import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { withAuth, parseBody, ApiError } from "@/lib/api";
import { RegisterDocumentSchema } from "@/lib/apiSchemas";
import { requireProject } from "@/server/services/access";
import { completeDocumentUpload } from "@/server/services/documentIngestion";

type Params = { projectId: string };

export const GET = withAuth<Params>("internal.view", async (_req, { session }, params) => {
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

    const pending = await db.query.documents.findFirst({
      where: and(
        eq(schema.documents.projectId, project.id),
        eq(schema.documents.orgId, session.orgId),
        eq(schema.documents.s3Key, body.s3Key),
      ),
    });
    if (!pending) {
      throw new ApiError(400, "Upload must begin with a presign request");
    }
    const result = await completeDocumentUpload({
      documentId: pending.id,
      orgId: session.orgId,
      actorId: session.userId,
    });
    return NextResponse.json(result, { status: 201 });
  },
);
