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
- Postgres RLS would be the next hardening step (defense in depth against a missed filter); it was skipped to keep the Drizzle setup simple and because every access path already funnels through the helpers.
- S3 objects are namespaced by org and project; the register endpoint rejects keys outside the caller's namespace, so the document table can never point at another tenant's object.

## Job system design

**Why not BullMQ/Redis?** The AWS story was a project requirement, and SQS + DLQ is the idiomatic AWS answer. It also demonstrates handling *at-least-once* semantics explicitly rather than leaning on a library's exactly-once promises.

Mechanics:

- `jobs` table row is created first (`queued`), then the id is sent to SQS. If the send fails, the row exists with no message — visible on the Ops page rather than silently lost.
- Worker claims with `UPDATE ... WHERE status='queued' RETURNING` — an atomic compare-and-swap. A duplicate SQS delivery finds `status != 'queued'` and no-ops.
- Failure path: attempts++, `failed` → re-enqueued with exponential backoff via SQS `DelaySeconds` (5·2ⁿ⁻¹ capped at 900s), until `maxAttempts` → `dead_letter` + audit event. The UI treats `failed` as "retry pending", `dead_letter` as "needs a human".
- The SQS-level redrive policy (maxReceiveCount 5 → DLQ) is a second, infrastructure-level safety net for messages the worker crashes on before writing anything.

## AI integration

- `AiProvider` interface with two implementations. The **mock** provider derives realistic output *from the actual prompt input* (it parses the same `<input_json>` envelope the real model sees), so offline demos exercise the identical pipeline: prompt build → completion → JSON extraction → zod validation → persistence.
- **Validation-repair loop:** one retry with the zod error text appended. Two design rules: never loop more than once (cost control), and never store unvalidated content.
- **Prompt versioning:** every plan row stores `model` + `promptVersion`, so output drift is attributable when prompts evolve — the audit log shows which prompt produced which plan.
- **What stays deterministic:** approval side effects (milestone/task materialization) are pure TypeScript over validated JSON. The model proposes; deterministic code disposes.

## Audit log

Append-only `audit_events`: `(orgId, actorId|null, action, subjectType, subjectId, projectId, metadata)`. Conventions:

- `actorId = null` means the system/worker acted.
- Action names are dot-scoped (`plan.generated`, `approval.rejected`, `job.dead_letter`) so they can be filtered by prefix later.
- Approvals additionally persist `reasonCode` on rejection — the seed for a quality-feedback loop (which reason codes correlate with which prompt versions).

## Known limitations / next iterations

1. **No RLS** (see above) — the top hardening priority for real production.
2. **Job polling from the browser** is simple interval polling; SSE or WebSocket push would remove the 1.5s poll loop.
3. **Plan diffing:** regenerated plans replace rather than diff against the previous version; a structured diff view would make re-approval faster.
4. **Single approval step:** the schema supports multi-step approval chains (approvals are rows, not columns), but the UI implements one gate.
5. **Worker scale-out** is safe (atomic claims) but untested beyond a single instance.
