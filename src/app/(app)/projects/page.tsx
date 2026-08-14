import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema, withTenantTransaction } from "@/db";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { NewProjectButton } from "./NewProjectButton";

export const dynamic = "force-dynamic";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = (await getSession())!;
  const query = (await searchParams) ?? {};
  const search = typeof query.q === "string" ? query.q.trim().toLowerCase() : "";
  const status = typeof query.status === "string" ? query.status : "";
  const customer = typeof query.customer === "string" ? query.customer : "";

  const canManage = can(session.role, "projects.manage");
  const { rows, customers } = await withTenantTransaction(
    session.orgId,
    async () => ({
      rows: await db
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
        .orderBy(desc(schema.projects.createdAt)),
      customers: await db.query.customers.findMany({
        where: eq(schema.customers.orgId, session.orgId),
      }),
    }),
    session.userId,
  );
  const filteredRows = rows.filter(({ project, customerName }) =>
    (!search || `${project.name} ${customerName} ${project.description ?? ""}`.toLowerCase().includes(search)) &&
    (!status || project.status === status) &&
    (!customer || project.customerId === customer),
  );

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

      <form method="get" className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4" aria-label="Filter projects">
        <label className="min-w-56 flex-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Search projects<input name="q" defaultValue={search} className="input mt-1" placeholder="Project, customer, or description" /></label>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Stage<select name="status" defaultValue={status} className="input mt-1"><option value="">All stages</option>{schema.projectStatus.enumValues.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Customer<select name="customer" defaultValue={customer} className="input mt-1"><option value="">All customers</option>{customers.map((value) => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
        <button type="submit" className="btn-secondary">Apply filters</button>
        {(search || status || customer) && <Link href="/projects" className="pb-2 text-xs font-semibold text-indigo-700 hover:underline">Clear</Link>}
      </form>

      {rows.length === 0 ? (
        <EmptyState
          title="No projects yet"
          hint="Create a project to start capturing requirements and generating implementation plans."
        />
      ) : filteredRows.length === 0 ? (
        <EmptyState title="No projects match those filters" hint="Clear a filter or broaden the search to see the organization portfolio." />
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
              {filteredRows.map(({ project, customerName }) => (
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
