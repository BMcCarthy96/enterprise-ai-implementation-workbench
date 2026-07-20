import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { withAuth, ApiError } from "@/lib/api";
import { retryJob } from "@/server/services/jobs";

type Params = { jobId: string };

export const POST = withAuth<Params>(
  "ops.retry_jobs",
  async (_req, { session }, params) => {
    const job = await db.query.jobs.findFirst({
      where: and(
        eq(schema.jobs.id, params.jobId),
        eq(schema.jobs.orgId, session.orgId),
      ),
    });
    if (!job) throw new ApiError(404, "Job not found");
    if (job.status !== "failed" && job.status !== "dead_letter") {
      throw new ApiError(409, "Only failed or dead-letter jobs can be retried");
    }
    await retryJob(job.id, session.userId);
    return NextResponse.json({ ok: true });
  },
);
