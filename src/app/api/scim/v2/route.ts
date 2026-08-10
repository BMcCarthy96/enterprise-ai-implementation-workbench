import { NextResponse } from "next/server";
import { authorizeScim, SCIM_LIST_SCHEMA } from "@/server/services/scim";

export async function GET(request: Request) {
  const context = await authorizeScim(request);
  if (!context) return NextResponse.json({ error: "SCIM authentication required" }, { status: 401 });
  return NextResponse.json({
    schemas: [SCIM_LIST_SCHEMA],
    resources: [
      { name: "User", endpoint: "/api/scim/v2/Users", schema: "urn:ietf:params:scim:schemas:core:2.0:User", operations: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
      { name: "Group", endpoint: "/api/scim/v2/Groups", schema: "urn:ietf:params:scim:schemas:core:2.0:Group", operations: ["GET", "POST", "PATCH"] },
    ],
  });
}
