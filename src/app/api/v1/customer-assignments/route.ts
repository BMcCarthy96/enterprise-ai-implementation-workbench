import { and, asc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, schema } from "@/db";
import { ApiError, parseBody, withAuth } from "@/lib/api";
import { recordAudit } from "@/server/services/audit";

const AssignmentSchema = z.object({
  userId: z.string().uuid(),
  customerId: z.string().uuid(),
});

export const GET = withAuth("org.manage_members", async (_request, { session }) => {
  const assignments = await db
    .select({
      id: schema.customerAssignments.id,
      userId: schema.customerAssignments.userId,
      userName: schema.users.name,
      userEmail: schema.users.email,
      customerId: schema.customerAssignments.customerId,
      customerName: schema.customers.name,
    })
    .from(schema.customerAssignments)
    .innerJoin(schema.users, eq(schema.customerAssignments.userId, schema.users.id))
    .innerJoin(schema.customers, eq(schema.customerAssignments.customerId, schema.customers.id))
    .where(eq(schema.customerAssignments.orgId, session.orgId))
    .orderBy(asc(schema.customers.name), asc(schema.users.name));
  return NextResponse.json({ assignments });
});

export const POST = withAuth("org.manage_members", async (request, { session }) => {
  const input = await parseBody(request, AssignmentSchema);
  const [member] = await db
    .select({
      userId: schema.memberships.userId,
      userName: schema.users.name,
      userEmail: schema.users.email,
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
    .where(
      and(
        eq(schema.memberships.orgId, session.orgId),
        eq(schema.memberships.userId, input.userId),
        eq(schema.memberships.role, "customer_stakeholder"),
        eq(schema.memberships.active, true),
      ),
    )
    .limit(1);
  const customer = await db.query.customers.findFirst({
    where: and(eq(schema.customers.orgId, session.orgId), eq(schema.customers.id, input.customerId)),
    columns: { id: true, name: true },
  });
  if (!member || !customer) throw new ApiError(404, "Customer stakeholder or customer not found");
  const [created] = await db
    .insert(schema.customerAssignments)
    .values({ orgId: session.orgId, userId: input.userId, customerId: input.customerId, createdBy: session.userId })
    .onConflictDoNothing({ target: [schema.customerAssignments.orgId, schema.customerAssignments.userId, schema.customerAssignments.customerId] })
    .returning({ id: schema.customerAssignments.id });
  if (created) {
    await recordAudit({
      orgId: session.orgId,
      actorId: session.userId,
      action: "customer_assignment.created",
      subjectType: "customer_assignment",
      subjectId: created.id,
      metadata: { userId: input.userId, customerId: input.customerId },
    });
  }
  const assignment = created
    ? {
        id: created.id,
        userId: member.userId,
        userName: member.userName,
        userEmail: member.userEmail,
        customerId: customer.id,
        customerName: customer.name,
      }
    : null;
  return NextResponse.json({ assignment }, { status: created ? 201 : 200 });
});

export const DELETE = withAuth("org.manage_members", async (request: NextRequest, { session }) => {
  const assignmentId = request.nextUrl.searchParams.get("assignmentId");
  if (!assignmentId || !z.string().uuid().safeParse(assignmentId).success) {
    throw new ApiError(400, "assignmentId must be a UUID", "INVALID_IDENTIFIER");
  }
  const [deleted] = await db
    .delete(schema.customerAssignments)
    .where(and(eq(schema.customerAssignments.id, assignmentId), eq(schema.customerAssignments.orgId, session.orgId)))
    .returning({ id: schema.customerAssignments.id });
  if (!deleted) throw new ApiError(404, "Customer assignment not found");
  await recordAudit({
    orgId: session.orgId,
    actorId: session.userId,
    action: "customer_assignment.deleted",
    subjectType: "customer_assignment",
    subjectId: deleted.id,
    metadata: {},
  });
  return NextResponse.json({ deleted: true });
});
