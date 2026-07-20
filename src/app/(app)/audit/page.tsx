import { and, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";

export const dynamic = "force-dynamic";

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const session = (await getSession())!;
  if (!can(session.role, "audit.view")) redirect("/dashboard");
  const { project } = await searchParams;

  const projects = await db.query.projects.findMany({
    where: eq(schema.projects.orgId, session.orgId),
  });

  const events = await db
    .select({
      event: schema.auditEvents,
      actorName: schema.users.name,
      projectName: schema.projects.name,
    })
    .from(schema.auditEvents)
    .leftJoin(schema.users, eq(schema.auditEvents.actorId, schema.users.id))
    .leftJoin(
      schema.projects,
      eq(schema.auditEvents.projectId, schema.projects.id),
    )
    .where(
      and(
        eq(schema.auditEvents.orgId, session.orgId),
        project ? eq(schema.auditEvents.projectId, project) : undefined,
      ),
    )
    .orderBy(desc(schema.auditEvents.createdAt))
    .limit(200);

  return (
    <div>
      <PageHeader
        title="Audit Log"
        subtitle="Append-only history of every action in your organization — human and system"
      />

      <form method="GET" className="mb-4 flex items-center gap-2">
        <select
          name="project"
          className="input max-w-xs"
          defaultValue={project ?? ""}
        >
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button type="submit" className="btn-secondary">
          Filter
        </button>
      </form>

      {events.length === 0 ? (
        <EmptyState title="No audit events match this filter" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="table-th">When</th>
                <th className="table-th">Actor</th>
                <th className="table-th">Action</th>
                <th className="table-th">Project</th>
                <th className="table-th">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {events.map(({ event, actorName, projectName }) => (
                <tr key={event.id}>
                  <td className="table-td whitespace-nowrap text-xs text-gray-500">
                    {event.createdAt.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}{" "}
                    {event.createdAt.toLocaleTimeString("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="table-td">{actorName ?? "System"}</td>
                  <td className="table-td">
                    <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">
                      {event.action}
                    </code>
                  </td>
                  <td className="table-td text-xs">{projectName ?? "—"}</td>
                  <td className="table-td max-w-xs">
                    {event.metadata != null && (
                      <span className="block truncate font-mono text-xs text-gray-400">
                        {JSON.stringify(event.metadata)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
