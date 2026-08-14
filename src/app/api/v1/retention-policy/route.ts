import { NextResponse } from "next/server";
import { parseBody, withAuth } from "@/lib/api";
import { UpdateRetentionPolicySchema } from "@/lib/apiSchemas";
import { getRetentionPolicy, saveRetentionPolicy } from "@/server/services/retention";
import { recordAudit } from "@/server/services/audit";

export const GET = withAuth("org.manage_retention", async (_request, ctx) => {
  return NextResponse.json({ policy: await getRetentionPolicy(ctx.session.orgId) });
});

export const PUT = withAuth("org.manage_retention", async (request, ctx) => {
  const input = await parseBody(request, UpdateRetentionPolicySchema);
  try {
    const policy = await saveRetentionPolicy(ctx.session.orgId, ctx.session.userId, input);
    await recordAudit({ orgId: ctx.session.orgId, actorId: ctx.session.userId, action: "retention_policy.updated", subjectType: "retention_policy", subjectId: policy.id, metadata: { auditDays: policy.auditDays, aiDetailDays: policy.aiDetailDays, completedJobDays: policy.completedJobDays, webhookDeliveryDays: policy.webhookDeliveryDays } });
    return NextResponse.json({ policy });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid retention policy" }, { status: 400 });
  }
});
