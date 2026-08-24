import { NextResponse } from "next/server";
import { getSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import {
  DEMO_TTL_SECONDS,
  DEMO_VISITOR_COOKIE,
  demoVisitorCookieOptions,
  demoVisitorKey,
} from "@/server/services/demoConfig";
import { replaceDemoWorkspaceControlled } from "@/server/services/demoControl";

export const runtime = "nodejs";
export const maxDuration = 60;

function errorResponse(error: unknown) {
  const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 503;
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "DEMO_RESET_UNAVAILABLE";
  const message = error instanceof Error ? error.message : "Demo reset is unavailable";
  return NextResponse.json({ error: message, code }, { status });
}
/** Reset only the authenticated isolated demo session; never a normal tenant. */
export async function POST(req: Request) {
  if (req.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json(
      { error: "Cross-site demo reset requests are not allowed", code: "CROSS_SITE_REQUEST" },
      { status: 403 },
    );
  }

  const session = await getSession();
  if (!session?.demoWorkspaceId) {
    return NextResponse.json(
      { error: "Only an authenticated demo session can be reset", code: "DEMO_SESSION_REQUIRED" },
      { status: 401 },
    );
  }

  let body: { confirmed?: boolean } = {};
  try {
    body = (await req.json()) as { confirmed?: boolean };
  } catch {
    // A missing/invalid body is treated as an unconfirmed reset.
  }
  if (body.confirmed !== true) {
    return NextResponse.json(
      { error: "Reset requires explicit confirmation", code: "RESET_CONFIRMATION_REQUIRED" },
      { status: 400 },
    );
  }

  try {
    const visitor = demoVisitorKey(req.headers);
    const result = await replaceDemoWorkspaceControlled({
      session,
      visitorKey: visitor.key,
      networkKey: visitor.networkKey,
    });
    const response = NextResponse.json({
      workspaceId: result.workspace.id,
      expiresAt: result.workspace.expiresAt.toISOString(),
      quotas: {
        generations: { used: result.workspace.generationJobsUsed, limit: result.workspace.maxGenerationJobs },
        uploads: { used: result.workspace.uploadCount, limit: result.workspace.maxUploads },
        storageBytes: { used: result.workspace.uploadBytes, limit: result.workspace.maxStorageBytes },
      },
    });
    response.cookies.set(SESSION_COOKIE, result.token, sessionCookieOptions(DEMO_TTL_SECONDS));
    if (visitor.setCookie) {
      response.cookies.set(DEMO_VISITOR_COOKIE, visitor.visitorId, demoVisitorCookieOptions);
    }
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
