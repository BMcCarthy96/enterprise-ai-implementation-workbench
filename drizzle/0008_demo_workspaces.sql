CREATE TABLE IF NOT EXISTS "demo_workspaces" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL UNIQUE REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "ip_hash" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "generation_jobs_used" integer NOT NULL DEFAULT 0,
  "upload_count" integer NOT NULL DEFAULT 0,
  "upload_bytes" integer NOT NULL DEFAULT 0,
  "max_generation_jobs" integer NOT NULL DEFAULT 3,
  "max_uploads" integer NOT NULL DEFAULT 2,
  "max_storage_bytes" integer NOT NULL DEFAULT 10485760,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "demo_workspaces_ip_expires_idx" ON "demo_workspaces" ("ip_hash", "expires_at");
CREATE INDEX IF NOT EXISTS "demo_workspaces_expires_idx" ON "demo_workspaces" ("expires_at");
