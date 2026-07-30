import { describe, expect, it } from "vitest";
import {
  summarizeBulkDecision,
  wantsRegeneration,
  type BulkDecisionResult,
} from "@/server/services/approvals";
import { BulkApprovalDecisionSchema } from "@/lib/apiSchemas";

const result = (over: Partial<BulkDecisionResult> = {}): BulkDecisionResult => ({
  succeeded: [],
  failed: [],
  regenerationJobCount: 0,
  ...over,
});

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

describe("summarizeBulkDecision", () => {
  it("reports a clean approval run", () => {
    expect(
      summarizeBulkDecision(
        result({ succeeded: [{ approvalId: "a" }, { approvalId: "b" }] }),
        "approved",
      ),
    ).toBe("Approved 2");
  });

  it("surfaces partial failures rather than hiding them", () => {
    expect(
      summarizeBulkDecision(
        result({
          succeeded: [{ approvalId: "a" }],
          failed: [{ approvalId: "b", status: 409, message: "already approved" }],
        }),
        "approved",
      ),
    ).toBe("Approved 1 · 1 failed");
  });

  it("counts queued regenerations on a rejection run, pluralized", () => {
    expect(
      summarizeBulkDecision(
        result({
          succeeded: [{ approvalId: "a", regenerationJobId: "j1" }],
          regenerationJobCount: 1,
        }),
        "rejected",
      ),
    ).toBe("Rejected 1 · 1 revised plan queued");
    expect(
      summarizeBulkDecision(
        result({
          succeeded: [{ approvalId: "a" }, { approvalId: "b" }],
          regenerationJobCount: 2,
        }),
        "rejected",
      ),
    ).toBe("Rejected 2 · 2 revised plans queued");
  });
});

describe("BulkApprovalDecisionSchema", () => {
  const id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

  it("accepts a well-formed bulk decision", () => {
    const parsed = BulkApprovalDecisionSchema.parse({
      approvalIds: [id],
      decision: "approved",
    });
    expect(parsed.approvalIds).toEqual([id]);
  });

  it("rejects an empty selection", () => {
    expect(() =>
      BulkApprovalDecisionSchema.parse({ approvalIds: [], decision: "approved" }),
    ).toThrow();
  });

  it("caps fan-out so one request can't queue unbounded work", () => {
    expect(() =>
      BulkApprovalDecisionSchema.parse({
        approvalIds: Array.from({ length: 51 }, () => id),
        decision: "approved",
      }),
    ).toThrow();
  });

  it("rejects non-uuid ids", () => {
    expect(() =>
      BulkApprovalDecisionSchema.parse({
        approvalIds: ["not-a-uuid"],
        decision: "approved",
      }),
    ).toThrow();
  });
});
