import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { getSession } from "@/lib/auth/session";
import { can, ROLE_LABELS, type Role } from "@/lib/auth/rbac";
import { PageHeader } from "@/components/PageHeader";

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

export default async function MembersPage() {
  const session = (await getSession())!;
  if (!can(session.role, "org.manage_members")) redirect("/dashboard");

  const members = await db
    .select({
      membership: schema.memberships,
      userName: schema.users.name,
      userEmail: schema.users.email,
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
    .where(eq(schema.memberships.orgId, session.orgId))
    .orderBy(asc(schema.memberships.createdAt));

  return (
    <div>
      <PageHeader
        title="Members"
        subtitle={`People with access to ${session.orgName}`}
      />

      <div className="card mb-6 overflow-x-auto">
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
                <td className="table-td font-medium text-gray-900">
                  {userName}
                </td>
                <td className="table-td">{userEmail}</td>
                <td className="table-td">{ROLE_LABELS[membership.role]}</td>
                <td className="table-td text-xs text-gray-500">
                  {membership.createdAt.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
