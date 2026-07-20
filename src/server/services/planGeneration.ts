import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { aiProvider } from "@/lib/ai/provider";
import {
  PlanContentSchema,
  PROMPT_VERSION,
  type PlanContent,
} from "@/lib/ai/planSchema";
import {
  PLAN_SYSTEM_PROMPT,
  buildPlanUserPrompt,
  buildRepairPrompt,
  type PlanPromptInput,
} from "@/lib/ai/prompts";
import { logger } from "@/lib/logger";
import { recordAudit } from "./audit";

/** Strip markdown fences some models wrap around JSON despite instructions. */
export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Model output contains no JSON object");
  }
  return candidate.slice(start, end + 1);
}

function validatePlan(raw: string): PlanContent {
  return PlanContentSchema.parse(JSON.parse(extractJson(raw)));
}

/**
 * Worker-side handler for plan_generation jobs.
 *
 * Flow: load project context → prompt the model → validate against the plan
 * schema (one repair attempt with the validation errors fed back) → store the
 * plan as pending_approval and open an approval request. Tasks/milestones are
 * NOT created here — that only happens after a human approves the plan.
 */
export async function runPlanGenerationJob(job: {
  id: string;
  orgId: string;
  projectId: string | null;
}): Promise<void> {
  if (!job.projectId) throw new Error("plan_generation job missing projectId");
  const log = logger.child({ jobId: job.id, projectId: job.projectId });

  const project = await db.query.projects.findFirst({
    where: eq(schema.projects.id, job.projectId),
  });
  if (!project || project.orgId !== job.orgId) {
    throw new Error("Project not found for plan generation");
  }
  const customer = await db.query.customers.findFirst({
    where: eq(schema.customers.id, project.customerId),
  });
  const reqs = await db.query.requirements.findMany({
    where: eq(schema.requirements.projectId, project.id),
    orderBy: desc(schema.requirements.createdAt),
  });
  if (reqs.length === 0) {
    throw new Error(
      "Cannot generate a plan: the project has no requirements captured",
    );
  }

  const input: PlanPromptInput = {
    projectName: project.name,
    projectDescription: project.description,
    customerName: customer?.name ?? "the customer",
    customerIndustry: customer?.industry ?? null,
    targetDate: project.targetDate?.toISOString().slice(0, 10) ?? null,
    requirements: reqs.map((r) => ({
      title: r.title,
      details: r.details,
      priority: r.priority,
    })),
  };

  const provider = await aiProvider();
  const userPrompt = buildPlanUserPrompt(input);
  const first = await provider.complete({
    system: PLAN_SYSTEM_PROMPT,
    user: userPrompt,
  });

  let content: PlanContent;
  let model = first.model;
  try {
    content = validatePlan(first.text);
  } catch (err) {
    // One repair pass: feed the validation error back to the model.
    log.warn({ err: String(err) }, "plan validation failed; attempting repair");
    const repair = await provider.complete({
      system: PLAN_SYSTEM_PROMPT,
      user:
        userPrompt +
        "\n\n" +
        buildRepairPrompt(first.text, String(err).slice(0, 2000)),
    });
    content = validatePlan(repair.text);
    model = repair.model;
  }

  const latest = await db.query.plans.findFirst({
    where: eq(schema.plans.projectId, project.id),
    orderBy: desc(schema.plans.version),
  });
  const version = (latest?.version ?? 0) + 1;

  const [plan] = await db
    .insert(schema.plans)
    .values({
      orgId: job.orgId,
      projectId: project.id,
      version,
      status: "pending_approval",
      summary: content.summary,
      content,
      model,
      promptVersion: PROMPT_VERSION,
      generatedByJobId: job.id,
    })
    .returning({ id: schema.plans.id });

  await db.insert(schema.approvals).values({
    orgId: job.orgId,
    projectId: project.id,
    subjectType: "plan",
    subjectId: plan.id,
  });

  await recordAudit({
    orgId: job.orgId,
    action: "plan.generated",
    subjectType: "plan",
    subjectId: plan.id,
    projectId: project.id,
    metadata: {
      version,
      model,
      promptVersion: PROMPT_VERSION,
      milestoneCount: content.milestones.length,
      taskCount: content.milestones.reduce((n, m) => n + m.tasks.length, 0),
    },
  });
  log.info({ planId: plan.id, version }, "plan generated and pending approval");
}
