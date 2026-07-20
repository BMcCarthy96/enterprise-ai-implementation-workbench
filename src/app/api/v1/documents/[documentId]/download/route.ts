import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api";
import { presignDownload } from "@/lib/aws/s3";
import { requireDocument } from "@/server/services/access";

type Params = { documentId: string };

export const GET = withAuth<Params>(null, async (_req, { session }, params) => {
  const document = await requireDocument(params.documentId, session.orgId);
  const url = await presignDownload(document.s3Key, document.fileName);
  return NextResponse.json({ url });
});
