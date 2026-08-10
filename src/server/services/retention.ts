import { and, eq, inArray, lt, type SQL } from "drizzle-orm";
import { db, dbAdmin, schema, tenantStorage } from "@/db";

export const DEFAULT_RETENTION_POLICY = {
  auditDays: 365,
  aiDetailDays: 90,
  completedJobDays: 30,
  webhookDeliveryDays: 30,
} as const;

export interface RetentionPolicyInput {
  auditDays: number;
  aiDetailDays: number;
  completedJobDays: number;
  webhookDeliveryDays: number;
}

export function validateRetentionPolicy(input: Partial<RetentionPolicyInput>) {
  const values = { ...DEFAULT_RETENTION_POLICY, ...input };
  if (values.auditDays < 90 || values.auditDays > 2555) throw new Error("auditDays must be between 90 and 2555");
  if (values.aiDetailDays < 30 || values.aiDetailDays > 365) throw new Error("aiDetailDays must be between 30 and 365");
  if (values.completedJobDays < 7 || values.completedJobDays > 90) throw new Error("completedJobDays must be between 7 and 90");
  if (values.webhookDeliveryDays < 7 || values.webhookDeliveryDays > 90) throw new Error("webhookDeliveryDays must be between 7 and 90");
  return values;
}

export async function getRetentionPolicy(orgId: string) {
  const existing = await db.query.retentionPolicies.findFirst({ where: eq(schema.retentionPolicies.orgId, orgId) });
  return existing ?? { ...DEFAULT_RETENTION_POLICY, orgId };
}

export async function saveRetentionPolicy(orgId: string, updatedBy: string, input: Partial<RetentionPolicyInput>) {
  const values = validateRetentionPolicy(input);
  const [row] = await db.insert(schema.retentionPolicies).values({ orgId, updatedBy, ...values }).onConflictDoUpdate({
    target: schema.retentionPolicies.orgId,
    set: { updatedBy, ...values, updatedAt: new Date() },
  }).returning();
  return row;
}

export async function previewRetention(orgId: string, policyInput?: Partial<RetentionPolicyInput>) {
  const policy = validateRetentionPolicy(policyInput ?? await getRetentionPolicy(orgId));
  const now = Date.now();
  const auditCutoff = new Date(now - policy.auditDays * 86_400_000);
  const aiCutoff = new Date(now - policy.aiDetailDays * 86_400_000);
  const jobsCutoff = new Date(now - policy.completedJobDays * 86_400_000);
  const webhookCutoff = new Date(now - policy.webhookDeliveryDays * 86_400_000);
  // A request preview runs on the tenant transaction; the scheduled cleanup
  // runs outside one and must use the owner connection to see RLS-protected
  // rows. Keep the selection sequential so one pg client is never used
  // concurrently by multiple queries.
  const reader = tenantStorage.getStore() ? db : dbAdmin;
  const audit = await reader.query.auditEvents.findMany({ where: and(eq(schema.auditEvents.orgId, orgId), lt(schema.auditEvents.createdAt, auditCutoff)), columns: { id: true } });
  const calls = await reader.query.aiCalls.findMany({ where: and(eq(schema.aiCalls.orgId, orgId), lt(schema.aiCalls.createdAt, aiCutoff)), columns: { id: true } });
  const evaluations = await reader.query.aiRunEvaluations.findMany({ where: and(eq(schema.aiRunEvaluations.orgId, orgId), lt(schema.aiRunEvaluations.createdAt, aiCutoff)), columns: { id: true } });
  const jobs = await reader.query.jobs.findMany({ where: and(eq(schema.jobs.orgId, orgId), lt(schema.jobs.createdAt, jobsCutoff), eq(schema.jobs.status, "succeeded")), columns: { id: true } });
  const deliveries = await reader.query.webhookDeliveries.findMany({ where: and(eq(schema.webhookDeliveries.orgId, orgId), lt(schema.webhookDeliveries.createdAt, webhookCutoff)), columns: { id: true } });
  return { policy, cutoffs: { audit: auditCutoff, ai: aiCutoff, jobs: jobsCutoff, webhooks: webhookCutoff }, counts: { auditEvents: audit.length, aiCalls: calls.length, aiEvaluations: evaluations.length, completedJobs: jobs.length, webhookDeliveries: deliveries.length } };
}

const RETENTION_BATCH_SIZE = 500;

type RetentionTable =
  | typeof schema.auditEvents
  | typeof schema.aiRunEvaluations
  | typeof schema.aiCalls
  | typeof schema.jobs
  | typeof schema.webhookDeliveries;

async function deleteInBatches(
  table: RetentionTable,
  where: SQL | undefined,
) {
  while (true) {
    const rows = await dbAdmin.select({ id: table.id }).from(table).where(where).limit(RETENTION_BATCH_SIZE);
    if (rows.length === 0) return;
    await dbAdmin.delete(table).where(inArray(table.id, rows.map((row) => row.id)));
    if (rows.length < RETENTION_BATCH_SIZE) return;
  }
}

export async function runRetention(orgId: string) {
  const policy = await getRetentionPolicy(orgId);
  const [run] = await dbAdmin.insert(schema.retentionRuns).values({ orgId, status: "running" }).returning({ id: schema.retentionRuns.id });
  if (!run) throw new Error("Unable to create retention run");
  try {
    const preview = await previewRetention(orgId, policy);
    const now = Date.now();
    const auditCutoff = new Date(now - policy.auditDays * 86_400_000);
    const aiCutoff = new Date(now - policy.aiDetailDays * 86_400_000);
    const jobsCutoff = new Date(now - policy.completedJobDays * 86_400_000);
    const webhookCutoff = new Date(now - policy.webhookDeliveryDays * 86_400_000);
    await deleteInBatches(schema.auditEvents, and(eq(schema.auditEvents.orgId, orgId), lt(schema.auditEvents.createdAt, auditCutoff)));
    await deleteInBatches(schema.aiRunEvaluations, and(eq(schema.aiRunEvaluations.orgId, orgId), lt(schema.aiRunEvaluations.createdAt, aiCutoff)));
    await deleteInBatches(schema.aiCalls, and(eq(schema.aiCalls.orgId, orgId), lt(schema.aiCalls.createdAt, aiCutoff)));
    await deleteInBatches(schema.jobs, and(eq(schema.jobs.orgId, orgId), eq(schema.jobs.status, "succeeded"), lt(schema.jobs.createdAt, jobsCutoff)));
    await deleteInBatches(schema.webhookDeliveries, and(eq(schema.webhookDeliveries.orgId, orgId), lt(schema.webhookDeliveries.createdAt, webhookCutoff)));
    await dbAdmin.update(schema.retentionRuns).set({ status: "succeeded", counts: preview.counts, finishedAt: new Date() }).where(eq(schema.retentionRuns.id, run.id));
    return { runId: run.id, ...preview.counts };
  } catch (error) {
    await dbAdmin.update(schema.retentionRuns).set({ status: "failed", error: error instanceof Error ? error.message : String(error), finishedAt: new Date() }).where(eq(schema.retentionRuns.id, run.id));
    throw error;
  }
}

export async function runRetentionForAllOrganizations() {
  const organizations = await dbAdmin.query.organizations.findMany({ columns: { id: true } });
  let succeeded = 0;
  for (const organization of organizations) {
    try {
      await runRetention(organization.id);
      succeeded += 1;
    } catch {
      // The run ledger records the failure for operator inspection.
    }
  }
  return { attempted: organizations.length, succeeded };
}
