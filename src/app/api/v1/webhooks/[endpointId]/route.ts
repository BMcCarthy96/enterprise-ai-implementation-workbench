import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { withAuth } from "@/lib/api";
import { recordAudit } from "@/server/services/audit";

export const DELETE = withAuth<{ endpointId: string }>("org.manage_integrations", async (_request, ctx, params) => {
  const result = await db.delete(schema.webhookEndpoints).where(and(eq(schema.webhookEndpoints.id, params.endpointId), eq(schema.webhookEndpoints.orgId, ctx.session.orgId))).returning({ id: schema.webhookEndpoints.id });
  if (result.length) {
    await recordAudit({ orgId: ctx.session.orgId, actorId: ctx.session.userId, action: "webhook_endpoint.deleted", subjectType: "webhook_endpoint", subjectId: params.endpointId, metadata: {} });
  }
  return result.length ? NextResponse.json({ deleted: true }) : NextResponse.json({ error: "Endpoint not found" }, { status: 404 });
});
