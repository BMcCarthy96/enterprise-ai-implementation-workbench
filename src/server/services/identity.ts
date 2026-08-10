import { and, eq } from "drizzle-orm";
import { db, dbAdmin, schema } from "@/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import type { Role } from "@/lib/auth/rbac";

export interface IdentityConnectionInput {
  slug: string;
  issuerUrl: string;
  clientId: string;
  clientSecret?: string;
  enabled?: boolean;
  jitEnabled?: boolean;
  allowedDomains?: string[];
  groupMappings?: Record<string, Role>;
}

export async function listIdentityConnections(orgId: string) {
  return db.query.identityConnections.findMany({
    where: eq(schema.identityConnections.orgId, orgId),
    columns: { id: true, slug: true, issuerUrl: true, clientId: true, enabled: true, jitEnabled: true, allowedDomains: true, groupMappings: true, createdAt: true, updatedAt: true },
  });
}

export async function createIdentityConnection(orgId: string, createdBy: string, input: IdentityConnectionInput) {
  const inserted = await db.insert(schema.identityConnections).values({
    orgId,
    createdBy,
    slug: input.slug,
    issuerUrl: input.issuerUrl,
    clientId: input.clientId,
    clientSecretCiphertext: input.clientSecret ? encryptSecret(input.clientSecret, orgId + ":oidc:" + input.slug) : null,
    enabled: input.enabled ?? false,
    jitEnabled: input.jitEnabled ?? false,
    allowedDomains: input.allowedDomains ?? [],
    groupMappings: input.groupMappings ?? {},
  }).returning({ id: schema.identityConnections.id });
  return inserted[0];
}

export async function updateIdentityConnection(
  orgId: string,
  connectionId: string,
  input: Partial<Omit<IdentityConnectionInput, "slug">>,
) {
  const current = await db.query.identityConnections.findFirst({
    where: and(eq(schema.identityConnections.id, connectionId), eq(schema.identityConnections.orgId, orgId)),
  });
  if (!current) return null;
  const update: Partial<typeof schema.identityConnections.$inferInsert> = {
    issuerUrl: input.issuerUrl,
    clientId: input.clientId,
    enabled: input.enabled,
    jitEnabled: input.jitEnabled,
    allowedDomains: input.allowedDomains,
    groupMappings: input.groupMappings,
    updatedAt: new Date(),
  };
  if (input.clientSecret) {
    update.clientSecretCiphertext = encryptSecret(input.clientSecret, orgId + ":oidc:" + current.slug);
  }
  const [updated] = await db.update(schema.identityConnections)
    .set(Object.fromEntries(Object.entries(update).filter(([, value]) => value !== undefined)))
    .where(and(eq(schema.identityConnections.id, connectionId), eq(schema.identityConnections.orgId, orgId)))
    .returning({
      id: schema.identityConnections.id,
      slug: schema.identityConnections.slug,
      issuerUrl: schema.identityConnections.issuerUrl,
      clientId: schema.identityConnections.clientId,
      enabled: schema.identityConnections.enabled,
      jitEnabled: schema.identityConnections.jitEnabled,
      allowedDomains: schema.identityConnections.allowedDomains,
      groupMappings: schema.identityConnections.groupMappings,
      createdAt: schema.identityConnections.createdAt,
      updatedAt: schema.identityConnections.updatedAt,
    });
  return updated ?? null;
}

export async function disableIdentityConnection(orgId: string, connectionId: string) {
  const [updated] = await db.update(schema.identityConnections)
    .set({ enabled: false, updatedAt: new Date() })
    .where(and(eq(schema.identityConnections.id, connectionId), eq(schema.identityConnections.orgId, orgId)))
    .returning({ id: schema.identityConnections.id });
  return updated ?? null;
}

export async function findPublicConnection(slug: string) {
  const rows = await dbAdmin
    .select({ connection: schema.identityConnections, org: schema.organizations })
    .from(schema.identityConnections)
    .innerJoin(schema.organizations, eq(schema.identityConnections.orgId, schema.organizations.id))
    .where(and(eq(schema.identityConnections.slug, slug), eq(schema.identityConnections.enabled, true)));
  if (rows.length !== 1) return null;
  return rows[0];
}

export function connectionSecret(connection: typeof schema.identityConnections.$inferSelect): string | undefined {
  return connection.clientSecretCiphertext
    ? decryptSecret(connection.clientSecretCiphertext, connection.orgId + ":oidc:" + connection.slug)
    : undefined;
}

export async function identityForSubject(connectionId: string, subject: string) {
  return dbAdmin.query.externalIdentities.findFirst({
    where: and(eq(schema.externalIdentities.connectionId, connectionId), eq(schema.externalIdentities.subject, subject)),
  });
}
