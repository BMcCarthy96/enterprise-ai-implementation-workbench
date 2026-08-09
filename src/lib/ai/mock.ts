import type {
  AiProvider,
  CompletionRequest,
  CompletionResult,
} from "./provider";
import {
  extractInputJson,
  type DigestPromptInput,
  type PlanPromptInput,
} from "./prompts";
import type { PlanContent } from "./planSchema";
import { redactSensitiveText } from "./redaction";

/**
 * Deterministic offline provider. Produces realistic, schema-valid output
 * derived from the actual prompt input, so the full workflow (generation →
 * validation → approval → task materialization) works with zero cloud
 * dependencies. Swap to Bedrock with AI_PROVIDER=bedrock.
 */
export class MockProvider implements AiProvider {
  readonly name = "mock";

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    // Simulate a little latency so job states are observable in the UI.
    await new Promise((r) => setTimeout(r, 800));

    if (req.system.includes("implementation planning assistant")) {
      const input = extractInputJson<PlanPromptInput>(req.user);
      const text = JSON.stringify(this.buildPlan(input));
      return {
        text,
        model: "mock",
        usage: estimateUsage(req.system, req.user, text),
      };
    }
    if (req.system.includes("status updates")) {
      const input = extractInputJson<DigestPromptInput>(req.user);
      const text = JSON.stringify(this.buildDigest(input));
      return {
        text,
        model: "mock",
        usage: estimateUsage(req.system, req.user, text),
      };
    }
    throw new Error("MockProvider: unrecognized prompt");
  }

  private buildPlan(input: PlanPromptInput): PlanContent {
    const reqs = input.requirements;
    const sourceRefs = (input.sources ?? []).slice(0, 2).map((source) => source.ref);
    const safe = (value: string) =>
      redactSensitiveText(value)
        .text.replace(/ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions?/gi, "[blocked instruction]")
        .replace(/exfiltrate|jailbreak|system\s+prompt/gi, "[blocked instruction]");
    const critical = reqs.filter(
      (r) => r.priority === "critical" || r.priority === "high",
    );

    const buildTasks = reqs.slice(0, 8).map((r) => ({
      title: `Implement: ${safe(r.title)}`,
      ...(r.id ? { requirementIds: [r.id] } : {}),
      ...(sourceRefs.length ? { sourceRefs } : {}),
      description:
        (r.details ? safe(r.details).slice(0, 500) : null) ??
        `Deliver the "${safe(r.title)}" requirement end to end, including configuration and validation.`,
      suggestedRole: "solutions_engineer" as const,
      estimateHours: r.priority === "critical" ? 24 : r.priority === "high" ? 16 : 8,
    }));

    // When this is a revision, lead the summary by naming the change made in
    // response to the reviewer — makes the closed feedback loop visible.
    const revisionPrefix = input.reviewerFeedback
      ? `Revised in response to reviewer feedback ("${safe(input.reviewerFeedback)}"): scope and sequencing were adjusted accordingly. `
      : "";

    return addPlanLinks({
      summary: `${revisionPrefix}Phased implementation of ${safe(input.projectName)} for ${safe(input.customerName)}, covering ${reqs.length} stated requirement${reqs.length === 1 ? "" : "s"}. The plan moves from discovery and environment setup through iterative build and validation to a controlled launch with handoff documentation.${critical.length ? ` ${critical.length} high-priority requirement${critical.length === 1 ? "" : "s"} are front-loaded into the early build phase.` : ""}`,
      ...(sourceRefs.length ? { summarySourceRefs: sourceRefs } : {}),
      assumptions: [
        ...(input.reviewerFeedback
          ? [`This revision addresses prior review feedback: ${safe(input.reviewerFeedback)}.`]
          : []),
        `${safe(input.customerName)} can provide a technical point of contact within the first week.`,
        "Access to required source systems is granted before the build phase begins.",
        "Scope is limited to the requirements captured at intake; new requests go through change control.",
      ],
      risks: [
        {
          description:
            "Third-party system access or credentials arrive late, delaying integration work.",
          severity: "medium",
          mitigation:
            "Request access during kickoff and track it as a week-one milestone exit criterion.",
        },
        ...(critical.length > 2
          ? [
              {
                description:
                  "A high concentration of critical requirements creates schedule pressure in the build phase.",
                severity: "high" as const,
                mitigation:
                  "Sequence critical items first and review scope weekly with the customer.",
              },
            ]
          : []),
      ],
      milestones: [
        {
          name: "Discovery & Kickoff",
          description:
            "Confirm scope, stakeholders, environments, and success criteria; finalize the delivery schedule.",
          durationWeeks: 1,
          tasks: [
            {
              title: "Run kickoff workshop and confirm requirement priorities",
              description:
                "Walk through each intake requirement with stakeholders and confirm acceptance criteria.",
              suggestedRole: "implementation_manager",
              estimateHours: 6,
            },
            {
              title: "Provision environments and access",
              description:
                "Set up sandbox/production environments and collect credentials for all integrated systems.",
              suggestedRole: "solutions_engineer",
              estimateHours: 8,
            },
          ],
        },
        {
          name: "Foundation & Configuration",
          description:
            "Stand up the core configuration that all requirement work builds on.",
          durationWeeks: 2,
          tasks: [
            {
              title: "Configure base platform settings and user roles",
              description:
                "Apply the agreed baseline configuration, security roles, and notification defaults.",
              suggestedRole: "solutions_engineer",
              estimateHours: 12,
            },
            {
              title: "Document configuration decisions",
              description:
                "Record each configuration choice and its rationale for handoff.",
              suggestedRole: "solutions_engineer",
              estimateHours: 4,
            },
          ],
        },
        {
          name: "Requirement Build",
          description:
            "Deliver the stated requirements iteratively, highest priority first.",
          durationWeeks: 3,
          tasks: buildTasks.length
            ? buildTasks
            : [
                {
                  title: "Implement core workflow",
                  description: "Build the primary workflow agreed at kickoff.",
                  suggestedRole: "solutions_engineer",
                  estimateHours: 16,
                },
              ],
        },
        {
          name: "Validation & UAT",
          description:
            "Verify every requirement against its acceptance criteria with customer participation.",
          durationWeeks: 1.5,
          tasks: [
            {
              title: "Execute internal QA pass",
              description:
                "Test each delivered requirement against acceptance criteria and log defects.",
              suggestedRole: "solutions_engineer",
              estimateHours: 12,
            },
            {
              title: "Facilitate customer UAT and sign-off",
              description:
                "Run UAT sessions, triage feedback, and capture formal sign-off.",
              suggestedRole: "implementation_manager",
              estimateHours: 8,
            },
          ],
        },
        {
          name: "Launch & Handoff",
          description:
            "Go live, train users, and hand off documentation and support ownership.",
          durationWeeks: 1,
          tasks: [
            {
              title: "Execute go-live checklist",
              description:
                "Promote configuration to production and verify critical paths post-launch.",
              suggestedRole: "solutions_engineer",
              estimateHours: 8,
            },
            {
              title: "Deliver training and handoff documentation",
              description:
                "Train customer admins and hand off runbooks and support contacts.",
              suggestedRole: "implementation_manager",
              estimateHours: 6,
            },
          ],
        },
      ],
      openQuestions: [
        `Who is the final approver on ${input.customerName}'s side for UAT sign-off?`,
        "Are there compliance or data-residency constraints that affect environment setup?",
      ],
    }, reqs, sourceRefs);
  }

  private buildDigest(input: DigestPromptInput): { title: string; body: string } {
    const { taskCounts } = input;
    const total =
      taskCounts.done +
      taskCounts.inProgress +
      taskCounts.blocked +
      taskCounts.todo;
    const pct = total ? Math.round((taskCounts.done / total) * 100) : 0;
    const inProgressMilestones = input.milestoneSummary
      .filter((m) => m.status === "in_progress")
      .map((m) => m.name);

    const paragraphs = [
      `Here is your ${input.periodDays}-day progress update for ${input.projectName}.`,
      `Overall delivery is ${pct}% complete: ${taskCounts.done} of ${total} tasks are finished, with ${taskCounts.inProgress} actively in progress.${inProgressMilestones.length ? ` Current focus is on ${inProgressMilestones.join(" and ")}.` : ""}`,
      taskCounts.blocked > 0
        ? `${taskCounts.blocked} task${taskCounts.blocked === 1 ? " is" : "s are"} currently blocked; our team is actively working to unblock ${taskCounts.blocked === 1 ? "it" : "them"} and will flag anything that needs input from your side.`
        : `Nothing is currently blocked, and the team has what it needs to keep moving.`,
      `We logged ${input.recentActivity.length} project activities in this period. As always, reach out to your implementation manager with any questions — the next update will follow in ${input.periodDays} days.`,
    ];

    return {
      title: `${input.projectName} — Progress Update`,
      body: paragraphs.join("\n\n"),
    };
  }
}

function addPlanLinks(
  plan: PlanContent,
  requirements: PlanPromptInput["requirements"],
  sourceRefs: string[],
): PlanContent {
  const requirementIds = requirements.flatMap((requirement) =>
    requirement.id ? [requirement.id] : [],
  );
  return {
    ...plan,
    ...(sourceRefs.length ? { summarySourceRefs: sourceRefs } : {}),
    risks: plan.risks.map((risk) => ({
      ...risk,
      ...(sourceRefs.length ? { sourceRefs } : {}),
    })),
    milestones: plan.milestones.map((milestone) => ({
      ...milestone,
      ...(sourceRefs.length ? { sourceRefs } : {}),
      tasks: milestone.tasks.map((task) => ({
        ...task,
        ...(requirementIds.length ? { requirementIds } : {}),
        ...(sourceRefs.length ? { sourceRefs } : {}),
      })),
    })),
  };
}

function estimateUsage(system: string, user: string, output: string) {
  const tokens = (value: string) => Math.max(1, Math.ceil(value.length / 4));
  return {
    inputTokens: tokens(system) + tokens(user),
    outputTokens: tokens(output),
    source: "estimated" as const,
  };
}
