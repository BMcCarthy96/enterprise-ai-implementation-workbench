ALTER TABLE "demo_workspaces"
  ADD COLUMN IF NOT EXISTS "reserved_spend_usd" numeric(12, 8) NOT NULL DEFAULT 0;
