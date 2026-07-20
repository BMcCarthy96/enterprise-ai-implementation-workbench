import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { withAuth, parseBody } from "@/lib/api";
import { CreateTaskSchema } from "@/lib/apiSchemas";
import { requireProject } from "@/server/services/access";
import { recordAudit } from "@/server/services/audit";

type Params = { projectId: string };

export const GET = withAuth<Params>(
  "internal.view",
  async (_req, { session }, params) => {
    await requireProject(params.projectId, session.orgId);
    const rows = await db.query.tasks.findMany({
      where: eq(schema.tasks.projectId, params.projectId),
      orderBy: [asc(schema.tasks.sortOrder), asc(schema.tasks.createdAt)],
    });
    return NextResponse.json({ tasks: rows });
  },
);

export const POST = withAuth<Params>(
  "tasks.manage",
  async (req, { session }, params) => {
    const project = await requireProject(params.projectId, session.orgId);
    const body = await parseBody(req, CreateTaskSchema);

    const [task] = await db
      .insert(schema.tasks)
      .values({
        orgId: session.orgId,
        projectId: project.id,
        milestoneId: body.milestoneId ?? null,
        title: body.title,
        description: body.description ?? null,
        priority: body.priority,
      })
      .returning();

    await recordAudit({
      orgId: session.orgId,
      actorId: session.userId,
      action: "task.created",
      subjectType: "task",
      subjectId: task.id,
      projectId: project.id,
      metadata: { title: task.title },
    });
    return NextResponse.json({ task }, { status: 201 });
  },
);
