import { describe, expect, it } from "vitest";
import { buildTaskBreakdown, calculateCompletion, formatAge } from "@/server/services/dashboard";

describe("dashboard read-model helpers", () => {
  it("calculates honest completion without inventing work", () => {
    expect(calculateCompletion([])).toEqual({ completed: 0, total: 0, percent: 0 });
    expect(calculateCompletion([
      { status: "done" },
      { status: "in_progress" },
      { status: "blocked" },
    ])).toEqual({ completed: 1, total: 3, percent: 33 });
  });

  it("returns a stable stacked task breakdown", () => {
    expect(buildTaskBreakdown([{ status: "done" }, { status: "blocked" }])).toEqual([
      { status: "todo", count: 0 },
      { status: "in_progress", count: 0 },
      { status: "blocked", count: 1 },
      { status: "in_review", count: 0 },
      { status: "done", count: 1 },
    ]);
  });

  it("formats queue age with compact, recruiter-friendly labels", () => {
    const now = new Date("2026-08-09T12:00:00.000Z");
    expect(formatAge(new Date("2026-08-09T11:45:00.000Z"), now)).toBe("Just now");
    expect(formatAge(new Date("2026-08-08T10:00:00.000Z"), now)).toBe("1d old");
  });
});
