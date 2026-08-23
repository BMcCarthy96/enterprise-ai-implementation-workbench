import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { withAuth, ApiError } from "@/lib/api";
import { requireProject } from "@/server/services/access";
import { createAndEnqueueJob } from "@/server/services/jobs";
import { DEMO_ESTIMATED_RESERVATION_USD } from "@/server/services/demoConfig";
import {
  reconcileDemoGenerationControlled,
  reserveDemoGenerationControlled,
} from "@/server/services/demoControl";

export const runtime = "nodejs";

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
        inArray(schema.jobs.status, ["queued", "running"]),
      ),
    });
    if (pending) {
      throw new ApiError(
        409,
        "A plan generation job is already active for this project",
      );
    }

    const reservedDemoUsd = session.demoWorkspaceId
      ? await reserveDemoGenerationControlled({ session })
      : 0;
    try {
      const jobId = await createAndEnqueueJob({
        orgId: session.orgId,
        projectId: project.id,
        type: "plan_generation",
        payload: reservedDemoUsd
          ? { demoReservationUsd: DEMO_ESTIMATED_RESERVATION_USD }
          : undefined,
        requestedBy: session.userId,
      });
      return NextResponse.json({ jobId }, { status: 202 });
    } catch (error) {
      if (reservedDemoUsd) {
        await reconcileDemoGenerationControlled({ session, reservedUsd: reservedDemoUsd });
      }
      throw error;
    }
  },
);
