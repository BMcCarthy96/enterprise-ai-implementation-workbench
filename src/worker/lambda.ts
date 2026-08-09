/**
 * SQS-triggered Lambda adapter. The DB row remains the source of truth and
 * processJob owns application retries; only infrastructure-level failures are
 * returned to Lambda for partial-batch redelivery.
 */
interface SqsRecord {
  messageId: string;
  body?: string;
}

interface SqsEvent {
  Records: SqsRecord[];
}

export interface SqsBatchResponse {
  batchItemFailures: Array<{ itemIdentifier: string }>;
}

export async function handler(event: SqsEvent): Promise<SqsBatchResponse> {
  const { processJob } = await import("./index");
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];
  for (const record of event.Records ?? []) {
    if (!record.body) continue;
    let jobId: string | undefined;
    try {
      const parsed = JSON.parse(record.body) as { jobId?: unknown };
      jobId = typeof parsed.jobId === "string" ? parsed.jobId : undefined;
    } catch {
      // Malformed messages are intentionally dropped; SQS DLQ is for transport
      // failures, not a permanently invalid application payload.
      continue;
    }
    if (!jobId) continue;
    try {
      await processJob(jobId);
    } catch {
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}
