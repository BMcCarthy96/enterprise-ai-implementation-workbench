import { describe, expect, it } from "vitest";
import {
  buildProjectTimeline,
  excerpt,
  type TimelineInput,
} from "@/server/services/timeline";

const STARTED = new Date("2026-06-01T00:00:00.000Z");

function input(over: Partial<TimelineInput> = {}): TimelineInput {
  return {
    startedAt: STARTED,
    targetDate: null,
    milestones: [],
    tasks: [],
    updates: [],
    ...over,
  };
}

const milestone = (
  id: string,
  sortOrder: number,
  status: string,
  name = `Phase ${id}`,
) => ({ id, name, description: null, status, sortOrder });

describe("excerpt", () => {
  it("returns the first paragraph when short enough", () => {
    expect(excerpt("First para.\n\nSecond para.")).toBe("First para.");
  });

  it("truncates long text with an ellipsis", () => {
    const out = excerpt("x".repeat(300));
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(181);
  });
});

describe("buildProjectTimeline", () => {
  it("orders phases by sortOrder and maps milestone status", () => {
    const t = buildProjectTimeline(
      input({
        milestones: [
          milestone("c", 2, "not_started"),
          milestone("a", 0, "complete"),
          milestone("b", 1, "in_progress"),
        ],
      }),
    );
    expect(t.phases.map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(t.phases.map((p) => p.status)).toEqual([
      "complete",
      "in_progress",
      "upcoming",
    ]);
  });

  it("counts tasks per phase and computes overall progress", () => {
    const t = buildProjectTimeline(
      input({
        milestones: [milestone("a", 0, "complete"), milestone("b", 1, "in_progress")],
        tasks: [
          { milestoneId: "a", status: "done" },
          { milestoneId: "a", status: "done" },
          { milestoneId: "b", status: "done" },
          { milestoneId: "b", status: "blocked" },
        ],
      }),
    );
    expect(t.phases[0]).toMatchObject({ taskCount: 2, doneCount: 2 });
    expect(t.phases[1]).toMatchObject({ taskCount: 2, doneCount: 1 });
    expect(t.progress).toMatchObject({
      phasesComplete: 1,
      phasesTotal: 2,
      tasksDone: 3,
      tasksTotal: 4,
      percent: 75,
    });
  });

  it("ignores tasks not attached to a milestone", () => {
    const t = buildProjectTimeline(
      input({
        milestones: [milestone("a", 0, "in_progress")],
        tasks: [
          { milestoneId: "a", status: "done" },
          { milestoneId: null, status: "done" },
          { milestoneId: null, status: "todo" },
        ],
      }),
    );
    expect(t.progress.tasksTotal).toBe(1);
    expect(t.progress.percent).toBe(100);
  });

  it("reports 0% rather than dividing by zero when there are no tasks", () => {
    const t = buildProjectTimeline(input({ milestones: [milestone("a", 0, "not_started")] }));
    expect(t.progress.percent).toBe(0);
    expect(t.progress.tasksTotal).toBe(0);
  });

  // The security property this feature rests on.
  it("exposes only published updates to the customer view", () => {
    const t = buildProjectTimeline(
      input({
        updates: [
          {
            id: "published",
            title: "Published",
            body: "Visible.",
            status: "published",
            publishedAt: new Date("2026-07-01T00:00:00.000Z"),
          },
          {
            id: "draft",
            title: "Draft",
            body: "Internal only.",
            status: "draft",
            publishedAt: null,
          },
          {
            id: "pending",
            title: "Awaiting review",
            body: "Not approved yet.",
            status: "pending_approval",
            publishedAt: null,
          },
          {
            id: "rejected",
            title: "Rejected draft",
            body: "Never send this.",
            status: "rejected",
            publishedAt: null,
          },
        ],
      }),
    );
    expect(t.updates.map((u) => u.id)).toEqual(["published"]);
  });

  it("drops an update marked published but missing a publish timestamp", () => {
    const t = buildProjectTimeline(
      input({
        updates: [
          {
            id: "no-date",
            title: "Odd",
            body: "x",
            status: "published",
            publishedAt: null,
          },
        ],
      }),
    );
    expect(t.updates).toEqual([]);
  });

  it("lists published updates newest first", () => {
    const mk = (id: string, iso: string) => ({
      id,
      title: id,
      body: "body",
      status: "published",
      publishedAt: new Date(iso),
    });
    const t = buildProjectTimeline(
      input({
        updates: [
          mk("older", "2026-06-01T00:00:00.000Z"),
          mk("newest", "2026-07-15T00:00:00.000Z"),
          mk("middle", "2026-07-01T00:00:00.000Z"),
        ],
      }),
    );
    expect(t.updates.map((u) => u.id)).toEqual(["newest", "middle", "older"]);
  });
});
