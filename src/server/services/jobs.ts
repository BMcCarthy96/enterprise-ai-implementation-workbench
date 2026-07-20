import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { enqueueJob } from "@/lib/aws/sqs";
import { recordAudit } from "./audit";

export type JobType = (typeof schema.jobType.enumValues)[number];

/**
 * Job lifecycle: DB row is the source of truth; the SQS message is only a
 * delivery mechanism carrying the job id. Retries re-enqueue with exponential
 * backoff until maxAttempts, then the job is parked as dead_letter for a
 * human to inspect and retry from the Ops page.
 */

export function backoffSeconds(attempt: number): number {
  // 5s, 10s, 20s, 40s... capped at SQS's 15-minute delay ceiling.
  return Math.min(5 * 2 ** (attempt - 1), 900);
}

export async function createAndEnqueueJob(input: {
  orgId: string;
  projectId?: string;
  type: JobType;
  payload?: Record<string, unknown>;
  requestedBy?: string;
}): Promise<string> {
  const [job] = await db
    .insert(schema.jobs)
    .values({
      orgId: input.orgId,
      projectId: input.projectId ?? null,
      type: input.type,
      payload: input.payload ?? {},
      requestedBy: input.requestedBy ?? null,
    })
    .returning({ id: schema.jobs.id });

  await enqueueJob(job.id);
  await recordAudit({
    orgId: input.orgId,
    actorId: input.requestedBy,
    action: `job.enqueued`,
    subjectType: "job",
    subjectId: job.id,
    projectId: input.projectId,
    metadata: { type: input.type },
  });
  return job.id;
}

/** Re-enqueue a failed/dead-letter job (Ops page retry button). */
export async function retryJob(jobId: string, actorId: string): Promise<void> {
  const job = await db.query.jobs.findFirst({
    where: eq(schema.jobs.id, jobId),
  });
  if (!job) throw new Error("Job not found");

  await db
    .update(schema.jobs)
    .set({ status: "queued", lastError: null, attempts: 0 })
    .where(eq(schema.jobs.id, jobId));
  await enqueueJob(jobId);
  await recordAudit({
    orgId: job.orgId,
    actorId,
    action: "job.manual_retry",
    subjectType: "job",
    subjectId: jobId,
    projectId: job.projectId,
    metadata: { type: job.type, previousStatus: job.status },
  });
}
