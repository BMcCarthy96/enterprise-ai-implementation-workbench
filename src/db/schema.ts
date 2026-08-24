import {
  customType,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { DemoScenarioRefs } from "@/lib/tour";
import type { AiCallValidationEvidence } from "@/lib/ai/evidence";
import type { Role } from "@/lib/auth/rbac";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const membershipRole = pgEnum("membership_role", [
  "org_admin",
  "implementation_manager",
  "solutions_engineer",
  "customer_stakeholder",
]);

export const projectStatus = pgEnum("project_status", [
  "discovery",
  "planning",
  "in_delivery",
  "on_hold",
  "completed",
]);

export const requirementPriority = pgEnum("requirement_priority", [
  "low",
  "medium",
  "high",
  "critical",
]);

export const requirementStatus = pgEnum("requirement_status", [
  "new",
  "in_plan",
  "delivered",
  "deferred",
]);

export const planStatus = pgEnum("plan_status", [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "superseded",
]);

export const milestoneStatus = pgEnum("milestone_status", [
  "not_started",
  "in_progress",
  "complete",
]);

export const taskStatus = pgEnum("task_status", [
  "todo",
  "in_progress",
  "blocked",
  "in_review",
  "done",
]);

export const approvalSubjectType = pgEnum("approval_subject_type", [
  "plan",
  "customer_update",
]);

export const approvalStatus = pgEnum("approval_status", [
  "pending",
  "approved",
  "rejected",
]);

export const customerUpdateStatus = pgEnum("customer_update_status", [
  "draft",
  "pending_approval",
  "published",
  "rejected",
]);

export const jobType = pgEnum("job_type", [
  "plan_generation",
  "customer_update_digest",
  "document_ingest",
  "webhook_delivery",
]);

export const jobStatus = pgEnum("job_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "dead_letter",
]);

export const aiRunArtifactType = pgEnum("ai_run_artifact_type", [
  "plan",
  "customer_update",
  "document_ingest",
  "eval",
]);

export const aiRunStatus = pgEnum("ai_run_status", [
  "running",
  "succeeded",
  "failed",
]);

export const aiCallOperation = pgEnum("ai_call_operation", [
  "generate",
  "repair",
  "judge",
  "embed",
]);

export const aiCallUsageSource = pgEnum("ai_call_usage_source", [
  "reported",
  "estimated",
]);

export const aiCallOutcome = pgEnum("ai_call_outcome", [
  "valid",
  "invalid",
  "blocked",
  "failed",
]);

export const documentStatus = pgEnum("document_status", [
  "pending_upload",
  "queued",
  "processing",
  "ready",
  "failed",
]);

/** pgvector's wire representation is a bracketed, comma-separated vector. */
export const vector1024 = customType<{ data: number[]; driverData: string }>({
  dataType: () => "vector(1024)",
  toDriver: (value) => `[${value.join(",")}]`,
  fromDriver: (value) => {
    if (Array.isArray(value)) return value.map(Number);
    const raw = String(value).replace(/^\[/, "").replace(/\]$/, "");
    return raw ? raw.split(",").map(Number) : [];
  },
});

// ---------------------------------------------------------------------------
// Tenancy & identity
// ---------------------------------------------------------------------------

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  externalId: text("external_id"),
  // A SCIM user is owned by the organization whose bearer token created it.
  // Keeping that association separate from the globally-unique email/external
  // identifiers prevents an org-scoped SCIM lookup from crossing tenants.
  scimOrgId: uuid("scim_org_id").references(() => organizations.id, { onDelete: "set null" }),
  // SSO/SCIM-provisioned users may not have a local password.
  passwordHash: text("password_hash"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    role: membershipRole("role").notNull(),
    active: boolean("active").notNull().default(true),
    sessionVersion: integer("session_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("memberships_user_org_unique").on(t.userId, t.orgId),
    index("memberships_org_idx").on(t.orgId),
  ],
);

/**
 * Customer-facing demo and production users are assigned to the customers
 * they are allowed to see. Internal roles do not need rows here because their
 * org membership already grants portfolio access.
 */
export const customerAssignments = pgTable(
  "customer_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("customer_assignments_user_customer_unique").on(t.orgId, t.userId, t.customerId),
    index("customer_assignments_org_user_idx").on(t.orgId, t.userId),
    index("customer_assignments_org_customer_idx").on(t.orgId, t.customerId),
  ],
);

export const identityConnections = pgTable(
  "identity_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    issuerUrl: text("issuer_url").notNull(),
    clientId: text("client_id").notNull(),
    clientSecretCiphertext: text("client_secret_ciphertext"),
    encryptionKeyVersion: integer("encryption_key_version").notNull().default(1),
    enabled: boolean("enabled").notNull().default(false),
    jitEnabled: boolean("jit_enabled").notNull().default(false),
    allowedDomains: jsonb("allowed_domains").$type<string[]>().notNull().default([]),
    groupMappings: jsonb("group_mappings").$type<Record<string, Role>>().notNull().default({}),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("identity_connections_org_slug_unique").on(t.orgId, t.slug),
    index("identity_connections_org_idx").on(t.orgId),
  ],
);

export const externalIdentities = pgTable(
  "external_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id").notNull().references(() => identityConnections.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    email: text("email").notNull(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("external_identities_connection_subject_unique").on(t.connectionId, t.subject),
    index("external_identities_org_idx").on(t.orgId),
    index("external_identities_user_idx").on(t.userId),
  ],
);

export const scimTokens = pgTable(
  "scim_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("scim_tokens_org_idx").on(t.orgId)],
);

export const directoryGroups = pgTable(
  "directory_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    displayName: text("display_name").notNull(),
    mappedRole: membershipRole("mapped_role"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("directory_groups_org_external_unique").on(t.orgId, t.externalId),
    index("directory_groups_org_idx").on(t.orgId),
  ],
);

export const webhookEventTypes = [
  "approval.decided",
  "task.status_changed",
  "customer_update.published",
  "job.dead_letter",
  "webhook.test",
] as const;
export type WebhookEventType = (typeof webhookEventTypes)[number];

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    secretCiphertext: text("secret_ciphertext").notNull(),
    encryptionKeyVersion: integer("encryption_key_version").notNull().default(1),
    eventTypes: jsonb("event_types").$type<WebhookEventType[]>().notNull().default([]),
    enabled: boolean("enabled").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("webhook_endpoints_org_idx").on(t.orgId)],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    endpointId: uuid("endpoint_id").notNull().references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    /** Lease fencing for a delivery request that outlives a worker process. */
    claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
    responseStatus: integer("response_status"),
    responseBody: text("response_body"),
    lastError: text("last_error"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("webhook_deliveries_org_created_idx").on(t.orgId, t.createdAt),
    index("webhook_deliveries_endpoint_idx").on(t.endpointId),
    index("webhook_deliveries_claim_idx").on(t.status, t.claimExpiresAt),
    uniqueIndex("webhook_deliveries_event_endpoint_unique").on(t.endpointId, t.eventId),
  ],
);

export const retentionPolicies = pgTable(
  "retention_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().unique().references(() => organizations.id, { onDelete: "cascade" }),
    auditDays: integer("audit_days").notNull().default(365),
    aiDetailDays: integer("ai_detail_days").notNull().default(90),
    completedJobDays: integer("completed_job_days").notNull().default(30),
    webhookDeliveryDays: integer("webhook_delivery_days").notNull().default(30),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("retention_policies_org_idx").on(t.orgId)],
);

export const retentionRuns = pgTable(
  "retention_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("running"),
    counts: jsonb("counts").$type<Record<string, number>>().notNull().default({}),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("retention_runs_org_started_idx").on(t.orgId, t.startedAt)],
);

export const demoWorkspaces = pgTable(
  "demo_workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .unique()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    ipHash: text("ip_hash").notNull(),
    // A separate coarse network hash is used only for abuse backstop counts;
    // the visitor hash still keeps two people behind one NAT independent.
    networkHash: text("network_hash"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    generationJobsUsed: integer("generation_jobs_used").notNull().default(0),
    uploadCount: integer("upload_count").notNull().default(0),
    uploadBytes: integer("upload_bytes").notNull().default(0),
    reservedSpendUsd: numeric("reserved_spend_usd", { precision: 12, scale: 8 })
      .notNull()
      .default("0"),
    maxGenerationJobs: integer("max_generation_jobs").notNull().default(3),
    maxUploads: integer("max_uploads").notNull().default(2),
    maxStorageBytes: integer("max_storage_bytes").notNull().default(10 * 1024 * 1024),
    // Nullable by design: older isolated workspaces use the route-only tour
    // fallback until scheduled cleanup removes them.
    scenarioRefs: jsonb("scenario_refs").$type<DemoScenarioRefs | null>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("demo_workspaces_ip_expires_idx").on(t.ipHash, t.expiresAt),
    index("demo_workspaces_network_expires_idx").on(t.networkHash, t.expiresAt),
    index("demo_workspaces_expires_idx").on(t.expiresAt),
  ],
);

// ---------------------------------------------------------------------------
// Delivery domain
// ---------------------------------------------------------------------------

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    industry: text("industry"),
    primaryContactName: text("primary_contact_name"),
    primaryContactEmail: text("primary_contact_email"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("customers_org_idx").on(t.orgId)],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    status: projectStatus("status").notNull().default("discovery"),
    targetDate: timestamp("target_date", { withTimezone: true }),
    // Partial SLA threshold overrides (see src/lib/sla.ts). Only the fields the
    // project actually overrides are stored, so the rest keep tracking the
    // org defaults as those evolve. Null = inherit everything.
    slaPolicy: jsonb("sla_policy"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("projects_org_idx").on(t.orgId)],
);

export const requirements = pgTable(
  "requirements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    details: text("details"),
    priority: requirementPriority("priority").notNull().default("medium"),
    status: requirementStatus("status").notNull().default("new"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("requirements_project_idx").on(t.projectId)],
);

export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    status: planStatus("status").notNull().default("draft"),
    summary: text("summary"),
    // Structured plan output validated against PlanContentSchema before insert.
    content: jsonb("content"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    generatedByJobId: uuid("generated_by_job_id"),
    // Reviewer feedback (reason code + note) from a prior rejection that this
    // regeneration was asked to address — the human-in-the-loop signal fed
    // back into the prompt.
    incorporatedFeedback: text("incorporated_feedback"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("plans_project_idx").on(t.projectId)],
);

export const milestones = pgTable(
  "milestones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    planId: uuid("plan_id").references(() => plans.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    targetDate: timestamp("target_date", { withTimezone: true }),
    status: milestoneStatus("status").notNull().default("not_started"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("milestones_project_idx").on(t.projectId),
    uniqueIndex("milestones_plan_sort_unique").on(t.planId, t.sortOrder),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    milestoneId: uuid("milestone_id").references(() => milestones.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    description: text("description"),
    status: taskStatus("status").notNull().default("todo"),
    priority: requirementPriority("priority").notNull().default("medium"),
    assigneeId: uuid("assignee_id").references(() => users.id, {
      onDelete: "set null",
    }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("tasks_project_idx").on(t.projectId),
    index("tasks_assignee_idx").on(t.assigneeId),
    uniqueIndex("tasks_milestone_sort_unique").on(t.milestoneId, t.sortOrder),
  ],
);

// ---------------------------------------------------------------------------
// Governance
// ---------------------------------------------------------------------------

export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    subjectType: approvalSubjectType("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    status: approvalStatus("status").notNull().default("pending"),
    requestedBy: uuid("requested_by").references(() => users.id),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    reasonCode: text("reason_code"),
    note: text("note"),
    decisionKey: text("decision_key"),
    decisionFingerprint: text("decision_fingerprint"),
    regenerationJobId: uuid("regeneration_job_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("approvals_org_status_idx").on(t.orgId, t.status),
    index("approvals_subject_idx").on(t.subjectType, t.subjectId),
    uniqueIndex("approvals_decision_key_unique").on(t.id, t.decisionKey),
  ],
);

/** Durable handoff for rejection-triggered regeneration. The approval decision
 * and this intent commit together; queue delivery can be retried afterwards. */
export const approvalRegenerationIntents = pgTable(
  "approval_regeneration_intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    approvalId: uuid("approval_id")
      .notNull()
      .references(() => approvals.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    jobId: uuid("job_id"),
    status: text("status").notNull().default("queued"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("approval_regeneration_intents_approval_unique").on(t.approvalId),
    index("approval_regeneration_intents_org_status_idx").on(t.orgId, t.status),
  ],
);

export const customerUpdates = pgTable(
  "customer_updates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    status: customerUpdateStatus("status").notNull().default("draft"),
    generatedByJobId: uuid("generated_by_job_id"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("customer_updates_project_idx").on(t.projectId)],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    s3Key: text("s3_key").notNull(),
    status: documentStatus("status").notNull().default("pending_upload"),
    sha256: text("sha256"),
    errorCode: text("error_code"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    uploadedBy: uuid("uploaded_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("documents_project_idx").on(t.projectId)],
);

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    pageNumber: integer("page_number"),
    heading: text("heading"),
    tokenCount: integer("token_count").notNull().default(0),
    embedding: vector1024("embedding").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("document_chunks_document_index_unique").on(
      t.documentId,
      t.chunkIndex,
    ),
    index("document_chunks_project_idx").on(t.projectId),
    index("document_chunks_org_idx").on(t.orgId),
  ],
);

export const planCitations = pgTable(
  "plan_citations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    sourceRef: text("source_ref").notNull(),
    chunkId: uuid("chunk_id")
      .notNull()
      .references(() => documentChunks.id, { onDelete: "cascade" }),
    location: text("location"),
    retrieverVersion: text("retriever_version").notNull().default("hybrid-v1"),
    queryHash: text("query_hash"),
    rank: integer("rank"),
    vectorScore: numeric("vector_score", { precision: 10, scale: 8 }),
    lexicalScore: numeric("lexical_score", { precision: 10, scale: 8 }),
    selectionReason: text("selection_reason"),
    redactedExcerpt: text("redacted_excerpt"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("plan_citations_plan_ref_unique").on(t.planId, t.sourceRef),
    index("plan_citations_project_idx").on(t.projectId),
    index("plan_citations_chunk_idx").on(t.chunkId),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Null actor means the system/worker performed the action.
    actorId: uuid("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id"),
    projectId: uuid("project_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("audit_org_created_idx").on(t.orgId, t.createdAt),
    index("audit_project_idx").on(t.projectId),
  ],
);

// ---------------------------------------------------------------------------
// Background jobs
// ---------------------------------------------------------------------------

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    type: jobType("type").notNull(),
    status: jobStatus("status").notNull().default("queued"),
    payload: jsonb("payload"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    lastError: text("last_error"),
    requestedBy: uuid("requested_by").references(() => users.id),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    traceId: text("trace_id"),
    traceParent: text("trace_parent"),
    /** Lease metadata lets a re-delivered message reclaim a crashed worker. */
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("jobs_org_status_idx").on(t.orgId, t.status),
    index("jobs_dispatch_idx").on(t.status, t.dispatchedAt),
    index("jobs_lease_idx").on(t.status, t.leaseExpiresAt),
  ],
);

export const jobAttempts = pgTable(
  "job_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    attempt: integer("attempt").notNull(),
    workerId: text("worker_id"),
    status: text("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    error: text("error"),
    traceId: text("trace_id"),
  },
  (t) => [
    uniqueIndex("job_attempts_job_attempt_unique").on(t.jobId, t.attempt),
    index("job_attempts_org_started_idx").on(t.orgId, t.startedAt),
    index("job_attempts_job_idx").on(t.jobId, t.startedAt),
  ],
);

// ---------------------------------------------------------------------------
// AI observability
// ---------------------------------------------------------------------------

export const aiRuns = pgTable(
  "ai_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    artifactType: aiRunArtifactType("artifact_type").notNull(),
    provider: text("provider").notNull(),
    model: text("model"),
    promptVersion: text("prompt_version"),
    dataOrigin: text("data_origin").$type<"fixture" | "mock_run" | "live_provider">().notNull().default("live_provider"),
    status: aiRunStatus("status").notNull().default("running"),
    finalOutcome: text("final_outcome"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    redactionCount: integer("redaction_count").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 8 }),
    pricingVersion: text("pricing_version"),
    latencyMs: integer("latency_ms"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("ai_runs_org_created_idx").on(t.orgId, t.createdAt),
    index("ai_runs_project_idx").on(t.projectId),
    index("ai_runs_job_idx").on(t.jobId),
  ],
);

export const aiCalls = pgTable(
  "ai_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    aiRunId: uuid("ai_run_id")
      .notNull()
      .references(() => aiRuns.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    operation: aiCallOperation("operation").notNull(),
    provider: text("provider").notNull(),
    model: text("model"),
    promptVersion: text("prompt_version"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    redactionCount: integer("redaction_count").notNull().default(0),
    usageSource: aiCallUsageSource("usage_source").notNull(),
    costUsd: numeric("cost_usd", { precision: 12, scale: 8 }),
    pricingVersion: text("pricing_version"),
    latencyMs: integer("latency_ms"),
    outcome: aiCallOutcome("outcome").notNull(),
    errorKind: text("error_kind"),
    validationEvidence: jsonb("validation_evidence").$type<AiCallValidationEvidence | null>(),
    providerRequestId: text("provider_request_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("ai_calls_run_sequence_idx").on(t.aiRunId, t.sequence),
    index("ai_calls_org_created_idx").on(t.orgId, t.createdAt),
  ],
);

export const aiRunEvaluations = pgTable(
  "ai_run_evaluations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    aiRunId: uuid("ai_run_id")
      .notNull()
      .references(() => aiRuns.id, { onDelete: "cascade" }),
    checkName: text("check_name").notNull(),
    category: text("category").notNull(),
    gateLevel: text("gate_level").notNull(),
    score: numeric("score", { precision: 8, scale: 6 }).notNull(),
    threshold: numeric("threshold", { precision: 8, scale: 6 }).notNull(),
    passed: boolean("passed").notNull().default(false),
    detail: text("detail").notNull(),
    evaluatorVersion: text("evaluator_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("ai_run_evaluations_unique").on(t.aiRunId, t.checkName, t.evaluatorVersion),
    index("ai_run_evaluations_org_idx").on(t.orgId, t.createdAt),
    index("ai_run_evaluations_run_idx").on(t.aiRunId),
  ],
);
