import { createHash } from "node:crypto";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { ApiError } from "@/lib/api";
import { headObject } from "@/lib/aws/s3";
import { readObject } from "@/lib/aws/s3";
import { embeddingProvider } from "@/lib/ai/embeddings";
import { redactSensitiveText, totalRedactions } from "@/lib/ai/redaction";
import {
  finishAiRun,
  finishAiRunAfterCommit,
  recordAiCall,
  startAiRun,
} from "./aiTelemetry";
import { createAndEnqueueJob } from "./jobs";
import { recordAudit } from "./audit";

export interface DocumentSection {
  text: string;
  pageNumber?: number;
  heading?: string;
}

export interface DocumentChunkInput {
  content: string;
  contentHash: string;
  chunkIndex: number;
  pageNumber?: number;
  heading?: string;
  tokenCount: number;
}

const MAX_TOKENS = 700;
const OVERLAP_TOKENS = 100;

export async function extractDocumentSections(
  buffer: Buffer,
  contentType: string,
  fileName: string,
): Promise<DocumentSection[]> {
  const normalized = contentType.toLowerCase();
  if (normalized === "application/pdf" || fileName.toLowerCase().endsWith(".pdf")) {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.pages
        .map((page) => ({ text: page.text.trim(), pageNumber: page.num }))
        .filter((section) => section.text.length > 0);
    } finally {
      await parser.destroy();
    }
  }
  if (
    normalized ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    fileName.toLowerCase().endsWith(".docx")
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return splitTextSections(result.value);
  }
  if (
    normalized.startsWith("text/") ||
    normalized === "application/markdown" ||
    /\.(txt|md|markdown)$/i.test(fileName)
  ) {
    return splitTextSections(buffer.toString("utf8"));
  }
  throw new Error("UNSUPPORTED_DOCUMENT_TYPE");
}

export function splitTextSections(text: string): DocumentSection[] {
  const sections: DocumentSection[] = [];
  let heading: string | undefined;
  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  for (const paragraph of paragraphs) {
    const headingMatch = paragraph.match(/^#{1,6}\s+(.+)$/m);
    if (headingMatch) {
      heading = headingMatch[1].trim();
    }
    sections.push({ text: paragraph, heading });
  }
  return sections;
}

export function chunkDocumentSections(sections: DocumentSection[]): DocumentChunkInput[] {
  const chunks: DocumentChunkInput[] = [];
  let chunkIndex = 0;
  for (const section of sections) {
    const words = section.text.split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    for (let start = 0; start < words.length; start += MAX_TOKENS - OVERLAP_TOKENS) {
      const selected = words.slice(start, start + MAX_TOKENS);
      const content = selected.join(" ").trim();
      if (!content) continue;
      chunks.push({
        content,
        contentHash: createHash("sha256").update(content).digest("hex"),
        chunkIndex,
        pageNumber: section.pageNumber,
        heading: section.heading,
        tokenCount: selected.length,
      });
      chunkIndex += 1;
      if (start + MAX_TOKENS >= words.length) break;
    }
  }
  return chunks;
}

export function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function completeDocumentUpload(input: {
  documentId: string;
  orgId: string;
  actorId: string;
}) {
  const document = await db.query.documents.findFirst({
    where: (table, { and, eq: equals }) =>
      and(equals(table.id, input.documentId), equals(table.orgId, input.orgId)),
  });
  if (!document) throw new ApiError(404, "Document not found");
  if (document.status !== "pending_upload") {
    return { document, jobId: await findActiveIngestionJob(document.id) };
  }

  let object: { sizeBytes: number; contentType: string };
  try {
    object = await headObject(document.s3Key);
  } catch {
    throw new ApiError(400, "Uploaded object was not found", "UPLOAD_NOT_FOUND");
  }
  if (object.sizeBytes !== document.sizeBytes || object.contentType !== document.contentType) {
    throw new ApiError(400, "Uploaded object metadata does not match the request", "UPLOAD_MISMATCH");
  }
  const [claimed] = await db
    .update(schema.documents)
    .set({ status: "queued", errorCode: null })
    .where(
      and(
        eq(schema.documents.id, document.id),
        eq(schema.documents.status, "pending_upload"),
      ),
    )
    .returning({ id: schema.documents.id });
  // Upload completion is idempotent. A concurrent request that loses the
  // pending_upload -> queued compare-and-set returns the winner's job.
  if (!claimed) {
    const current = await db.query.documents.findFirst({
      where: and(
        eq(schema.documents.id, document.id),
        eq(schema.documents.orgId, input.orgId),
      ),
    });
    return {
      document: current ?? document,
      jobId: await findActiveIngestionJob(document.id),
    };
  }
  const jobId = await createAndEnqueueJob({
    orgId: input.orgId,
    projectId: document.projectId,
    type: "document_ingest",
    payload: { documentId: document.id },
    requestedBy: input.actorId,
    auditMetadata: { documentId: document.id, fileName: document.fileName },
  });
  await recordAudit({
    orgId: input.orgId,
    actorId: input.actorId,
    action: "document.ingest_queued",
    subjectType: "document",
    subjectId: document.id,
    projectId: document.projectId,
    metadata: { jobId },
  });
  return {
    document: { ...document, status: "queued" as const },
    jobId,
  };
}

async function findActiveIngestionJob(documentId: string): Promise<string | null> {
  const job = await db.query.jobs.findFirst({
    where: and(
      eq(schema.jobs.type, "document_ingest"),
      sql`${schema.jobs.status} IN ('queued', 'running')`,
      sql`${schema.jobs.payload} ->> 'documentId' = ${documentId}`,
    ),
    orderBy: (table, { desc }) => desc(table.createdAt),
    columns: { id: true },
  });
  return job?.id ?? null;
}

export async function runDocumentIngestionJob(job: {
  id: string;
  orgId: string;
  projectId: string | null;
  payload?: unknown;
}): Promise<void> {
  const documentId =
    typeof job.payload === "object" && job.payload !== null && "documentId" in job.payload
      ? String((job.payload as { documentId: unknown }).documentId)
      : null;
  if (!documentId) throw new Error("document_ingest job missing documentId");
  const document = await db.query.documents.findFirst({
    where: (table, { and, eq: equals }) =>
      and(equals(table.id, documentId), equals(table.orgId, job.orgId)),
  });
  if (!document) throw new Error("Document not found for ingestion");
  if (document.status === "ready" && document.sha256) return;

  await db
    .update(schema.documents)
    .set({ status: "processing", errorCode: null })
    .where(eq(schema.documents.id, document.id));

  const provider = await embeddingProvider();
  const run = await startAiRun({
    orgId: job.orgId,
    projectId: document.projectId,
    jobId: job.id,
    artifactType: "document_ingest",
    provider: provider.name,
    promptVersion: "chunking-v1",
  });
  let sequence = 0;
  try {
    const buffer = await readObject(document.s3Key);
    const contentHash = sha256(buffer);
    const existingChunkCount = document.sha256 === contentHash
      ? await db.$count(
          schema.documentChunks,
          eq(schema.documentChunks.documentId, document.id),
        )
      : 0;
    if (document.sha256 === contentHash && existingChunkCount > 0) {
      await db
        .update(schema.documents)
        .set({ status: "ready", processedAt: new Date(), errorCode: null })
        .where(eq(schema.documents.id, document.id));
      await finishAiRunAfterCommit({ aiRunId: run.id, outcome: "succeeded" });
      return;
    }
    const sections = await extractDocumentSections(buffer, document.contentType, document.fileName);
    const chunks = chunkDocumentSections(sections);
    if (!chunks.length) throw new Error("EMPTY_DOCUMENT");

    await db.delete(schema.documentChunks).where(eq(schema.documentChunks.documentId, document.id));
    for (const chunk of chunks) {
      const redacted = redactSensitiveText(chunk.content);
      const startedAt = Date.now();
      try {
        const result = await provider.embed(redacted.text);
        sequence += 1;
        await recordAiCall({
          aiRunId: run.id,
          orgId: job.orgId,
          sequence,
          operation: "embed",
          provider: provider.name,
          model: result.model,
          result: {
            model: result.model,
            usage: {
              inputTokens: result.inputTokens,
              outputTokens: 0,
              source: result.usageSource,
            },
            providerRequestId: result.providerRequestId,
          },
          promptVersion: "chunking-v1",
          latencyMs: Date.now() - startedAt,
          outcome: "valid",
          redactionCount: totalRedactions(redacted.counts),
        });
        await db.insert(schema.documentChunks).values({
          orgId: job.orgId,
          projectId: document.projectId,
          documentId: document.id,
          chunkIndex: chunk.chunkIndex,
          content: chunk.content,
          contentHash: chunk.contentHash,
          pageNumber: chunk.pageNumber ?? null,
          heading: chunk.heading ?? null,
          tokenCount: chunk.tokenCount,
          embedding: result.vector,
        });
      } catch (error) {
        sequence += 1;
        await recordAiCall({
          aiRunId: run.id,
          orgId: job.orgId,
          sequence,
          operation: "embed",
          provider: provider.name,
          promptVersion: "chunking-v1",
          latencyMs: Date.now() - startedAt,
          outcome: "failed",
          errorKind: "embedding_error",
          redactionCount: totalRedactions(redacted.counts),
        });
        throw error;
      }
    }
    await db
      .update(schema.documents)
      .set({ status: "ready", sha256: contentHash, processedAt: new Date(), errorCode: null })
      .where(eq(schema.documents.id, document.id));
    await finishAiRunAfterCommit({ aiRunId: run.id, outcome: "succeeded" });
  } catch (error) {
    await finishAiRun({ aiRunId: run.id, outcome: "failed" });
    throw new DocumentIngestionError(
      document.id,
      classifyIngestionError(error),
      error,
    );
  }
}

export class DocumentIngestionError extends Error {
  constructor(
    public readonly documentId: string,
    public readonly errorCode: string,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "DocumentIngestionError";
  }
}

/** Run only after the failed ingestion transaction has rolled back. */
export async function markDocumentIngestionFailed(
  error: DocumentIngestionError,
): Promise<void> {
  await db
    .update(schema.documents)
    .set({
      status: "failed",
      errorCode: error.errorCode,
      processedAt: new Date(),
    })
    .where(eq(schema.documents.id, error.documentId));
}

function classifyIngestionError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "UNSUPPORTED_DOCUMENT_TYPE") return message;
  if (message === "EMPTY_DOCUMENT") return message;
  return "INGESTION_FAILED";
}
