import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { withAuth, ApiError } from "@/lib/api";
import { requireProject } from "@/server/services/access";
import { createAndEnqueueJob } from "@/server/services/jobs";

type Params = { projectId: string };

/**
 * Kicks off asynchronous plan generation. Returns 202 with the job id; the
 * worker picks the job up from SQS and the UI polls job status.
 */
export const POST = withAuth<Params>(
  "plans.generate",
  async (_req, { session }, params) => {
    const project = await requireProject(params.projectId, session.orgId);

    const reqCount = await db.$count(
      schema.requirements,
      eq(schema.requirements.projectId, project.id),
    );
    if (reqCount === 0) {
      throw new ApiError(
        400,
        "Capture at least one requirement before generating a plan",
      );
    }

    const pending = await db.query.jobs.findFirst({
      where: and(
        eq(schema.jobs.projectId, project.id),
        eq(schema.jobs.type, "plan_generation"),
        eq(schema.jobs.status, "queued"),
      ),
    });
    if (pending) {
      throw new ApiError(
        409,
        "A plan generation job is already queued for this project",
      );
    }

    const jobId = await createAndEnqueueJob({
      orgId: session.orgId,
      projectId: project.id,
      type: "plan_generation",
      requestedBy: session.userId,
    });
    return NextResponse.json({ jobId }, { status: 202 });
  },
);
