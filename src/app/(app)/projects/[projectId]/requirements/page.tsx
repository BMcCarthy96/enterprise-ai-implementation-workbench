import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema, withTenantTransaction } from "@/db";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { RequirementForm } from "./RequirementForm";
import { TOUR_TARGETS } from "@/lib/tour";

export const dynamic = "force-dynamic";

export default async function RequirementsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = (await getSession())!;
  if (!can(session.role, "internal.view")) redirect(`/projects/${projectId}`);
  const canEdit = can(session.role, "requirements.manage");

  const rows = await withTenantTransaction(
    session.orgId,
    () =>
      db.query.requirements.findMany({
        where: eq(schema.requirements.projectId, projectId),
        orderBy: desc(schema.requirements.createdAt),
      }),
    session.userId,
  );

  return (
    <div className="grid scroll-mt-28 gap-6 lg:grid-cols-3" data-tour-target={TOUR_TARGETS.projectRequirements} aria-label="Project requirements">
      <div className="lg:col-span-2">
        {rows.length === 0 ? (
          <EmptyState
            title="No requirements captured"
            hint="Capture what the customer needs — the AI scoping engine turns these into a phased implementation plan."
          />
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-gray-900">{r.title}</p>
                  <div className="flex shrink-0 gap-1.5">
                    <StatusBadge status={r.priority} />
                    <StatusBadge status={r.status} />
                  </div>
                </div>
                {r.details && (
                  <p className="mt-2 text-sm leading-relaxed text-gray-600">
                    {r.details}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {canEdit && (
        <div>
          <div className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">
              Capture requirement
            </h2>
            <RequirementForm projectId={projectId} />
          </div>
        </div>
      )}
    </div>
  );
}
