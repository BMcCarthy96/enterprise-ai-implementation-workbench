import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema, withTenantTransaction } from "@/db";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { ProjectTimeline } from "@/components/ProjectTimeline";
import { getProjectTimeline } from "@/server/services/timeline";
import { TOUR_TARGETS } from "@/lib/tour";

export const dynamic = "force-dynamic";

export default async function TimelinePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = (await getSession())!;

  // Org-scoped: a guessed id from another tenant 404s rather than leaking.
  const timeline = await withTenantTransaction(
    session.orgId,
    async () => {
      const project = await db.query.projects.findFirst({
        where: and(
          eq(schema.projects.id, projectId),
          eq(schema.projects.orgId, session.orgId),
        ),
      });
      if (!project) notFound();
      return getProjectTimeline(projectId, project);
    },
    session.userId,
  );
  const internal = can(session.role, "internal.view");

  return (
    <div className="scroll-mt-28" data-tour-target={TOUR_TARGETS.projectTimeline} aria-label="Project timeline">
      <p className="mb-4 text-sm text-gray-500">
        {internal
          ? "The customer-facing view of delivery progress — published updates only, no internal review history."
          : "Where your implementation stands and what has been published so far."}
      </p>
      <ProjectTimeline timeline={timeline} />
    </div>
  );
}
