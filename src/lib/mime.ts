// We deliberately do not maintain an extension → MIME map for the object
// browser's Type column. The value shown there should reflect what S3
// actually stores, not a guess derived from the file extension. See
// `s3DefaultContentType` below.

/**
 * Return the type label shown in the object browser's Type column.
 *
 * S3 itself doesn't auto-detect a content type when an object is uploaded
 * without one; AWS, Cloudflare R2 and most S3-compatible providers store the
 * default `application/octet-stream` in that case. The list_objects_v2 API
 * also doesn't return Content-Type at all, so the only honest thing the
 * browser can show without an extra HEAD request per row is the S3 default.
 *
 * The real per-object Content-Type (and an editor for it) lives in the Get
 * Info modal, which performs a HEAD against the object.
 */
export function s3DefaultContentType(key: string): string {
  if (!key || key.endsWith("/")) return "—";
  return "application/octet-stream";
}

/**
 * Return the lowercase file extension (no leading dot), or "" if the key has
 * none. Used as a sort key for the Type column so files of the same kind
 * cluster together even though they all display the same MIME label.
 */
export function fileExtension(key: string): string {
  if (!key || key.endsWith("/")) return "";
  const base = key.split("/").filter(Boolean).pop() ?? key;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

/**
 * @deprecated kept only as an alias of {@link s3DefaultContentType} so any
 * remaining call sites keep compiling. New code should use the explicit
 * helper.
 */
export function mimeFromExtension(key: string): string {
  return s3DefaultContentType(key);
}
