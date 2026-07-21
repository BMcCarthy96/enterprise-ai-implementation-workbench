# Deploying to real AWS

The app is developed against LocalStack, but every integration uses the real AWS SDK v3. Moving to a live account is a **configuration change, not a code change**: drop `AWS_ENDPOINT_URL`, point `DATABASE_URL` at RDS, set real queue/bucket names, and flip `AI_PROVIDER=bedrock`.

## 1. Account prerequisites

1. Create an AWS account and enable MFA on the root user.
2. Create an IAM user or (better) an IAM Identity Center profile for yourself; never deploy as root.
3. Pick one region (e.g. `us-east-1`) and stay in it — Bedrock model access is per-region.

## 2. Resources to create

| Resource | Service | Notes | Free-tier friendly? |
|---|---|---|---|
| Postgres database | RDS (db.t4g.micro, 20 GB) | Single-AZ for a demo; enable automated backups | 12-month free tier |
| `workbench-documents` | S3 | Block all public access; SSE-S3 encryption is on by default | Effectively free at demo scale |
| `workbench-jobs` + `workbench-jobs-dlq` | SQS | Same redrive policy as `scripts/localstack-init.sh` (maxReceiveCount 5, visibility 120s) | 1M requests/month always free |
| Claude model access | Bedrock | Console → Bedrock → Model access → enable Anthropic Claude models | Pay-per-token only |
| App hosting | App Runner (simplest) or ECS Fargate | Container from the Next.js standalone build; point the health check at `GET /api/health` | ~$5–15/mo smallest sizes |
| Worker | ECS Fargate service (0.25 vCPU) running `npm run worker`, or refactor the handler into an SQS-triggered Lambda | Fargate ~$9/mo; Lambda ~free at demo volume |

The SQS redrive policy in `scripts/localstack-init.sh` is the exact spec to mirror; it doubles as infrastructure documentation.

## 3. IAM policy for the app + worker

Least-privilege policy (attach to the App Runner / ECS task role):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::workbench-documents/orgs/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "sqs:SendMessage",
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes"
      ],
      "Resource": [
        "arn:aws:sqs:*:*:workbench-jobs",
        "arn:aws:sqs:*:*:workbench-jobs-dlq"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["bedrock:InvokeModel"],
      "Resource": "arn:aws:bedrock:*::foundation-model/anthropic.*"
    }
  ]
}
```

With a task role in place, **do not set** `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` — the SDK default credential chain picks up the role automatically.

## 4. Environment for production

```bash
DATABASE_URL=postgres://workbench:<password>@<rds-endpoint>:5432/workbench
SESSION_SECRET=<openssl rand -base64 48>          # store in Secrets Manager / SSM
AWS_REGION=us-east-1
# AWS_ENDPOINT_URL intentionally unset → real AWS endpoints
S3_BUCKET=workbench-documents
JOBS_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/<account-id>/workbench-jobs
AI_PROVIDER=bedrock
BEDROCK_MODEL_ID=anthropic.claude-sonnet-4-5-20250929-v1:0
NODE_ENV=production
```

Store `DATABASE_URL` and `SESSION_SECRET` in AWS Secrets Manager (App Runner and ECS both support secret env injection).

## 5. Deploy steps

```bash
# one-time
aws s3 mb s3://workbench-documents
aws sqs create-queue --queue-name workbench-jobs-dlq
aws sqs create-queue --queue-name workbench-jobs --attributes file://redrive.json

# each release (App Runner from ECR example)
docker build -t workbench .
docker tag workbench:latest <account>.dkr.ecr.us-east-1.amazonaws.com/workbench:latest
docker push <account>.dkr.ecr.us-east-1.amazonaws.com/workbench:latest
npm run db:migrate   # against RDS, from CI or a bastion
```

## 6. What changes at each layer

| Layer | Local | AWS | Code change |
|---|---|---|---|
| Postgres | Docker container :5433 | RDS | none — `DATABASE_URL` |
| S3 | LocalStack | S3 | none — endpoint var removed |
| SQS | LocalStack | SQS | none — `JOBS_QUEUE_URL` |
| LLM | `MockProvider` | `BedrockProvider` | none — `AI_PROVIDER` |
| Auth secret | .env | Secrets Manager | none |
| Logs | pretty console | CloudWatch (JSON) | none — pino already emits JSON |

## 7. Cost guardrails

- Set a **billing alarm** (Budgets → $10/month alert) before creating anything.
- RDS is the only always-on cost after free tier; stop the instance when not demoing.
- Bedrock is pay-per-token; the plan/digest prompts run ~2–4k tokens per job — cents per demo.
- Delete the App Runner service (or scale ECS to 0) between interview cycles; the data survives in RDS/S3.
