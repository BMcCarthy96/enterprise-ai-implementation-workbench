import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { afterTransactionCommit, db, dbAdmin, schema, withTenantTransaction } from "@/db";
import { PlanContentSchema } from "@/lib/ai/planSchema";
import { ApiError } from "@/lib/api";
import { logger } from "@/lib/logger";
import { createAndEnqueueJob } from "./jobs";
import { recordAudit } from "./audit";
import { queueWebhookEvent } from "./webhooks";
import { withSpan } from "@/lib/telemetry";

export interface DecisionInput {
  approvalId: string;
  orgId: string;
  decidedBy: string;
  decision: "approved" | "rejected";
  reasonCode?: string;
  note?: string;
  /** When rejecting a plan, also queue a revised generation (feedback loop). */
  regenerate?: boolean;
  /** Client supplied idempotency key for a consequential decision. */
  idempotencyKey?: string;
}

export interface DecisionResult {
  /** Set when a rejection kicked off an automatic revised-plan generation. */
  regenerationJobId?: string;
  /** True once the durable regeneration intent is committed, even if dispatch is deferred. */
  regenerationQueued?: boolean;
}

/**
 * Bind an idempotency key to the exact consequential request it represents.
 * Object keys are intentionally fixed here so equivalent requests hash
 * deterministically without relying on caller JSON property order.
 */
export function approvalDecisionFingerprint(input: DecisionInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        approvalId: input.approvalId,
        orgId: input.orgId,
        decidedBy: input.decidedBy,
        decision: input.decision,
        reasonCode: input.reasonCode ?? null,
        note: input.note ?? null,
        regenerate: input.regenerate === true,
      }),
    )
    .digest("hex");
}

export function replayDecision(
  existing: Pick<
    typeof schema.approvals.$inferSelect,
    "decisionKey" | "decisionFingerprint" | "regenerationJobId" | "subjectType"
  >,
  input: DecisionInput,
  fingerprint: string,
): DecisionResult | undefined {
  if (!input.idempotencyKey || existing.decisionKey !== input.idempotencyKey) {
    return undefined;
  }
  if (existing.decisionFingerprint !== fingerprint) {
    throw new ApiError(
      409,
      "This Idempotency-Key was already used with a different approval decision",
      "IDEMPOTENCY_KEY_REUSED",
    );
  }
  return {
    regenerationJobId: existing.regenerationJobId ?? undefined,
    regenerationQueued:
      existing.subjectType === "plan" &&
      input.decision === "rejected" &&
      input.regenerate === true,
  };
}

/**
 * Whether a decision should trigger an automatic revised-plan generation. Pure
 * so the guard is unit-tested directly: only a *plan* *rejection* with the flag
 * set qualifies — approvals and customer-update rejections never regenerate.
 */
export function wantsRegeneration(opts: {
  decision: "approved" | "rejected";
  subjectType: string;
  regenerate?: boolean;
}): boolean {
  return (
    opts.decision === "rejected" &&
    opts.subjectType === "plan" &&
    opts.regenerate === true
  );
}

/**
 * The single human checkpoint for AI output. Approving a plan materializes
 * its milestones and tasks; approving a customer update publishes it to the
 * customer stakeholder view. Rejections capture a reason code that feeds the
 * quality loop.
 */
export async function decideApproval(
  input: DecisionInput,
): Promise<DecisionResult> {
  return withSpan(
    "approval.decide",
    { "workbench.approval_decision": input.decision },
    () => decideApprovalInternal(input),
  );
}

async function decideApprovalInternal(
  input: DecisionInput,
): Promise<DecisionResult> {
  return withTenantTransaction(
    input.orgId,
    async () => {
      if (input.decision === "rejected" && !input.reasonCode) {
        throw new ApiError(400, "A reason code is required when rejecting");
      }
      const decisionFingerprint = approvalDecisionFingerprint(input);

      const existing = await db.query.approvals.findFirst({
        where: and(
          eq(schema.approvals.id, input.approvalId),
          eq(schema.approvals.orgId, input.orgId),
        ),
      });
      if (!existing) throw new ApiError(404, "Approval not found");
      if (
        input.decision === "approved" &&
        existing.subjectType === "plan" &&
        existing.requestedBy === input.decidedBy
      ) {
        throw new ApiError(
          403,
          "Maker-checker policy: the requester cannot approve their own AI plan",
          "MAKER_CHECKER_REQUIRED",
        );
      }
      if (existing.status !== "pending") {
        const replay = replayDecision(existing, input, decisionFingerprint);
        if (replay) return replay;
        throw new ApiError(409, `This item was already ${existing.status}`);
      }

      // Conditional update is the concurrency boundary: only one reviewer can
      // transition a pending approval, even when requests race.
      const [approval] = await db
        .update(schema.approvals)
        .set({
          status: input.decision,
          decidedBy: input.decidedBy,
          decidedAt: new Date(),
          reasonCode: input.reasonCode ?? null,
          note: input.note ?? null,
          decisionKey: input.idempotencyKey ?? null,
          decisionFingerprint,
        })
        .where(
          and(
            eq(schema.approvals.id, input.approvalId),
            eq(schema.approvals.orgId, input.orgId),
            eq(schema.approvals.status, "pending"),
          ),
        )
        .returning();
      if (!approval) {
        // A same-key concurrent request can read `pending`, wait on the winner's
        // conditional update, then observe zero updated rows. Re-read so an exact
        // replay receives the original result instead of a false conflict.
        const decided = await db.query.approvals.findFirst({
          where: and(
            eq(schema.approvals.id, input.approvalId),
            eq(schema.approvals.orgId, input.orgId),
          ),
          columns: {
            decisionKey: true,
            decisionFingerprint: true,
            regenerationJobId: true,
            subjectType: true,
          },
        });
        if (decided) {
          const replay = replayDecision(decided, input, decisionFingerprint);
          if (replay) return replay;
        }
        throw new ApiError(409, "This item was already decided");
      }

      if (approval.subjectType === "plan") {
        await applyPlanDecision(approval.subjectId, input);
      } else if (approval.subjectType === "customer_update") {
        await applyUpdateDecision(approval.subjectId, input);
      }

      await recordAudit({
        orgId: input.orgId,
        actorId: input.decidedBy,
        action: `approval.${input.decision}`,
        subjectType: approval.subjectType,
        subjectId: approval.subjectId,
        projectId: approval.projectId,
        metadata: {
          approvalId: approval.id,
          reasonCode: input.reasonCode ?? null,
          note: input.note ?? null,
        },
      });
      await queueWebhookEvent({
        type: "approval.decided",
        orgId: input.orgId,
        actorId: input.decidedBy,
        subjectId: approval.subjectId,
        data: {
          approvalId: approval.id,
          subjectType: approval.subjectType,
          decision: input.decision,
          reasonCode: input.reasonCode ?? null,
        },
      });
      if (
        approval.subjectType === "customer_update" &&
        input.decision === "approved"
      ) {
        await queueWebhookEvent({
          type: "customer_update.published",
          orgId: input.orgId,
          actorId: input.decidedBy,
          subjectId: approval.subjectId,
          data: { approvalId: approval.id },
        });
      }

      // Closed feedback loop: on a plan rejection the reviewer can opt to have a
      // revised plan generated immediately. The worker's generation path already
      // pulls the latest rejection's reason + note into the prompt.
      const result: DecisionResult = {};
      if (
        wantsRegeneration({
          decision: input.decision,
          subjectType: approval.subjectType,
          regenerate: input.regenerate,
        })
      ) {
        if (!approval.projectId) {
          throw new Error("Plan approval is missing its project reference");
        }
        const [intent] = await db
          .insert(schema.approvalRegenerationIntents)
          .values({
            orgId: approval.orgId,
            approvalId: approval.id,
            projectId: approval.projectId,
            requestedBy: input.decidedBy,
          })
          .onConflictDoNothing({ target: schema.approvalRegenerationIntents.approvalId })
          .returning({ id: schema.approvalRegenerationIntents.id });
        // The intent is the durable user-visible outcome. A conflict here means
        // the same approval already has one, so the response can still report
        // that regeneration is queued.
        result.regenerationQueued = true;
        if (intent) {
          await afterTransactionCommit(async () => {
            try {
              const jobId = await dispatchRegenerationIntent(intent.id);
              if (jobId) result.regenerationJobId = jobId;
            } catch (error) {
              logger.error(
                { err: String(error), intentId: intent.id },
                "regeneration intent dispatch failed; reconciliation can retry it",
              );
            }
          });
        }
      }
      return result;
    },
    input.decidedBy,
  );
}

export interface BulkDecisionInput extends Omit<DecisionInput, "approvalId"> {
  approvalIds: string[];
}

export interface BulkDecisionResult {
  succeeded: Array<{
    approvalId: string;
    regenerationJobId?: string;
    regenerationQueued?: boolean;
  }>;
  failed: Array<{ approvalId: string; status: number; message: string }>;
  regenerationJobCount: number;
}

/**
 * Human-readable outcome for a bulk decision. Pure so the wording is pinned by
 * unit tests rather than asserted through the UI.
 */
export function summarizeBulkDecision(
  result: BulkDecisionResult,
  decision: "approved" | "rejected",
): string {
  const verb = decision === "approved" ? "Approved" : "Rejected";
  const parts = [`${verb} ${result.succeeded.length}`];
  if (result.failed.length > 0) parts.push(`${result.failed.length} failed`);
  if (result.regenerationJobCount > 0) {
    parts.push(
      `${result.regenerationJobCount} revised ${
        result.regenerationJobCount === 1 ? "plan" : "plans"
      } queued`,
    );
  }
  return parts.join(" · ");
}

/**
 * Apply one decision across a selection from the approval queue.
 *
 * Deliberately sequential and partial-failure tolerant: each item is an
 * independent audited transaction, so a stale selection (someone else already
 * decided one, or an id from another tenant) records a per-item failure instead
 * of rolling back the reviewer's other decisions.
 */
export async function decideApprovalsBulk(
  input: BulkDecisionInput,
): Promise<BulkDecisionResult> {
  const result: BulkDecisionResult = {
    succeeded: [],
    failed: [],
    regenerationJobCount: 0,
  };

  // De-dupe so a repeated id can't double-count against the same approval.
  for (const approvalId of [...new Set(input.approvalIds)]) {
    try {
      const { regenerationJobId, regenerationQueued } = await decideApproval({
        ...input,
        approvalId,
        idempotencyKey: input.idempotencyKey
          ? `${input.idempotencyKey}:${approvalId}`
          : `bulk-${randomUUID()}`,
      });
      result.succeeded.push({ approvalId, regenerationJobId, regenerationQueued });
      if (regenerationJobId || regenerationQueued) result.regenerationJobCount += 1;
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 500;
      const message = err instanceof Error ? err.message : "Decision failed";
      if (status >= 500) {
        logger.error(
          { err: String(err), approvalId },
          "bulk decision item failed",
        );
      }
      result.failed.push({ approvalId, status, message });
    }
  }

  return result;
}

/**
 * Enqueue a revised-plan generation after a rejection. The intent is already
 * committed, so a queue failure leaves it ready for the scheduled reconciler.
 */
async function dispatchRegenerationIntent(intentId: string): Promise<string | undefined> {
  let dispatchedJobId: string | undefined;
  const ownerIntent = await dbAdmin.query.approvalRegenerationIntents.findFirst({
    where: eq(schema.approvalRegenerationIntents.id, intentId),
  });
  if (!ownerIntent) return undefined;
  await withTenantTransaction(ownerIntent.orgId, async () => {
    // A request callback and the scheduled reconciler can notice the same
    // committed intent. Serialize them for this intent without leaving a lease
    // behind if either process exits mid-transaction.
    await db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${intentId}::text, 0))`,
    );
    const intent = await db.query.approvalRegenerationIntents.findFirst({
      where: eq(schema.approvalRegenerationIntents.id, intentId),
    });
    if (!intent || intent.jobId || intent.status === "dispatched") {
      dispatchedJobId = intent?.jobId ?? undefined;
      return;
    }
    const queued = await db.query.jobs.findFirst({
      where: and(
        eq(schema.jobs.projectId, intent.projectId),
        eq(schema.jobs.type, "plan_generation"),
        inArray(schema.jobs.status, ["queued", "running"]),
      ),
    });
    if (queued) {
      dispatchedJobId = queued.id;
      await db
        .update(schema.approvalRegenerationIntents)
        .set({ jobId: queued.id, status: "dispatched", dispatchedAt: new Date(), lastError: null })
        .where(eq(schema.approvalRegenerationIntents.id, intent.id));
      await db.update(schema.approvals).set({ regenerationJobId: queued.id }).where(eq(schema.approvals.id, intent.approvalId));
      return;
    }
    const reqCount = await db.$count(schema.requirements, eq(schema.requirements.projectId, intent.projectId));
    if (reqCount === 0) {
      await db.update(schema.approvalRegenerationIntents).set({ status: "failed", lastError: "No requirements remain for regeneration" }).where(eq(schema.approvalRegenerationIntents.id, intent.id));
      return;
    }
    try {
      dispatchedJobId = await createAndEnqueueJob({
        orgId: intent.orgId,
        projectId: intent.projectId,
        type: "plan_generation",
        requestedBy: intent.requestedBy ?? undefined,
        auditMetadata: { trigger: "rejection_auto_regenerate", rejectedApprovalId: intent.approvalId },
      });
      await db
        .update(schema.approvalRegenerationIntents)
        .set({ jobId: dispatchedJobId, status: "dispatched", dispatchedAt: new Date(), lastError: null })
        .where(eq(schema.approvalRegenerationIntents.id, intent.id));
      await db.update(schema.approvals).set({ regenerationJobId: dispatchedJobId }).where(eq(schema.approvals.id, intent.approvalId));
    } catch (error) {
      await db
        .update(schema.approvalRegenerationIntents)
        .set({ status: "queued", lastError: error instanceof Error ? error.message : String(error) })
        .where(eq(schema.approvalRegenerationIntents.id, intent.id));
      throw error;
    }
  }, ownerIntent.requestedBy ?? undefined);
  return dispatchedJobId;
}

/** Retry committed regeneration intents after a web request or worker crash. */
export async function reconcileRegenerationIntents(limit = 10): Promise<number> {
  const intents = await dbAdmin.query.approvalRegenerationIntents.findMany({
    where: eq(schema.approvalRegenerationIntents.status, "queued"),
    orderBy: (rows, { asc }) => [asc(rows.createdAt)],
    limit,
    columns: { id: true },
  });
  let dispatched = 0;
  for (const intent of intents) {
    try {
      if (await dispatchRegenerationIntent(intent.id)) dispatched += 1;
    } catch (error) {
      logger.warn({ err: String(error), intentId: intent.id }, "regeneration intent remains queued");
    }
  }
  return dispatched;
}

async function applyPlanDecision(planId: string, input: DecisionInput) {
  const plan = await db.query.plans.findFirst({
    where: and(
      eq(schema.plans.id, planId),
      eq(schema.plans.orgId, input.orgId),
    ),
  });
  if (!plan) throw new ApiError(404, "Plan not found");

  if (input.decision === "rejected") {
    await db
      .update(schema.plans)
      .set({ status: "rejected" })
      .where(
        and(eq(schema.plans.id, planId), eq(schema.plans.orgId, input.orgId)),
      );
    return;
  }

  const content = PlanContentSchema.parse(plan.content);

  // Any previously approved plan for this project is superseded. This function
  // deliberately uses the ambient tenant transaction created by
  // decideApproval; opening a base transaction here would lose RLS context.
  await db
    .update(schema.plans)
    .set({ status: "superseded" })
    .where(
      and(
        eq(schema.plans.projectId, plan.projectId),
        eq(schema.plans.status, "approved"),
        ne(schema.plans.id, planId),
      ),
    );
  await db
    .update(schema.plans)
    .set({ status: "approved" })
    .where(eq(schema.plans.id, planId));

  // Materialize milestones and tasks from the approved plan content.
  for (const [i, m] of content.milestones.entries()) {
    const existingMilestone = await db.query.milestones.findFirst({
      where: and(
        eq(schema.milestones.planId, plan.id),
        eq(schema.milestones.sortOrder, i),
      ),
      columns: { id: true },
    });
    if (existingMilestone) continue;
    const [milestone] = await db
      .insert(schema.milestones)
      .values({
        orgId: plan.orgId,
        projectId: plan.projectId,
        planId: plan.id,
        name: m.name,
        description: m.description,
        sortOrder: i,
      })
      .returning({ id: schema.milestones.id });

    await db.insert(schema.tasks).values(
      m.tasks.map((t, j) => ({
        orgId: plan.orgId,
        projectId: plan.projectId,
        milestoneId: milestone.id,
        title: t.title,
        description: t.description || null,
        sortOrder: j,
      })),
    );
  }

  await db
    .update(schema.requirements)
    .set({ status: "in_plan" })
    .where(
      and(
        eq(schema.requirements.projectId, plan.projectId),
        eq(schema.requirements.status, "new"),
      ),
    );
  await db
    .update(schema.projects)
    .set({ status: "in_delivery", updatedAt: new Date() })
    .where(eq(schema.projects.id, plan.projectId));
}

async function applyUpdateDecision(updateId: string, input: DecisionInput) {
  if (input.decision === "approved") {
    await db
      .update(schema.customerUpdates)
      .set({ status: "published", publishedAt: new Date() })
      .where(
        and(
          eq(schema.customerUpdates.id, updateId),
          eq(schema.customerUpdates.orgId, input.orgId),
        ),
      );
  } else {
    await db
      .update(schema.customerUpdates)
      .set({ status: "rejected" })
      .where(
        and(
          eq(schema.customerUpdates.id, updateId),
          eq(schema.customerUpdates.orgId, input.orgId),
        ),
      );
  }
}
