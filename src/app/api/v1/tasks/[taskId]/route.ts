import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { withAuth, parseBody } from "@/lib/api";
import { UpdateTaskSchema } from "@/lib/apiSchemas";
import { requireTask } from "@/server/services/access";
import { recordAudit } from "@/server/services/audit";

type Params = { taskId: string };

export const PATCH = withAuth<Params>(
  "tasks.manage",
  async (req, { session }, params) => {
    const task = await requireTask(params.taskId, session.orgId);
    const body = await parseBody(req, UpdateTaskSchema);

    const [updated] = await db
      .update(schema.tasks)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(schema.tasks.id, task.id))
      .returning();

    await recordAudit({
      orgId: session.orgId,
      actorId: session.userId,
      action:
        body.status && body.status !== task.status
          ? "task.status_changed"
          : "task.updated",
      subjectType: "task",
      subjectId: task.id,
      projectId: task.projectId,
      metadata: {
        changes: body,
        ...(body.status ? { from: task.status, to: body.status } : {}),
      },
    });
    return NextResponse.json({ task: updated });
  },
);
