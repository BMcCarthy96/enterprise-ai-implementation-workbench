import { z } from "zod";

/**
 * All process.env access goes through this module so a misconfigured
 * deployment fails at boot with a readable error, not at first request.
 */
const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  AWS_REGION: z.string().default("us-east-1"),
  AWS_ENDPOINT_URL: z.string().url().optional(),
  S3_BUCKET: z.string().min(1),
  JOBS_QUEUE_URL: z.string().url(),
  AI_PROVIDER: z.enum(["mock", "bedrock"]).default("mock"),
  BEDROCK_MODEL_ID: z
    .string()
    .default("anthropic.claude-sonnet-4-5-20250929-v1:0"),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error"])
    .default("info"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) {
      const details = parsed.error.issues
        .map((i) => `  ${i.path.join(".")}: ${i.message}`)
        .join("\n");
      throw new Error(`Invalid environment configuration:\n${details}`);
    }
    cached = parsed.data;
  }
  return cached;
}
