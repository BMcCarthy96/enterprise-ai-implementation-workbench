# Deploying the Enterprise AI Implementation Workbench

The production shape is intentionally AWS-first while keeping the application portable:

- **Neon Postgres + pgvector** supplies a pooled runtime URL and a separate direct admin/migration URL.
- **CDK** provisions a private encrypted S3 bucket, SQS queue + DLQ, an SQS-triggered Lambda worker, a one-minute durable-dispatch reconciler, an hourly expired-demo cleanup Lambda, CloudWatch alarms, and a $15 monthly budget.
- **Bedrock Converse** runs Claude plan generation; **Titan Text Embeddings v2** powers retrieval.
- **Vercel** can host the Next.js UI, but its runtime must use an approved short-lived AWS credential pattern. The optional OIDC role in this stack is a deployment-role scaffold, not a reason to place long-lived AWS keys in Vercel.

The local/cloud switch remains configuration-only: remove `AWS_ENDPOINT_URL`, use the real Neon URLs and CDK outputs, and set `AI_PROVIDER=bedrock` plus `EMBEDDING_PROVIDER=bedrock`.

## Prerequisites

1. An AWS account with MFA and an IAM Identity Center profile (do not use the root user).
2. Bedrock model access enabled in one region for the selected Claude and Titan models.
3. A Neon project with the `vector` extension enabled. Use a pooled connection for `DATABASE_URL` and the direct connection for `DATABASE_ADMIN_URL`.
4. Node 22+, Docker Desktop, and the AWS CLI/CDK bootstrap permissions.

Pick one region and keep Neon, S3, SQS, and Bedrock aligned to it where applicable (the default is `us-east-1`).

## Create the runtime secret

Create one Secrets Manager JSON secret before deploying the stack. The CDK functions resolve these fields into their environment at deploy time; no secret values are committed to the template or source tree.

```json
{
  "DATABASE_URL": "postgres://runtime:<password>@<pooled-neon-host>/workbench?sslmode=require",
  "DATABASE_ADMIN_URL": "postgres://admin:<password>@<direct-neon-host>:5432/workbench?sslmode=require",
  "SESSION_SECRET": "<at-least-32-character-random-value>",
  "APP_ENCRYPTION_KEY": "<base64-key-material>"
}
```

```bash
aws secretsmanager create-secret \
  --name enterprise-ai-workbench/runtime \
  --secret-string file://runtime-secret.json \
  --region us-east-1
```

If the secret has another name, pass `-c runtimeSecretName=your/name` to CDK commands below.

## Synthesize and deploy the AWS stack

```bash
npm run infra:install
cd infra
npx cdk bootstrap
npx cdk synth
npx cdk deploy \
  -c runtimeSecretName=enterprise-ai-workbench/runtime \
  -c budgetEmail=you@example.com \
  -c vercelTeamId=<team-id> \
  -c vercelProject=<project-name>
```

The deploy prints `DocumentsBucketName`, `JobsQueueUrl`, and `JobsDlqUrl`. Copy those values into the application runtime environment. The stack uses a 120-second Lambda timeout, 720-second SQS visibility timeout, batch size 5, reserved concurrency 2, partial-batch failure reporting, and a five-delivery DLQ policy.

For a repeatable release path, the repository also includes a manual
`.github/workflows/deploy.yml` workflow. Configure the GitHub environment with
an `AWS_DEPLOY_ROLE_ARN` secret whose trust policy accepts GitHub's OIDC
provider, then dispatch the workflow with the region and pre-created runtime
secret name. The workflow synthesizes the template before deploying and never
stores database, session, or AWS access-key values in GitHub.

## Migrate Neon and configure the application

Run migrations with the direct admin URL, never the pooled runtime role:

```bash
$env:DATABASE_URL="postgres://runtime:..."
$env:DATABASE_ADMIN_URL="postgres://admin:..."
npm run db:migrate
```

After migrations, provision grants and forced RLS for the pre-created runtime role:

```bash
psql "$DATABASE_ADMIN_URL" -v runtime_role=workbench_runtime -f scripts/provision-runtime-role.sql
```

The admin role must retain `BYPASSRLS`; the runtime connection must use the named restricted role.

Configure the Next.js runtime with:

```bash
DATABASE_URL=<pooled Neon runtime URL>
DATABASE_ADMIN_URL=<direct Neon admin URL>
SESSION_SECRET=<same secret value>
AWS_REGION=us-east-1
S3_BUCKET=<DocumentsBucketName output>
JOBS_QUEUE_URL=<JobsQueueUrl output>
AI_PROVIDER=bedrock
BEDROCK_MODEL_ID=anthropic.claude-sonnet-4-5-20250929-v1:0
EMBEDDING_PROVIDER=bedrock
BEDROCK_EMBEDDING_MODEL_ID=amazon.titan-embed-text-v2:0
NODE_ENV=production
```

The Lambda worker receives its database and session values from Secrets Manager and its bucket/queue names directly from the CDK stack. Its IAM role is limited to the required S3, SQS send/consume, Bedrock model invocation, and CloudWatch execution duties; the database roles enforce application-vs-admin separation.

For a Vercel-hosted UI, use a short-lived OIDC/role-assumption bridge or keep the server runtime in an AWS role-bearing service such as App Runner/ECS. Do not put a permanent `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` pair in Vercel project settings. The optional Vercel OIDC context in CDK is constrained to the named project/environment and is intended for deployment automation.

## Local-to-cloud mapping

| Capability | Local | AWS | Code change |
|---|---|---|---|
| Postgres | Docker `pgvector/pg16` on `:5433` | Neon pooled runtime + direct admin URL | Environment only |
| Object storage | LocalStack S3 | Private encrypted S3 | Environment only |
| Jobs | LocalStack SQS + DLQ | SQS + DLQ + Lambda event source | Same `processJob` path |
| Dispatch repair | Worker poll-loop reconciliation | One-minute EventBridge + Lambda reconciliation | Same `dispatchUndeliveredJobs` service |
| Plan model | Deterministic mock | Bedrock Claude Converse | `AI_PROVIDER` |
| Embeddings | Deterministic mock vectors | Bedrock Titan Text Embeddings v2 | `EMBEDDING_PROVIDER` |
| Demo cleanup | Service call | Scheduled Lambda + S3 prefix cleanup | Same service |

## Enterprise identity, webhooks, and observability

Add APP_ENCRYPTION_KEY to the runtime secret JSON. It is used for per-record
AES-256-GCM encryption of OIDC client secrets and webhook signing secrets.
Configure an organization connection through the identity admin API, then
point the OIDC provider's callback to /api/auth/oidc/callback. Keep JIT off
unless the organization explicitly accepts just-in-time provisioning; the
SCIM-first path provides deterministic group-to-role lifecycle.

Webhook endpoints are organization-scoped and should target a verified HTTPS
receiver. The app performs DNS/private-network checks at registration and
delivery, signs each event with a timestamped HMAC, and sends only a minimal
versioned envelope. Retention preview and policy APIs are org-admin only.

For the web runtime, register the Next.js instrumentation entrypoint and send
OTLP to a Vercel-compatible collector when available. The shared worker also
registers the OpenTelemetry SDK when `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` (or
`WORKBENCH_OTEL_ENABLED=true`) is present, so local worker spans and the
SQS-triggered Lambda path use the same trace names. CloudWatch/X-Ray remain the
authoritative AWS runtime view; the persisted job trace context joins both
sides without putting tenant ids or content in telemetry.

Public demo guardrails are intentionally conservative: one live generation per
isolated workspace, a one-dollar daily application cap, and the existing
fifteen-dollar monthly AWS budget. Seeded evidence remains the fallback when a
provider circuit breaker is open.

## Security and operations checklist

- Keep `DATABASE_URL` on a least-privilege runtime role and `DATABASE_ADMIN_URL` on a separate migration/cleanup role.
- After provisioning those roles, force RLS on tenant tables and grant the runtime role only the tables/actions needed by the app.
- Keep S3 public access blocked and preserve the `orgs/{orgId}/projects/{projectId}/...` key namespace.
- Enable the CloudWatch queue-age, DLQ, and worker-error alarms before a recruiter demo.
- The cleanup Lambda removes expired demo organizations and their exact `orgs/{orgId}/` object prefixes hourly.
- Keep the $15 budget and email thresholds enabled; Bedrock is pay-per-token and Neon/S3/SQS are usage-based.

The trust-boundary details, redaction behavior, RLS assumptions, and explicit non-goals are in [security.md](security.md). The repeatable 90-second walkthrough is in [recruiter-demo-script.md](recruiter-demo-script.md).
