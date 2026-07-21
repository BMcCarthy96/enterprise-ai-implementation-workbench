import type { PlanContent } from "./planSchema";

export interface PlanDiff {
  milestonesAdded: string[];
  milestonesRemoved: string[];
  taskCountDelta: number;
  riskCountDelta: number;
  previousTaskCount: number;
  currentTaskCount: number;
  summaryChanged: boolean;
  hasChanges: boolean;
}

const taskTotal = (p: PlanContent) =>
  p.milestones.reduce((n, m) => n + m.tasks.length, 0);

/**
 * Structured diff between two plan versions, so a reviewer re-approving a
 * regenerated plan can see what changed instead of re-reading the whole thing.
 * Milestones are matched by name (case-insensitive).
 */
export function diffPlans(prev: PlanContent, next: PlanContent): PlanDiff {
  const prevNames = new Set(
    prev.milestones.map((m) => m.name.trim().toLowerCase()),
  );
  const nextNames = new Set(
    next.milestones.map((m) => m.name.trim().toLowerCase()),
  );

  const milestonesAdded = next.milestones
    .filter((m) => !prevNames.has(m.name.trim().toLowerCase()))
    .map((m) => m.name);
  const milestonesRemoved = prev.milestones
    .filter((m) => !nextNames.has(m.name.trim().toLowerCase()))
    .map((m) => m.name);

  const previousTaskCount = taskTotal(prev);
  const currentTaskCount = taskTotal(next);
  const taskCountDelta = currentTaskCount - previousTaskCount;
  const riskCountDelta = next.risks.length - prev.risks.length;
  const summaryChanged = prev.summary.trim() !== next.summary.trim();

  return {
    milestonesAdded,
    milestonesRemoved,
    taskCountDelta,
    riskCountDelta,
    previousTaskCount,
    currentTaskCount,
    summaryChanged,
    hasChanges:
      milestonesAdded.length > 0 ||
      milestonesRemoved.length > 0 ||
      taskCountDelta !== 0 ||
      riskCountDelta !== 0 ||
      summaryChanged,
  };
}
