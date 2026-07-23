import { describe, expect, it } from "vitest";
import {
  assessProjectRisk,
  worseLevel,
  DEFAULT_SLA_POLICY,
  type ProjectRiskInput,
} from "@/server/services/sla";

const NOW = new Date("2026-07-21T12:00:00.000Z");
const daysBefore = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const daysAfter = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
const hoursBefore = (n: number) => new Date(NOW.getTime() - n * 3_600_000);

function base(overrides: Partial<ProjectRiskInput> = {}): ProjectRiskInput {
  return {
    projectId: "p1",
    projectName: "Test Project",
    customerName: "Acme",
    status: "in_delivery",
    targetDate: null,
    blockedCount: 0,
    oldestBlockedAt: null,
    pendingApprovalCount: 0,
    oldestPendingApprovalAt: null,
    ...overrides,
  };
}

describe("worseLevel", () => {
  it("returns the more severe level", () => {
    expect(worseLevel("on_track", "at_risk")).toBe("at_risk");
    expect(worseLevel("at_risk", "breached")).toBe("breached");
    expect(worseLevel("breached", "at_risk")).toBe("breached");
    expect(worseLevel("on_track", "on_track")).toBe("on_track");
  });
});

describe("assessProjectRisk", () => {
  it("is on track with no signals", () => {
    const r = assessProjectRisk(base(), NOW);
    expect(r.level).toBe("on_track");
    expect(r.signals).toHaveLength(0);
  });

  it("never carries an SLA for completed or on-hold projects", () => {
    for (const status of ["completed", "on_hold"]) {
      const r = assessProjectRisk(
        base({ status, targetDate: daysBefore(30), blockedCount: 5, oldestBlockedAt: daysBefore(30) }),
        NOW,
      );
      expect(r.level).toBe("on_track");
      expect(r.signals).toHaveLength(0);
    }
  });

  it("breaches when the target date has passed", () => {
    const r = assessProjectRisk(base({ targetDate: daysBefore(3) }), NOW);
    expect(r.level).toBe("breached");
    expect(r.signals[0]).toMatchObject({ kind: "target_date", level: "breached" });
    expect(r.signals[0].label).toContain("3 days ago");
  });

  it("warns when the target date is within the policy window, not beyond it", () => {
    expect(assessProjectRisk(base({ targetDate: daysAfter(10) }), NOW).level).toBe("at_risk");
    // 20 days out is beyond the 14-day window → no signal.
    expect(assessProjectRisk(base({ targetDate: daysAfter(20) }), NOW).level).toBe("on_track");
  });

  it("labels a same-day target distinctly", () => {
    const r = assessProjectRisk(base({ targetDate: new Date(NOW.getTime() + 3_600_000) }), NOW);
    expect(r.signals[0].label).toBe("Target date is today");
  });

  it("escalates blocked tasks from warn to breach by age", () => {
    expect(
      assessProjectRisk(base({ blockedCount: 1, oldestBlockedAt: daysBefore(4) }), NOW).level,
    ).toBe("at_risk");
    expect(
      assessProjectRisk(base({ blockedCount: 2, oldestBlockedAt: daysBefore(9) }), NOW).level,
    ).toBe("breached");
    // Blocked only 1 day → under the warn threshold.
    expect(
      assessProjectRisk(base({ blockedCount: 1, oldestBlockedAt: daysBefore(1) }), NOW).level,
    ).toBe("on_track");
  });

  it("escalates aging approvals from warn to breach", () => {
    expect(
      assessProjectRisk(base({ pendingApprovalCount: 1, oldestPendingApprovalAt: hoursBefore(30) }), NOW).level,
    ).toBe("at_risk");
    expect(
      assessProjectRisk(base({ pendingApprovalCount: 1, oldestPendingApprovalAt: hoursBefore(80) }), NOW).level,
    ).toBe("breached");
    expect(
      assessProjectRisk(base({ pendingApprovalCount: 1, oldestPendingApprovalAt: hoursBefore(2) }), NOW).level,
    ).toBe("on_track");
  });

  it("takes the worst level across signals and lists breaches first", () => {
    const r = assessProjectRisk(
      base({
        targetDate: daysAfter(10), // at_risk
        blockedCount: 1,
        oldestBlockedAt: daysBefore(9), // breached
      }),
      NOW,
    );
    expect(r.level).toBe("breached");
    expect(r.signals).toHaveLength(2);
    expect(r.signals[0].level).toBe("breached");
    expect(r.signals[1].level).toBe("at_risk");
  });

  it("honours a custom policy", () => {
    const strict = { ...DEFAULT_SLA_POLICY, blockedTaskBreachDays: 2 };
    expect(
      assessProjectRisk(base({ blockedCount: 1, oldestBlockedAt: daysBefore(3) }), NOW, strict).level,
    ).toBe("breached");
  });
});
