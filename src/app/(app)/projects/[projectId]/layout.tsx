import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, schema, withTenantTransaction } from "@/db";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { ApiError } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { ProjectBreadcrumb, ProjectTabs } from "./ProjectTabs";
import { assertCustomerAccess, uuidParam } from "@/server/services/access";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId: rawProjectId } = await params;
  const projectId = uuidParam(rawProjectId, "projectId");
  const session = (await getSession())!;

  const row = await withTenantTransaction(
    session.orgId,
    async () => {
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
        .where(
          and(
            eq(schema.projects.id, projectId),
            eq(schema.projects.orgId, session.orgId),
          ),
        )
        .limit(1);
      if (rows[0]) {
        try {
          await assertCustomerAccess(session, rows[0].project.customerId);
        } catch (error) {
          // Treat an unassigned customer project exactly like a missing
          // project at the page boundary. This keeps the response a real 404
          // instead of surfacing an API error through the server component.
          if (error instanceof ApiError && error.status === 404) return [];
          throw error;
        }
      }
      return rows;
    },
    session.userId,
  );
  if (row.length === 0) {
    // A customer who guesses another project's UUID should land back on the
    // scoped project list rather than receive a streamed shell with a 200
    // status before Next can render its not-found boundary. Internal users
    // still get the normal 404 for an unknown project.
    if (session.role === "customer_stakeholder") redirect("/projects");
    notFound();
  }
  const { project, customerName } = row[0];

  const internal = can(session.role, "internal.view");
  const tabs = internal
    ? [
        { href: `/projects/${projectId}`, label: "Overview" },
        { href: `/projects/${projectId}/requirements`, label: "Scope" },
        { href: `/projects/${projectId}/plan`, label: "Plan" },
        { href: `/projects/${projectId}/board`, label: "Delivery" },
        { href: `/projects/${projectId}/timeline`, label: "Timeline" },
        { href: `/projects/${projectId}/documents`, label: "Documents" },
        { href: `/projects/${projectId}/updates`, label: "Communications" },
        { href: `/projects/${projectId}/activity`, label: "Activity" },
      ]
    : [
        { href: `/projects/${projectId}`, label: "Overview" },
        { href: `/projects/${projectId}/timeline`, label: "Timeline" },
        { href: `/projects/${projectId}/updates`, label: "Communications" },
      ];

  return (
    <div data-testid="project-shell">
      <ProjectBreadcrumb projectName={project.name} tabs={tabs} />
      <div className="mb-1 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-gray-900">{project.name}</h1>
        <StatusBadge status={project.status} />
      </div>
      <p className="text-sm text-gray-500">
        {customerName}
        {project.targetDate &&
          ` · Target ${project.targetDate.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}`}
      </p>
      <div className="mt-4 border-b border-gray-200">
        <ProjectTabs tabs={tabs} />
      </div>
      <div className="mt-6">{children}</div>
    </div>
  );
}
