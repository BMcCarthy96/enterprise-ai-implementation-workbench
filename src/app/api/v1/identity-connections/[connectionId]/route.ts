import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, parseBody, withAuth } from "@/lib/api";
import { disableIdentityConnection, updateIdentityConnection } from "@/server/services/identity";
import { recordAudit } from "@/server/services/audit";

type Params = { connectionId: string };

const UpdateSchema = z.object({
  issuerUrl: z.string().url().optional(),
  clientId: z.string().min(1).optional(),
  clientSecret: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  jitEnabled: z.boolean().optional(),
  allowedDomains: z.array(z.string().min(1)).max(20).optional(),
  groupMappings: z.record(z.string(), z.enum(["org_admin", "implementation_manager", "solutions_engineer", "customer_stakeholder"])).optional(),
});

export const PATCH = withAuth<Params>("org.manage_identity", async (request, ctx, params) => {
  const input = await parseBody(request, UpdateSchema);
  if (input.issuerUrl && process.env.NODE_ENV === "production" && !input.issuerUrl.startsWith("https://")) {
    throw new ApiError(400, "Production OIDC issuers must use HTTPS", "OIDC_HTTPS_REQUIRED");
  }
  const connection = await updateIdentityConnection(ctx.session.orgId, params.connectionId, input);
  if (!connection) return NextResponse.json({ error: "Identity connection not found" }, { status: 404 });
  await recordAudit({
    orgId: ctx.session.orgId,
    actorId: ctx.session.userId,
    action: "identity_connection.updated",
    subjectType: "identity_connection",
    subjectId: params.connectionId,
    metadata: {
      fields: Object.keys(input).filter((field) => field !== "clientSecret"),
      secretRotated: Boolean(input.clientSecret),
    },
  });
  return NextResponse.json({ connection, secretStored: Boolean(input.clientSecret) });
});

export const DELETE = withAuth<Params>("org.manage_identity", async (_request, ctx, params) => {
  const connection = await disableIdentityConnection(ctx.session.orgId, params.connectionId);
  if (!connection) return NextResponse.json({ error: "Identity connection not found" }, { status: 404 });
  await recordAudit({
    orgId: ctx.session.orgId,
    actorId: ctx.session.userId,
    action: "identity_connection.disabled",
    subjectType: "identity_connection",
    subjectId: params.connectionId,
    metadata: {},
  });
  return NextResponse.json({ disabled: true });
});
