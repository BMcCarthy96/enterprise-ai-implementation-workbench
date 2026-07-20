import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  type Message,
} from "@aws-sdk/client-sqs";
import { sqsClient } from "./clients";
import { env } from "@/lib/env";

export interface JobMessage {
  jobId: string;
}

/**
 * Enqueue a job pointer. The SQS message carries only the job id — all state
 * (payload, attempts, errors) lives in Postgres, so messages are cheap to
 * redeliver and the DB row is the single source of truth for observability.
 */
export async function enqueueJob(
  jobId: string,
  delaySeconds = 0,
): Promise<void> {
  await sqsClient().send(
    new SendMessageCommand({
      QueueUrl: env().JOBS_QUEUE_URL,
      MessageBody: JSON.stringify({ jobId } satisfies JobMessage),
      DelaySeconds: Math.min(delaySeconds, 900),
    }),
  );
}

/** Long-poll for up to `waitSeconds`; returns [] on timeout. */
export async function receiveJobs(waitSeconds = 10): Promise<Message[]> {
  const res = await sqsClient().send(
    new ReceiveMessageCommand({
      QueueUrl: env().JOBS_QUEUE_URL,
      MaxNumberOfMessages: 5,
      WaitTimeSeconds: waitSeconds,
    }),
  );
  return res.Messages ?? [];
}

export async function deleteMessage(receiptHandle: string): Promise<void> {
  await sqsClient().send(
    new DeleteMessageCommand({
      QueueUrl: env().JOBS_QUEUE_URL,
      ReceiptHandle: receiptHandle,
    }),
  );
}
