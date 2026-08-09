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
      reservedConcurrentExecutions: 2,
      logGroup: workerLogs,
      environment: {
        DATABASE_URL: runtimeSecret.secretValueFromJson("DATABASE_URL").unsafeUnwrap(),
        DATABASE_ADMIN_URL: runtimeSecret.secretValueFromJson("DATABASE_ADMIN_URL").unsafeUnwrap(),
        SESSION_SECRET: runtimeSecret.secretValueFromJson("SESSION_SECRET").unsafeUnwrap(),
        JOBS_QUEUE_URL: jobs.queueUrl,
        S3_BUCKET: documents.bucketName,
        AI_PROVIDER: "bedrock",
        EMBEDDING_PROVIDER: "bedrock",
        BEDROCK_MODEL_ID: "anthropic.claude-sonnet-4-5-20250929-v1:0",
        BEDROCK_EMBEDDING_MODEL_ID: "amazon.titan-embed-text-v2:0",
      },
      bundling: { minify: true, sourceMap: true, externalModules: ["pdfjs-dist"] },
    });
    jobs.grantConsumeMessages(worker);
    // Application-level retries publish a fresh delayed pointer after a
    // failed attempt, so the worker needs narrowly-scoped send permission too.
    jobs.grantSendMessages(worker);
    documents.grantReadWrite(worker);
    worker.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "InvokeBedrockModels",
        actions: ["bedrock:InvokeModel"],
        resources: [
          `arn:${cdk.Aws.PARTITION}:bedrock:${cdk.Aws.REGION}::foundation-model/anthropic.claude-sonnet-4-5-20250929-v1:0`,
          `arn:${cdk.Aws.PARTITION}:bedrock:${cdk.Aws.REGION}::foundation-model/amazon.titan-embed-text-v2:0`,
        ],
      }),
    );
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

    this.addVercelOidcRole();
    new cdk.CfnOutput(this, "DocumentsBucketName", { value: documents.bucketName });
    new cdk.CfnOutput(this, "JobsQueueUrl", { value: jobs.queueUrl });
    new cdk.CfnOutput(this, "JobsDlqUrl", { value: deadLetter.queueUrl });
  }

  private addVercelOidcRole(): void {
    const teamId = this.node.tryGetContext("vercelTeamId") as string | undefined;
    if (!teamId) return;
    const provider = new iam.OpenIdConnectProvider(this, "VercelOidc", {
      url: "https://oidc.vercel.com",
      clientIds: [`https://vercel.com/${teamId}`],
    });
    new iam.Role(this, "VercelDeployRole", {
      assumedBy: new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: {
          "oidc.vercel.com:aud": `https://vercel.com/${teamId}`,
          "oidc.vercel.com:sub": `team:${teamId}:project:${this.node.tryGetContext("vercelProject") ?? "enterprise-ai-implementation-workbench"}:environment:production`,
        },
      }),
      inlinePolicies: {
        DeployOnly: new iam.PolicyDocument({ statements: [new iam.PolicyStatement({
          actions: ["cloudformation:DescribeStacks", "s3:GetObject", "s3:PutObject"],
          resources: ["*"],
        })] }),
      },
    });
  }
}
