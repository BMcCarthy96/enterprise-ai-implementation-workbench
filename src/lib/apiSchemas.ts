import { z } from "zod";
import { SLA_POLICY_FIELDS, type SlaPolicy } from "@/lib/sla";

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
  // When rejecting a plan, queue a revised generation that carries this
  // rejection's reason + note back into the prompt (closed feedback loop).
  regenerate: z.boolean().optional(),
});

/**
 * Bulk decision over a selection from the approval queue. Same shape as a
 * single decision plus the ids; capped so one request can't fan out unbounded
 * work (each id may enqueue a regeneration job).
 */
export const BulkApprovalDecisionSchema = ApprovalDecisionSchema.extend({
  approvalIds: z.array(z.string().uuid()).min(1).max(50),
});

/**
 * Per-project SLA threshold overrides. Every field is optional — only what the
 * project actually overrides is stored, so the rest keep tracking the defaults.
 * An empty object clears all overrides.
 *
 * Bounds come from SLA_POLICY_FIELDS so the schema, the settings form, and the
 * evaluator can't drift apart. Kept refinement-free so it stays representable
 * as JSON Schema for the generated docs; the cross-field ordering rule (warn
 * must not exceed breach) is applied by the handler via `policyOrderingErrors`
 * against the *resolved* policy, which is the only place it's meaningful.
 */
export const UpdateSlaPolicySchema = z.strictObject(
  Object.fromEntries(
    SLA_POLICY_FIELDS.map((f) => [
      f.key,
      z.number().int().min(f.min).max(f.max).optional(),
    ]),
  ) as Record<keyof SlaPolicy, z.ZodOptional<z.ZodNumber>>,
);

export const RetentionPolicySchema = z.strictObject({
  auditDays: z.number().int().min(90).max(2555),
  aiDetailDays: z.number().int().min(30).max(365),
  completedJobDays: z.number().int().min(7).max(90),
  webhookDeliveryDays: z.number().int().min(7).max(90),
});

export const UpdateRetentionPolicySchema = RetentionPolicySchema.partial();

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

export const SUPPORTED_DOCUMENT_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
] as const;

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export const PresignDocumentSchema = z
  .object({
    fileName: z.string().min(1).max(255),
    contentType: z.string().min(3).max(150),
    sizeBytes: z.number().int().min(1).max(MAX_DOCUMENT_BYTES),
  })
  .superRefine((value, ctx) => {
    if (!(SUPPORTED_DOCUMENT_TYPES as readonly string[]).includes(value.contentType)) {
      ctx.addIssue({
        code: "custom",
        path: ["contentType"],
        message: "Only PDF, DOCX, TXT, and Markdown files are supported",
      });
    }
    if (!/\.(pdf|docx|txt|md|markdown)$/i.test(value.fileName)) {
      ctx.addIssue({
        code: "custom",
        path: ["fileName"],
        message: "File extension must match PDF, DOCX, TXT, or Markdown",
      });
    }
  });

export const RegisterDocumentSchema = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(3).max(150),
  sizeBytes: z.number().int().min(0),
  s3Key: z.string().min(1).max(1024),
});
