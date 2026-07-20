import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { StatusBadge } from "@/components/StatusBadge";
import { ProjectTabs } from "./ProjectTabs";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = (await getSession())!;

  const row = await db
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
  if (row.length === 0) notFound();
  const { project, customerName } = row[0];

  const internal = can(session.role, "internal.view");
  const tabs = internal
    ? [
        { href: `/projects/${projectId}`, label: "Overview" },
        { href: `/projects/${projectId}/requirements`, label: "Requirements" },
        { href: `/projects/${projectId}/plan`, label: "Plan" },
        { href: `/projects/${projectId}/board`, label: "Board" },
        { href: `/projects/${projectId}/documents`, label: "Documents" },
        { href: `/projects/${projectId}/updates`, label: "Updates" },
        { href: `/projects/${projectId}/activity`, label: "Activity" },
      ]
    : [
        { href: `/projects/${projectId}`, label: "Overview" },
        { href: `/projects/${projectId}/updates`, label: "Updates" },
      ];

  return (
    <div>
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
