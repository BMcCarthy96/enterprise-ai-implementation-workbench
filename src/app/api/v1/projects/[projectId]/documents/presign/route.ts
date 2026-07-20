import { NextResponse } from "next/server";
import { withAuth, parseBody } from "@/lib/api";
import { PresignDocumentSchema } from "@/lib/apiSchemas";
import { documentKey, presignUpload } from "@/lib/aws/s3";
import { requireProject } from "@/server/services/access";

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

    const key = documentKey(session.orgId, project.id, body.fileName);
    const uploadUrl = await presignUpload(key, body.contentType);
    return NextResponse.json({ uploadUrl, s3Key: key });
  },
);
