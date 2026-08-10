import { describe, expect, it } from "vitest";
import { PlanContentSchema } from "@/lib/ai/planSchema";
import {
  buildPlanEvaluationRows,
  computePlanCoverage,
  normalizedValidationEvidence,
} from "@/lib/ai/evidence";
import { assessPlanOutput } from "@/server/services/planGeneration";
import { compareEvalReports } from "@/lib/evals/regression";

const plan = PlanContentSchema.parse({
  summary: "A phased implementation covering discovery, build, validation, and launch.",
  assumptions: ["Customer provides a point of contact."],
  risks: [{ description: "Credentials arrive late.", severity: "medium", mitigation: "Request during kickoff." }],
  milestones: [
    { name: "Discovery", description: "Confirm scope.", durationWeeks: 1, tasks: [{ title: "Run kickoff workshop", description: "" }] },
    { name: "Launch & Handoff", description: "Release safely.", durationWeeks: 1, tasks: [{ title: "Run launch", description: "" }] },
  ],
  openQuestions: ["Who signs off UAT?"],
});

describe("AI evidence normalization", () => {
  const input = {
    projectName: "Example",
    projectDescription: null,
    customerName: "Example Customer",
    customerIndustry: null,
    targetDate: null,
    requirements: [{ id: "req-1", title: "Intake form", details: "Capture intake", priority: "high" }],
  };

  it("classifies malformed output without retaining its contents", () => {
    const assessment = assessPlanOutput("not-json with a secret@example.com", input);
    expect(assessment.content).toBeUndefined();
    expect(assessment.errorKind).toBe("JSON_PARSE_FAILED");
    expect(JSON.stringify(assessment.evidence)).not.toContain("secret@example.com");
  });

  it("persists only stable failure codes and paths", () => {
    const evidence = normalizedValidationEvidence({
      schemaValid: false,
      guardrailPassed: false,
      failureCodes: ["SCHEMA_VALIDATION_FAILED", "SCHEMA_VALIDATION_FAILED"],
      issuePaths: ["milestones[0].tasks[0].requirementIds"],
    });
    expect(evidence.failureCodes).toEqual(["SCHEMA_VALIDATION_FAILED"]);
    expect(JSON.stringify(evidence)).not.toContain("prompt");
    expect(JSON.stringify(evidence)).not.toContain("source");
  });

  it("maps graders to hard gates and quality signals with normalized details", () => {
    const rows = buildPlanEvaluationRows(input, plan);
    expect(rows.some((row) => row.checkName === "schemaValid" && row.gateLevel === "hard_gate")).toBe(true);
    expect(rows.some((row) => row.checkName === "milestoneOrdering" && row.gateLevel === "quality_signal")).toBe(true);
    expect(rows.every((row) => !row.detail.includes("Example Customer"))).toBe(true);
  });

  it("computes requirement and citation coverage without exposing content", () => {
    const coverage = computePlanCoverage({ requirements: [{ id: "req-1" }], plan, citationCount: 0 });
    expect(coverage.requirementsTotal).toBe(1);
    expect(coverage.citationsTotal).toBe(0);
    expect(coverage.coveragePercent).toBeGreaterThanOrEqual(0);
  });

  it("uses the shared regression gate for baseline comparisons", () => {
    const result = compareEvalReports(
      { summary: { "plan-v2.0": { aggregate: 1, schemaValidRate: 1, graders: { citationValidity: 1, injectionResistance: 1, noPromptLeak: 1, riskCompleteness: 1 } } } },
      { summary: { "plan-v2.0": { aggregate: 0.99, schemaValidRate: 1, graders: { citationValidity: 1, injectionResistance: 1, noPromptLeak: 1, riskCompleteness: 1 } } } },
    );
    expect(result.passed).toBe(true);
    expect(result.maxAggregateRegression).toBeCloseTo(0.01);
  });
});
