#!/bin/bash
# Provisions the AWS resources the workbench expects. Runs inside LocalStack on
# container ready. Mirrors what Terraform/CDK would create in a real account.
set -euo pipefail

awslocal s3 mb s3://workbench-documents || true

# Dead-letter queue first so the main queue can reference it.
awslocal sqs create-queue --queue-name workbench-jobs-dlq
DLQ_ARN=$(awslocal sqs get-queue-attributes \
  --queue-url http://localhost:4566/000000000000/workbench-jobs-dlq \
  --attribute-names QueueArn --query 'Attributes.QueueArn' --output text)

awslocal sqs create-queue --queue-name workbench-jobs \
  --attributes "{\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"${DLQ_ARN}\\\",\\\"maxReceiveCount\\\":\\\"5\\\"}\",\"VisibilityTimeout\":\"120\"}"

echo "workbench: S3 bucket + SQS queues ready"
