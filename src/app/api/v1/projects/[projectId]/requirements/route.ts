import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { withAuth, parseBody } from "@/lib/api";
import { CreateRequirementSchema } from "@/lib/apiSchemas";
import { requireProject } from "@/server/services/access";
import { recordAudit } from "@/server/services/audit";

type Params = { projectId: string };

export const GET = withAuth<Params>(
  "internal.view",
  async (_req, { session }, params) => {
    await requireProject(params.projectId, session.orgId);
    const rows = await db.query.requirements.findMany({
      where: eq(schema.requirements.projectId, params.projectId),
      orderBy: desc(schema.requirements.createdAt),
    });
    return NextResponse.json({ requirements: rows });
  },
);

export const POST = withAuth<Params>(
  "requirements.manage",
  async (req, { session }, params) => {
    const project = await requireProject(params.projectId, session.orgId);
    const body = await parseBody(req, CreateRequirementSchema);

    const [requirement] = await db
      .insert(schema.requirements)
      .values({
        orgId: session.orgId,
        projectId: project.id,
        title: body.title,
        details: body.details ?? null,
        priority: body.priority,
        createdBy: session.userId,
      })
      .returning();

    await recordAudit({
      orgId: session.orgId,
      actorId: session.userId,
      action: "requirement.created",
      subjectType: "requirement",
      subjectId: requirement.id,
      projectId: project.id,
      metadata: { title: requirement.title, priority: requirement.priority },
    });
    return NextResponse.json({ requirement }, { status: 201 });
  },
);
