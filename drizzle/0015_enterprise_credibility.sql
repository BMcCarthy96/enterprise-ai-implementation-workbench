ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "external_id" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "scim_org_id" uuid REFERENCES "organizations"("id") ON DELETE SET NULL;
ALTER TABLE "memberships"
  ADD COLUMN IF NOT EXISTS "active" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "session_version" integer NOT NULL DEFAULT 1;
ALTER TABLE "jobs"
  ADD COLUMN IF NOT EXISTS "trace_id" text,
  ADD COLUMN IF NOT EXISTS "trace_parent" text;
ALTER TYPE "job_type" ADD VALUE IF NOT EXISTS 'webhook_delivery';

CREATE TABLE IF NOT EXISTS "identity_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "slug" text NOT NULL,
  "issuer_url" text NOT NULL,
  "client_id" text NOT NULL,
  "client_secret_ciphertext" text,
  "encryption_key_version" integer NOT NULL DEFAULT 1,
  "enabled" boolean NOT NULL DEFAULT false,
  "jit_enabled" boolean NOT NULL DEFAULT false,
  "allowed_domains" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "group_mappings" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "identity_connections_org_slug_unique" ON "identity_connections" ("org_id", "slug");
CREATE INDEX IF NOT EXISTS "identity_connections_org_idx" ON "identity_connections" ("org_id");

CREATE TABLE IF NOT EXISTS "external_identities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "connection_id" uuid NOT NULL REFERENCES "identity_connections"("id") ON DELETE CASCADE,
  "subject" text NOT NULL,
  "email" text NOT NULL,
  "last_login_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "external_identities_connection_subject_unique" ON "external_identities" ("connection_id", "subject");
CREATE INDEX IF NOT EXISTS "external_identities_org_idx" ON "external_identities" ("org_id");
CREATE INDEX IF NOT EXISTS "external_identities_user_idx" ON "external_identities" ("user_id");

CREATE TABLE IF NOT EXISTS "scim_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "label" text NOT NULL,
  "token_hash" text NOT NULL UNIQUE,
  "expires_at" timestamptz,
  "last_used_at" timestamptz,
  "revoked_at" timestamptz,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "scim_tokens_org_idx" ON "scim_tokens" ("org_id");

CREATE TABLE IF NOT EXISTS "directory_groups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "external_id" text NOT NULL,
  "display_name" text NOT NULL,
  "mapped_role" "membership_role",
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "directory_groups_org_external_unique" ON "directory_groups" ("org_id", "external_id");
CREATE INDEX IF NOT EXISTS "directory_groups_org_idx" ON "directory_groups" ("org_id");

CREATE TABLE IF NOT EXISTS "webhook_endpoints" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "url" text NOT NULL,
  "secret_ciphertext" text NOT NULL,
  "encryption_key_version" integer NOT NULL DEFAULT 1,
  "event_types" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "webhook_endpoints_org_idx" ON "webhook_endpoints" ("org_id");

CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "endpoint_id" uuid NOT NULL REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE,
  "event_id" uuid NOT NULL,
  "event_type" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" text NOT NULL DEFAULT 'queued',
  "attempts" integer NOT NULL DEFAULT 0,
  "next_attempt_at" timestamptz,
  "response_status" integer,
  "response_body" text,
  "last_error" text,
  "delivered_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "webhook_deliveries_org_created_idx" ON "webhook_deliveries" ("org_id", "created_at");
CREATE INDEX IF NOT EXISTS "webhook_deliveries_endpoint_idx" ON "webhook_deliveries" ("endpoint_id");
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_deliveries_event_endpoint_unique" ON "webhook_deliveries" ("endpoint_id", "event_id");

CREATE TABLE IF NOT EXISTS "retention_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL UNIQUE REFERENCES "organizations"("id") ON DELETE CASCADE,
  "audit_days" integer NOT NULL DEFAULT 365,
  "ai_detail_days" integer NOT NULL DEFAULT 90,
  "completed_job_days" integer NOT NULL DEFAULT 30,
  "webhook_delivery_days" integer NOT NULL DEFAULT 30,
  "updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "retention_policies_org_idx" ON "retention_policies" ("org_id");

CREATE TABLE IF NOT EXISTS "retention_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "status" text NOT NULL DEFAULT 'running',
  "counts" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "error" text,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "finished_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "retention_runs_org_started_idx" ON "retention_runs" ("org_id", "started_at");

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'identity_connections',
    'external_identities',
    'scim_tokens',
    'directory_groups',
    'webhook_endpoints',
    'webhook_deliveries',
    'retention_policies',
    'retention_runs'
  ] LOOP
    EXECUTE format('ALTER TABLE "%s" ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS "%s_tenant_isolation" ON "%s"', table_name, table_name);
    EXECUTE format(
      'CREATE POLICY "%s_tenant_isolation" ON "%s" USING ("org_id" = app_current_org_id()) WITH CHECK ("org_id" = app_current_org_id())',
      table_name,
      table_name
    );
  END LOOP;
END $$;
