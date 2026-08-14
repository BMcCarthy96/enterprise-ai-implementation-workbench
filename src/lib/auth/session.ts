import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db, schema, withTenantTransaction } from "@/db";
import { env } from "@/lib/env";
import { withSpan } from "@/lib/telemetry";
import type { Role } from "./rbac";

/**
 * An HS256 JWT in an httpOnly cookie carries the active organization and role.
 * Protected requests also compare its membership version with PostgreSQL so
 * SCIM suspension and role changes invalidate an existing token immediately.
 * The JWT boundary remains swappable for Cognito-issued tokens.
 */

export const SESSION_COOKIE = "workbench_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours

export interface SessionPayload {
  userId: string;
  email: string;
  name: string;
  orgId: string;
  orgName: string;
  role: Role;
  /** Added for immediate SCIM deprovisioning; legacy sessions omit these. */
  membershipId?: string;
  sessionVersion?: number;
  demoWorkspaceId?: string;
  demoExpiresAt?: string;
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(env().SESSION_SECRET);
}

export async function createSessionToken(
  payload: SessionPayload,
  ttlSeconds = SESSION_TTL_SECONDS,
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secretKey());
}

export async function verifySessionToken(
  token: string,
): Promise<SessionPayload | null> {
  return withSpan(
    "auth.verify_session",
    { "workbench.session_present": Boolean(token) },
    async () => {
      try {
        const { payload } = await jwtVerify(token, secretKey());
        return payload as unknown as SessionPayload;
      } catch {
        return null;
      }
    },
  );
}

export interface SessionMembershipState {
  id: string;
  orgId: string;
  userId: string;
  active: boolean;
  sessionVersion: number;
}

export function sessionMembershipIsCurrent(
  session: SessionPayload,
  membership: SessionMembershipState | null | undefined,
): boolean {
  return Boolean(
    session.membershipId &&
      session.sessionVersion != null &&
      membership &&
      membership.id === session.membershipId &&
      membership.orgId === session.orgId &&
      membership.userId === session.userId &&
      membership.active &&
      membership.sessionVersion === session.sessionVersion,
  );
}

/** Read and cryptographically verify the cookie without consulting the DB. */
export async function getTokenSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/**
 * Return a session only while its organization membership is still active and
 * unchanged. Legacy tokens without membership versioning fail closed.
 */
export async function getSession(): Promise<SessionPayload | null> {
  const session = await getTokenSession();
  if (!session?.membershipId || session.sessionVersion == null) return null;
  const membership = await withTenantTransaction(
    session.orgId,
    () =>
      db.query.memberships.findFirst({
        where: and(
          eq(schema.memberships.id, session.membershipId!),
          eq(schema.memberships.orgId, session.orgId),
          eq(schema.memberships.userId, session.userId),
        ),
        columns: {
          id: true,
          orgId: true,
          userId: true,
          active: true,
          sessionVersion: true,
        },
      }),
    session.userId,
  );
  return sessionMembershipIsCurrent(session, membership) ? session : null;
}

export function sessionCookieOptions(maxAge = SESSION_TTL_SECONDS) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}
