import {
  dispatchUndeliveredJobs,
  reclaimExpiredJobs,
} from "@/server/services/jobs";
import { reconcileRegenerationIntents } from "@/server/services/approvals";

/**
 * Scheduled safety net for committed jobs whose initial SQS publish failed,
 * expired worker leases, and rejection regeneration intents left by a web
 * request that died after its database commit.
 */
export async function handler(): Promise<{
  attempted: number;
  dispatched: number;
  reclaimed: number;
  regenerated: number;
}> {
  const reclaimed = await reclaimExpiredJobs(100);
  const result = await dispatchUndeliveredJobs(100);
  const regenerated = await reconcileRegenerationIntents(100);
  const summary = { ...result, reclaimed, regenerated, action: "job_dispatch_reconciliation" };
  console.log(JSON.stringify(summary));
  return summary;
}
