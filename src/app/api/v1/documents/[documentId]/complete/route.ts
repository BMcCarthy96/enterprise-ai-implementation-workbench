import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { completeDocumentUpload } from "@/server/services/documentUploads";
import { uuidParam } from "@/server/services/access";

type Params = { documentId: string };

/** Verify the direct-to-S3 upload before it becomes an ingestion job. */
export const POST = withAuth<Params>(
  "documents.upload",
  async (_req, { session }, params) => {
    return NextResponse.json(
      await completeDocumentUpload({
        documentId: uuidParam(params.documentId, "documentId"),
        orgId: session.orgId,
        actorId: session.userId,
      }),
    );
  },
);
