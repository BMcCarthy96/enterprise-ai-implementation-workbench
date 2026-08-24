import "dotenv/config";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { db, dbAdmin, schema, withTenantTransaction } from "@/db";
import { deleteMessage, receiveJobs } from "@/lib/aws/sqs";
import { logger } from "@/lib/logger";
import {
  backoffSeconds,
  dispatchJob,
  dispatchUndeliveredJobs,
  reclaimExpiredJobs,
} from "@/server/services/jobs";
import { recordAudit } from "@/server/services/audit";
import { reconcileRegenerationIntents } from "@/server/services/approvals";
import { runPlanGenerationJob } from "@/server/services/planGeneration";
import { runDigestJob } from "@/server/services/digest";
import {
  DocumentIngestionError,
  markDocumentIngestionFailed,
  runDocumentIngestionJob,
} from "@/server/services/documentIngestion";
import { reconcileDemoGeneration } from "@/server/services/demo";
import {
  deliverWebhookJob,
  queueWebhookEvent,
} from "@/server/services/webhooks";
import { withSpan } from "@/lib/telemetry";

/**
 * Background worker: long-polls SQS for job pointers and executes them.
 *
 * Reliability model:
 * - The DB row is the source of truth; the SQS message only carries the id.
 * - Failures increment attempts and re-enqueue with exponential backoff
 *   (5s, 10s, 20s ... capped) until maxAttempts, then park as dead_letter.
 * - Dead-letter jobs are surfaced on the Ops page with a manual retry action.
 * - An atomic queued→running transition plus a lease/heartbeat makes duplicate
 *   SQS deliveries harmless and lets a later worker reclaim a crashed claim.
 *
 * Locally this runs via `npm run worker`; on AWS the same code ships as an
 * ECS service or an SQS-triggered Lambda.
 */

const log = logger.child({ component: "worker" });
const LEASE_MS = 60_000;
const HEARTBEAT_MS = 15_000;
const WORKER_ID = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

class LostJobLeaseError extends Error {
  constructor() {
    super("Job lease was reclaimed before this worker could commit");
    this.name = "LostJobLeaseError";
  }
}

let telemetryRegistration: Promise<void> | undefined;
async function ensureWorkerTelemetry() {
  if (process.env.OTEL_SDK_DISABLED === "true") return;
  const endpoint =
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint && process.env.WORKBENCH_OTEL_ENABLED !== "true") return;
  telemetryRegistration ??= import("@vercel/otel")
    .then(({ registerOTel }) => {
      registerOTel({
        serviceName:
          process.env.OTEL_SERVICE_NAME ?? "enterprise-ai-workbench-worker",
      });
    })
    .catch((error) => {
      // Telemetry is supporting infrastructure. A collector or SDK mismatch
      // must remain visible without taking the durable job processor offline.
      log.warn(
        { error: String(error) },
        "worker telemetry initialization failed; continuing without export",
      );
    });
  await telemetryRegistration;
}

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
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("demoReservationUsd" in payload)
  ) {
    return 0;
  }
  const value = Number(
    (payload as { demoReservationUsd?: unknown }).demoReservationUsd,
  );
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export async function processJob(jobId: string): Promise<void> {
  await ensureWorkerTelemetry();
  return withSpan(
    "worker.process_job",
    { "workbench.job_id": jobId },
    async () => {
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

      // Atomically claim the job. A queued job is new work; an expired running
      // lease is recoverable work from a worker that crashed after claiming.
      const now = new Date();
      const claimToken = `${WORKER_ID}:claim:${randomUUID()}`;
      const job = await withTenantTransaction(candidate.orgId, async () => {
        const [claimed] = await db
          .update(schema.jobs)
          .set({
            status: "running",
            startedAt: now,
            finishedAt: null,
            durationMs: null,
            heartbeatAt: now,
            // A fresh token per claim acts as a fencing token. Reusing the process
            // id would let an older invocation from this process commit after a
            // later invocation reclaimed the same job.
            leaseOwner: claimToken,
            leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
            attempts: sql`${schema.jobs.attempts} + 1`,
          })
          .where(
            and(
              eq(schema.jobs.id, jobId),
              or(
                eq(schema.jobs.status, "queued"),
                and(
                  eq(schema.jobs.status, "running"),
                  or(
                    isNull(schema.jobs.leaseExpiresAt),
                    lt(schema.jobs.leaseExpiresAt, now),
                  ),
                ),
              ),
            ),
          )
          .returning();
        if (!claimed) return null;

        // Claim state and attempt evidence must commit together. If the attempt
        // insert fails, the queued/running transition is rolled back as well.
        await db
          .update(schema.jobAttempts)
          .set({
            status: "lease_lost",
            finishedAt: now,
            error: "Lease expired and a later claim fenced this attempt",
          })
          .where(
            and(
              eq(schema.jobAttempts.jobId, claimed.id),
              eq(schema.jobAttempts.status, "running"),
            ),
          );
        await db.insert(schema.jobAttempts).values({
          jobId: claimed.id,
          orgId: claimed.orgId,
          attempt: claimed.attempts,
          workerId: claimToken,
          traceId: claimed.traceId,
        });
        return claimed;
      });
      if (!job) {
        log.info({ jobId }, "job not claimable (already running or finished)");
        return;
      }
      const attempt = job.attempts;
      const jobLog = log.child({
        jobId,
        type: job.type,
        attempt,
        workerId: WORKER_ID,
      });
      const started = Date.now();
      const heartbeat = setInterval(() => {
        void withTenantTransaction(job.orgId, () =>
          db
            .update(schema.jobs)
            .set({
              heartbeatAt: new Date(),
              leaseExpiresAt: new Date(Date.now() + LEASE_MS),
            })
            .where(
              and(
                eq(schema.jobs.id, job.id),
                eq(schema.jobs.status, "running"),
                eq(schema.jobs.leaseOwner, claimToken),
              ),
            ),
        ).catch((error) =>
          jobLog.warn({ error: String(error) }, "job heartbeat failed"),
        );
      }, HEARTBEAT_MS);

      try {
        const reservedUsd = demoReservationUsd(job.payload);
        await withTenantTransaction(job.orgId, async () => {
          await HANDLERS[job.type](job);
          const [completed] = await db
            .update(schema.jobs)
            .set({
              status: "succeeded",
              finishedAt: new Date(),
              durationMs: Date.now() - started,
              lastError: null,
              leaseOwner: null,
              leaseExpiresAt: null,
              heartbeatAt: new Date(),
            })
            .where(
              and(
                eq(schema.jobs.id, job.id),
                eq(schema.jobs.status, "running"),
                eq(schema.jobs.leaseOwner, claimToken),
              ),
            )
            .returning({ id: schema.jobs.id });
          if (!completed) throw new LostJobLeaseError();
          await db
            .update(schema.jobAttempts)
            .set({
              status: "succeeded",
              finishedAt: new Date(),
              durationMs: Date.now() - started,
            })
            .where(
              and(
                eq(schema.jobAttempts.jobId, job.id),
                eq(schema.jobAttempts.attempt, attempt),
                eq(schema.jobAttempts.workerId, claimToken),
              ),
            );
        });
        if (reservedUsd) {
          await reconcileDemoGeneration({
            orgId: job.orgId,
            reservedUsd,
          }).catch((error) => {
            jobLog.warn(
              { error: String(error) },
              "demo spend reservation reconciliation failed",
            );
          });
        }
        jobLog.info({ durationMs: Date.now() - started }, "job succeeded");
      } catch (err) {
        if (err instanceof LostJobLeaseError) {
          await withTenantTransaction(job.orgId, () =>
            db
              .update(schema.jobAttempts)
              .set({
                status: "lease_lost",
                finishedAt: new Date(),
                durationMs: Date.now() - started,
                error: err.message,
              })
              .where(
                and(
                  eq(schema.jobAttempts.jobId, job.id),
                  eq(schema.jobAttempts.attempt, attempt),
                  eq(schema.jobAttempts.workerId, claimToken),
                ),
              ),
          );
          jobLog.warn("job lease was reclaimed; rolled back handler writes");
          return;
        }

        const attempts = job.attempts;
        const message = err instanceof Error ? err.message : String(err);
        const exhausted = attempts >= job.maxAttempts;

        try {
          await withTenantTransaction(job.orgId, async () => {
            const [failed] = await db
              .update(schema.jobs)
              .set({
                status: exhausted ? "dead_letter" : "failed",
                attempts,
                finishedAt: new Date(),
                durationMs: Date.now() - started,
                lastError: message,
                leaseOwner: null,
                leaseExpiresAt: null,
                heartbeatAt: new Date(),
              })
              .where(
                and(
                  eq(schema.jobs.id, job.id),
                  eq(schema.jobs.status, "running"),
                  eq(schema.jobs.leaseOwner, claimToken),
                ),
              )
              .returning({ id: schema.jobs.id });
            if (!failed) throw new LostJobLeaseError();
            if (err instanceof DocumentIngestionError) {
              await markDocumentIngestionFailed(err);
            }
            await db
              .update(schema.jobAttempts)
              .set({
                status: exhausted ? "dead_letter" : "failed",
                finishedAt: new Date(),
                durationMs: Date.now() - started,
                error: message,
              })
              .where(
                and(
                  eq(schema.jobAttempts.jobId, job.id),
                  eq(schema.jobAttempts.attempt, attempt),
                  eq(schema.jobAttempts.workerId, claimToken),
                ),
              );
          });
        } catch (transitionError) {
          if (!(transitionError instanceof LostJobLeaseError))
            throw transitionError;
          await withTenantTransaction(job.orgId, () =>
            db
              .update(schema.jobAttempts)
              .set({
                status: "lease_lost",
                finishedAt: new Date(),
                durationMs: Date.now() - started,
                error: transitionError.message,
              })
              .where(
                and(
                  eq(schema.jobAttempts.jobId, job.id),
                  eq(schema.jobAttempts.attempt, attempt),
                  eq(schema.jobAttempts.workerId, claimToken),
                ),
              ),
          );
          jobLog.warn(
            "job lease was reclaimed before failure state could commit",
          );
          return;
        }

        if (exhausted) {
          const reservedUsd = demoReservationUsd(job.payload);
          if (reservedUsd) {
            await reconcileDemoGeneration({
              orgId: job.orgId,
              reservedUsd,
            }).catch((error) => {
              jobLog.warn(
                { error: String(error) },
                "demo spend reservation release failed",
              );
            });
          }
          jobLog.error(
            { err: message, attempts },
            "job exhausted retries; dead-lettered",
          );
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
            jobLog.warn(
              { error: String(error) },
              "dead-letter webhook enqueue failed",
            );
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
              .set({
                status: "queued",
                dispatchedAt: null,
                leaseOwner: null,
                leaseExpiresAt: null,
                heartbeatAt: null,
              })
              .where(
                and(
                  eq(schema.jobs.id, job.id),
                  eq(schema.jobs.status, "failed"),
                ),
              );
          });
          await dispatchJob(job.id, delay);
        }
      } finally {
        clearInterval(heartbeat);
      }
    },
  );
}

let shuttingDown = false;

async function main() {
  await ensureWorkerTelemetry();
  log.info("worker started; polling for jobs");
  process.on("SIGINT", () => (shuttingDown = true));
  process.on("SIGTERM", () => (shuttingDown = true));

  while (!shuttingDown) {
    try {
      const reclaimed = await reclaimExpiredJobs();
      if (reclaimed) log.info({ reclaimed }, "reclaimed expired job leases");
      const repaired = await dispatchUndeliveredJobs();
      if (repaired.dispatched) {
        log.info(repaired, "repaired undelivered job pointers");
      }
      const regenerated = await reconcileRegenerationIntents();
      if (regenerated) log.info({ regenerated }, "dispatched regeneration intents");
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
