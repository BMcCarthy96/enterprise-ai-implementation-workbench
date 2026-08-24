import { NextResponse } from "next/server";
import { withAuth, parseBody } from "@/lib/api";
import { UpdateSlaPolicySchema } from "@/lib/apiSchemas";
import { requireProject } from "@/server/services/access";
import {
  readProjectSlaPolicy,
  updateProjectSlaPolicy,
} from "@/server/services/sla";

type Params = { projectId: string };

/** Current overrides plus the resolved thresholds actually in force. */
export const GET = withAuth<Params>(
  "internal.view",
  async (_req, { session }, params) => {
    const project = await requireProject(params.projectId, session.orgId, session.userId, session.role);
    return NextResponse.json(readProjectSlaPolicy(project.slaPolicy));
  },
);

/**
 * Replace this project's SLA overrides. Send only the fields to override; an
 * empty object resets the project to the org defaults.
 */
export const PUT = withAuth<Params>(
  "projects.manage",
  async (req, { session }, params) => {
    const override = await parseBody(req, UpdateSlaPolicySchema);
    const result = await updateProjectSlaPolicy({
      projectId: params.projectId,
      orgId: session.orgId,
      actorId: session.userId,
      override,
    });
    return NextResponse.json(result);
  },
);

/** Clear all overrides for this project. */
export const DELETE = withAuth<Params>(
  "projects.manage",
  async (_req, { session }, params) => {
    const result = await updateProjectSlaPolicy({
      projectId: params.projectId,
      orgId: session.orgId,
      actorId: session.userId,
      override: {},
    });
    return NextResponse.json(result);
  },
);
