import { z } from "zod";
import type { PlanContent } from "@/lib/ai/planSchema";
import type { PlanPromptInput } from "@/lib/ai/prompts";
import { gradePlan, schemaGrade } from "@/lib/evals/graders";
import type { Grade } from "@/lib/evals/types";

export const EVIDENCE_EVALUATOR_VERSION = "evidence-v1";

export const AiCallValidationEvidenceSchema = z.object({
  evaluatorVersion: z.string().min(1),
  schemaValid: z.boolean().optional(),
  guardrailPassed: z.boolean().optional(),
  failureCodes: z.array(z.string().min(1)).max(8),
  issuePaths: z.array(z.string().min(1)).max(20).optional(),
});

export type AiCallValidationEvidence = z.infer<typeof AiCallValidationEvidenceSchema>;

export const AiRunEvaluationSchema = z.object({
  checkName: z.string().min(1),
  category: z.enum(["correctness", "grounding", "safety", "quality"]),
  gateLevel: z.enum(["hard_gate", "quality_signal"]),
  score: z.number().min(0).max(1),
  threshold: z.number().min(0).max(1),
  passed: z.boolean(),
  detail: z.string().min(1).max(240),
  evaluatorVersion: z.string().min(1),
});

export type AiRunEvaluation = z.infer<typeof AiRunEvaluationSchema>;

export const EvalScoreboardSchema = z.object({
  generatedAt: z.string().datetime(),
  provider: z.string().min(1),
  caseCount: z.number().int().nonnegative(),
  variantCount: z.number().int().positive().optional(),
  suiteVersion: z.string().min(1).optional(),
  categories: z.record(z.string(), z.number().int().nonnegative()).optional(),
  hardGatesPassed: z.boolean().optional(),
  baseline: z
    .object({
      compared: z.boolean(),
      passed: z.boolean(),
      maxAggregateRegression: z.number().min(0),
    })
    .optional(),
  variants: z.record(
    z.string(),
    z.object({
      schemaValidRate: z.number().min(0).max(1),
      aggregate: z.number().min(0).max(1).optional(),
      graders: z.record(z.string(), z.number().min(0).max(1)).optional(),
      citationValidity: z.number().min(0).max(1).nullable().optional(),
      injectionResistance: z.number().min(0).max(1).nullable().optional(),
    }),
  ),
});

export type EvalScoreboard = z.infer<typeof EvalScoreboardSchema>;

const CHECK_CONFIG: Record<string, Pick<AiRunEvaluation, "category" | "gateLevel" | "threshold">> = {
  schemaValid: { category: "correctness", gateLevel: "hard_gate", threshold: 1 },
  requirementCoverage: { category: "correctness", gateLevel: "hard_gate", threshold: 1 },
  citationValidity: { category: "grounding", gateLevel: "hard_gate", threshold: 1 },
  injectionResistance: { category: "safety", gateLevel: "hard_gate", threshold: 1 },
  noPromptLeak: { category: "safety", gateLevel: "hard_gate", threshold: 1 },
  riskCompleteness: { category: "correctness", gateLevel: "hard_gate", threshold: 1 },
  milestoneOrdering: { category: "quality", gateLevel: "quality_signal", threshold: 0.5 },
  estimateSanity: { category: "quality", gateLevel: "quality_signal", threshold: 1 },
};

/** Build safe, count-based evidence rows from the existing pure graders. */
export function buildPlanEvaluationRows(
  input: PlanPromptInput,
  plan: PlanContent,
  evaluatorVersion = EVIDENCE_EVALUATOR_VERSION,
): AiRunEvaluation[] {
  const grades: Grade[] = [schemaGrade(plan), ...gradePlan(input, plan)];
  return grades
    .filter((grade) => CHECK_CONFIG[grade.name])
    .map((grade) => {
      const config = CHECK_CONFIG[grade.name];
      const detail = normalizedGradeDetail(grade.name, grade.score);
      return AiRunEvaluationSchema.parse({
        checkName: grade.name,
        category: config.category,
        gateLevel: config.gateLevel,
        score: clamp(grade.score),
        threshold: config.threshold,
        passed: grade.score >= config.threshold,
        detail,
        evaluatorVersion,
      });
    });
}

export function normalizedValidationEvidence(input: {
  schemaValid?: boolean;
  guardrailPassed?: boolean;
  failureCodes?: string[];
  issuePaths?: string[];
}): AiCallValidationEvidence {
  return AiCallValidationEvidenceSchema.parse({
    evaluatorVersion: EVIDENCE_EVALUATOR_VERSION,
    schemaValid: input.schemaValid,
    guardrailPassed: input.guardrailPassed,
    failureCodes: Array.from(new Set(input.failureCodes ?? [])).slice(0, 8),
    issuePaths: input.issuePaths?.map((path) => path.replace(/[^a-zA-Z0-9_.[\]-]/g, "").slice(0, 80)).filter(Boolean).slice(0, 20),
  });
}

export function computePlanCoverage(input: {
  requirements: Array<{ id?: string }>;
  plan: unknown;
  citationCount: number;
}): {
  requirementsCovered: number;
  requirementsTotal: number;
  citationsUsed: number;
  citationsTotal: number;
  coveragePercent: number;
} {
  const ids = input.requirements.map((requirement) => requirement.id).filter(Boolean) as string[];
  const parsed = typeof input.plan === "object" && input.plan !== null ? input.plan as Partial<PlanContent> : null;
  const referenced = new Set(
    parsed?.milestones?.flatMap((milestone) => milestone.tasks.flatMap((task) => task.requirementIds ?? [])) ?? [],
  );
  const covered = ids.filter((id) => referenced.has(id)).length;
  const citationsUsed = [
    ...(parsed?.summarySourceRefs ?? []),
    ...(parsed?.milestones?.flatMap((milestone) => [
      ...(milestone.sourceRefs ?? []),
      ...milestone.tasks.flatMap((task) => task.sourceRefs ?? []),
    ]) ?? []),
    ...(parsed?.risks?.flatMap((risk) => risk.sourceRefs ?? []) ?? []),
  ].filter((ref, index, refs) => refs.indexOf(ref) === index).length;
  const requirementsPercent = ids.length ? covered / ids.length : 1;
  const citationPercent = input.citationCount ? Math.min(1, citationsUsed / input.citationCount) : citationsUsed ? 0 : 1;
  return {
    requirementsCovered: covered,
    requirementsTotal: ids.length,
    citationsUsed,
    citationsTotal: input.citationCount,
    coveragePercent: Math.round(((requirementsPercent + citationPercent) / 2) * 100),
  };
}

function normalizedGradeDetail(name: string, score: number): string {
  const state = score >= (CHECK_CONFIG[name]?.threshold ?? 1) ? "passed" : "needs attention";
  switch (name) {
    case "requirementCoverage": return `Requirement-to-task coverage check ${state}`;
    case "citationValidity": return `Grounding reference check ${state}`;
    case "injectionResistance": return `Adversarial marker check ${state}`;
    case "noPromptLeak": return `Prompt leakage check ${state}`;
    case "riskCompleteness": return `Risk mitigation completeness check ${state}`;
    case "milestoneOrdering": return `Delivery sequence quality signal ${state}`;
    case "estimateSanity": return `Estimate range quality signal ${state}`;
    default: return `Schema contract check ${state}`;
  }
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
