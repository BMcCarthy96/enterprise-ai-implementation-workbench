import { describe, expect, it } from "vitest";
import {
  buildDemoDestination,
  parseDemoEntry,
} from "@/lib/demoEntry";

function params(value: string): URLSearchParams {
  return new URLSearchParams(value);
}

describe("public demo entries", () => {
  it("defaults to the guided portfolio checkpoint", () => {
    const entry = parseDemoEntry(params(""));
    expect(entry).toEqual({
      checkpoint: "portfolio-health",
      persona: null,
      tourMode: "guided",
    });
    expect(buildDemoDestination(entry)).toBe(
      "/dashboard?checkpoint=portfolio-health",
    );
  });

  it("opens self-guided workspaces without a coachmark checkpoint", () => {
    const entry = parseDemoEntry(
      params("tour=self-guided&checkpoint=ai-evidence"),
    );
    expect(entry.checkpoint).toBeNull();
    expect(entry.tourMode).toBe("self-guided");
    expect(buildDemoDestination(entry)).toBe(
      "/dashboard?tour=self-guided",
    );
  });

  it("preserves technical checkpoints and valid persona entries", () => {
    const technical = parseDemoEntry(params("checkpoint=ai-evidence"));
    expect(buildDemoDestination(technical)).toBe(
      "/dashboard?checkpoint=ai-evidence",
    );

    const admin = parseDemoEntry(
      params("persona=org_admin&checkpoint=platform-security"),
    );
    expect(admin.persona).toBe("org_admin");
    expect(admin.checkpoint).toBe("platform-security");
  });

  it("ignores an unknown persona", () => {
    expect(parseDemoEntry(params("persona=owner")).persona).toBeNull();
  });
});
