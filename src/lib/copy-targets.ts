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

// ── Folder-browser navigation helpers ────────────────────────────────────────
//
// The destination folder picker inside the copy modal is essentially a tiny
// Finder column — these pure helpers keep the navigation rules unit-testable
// without rendering the modal. The previous implementation accidentally
// concatenated the listing prefix on top of itself when drilling deeper,
// because `listObjects` returns full S3 keys (already containing the parent
// prefix) — see `enterFolderPrefix`.

/** Walk the current browse prefix up by one level. Returns "" at the root. */
export function browseUp(currentPrefix: string): string {
  if (!currentPrefix) return "";
  const trimmed = currentPrefix.replace(/\/$/, "");
  const idx = trimmed.lastIndexOf("/");
  if (idx === -1) return "";
  return trimmed.slice(0, idx + 1);
}

/**
 * Compute the new browse prefix when the user clicks a folder row.
 *
 * `folderKey` is the full S3 key as returned by `listObjects` (e.g.
 * "photos/2024/" when browsing under "photos/"). The new prefix IS the
 * folder key — we must not concatenate it onto the current prefix, or
 * drilling into a sub-folder would produce "photos/photos/2024/" and the
 * next listing would be empty.
 */
export function enterFolderPrefix(folderKey: string): string {
  if (!folderKey) return "";
  return folderKey.endsWith("/") ? folderKey : folderKey + "/";
}

/** Display label for a folder row inside the browser. */
export function folderRowLabel(
  folderKey: string,
  currentBrowsePrefix: string,
): string {
  const slice = folderKey.startsWith(currentBrowsePrefix)
    ? folderKey.slice(currentBrowsePrefix.length)
    : folderKey;
  return slice.replace(/\/$/, "");
}

export interface BrowseCrumb {
  /** Visible label, e.g. the bucket name or a single folder segment. */
  label: string;
  /** Prefix to navigate to when this crumb is clicked (root = ""). */
  prefix: string;
}

/**
 * Build breadcrumbs for the current browse prefix. The first crumb is always
 * the bucket (which navigates back to the root prefix). Each subsequent
 * crumb represents one folder segment and navigates to that depth.
 */
export function browseBreadcrumbs(
  bucket: string,
  currentPrefix: string,
): BrowseCrumb[] {
  const crumbs: BrowseCrumb[] = [{ label: bucket, prefix: "" }];
  if (!currentPrefix) return crumbs;
  const segments = currentPrefix.replace(/\/$/, "").split("/").filter(Boolean);
  let acc = "";
  for (const seg of segments) {
    acc += seg + "/";
    crumbs.push({ label: seg, prefix: acc });
  }
  return crumbs;
}
