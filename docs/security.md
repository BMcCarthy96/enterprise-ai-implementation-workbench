# Security and trust boundaries

The Workbench is a synthetic-data portfolio project, but the security model is designed like an internal enterprise tool. The goal is to make the assumptions inspectable rather than imply that a demo is production-complete.

## Trust boundaries

1. Browser input, requirement text, reviewer notes, and uploaded documents are untrusted data.
2. The Next.js API is the policy boundary: session verification, RBAC, UUID validation, tenant-scoped lookups, upload completion checks, and demo quotas happen before side effects.
3. PostgreSQL RLS is defense in depth. Authenticated requests set `app.org_id` and `app.user_id` in a transaction-local context; pooled connections never rely on session state.
4. S3 is private. Keys are namespaced by organization and project, and downloads are presigned only after a tenant-checked document lookup.
5. SQS carries only a job id. Postgres is the source of truth; duplicate delivery is expected and the atomic claim makes it harmless.
6. Models receive redacted, bounded context. Production prompts, document chunks, and responses are not written to AI telemetry.

## Model-data flow

```text
requirements / S3 document
        │  tenant + project filter
        ▼
redaction → chunking → pgvector retrieval → opaque refs (S1…S8)
        │
        ▼
Bedrock / mock → Zod schema → requirement + citation + policy guardrails
        │                                  │
        └──────── one repair attempt ──────┘
                                           ▼
                              pending approval (never auto-executes)
```

Direct email, phone, and common account/identifier patterns are replaced with redaction markers before model submission. Telemetry stores only counts and sanitized error classifications. This is not a full DLP system; it is an explicit, testable non-goal.

## Tenant controls

- Malformed identifiers return `400 INVALID_IDENTIFIER`; valid foreign UUIDs return the same resource-not-found response as any other missing resource.
- Every resource lookup is organization-scoped, and RLS policies repeat that condition at the database boundary (including AI traces, retrieval chunks/citations, and demo quota state).
- Production deployments must use a pooled runtime role through `DATABASE_URL` and a separate owner/admin role through `DATABASE_ADMIN_URL`. After the platform creates both roles, run `scripts/provision-runtime-role.sql` as the admin role. It grants the complete application-table surface (including `job_attempts`), preserves the append-only audit boundary, establishes default privileges, and forces every policy-enabled table through RLS without creating or exposing credentials.
- Seed, migrations, and expired-demo cleanup use the admin connection and are never reachable from user routes.

## Abuse controls and demo limits

The public demo creates a synthetic organization per visitor/IP hash for 60 minutes. It caps active workspaces, AI generations, uploads, file size, total storage, and aggregate demo model spend. A quota check takes a transaction-scoped global admission lock, validates the workspace quota, and reserves an estimated model cost before a job is enqueued; completion releases that reservation while actual provider usage remains in `ai_runs`. Exhausted limits return `429 DEMO_LIMIT_REACHED` or `503 DEMO_BUDGET_EXHAUSTED`. An hourly cleanup job removes expired organizations and their exact S3 prefixes.

## Lifecycle, incident, and certification boundary

The lifecycle and control evidence are summarized in the repository
[security policy](../SECURITY.md) and [operations runbook](operations.md).
OIDC/SCIM are implemented as provider-neutral standards surfaces; direct SAML,
vendor-specific directory adapters, and OCR for scanned PDFs remain out of
scope. The public demo contains synthetic data only. Nothing in this project
constitutes SOC 2, HIPAA, ISO 27001, FedRAMP, or production uptime
certification. Offline mock metrics remain visibly separate from reported
provider usage.
