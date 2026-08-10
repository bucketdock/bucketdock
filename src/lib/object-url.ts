import type { Connection } from "@/lib/tauri";

/** 根据连接配置生成对象的公开访问 URL，不包含签名参数。 */
export function buildPublicObjectUrl(
  connection: Connection | undefined,
  bucket: string,
  objectKey: string,
): string | null {
  if (!connection || !bucket || !objectKey) return null;

  const encodedBucket = encodeURIComponent(bucket);
  const encodedKey = objectKey
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  if (connection.provider === "aws" && !connection.endpoint) {
    const region = connection.region.trim() || "us-east-1";
    return `https://${encodedBucket}.s3.${region}.amazonaws.com/${encodedKey}`;
  }

  const endpoint = connection.endpoint?.trim().replace(/\/$/, "");
  if (!endpoint) return null;
  return `${endpoint}/${encodedBucket}/${encodedKey}`;
}
