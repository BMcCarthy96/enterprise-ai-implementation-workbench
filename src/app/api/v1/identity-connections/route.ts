import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, parseBody, withAuth } from "@/lib/api";
import { createIdentityConnection, listIdentityConnections } from "@/server/services/identity";
import { recordAudit } from "@/server/services/audit";

const ConnectionSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,48}$/),
  issuerUrl: z.string().url(),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  jitEnabled: z.boolean().optional(),
  allowedDomains: z.array(z.string().min(1)).max(20).optional(),
  groupMappings: z.record(z.string(), z.enum(["org_admin", "implementation_manager", "solutions_engineer", "customer_stakeholder"])).optional(),
});

export const GET = withAuth("org.manage_identity", async (_request, ctx) => {
  return NextResponse.json({ connections: await listIdentityConnections(ctx.session.orgId) });
});

export const POST = withAuth("org.manage_identity", async (request, ctx) => {
  const input = await parseBody(request, ConnectionSchema);
  if (process.env.NODE_ENV === "production" && !input.issuerUrl.startsWith("https://")) {
    throw new ApiError(400, "Production OIDC issuers must use HTTPS", "OIDC_HTTPS_REQUIRED");
  }
  const connection = await createIdentityConnection(ctx.session.orgId, ctx.session.userId, input);
  await recordAudit({
    orgId: ctx.session.orgId,
    actorId: ctx.session.userId,
    action: "identity_connection.created",
    subjectType: "identity_connection",
    subjectId: connection?.id,
    metadata: { slug: input.slug, issuerHost: new URL(input.issuerUrl).host, enabled: input.enabled ?? false, jitEnabled: input.jitEnabled ?? false },
  });
  return NextResponse.json({ connection, secretStored: Boolean(input.clientSecret) }, { status: 201 });
});
