import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SessionPayload } from "@/lib/auth/session";
import {
  buildRoleTourSteps,
  DEMO_PERSONA_OPTIONS,
  TOUR_VERSION,
  type DemoScenarioRefs,
  type TourManifest,
} from "@/lib/tour";

function asRefs(value: unknown): DemoScenarioRefs | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<DemoScenarioRefs>;
  if (
    !candidate.personaUserIds?.implementation_manager ||
    !candidate.personaUserIds?.solutions_engineer ||
    !candidate.personaUserIds?.customer_stakeholder ||
    !candidate.personaUserIds?.org_admin ||
    !candidate.projectIds?.orderIntake ||
    !candidate.projectIds.patientOnboarding
  ) return null;
  return candidate as DemoScenarioRefs;
}

/**
 * Build a server-sourced tour manifest. The route list is pure and role-aware;
 * demo workflow completion is refreshed from the current tenant rows so a
 * live generation or approval changes the checklist on the next navigation.
 */
export async function getTourManifest(session: SessionPayload): Promise<TourManifest> {
  let refs: DemoScenarioRefs | null = null;
  if (session.demoWorkspaceId) {
    const workspace = await db.query.demoWorkspaces.findFirst({
      where: and(
        eq(schema.demoWorkspaces.id, session.demoWorkspaceId),
        eq(schema.demoWorkspaces.orgId, session.orgId),
      ),
      columns: { scenarioRefs: true },
    });
    refs = asRefs(workspace?.scenarioRefs);
  }

  const steps = buildRoleTourSteps(session.role, refs);
  if (!refs) {
    return { version: TOUR_VERSION, role: session.role, isDemo: false, steps };
  }

  const demoPersonas = DEMO_PERSONA_OPTIONS.map((persona) => ({ ...persona }));

  const onboardingPlans = await db.query.plans.findMany({
    where: and(eq(schema.plans.orgId, session.orgId), eq(schema.plans.projectId, refs.projectIds.patientOnboarding)),
    columns: { id: true, status: true },
  });
  const onboardingPlanIds = onboardingPlans.map((plan) => plan.id);
  const onboardingApprovals = onboardingPlanIds.length
    ? await db.query.approvals.findMany({
        where: and(eq(schema.approvals.orgId, session.orgId), inArray(schema.approvals.subjectId, onboardingPlanIds)),
        columns: { status: true },
      })
    : [];
  const onboardingTasks = await db.query.tasks.findMany({
    where: and(eq(schema.tasks.orgId, session.orgId), eq(schema.tasks.projectId, refs.projectIds.patientOnboarding)),
    columns: { id: true },
    limit: 1,
  });
  const deadLetterJobs = await db.query.jobs.findMany({
    where: and(eq(schema.jobs.orgId, session.orgId), eq(schema.jobs.id, refs.jobIds.deadLetter), eq(schema.jobs.status, "dead_letter")),
    columns: { id: true },
  });
  const pendingUpdates = await db.query.customerUpdates.findMany({
    where: and(eq(schema.customerUpdates.orgId, session.orgId), eq(schema.customerUpdates.id, refs.updateIds.pending), eq(schema.customerUpdates.status, "pending_approval")),
    columns: { id: true },
  });

  const complete = new Set<string>();
  if (onboardingPlans.length > 0) complete.add("live-generation");
  if (onboardingApprovals.some((approval) => approval.status === "approved")) complete.add("generated-board");
  if (onboardingTasks.length > 0) complete.add("generated-board");
  if (deadLetterJobs.length > 0) complete.add("dead-letter-recovery");
  if (pendingUpdates.length === 0) complete.add("customer-update");

  return {
    version: TOUR_VERSION,
    role: session.role,
    isDemo: true,
    workspaceId: session.demoWorkspaceId,
    demoPersonas,
    steps: steps.map((step) => ({ ...step, complete: complete.has(step.id) })),
  };
}
