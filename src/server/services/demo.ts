import { createHash } from "node:crypto";
import { and, eq, gt, lt, ne, sql } from "drizzle-orm";
import { db, dbAdmin, schema } from "@/db";
import { deletePrefix, documentKey, putObject } from "@/lib/aws/s3";
import { embeddingProvider, mockEmbedding } from "@/lib/ai/embeddings";
import { PlanContentSchema, PROMPT_VERSION } from "@/lib/ai/planSchema";
import { buildPlanEvaluationRows } from "@/lib/ai/evidence";
import { ApiError } from "@/lib/api";
import { hashPassword } from "@/lib/auth/password";
import { createSessionToken, type SessionPayload } from "@/lib/auth/session";
import { ROLES, type Role } from "@/lib/auth/rbac";
import { safeDemoReturnPath, type DemoScenarioRefs } from "@/lib/tour";

export const DEMO_TTL_SECONDS = 60 * 60;
export const DEMO_MAX_ACTIVE = 20;
function configuredPositiveNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
const DEMO_MAX_DAILY_SPEND_USD = configuredPositiveNumber("DEMO_MAX_DAILY_SPEND_USD", 1);
const DEMO_MAX_MONTHLY_SPEND_USD = configuredPositiveNumber("DEMO_MAX_MONTHLY_SPEND_USD", 15);
const DEMO_MAX_GENERATION_JOBS = Math.max(1, Math.floor(configuredPositiveNumber("DEMO_MAX_GENERATION_JOBS", 1)));
export const DEMO_ESTIMATED_RESERVATION_USD = 0.05;

export const DEMO_PERSONA_ROLES = [
  "org_admin",
  "implementation_manager",
  "solutions_engineer",
  "customer_stakeholder",
] as const satisfies readonly Role[];

function demoRefs(value: unknown): DemoScenarioRefs | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<DemoScenarioRefs>;
  if (
    !candidate.personaUserIds?.org_admin ||
    !candidate.personaUserIds?.implementation_manager ||
    !candidate.personaUserIds?.solutions_engineer ||
    !candidate.personaUserIds?.customer_stakeholder
  ) return null;
  return candidate as DemoScenarioRefs;
}

function remainingDemoTtlSeconds(expiresAt: Date): number {
  return Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 1000));
}

const demoDaysAgo = (days: number, hourOffset = 0) =>
  new Date(Date.now() - days * 86_400_000 + hourOffset * 3_600_000);

function buildDemoPlan(input: {
  projectName: string;
  customerName: string;
  requirements: Array<{ id: string; title: string; details: string }>;
  grounded?: boolean;
}) {
  const sourceRefs = input.grounded ? ["S1"] : undefined;
  return PlanContentSchema.parse({
    summary: `Phased implementation of ${input.projectName} for ${input.customerName}, covering ${input.requirements.length} validated requirements from discovery through controlled launch and operational handoff.`,
    ...(sourceRefs ? { summarySourceRefs: sourceRefs } : {}),
    assumptions: [
      `${input.customerName} provides a technical owner and weekly review availability.`,
      "Required sandbox credentials are available before configuration begins.",
      "New scope enters the documented change-control process.",
    ],
    risks: [
      {
        description: "Delayed source-system access could compress validation time.",
        severity: "medium",
        mitigation: "Track access as a kickoff exit criterion and escalate after two business days.",
        ...(sourceRefs ? { sourceRefs } : {}),
      },
      {
        description: "Operational edge cases may appear late in user acceptance testing.",
        severity: "high",
        mitigation: "Replay representative exception scenarios in the sandbox before UAT sign-off.",
        ...(sourceRefs ? { sourceRefs } : {}),
      },
    ],
    milestones: [
      {
        name: "Discovery & Architecture",
        description: "Confirm scope, success measures, integration boundaries, and delivery controls.",
        durationWeeks: 1,
        ...(sourceRefs ? { sourceRefs } : {}),
        tasks: [
          {
            title: "Confirm acceptance criteria and owners",
            description: "Validate every requirement with business and technical stakeholders.",
            suggestedRole: "implementation_manager",
            estimateHours: 6,
            ...(sourceRefs ? { sourceRefs } : {}),
          },
          {
            title: "Finalize solution architecture",
            description: "Document system boundaries, security roles, data flow, and failure handling.",
            suggestedRole: "solutions_engineer",
            estimateHours: 10,
            ...(sourceRefs ? { sourceRefs } : {}),
          },
        ],
      },
      {
        name: "Platform Foundation",
        description: "Provision the sandbox, access controls, observability, and deployment path.",
        durationWeeks: 1.5,
        ...(sourceRefs ? { sourceRefs } : {}),
        tasks: [
          {
            title: "Provision sandbox and delivery pipeline",
            description: "Create isolated environments with deployment checks and rollback guidance.",
            suggestedRole: "solutions_engineer",
            estimateHours: 16,
            ...(sourceRefs ? { sourceRefs } : {}),
          },
          {
            title: "Configure roles, alerts, and audit controls",
            description: "Apply least-privilege roles and operational telemetry before feature work.",
            suggestedRole: "solutions_engineer",
            estimateHours: 12,
            ...(sourceRefs ? { sourceRefs } : {}),
          },
        ],
      },
      {
        name: "Requirement Build",
        description: "Deliver the approved requirements iteratively, highest business risk first.",
        durationWeeks: 3,
        ...(sourceRefs ? { sourceRefs } : {}),
        tasks: input.requirements.map((requirement, index) => ({
          title: `Implement: ${requirement.title}`,
          description: requirement.details,
          requirementIds: [requirement.id],
          suggestedRole: "solutions_engineer",
          estimateHours: index === 0 ? 24 : 16,
          ...(sourceRefs ? { sourceRefs } : {}),
        })),
      },
      {
        name: "Validation, Launch & Handoff",
        description: "Prove the workflow, obtain approval, launch safely, and transfer ownership.",
        durationWeeks: 2,
        ...(sourceRefs ? { sourceRefs } : {}),
        tasks: [
          {
            title: "Run UAT and exception-path validation",
            description: "Test acceptance criteria and failure scenarios with customer participants.",
            suggestedRole: "implementation_manager",
            estimateHours: 16,
            ...(sourceRefs ? { sourceRefs } : {}),
          },
          {
            title: "Execute launch and operational handoff",
            description: "Complete go-live checks, training, runbooks, and support ownership transfer.",
            suggestedRole: "implementation_manager",
            estimateHours: 12,
            ...(sourceRefs ? { sourceRefs } : {}),
          },
        ],
      },
    ],
    openQuestions: [
      `Who provides final UAT sign-off for ${input.customerName}?`,
      "Which operational metrics should trigger a post-launch escalation?",
    ],
  });
}

export function hashDemoIp(ip: string): string {
  return createHash("sha256")
    .update(`${process.env.SESSION_SECRET ?? "demo"}:${ip}`)
    .digest("hex");
}

export function clientIp(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headers.get("x-real-ip") ??
    "unknown"
  );
}

export async function createDemoWorkspace(ip: string): Promise<{
  workspace: typeof schema.demoWorkspaces.$inferSelect;
  token: string;
}> {
  const ipHash = hashDemoIp(ip);
  const now = new Date();
  const existing = await dbAdmin.query.demoWorkspaces.findFirst({
    where: and(eq(schema.demoWorkspaces.ipHash, ipHash), gt(schema.demoWorkspaces.expiresAt, now)),
  });
  if (existing) return issueDemoSession(existing);

  const active = await dbAdmin.$count(
    schema.demoWorkspaces,
    gt(schema.demoWorkspaces.expiresAt, now),
  );
  if (active >= DEMO_MAX_ACTIVE) {
    throw new ApiError(429, "Interactive demo capacity is full; try again shortly", "DEMO_LIMIT_REACHED");
  }

  return provisionDemoWorkspace(ipHash, new Date(now.getTime() + DEMO_TTL_SECONDS * 1000));
}

/** Provision a fresh isolated workspace without consulting the visitor cap. */
async function provisionDemoWorkspace(
  ipHash: string,
  expiresAt: Date,
): Promise<{
  workspace: typeof schema.demoWorkspaces.$inferSelect;
  token: string;
}> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const orgId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const personaUserIds: Record<Role, string> = {
    org_admin: crypto.randomUUID(),
    implementation_manager: userId,
    solutions_engineer: crypto.randomUUID(),
    customer_stakeholder: crypto.randomUUID(),
  };
  const customerId = crypto.randomUUID();
  const healthcareCustomerId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const claimsProjectId = crypto.randomUUID();
  const onboardingProjectId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const requirementIds = [
    crypto.randomUUID(),
    crypto.randomUUID(),
    crypto.randomUUID(),
    crypto.randomUUID(),
  ];
  const claimsRequirementIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const onboardingRequirementIds = [
    crypto.randomUUID(),
    crypto.randomUUID(),
    crypto.randomUUID(),
    crypto.randomUUID(),
  ];
  const passwordHash = await hashPassword(crypto.randomUUID());
  const documentText = `# Order intake implementation brief

Brightlane wants a controlled order intake workflow for approved source systems. Each submission must validate origin, destination, weight class, and service level. Carrier assignment must happen before an exception is opened, and manual overrides require a logged reason. Unresolved orders should route to a review queue with standardized reason codes. Operations leadership needs a daily summary of volume, exceptions, and unassigned orders. The implementation manager must approve the launch plan before delivery tasks are created.`;
  const documentBuffer = Buffer.from(documentText, "utf8");
  const s3Key = documentKey(orgId, projectId, "order-intake-brief.md", documentId);
  const embeddingResult =
    process.env.EMBEDDING_PROVIDER === "bedrock"
      ? await (await embeddingProvider()).embed(documentText)
      : null;
  const embedding = embeddingResult?.vector ?? mockEmbedding(documentText);
  const orderRequirements = [
    {
      id: requirementIds[0],
      title: "Structured order intake",
      details: "Capture and validate origin, destination, weight class, and service level from approved sources.",
      priority: "critical" as const,
    },
    {
      id: requirementIds[1],
      title: "Carrier assignment rules",
      details: "Assign carriers by lane, weight, and contract priority with audited manual overrides.",
      priority: "critical" as const,
    },
    {
      id: requirementIds[2],
      title: "Exception review queue",
      details: "Route failed validations into a reviewable queue with standardized reason codes.",
      priority: "high" as const,
    },
    {
      id: requirementIds[3],
      title: "Daily operations summary",
      details: "Summarize intake volume, unresolved exceptions, and unassigned orders for operations leadership.",
      priority: "medium" as const,
    },
  ];
  const claimsRequirements = [
    {
      id: claimsRequirementIds[0],
      title: "Automated payer status polling",
      details: "Poll the clearinghouse and surface claim status changes without manual portal checks.",
      priority: "high" as const,
    },
    {
      id: claimsRequirementIds[1],
      title: "Denial-reason routing",
      details: "Route denied claims to specialist queues based on the payer denial code.",
      priority: "high" as const,
    },
    {
      id: claimsRequirementIds[2],
      title: "Claims aging dashboard",
      details: "Highlight outstanding claims in 30, 60, and 90-day aging buckets.",
      priority: "medium" as const,
    },
  ];
  const onboardingRequirements = [
    {
      id: onboardingRequirementIds[0],
      title: "Digital intake packet with e-signature",
      details: "Let new patients complete demographics, history, and consent forms before arrival.",
      priority: "critical" as const,
    },
    {
      id: onboardingRequirementIds[1],
      title: "Insurance verification checklist",
      details: "Track verification steps and flag expired or mismatched coverage before appointments.",
      priority: "high" as const,
    },
    {
      id: onboardingRequirementIds[2],
      title: "Appointment-prep reminder sequence",
      details: "Send 48-hour and 24-hour reminders with required documents and arrival guidance.",
      priority: "medium" as const,
    },
    {
      id: onboardingRequirementIds[3],
      title: "Staff onboarding-status dashboard",
      details: "Show each patient workflow stage and highlight records that are stuck or incomplete.",
      priority: "high" as const,
    },
  ];
  const orderPlanContent = buildDemoPlan({
    projectName: "Order Intake Automation",
    customerName: "Brightlane Logistics",
    requirements: orderRequirements,
    grounded: true,
  });
  const claimsPlanContent = buildDemoPlan({
    projectName: "Claims Status Tracker",
    customerName: "Harbor Health Clinic",
    requirements: claimsRequirements,
  });

  try {
    await putObject(s3Key, documentBuffer, "text/markdown");
    const workspace = await dbAdmin.transaction(async (tx) => {
      await tx.insert(schema.organizations).values({
        id: orgId,
        name: `Enterprise AI Demo · ${suffix}`,
        slug: `demo-${suffix}`,
      });
      await tx.insert(schema.users).values([
        { id: personaUserIds.org_admin, email: `demo-${suffix}-admin@demo.workbench.local`, name: "Demo Operations Admin", passwordHash },
        { id: personaUserIds.implementation_manager, email: `demo-${suffix}-manager@demo.workbench.local`, name: "Demo Implementation Manager", passwordHash },
        { id: personaUserIds.solutions_engineer, email: `demo-${suffix}-engineer@demo.workbench.local`, name: "Demo Solutions Engineer", passwordHash },
        { id: personaUserIds.customer_stakeholder, email: `demo-${suffix}-customer@demo.workbench.local`, name: "Demo Customer Stakeholder", passwordHash },
      ]);
      await tx.insert(schema.memberships).values([
        { orgId, userId: personaUserIds.org_admin, role: "org_admin" },
        { orgId, userId: personaUserIds.implementation_manager, role: "implementation_manager" },
        { orgId, userId: personaUserIds.solutions_engineer, role: "solutions_engineer" },
        { orgId, userId: personaUserIds.customer_stakeholder, role: "customer_stakeholder" },
      ]);
      await tx.insert(schema.demoWorkspaces).values({
        orgId,
        userId,
        ipHash,
        expiresAt,
        // Public workspaces are intentionally capped to one live generation;
        // seeded evidence keeps the rest of the recruiter walkthrough instant.
        maxGenerationJobs: DEMO_MAX_GENERATION_JOBS,
      });
      await tx.insert(schema.customers).values([
        {
          id: customerId,
          orgId,
          name: "Brightlane Logistics",
          industry: "Logistics & Freight",
          primaryContactName: "Sam Osei",
          primaryContactEmail: "sam.osei@brightlane.example",
        },
        {
          id: healthcareCustomerId,
          orgId,
          name: "Harbor Health Clinic",
          industry: "Healthcare",
          primaryContactName: "Dana Whitfield",
          primaryContactEmail: "dana.whitfield@harborhealth.example",
        },
      ]);
      await tx.insert(schema.projects).values([
        {
          id: projectId,
          orgId,
          customerId,
          name: "Order Intake Automation",
          description:
            "Replace email-based order intake with validated submissions, carrier routing, and an exception workflow backed by a human-approved AI delivery plan.",
          status: "in_delivery",
          targetDate: demoDaysAgo(-45),
          createdBy: userId,
          createdAt: demoDaysAgo(30),
        },
        {
          id: claimsProjectId,
          orgId,
          customerId: healthcareCustomerId,
          name: "Claims Status Tracker",
          description:
            "Give the billing team payer-status automation, denial routing, and an aging dashboard; the generated plan is waiting for manager approval.",
          status: "planning",
          targetDate: demoDaysAgo(-12),
          createdBy: userId,
          createdAt: demoDaysAgo(4),
        },
        {
          id: onboardingProjectId,
          orgId,
          customerId: healthcareCustomerId,
          name: "Patient Onboarding Portal",
          description:
            "A discovery-ready project with four validated requirements and no plan yet—use it to demonstrate live generation, approval, and task materialization.",
          status: "discovery",
          targetDate: demoDaysAgo(-75),
          createdBy: userId,
          createdAt: demoDaysAgo(1),
        },
      ]);
      await tx.insert(schema.requirements).values([
        ...orderRequirements.map((requirement, index) => ({
          ...requirement,
          orgId,
          projectId,
          status: "in_plan" as const,
          createdBy: userId,
          createdAt: demoDaysAgo(28, index),
        })),
        ...claimsRequirements.map((requirement, index) => ({
          ...requirement,
          orgId,
          projectId: claimsProjectId,
          status: "new" as const,
          createdBy: userId,
          createdAt: demoDaysAgo(3, index),
        })),
        ...onboardingRequirements.map((requirement, index) => ({
          ...requirement,
          orgId,
          projectId: onboardingProjectId,
          status: "new" as const,
          createdBy: userId,
          createdAt: demoDaysAgo(1, index),
        })),
      ]);
      await tx.insert(schema.documents).values({
        id: documentId,
        orgId,
        projectId,
        fileName: "order-intake-brief.md",
        contentType: "text/markdown",
        sizeBytes: documentBuffer.byteLength,
        s3Key,
        status: "ready",
        sha256: createHash("sha256").update(documentBuffer).digest("hex"),
        processedAt: demoDaysAgo(18),
        uploadedBy: userId,
        createdAt: demoDaysAgo(19),
      });
      const [documentChunk] = await tx
        .insert(schema.documentChunks)
        .values({
          orgId,
          projectId,
          documentId,
          chunkIndex: 0,
          content: documentText,
          contentHash: createHash("sha256").update(documentText).digest("hex"),
          heading: "Order intake implementation brief",
          tokenCount: documentText.split(/\s+/).length,
          embedding,
          createdAt: demoDaysAgo(18),
        })
        .returning({ id: schema.documentChunks.id });

      const [generationJob] = await tx
        .insert(schema.jobs)
        .values({
          orgId,
          projectId,
          type: "plan_generation",
          status: "succeeded",
          attempts: 1,
          requestedBy: userId,
          startedAt: demoDaysAgo(17),
          finishedAt: demoDaysAgo(17, 0.01),
          durationMs: 2350,
          createdAt: demoDaysAgo(17),
        })
        .returning();
      const [aiRun] = await tx
        .insert(schema.aiRuns)
        .values({
          orgId,
          projectId,
          jobId: generationJob.id,
          artifactType: "plan",
          provider: "mock",
          model: "mock",
          promptVersion: PROMPT_VERSION,
          dataOrigin: "fixture",
          status: "succeeded",
          finalOutcome: "repaired",
          inputTokens: 1200,
          outputTokens: 900,
          // Fixture telemetry is intentionally not priced. Live/provider runs
          // calculate cost only when a versioned model price is known.
          costUsd: null,
          pricingVersion: null,
          latencyMs: 2350,
          startedAt: demoDaysAgo(17),
          finishedAt: demoDaysAgo(17, 0.01),
          createdAt: demoDaysAgo(17),
        })
        .returning();
      await tx.insert(schema.aiCalls).values([
        {
          aiRunId: aiRun.id,
          orgId,
          sequence: 1,
          operation: "generate",
          provider: "mock",
          model: "mock",
          promptVersion: PROMPT_VERSION,
          inputTokens: 900,
          outputTokens: 700,
          usageSource: "estimated",
          latencyMs: 1800,
          outcome: "invalid",
          errorKind: "schema_validation",
          validationEvidence: {
            evaluatorVersion: "evidence-v1",
            schemaValid: false,
            guardrailPassed: false,
            failureCodes: ["SCHEMA_VALIDATION_FAILED"],
            issuePaths: ["milestones[0].tasks[0].requirementIds"],
          },
          createdAt: demoDaysAgo(17),
        },
        {
          aiRunId: aiRun.id,
          orgId,
          sequence: 2,
          operation: "repair",
          provider: "mock",
          model: "mock",
          promptVersion: PROMPT_VERSION,
          inputTokens: 300,
          outputTokens: 200,
          usageSource: "estimated",
          latencyMs: 550,
          outcome: "valid",
          validationEvidence: {
            evaluatorVersion: "evidence-v1",
            schemaValid: true,
            guardrailPassed: true,
            failureCodes: [],
          },
          createdAt: demoDaysAgo(17, 0.01),
        },
      ]);

      const [approvedPlan] = await tx
        .insert(schema.plans)
        .values({
          orgId,
          projectId,
          version: 2,
          status: "approved",
          summary: orderPlanContent.summary,
          content: orderPlanContent,
          model: "mock",
          promptVersion: PROMPT_VERSION,
          generatedByJobId: generationJob.id,
          incorporatedFeedback:
            "wrong sequencing — carrier assignment must precede exception routing",
          createdBy: userId,
          createdAt: demoDaysAgo(16),
        })
        .returning();
      await tx.insert(schema.planCitations).values({
        orgId,
        projectId,
        planId: approvedPlan.id,
        sourceRef: "S1",
        chunkId: documentChunk.id,
        location: "order-intake-brief.md · Order intake implementation brief",
        createdAt: demoDaysAgo(16),
      });
      const demoEvaluations = buildPlanEvaluationRows(
        {
          projectName: "Order Intake Automation",
          projectDescription: "Grounded demo plan",
          customerName: "Brightlane Logistics",
          customerIndustry: "Logistics & Freight",
          targetDate: null,
          requirements: orderRequirements,
          sources: [{ ref: "S1", documentName: "order-intake-brief.md", pageNumber: null, heading: "Order intake implementation brief", content: documentText }],
        },
        orderPlanContent,
      );
      await tx.insert(schema.aiRunEvaluations).values(demoEvaluations.map((evaluation) => ({
        orgId,
        aiRunId: aiRun.id,
        checkName: evaluation.checkName,
        category: evaluation.category,
        gateLevel: evaluation.gateLevel,
        score: evaluation.score.toFixed(6),
        threshold: evaluation.threshold.toFixed(6),
        passed: evaluation.passed,
        detail: evaluation.detail,
        evaluatorVersion: evaluation.evaluatorVersion,
        createdAt: demoDaysAgo(16),
      })));
      const [approvedPlanApproval] = await tx.insert(schema.approvals).values({
        orgId,
        projectId,
        subjectType: "plan",
        subjectId: approvedPlan.id,
        status: "approved",
        requestedBy: userId,
        decidedBy: userId,
        decidedAt: demoDaysAgo(15),
        note: "Revised sequencing is grounded in the implementation brief. Approved for delivery.",
        createdAt: demoDaysAgo(16),
      }).returning({ id: schema.approvals.id });

      const taskStatuses = [
        ["done", "done"],
        ["done", "in_progress"],
        ["done", "in_progress", "blocked", "todo"],
        ["todo", "todo"],
      ] as const;
      const milestoneStatuses = ["complete", "in_progress", "in_progress", "not_started"] as const;
      for (const [milestoneIndex, milestoneContent] of orderPlanContent.milestones.entries()) {
        const [milestone] = await tx
          .insert(schema.milestones)
          .values({
            orgId,
            projectId,
            planId: approvedPlan.id,
            name: milestoneContent.name,
            description: milestoneContent.description,
            sortOrder: milestoneIndex,
            status: milestoneStatuses[milestoneIndex] ?? "not_started",
            createdAt: demoDaysAgo(15),
          })
          .returning();
        for (const [taskIndex, taskContent] of milestoneContent.tasks.entries()) {
          const status = taskStatuses[milestoneIndex]?.[taskIndex] ?? "todo";
          await tx.insert(schema.tasks).values({
            orgId,
            projectId,
            milestoneId: milestone.id,
            title: taskContent.title,
            description: taskContent.description,
            status,
            priority: status === "blocked" ? "critical" : "high",
            assigneeId: status === "todo" ? null : userId,
            sortOrder: taskIndex,
            createdAt: demoDaysAgo(15),
            updatedAt: demoDaysAgo(status === "done" ? 9 : status === "blocked" ? 8 : 2),
          });
        }
      }

      const [digestJob] = await tx
        .insert(schema.jobs)
        .values({
          orgId,
          projectId,
          type: "customer_update_digest",
          status: "succeeded",
          attempts: 1,
          requestedBy: userId,
          startedAt: demoDaysAgo(4),
          finishedAt: demoDaysAgo(4, 0.01),
          durationMs: 1830,
          createdAt: demoDaysAgo(4),
        })
        .returning();
      const [publishedUpdate] = await tx
        .insert(schema.customerUpdates)
        .values({
          orgId,
          projectId,
          title: "Order Intake Automation — Progress Update",
          body: [
            "Discovery is complete and the delivery foundation is in place.",
            "The structured intake workflow has passed sandbox validation, while carrier assignment rules are in active build. One item is blocked pending Brightlane's sign-off on exception reason codes.",
            "The project remains on track for launch if that decision lands this week. The next checkpoint covers carrier-rule test results and UAT readiness.",
          ].join("\n\n"),
          status: "published",
          generatedByJobId: digestJob.id,
          publishedAt: demoDaysAgo(3),
          createdBy: userId,
          createdAt: demoDaysAgo(4),
        })
        .returning();
      await tx.insert(schema.approvals).values({
        orgId,
        projectId,
        subjectType: "customer_update",
        subjectId: publishedUpdate.id,
        status: "approved",
        requestedBy: userId,
        decidedBy: userId,
        decidedAt: demoDaysAgo(3),
        note: "Accurate, concise, and appropriate for the customer audience.",
        createdAt: demoDaysAgo(4),
      });
      const [pendingUpdate] = await tx
        .insert(schema.customerUpdates)
        .values({
          orgId,
          projectId,
          title: "Order Intake Automation — UAT Readiness",
          body:
            "Carrier assignment rules are feature-complete in the sandbox. The team is ready to begin UAT after Brightlane confirms the exception reason-code list and identifies final sign-off participants.",
          status: "pending_approval",
          createdBy: userId,
          createdAt: demoDaysAgo(0, -5),
        })
        .returning();
      const [pendingUpdateApproval] = await tx.insert(schema.approvals).values({
        orgId,
        projectId,
        subjectType: "customer_update",
        subjectId: pendingUpdate.id,
        status: "pending",
        requestedBy: userId,
        createdAt: demoDaysAgo(0, -5),
      }).returning({ id: schema.approvals.id });

      const [claimsGenerationJob] = await tx
        .insert(schema.jobs)
        .values({
          orgId,
          projectId: claimsProjectId,
          type: "plan_generation",
          status: "succeeded",
          attempts: 1,
          requestedBy: userId,
          startedAt: demoDaysAgo(2),
          finishedAt: demoDaysAgo(2, 0.01),
          durationMs: 2100,
          createdAt: demoDaysAgo(2),
        })
        .returning();
      const [claimsPlan] = await tx
        .insert(schema.plans)
        .values({
          orgId,
          projectId: claimsProjectId,
          version: 1,
          status: "pending_approval",
          summary: claimsPlanContent.summary,
          content: claimsPlanContent,
          model: "mock",
          promptVersion: PROMPT_VERSION,
          generatedByJobId: claimsGenerationJob.id,
          createdBy: userId,
          createdAt: demoDaysAgo(2),
        })
        .returning();
      const [pendingPlanApproval] = await tx.insert(schema.approvals).values({
        orgId,
        projectId: claimsProjectId,
        subjectType: "plan",
        subjectId: claimsPlan.id,
        status: "pending",
        // The engineer produced this AI plan; the manager must be the
        // independent reviewer in the seeded maker-checker walkthrough.
        requestedBy: personaUserIds.solutions_engineer,
        createdAt: demoDaysAgo(2),
      }).returning({ id: schema.approvals.id });
      const [deadLetterJob] = await tx
        .insert(schema.jobs)
        .values({
          orgId,
          projectId: claimsProjectId,
          type: "customer_update_digest",
          status: "dead_letter",
          attempts: 3,
          maxAttempts: 3,
          lastError:
            "ThrottlingException: model capacity exceeded after three retry attempts; manual retry is available.",
          requestedBy: userId,
          startedAt: demoDaysAgo(1),
          finishedAt: demoDaysAgo(1, 0.02),
          durationMs: 4120,
          createdAt: demoDaysAgo(1),
        })
        .returning();

      await tx.insert(schema.auditEvents).values([
        {
          orgId,
          actorId: userId,
          action: "demo.workspace_seeded",
          subjectType: "organization",
          subjectId: orgId,
          metadata: { synthetic: true, scenario: "recruiter_walkthrough" },
          createdAt: demoDaysAgo(30),
        },
        {
          orgId,
          actorId: userId,
          action: "project.created",
          subjectType: "project",
          subjectId: projectId,
          projectId,
          metadata: { name: "Order Intake Automation" },
          createdAt: demoDaysAgo(30),
        },
        {
          orgId,
          actorId: null,
          action: "plan.generated",
          subjectType: "plan",
          subjectId: approvedPlan.id,
          projectId,
          metadata: { model: "mock", promptVersion: PROMPT_VERSION, outcome: "repaired" },
          createdAt: demoDaysAgo(17),
        },
        {
          orgId,
          actorId: userId,
          action: "approval.approved",
          subjectType: "plan",
          subjectId: approvedPlan.id,
          projectId,
          metadata: { note: "sequencing corrected" },
          createdAt: demoDaysAgo(15),
        },
        {
          orgId,
          actorId: userId,
          action: "task.status_changed",
          subjectType: "task",
          projectId,
          metadata: { from: "in_progress", to: "blocked", reason: "customer decision" },
          createdAt: demoDaysAgo(8),
        },
        {
          orgId,
          actorId: null,
          action: "customer_update.generated",
          subjectType: "customer_update",
          subjectId: publishedUpdate.id,
          projectId,
          metadata: { model: "mock" },
          createdAt: demoDaysAgo(4),
        },
        {
          orgId,
          actorId: userId,
          action: "project.created",
          subjectType: "project",
          subjectId: claimsProjectId,
          projectId: claimsProjectId,
          metadata: { name: "Claims Status Tracker" },
          createdAt: demoDaysAgo(4),
        },
        {
          orgId,
          actorId: null,
          action: "plan.generated",
          subjectType: "plan",
          subjectId: claimsPlan.id,
          projectId: claimsProjectId,
          metadata: { model: "mock", promptVersion: PROMPT_VERSION },
          createdAt: demoDaysAgo(2),
        },
        {
          orgId,
          actorId: null,
          action: "job.dead_letter",
          subjectType: "job",
          subjectId: deadLetterJob.id,
          projectId: claimsProjectId,
          metadata: { type: "customer_update_digest", attempts: 3 },
          createdAt: demoDaysAgo(1),
        },
        {
          orgId,
          actorId: userId,
          action: "project.created",
          subjectType: "project",
          subjectId: onboardingProjectId,
          projectId: onboardingProjectId,
          metadata: { name: "Patient Onboarding Portal", demoAction: "generate_plan" },
          createdAt: demoDaysAgo(1),
        },
      ]);
      const scenarioRefs: DemoScenarioRefs = {
        personaUserIds,
        projectIds: {
          orderIntake: projectId,
          claimsStatus: claimsProjectId,
          patientOnboarding: onboardingProjectId,
        },
        planIds: { approved: approvedPlan.id, pending: claimsPlan.id },
        aiRunId: aiRun.id,
        approvalIds: {
          approvedPlan: approvedPlanApproval.id,
          pendingPlan: pendingPlanApproval.id,
          pendingUpdate: pendingUpdateApproval.id,
        },
        jobIds: { deadLetter: deadLetterJob.id },
        updateIds: { published: publishedUpdate.id, pending: pendingUpdate.id },
      };
      await tx
        .update(schema.demoWorkspaces)
        .set({ scenarioRefs })
        .where(eq(schema.demoWorkspaces.orgId, orgId));
      const [row] = await tx
        .select()
        .from(schema.demoWorkspaces)
        .where(eq(schema.demoWorkspaces.orgId, orgId));
      return row;
    });
    return issueDemoSession(workspace);
  } catch (error) {
    await deletePrefix(`orgs/${orgId}/`).catch(() => undefined);
    await dbAdmin
      .delete(schema.organizations)
      .where(eq(schema.organizations.id, orgId))
      .catch(() => undefined);
    throw error;
  }
}

async function issueDemoSession(workspace: typeof schema.demoWorkspaces.$inferSelect) {
  return issueDemoSessionForRole(workspace, "implementation_manager");
}

export async function issueDemoSessionForRole(
  workspace: typeof schema.demoWorkspaces.$inferSelect,
  role: Role,
) {
  const org = await dbAdmin.query.organizations.findFirst({ where: eq(schema.organizations.id, workspace.orgId) });
  const refs = demoRefs(workspace.scenarioRefs);
  const userId = refs?.personaUserIds[role] ?? (role === "implementation_manager" ? workspace.userId : null);
  const user = userId
    ? await dbAdmin.query.users.findFirst({ where: eq(schema.users.id, userId) })
    : null;
  if (!org || !user) throw new ApiError(503, "Demo workspace is unavailable", "DEMO_UNAVAILABLE");
  const membership = user
    ? await dbAdmin.query.memberships.findFirst({
        where: and(eq(schema.memberships.userId, user.id), eq(schema.memberships.orgId, org.id)),
      })
    : null;
  if (!org || !user || !membership) throw new ApiError(503, "Demo workspace is unavailable", "DEMO_UNAVAILABLE");
  const ttlSeconds = remainingDemoTtlSeconds(workspace.expiresAt);
  const payload: SessionPayload = {
    userId: user.id,
    email: user.email,
    name: user.name,
    orgId: org.id,
    orgName: org.name,
    role,
    membershipId: membership.id,
    sessionVersion: membership.sessionVersion,
    demoWorkspaceId: workspace.id,
    demoExpiresAt: workspace.expiresAt.toISOString(),
  };
  return { workspace, token: await createSessionToken(payload, ttlSeconds), user, ttlSeconds };
}

export async function switchDemoPersona(input: {
  workspaceId: string;
  orgId: string;
  currentUserId: string;
  role: Role;
  returnTo?: string | null;
}) {
  if (!ROLES.includes(input.role)) {
    throw new ApiError(400, "Unknown demo persona", "DEMO_ROLE_INVALID");
  }
  const workspace = await dbAdmin.query.demoWorkspaces.findFirst({
    where: and(eq(schema.demoWorkspaces.id, input.workspaceId), eq(schema.demoWorkspaces.orgId, input.orgId)),
  });
  if (!workspace) throw new ApiError(404, "Demo workspace not found", "DEMO_NOT_FOUND");
  if (workspace.expiresAt <= new Date()) throw new ApiError(410, "Demo workspace has expired", "DEMO_EXPIRED");
  const refs = demoRefs(workspace.scenarioRefs);
  if (!refs) throw new ApiError(409, "This demo predates persona switching; reset the demo to upgrade it", "DEMO_PERSONAS_UNAVAILABLE");
  const currentIsPersona = Object.values(refs.personaUserIds).includes(input.currentUserId);
  if (!currentIsPersona) throw new ApiError(403, "Only an active demo persona can switch roles", "DEMO_PERSONA_REQUIRED");
  const targetUserId = refs.personaUserIds[input.role];
  const target = await dbAdmin
    .select({ id: schema.users.id, email: schema.users.email, name: schema.users.name, role: schema.memberships.role })
    .from(schema.users)
    .innerJoin(schema.memberships, and(eq(schema.memberships.userId, schema.users.id), eq(schema.memberships.orgId, input.orgId)))
    .where(eq(schema.users.id, targetUserId))
    .limit(1);
  const targetUser = target[0];
  if (!targetUser || targetUser.role !== input.role) throw new ApiError(409, "Requested demo persona is unavailable", "DEMO_PERSONA_UNAVAILABLE");
  const result = await issueDemoSessionForRole(workspace, input.role);
  return {
    ...result,
    role: input.role,
    redirectTo: safeDemoReturnPath(input.role, input.returnTo),
    previousUserId: input.currentUserId,
  };
}

/**
 * Replace an active demo with a fresh scenario. Provisioning happens first so
 * a failed seed never destroys the visitor's current workspace.
 */
export async function replaceDemoWorkspace(input: {
  workspaceId: string;
  orgId: string;
  userId: string;
  ip: string;
}): Promise<{
  workspace: typeof schema.demoWorkspaces.$inferSelect;
  token: string;
}> {
  const now = new Date();
  const current = await dbAdmin.query.demoWorkspaces.findFirst({
    where: and(
      eq(schema.demoWorkspaces.id, input.workspaceId),
      eq(schema.demoWorkspaces.orgId, input.orgId),
    ),
  });
  if (!current) throw new ApiError(404, "Demo workspace not found", "DEMO_NOT_FOUND");
  if (current.expiresAt <= now) {
    throw new ApiError(410, "Demo workspace has expired", "DEMO_EXPIRED");
  }
  const refs = demoRefs(current.scenarioRefs);
  if (refs && !Object.values(refs.personaUserIds).includes(input.userId)) {
    throw new ApiError(403, "Only an active demo persona can reset the workspace", "DEMO_PERSONA_REQUIRED");
  }
  if (!refs && current.userId !== input.userId) {
    throw new ApiError(403, "Only the demo owner can reset this legacy workspace", "DEMO_PERSONA_REQUIRED");
  }

  const active = await dbAdmin.$count(
    schema.demoWorkspaces,
    and(
      gt(schema.demoWorkspaces.expiresAt, now),
      ne(schema.demoWorkspaces.id, current.id),
    ),
  );
  if (active >= DEMO_MAX_ACTIVE) {
    throw new ApiError(429, "Interactive demo capacity is full; try again shortly", "DEMO_LIMIT_REACHED");
  }

  const replacement = await provisionDemoWorkspace(
    hashDemoIp(input.ip),
    new Date(now.getTime() + DEMO_TTL_SECONDS * 1000),
  );

  // This is intentionally after successful provisioning. If this update or
  // cleanup is unavailable, the scheduled expiry worker can finish the old
  // workspace without losing the newly issued session.
  await dbAdmin
    .update(schema.demoWorkspaces)
    .set({ expiresAt: now })
    .where(
      and(
        eq(schema.demoWorkspaces.id, current.id),
        eq(schema.demoWorkspaces.orgId, input.orgId),
      ),
    );
  await deletePrefix(`orgs/${current.orgId}/`).catch(() => undefined);
  await dbAdmin
    .delete(schema.organizations)
    .where(eq(schema.organizations.id, current.orgId))
    .catch(() => undefined);

  return replacement;
}

export async function reserveDemoGeneration(input: { orgId: string; userId: string }): Promise<number> {
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  await dbAdmin.transaction(async (tx) => {
    // One transaction-wide advisory lock serializes the global demo circuit
    // breaker across different workspaces, not just concurrent calls from the
    // same visitor.
    await tx.execute(sql`select pg_advisory_xact_lock(1473298612)`);
    await tx.execute(
      sql`select id from ${schema.demoWorkspaces} where ${schema.demoWorkspaces.orgId} = ${input.orgId} for update`,
    );
    const membership = await tx.query.memberships.findFirst({
      where: and(eq(schema.memberships.orgId, input.orgId), eq(schema.memberships.userId, input.userId)),
      columns: { userId: true },
    });
    const workspace = membership
      ? await tx.query.demoWorkspaces.findFirst({
          where: and(eq(schema.demoWorkspaces.orgId, input.orgId), gt(schema.demoWorkspaces.expiresAt, new Date())),
        })
      : null;
    if (!workspace) {
      throw new ApiError(429, "Demo generation quota reached", "DEMO_LIMIT_REACHED");
    }
    const [spend] = await tx
      .select({
        day: sql<number>`coalesce(sum(case when ${schema.aiRuns.createdAt} >= ${dayStart} then coalesce(${schema.aiRuns.costUsd}, 0) else 0 end), 0)`,
        month: sql<number>`coalesce(sum(case when ${schema.aiRuns.createdAt} >= ${monthStart} then coalesce(${schema.aiRuns.costUsd}, 0) else 0 end), 0)`,
      })
      .from(schema.aiRuns)
      .innerJoin(
        schema.demoWorkspaces,
        eq(schema.demoWorkspaces.orgId, schema.aiRuns.orgId),
      );
    const [reservationLedger] = await tx
      .select({
        reserved: sql<number>`coalesce(sum(${schema.demoWorkspaces.reservedSpendUsd}), 0)`,
      })
      .from(schema.demoWorkspaces);
    const reserved = Number(reservationLedger?.reserved ?? 0);
    if (
      Number(spend?.day ?? 0) + reserved + DEMO_ESTIMATED_RESERVATION_USD > DEMO_MAX_DAILY_SPEND_USD ||
      Number(spend?.month ?? 0) + reserved + DEMO_ESTIMATED_RESERVATION_USD > DEMO_MAX_MONTHLY_SPEND_USD
    ) {
      throw new ApiError(503, "Demo AI budget is exhausted; no model call was started", "DEMO_BUDGET_EXHAUSTED");
    }
    const [row] = await tx
      .update(schema.demoWorkspaces)
      .set({
        generationJobsUsed: sql`${schema.demoWorkspaces.generationJobsUsed} + 1`,
        reservedSpendUsd: sql`${schema.demoWorkspaces.reservedSpendUsd} + ${DEMO_ESTIMATED_RESERVATION_USD}`,
      })
      .where(
        and(
          eq(schema.demoWorkspaces.orgId, input.orgId),
          gt(schema.demoWorkspaces.expiresAt, new Date()),
          lt(schema.demoWorkspaces.generationJobsUsed, schema.demoWorkspaces.maxGenerationJobs),
        ),
      )
      .returning({ id: schema.demoWorkspaces.id });
    if (!row) throw new ApiError(429, "Demo generation quota reached", "DEMO_LIMIT_REACHED");
  });
  return DEMO_ESTIMATED_RESERVATION_USD;
}

/**
 * Release a reserved estimate after a job commits or reaches its final retry.
 * The actual provider-reported amount is already persisted on ai_runs; the
 * next reservation reads that ledger plus any still-in-flight estimates.
 */
export async function reconcileDemoGeneration(input: {
  orgId: string;
  reservedUsd: number;
}): Promise<void> {
  if (!Number.isFinite(input.reservedUsd) || input.reservedUsd <= 0) return;
  await dbAdmin
    .update(schema.demoWorkspaces)
    .set({
      reservedSpendUsd: sql`greatest(0, ${schema.demoWorkspaces.reservedSpendUsd} - ${input.reservedUsd})`,
    })
    .where(eq(schema.demoWorkspaces.orgId, input.orgId));
}

export async function reserveDemoUpload(input: {
  orgId: string;
  userId: string;
  sizeBytes: number;
}): Promise<void> {
  const membership = await db.query.memberships.findFirst({
    where: and(eq(schema.memberships.orgId, input.orgId), eq(schema.memberships.userId, input.userId)),
    columns: { userId: true },
  });
  if (!membership) throw new ApiError(403, "Only an active demo persona can upload documents", "DEMO_PERSONA_REQUIRED");
  const [row] = await db
    .update(schema.demoWorkspaces)
    .set({
      uploadCount: sql`${schema.demoWorkspaces.uploadCount} + 1`,
      uploadBytes: sql`${schema.demoWorkspaces.uploadBytes} + ${input.sizeBytes}`,
    })
    .where(
      and(
        eq(schema.demoWorkspaces.orgId, input.orgId),
        gt(schema.demoWorkspaces.expiresAt, new Date()),
        lt(schema.demoWorkspaces.uploadCount, schema.demoWorkspaces.maxUploads),
        sql`${schema.demoWorkspaces.uploadBytes} + ${input.sizeBytes} <= ${schema.demoWorkspaces.maxStorageBytes}`,
      ),
    )
    .returning({ id: schema.demoWorkspaces.id });
  if (!row) throw new ApiError(429, "Demo document quota reached", "DEMO_LIMIT_REACHED");
}

export async function cleanupExpiredDemoWorkspaces(): Promise<number> {
  const expired = await dbAdmin.query.demoWorkspaces.findMany({
    where: lt(schema.demoWorkspaces.expiresAt, new Date()),
    columns: { orgId: true },
  });
  for (const workspace of expired) {
    // Workspace documents are namespaced by org. Remove object storage before
    // the cascading org delete so expired interview/demo data is recoverable
    // only until this cleanup pass runs, never indefinitely in S3.
    await deletePrefix(`orgs/${workspace.orgId}/`);
    await dbAdmin.delete(schema.organizations).where(eq(schema.organizations.id, workspace.orgId));
  }
  return expired.length;
}

export function demoBudgetAvailable(estimatedCostUsd: number): boolean {
  return estimatedCostUsd <= DEMO_MAX_DAILY_SPEND_USD;
}
