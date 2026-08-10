import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { withAuth } from "@/lib/api";
import { recordAudit } from "@/server/services/audit";

export const DELETE = withAuth<{ tokenId: string }>("org.manage_identity", async (_request, ctx, params) => {
  const result = await db.update(schema.scimTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.scimTokens.id, params.tokenId), eq(schema.scimTokens.orgId, ctx.session.orgId)))
    .returning({ id: schema.scimTokens.id });
  if (result.length) {
    await recordAudit({ orgId: ctx.session.orgId, actorId: ctx.session.userId, action: "scim_token.revoked", subjectType: "scim_token", subjectId: params.tokenId, metadata: {} });
  }
  return result.length ? NextResponse.json({ revoked: true }) : NextResponse.json({ error: "Token not found" }, { status: 404 });
});
