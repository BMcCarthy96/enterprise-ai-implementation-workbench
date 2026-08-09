import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import type { Role } from "./rbac";

/**
 * Stateless session: an HS256 JWT in an httpOnly cookie. The token carries
 * identity plus the active organization and the user's role in it, so RBAC
 * checks never need an extra query. Swappable for Cognito-issued tokens in a
 * real AWS deployment without touching call sites.
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
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
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
