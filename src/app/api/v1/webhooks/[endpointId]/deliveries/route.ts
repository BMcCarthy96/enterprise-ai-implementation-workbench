import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { and, eq } from "drizzle-orm";
import { withAuth } from "@/lib/api";
import { listWebhookDeliveries } from "@/server/services/webhooks";

type Params = { endpointId: string };

export const GET = withAuth<Params>("org.manage_integrations", async (request, ctx, params) => {
  const endpoint = await db.query.webhookEndpoints.findFirst({
    where: and(eq(schema.webhookEndpoints.id, params.endpointId), eq(schema.webhookEndpoints.orgId, ctx.session.orgId)),
    columns: { id: true },
  });
  if (!endpoint) return NextResponse.json({ error: "Webhook endpoint not found" }, { status: 404 });
  const rawLimit = Number(request.nextUrl.searchParams.get("limit") ?? 50);
  return NextResponse.json({ deliveries: await listWebhookDeliveries(ctx.session.orgId, params.endpointId, Number.isFinite(rawLimit) ? rawLimit : 50) });
});
