ALTER TABLE "webhook_deliveries"
  ADD COLUMN IF NOT EXISTS "claim_expires_at" timestamptz;

CREATE INDEX IF NOT EXISTS "webhook_deliveries_claim_idx"
  ON "webhook_deliveries" ("status", "claim_expires_at");
