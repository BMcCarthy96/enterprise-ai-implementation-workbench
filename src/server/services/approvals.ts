import { and, eq, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { PlanContentSchema } from "@/lib/ai/planSchema";
import { ApiError } from "@/lib/api";
import { recordAudit } from "./audit";

export interface DecisionInput {
  approvalId: string;
  orgId: string;
  decidedBy: string;
  decision: "approved" | "rejected";
  reasonCode?: string;
  note?: string;
}

/**
 * The single human checkpoint for AI output. Approving a plan materializes
 * its milestones and tasks; approving a customer update publishes it to the
 * customer stakeholder view. Rejections capture a reason code that feeds the
 * quality loop.
 */
export async function decideApproval(input: DecisionInput): Promise<void> {
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
