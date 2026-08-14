ALTER TABLE "plan_citations"
  ADD COLUMN IF NOT EXISTS "retriever_version" text NOT NULL DEFAULT 'hybrid-v1',
  ADD COLUMN IF NOT EXISTS "query_hash" text,
  ADD COLUMN IF NOT EXISTS "rank" integer,
  ADD COLUMN IF NOT EXISTS "vector_score" numeric(10, 8),
  ADD COLUMN IF NOT EXISTS "lexical_score" numeric(10, 8),
  ADD COLUMN IF NOT EXISTS "selection_reason" text,
  ADD COLUMN IF NOT EXISTS "redacted_excerpt" text;

CREATE INDEX IF NOT EXISTS "plan_citations_query_hash_idx"
  ON "plan_citations" ("query_hash");
