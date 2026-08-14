import { asc, eq } from "drizzle-orm";
import { afterTransactionCommit, dbAdmin as telemetryDb, schema } from "@/db";
import { logger } from "@/lib/logger";
import {
  calculateCostUsd,
  pricingVersionForModel,
} from "@/lib/ai/pricing";
import type { CompletionResult } from "@/lib/ai/provider";
import type { AiCallValidationEvidence } from "@/lib/ai/evidence";
import { withSpan } from "@/lib/telemetry";

export type AiCallResult = Pick<CompletionResult, "model" | "usage" | "providerRequestId">;

type ArtifactType = (typeof schema.aiRunArtifactType.enumValues)[number];
type Operation = (typeof schema.aiCallOperation.enumValues)[number];
type CallOutcome = (typeof schema.aiCallOutcome.enumValues)[number];

export async function startAiRun(input: {
  orgId: string;
  projectId?: string | null;
  jobId?: string | null;
  artifactType: ArtifactType;
  provider: string;
  promptVersion?: string | null;
  dataOrigin?: "fixture" | "mock_run" | "live_provider";
  startedAt?: Date;
}): Promise<{ id: string; startedAt: Date }> {
  const startedAt = input.startedAt ?? new Date();
  const [run] = await telemetryDb
    .insert(schema.aiRuns)
    .values({
      orgId: input.orgId,
      projectId: input.projectId ?? null,
      jobId: input.jobId ?? null,
      artifactType: input.artifactType,
      provider: input.provider,
      promptVersion: input.promptVersion ?? null,
      dataOrigin: input.dataOrigin ?? (input.provider === "mock" ? "mock_run" : "live_provider"),
      startedAt,
    })
    .returning({ id: schema.aiRuns.id });
  return { id: run.id, startedAt };
}

export async function recordAiCall(input: {
  aiRunId: string;
  orgId: string;
  sequence: number;
  operation: Operation;
  provider: string;
  result?: AiCallResult;
  model?: string | null;
  promptVersion?: string | null;
  latencyMs: number;
  outcome: CallOutcome;
  errorKind?: string | null;
  validationEvidence?: AiCallValidationEvidence | null;
  redactionCount?: number;
}): Promise<void> {
  const model = input.result?.model ?? input.model ?? null;
  const inputTokens = input.result?.usage.inputTokens ?? 0;
  const outputTokens = input.result?.usage.outputTokens ?? 0;
  const cost = model
    ? calculateCostUsd(model, inputTokens, outputTokens)
    : null;
  await telemetryDb.insert(schema.aiCalls).values({
    aiRunId: input.aiRunId,
    orgId: input.orgId,
    sequence: input.sequence,
    operation: input.operation,
    provider: input.provider,
    model,
    promptVersion: input.promptVersion ?? null,
    inputTokens,
    outputTokens,
    redactionCount: Math.max(0, Math.floor(input.redactionCount ?? 0)),
    usageSource: input.result?.usage.source ?? "estimated",
    costUsd: cost === null ? null : cost.toFixed(8),
    pricingVersion: model ? pricingVersionForModel(model) : null,
    latencyMs: input.latencyMs,
    outcome: input.outcome,
    errorKind: input.errorKind ?? null,
    validationEvidence: input.validationEvidence ?? null,
    providerRequestId: input.result?.providerRequestId ?? null,
  });
}

export async function finishAiRun(input: {
  aiRunId: string;
  outcome: "succeeded" | "repaired" | "failed" | "blocked";
  finishedAt?: Date;
}): Promise<void> {
  const finishedAt = input.finishedAt ?? new Date();
  const calls = await telemetryDb.query.aiCalls.findMany({
    where: eq(schema.aiCalls.aiRunId, input.aiRunId),
    orderBy: asc(schema.aiCalls.sequence),
  });
  const inputTokens = calls.reduce((sum, call) => sum + call.inputTokens, 0);
  const outputTokens = calls.reduce((sum, call) => sum + call.outputTokens, 0);
  const redactionCount = calls.reduce((sum, call) => sum + call.redactionCount, 0);
  const cost = calls.reduce(
    (sum, call) => sum + (call.costUsd ? Number(call.costUsd) : 0),
    0,
  );
  const run = await telemetryDb.query.aiRuns.findFirst({
    where: eq(schema.aiRuns.id, input.aiRunId),
  });
  if (!run) return;
  await telemetryDb
    .update(schema.aiRuns)
    .set({
      status: input.outcome === "failed" || input.outcome === "blocked" ? "failed" : "succeeded",
      finalOutcome: input.outcome,
      model: calls.find((call) => call.model)?.model ?? run.model,
      inputTokens,
      outputTokens,
      redactionCount,
      costUsd: calls.some((call) => call.costUsd !== null)
        ? cost.toFixed(8)
        : null,
      pricingVersion: calls.find((call) => call.pricingVersion)?.pricingVersion ?? null,
      latencyMs: finishedAt.getTime() - run.startedAt.getTime(),
      finishedAt,
    })
    .where(eq(schema.aiRuns.id, input.aiRunId));
}

/**
 * Finalize successful telemetry only after the artifact/job transaction is
 * durable. A trace-finalization outage must not turn a committed artifact into
 * a retried model call.
 */
export async function finishAiRunAfterCommit(input: {
  aiRunId: string;
  outcome: "succeeded" | "repaired";
}): Promise<void> {
  await afterTransactionCommit(async () => {
    try {
      await finishAiRun(input);
    } catch (error) {
      logger.error(
        { aiRunId: input.aiRunId, error: String(error) },
        "AI run finalization failed after artifact commit",
      );
    }
  });
}

export async function instrumentAiCall<T extends CompletionResult>(input: {
  aiRunId: string;
  orgId: string;
  sequence: number;
  operation: Operation;
  provider: string;
  promptVersion?: string | null;
  complete: () => Promise<T>;
  classifyError?: (error: unknown) => string;
  validate?: (result: T) =>
    | CallOutcome
    | { outcome: CallOutcome; evidence?: AiCallValidationEvidence; errorKind?: string | null };
  redactionCount?: number;
}): Promise<T> {
  return withSpan(
    "ai.call",
    { "workbench.ai_operation": input.operation, "workbench.provider": input.provider },
    () => instrumentAiCallInternal(input),
  );
}

async function instrumentAiCallInternal<T extends CompletionResult>(input: {
  aiRunId: string;
  orgId: string;
  sequence: number;
  operation: Operation;
  provider: string;
  promptVersion?: string | null;
  complete: () => Promise<T>;
  classifyError?: (error: unknown) => string;
  validate?: (result: T) =>
    | CallOutcome
    | { outcome: CallOutcome; evidence?: AiCallValidationEvidence; errorKind?: string | null };
  redactionCount?: number;
}): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await input.complete();
    const validation = input.validate?.(result) ?? "valid";
    const validationResult = typeof validation === "string" ? { outcome: validation } : validation;
    await recordAiCall({
      aiRunId: input.aiRunId,
      orgId: input.orgId,
      sequence: input.sequence,
      operation: input.operation,
      provider: input.provider,
      promptVersion: input.promptVersion,
      result,
      latencyMs: Date.now() - startedAt,
      outcome: validationResult.outcome,
      errorKind: validationResult.errorKind,
      validationEvidence: validationResult.evidence,
      redactionCount: input.redactionCount,
    });
    return result;
  } catch (error) {
    await recordAiCall({
      aiRunId: input.aiRunId,
      orgId: input.orgId,
      sequence: input.sequence,
      operation: input.operation,
      provider: input.provider,
      promptVersion: input.promptVersion,
      model: null,
      latencyMs: Date.now() - startedAt,
      outcome: "failed",
      errorKind: input.classifyError?.(error) ?? "provider_error",
      redactionCount: input.redactionCount,
    });
    throw error;
  }
}
