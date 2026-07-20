import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3Client } from "./clients";
import { env } from "@/lib/env";

const PRESIGN_TTL_SECONDS = 300;

/** Keys are namespaced by org so tenant data never collides. */
export function documentKey(
  orgId: string,
  projectId: string,
  fileName: string,
): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `orgs/${orgId}/projects/${projectId}/${crypto.randomUUID()}-${safe}`;
}

export async function presignUpload(
  key: string,
  contentType: string,
): Promise<string> {
  return getSignedUrl(
    s3Client(),
    new PutObjectCommand({
      Bucket: env().S3_BUCKET,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: PRESIGN_TTL_SECONDS },
  );
}

export async function presignDownload(
  key: string,
  fileName: string,
): Promise<string> {
  return getSignedUrl(
    s3Client(),
    new GetObjectCommand({
      Bucket: env().S3_BUCKET,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${fileName.replace(/"/g, "")}"`,
    }),
    { expiresIn: PRESIGN_TTL_SECONDS },
  );
}

export async function deleteObject(key: string): Promise<void> {
  await s3Client().send(
    new DeleteObjectCommand({ Bucket: env().S3_BUCKET, Key: key }),
  );
}
