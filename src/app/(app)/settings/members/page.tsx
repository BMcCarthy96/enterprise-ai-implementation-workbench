import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema, withTenantTransaction } from "@/db";
import { getSession } from "@/lib/auth/session";
import { can, ROLE_LABELS, type Role } from "@/lib/auth/rbac";
import { PageHeader } from "@/components/PageHeader";
import { TOUR_TARGETS } from "@/lib/tour";
import { SettingsNav } from "../SettingsNav";
import { CustomerAssignmentsPanel } from "./CustomerAssignmentsPanel";

export const dynamic = "force-dynamic";

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  org_admin:
    "Full control: members, projects, approvals, operations, and audit history.",
  implementation_manager:
    "Owns delivery. Manages projects and tasks, and is the approval checkpoint for AI-generated plans and customer updates.",
  solutions_engineer:
    "Does the build work: captures requirements, generates plans, works the task board, drafts updates. Cannot approve.",
  customer_stakeholder:
    "External, read-only: sees project status and published updates only.",
};

function formatJoinedDate(date: Date) {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function MembersPage() {
  const session = (await getSession())!;
  if (!can(session.role, "org.manage_members")) redirect("/dashboard");

  const members = await withTenantTransaction(
    session.orgId,
    () =>
      db
        .select({
          membership: schema.memberships,
          userName: schema.users.name,
          userEmail: schema.users.email,
        })
        .from(schema.memberships)
        .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
        .where(eq(schema.memberships.orgId, session.orgId))
        .orderBy(asc(schema.memberships.createdAt)),
    session.userId,
  );
  const customerAccess = can(session.role, "org.manage_members")
    ? await withTenantTransaction(
        session.orgId,
        async () => {
          const customers = await db.query.customers.findMany({
            where: eq(schema.customers.orgId, session.orgId),
            columns: { id: true, name: true },
            orderBy: [asc(schema.customers.name)],
          });
          const assignments = await db
            .select({
              id: schema.customerAssignments.id,
              userId: schema.customerAssignments.userId,
              userName: schema.users.name,
              userEmail: schema.users.email,
              customerId: schema.customerAssignments.customerId,
              customerName: schema.customers.name,
            })
            .from(schema.customerAssignments)
            .innerJoin(schema.users, eq(schema.customerAssignments.userId, schema.users.id))
            .innerJoin(schema.customers, eq(schema.customerAssignments.customerId, schema.customers.id))
            .where(eq(schema.customerAssignments.orgId, session.orgId))
            .orderBy(asc(schema.customers.name), asc(schema.users.name));
          return { customers, assignments };
        },
        session.userId,
      )
    : null;

  return (
    <div>
      <PageHeader
        title="Members"
        subtitle={`People with access to ${session.orgName}`}
      />
      <SettingsNav active="/settings/members" />

      <div
        className="card mb-6 scroll-mt-28 overflow-hidden"
        data-tour-target={TOUR_TARGETS.membersAccess}
      >
        <ul className="divide-y divide-gray-100 sm:hidden" data-testid="mobile-member-list">
          {members.map(({ membership, userName, userEmail }) => (
            <li key={membership.id} className="p-4">
              <p className="font-medium text-gray-900">{userName}</p>
              <p className="mt-1 break-all text-sm text-gray-600">{userEmail}</p>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Role</dt>
                  <dd className="mt-1 text-gray-800">{ROLE_LABELS[membership.role]}</dd>
                </div>
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Joined</dt>
                  <dd className="mt-1 text-gray-800">{formatJoinedDate(membership.createdAt)}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
        <div className="hidden overflow-x-auto sm:block">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="table-th">Name</th>
                <th className="table-th">Email</th>
                <th className="table-th">Role</th>
                <th className="table-th">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {members.map(({ membership, userName, userEmail }) => (
                <tr key={membership.id}>
                  <td className="table-td font-medium text-gray-900">{userName}</td>
                  <td className="table-td">{userEmail}</td>
                  <td className="table-td">{ROLE_LABELS[membership.role]}</td>
                  <td className="table-td text-xs text-gray-500">
                    {formatJoinedDate(membership.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {customerAccess ? (
        <div className="mb-6">
          <CustomerAssignmentsPanel
            members={members
              .filter(({ membership }) => membership.role === "customer_stakeholder" && membership.active)
              .map(({ membership, userName, userEmail }) => ({ id: membership.userId, label: userName, detail: userEmail }))}
            customers={customerAccess.customers.map((customer) => ({ id: customer.id, label: customer.name }))}
            initialAssignments={customerAccess.assignments}
          />
        </div>
      ) : null}

      <div className="card p-5">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">
          Role permissions
        </h2>
        <dl className="space-y-3">
          {(Object.keys(ROLE_DESCRIPTIONS) as Role[]).map((role) => (
            <div key={role}>
              <dt className="text-sm font-medium text-gray-800">
                {ROLE_LABELS[role]}
              </dt>
              <dd className="text-sm text-gray-500">
                {ROLE_DESCRIPTIONS[role]}
              </dd>
            </div>
          ))}
        </dl>
      </div>

    </div>
  );
}
