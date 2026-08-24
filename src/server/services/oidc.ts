import {
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  ClientSecretPost,
  discovery,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
} from "openid-client";
import { and, eq } from "drizzle-orm";
import { dbAdmin, schema } from "@/db";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { createSessionToken, type SessionPayload } from "@/lib/auth/session";
import { findPublicConnection, connectionSecret, identityForSubject } from "@/server/services/identity";
import type { Role } from "@/lib/auth/rbac";
import { assertSafeWebhookTarget, isBlockedHost } from "@/server/services/webhooks";

const STATE_COOKIE = "workbench_oidc_state";
const CALLBACK_PATH = "/api/auth/oidc/callback";

async function assertSafeIssuerUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("OIDC issuer URL is invalid");
  }
  const localDevelopment =
    process.env.NODE_ENV !== "production" &&
    ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localDevelopment) {
    throw new Error("OIDC issuer URL must use HTTPS");
  }
  if (url.username || url.password || isBlockedHost(url.hostname) && !localDevelopment) {
    throw new Error("OIDC issuer URL points to a private or credentialed host");
  }
  if (localDevelopment) return url;
  await Promise.race([
    assertSafeWebhookTarget(url),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("OIDC issuer validation timed out")), 3_000)),
  ]);
  return url;
}

export function oidcStateCookieName() {
  return STATE_COOKIE;
}

export async function createAuthorizationRequest(input: { connectionSlug: string; returnTo: string; origin: string }) {
  const found = await findPublicConnection(input.connectionSlug);
  if (!found) throw new Error("OIDC connection is unavailable");
  const connection = found.connection;
  const verifier = randomPKCECodeVerifier();
  const challenge = await calculatePKCECodeChallenge(verifier);
  const state = randomState();
  const nonce = randomNonce();
  const config = await discovery(await assertSafeIssuerUrl(connection.issuerUrl), connection.clientId, undefined, connectionSecret(connection) ? ClientSecretPost(connectionSecret(connection)) : undefined);
  const redirectUri = new URL(CALLBACK_PATH, input.origin).toString();
  const url = buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    scope: "openid profile email",
    response_type: "code",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  const statePayload = encryptSecret(JSON.stringify({ state, nonce, verifier, connectionSlug: input.connectionSlug, returnTo: safeReturnTo(input.returnTo) }), "oidc-state");
  return { url, statePayload };
}

export async function finishAuthorizationRequest(input: { requestUrl: URL; statePayload: string; origin: string }) {
  const state = JSON.parse(decryptSecret(input.statePayload, "oidc-state")) as { state: string; nonce: string; verifier: string; connectionSlug: string; returnTo: string };
  const found = await findPublicConnection(state.connectionSlug);
  if (!found) throw new Error("OIDC connection is unavailable");
  const connection = found.connection;
  const config = await discovery(await assertSafeIssuerUrl(connection.issuerUrl), connection.clientId, undefined, connectionSecret(connection) ? ClientSecretPost(connectionSecret(connection)) : undefined);
  const tokens = await authorizationCodeGrant(config, input.requestUrl, { pkceCodeVerifier: state.verifier, expectedState: state.state, expectedNonce: state.nonce, idTokenExpected: true });
  const claims = tokens.claims();
  if (!claims?.sub) throw new Error("OIDC provider did not return a subject");
  const email = typeof claims.email === "string" ? claims.email.toLowerCase() : "";
  if (!email || claims.email_verified === false) throw new Error("OIDC provider did not return a verified email");
  const existingIdentity = await identityForSubject(connection.id, claims.sub);
  let userId = existingIdentity?.userId;
  if (!userId) {
    const existingUser = await dbAdmin.query.users.findFirst({ where: eq(schema.users.email, email) });
    if (existingUser) userId = existingUser.id;
    if (!userId && connection.jitEnabled && domainAllowed(email, connection.allowedDomains)) {
      const mappedRole = mappedRoleFromClaims(connection.groupMappings, claims);
      const inserted = await dbAdmin.insert(schema.users).values({ email, name: displayName(claims, email), passwordHash: null }).returning({ id: schema.users.id });
      userId = inserted[0].id;
      await dbAdmin.insert(schema.memberships).values({ userId, orgId: connection.orgId, role: mappedRole ?? "customer_stakeholder", active: true, sessionVersion: 1 });
    }
  }
  if (!userId) throw new Error("This account has not been provisioned for the organization");
  let membership = await dbAdmin.query.memberships.findFirst({ where: and(eq(schema.memberships.orgId, connection.orgId), eq(schema.memberships.userId, userId)) });
  if (!membership || !membership.active) throw new Error("Your organization access is suspended");
  const mappedRole = mappedRoleFromClaims(connection.groupMappings, claims);
  if (mappedRole && membership.role !== mappedRole) {
    const [updated] = await dbAdmin.update(schema.memberships)
      .set({ role: mappedRole, sessionVersion: membership.sessionVersion + 1 })
      .where(and(eq(schema.memberships.id, membership.id), eq(schema.memberships.orgId, connection.orgId)))
      .returning();
    if (updated) membership = updated;
  }
  const user = await dbAdmin.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!user) throw new Error("User account is unavailable");
  if (existingIdentity) {
    await dbAdmin.update(schema.externalIdentities).set({ email, lastLoginAt: new Date() }).where(eq(schema.externalIdentities.id, existingIdentity.id));
  } else {
    await dbAdmin.insert(schema.externalIdentities).values({ orgId: connection.orgId, userId, connectionId: connection.id, subject: claims.sub, email, lastLoginAt: new Date() });
  }
  const payload: SessionPayload = { userId: user.id, email: user.email, name: user.name, orgId: connection.orgId, orgName: found.org.name, role: membership.role, membershipId: membership.id, sessionVersion: membership.sessionVersion };
  return { token: await createSessionToken(payload), returnTo: safeReturnTo(state.returnTo) };
}

function displayName(claims: Record<string, unknown>, email: string) {
  return typeof claims.name === "string" && claims.name.trim() ? claims.name : email.split("@")[0];
}

function domainAllowed(email: string, domains: string[]) {
  const domain = email.split("@")[1]?.toLowerCase();
  return Boolean(domain && domains.some((allowed) => allowed.toLowerCase() === domain));
}

const OIDC_ROLES: ReadonlySet<Role> = new Set([
  "org_admin",
  "implementation_manager",
  "solutions_engineer",
  "customer_stakeholder",
]);

/** Resolve one unambiguous Workbench role from an IdP's `groups` claim. */
export function mappedRoleFromClaims(
  mappings: Record<string, Role> | null | undefined,
  claims: Record<string, unknown>,
): Role | null {
  if (!mappings || typeof mappings !== "object") return null;
  const groups = Array.isArray(claims.groups)
    ? claims.groups.filter((value): value is string => typeof value === "string")
    : [];
  const roles = Array.from(new Set(groups.map((group) => mappings[group]).filter((role): role is Role => Boolean(role && OIDC_ROLES.has(role)))));
  if (roles.length > 1) throw new Error("OIDC role mapping is ambiguous");
  return roles[0] ?? null;
}

export function safeReturnTo(value: string | null | undefined) {
  const candidate = typeof value === "string" ? value.split(/[?#]/, 1)[0] : "";
  return candidate.startsWith("/") && !candidate.startsWith("//") ? candidate : "/dashboard";
}

export { STATE_COOKIE };
