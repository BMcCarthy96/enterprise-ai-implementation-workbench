import { z } from "zod";

/**
 * Contract for AI-generated implementation plans. Model output is parsed and
 * validated against this schema before anything touches the database; invalid
 * output triggers one repair attempt with the validation errors fed back.
 */

export const PlanTaskSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().max(2000).default(""),
  suggestedRole: z
    .enum(["implementation_manager", "solutions_engineer"])
    .default("solutions_engineer"),
  estimateHours: z.number().int().min(1).max(200).optional(),
});

export const PlanMilestoneSchema = z.object({
  name: z.string().min(3).max(200),
  description: z.string().max(2000).default(""),
  durationWeeks: z.number().min(0.5).max(26).optional(),
  tasks: z.array(PlanTaskSchema).min(1).max(15),
});

export const PlanRiskSchema = z.object({
  description: z.string().min(3).max(1000),
  severity: z.enum(["low", "medium", "high"]),
  mitigation: z.string().max(1000).default(""),
});

export const PlanContentSchema = z.object({
  summary: z.string().min(20).max(3000),
  assumptions: z.array(z.string().max(500)).max(15).default([]),
  risks: z.array(PlanRiskSchema).max(10).default([]),
  milestones: z.array(PlanMilestoneSchema).min(2).max(10),
  openQuestions: z.array(z.string().max(500)).max(15).default([]),
});

export type PlanContent = z.infer<typeof PlanContentSchema>;
export type PlanMilestone = z.infer<typeof PlanMilestoneSchema>;
export type PlanTask = z.infer<typeof PlanTaskSchema>;

/** Version stamp stored with every plan for prompt regression tracking. */
export const PROMPT_VERSION = "plan-v1.0";
