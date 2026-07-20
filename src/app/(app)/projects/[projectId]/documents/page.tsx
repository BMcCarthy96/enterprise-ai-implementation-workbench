import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { DocumentList, DocumentUploader } from "./DocumentUploader";

export const dynamic = "force-dynamic";

export default async function DocumentsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = (await getSession())!;
  const canUpload = can(session.role, "documents.upload");

  const docs = await db.query.documents.findMany({
    where: eq(schema.documents.projectId, projectId),
    orderBy: desc(schema.documents.createdAt),
  });

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <DocumentList
          documents={docs.map((d) => ({
            id: d.id,
            fileName: d.fileName,
            sizeBytes: d.sizeBytes,
            createdAt: d.createdAt.toISOString(),
          }))}
        />
      </div>
      {canUpload && (
        <div>
          <div className="card p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">
              Upload document
            </h2>
            <p className="mb-3 text-xs text-gray-500">
              Files are uploaded directly to S3 with a presigned URL — the app
              server never handles file bytes.
            </p>
            <DocumentUploader projectId={projectId} />
          </div>
        </div>
      )}
    </div>
  );
}
