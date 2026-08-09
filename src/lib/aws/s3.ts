import {
  DeleteObjectsCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
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
  documentId = crypto.randomUUID(),
): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `orgs/${orgId}/projects/${projectId}/${documentId}-${safe}`;
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

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await s3Client().send(
    new PutObjectCommand({
      Bucket: env().S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

/** Delete every object below an exact tenant/workspace prefix. */
export async function deletePrefix(prefix: string): Promise<number> {
  let continuationToken: string | undefined;
  let deleted = 0;
  do {
    const page = await s3Client().send(
      new ListObjectsV2Command({
        Bucket: env().S3_BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    const objects = (page.Contents ?? [])
      .map((item) => item.Key)
      .filter((key): key is string => Boolean(key));
    if (objects.length) {
      await s3Client().send(
        new DeleteObjectsCommand({
          Bucket: env().S3_BUCKET,
          Delete: { Objects: objects.map((Key) => ({ Key })) },
        }),
      );
      deleted += objects.length;
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return deleted;
}

export async function headObject(key: string): Promise<{
  sizeBytes: number;
  contentType: string;
}> {
  const response = await s3Client().send(
    new HeadObjectCommand({ Bucket: env().S3_BUCKET, Key: key }),
  );
  return {
    sizeBytes: response.ContentLength ?? 0,
    contentType: response.ContentType ?? "application/octet-stream",
  };
}

export async function readObject(key: string): Promise<Buffer> {
  const response = await s3Client().send(
    new GetObjectCommand({ Bucket: env().S3_BUCKET, Key: key }),
  );
  if (!response.Body) throw new Error("S3 object has no body");
  return Buffer.from(await response.Body.transformToByteArray());
}
