import type { Role } from "@/lib/auth/rbac";

/** Bump this when the product tour's information architecture changes. */
export const TOUR_VERSION = "phase3-coachmarks-2026-08";

export interface DemoPersonaOption {
  role: Role;
  label: string;
  focus: string;
}

export const DEMO_PERSONA_OPTIONS: Array<Pick<DemoPersonaOption, "role" | "label" | "focus">> = [
  { role: "implementation_manager", label: "Implementation Manager", focus: "Reviews delivery work and makes approval decisions" },
  { role: "solutions_engineer", label: "Solutions Engineer", focus: "Builds plans from the requirements and source documents" },
  { role: "customer_stakeholder", label: "Customer Stakeholder", focus: "Checks progress and reads updates prepared for the customer" },
  { role: "org_admin", label: "Operations Admin", focus: "Manages access and keeps an eye on jobs and audit history" },
];

/** Stable references captured while provisioning an isolated demo workspace. */
export interface DemoScenarioRefs {
  personaUserIds: Record<Role, string>;
  projectIds: {
    orderIntake: string;
    claimsStatus: string;
    patientOnboarding: string;
  };
  planIds: {
    approved: string;
    pending: string;
  };
  aiRunId: string;
  approvalIds: {
    approvedPlan: string;
    pendingPlan: string;
    pendingUpdate: string;
  };
  jobIds: {
    deadLetter: string;
  };
  updateIds: {
    published: string;
    pending: string;
  };
}

export type TourPlacement = "top" | "right" | "bottom" | "left";

export interface TourTarget {
  /** Semantic DOM anchor id rendered through data-tour-target. */
  id: string;
  /** Stable surface-level anchor used when seeded data has changed. */
  fallbackId?: string;
  placement?: TourPlacement;
}

export const TOUR_TARGETS = {
  dashboardPortfolio: "dashboard-portfolio-health",
  dashboardDeliveryRisk: "dashboard-delivery-risk",
  projectOverview: "project-overview",
  projectRequirements: "project-requirements",
  projectDocuments: "project-documents",
  projectPlan: "project-plan",
  projectPlanCitations: "project-plan-citations",
  projectPlanGenerate: "project-plan-generate",
  projectBoard: "project-delivery-board",
  projectTimeline: "project-timeline",
  projectUpdates: "project-updates",
  aiEvidenceList: "ai-evidence-list",
  aiEvidenceFlow: "ai-evidence-flow",
  approvalsQueue: "approvals-queue",
  membersAccess: "members-access",
  auditLog: "audit-log",
  operationsJobs: "operations-jobs",
  projectsList: "projects-list",
} as const;

export type TourEntity = "approval" | "job" | "update";

export function entityTourTarget(entity: TourEntity, id: string): string {
  return `${entity}-${id}`;
}

export interface TourStep {
  id: string;
  title: string;
  purpose: string;
  evidence: string;
  href: string;
  cta: string;
  target: TourTarget;
  /** The server can mark workflow-dependent steps complete as data changes. */
  complete?: boolean;
}

export interface TourManifest {
  version: string;
  role: Role;
  isDemo: boolean;
  workspaceId?: string;
  demoPersonas?: DemoPersonaOption[];
  steps: TourStep[];
}

export interface TourProgress {
  version: string;
  completedStepIds: string[];
  lastStepId?: string;
  dismissed?: boolean;
  autoOpened?: boolean;
}

export function sameTourPath(pathname: string, href: string): boolean {
  const normalize = (value: string) =>
    value.length > 1 ? value.replace(/\/$/, "") : value;
  return normalize(pathname) === normalize(href);
}

export function checkpointTourStepId(checkpoint: string | null): string | null {
  if (!checkpoint) return null;
  const checkpoints: Record<string, string> = {
    "portfolio-health": "portfolio-health",
    "ai-evidence": "repaired-ai-trace",
    "approval-gate": "claims-approval",
    "delivery-board": "generated-board",
    "platform-security": "members",
    "role-switching": "portfolio-health",
    "dlq-recovery": "dead-letter-recovery",
  };
  return checkpoints[checkpoint] ?? null;
}

export function reconcileTourStepId(
  steps: TourStep[],
  pathname: string,
): string | undefined {
  return steps.find((candidate) => sameTourPath(pathname, candidate.href))?.id
    ?? steps[0]?.id;
}

export function restartTourProgress(
  version: string,
  steps: TourStep[],
): TourProgress {
  return {
    version,
    completedStepIds: [],
    autoOpened: true,
    lastStepId: steps[0]?.id,
  };
}

export function completeTourStep(
  progress: TourProgress,
  stepId: string,
): TourProgress {
  return {
    ...progress,
    completedStepIds: Array.from(
      new Set([...progress.completedStepIds, stepId]),
    ),
  };
}

function step(
  id: string,
  title: string,
  purpose: string,
  evidence: string,
  href: string,
  cta: string,
  target: TourTarget,
): TourStep {
  return { id, title, purpose, evidence, href, cta, target };
}

function anchor(
  id: string,
  placement: TourPlacement = "bottom",
  fallbackId?: string,
): TourTarget {
  return { id, placement, ...(fallbackId ? { fallbackId } : {}) };
}

/**
 * Pure role-aware tour definition. Keep every destination inside the normal
 * application navigation so the tour remains useful for authenticated tenants
 * and cannot introduce a route a persona cannot already reach. Keep the copy
 * short, conversational, and free of audience references or sales language.
 */
export function buildRoleTourSteps(
  role: Role,
  refs?: DemoScenarioRefs | null,
): TourStep[] {
  if (refs && role === "implementation_manager") {
    return [
      step("portfolio-health", "Portfolio health", "Start on the dashboard. It shows what needs attention right now.", "There are three active projects. One has a blocked task, and two items are waiting for approval.", "/dashboard", "Review dashboard", anchor(TOUR_TARGETS.dashboardPortfolio, "bottom")),
      step("grounded-plan", "Plan and source", "Open the approved plan and trace its work back to the source brief.", "The Order Intake plan includes a link to the brief that supports it.", `/projects/${refs.projectIds.orderIntake}/plan`, "Open the plan", anchor(TOUR_TARGETS.projectPlanCitations, "top", TOUR_TARGETS.projectPlan)),
      step("repaired-ai-trace", "AI run details", "Open the run to see why the first response failed.", "The first response failed validation, then passed after one repair. Timing and cost are shown with the run.", `/ai-runs/${refs.aiRunId}`, "Open the AI run", anchor(TOUR_TARGETS.aiEvidenceFlow, "bottom", TOUR_TARGETS.aiEvidenceList)),
      step("claims-approval", "Plan approval", "Open the request that is holding the Claims Status plan.", "A manager still needs to approve this plan. Its tasks appear on the board after that decision.", "/approvals", "Open the approval", anchor(entityTourTarget("approval", refs.approvalIds.pendingPlan), "top", TOUR_TARGETS.approvalsQueue)),
      step("live-generation", "Generate a plan", "Create a plan from the Patient Onboarding requirements.", "This project starts with requirements and no plan. Use the button on this page to create one.", `/projects/${refs.projectIds.patientOnboarding}/plan`, "Generate the plan", anchor(TOUR_TARGETS.projectPlanGenerate, "bottom", TOUR_TARGETS.projectPlan)),
      step("generated-board", "New board tasks", "Open the board after the plan has been approved.", "The plan adds its milestone tasks to this board. Each task can be assigned and tracked here.", `/projects/${refs.projectIds.patientOnboarding}/board`, "Open the board", anchor(TOUR_TARGETS.projectBoard, "top")),
      step("dead-letter-recovery", "Failed job recovery", "Open the customer update job that stopped after three tries.", "Its history is on the same row as the retry button.", "/ops", "Open the failed job", anchor(entityTourTarget("job", refs.jobIds.deadLetter), "left", TOUR_TARGETS.operationsJobs)),
      step("customer-update", "Customer update", "Open the update that a customer can read.", "One update has been published. The UAT update is still waiting for approval.", `/projects/${refs.projectIds.orderIntake}/updates`, "Open the update", anchor(entityTourTarget("update", refs.updateIds.published), "top", TOUR_TARGETS.projectUpdates)),
    ];
  }

  switch (role) {
    case "org_admin":
      return [
        step("portfolio-health", "Portfolio health", "Start with the work that may need attention.", "The dashboard shows project status and current risks. It uses the data available in this workspace.", "/dashboard", "Open the dashboard", anchor(TOUR_TARGETS.dashboardPortfolio, "bottom")),
        step("members", "Team access", "Open the member list and check who can use the workspace.", "Each person has a role that controls what they can see and change.", "/settings/members", "Open the member list", anchor(TOUR_TARGETS.membersAccess, "bottom")),
        step("audit", "Audit history", "Open the history for a recent change.", "Each entry names the person or service that made the change. It also shows when it happened.", "/audit", "Open the audit history", anchor(TOUR_TARGETS.auditLog, "top")),
        step("operations", "Background jobs", "Check what happened to a failed job.", "You can read its attempts and start a retry from this page.", "/ops", "Open the jobs page", anchor(TOUR_TARGETS.operationsJobs, "top")),
      ];
    case "implementation_manager":
      return [
        step("portfolio-health", "Delivery risk", "Start with the projects that need attention.", "The dashboard shows a blocked task and work nearing its target date. It also shows how long approvals have been waiting.", "/dashboard", "Open the dashboard", anchor(TOUR_TARGETS.dashboardDeliveryRisk, "right", TOUR_TARGETS.dashboardPortfolio)),
        step("approvals", "Approval queue", "Open the next decision waiting for you.", "Plans and customer updates stay here until someone reviews them.", "/approvals", "Open the approvals", anchor(TOUR_TARGETS.approvalsQueue, "top")),
        step("ai-quality", "AI runs", "Open a recent run and check how it behaved.", "You can see whether it passed validation. Timing and recorded cost are shown with the run.", "/ai-runs", "Open the AI runs", anchor(TOUR_TARGETS.aiEvidenceList, "bottom")),
        step("audit", "Audit history", "Look up a recent change.", "Search by project or person to see who made it and when.", "/audit", "Open the audit history", anchor(TOUR_TARGETS.auditLog, "top")),
        step("operations", "Failed jobs", "Open a failed job and review its attempts.", "If the job can be retried, the action is available on the same page.", "/ops", "Open the jobs page", anchor(TOUR_TARGETS.operationsJobs, "top")),
      ];
    case "solutions_engineer": {
      const projectId = refs?.projectIds.patientOnboarding;
      return [
        step("requirements", "Requirements", "Read the requirements before you build the plan.", "Each requirement shows its priority and current status.", projectId ? `/projects/${projectId}/requirements` : "/projects", "Open the requirements", anchor(projectId ? TOUR_TARGETS.projectRequirements : TOUR_TARGETS.projectsList, "right")),
        step("documents", "Source documents", "Open the brief that the plan uses as a source.", "The document is processed into sections that the plan can cite.", refs ? `/projects/${refs.projectIds.orderIntake}/documents` : "/projects", "Open the source document", anchor(refs ? TOUR_TARGETS.projectDocuments : TOUR_TARGETS.projectsList, "right")),
        step("plan-generation", "Generate a plan", "Create a plan from the project requirements.", "The system checks the plan format before sending it for approval.", projectId ? `/projects/${projectId}/plan` : "/projects", "Generate the plan", anchor(projectId ? TOUR_TARGETS.projectPlanGenerate : TOUR_TARGETS.projectsList, "bottom", projectId ? TOUR_TARGETS.projectPlan : undefined)),
        step("task-board", "Task board", "Open the board where the team tracks the work.", "Each card shows its owner and status. Blocked work stands out on the board.", projectId ? `/projects/${projectId}/board` : "/projects", "Open the task board", anchor(projectId ? TOUR_TARGETS.projectBoard : TOUR_TARGETS.projectsList, "top")),
        step("job-status", "Job status", "Check the job that runs plan generation in the background.", "The page shows its current state. It keeps the attempt history if something fails.", "/ops", "Open the job status", anchor(TOUR_TARGETS.operationsJobs, "top")),
      ];
    }
    case "customer_stakeholder": {
      const projectId = refs?.projectIds.orderIntake;
      const base = projectId ? `/projects/${projectId}` : "/projects";
      return [
        step("project-overview", "Project overview", "Start with the project page.", "It shows the current scope and stage. The next milestone appears below them.", base, "Open the project", anchor(projectId ? TOUR_TARGETS.projectOverview : TOUR_TARGETS.projectsList, "right")),
        step("timeline", "Timeline", "Open the timeline to see what has happened so far.", "Milestones and recent updates appear in date order.", projectId ? `${base}/timeline` : "/projects", "Open the timeline", anchor(projectId ? TOUR_TARGETS.projectTimeline : TOUR_TARGETS.projectsList, "right")),
        step("updates", "Published updates", "Read the latest update shared with the customer.", "This page only shows updates that have already been approved and published.", projectId ? `${base}/updates` : "/projects", "Open the updates", anchor(projectId ? TOUR_TARGETS.projectUpdates : TOUR_TARGETS.projectsList, "top")),
      ];
    }
  }
}

/**
 * Return a safe, role-compatible application path after an isolated demo
 * persona switch. Query strings and absolute URLs are intentionally discarded
 * so a shared checkpoint path can never become an open redirect.
 */
export function safeDemoReturnPath(role: Role, pathname: string | null | undefined): string {
  const value = typeof pathname === "string" ? pathname.split(/[?#]/, 1)[0] : "";
  if (!value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  if (value === "/" || value === "/dashboard" || value === "/projects") return value === "/" ? "/dashboard" : value;

  if (role === "customer_stakeholder") {
    return /^\/projects\/[^/]+(?:\/(?:timeline|updates))?$/.test(value)
      ? value
      : "/dashboard";
  }

  if (role === "solutions_engineer") {
    const restricted = ["/approvals", "/audit", "/insights", "/settings", "/ai-runs"];
    if (restricted.some((prefix) => value === prefix || value.startsWith(`${prefix}/`))) {
      return "/dashboard";
    }
  }

  if (role === "implementation_manager") {
    // Managers can see every internal destination represented by the demo.
    return value;
  }

  return value;
}
