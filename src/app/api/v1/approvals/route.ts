import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { withAuth } from "@/lib/api";

export const GET = withAuth("internal.view", async (req, { session }) => {
  const status = req.nextUrl.searchParams.get("status") ?? "pending";
  const rows = await db
    .select({
      approval: schema.approvals,
      projectName: schema.projects.name,
    })
    .from(schema.approvals)
    .leftJoin(
      schema.projects,
      eq(schema.approvals.projectId, schema.projects.id),
    )
    .where(
      and(
        eq(schema.approvals.orgId, session.orgId),
        status === "all"
          ? undefined
          : eq(
              schema.approvals.status,
              status as (typeof schema.approvalStatus.enumValues)[number],
            ),
      ),
    )
    .orderBy(desc(schema.approvals.createdAt));

  return NextResponse.json({
    approvals: rows.map((r) => ({
      ...r.approval,
      projectName: r.projectName,
    })),
  });
});
