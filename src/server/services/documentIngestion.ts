import { createHash } from "node:crypto";
import mammoth from "mammoth";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { readObject } from "@/lib/aws/s3";
import { embeddingProvider } from "@/lib/ai/embeddings";
import { redactSensitiveText, totalRedactions } from "@/lib/ai/redaction";
import {
  finishAiRun,
  finishAiRunAfterCommit,
  recordAiCall,
  startAiRun,
} from "./aiTelemetry";

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
    // pdf-parse's bundled pdfjs build expects browser canvas globals. Lambda
    // has no DOM, so provide the native Node canvas implementations before the
    // parser module evaluates.
    const { DOMMatrix, ImageData, Path2D } = await import("@napi-rs/canvas");
    Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
    const { PDFParse } = await import("pdf-parse");
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
