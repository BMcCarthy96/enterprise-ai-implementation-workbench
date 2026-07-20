import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { withAuth, parseBody, ApiError } from "@/lib/api";
import { RegisterDocumentSchema } from "@/lib/apiSchemas";
import { requireProject } from "@/server/services/access";
import { recordAudit } from "@/server/services/audit";

type Params = { projectId: string };

export const GET = withAuth<Params>(null, async (_req, { session }, params) => {
  await requireProject(params.projectId, session.orgId);
  const rows = await db.query.documents.findMany({
    where: eq(schema.documents.projectId, params.projectId),
    orderBy: desc(schema.documents.createdAt),
  });
  return NextResponse.json({ documents: rows });
});

export const POST = withAuth<Params>(
  "documents.upload",
  async (req, { session }, params) => {
    const project = await requireProject(params.projectId, session.orgId);
    const body = await parseBody(req, RegisterDocumentSchema);

    // The key must belong to this org+project namespace — a client cannot
    // register (and later download) an object outside its tenant.
    const expectedPrefix = `orgs/${session.orgId}/projects/${project.id}/`;
    if (!body.s3Key.startsWith(expectedPrefix)) {
      throw new ApiError(400, "Document key does not match this project");
    }

    const [document] = await db
      .insert(schema.documents)
      .values({
        orgId: session.orgId,
        projectId: project.id,
        fileName: body.fileName,
        contentType: body.contentType,
        sizeBytes: body.sizeBytes,
        s3Key: body.s3Key,
        uploadedBy: session.userId,
      })
      .returning();

    await recordAudit({
      orgId: session.orgId,
      actorId: session.userId,
      action: "document.uploaded",
      subjectType: "document",
      subjectId: document.id,
      projectId: project.id,
      metadata: { fileName: document.fileName, sizeBytes: document.sizeBytes },
    });
    return NextResponse.json({ document }, { status: 201 });
  },
);
