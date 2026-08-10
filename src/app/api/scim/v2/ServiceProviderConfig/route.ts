import { NextResponse } from "next/server";
import { authorizeScim } from "@/server/services/scim";

export async function GET(request: Request) {
  if (!(await authorizeScim(request))) return NextResponse.json({ error: "SCIM authentication required" }, { status: 401 });
  return NextResponse.json({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 100 },
    changePassword: { supported: false },
    sort: { supported: true },
    etag: { supported: true },
    authenticationSchemes: [{ name: "OAuth Bearer Token", description: "Organization-scoped SCIM bearer token", specUri: "https://www.rfc-editor.org/rfc/rfc6750", type: "oauthbearertoken" }],
  });
}
