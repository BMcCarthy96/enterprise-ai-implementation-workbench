# Security policy

The Workbench is a synthetic-data portfolio project. Its security controls are
implemented to make the engineering tradeoffs inspectable; the project is not
SOC 2, HIPAA, FedRAMP, ISO 27001, or any other certified service.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Email the
maintainer listed in the repository profile with the subject
[security] enterprise-ai-workbench and include a minimal reproduction, affected
route/commit, and impact. Do not include real customer data or credentials.
The maintainer will acknowledge reports within five business days and will
coordinate a fix or an explicit non-issue explanation.

## Security boundaries

- Every authenticated request carries a membership id and session version;
  suspended or role-changed memberships invalidate the session immediately.
- Organization queries run inside a transaction-local RLS context. Admin
  connections are reserved for migrations, cleanup, SCIM, and worker source-of-
  truth reads.
- OIDC uses discovery, authorization-code PKCE, state, nonce, verified issuer
  and email, optional domain allowlists, and safe same-origin return paths.
- SCIM bearer tokens are organization-scoped, expirable, revocable, hashed at
  rest, and shown only once. Unmapped groups grant no access.
- OIDC and webhook secrets use AES-256-GCM with a per-record nonce and
  organization-bound authenticated data. Set APP_ENCRYPTION_KEY from a runtime
  secret manager in production.
- Webhooks require HTTPS in production, reject credentials/private targets
  after DNS resolution, disable redirects, time out after five seconds, bound
  response capture, sign with timestamped HMAC-SHA256, and use idempotent
  delivery records.
- Audit, AI detail, completed-job, and webhook retention windows are bounded,
  previewable, and recorded in a retention-run ledger. Demo workspaces remain
  synthetic and expire after 60 minutes.
- Telemetry excludes emails, prompts, model output, document content, raw
  organization ids, and bearer tokens. Job rows carry only safe trace context;
  SQS messages carry only a job id.

## Data lifecycle and recovery

The data lifecycle is: browser/API input → tenant-scoped Postgres and private
S3 → bounded retrieval context → validated AI artifact → human approval →
durable delivery/audit evidence. Retention removes detail on a bounded schedule
while artifact-linked summaries remain available. Production operators should
use Neon point-in-time restore plus versioned S3 recovery, then replay the
durable job queue. The recovery objectives (24-hour RPO / four-hour RTO) are
targets until a staging restore drill is recorded.

## Control evidence

| Control family | Evidence |
|---|---|
| Access control | src/lib/auth/rbac.ts, OIDC/SCIM routes, membership-version checks |
| Tenant isolation | src/db/index.ts, RLS migration, tests/unit/access.test.ts |
| Cryptographic protection | src/lib/crypto.ts, authenticated encryption tests |
| Secure integrations | src/server/services/webhooks.ts, SSRF/signature tests |
| Secure development | .github/workflows/ci.yml, .github/workflows/security.yml, Dependabot |
| Resilience | src/server/services/jobs.ts, DLQ/retry UI, docs/operations.md |

This matrix is evidence for a portfolio review, not a compliance attestation.
