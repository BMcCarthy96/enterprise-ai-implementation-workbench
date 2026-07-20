import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { withAuth, parseBody } from "@/lib/api";
import { CreateCustomerSchema } from "@/lib/apiSchemas";
import { recordAudit } from "@/server/services/audit";

export const GET = withAuth("internal.view", async (_req, { session }) => {
  const rows = await db.query.customers.findMany({
    where: eq(schema.customers.orgId, session.orgId),
    orderBy: desc(schema.customers.createdAt),
  });
  return NextResponse.json({ customers: rows });
});

export const POST = withAuth("customers.manage", async (req, { session }) => {
  const body = await parseBody(req, CreateCustomerSchema);
  const [customer] = await db
    .insert(schema.customers)
    .values({ orgId: session.orgId, ...body })
    .returning();
  await recordAudit({
    orgId: session.orgId,
    actorId: session.userId,
    action: "customer.created",
    subjectType: "customer",
    subjectId: customer.id,
    metadata: { name: customer.name },
  });
  return NextResponse.json({ customer }, { status: 201 });
});
