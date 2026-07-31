import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { ApiError } from "@/lib/api";
import {
  DEFAULT_SLA_POLICY,
  effectiveOverrides,
  policyOrderingErrors,
  resolveSlaPolicy,
  type SlaPolicy,
  type SlaPolicyOverride,
} from "@/lib/sla";
import { recordAudit } from "./audit";

/**
 * SLA / delivery-risk scoring.
 *
 * Risk itself is never stored — it's *derived* on read from delivery data
 * already in Postgres (project target dates, blocked-task age, approval-queue
 * age). Only the thresholds are persisted, and only where a project overrides
 * them; the scoring stays pure and unit-tested.
 */

// Re-exported so callers have one import site for policy + evaluation.
export {
  DEFAULT_SLA_POLICY,
  resolveSlaPolicy,
  effectiveOverrides,
  type SlaPolicy,
  type SlaPolicyOverride,
};

export type RiskLevel = "on_track" | "at_risk" | "breached";
export type ActiveRiskLevel = Exclude<RiskLevel, "on_track">;

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
  /** True when this project's thresholds differ from the org defaults. */
  customPolicy?: boolean;
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

/** The stored override plus its resolved form, for the settings UI. */
export interface ProjectSlaPolicy {
  override: SlaPolicyOverride | null;
  resolved: SlaPolicy;
  overriddenFields: Array<keyof SlaPolicy>;
}

export function readProjectSlaPolicy(raw: unknown): ProjectSlaPolicy {
  const override = (raw ?? null) as SlaPolicyOverride | null;
  return {
    override,
    resolved: resolveSlaPolicy(override),
    overriddenFields: effectiveOverrides(override),
  };
}

/**
 * Persist a project's SLA overrides. An empty object clears them (back to org
 * defaults). Validates the *resolved* policy: a warn threshold above its breach
 * threshold would make the warn level unreachable, and that's only checkable
 * after merging, since a partial override can invert an inherited default.
 */
export async function updateProjectSlaPolicy(input: {
  projectId: string;
  orgId: string;
  actorId: string;
  override: SlaPolicyOverride;
}): Promise<ProjectSlaPolicy> {
  const errors = policyOrderingErrors(resolveSlaPolicy(input.override));
  if (errors.length > 0) {
    throw new ApiError(400, errors.join("; "), "invalid_sla_policy");
  }

  const project = await db.query.projects.findFirst({
    where: and(
      eq(schema.projects.id, input.projectId),
      eq(schema.projects.orgId, input.orgId),
    ),
  });
  if (!project) throw new ApiError(404, "Project not found");

  // Store only genuine overrides so unset fields keep tracking the defaults.
  const kept = effectiveOverrides(input.override);
  const toStore =
    kept.length === 0
      ? null
      : Object.fromEntries(kept.map((k) => [k, input.override[k]!]));

  await db
    .update(schema.projects)
    .set({ slaPolicy: toStore, updatedAt: new Date() })
    .where(eq(schema.projects.id, input.projectId));

  await recordAudit({
    orgId: input.orgId,
    actorId: input.actorId,
    action: "project.sla_policy_updated",
    subjectType: "project",
    subjectId: input.projectId,
    projectId: input.projectId,
    metadata: { before: project.slaPolicy ?? null, after: toStore },
  });

  return readProjectSlaPolicy(toStore);
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
      slaPolicy: schema.projects.slaPolicy,
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
    .map((p) => {
      // Each project is scored against its own resolved thresholds.
      const override = p.slaPolicy as SlaPolicyOverride | null;
      const risk = assessProjectRisk(
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
        resolveSlaPolicy(override),
      );
      return { ...risk, customPolicy: effectiveOverrides(override).length > 0 };
    })
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
