ALTER TABLE "ai_runs"
  ADD COLUMN IF NOT EXISTS "redaction_count" integer NOT NULL DEFAULT 0;

ALTER TABLE "ai_calls"
  ADD COLUMN IF NOT EXISTS "redaction_count" integer NOT NULL DEFAULT 0;
