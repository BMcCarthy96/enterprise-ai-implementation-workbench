import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { env } from "@/lib/env";

/**
 * Shared AWS SDK v3 client configuration.
 *
 * Locally, AWS_ENDPOINT_URL points every client at LocalStack; in a real
 * account the variable is simply absent and the SDK resolves regional
 * endpoints + IAM credentials on its own. That single toggle is the entire
 * local/cloud switch.
 */
function baseConfig() {
  const e = env();
  return {
    region: e.AWS_REGION,
    ...(e.AWS_ENDPOINT_URL ? { endpoint: e.AWS_ENDPOINT_URL } : {}),
  };
}

let s3: S3Client | undefined;
let sqs: SQSClient | undefined;
let bedrock: BedrockRuntimeClient | undefined;

export function s3Client(): S3Client {
  if (!s3) {
    // forcePathStyle is required for LocalStack; harmless against real S3.
    s3 = new S3Client({ ...baseConfig(), forcePathStyle: true });
  }
  return s3;
}

export function sqsClient(): SQSClient {
  if (!sqs) sqs = new SQSClient(baseConfig());
  return sqs;
}

export function bedrockClient(): BedrockRuntimeClient {
  if (!bedrock) {
    // Bedrock is not emulated by LocalStack: always use the real regional
    // endpoint. AI_PROVIDER=mock covers offline development instead.
    bedrock = new BedrockRuntimeClient({ region: env().AWS_REGION });
  }
  return bedrock;
}
