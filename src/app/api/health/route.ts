import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { GetQueueAttributesCommand } from "@aws-sdk/client-sqs";
import { db } from "@/db";
import { sqsClient } from "@/lib/aws/clients";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Liveness/readiness probe for container orchestration (App Runner health
 * check path, ECS/ALB target group, or `docker healthcheck`). Reports each
 * dependency independently so a degraded queue is distinguishable from a
 * degraded database. Public — exposes status only, never data.
 */
async function check(fn: () => Promise<void>) {
  const started = Date.now();
  try {
    await fn();
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function GET() {
  const [database, queue] = await Promise.all([
    check(async () => {
      await db.execute(sql`select 1`);
    }),
    check(async () => {
      await sqsClient().send(
        new GetQueueAttributesCommand({
          QueueUrl: env().JOBS_QUEUE_URL,
          AttributeNames: ["ApproximateNumberOfMessages"],
        }),
      );
    }),
  ]);

  const healthy = database.ok && queue.ok;
  return NextResponse.json(
    {
      status: healthy ? "healthy" : "degraded",
      checks: { database, queue },
      timestamp: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 },
  );
}
