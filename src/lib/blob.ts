import "server-only";
import { createHash } from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Railway's MinIO template emits endpoints like https://host:443. An explicit
 * default port breaks presigned URL signatures because fetch() drops default
 * ports from the Host header before sending the request. Strip them so the
 * signature we generate matches what the client actually sends over the wire.
 */
function normalizeEndpoint(raw: string): string {
  const u = new URL(raw);
  if (
    (u.protocol === "https:" && u.port === "443") ||
    (u.protocol === "http:" && u.port === "80")
  ) {
    u.port = "";
  }
  return u.toString().replace(/\/$/, "");
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function makeClient(endpointEnvVar: string): S3Client {
  return new S3Client({
    endpoint: normalizeEndpoint(requireEnv(endpointEnvVar)),
    region: process.env.S3_REGION ?? "us-east-1",
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: {
      accessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
    },
  });
}

let _internal: S3Client | null = null;
let _public: S3Client | null = null;
let _bucketEnsured = false;

function internalClient(): S3Client {
  if (!_internal) _internal = makeClient("S3_ENDPOINT");
  return _internal;
}

function publicClient(): S3Client {
  if (!_public) _public = makeClient("S3_PUBLIC_ENDPOINT");
  return _public;
}

function bucket(): string {
  return requireEnv("S3_BUCKET");
}

function keyFor(sha256: string): string {
  return `blobs/${sha256}`;
}

function sha256Hex(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function ensureBucket(): Promise<void> {
  if (_bucketEnsured) return;
  const client = internalClient();
  const Bucket = bucket();
  try {
    await client.send(new HeadBucketCommand({ Bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket }));
  }
  _bucketEnsured = true;
}

export async function hasBlob(sha256: string): Promise<boolean> {
  try {
    await internalClient().send(new HeadObjectCommand({ Bucket: bucket(), Key: keyFor(sha256) }));
    return true;
  } catch {
    return false;
  }
}

export async function putBlob(
  content: Buffer | string,
  contentType: string,
): Promise<{ sha256: string; size: number; alreadyExisted: boolean }> {
  const buf = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  const sha256 = sha256Hex(buf);
  const size = buf.byteLength;

  if (await hasBlob(sha256)) {
    return { sha256, size, alreadyExisted: true };
  }

  await internalClient().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: keyFor(sha256),
      Body: buf,
      ContentType: contentType,
      ContentLength: size,
    }),
  );
  return { sha256, size, alreadyExisted: false };
}

export async function getBlobContent(sha256: string): Promise<Buffer> {
  const res = await internalClient().send(
    new GetObjectCommand({ Bucket: bucket(), Key: keyFor(sha256) }),
  );
  if (!res.Body) {
    throw new Error(`Blob ${sha256} has no body`);
  }
  const bytes = await res.Body.transformToByteArray();
  return Buffer.from(bytes);
}

export async function getPresignedDownloadUrl(
  sha256: string,
  filename: string,
  contentType: string,
  expiresInSeconds = 3600,
): Promise<string> {
  return getSignedUrl(
    publicClient(),
    new GetObjectCommand({
      Bucket: bucket(),
      Key: keyFor(sha256),
      ResponseContentDisposition: `attachment; filename="${filename.replace(/"/g, "")}"`,
      ResponseContentType: contentType,
    }),
    { expiresIn: expiresInSeconds },
  );
}
