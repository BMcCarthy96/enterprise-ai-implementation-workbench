import { asc, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema, withTenantTransaction } from "@/db";
import { getSession } from "@/lib/auth/session";
import { can, ROLE_LABELS, type Role } from "@/lib/auth/rbac";
import { PageHeader } from "@/components/PageHeader";
import { TOUR_TARGETS } from "@/lib/tour";
import { SettingsNav } from "../SettingsNav";

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
  const enterpriseControls = can(session.role, "org.manage_identity")
    ? await withTenantTransaction(
        session.orgId,
        async () => {
          const identityConnections = await db.query.identityConnections.findMany({
            where: eq(schema.identityConnections.orgId, session.orgId),
            columns: {
              slug: true,
              issuerUrl: true,
              enabled: true,
              jitEnabled: true,
              allowedDomains: true,
              groupMappings: true,
              updatedAt: true,
            },
            orderBy: [asc(schema.identityConnections.slug)],
          });
          const scimTokens = await db.query.scimTokens.findMany({
            where: eq(schema.scimTokens.orgId, session.orgId),
            columns: { label: true, expiresAt: true, lastUsedAt: true, revokedAt: true, createdAt: true },
            orderBy: [desc(schema.scimTokens.createdAt)],
          });
          const directoryGroups = await db.query.directoryGroups.findMany({
            where: eq(schema.directoryGroups.orgId, session.orgId),
            columns: { externalId: true, displayName: true, mappedRole: true },
            orderBy: [asc(schema.directoryGroups.displayName)],
          });
          const retentionPolicy = await db.query.retentionPolicies.findFirst({
            where: eq(schema.retentionPolicies.orgId, session.orgId),
          });
          const lastRetentionRun = await db.query.retentionRuns.findFirst({
            where: eq(schema.retentionRuns.orgId, session.orgId),
            columns: { status: true, counts: true, startedAt: true, finishedAt: true },
            orderBy: [desc(schema.retentionRuns.startedAt)],
          });
          const webhookEndpoints = await db.query.webhookEndpoints.findMany({
            where: eq(schema.webhookEndpoints.orgId, session.orgId),
            columns: { url: true, eventTypes: true, enabled: true, updatedAt: true },
            orderBy: [asc(schema.webhookEndpoints.url)],
          });
          return { identityConnections, scimTokens, directoryGroups, retentionPolicy, lastRetentionRun, webhookEndpoints };
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
        className="card mb-6 scroll-mt-28 overflow-x-auto"
        data-tour-target={TOUR_TARGETS.membersAccess}
      >
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

      {enterpriseControls ? (
        <section className="mt-6 space-y-4" aria-labelledby="enterprise-controls">
          <div>
            <h2 id="enterprise-controls" className="text-lg font-semibold text-gray-900">
              Enterprise controls
            </h2>
            <p className="text-sm text-gray-500">
              Standards-ready identity, integration, and data-lifecycle controls. Secrets and bearer tokens are never displayed here.
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">OIDC connections</h3>
                <span className="badge badge-green">{enterpriseControls.identityConnections.length} configured</span>
              </div>
              {enterpriseControls.identityConnections.length === 0 ? (
                <p className="text-sm text-gray-500">No provider configured. Password login remains available.</p>
              ) : (
                <ul className="space-y-3">
                  {enterpriseControls.identityConnections.map((connection) => (
                    <li key={connection.slug} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium text-gray-800">{connection.slug}</span>
                        <span className={connection.enabled ? "badge badge-green" : "badge"}>{connection.enabled ? "Enabled" : "Disabled"}</span>
                      </div>
                      <p className="mt-1 truncate text-xs text-gray-500">{connection.issuerUrl}</p>
                      <p className="mt-2 text-xs text-gray-500">
                        {connection.jitEnabled ? "JIT provisioning on" : "SCIM-first provisioning"} · {Object.keys(connection.groupMappings).length} role mappings
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="card p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">SCIM lifecycle</h3>
                <span className="badge">{enterpriseControls.scimTokens.filter((token) => !token.revokedAt).length} active tokens</span>
              </div>
              <p className="text-xs text-gray-500">
                Base URL: <code>/api/scim/v2</code> · bearer tokens are hashed at rest and scoped to this organization.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {enterpriseControls.directoryGroups.map((group) => (
                  <span key={group.externalId} className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-700">
                    {group.displayName}: {group.mappedRole ? ROLE_LABELS[group.mappedRole] : "no access"}
                  </span>
                ))}
              </div>
              {enterpriseControls.scimTokens[0] ? (
                <p className="mt-3 text-xs text-gray-500">
                  Last token activity: {enterpriseControls.scimTokens[0].lastUsedAt?.toLocaleString() ?? "not used yet"}.
                </p>
              ) : null}
            </div>

            <div className="card p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">Retention policy</h3>
                <span className="badge badge-amber">Org admin</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="block text-xs text-gray-500">Audit events</span><strong>{enterpriseControls.retentionPolicy?.auditDays ?? 365} days</strong></div>
                <div><span className="block text-xs text-gray-500">AI detail</span><strong>{enterpriseControls.retentionPolicy?.aiDetailDays ?? 90} days</strong></div>
                <div><span className="block text-xs text-gray-500">Completed jobs</span><strong>{enterpriseControls.retentionPolicy?.completedJobDays ?? 30} days</strong></div>
                <div><span className="block text-xs text-gray-500">Webhook deliveries</span><strong>{enterpriseControls.retentionPolicy?.webhookDeliveryDays ?? 30} days</strong></div>
              </div>
              <p className="mt-3 text-xs text-gray-500">
                {enterpriseControls.lastRetentionRun
                  ? "Last run " + enterpriseControls.lastRetentionRun.status + " · " + (enterpriseControls.lastRetentionRun.finishedAt?.toLocaleString() ?? "in progress")
                  : "No scheduled retention run recorded yet."}
              </p>
            </div>

            <div className="card p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">Outbound webhooks</h3>
                <span className="badge">{enterpriseControls.webhookEndpoints.filter((endpoint) => endpoint.enabled).length} enabled</span>
              </div>
              {enterpriseControls.webhookEndpoints.length === 0 ? (
                <p className="text-sm text-gray-500">No endpoints registered. Events remain internal and audited.</p>
              ) : (
                <ul className="space-y-2">
                  {enterpriseControls.webhookEndpoints.map((endpoint) => (
                    <li key={endpoint.url} className="flex items-start justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-gray-800">{endpoint.url}</p>
                        <p className="text-xs text-gray-500">{endpoint.eventTypes.join(" · ")}</p>
                      </div>
                      <span className={endpoint.enabled ? "badge badge-green" : "badge"}>{endpoint.enabled ? "On" : "Off"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
