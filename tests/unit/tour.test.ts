import { describe, expect, it } from "vitest";
import {
  DEMO_PERSONA_OPTIONS,
  TOUR_TARGETS,
  buildRoleTourSteps,
  checkpointTourStepId,
  completeTourStep,
  entityTourTarget,
  reconcileTourStepId,
  restartTourProgress,
  safeDemoReturnPath,
  type DemoScenarioRefs,
} from "@/lib/tour";

const refs: DemoScenarioRefs = {
  personaUserIds: {
    org_admin: "admin-user",
    implementation_manager: "manager-user",
    solutions_engineer: "engineer-user",
    customer_stakeholder: "customer-user",
  },
  projectIds: { orderIntake: "order", claimsStatus: "claims", patientOnboarding: "onboarding" },
  planIds: { approved: "approved-plan", pending: "pending-plan" },
  aiRunId: "ai-run",
  approvalIds: { approvedPlan: "approved-approval", pendingPlan: "pending-approval", pendingUpdate: "update-approval" },
  jobIds: { deadLetter: "dead-letter" },
  updateIds: { published: "published", pending: "pending-update" },
};

describe("role-aware product tour", () => {
  it("builds the full demo path from stable scenario references", () => {
    const steps = buildRoleTourSteps("implementation_manager", refs);
    expect(steps.map((step) => step.id)).toEqual([
      "portfolio-health", "grounded-plan", "repaired-ai-trace", "claims-approval",
      "live-generation", "generated-board", "dead-letter-recovery", "customer-update",
    ]);
    expect(steps.find((step) => step.id === "repaired-ai-trace")?.href).toBe("/ai-runs/ai-run");
    expect(steps.find((step) => step.id === "claims-approval")?.target).toMatchObject({
      id: "approval-pending-approval",
      fallbackId: TOUR_TARGETS.approvalsQueue,
    });
    expect(steps.find((step) => step.id === "dead-letter-recovery")?.target).toMatchObject({
      id: "job-dead-letter",
      fallbackId: TOUR_TARGETS.operationsJobs,
    });
    expect(steps.find((step) => step.id === "customer-update")?.target.id).toBe("update-published");
    expect(steps.find((step) => step.id === "live-generation")).toMatchObject({
      href: "/projects/onboarding/plan",
      cta: "Generate the plan",
      target: { id: TOUR_TARGETS.projectPlanGenerate },
    });
    expect(steps.every((step) => step.href.startsWith("/"))).toBe(true);
  });

  it("keeps semantic target ids unique and constructs seeded ids predictably", () => {
    const targetIds = Object.values(TOUR_TARGETS);
    expect(new Set(targetIds).size).toBe(targetIds.length);
    expect(entityTourTarget("approval", "abc-123")).toBe("approval-abc-123");
    expect(entityTourTarget("job", "abc-123")).toBe("job-abc-123");
    expect(entityTourTarget("update", "abc-123")).toBe("update-abc-123");
    for (const role of ["org_admin", "implementation_manager", "solutions_engineer", "customer_stakeholder"] as const) {
      const steps = buildRoleTourSteps(role, refs);
      expect(steps.every((tourStep) => Boolean(tourStep.target.id))).toBe(true);
      expect(new Set(steps.map((tourStep) => tourStep.id)).size).toBe(steps.length);
    }
  });

  it("keeps the walkthrough copy short and conversational", () => {
    const roles = ["org_admin", "implementation_manager", "solutions_engineer", "customer_stakeholder"] as const;
    const descriptions = [
      ...DEMO_PERSONA_OPTIONS.map((persona) => persona.focus),
      ...roles.flatMap((role) => buildRoleTourSteps(role, refs).flatMap((tourStep) => [tourStep.purpose, tourStep.evidence])),
      ...buildRoleTourSteps("implementation_manager").flatMap((tourStep) => [tourStep.purpose, tourStep.evidence]),
    ];

    for (const description of descriptions) {
      expect(description).not.toMatch(/\brecruiter\b|—|\binstead of\b|\bnot only\b|\bbut also\b/i);
      expect(description).not.toMatch(/\bat-a-glance\b|\bdelivery posture\b|\bhuman-governed\b|\bclose the loop\b|\boperational path\b|\bimplementation boundary\b/i);
      expect(description.length).toBeLessThanOrEqual(160);
      expect((description.match(/,/g) ?? []).length).toBeLessThanOrEqual(1);
    }
  });

  it("resolves checkpoints and reconciles a persona to its current permitted route", () => {
    const adminSteps = buildRoleTourSteps("org_admin", refs);
    expect(checkpointTourStepId("ai-evidence")).toBe("repaired-ai-trace");
    expect(checkpointTourStepId("approval-gate")).toBe("claims-approval");
    expect(checkpointTourStepId("delivery-board")).toBe("generated-board");
    expect(checkpointTourStepId("platform-security")).toBe("members");
    expect(checkpointTourStepId("unknown")).toBeNull();
    expect(reconcileTourStepId(adminSteps, "/ops")).toBe("operations");
    expect(reconcileTourStepId(adminSteps, "/projects/order/plan")).toBe("portfolio-health");
  });

  it("only records completion explicitly and restart clears client progress", () => {
    const steps = buildRoleTourSteps("implementation_manager", refs);
    const initial = restartTourProgress("test-version", steps);
    expect(initial).toMatchObject({
      completedStepIds: [],
      lastStepId: "portfolio-health",
      autoOpened: true,
    });
    const completed = completeTourStep(initial, "portfolio-health");
    expect(completed.completedStepIds).toEqual(["portfolio-health"]);
    expect(completeTourStep(completed, "portfolio-health").completedStepIds).toEqual(["portfolio-health"]);
    expect(restartTourProgress("test-version", steps).completedStepIds).toEqual([]);
  });

  it("keeps customer and engineer tours inside their normal navigation", () => {
    const customer = buildRoleTourSteps("customer_stakeholder", refs);
    const engineer = buildRoleTourSteps("solutions_engineer", refs);
    expect(customer.map((step) => step.href)).toEqual([
      "/projects/order", "/projects/order/timeline", "/projects/order/updates",
    ]);
    expect(engineer.some((step) => step.href === "/approvals")).toBe(false);
    expect(engineer.every((step) => step.href.startsWith("/projects/") || step.href === "/ops")).toBe(true);
  });

  it("falls back to route-only paths when legacy demo refs are missing", () => {
    const steps = buildRoleTourSteps("implementation_manager");
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every((step) => step.href.startsWith("/"))).toBe(true);
    expect(steps.some((step) => step.href === "/dashboard")).toBe(true);
  });

  it("keeps persona switches inside role-compatible paths", () => {
    expect(safeDemoReturnPath("customer_stakeholder", "/projects/abc/updates?tab=latest")).toBe("/projects/abc/updates");
    expect(safeDemoReturnPath("customer_stakeholder", "/projects/abc/board")).toBe("/dashboard");
    expect(safeDemoReturnPath("solutions_engineer", "/ai-runs/run")).toBe("/dashboard");
    expect(safeDemoReturnPath("org_admin", "https://evil.example/steal")).toBe("/dashboard");
    expect(safeDemoReturnPath("implementation_manager", "/projects/abc/plan?version=2")).toBe("/projects/abc/plan");
  });
});
