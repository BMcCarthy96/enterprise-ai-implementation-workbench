import type { Role } from "@/lib/auth/rbac";

export type DemoTourMode = "guided" | "self-guided";

export interface DemoEntry {
  checkpoint: string | null;
  persona: Role | null;
  tourMode: DemoTourMode;
}

interface SearchParamsReader {
  get(name: string): string | null;
}

const DEMO_PERSONAS = new Set<Role>([
  "org_admin",
  "implementation_manager",
  "solutions_engineer",
  "customer_stakeholder",
]);

export function isSelfGuidedDemo(params: SearchParamsReader): boolean {
  return params.get("tour") === "self-guided";
}

export function parseDemoEntry(params: SearchParamsReader): DemoEntry {
  const tourMode: DemoTourMode = isSelfGuidedDemo(params)
    ? "self-guided"
    : "guided";
  const requestedPersona = params.get("persona");
  const persona = DEMO_PERSONAS.has(requestedPersona as Role)
    ? (requestedPersona as Role)
    : null;

  return {
    // A self-guided entry intentionally ignores a checkpoint so no coachmark
    // can reopen while the visitor is trying to browse on their own.
    checkpoint:
      tourMode === "self-guided"
        ? null
        : (params.get("checkpoint") ?? "portfolio-health"),
    persona,
    tourMode,
  };
}

export function buildDemoDestination(
  entry: Pick<DemoEntry, "checkpoint" | "tourMode">,
): string {
  const params = new URLSearchParams();
  if (entry.checkpoint) params.set("checkpoint", entry.checkpoint);
  if (entry.tourMode === "self-guided") params.set("tour", "self-guided");
  const query = params.toString();
  return query ? `/dashboard?${query}` : "/dashboard";
}
