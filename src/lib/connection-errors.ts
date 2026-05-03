/**
 * Map raw errors thrown by the Tauri/S3 backend during the connection-form
 * Test/Save flow to a short, action-focused message. The goal is one line
 * the user can act on — never a wall of SDK/HTTP detail.
 *
 * Pure function so it can be unit-tested without rendering the modal.
 */
export interface FriendlyErrorContext {
  /** Whether the user has typed any bucket name(s) in the Buckets field. */
  hasBucketFilter: boolean;
}

export function friendlyConnectionError(
  err: unknown,
  ctx: FriendlyErrorContext,
): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  if (
    lower.includes("accessdenied") ||
    lower.includes("not authorized") ||
    lower.includes("forbidden") ||
    lower.includes("listbuckets")
  ) {
    return ctx.hasBucketFilter
      ? "Access denied. Check the access key has read access to the listed bucket(s)."
      : "Access denied. If the key is bucket-scoped, list bucket name(s) in the Buckets field below.";
  }
  if (lower.includes("signaturedoesnotmatch")) {
    return "Wrong Secret Access Key. Re-paste it — extra whitespace is the usual cause.";
  }
  if (lower.includes("invalidaccesskeyid")) {
    return "Unknown Access Key ID for this provider.";
  }
  if (lower.includes("nosuchbucket")) {
    return "Bucket not found. Check the name and region.";
  }
  if (
    lower.includes("dispatch failure") ||
    lower.includes("dns error") ||
    lower.includes("connection refused") ||
    lower.includes("timed out") ||
    lower.includes("network")
  ) {
    return "Couldn't reach the endpoint. Check the URL and your internet connection.";
  }
  // Last resort: keep the message short. Most SDK errors are several lines
  // of cause-chain detail — truncate to the first line so the toast stays
  // readable. The full text is still in the dev console.
  const firstLine = raw.split("\n", 1)[0]?.trim() ?? raw;
  if (firstLine.length > 200) return firstLine.slice(0, 197) + "…";
  return firstLine;
}
