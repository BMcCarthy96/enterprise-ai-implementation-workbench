import { and, asc, eq, isNull, lt, or } from "drizzle-orm";
import { afterTransactionCommit, db, dbAdmin, schema } from "@/db";
import { enqueueJob } from "@/lib/aws/sqs";
import { ApiError } from "@/lib/api";
import { logger } from "@/lib/logger";
import { recordAudit } from "./audit";
import { activeTraceContext, withSpan } from "@/lib/telemetry";

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

const jobLog = logger.child({ component: "job-dispatch" });

function isConstraintViolation(error: unknown, constraint: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    const value = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (value.code === "23505" && value.constraint === constraint) return true;
    current = value.cause;
  }
  return false;
}

function throwActivePlanConflict(error: unknown): never {
  if (isConstraintViolation(error, "jobs_one_active_plan_generation_idx")) {
    throw new ApiError(
      409,
      "A plan generation job is already active for this project",
      "PLAN_GENERATION_ACTIVE",
    );
  }
  throw error;
}

/** Publish a committed job row and mark the delivery attempt durable. */
export async function dispatchJob(jobId: string, delaySeconds = 0): Promise<void> {
  return withSpan("job.dispatch", { "workbench.job_id_present": Boolean(jobId) }, async () => {
    await enqueueJob(jobId, delaySeconds);
    await dbAdmin
      .update(schema.jobs)
      .set({ dispatchedAt: new Date() })
      .where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.status, "queued")));
  });
}

async function dispatchJobSafely(jobId: string): Promise<void> {
  try {
    await dispatchJob(jobId);
  } catch (error) {
    // The row deliberately remains queued with dispatched_at = null. The
    // local worker or scheduled AWS dispatcher will repair the delivery.
    jobLog.error({ jobId, error: String(error) }, "job dispatch failed; reconciliation will retry");
  }
}

/**
 * Repair the database/SQS boundary after a transient publish failure. Sending
 * a duplicate pointer is safe because workers claim queued jobs atomically.
 */
export async function dispatchUndeliveredJobs(limit = 25): Promise<{
  attempted: number;
  dispatched: number;
}> {
  const candidates = await dbAdmin.query.jobs.findMany({
    where: and(eq(schema.jobs.status, "queued"), isNull(schema.jobs.dispatchedAt)),
    orderBy: asc(schema.jobs.createdAt),
    limit,
    columns: { id: true },
  });
  let dispatched = 0;
  for (const candidate of candidates) {
    try {
      await dispatchJob(candidate.id);
      dispatched += 1;
    } catch (error) {
      jobLog.warn({ jobId: candidate.id, error: String(error) }, "job reconciliation dispatch failed");
    }
  }
  return { attempted: candidates.length, dispatched };
}

/** Requeue work whose worker lease expired before it could acknowledge the message. */
export async function reclaimExpiredJobs(limit = 25): Promise<number> {
  const expired = await dbAdmin
    .update(schema.jobs)
    .set({ status: "queued", dispatchedAt: null, leaseOwner: null, leaseExpiresAt: null, heartbeatAt: null })
    .where(and(
      eq(schema.jobs.status, "running"),
      or(isNull(schema.jobs.leaseExpiresAt), lt(schema.jobs.leaseExpiresAt, new Date())),
    ))
    .returning({ id: schema.jobs.id });
  let dispatched = 0;
  for (const job of expired.slice(0, limit)) {
    try {
      await dispatchJob(job.id);
      dispatched += 1;
    } catch (error) {
      jobLog.warn({ jobId: job.id, error: String(error) }, "expired job redispatch failed");
    }
  }
  return dispatched;
}

export async function createAndEnqueueJob(input: {
  orgId: string;
  projectId?: string;
  type: JobType;
  payload?: Record<string, unknown>;
  requestedBy?: string;
  /** Extra fields merged into the job.enqueued audit metadata (e.g. what
   *  triggered the job). */
  auditMetadata?: Record<string, unknown>;
}): Promise<string> {
  return withSpan("job.enqueue", { "workbench.job_type": input.type }, async () => {
    let job: { id: string };
    const traceContext = activeTraceContext();
    try {
    [job] = await db
      .insert(schema.jobs)
      .values({
        orgId: input.orgId,
        projectId: input.projectId ?? null,
          type: input.type,
          payload: input.payload ?? {},
          requestedBy: input.requestedBy ?? null,
          traceId: traceContext.traceId ?? null,
          traceParent: traceContext.traceParent ?? null,
      })
      .returning({ id: schema.jobs.id });
    } catch (error) {
      if (input.type === "plan_generation") throwActivePlanConflict(error);
      throw error;
    }

    await recordAudit({
    orgId: input.orgId,
    actorId: input.requestedBy,
    action: `job.enqueued`,
    subjectType: "job",
    subjectId: job.id,
    projectId: input.projectId,
    metadata: { type: input.type, ...input.auditMetadata },
    });
    await afterTransactionCommit(() => dispatchJobSafely(job.id));
    return job.id;
  });
}

/** Re-enqueue a failed/dead-letter job (Ops page retry button). */
export async function retryJob(jobId: string, actorId: string): Promise<void> {
  const job = await db.query.jobs.findFirst({
    where: eq(schema.jobs.id, jobId),
  });
  if (!job) throw new Error("Job not found");

  try {
    await db
      .update(schema.jobs)
      .set({ status: "queued", lastError: null, attempts: 0, dispatchedAt: null, leaseOwner: null, leaseExpiresAt: null, heartbeatAt: null })
      .where(eq(schema.jobs.id, jobId));
  } catch (error) {
    if (job.type === "plan_generation") throwActivePlanConflict(error);
    throw error;
  }
  await recordAudit({
    orgId: job.orgId,
    actorId,
    action: "job.manual_retry",
    subjectType: "job",
    subjectId: jobId,
    projectId: job.projectId,
    metadata: { type: job.type, previousStatus: job.status },
  });
  await afterTransactionCommit(() => dispatchJobSafely(jobId));
}
