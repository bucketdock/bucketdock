/**
 * Pure helpers used by the bucket-to-bucket copy modal. Extracted here so
 * the validation logic (especially the "would overwrite the source" guard)
 * can be unit-tested without rendering the UI.
 */

export interface CopyTarget {
  srcConnectionId: string;
  srcBucket: string;
  /** Current folder the user is browsing (the source location). */
  srcPrefix: string;
  /** Selected source keys; folders end with "/". */
  selectedKeys: string[];

  dstConnectionId: string;
  dstBucket: string;
  /** Raw text the user typed (or empty). */
  dstPrefixRaw: string;
}

/** Normalize a user-typed destination prefix (trim + ensure trailing slash). */
export function normalizeDstPrefix(raw: string): string {
  const p = raw.trim();
  if (p === "") return "";
  return p.endsWith("/") ? p : p + "/";
}

/**
 * Returns a user-facing reason string when the copy would overwrite the
 * source files (same connection + bucket + a destination that resolves to
 * the source location), or null when the operation is safe to enqueue.
 *
 * This is intentionally a pure function — no toast, no IPC, no React.
 */
export function selfCopyReason(t: CopyTarget): string | null {
  if (t.dstConnectionId !== t.srcConnectionId) return null;
  if (t.dstBucket !== t.srcBucket) return null;

  const dst = normalizeDstPrefix(t.dstPrefixRaw);

  // Copying back into the same folder = self-overwrite for every file.
  if (dst === t.srcPrefix) {
    return "Pick a different destination — copying the selection back into the same folder would overwrite the source files.";
  }
  // Copying into one of the selected folders (or below it).
  for (const k of t.selectedKeys) {
    if (k.endsWith("/") && (dst === k || dst.startsWith(k))) {
      return `The destination is inside "${k}", which is one of the items being copied. Pick a different folder.`;
    }
  }
  return null;
}
