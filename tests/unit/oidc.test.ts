import { describe, expect, it } from "vitest";
import { mappedRoleFromClaims } from "@/server/services/oidc";

describe("mappedRoleFromClaims", () => {
  const mappings = {
    "workbench-admins": "org_admin",
    "delivery-managers": "implementation_manager",
  } as const;

  it("maps a provider group to a Workbench role", () => {
    expect(mappedRoleFromClaims(mappings, { groups: ["delivery-managers"] })).toBe("implementation_manager");
  });

  it("leaves the existing role unchanged when no group matches", () => {
    expect(mappedRoleFromClaims(mappings, { groups: ["read-only"] })).toBeNull();
    expect(mappedRoleFromClaims(mappings, {})).toBeNull();
  });

  it("rejects ambiguous claims instead of choosing a privileged role", () => {
    expect(() => mappedRoleFromClaims(mappings, { groups: ["workbench-admins", "delivery-managers"] })).toThrow(/ambiguous/i);
  });
});
