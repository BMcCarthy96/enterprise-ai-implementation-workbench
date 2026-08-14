import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

const ALGORITHM = "aes-256-gcm";

function encryptionKey(): Buffer {
  const configuration = env();
  if (!configuration.APP_ENCRYPTION_KEY && configuration.NODE_ENV === "production") {
    throw new Error("APP_ENCRYPTION_KEY is required in production; do not reuse SESSION_SECRET for data encryption");
  }
  const configured = configuration.APP_ENCRYPTION_KEY ?? configuration.SESSION_SECRET;
  return createHash("sha256").update(configured).digest();
}

export function encryptSecret(value: string, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecret(payload: string, aad: string): string {
  const [ivText, tagText, ciphertextText] = payload.split(".");
  if (!ivText || !tagText || !ciphertextText) throw new Error("Malformed encrypted secret");
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextText, "base64url")), decipher.final()]).toString("utf8");
}

export function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createOpaqueSecret(prefix: string): { plaintext: string; hash: string } {
  const plaintext = prefix + "_" + randomBytes(32).toString("base64url");
  return { plaintext, hash: hashSecret(plaintext) };
}
