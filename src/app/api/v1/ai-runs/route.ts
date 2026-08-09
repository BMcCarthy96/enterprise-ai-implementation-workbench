import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { withAuth } from "@/lib/api";
import { uuidParam } from "@/server/services/access";

export const GET = withAuth("audit.view", async (req, { session }) => {
  const projectId = req.nextUrl.searchParams.get("projectId");
  const validProjectId = projectId ? uuidParam(projectId, "projectId") : null;
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 50) || 50, 100);
  const runs = await db.query.aiRuns.findMany({
    where: validProjectId
      ? (table, { and, eq: equals }) =>
          and(equals(table.orgId, session.orgId), equals(table.projectId, validProjectId))
      : eq(schema.aiRuns.orgId, session.orgId),
    orderBy: desc(schema.aiRuns.createdAt),
    limit,
  });
  return NextResponse.json({ runs });
});
