import { NextRequest, NextResponse } from "next/server";
import { sessionCookieOptions, SESSION_COOKIE } from "@/lib/auth/session";
import { finishAuthorizationRequest, STATE_COOKIE } from "@/server/services/oidc";

export async function GET(request: NextRequest) {
  const statePayload = request.cookies.get(STATE_COOKIE)?.value;
  if (!statePayload) return NextResponse.redirect(new URL("/login?error=sso_state_expired", request.url));
  try {
    const result = await finishAuthorizationRequest({
      requestUrl: new URL(request.url),
      statePayload,
      origin: request.nextUrl.origin,
    });
    const response = NextResponse.redirect(new URL(result.returnTo, request.url));
    response.cookies.set(SESSION_COOKIE, result.token, sessionCookieOptions());
    response.cookies.delete(STATE_COOKIE);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "SSO sign in failed";
    const response = NextResponse.redirect(new URL("/login?error=sso_failed", request.url));
    response.cookies.delete(STATE_COOKIE);
    console.warn("[oidc] sign-in failed", message);
    return response;
  }
}
