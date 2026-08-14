import { NextResponse } from "next/server";
import { withTenantTransaction } from "@/db";
import { getTokenSession, SESSION_COOKIE } from "@/lib/auth/session";
import { logger } from "@/lib/logger";
import { recordAudit } from "@/server/services/audit";

export async function POST() {
  const session = await getTokenSession();
  if (session) {
    try {
      await withTenantTransaction(
        session.orgId,
        () =>
          recordAudit({
            orgId: session.orgId,
            actorId: session.userId,
            action: "auth.logout",
            subjectType: "user",
            subjectId: session.userId,
          }),
        session.userId,
      );
    } catch (error) {
      // Session clearing must remain available during a database incident.
      logger.warn(
        { error: String(error) },
        "logout audit could not be persisted",
      );
    }
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
