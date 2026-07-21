import "dotenv/config";
import { sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { hashPassword } from "@/lib/auth/password";
import { MockProvider } from "@/lib/ai/mock";
import {
  PLAN_SYSTEM_PROMPT,
  buildPlanUserPrompt,
  type PlanPromptInput,
} from "@/lib/ai/prompts";
import { PlanContentSchema } from "@/lib/ai/planSchema";
import { PROMPT_VERSION } from "@/lib/ai/planSchema";

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
  for (const [i, r] of orderReqs.entries()) {
    await db.insert(schema.requirements).values({
      orgId: northwind.id,
      projectId: orderProject.id,
      title: r.title,
      details: r.details,
      priority: r.priority,
      status: r.status,
      createdBy: engineer,
      createdAt: daysAgo(28, i),
    });
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
    requirements: orderReqs.map((r) => ({
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
        updatedAt: daysAgo(status === "done" ? 10 : 2),
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
    { action: "task.status_changed", subjectType: "task", actorId: engineer, projectId: orderProject.id, days: 4, metadata: { from: "in_progress", to: "blocked" } },
    { action: "customer_update.generated", subjectType: "customer_update", actorId: null, projectId: orderProject.id, days: 7, metadata: { model: "mock" } },
    { action: "approval.approved", subjectType: "customer_update", actorId: manager, projectId: orderProject.id, days: 6 },
    { action: "project.created", subjectType: "project", actorId: manager, projectId: onboardingProject.id, days: 5, metadata: { name: onboardingProject.name } },
    { action: "requirement.created", subjectType: "requirement", actorId: manager, projectId: onboardingProject.id, days: 4, metadata: { title: onboardingReqs[0].title } },
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
