import type { Role } from "@/lib/auth/rbac";

/** Bump this when the product tour's information architecture changes. */
export const TOUR_VERSION = "phase2-recruiter-2026-08";

export interface DemoPersonaOption {
  role: Role;
  label: string;
  focus: string;
}

export const DEMO_PERSONA_OPTIONS: Array<Pick<DemoPersonaOption, "role" | "label" | "focus">> = [
  { role: "implementation_manager", label: "Implementation Manager", focus: "Owns delivery, approvals, and the recruiter walkthrough" },
  { role: "solutions_engineer", label: "Solutions Engineer", focus: "Builds requirements, plans, documents, and tasks" },
  { role: "customer_stakeholder", label: "Customer Stakeholder", focus: "Reads the customer-safe project story and updates" },
  { role: "org_admin", label: "Operations Admin", focus: "Sees organization governance, audit, and operations" },
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

export interface TourStep {
  id: string;
  title: string;
  purpose: string;
  evidence: string;
  href: string;
  cta: string;
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

function step(
  id: string,
  title: string,
  purpose: string,
  evidence: string,
  href: string,
  cta: string,
): TourStep {
  return { id, title, purpose, evidence, href, cta };
}

/**
 * Pure role-aware tour definition. Keep every destination inside the normal
 * application navigation so the tour remains useful for authenticated tenants
 * and cannot introduce a route a persona cannot already reach.
 */
export function buildRoleTourSteps(
  role: Role,
  refs?: DemoScenarioRefs | null,
): TourStep[] {
  if (refs && role === "implementation_manager") {
    return [
      step("portfolio-health", "Portfolio health", "Start with the delivery signal a recruiter can understand in seconds.", "Three active projects, a visible blocked-task risk, and a pending approval queue.", "/dashboard", "Review dashboard"),
      step("grounded-plan", "Grounded implementation plan", "Show how requirements become an executable plan with source grounding.", "Order Intake Automation has an approved plan with a linked implementation brief citation.", `/projects/${refs.projectIds.orderIntake}/plan`, "Open grounded plan"),
      step("repaired-ai-trace", "Repaired AI evidence", "Make quality observable instead of treating model output as a black box.", "The packet records an invalid first pass, a repair call, normalized checks, latency, cost, and approval context.", `/ai-runs/${refs.aiRunId}`, "Inspect AI evidence"),
      step("claims-approval", "Human approval gate", "Demonstrate that delivery remains human-governed before work starts.", "Claims Status Tracker is waiting for manager approval before task materialization.", "/approvals", "Review approval queue"),
      step("live-generation", "Live plan generation", "Turn a real requirement set into a plan during the conversation.", "Patient Onboarding Portal is intentionally seeded without a plan so generation is visible.", `/projects/${refs.projectIds.patientOnboarding}/requirements`, "Open requirements"),
      step("generated-board", "Generated delivery board", "Close the loop from approved plan to assignable work.", "After approval, milestone tasks appear on the project board and become trackable.", `/projects/${refs.projectIds.patientOnboarding}/board`, "Open delivery board"),
      step("dead-letter-recovery", "Dead-letter recovery", "Show the operational path when an automated job exhausts its retries.", "A customer-update job is parked with its retry history and a manual recovery action.", "/ops", "Open operations"),
      step("customer-update", "Customer-ready update", "End with an approval-aware update that is safe to share externally.", "A published update and a pending UAT-readiness update make the communication gate visible.", `/projects/${refs.projectIds.orderIntake}/updates`, "View customer updates"),
    ];
  }

  switch (role) {
    case "org_admin":
      return [
        step("portfolio-health", "Portfolio health", "See the organization-wide delivery posture.", "KPI context, risk signals, and project stages are summarized without invented trends.", "/dashboard", "Review dashboard"),
        step("members", "Team access", "Verify who can act on delivery data.", "Role labels and least-privilege membership controls are visible.", "/settings/members", "Review members"),
        step("audit", "Audit trail", "Prove important changes are attributable.", "Actor, action, subject, and timestamp are available for review.", "/audit", "Open audit log"),
        step("operations", "Operations", "Close the loop on background work.", "Failed and dead-letter jobs can be inspected and recovered.", "/ops", "Open operations"),
      ];
    case "implementation_manager":
      return [
        step("portfolio-health", "Delivery risk", "Prioritize the work that needs attention.", "Blocked work, target dates, and approval aging are visible together.", "/dashboard", "Review dashboard"),
        step("approvals", "Approval queue", "Keep human decisions in the delivery loop.", "Pending plans and customer updates have clear next actions.", "/approvals", "Review approvals"),
        step("ai-quality", "AI evidence", "Make model behavior reviewable.", "Validity, repair rescue, latency, cost, and normalized checks are measurable.", "/ai-runs", "Inspect AI evidence"),
        step("audit", "Audit trail", "Trace who changed what and when.", "Delivery and governance events are searchable by subject.", "/audit", "Open audit log"),
        step("operations", "Operations", "Recover safely from failed automation.", "Retry and dead-letter states are visible to the delivery owner.", "/ops", "Open operations"),
      ];
    case "solutions_engineer": {
      const projectId = refs?.projectIds.patientOnboarding;
      return [
        step("requirements", "Requirements", "Start from validated business needs.", "Requirement status and priority provide the implementation boundary.", projectId ? `/projects/${projectId}/requirements` : "/projects", "Review requirements"),
        step("documents", "Source documents", "Keep implementation work grounded in evidence.", "Uploaded briefs and processed document chunks can be traced to plan citations.", refs ? `/projects/${refs.projectIds.orderIntake}/documents` : "/projects", "Open source documents"),
        step("plan-generation", "Plan generation", "Turn requirements into structured delivery work.", "Plans are schema-validated before they enter the approval workflow.", projectId ? `/projects/${projectId}/plan` : "/projects", "Open plan workspace"),
        step("task-board", "Task board", "Make the plan executable for the build team.", "Milestones, owners, priority, and blocked status are visible in one board.", projectId ? `/projects/${projectId}/board` : "/projects", "Open task board"),
        step("job-status", "Job status", "Know what automation is doing in the background.", "Queued, retrying, succeeded, and dead-letter jobs have operational context.", "/ops", "Open job status"),
      ];
    }
    case "customer_stakeholder": {
      const projectId = refs?.projectIds.orderIntake;
      const base = projectId ? `/projects/${projectId}` : "/projects";
      return [
        step("project-overview", "Project overview", "Get the current implementation context.", "Scope, customer, stage, and next milestone are presented in plain language.", base, "Open project overview"),
        step("timeline", "Timeline", "Understand progress without internal implementation noise.", "Milestones and recent delivery events are sequenced by date.", projectId ? `${base}/timeline` : "/projects", "View timeline"),
        step("updates", "Published updates", "Read the latest customer-safe status.", "Only approved and published updates are exposed to the customer role.", projectId ? `${base}/updates` : "/projects", "View updates"),
      ];
    }
  }
}

/**
 * Return a safe, role-compatible application path after an isolated demo
 * persona switch. Query strings and absolute URLs are intentionally discarded
 * so a recruiter-controlled path can never become an open redirect.
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
