import { NextResponse } from "next/server";
import { desc, eq, inArray } from "drizzle-orm";
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
  const runRows = rows.length
    ? await db.query.aiRuns.findMany({
        where: inArray(schema.aiRuns.jobId, rows.map((row) => row.id)),
        columns: { id: true, jobId: true },
      })
    : [];
  const aiRunByJob = new Map(runRows.map((run) => [run.jobId, run.id]));
  return NextResponse.json({
    jobs: rows.map((job) => ({ ...job, aiRunId: aiRunByJob.get(job.id) ?? null })),
  });
});
