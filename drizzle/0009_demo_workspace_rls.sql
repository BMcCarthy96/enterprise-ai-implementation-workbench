-- Demo quota state is tenant-owned too. The admin connection used by the
-- public-session allocator and scheduled cleanup intentionally bypasses this
-- policy; normal application reads run inside withTenantTransaction.
ALTER TABLE "demo_workspaces" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "demo_workspaces_org_isolation" ON "demo_workspaces";
CREATE POLICY "demo_workspaces_org_isolation" ON "demo_workspaces"
  USING ("org_id" = app_current_org_id())
  WITH CHECK ("org_id" = app_current_org_id());
