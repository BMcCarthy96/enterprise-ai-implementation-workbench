# Public showcase deployment

This is the path for the public interactive demo. It keeps the Next.js app on
Vercel, the database on Neon, and the worker services in AWS. The public demo
uses the deterministic mock provider so a visitor can run the flow without
waiting for model capacity or creating a model bill. The same worker can use
Bedrock in a private environment by changing the CDK context values.

## Service layout

| Service | What it does | Public exposure |
| --- | --- | --- |
| Vercel | Next.js UI and API routes | HTTPS application URL |
| Neon | Postgres and pgvector | Pooled runtime URL plus direct admin URL |
| S3 | Private document storage | Never public; accessed through signed requests |
| SQS + Lambda | Durable generation jobs and retries | No public endpoint |
| Demo control Lambda | Creates and resets isolated demo workspaces | Invoked only by the Vercel role |

The Vercel runtime gets a short-lived AWS role through Vercel OIDC. It does not
receive `DATABASE_ADMIN_URL`. Admin-only demo seeding, reset, persona switching,
and quota accounting happen in the control Lambda.

## One-time setup

Create the AWS and Neon accounts yourself, then sign in to the tools you use
for deployment. Account creation and billing details must stay in your hands.

1. Create a Neon project in the same region family as the AWS stack and enable
   `vector`. Keep the owner role for migrations. Create a separate login role
   named `workbench_runtime`, then copy a pooled connection string that uses
   that role for `DATABASE_URL`. Copy the owner role's direct connection string
   for `DATABASE_ADMIN_URL`. Do not use the owner connection in Vercel or the
   worker runtime.
2. Create an AWS account with MFA. Configure a GitHub Actions OIDC deploy role.
   The role only needs permission to deploy this CDK stack.
3. Create a Secrets Manager JSON value named
   `enterprise-ai-workbench/runtime`:

   ```json
   {
     "DATABASE_URL": "postgres://runtime:<password>@<pooled-host>/workbench?sslmode=require",
     "DATABASE_ADMIN_URL": "postgres://admin:<password>@<direct-host>/workbench?sslmode=require",
     "SESSION_SECRET": "<random value at least 32 characters>",
     "APP_ENCRYPTION_KEY": "<separate random key at least 32 characters>"
   }
   ```

4. Create a Vercel project from the GitHub repository
   `BMcCarthy96/enterprise-ai-implementation-workbench`. Use the `main` branch
   and the Next.js framework preset.
5. Keep production-only values in Vercel Project Settings → Environment
   Variables. Do not add long-lived AWS access keys.

## Deploy the AWS side

The manual GitHub workflow is the repeatable path. Set these GitHub environment
values first:

- `AWS_DEPLOY_ROLE_ARN` secret
- `DATABASE_ADMIN_URL` secret, used only for the migration step
- `SHOWCASE_BASE_URL` variable after the first Vercel deployment

Dispatch **Deploy AWS infrastructure** with:

```text
aws-region: us-east-1
runtime-secret-name: enterprise-ai-workbench/runtime
budget-email: your alert address
ai-provider: mock
embedding-provider: mock
vercel-team-slug: bmccarthy96s-projects
vercel-project: enterprise-ai-implementation-workbench
runtime-role: workbench_runtime
```

The workflow confirms that `workbench_runtime` exists, grants the tables the
application needs, and forces RLS on every policy-enabled table. It stops
before deploying if the role is missing or can bypass RLS.

The stack outputs `DocumentsBucketName`, `JobsQueueUrl`,
`DemoControlFunctionArn`, and `VercelRuntimeRoleArn`. Keep those values for the
Vercel setup. The workflow runs migrations before it reports success.

The AWS workflow does not publish the Next.js site. Vercel builds the `main`
branch separately, so run the **Public showcase smoke** workflow after each
production Vercel deployment. Set the repository variable
`SHOWCASE_BASE_URL` or pass `base_url` when dispatching it. A green AWS run
proves the infrastructure and database gates; the hosted smoke is the check
that proves the public link works.

## Configure Vercel

Set these production environment variables. Values marked `from CDK output`
come from the AWS deployment:

```text
DATABASE_URL=<Neon pooled URL for workbench_runtime>
SESSION_SECRET=<same value as the runtime secret>
APP_ENCRYPTION_KEY=<same value as the runtime secret>
AWS_REGION=us-east-1
AWS_ROLE_ARN=<VercelRuntimeRoleArn from CDK output>
AWS_OIDC_AUDIENCE=https://vercel.com/bmccarthy96s-projects
S3_BUCKET=<DocumentsBucketName from CDK output>
JOBS_QUEUE_URL=<JobsQueueUrl from CDK output>
DEMO_CONTROL_FUNCTION_ARN=<DemoControlFunctionArn from CDK output>
AI_PROVIDER=mock
EMBEDDING_PROVIDER=mock
WORKBENCH_ENV_MODE=showcase
DEMO_MAX_GENERATION_JOBS=2
DEMO_MAX_ACTIVE_WORKSPACES=20
DEMO_MAX_ACTIVE_PER_NETWORK=4
DEMO_MAX_DAILY_SPEND_USD=1
DEMO_MAX_MONTHLY_SPEND_USD=15
NODE_ENV=production
```

Leave `DATABASE_ADMIN_URL` out of Vercel. Leave
`AWS_ENDPOINT_URL`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY` out as
well. Redeploy after saving the variables.

In Vercel, set production deployments to build from `main`. Add a small WAF
rate limit for `/api/demo/*` and `/api/v1/*`, then set the project’s spend and
error alerts. Keep the project on a plan that allows the route’s 60-second
function budget; creating or resetting a seeded workspace includes a cold
Lambda invocation and several database writes. The app also enforces a
workspace cap, two plan generations per browser visitor, a separate network
backstop, and an expiry window
in the database. A private HttpOnly visitor cookie keeps separate browsers on
the same network from sharing a generation quota; the network address remains
part of the key as a coarse abuse backstop.

## Verify the public URL

After the first deployment, open:

```text
https://<your-vercel-domain>/demo?checkpoint=portfolio-health
```

The URL should create an isolated workspace without a password, open the
dashboard, and show the guided walkthrough. Run the hosted smoke workflow with
that base URL. It checks the demo entry, persona switch, protected project
route, health endpoint, and the full generate → approve → materialize path.

The link to place on a resume is the `/demo?checkpoint=portfolio-health` URL.
Keep the GitHub repository link beside it so visitors can choose between a
quick tour and the implementation details.

## Rollback and cleanup

Vercel can roll back to the prior production deployment from the Deployments
tab. If an AWS release is unhealthy, stop the public Vercel deployment first,
then roll back the CDK stack to the previous known-good commit. Do not delete
the S3 bucket during a normal rollback; it is retained by design. The hourly
cleanup Lambda removes expired demo organizations and their exact object
prefixes.
