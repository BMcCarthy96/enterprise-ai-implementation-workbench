import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { NewProjectButton } from "./NewProjectButton";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const session = (await getSession())!;

  const rows = await db
    .select({
      project: schema.projects,
      customerName: schema.customers.name,
    })
    .from(schema.projects)
    .innerJoin(
      schema.customers,
      eq(schema.projects.customerId, schema.customers.id),
    )
    .where(eq(schema.projects.orgId, session.orgId))
    .orderBy(desc(schema.projects.createdAt));

  const customers = await db.query.customers.findMany({
    where: eq(schema.customers.orgId, session.orgId),
  });

  const canManage = can(session.role, "projects.manage");

  return (
    <div>
      <PageHeader
        title="Projects"
        subtitle="Implementation engagements across your customers"
        actions={
          canManage ? (
            <NewProjectButton
              customers={customers.map((c) => ({ id: c.id, name: c.name }))}
            />
          ) : undefined
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          title="No projects yet"
          hint="Create a project to start capturing requirements and generating implementation plans."
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="table-th">Project</th>
                <th className="table-th">Customer</th>
                <th className="table-th">Status</th>
                <th className="table-th">Target date</th>
                <th className="table-th">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(({ project, customerName }) => (
                <tr key={project.id} className="hover:bg-gray-50">
                  <td className="table-td">
                    <Link
                      href={`/projects/${project.id}`}
                      className="font-medium text-indigo-600 hover:text-indigo-800"
                    >
                      {project.name}
                    </Link>
                  </td>
                  <td className="table-td">{customerName}</td>
                  <td className="table-td">
                    <StatusBadge status={project.status} />
                  </td>
                  <td className="table-td">
                    {project.targetDate
                      ? project.targetDate.toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })
                      : "—"}
                  </td>
                  <td className="table-td">
                    {project.createdAt.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
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
