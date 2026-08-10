import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { previewRetention } from "@/server/services/retention";

export const GET = withAuth("org.manage_retention", async (_request, ctx) => {
  return NextResponse.json(await previewRetention(ctx.session.orgId));
});
