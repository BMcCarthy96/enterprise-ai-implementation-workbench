-- Defense-in-depth tenant isolation. Runtime connections must set
-- app.org_id inside a transaction; login may set app.user_id to discover the
-- caller's organization before an org context exists. Migrations and seed
-- operations use a separate owner/admin connection.
CREATE OR REPLACE FUNCTION app_current_org_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.org_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY organizations_tenant_isolation ON organizations
  USING (
    id = app_current_org_id()
    OR EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.org_id = organizations.id
        AND m.user_id = app_current_user_id()
    )
  )
  WITH CHECK (id = app_current_org_id());

CREATE POLICY memberships_tenant_isolation ON memberships
  USING (org_id = app_current_org_id() OR user_id = app_current_user_id())
  WITH CHECK (org_id = app_current_org_id());

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'customers', 'projects', 'requirements', 'plans', 'milestones',
    'tasks', 'approvals', 'customer_updates', 'documents', 'audit_events', 'jobs'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id())',
      table_name || '_tenant_isolation', table_name
    );
  END LOOP;
END $$;
