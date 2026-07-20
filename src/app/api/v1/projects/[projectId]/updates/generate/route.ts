import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { requireProject } from "@/server/services/access";
import { createAndEnqueueJob } from "@/server/services/jobs";

type Params = { projectId: string };

export const POST = withAuth<Params>(
  "updates.draft",
  async (_req, { session }, params) => {
    const project = await requireProject(params.projectId, session.orgId);
    const jobId = await createAndEnqueueJob({
      orgId: session.orgId,
      projectId: project.id,
      type: "customer_update_digest",
      requestedBy: session.userId,
    });
    return NextResponse.json({ jobId }, { status: 202 });
  },
);
