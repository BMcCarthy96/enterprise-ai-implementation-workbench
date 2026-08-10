import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * Org-scoped analytics for the Insights dashboard.
 *
 * The aggregation math lives in pure functions (exported for unit testing);
 * the `getInsights` wrapper is the only part that touches the database. This
 * keeps the "eval" logic — approval rates, latency, reason-code breakdowns —
 * verifiable without a live DB.
 */

export interface DecisionRow {
  status: "pending" | "approved" | "rejected";
  reasonCode: string | null;
  createdAt: Date;
  decidedAt: Date | null;
}

export interface JobRow {
  type: "plan_generation" | "customer_update_digest" | "document_ingest" | "webhook_delivery";
  status: "queued" | "running" | "succeeded" | "failed" | "dead_letter";
  attempts: number;
  durationMs: number | null;
}

export interface PlanRow {
  promptVersion: string | null;
  status: string;
}

export interface AiRunRow {
  artifactType: "plan" | "customer_update" | "document_ingest" | "eval";
  status: "running" | "succeeded" | "failed";
  finalOutcome: string | null;
  costUsd: string | null;
  latencyMs: number | null;
}

export interface AiCallRow {
  operation: "generate" | "repair" | "judge" | "embed";
  outcome: "valid" | "invalid" | "blocked" | "failed";
}

// --- Pure aggregation helpers -------------------------------------------------

export interface ApprovalStats {
  total: number;
  approved: number;
  rejected: number;
  pending: number;
  /** Approval rate over *decided* items (0–100, or null if none decided). */
  approvalRate: number | null;
  /** Avg hours from request to decision, or null if none decided. */
  avgTurnaroundHours: number | null;
}

export function computeApprovalStats(rows: DecisionRow[]): ApprovalStats {
  const approved = rows.filter((r) => r.status === "approved").length;
  const rejected = rows.filter((r) => r.status === "rejected").length;
  const pending = rows.filter((r) => r.status === "pending").length;
  const decided = approved + rejected;

  const turnarounds = rows
    .filter((r) => r.decidedAt)
    .map((r) => (r.decidedAt!.getTime() - r.createdAt.getTime()) / 3_600_000);
  const avgTurnaroundHours = turnarounds.length
    ? round(turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length, 1)
    : null;

  return {
    total: rows.length,
    approved,
    rejected,
    pending,
    approvalRate: decided ? Math.round((approved / decided) * 100) : null,
    avgTurnaroundHours,
  };
}

/** Count rejections by reason code, descending. Feeds the quality loop. */
export function computeRejectionReasons(
  rows: DecisionRow[],
): Array<{ reason: string; count: number }> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (r.status !== "rejected") continue;
    const key = r.reasonCode ?? "unspecified";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}

export interface JobReliability {
  total: number;
  succeeded: number;
  failedOrDead: number;
  deadLetter: number;
  successRate: number | null;
  /** Share of jobs that needed more than one attempt (0–100). */
  retryRate: number | null;
  avgDurationMs: number | null;
}

export function computeJobReliability(rows: JobRow[]): JobReliability {
  const terminal = rows.filter((r) =>
    ["succeeded", "failed", "dead_letter"].includes(r.status),
  );
  const succeeded = rows.filter((r) => r.status === "succeeded").length;
  const deadLetter = rows.filter((r) => r.status === "dead_letter").length;
  const failedOrDead = rows.filter((r) =>
    ["failed", "dead_letter"].includes(r.status),
  ).length;
  const retried = rows.filter((r) => r.attempts > 1).length;
  const durations = rows
    .filter((r) => r.durationMs != null)
    .map((r) => r.durationMs!);

  return {
    total: rows.length,
    succeeded,
    failedOrDead,
    deadLetter,
    successRate: terminal.length
      ? Math.round((succeeded / terminal.length) * 100)
      : null,
    retryRate: rows.length ? Math.round((retried / rows.length) * 100) : null,
    avgDurationMs: durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : null,
  };
}

/** Group plan approvals by the prompt version that produced them. */
export function computeByPromptVersion(
  plans: PlanRow[],
): Array<{ promptVersion: string; total: number; approved: number }> {
  const groups = new Map<string, { total: number; approved: number }>();
  for (const p of plans) {
    const key = p.promptVersion ?? "unversioned";
    const g = groups.get(key) ?? { total: 0, approved: 0 };
    g.total += 1;
    if (p.status === "approved" || p.status === "superseded") g.approved += 1;
    groups.set(key, g);
  }
  return [...groups.entries()]
    .map(([promptVersion, g]) => ({ promptVersion, ...g }))
    .sort((a, b) => b.total - a.total);
}

export function tally<T extends string>(
  values: T[],
): Array<{ key: T; count: number }> {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].map(([key, count]) => ({ key, count }));
}

export interface AiQualityStats {
  runCount: number;
  succeeded: number;
  totalCostUsd: number | null;
  costPerPlanUsd: number | null;
  costPerApprovedPlanUsd: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  firstAttemptValidityRate: number | null;
  repairRescueRate: number | null;
  guardrailFailures: number;
}

export function computeAiQuality(input: {
  runs: AiRunRow[];
  calls: AiCallRow[];
  approvedPlanCount: number;
}): AiQualityStats {
  const planRuns = input.runs.filter((run) => run.artifactType === "plan");
  const latencies = planRuns
    .map((run) => run.latencyMs)
    .filter((value): value is number => value != null)
    .sort((a, b) => a - b);
  const costs = planRuns
    .map((run) => (run.costUsd == null ? null : Number(run.costUsd)))
    .filter((value): value is number => value != null && Number.isFinite(value));
  const initialCalls = input.calls.filter((call) => call.operation === "generate");
  const repairedRuns = planRuns.filter((run) => run.finalOutcome === "repaired").length;
  const rescuedRuns = planRuns.filter((run) => run.finalOutcome === "repaired" && run.status === "succeeded").length;
  const guardrailFailures = input.calls.filter(
    (call) => call.outcome === "blocked" || call.outcome === "invalid",
  ).length;
  const totalCostUsd = costs.length ? round(costs.reduce((sum, value) => sum + value, 0), 6) : null;
  return {
    runCount: planRuns.length,
    succeeded: planRuns.filter((run) => run.status === "succeeded").length,
    totalCostUsd,
    costPerPlanUsd: totalCostUsd != null && planRuns.length ? round(totalCostUsd / planRuns.length, 6) : null,
    costPerApprovedPlanUsd:
      totalCostUsd != null && input.approvedPlanCount
        ? round(totalCostUsd / input.approvedPlanCount, 6)
        : null,
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    firstAttemptValidityRate: initialCalls.length
      ? Math.round((initialCalls.filter((call) => call.outcome === "valid").length / initialCalls.length) * 100)
      : null,
    repairRescueRate: repairedRuns ? Math.round((rescuedRuns / repairedRuns) * 100) : null,
    guardrailFailures,
  };
}

function percentile(sorted: number[], fraction: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

// --- DB-backed wrapper --------------------------------------------------------

export async function getInsights(orgId: string) {
  // A tenant request uses one transaction-bound pg client. Keep operations
  // sequential: concurrent client.query calls are deprecated in pg 8 and will
  // be rejected by pg 9.
  const approvals = await db.query.approvals.findMany({
    where: eq(schema.approvals.orgId, orgId),
  });
  const jobs = await db.query.jobs.findMany({ where: eq(schema.jobs.orgId, orgId) });
  const plans = await db.query.plans.findMany({ where: eq(schema.plans.orgId, orgId) });
  const projects = await db.query.projects.findMany({ where: eq(schema.projects.orgId, orgId) });
  const tasks = await db.query.tasks.findMany({ where: eq(schema.tasks.orgId, orgId) });
  const requirements = await db.query.requirements.findMany({
    where: eq(schema.requirements.orgId, orgId),
  });
  const updates = await db.query.customerUpdates.findMany({
    where: eq(schema.customerUpdates.orgId, orgId),
  });
  const aiRuns = await db.query.aiRuns.findMany({ where: eq(schema.aiRuns.orgId, orgId) });
  const aiCalls = await db.query.aiCalls.findMany({ where: eq(schema.aiCalls.orgId, orgId) });

  const planDecisions: DecisionRow[] = approvals
    .filter((a) => a.subjectType === "plan")
    .map((a) => ({
      status: a.status,
      reasonCode: a.reasonCode,
      createdAt: a.createdAt,
      decidedAt: a.decidedAt,
    }));
  const updateDecisions: DecisionRow[] = approvals
    .filter((a) => a.subjectType === "customer_update")
    .map((a) => ({
      status: a.status,
      reasonCode: a.reasonCode,
      createdAt: a.createdAt,
      decidedAt: a.decidedAt,
    }));

  const planJobs: JobRow[] = jobs
    .filter((j) => j.type === "plan_generation")
    .map((j) => ({
      type: j.type,
      status: j.status,
      attempts: j.attempts,
      durationMs: j.durationMs,
    }));

  return {
    planQuality: computeApprovalStats(planDecisions),
    updateQuality: computeApprovalStats(updateDecisions),
    rejectionReasons: computeRejectionReasons([
      ...planDecisions,
      ...updateDecisions,
    ]),
    planJobReliability: computeJobReliability(planJobs),
    byPromptVersion: computeByPromptVersion(
      plans.map((p) => ({ promptVersion: p.promptVersion, status: p.status })),
    ),
    aiQuality: computeAiQuality({
      runs: aiRuns.map((run) => ({
        artifactType: run.artifactType,
        status: run.status,
        finalOutcome: run.finalOutcome,
        costUsd: run.costUsd,
        latencyMs: run.latencyMs,
      })),
      calls: aiCalls.map((call) => ({ operation: call.operation, outcome: call.outcome })),
      approvedPlanCount: plans.filter((plan) => plan.status === "approved" || plan.status === "superseded").length,
    }),
    delivery: {
      projectsByStatus: tally(projects.map((p) => p.status)),
      tasksByStatus: tally(tasks.map((t) => t.status)),
      totalRequirements: requirements.length,
      totalPlans: plans.length,
      totalUpdatesPublished: updates.filter((u) => u.status === "published")
        .length,
    },
  };
}

export type Insights = Awaited<ReturnType<typeof getInsights>>;
