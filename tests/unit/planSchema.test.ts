import { describe, expect, it } from "vitest";
import { PlanContentSchema } from "@/lib/ai/planSchema";
import { extractJson } from "@/server/services/planGeneration";

const validPlan = {
  summary:
    "A phased implementation covering intake, configuration, build, validation, and launch.",
  assumptions: ["Customer provides a point of contact."],
  risks: [
    {
      description: "Credentials arrive late.",
      severity: "medium",
      mitigation: "Request during kickoff.",
    },
  ],
  milestones: [
    {
      name: "Discovery",
      description: "Confirm scope.",
      durationWeeks: 1,
      tasks: [{ title: "Run kickoff workshop", description: "" }],
    },
    {
      name: "Build",
      description: "Deliver requirements.",
      durationWeeks: 3,
      tasks: [{ title: "Implement intake form", description: "" }],
    },
  ],
  openQuestions: ["Who signs off UAT?"],
};

describe("PlanContentSchema", () => {
  it("accepts a well-formed plan and applies defaults", () => {
    const parsed = PlanContentSchema.parse(validPlan);
    expect(parsed.milestones).toHaveLength(2);
    expect(parsed.milestones[0].tasks[0].suggestedRole).toBe(
      "solutions_engineer",
    );
  });

  it("rejects a plan with fewer than two milestones", () => {
    expect(() =>
      PlanContentSchema.parse({
        ...validPlan,
        milestones: [validPlan.milestones[0]],
      }),
    ).toThrow();
  });

  it("rejects a milestone with no tasks", () => {
    expect(() =>
      PlanContentSchema.parse({
        ...validPlan,
        milestones: [
          validPlan.milestones[0],
          { ...validPlan.milestones[1], tasks: [] },
        ],
      }),
    ).toThrow();
  });

  it("rejects invalid risk severities", () => {
    expect(() =>
      PlanContentSchema.parse({
        ...validPlan,
        risks: [{ description: "Something", severity: "catastrophic" }],
      }),
    ).toThrow();
  });
});

describe("extractJson", () => {
  it("passes through bare JSON", () => {
    expect(JSON.parse(extractJson('{"a": 1}'))).toEqual({ a: 1 });
  });

  it("strips markdown fences models sometimes add", () => {
    const wrapped = '```json\n{"a": 1}\n```';
    expect(JSON.parse(extractJson(wrapped))).toEqual({ a: 1 });
  });

  it("trims commentary around the JSON object", () => {
    const noisy = 'Here is your plan:\n{"a": 1}\nLet me know!';
    expect(JSON.parse(extractJson(noisy))).toEqual({ a: 1 });
  });

  it("throws when there is no JSON at all", () => {
    expect(() => extractJson("I cannot help with that.")).toThrow();
  });
});
