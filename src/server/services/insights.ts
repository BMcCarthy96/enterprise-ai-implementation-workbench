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
  type: "plan_generation" | "customer_update_digest";
  status: "queued" | "running" | "succeeded" | "failed" | "dead_letter";
  attempts: number;
  durationMs: number | null;
}

export interface PlanRow {
  promptVersion: string | null;
  status: string;
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

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

// --- DB-backed wrapper --------------------------------------------------------

export async function getInsights(orgId: string) {
  const [approvals, jobs, plans, projects, tasks, requirements, updates] =
    await Promise.all([
      db.query.approvals.findMany({
        where: eq(schema.approvals.orgId, orgId),
      }),
      db.query.jobs.findMany({ where: eq(schema.jobs.orgId, orgId) }),
      db.query.plans.findMany({ where: eq(schema.plans.orgId, orgId) }),
      db.query.projects.findMany({ where: eq(schema.projects.orgId, orgId) }),
      db.query.tasks.findMany({ where: eq(schema.tasks.orgId, orgId) }),
      db.query.requirements.findMany({
        where: eq(schema.requirements.orgId, orgId),
      }),
      db.query.customerUpdates.findMany({
        where: eq(schema.customerUpdates.orgId, orgId),
      }),
    ]);

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
