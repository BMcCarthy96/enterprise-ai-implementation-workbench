import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { withTenantTransaction } from "@/db";
import { recordAudit } from "@/server/services/audit";
import { switchDemoPersona } from "@/server/services/demo";

const RoleSwitchSchema = z.object({
  role: z.enum(["org_admin", "implementation_manager", "solutions_engineer", "customer_stakeholder"]),
  returnTo: z.string().optional(),
});

function errorResponse(error: unknown) {
  const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 503;
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "DEMO_ROLE_SWITCH_UNAVAILABLE";
  const message = error instanceof Error ? error.message : "Demo role switching is unavailable";
  return NextResponse.json({ error: message, code }, { status });
}

/** Switch only among seeded identities in an active isolated demo workspace. */
export async function POST(req: Request) {
  if (req.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json(
      { error: "Cross-site demo role switches are not allowed", code: "CROSS_SITE_REQUEST" },
      { status: 403 },
    );
  }
  const session = await getSession();
  if (!session?.demoWorkspaceId) {
    return NextResponse.json(
      { error: "Only an authenticated demo session can switch personas", code: "DEMO_SESSION_REQUIRED" },
      { status: 401 },
    );
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON", code: "INVALID_JSON" }, { status: 400 });
  }
  const parsed = RoleSwitchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "A valid demo role is required", code: "DEMO_ROLE_INVALID" }, { status: 400 });
  }
  try {
    const result = await switchDemoPersona({
      workspaceId: session.demoWorkspaceId,
      orgId: session.orgId,
      currentUserId: session.userId,
      role: parsed.data.role,
      returnTo: parsed.data.returnTo,
    });
    await withTenantTransaction(session.orgId, () => recordAudit({
      orgId: session.orgId,
      actorId: session.userId,
      action: "demo.persona_switched",
      subjectType: "user",
      subjectId: result.user.id,
      metadata: {
        fromRole: session.role,
        toRole: parsed.data.role,
        fromUserId: session.userId,
        toUserId: result.user.id,
      },
    }), session.userId);
    const response = NextResponse.json({
      user: { id: result.user.id, email: result.user.email, name: result.user.name, role: result.role },
      redirectTo: result.redirectTo,
      expiresAt: result.workspace.expiresAt.toISOString(),
    });
    response.cookies.set(SESSION_COOKIE, result.token, sessionCookieOptions(result.ttlSeconds));
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
