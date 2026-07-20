import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { withAuth, parseBody } from "@/lib/api";
import { UpdateProjectSchema } from "@/lib/apiSchemas";
import { requireProject } from "@/server/services/access";
import { recordAudit } from "@/server/services/audit";

type Params = { projectId: string };

export const GET = withAuth<Params>(null, async (_req, { session }, params) => {
  const project = await requireProject(params.projectId, session.orgId);
  return NextResponse.json({ project });
});

export const PATCH = withAuth<Params>(
  "projects.manage",
  async (req, { session }, params) => {
    const project = await requireProject(params.projectId, session.orgId);
    const body = await parseBody(req, UpdateProjectSchema);

    const [updated] = await db
      .update(schema.projects)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined
          ? { description: body.description }
          : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.targetDate !== undefined
          ? { targetDate: body.targetDate ? new Date(body.targetDate) : null }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.projects.id, project.id))
      .returning();

    await recordAudit({
      orgId: session.orgId,
      actorId: session.userId,
      action: "project.updated",
      subjectType: "project",
      subjectId: project.id,
      projectId: project.id,
      metadata: { changes: body },
    });
    return NextResponse.json({ project: updated });
  },
);
