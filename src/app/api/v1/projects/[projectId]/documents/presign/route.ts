import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { withAuth, parseBody, ApiError } from "@/lib/api";
import { PresignDocumentSchema } from "@/lib/apiSchemas";
import { documentKey, presignUpload } from "@/lib/aws/s3";
import { requireProject } from "@/server/services/access";
import { reserveDemoUpload } from "@/server/services/demo";
import { recordAudit } from "@/server/services/audit";

type Params = { projectId: string };

/**
 * Step 1 of the two-step upload: client asks for a presigned S3 PUT URL,
 * uploads directly to S3, then registers metadata via POST /documents.
 * The app server never proxies file bytes.
 */
export const POST = withAuth<Params>(
  "documents.upload",
  async (req, { session }, params) => {
    const project = await requireProject(params.projectId, session.orgId);
    const body = await parseBody(req, PresignDocumentSchema);
    if (session.demoWorkspaceId) {
      if (body.sizeBytes > 5 * 1024 * 1024) {
        throw new ApiError(429, "Demo files are limited to 5 MB", "DEMO_LIMIT_REACHED");
      }
      await reserveDemoUpload({ orgId: session.orgId, userId: session.userId, sizeBytes: body.sizeBytes });
    }

    const documentId = crypto.randomUUID();
    const key = documentKey(session.orgId, project.id, body.fileName, documentId);
    await db.insert(schema.documents).values({
      id: documentId,
      orgId: session.orgId,
      projectId: project.id,
      fileName: body.fileName,
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
      s3Key: key,
      status: "pending_upload",
      uploadedBy: session.userId,
    });
    await recordAudit({
      orgId: session.orgId,
      actorId: session.userId,
      action: "document.upload_requested",
      subjectType: "document",
      subjectId: documentId,
      projectId: project.id,
      metadata: {
        fileName: body.fileName,
        contentType: body.contentType,
        sizeBytes: body.sizeBytes,
      },
    });
    const uploadUrl = await presignUpload(key, body.contentType);
    return NextResponse.json({ uploadUrl, s3Key: key, documentId });
  },
);
