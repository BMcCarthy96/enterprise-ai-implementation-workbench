import { randomUUID } from "node:crypto";

/** Lightweight public-demo settings shared by routes and the admin service. */
export const DEMO_TTL_SECONDS = 60 * 60;
export const DEMO_ESTIMATED_RESERVATION_USD = 0.05;
export const DEMO_VISITOR_COOKIE = "workbench_demo_visitor";

const visitorIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function clientIp(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headers.get("x-real-ip") ??
    "unknown"
  );
}

function readCookie(headers: Headers, name: string): string | null {
  const prefix = `${name}=`;
  for (const part of (headers.get("cookie") ?? "").split(";")) {
    const value = part.trim();
    if (!value.startsWith(prefix)) continue;
    try {
      return decodeURIComponent(value.slice(prefix.length));
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Keep workspace reuse scoped to one browser visitor on one network. The
 * network address remains in the key as a coarse abuse backstop, while the
 * visitor cookie prevents two people behind the same NAT from sharing a
 * generation quota.
 */
export function demoVisitorKey(headers: Headers): {
  key: string;
  networkKey: string;
  visitorId: string;
  setCookie: boolean;
} {
  const existing = readCookie(headers, DEMO_VISITOR_COOKIE);
  const visitorId = existing && visitorIdPattern.test(existing) ? existing : randomUUID();
  return {
    key: `${clientIp(headers)}:${visitorId}`,
    networkKey: clientIp(headers),
    visitorId,
    setCookie: visitorId !== existing,
  };
}

export const demoVisitorCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: DEMO_TTL_SECONDS,
};
