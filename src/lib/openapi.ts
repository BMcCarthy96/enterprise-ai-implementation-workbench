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
        scimBearer: {
          type: "http",
          scheme: "bearer",
          description: "Organization-scoped SCIM token. The plaintext is shown only at creation.",
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
      "/api/proof/manifest": {
        get: {
          tags: ["Portfolio proof"],
          summary: "Public, secret-free proof claims and offline evaluation metadata",
          security: [],
          responses: { "200": jsonResponse("Proof manifest") },
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
      "/api/demo/role": {
        post: {
          tags: ["Demo"],
          summary: "Switch among seeded personas in the active isolated demo (never a production impersonation endpoint)",
          requestBody: body(z.object({
            role: z.enum(["org_admin", "implementation_manager", "solutions_engineer", "customer_stakeholder"]),
            returnTo: z.string().optional(),
          })),
          responses: {
            "200": jsonResponse("Session switched: { user, redirectTo, expiresAt }"),
            "400": { description: "Invalid persona" },
            "401": { description: "Active demo session required" },
            "403": { description: "Persona or origin not allowed" },
            "409": { description: "Persona seed unavailable" },
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
          summary: "List tenant-scoped AI evidence traces",
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
          summary: "Inspect a run's sanitized timeline, evaluations, grounding coverage, artifact, and approval",
          parameters: [pathParam("runId")],
          responses: { "200": jsonResponse("{ run, calls, evaluations, citations, artifact, approval, coverage }"), ...STD },
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
      "/api/v1/identity-connections": {
        get: {
          tags: ["Identity"],
          summary: "List organization-scoped OIDC connections (requires org.manage_identity)",
          responses: { "200": jsonResponse("{ connections }"), ...STD },
        },
        post: {
          tags: ["Identity"],
          summary: "Create an OIDC connection with an encrypted client secret",
          requestBody: body(z.object({
            slug: z.string(),
            issuerUrl: z.string().url(),
            clientId: z.string(),
            clientSecret: z.string().optional(),
            enabled: z.boolean().optional(),
            jitEnabled: z.boolean().optional(),
            allowedDomains: z.array(z.string()).optional(),
            groupMappings: z.record(z.string(), z.string()).optional(),
          })),
          responses: { "201": jsonResponse("OIDC connection"), ...STD },
        },
      },
      "/api/v1/identity-connections/{connectionId}": {
        patch: {
          tags: ["Identity"],
          summary: "Update or rotate credentials for an OIDC connection",
          parameters: [pathParam("connectionId")],
          requestBody: body(z.object({
            issuerUrl: z.string().url().optional(),
            clientId: z.string().optional(),
            clientSecret: z.string().optional(),
            enabled: z.boolean().optional(),
            jitEnabled: z.boolean().optional(),
            allowedDomains: z.array(z.string()).optional(),
            groupMappings: z.record(z.string(), z.string()).optional(),
          })),
          responses: { "200": jsonResponse("OIDC connection updated"), ...STD },
        },
        delete: {
          tags: ["Identity"],
          summary: "Disable an OIDC connection without deleting its audit history",
          parameters: [pathParam("connectionId")],
          responses: { "200": jsonResponse("OIDC connection disabled"), ...STD },
        },
      },
      "/api/v1/scim-tokens": {
        get: {
          tags: ["Identity"],
          summary: "List non-secret SCIM token metadata",
          responses: { "200": jsonResponse("{ tokens }"), ...STD },
        },
        post: {
          tags: ["Identity"],
          summary: "Rotate/create an organization-scoped SCIM bearer token",
          requestBody: body(z.object({ label: z.string().min(1), expiresAt: z.string().datetime().optional(), revokeTokenId: z.string().uuid().optional() })),
          responses: { "201": jsonResponse("{ token, tokenMetadata }"), ...STD },
        },
      },
      "/api/v1/scim-tokens/{tokenId}": {
        delete: {
          tags: ["Identity"],
          summary: "Revoke a SCIM bearer token",
          parameters: [pathParam("tokenId")],
          responses: { "204": { description: "Token revoked" }, ...STD },
        },
      },
      "/api/v1/webhooks": {
        get: {
          tags: ["Integrations"],
          summary: "List organization-scoped webhook endpoints",
          responses: { "200": jsonResponse("{ endpoints }"), ...STD },
        },
        post: {
          tags: ["Integrations"],
          summary: "Register a signed outbound webhook endpoint",
          requestBody: body(z.object({ url: z.string().url(), eventTypes: z.array(z.string()).min(1) })),
          responses: { "201": jsonResponse("{ endpoint, secret }"), ...STD },
        },
      },
      "/api/v1/webhooks/{endpointId}": {
        delete: {
          tags: ["Integrations"],
          summary: "Disable a webhook endpoint",
          parameters: [pathParam("endpointId")],
          responses: { "204": { description: "Endpoint disabled" }, ...STD },
        },
      },
      "/api/v1/webhooks/{endpointId}/test": {
        post: {
          tags: ["Integrations"],
          summary: "Queue a signed synthetic connectivity test through the durable job path",
          parameters: [pathParam("endpointId")],
          responses: { "202": jsonResponse("{ deliveryId, eventId, jobId }"), ...STD },
        },
      },
      "/api/v1/webhooks/{endpointId}/deliveries": {
        get: {
          tags: ["Integrations"],
          summary: "Read bounded webhook delivery history for one endpoint",
          parameters: [pathParam("endpointId"), { name: "limit", in: "query", schema: { type: "integer", maximum: 100 } }],
          responses: { "200": jsonResponse("{ deliveries }"), ...STD },
        },
      },
      "/api/v1/webhooks/{endpointId}/rotate-secret": {
        post: {
          tags: ["Integrations"],
          summary: "Rotate a webhook signing secret (plaintext shown once)",
          parameters: [pathParam("endpointId")],
          responses: { "200": jsonResponse("{ endpointId, secret }"), ...STD },
        },
      },
      "/api/v1/retention-policy": {
        get: {
          tags: ["Security"],
          summary: "Read the organization retention policy",
          responses: { "200": jsonResponse("{ policy }"), ...STD },
        },
        put: {
          tags: ["Security"],
          summary: "Update bounded organization retention windows",
          requestBody: body(z.object({
            auditDays: z.number().int().optional(),
            aiDetailDays: z.number().int().optional(),
            completedJobDays: z.number().int().optional(),
            webhookDeliveryDays: z.number().int().optional(),
          })),
          responses: { "200": jsonResponse("{ policy }"), ...STD },
        },
      },
      "/api/v1/retention-policy/preview": {
        get: {
          tags: ["Security"],
          summary: "Preview records selected by the current retention policy",
          responses: { "200": jsonResponse("{ policy, cutoffs, counts }"), ...STD },
        },
      },
      "/api/scim/v2/ServiceProviderConfig": {
        get: {
          tags: ["SCIM"],
          summary: "SCIM 2.0 service provider capabilities",
          security: [{ scimBearer: [] }],
          responses: { "200": jsonResponse("SCIM ServiceProviderConfig") },
        },
      },
      "/api/scim/v2/Users": {
        get: {
          tags: ["SCIM"],
          summary: "List/filter provisioned users",
          security: [{ scimBearer: [] }],
          responses: { "200": jsonResponse("SCIM ListResponse") },
        },
        post: {
          tags: ["SCIM"],
          summary: "Provision a user",
          security: [{ scimBearer: [] }],
          responses: { "201": jsonResponse("SCIM User"), "409": { description: "Conflicting role mapping or duplicate user" } },
        },
      },
      "/api/scim/v2/Users/{id}": {
        get: {
          tags: ["SCIM"],
          summary: "Read a provisioned user",
          security: [{ scimBearer: [] }],
          parameters: [pathParam("id")],
          responses: { "200": jsonResponse("SCIM User"), "404": { description: "User not found" } },
        },
        put: {
          tags: ["SCIM"],
          summary: "Replace a provisioned user",
          security: [{ scimBearer: [] }],
          parameters: [pathParam("id")],
          responses: { "200": jsonResponse("SCIM User"), "412": { description: "ETag precondition failed" } },
        },
        patch: {
          tags: ["SCIM"],
          summary: "Patch a provisioned user",
          security: [{ scimBearer: [] }],
          parameters: [pathParam("id")],
          responses: { "200": jsonResponse("SCIM User"), "412": { description: "ETag precondition failed" } },
        },
        delete: {
          tags: ["SCIM"],
          summary: "Deactivate a provisioned user",
          security: [{ scimBearer: [] }],
          parameters: [pathParam("id")],
          responses: { "204": { description: "User deactivated" }, "412": { description: "ETag precondition failed" } },
        },
      },
      "/api/scim/v2/Groups": {
        get: {
          tags: ["SCIM"],
          summary: "List directory groups and mapped roles",
          security: [{ scimBearer: [] }],
          responses: { "200": jsonResponse("SCIM ListResponse") },
        },
        post: {
          tags: ["SCIM"],
          summary: "Create a directory group",
          security: [{ scimBearer: [] }],
          responses: { "201": jsonResponse("SCIM Group") },
        },
      },
      "/api/scim/v2/Groups/{id}": {
        get: {
          tags: ["SCIM"],
          summary: "Read a directory group",
          security: [{ scimBearer: [] }],
          parameters: [pathParam("id")],
          responses: { "200": jsonResponse("SCIM Group"), "404": { description: "Group not found" } },
        },
        patch: {
          tags: ["SCIM"],
          summary: "Patch group membership with conflict-safe mapped roles",
          security: [{ scimBearer: [] }],
          parameters: [pathParam("id")],
          responses: { "200": jsonResponse("SCIM Group"), "409": { description: "Conflicting mapped role" } },
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
