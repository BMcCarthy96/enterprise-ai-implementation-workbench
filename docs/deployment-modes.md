# Deployment modes

The Workbench has two intentionally different deployment modes. Keeping them
explicit prevents a polished guided walkthrough from being confused with a
production launch plan.

## Persistent showcase environment

Use this mode for a portfolio URL or a scheduled interview. The web runtime,
Postgres/pgvector database, object storage, queue, worker, and observability
stack stay provisioned. Set `WORKBENCH_ENV_MODE=showcase` and
`AI_PROVIDER=mock`, then keep the demo guardrails enabled:

- synthetic accounts only; never add personal or customer data;
- public password login disabled; reviewers enter through expiring isolated demo sessions or configured enterprise SSO;
- one live generation per isolated demo workspace;
- a short workspace TTL and the daily/monthly spend caps from `.env.example`;
- `/api/health` as the liveness/readiness check;
- CI proof metadata (`PROOF_EVIDENCE_SHA`, `PROOF_EVIDENCE_RUN_URL`) on the
  build that is advertised publicly.

This mode is the clearest way to show a stable `/proof` page, seeded failure
recovery, AI evidence packets, and enterprise Settings without asking a
reviewer to deploy infrastructure first.

## Ephemeral interview environment

Use this mode for a live technical interview or a pull request preview. Create
a short-lived stack from the same image and migrations, run the seed script,
and destroy it after the session. Keep the mode visible in the environment
metadata so screenshots and proof claims cannot imply durable production data.

```text
WORKBENCH_ENV_MODE=interview
WORKBENCH_TTL_HOURS=8
AI_PROVIDER=mock
```

The deployment checklist is: deploy web and worker, run migrations, seed,
smoke-test `/api/health` and the generate → approve → materialize flow, capture
the proof bundle, then schedule teardown. A preview may use a managed Neon
branch and temporary S3/SQS resources; it must not reuse a persistent showcase
database.

## Production path

The AWS/CDK path in [aws-deployment.md](aws-deployment.md) is the worker and
data-plane deployment. The public Vercel/Neon setup, migrations, smoke checks,
and rollback steps are in [showcase-deployment.md](showcase-deployment.md). A
public showcase is still a synthetic environment, separate from a production
claim.
