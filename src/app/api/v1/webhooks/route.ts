import { NextResponse } from "next/server";
import { z } from "zod";
import { schema } from "@/db";
import { parseBody, withAuth } from "@/lib/api";
import { createWebhookEndpoint, listWebhookEndpoints } from "@/server/services/webhooks";
import { recordAudit } from "@/server/services/audit";

const WebhookSchema = z.object({
  url: z.string().url(),
  eventTypes: z.array(z.enum(schema.webhookEventTypes)).min(1),
});

export const GET = withAuth("org.manage_integrations", async (_request, ctx) => {
  return NextResponse.json({ endpoints: await listWebhookEndpoints(ctx.session.orgId) });
});

export const POST = withAuth("org.manage_integrations", async (request, ctx) => {
  const input = await parseBody(request, WebhookSchema);
  const result = await createWebhookEndpoint({ orgId: ctx.session.orgId, actorId: ctx.session.userId, ...input });
  await recordAudit({
    orgId: ctx.session.orgId,
    actorId: ctx.session.userId,
    action: "webhook_endpoint.created",
    subjectType: "webhook_endpoint",
    subjectId: result.endpoint.id,
    metadata: { host: new URL(input.url).host, eventTypes: input.eventTypes },
  });
  return NextResponse.json(result, { status: 201 });
});
