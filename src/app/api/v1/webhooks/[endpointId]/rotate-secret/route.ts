import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { rotateWebhookSecret } from "@/server/services/webhooks";
import { recordAudit } from "@/server/services/audit";

type Params = { endpointId: string };

export const POST = withAuth<Params>("org.manage_integrations", async (_request, ctx, params) => {
  const result = await rotateWebhookSecret(ctx.session.orgId, params.endpointId);
  await recordAudit({
    orgId: ctx.session.orgId,
    actorId: ctx.session.userId,
    action: "webhook_endpoint.secret_rotated",
    subjectType: "webhook_endpoint",
    subjectId: params.endpointId,
    metadata: { secretShownOnce: true },
  });
  return NextResponse.json(result);
});
