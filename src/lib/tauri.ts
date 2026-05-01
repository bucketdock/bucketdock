import { invoke } from "@tauri-apps/api/core";

// ── Types ────────────────────────────────────────────────────────────────────

export type Provider = "aws" | "r2" | "custom";

export interface Connection {
  id: string;
  name: string;
  provider: Provider;
  endpoint: string | null;
  region: string;
  access_key_id: string;
  bucket_filter: string | null;
}

export interface ConnectionInput {
  name: string;
  provider: Provider;
  endpoint: string | null;
  region: string;
  access_key_id: string;
  secret_access_key: string;
  bucket_filter: string | null;
}

export interface BucketInfo {
  name: string;
  creation_date: string | null;
}

export interface ObjectInfo {
  key: string;
  size: number;
  last_modified: string | null;
  etag: string | null;
}

export interface ListPage {
  folders: string[];
  files: ObjectInfo[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function call<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    // Tauri commands serialize Rust errors as { kind, message }.
    // Unwrap to a real Error so toasts/UI show a useful string.
    if (err && typeof err === "object") {
      const obj = err as { message?: unknown; kind?: unknown };
      if (typeof obj.message === "string" && obj.message.length > 0) {
        const e = new Error(obj.message);
        if (typeof obj.kind === "string")
          (e as Error & { kind?: string }).kind = obj.kind;
        throw e;
      }
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
}

// ── Connection commands ───────────────────────────────────────────────────────

export function listConnections(): Promise<Connection[]> {
  return call("list_connections");
}

export function addConnection(input: ConnectionInput): Promise<Connection> {
  return call("add_connection", { input });
}

export function updateConnection(
  id: string,
  input: ConnectionInput,
): Promise<Connection> {
  return call("update_connection", { id, input });
}

export function deleteConnection(id: string): Promise<void> {
  return call("delete_connection", { id });
}

export function testConnection(input: ConnectionInput): Promise<number> {
  return call("test_connection", { input });
}

// ── Bucket commands ───────────────────────────────────────────────────────────

export function listBuckets(connectionId: string): Promise<BucketInfo[]> {
  return call("list_buckets", { connectionId });
}

// ── Object commands ───────────────────────────────────────────────────────────

export function listObjects(
  connectionId: string,
  bucket: string,
  prefix: string,
  continuationToken?: string | null,
): Promise<ListPage> {
  return call("list_objects", {
    connectionId,
    bucket,
    prefix,
    continuationToken: continuationToken ?? null,
  });
}

export function uploadFile(
  connectionId: string,
  bucket: string,
  key: string,
  localPath: string,
): Promise<void> {
  return call("upload_file", { connectionId, bucket, key, localPath });
}

export function downloadFile(
  connectionId: string,
  bucket: string,
  key: string,
  localPath: string,
): Promise<void> {
  return call("download_file", { connectionId, bucket, key, localPath });
}

export function deleteObject(
  connectionId: string,
  bucket: string,
  key: string,
): Promise<void> {
  return call("delete_object", { connectionId, bucket, key });
}

export function deleteObjects(
  connectionId: string,
  bucket: string,
  keys: string[],
): Promise<void> {
  return call("delete_objects", { connectionId, bucket, keys });
}

export function createFolder(
  connectionId: string,
  bucket: string,
  prefix: string,
): Promise<void> {
  return call("create_folder", { connectionId, bucket, prefix });
}

export function renameObject(
  connectionId: string,
  bucket: string,
  oldKey: string,
  newKey: string,
): Promise<void> {
  return call("rename_object", { connectionId, bucket, oldKey, newKey });
}

export function getPresignedUrl(
  connectionId: string,
  bucket: string,
  key: string,
  expiresInSecs?: number,
): Promise<string> {
  return call("get_presigned_url", {
    connectionId,
    bucket,
    key,
    expiresInSecs: expiresInSecs ?? 3600,
  });
}

export function uploadFolder(
  connectionId: string,
  bucket: string,
  prefix: string,
  localDir: string,
): Promise<[number, number]> {
  return call("upload_folder", { connectionId, bucket, prefix, localDir });
}
export function downloadFolder(
  connectionId: string,
  bucket: string,
  prefix: string,
  localDir: string,
): Promise<[number, number]> {
  return call("download_folder", { connectionId, bucket, prefix, localDir });
}
export function deletePrefix(
  connectionId: string,
  bucket: string,
  prefix: string,
): Promise<number> {
  return call("delete_prefix", { connectionId, bucket, prefix });
}

export interface ObjectMetadata {
  content_type: string | null;
  cache_control: string | null;
  content_disposition: string | null;
  content_encoding: string | null;
  content_language: string | null;
  metadata: Record<string, string>;
  size: number;
  last_modified: string | null;
  etag: string | null;
}

export function getObjectMetadata(
  connectionId: string,
  bucket: string,
  key: string,
): Promise<ObjectMetadata> {
  return call("get_object_metadata", { connectionId, bucket, key });
}

export function updateObjectMetadata(
  connectionId: string,
  bucket: string,
  key: string,
  metadata: ObjectMetadata,
): Promise<void> {
  return call("update_object_metadata", {
    connectionId,
    bucket,
    key,
    metadata,
  });
}

// ── Tracked transfer commands ────────────────────────────────────────────────
//
// These mirror the simple upload/download/copy commands but accept a
// `transferId` so the backend can emit `transfer://progress` events and the
// transfer can be cancelled via `cancelTransfer(transferId)`.

export function uploadFileTracked(
  connectionId: string,
  bucket: string,
  key: string,
  localPath: string,
  transferId: string,
): Promise<void> {
  return call("upload_file_tracked", {
    connectionId,
    bucket,
    key,
    localPath,
    transferId,
  });
}

export function downloadFileTracked(
  connectionId: string,
  bucket: string,
  key: string,
  localPath: string,
  transferId: string,
): Promise<void> {
  return call("download_file_tracked", {
    connectionId,
    bucket,
    key,
    localPath,
    transferId,
  });
}

export function copyObjectTracked(
  srcConnectionId: string,
  srcBucket: string,
  srcKey: string,
  dstConnectionId: string,
  dstBucket: string,
  dstKey: string,
  transferId: string,
): Promise<void> {
  return call("copy_object_tracked", {
    srcConnectionId,
    srcBucket,
    srcKey,
    dstConnectionId,
    dstBucket,
    dstKey,
    transferId,
  });
}

export function cancelTransfer(transferId: string): Promise<void> {
  return call("cancel_transfer", { transferId });
}

export interface TransferProgressEvent {
  id: string;
  status: "running" | "done" | "failed" | "cancelled";
  loaded: number;
  total: number;
  error: string | null;
}
