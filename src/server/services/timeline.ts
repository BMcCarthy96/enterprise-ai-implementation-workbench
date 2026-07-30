import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * Customer-facing project status timeline.
 *
 * Deliberately assembled from delivery state (milestones, tasks, *published*
 * customer updates) rather than from `audit_events`. The audit trail carries
 * internal signals a customer must never see — plan rejections and their reason
 * codes, AI generation attempts, job failures, who approved what — so the
 * timeline is built from an explicit allowlist of safe sources instead of
 * filtering a stream that defaults to exposing everything.
 */

export type PhaseStatus = "complete" | "in_progress" | "upcoming";

export interface TimelinePhase {
  id: string;
  name: string;
  description: string | null;
  status: PhaseStatus;
  taskCount: number;
  doneCount: number;
}

export interface TimelineUpdate {
  id: string;
  title: string;
  publishedAt: Date;
  excerpt: string;
}

export interface TimelineProgress {
  phasesComplete: number;
  phasesTotal: number;
  tasksDone: number;
  tasksTotal: number;
  percent: number;
}

export interface ProjectTimeline {
  startedAt: Date;
  targetDate: Date | null;
  phases: TimelinePhase[];
  updates: TimelineUpdate[];
  progress: TimelineProgress;
}

export interface TimelineInput {
  startedAt: Date;
  targetDate: Date | null;
  milestones: Array<{
    id: string;
    name: string;
    description: string | null;
    status: string;
    sortOrder: number;
  }>;
  tasks: Array<{ milestoneId: string | null; status: string }>;
  updates: Array<{
    id: string;
    title: string;
    body: string;
    status: string;
    publishedAt: Date | null;
  }>;
}

const PHASE_STATUS: Record<string, PhaseStatus> = {
  complete: "complete",
  in_progress: "in_progress",
  not_started: "upcoming",
};

/** First sentence (or a trimmed prefix) of an update body. */
export function excerpt(body: string, max = 180): string {
  const firstPara = body.split("\n\n")[0]?.trim() ?? "";
  if (firstPara.length <= max) return firstPara;
  return `${firstPara.slice(0, max).trimEnd()}…`;
}

/**
 * Pure assembly of the timeline. Filters updates to `published` itself rather
 * than trusting the caller's query — the customer-visibility rule is enforced
 * where it can be unit-tested.
 */
export function buildProjectTimeline(input: TimelineInput): ProjectTimeline {
  const doneByMilestone = new Map<string, number>();
  const totalByMilestone = new Map<string, number>();
  for (const t of input.tasks) {
    if (!t.milestoneId) continue;
    totalByMilestone.set(t.milestoneId, (totalByMilestone.get(t.milestoneId) ?? 0) + 1);
    if (t.status === "done") {
      doneByMilestone.set(t.milestoneId, (doneByMilestone.get(t.milestoneId) ?? 0) + 1);
    }
  }

  const phases: TimelinePhase[] = [...input.milestones]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      status: PHASE_STATUS[m.status] ?? "upcoming",
      taskCount: totalByMilestone.get(m.id) ?? 0,
      doneCount: doneByMilestone.get(m.id) ?? 0,
    }));

  const updates: TimelineUpdate[] = input.updates
    .filter((u) => u.status === "published" && u.publishedAt !== null)
    .map((u) => ({
      id: u.id,
      title: u.title,
      publishedAt: u.publishedAt as Date,
      excerpt: excerpt(u.body),
    }))
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());

  const tasksTotal = input.tasks.filter((t) => t.milestoneId).length;
  const tasksDone = input.tasks.filter(
    (t) => t.milestoneId && t.status === "done",
  ).length;
  const phasesComplete = phases.filter((p) => p.status === "complete").length;

  return {
    startedAt: input.startedAt,
    targetDate: input.targetDate,
    phases,
    updates,
    progress: {
      phasesComplete,
      phasesTotal: phases.length,
      tasksDone,
      tasksTotal,
      // Task-level percentage is the honest measure of progress; phases are
      // coarse and would jump in large steps.
      percent: tasksTotal === 0 ? 0 : Math.round((tasksDone / tasksTotal) * 100),
    },
  };
}

/** Org-scoped fetch + assembly for a single project. */
export async function getProjectTimeline(
  projectId: string,
  project: { createdAt: Date; targetDate: Date | null },
): Promise<ProjectTimeline> {
  const [milestones, tasks, updates] = await Promise.all([
    db
      .select({
        id: schema.milestones.id,
        name: schema.milestones.name,
        description: schema.milestones.description,
        status: schema.milestones.status,
        sortOrder: schema.milestones.sortOrder,
      })
      .from(schema.milestones)
      .where(eq(schema.milestones.projectId, projectId))
      .orderBy(asc(schema.milestones.sortOrder)),
    db
      .select({
        milestoneId: schema.tasks.milestoneId,
        status: schema.tasks.status,
      })
      .from(schema.tasks)
      .where(eq(schema.tasks.projectId, projectId)),
    db
      .select({
        id: schema.customerUpdates.id,
        title: schema.customerUpdates.title,
        body: schema.customerUpdates.body,
        status: schema.customerUpdates.status,
        publishedAt: schema.customerUpdates.publishedAt,
      })
      .from(schema.customerUpdates)
      .where(eq(schema.customerUpdates.projectId, projectId)),
  ]);

  return buildProjectTimeline({
    startedAt: project.createdAt,
    targetDate: project.targetDate,
    milestones,
    tasks,
    updates,
  });
}
