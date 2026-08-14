ALTER TABLE "approvals"
  ADD COLUMN IF NOT EXISTS "decision_fingerprint" text;

-- Migration 0016 necessarily used one default for existing rows. Correct
-- historical mock-provider runs without overwriting explicitly labelled
-- fixtures or any real-provider provenance.
UPDATE "ai_runs"
SET "data_origin" = 'mock_run'
WHERE "provider" = 'mock'
  AND "data_origin" = 'live_provider';

-- Preserve monotonic attempt numbering for any job manually retried between
-- migrations 0016 and 0018, when retry still reset jobs.attempts to zero.
UPDATE "jobs" AS j
SET "attempts" = prior."last_attempt"
FROM (
  SELECT "job_id", max("attempt") AS "last_attempt"
  FROM "job_attempts"
  GROUP BY "job_id"
) AS prior
WHERE j."id" = prior."job_id"
  AND j."attempts" < prior."last_attempt";
