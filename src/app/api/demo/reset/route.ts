import { NextResponse } from "next/server";
import { getSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import {
  clientIp,
  DEMO_TTL_SECONDS,
  replaceDemoWorkspace,
} from "@/server/services/demo";

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
    const result = await replaceDemoWorkspace({
      workspaceId: session.demoWorkspaceId,
      orgId: session.orgId,
      userId: session.userId,
      ip: clientIp(req.headers),
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
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
