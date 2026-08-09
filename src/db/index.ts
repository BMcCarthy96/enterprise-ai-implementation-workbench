import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";
import * as schema from "./schema";

// Reuse the pool across Next.js hot reloads in dev to avoid connection leaks.
const globalForDb = globalThis as unknown as { pool?: Pool };

const pool =
  globalForDb.pool ??
  new Pool({
    connectionString: env().DATABASE_URL,
    max: 10,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.pool = pool;
}

const baseDb = drizzle(pool, { schema });

// Migrations, seed, and demo cleanup may use an owner/admin connection. The
// fallback keeps the existing local setup working until the separate role is
// provisioned; production should always provide DATABASE_ADMIN_URL.
const adminPool = new Pool({
  connectionString: env().DATABASE_ADMIN_URL ?? env().DATABASE_URL,
  max: 5,
});
export const dbAdmin = drizzle(adminPool, { schema });

type TenantTransaction = Parameters<Parameters<typeof baseDb.transaction>[0]>[0];
type TenantContext = {
  orgId?: string;
  userId?: string;
  tx: TenantTransaction;
  afterCommit: Array<() => Promise<void>>;
};

/**
 * Request-local transaction context. The exported `db` transparently routes
 * queries through the active tenant transaction, so existing services cannot
 * accidentally bypass the RLS context once it is enabled in production.
 */
export const tenantStorage = new AsyncLocalStorage<TenantContext>();

async function setContextValue(name: "app.org_id" | "app.user_id", value: string) {
  const context = tenantStorage.getStore();
  if (!context) throw new Error("Database context is not active");
  await context.tx.execute(sql`select set_config(${name}, ${value}, true)`);
  if (name === "app.org_id") context.orgId = value;
  else context.userId = value;
}

export async function setTenantContext(orgId: string): Promise<void> {
  await setContextValue("app.org_id", orgId);
}

export async function withTenantTransaction<T>(
  orgId: string,
  callback: () => Promise<T>,
  userId?: string,
): Promise<T> {
  const afterCommit: Array<() => Promise<void>> = [];
  const result = await baseDb.transaction(async (tx) => {
    return tenantStorage.run({ tx, afterCommit }, async () => {
      await setTenantContext(orgId);
      if (userId) await setContextValue("app.user_id", userId);
      return callback();
    });
  });
  // External side effects must not run until PostgreSQL has committed. This is
  // especially important for SQS: a worker must never receive a pointer to a
  // row that is still invisible on another database connection.
  for (const effect of afterCommit) await effect();
  return result;
}

export async function withUserTransaction<T>(
  userId: string,
  callback: () => Promise<T>,
): Promise<T> {
  const afterCommit: Array<() => Promise<void>> = [];
  const result = await baseDb.transaction(async (tx) =>
    tenantStorage.run({ tx, afterCommit }, async () => {
      await setContextValue("app.user_id", userId);
      return callback();
    }),
  );
  for (const effect of afterCommit) await effect();
  return result;
}

/**
 * Schedule an external side effect for after the active database transaction
 * commits. Outside a managed transaction the effect runs immediately.
 */
export async function afterTransactionCommit(effect: () => Promise<void>): Promise<void> {
  const context = tenantStorage.getStore();
  if (context) {
    context.afterCommit.push(effect);
    return;
  }
  await effect();
}

export const db = new Proxy(baseDb, {
  get(target, property, receiver) {
    const active = tenantStorage.getStore()?.tx;
    if (!active || property === "transaction") {
      return Reflect.get(target, property, receiver);
    }
    const value = Reflect.get(active, property, active);
    return typeof value === "function" ? value.bind(active) : value;
  },
}) as typeof baseDb;
export type Db = typeof db;
export { schema };
