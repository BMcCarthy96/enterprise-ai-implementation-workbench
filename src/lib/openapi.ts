import { z, type ZodType } from "zod";
import {
  ApprovalDecisionSchema,
  BulkApprovalDecisionSchema,
  CreateCustomerSchema,
  CreateProjectSchema,
  CreateRequirementSchema,
  CreateTaskSchema,
  PresignDocumentSchema,
  RegisterDocumentSchema,
  UpdateProjectSchema,
  UpdateRequirementSchema,
  UpdateSlaPolicySchema,
  UpdateTaskSchema,
} from "@/lib/apiSchemas";

/**
 * OpenAPI 3.1 document for the /api/v1 surface, generated from the same zod
 * schemas the route handlers validate with (zod's native JSON Schema export),
 * so the docs cannot drift from the actual validation rules.
 */

function body(schema: ZodType) {
  return {
    required: true,
    content: {
      "application/json": {
        schema: z.toJSONSchema(schema, { target: "openapi-3.0" }),
      },
    },
  };
}

const jsonResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: { type: "object" as const } } },
});

const STD = {
  "400": { description: "Validation failed" },
  "401": { description: "Not authenticated" },
  "403": { description: "Insufficient role permissions" },
  "404": { description: "Not found in this organization" },
};

export function buildOpenApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Enterprise AI Implementation Workbench API",
      version: "1.0.0",
      description:
        "Multi-tenant implementation delivery API. All endpoints require a session cookie obtained via /api/auth/login and are scoped to the caller's organization. Role-based permissions are enforced per endpoint; mutations are recorded in the audit log.",
    },
    servers: [{ url: "/" }],
    components: {
      securitySchemes: {
        sessionCookie: {
          type: "apiKey",
          in: "cookie",
          name: "workbench_session",
          description: "HS256 JWT session cookie set by POST /api/auth/login",
        },
      },
    },
    security: [{ sessionCookie: [] }],
    paths: {
      "/api/health": {
        get: {
          tags: ["System"],
          summary:
            "Liveness/readiness probe (public). 200 healthy, 503 degraded; reports database and queue status independently.",
          security: [],
          responses: {
            "200": jsonResponse("All dependencies healthy"),
            "503": jsonResponse("One or more dependencies degraded"),
          },
        },
      },
      "/api/auth/login": {
        post: {
          tags: ["Auth"],
          summary: "Sign in and receive a session cookie",
          security: [],
          requestBody: body(
            z.object({ email: z.string().email(), password: z.string() }),
          ),
          responses: {
            "200": jsonResponse("Session established"),
            "401": { description: "Invalid credentials" },
          },
        },
      },
      "/api/auth/logout": {
        post: {
          tags: ["Auth"],
          summary: "Clear the session cookie",
          responses: { "200": jsonResponse("Signed out") },
        },
      },
      "/api/demo/session": {
        post: {
          tags: ["Demo"],
          summary: "Create or resume an isolated synthetic demo workspace",
          security: [],
          responses: {
            "200": jsonResponse("Workspace session and remaining quotas"),
            "429": { description: "Demo capacity or quota reached" },
            "503": { description: "Demo budget or dependency unavailable" },
          },
        },
      },
      "/api/v1/search": {
        get: {
          tags: ["Search"],
          summary:
            "Global search across projects, requirements, and customers (org-scoped; result types gated by role). Minimum query length 2.",
          parameters: [
            {
              name: "q",
              in: "query",
              required: true,
              schema: { type: "string", minLength: 2 },
            },
          ],
          responses: {
            "200": jsonResponse("{ query, results[] }"),
            ...STD,
          },
        },
      },
      "/api/v1/customers": {
        get: {
          tags: ["Customers"],
          summary: "List customers in the organization",
          responses: { "200": jsonResponse("Customer list"), ...STD },
        },
        post: {
          tags: ["Customers"],
          summary: "Create a customer (requires customers.manage)",
          requestBody: body(CreateCustomerSchema),
          responses: { "201": jsonResponse("Customer created"), ...STD },
        },
      },
      "/api/v1/projects": {
        get: {
          tags: ["Projects"],
          summary: "List projects with customer names",
          responses: { "200": jsonResponse("Project list"), ...STD },
        },
        post: {
          tags: ["Projects"],
          summary: "Create a project (requires projects.manage)",
          requestBody: body(CreateProjectSchema),
          responses: { "201": jsonResponse("Project created"), ...STD },
        },
      },
      "/api/v1/projects/{projectId}": {
        get: {
          tags: ["Projects"],
          summary: "Get a project",
          parameters: [pathParam("projectId")],
          responses: { "200": jsonResponse("Project"), ...STD },
        },
        patch: {
          tags: ["Projects"],
          summary: "Update project fields (requires projects.manage)",
          parameters: [pathParam("projectId")],
          requestBody: body(UpdateProjectSchema),
          responses: { "200": jsonResponse("Updated project"), ...STD },
        },
      },
      "/api/v1/projects/{projectId}/requirements": {
        get: {
          tags: ["Requirements"],
          summary: "List requirements for a project",
          parameters: [pathParam("projectId")],
          responses: { "200": jsonResponse("Requirement list"), ...STD },
        },
        post: {
          tags: ["Requirements"],
          summary: "Capture a requirement (requires requirements.manage)",
          parameters: [pathParam("projectId")],
          requestBody: body(CreateRequirementSchema),
          responses: { "201": jsonResponse("Requirement created"), ...STD },
        },
      },
      "/api/v1/requirements/{requirementId}": {
        patch: {
          tags: ["Requirements"],
          summary: "Update a requirement (requires requirements.manage)",
          parameters: [pathParam("requirementId")],
          requestBody: body(UpdateRequirementSchema),
          responses: { "200": jsonResponse("Updated requirement"), ...STD },
        },
      },
      "/api/v1/projects/{projectId}/plans": {
        get: {
          tags: ["Plans"],
          summary: "List plan versions for a project",
          parameters: [pathParam("projectId")],
          responses: { "200": jsonResponse("Plan versions"), ...STD },
        },
      },
      "/api/v1/projects/{projectId}/plans/generate": {
        post: {
          tags: ["Plans"],
          summary:
            "Queue AI plan generation (requires plans.generate; async — poll the jobs API)",
          parameters: [pathParam("projectId")],
          responses: {
            "202": jsonResponse("Job accepted: { jobId }"),
            "409": { description: "A generation job is already queued" },
            ...STD,
          },
        },
      },
      "/api/v1/projects/{projectId}/updates/generate": {
        post: {
          tags: ["Customer updates"],
          summary:
            "Queue AI customer-update digest (requires updates.draft; async)",
          parameters: [pathParam("projectId")],
          responses: { "202": jsonResponse("Job accepted: { jobId }"), ...STD },
        },
      },
      "/api/v1/projects/{projectId}/sla-policy": {
        get: {
          tags: ["Projects"],
          summary:
            "Current SLA overrides plus the resolved thresholds in force (requires internal.view)",
          parameters: [pathParam("projectId")],
          responses: {
            "200": jsonResponse("{ override, resolved, overriddenFields }"),
            ...STD,
          },
        },
        put: {
          tags: ["Projects"],
          summary:
            "Replace this project's SLA overrides (requires projects.manage). Send only the fields to override; an empty object resets to org defaults. Rejected with 400 if a warn threshold would exceed its breach threshold once merged.",
          parameters: [pathParam("projectId")],
          requestBody: body(UpdateSlaPolicySchema),
          responses: {
            "200": jsonResponse("Updated policy"),
            ...STD,
            "400": {
              description: "Validation failed, or warn threshold exceeds breach",
            },
          },
        },
        delete: {
          tags: ["Projects"],
          summary: "Clear all SLA overrides (requires projects.manage)",
          parameters: [pathParam("projectId")],
          responses: { "200": jsonResponse("Reset to defaults"), ...STD },
        },
      },
      "/api/v1/approvals": {
        get: {
          tags: ["Approvals"],
          summary: "List approvals (default: pending)",
          parameters: [
            {
              name: "status",
              in: "query",
              schema: {
                type: "string",
                enum: ["pending", "approved", "rejected", "all"],
              },
            },
          ],
          responses: { "200": jsonResponse("Approval list"), ...STD },
        },
      },
      "/api/v1/approvals/bulk": {
        post: {
          tags: ["Approvals"],
          summary:
            "Apply one decision to a selection of approvals (requires approvals.decide). Items are independent audited transactions, so the response is a partial-success report: { succeeded[], failed[], summary }.",
          requestBody: body(BulkApprovalDecisionSchema),
          responses: {
            "200": jsonResponse("Per-item outcomes (may include failures)"),
            ...STD,
          },
        },
      },
      "/api/v1/approvals/{approvalId}/decision": {
        post: {
          tags: ["Approvals"],
          summary:
            "Approve or reject (requires approvals.decide). Approving a plan materializes milestones and tasks; approving an update publishes it. Rejecting a plan with regenerate=true queues a revised version that carries the reason + note back into the prompt.",
          parameters: [pathParam("approvalId")],
          requestBody: body(ApprovalDecisionSchema),
          responses: {
            "200": jsonResponse("Decision applied"),
            "409": { description: "Already decided" },
            ...STD,
          },
        },
      },
      "/api/v1/projects/{projectId}/tasks": {
        get: {
          tags: ["Tasks"],
          summary: "List tasks for a project",
          parameters: [pathParam("projectId")],
          responses: { "200": jsonResponse("Task list"), ...STD },
        },
        post: {
          tags: ["Tasks"],
          summary: "Create a task (requires tasks.manage)",
          parameters: [pathParam("projectId")],
          requestBody: body(CreateTaskSchema),
          responses: { "201": jsonResponse("Task created"), ...STD },
        },
      },
      "/api/v1/tasks/{taskId}": {
        patch: {
          tags: ["Tasks"],
          summary: "Update task status/assignee/fields (requires tasks.manage)",
          parameters: [pathParam("taskId")],
          requestBody: body(UpdateTaskSchema),
          responses: { "200": jsonResponse("Updated task"), ...STD },
        },
      },
      "/api/v1/projects/{projectId}/documents/presign": {
        post: {
          tags: ["Documents"],
          summary:
            "Get a presigned S3 upload URL (requires documents.upload). Step 1 of 2.",
          parameters: [pathParam("projectId")],
          requestBody: body(PresignDocumentSchema),
          responses: {
            "200": jsonResponse("{ uploadUrl, documentId, s3Key }"),
            ...STD,
          },
        },
      },
      "/api/v1/projects/{projectId}/documents": {
        get: {
          tags: ["Documents"],
          summary: "List documents for a project",
          parameters: [pathParam("projectId")],
          responses: { "200": jsonResponse("Document list"), ...STD },
        },
        post: {
          tags: ["Documents"],
          summary:
            "Register uploaded document metadata (requires documents.upload). Step 2 of 2.",
          parameters: [pathParam("projectId")],
          requestBody: body(RegisterDocumentSchema),
          responses: { "201": jsonResponse("Document registered"), ...STD },
        },
      },
      "/api/v1/documents/{documentId}/download": {
        get: {
          tags: ["Documents"],
          summary: "Get a presigned S3 download URL",
          parameters: [pathParam("documentId")],
          responses: { "200": jsonResponse("{ url }"), ...STD },
        },
      },
      "/api/v1/documents/{documentId}/complete": {
        post: {
          tags: ["Documents"],
          summary: "Verify an S3 upload and enqueue idempotent ingestion",
          parameters: [pathParam("documentId")],
          responses: { "200": jsonResponse("{ document, jobId }"), ...STD },
        },
      },
      "/api/v1/ai-runs": {
        get: {
          tags: ["AI quality"],
          summary: "List tenant-scoped AI run traces",
          parameters: [
            { name: "projectId", in: "query", schema: { type: "string", format: "uuid" } },
            { name: "limit", in: "query", schema: { type: "integer", maximum: 100 } },
          ],
          responses: { "200": jsonResponse("{ runs }"), ...STD },
        },
      },
      "/api/v1/ai-runs/{runId}": {
        get: {
          tags: ["AI quality"],
          summary: "Inspect a run's sanitized call timeline and citations",
          parameters: [pathParam("runId")],
          responses: { "200": jsonResponse("{ run, calls, citations }"), ...STD },
        },
      },
      "/api/v1/audit": {
        get: {
          tags: ["Audit"],
          summary: "List audit events (requires audit.view)",
          parameters: [
            {
              name: "projectId",
              in: "query",
              schema: { type: "string", format: "uuid" },
            },
            { name: "limit", in: "query", schema: { type: "integer", maximum: 500 } },
          ],
          responses: { "200": jsonResponse("Audit events"), ...STD },
        },
      },
      "/api/v1/audit/export": {
        get: {
          tags: ["Audit"],
          summary:
            "Download the audit trail as CSV (requires audit.view); optional projectId filter",
          parameters: [
            {
              name: "projectId",
              in: "query",
              schema: { type: "string", format: "uuid" },
            },
          ],
          responses: {
            "200": {
              description: "CSV export",
              content: { "text/csv": { schema: { type: "string" } } },
            },
            ...STD,
          },
        },
      },
      "/api/v1/jobs": {
        get: {
          tags: ["Operations"],
          summary: "List background jobs with associated aiRunId values (requires ops.view)",
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer", maximum: 500 } },
          ],
          responses: { "200": jsonResponse("Job list"), ...STD },
        },
      },
      "/api/v1/jobs/{jobId}/retry": {
        post: {
          tags: ["Operations"],
          summary:
            "Re-enqueue a failed or dead-letter job (requires ops.retry_jobs)",
          parameters: [pathParam("jobId")],
          responses: {
            "200": jsonResponse("Job re-enqueued"),
            "409": { description: "Job is not in a retryable state" },
            ...STD,
          },
        },
      },
    },
  };
}

function pathParam(name: string) {
  return {
    name,
    in: "path" as const,
    required: true,
    schema: { type: "string" as const, format: "uuid" },
  };
}
