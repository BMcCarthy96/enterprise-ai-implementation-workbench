#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";
import { WorkbenchStack } from "../lib/workbench-stack";

const app = new cdk.App();
cdk.Validations.of(app).addPlugins(new AwsSolutionsChecks(app, { verbose: true }));
new WorkbenchStack(app, "EnterpriseAiImplementationWorkbench", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? app.node.tryGetContext("region") ?? "us-east-1",
  },
});
