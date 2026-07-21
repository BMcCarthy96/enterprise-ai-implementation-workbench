import { describe, expect, it } from "vitest";
import { diffPlans } from "@/lib/ai/planDiff";
import type { PlanContent } from "@/lib/ai/planSchema";

function plan(over: Partial<PlanContent>): PlanContent {
  return {
    summary: "A phased implementation covering the requirements.",
    assumptions: [],
    risks: [],
    openQuestions: [],
    milestones: [
      {
        name: "Discovery",
        description: "",
        tasks: [{ title: "Kickoff", description: "", suggestedRole: "solutions_engineer" }],
      },
      {
        name: "Build",
        description: "",
        tasks: [{ title: "Implement", description: "", suggestedRole: "solutions_engineer" }],
      },
    ],
    ...over,
  };
}

describe("diffPlans", () => {
  it("reports no changes for identical plans", () => {
    const p = plan({});
    const d = diffPlans(p, plan({}));
    expect(d.hasChanges).toBe(false);
    expect(d.taskCountDelta).toBe(0);
    expect(d.milestonesAdded).toEqual([]);
  });

  it("detects an added milestone", () => {
    const next = plan({
      milestones: [
        ...plan({}).milestones,
        { name: "Launch", description: "", tasks: [{ title: "Go live", description: "", suggestedRole: "solutions_engineer" }] },
      ],
    });
    const d = diffPlans(plan({}), next);
    expect(d.milestonesAdded).toEqual(["Launch"]);
    expect(d.milestonesRemoved).toEqual([]);
    expect(d.hasChanges).toBe(true);
  });

  it("detects a removed milestone and matches names case-insensitively", () => {
    const prev = plan({});
    const next = plan({ milestones: [prev.milestones[0]] });
    const d = diffPlans(prev, next);
    expect(d.milestonesRemoved).toEqual(["Build"]);

    // Rename-only-by-case should NOT count as add/remove.
    const recased = plan({
      milestones: prev.milestones.map((m) => ({ ...m, name: m.name.toUpperCase() })),
    });
    expect(diffPlans(prev, recased).milestonesAdded).toEqual([]);
  });

  it("computes task and risk deltas", () => {
    const prev = plan({});
    const next = plan({
      milestones: [
        {
          name: "Discovery",
          description: "",
          tasks: [
            { title: "Kickoff", description: "", suggestedRole: "solutions_engineer" },
            { title: "Extra", description: "", suggestedRole: "solutions_engineer" },
          ],
        },
        prev.milestones[1],
      ],
      risks: [{ description: "New risk", severity: "low", mitigation: "" }],
    });
    const d = diffPlans(prev, next);
    expect(d.taskCountDelta).toBe(1);
    expect(d.currentTaskCount).toBe(3);
    expect(d.previousTaskCount).toBe(2);
    expect(d.riskCountDelta).toBe(1);
  });

  it("flags a changed summary", () => {
    const d = diffPlans(plan({}), plan({ summary: "Totally different summary here." }));
    expect(d.summaryChanged).toBe(true);
    expect(d.hasChanges).toBe(true);
  });
});
