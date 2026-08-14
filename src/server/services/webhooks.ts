import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, dbAdmin, schema } from "@/db";
import { ApiError } from "@/lib/api";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { createAndEnqueueJob } from "@/server/services/jobs";

export interface WebhookEvent {
  type: (typeof schema.webhookEventTypes)[number];
  orgId: string;
  actorId?: string;
  subjectId?: string;
  data: Record<string, unknown>;
}

export function validateWebhookUrl(raw: string): URL {
  const url = new URL(raw);
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") throw new ApiError(400, "Webhook URLs must use HTTPS in production", "WEBHOOK_HTTPS_REQUIRED");
  if (!["http:", "https:"].includes(url.protocol)) throw new ApiError(400, "Webhook URL must use HTTP or HTTPS", "WEBHOOK_URL_INVALID");
  if (url.username || url.password) throw new ApiError(400, "Webhook URL credentials are not allowed", "WEBHOOK_URL_INVALID");
  if (isBlockedHost(url.hostname)) throw new ApiError(400, "Webhook URL points to a private network", "WEBHOOK_PRIVATE_TARGET");
  return url;
}

export async function assertSafeWebhookTarget(url: URL): Promise<void> {
  if (process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname)) return;
  const addresses = isIP(url.hostname) ? [url.hostname] : (await lookup(url.hostname, { all: true })).map((entry) => entry.address);
  if (addresses.some(isBlockedHost)) throw new Error("Webhook target resolved to a private network");
}

export function isBlockedHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;
  if (normalized.includes(":")) {
    const mapped = normalized.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (mapped && isBlockedHost(mapped[1])) return true;
    return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized) || normalized.startsWith("ff") || normalized.startsWith("2001:db8:") || normalized.startsWith("100:");
  }
  const parts = normalized.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  return parts[0] === 10 || parts[0] === 127 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 169 && parts[1] === 254);
}

export async function createWebhookEndpoint(input: { orgId: string; actorId: string; url: string; eventTypes: Array<(typeof schema.webhookEventTypes)[number]> }) {
  const url = validateWebhookUrl(input.url);
  const id = randomUUID();
  const secret = "whsec_" + randomBytes(32).toString("base64url");
  const [endpoint] = await db.insert(schema.webhookEndpoints).values({
    id,
    orgId: input.orgId,
    url: url.toString(),
    secretCiphertext: encryptSecret(secret, input.orgId + ":webhook:" + id),
    eventTypes: input.eventTypes,
    createdBy: input.actorId,
  }).returning({ id: schema.webhookEndpoints.id, url: schema.webhookEndpoints.url, eventTypes: schema.webhookEndpoints.eventTypes, enabled: schema.webhookEndpoints.enabled });
  if (!endpoint) throw new Error("Unable to create webhook endpoint");
  return { endpoint, secret };
}

export async function listWebhookEndpoints(orgId: string) {
  return db.query.webhookEndpoints.findMany({
    where: eq(schema.webhookEndpoints.orgId, orgId),
    columns: { id: true, url: true, eventTypes: true, enabled: true, createdAt: true, updatedAt: true },
  });
}

export async function listWebhookDeliveries(orgId: string, endpointId: string, limit = 50) {
  return db.query.webhookDeliveries.findMany({
    where: and(eq(schema.webhookDeliveries.orgId, orgId), eq(schema.webhookDeliveries.endpointId, endpointId)),
    columns: {
      id: true,
      eventId: true,
      eventType: true,
      status: true,
      attempts: true,
      nextAttemptAt: true,
      responseStatus: true,
      lastError: true,
      deliveredAt: true,
      createdAt: true,
    },
    orderBy: (deliveries, { desc }) => [desc(deliveries.createdAt)],
    limit: Math.min(Math.max(limit, 1), 100),
  });
}

export async function queueWebhookEvent(event: WebhookEvent): Promise<number> {
  const endpoints = await db.query.webhookEndpoints.findMany({ where: and(eq(schema.webhookEndpoints.orgId, event.orgId), eq(schema.webhookEndpoints.enabled, true)) });
  const matching = endpoints.filter((endpoint) => endpoint.eventTypes.includes(event.type));
  let queued = 0;
  for (const endpoint of matching) {
    const eventId = randomUUID();
    const payload = {
      id: eventId,
      type: event.type,
      apiVersion: "2026-08-01",
      occurredAt: new Date().toISOString(),
      organizationId: event.orgId,
      actor: event.actorId ? { id: event.actorId, type: "user" } : { id: null, type: "system" },
      subjectId: event.subjectId ?? null,
      data: event.data,
    };
    const [delivery] = await db.insert(schema.webhookDeliveries).values({ orgId: event.orgId, endpointId: endpoint.id, eventId, eventType: event.type, payload }).returning({ id: schema.webhookDeliveries.id });
    if (!delivery) continue;
    await createAndEnqueueJob({ orgId: event.orgId, type: "webhook_delivery", payload: { deliveryId: delivery.id }, requestedBy: event.actorId, auditMetadata: { eventType: event.type } });
    queued += 1;
  }
  return queued;
}

export async function queueWebhookTest(orgId: string, endpointId: string, actorId: string) {
  const endpoint = await db.query.webhookEndpoints.findFirst({
    where: and(eq(schema.webhookEndpoints.id, endpointId), eq(schema.webhookEndpoints.orgId, orgId), eq(schema.webhookEndpoints.enabled, true)),
  });
  if (!endpoint) throw new ApiError(404, "Webhook endpoint not found or disabled", "WEBHOOK_NOT_FOUND");
  const eventId = randomUUID();
  const payload = {
    id: eventId,
    type: "webhook.test" as const,
    apiVersion: "2026-08-01",
    occurredAt: new Date().toISOString(),
    organizationId: orgId,
    actor: { id: actorId, type: "user" },
    subjectId: endpointId,
    data: { message: "Webhook connectivity test", synthetic: true },
  };
  const [delivery] = await db.insert(schema.webhookDeliveries).values({
    orgId,
    endpointId,
    eventId,
    eventType: "webhook.test",
    payload,
  }).returning({ id: schema.webhookDeliveries.id, eventId: schema.webhookDeliveries.eventId });
  if (!delivery) throw new Error("Unable to queue webhook test");
  const jobId = await createAndEnqueueJob({
    orgId,
    type: "webhook_delivery",
    payload: { deliveryId: delivery.id },
    requestedBy: actorId,
    auditMetadata: { eventType: "webhook.test", endpointId },
  });
  return { deliveryId: delivery.id, eventId: delivery.eventId, jobId };
}

export async function rotateWebhookSecret(orgId: string, endpointId: string) {
  const endpoint = await db.query.webhookEndpoints.findFirst({
    where: and(eq(schema.webhookEndpoints.id, endpointId), eq(schema.webhookEndpoints.orgId, orgId)),
    columns: { id: true },
  });
  if (!endpoint) throw new ApiError(404, "Webhook endpoint not found", "WEBHOOK_NOT_FOUND");
  const secret = "whsec_" + randomBytes(32).toString("base64url");
  await db.update(schema.webhookEndpoints)
    .set({ secretCiphertext: encryptSecret(secret, orgId + ":webhook:" + endpointId), updatedAt: new Date() })
    .where(and(eq(schema.webhookEndpoints.id, endpointId), eq(schema.webhookEndpoints.orgId, orgId)));
  return { endpointId, secret };
}

async function readBoundedResponse(response: Response, maxBytes = 8192): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (total < maxBytes) {
    const next = await reader.read();
    if (next.done) break;
    const chunk = Buffer.from(next.value);
    const remaining = maxBytes - total;
    chunks.push(chunk.subarray(0, remaining));
    total += Math.min(chunk.length, remaining);
    if (chunk.length > remaining) {
      await reader.cancel();
      break;
    }
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function deliverWebhookJob(job: { orgId: string; payload?: unknown }) {
  const deliveryId = typeof job.payload === "object" && job.payload && "deliveryId" in job.payload && typeof job.payload.deliveryId === "string" ? job.payload.deliveryId : null;
  if (!deliveryId) throw new Error("Webhook delivery job is missing deliveryId");
  const delivery = await dbAdmin.query.webhookDeliveries.findFirst({ where: and(eq(schema.webhookDeliveries.id, deliveryId), eq(schema.webhookDeliveries.orgId, job.orgId)) });
  if (!delivery) return;
  const endpoint = await dbAdmin.query.webhookEndpoints.findFirst({ where: and(eq(schema.webhookEndpoints.id, delivery.endpointId), eq(schema.webhookEndpoints.orgId, job.orgId)) });
  if (!endpoint || !endpoint.enabled) return;
  const url = validateWebhookUrl(endpoint.url);
  await assertSafeWebhookTarget(url);
  const body = JSON.stringify(delivery.payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const secret = decryptSecret(endpoint.secretCiphertext, endpoint.orgId + ":webhook:" + endpoint.id);
  const signature = createHmac("sha256", secret).update(timestamp + "." + body).digest("hex");
  const attempts = delivery.attempts + 1;
  await dbAdmin.update(schema.webhookDeliveries).set({ status: "delivering", attempts, lastError: null }).where(eq(schema.webhookDeliveries.id, delivery.id));
  try {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "user-agent": "Enterprise-AI-Workbench/1.0", "x-workbench-event-id": String(delivery.eventId), "x-workbench-signature": "t=" + timestamp + ",v1=" + signature }, body, redirect: "error", signal: AbortSignal.timeout(5000) });
    const responseBody = await readBoundedResponse(response);
    if (!response.ok) throw new Error("Webhook returned HTTP " + response.status);
    await dbAdmin.update(schema.webhookDeliveries).set({ status: "delivered", responseStatus: response.status, responseBody, deliveredAt: new Date(), nextAttemptAt: null }).where(eq(schema.webhookDeliveries.id, delivery.id));
  } catch (error) {
    await dbAdmin.update(schema.webhookDeliveries).set({ status: "failed", lastError: error instanceof Error ? error.message : String(error), nextAttemptAt: new Date(Date.now() + Math.min(900, 5 * 2 ** Math.max(attempts - 1, 0)) * 1000) }).where(eq(schema.webhookDeliveries.id, delivery.id));
    throw error;
  }
}

export function verifyWebhookSignature(secret: string, timestamp: number, body: string, signature: string, now = Math.floor(Date.now() / 1000)) {
  if (Math.abs(now - timestamp) > 300) return false;
  const expected = createHmac("sha256", secret).update(timestamp + "." + body).digest("hex");
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(signature, "utf8"));
}
