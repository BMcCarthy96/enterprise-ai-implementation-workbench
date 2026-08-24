import scoreboard from "../../evals/scoreboard.json";
import { getBuildMetadata } from "@/lib/buildMetadata";

export type ProofStatus =
  | "verified"
  | "ci_verified"
  | "staging_observed"
  | "implemented"
  | "target"
  | "planned";
export type ProofEvidenceKind =
  | "demo"
  | "test"
  | "ci"
  | "api"
  | "adr"
  | "runbook"
  | "artifact";

export interface ProofEvidence {
  kind: ProofEvidenceKind;
  label: string;
  href: string;
  description?: string;
}

export interface ProofClaim {
  id: string;
  category: "delivery" | "ai" | "security" | "reliability" | "platform";
  title: string;
  summary: string;
  status: ProofStatus;
  evidence: ProofEvidence[];
  lastVerifiedCommit?: string;
  verification?: {
    commitSha: string;
    workflowRunUrl?: string;
    command?: string;
    environment: string;
    verifiedAt: string;
    conclusion: "success";
  };
}

export const proofStatusLabels: Record<ProofStatus, string> = {
  verified: "Verified",
  ci_verified: "CI verified",
  staging_observed: "Staging observed",
  implemented: "Implemented",
  target: "Operating target",
  planned: "Planned",
};

export const proofClaims: ProofClaim[] = [
  {
    id: "human-approval-boundary",
    category: "delivery",
    title: "AI output stays a proposal until a human approves it",
    summary:
      "Structured plans are validated, reviewed, and only then materialized into delivery milestones and tasks.",
    status: "ci_verified",
    evidence: [
      {
        kind: "demo",
        label: "Open AI-to-approval tour",
        href: "/demo?checkpoint=ai-evidence",
      },
      {
        kind: "test",
        label: "Approval and RBAC tests",
        href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/tests/unit/approvals.test.ts",
      },
      {
        kind: "adr",
        label: "Architecture notes",
        href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/docs/architecture.md",
      },
    ],
  },
  {
    id: "grounded-ai-evidence",
    category: "ai",
    title: "Grounded plans link inspectable AI evidence",
    summary:
      "The grounded showcase connects retrieval, repair, normalized checks, citations, cost, latency, and the approval outcome in one evidence packet.",
    status: "ci_verified",
    evidence: [
      {
        kind: "demo",
        label: "Open AI evidence checkpoint",
        href: "/demo?checkpoint=ai-evidence",
      },
      {
        kind: "test",
        label: "Evidence service tests",
        href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/tests/unit/aiEvidence.test.ts",
      },
      { kind: "api", label: "OpenAPI contract", href: "/api/openapi.json" },
    ],
  },
  {
    id: "tenant-isolation",
    category: "security",
    title: "Tenant boundaries are enforced in application and database layers",
    summary:
      "RBAC, organization-scoped lookups, transaction-local RLS context, private object storage, and synthetic demo isolation work together.",
    status: "implemented",
    evidence: [
      {
        kind: "test",
        label: "Access and RBAC tests",
        href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/tests/unit/access.test.ts",
      },
      {
        kind: "test",
        label: "Cross-tenant browser proof",
        href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/tests/e2e/workbench.spec.ts",
      },
      {
        kind: "runbook",
        label: "Security boundaries",
        href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/docs/security.md",
      },
      {
        kind: "artifact",
        label: "Customer assignment RLS migration",
        href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/drizzle/0019_customer_assignments.sql",
      },
      {
        kind: "demo",
        label: "Open admin access controls",
        href: "/demo?persona=org_admin&checkpoint=platform-security",
      },
    ],
  },
  {
    id: "failure-aware-jobs",
    category: "reliability",
    title: "At-least-once delivery and failure are first-class states",
    summary:
      "Atomic fenced claims, bounded backoff, partial-batch handling, dead-letter parking, and a visible retry path make recovery inspectable.",
    status: "implemented",
    evidence: [
      {
        kind: "demo",
        label: "Open operations",
        href: "/demo?checkpoint=dlq-recovery",
      },
      {
        kind: "test",
        label: "Job reliability tests",
        href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/tests/unit/jobs.test.ts",
      },
      {
        kind: "test",
        label: "Fenced worker implementation",
        href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/src/worker/index.ts",
      },
      {
        kind: "runbook",
        label: "AWS deployment checklist",
        href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/docs/aws-deployment.md",
      },
    ],
  },
  {
    id: "offline-evaluation",
    category: "ai",
    title: "AI quality claims are backed by a reproducible offline suite",
    summary:
      "Fifteen synthetic cases across three prompt variants exercise schema, coverage, citation, and injection gates without cloud credentials.",
    status: "ci_verified",
    evidence: [
      {
        kind: "artifact",
        label: "Offline scoreboard",
        href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/evals/scoreboard.json",
      },
      {
        kind: "ci",
        label: "CI workflow",
        href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/actions/workflows/ci.yml",
      },
      {
        kind: "demo",
        label: "Open AI quality checkpoint",
        href: "/demo?checkpoint=ai-evidence",
      },
    ],
  },
  {
    id: "oidc-scim-lifecycle",
    category: "security",
    title: "Enterprise identity lifecycle is standards-ready",
    summary:
      "OIDC login and SCIM provisioning support controlled role mapping, hashed bearer tokens, and immediate deprovisioning.",
    status: "implemented",
    evidence: [
      {
        kind: "api",
        label: "SCIM service configuration source",
        href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/src/app/api/scim/v2/ServiceProviderConfig/route.ts",
      },
      {
        kind: "test",
        label: "Enterprise control tests",
        href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/tests/unit/enterpriseControls.test.ts",
      },
      {
        kind: "runbook",
        label: "Security boundaries",
        href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/docs/security.md",
      },
    ],
  },
  {
    id: "webhook-integrations",
    category: "platform",
    title: "Outbound integrations are signed, retryable, and tenant-scoped",
    summary:
      "Versioned event envelopes travel through the durable job path with HMAC signatures, replay windows, SSRF guards, and bounded response capture.",
    status: "implemented",
    evidence: [
      {
        kind: "api",
        label: "Webhook management route",
        href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/src/app/api/v1/webhooks/route.ts",
      },
      {
        kind: "test",
        label: "Signature and SSRF tests",
        href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/tests/unit/enterpriseControls.test.ts",
      },
      {
        kind: "runbook",
        label: "Security boundaries",
        href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/docs/security.md",
      },
    ],
  },
  {
    id: "retention-controls",
    category: "security",
    title: "Data lifecycle controls are explicit and inspectable",
    summary:
      "Org admins can preview and tune retention windows while a bounded scheduled run records counts, outcome, and sanitized errors.",
    status: "implemented",
    evidence: [
      {
        kind: "api",
        label: "Retention management route",
        href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/src/app/api/v1/retention-policy/route.ts",
      },
      {
        kind: "test",
        label: "Retention bound tests",
        href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/tests/unit/enterpriseControls.test.ts",
      },
      {
        kind: "runbook",
        label: "Data lifecycle guide",
        href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/docs/security.md",
      },
    ],
  },
  {
    id: "staging-slos",
    category: "reliability",
    title: "Staging reliability is measured against explicit service targets",
    summary:
      "Availability, API latency, queue start time, generation outcomes, and recovery objectives will be reported separately from aspirational targets.",
    status: "target",
    evidence: [
      {
        kind: "runbook",
        label: "Deployment guide",
        href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/docs/aws-deployment.md",
      },
    ],
  },
  {
    id: "public-staging-verification",
    category: "platform",
    title: "Public staging smoke verification",
    summary:
      "A public Vercel, Neon, AWS, and optional IdP deployment will be promoted only after health, checkpoint, retention, webhook, and capped Bedrock smoke checks pass.",
    status: "planned",
    evidence: [
      {
        kind: "runbook",
        label: "AWS deployment and release guide",
        href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/docs/aws-deployment.md",
      },
      {
        kind: "runbook",
        label: "Operations and restore runbook",
        href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/docs/operations.md",
      },
    ],
  },
  {
    id: "aws-native-backbone",
    category: "platform",
    title: "The local workflow maps cleanly to an AWS-native production shape",
    summary:
      "CDK captures encrypted storage, SQS/DLQ, Lambda workers, scheduled cleanup, alarms, budgets, and deployment trust boundaries.",
    status: "implemented",
    evidence: [
      {
        kind: "api",
        label: "Synthesized infrastructure",
        href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/tree/main/infra",
      },
      {
        kind: "runbook",
        label: "AWS deployment guide",
        href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/docs/aws-deployment.md",
      },
    ],
  },
  {
    id: "traceable-operations",
    category: "reliability",
    title: "Request-to-worker correlation is part of the operating model",
    summary:
      "OpenTelemetry spans and safe trace context connect API requests, job dispatch, generation, and worker execution without exporting tenant identifiers or content.",
    status: "implemented",
    evidence: [
      {
        kind: "adr",
        label: "Telemetry decision record",
        href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/docs/architecture.md",
      },
      {
        kind: "ci",
        label: "Typecheck and test workflow",
        href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/actions/workflows/ci.yml",
      },
    ],
  },
];

const COMMIT_SHA = /^[a-f0-9]{40}$/i;
const WORKFLOW_RUN_URL =
  /^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+(?:\/.*)?$/;

function validTimestamp(value: string | undefined): value is string {
  return Boolean(value && !Number.isNaN(Date.parse(value)));
}

function provenanceReason(input: {
  buildCommit: string;
  evidenceCommit?: string;
  runUrl?: string;
  verifiedAt?: string;
  conclusion?: string;
}): string {
  if (!COMMIT_SHA.test(input.buildCommit))
    return "This build does not expose an immutable commit SHA.";
  if (!input.evidenceCommit)
    return "No CI evidence commit is attached to this build.";
  if (input.evidenceCommit !== input.buildCommit)
    return "Attached CI evidence belongs to a different commit.";
  if (input.conclusion !== "success")
    return "A successful CI conclusion is not attached to this build.";
  if (!input.runUrl || !WORKFLOW_RUN_URL.test(input.runUrl))
    return "A valid GitHub Actions run URL is not attached.";
  if (!validTimestamp(input.verifiedAt))
    return "An explicit CI verification timestamp is not attached.";
  return "Current build and CI evidence match.";
}

export function getProofManifest() {
  const flagship =
    scoreboard.variants["plan-v2.0"] ?? scoreboard.variants["plan-v1.0"];
  const buildMetadata = getBuildMetadata();
  const commit = buildMetadata.commit;
  const evidenceCommit = process.env.PROOF_EVIDENCE_SHA;
  const evidenceRunUrl = process.env.PROOF_EVIDENCE_RUN_URL;
  const evidenceCommand = process.env.PROOF_EVIDENCE_COMMAND;
  const verifiedAt = process.env.PROOF_EVIDENCE_VERIFIED_AT;
  const evidenceConclusion = process.env.PROOF_EVIDENCE_CONCLUSION;
  const environment =
    process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development";
  const currentBuildVerified = Boolean(
    COMMIT_SHA.test(commit) &&
      evidenceCommit === commit &&
      evidenceConclusion === "success" &&
      evidenceRunUrl &&
      WORKFLOW_RUN_URL.test(evidenceRunUrl) &&
      validTimestamp(verifiedAt),
  );
  const reason = provenanceReason({
    buildCommit: commit,
    evidenceCommit,
    runUrl: evidenceRunUrl,
    verifiedAt,
    conclusion: evidenceConclusion,
  });
  const claims: ProofClaim[] = proofClaims.map((claim) => {
    if (claim.status === "ci_verified" && !currentBuildVerified) {
      return { ...claim, status: "implemented" };
    }
    if (
      claim.status !== "ci_verified" ||
      !evidenceCommit ||
      !evidenceRunUrl ||
      !verifiedAt
    ) {
      return { ...claim };
    }
    return {
      ...claim,
      lastVerifiedCommit: evidenceCommit,
      verification: {
        commitSha: evidenceCommit,
        workflowRunUrl: evidenceRunUrl,
        ...(evidenceCommand ? { command: evidenceCommand } : {}),
        environment,
        verifiedAt,
        conclusion: "success",
      },
    };
  });
  return {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    build: {
      commit,
      environment,
      deploymentMode: buildMetadata.deploymentMode,
      providerMode: buildMetadata.providerMode,
      databaseMode: buildMetadata.databaseMode,
      buildTime: buildMetadata.buildTime,
      evidenceVersion: buildMetadata.evidenceVersion,
    },
    evaluation: {
      suiteVersion: scoreboard.suiteVersion,
      caseCount: scoreboard.caseCount,
      schemaValidRate: flagship?.schemaValidRate ?? null,
      citationValidity: flagship?.citationValidity ?? null,
      injectionResistance: flagship?.injectionResistance ?? null,
    },
    provenance: {
      status: currentBuildVerified ? "verified" : "unverified",
      currentBuildVerified,
      reason,
      ...(evidenceCommit ? { evidenceCommit } : {}),
      ...(currentBuildVerified && evidenceRunUrl && verifiedAt
        ? { workflowRunUrl: evidenceRunUrl, verifiedAt }
        : {}),
    },
    claims,
  } as const;
}

export function proofStatusTone(status: ProofStatus): string {
  return {
    verified: "border-slate-200 bg-slate-50 text-slate-700",
    ci_verified: "border-emerald-200 bg-emerald-50 text-emerald-800",
    staging_observed: "border-cyan-200 bg-cyan-50 text-cyan-800",
    implemented: "border-indigo-200 bg-indigo-50 text-indigo-800",
    target: "border-amber-200 bg-amber-50 text-amber-800",
    planned: "border-gray-200 bg-gray-50 text-gray-700",
  }[status];
}
