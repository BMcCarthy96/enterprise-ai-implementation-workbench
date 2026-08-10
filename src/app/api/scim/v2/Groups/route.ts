import { NextRequest, NextResponse } from "next/server";
import { authorizeScim, listScimGroups, scimError, upsertScimGroup, groupResource } from "@/server/services/scim";

export async function GET(request: NextRequest) {
  const context = await authorizeScim(request);
  if (!context) return NextResponse.json(scimError(401, "SCIM authentication required"), { status: 401 });
  return NextResponse.json(await listScimGroups(request, context.orgId));
}

export async function POST(request: NextRequest) {
  const context = await authorizeScim(request);
  if (!context) return NextResponse.json(scimError(401, "SCIM authentication required"), { status: 401 });
  try {
    const group = await upsertScimGroup(context.orgId, (await request.json()) as Record<string, unknown>);
    return NextResponse.json(await groupResource(request, context.orgId, group), { status: 201, headers: { Location: new URL("/api/scim/v2/Groups/" + group.externalId, request.url).toString() } });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unable to provision group";
    const status = detail.includes("already exists") ? 409 : 400;
    return NextResponse.json(scimError(status, detail, status === 409 ? "uniqueness" : undefined), { status });
  }
}
