import { describe, expect, it } from "vitest";
import {
  approvalDecisionFingerprint,
  replayDecision,
  summarizeBulkDecision,
  wantsRegeneration,
  type BulkDecisionResult,
  type DecisionInput,
} from "@/server/services/approvals";
import { BulkApprovalDecisionSchema } from "@/lib/apiSchemas";

const result = (over: Partial<BulkDecisionResult> = {}): BulkDecisionResult => ({
  succeeded: [],
  failed: [],
  regenerationJobCount: 0,
  ...over,
});

const decisionInput = (over: Partial<DecisionInput> = {}): DecisionInput => ({
  approvalId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
  orgId: "3f2504e0-4f89-41d3-9a0c-0305e82c3302",
  decidedBy: "3f2504e0-4f89-41d3-9a0c-0305e82c3303",
  decision: "rejected",
  reasonCode: "scope_gap",
  note: "Cover the migration path",
  regenerate: true,
  idempotencyKey: "decision-key",
  ...over,
});

describe("approval idempotency", () => {
  it("fingerprints equivalent decision payloads deterministically", () => {
    expect(approvalDecisionFingerprint(decisionInput())).toBe(
      approvalDecisionFingerprint(decisionInput()),
    );
  });

  it("changes the fingerprint when consequential input changes", () => {
    const original = approvalDecisionFingerprint(decisionInput());
    expect(approvalDecisionFingerprint(decisionInput({ decision: "approved" }))).not.toBe(original);
    expect(approvalDecisionFingerprint(decisionInput({ note: "Different feedback" }))).not.toBe(original);
    expect(approvalDecisionFingerprint(decisionInput({ regenerate: false }))).not.toBe(original);
  });

  it("returns the original result only for an exact same-key replay", () => {
    const input = decisionInput();
    const fingerprint = approvalDecisionFingerprint(input);
    expect(replayDecision({
      decisionKey: input.idempotencyKey ?? null,
      decisionFingerprint: fingerprint,
      regenerationJobId: "3f2504e0-4f89-41d3-9a0c-0305e82c3304",
    }, input, fingerprint)).toEqual({
      regenerationJobId: "3f2504e0-4f89-41d3-9a0c-0305e82c3304",
    });
  });

  it("rejects reuse of the same key with a different payload", () => {
    const original = decisionInput();
    const changed = decisionInput({ note: "Changed after an ambiguous response" });
    let error: unknown;
    try {
      replayDecision({
        decisionKey: original.idempotencyKey ?? null,
        decisionFingerprint: approvalDecisionFingerprint(original),
        regenerationJobId: null,
      }, changed, approvalDecisionFingerprint(changed));
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ status: 409, code: "IDEMPOTENCY_KEY_REUSED" });
  });
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
