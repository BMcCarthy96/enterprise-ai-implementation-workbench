import { NextResponse } from "next/server";
import { createDemoWorkspace, clientIp, DEMO_TTL_SECONDS } from "@/server/services/demo";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";

export async function POST(req: Request) {
  // Do not allow a cross-site form or fetch to replace a visitor's current
  // Workbench session with a demo session.
  if (req.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json(
      { error: "Cross-site demo session requests are not allowed", code: "CROSS_SITE_REQUEST" },
      { status: 403 },
    );
  }
  try {
    const result = await createDemoWorkspace(clientIp(req.headers));
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
    const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 503;
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "DEMO_UNAVAILABLE";
    const message = error instanceof Error ? error.message : "Interactive demo is unavailable";
    return NextResponse.json({ error: message, code }, { status });
  }
}
