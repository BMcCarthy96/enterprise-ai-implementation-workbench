import { describe, expect, it } from "vitest";
import {
  computeApprovalStats,
  computeJobReliability,
  computeRejectionReasons,
  computeByPromptVersion,
  tally,
  type DecisionRow,
  type JobRow,
} from "@/server/services/insights";

const at = (h: number) => new Date(2026, 0, 1, h);

describe("computeApprovalStats", () => {
  const rows: DecisionRow[] = [
    { status: "approved", reasonCode: null, createdAt: at(0), decidedAt: at(2) },
    { status: "approved", reasonCode: null, createdAt: at(0), decidedAt: at(4) },
    { status: "rejected", reasonCode: "scope_too_broad", createdAt: at(0), decidedAt: at(0) },
    { status: "pending", reasonCode: null, createdAt: at(0), decidedAt: null },
  ];

  it("computes approval rate over decided items only", () => {
    const s = computeApprovalStats(rows);
    expect(s.total).toBe(4);
    expect(s.approved).toBe(2);
    expect(s.rejected).toBe(1);
    expect(s.pending).toBe(1);
    // 2 approved of 3 decided = 67%
    expect(s.approvalRate).toBe(67);
  });

  it("averages turnaround across decided items (2h and 4h and 0h → 2h)", () => {
    expect(computeApprovalStats(rows).avgTurnaroundHours).toBe(2);
  });

  it("returns null rates when nothing is decided", () => {
    const s = computeApprovalStats([
      { status: "pending", reasonCode: null, createdAt: at(0), decidedAt: null },
    ]);
    expect(s.approvalRate).toBeNull();
    expect(s.avgTurnaroundHours).toBeNull();
  });
});

describe("computeRejectionReasons", () => {
  it("counts and sorts reason codes descending, ignoring non-rejections", () => {
    const rows: DecisionRow[] = [
      { status: "rejected", reasonCode: "inaccurate_content", createdAt: at(0), decidedAt: at(1) },
      { status: "rejected", reasonCode: "inaccurate_content", createdAt: at(0), decidedAt: at(1) },
      { status: "rejected", reasonCode: "scope_too_broad", createdAt: at(0), decidedAt: at(1) },
      { status: "approved", reasonCode: null, createdAt: at(0), decidedAt: at(1) },
    ];
    expect(computeRejectionReasons(rows)).toEqual([
      { reason: "inaccurate_content", count: 2 },
      { reason: "scope_too_broad", count: 1 },
    ]);
  });

  it("labels missing reason codes as unspecified", () => {
    const rows: DecisionRow[] = [
      { status: "rejected", reasonCode: null, createdAt: at(0), decidedAt: at(1) },
    ];
    expect(computeRejectionReasons(rows)).toEqual([
      { reason: "unspecified", count: 1 },
    ]);
  });
});

describe("computeJobReliability", () => {
  const rows: JobRow[] = [
    { type: "plan_generation", status: "succeeded", attempts: 1, durationMs: 1000 },
    { type: "plan_generation", status: "succeeded", attempts: 2, durationMs: 3000 },
    { type: "plan_generation", status: "dead_letter", attempts: 3, durationMs: 5000 },
    { type: "plan_generation", status: "queued", attempts: 0, durationMs: null },
  ];

  it("computes success rate over terminal jobs only (2 of 3 = 67%)", () => {
    expect(computeJobReliability(rows).successRate).toBe(67);
  });

  it("counts dead-letter jobs and retry share", () => {
    const r = computeJobReliability(rows);
    expect(r.deadLetter).toBe(1);
    // 2 of 4 jobs had >1 attempt
    expect(r.retryRate).toBe(50);
  });

  it("averages duration over jobs that recorded one", () => {
    // (1000 + 3000 + 5000) / 3 = 3000
    expect(computeJobReliability(rows).avgDurationMs).toBe(3000);
  });

  it("handles an empty set without dividing by zero", () => {
    const r = computeJobReliability([]);
    expect(r.successRate).toBeNull();
    expect(r.avgDurationMs).toBeNull();
  });
});

describe("computeByPromptVersion", () => {
  it("groups plans by prompt version, counting approved+superseded as approved", () => {
    const result = computeByPromptVersion([
      { promptVersion: "plan-v1.0", status: "approved" },
      { promptVersion: "plan-v1.0", status: "superseded" },
      { promptVersion: "plan-v1.0", status: "rejected" },
      { promptVersion: "plan-v2.0", status: "pending_approval" },
    ]);
    expect(result[0]).toEqual({ promptVersion: "plan-v1.0", total: 3, approved: 2 });
    expect(result.find((r) => r.promptVersion === "plan-v2.0")).toEqual({
      promptVersion: "plan-v2.0",
      total: 1,
      approved: 0,
    });
  });
});

describe("tally", () => {
  it("counts occurrences of each key", () => {
    const result = tally(["todo", "done", "todo", "blocked"]);
    expect(result).toContainEqual({ key: "todo", count: 2 });
    expect(result).toContainEqual({ key: "done", count: 1 });
    expect(result).toContainEqual({ key: "blocked", count: 1 });
  });
});
