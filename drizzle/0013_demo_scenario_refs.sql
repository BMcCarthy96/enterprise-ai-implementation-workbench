ALTER TABLE "demo_workspaces"
  ADD COLUMN IF NOT EXISTS "scenario_refs" jsonb;
