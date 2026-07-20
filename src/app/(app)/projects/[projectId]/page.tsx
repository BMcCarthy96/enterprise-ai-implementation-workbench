import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession } from "@/lib/auth/session";
import { StatusBadge } from "@/components/StatusBadge";

export const dynamic = "force-dynamic";

export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = (await getSession())!;

  const project = await db.query.projects.findFirst({
    where: and(
      eq(schema.projects.id, projectId),
      eq(schema.projects.orgId, session.orgId),
    ),
  });
  if (!project) return null;

  const milestones = await db.query.milestones.findMany({
    where: eq(schema.milestones.projectId, projectId),
    orderBy: asc(schema.milestones.sortOrder),
  });
  const tasks = await db.query.tasks.findMany({
    where: eq(schema.tasks.projectId, projectId),
  });

  const done = tasks.filter((t) => t.status === "done").length;
  const blocked = tasks.filter((t) => t.status === "blocked").length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <div className="card p-5">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">
            About this project
          </h2>
          <p className="text-sm leading-relaxed text-gray-600">
            {project.description ?? "No description provided."}
          </p>
        </div>

        <div className="card">
          <div className="border-b border-gray-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-900">Milestones</h2>
          </div>
          {milestones.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-gray-500">
              No milestones yet — they are created when an implementation plan
              is approved.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {milestones.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">{m.name}</p>
                    {m.description && (
                      <p className="mt-0.5 line-clamp-1 text-xs text-gray-500">
                        {m.description}
                      </p>
                    )}
                  </div>
                  <StatusBadge status={m.status} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="space-y-6">
        <div className="card p-5">
          <h2 className="mb-3 text-sm font-semibold text-gray-900">
            Delivery progress
          </h2>
          <div className="mb-2 h-2 overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-indigo-600 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-sm text-gray-600">
            {done} of {tasks.length} tasks complete ({pct}%)
          </p>
          {blocked > 0 && (
            <p className="mt-2 text-sm font-medium text-red-600">
              {blocked} task{blocked === 1 ? "" : "s"} blocked
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
