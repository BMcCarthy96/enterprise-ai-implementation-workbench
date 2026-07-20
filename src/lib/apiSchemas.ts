import { z } from "zod";

/**
 * Request bodies for the /api/v1 surface. Kept in one module so the OpenAPI
 * generator and the route handlers share a single source of truth.
 */

export const CreateCustomerSchema = z.object({
  name: z.string().min(2).max(200),
  industry: z.string().max(100).optional(),
  primaryContactName: z.string().max(200).optional(),
  primaryContactEmail: z.string().email().optional(),
});

export const CreateProjectSchema = z.object({
  customerId: z.string().uuid(),
  name: z.string().min(2).max(200),
  description: z.string().max(4000).optional(),
  targetDate: z.string().date().optional(),
});

export const UpdateProjectSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  description: z.string().max(4000).optional(),
  status: z
    .enum(["discovery", "planning", "in_delivery", "on_hold", "completed"])
    .optional(),
  targetDate: z.string().date().nullable().optional(),
});

export const CreateRequirementSchema = z.object({
  title: z.string().min(3).max(300),
  details: z.string().max(10000).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
});

export const UpdateRequirementSchema = z.object({
  title: z.string().min(3).max(300).optional(),
  details: z.string().max(10000).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  status: z.enum(["new", "in_plan", "delivered", "deferred"]).optional(),
});

export const ApprovalDecisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  reasonCode: z
    .enum([
      "scope_too_broad",
      "scope_too_narrow",
      "inaccurate_content",
      "wrong_sequencing",
      "estimates_unrealistic",
      "tone_inappropriate",
      "other",
    ])
    .optional(),
  note: z.string().max(2000).optional(),
});

export const CreateTaskSchema = z.object({
  title: z.string().min(3).max(300),
  description: z.string().max(4000).optional(),
  milestoneId: z.string().uuid().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
});

export const UpdateTaskSchema = z.object({
  title: z.string().min(3).max(300).optional(),
  description: z.string().max(4000).optional(),
  status: z
    .enum(["todo", "in_progress", "blocked", "in_review", "done"])
    .optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  milestoneId: z.string().uuid().nullable().optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
});

export const PresignDocumentSchema = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(3).max(150),
  sizeBytes: z
    .number()
    .int()
    .min(1)
    .max(25 * 1024 * 1024),
});

export const RegisterDocumentSchema = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(3).max(150),
  sizeBytes: z.number().int().min(0),
  s3Key: z.string().min(1).max(1024),
});
