import { z } from "zod";

/**
 * Contract for AI-generated implementation plans. Model output is parsed and
 * validated against this schema before anything touches the database; invalid
 * output triggers one repair attempt with the validation errors fed back.
 */

export const PlanTaskSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().max(2000).default(""),
  requirementIds: z.array(z.string().uuid()).max(20).optional(),
  sourceRefs: z.array(z.string().regex(/^S[1-8]$/)).max(8).optional(),
  suggestedRole: z
    .enum(["implementation_manager", "solutions_engineer"])
    .default("solutions_engineer"),
  estimateHours: z.number().int().min(1).max(200).optional(),
});

export const PlanMilestoneSchema = z.object({
  name: z.string().min(3).max(200),
  description: z.string().max(2000).default(""),
  durationWeeks: z.number().min(0.5).max(26).optional(),
  sourceRefs: z.array(z.string().regex(/^S[1-8]$/)).max(8).optional(),
  tasks: z.array(PlanTaskSchema).min(1).max(15),
});

export const PlanRiskSchema = z.object({
  description: z.string().min(3).max(1000),
  severity: z.enum(["low", "medium", "high"]),
  mitigation: z.string().max(1000).default(""),
  sourceRefs: z.array(z.string().regex(/^S[1-8]$/)).max(8).optional(),
});

export const PlanContentSchema = z.object({
  summary: z.string().min(20).max(3000),
  summarySourceRefs: z.array(z.string().regex(/^S[1-8]$/)).max(8).optional(),
  assumptions: z.array(z.string().max(500)).max(15).default([]),
  risks: z.array(PlanRiskSchema).max(10).default([]),
  milestones: z.array(PlanMilestoneSchema).min(2).max(10),
  openQuestions: z.array(z.string().max(500)).max(15).default([]),
});

export type PlanContent = z.infer<typeof PlanContentSchema>;
export type PlanMilestone = z.infer<typeof PlanMilestoneSchema>;
export type PlanTask = z.infer<typeof PlanTaskSchema>;

/**
 * Bedrock Converse structured-output contract for the flagship planning
 * variant. Keep this to the portable JSON Schema subset supported by the
 * provider; Zod remains the authoritative application-level validator.
 */
export const PLAN_OUTPUT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "assumptions", "milestones", "risks", "openQuestions"],
  properties: {
    summary: { type: "string" },
    summarySourceRefs: {
      type: "array",
      maxItems: 8,
      items: { type: "string", enum: ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"] },
    },
    assumptions: {
      type: "array",
      maxItems: 15,
      items: { type: "string", maxLength: 500 },
    },
    milestones: {
      type: "array",
      minItems: 2,
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "description", "tasks"],
        properties: {
          name: { type: "string" },
          description: { type: "string", maxLength: 2000 },
          durationWeeks: { type: "number", minimum: 0.5, maximum: 26 },
          sourceRefs: {
            type: "array",
            maxItems: 8,
            items: { type: "string", enum: ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"] },
          },
          tasks: {
            type: "array",
            minItems: 1,
            maxItems: 15,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["title", "description", "suggestedRole"],
              properties: {
                title: { type: "string" },
                description: { type: "string", maxLength: 2000 },
                requirementIds: {
                  type: "array",
                  maxItems: 20,
                  items: { type: "string" },
                },
                sourceRefs: {
                  type: "array",
                  maxItems: 8,
                  items: { type: "string", enum: ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"] },
                },
                suggestedRole: {
                  type: "string",
                  enum: ["implementation_manager", "solutions_engineer"],
                },
                estimateHours: { type: "integer", minimum: 1, maximum: 200 },
              },
            },
          },
        },
      },
    },
    risks: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "severity", "mitigation"],
        properties: {
          description: { type: "string", maxLength: 1000 },
          severity: { type: "string", enum: ["low", "medium", "high"] },
          mitigation: { type: "string", maxLength: 1000 },
          sourceRefs: {
            type: "array",
            maxItems: 8,
            items: { type: "string", enum: ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"] },
          },
        },
      },
    },
    openQuestions: {
      type: "array",
      maxItems: 15,
      items: { type: "string", maxLength: 500 },
    },
  },
};

/** Version stamp stored with every plan for prompt regression tracking. */
export const PROMPT_VERSION = "plan-v1.0";
