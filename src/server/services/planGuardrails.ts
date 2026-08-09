import type { PlanContent } from "@/lib/ai/planSchema";
import type { PlanPromptInput } from "@/lib/ai/prompts";

const INJECTION_MARKERS = [
  "ignore previous instructions",
  "ignore all prior",
  "ignore prior instructions",
  "system prompt",
  "<input_json>",
  "exfiltrate",
  "jailbreak",
];

export class PlanGuardrailError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(`${code}: ${message}`);
  }
}

export function validatePlanGuardrails(
  input: PlanPromptInput,
  plan: PlanContent,
): void {
  const requirementIds = input.requirements
    .map((requirement) => requirement.id)
    .filter((id): id is string => Boolean(id));
  const knownRequirements = new Set(requirementIds);
  const referencedRequirements = new Set<string>();
  const sourceRefs = new Set((input.sources ?? []).map((source) => source.ref));
  const usedSourceRefs = new Set<string>();

  for (const milestone of plan.milestones) {
    collectSourceRefs(milestone.sourceRefs, sourceRefs, usedSourceRefs);
    for (const task of milestone.tasks) {
      for (const id of task.requirementIds ?? []) {
        if (knownRequirements.size && !knownRequirements.has(id)) {
          throw new PlanGuardrailError(`unknown requirement id ${id}`, "UNKNOWN_REQUIREMENT_REFERENCE");
        }
        referencedRequirements.add(id);
      }
      collectSourceRefs(task.sourceRefs, sourceRefs, usedSourceRefs);
    }
  }
  for (const risk of plan.risks) collectSourceRefs(risk.sourceRefs, sourceRefs, usedSourceRefs);
  collectSourceRefs(plan.summarySourceRefs, sourceRefs, usedSourceRefs);

  if (knownRequirements.size) {
    const missing = requirementIds.filter((id) => !referencedRequirements.has(id));
    if (missing.length) {
      throw new PlanGuardrailError(
        `requirements are not covered: ${missing.join(", ")}`,
        "REQUIREMENT_COVERAGE_FAILED",
      );
    }
    const missingTaskRefs = plan.milestones
      .flatMap((milestone) => milestone.tasks)
      .filter((task) => !task.requirementIds?.length);
    if (missingTaskRefs.length) {
      throw new PlanGuardrailError(
        "every generated task must include at least one requirementIds reference",
        "TASK_REQUIREMENT_REFERENCE_MISSING",
      );
    }
  }
  if (sourceRefs.size && !usedSourceRefs.size) {
    throw new PlanGuardrailError(
      "retrieved context was supplied but the plan cited no sources",
      "CITATION_REQUIRED",
    );
  }

  const output = JSON.stringify(plan).toLowerCase();
  const marker = INJECTION_MARKERS.find((value) => output.includes(value));
  if (marker) {
    throw new PlanGuardrailError(`untrusted instruction marker echoed: ${marker}`, "INJECTION_MARKER_ECHO");
  }
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(JSON.stringify(plan))) {
    throw new PlanGuardrailError("plan appears to echo an email address", "PII_ECHO");
  }
  const serialized = JSON.stringify(plan).replace(
    /[0-9a-f]{8}-[0-9a-f-]{27,}/gi,
    "",
  );
  if (/(?:\+?\d[\d\s().-]{7,}\d)/.test(serialized)) {
    throw new PlanGuardrailError("plan appears to echo a phone number", "PII_ECHO");
  }
  const incompleteRisk = plan.risks.find((risk) => !risk.mitigation.trim());
  if (incompleteRisk) {
    throw new PlanGuardrailError("every risk must include a mitigation", "RISK_MITIGATION_MISSING");
  }
}

function collectSourceRefs(
  refs: string[] | undefined,
  known: Set<string>,
  used: Set<string>,
): void {
  for (const ref of refs ?? []) {
    if (!known.has(ref)) {
      throw new PlanGuardrailError(`unknown source ref ${ref}`, "UNKNOWN_CITATION_REFERENCE");
    }
    used.add(ref);
  }
}

export function sourceRefsFromPlan(plan: PlanContent): string[] {
  return [
    ...(plan.summarySourceRefs ?? []),
    ...plan.milestones.flatMap((milestone) => [
      ...(milestone.sourceRefs ?? []),
      ...milestone.tasks.flatMap((task) => task.sourceRefs ?? []),
    ]),
    ...plan.risks.flatMap((risk) => risk.sourceRefs ?? []),
  ].filter((ref, index, refs) => refs.indexOf(ref) === index);
}
