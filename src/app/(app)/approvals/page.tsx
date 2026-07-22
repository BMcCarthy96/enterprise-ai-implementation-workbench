import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { ApprovalActions } from "./ApprovalActions";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const session = (await getSession())!;
  const canDecide = can(session.role, "approvals.decide");

  const pending = await db
    .select({
      approval: schema.approvals,
      projectName: schema.projects.name,
    })
    .from(schema.approvals)
    .leftJoin(
      schema.projects,
      eq(schema.approvals.projectId, schema.projects.id),
    )
    .where(
      and(
        eq(schema.approvals.orgId, session.orgId),
        eq(schema.approvals.status, "pending"),
      ),
    )
    .orderBy(desc(schema.approvals.createdAt));

  // Load subject previews.
  const planIds = pending
    .filter((p) => p.approval.subjectType === "plan")
    .map((p) => p.approval.subjectId);
  const updateIds = pending
    .filter((p) => p.approval.subjectType === "customer_update")
    .map((p) => p.approval.subjectId);

  const plans = planIds.length
    ? await db.query.plans.findMany({
        where: inArray(schema.plans.id, planIds),
      })
    : [];
  const updates = updateIds.length
    ? await db.query.customerUpdates.findMany({
        where: inArray(schema.customerUpdates.id, updateIds),
      })
    : [];

  const recentDecisions = await db
    .select({
      approval: schema.approvals,
      projectName: schema.projects.name,
      deciderName: schema.users.name,
    })
    .from(schema.approvals)
    .leftJoin(
      schema.projects,
      eq(schema.approvals.projectId, schema.projects.id),
    )
    .leftJoin(schema.users, eq(schema.approvals.decidedBy, schema.users.id))
    .where(
      and(
        eq(schema.approvals.orgId, session.orgId),
        inArray(schema.approvals.status, ["approved", "rejected"]),
      ),
    )
    .orderBy(desc(schema.approvals.decidedAt))
    .limit(10);

  return (
    <div>
      <PageHeader
        title="Approvals"
        subtitle="Human review checkpoint for AI-generated plans and customer communications"
      />

      {pending.length === 0 ? (
        <EmptyState
          title="Nothing waiting for review"
          hint="AI-generated implementation plans and customer updates appear here before they take effect."
        />
      ) : (
        <div className="space-y-4">
          {pending.map(({ approval, projectName }) => {
            const plan = plans.find((p) => p.id === approval.subjectId);
            const update = updates.find((u) => u.id === approval.subjectId);
            return (
              <div key={approval.id} className="card p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">
                      {approval.subjectType === "plan"
                        ? `Implementation plan${plan ? ` v${plan.version}` : ""}`
                        : "Customer update"}
                      {projectName && (
                        <span className="font-normal text-gray-500">
                          {" "}
                          · {projectName}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-gray-400">
                      Requested{" "}
                      {approval.createdAt.toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </p>
                  </div>
                  <StatusBadge status="pending" />
                </div>

                {plan && (
                  <div className="mb-4 rounded-md bg-gray-50 p-3">
                    <p className="text-sm leading-relaxed text-gray-600">
                      {plan.summary}
                    </p>
                    {approval.projectId && (
                      <a
                        href={`/projects/${approval.projectId}/plan`}
                        className="mt-2 inline-block text-xs font-medium text-indigo-600 hover:text-indigo-800"
                      >
                        Review full plan →
                      </a>
                    )}
                  </div>
                )}
                {update && (
                  <div className="mb-4 max-h-48 overflow-y-auto rounded-md bg-gray-50 p-3">
                    <p className="mb-1 text-sm font-medium text-gray-800">
                      {update.title}
                    </p>
                    <div className="space-y-2 text-sm leading-relaxed text-gray-600">
                      {update.body.split("\n\n").map((p, i) => (
                        <p key={i}>{p}</p>
                      ))}
                    </div>
                  </div>
                )}

                {canDecide ? (
                  <ApprovalActions
                    approvalId={approval.id}
                    subjectType={approval.subjectType}
                  />
                ) : (
                  <p className="text-xs text-gray-400">
                    Awaiting a decision from an implementation manager.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {recentDecisions.length > 0 && (
        <div className="card mt-8">
          <div className="border-b border-gray-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-900">
              Recent decisions
            </h2>
          </div>
          <ul className="divide-y divide-gray-100">
            {recentDecisions.map(({ approval, projectName, deciderName }) => (
              <li
                key={approval.id}
                className="flex items-center justify-between gap-3 px-4 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-gray-700">
                    {approval.subjectType === "plan"
                      ? "Implementation plan"
                      : "Customer update"}
                    {projectName && ` · ${projectName}`}
                  </p>
                  <p className="truncate text-xs text-gray-400">
                    {deciderName ?? "—"}
                    {approval.reasonCode && ` · ${approval.reasonCode.replace(/_/g, " ")}`}
                    {approval.note && ` · "${approval.note}"`}
                  </p>
                </div>
                <StatusBadge status={approval.status} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
