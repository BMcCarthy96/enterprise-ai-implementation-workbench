import { describe, expect, it } from "vitest";
import { applyScimUserPatchOperations } from "@/lib/scimPatch";

describe("SCIM user PatchOp normalization", () => {
  it("handles Okta-style pathless deprovisioning", () => {
    expect(
      applyScimUserPatchOperations({
        Operations: [{ op: "Replace", value: { active: false } }],
      }),
    ).toEqual({ active: false });
  });

  it("handles provider casing and string booleans", () => {
    expect(
      applyScimUserPatchOperations({
        Operations: [
          { op: "replace", path: "Active", value: "False" },
          { op: "ADD", path: "displayName", value: "Ada Lovelace" },
        ],
      }),
    ).toEqual({ active: false, displayName: "Ada Lovelace" });
  });

  it("treats removing active as deprovisioning", () => {
    expect(
      applyScimUserPatchOperations({
        Operations: [{ op: "Remove", path: "active" }],
      }),
    ).toEqual({ active: false });
  });

  it("clears externalId explicitly when a provider removes it", () => {
    expect(
      applyScimUserPatchOperations({
        Operations: [{ op: "Remove", path: "externalId" }],
      }),
    ).toEqual({ externalId: null });
  });

  it("fails closed when string attributes have the wrong type", () => {
    expect(() =>
      applyScimUserPatchOperations({
        Operations: [{ op: "replace", path: "displayName", value: null }],
      }),
    ).toThrow(/displayName must be a string/i);
    expect(() =>
      applyScimUserPatchOperations({
        Operations: [{ op: "replace", path: "userName", value: 42 }],
      }),
    ).toThrow(/userName must be a string/i);
    expect(() =>
      applyScimUserPatchOperations({
        Operations: [{ op: "replace", path: "externalId", value: {} }],
      }),
    ).toThrow(/externalId must be a string/i);
  });

  it("fails closed for unsupported changes", () => {
    expect(() =>
      applyScimUserPatchOperations({
        Operations: [{ op: "replace", path: "phoneNumbers", value: [] }],
      }),
    ).toThrow(/unsupported scim patch path/i);
    expect(() => applyScimUserPatchOperations({ Operations: [] })).toThrow(
      /at least one operation/i,
    );
  });
});
