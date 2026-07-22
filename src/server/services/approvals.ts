import { and, eq, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { PlanContentSchema } from "@/lib/ai/planSchema";
import { ApiError } from "@/lib/api";
import { logger } from "@/lib/logger";
import { createAndEnqueueJob } from "./jobs";
import { recordAudit } from "./audit";

export interface DecisionInput {
  approvalId: string;
  orgId: string;
  decidedBy: string;
  decision: "approved" | "rejected";
  reasonCode?: string;
  note?: string;
  /** When rejecting a plan, also queue a revised generation (feedback loop). */
  regenerate?: boolean;
}

export interface DecisionResult {
  /** Set when a rejection kicked off an automatic revised-plan generation. */
  regenerationJobId?: string;
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
  const approval = await db.query.approvals.findFirst({
    where: and(
      eq(schema.approvals.id, input.approvalId),
      eq(schema.approvals.orgId, input.orgId),
    ),
  });
  if (!approval) throw new ApiError(404, "Approval not found");
  if (approval.status !== "pending") {
    throw new ApiError(409, `This item was already ${approval.status}`);
  }
  if (input.decision === "rejected" && !input.reasonCode) {
    throw new ApiError(400, "A reason code is required when rejecting");
  }

  await db
    .update(schema.approvals)
    .set({
      status: input.decision,
      decidedBy: input.decidedBy,
      decidedAt: new Date(),
      reasonCode: input.reasonCode ?? null,
      note: input.note ?? null,
    })
    .where(eq(schema.approvals.id, approval.id));

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

  // Closed feedback loop: on a plan rejection the reviewer can opt to have a
  // revised plan generated immediately. The worker's generation path already
  // pulls the latest rejection's reason + note into the prompt.
  let regenerationJobId: string | undefined;
  if (
    wantsRegeneration({
      decision: input.decision,
      subjectType: approval.subjectType,
      regenerate: input.regenerate,
    })
  ) {
    regenerationJobId = await queueRegeneration(approval, input.decidedBy);
  }

  return { regenerationJobId };
}

/**
 * Enqueue a revised-plan generation after a rejection. Best-effort: the human
 * rejection is already committed and must not be undone by a queue hiccup, so
 * failures here are logged and swallowed (the reviewer can regenerate manually).
 */
async function queueRegeneration(
  approval: typeof schema.approvals.$inferSelect,
  decidedBy: string,
): Promise<string | undefined> {
  if (!approval.projectId) return undefined;
  const projectId = approval.projectId;
  try {
    // Don't stack a second generation if one is already queued.
    const queued = await db.query.jobs.findFirst({
      where: and(
        eq(schema.jobs.projectId, projectId),
        eq(schema.jobs.type, "plan_generation"),
        eq(schema.jobs.status, "queued"),
      ),
    });
    if (queued) return queued.id;

    // Generation needs at least one requirement to work from.
    const reqCount = await db.$count(
      schema.requirements,
      eq(schema.requirements.projectId, projectId),
    );
    if (reqCount === 0) return undefined;

    return await createAndEnqueueJob({
      orgId: approval.orgId,
      projectId,
      type: "plan_generation",
      requestedBy: decidedBy,
      auditMetadata: {
        trigger: "rejection_auto_regenerate",
        rejectedApprovalId: approval.id,
      },
    });
  } catch (err) {
    logger.error(
      { err: String(err), projectId },
      "auto-regeneration enqueue failed after plan rejection",
    );
    return undefined;
  }
}

async function applyPlanDecision(planId: string, input: DecisionInput) {
  const plan = await db.query.plans.findFirst({
    where: eq(schema.plans.id, planId),
  });
  if (!plan) throw new ApiError(404, "Plan not found");

  if (input.decision === "rejected") {
    await db
      .update(schema.plans)
      .set({ status: "rejected" })
      .where(eq(schema.plans.id, planId));
    return;
  }

  const content = PlanContentSchema.parse(plan.content);

  await db.transaction(async (tx) => {
    // Any previously approved plan for this project is superseded.
    await tx
      .update(schema.plans)
      .set({ status: "superseded" })
      .where(
        and(
          eq(schema.plans.projectId, plan.projectId),
          eq(schema.plans.status, "approved"),
          ne(schema.plans.id, planId),
        ),
      );
    await tx
      .update(schema.plans)
      .set({ status: "approved" })
      .where(eq(schema.plans.id, planId));

    // Materialize milestones and tasks from the approved plan content.
    for (const [i, m] of content.milestones.entries()) {
      const [milestone] = await tx
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

      await tx.insert(schema.tasks).values(
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

    await tx
      .update(schema.requirements)
      .set({ status: "in_plan" })
      .where(
        and(
          eq(schema.requirements.projectId, plan.projectId),
          eq(schema.requirements.status, "new"),
        ),
      );
    await tx
      .update(schema.projects)
      .set({ status: "in_delivery", updatedAt: new Date() })
      .where(eq(schema.projects.id, plan.projectId));
  });
}

async function applyUpdateDecision(updateId: string, input: DecisionInput) {
  if (input.decision === "approved") {
    await db
      .update(schema.customerUpdates)
      .set({ status: "published", publishedAt: new Date() })
      .where(eq(schema.customerUpdates.id, updateId));
  } else {
    await db
      .update(schema.customerUpdates)
      .set({ status: "rejected" })
      .where(eq(schema.customerUpdates.id, updateId));
  }
}
