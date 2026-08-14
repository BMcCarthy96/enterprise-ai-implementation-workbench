import { NextResponse } from "next/server";
import { parseBody, withAuth } from "@/lib/api";
import { RetentionPolicySchema } from "@/lib/apiSchemas";
import { previewRetention } from "@/server/services/retention";

export const GET = withAuth("org.manage_retention", async (_request, ctx) => {
  return NextResponse.json(await previewRetention(ctx.session.orgId));
});

export const POST = withAuth("org.manage_retention", async (request, ctx) => {
  const draft = await parseBody(request, RetentionPolicySchema);
  return NextResponse.json(await previewRetention(ctx.session.orgId, draft));
});
