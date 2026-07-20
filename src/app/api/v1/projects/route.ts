import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { withAuth, parseBody, ApiError } from "@/lib/api";
import { CreateProjectSchema } from "@/lib/apiSchemas";
import { recordAudit } from "@/server/services/audit";

export const GET = withAuth(null, async (_req, { session }) => {
  const rows = await db
    .select({
      project: schema.projects,
      customerName: schema.customers.name,
    })
    .from(schema.projects)
    .innerJoin(
      schema.customers,
      eq(schema.projects.customerId, schema.customers.id),
    )
    .where(eq(schema.projects.orgId, session.orgId))
    .orderBy(desc(schema.projects.createdAt));
  return NextResponse.json({
    projects: rows.map((r) => ({ ...r.project, customerName: r.customerName })),
  });
});

export const POST = withAuth("projects.manage", async (req, { session }) => {
  const body = await parseBody(req, CreateProjectSchema);

  const customer = await db.query.customers.findFirst({
    where: eq(schema.customers.id, body.customerId),
  });
  if (!customer || customer.orgId !== session.orgId) {
    throw new ApiError(404, "Customer not found");
  }

  const [project] = await db
    .insert(schema.projects)
    .values({
      orgId: session.orgId,
      customerId: body.customerId,
      name: body.name,
      description: body.description ?? null,
      targetDate: body.targetDate ? new Date(body.targetDate) : null,
      createdBy: session.userId,
    })
    .returning();

  await recordAudit({
    orgId: session.orgId,
    actorId: session.userId,
    action: "project.created",
    subjectType: "project",
    subjectId: project.id,
    projectId: project.id,
    metadata: { name: project.name, customerId: customer.id },
  });
  return NextResponse.json({ project }, { status: 201 });
});
