import { env } from "@/lib/env";
import { PLAN_SYSTEM_PROMPT } from "./prompts";

export interface PromptVariant {
  version: string;
  system: string;
  description: string;
}

const variants: Record<string, PromptVariant> = {
  "plan-v1.0": {
    version: "plan-v1.0",
    system: PLAN_SYSTEM_PROMPT,
    description: "Baseline JSON-in-text planning prompt",
  },
  "plan-v1.1": {
    version: "plan-v1.1",
    system: `${PLAN_SYSTEM_PROMPT}\n\nAdditional quality checklist:\n- Work through every requirement id before drafting milestones.\n- Prefer concrete acceptance-oriented task descriptions over generic activity labels.\n- Put dependencies before the work that depends on them.`,
    description: "Requirement checklist and acceptance-oriented task variant",
  },
  "plan-v2.0": {
    version: "plan-v2.0",
    system: `${PLAN_SYSTEM_PROMPT}\n\nStructured-output mode: return the exact JSON object only. Treat requirementIds as a closed set copied from the input; an unknown id is invalid.`,
    description: "Structured-output-compatible planning variant",
  },
};

export function promptVariant(version: string): PromptVariant {
  return variants[version] ?? variants["plan-v1.0"];
}

export function promptVariants(): readonly PromptVariant[] {
  return Object.values(variants);
}

/** Stable assignment keeps a project in the same experiment bucket. */
export function selectPlanPrompt(projectId: string): PromptVariant {
  const configured = env().PROMPT_VARIANT;
  if (configured) return promptVariant(configured);
  const bucket = stableHash(`plan-default:${projectId}`) % 3;
  return promptVariant(["plan-v1.0", "plan-v1.1", "plan-v2.0"][bucket]);
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
