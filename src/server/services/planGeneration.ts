import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { aiProvider } from "@/lib/ai/provider";
import {
  PlanContentSchema,
  PLAN_OUTPUT_JSON_SCHEMA,
  type PlanContent,
} from "@/lib/ai/planSchema";
import {
  buildPlanUserPrompt,
  buildRepairPrompt,
  type PlanPromptInput,
} from "@/lib/ai/prompts";
import { selectPlanPrompt } from "@/lib/ai/promptRegistry";
import { redactSensitiveText, totalRedactions } from "@/lib/ai/redaction";
import { logger } from "@/lib/logger";
import { recordAudit } from "./audit";
import {
  finishAiRun,
  finishAiRunAfterCommit,
  instrumentAiCall,
  recordAiCall,
  startAiRun,
} from "./aiTelemetry";
import { retrieveProjectSources, retrievalQuery, type RetrievedSource } from "./retrieval";
import { PlanGuardrailError, sourceRefsFromPlan, validatePlanGuardrails } from "./planGuardrails";
import { withSpan } from "@/lib/telemetry";
import {
  buildPlanEvaluationRows,
  normalizedValidationEvidence,
  type AiCallValidationEvidence,
} from "@/lib/ai/evidence";

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

interface PlanAssessment {
  content?: PlanContent;
  evidence: AiCallValidationEvidence;
  errorKind?: string;
  errorMessage?: string;
}

export function assessPlanOutput(raw: string, input: PlanPromptInput): PlanAssessment {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch {
    return {
      evidence: normalizedValidationEvidence({ schemaValid: false, guardrailPassed: false, failureCodes: ["JSON_PARSE_FAILED"] }),
      errorKind: "JSON_PARSE_FAILED",
      errorMessage: "Model output was not a JSON object",
    };
  }
  const parsedContent = PlanContentSchema.safeParse(parsed);
  if (!parsedContent.success) {
    return {
      evidence: normalizedValidationEvidence({
        schemaValid: false,
        guardrailPassed: false,
        failureCodes: ["SCHEMA_VALIDATION_FAILED"],
        issuePaths: parsedContent.error.issues.map((issue) => issue.path.join(".")),
      }),
      errorKind: "SCHEMA_VALIDATION_FAILED",
      errorMessage: "Plan did not match the output schema",
    };
  }
  try {
    validatePlanGuardrails(input, parsedContent.data);
  } catch (error) {
    const code = error instanceof PlanGuardrailError ? error.code : "GUARDRAIL_FAILED";
    return {
      evidence: normalizedValidationEvidence({ schemaValid: true, guardrailPassed: false, failureCodes: [code] }),
      errorKind: code,
      errorMessage: error instanceof Error ? error.message.slice(0, 240) : "Plan guardrail failed",
    };
  }
  return {
    content: parsedContent.data,
    evidence: normalizedValidationEvidence({ schemaValid: true, guardrailPassed: true, failureCodes: [] }),
  };
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
  return withSpan(
    "ai.plan_generation",
    { "workbench.ai_provider": process.env.AI_PROVIDER ?? "mock" },
    () => runPlanGenerationJobInternal(job),
  );
}

async function runPlanGenerationJobInternal(job: {
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

  // Closed feedback loop: if a previous plan for this project was rejected,
  // carry the reviewer's reason + note into this regeneration so the model
  // can address it.
  const lastRejection = await db.query.approvals.findFirst({
    where: and(
      eq(schema.approvals.projectId, project.id),
      eq(schema.approvals.subjectType, "plan"),
      eq(schema.approvals.status, "rejected"),
    ),
    orderBy: desc(schema.approvals.decidedAt),
  });
  const reviewerFeedback = lastRejection
    ? [
        lastRejection.reasonCode?.replace(/_/g, " "),
        lastRejection.note,
      ]
        .filter(Boolean)
        .join(" — ") || null
    : null;

  const input: PlanPromptInput = {
    projectName: project.name,
    projectDescription: project.description,
    customerName: customer?.name ?? "the customer",
    customerIndustry: customer?.industry ?? null,
    targetDate: project.targetDate?.toISOString().slice(0, 10) ?? null,
    requirements: reqs.map((r) => ({
      id: r.id,
      title: r.title,
      details: r.details,
      priority: r.priority,
    })),
    reviewerFeedback,
  };

  const provider = await aiProvider();
  const promptVariant = selectPlanPrompt(project.id);
  const run = await startAiRun({
    orgId: job.orgId,
    projectId: project.id,
    jobId: job.id,
    artifactType: "plan",
    provider: provider.name,
    promptVersion: promptVariant.version,
  });

  let content: PlanContent;
  let model: string;
  let repaired = false;
  let promptInput = input;
  let userPrompt = "";
  let sequence = 0;
  let retrievedSources: RetrievedSource[] = [];
  let retrieverVersion = "hybrid-v1";
  let retrievalQueryHash: string | null = null;
  try {
    const retrievalStartedAt = Date.now();
    const retrieval = await withSpan(
      "ai.retrieval",
      { "workbench.source_count_requested": reqs.length },
      () => retrieveProjectSources({
        orgId: job.orgId,
        projectId: project.id,
        query: retrievalQuery({
          projectName: project.name,
          projectDescription: project.description,
          requirements: reqs,
        }),
      }),
    );
    retrievedSources = retrieval.sources;
    retrieverVersion = retrieval.retrieverVersion;
    retrievalQueryHash = retrieval.queryHash;
    if (retrieval.embedding) {
      sequence += 1;
      await recordAiCall({
        aiRunId: run.id,
        orgId: job.orgId,
        sequence,
        operation: "embed",
        provider: retrieval.embedding.model.startsWith("mock") ? "mock" : "bedrock",
        model: retrieval.embedding.model,
        promptVersion: "retrieval-v1",
        result: {
          model: retrieval.embedding.model,
          usage: {
            inputTokens: retrieval.embedding.inputTokens,
            outputTokens: 0,
            source: retrieval.embedding.usageSource,
          },
          providerRequestId: retrieval.embedding.providerRequestId,
        },
        latencyMs: Date.now() - retrievalStartedAt,
        outcome: "valid",
        redactionCount: retrieval.redactionCount,
      });
    }
    promptInput = {
      ...input,
      sources: retrieval.sources.map((source) => ({
        ref: source.ref,
        documentName: source.documentName,
        pageNumber: source.pageNumber,
        heading: source.heading,
        content: source.content,
      })),
    };
    const promptRedaction = redactSensitiveText(buildPlanUserPrompt(promptInput));
    userPrompt = promptRedaction.text;
    const promptRedactionCount = totalRedactions(promptRedaction.counts);
    sequence += 1;
    const first = await instrumentAiCall({
      aiRunId: run.id,
      orgId: job.orgId,
      sequence,
      operation: "generate",
      provider: provider.name,
      promptVersion: promptVariant.version,
      redactionCount: promptRedactionCount,
      complete: () =>
        provider.complete({
          system: promptVariant.system,
          user: userPrompt,
          structuredOutput:
            promptVariant.version === "plan-v2.0"
              ? { name: "implementation_plan", schema: PLAN_OUTPUT_JSON_SCHEMA }
              : undefined,
        }),
      validate: (result) => {
        const assessment = assessPlanOutput(result.text, promptInput);
        return {
          outcome: assessment.content ? "valid" : "invalid",
          errorKind: assessment.errorKind,
          evidence: assessment.evidence,
        };
      },
    });

    model = first.model;
    const firstAssessment = assessPlanOutput(first.text, promptInput);
    if (firstAssessment.content) {
      content = firstAssessment.content;
    } else {
      repaired = true;
      log.warn({ errorKind: firstAssessment.errorKind }, "plan validation failed; attempting repair");
      const repair = await instrumentAiCall({
        aiRunId: run.id,
        orgId: job.orgId,
        sequence: sequence + 1,
        operation: "repair",
        provider: provider.name,
        promptVersion: promptVariant.version,
        redactionCount: promptRedactionCount,
        complete: () =>
          provider.complete({
            system: promptVariant.system,
            user:
              userPrompt +
              "\n\n" +
              buildRepairPrompt(first.text, firstAssessment.errorMessage ?? "Plan validation failed"),
            structuredOutput:
              promptVariant.version === "plan-v2.0"
                ? { name: "implementation_plan", schema: PLAN_OUTPUT_JSON_SCHEMA }
                : undefined,
          }),
        validate: (result) => {
          const assessment = assessPlanOutput(result.text, promptInput);
          return {
            outcome: assessment.content ? "valid" : "invalid",
            errorKind: assessment.errorKind,
            evidence: assessment.evidence,
          };
        },
      });
      const repairAssessment = assessPlanOutput(repair.text, promptInput);
      if (!repairAssessment.content) {
        throw new Error(repairAssessment.errorMessage ?? "Repaired plan failed validation");
      }
      content = repairAssessment.content;
      model = repair.model;
    }
  } catch (error) {
    await finishAiRun({ aiRunId: run.id, outcome: "failed" });
    throw error;
  }

  try {
    const latest = await db.query.plans.findFirst({
      where: eq(schema.plans.projectId, project.id),
      orderBy: desc(schema.plans.version),
    });
    const version = (latest?.version ?? 0) + 1;
    const evaluationRows = buildPlanEvaluationRows(promptInput, content);
    const failedHardGate = evaluationRows.find((row) => row.gateLevel === "hard_gate" && !row.passed);
    if (failedHardGate) {
      throw new Error(`AI evidence hard gate failed: ${failedHardGate.checkName}`);
    }

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
        promptVersion: promptVariant.version,
        generatedByJobId: job.id,
        incorporatedFeedback: reviewerFeedback,
      })
      .returning({ id: schema.plans.id });

    const sourcesByRef = new Map(retrievedSources.map((source) => [source.ref, source]));
    const citationRows = sourceRefsFromPlan(content).map((ref) => {
      const source = sourcesByRef.get(ref);
      if (!source) throw new Error(`Unknown citation reference ${ref}`);
      return {
        orgId: job.orgId,
        projectId: project.id,
        planId: plan.id,
        sourceRef: ref,
        chunkId: source.chunkId,
        location: [source.documentName, source.pageNumber ? `page ${source.pageNumber}` : source.heading]
          .filter(Boolean)
          .join(" · "),
        retrieverVersion,
        queryHash: retrievalQueryHash,
        rank: retrievedSources.findIndex((candidate) => candidate.ref === ref) + 1,
        vectorScore: source.vectorScore.toFixed(8),
        lexicalScore: source.lexicalScore.toFixed(8),
        selectionReason: source.selectionReason,
        redactedExcerpt: source.content.slice(0, 280),
      };
    });
    if (citationRows.length) await db.insert(schema.planCitations).values(citationRows);

    await db.insert(schema.aiRunEvaluations).values(evaluationRows.map((row) => ({
      orgId: job.orgId,
      aiRunId: run.id,
      checkName: row.checkName,
      category: row.category,
      gateLevel: row.gateLevel,
      score: row.score.toFixed(6),
      threshold: row.threshold.toFixed(6),
      passed: row.passed,
      detail: row.detail,
      evaluatorVersion: row.evaluatorVersion,
    })));

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
        promptVersion: promptVariant.version,
        milestoneCount: content.milestones.length,
        taskCount: content.milestones.reduce((n, m) => n + m.tasks.length, 0),
        citationCount: citationRows.length,
        incorporatedFeedback: reviewerFeedback ?? undefined,
      },
    });
    await finishAiRunAfterCommit({
      aiRunId: run.id,
      outcome: repaired ? "repaired" : "succeeded",
    });
    log.info({ planId: plan.id, version }, "plan generated and pending approval");
  } catch (error) {
    await finishAiRun({ aiRunId: run.id, outcome: "failed" });
    throw error;
  }
}
