import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { DeliveryRiskPanel } from "@/components/DeliveryRiskPanel";
import { RiskDot } from "@/components/RiskBadge";
import { getDeliveryRisks, type RiskLevel } from "@/server/services/sla";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = (await getSession())!;
  const orgId = session.orgId;
  const isInternal = can(session.role, "internal.view");

  const projects = await db
    .select({
      project: schema.projects,
      customerName: schema.customers.name,
    })
    .from(schema.projects)
    .innerJoin(
      schema.customers,
      eq(schema.projects.customerId, schema.customers.id),
    )
    .where(eq(schema.projects.orgId, orgId))
    .orderBy(desc(schema.projects.updatedAt));

  const activeCount = projects.filter((p) =>
    ["discovery", "planning", "in_delivery"].includes(p.project.status),
  ).length;

  const openTasks = await db.$count(
    schema.tasks,
    and(
      eq(schema.tasks.orgId, orgId),
      inArray(schema.tasks.status, ["todo", "in_progress", "blocked", "in_review"]),
    ),
  );
  const pendingApprovals = await db.$count(
    schema.approvals,
    and(
      eq(schema.approvals.orgId, orgId),
      eq(schema.approvals.status, "pending"),
    ),
  );
  const failedJobs = await db.$count(
    schema.jobs,
    and(
      eq(schema.jobs.orgId, orgId),
      inArray(schema.jobs.status, ["failed", "dead_letter"]),
    ),
  );

  const delivery = isInternal
    ? await getDeliveryRisks(orgId)
    : { risks: [], counts: { breached: 0, atRisk: 0 } };
  const riskByProject = new Map<string, RiskLevel>(
    delivery.risks.map((r) => [r.projectId, r.level]),
  );

  const recentActivity = isInternal
    ? await db
        .select({
          event: schema.auditEvents,
          actorName: schema.users.name,
        })
        .from(schema.auditEvents)
        .leftJoin(schema.users, eq(schema.auditEvents.actorId, schema.users.id))
        .where(eq(schema.auditEvents.orgId, orgId))
        .orderBy(desc(schema.auditEvents.createdAt))
        .limit(8)
    : [];

  const stats = isInternal
    ? [
        { label: "Active projects", value: activeCount, href: "/projects" },
        { label: "Pending approvals", value: pendingApprovals, href: "/approvals" },
        { label: "Open tasks", value: openTasks, href: "/projects" },
        { label: "Failed jobs", value: failedJobs, href: "/ops" },
      ]
    : [{ label: "Projects", value: projects.length, href: "/projects" }];

  return (
    <div>
      <PageHeader
        title={`Welcome back, ${session.name.split(" ")[0]}`}
        subtitle={
          isInternal
            ? "Delivery status across your organization"
            : "Your implementation projects at a glance"
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="card p-4 hover:border-gray-300">
            <p className="text-2xl font-semibold text-gray-900">{s.value}</p>
            <p className="mt-1 text-sm text-gray-500">{s.label}</p>
          </Link>
        ))}
      </div>

      {isInternal && <DeliveryRiskPanel {...delivery} />}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <div className="border-b border-gray-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-900">Projects</h2>
          </div>
          <ul className="divide-y divide-gray-100">
            {projects.slice(0, 6).map(({ project, customerName }) => (
              <li key={project.id}>
                <Link
                  href={`/projects/${project.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-gray-50"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate text-sm font-medium text-gray-900">
                      <RiskDot level={riskByProject.get(project.id) ?? "on_track"} />
                      {project.name}
                    </p>
                    <p className="truncate text-xs text-gray-500">{customerName}</p>
                  </div>
                  <StatusBadge status={project.status} />
                </Link>
              </li>
            ))}
            {projects.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-gray-500">
                No projects yet.
              </li>
            )}
          </ul>
        </div>

        {isInternal && (
          <div className="card">
            <div className="border-b border-gray-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-900">
                Recent activity
              </h2>
            </div>
            <ul className="divide-y divide-gray-100">
              {recentActivity.map(({ event, actorName }) => (
                <li key={event.id} className="px-4 py-2.5">
                  <p className="text-xs font-medium text-gray-700">
                    {event.action.replace(/[._]/g, " ")}
                  </p>
                  <p className="text-xs text-gray-400">
                    {actorName ?? "System"} ·{" "}
                    {event.createdAt.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                </li>
              ))}
              {recentActivity.length === 0 && (
                <li className="px-4 py-8 text-center text-sm text-gray-500">
                  No activity yet.
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
