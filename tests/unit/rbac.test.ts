import { describe, expect, it } from "vitest";
import {
  can,
  permissionsFor,
  PERMISSIONS,
  ROLES,
} from "@/lib/auth/rbac";

describe("RBAC matrix", () => {
  it("gives customer stakeholders no internal permissions at all", () => {
    expect(permissionsFor("customer_stakeholder")).toHaveLength(0);
    for (const p of PERMISSIONS) {
      expect(can("customer_stakeholder", p)).toBe(false);
    }
  });

  it("only lets org admins manage members", () => {
    expect(can("org_admin", "org.manage_members")).toBe(true);
    expect(can("implementation_manager", "org.manage_members")).toBe(false);
    expect(can("solutions_engineer", "org.manage_members")).toBe(false);
    expect(can("customer_stakeholder", "org.manage_members")).toBe(false);
  });

  it("separates drafting from approving: engineers generate but never decide", () => {
    expect(can("solutions_engineer", "plans.generate")).toBe(true);
    expect(can("solutions_engineer", "updates.draft")).toBe(true);
    expect(can("solutions_engineer", "approvals.decide")).toBe(false);
    expect(can("implementation_manager", "approvals.decide")).toBe(true);
  });

  it("restricts audit history to admins and managers", () => {
    expect(can("org_admin", "audit.view")).toBe(true);
    expect(can("implementation_manager", "audit.view")).toBe(true);
    expect(can("solutions_engineer", "audit.view")).toBe(false);
  });

  it("lets engineers observe ops but not retry jobs", () => {
    expect(can("solutions_engineer", "ops.view")).toBe(true);
    expect(can("solutions_engineer", "ops.retry_jobs")).toBe(false);
    expect(can("implementation_manager", "ops.retry_jobs")).toBe(true);
  });

  it("grants org admins every defined permission", () => {
    for (const p of PERMISSIONS) {
      expect(can("org_admin", p)).toBe(true);
    }
  });

  it("only grants permissions that are actually defined", () => {
    for (const role of ROLES) {
      for (const p of permissionsFor(role)) {
        expect(PERMISSIONS).toContain(p);
      }
    }
  });
});
