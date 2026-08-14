import { NextRequest, NextResponse } from "next/server";
import { applyScimUserPatchOperations } from "@/lib/scimPatch";
import { authorizeScim, deleteScimUser, findScimUser, scimError, updateScimUser, userResource, userResourceEtag } from "@/server/services/scim";

type Params = { id: string };

async function load(request: NextRequest) {
  const context = await authorizeScim(request);
  return context;
}

export async function GET(request: NextRequest, route: { params: Promise<Params> }) {
  const context = await load(request);
  if (!context) return NextResponse.json(scimError(401, "SCIM authentication required"), { status: 401 });
  const { id } = await route.params;
  const user = await findScimUser(context.orgId, id);
  if (!user) return NextResponse.json(scimError(404, "User not found"), { status: 404 });
  return NextResponse.json(await userResource(request, context.orgId, user), { headers: { ETag: await userResourceEtag(context.orgId, user) } });
}

export async function PUT(request: NextRequest, route: { params: Promise<Params> }) {
  return modify(request, route, true);
}

export async function PATCH(request: NextRequest, route: { params: Promise<Params> }) {
  return modify(request, route, false);
}

async function modify(request: NextRequest, route: { params: Promise<Params> }, replace: boolean) {
  const context = await load(request);
  if (!context) return NextResponse.json(scimError(401, "SCIM authentication required"), { status: 401 });
  const { id } = await route.params;
  try {
    const current = await findScimUser(context.orgId, id);
    if (!current) return NextResponse.json(scimError(404, "User not found"), { status: 404 });
    const expectedTag = await userResourceEtag(context.orgId, current);
    const ifMatch = request.headers.get("if-match");
    if (ifMatch && ifMatch !== expectedTag) return NextResponse.json(scimError(412, "Resource changed since it was read"), { status: 412 });
    const input = (await request.json()) as Record<string, unknown>;
    const user = await updateScimUser(context.orgId, id, !replace ? applyScimUserPatchOperations(input) : input, replace);
    if (!user) return NextResponse.json(scimError(404, "User not found"), { status: 404 });
    return NextResponse.json(await userResource(request, context.orgId, user), { headers: { ETag: await userResourceEtag(context.orgId, user) } });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unable to update user";
    return NextResponse.json(scimError(detail.includes("already exists") ? 409 : 400, detail), { status: detail.includes("already exists") ? 409 : 400 });
  }
}

export async function DELETE(request: NextRequest, route: { params: Promise<Params> }) {
  const context = await load(request);
  if (!context) return NextResponse.json(scimError(401, "SCIM authentication required"), { status: 401 });
  const { id } = await route.params;
  const current = await findScimUser(context.orgId, id);
  if (!current) return NextResponse.json(scimError(404, "User not found"), { status: 404 });
  const expectedTag = await userResourceEtag(context.orgId, current);
  const ifMatch = request.headers.get("if-match");
  if (ifMatch && ifMatch !== expectedTag) return NextResponse.json(scimError(412, "Resource changed since it was read"), { status: 412 });
  const deleted = await deleteScimUser(context.orgId, id);
  if (!deleted) return NextResponse.json(scimError(404, "User not found"), { status: 404 });
  return new NextResponse(null, { status: 204 });
}
