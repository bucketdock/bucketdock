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
- `src/components/copy-to-modal.tsx`: bucket-to-bucket copy destination picker
- `src/store/transfers-store.ts`: transfer queue state, dispatches tracked Tauri commands
- `src/lib/tauri.ts`: frontend Tauri command bridge
- `src-tauri/src/commands_conns.rs`: add/update/delete/test connection commands
- `src-tauri/src/commands_s3.rs`: bucket and object command handlers
- `src-tauri/src/commands_transfers.rs`: tracked upload/download/copy + cancel
- `src-tauri/src/connections.rs`: metadata persistence and keychain helpers
- `src-tauri/src/s3.rs`: AWS SDK client configuration and storage operations

## Validation

- backend: `cargo check --manifest-path src-tauri/Cargo.toml`
- desktop app: `pnpm tauri dev`
- frontend only: `pnpm dev --port 1420`

## Guardrails

- Do not claim unsupported features are implemented. Search, tags, and folder rename are not shipped.
- Folder copy across buckets is not implemented; only single-file copy through `copy_object_tracked`.
- Upload progress is currently start/complete only — do not claim per-byte upload progress.
- If a saved connection behaves differently from a form test, inspect keychain persistence before changing S3 logic.
- Prefer small, local changes around the owning abstraction instead of broad rewrites.
<!-- END:nextjs-agent-rules -->
