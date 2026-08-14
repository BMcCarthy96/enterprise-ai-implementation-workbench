\set ON_ERROR_STOP on

-- Usage (run as the migration/owner role after migrations):
--   psql "$DATABASE_ADMIN_URL" -v runtime_role=workbench_runtime \
--     -f scripts/provision-runtime-role.sql
--
-- The role must already exist and receive its password/connection policy from
-- the deployment platform. This script deliberately never creates credentials.

SELECT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = :'runtime_role'
) AS runtime_role_exists \gset

\if :runtime_role_exists
\else
  \echo 'The requested runtime_role does not exist; create it through the deployment platform first.'
  \quit 3
\endif

SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'runtime_role') \gexec

-- Identity mutation is reserved for the admin connection used by OIDC and
-- SCIM. The runtime role only needs users for login and tenant-scoped joins;
-- the global users table intentionally has no RLS policy of its own.
SELECT format(
  'REVOKE INSERT, UPDATE, DELETE ON TABLE users FROM %I',
  :'runtime_role'
) \gexec
SELECT format('GRANT SELECT ON TABLE users TO %I', :'runtime_role') \gexec

SELECT format(
  'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %s TO %I',
  'organizations, memberships, identity_connections, external_identities, scim_tokens, directory_groups, webhook_endpoints, webhook_deliveries, retention_policies, retention_runs, demo_workspaces, customers, projects, requirements, plans, milestones, tasks, approvals, customer_updates, documents, document_chunks, plan_citations, audit_events, jobs, job_attempts, ai_runs, ai_calls, ai_run_evaluations',
  :'runtime_role'
) \gexec

-- Audit rows are append-only to the application role. Retention cleanup runs
-- through DATABASE_ADMIN_URL and is therefore not weakened by this revoke.
SELECT format('REVOKE UPDATE, DELETE ON TABLE audit_events FROM %I', :'runtime_role') \gexec
SELECT format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', :'runtime_role') \gexec

-- Future application tables remain deployable under the runtime connection.
-- A migration introducing a more restrictive table (for example another
-- append-only ledger) must explicitly revoke excess actions in that migration.
SELECT format(
  'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
  :'runtime_role'
) \gexec
SELECT format(
  'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I',
  :'runtime_role'
) \gexec

-- FORCE every policy-enabled application table so accidentally making the
-- runtime role its owner cannot bypass tenant policies. The migration/admin
-- role must remain separate and have BYPASSRLS for cleanup and migrations.
SELECT format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', schemaname, tablename)
FROM pg_tables
WHERE schemaname = 'public'
  AND rowsecurity
ORDER BY tablename
\gexec

\echo 'Runtime role grants and forced RLS policies applied.'
