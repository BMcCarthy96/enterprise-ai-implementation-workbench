<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Enterprise AI Implementation Workbench

Multi-tenant implementation-delivery platform: requirements intake → AI scoping plans (Bedrock/Claude or offline mock) → human approval queue → milestone/task boards → customer updates → audit log. AWS-native (Postgres/S3/SQS/Bedrock) but runs fully locally via Docker + LocalStack.

## Commands

- `docker compose up -d` — Postgres :5433 + LocalStack :4566 (S3/SQS auto-provisioned; LocalStack pinned to 4.6 — `latest` requires a paid token)
- `npm run dev` / `npm run worker` — app + SQS job worker (two terminals; worker required for plan/digest generation)
- `npm run db:migrate` / `npm run db:seed` — Drizzle migrations / demo tenants (password `demo1234`)
- `npm test` (Vitest unit) · `npm run test:e2e` (Playwright; needs seeded DB) · `npm run typecheck` · `npm run lint`

## Architecture rules

- All env access through `src/lib/env.ts` (zod-validated). `AWS_ENDPOINT_URL` set = LocalStack; unset = real AWS. `AI_PROVIDER=mock|bedrock`.
- Every tenant-owned query is org-scoped: API routes resolve resources ONLY via `src/server/services/access.ts` helpers; sessions carry `orgId`+`role` (jose JWT cookie).
- API routes wrap handlers in `withAuth(permission, handler)` from `src/lib/api.ts`; permissions live in `src/lib/auth/rbac.ts`.
- Every mutation writes an `audit_events` row via `recordAudit` (actorId null = system/worker).
- AI output must be zod-validated before persistence (`PlanContentSchema`); generation never mutates delivery state — only approval decisions do (`src/server/services/approvals.ts`).
- Jobs: DB row is source of truth, SQS carries only `{jobId}`; worker claims atomically (`queued→running`); failures re-enqueue with backoff until `maxAttempts` → `dead_letter`.
- Request bodies validate against schemas in `src/lib/apiSchemas.ts` — shared with the OpenAPI generator (`src/lib/openapi.ts`); update both stay in sync automatically since docs are generated from the schemas.
