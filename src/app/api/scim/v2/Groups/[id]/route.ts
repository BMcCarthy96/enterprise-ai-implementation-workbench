import { NextRequest, NextResponse } from "next/server";
import { authorizeScim, findScimGroup, groupResource, patchScimGroup, resourceEtag, scimError } from "@/server/services/scim";

type Params = { id: string };

export async function GET(request: NextRequest, route: { params: Promise<Params> }) {
  const context = await authorizeScim(request);
  if (!context) return NextResponse.json(scimError(401, "SCIM authentication required"), { status: 401 });
  const { id } = await route.params;
  const group = await findScimGroup(context.orgId, id);
  if (!group) return NextResponse.json(scimError(404, "Group not found"), { status: 404 });
  return NextResponse.json(await groupResource(request, context.orgId, group), { headers: { ETag: resourceEtag([group.id, group.externalId, group.displayName, group.mappedRole]) } });
}

export async function PATCH(request: NextRequest, route: { params: Promise<Params> }) {
  const context = await authorizeScim(request);
  if (!context) return NextResponse.json(scimError(401, "SCIM authentication required"), { status: 401 });
  const { id } = await route.params;
  try {
    const current = await findScimGroup(context.orgId, id);
    if (!current) return NextResponse.json(scimError(404, "Group not found"), { status: 404 });
    const expectedTag = resourceEtag([current.id, current.externalId, current.displayName, current.mappedRole]);
    const ifMatch = request.headers.get("if-match");
    if (ifMatch && ifMatch !== expectedTag) return NextResponse.json(scimError(412, "Resource changed since it was read"), { status: 412 });
    const input = (await request.json()) as { Operations?: unknown[] };
    const group = await patchScimGroup(context.orgId, id, input.Operations ?? []);
    if (!group) return NextResponse.json(scimError(404, "Group not found"), { status: 404 });
    return NextResponse.json(await groupResource(request, context.orgId, group), { headers: { ETag: resourceEtag([group.id, group.externalId, group.displayName, group.mappedRole]) } });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unable to update group";
    return NextResponse.json(scimError(409, detail), { status: 409 });
  }
}
