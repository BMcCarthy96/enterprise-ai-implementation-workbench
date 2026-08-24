\set ON_ERROR_STOP on

-- This check runs with the migration/admin connection. It never prints a
-- connection string or grants anything. The application role must already be
-- provisioned separately, and must not be allowed to bypass RLS.
SELECT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = :'runtime_role'
) AS runtime_role_exists \gset

\if :runtime_role_exists
\else
  \echo 'Runtime role does not exist; provision it before deploying the web runtime.'
  \quit 3
\endif

SELECT rolbypassrls AS runtime_role_bypasses_rls
FROM pg_roles
WHERE rolname = :'runtime_role' \gset

\if :runtime_role_bypasses_rls
  \echo 'Runtime role must not have BYPASSRLS.'
  \quit 3
\endif

DO $$
DECLARE
  missing_count integer;
BEGIN
  SELECT count(*) INTO missing_count
  FROM unnest(ARRAY[
    'organizations', 'memberships', 'customers', 'projects', 'requirements',
    'plans', 'milestones', 'tasks', 'approvals', 'customer_updates',
    'documents', 'document_chunks', 'plan_citations', 'audit_events', 'jobs',
    'job_attempts', 'ai_runs', 'ai_calls', 'ai_run_evaluations',
    'identity_connections', 'external_identities', 'scim_tokens',
    'directory_groups', 'webhook_endpoints', 'webhook_deliveries',
    'retention_policies', 'retention_runs', 'demo_workspaces',
    'customer_assignments', 'approval_regeneration_intents'
  ]) AS expected(table_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = expected.table_name
      AND c.relrowsecurity
      AND c.relforcerowsecurity
  );
  IF missing_count > 0 THEN
    RAISE EXCEPTION 'RLS is not enabled and forced on % expected tables', missing_count;
  END IF;
END $$;

\echo 'Runtime role preflight passed: role exists, cannot bypass RLS, and expected tables are forced.'
