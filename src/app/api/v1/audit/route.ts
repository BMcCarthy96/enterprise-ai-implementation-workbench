import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { withAuth } from "@/lib/api";

export const GET = withAuth("audit.view", async (req, { session }) => {
  const projectId = req.nextUrl.searchParams.get("projectId");
  const limit = Math.min(
    Number(req.nextUrl.searchParams.get("limit") ?? 100),
    500,
  );

  const rows = await db
    .select({
      event: schema.auditEvents,
      actorName: schema.users.name,
    })
    .from(schema.auditEvents)
    .leftJoin(schema.users, eq(schema.auditEvents.actorId, schema.users.id))
    .where(
      and(
        eq(schema.auditEvents.orgId, session.orgId),
        projectId ? eq(schema.auditEvents.projectId, projectId) : undefined,
      ),
    )
    .orderBy(desc(schema.auditEvents.createdAt))
    .limit(limit);

  return NextResponse.json({
    events: rows.map((r) => ({
      ...r.event,
      actorName: r.actorName ?? "System",
    })),
  });
});
