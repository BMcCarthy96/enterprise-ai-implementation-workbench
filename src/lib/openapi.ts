import { z, type ZodType } from "zod";
import {
  ApprovalDecisionSchema,
  CreateCustomerSchema,
  CreateProjectSchema,
  CreateRequirementSchema,
  CreateTaskSchema,
  PresignDocumentSchema,
  RegisterDocumentSchema,
  UpdateProjectSchema,
  UpdateRequirementSchema,
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
      "/api/v1/approvals/{approvalId}/decision": {
        post: {
          tags: ["Approvals"],
          summary:
            "Approve or reject (requires approvals.decide). Approving a plan materializes milestones and tasks; approving an update publishes it.",
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
            "200": jsonResponse("{ uploadUrl, s3Key }"),
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
      "/api/v1/jobs": {
        get: {
          tags: ["Operations"],
          summary: "List background jobs (requires ops.view)",
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
