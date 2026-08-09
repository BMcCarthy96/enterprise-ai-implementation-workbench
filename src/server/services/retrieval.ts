import { sql } from "drizzle-orm";
import { db } from "@/db";
import { embeddingProvider, type EmbeddingResult } from "@/lib/ai/embeddings";
import { redactSensitiveText } from "@/lib/ai/redaction";

export interface RetrievedSource {
  ref: string;
  chunkId: string;
  documentId: string;
  documentName: string;
  content: string;
  pageNumber: number | null;
  heading: string | null;
}

export interface RetrievalResult {
  sources: RetrievedSource[];
  embedding: EmbeddingResult | null;
  redactionCount: number;
}

/**
 * Retrieval is always scoped by both tenant and project in the SQL predicate;
 * the vector index only accelerates the already-isolated candidate set.
 */
export async function retrieveProjectSources(input: {
  orgId: string;
  projectId: string;
  query: string;
  limit?: number;
}): Promise<RetrievalResult> {
  const available = (await db.execute(sql`
    SELECT 1
    FROM document_chunks dc
    INNER JOIN documents d ON d.id = dc.document_id
    WHERE dc.org_id = ${input.orgId}
      AND dc.project_id = ${input.projectId}
      AND d.status = 'ready'
    LIMIT 1
  `)) as unknown as unknown[];
  if (!available.length) return { sources: [], embedding: null, redactionCount: 0 };
  const provider = await embeddingProvider();
  const redacted = redactSensitiveText(input.query);
  const embedding = await provider.embed(redacted.text);
  const vector = `[${embedding.vector.join(",")}]`;
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 8);
  const maxCosineDistance = 0.9;
  const rows = (await db.execute(sql`
    SELECT
      dc.id AS "chunkId",
      dc.document_id AS "documentId",
      dc.content AS content,
      dc.page_number AS "pageNumber",
      dc.heading AS heading,
      d.file_name AS "documentName"
    FROM document_chunks dc
    INNER JOIN documents d ON d.id = dc.document_id
    WHERE dc.org_id = ${input.orgId}
      AND dc.project_id = ${input.projectId}
      AND d.status = 'ready'
      AND (dc.embedding <=> ${vector}::vector) <= ${maxCosineDistance}
    ORDER BY dc.embedding <=> ${vector}::vector
    LIMIT ${limit}
  `)) as unknown as Array<{
    chunkId: string;
    documentId: string;
    content: string;
    pageNumber: number | null;
    heading: string | null;
    documentName: string;
  }>;
  return {
    embedding,
    redactionCount:
      redacted.counts.email + redacted.counts.phone + redacted.counts.identifier,
    sources: rows.map((row, index) => ({
      ref: `S${index + 1}`,
      ...row,
      content: redactSensitiveText(row.content).text,
    })),
  };
}

export function retrievalQuery(input: {
  projectName: string;
  projectDescription: string | null;
  requirements: Array<{ title: string; details: string | null }>;
}): string {
  return [
    input.projectName,
    input.projectDescription,
    ...input.requirements.flatMap((requirement) => [requirement.title, requirement.details]),
  ]
    .filter(Boolean)
    .join("\n");
}
