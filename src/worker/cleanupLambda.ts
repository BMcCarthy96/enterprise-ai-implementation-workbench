import { cleanupExpiredDemoWorkspaces } from "@/server/services/demo";

/** Hourly cleanup entry point for expired isolated demo workspaces. */
export async function handler(): Promise<{ cleaned: number }> {
  const cleaned = await cleanupExpiredDemoWorkspaces();
  console.log(JSON.stringify({ cleaned, action: "demo_workspace_cleanup" }));
  return { cleaned };
}
