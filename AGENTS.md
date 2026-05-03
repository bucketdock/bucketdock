<!-- BEGIN:nextjs-agent-rules -->

# BucketDock Agent Notes

## Project Shape

BucketDock is a macOS desktop app built from:

- Next.js 16 App Router frontend in `src/`
- Tauri 2 shell and Rust backend in `src-tauri/`
- AWS SDK based S3 client in `src-tauri/src/s3.rs`

The frontend never talks to S3 directly. All storage operations go through Tauri commands.

## Next.js Rule

This repo uses Next.js 16. Do not rely on stale framework knowledge.

For Next.js-specific behavior, APIs, config, and conventions:

- use the official Next.js docs first
- prefer the MCP Next.js docs flow when available
- keep changes compatible with the App Router setup already in `src/app/`

## Backend Facts

- Connection metadata is stored in `~/Library/Application Support/BucketDock/connections.json`
- Secret access keys are stored in the macOS Keychain under service `com.bucketdock.app`
- Since the keychain refactor, every secret lives inside a **single bundled keychain entry** with account `bucketdock://secrets-v2` (a JSON `{id -> secret}` map). Legacy per-id entries are migrated forward on first read and then deleted. Do not reintroduce per-id `Entry::new(service, id)` calls outside the migration path in `connections.rs`.
- The Rust backend uses `keyring` with the native macOS backend enabled
- `S3Client::from_connection` is the main credential and endpoint assembly point

## Cloudflare R2 Rules

- use the account endpoint, not a bucket-appended URL
- keep region set to `auto`
- bucket-scoped credentials must set `bucket_filter`
- the backend currently forces path-style addressing for `r2` and `custom` providers

## High-Value Files

- `src/components/connection-form-modal.tsx`: add/edit/test connection UI
- `src/components/connections-sidebar.tsx`: saved connection list and bucket loading
- `src/components/object-browser.tsx`: main browser UI and object actions
- `src/components/transfer-queue.tsx`: bottom-right transfer dock (progress, cancel, retry)
- `src/components/copy-to-modal.tsx`: bucket-to-bucket copy destination picker (files and folders)
- `src/components/object-info-modal.tsx`: object info viewer + headers/metadata editor (`mode="info" | "edit"`)
- `src/components/file-preview-modal.tsx`: inline preview for images / audio / video / PDF / text
- `src/store/transfers-store.ts`: transfer queue state, dispatches tracked Tauri commands
- `src/lib/tauri.ts`: frontend Tauri command bridge
- `src-tauri/src/commands_conns.rs`: add/update/delete/test connection commands
- `src-tauri/src/commands_s3.rs`: bucket and object command handlers
- `src-tauri/src/commands_transfers.rs`: tracked upload/download/copy + cancel
- `src-tauri/src/connections.rs`: metadata persistence and keychain helpers
- `src-tauri/src/s3.rs`: AWS SDK client configuration and storage operations

## Validation

- backend: `cargo check --manifest-path src-tauri/Cargo.toml`
- backend tests (gating CI): `cargo test --manifest-path src-tauri/Cargo.toml`
- frontend tests (gating CI): `pnpm test` (Vitest + jsdom). New helpers belong in `src/lib/` so they can be imported directly into `*.test.ts` files without rendering the UI.
- desktop app: `pnpm tauri dev`
- frontend only: `pnpm dev --port 1420`

## Guardrails

- Object tags, Finder reveal, and bucket policy inspection are not implemented. Do not claim them.
- Folder rename / move and cross-bucket folder copy are implemented as recursive copy-and-delete (`rename_prefix` and bulk `copy_object_tracked`); they are not atomic server-side operations.
- The Type column in the object browser is **not** derived from extension. It uses `s3DefaultContentType()` from `src/lib/mime.ts`, which always returns `application/octet-stream` for files (and an em-dash for folders) — the value S3 itself defaults to when no `Content-Type` is set on PutObject. The real `Content-Type` reported by the server is shown in the Get Info modal only — list_objects_v2 does not include it.
- Bucket-to-bucket copy uses pure helpers in `src/lib/copy-targets.ts` (`normalizeDstPrefix`, `selfCopyReason`) so the self-overwrite guard can be unit-tested without rendering the modal. Keep those helpers free of React / Tauri imports.
- When a `list_buckets` call fails on a connection that has no bucket filter, **do not** raise a toast — `BucketsPane` already renders the error inline with an Edit Connection action. Toasting again was the source of duplicated error popups.
- Connection inputs flow through `connections::validate_input` and bucket filters through `connections::parse_bucket_filter`; do not reintroduce ad-hoc validation or splitting.
- The native macOS application menu lives in `src-tauri/src/lib.rs`. Help links open via `tauri-plugin-opener`; everything else emits the `menu://action` event with the menu item id, listened to by `object-browser.tsx` and `connections-sidebar.tsx`.
- Multipart uploads emit per-part progress; single-PutObject uploads still emit only start / complete.
- If a saved connection behaves differently from a form test, inspect keychain persistence before changing S3 logic.
- Backend Rust unit tests are required to pass in CI (Smoke workflow); add new tests under `#[cfg(test)] mod tests` next to the code they cover.
- Prefer small, local changes around the owning abstraction instead of broad rewrites.
<!-- END:nextjs-agent-rules -->
