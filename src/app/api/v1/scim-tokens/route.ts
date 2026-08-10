import { NextResponse } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db";
import { ApiError, parseBody, withAuth } from "@/lib/api";
import { createOpaqueSecret } from "@/lib/crypto";
import { and, eq, isNull } from "drizzle-orm";
import { recordAudit } from "@/server/services/audit";

const TokenSchema = z.object({
  label: z.string().min(1).max(80),
  expiresAt: z.string().datetime().optional(),
  revokeTokenId: z.string().uuid().optional(),
});

export const GET = withAuth("org.manage_identity", async (_request, ctx) => {
  const tokens = await db.query.scimTokens.findMany({
    where: eq(schema.scimTokens.orgId, ctx.session.orgId),
    columns: { id: true, label: true, expiresAt: true, lastUsedAt: true, revokedAt: true, createdAt: true },
  });
  return NextResponse.json({ tokens });
});

export const POST = withAuth("org.manage_identity", async (request, ctx) => {
  const input = await parseBody(request, TokenSchema);
  const { revokeTokenId, ...tokenInput } = input;
  const secret = createOpaqueSecret("scim");
  const [token] = await db.insert(schema.scimTokens).values({
    orgId: ctx.session.orgId,
    label: tokenInput.label,
    tokenHash: secret.hash,
    expiresAt: tokenInput.expiresAt ? new Date(tokenInput.expiresAt) : null,
    createdBy: ctx.session.userId,
  }).returning({ id: schema.scimTokens.id, label: schema.scimTokens.label, expiresAt: schema.scimTokens.expiresAt });
  if (!token) throw new ApiError(500, "Unable to create SCIM token");
  if (revokeTokenId) {
    const revoked = await db.update(schema.scimTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.scimTokens.id, revokeTokenId), eq(schema.scimTokens.orgId, ctx.session.orgId), isNull(schema.scimTokens.revokedAt)))
      .returning({ id: schema.scimTokens.id });
    if (!revoked.length) throw new ApiError(404, "Token to rotate was not found or was already revoked");
  }
  await recordAudit({
    orgId: ctx.session.orgId,
    actorId: ctx.session.userId,
    action: revokeTokenId ? "scim_token.rotated" : "scim_token.created",
    subjectType: "scim_token",
    subjectId: token.id,
    metadata: { label: token.label, expiresAt: token.expiresAt?.toISOString() ?? null, rotatedTokenId: revokeTokenId ?? null },
  });
  return NextResponse.json({ token, plaintext: secret.plaintext }, { status: 201 });
});
