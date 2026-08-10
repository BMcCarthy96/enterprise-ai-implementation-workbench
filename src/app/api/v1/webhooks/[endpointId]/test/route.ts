import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { queueWebhookTest } from "@/server/services/webhooks";
import { recordAudit } from "@/server/services/audit";

type Params = { endpointId: string };

export const POST = withAuth<Params>("org.manage_integrations", async (_request, ctx, params) => {
  const result = await queueWebhookTest(ctx.session.orgId, params.endpointId, ctx.session.userId);
  await recordAudit({
    orgId: ctx.session.orgId,
    actorId: ctx.session.userId,
    action: "webhook_endpoint.test_queued",
    subjectType: "webhook_endpoint",
    subjectId: params.endpointId,
    metadata: { deliveryId: result.deliveryId, eventId: result.eventId },
  });
  return NextResponse.json(result, { status: 202 });
});
