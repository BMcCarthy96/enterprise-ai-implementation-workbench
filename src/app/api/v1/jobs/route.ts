import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { withAuth } from "@/lib/api";

export const GET = withAuth("ops.view", async (req, { session }) => {
  const limit = Math.min(
    Number(req.nextUrl.searchParams.get("limit") ?? 100),
    500,
  );
  const rows = await db.query.jobs.findMany({
    where: eq(schema.jobs.orgId, session.orgId),
    orderBy: desc(schema.jobs.createdAt),
    limit,
  });
  return NextResponse.json({ jobs: rows });
});
