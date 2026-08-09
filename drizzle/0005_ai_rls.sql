ALTER TABLE ai_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_runs_tenant_isolation ON ai_runs
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());

CREATE POLICY ai_calls_tenant_isolation ON ai_calls
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());
