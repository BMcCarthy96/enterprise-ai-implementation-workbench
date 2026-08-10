import { describe, expect, it } from "vitest";
import { buildRoleTourSteps, safeDemoReturnPath, type DemoScenarioRefs } from "@/lib/tour";

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
  it("builds the full recruiter path from stable scenario references", () => {
    const steps = buildRoleTourSteps("implementation_manager", refs);
    expect(steps.map((step) => step.id)).toEqual([
      "portfolio-health", "grounded-plan", "repaired-ai-trace", "claims-approval",
      "live-generation", "generated-board", "dead-letter-recovery", "customer-update",
    ]);
    expect(steps.find((step) => step.id === "repaired-ai-trace")?.href).toBe("/ai-runs/ai-run");
    expect(steps.every((step) => step.href.startsWith("/"))).toBe(true);
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
