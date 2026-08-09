import { z } from "zod";
import type { PlanPromptInput } from "@/lib/ai/prompts";

export const EvalCaseSchema = z.object({
  id: z.string().min(1),
  category: z.string().min(1),
  project: z.object({
    projectName: z.string(),
    projectDescription: z.string().nullable(),
    customerName: z.string(),
    customerIndustry: z.string().nullable(),
    targetDate: z.string().nullable(),
    requirements: z.array(
      z.object({
        id: z.string().uuid(),
        title: z.string(),
        details: z.string().nullable(),
        priority: z.string(),
      }),
    ),
    sources: z
      .array(
        z.object({
          ref: z.string().regex(/^S[1-8]$/),
          documentName: z.string(),
          pageNumber: z.number().int().nullable(),
          heading: z.string().nullable(),
          content: z.string(),
        }),
      )
      .max(8)
      .optional(),
    reviewerFeedback: z.string().nullable().optional(),
  }),
});

export type EvalCase = z.infer<typeof EvalCaseSchema>;
export type EvalProject = EvalCase["project"] & PlanPromptInput;

export interface Grade {
  name: string;
  score: number;
  detail: string;
}

export interface EvalCaseResult {
  caseId: string;
  category: string;
  promptVersion: string;
  schemaValid: boolean;
  grades: Grade[];
  aggregate: number;
  output?: unknown;
  error?: string;
}
