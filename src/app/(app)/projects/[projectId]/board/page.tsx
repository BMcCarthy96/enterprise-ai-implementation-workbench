import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { EmptyState } from "@/components/EmptyState";
import { TaskCard } from "./TaskCard";

export const dynamic = "force-dynamic";

const COLUMNS = [
  { key: "todo", label: "To do" },
  { key: "in_progress", label: "In progress" },
  { key: "blocked", label: "Blocked" },
  { key: "in_review", label: "In review" },
  { key: "done", label: "Done" },
] as const;

export default async function BoardPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = (await getSession())!;
  const canManage = can(session.role, "tasks.manage");

  const tasks = await db
    .select({
      task: schema.tasks,
      assigneeName: schema.users.name,
      milestoneName: schema.milestones.name,
    })
    .from(schema.tasks)
    .leftJoin(schema.users, eq(schema.tasks.assigneeId, schema.users.id))
    .leftJoin(
      schema.milestones,
      eq(schema.tasks.milestoneId, schema.milestones.id),
    )
    .where(eq(schema.tasks.projectId, projectId))
    .orderBy(asc(schema.tasks.sortOrder), asc(schema.tasks.createdAt));

  if (tasks.length === 0) {
    return (
      <EmptyState
        title="No tasks on the board"
        hint="Tasks appear here after an implementation plan is approved, or can be added manually."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-5">
      {COLUMNS.map((col) => {
        const colTasks = tasks.filter((t) => t.task.status === col.key);
        return (
          <div key={col.key} className="rounded-lg bg-gray-100/70 p-2">
            <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
              <span>{col.label}</span>{" "}
              <span className="font-normal text-gray-400">
                {colTasks.length}
              </span>
            </p>
            <div className="space-y-2">
              {colTasks.map(({ task, assigneeName, milestoneName }) => (
                <TaskCard
                  key={task.id}
                  task={{
                    id: task.id,
                    title: task.title,
                    status: task.status,
                    priority: task.priority,
                    assigneeName,
                    milestoneName,
                  }}
                  canManage={canManage}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
