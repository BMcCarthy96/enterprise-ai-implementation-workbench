ALTER TABLE "jobs"
  ADD COLUMN IF NOT EXISTS "lease_owner" text,
  ADD COLUMN IF NOT EXISTS "lease_expires_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "heartbeat_at" timestamptz;

CREATE INDEX IF NOT EXISTS "jobs_lease_idx"
  ON "jobs" ("status", "lease_expires_at");

CREATE UNIQUE INDEX IF NOT EXISTS "milestones_plan_sort_unique"
  ON "milestones" ("plan_id", "sort_order");
CREATE UNIQUE INDEX IF NOT EXISTS "tasks_milestone_sort_unique"
  ON "tasks" ("milestone_id", "sort_order");

CREATE TABLE IF NOT EXISTS "job_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "job_id" uuid NOT NULL REFERENCES "jobs"("id") ON DELETE CASCADE,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "attempt" integer NOT NULL,
  "worker_id" text,
  "status" text NOT NULL DEFAULT 'running',
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "finished_at" timestamptz,
  "duration_ms" integer,
  "error" text,
  "trace_id" text
);

CREATE UNIQUE INDEX IF NOT EXISTS "job_attempts_job_attempt_unique"
  ON "job_attempts" ("job_id", "attempt");
CREATE INDEX IF NOT EXISTS "job_attempts_org_started_idx"
  ON "job_attempts" ("org_id", "started_at");
CREATE INDEX IF NOT EXISTS "job_attempts_job_idx"
  ON "job_attempts" ("job_id", "started_at");

ALTER TABLE "job_attempts" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "job_attempts_tenant_isolation" ON "job_attempts";
CREATE POLICY "job_attempts_tenant_isolation" ON "job_attempts"
  USING ("org_id" = app_current_org_id())
  WITH CHECK ("org_id" = app_current_org_id());

ALTER TABLE "ai_runs"
  ADD COLUMN IF NOT EXISTS "data_origin" text NOT NULL DEFAULT 'live_provider';

ALTER TABLE "approvals"
  ADD COLUMN IF NOT EXISTS "decision_key" text,
  ADD COLUMN IF NOT EXISTS "regeneration_job_id" uuid;

CREATE UNIQUE INDEX IF NOT EXISTS "approvals_decision_key_unique"
  ON "approvals" ("id", "decision_key");
