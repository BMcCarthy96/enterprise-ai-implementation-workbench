export type DeploymentMode = "local" | "showcase" | "interview";

function deploymentMode(value: string | undefined): DeploymentMode {
  return value === "showcase" || value === "interview" ? value : "local";
}

function databaseMode(value: string | undefined): "postgres" | "neon" | "aurora" | "unknown" {
  const normalized = value?.toLowerCase() ?? "";
  if (normalized.includes("neon")) return "neon";
  if (normalized.includes("aurora")) return "aurora";
  if (normalized.startsWith("postgres")) return "postgres";
  return "unknown";
}

/** Public-safe release metadata. Never include URLs, credentials, or tenant data here. */
export function getBuildMetadata() {
  return {
    schemaVersion: "1.0",
    deploymentMode: deploymentMode(process.env.WORKBENCH_ENV_MODE),
    providerMode: process.env.AI_PROVIDER === "bedrock" || process.env.AI_PROVIDER === "anthropic" ? process.env.AI_PROVIDER : "mock",
    databaseMode: databaseMode(process.env.DATABASE_URL),
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? "local",
    buildTime: process.env.BUILD_TIME ?? null,
    evidenceVersion: "proof-manifest-v1",
  } as const;
}
