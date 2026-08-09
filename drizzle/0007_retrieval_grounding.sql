CREATE EXTENSION IF NOT EXISTS vector;

ALTER TYPE "job_type" ADD VALUE IF NOT EXISTS 'document_ingest';

DO $$ BEGIN
  CREATE TYPE "document_status" AS ENUM ('pending_upload', 'queued', 'processing', 'ready', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "status" "document_status" NOT NULL DEFAULT 'pending_upload',
  ADD COLUMN IF NOT EXISTS "sha256" text,
  ADD COLUMN IF NOT EXISTS "error_code" text,
  ADD COLUMN IF NOT EXISTS "processed_at" timestamptz;

-- Existing uploads predate ingestion. Treat them as registered legacy files;
-- a user can re-upload to create a grounded, ready document with chunks.
UPDATE "documents" SET "status" = 'ready' WHERE "status" = 'pending_upload';

CREATE TABLE IF NOT EXISTS "document_chunks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "document_id" uuid NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "chunk_index" integer NOT NULL,
  "content" text NOT NULL,
  "content_hash" text NOT NULL,
  "page_number" integer,
  "heading" text,
  "token_count" integer NOT NULL DEFAULT 0,
  "embedding" vector(1024) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "document_chunks_document_index_unique" UNIQUE("document_id", "chunk_index")
);

CREATE INDEX IF NOT EXISTS "document_chunks_project_idx" ON "document_chunks" ("project_id");
CREATE INDEX IF NOT EXISTS "document_chunks_org_idx" ON "document_chunks" ("org_id");
CREATE INDEX IF NOT EXISTS "document_chunks_embedding_hnsw_idx"
  ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops);

CREATE TABLE IF NOT EXISTS "plan_citations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "plan_id" uuid NOT NULL REFERENCES "plans"("id") ON DELETE CASCADE,
  "source_ref" text NOT NULL,
  "chunk_id" uuid NOT NULL REFERENCES "document_chunks"("id") ON DELETE CASCADE,
  "location" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "plan_citations_plan_ref_unique" UNIQUE("plan_id", "source_ref")
);

CREATE INDEX IF NOT EXISTS "plan_citations_project_idx" ON "plan_citations" ("project_id");
CREATE INDEX IF NOT EXISTS "plan_citations_chunk_idx" ON "plan_citations" ("chunk_id");

ALTER TABLE "document_chunks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "plan_citations" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "document_chunks_org_isolation" ON "document_chunks";
CREATE POLICY "document_chunks_org_isolation" ON "document_chunks"
  USING ("org_id" = app_current_org_id())
  WITH CHECK ("org_id" = app_current_org_id());

DROP POLICY IF EXISTS "plan_citations_org_isolation" ON "plan_citations";
CREATE POLICY "plan_citations_org_isolation" ON "plan_citations"
  USING ("org_id" = app_current_org_id())
  WITH CHECK ("org_id" = app_current_org_id());
