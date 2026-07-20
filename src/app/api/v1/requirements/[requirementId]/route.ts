import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { withAuth, parseBody } from "@/lib/api";
import { UpdateRequirementSchema } from "@/lib/apiSchemas";
import { requireRequirement } from "@/server/services/access";
import { recordAudit } from "@/server/services/audit";

type Params = { requirementId: string };

export const PATCH = withAuth<Params>(
  "requirements.manage",
  async (req, { session }, params) => {
    const requirement = await requireRequirement(
      params.requirementId,
      session.orgId,
    );
    const body = await parseBody(req, UpdateRequirementSchema);

    const [updated] = await db
      .update(schema.requirements)
      .set(body)
      .where(eq(schema.requirements.id, requirement.id))
      .returning();

    await recordAudit({
      orgId: session.orgId,
      actorId: session.userId,
      action: "requirement.updated",
      subjectType: "requirement",
      subjectId: requirement.id,
      projectId: requirement.projectId,
      metadata: { changes: body },
    });
    return NextResponse.json({ requirement: updated });
  },
);
