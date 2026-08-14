import { describe, expect, it } from "vitest";
import { calibrationReport } from "@/lib/evals/calibration";

describe("calibrationReport", () => {
  it("enables judge comparisons only when correlation and error thresholds pass", () => {
    const report = calibrationReport(
      Array.from({ length: 15 }, (_, index) => ({
        human: (index % 5) + 1,
        judge: (index % 5) + 1,
      })),
    );
    expect(report.spearman).toBe(1);
    expect(report.meanAbsoluteError).toBe(0);
    expect(report.judgeEligible).toBe(true);
  });

  it("keeps a statistically promising judge advisory below 15 samples", () => {
    const report = calibrationReport([
      { human: 1, judge: 1 },
      { human: 2, judge: 2 },
      { human: 3, judge: 3 },
      { human: 4, judge: 4 },
      { human: 5, judge: 5 },
    ]);
    expect(report.spearman).toBe(1);
    expect(report.meanAbsoluteError).toBe(0);
    expect(report.judgeEligible).toBe(false);
  });

  it("keeps an uncalibrated judge advisory", () => {
    const report = calibrationReport([
      { human: 1, judge: 5 },
      { human: 2, judge: 4 },
      { human: 3, judge: 3 },
      { human: 4, judge: 2 },
      { human: 5, judge: 1 },
    ]);
    expect(report.spearman).toBe(-1);
    expect(report.judgeEligible).toBe(false);
  });
});
