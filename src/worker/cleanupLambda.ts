import { cleanupExpiredDemoWorkspaces } from "@/server/services/demo";
import { runRetentionForAllOrganizations } from "@/server/services/retention";

/** Hourly cleanup entry point for expired isolated demo workspaces. */
export async function handler(): Promise<{ cleaned: number; retention: { attempted: number; succeeded: number } }> {
  const cleaned = await cleanupExpiredDemoWorkspaces();
  const retention = await runRetentionForAllOrganizations();
  console.log(JSON.stringify({ cleaned, retention, action: "demo_workspace_and_retention_cleanup" }));
  return { cleaned, retention };
}
