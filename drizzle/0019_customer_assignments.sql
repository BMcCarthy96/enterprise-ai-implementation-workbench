CREATE TABLE IF NOT EXISTS "customer_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "customer_id" uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "customer_assignments_user_customer_unique" UNIQUE ("org_id", "user_id", "customer_id")
);

CREATE INDEX IF NOT EXISTS "customer_assignments_org_user_idx"
  ON "customer_assignments" ("org_id", "user_id");
CREATE INDEX IF NOT EXISTS "customer_assignments_org_customer_idx"
  ON "customer_assignments" ("org_id", "customer_id");

ALTER TABLE "demo_workspaces"
  ADD COLUMN IF NOT EXISTS "network_hash" text;
CREATE INDEX IF NOT EXISTS "demo_workspaces_network_expires_idx"
  ON "demo_workspaces" ("network_hash", "expires_at");

CREATE TABLE IF NOT EXISTS "approval_regeneration_intents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "approval_id" uuid NOT NULL REFERENCES "approvals"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "requested_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "job_id" uuid,
  "status" text NOT NULL DEFAULT 'queued',
  "last_error" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "dispatched_at" timestamptz,
  CONSTRAINT "approval_regeneration_intents_approval_unique" UNIQUE ("approval_id")
);
CREATE INDEX IF NOT EXISTS "approval_regeneration_intents_org_status_idx"
  ON "approval_regeneration_intents" ("org_id", "status");

-- Preserve access for existing seeded or imported stakeholder accounts when
-- their customer record already names the same primary contact. Ambiguous or
-- unlisted relationships remain unassigned and can be granted explicitly from
-- Settings → Members → Customer access.
INSERT INTO "customer_assignments" ("org_id", "user_id", "customer_id")
SELECT m."org_id", m."user_id", c."id"
FROM "memberships" m
JOIN "users" u ON u."id" = m."user_id"
JOIN "customers" c
  ON c."org_id" = m."org_id"
 AND lower(c."primary_contact_email") = lower(u."email")
WHERE m."role" = 'customer_stakeholder'
ON CONFLICT ("org_id", "user_id", "customer_id") DO NOTHING;

ALTER TABLE "customer_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "approval_regeneration_intents" ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION app_is_customer_stakeholder() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM memberships
    WHERE org_id = app_current_org_id()
      AND user_id = app_current_user_id()
      AND active
      AND role = 'customer_stakeholder'
  )
$$;

CREATE OR REPLACE FUNCTION app_user_can_access_project(candidate_project_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM projects p
    WHERE p.id = candidate_project_id
      AND p.org_id = app_current_org_id()
      AND (
        NOT app_is_customer_stakeholder()
        OR EXISTS (
          SELECT 1
          FROM customer_assignments ca
          WHERE ca.org_id = p.org_id
            AND ca.user_id = app_current_user_id()
            AND ca.customer_id = p.customer_id
        )
      )
  )
$$;

DROP POLICY IF EXISTS customer_assignments_tenant_isolation ON customer_assignments;
DROP POLICY IF EXISTS customer_assignments_tenant_select ON customer_assignments;
DROP POLICY IF EXISTS customer_assignments_tenant_internal ON customer_assignments;
CREATE POLICY customer_assignments_tenant_select ON customer_assignments
  FOR SELECT
  USING (
    org_id = app_current_org_id()
    AND (NOT app_is_customer_stakeholder() OR user_id = app_current_user_id())
  );
CREATE POLICY customer_assignments_tenant_internal ON customer_assignments
  FOR ALL
  USING (org_id = app_current_org_id() AND NOT app_is_customer_stakeholder())
  WITH CHECK (org_id = app_current_org_id() AND NOT app_is_customer_stakeholder());

DROP POLICY IF EXISTS customers_tenant_isolation ON customers;
DROP POLICY IF EXISTS customers_tenant_select ON customers;
DROP POLICY IF EXISTS customers_tenant_internal ON customers;
CREATE POLICY customers_tenant_select ON customers
  FOR SELECT
  USING (
    org_id = app_current_org_id()
    AND (
      NOT app_is_customer_stakeholder()
      OR EXISTS (
        SELECT 1 FROM customer_assignments ca
        WHERE ca.org_id = customers.org_id
          AND ca.user_id = app_current_user_id()
          AND ca.customer_id = customers.id
      )
    )
  );
CREATE POLICY customers_tenant_internal ON customers
  FOR ALL
  USING (org_id = app_current_org_id() AND NOT app_is_customer_stakeholder())
  WITH CHECK (org_id = app_current_org_id() AND NOT app_is_customer_stakeholder());

DROP POLICY IF EXISTS projects_tenant_isolation ON projects;
DROP POLICY IF EXISTS projects_tenant_select ON projects;
DROP POLICY IF EXISTS projects_tenant_internal ON projects;
CREATE POLICY projects_tenant_select ON projects
  FOR SELECT
  USING (app_user_can_access_project(id))
;
CREATE POLICY projects_tenant_internal ON projects
  FOR ALL
  USING (org_id = app_current_org_id() AND NOT app_is_customer_stakeholder())
  WITH CHECK (org_id = app_current_org_id() AND NOT app_is_customer_stakeholder());

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'requirements', 'plans', 'milestones', 'tasks', 'approvals',
    'customer_updates', 'documents', 'audit_events', 'jobs',
    'document_chunks', 'plan_citations', 'ai_runs'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_tenant_isolation', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_tenant_select', table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_tenant_internal', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (org_id = app_current_org_id() AND (NOT app_is_customer_stakeholder() OR (project_id IS NOT NULL AND app_user_can_access_project(project_id))))',
      table_name || '_tenant_select', table_name
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (org_id = app_current_org_id() AND NOT app_is_customer_stakeholder()) WITH CHECK (org_id = app_current_org_id() AND NOT app_is_customer_stakeholder())',
      table_name || '_tenant_internal', table_name
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS approval_regeneration_intents_tenant_isolation ON approval_regeneration_intents;
DROP POLICY IF EXISTS approval_regeneration_intents_tenant_select ON approval_regeneration_intents;
DROP POLICY IF EXISTS approval_regeneration_intents_tenant_internal ON approval_regeneration_intents;
CREATE POLICY approval_regeneration_intents_tenant_select ON approval_regeneration_intents
  FOR SELECT
  USING (
    org_id = app_current_org_id()
    AND app_user_can_access_project(project_id)
  );
CREATE POLICY approval_regeneration_intents_tenant_internal ON approval_regeneration_intents
  FOR ALL
  USING (org_id = app_current_org_id() AND NOT app_is_customer_stakeholder())
  WITH CHECK (org_id = app_current_org_id() AND NOT app_is_customer_stakeholder());

DROP POLICY IF EXISTS ai_calls_tenant_isolation ON ai_calls;
DROP POLICY IF EXISTS ai_calls_tenant_select ON ai_calls;
DROP POLICY IF EXISTS ai_calls_tenant_internal ON ai_calls;
CREATE POLICY ai_calls_tenant_select ON ai_calls
  FOR SELECT
  USING (
    org_id = app_current_org_id()
    AND EXISTS (
      SELECT 1 FROM ai_runs r
      WHERE r.id = ai_calls.ai_run_id
        AND r.project_id IS NOT NULL
        AND app_user_can_access_project(r.project_id)
    )
  );
CREATE POLICY ai_calls_tenant_internal ON ai_calls
  FOR ALL
  USING (org_id = app_current_org_id() AND NOT app_is_customer_stakeholder())
  WITH CHECK (org_id = app_current_org_id() AND NOT app_is_customer_stakeholder());

DROP POLICY IF EXISTS ai_run_evaluations_tenant_isolation ON ai_run_evaluations;
DROP POLICY IF EXISTS ai_run_evaluations_tenant_select ON ai_run_evaluations;
DROP POLICY IF EXISTS ai_run_evaluations_tenant_internal ON ai_run_evaluations;
CREATE POLICY ai_run_evaluations_tenant_select ON ai_run_evaluations
  FOR SELECT
  USING (
    org_id = app_current_org_id()
    AND EXISTS (
      SELECT 1 FROM ai_runs r
      WHERE r.id = ai_run_evaluations.ai_run_id
        AND r.project_id IS NOT NULL
        AND app_user_can_access_project(r.project_id)
    )
  );
CREATE POLICY ai_run_evaluations_tenant_internal ON ai_run_evaluations
  FOR ALL
  USING (org_id = app_current_org_id() AND NOT app_is_customer_stakeholder())
  WITH CHECK (org_id = app_current_org_id() AND NOT app_is_customer_stakeholder());

DROP POLICY IF EXISTS job_attempts_tenant_isolation ON job_attempts;
DROP POLICY IF EXISTS job_attempts_tenant_select ON job_attempts;
DROP POLICY IF EXISTS job_attempts_tenant_internal ON job_attempts;
CREATE POLICY job_attempts_tenant_select ON job_attempts
  FOR SELECT
  USING (
    org_id = app_current_org_id()
    AND EXISTS (
      SELECT 1 FROM jobs j
      WHERE j.id = job_attempts.job_id
        AND j.project_id IS NOT NULL
        AND app_user_can_access_project(j.project_id)
    )
  );
CREATE POLICY job_attempts_tenant_internal ON job_attempts
  FOR ALL
  USING (org_id = app_current_org_id() AND NOT app_is_customer_stakeholder())
  WITH CHECK (org_id = app_current_org_id() AND NOT app_is_customer_stakeholder());
