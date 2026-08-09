import {
  customType,
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
  passwordHash: text("password_hash").notNull(),
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("memberships_user_org_unique").on(t.userId, t.orgId),
    index("memberships_org_idx").on(t.orgId),
  ],
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("demo_workspaces_ip_expires_idx").on(t.ipHash, t.expiresAt),
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
  (t) => [index("milestones_project_idx").on(t.projectId)],
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("approvals_org_status_idx").on(t.orgId, t.status),
    index("approvals_subject_idx").on(t.subjectType, t.subjectId),
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("jobs_org_status_idx").on(t.orgId, t.status),
    index("jobs_dispatch_idx").on(t.status, t.dispatchedAt),
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
