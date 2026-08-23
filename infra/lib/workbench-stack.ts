import * as cdk from "aws-cdk-lib";
import { Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as budgets from "aws-cdk-lib/aws-budgets";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sources from "aws-cdk-lib/aws-lambda-event-sources";
import { Construct } from "constructs";
import { resolve } from "node:path";

export class WorkbenchStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const documents = new s3.Bucket(this, "Documents", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [
        { abortIncompleteMultipartUploadAfter: Duration.days(7) },
        { noncurrentVersionExpiration: Duration.days(30) },
      ],
      removalPolicy: RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
    });
    const deadLetter = new sqs.Queue(this, "JobsDlq", {
      retentionPeriod: Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });
    const jobs = new sqs.Queue(this, "Jobs", {
      visibilityTimeout: Duration.seconds(720),
      receiveMessageWaitTime: Duration.seconds(20),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue: { queue: deadLetter, maxReceiveCount: 5 },
    });
    for (const queue of [deadLetter, jobs]) {
      queue.addToResourcePolicy(new iam.PolicyStatement({
        sid: "DenyInsecureTransport",
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ["sqs:*"],
        resources: [queue.queueArn],
        conditions: { Bool: { "aws:SecureTransport": "false" } },
      }));
    }

    // Keep application secrets out of the template and Lambda source. The
    // existing Secrets Manager JSON object is resolved by CloudFormation into
    // the function environment at deploy time; the app still reads the same
    // validated environment contract locally and in production.
    const runtimeSecretName =
      (this.node.tryGetContext("runtimeSecretName") as string | undefined) ??
      "enterprise-ai-workbench/runtime";
    const runtimeSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "RuntimeSecret",
      runtimeSecretName,
    );
    const aiProvider = String(this.node.tryGetContext("aiProvider") ?? "mock");
    const embeddingProvider = String(
      this.node.tryGetContext("embeddingProvider") ?? "mock",
    );
    const modelId = String(
      this.node.tryGetContext("bedrockModelId") ??
        "anthropic.claude-sonnet-4-5-20250929-v1:0",
    );
    const embeddingModelId = String(
      this.node.tryGetContext("bedrockEmbeddingModelId") ??
        "amazon.titan-embed-text-v2:0",
    );
    // New AWS accounts often start with a Lambda account concurrency quota of
    // 10. Reserved concurrency consumes that quota while AWS requires at
    // least 10 executions to remain unreserved, so keep reservations opt-in.
    // The SQS event source still limits worker fan-out for the showcase.
    const workerReservedConcurrency = readOptionalConcurrency(
      this.node.tryGetContext("workerReservedConcurrency"),
      "workerReservedConcurrency",
    );
    const demoControlReservedConcurrency = readOptionalConcurrency(
      this.node.tryGetContext("demoControlReservedConcurrency"),
      "demoControlReservedConcurrency",
    );

    const workerLogs = new logs.LogGroup(this, "WorkerLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const worker = new lambdaNodejs.NodejsFunction(this, "Worker", {
      entry: resolve(__dirname, "../../src/worker/lambda.ts"),
      projectRoot: resolve(__dirname, "../.."),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: Duration.seconds(120),
      memorySize: 1024,
      reservedConcurrentExecutions: workerReservedConcurrency,
      logGroup: workerLogs,
      environment: {
        DATABASE_URL: runtimeSecret.secretValueFromJson("DATABASE_URL").unsafeUnwrap(),
        DATABASE_ADMIN_URL: runtimeSecret.secretValueFromJson("DATABASE_ADMIN_URL").unsafeUnwrap(),
        SESSION_SECRET: runtimeSecret.secretValueFromJson("SESSION_SECRET").unsafeUnwrap(),
        APP_ENCRYPTION_KEY: runtimeSecret.secretValueFromJson("APP_ENCRYPTION_KEY").unsafeUnwrap(),
        JOBS_QUEUE_URL: jobs.queueUrl,
        S3_BUCKET: documents.bucketName,
        AI_PROVIDER: aiProvider,
        EMBEDDING_PROVIDER: embeddingProvider,
        BEDROCK_MODEL_ID: modelId,
        BEDROCK_EMBEDDING_MODEL_ID: embeddingModelId,
      },
      bundling: { minify: true, sourceMap: true, externalModules: ["pdfjs-dist"] },
    });
    jobs.grantConsumeMessages(worker);
    // Application-level retries publish a fresh delayed pointer after a
    // failed attempt, so the worker needs narrowly-scoped send permission too.
    jobs.grantSendMessages(worker);
    documents.grantReadWrite(worker);
    if (aiProvider === "bedrock" || embeddingProvider === "bedrock") {
      worker.addToRolePolicy(
        new iam.PolicyStatement({
          sid: "InvokeBedrockModels",
          actions: ["bedrock:InvokeModel"],
          resources: [
            `arn:${cdk.Aws.PARTITION}:bedrock:${cdk.Aws.REGION}::foundation-model/${modelId}`,
            `arn:${cdk.Aws.PARTITION}:bedrock:${cdk.Aws.REGION}::foundation-model/${embeddingModelId}`,
          ],
        }),
      );
    }
    worker.addEventSource(new sources.SqsEventSource(jobs, {
      batchSize: 5,
      reportBatchItemFailures: true,
      maxConcurrency: 2,
    }));

    const dispatcherLogs = new logs.LogGroup(this, "JobDispatcherLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const dispatcher = new lambdaNodejs.NodejsFunction(this, "JobDispatcher", {
      entry: resolve(__dirname, "../../src/worker/dispatchLambda.ts"),
      projectRoot: resolve(__dirname, "../.."),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: Duration.seconds(30),
      memorySize: 256,
      logGroup: dispatcherLogs,
      environment: {
        DATABASE_URL: runtimeSecret.secretValueFromJson("DATABASE_URL").unsafeUnwrap(),
        DATABASE_ADMIN_URL: runtimeSecret.secretValueFromJson("DATABASE_ADMIN_URL").unsafeUnwrap(),
        SESSION_SECRET: runtimeSecret.secretValueFromJson("SESSION_SECRET").unsafeUnwrap(),
        JOBS_QUEUE_URL: jobs.queueUrl,
        S3_BUCKET: documents.bucketName,
        AI_PROVIDER: "mock",
      },
      bundling: { minify: true, sourceMap: true },
    });
    jobs.grantSendMessages(dispatcher);
    const dispatchSchedule = new events.Rule(this, "JobDispatchSchedule", {
      schedule: events.Schedule.rate(Duration.minutes(1)),
    });
    dispatchSchedule.addTarget(new targets.LambdaFunction(dispatcher));

    const cleanupLogs = new logs.LogGroup(this, "ExpiredDemoCleanupLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const cleanup = new lambdaNodejs.NodejsFunction(this, "ExpiredDemoCleanup", {
      entry: resolve(__dirname, "../../src/worker/cleanupLambda.ts"),
      projectRoot: resolve(__dirname, "../.."),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: Duration.seconds(60),
      memorySize: 512,
      logGroup: cleanupLogs,
      environment: {
        DATABASE_URL: runtimeSecret.secretValueFromJson("DATABASE_URL").unsafeUnwrap(),
        DATABASE_ADMIN_URL: runtimeSecret.secretValueFromJson("DATABASE_ADMIN_URL").unsafeUnwrap(),
        SESSION_SECRET: runtimeSecret.secretValueFromJson("SESSION_SECRET").unsafeUnwrap(),
        JOBS_QUEUE_URL: jobs.queueUrl,
        S3_BUCKET: documents.bucketName,
        AI_PROVIDER: "mock",
      },
      bundling: { minify: true, sourceMap: true, externalModules: ["pdfjs-dist"] },
    });
    documents.grantRead(cleanup);
    documents.grantDelete(cleanup);
    const schedule = new events.Rule(this, "DemoCleanupSchedule", {
      schedule: events.Schedule.rate(Duration.hours(1)),
    });
    schedule.addTarget(new targets.LambdaFunction(cleanup));

    // The Vercel web runtime never receives DATABASE_ADMIN_URL. Demo session
    // creation, reset, persona switching, and quota accounting call this
    // narrowly-scoped function instead, while the trusted worker retains the
    // admin connection for background processing.
    const demoControlLogs = new logs.LogGroup(this, "DemoControlLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const demoControl = new lambdaNodejs.NodejsFunction(this, "DemoControl", {
      entry: resolve(__dirname, "../../src/worker/demoControlLambda.ts"),
      projectRoot: resolve(__dirname, "../.."),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: Duration.seconds(120),
      memorySize: 1024,
      reservedConcurrentExecutions: demoControlReservedConcurrency,
      logGroup: demoControlLogs,
      environment: {
        DATABASE_URL: runtimeSecret.secretValueFromJson("DATABASE_URL").unsafeUnwrap(),
        DATABASE_ADMIN_URL: runtimeSecret.secretValueFromJson("DATABASE_ADMIN_URL").unsafeUnwrap(),
        SESSION_SECRET: runtimeSecret.secretValueFromJson("SESSION_SECRET").unsafeUnwrap(),
        APP_ENCRYPTION_KEY: runtimeSecret.secretValueFromJson("APP_ENCRYPTION_KEY").unsafeUnwrap(),
        JOBS_QUEUE_URL: jobs.queueUrl,
        S3_BUCKET: documents.bucketName,
        AI_PROVIDER: "mock",
        EMBEDDING_PROVIDER: "mock",
        WORKBENCH_ENV_MODE: "showcase",
        DEMO_MAX_GENERATION_JOBS: String(this.node.tryGetContext("demoMaxGenerationJobs") ?? 1),
        DEMO_MAX_DAILY_SPEND_USD: String(this.node.tryGetContext("demoMaxDailySpendUsd") ?? 1),
        DEMO_MAX_MONTHLY_SPEND_USD: String(this.node.tryGetContext("demoMaxMonthlySpendUsd") ?? 15),
      },
      bundling: { minify: true, sourceMap: true, externalModules: ["pdfjs-dist"] },
    });
    documents.grantReadWrite(demoControl);

    new cloudwatch.Alarm(this, "QueueAgeAlarm", {
      metric: jobs.metricApproximateAgeOfOldestMessage({ period: Duration.minutes(5), statistic: "Maximum" }),
      threshold: 600,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });
    new cloudwatch.Alarm(this, "DeadLetterAlarm", {
      metric: deadLetter.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(5), statistic: "Maximum" }),
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });
    new cloudwatch.Alarm(this, "WorkerErrorAlarm", {
      metric: worker.metricErrors({ period: Duration.minutes(5), statistic: "Sum" }),
      threshold: 1,
      evaluationPeriods: 1,
    });

    const budgetEmail = this.node.tryGetContext("budgetEmail") as string | undefined;
    new budgets.CfnBudget(this, "MonthlyBudget", {
      budget: {
        budgetLimit: { amount: Number(this.node.tryGetContext("budgetUsd") ?? 15), unit: "USD" },
        budgetName: "enterprise-ai-workbench-monthly",
        budgetType: "COST",
        timeUnit: "MONTHLY",
      },
      notificationsWithSubscribers: budgetEmail
        ? [50, 80, 100].map((threshold) => ({
            notification: { comparisonOperator: "GREATER_THAN", notificationType: "FORECASTED", threshold, thresholdType: "PERCENTAGE" },
            subscribers: [{ address: budgetEmail, subscriptionType: "EMAIL" }],
          }))
        : undefined,
    });

    this.addVercelOidcRoles(documents, jobs, demoControl);
    // These acknowledgements are intentionally narrow and documented: S3
    // access logging is delegated to CloudTrail in the reference deployment;
    // Lambda's AWS-managed basic execution policy is the platform baseline;
    // and CDK's grant helpers emit constrained bucket-object wildcards.
    cdk.Validations.of(documents).acknowledge({
      id: "AwsSolutions::AwsSolutions-S1",
      reason: "CloudTrail data events provide the request trail in the reference deployment; the bucket remains private and encrypted.",
    });
    for (const fn of [worker, dispatcher, cleanup, demoControl]) {
      cdk.Validations.of(fn).acknowledge({
        id: "AwsSolutions::AwsSolutions-IAM4",
        reason: "AWSLambdaBasicExecutionRole is the AWS-managed minimum needed for Lambda log delivery; application permissions are inline and resource-scoped.",
      });
      cdk.Validations.of(fn).acknowledge({
        id: "AwsSolutions::AwsSolutions-IAM5",
        reason: "CDK grant helpers emit object-operation wildcards constrained to the Workbench bucket ARN; no public or cross-bucket resource is granted.",
      });
      cdk.Validations.of(fn).acknowledge({
        id: "AwsSolutions::AwsSolutions-L1",
        reason: "Node.js 22 is the pinned supported runtime for this release and is upgraded through the normal dependency/release gate.",
      });
    }
    // cdk-nag 3 reports IAM wildcard findings with a bracketed, granular rule
    // id. CDK's public acknowledgement helper intentionally rejects the
    // nested `::` in those ids, so retain the exact audit keys as construct
    // metadata for the plugin to consume.
    this.node.addMetadata(cdk.Validations.ACKNOWLEDGED_RULES_METADATA_KEY, {
      "AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]": "AWS Lambda basic execution policy is the platform minimum; application grants remain inline and scoped.",
      "AwsSolutions-IAM5[Action::s3:GetObject*]": "Generated object-read operations are constrained to the private Workbench bucket.",
      "AwsSolutions-IAM5[Action::s3:GetBucket*]": "Generated bucket metadata operations are constrained to the private Workbench bucket.",
      "AwsSolutions-IAM5[Action::s3:List*]": "Generated list operations are constrained to the private Workbench bucket.",
      "AwsSolutions-IAM5[Action::s3:DeleteObject*]": "Generated object-delete operations are constrained to the private Workbench bucket.",
      "AwsSolutions-IAM5[Action::s3:Abort*]": "Generated multipart-abort operations are constrained to the private Workbench bucket.",
      "AwsSolutions-IAM5[Resource::<Documents7E5B2978.Arn>/*]": "Object wildcards are limited to the private Workbench bucket; no public or cross-bucket resource is granted.",
      "AwsSolutions-IAM5[Resource::*]": "The deployment role only calls CloudFormation DescribeStacks; the AWS API requires a wildcard resource for this read-only action.",
      "AwsSolutions-IAM5[Resource::<Documents7E5B2978.Arn>/orgs/*]": "The Vercel runtime role is constrained to tenant-prefixed objects inside the private Workbench bucket.",
    });
    new cdk.CfnOutput(this, "DocumentsBucketName", { value: documents.bucketName });
    new cdk.CfnOutput(this, "JobsQueueUrl", { value: jobs.queueUrl });
    new cdk.CfnOutput(this, "JobsDlqUrl", { value: deadLetter.queueUrl });
    new cdk.CfnOutput(this, "DemoControlFunctionArn", { value: demoControl.functionArn });
  }

  private addVercelOidcRoles(
    documents: s3.Bucket,
    jobs: sqs.Queue,
    demoControl: lambda.IFunction,
  ): void {
    const teamSlug = this.node.tryGetContext("vercelTeamSlug") as string | undefined;
    if (!teamSlug) return;
    const project = String(
      this.node.tryGetContext("vercelProject") ??
        "enterprise-ai-implementation-workbench",
    );
    const issuer = `https://oidc.vercel.com/${teamSlug}`;
    const audience = `https://vercel.com/${teamSlug}`;
    const claims = {
      [`oidc.vercel.com/${teamSlug}:aud`]: audience,
      [`oidc.vercel.com/${teamSlug}:sub`]: `owner:${teamSlug}:project:${project}:environment:production`,
    };
    const provider = new iam.OpenIdConnectProvider(this, "VercelOidc", {
      url: issuer,
      clientIds: [audience],
    });
    new iam.Role(this, "VercelDeployRole", {
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, { StringEquals: claims }),
      inlinePolicies: {
        DeployOnly: new iam.PolicyDocument({ statements: [new iam.PolicyStatement({
          actions: ["cloudformation:DescribeStacks"],
          resources: ["*"],
        })] }),
      },
    });
    const runtimeRole = new iam.Role(this, "VercelRuntimeRole", {
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, { StringEquals: claims }),
      inlinePolicies: {
        RuntimeOnly: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ["s3:GetObject", "s3:PutObject", "s3:AbortMultipartUpload"],
              resources: [documents.bucketArn + "/orgs/*"],
            }),
            new iam.PolicyStatement({
              actions: ["sqs:SendMessage", "sqs:GetQueueAttributes"],
              resources: [jobs.queueArn],
            }),
            new iam.PolicyStatement({
              actions: ["lambda:InvokeFunction"],
              resources: [demoControl.functionArn],
            }),
          ],
        }),
      },
    });
    new cdk.CfnOutput(this, "VercelRuntimeRoleArn", {
      value: runtimeRole.roleArn,
    });
  }
}

function readOptionalConcurrency(value: unknown, contextKey: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${contextKey} must be a non-negative integer when provided`);
  }
  return parsed;
}
