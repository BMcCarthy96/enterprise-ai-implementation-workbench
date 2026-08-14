import "dotenv/config";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { dbAdmin as db, schema } from "@/db";
import { hashPassword } from "@/lib/auth/password";
import { MockProvider } from "@/lib/ai/mock";
import {
  PLAN_SYSTEM_PROMPT,
  buildPlanUserPrompt,
  type PlanPromptInput,
} from "@/lib/ai/prompts";
import { PlanContentSchema } from "@/lib/ai/planSchema";
import { PROMPT_VERSION } from "@/lib/ai/planSchema";
import { mockEmbedding } from "@/lib/ai/embeddings";
import { buildPlanEvaluationRows } from "@/lib/ai/evidence";

/**
 * Seeds two demo tenants so the app opens looking like a working business
 * system, not an empty shell:
 *
 * - Northwind Implementations: full history — an in-delivery project with an
 *   approved AI plan, task board in motion, published customer update, audit
 *   trail, job history (including one dead-letter for the Ops demo), plus a
 *   fresh discovery project ready for a live plan-generation demo.
 * - Cascade Delivery Group: a second org proving tenant isolation.
 *
 * All demo accounts use the password: demo1234
 */

const PASSWORD = "demo1234";
const daysAgo = (n: number, hourOffset = 0) =>
  new Date(Date.now() - n * 86400000 + hourOffset * 3600000);
const hoursAgo = (n: number) => new Date(Date.now() - n * 3600000);

async function main() {
  console.log("Clearing existing data...");
  // Truncate everything in dependency-safe order.
  await db.execute(sql`
    TRUNCATE TABLE audit_events, jobs, documents, customer_updates, approvals,
      tasks, milestones, plans, requirements, projects, customers, memberships,
      users, organizations CASCADE
  `);

  const passwordHash = await hashPassword(PASSWORD);

  console.log("Creating organizations & users...");
  const [northwind] = await db
    .insert(schema.organizations)
    .values({ name: "Northwind Implementations", slug: "northwind" })
    .returning();
  const [cascade] = await db
    .insert(schema.organizations)
    .values({ name: "Cascade Delivery Group", slug: "cascade" })
    .returning();

  const usersData = [
    { email: "admin@northwind.dev", name: "Avery Collins", org: northwind.id, role: "org_admin" as const },
    { email: "manager@northwind.dev", name: "Riley Chen", org: northwind.id, role: "implementation_manager" as const },
    { email: "engineer@northwind.dev", name: "Jordan Patel", org: northwind.id, role: "solutions_engineer" as const },
    { email: "customer@brightlane.dev", name: "Sam Osei", org: northwind.id, role: "customer_stakeholder" as const },
    { email: "admin@cascade.dev", name: "Morgan Reyes", org: cascade.id, role: "org_admin" as const },
  ];

  const userIds: Record<string, string> = {};
  for (const u of usersData) {
    const [row] = await db
      .insert(schema.users)
      .values({ email: u.email, name: u.name, passwordHash })
      .returning();
    userIds[u.email] = row.id;
    await db.insert(schema.memberships).values({
      userId: row.id,
      orgId: u.org,
      role: u.role,
    });
  }
  for (const organization of [northwind, cascade]) {
    await db.insert(schema.retentionPolicies).values({ orgId: organization.id });
    await db.insert(schema.directoryGroups).values([
      { orgId: organization.id, externalId: organization.slug + "-admins", displayName: "Workbench Admins", mappedRole: "org_admin" },
      { orgId: organization.id, externalId: organization.slug + "-managers", displayName: "Implementation Managers", mappedRole: "implementation_manager" },
      { orgId: organization.id, externalId: organization.slug + "-engineers", displayName: "Solutions Engineers", mappedRole: "solutions_engineer" },
      { orgId: organization.id, externalId: organization.slug + "-customers", displayName: "Customer Stakeholders", mappedRole: "customer_stakeholder" },
    ]);
  }
  const admin = userIds["admin@northwind.dev"];
  const manager = userIds["manager@northwind.dev"];
  const engineer = userIds["engineer@northwind.dev"];

  console.log("Creating customers & projects...");
  const [brightlane] = await db
    .insert(schema.customers)
    .values({
      orgId: northwind.id,
      name: "Brightlane Logistics",
      industry: "Logistics & Freight",
      primaryContactName: "Sam Osei",
      primaryContactEmail: "customer@brightlane.dev",
    })
    .returning();
  const [harbor] = await db
    .insert(schema.customers)
    .values({
      orgId: northwind.id,
      name: "Harbor Health Clinic",
      industry: "Healthcare",
      primaryContactName: "Dana Whitfield",
      primaryContactEmail: "dana@harborhealth.example",
    })
    .returning();

  const [orderProject] = await db
    .insert(schema.projects)
    .values({
      orgId: northwind.id,
      customerId: brightlane.id,
      name: "Order Intake Automation",
      description:
        "Replace Brightlane's manual email-based order intake with an automated workflow: structured intake forms, carrier assignment rules, and exception queues for the ops team.",
      status: "in_delivery",
      targetDate: daysAgo(-45),
      createdBy: admin,
      createdAt: daysAgo(30),
    })
    .returning();

  const [onboardingProject] = await db
    .insert(schema.projects)
    .values({
      orgId: northwind.id,
      customerId: harbor.id,
      name: "Patient Onboarding Portal",
      description:
        "Digitize Harbor Health's new-patient onboarding: intake packets, insurance verification checklist, and appointment-prep reminders integrated with their scheduling system.",
      status: "discovery",
      targetDate: daysAgo(-90),
      // Healthcare engagement with a tighter review turnaround than the org
      // default (24h warn / 72h breach). Demonstrates a per-project override
      // changing the outcome: its pending update is only hours old, so it is
      // flagged here while the same age would be on track elsewhere.
      slaPolicy: { approvalWarnHours: 4, approvalBreachHours: 12 },
      createdBy: manager,
      createdAt: daysAgo(5),
    })
    .returning();

  console.log("Creating requirements...");
  const orderReqs = [
    { title: "Structured order intake form replacing email submissions", details: "Ops currently re-keys orders from free-form emails. Need a validated intake form covering origin, destination, weight class, and service level, with required-field enforcement.", priority: "critical" as const, status: "in_plan" as const },
    { title: "Automated carrier assignment rules", details: "Assign carriers by lane, weight class, and contract rate priority. Manual override must be possible with a logged reason.", priority: "high" as const, status: "in_plan" as const },
    { title: "Exception queue for failed validations", details: "Orders failing validation should land in a reviewable queue with reason codes rather than bouncing back to the customer.", priority: "high" as const, status: "in_plan" as const },
    { title: "Daily ops summary email", details: "End-of-day summary of intake volume, exceptions, and unassigned orders for the operations lead.", priority: "medium" as const, status: "in_plan" as const },
  ];
  const orderRequirementIds: string[] = [];
  for (const [i, r] of orderReqs.entries()) {
    const [requirement] = await db.insert(schema.requirements).values({
      orgId: northwind.id,
      projectId: orderProject.id,
      title: r.title,
      details: r.details,
      priority: r.priority,
      status: r.status,
      createdBy: engineer,
      createdAt: daysAgo(28, i),
    }).returning({ id: schema.requirements.id });
    orderRequirementIds.push(requirement.id);
  }

  const onboardingReqs = [
    { title: "Digital intake packet with e-signature", details: "New patients complete demographics, history, and consent forms online before their first visit. Needs e-signature capture and PDF archival.", priority: "critical" as const },
    { title: "Insurance verification checklist", details: "Front-desk staff need a per-patient checklist that tracks verification steps and flags expired or mismatched coverage before the appointment.", priority: "high" as const },
    { title: "Appointment-prep reminder sequence", details: "Automated reminders (48h and 24h before first appointment) including required documents and arrival instructions.", priority: "medium" as const },
    { title: "Staff dashboard for onboarding status", details: "A single view showing where each incoming patient is in the onboarding flow, with stuck-state highlighting.", priority: "high" as const },
  ];
  for (const [i, r] of onboardingReqs.entries()) {
    await db.insert(schema.requirements).values({
      orgId: northwind.id,
      projectId: onboardingProject.id,
      title: r.title,
      details: r.details,
      priority: r.priority,
      status: "new",
      createdBy: manager,
      createdAt: daysAgo(4, i),
    });
  }

  console.log("Generating approved plan for the in-delivery project...");
  // Run the real generation path (mock provider) so seeded data matches what
  // the live workflow produces.
  const planInput: PlanPromptInput = {
    projectName: orderProject.name,
    projectDescription: orderProject.description,
    customerName: brightlane.name,
    customerIndustry: brightlane.industry,
    targetDate: orderProject.targetDate?.toISOString().slice(0, 10) ?? null,
    requirements: orderReqs.map((r, i) => ({
      id: orderRequirementIds[i],
      title: r.title,
      details: r.details,
      priority: r.priority,
    })),
  };
  const mock = new MockProvider();
  const planRes = await mock.complete({
    system: PLAN_SYSTEM_PROMPT,
    user: buildPlanUserPrompt(planInput),
  });
  const planContent = PlanContentSchema.parse(JSON.parse(planRes.text));
  planContent.summarySourceRefs = ["S1"];
  planContent.milestones = planContent.milestones.map((milestone) => ({
    ...milestone,
    sourceRefs: ["S1"],
    tasks: milestone.tasks.map((task) => ({ ...task, sourceRefs: ["S1"] })),
  }));
  planContent.risks = planContent.risks.map((risk) => ({ ...risk, sourceRefs: ["S1"] }));

  const [genJob] = await db
    .insert(schema.jobs)
    .values({
      orgId: northwind.id,
      projectId: orderProject.id,
      type: "plan_generation",
      status: "succeeded",
      attempts: 1,
      requestedBy: engineer,
      startedAt: daysAgo(27),
      finishedAt: daysAgo(27, 0.01),
      durationMs: 2350,
      createdAt: daysAgo(27),
    })
    .returning();

  const traceStarted = daysAgo(27);
  const traceFinished = daysAgo(27, 0.01);
  const [seedRun] = await db.insert(schema.aiRuns).values({
    orgId: northwind.id,
    projectId: orderProject.id,
    jobId: genJob.id,
    artifactType: "plan",
    provider: "mock",
    model: "mock",
    promptVersion: PROMPT_VERSION,
    dataOrigin: "fixture",
    status: "succeeded",
    finalOutcome: "repaired",
    inputTokens: 1200,
    outputTokens: 900,
    // Synthetic fixture: do not present an invented provider cost as a live
    // spend measurement.
    costUsd: null,
    pricingVersion: null,
    latencyMs: 2350,
    startedAt: traceStarted,
    finishedAt: traceFinished,
    createdAt: traceStarted,
  }).returning({ id: schema.aiRuns.id });
  await db.insert(schema.aiCalls).values([
    {
      aiRunId: seedRun.id,
      orgId: northwind.id,
      sequence: 1,
      operation: "generate",
      provider: "mock",
      model: "mock",
      promptVersion: PROMPT_VERSION,
      inputTokens: 900,
      outputTokens: 700,
      usageSource: "estimated",
      costUsd: null,
      pricingVersion: null,
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
      createdAt: traceStarted,
    },
    {
      aiRunId: seedRun.id,
      orgId: northwind.id,
      sequence: 2,
      operation: "repair",
      provider: "mock",
      model: "mock",
      promptVersion: PROMPT_VERSION,
      inputTokens: 300,
      outputTokens: 200,
      usageSource: "estimated",
      costUsd: null,
      pricingVersion: null,
      latencyMs: 550,
      outcome: "valid",
      validationEvidence: {
        evaluatorVersion: "evidence-v1",
        schemaValid: true,
        guardrailPassed: true,
        failureCodes: [],
      },
      createdAt: traceFinished,
    },
  ]);

  // v1 was generated, reviewed, and REJECTED — this populates the rejection
  // reason codes in Insights and demonstrates the closed feedback loop. Its
  // content differs from v2 (no dedicated launch milestone) so the version
  // diff on the plan page is meaningful.
  const rejectedContent = {
    ...planContent,
    summary:
      "Initial implementation of Order Intake Automation for Brightlane Logistics covering 4 stated requirements, sequenced with the exception queue ahead of carrier assignment rules.",
    milestones: planContent.milestones.slice(0, -1),
  };
  const [rejectedPlan] = await db
    .insert(schema.plans)
    .values({
      orgId: northwind.id,
      projectId: orderProject.id,
      version: 1,
      status: "rejected",
      summary: rejectedContent.summary,
      content: rejectedContent,
      model: "mock",
      promptVersion: PROMPT_VERSION,
      generatedByJobId: genJob.id,
      createdAt: daysAgo(28),
    })
    .returning();

  await db.insert(schema.approvals).values({
    orgId: northwind.id,
    projectId: orderProject.id,
    subjectType: "plan",
    subjectId: rejectedPlan.id,
    status: "rejected",
    requestedBy: engineer,
    decidedBy: manager,
    decidedAt: daysAgo(27, 6),
    reasonCode: "wrong_sequencing",
    note: "Carrier assignment rules must land before the exception queue — reverse the build order.",
    createdAt: daysAgo(28),
  });

  // v2 is the revision that incorporated that feedback, then was approved.
  const [plan] = await db
    .insert(schema.plans)
    .values({
      orgId: northwind.id,
      projectId: orderProject.id,
      version: 2,
      status: "approved",
      summary: planContent.summary,
      content: planContent,
      model: "mock",
      promptVersion: PROMPT_VERSION,
      generatedByJobId: genJob.id,
      incorporatedFeedback:
        "wrong sequencing — Carrier assignment rules must land before the exception queue — reverse the build order.",
      createdAt: daysAgo(27),
    })
    .returning();

  await db.insert(schema.approvals).values({
    orgId: northwind.id,
    projectId: orderProject.id,
    subjectType: "plan",
    subjectId: plan.id,
    status: "approved",
    requestedBy: engineer,
    decidedBy: manager,
    decidedAt: daysAgo(26),
    note: "Revised plan fixes the sequencing — carrier rules now precede the exception queue. Approved.",
    createdAt: daysAgo(27),
  });

  const sourceText = "Brightlane's order intake brief requires validated submissions, carrier assignment rules, and a reviewable exception queue.";
  const sourceHash = createHash("sha256").update(sourceText).digest("hex");
  const [sourceDocument] = await db.insert(schema.documents).values({
    orgId: northwind.id,
    projectId: orderProject.id,
    fileName: "brightlane-order-intake-brief.md",
    contentType: "text/markdown",
    sizeBytes: Buffer.byteLength(sourceText),
    s3Key: `orgs/${northwind.id}/projects/${orderProject.id}/seed-order-brief.md`,
    status: "ready",
    sha256: sourceHash,
    processedAt: daysAgo(27),
    uploadedBy: engineer,
    createdAt: daysAgo(28),
  }).returning({ id: schema.documents.id });
  const [sourceChunk] = await db.insert(schema.documentChunks).values({
    orgId: northwind.id,
    projectId: orderProject.id,
    documentId: sourceDocument.id,
    chunkIndex: 0,
    content: sourceText,
    contentHash: sourceHash,
    heading: "Implementation brief",
    tokenCount: sourceText.split(/\s+/).length,
    embedding: mockEmbedding(sourceText),
  }).returning({ id: schema.documentChunks.id });
  await db.insert(schema.planCitations).values({
    orgId: northwind.id,
    projectId: orderProject.id,
    planId: plan.id,
    sourceRef: "S1",
    chunkId: sourceChunk.id,
    location: "brightlane-order-intake-brief.md · Implementation brief",
  });
  const seedEvaluations = buildPlanEvaluationRows(
    {
      ...planInput,
      sources: [{ ref: "S1", documentName: "brightlane-order-intake-brief.md", pageNumber: null, heading: "Implementation brief", content: sourceText }],
    },
    planContent,
  );
  await db.insert(schema.aiRunEvaluations).values(seedEvaluations.map((evaluation) => ({
    orgId: northwind.id,
    aiRunId: seedRun.id,
    checkName: evaluation.checkName,
    category: evaluation.category,
    gateLevel: evaluation.gateLevel,
    score: evaluation.score.toFixed(6),
    threshold: evaluation.threshold.toFixed(6),
    passed: evaluation.passed,
    detail: evaluation.detail,
    evaluatorVersion: evaluation.evaluatorVersion,
  })));

  console.log("Materializing milestones & tasks with in-flight statuses...");
  const taskStatusPlan: Array<Array<(typeof schema.taskStatus.enumValues)[number]>> = [
    ["done", "done"],
    ["done", "done"],
    ["done", "in_progress", "in_progress", "blocked", "todo", "todo", "todo", "todo"],
    ["todo", "todo"],
    ["todo", "todo"],
  ];
  const milestoneStatuses: Array<(typeof schema.milestoneStatus.enumValues)[number]> = [
    "complete",
    "complete",
    "in_progress",
    "not_started",
    "not_started",
  ];
  for (const [i, m] of planContent.milestones.entries()) {
    const [milestone] = await db
      .insert(schema.milestones)
      .values({
        orgId: northwind.id,
        projectId: orderProject.id,
        planId: plan.id,
        name: m.name,
        description: m.description,
        sortOrder: i,
        status: milestoneStatuses[i] ?? "not_started",
        createdAt: daysAgo(26),
      })
      .returning();
    for (const [j, t] of m.tasks.entries()) {
      const status = taskStatusPlan[i]?.[j] ?? "todo";
      await db.insert(schema.tasks).values({
        orgId: northwind.id,
        projectId: orderProject.id,
        milestoneId: milestone.id,
        title: t.title,
        description: t.description || null,
        status,
        assigneeId:
          status === "todo"
            ? null
            : t.suggestedRole === "implementation_manager"
              ? manager
              : engineer,
        sortOrder: j,
        createdAt: daysAgo(26),
        // The blocked task has been stuck long enough to breach the SLA policy
        // (blockedTaskBreachDays), so the dashboard delivery-risk panel lights up.
        updatedAt: daysAgo(status === "done" ? 10 : status === "blocked" ? 8 : 2),
      });
    }
  }

  console.log("Creating published customer update...");
  const [digestJob] = await db
    .insert(schema.jobs)
    .values({
      orgId: northwind.id,
      projectId: orderProject.id,
      type: "customer_update_digest",
      status: "succeeded",
      attempts: 1,
      requestedBy: manager,
      startedAt: daysAgo(7),
      finishedAt: daysAgo(7, 0.01),
      durationMs: 1830,
      createdAt: daysAgo(7),
    })
    .returning();

  const [update] = await db
    .insert(schema.customerUpdates)
    .values({
      orgId: northwind.id,
      projectId: orderProject.id,
      title: "Order Intake Automation — Progress Update",
      body: [
        "Here is your 14-day progress update for Order Intake Automation.",
        "Discovery and foundation work are complete: environments are provisioned, base configuration is applied, and your team's priorities from kickoff are locked into the delivery plan. The build phase is now well underway — the structured intake form is live in the sandbox environment and carrier assignment rules are in active development.",
        "One item is currently blocked: finalizing the exception-queue reason codes requires sign-off from your operations lead on the proposed code list we shared last week. A quick review this week keeps the schedule intact.",
        "Overall we remain on track for the target go-live. The next update will follow in two weeks; as always, reach out to Riley Chen with any questions in the meantime.",
      ].join("\n\n"),
      status: "published",
      generatedByJobId: digestJob.id,
      publishedAt: daysAgo(6),
      createdBy: manager,
      createdAt: daysAgo(7),
    })
    .returning();

  await db.insert(schema.approvals).values({
    orgId: northwind.id,
    projectId: orderProject.id,
    subjectType: "customer_update",
    subjectId: update.id,
    status: "approved",
    requestedBy: manager,
    decidedBy: manager,
    decidedAt: daysAgo(6),
    note: "Accurate and appropriately framed for the blocked item.",
    createdAt: daysAgo(7),
  });

  console.log("Creating a dead-letter job for the Ops demo...");
  await db.insert(schema.jobs).values({
    orgId: northwind.id,
    projectId: onboardingProject.id,
    type: "customer_update_digest",
    status: "dead_letter",
    attempts: 3,
    lastError:
      "ThrottlingException: Too many requests to model anthropic.claude-sonnet-4-5, please wait before trying again.",
    requestedBy: manager,
    startedAt: daysAgo(2),
    finishedAt: daysAgo(2, 0.05),
    durationMs: 4120,
    createdAt: daysAgo(2),
  });

  console.log("Creating a planning project with a plan awaiting review...");
  // A second Harbor engagement sitting in the approval queue — gives the demo a
  // real pending decision and exercises the reject → auto-regenerate loop.
  const [claimsProject] = await db
    .insert(schema.projects)
    .values({
      orgId: northwind.id,
      customerId: harbor.id,
      name: "Claims Status Tracker",
      description:
        "Give Harbor Health's billing team a real-time view of insurance claim status with automated payer status checks and denial-reason routing.",
      status: "planning",
      // Target only ~10 days out while the plan is still awaiting approval —
      // trips both the approaching-target-date and stale-approval SLAs.
      targetDate: daysAgo(-10),
      createdBy: manager,
      createdAt: daysAgo(3),
    })
    .returning();

  const claimsReqs = [
    { title: "Automated payer claim status polling", details: "Poll the clearinghouse for claim status changes and surface updates without staff logging into each payer portal.", priority: "high" as const },
    { title: "Denial-reason routing to billing specialists", details: "Route denied claims to the correct specialist queue based on the denial reason code.", priority: "high" as const },
    { title: "Aging report for outstanding claims", details: "Weekly report of claims outstanding past 30/60/90 days for the billing lead.", priority: "medium" as const },
  ];
  for (const [i, r] of claimsReqs.entries()) {
    await db.insert(schema.requirements).values({
      orgId: northwind.id,
      projectId: claimsProject.id,
      title: r.title,
      details: r.details,
      priority: r.priority,
      status: "new",
      createdBy: manager,
      createdAt: daysAgo(3, i),
    });
  }

  const claimsPlanRes = await mock.complete({
    system: PLAN_SYSTEM_PROMPT,
    user: buildPlanUserPrompt({
      projectName: claimsProject.name,
      projectDescription: claimsProject.description,
      customerName: harbor.name,
      customerIndustry: harbor.industry,
      targetDate: claimsProject.targetDate?.toISOString().slice(0, 10) ?? null,
      requirements: claimsReqs.map((r) => ({
        title: r.title,
        details: r.details,
        priority: r.priority,
      })),
    }),
  });
  const claimsPlanContent = PlanContentSchema.parse(JSON.parse(claimsPlanRes.text));

  const [claimsJob] = await db
    .insert(schema.jobs)
    .values({
      orgId: northwind.id,
      projectId: claimsProject.id,
      type: "plan_generation",
      status: "succeeded",
      attempts: 1,
      requestedBy: manager,
      startedAt: daysAgo(2),
      finishedAt: daysAgo(2, 0.01),
      durationMs: 2100,
      createdAt: daysAgo(2),
    })
    .returning();

  const [claimsPlan] = await db
    .insert(schema.plans)
    .values({
      orgId: northwind.id,
      projectId: claimsProject.id,
      version: 1,
      status: "pending_approval",
      summary: claimsPlanContent.summary,
      content: claimsPlanContent,
      model: "mock",
      promptVersion: PROMPT_VERSION,
      generatedByJobId: claimsJob.id,
      createdAt: daysAgo(2),
    })
    .returning();

  await db.insert(schema.approvals).values({
    orgId: northwind.id,
    projectId: claimsProject.id,
    subjectType: "plan",
    subjectId: claimsPlan.id,
    status: "pending",
    requestedBy: manager,
    createdAt: daysAgo(2),
  });

  console.log("Creating additional pending updates for the bulk-review demo...");
  // Two customer updates awaiting review so the approval queue has enough
  // volume to demonstrate bulk decisions. Created recently on purpose: older
  // than 24h would trip the stale-approval SLA and muddy the risk panel.
  const pendingUpdates = [
    {
      projectId: orderProject.id,
      title: "Order Intake Automation — Milestone Update",
      body: [
        "The build phase for Order Intake Automation is progressing on schedule.",
        "Carrier assignment rules are now feature-complete in the sandbox environment and the structured intake form has passed its first round of validation testing with your ops team's sample orders.",
        "The exception-queue reason codes remain the one open dependency; once your operations lead signs off on the proposed list we can close out the remaining build tasks.",
      ].join("\n\n"),
    },
    {
      projectId: onboardingProject.id,
      title: "Patient Onboarding Portal — Discovery Summary",
      body: [
        "Discovery for the Patient Onboarding Portal is nearly complete.",
        "We have captured four priority requirements covering the digital intake packet, insurance verification checklist, appointment-prep reminders, and the staff status dashboard. Each has been reviewed with your front-desk team for workflow accuracy.",
        "Next step is a scoped implementation plan for your review, which we expect to circulate this week.",
      ].join("\n\n"),
    },
  ];

  for (const [i, u] of pendingUpdates.entries()) {
    const [row] = await db
      .insert(schema.customerUpdates)
      .values({
        orgId: northwind.id,
        projectId: u.projectId,
        title: u.title,
        body: u.body,
        status: "pending_approval",
        createdBy: manager,
        createdAt: hoursAgo(4 + i),
      })
      .returning();
    await db.insert(schema.approvals).values({
      orgId: northwind.id,
      projectId: u.projectId,
      subjectType: "customer_update",
      subjectId: row.id,
      status: "pending",
      requestedBy: manager,
      createdAt: hoursAgo(4 + i),
    });
  }

  console.log("Writing audit history...");
  const auditRows: Array<{
    action: string;
    subjectType: string;
    actorId: string | null;
    projectId: string | null;
    days: number;
    metadata?: Record<string, unknown>;
  }> = [
    { action: "project.created", subjectType: "project", actorId: admin, projectId: orderProject.id, days: 30, metadata: { name: orderProject.name } },
    { action: "requirement.created", subjectType: "requirement", actorId: engineer, projectId: orderProject.id, days: 28, metadata: { title: orderReqs[0].title } },
    { action: "requirement.created", subjectType: "requirement", actorId: engineer, projectId: orderProject.id, days: 28, metadata: { title: orderReqs[1].title } },
    { action: "plan.generated", subjectType: "plan", actorId: null, projectId: orderProject.id, days: 28, metadata: { version: 1, model: "mock", promptVersion: PROMPT_VERSION } },
    { action: "approval.rejected", subjectType: "plan", actorId: manager, projectId: orderProject.id, days: 27, metadata: { reasonCode: "wrong_sequencing", note: "reverse the build order" } },
    { action: "job.enqueued", subjectType: "job", actorId: engineer, projectId: orderProject.id, days: 27, metadata: { type: "plan_generation" } },
    { action: "plan.generated", subjectType: "plan", actorId: null, projectId: orderProject.id, days: 27, metadata: { version: 2, model: "mock", promptVersion: PROMPT_VERSION, incorporatedFeedback: "wrong sequencing" } },
    { action: "approval.approved", subjectType: "plan", actorId: manager, projectId: orderProject.id, days: 26, metadata: { note: "Revised plan fixes the sequencing" } },
    { action: "task.status_changed", subjectType: "task", actorId: engineer, projectId: orderProject.id, days: 12, metadata: { from: "in_progress", to: "done" } },
    { action: "task.status_changed", subjectType: "task", actorId: engineer, projectId: orderProject.id, days: 8, metadata: { from: "in_progress", to: "blocked" } },
    { action: "customer_update.generated", subjectType: "customer_update", actorId: null, projectId: orderProject.id, days: 7, metadata: { model: "mock" } },
    { action: "approval.approved", subjectType: "customer_update", actorId: manager, projectId: orderProject.id, days: 6 },
    { action: "project.created", subjectType: "project", actorId: manager, projectId: onboardingProject.id, days: 5, metadata: { name: onboardingProject.name } },
    { action: "requirement.created", subjectType: "requirement", actorId: manager, projectId: onboardingProject.id, days: 4, metadata: { title: onboardingReqs[0].title } },
    { action: "project.created", subjectType: "project", actorId: manager, projectId: claimsProject.id, days: 3, metadata: { name: claimsProject.name } },
    { action: "plan.generated", subjectType: "plan", actorId: null, projectId: claimsProject.id, days: 2, metadata: { version: 1, model: "mock", promptVersion: PROMPT_VERSION } },
    { action: "job.dead_letter", subjectType: "job", actorId: null, projectId: onboardingProject.id, days: 2, metadata: { type: "customer_update_digest", attempts: 3 } },
  ];
  for (const a of auditRows) {
    await db.insert(schema.auditEvents).values({
      orgId: northwind.id,
      actorId: a.actorId,
      action: a.action,
      subjectType: a.subjectType,
      projectId: a.projectId,
      metadata: a.metadata ?? null,
      createdAt: daysAgo(a.days),
    });
  }

  console.log("Seeding second tenant (Cascade)...");
  const [cascadeCustomer] = await db
    .insert(schema.customers)
    .values({
      orgId: cascade.id,
      name: "Summit Outdoor Supply",
      industry: "Retail",
      primaryContactName: "Lee Tran",
      primaryContactEmail: "lee@summitoutdoor.example",
    })
    .returning();
  await db.insert(schema.projects).values({
    orgId: cascade.id,
    customerId: cascadeCustomer.id,
    name: "Returns Processing Workflow",
    description:
      "Streamline Summit's returns intake and restocking decisions with a rules-based workflow.",
    status: "planning",
    createdBy: userIds["admin@cascade.dev"],
    createdAt: daysAgo(10),
  });

  console.log("\nSeed complete. Demo accounts (password: demo1234):");
  for (const u of usersData) console.log(`  ${u.email}  (${u.role})`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
