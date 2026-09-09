import "server-only";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const REQUIRED_ENV = [
  "AVATAR_S3_ENDPOINT",
  "AVATAR_S3_ACCESS_KEY_ID",
  "AVATAR_S3_SECRET_ACCESS_KEY",
  "AVATAR_S3_BUCKET",
] as const;

let client: S3Client | null = null;

function storageConfig() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`Armazenamento de avatares indisponível: ${missing.join(", ")}`);
  }

  return {
    endpoint: process.env.AVATAR_S3_ENDPOINT!,
    accessKeyId: process.env.AVATAR_S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AVATAR_S3_SECRET_ACCESS_KEY!,
    bucket: process.env.AVATAR_S3_BUCKET!,
    region: process.env.AVATAR_S3_REGION?.trim() || "auto",
    forcePathStyle: process.env.AVATAR_S3_URL_STYLE === "path",
  };
}

function storageClient(): { client: S3Client; bucket: string } {
  const config = storageConfig();
  client ??= new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  return { client, bucket: config.bucket };
}

export function avatarVersion(key: string): string {
  return key.split("/").at(-1)?.replace(/\.webp$/i, "") ?? "avatar";
}

export function avatarUrl(userId: string, key: string | null): string | null {
  if (!key) return null;
  return `/api/avatares/${encodeURIComponent(userId)}/${encodeURIComponent(avatarVersion(key))}`;
}

export async function putAvatar(key: string, body: Uint8Array) {
  const storage = storageClient();
  await storage.client.send(
    new PutObjectCommand({
      Bucket: storage.bucket,
      Key: key,
      Body: body,
      ContentType: "image/webp",
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
}

export async function getAvatar(key: string) {
  const storage = storageClient();
  return storage.client.send(
    new GetObjectCommand({ Bucket: storage.bucket, Key: key }),
  );
}

export async function deleteAvatar(key: string) {
  const storage = storageClient();
  await storage.client.send(
    new DeleteObjectCommand({ Bucket: storage.bucket, Key: key }),
  );
}
