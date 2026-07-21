import { describe, expect, it } from "vitest";
import { escapeLike, searchableTypesFor } from "@/server/services/search";
import { ROLES } from "@/lib/auth/rbac";

describe("searchableTypesFor", () => {
  it("lets customer stakeholders search only projects", () => {
    expect(searchableTypesFor("customer_stakeholder")).toEqual(["project"]);
  });

  it("gives internal roles projects, requirements, and customers", () => {
    for (const role of ["org_admin", "implementation_manager", "solutions_engineer"] as const) {
      expect(searchableTypesFor(role).sort()).toEqual(
        ["customer", "project", "requirement"],
      );
    }
  });

  it("never exposes customers or requirements to a non-internal role", () => {
    for (const role of ROLES) {
      const types = searchableTypesFor(role);
      // Projects are always allowed; the internal-only types must not leak to
      // any role that lacks internal.view.
      expect(types).toContain("project");
      if (role === "customer_stakeholder") {
        expect(types).not.toContain("customer");
        expect(types).not.toContain("requirement");
      }
    }
  });
});

describe("escapeLike", () => {
  it("escapes LIKE wildcards so they match literally", () => {
    expect(escapeLike("100%")).toBe("100\\%");
    expect(escapeLike("a_b")).toBe("a\\_b");
    expect(escapeLike("back\\slash")).toBe("back\\\\slash");
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeLike("Order Intake")).toBe("Order Intake");
  });
});
