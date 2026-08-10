import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { db, dbAdmin, schema, withTenantTransaction } from "@/db";
import { deleteMessage, receiveJobs } from "@/lib/aws/sqs";
import { logger } from "@/lib/logger";
import { backoffSeconds, dispatchJob, dispatchUndeliveredJobs } from "@/server/services/jobs";
import { recordAudit } from "@/server/services/audit";
import { runPlanGenerationJob } from "@/server/services/planGeneration";
import { runDigestJob } from "@/server/services/digest";
import {
  DocumentIngestionError,
  markDocumentIngestionFailed,
  runDocumentIngestionJob,
} from "@/server/services/documentIngestion";
import { reconcileDemoGeneration } from "@/server/services/demo";
import { deliverWebhookJob, queueWebhookEvent } from "@/server/services/webhooks";
import { withSpan } from "@/lib/telemetry";

/**
 * Background worker: long-polls SQS for job pointers and executes them.
 *
 * Reliability model:
 * - The DB row is the source of truth; the SQS message only carries the id.
 * - Failures increment attempts and re-enqueue with exponential backoff
 *   (5s, 10s, 20s ... capped) until maxAttempts, then park as dead_letter.
 * - Dead-letter jobs are surfaced on the Ops page with a manual retry action.
 * - An atomic queued→running transition makes duplicate SQS deliveries
 *   harmless (at-least-once delivery is expected, not exceptional).
 *
 * Locally this runs via `npm run worker`; on AWS the same code ships as an
 * ECS service or an SQS-triggered Lambda.
 */

const log = logger.child({ component: "worker" });

const HANDLERS: Record<
  (typeof schema.jobType.enumValues)[number],
  (job: {
    id: string;
    orgId: string;
    projectId: string | null;
    payload?: unknown;
  }) => Promise<void>
> = {
  plan_generation: runPlanGenerationJob,
  customer_update_digest: runDigestJob,
  document_ingest: runDocumentIngestionJob,
  webhook_delivery: deliverWebhookJob,
};

function demoReservationUsd(payload: unknown): number {
  if (typeof payload !== "object" || payload === null || !("demoReservationUsd" in payload)) {
    return 0;
  }
  const value = Number((payload as { demoReservationUsd?: unknown }).demoReservationUsd);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export async function processJob(jobId: string): Promise<void> {
  return withSpan("worker.process_job", { "workbench.job_id": jobId }, async () => {
  // A worker receives only the job id. Resolve its organization through the
  // admin connection first, then perform every runtime query inside the
  // tenant transaction so production RLS is active even before the first
  // claim/update.
  const candidate = await dbAdmin.query.jobs.findFirst({
    where: eq(schema.jobs.id, jobId),
  });
  if (!candidate) {
    log.info({ jobId }, "job not found; dropping message");
    return;
  }

  // Atomically claim the job; skips duplicates and manually-cancelled work.
  const claimed = await withTenantTransaction(candidate.orgId, () =>
    db
      .update(schema.jobs)
      .set({ status: "running", startedAt: new Date() })
      .where(
        sql`${schema.jobs.id} = ${jobId} AND ${schema.jobs.status} = 'queued'`,
      )
      .returning(),
  );
  if (claimed.length === 0) {
    log.info({ jobId }, "job not claimable (already running or finished)");
    return;
  }
  const job = claimed[0];
  const jobLog = log.child({ jobId, type: job.type, attempt: job.attempts + 1 });
  const started = Date.now();

  try {
    const reservedUsd = demoReservationUsd(job.payload);
    await withTenantTransaction(job.orgId, async () => {
      await HANDLERS[job.type](job);
      await db
        .update(schema.jobs)
        .set({
          status: "succeeded",
          attempts: job.attempts + 1,
          finishedAt: new Date(),
          durationMs: Date.now() - started,
          lastError: null,
        })
        .where(eq(schema.jobs.id, job.id));
    });
    if (reservedUsd) {
      await reconcileDemoGeneration({ orgId: job.orgId, reservedUsd }).catch((error) => {
        jobLog.warn({ error: String(error) }, "demo spend reservation reconciliation failed");
      });
    }
    jobLog.info({ durationMs: Date.now() - started }, "job succeeded");
  } catch (err) {
    const attempts = job.attempts + 1;
    const message = err instanceof Error ? err.message : String(err);
    const exhausted = attempts >= job.maxAttempts;

    await withTenantTransaction(job.orgId, async () => {
      if (err instanceof DocumentIngestionError) {
        await markDocumentIngestionFailed(err);
      }
      await db
        .update(schema.jobs)
        .set({
          status: exhausted ? "dead_letter" : "failed",
          attempts,
          finishedAt: new Date(),
          durationMs: Date.now() - started,
          lastError: message,
        })
        .where(eq(schema.jobs.id, job.id));
    });

    if (exhausted) {
      const reservedUsd = demoReservationUsd(job.payload);
      if (reservedUsd) {
        await reconcileDemoGeneration({ orgId: job.orgId, reservedUsd }).catch((error) => {
          jobLog.warn({ error: String(error) }, "demo spend reservation release failed");
        });
      }
      jobLog.error({ err: message, attempts }, "job exhausted retries; dead-lettered");
      await withTenantTransaction(job.orgId, () =>
        recordAudit({
          orgId: job.orgId,
          action: "job.dead_letter",
          subjectType: "job",
          subjectId: job.id,
          projectId: job.projectId,
          metadata: { type: job.type, attempts, error: message },
        }),
      );
      // Notify configured integrations after the dead-letter state and audit
      // row are durable. Delivery itself is another durable job, so a
      // transient webhook outage cannot change the worker outcome.
      await withTenantTransaction(job.orgId, () =>
        queueWebhookEvent({
          orgId: job.orgId,
          actorId: job.requestedBy ?? undefined,
          subjectId: job.id,
          type: "job.dead_letter",
          data: { type: job.type, attempts, error: message.slice(0, 500) },
        }),
      ).catch((error) => {
        jobLog.warn({ error: String(error) }, "dead-letter webhook enqueue failed");
      });
    } else {
      const delay = backoffSeconds(attempts);
      jobLog.warn(
        { err: message, attempts, retryInSeconds: delay },
        "job failed; scheduling retry",
      );
      // Flip back to queued and re-enqueue with backoff delay.
      await withTenantTransaction(job.orgId, async () => {
        await db
          .update(schema.jobs)
          .set({ status: "queued", dispatchedAt: null })
          .where(eq(schema.jobs.id, job.id));
      });
      await dispatchJob(job.id, delay);
    }
  }
  });
}

let shuttingDown = false;

async function main() {
  log.info("worker started; polling for jobs");
  process.on("SIGINT", () => (shuttingDown = true));
  process.on("SIGTERM", () => (shuttingDown = true));

  while (!shuttingDown) {
    try {
      const repaired = await dispatchUndeliveredJobs();
      if (repaired.dispatched) {
        log.info(repaired, "repaired undelivered job pointers");
      }
      const messages = await receiveJobs(10);
      for (const message of messages) {
        if (!message.Body || !message.ReceiptHandle) continue;
        let jobId: string;
        try {
          jobId = (JSON.parse(message.Body) as { jobId: string }).jobId;
        } catch {
          log.error({ body: message.Body }, "malformed message; dropping");
          await deleteMessage(message.ReceiptHandle);
          continue;
        }
        await processJob(jobId);
        // Failure handling re-enqueues its own delayed message, so the
        // original is always safe to delete.
        await deleteMessage(message.ReceiptHandle);
      }
    } catch (err) {
      log.error({ err }, "poll loop error; backing off 5s");
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  log.info("worker shut down cleanly");
  process.exit(0);
}

// Lambda imports processJob from this module but must not start the local
// long-poll loop. AWS always sets AWS_LAMBDA_FUNCTION_NAME for that runtime.
if (!process.env.AWS_LAMBDA_FUNCTION_NAME) void main();
