import { desc, eq, and } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { JobRunnerButton } from "@/components/JobRunnerButton";

export const dynamic = "force-dynamic";

export default async function UpdatesPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = (await getSession())!;
  const internal = can(session.role, "internal.view");
  const canDraft = can(session.role, "updates.draft");

  // Customer stakeholders only ever see published updates.
  const updates = await db.query.customerUpdates.findMany({
    where: internal
      ? eq(schema.customerUpdates.projectId, projectId)
      : and(
          eq(schema.customerUpdates.projectId, projectId),
          eq(schema.customerUpdates.status, "published"),
        ),
    orderBy: desc(schema.customerUpdates.createdAt),
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {internal
            ? "AI-drafted status updates — every update is approved before the customer sees it."
            : "Status updates from your implementation team."}
        </p>
        {canDraft && (
          <JobRunnerButton
            endpoint={`/api/v1/projects/${projectId}/updates/generate`}
            label="Draft customer update"
            busyLabel="Drafting update..."
          />
        )}
      </div>

      {updates.length === 0 ? (
        <EmptyState
          title="No updates yet"
          hint={
            internal
              ? "Draft an update — the digest engine summarizes recent progress, then it goes through the approval queue."
              : "Your implementation team has not published an update yet."
          }
        />
      ) : (
        <div className="space-y-4">
          {updates.map((u) => (
            <article key={u.id} className="card p-5">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-gray-900">
                  {u.title}
                </h2>
                <div className="flex items-center gap-2">
                  {internal && <StatusBadge status={u.status} />}
                  <span className="text-xs text-gray-400">
                    {(u.publishedAt ?? u.createdAt).toLocaleDateString("en-US", {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </div>
              </div>
              <div className="space-y-3 text-sm leading-relaxed text-gray-600">
                {u.body.split("\n\n").map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
