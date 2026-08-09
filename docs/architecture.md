# Architecture notes

Deeper technical documentation to complement the README. Written as the "explain your tradeoffs" companion for code review and interviews.

## Request lifecycle

1. **Edge proxy** (`src/proxy.ts`, Next 16's successor to middleware) verifies the `workbench_session` JWT on every non-public route. Browsers get redirected to `/login`; API callers get a 401 JSON body. The proxy only answers *"is this a valid session?"* — no role logic lives there.
2. **Route handlers** wrap their logic in `withAuth(permission, handler)` (`src/lib/api.ts`), which resolves the session, enforces one named RBAC permission, attaches a per-request child logger with a `requestId`, and converts thrown `ApiError`/`ZodError` into consistent JSON envelopes.
3. **Server components** read the session directly and query through the same org-scoped patterns; they never accept an org id from the client.

## Why sessions carry the org and role

The JWT payload includes `orgId` and `role` resolved at login. Tradeoff:

- ✅ Zero extra queries per request for tenancy/RBAC checks.
- ⚠️ A role change doesn't take effect until the next login (12h max). Acceptable for this system's threat model; a production hardening step would be a short-lived token + refresh, or a session-version check against the DB.

This shape is deliberately Cognito-compatible: swap token issuance for a Cognito user pool and keep every downstream check unchanged (claims map 1:1).

## Multi-tenancy strategy

Single database, shared schema, `org_id` column on every tenant-owned table — the standard SaaS starting point.

- All queries filter by the session's `orgId`; helpers in `src/server/services/access.ts` are the only way API routes resolve project-owned resources, so the filter can't be forgotten per-route.
- Postgres RLS repeats the organization predicate on every tenant-owned table. `withTenantTransaction` sets `app.org_id` and `app.user_id` with transaction-local `set_config`, so pooled connections cannot retain a previous caller's context.
- The runtime and owner connections are intentionally separate. Local Docker uses the owner for convenience; production must use a least-privilege runtime role and force RLS after role provisioning, as described in `docs/security.md`.
- S3 objects are namespaced by org and project; the register endpoint rejects keys outside the caller's namespace, so the document table can never point at another tenant's object.

## Job system design

**Why not BullMQ/Redis?** The AWS story was a project requirement, and SQS + DLQ is the idiomatic AWS answer. It also demonstrates handling *at-least-once* semantics explicitly rather than leaning on a library's exactly-once promises.

Mechanics:

- The job row and its audit event commit before SQS publication. A transaction-local post-commit hook prevents a fast worker from receiving a pointer to an uncommitted row.
- `dispatched_at` is the durable delivery marker. If the initial publish fails, the row remains `queued` with a null marker; the local worker and a one-minute scheduled AWS dispatcher republish it. A send/marker crash can create a duplicate pointer, which is safe by design.
- Worker claims with `UPDATE ... WHERE status='queued' RETURNING` — an atomic compare-and-swap. A duplicate SQS delivery finds `status != 'queued'` and no-ops.
- Failure path: attempts++, `failed` → re-enqueued with exponential backoff via SQS `DelaySeconds` (5·2ⁿ⁻¹ capped at 900s), until `maxAttempts` → `dead_letter` + audit event. The UI treats `failed` as "retry pending", `dead_letter` as "needs a human".
- The SQS-level redrive policy (maxReceiveCount 5 → DLQ) is a second, infrastructure-level safety net for messages the worker crashes on before writing anything.

## AI integration

- `AiProvider` has deterministic mock, Bedrock Converse, and direct Anthropic implementations. The **mock** provider derives realistic output *from the actual prompt input* (it parses the same `<input_json>` envelope the real model sees), so offline demos exercise the identical pipeline: prompt build → completion → JSON extraction → zod validation → persistence.
- User-authored plan/digest text and retrieved chunks are redacted before model submission. AI call telemetry stores counts, token usage, model/pricing version, latency, and sanitized outcomes—never raw prompts or responses.
- Retrieval embeds a redacted, project-specific query, applies tenant + project predicates before vector ranking, drops low-similarity matches, and persists only validated opaque citation references (`S1…S8`).
- **Validation-repair loop:** one retry with the zod error text appended. Two design rules: never loop more than once (cost control), and never store unvalidated content.
- **Prompt versioning:** every plan row stores `model` + `promptVersion`, so output drift is attributable when prompts evolve — the audit log shows which prompt produced which plan.
- **What stays deterministic:** approval side effects (milestone/task materialization) are pure TypeScript over validated JSON. The model proposes; deterministic code disposes.

## Audit log

Append-only `audit_events`: `(orgId, actorId|null, action, subjectType, subjectId, projectId, metadata)`. Conventions:

- `actorId = null` means the system/worker acted.
- Action names are dot-scoped (`plan.generated`, `approval.rejected`, `job.dead_letter`) so they can be filtered by prefix later.
- Approvals additionally persist `reasonCode` on rejection — the seed for a quality-feedback loop (which reason codes correlate with which prompt versions).

## Known limitations / next iterations

1. **Production database-role provisioning is environment-specific.** The migrations enable RLS but do not create credentials or force policies for the owner; deployment must create a restricted runtime role, grant only required operations, and force RLS on tenant tables.
2. **Customer stakeholder access is organization-wide.** The demo assumes a customer-facing tenant boundary; a shared implementation-provider tenant would need explicit customer/project assignments before onboarding external users.
3. **Job polling from the browser** is simple interval polling; SSE or WebSocket push would remove the 1.5s poll loop.
4. **Single approval step:** the schema supports multi-step approval chains (approvals are rows, not columns), but the UI implements one gate.
5. **Worker scale-out** is safe (atomic claims and idempotent pointers) but has not been load-tested beyond the automated checks.
