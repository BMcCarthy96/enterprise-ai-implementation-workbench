import { describe, expect, it } from "vitest";
import { MockProvider } from "@/lib/ai/mock";
import { PlanContentSchema } from "@/lib/ai/planSchema";
import {
  PLAN_SYSTEM_PROMPT,
  DIGEST_SYSTEM_PROMPT,
  buildPlanUserPrompt,
  buildDigestUserPrompt,
} from "@/lib/ai/prompts";

const planInput = {
  projectName: "Test Project",
  projectDescription: "A test",
  customerName: "Acme Co",
  customerIndustry: "Testing",
  targetDate: null,
  requirements: [
    { title: "Structured intake form", details: "Replace emails", priority: "critical" },
    { title: "Assignment rules", details: null, priority: "medium" },
  ],
};

describe("MockProvider", () => {
  it("produces a plan that passes the same validation as real model output", async () => {
    const provider = new MockProvider();
    const res = await provider.complete({
      system: PLAN_SYSTEM_PROMPT,
      user: buildPlanUserPrompt(planInput),
    });
    const plan = PlanContentSchema.parse(JSON.parse(res.text));
    expect(plan.milestones.length).toBeGreaterThanOrEqual(2);
  });

  it("covers every stated requirement with a build task", async () => {
    const provider = new MockProvider();
    const res = await provider.complete({
      system: PLAN_SYSTEM_PROMPT,
      user: buildPlanUserPrompt(planInput),
    });
    const plan = PlanContentSchema.parse(JSON.parse(res.text));
    const allTitles = plan.milestones.flatMap((m) => m.tasks.map((t) => t.title));
    for (const req of planInput.requirements) {
      expect(
        allTitles.some((t) => t.includes(req.title)),
        `requirement "${req.title}" should map to a task`,
      ).toBe(true);
    }
  });

  it("produces a digest with title and body", async () => {
    const provider = new MockProvider();
    const res = await provider.complete({
      system: DIGEST_SYSTEM_PROMPT,
      user: buildDigestUserPrompt({
        projectName: "Test Project",
        customerName: "Acme Co",
        periodDays: 14,
        milestoneSummary: [{ name: "Build", status: "in_progress" }],
        taskCounts: { done: 3, inProgress: 2, blocked: 1, todo: 4 },
        recentActivity: [{ action: "task.status_changed", at: new Date().toISOString() }],
      }),
    });
    const digest = JSON.parse(res.text) as { title: string; body: string };
    expect(digest.title).toContain("Test Project");
    expect(digest.body.length).toBeGreaterThan(100);
    // The blocked task must be surfaced honestly to the customer.
    expect(digest.body).toContain("blocked");
  });

  it("rejects prompts it does not recognize", async () => {
    const provider = new MockProvider();
    await expect(
      provider.complete({ system: "unknown", user: "hello" }),
    ).rejects.toThrow();
  });
});
