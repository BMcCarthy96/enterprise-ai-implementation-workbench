import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { EmptyState } from "@/components/EmptyState";

export const dynamic = "force-dynamic";

export default async function ActivityPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = (await getSession())!;
  if (!can(session.role, "internal.view")) {
    return (
      <EmptyState title="Not available" hint="You do not have access to the activity log." />
    );
  }

  const events = await db
    .select({
      event: schema.auditEvents,
      actorName: schema.users.name,
    })
    .from(schema.auditEvents)
    .leftJoin(schema.users, eq(schema.auditEvents.actorId, schema.users.id))
    .where(eq(schema.auditEvents.projectId, projectId))
    .orderBy(desc(schema.auditEvents.createdAt))
    .limit(200);

  if (events.length === 0) {
    return <EmptyState title="No activity recorded for this project yet" />;
  }

  return (
    <div className="card">
      <ul className="divide-y divide-gray-100">
        {events.map(({ event, actorName }) => (
          <li key={event.id} className="flex items-baseline gap-3 px-4 py-2.5">
            <span className="w-32 shrink-0 text-xs text-gray-400">
              {event.createdAt.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}{" "}
              {event.createdAt.toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
            <div>
              <p className="text-sm text-gray-700">
                <span className="font-medium">{actorName ?? "System"}</span>{" "}
                — {event.action.replace(/\./g, ": ").replace(/_/g, " ")}
              </p>
              {event.metadata != null && (
                <p className="mt-0.5 max-w-xl truncate font-mono text-xs text-gray-400">
                  {JSON.stringify(event.metadata)}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
