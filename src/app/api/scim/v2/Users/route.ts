import { NextRequest, NextResponse } from "next/server";
import { authorizeScim, createScimUser, listScimUsers, resourceEtag, scimError, userResource } from "@/server/services/scim";

export async function GET(request: NextRequest) {
  const context = await authorizeScim(request);
  if (!context) return NextResponse.json(scimError(401, "SCIM authentication required"), { status: 401 });
  const startIndex = Number(request.nextUrl.searchParams.get("startIndex") ?? 1);
  const count = Math.min(Number(request.nextUrl.searchParams.get("count") ?? 100), 100);
  const result = await listScimUsers(request, context.orgId, Number.isFinite(startIndex) ? Math.max(startIndex, 1) : 1, Number.isFinite(count) ? Math.max(count, 1) : 100, request.nextUrl.searchParams.get("filter") ?? undefined);
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const context = await authorizeScim(request);
  if (!context) return NextResponse.json(scimError(401, "SCIM authentication required"), { status: 401 });
  try {
    const input = (await request.json()) as Record<string, unknown>;
    const user = await createScimUser(context.orgId, input);
    return NextResponse.json(await userResource(request, context.orgId, user), { status: 201, headers: { Location: new URL("/api/scim/v2/Users/" + user.id, request.url).toString(), ETag: resourceEtag([user.id, user.createdAt.getTime(), user.externalId]) } });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unable to provision user";
    return NextResponse.json(scimError(detail.includes("already exists") ? 409 : 400, detail, detail.includes("already exists") ? "uniqueness" : undefined), { status: detail.includes("already exists") ? 409 : 400 });
  }
}
