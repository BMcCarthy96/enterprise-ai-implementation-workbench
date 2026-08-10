import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { computePlanCoverage } from "@/lib/ai/evidence";

export interface AiEvidencePacket {
  run: typeof schema.aiRuns.$inferSelect;
  calls: Array<typeof schema.aiCalls.$inferSelect>;
  evaluations: Array<{
    id: string;
    checkName: string;
    category: string;
    gateLevel: string;
    score: number;
    threshold: number;
    passed: boolean;
    detail: string;
    evaluatorVersion: string;
    createdAt: Date;
  }>;
  citations: Array<typeof schema.planCitations.$inferSelect>;
  artifact: {
    id: string;
    type: string;
    projectId: string;
    version: number;
    status: string;
    href: string;
  } | null;
  approval: {
    id: string;
    status: string;
    requestedBy: string | null;
    decidedBy: string | null;
    requestedByName: string | null;
    decidedByName: string | null;
    createdAt: Date;
    decidedAt: Date | null;
    note: string | null;
  } | null;
  coverage: ReturnType<typeof computePlanCoverage> | null;
  retentionExpired: boolean;
}

export async function getAiEvidencePacket(orgId: string, runId: string): Promise<AiEvidencePacket | null> {
  const run = await db.query.aiRuns.findFirst({
    where: and(eq(schema.aiRuns.id, runId), eq(schema.aiRuns.orgId, orgId)),
  });
  if (!run) return null;
  const calls = await db.query.aiCalls.findMany({
    where: and(eq(schema.aiCalls.aiRunId, run.id), eq(schema.aiCalls.orgId, orgId)),
    orderBy: asc(schema.aiCalls.sequence),
  });
  const evaluationRows = await db.query.aiRunEvaluations.findMany({
    where: and(eq(schema.aiRunEvaluations.aiRunId, run.id), eq(schema.aiRunEvaluations.orgId, orgId)),
    orderBy: asc(schema.aiRunEvaluations.checkName),
  });
  const retentionPolicy = await db.query.retentionPolicies.findFirst({
    where: eq(schema.retentionPolicies.orgId, orgId),
    columns: { aiDetailDays: true },
  });
  const detailCutoff = Date.now() - (retentionPolicy?.aiDetailDays ?? 90) * 86_400_000;
  const retentionExpired = calls.length === 0 && evaluationRows.length === 0 && run.createdAt.getTime() < detailCutoff;
  const evaluations = evaluationRows.map((evaluation) => ({
    id: evaluation.id,
    checkName: evaluation.checkName,
    category: evaluation.category,
    gateLevel: evaluation.gateLevel,
    score: Number(evaluation.score),
    threshold: Number(evaluation.threshold),
    passed: evaluation.passed,
    detail: evaluation.detail,
    evaluatorVersion: evaluation.evaluatorVersion,
    createdAt: evaluation.createdAt,
  }));

  const plan = run.artifactType === "plan" && run.jobId
    ? await db.query.plans.findFirst({
        where: and(eq(schema.plans.orgId, orgId), eq(schema.plans.generatedByJobId, run.jobId)),
        orderBy: desc(schema.plans.version),
      })
    : null;
  const citations = plan
    ? await db.query.planCitations.findMany({
        where: and(eq(schema.planCitations.orgId, orgId), eq(schema.planCitations.planId, plan.id)),
        orderBy: asc(schema.planCitations.sourceRef),
      })
    : [];
  const approval = plan
    ? await db.query.approvals.findFirst({
        where: and(
          eq(schema.approvals.orgId, orgId),
          eq(schema.approvals.subjectType, "plan"),
          eq(schema.approvals.subjectId, plan.id),
        ),
        orderBy: desc(schema.approvals.createdAt),
      })
    : null;
  const actorIds = approval
    ? [approval.requestedBy, approval.decidedBy].filter((id): id is string => Boolean(id))
    : [];
  const approvalActors = actorIds.length
    ? await db.query.users.findMany({ where: inArray(schema.users.id, actorIds), columns: { id: true, name: true } })
    : [];
  const actorNames = new Map(approvalActors.map((actor) => [actor.id, actor.name]));
  const requirements = plan
    ? await db.query.requirements.findMany({
        where: and(eq(schema.requirements.orgId, orgId), eq(schema.requirements.projectId, plan.projectId)),
        columns: { id: true },
      })
    : [];

  return {
    run,
    calls,
    evaluations,
    citations,
    artifact: plan
      ? {
          id: plan.id,
          type: "plan",
          projectId: plan.projectId,
          version: plan.version,
          status: plan.status,
          href: `/projects/${plan.projectId}/plan`,
        }
      : null,
    approval: approval
      ? {
          id: approval.id,
          status: approval.status,
          requestedBy: approval.requestedBy,
          decidedBy: approval.decidedBy,
          requestedByName: approval.requestedBy ? actorNames.get(approval.requestedBy) ?? null : null,
          decidedByName: approval.decidedBy ? actorNames.get(approval.decidedBy) ?? null : null,
          createdAt: approval.createdAt,
          decidedAt: approval.decidedAt,
          note: approval.note,
        }
      : null,
    coverage: plan
      ? computePlanCoverage({ requirements, plan: plan.content, citationCount: citations.length })
      : null,
    retentionExpired,
  };
}

export function summarizeEvidence(evaluations: Array<{ passed: boolean; gateLevel: string }>): {
  passed: number;
  total: number;
  hardGatePassed: boolean | null;
} {
  if (!evaluations.length) return { passed: 0, total: 0, hardGatePassed: null };
  const hardGates = evaluations.filter((evaluation) => evaluation.gateLevel === "hard_gate");
  return {
    passed: evaluations.filter((evaluation) => evaluation.passed).length,
    total: evaluations.length,
    hardGatePassed: hardGates.length ? hardGates.every((evaluation) => evaluation.passed) : null,
  };
}
