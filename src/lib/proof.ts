import scoreboard from "../../evals/scoreboard.json";

export type ProofStatus = "verified" | "implemented" | "target" | "planned";
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
}

export const proofStatusLabels: Record<ProofStatus, string> = {
  verified: "Verified in CI / demo",
  implemented: "Implemented in code",
  target: "Operating target",
  planned: "Planned next",
};

export const proofClaims: ProofClaim[] = [
  {
    id: "human-approval-boundary",
    category: "delivery",
    title: "AI output stays a proposal until a human approves it",
    summary:
      "Structured plans are validated, reviewed, and only then materialized into delivery milestones and tasks.",
    status: "verified",
    evidence: [
      { kind: "demo", label: "Open approval queue", href: "/approvals" },
      { kind: "test", label: "Approval and RBAC tests", href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/tests/unit/approvals.test.ts" },
      { kind: "adr", label: "Architecture notes", href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/docs/architecture.md" },
    ],
  },
  {
    id: "grounded-ai-evidence",
    category: "ai",
    title: "Every plan carries inspectable AI evidence",
    summary:
      "Retrieval, repair, normalized checks, citations, cost, latency, and the approval outcome are connected in one evidence packet.",
    status: "verified",
    evidence: [
      { kind: "demo", label: "Open AI evidence", href: "/ai-runs" },
      { kind: "test", label: "Evidence service tests", href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/tests/unit/aiEvidence.test.ts" },
      { kind: "api", label: "OpenAPI contract", href: "/api/openapi.json" },
    ],
  },
  {
    id: "tenant-isolation",
    category: "security",
    title: "Tenant boundaries are enforced in application and database layers",
    summary:
      "RBAC, organization-scoped lookups, transaction-local RLS context, private object storage, and synthetic demo isolation work together.",
    status: "verified",
    evidence: [
      { kind: "test", label: "Access and RBAC tests", href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/tests/unit/access.test.ts" },
      { kind: "runbook", label: "Security boundaries", href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/docs/security.md" },
      { kind: "demo", label: "Switch demo personas", href: "/demo?checkpoint=role-switching" },
    ],
  },
  {
    id: "failure-aware-jobs",
    category: "reliability",
    title: "At-least-once delivery and failure are first-class states",
    summary:
      "Atomic job claims, persisted backoff, partial-batch handling, dead-letter parking, and a visible retry path make recovery inspectable.",
    status: "verified",
    evidence: [
      { kind: "demo", label: "Open operations", href: "/demo?checkpoint=dlq-recovery" },
      { kind: "test", label: "Job reliability tests", href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/tests/unit/jobs.test.ts" },
      { kind: "runbook", label: "AWS deployment checklist", href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/docs/aws-deployment.md" },
    ],
  },
  {
    id: "offline-evaluation",
    category: "ai",
    title: "AI quality claims are backed by a reproducible offline suite",
    summary:
      "Fifteen synthetic cases across three prompt variants exercise schema, coverage, citation, and injection gates without cloud credentials.",
    status: "verified",
    evidence: [
      { kind: "artifact", label: "Offline scoreboard", href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/evals/scoreboard.json" },
      { kind: "ci", label: "CI workflow", href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/actions/workflows/ci.yml" },
      { kind: "demo", label: "Open AI quality", href: "/insights" },
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
      { kind: "api", label: "SCIM service configuration", href: "/api/scim/v2/ServiceProviderConfig" },
      { kind: "test", label: "Enterprise control tests", href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/tests/unit/enterpriseControls.test.ts" },
      { kind: "runbook", label: "Security boundaries", href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/docs/security.md" },
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
      { kind: "api", label: "Webhook management API", href: "/api/openapi.json#/paths/~1api~1v1~1webhooks" },
      { kind: "test", label: "Signature and SSRF tests", href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/tests/unit/enterpriseControls.test.ts" },
      { kind: "runbook", label: "Security boundaries", href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/docs/security.md" },
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
      { kind: "api", label: "Retention management API", href: "/api/openapi.json#/paths/~1api~1v1~1retention-policy" },
      { kind: "test", label: "Retention bound tests", href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/tests/unit/enterpriseControls.test.ts" },
      { kind: "runbook", label: "Data lifecycle guide", href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/docs/security.md" },
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
      { kind: "runbook", label: "Deployment guide", href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/docs/aws-deployment.md" },
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
      { kind: "runbook", label: "AWS deployment and release guide", href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/docs/aws-deployment.md" },
      { kind: "runbook", label: "Operations and restore runbook", href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/docs/operations.md" },
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
      { kind: "api", label: "Synthesized infrastructure", href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/tree/main/infra" },
      { kind: "runbook", label: "AWS deployment guide", href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/docs/aws-deployment.md" },
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
      { kind: "adr", label: "Telemetry decision record", href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/blob/main/docs/architecture.md" },
      { kind: "ci", label: "Typecheck and test workflow", href: "https://github.com/BMcCarthy96/enterprise-ai-implementation-workbench/actions/workflows/ci.yml" },
    ],
  },
];

export function getProofManifest() {
  const flagship = scoreboard.variants["plan-v2.0"] ?? scoreboard.variants["plan-v1.0"];
  const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? "local";
  return {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    build: {
      commit,
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    },
    evaluation: {
      suiteVersion: scoreboard.suiteVersion,
      caseCount: scoreboard.caseCount,
      schemaValidRate: flagship?.schemaValidRate ?? null,
      citationValidity: flagship?.citationValidity ?? null,
      injectionResistance: flagship?.injectionResistance ?? null,
    },
    claims: proofClaims.map((claim) => ({
      ...claim,
      ...(claim.status === "verified" || claim.status === "implemented"
        ? { lastVerifiedCommit: commit }
        : {}),
    })),
  } as const;
}

export function proofStatusTone(status: ProofStatus): string {
  return {
    verified: "border-emerald-200 bg-emerald-50 text-emerald-800",
    implemented: "border-indigo-200 bg-indigo-50 text-indigo-800",
    target: "border-amber-200 bg-amber-50 text-amber-800",
    planned: "border-gray-200 bg-gray-50 text-gray-700",
  }[status];
}
