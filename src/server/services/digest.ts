import { and, desc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { aiProvider } from "@/lib/ai/provider";
import {
  DIGEST_SYSTEM_PROMPT,
  buildDigestUserPrompt,
  type DigestPromptInput,
} from "@/lib/ai/prompts";
import { extractJson } from "./planGeneration";
import { recordAudit } from "./audit";

const DigestOutputSchema = z.object({
  title: z.string().min(3).max(200),
  body: z.string().min(50).max(8000),
});

const PERIOD_DAYS = 14;

/**
 * Worker-side handler for customer_update_digest jobs: summarizes recent
 * project activity into a stakeholder-facing update. The draft goes through
 * the same approval queue as plans — nothing reaches the customer role
 * without a human sign-off.
 */
export async function runDigestJob(job: {
  id: string;
  orgId: string;
  projectId: string | null;
}): Promise<void> {
  if (!job.projectId) throw new Error("digest job missing projectId");

  const project = await db.query.projects.findFirst({
    where: eq(schema.projects.id, job.projectId),
  });
  if (!project || project.orgId !== job.orgId) {
    throw new Error("Project not found for digest generation");
  }
  const customer = await db.query.customers.findFirst({
    where: eq(schema.customers.id, project.customerId),
  });

  const milestones = await db.query.milestones.findMany({
    where: eq(schema.milestones.projectId, project.id),
  });
  const tasks = await db.query.tasks.findMany({
    where: eq(schema.tasks.projectId, project.id),
  });
  const since = new Date(Date.now() - PERIOD_DAYS * 24 * 60 * 60 * 1000);
  const activity = await db.query.auditEvents.findMany({
    where: and(
      eq(schema.auditEvents.projectId, project.id),
      gte(schema.auditEvents.createdAt, since),
    ),
    orderBy: desc(schema.auditEvents.createdAt),
    limit: 50,
  });

  const input: DigestPromptInput = {
    projectName: project.name,
    customerName: customer?.name ?? "the customer",
    periodDays: PERIOD_DAYS,
    milestoneSummary: milestones.map((m) => ({
      name: m.name,
      status: m.status,
    })),
    taskCounts: {
      done: tasks.filter((t) => t.status === "done").length,
      inProgress: tasks.filter((t) => t.status === "in_progress").length,
      blocked: tasks.filter((t) => t.status === "blocked").length,
      todo: tasks.filter((t) => t.status === "todo" || t.status === "in_review")
        .length,
    },
    recentActivity: activity.map((a) => ({
      action: a.action,
      at: a.createdAt.toISOString(),
    })),
  };

  const provider = await aiProvider();
  const res = await provider.complete({
    system: DIGEST_SYSTEM_PROMPT,
    user: buildDigestUserPrompt(input),
  });
  const output = DigestOutputSchema.parse(JSON.parse(extractJson(res.text)));

  const [update] = await db
    .insert(schema.customerUpdates)
    .values({
      orgId: job.orgId,
      projectId: project.id,
      title: output.title,
      body: output.body,
      status: "pending_approval",
      generatedByJobId: job.id,
    })
    .returning({ id: schema.customerUpdates.id });

  await db.insert(schema.approvals).values({
    orgId: job.orgId,
    projectId: project.id,
    subjectType: "customer_update",
    subjectId: update.id,
  });

  await recordAudit({
    orgId: job.orgId,
    action: "customer_update.generated",
    subjectType: "customer_update",
    subjectId: update.id,
    projectId: project.id,
    metadata: { model: res.model, periodDays: PERIOD_DAYS },
  });
}
