import { db, schema } from "@/db";

export interface AuditInput {
  orgId: string;
  actorId?: string | null;
  action: string;
  subjectType: string;
  subjectId?: string | null;
  projectId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Append-only activity trail. Every mutation in the system — human or worker —
 * records one of these. Nothing ever updates or deletes audit rows.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  await db.insert(schema.auditEvents).values({
    orgId: input.orgId,
    actorId: input.actorId ?? null,
    action: input.action,
    subjectType: input.subjectType,
    subjectId: input.subjectId ?? null,
    projectId: input.projectId ?? null,
    metadata: input.metadata ?? null,
  });
}
