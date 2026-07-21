import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { withAuth } from "@/lib/api";

/** RFC-4180 field escaping. */
function csvCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Streams the org's audit trail as CSV for offline review / compliance export.
 * Same permission and org scoping as the audit page.
 */
export const GET = withAuth("audit.view", async (req, { session }) => {
  const projectId = req.nextUrl.searchParams.get("projectId");

  const rows = await db
    .select({
      event: schema.auditEvents,
      actorName: schema.users.name,
      projectName: schema.projects.name,
    })
    .from(schema.auditEvents)
    .leftJoin(schema.users, eq(schema.auditEvents.actorId, schema.users.id))
    .leftJoin(
      schema.projects,
      eq(schema.auditEvents.projectId, schema.projects.id),
    )
    .where(
      and(
        eq(schema.auditEvents.orgId, session.orgId),
        projectId ? eq(schema.auditEvents.projectId, projectId) : undefined,
      ),
    )
    .orderBy(desc(schema.auditEvents.createdAt))
    .limit(5000);

  const header = [
    "timestamp",
    "actor",
    "action",
    "subject_type",
    "subject_id",
    "project",
    "metadata",
  ];
  const lines = [header.join(",")];
  for (const { event, actorName, projectName } of rows) {
    lines.push(
      [
        event.createdAt.toISOString(),
        actorName ?? "System",
        event.action,
        event.subjectType,
        event.subjectId ?? "",
        projectName ?? "",
        event.metadata ? JSON.stringify(event.metadata) : "",
      ]
        .map(csvCell)
        .join(","),
    );
  }

  const filename = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(lines.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});
