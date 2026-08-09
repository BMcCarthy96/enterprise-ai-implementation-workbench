ALTER TABLE "jobs"
  ADD COLUMN IF NOT EXISTS "dispatched_at" timestamptz;

CREATE INDEX IF NOT EXISTS "jobs_dispatch_idx"
  ON "jobs" ("status", "dispatched_at");

-- The application also checks before enqueueing; this index closes the
-- concurrent-request race at the database boundary.
CREATE UNIQUE INDEX IF NOT EXISTS "jobs_one_active_plan_generation_idx"
  ON "jobs" ("project_id")
  WHERE "project_id" IS NOT NULL
    AND "type" = 'plan_generation'
    AND "status" IN ('queued', 'running');
