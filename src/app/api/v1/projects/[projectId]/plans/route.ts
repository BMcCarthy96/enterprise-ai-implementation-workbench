import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { withAuth } from "@/lib/api";
import { requireProject } from "@/server/services/access";

type Params = { projectId: string };

export const GET = withAuth<Params>(
  "internal.view",
  async (_req, { session }, params) => {
    await requireProject(params.projectId, session.orgId);
    const rows = await db.query.plans.findMany({
      where: eq(schema.plans.projectId, params.projectId),
      orderBy: desc(schema.plans.version),
    });
    return NextResponse.json({ plans: rows });
  },
);
