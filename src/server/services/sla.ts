import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * SLA / delivery-risk scoring.
 *
 * Nothing here is stored — risk is *derived* on read from delivery data already
 * in Postgres (project target dates, blocked-task age, approval-queue age). The
 * scoring is pure and unit-tested; the thresholds are one policy object so an
 * org could tune them without touching the logic.
 */

export type RiskLevel = "on_track" | "at_risk" | "breached";
export type ActiveRiskLevel = Exclude<RiskLevel, "on_track">;

export interface SlaPolicy {
  /** Flag a project whose target date is within this many days. */
  targetDateWarningDays: number;
  /** Blocked task aging thresholds (days since it went blocked). */
  blockedTaskWarnDays: number;
  blockedTaskBreachDays: number;
  /** Approval-queue aging thresholds (hours pending human review). */
  approvalWarnHours: number;
  approvalBreachHours: number;
}

export const DEFAULT_SLA_POLICY: SlaPolicy = {
  targetDateWarningDays: 14,
  blockedTaskWarnDays: 3,
  blockedTaskBreachDays: 7,
  approvalWarnHours: 24,
  approvalBreachHours: 72,
};

export interface SlaSignal {
  kind: "target_date" | "blocked_task" | "stale_approval";
  level: ActiveRiskLevel;
  label: string;
}

export interface ProjectRiskInput {
  projectId: string;
  projectName: string;
  customerName: string;
  status: string;
  targetDate: Date | null;
  blockedCount: number;
  oldestBlockedAt: Date | null;
  pendingApprovalCount: number;
  oldestPendingApprovalAt: Date | null;
}

export interface ProjectRisk {
  projectId: string;
  projectName: string;
  customerName: string;
  status: string;
  level: RiskLevel;
  signals: SlaSignal[];
}

export interface DeliveryRisks {
  risks: ProjectRisk[];
  counts: { breached: number; atRisk: number };
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
// Only projects that are actively being delivered carry a delivery SLA.
const ACTIVE_STATUSES = ["discovery", "planning", "in_delivery"] as const;
const ACTIVE_SET = new Set<string>(ACTIVE_STATUSES);

const RANK: Record<RiskLevel, number> = { on_track: 0, at_risk: 1, breached: 2 };

/** The more severe of two levels. */
export function worseLevel(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RANK[a] >= RANK[b] ? a : b;
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/**
 * Classify one project's delivery risk from its aggregated signals. Pure: pass
 * a fixed `now` in tests. Completed / on-hold projects never carry an SLA.
 */
export function assessProjectRisk(
  input: ProjectRiskInput,
  now: Date = new Date(),
  policy: SlaPolicy = DEFAULT_SLA_POLICY,
): ProjectRisk {
  const base = {
    projectId: input.projectId,
    projectName: input.projectName,
    customerName: input.customerName,
    status: input.status,
  };
  const signals: SlaSignal[] = [];

  if (!ACTIVE_SET.has(input.status)) {
    return { ...base, level: "on_track", signals };
  }

  // 1) Target date approaching or passed.
  if (input.targetDate) {
    const days = Math.floor((input.targetDate.getTime() - now.getTime()) / DAY_MS);
    if (days < 0) {
      signals.push({
        kind: "target_date",
        level: "breached",
        label: `Target date passed ${plural(-days, "day")} ago`,
      });
    } else if (days <= policy.targetDateWarningDays) {
      signals.push({
        kind: "target_date",
        level: "at_risk",
        label: days === 0 ? "Target date is today" : `Target date in ${plural(days, "day")}`,
      });
    }
  }

  // 2) Blocked tasks aging.
  if (input.blockedCount > 0 && input.oldestBlockedAt) {
    const days = Math.floor((now.getTime() - input.oldestBlockedAt.getTime()) / DAY_MS);
    const label = `${plural(input.blockedCount, "task")} blocked ${days}d+`;
    if (days >= policy.blockedTaskBreachDays) {
      signals.push({ kind: "blocked_task", level: "breached", label });
    } else if (days >= policy.blockedTaskWarnDays) {
      signals.push({ kind: "blocked_task", level: "at_risk", label });
    }
  }

  // 3) Approvals aging in the human-review queue.
  if (input.pendingApprovalCount > 0 && input.oldestPendingApprovalAt) {
    const hours = Math.floor(
      (now.getTime() - input.oldestPendingApprovalAt.getTime()) / HOUR_MS,
    );
    const label =
      hours >= 48
        ? `Approval waiting ${plural(Math.floor(hours / 24), "day")}`
        : `Approval waiting ${plural(hours, "hour")}`;
    if (hours >= policy.approvalBreachHours) {
      signals.push({ kind: "stale_approval", level: "breached", label });
    } else if (hours >= policy.approvalWarnHours) {
      signals.push({ kind: "stale_approval", level: "at_risk", label });
    }
  }

  const level = signals.reduce<RiskLevel>((acc, s) => worseLevel(acc, s.level), "on_track");
  signals.sort((a, b) => RANK[b.level] - RANK[a.level]);
  return { ...base, level, signals };
}

function groupAgg(
  rows: Array<{ projectId: string; at: Date }>,
): Map<string, { count: number; oldest: Date }> {
  const map = new Map<string, { count: number; oldest: Date }>();
  for (const r of rows) {
    const cur = map.get(r.projectId);
    if (!cur) map.set(r.projectId, { count: 1, oldest: r.at });
    else {
      cur.count += 1;
      if (r.at < cur.oldest) cur.oldest = r.at;
    }
  }
  return map;
}

/**
 * Org-scoped delivery-risk snapshot for the dashboard: every actively-delivering
 * project that is at risk or breached, worst first.
 */
export async function getDeliveryRisks(
  orgId: string,
  now: Date = new Date(),
): Promise<DeliveryRisks> {
  const projects = await db
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      status: schema.projects.status,
      targetDate: schema.projects.targetDate,
      customerName: schema.customers.name,
    })
    .from(schema.projects)
    .innerJoin(
      schema.customers,
      eq(schema.projects.customerId, schema.customers.id),
    )
    .where(
      and(
        eq(schema.projects.orgId, orgId),
        inArray(schema.projects.status, [...ACTIVE_STATUSES]),
      ),
    );

  if (projects.length === 0) return { risks: [], counts: { breached: 0, atRisk: 0 } };
  const ids = projects.map((p) => p.id);

  const blockedRows = await db
    .select({
      projectId: schema.tasks.projectId,
      updatedAt: schema.tasks.updatedAt,
    })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.orgId, orgId),
        eq(schema.tasks.status, "blocked"),
        inArray(schema.tasks.projectId, ids),
      ),
    );

  const pendingRows = await db
    .select({
      projectId: schema.approvals.projectId,
      createdAt: schema.approvals.createdAt,
    })
    .from(schema.approvals)
    .where(
      and(
        eq(schema.approvals.orgId, orgId),
        eq(schema.approvals.status, "pending"),
        inArray(schema.approvals.projectId, ids),
      ),
    );

  const blockedBy = groupAgg(
    blockedRows.map((r) => ({ projectId: r.projectId, at: r.updatedAt })),
  );
  const pendingBy = groupAgg(
    pendingRows
      .filter((r): r is { projectId: string; createdAt: Date } => r.projectId !== null)
      .map((r) => ({ projectId: r.projectId, at: r.createdAt })),
  );

  const risks = projects
    .map((p) =>
      assessProjectRisk(
        {
          projectId: p.id,
          projectName: p.name,
          customerName: p.customerName,
          status: p.status,
          targetDate: p.targetDate,
          blockedCount: blockedBy.get(p.id)?.count ?? 0,
          oldestBlockedAt: blockedBy.get(p.id)?.oldest ?? null,
          pendingApprovalCount: pendingBy.get(p.id)?.count ?? 0,
          oldestPendingApprovalAt: pendingBy.get(p.id)?.oldest ?? null,
        },
        now,
      ),
    )
    .filter((r) => r.level !== "on_track")
    .sort(
      (a, b) =>
        RANK[b.level] - RANK[a.level] || a.projectName.localeCompare(b.projectName),
    );

  return {
    risks,
    counts: {
      breached: risks.filter((r) => r.level === "breached").length,
      atRisk: risks.filter((r) => r.level === "at_risk").length,
    },
  };
}
