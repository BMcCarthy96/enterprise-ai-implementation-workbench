import { createHash } from "node:crypto";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { db, dbAdmin, schema } from "@/db";
import { deletePrefix, documentKey, putObject } from "@/lib/aws/s3";
import { embeddingProvider, mockEmbedding } from "@/lib/ai/embeddings";
import { ApiError } from "@/lib/api";
import { hashPassword } from "@/lib/auth/password";
import { createSessionToken, type SessionPayload } from "@/lib/auth/session";

export const DEMO_TTL_SECONDS = 60 * 60;
export const DEMO_MAX_ACTIVE = 20;
const DEMO_MAX_DAILY_SPEND_USD = 1;
const DEMO_MAX_MONTHLY_SPEND_USD = 8;
export const DEMO_ESTIMATED_RESERVATION_USD = 0.05;

export function hashDemoIp(ip: string): string {
  return createHash("sha256")
    .update(`${process.env.SESSION_SECRET ?? "demo"}:${ip}`)
    .digest("hex");
}

export function clientIp(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headers.get("x-real-ip") ??
    "unknown"
  );
}

export async function createDemoWorkspace(ip: string): Promise<{
  workspace: typeof schema.demoWorkspaces.$inferSelect;
  token: string;
}> {
  const ipHash = hashDemoIp(ip);
  const now = new Date();
  const existing = await dbAdmin.query.demoWorkspaces.findFirst({
    where: and(eq(schema.demoWorkspaces.ipHash, ipHash), gt(schema.demoWorkspaces.expiresAt, now)),
  });
  if (existing) return issueDemoSession(existing);

  const active = await dbAdmin.$count(
    schema.demoWorkspaces,
    gt(schema.demoWorkspaces.expiresAt, now),
  );
  if (active >= DEMO_MAX_ACTIVE) {
    throw new ApiError(429, "Interactive demo capacity is full; try again shortly", "DEMO_LIMIT_REACHED");
  }

  const expiresAt = new Date(now.getTime() + DEMO_TTL_SECONDS * 1000);
  const suffix = crypto.randomUUID().slice(0, 8);
  const orgId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const customerId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const requirementIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const passwordHash = await hashPassword(crypto.randomUUID());
  const documentText = `# Order intake implementation brief

The customer wants a controlled order intake workflow for approved source systems. Carrier assignment must happen before an exception is opened. Unresolved orders should route to a review queue, and the implementation manager must approve the launch plan before delivery tasks are created.`;
  const documentBuffer = Buffer.from(documentText, "utf8");
  const s3Key = documentKey(orgId, projectId, "order-intake-brief.md", documentId);
  const embeddingResult =
    process.env.EMBEDDING_PROVIDER === "bedrock"
      ? await (await embeddingProvider()).embed(documentText)
      : null;
  const embedding = embeddingResult?.vector ?? mockEmbedding(documentText);

  try {
    await putObject(s3Key, documentBuffer, "text/markdown");
    const workspace = await dbAdmin.transaction(async (tx) => {
      await tx.insert(schema.organizations).values({
        id: orgId,
        name: `Enterprise AI Demo · ${suffix}`,
        slug: `demo-${suffix}`,
      });
      await tx.insert(schema.users).values({
        id: userId,
        email: `demo-${suffix}@demo.workbench.local`,
        name: "Demo Implementation Manager",
        passwordHash,
      });
      await tx.insert(schema.memberships).values({ orgId, userId, role: "implementation_manager" });
      await tx.insert(schema.demoWorkspaces).values({ orgId, userId, ipHash, expiresAt });
      await tx.insert(schema.customers).values({
        id: customerId,
        orgId,
        name: "Brightlane Logistics (demo)",
        industry: "Logistics",
      });
      await tx.insert(schema.projects).values({
        id: projectId,
        orgId,
        customerId,
        name: "Order Intake Automation",
        description: "A synthetic, grounded implementation project for the recruiter walkthrough.",
        status: "planning",
        targetDate: new Date("2026-10-30T00:00:00Z"),
        createdBy: userId,
      });
      await tx.insert(schema.requirements).values([
        {
          id: requirementIds[0],
          orgId,
          projectId,
          title: "Structured order intake",
          details: "Capture order details from approved sources.",
          priority: "high",
          createdBy: userId,
        },
        {
          id: requirementIds[1],
          orgId,
          projectId,
          title: "Carrier assignment",
          details: "Assign a carrier before an exception is opened.",
          priority: "critical",
          createdBy: userId,
        },
        {
          id: requirementIds[2],
          orgId,
          projectId,
          title: "Exception queue",
          details: "Route unresolved orders to a review queue.",
          priority: "high",
          createdBy: userId,
        },
      ]);
      await tx.insert(schema.documents).values({
        id: documentId,
        orgId,
        projectId,
        fileName: "order-intake-brief.md",
        contentType: "text/markdown",
        sizeBytes: documentBuffer.byteLength,
        s3Key,
        status: "ready",
        sha256: createHash("sha256").update(documentBuffer).digest("hex"),
        processedAt: new Date(),
        uploadedBy: userId,
      });
      await tx.insert(schema.documentChunks).values({
        orgId,
        projectId,
        documentId,
        chunkIndex: 0,
        content: documentText,
        contentHash: createHash("sha256").update(documentText).digest("hex"),
        heading: "Order intake implementation brief",
        tokenCount: documentText.split(/\s+/).length,
        embedding,
      });
      await tx.insert(schema.auditEvents).values({
        orgId,
        actorId: userId,
        action: "demo.workspace_seeded",
        subjectType: "project",
        subjectId: projectId,
        projectId,
        metadata: { documentId, synthetic: true },
      });
      const [row] = await tx
        .select()
        .from(schema.demoWorkspaces)
        .where(eq(schema.demoWorkspaces.orgId, orgId));
      return row;
    });
    return issueDemoSession(workspace);
  } catch (error) {
    await deletePrefix(`orgs/${orgId}/`).catch(() => undefined);
    await dbAdmin
      .delete(schema.organizations)
      .where(eq(schema.organizations.id, orgId))
      .catch(() => undefined);
    throw error;
  }
}

async function issueDemoSession(workspace: typeof schema.demoWorkspaces.$inferSelect) {
  const org = await dbAdmin.query.organizations.findFirst({ where: eq(schema.organizations.id, workspace.orgId) });
  const user = await dbAdmin.query.users.findFirst({ where: eq(schema.users.id, workspace.userId) });
  if (!org || !user) throw new ApiError(503, "Demo workspace is unavailable", "DEMO_UNAVAILABLE");
  const payload: SessionPayload = {
    userId: user.id,
    email: user.email,
    name: user.name,
    orgId: org.id,
    orgName: org.name,
    role: "implementation_manager",
    demoWorkspaceId: workspace.id,
    demoExpiresAt: workspace.expiresAt.toISOString(),
  };
  return { workspace, token: await createSessionToken(payload, DEMO_TTL_SECONDS) };
}

export async function reserveDemoGeneration(input: { orgId: string; userId: string }): Promise<number> {
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  await dbAdmin.transaction(async (tx) => {
    // One transaction-wide advisory lock serializes the global demo circuit
    // breaker across different workspaces, not just concurrent calls from the
    // same visitor.
    await tx.execute(sql`select pg_advisory_xact_lock(1473298612)`);
    await tx.execute(
      sql`select id from ${schema.demoWorkspaces} where ${schema.demoWorkspaces.orgId} = ${input.orgId} for update`,
    );
    const workspace = await tx.query.demoWorkspaces.findFirst({
      where: and(
        eq(schema.demoWorkspaces.orgId, input.orgId),
        eq(schema.demoWorkspaces.userId, input.userId),
        gt(schema.demoWorkspaces.expiresAt, new Date()),
      ),
    });
    if (!workspace) {
      throw new ApiError(429, "Demo generation quota reached", "DEMO_LIMIT_REACHED");
    }
    const [spend] = await tx
      .select({
        day: sql<number>`coalesce(sum(case when ${schema.aiRuns.createdAt} >= ${dayStart} then coalesce(${schema.aiRuns.costUsd}, 0) else 0 end), 0)`,
        month: sql<number>`coalesce(sum(case when ${schema.aiRuns.createdAt} >= ${monthStart} then coalesce(${schema.aiRuns.costUsd}, 0) else 0 end), 0)`,
      })
      .from(schema.aiRuns)
      .innerJoin(
        schema.demoWorkspaces,
        eq(schema.demoWorkspaces.orgId, schema.aiRuns.orgId),
      );
    const [reservationLedger] = await tx
      .select({
        reserved: sql<number>`coalesce(sum(${schema.demoWorkspaces.reservedSpendUsd}), 0)`,
      })
      .from(schema.demoWorkspaces);
    const reserved = Number(reservationLedger?.reserved ?? 0);
    if (
      Number(spend?.day ?? 0) + reserved + DEMO_ESTIMATED_RESERVATION_USD > DEMO_MAX_DAILY_SPEND_USD ||
      Number(spend?.month ?? 0) + reserved + DEMO_ESTIMATED_RESERVATION_USD > DEMO_MAX_MONTHLY_SPEND_USD
    ) {
      throw new ApiError(503, "Demo AI budget is exhausted; no model call was started", "DEMO_BUDGET_EXHAUSTED");
    }
    const [row] = await tx
      .update(schema.demoWorkspaces)
      .set({
        generationJobsUsed: sql`${schema.demoWorkspaces.generationJobsUsed} + 1`,
        reservedSpendUsd: sql`${schema.demoWorkspaces.reservedSpendUsd} + ${DEMO_ESTIMATED_RESERVATION_USD}`,
      })
      .where(
        and(
          eq(schema.demoWorkspaces.orgId, input.orgId),
          eq(schema.demoWorkspaces.userId, input.userId),
          gt(schema.demoWorkspaces.expiresAt, new Date()),
          lt(schema.demoWorkspaces.generationJobsUsed, schema.demoWorkspaces.maxGenerationJobs),
        ),
      )
      .returning({ id: schema.demoWorkspaces.id });
    if (!row) throw new ApiError(429, "Demo generation quota reached", "DEMO_LIMIT_REACHED");
  });
  return DEMO_ESTIMATED_RESERVATION_USD;
}

/**
 * Release a reserved estimate after a job commits or reaches its final retry.
 * The actual provider-reported amount is already persisted on ai_runs; the
 * next reservation reads that ledger plus any still-in-flight estimates.
 */
export async function reconcileDemoGeneration(input: {
  orgId: string;
  reservedUsd: number;
}): Promise<void> {
  if (!Number.isFinite(input.reservedUsd) || input.reservedUsd <= 0) return;
  await dbAdmin
    .update(schema.demoWorkspaces)
    .set({
      reservedSpendUsd: sql`greatest(0, ${schema.demoWorkspaces.reservedSpendUsd} - ${input.reservedUsd})`,
    })
    .where(eq(schema.demoWorkspaces.orgId, input.orgId));
}

export async function reserveDemoUpload(input: {
  orgId: string;
  userId: string;
  sizeBytes: number;
}): Promise<void> {
  const [row] = await db
    .update(schema.demoWorkspaces)
    .set({
      uploadCount: sql`${schema.demoWorkspaces.uploadCount} + 1`,
      uploadBytes: sql`${schema.demoWorkspaces.uploadBytes} + ${input.sizeBytes}`,
    })
    .where(
      and(
        eq(schema.demoWorkspaces.orgId, input.orgId),
        eq(schema.demoWorkspaces.userId, input.userId),
        gt(schema.demoWorkspaces.expiresAt, new Date()),
        lt(schema.demoWorkspaces.uploadCount, schema.demoWorkspaces.maxUploads),
        sql`${schema.demoWorkspaces.uploadBytes} + ${input.sizeBytes} <= ${schema.demoWorkspaces.maxStorageBytes}`,
      ),
    )
    .returning({ id: schema.demoWorkspaces.id });
  if (!row) throw new ApiError(429, "Demo document quota reached", "DEMO_LIMIT_REACHED");
}

export async function cleanupExpiredDemoWorkspaces(): Promise<number> {
  const expired = await dbAdmin.query.demoWorkspaces.findMany({
    where: lt(schema.demoWorkspaces.expiresAt, new Date()),
    columns: { orgId: true },
  });
  for (const workspace of expired) {
    // Workspace documents are namespaced by org. Remove object storage before
    // the cascading org delete so expired interview/demo data is recoverable
    // only until this cleanup pass runs, never indefinitely in S3.
    await deletePrefix(`orgs/${workspace.orgId}/`);
    await dbAdmin.delete(schema.organizations).where(eq(schema.organizations.id, workspace.orgId));
  }
  return expired.length;
}

export function demoBudgetAvailable(estimatedCostUsd: number): boolean {
  return estimatedCostUsd <= DEMO_MAX_DAILY_SPEND_USD;
}
