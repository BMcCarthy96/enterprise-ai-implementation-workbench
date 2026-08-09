import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { withAuth } from "@/lib/api";
import { uuidParam } from "@/server/services/access";

type Params = { runId: string };

export const GET = withAuth<Params>("audit.view", async (_req, { session }, params) => {
  const runId = uuidParam(params.runId, "runId");
  const run = await db.query.aiRuns.findFirst({
    where: and(eq(schema.aiRuns.id, runId), eq(schema.aiRuns.orgId, session.orgId)),
  });
  if (!run) {
    return NextResponse.json({ error: "AI run not found" }, { status: 404 });
  }
  const calls = await db.query.aiCalls.findMany({
    where: eq(schema.aiCalls.aiRunId, run.id),
    orderBy: asc(schema.aiCalls.sequence),
  });
  const plan = run.artifactType === "plan" && run.jobId
    ? await db.query.plans.findFirst({
        where: and(
          eq(schema.plans.orgId, session.orgId),
          eq(schema.plans.generatedByJobId, run.jobId),
        ),
      })
    : null;
  const citations = plan
    ? await db.query.planCitations.findMany({
        where: eq(schema.planCitations.planId, plan.id),
      })
    : [];
  return NextResponse.json({ run, calls, citations });
});
