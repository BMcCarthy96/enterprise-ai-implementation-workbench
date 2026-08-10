import { NextRequest, NextResponse } from "next/server";
import { createAuthorizationRequest, STATE_COOKIE } from "@/server/services/oidc";

export async function GET(request: NextRequest) {
  const connection = request.nextUrl.searchParams.get("connection");
  if (!connection) return NextResponse.json({ error: "connection is required" }, { status: 400 });
  try {
    const result = await createAuthorizationRequest({
      connectionSlug: connection,
      returnTo: request.nextUrl.searchParams.get("returnTo") ?? "/dashboard",
      origin: request.nextUrl.origin,
    });
    const response = NextResponse.redirect(result.url);
    response.cookies.set(STATE_COOKIE, result.statePayload, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 600,
    });
    return response;
  } catch {
    return NextResponse.json({ error: "OIDC connection is unavailable" }, { status: 404 });
  }
}
