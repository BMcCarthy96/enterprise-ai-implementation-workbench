import { describe, expect, it } from "vitest";
import { wantsRegeneration } from "@/server/services/approvals";

describe("wantsRegeneration", () => {
  it("triggers only on a plan rejection with the flag set", () => {
    expect(
      wantsRegeneration({ decision: "rejected", subjectType: "plan", regenerate: true }),
    ).toBe(true);
  });

  it("never triggers on approval", () => {
    expect(
      wantsRegeneration({ decision: "approved", subjectType: "plan", regenerate: true }),
    ).toBe(false);
  });

  it("never regenerates a customer update", () => {
    expect(
      wantsRegeneration({
        decision: "rejected",
        subjectType: "customer_update",
        regenerate: true,
      }),
    ).toBe(false);
  });

  it("respects the opt-out (flag off or missing)", () => {
    expect(
      wantsRegeneration({ decision: "rejected", subjectType: "plan", regenerate: false }),
    ).toBe(false);
    expect(
      wantsRegeneration({ decision: "rejected", subjectType: "plan" }),
    ).toBe(false);
  });
});
