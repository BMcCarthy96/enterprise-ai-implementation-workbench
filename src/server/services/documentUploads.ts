import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { ApiError } from "@/lib/api";
import { headObject } from "@/lib/aws/s3";
import { createAndEnqueueJob } from "./jobs";
import { recordAudit } from "./audit";

/**
 * Complete a presigned upload and enqueue the worker-only ingestion path.
 * Keeping this registration surface separate prevents Vercel's server build
 * from tracing the native PDF canvas dependency used by the Lambda worker.
 */
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
