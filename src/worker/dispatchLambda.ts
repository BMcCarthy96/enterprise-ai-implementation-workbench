import { dispatchUndeliveredJobs } from "@/server/services/jobs";

/** Scheduled safety net for committed jobs whose initial SQS publish failed. */
export async function handler(): Promise<{ attempted: number; dispatched: number }> {
  const result = await dispatchUndeliveredJobs(100);
  console.log(JSON.stringify({ ...result, action: "job_dispatch_reconciliation" }));
  return result;
}
