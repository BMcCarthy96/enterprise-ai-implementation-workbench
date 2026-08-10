ALTER TABLE "ai_calls"
  ADD COLUMN IF NOT EXISTS "validation_evidence" jsonb;

CREATE TABLE IF NOT EXISTS "ai_run_evaluations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "ai_run_id" uuid NOT NULL REFERENCES "ai_runs"("id") ON DELETE CASCADE,
  "check_name" text NOT NULL,
  "category" text NOT NULL,
  "gate_level" text NOT NULL,
  "score" numeric(8, 6) NOT NULL,
  "threshold" numeric(8, 6) NOT NULL,
  "passed" boolean NOT NULL DEFAULT false,
  "detail" text NOT NULL,
  "evaluator_version" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "ai_run_evaluations_unique"
  ON "ai_run_evaluations" ("ai_run_id", "check_name", "evaluator_version");
CREATE INDEX IF NOT EXISTS "ai_run_evaluations_org_idx"
  ON "ai_run_evaluations" ("org_id", "created_at");
CREATE INDEX IF NOT EXISTS "ai_run_evaluations_run_idx"
  ON "ai_run_evaluations" ("ai_run_id");

ALTER TABLE "ai_run_evaluations" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ai_run_evaluations_tenant_isolation" ON "ai_run_evaluations";
CREATE POLICY "ai_run_evaluations_tenant_isolation" ON "ai_run_evaluations"
  USING ("org_id" = app_current_org_id())
  WITH CHECK ("org_id" = app_current_org_id());
