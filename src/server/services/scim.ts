import { createHash } from "node:crypto";
import { and, asc, count, eq, inArray, or } from "drizzle-orm";
import { dbAdmin, schema } from "@/db";
import { hashSecret } from "@/lib/crypto";
import type { Role } from "@/lib/auth/rbac";

export const SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
export const SCIM_GROUP_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Group";
export const SCIM_LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
export const SCIM_ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";

const ROLE_GROUPS: Record<string, Role> = {
  "Workbench Admins": "org_admin",
  "Implementation Managers": "implementation_manager",
  "Solutions Engineers": "solutions_engineer",
  "Customer Stakeholders": "customer_stakeholder",
};

export interface ScimContext {
  orgId: string;
  tokenId: string;
}

async function auditScim(orgId: string, action: string, subjectType: string, subjectId: string, metadata: Record<string, unknown> = {}) {
  await dbAdmin.insert(schema.auditEvents).values({
    orgId,
    actorId: null,
    action,
    subjectType,
    subjectId,
    metadata: { scim: true, ...metadata },
  });
}

export function scimError(status: number, detail: string, scimType?: string) {
  return { schemas: [SCIM_ERROR_SCHEMA], status: String(status), detail, ...(scimType ? { scimType } : {}) };
}

export async function authorizeScim(request: Request): Promise<ScimContext | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  const row = await dbAdmin.query.scimTokens.findFirst({ where: eq(schema.scimTokens.tokenHash, hashSecret(token)) });
  if (!row || row.revokedAt || (row.expiresAt && row.expiresAt <= new Date())) return null;
  await dbAdmin.update(schema.scimTokens).set({ lastUsedAt: new Date() }).where(eq(schema.scimTokens.id, row.id));
  return { orgId: row.orgId, tokenId: row.id };
}

export function resourceLocation(request: Request, resource: string, id: string) {
  return new URL("/api/scim/v2/" + resource + "/" + id, request.url).toString();
}

export function resourceEtag(parts: Array<string | number | boolean | null | undefined>): string {
  return '"' + createHash("sha256").update(parts.map((part) => String(part ?? "")).join("|")).digest("hex").slice(0, 24) + '"';
}

function roleForGroup(displayName: string): Role | null {
  return ROLE_GROUPS[displayName] ?? null;
}

async function membershipForUser(orgId: string, userId: string) {
  return dbAdmin.query.memberships.findFirst({ where: and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, userId)) });
}

export async function userResource(request: Request, orgId: string, user: typeof schema.users.$inferSelect) {
  const membership = await membershipForUser(orgId, user.id);
  return {
    schemas: [SCIM_USER_SCHEMA],
    id: user.id,
    externalId: user.externalId ?? undefined,
    userName: user.email,
    displayName: user.name,
    name: { formatted: user.name },
    emails: [{ value: user.email, type: "work", primary: true }],
    active: membership?.active ?? false,
    groups: membership?.active ? [{ value: membership.id, display: membership.role }] : [],
    meta: { resourceType: "User", created: user.createdAt.toISOString(), lastModified: user.createdAt.toISOString(), location: resourceLocation(request, "Users", user.id) },
  };
}

export async function listScimUsers(request: Request, orgId: string, startIndex: number, countLimit: number, filter?: string) {
  const normalizedFilter = filter?.match(/^\s*(userName|externalId)\s+eq\s+"([^"]+)"\s*$/i);
  const filterColumn = normalizedFilter?.[1].toLowerCase();
  const filterValue = normalizedFilter?.[2];
  const where = filterColumn === "externalid" && filterValue
    ? eq(schema.users.externalId, filterValue)
    : filterColumn === "username" && filterValue
      ? eq(schema.users.email, filterValue.toLowerCase())
      : undefined;
  const memberships = await dbAdmin.query.memberships.findMany({
    where: eq(schema.memberships.orgId, orgId),
    columns: { userId: true },
  });
  const scopedUserIds = memberships.map((membership) => membership.userId);
  const orgScope = scopedUserIds.length
    ? or(eq(schema.users.scimOrgId, orgId), inArray(schema.users.id, scopedUserIds))
    : eq(schema.users.scimOrgId, orgId);
  const scopedWhere = where ? and(orgScope, where) : orgScope;
  const totalRow = await dbAdmin.select({ value: count() }).from(schema.users).where(scopedWhere);
  const rows = await dbAdmin.query.users.findMany({ where: scopedWhere, orderBy: [asc(schema.users.createdAt)], limit: countLimit, offset: Math.max(startIndex - 1, 0) });
  return { schemas: [SCIM_LIST_SCHEMA], totalResults: Number(totalRow[0]?.value ?? 0), startIndex, itemsPerPage: rows.length, Resources: await Promise.all(rows.map((user) => userResource(request, orgId, user))) };
}

export async function findScimUser(orgId: string, id: string) {
  const user = await dbAdmin.query.users.findFirst({ where: eq(schema.users.id, id) });
  if (!user) return null;
  const membership = await membershipForUser(orgId, id);
  if (membership || user.scimOrgId === orgId) return user;
  return null;
}

export async function resolveMappedRole(orgId: string, groupIds: string[] | undefined): Promise<Role | null> {
  if (!groupIds || groupIds.length === 0) return null;
  const groups = await dbAdmin.query.directoryGroups.findMany({ where: and(eq(schema.directoryGroups.orgId, orgId), or(...groupIds.map((id) => eq(schema.directoryGroups.externalId, id)))) });
  const roles = Array.from(new Set(groups.map((group) => group.mappedRole).filter((role): role is Role => Boolean(role))));
  if (roles.length > 1) throw new Error("SCIM role mapping is ambiguous");
  return roles[0] ?? null;
}

export async function createScimUser(orgId: string, input: Record<string, unknown>) {
  const email = typeof input.userName === "string" ? input.userName.toLowerCase() : "";
  if (!email || !email.includes("@")) throw new Error("userName must be an email address");
  const existing = await dbAdmin.query.users.findFirst({ where: eq(schema.users.email, email) });
  if (existing) throw new Error("A user with this userName already exists");
  const displayName = typeof input.displayName === "string" && input.displayName.trim() ? input.displayName.trim() : email;
  const externalId = typeof input.externalId === "string" ? input.externalId : null;
  const active = input.active !== false;
  const groups = Array.isArray(input.groups) ? input.groups.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object")) : [];
  const groupIds = groups.map((group) => typeof group.value === "string" ? group.value : "").filter(Boolean);
  const role = await resolveMappedRole(orgId, groupIds);
  const inserted = await dbAdmin.insert(schema.users).values({ email, name: displayName, externalId, scimOrgId: orgId, passwordHash: null }).returning();
  const user = inserted[0];
  if (role) await dbAdmin.insert(schema.memberships).values({ userId: user.id, orgId, role, active, sessionVersion: 1 });
  await auditScim(orgId, "scim.user_provisioned", "user", user.id, { mappedRole: role, active });
  return user;
}

export async function updateScimUser(orgId: string, id: string, input: Record<string, unknown>, replace = false) {
  const user = await findScimUser(orgId, id);
  if (!user) return null;
  const email = typeof input.userName === "string" ? input.userName.toLowerCase() : replace ? user.email : undefined;
  const name = typeof input.displayName === "string" && input.displayName.trim() ? input.displayName.trim() : replace ? user.name : undefined;
  const externalId = typeof input.externalId === "string" ? input.externalId : replace ? null : undefined;
  const userUpdate: { email?: string; name?: string; externalId?: string | null } = {};
  if (email !== undefined) userUpdate.email = email;
  if (name !== undefined) userUpdate.name = name;
  if (externalId !== undefined) userUpdate.externalId = externalId;
  if (Object.keys(userUpdate).length > 0) await dbAdmin.update(schema.users).set(userUpdate).where(eq(schema.users.id, id));
  const membership = await membershipForUser(orgId, id);
  const active = typeof input.active === "boolean" ? input.active : replace ? true : undefined;
  if (membership && active !== undefined && membership.active !== active) {
    await dbAdmin.update(schema.memberships).set({ active, sessionVersion: membership.sessionVersion + 1 }).where(eq(schema.memberships.id, membership.id));
  }
  const updated = (await dbAdmin.query.users.findFirst({ where: eq(schema.users.id, id) })) ?? user;
  await auditScim(orgId, "scim.user_updated", "user", id, { active: membership?.active ?? active ?? null });
  return updated;
}

export async function deleteScimUser(orgId: string, id: string): Promise<boolean> {
  const membership = await membershipForUser(orgId, id);
  if (!membership) return false;
  await dbAdmin.update(schema.memberships).set({ active: false, sessionVersion: membership.sessionVersion + 1 }).where(eq(schema.memberships.id, membership.id));
  await auditScim(orgId, "scim.user_deprovisioned", "user", id, { active: false });
  return true;
}

export async function groupResource(request: Request, orgId: string, group: typeof schema.directoryGroups.$inferSelect) {
  const members = group.mappedRole ? await dbAdmin.query.memberships.findMany({ where: and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.role, group.mappedRole)) }) : [];
  return { schemas: [SCIM_GROUP_SCHEMA], id: group.externalId, displayName: group.displayName, members: members.map((membership) => ({ value: membership.userId, display: membership.userId, type: "User" })), meta: { resourceType: "Group", location: resourceLocation(request, "Groups", group.externalId) } };
}

export async function listScimGroups(request: Request, orgId: string) {
  const groups = await dbAdmin.query.directoryGroups.findMany({ where: eq(schema.directoryGroups.orgId, orgId), orderBy: [asc(schema.directoryGroups.displayName)] });
  return { schemas: [SCIM_LIST_SCHEMA], totalResults: groups.length, startIndex: 1, itemsPerPage: groups.length, Resources: await Promise.all(groups.map((group) => groupResource(request, orgId, group))) };
}

export async function upsertScimGroup(orgId: string, input: Record<string, unknown>) {
  const displayName = typeof input.displayName === "string" ? input.displayName.trim() : "";
  const externalId = typeof input.id === "string" && input.id ? input.id : crypto.randomUUID();
  if (!displayName) throw new Error("displayName is required");
  const mappedRole = roleForGroup(displayName);
  const existing = await dbAdmin.query.directoryGroups.findFirst({ where: and(eq(schema.directoryGroups.orgId, orgId), eq(schema.directoryGroups.externalId, externalId)) });
  if (existing) throw new Error("A group with this id already exists");
  const inserted = await dbAdmin.insert(schema.directoryGroups).values({ orgId, externalId, displayName, mappedRole }).returning();
  await auditScim(orgId, "scim.group_created", "directory_group", externalId, { displayName, mappedRole });
  return inserted[0];
}

export async function patchScimGroup(orgId: string, externalId: string, operations: unknown[]) {
  const group = await dbAdmin.query.directoryGroups.findFirst({ where: and(eq(schema.directoryGroups.orgId, orgId), eq(schema.directoryGroups.externalId, externalId)) });
  if (!group) return null;

  // Validate every role-changing member before mutating any membership. An
  // IdP can send several operations in one PATCH; rejecting the whole request
  // avoids a half-applied group update when one user is already mapped to a
  // different Workbench role.
  if (group.mappedRole) {
    const additions = new Set<string>();
    for (const raw of operations) {
      if (!raw || typeof raw !== "object") continue;
      const operation = raw as { op?: string; value?: unknown };
      if (operation.op?.toLowerCase() === "remove") continue;
      const members = Array.isArray(operation.value) ? operation.value : operation.value && typeof operation.value === "object" ? [operation.value] : [];
      for (const member of members) {
        const userId = member && typeof member === "object" && "value" in member && typeof member.value === "string" ? member.value : null;
        if (userId) additions.add(userId);
      }
    }
    for (const userId of additions) {
      const user = await dbAdmin.query.users.findFirst({ where: eq(schema.users.id, userId), columns: { id: true } });
      if (!user) throw new Error("SCIM user not found");
      const membership = await membershipForUser(orgId, userId);
      if (membership && membership.role !== group.mappedRole) throw new Error("SCIM role mapping is ambiguous");
    }
  }

  for (const raw of operations) {
    if (!raw || typeof raw !== "object") continue;
    const operation = raw as { op?: string; value?: unknown };
    const members = Array.isArray(operation.value) ? operation.value : operation.value && typeof operation.value === "object" ? [operation.value] : [];
    for (const member of members) {
      const userId = member && typeof member === "object" && "value" in member && typeof member.value === "string" ? member.value : null;
      if (!userId || !group.mappedRole) continue;
      const membership = await membershipForUser(orgId, userId);
      if (operation.op?.toLowerCase() === "remove") {
        if (membership && membership.role === group.mappedRole) await dbAdmin.update(schema.memberships).set({ active: false, sessionVersion: membership.sessionVersion + 1 }).where(eq(schema.memberships.id, membership.id));
      } else if (!membership) {
        await dbAdmin.insert(schema.memberships).values({ userId, orgId, role: group.mappedRole, active: true, sessionVersion: 1 });
      } else if (membership.role !== group.mappedRole) {
        throw new Error("SCIM role mapping is ambiguous");
      } else {
        await dbAdmin.update(schema.memberships).set({ active: true, sessionVersion: membership.sessionVersion + 1 }).where(eq(schema.memberships.id, membership.id));
      }
    }
  }
  await auditScim(orgId, "scim.group_membership_changed", "directory_group", externalId, { operationCount: operations.length });
  return group;
}

export async function findScimGroup(orgId: string, externalId: string) {
  return dbAdmin.query.directoryGroups.findFirst({
    where: and(eq(schema.directoryGroups.orgId, orgId), eq(schema.directoryGroups.externalId, externalId)),
  });
}
