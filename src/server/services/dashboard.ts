import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { computeAiQuality, type AiCallRow, type AiRunRow } from "./insights";
import { getDeliveryRisks, type ProjectRisk, type RiskLevel } from "./sla";

export type DashboardTaskStatus = "todo" | "in_progress" | "blocked" | "in_review" | "done";

export interface DashboardKpi {
  id: "projects" | "approvals" | "tasks" | "jobs";
  label: string;
  value: number;
  context: string;
  href: string;
  tone: "cyan" | "amber" | "rose" | "emerald";
}

export interface DashboardProjectHealth {
  id: string;
  name: string;
  customerName: string;
  status: string;
  targetDate: Date | null;
  targetLabel: string;
  completedTasks: number;
  totalTasks: number;
  completionPercent: number;
  nextMilestone: string | null;
  risk: RiskLevel;
  signals: string[];
  nextAction: string;
  nextActionHref: string;
}

export interface DashboardApproval {
  id: string;
  projectId: string | null;
  projectName: string;
  subjectType: string;
  title: string;
  ageLabel: string;
  createdAt: Date;
  href: string;
}

export interface DashboardQueueItem {
  id: string;
  kind: "risk" | "approval" | "blocked_task" | "failed_job";
  title: string;
  detail: string;
  href: string;
  tone: "rose" | "amber" | "cyan";
}

export interface DashboardActivity {
  id: string;
  action: string;
  actor: string;
  createdAt: Date;
  projectId: string | null;
}

export interface DashboardAiProof {
  planRuns: number;
  successfulRuns: number;
  firstPassValidityRate: number | null;
  repairRescueRate: number | null;
  costPerPlanUsd: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  evaluatedRuns: number;
  hardGatePassRate: number | null;
  latestOutcome: string | null;
  latestAt: Date | null;
  href: string;
}

export interface DashboardSnapshot {
  isInternal: boolean;
  kpis: DashboardKpi[];
  projects: DashboardProjectHealth[];
  taskBreakdown: Array<{ status: DashboardTaskStatus; count: number }>;
  approvals: DashboardApproval[];
  blockedTasks: Array<{ id: string; title: string; projectName: string; updatedAt: Date; href: string }>;
  failedJobs: Array<{ id: string; type: string; projectName: string; status: string; attempts: number; href: string }>;
  aiProof: DashboardAiProof | null;
  actionQueue: DashboardQueueItem[];
  activity: DashboardActivity[];
  delivery: { risks: ProjectRisk[]; counts: { breached: number; atRisk: number } };
  riskCounts: { breached: number; atRisk: number };
}

export function calculateCompletion(tasks: Array<{ status: DashboardTaskStatus }>): {
  completed: number;
  total: number;
  percent: number;
} {
  const completed = tasks.filter((task) => task.status === "done").length;
  return { completed, total: tasks.length, percent: tasks.length ? Math.round((completed / tasks.length) * 100) : 0 };
}

export function buildTaskBreakdown(tasks: Array<{ status: DashboardTaskStatus }>): Array<{ status: DashboardTaskStatus; count: number }> {
  const statuses: DashboardTaskStatus[] = ["todo", "in_progress", "blocked", "in_review", "done"];
  return statuses.map((status) => ({ status, count: tasks.filter((task) => task.status === status).length }));
}

export function formatAge(createdAt: Date, now = new Date()): string {
  const hours = Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / 3_600_000));
  if (hours < 1) return "Just now";
  if (hours < 24) return `${hours}h old`;
  const days = Math.floor(hours / 24);
  return `${days}d old`;
}

function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

function projectRisk(risks: ProjectRisk[], projectId: string): ProjectRisk | undefined {
  return risks.find((risk) => risk.projectId === projectId);
}

/** Tenant-scoped dashboard read model. Every source query is filtered by org. */
export async function getDashboardSnapshot(orgId: string, isInternal: boolean): Promise<DashboardSnapshot> {
  const projects = await db
    .select({ project: schema.projects, customerName: schema.customers.name })
    .from(schema.projects)
    .innerJoin(schema.customers, eq(schema.projects.customerId, schema.customers.id))
    .where(eq(schema.projects.orgId, orgId))
    .orderBy(desc(schema.projects.updatedAt));
  const tasks = await db.query.tasks.findMany({ where: eq(schema.tasks.orgId, orgId) });
  const milestones = await db.query.milestones.findMany({ where: eq(schema.milestones.orgId, orgId) });
  const plans = await db.query.plans.findMany({ where: eq(schema.plans.orgId, orgId) });
  const approvals = await db.query.approvals.findMany({ where: eq(schema.approvals.orgId, orgId) });
  const jobs = await db.query.jobs.findMany({ where: eq(schema.jobs.orgId, orgId) });
  const aiRuns = await db.query.aiRuns.findMany({ where: eq(schema.aiRuns.orgId, orgId) });
  const aiCalls = await db.query.aiCalls.findMany({ where: eq(schema.aiCalls.orgId, orgId) });
  const aiEvaluations = await db.query.aiRunEvaluations.findMany({ where: eq(schema.aiRunEvaluations.orgId, orgId) });
  approvals.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  jobs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  aiRuns.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const delivery = isInternal ? await getDeliveryRisks(orgId) : { risks: [], counts: { breached: 0, atRisk: 0 } };
  const projectNames = new Map(projects.map(({ project, customerName }) => [project.id, { name: project.name, customerName }]));
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const updateRows = await db.query.customerUpdates.findMany({ where: eq(schema.customerUpdates.orgId, orgId), columns: { id: true, title: true } });
  const updateById = new Map(updateRows.map((update) => [update.id, update.title]));
  const now = new Date();

  const projectHealth = projects.map(({ project, customerName }) => {
    const projectTasks = tasks.filter((task) => task.projectId === project.id);
    const progress = calculateCompletion(projectTasks);
    const nextMilestone = milestones
      .filter((milestone) => milestone.projectId === project.id && milestone.status !== "complete")
      .sort((a, b) => a.sortOrder - b.sortOrder)[0]?.name ?? null;
    const risk = projectRisk(delivery.risks, project.id);
    const projectPlans = plans.filter((plan) => plan.projectId === project.id).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const latestPlan = projectPlans[0];
    const blocked = projectTasks.some((task) => task.status === "blocked");
    let nextAction = "Review project overview";
    let nextActionHref = `/projects/${project.id}`;
    if (!latestPlan) {
      nextAction = "Generate implementation plan";
      nextActionHref = `/projects/${project.id}/requirements`;
    } else if (latestPlan.status === "pending_approval") {
      nextAction = "Review pending plan";
      nextActionHref = "/approvals";
    } else if (blocked) {
      nextAction = "Resolve blocked task";
      nextActionHref = `/projects/${project.id}/board`;
    } else if (progress.total > 0 && progress.percent < 100) {
      nextAction = "Open delivery board";
      nextActionHref = `/projects/${project.id}/board`;
    }
    return {
      id: project.id,
      name: project.name,
      customerName,
      status: project.status,
      targetDate: project.targetDate,
      targetLabel: project.targetDate ? project.targetDate.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "No target",
      completedTasks: progress.completed,
      totalTasks: progress.total,
      completionPercent: progress.percent,
      nextMilestone,
      risk: risk?.level ?? "on_track",
      signals: risk?.signals.map((signal) => signal.label) ?? [],
      nextAction,
      nextActionHref,
    } satisfies DashboardProjectHealth;
  });

  const pendingApprovals = approvals.filter((approval) => approval.status === "pending");
  const approvalItems: DashboardApproval[] = pendingApprovals.slice(0, 8).map((approval) => {
    const project = approval.projectId ? projectNames.get(approval.projectId) : undefined;
    const subject = approval.subjectType === "plan" ? planById.get(approval.subjectId)?.summary : updateById.get(approval.subjectId);
    return {
      id: approval.id,
      projectId: approval.projectId,
      projectName: project?.name ?? "Organization-wide",
      subjectType: approval.subjectType,
      title: subject?.split(".")[0] ?? `${statusLabel(approval.subjectType)} review`,
      ageLabel: formatAge(approval.createdAt, now),
      createdAt: approval.createdAt,
      href: "/approvals",
    };
  });
  const blockedTasks = tasks.filter((task) => task.status === "blocked").sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime()).slice(0, 6).map((task) => ({
    id: task.id,
    title: task.title,
    projectName: projectNames.get(task.projectId)?.name ?? "Project",
    updatedAt: task.updatedAt,
    href: `/projects/${task.projectId}/board`,
  }));
  const failedJobs = jobs.filter((job) => ["failed", "dead_letter"].includes(job.status)).slice(0, 6).map((job) => ({
    id: job.id,
    type: statusLabel(job.type),
    projectName: job.projectId ? projectNames.get(job.projectId)?.name ?? "Project" : "Organization",
    status: job.status,
    attempts: job.attempts,
    href: "/ops",
  }));

  const kpis: DashboardKpi[] = [
    { id: "projects", label: "Active projects", value: projectHealth.filter((project) => ["discovery", "planning", "in_delivery"].includes(project.status)).length, context: `${delivery.counts.breached} breached · ${delivery.counts.atRisk} at risk`, href: "/projects", tone: delivery.counts.breached ? "rose" : "cyan" },
    { id: "approvals", label: "Pending approvals", value: pendingApprovals.length, context: pendingApprovals.length ? `${approvalItems[0]?.ageLabel ?? "Needs review"}` : "Queue is clear", href: "/approvals", tone: pendingApprovals.length ? "amber" : "emerald" },
    { id: "tasks", label: "Open tasks", value: tasks.filter((task) => task.status !== "done").length, context: `${blockedTasks.length} blocked · ${tasks.filter((task) => task.status === "in_review").length} in review`, href: "/projects", tone: blockedTasks.length ? "rose" : "cyan" },
    { id: "jobs", label: "Failed jobs", value: failedJobs.length, context: failedJobs.some((job) => job.status === "dead_letter") ? "Dead-letter recovery available" : "No dead letters", href: "/ops", tone: failedJobs.length ? "rose" : "emerald" },
  ];

  const planRunRows: AiRunRow[] = aiRuns.map((run) => ({ artifactType: run.artifactType, status: run.status, finalOutcome: run.finalOutcome, costUsd: run.costUsd, latencyMs: run.latencyMs }));
  const callRows: AiCallRow[] = aiCalls.map((call) => ({ operation: call.operation, outcome: call.outcome }));
  const aiQuality = computeAiQuality({ runs: planRunRows, calls: callRows, approvedPlanCount: plans.filter((plan) => ["approved", "superseded"].includes(plan.status)).length });
  const latestPlanRun = aiRuns.find((run) => run.artifactType === "plan");
  const planRunIds = new Set(aiRuns.filter((run) => run.artifactType === "plan").map((run) => run.id));
  const evaluationByRun = new Map<string, typeof aiEvaluations>();
  for (const evaluation of aiEvaluations) {
    if (!planRunIds.has(evaluation.aiRunId)) continue;
    const rows = evaluationByRun.get(evaluation.aiRunId) ?? [];
    rows.push(evaluation);
    evaluationByRun.set(evaluation.aiRunId, rows);
  }
  const evaluatedRuns = [...evaluationByRun.values()];
  const hardGatePasses = evaluatedRuns.filter((rows) => rows.filter((row) => row.gateLevel === "hard_gate").every((row) => row.passed));
  const aiProof: DashboardAiProof | null = isInternal ? {
    planRuns: aiQuality.runCount,
    successfulRuns: aiQuality.succeeded,
    firstPassValidityRate: aiQuality.firstAttemptValidityRate,
    repairRescueRate: aiQuality.repairRescueRate,
    costPerPlanUsd: aiQuality.costPerPlanUsd,
    p50LatencyMs: aiQuality.p50LatencyMs,
    p95LatencyMs: aiQuality.p95LatencyMs,
    evaluatedRuns: evaluatedRuns.length,
    hardGatePassRate: evaluatedRuns.length ? Math.round((hardGatePasses.length / evaluatedRuns.length) * 100) : null,
    latestOutcome: latestPlanRun?.finalOutcome ?? null,
    latestAt: latestPlanRun?.createdAt ?? null,
    href: "/ai-runs",
  } : null;

  const actionQueue: DashboardQueueItem[] = [];
  for (const risk of delivery.risks.slice(0, 3)) actionQueue.push({ id: `risk-${risk.projectId}`, kind: "risk", title: risk.projectName, detail: risk.signals[0] ? `Risk signal · ${risk.signals[0].label}` : "Delivery risk needs review", href: `/projects/${risk.projectId}`, tone: risk.level === "breached" ? "rose" : "amber" });
  for (const approval of approvalItems.slice(0, 3)) actionQueue.push({ id: `approval-${approval.id}`, kind: "approval", title: approval.title, detail: `${approval.projectName} · ${approval.ageLabel}`, href: approval.href, tone: "amber" });
  for (const task of blockedTasks.slice(0, 2)) actionQueue.push({ id: `task-${task.id}`, kind: "blocked_task", title: task.title, detail: `${task.projectName} · blocked`, href: task.href, tone: "rose" });
  for (const job of failedJobs.slice(0, 2)) actionQueue.push({ id: `job-${job.id}`, kind: "failed_job", title: `${job.type} ${job.status.replace("_", " ")}`, detail: `${job.projectName} · ${job.attempts} attempts`, href: job.href, tone: "rose" });

  const activityRows = isInternal ? await db
    .select({ event: schema.auditEvents, actorName: schema.users.name })
    .from(schema.auditEvents)
    .leftJoin(schema.users, eq(schema.auditEvents.actorId, schema.users.id))
    .where(eq(schema.auditEvents.orgId, orgId))
    .orderBy(desc(schema.auditEvents.createdAt))
    .limit(8) : [];

  return {
    isInternal,
    kpis: isInternal ? kpis : [{ id: "projects", label: "Projects", value: projectHealth.length, context: "Your implementation portfolio", href: "/projects", tone: "cyan" }],
    projects: projectHealth,
    taskBreakdown: buildTaskBreakdown(tasks),
    approvals: isInternal ? approvalItems : [],
    blockedTasks: isInternal ? blockedTasks : [],
    failedJobs: isInternal ? failedJobs : [],
    aiProof,
    actionQueue: isInternal ? actionQueue.slice(0, 8) : [],
    activity: activityRows.map(({ event, actorName }) => ({ id: event.id, action: event.action.replace(/[._]/g, " "), actor: actorName ?? "System", createdAt: event.createdAt, projectId: event.projectId })),
    delivery,
    riskCounts: delivery.counts,
  };
}
