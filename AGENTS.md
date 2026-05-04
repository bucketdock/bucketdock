<!-- BEGIN:nextjs-agent-rules -->

# BucketDock Agent Notes

BucketDock is a macOS app with a Next.js 16 App Router frontend in `src/` and a Tauri 2 / Rust backend in `src-tauri/`.

## Core Rules

- The frontend never talks to S3 directly. Storage work goes through Tauri commands.
- For Next.js behavior, use current official docs or MCP docs and keep changes compatible with `src/app/`.
- `src-tauri/src/s3.rs` owns S3 client behavior, and `S3Client::from_connection` is the main credential / endpoint assembly point.
- Connection metadata lives in `~/Library/Application Support/BucketDock/connections.json`.
- Secrets live in one bundled macOS Keychain entry: service `com.bucketdock.app`, account `bucketdock://secrets-v2`. Do not reintroduce per-id keychain entries outside the migration path.
- For Cloudflare R2, use the account endpoint, keep region `auto`, and require `bucket_filter` for bucket-scoped credentials.
- Keep connection validation and parsing in `connections::validate_input` and `connections::parse_bucket_filter`. Keep user-facing connection error classification in `friendlyConnectionError`.

## Guardrails

- Do not claim object tags, Finder reveal, or bucket policy inspection. They are not implemented.
- Folder rename / move and cross-bucket folder copy are recursive copy-and-delete, not atomic server-side operations.
- The object browser Type column is not extension-based; the real `Content-Type` only appears in Get Info.
- If a saved connection behaves differently from a form test, inspect keychain persistence before changing S3 logic.

## Validation

- `cargo check --manifest-path src-tauri/Cargo.toml`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `pnpm test`
- `pnpm tauri dev`
- `pnpm dev --port 1420`
<!-- END:nextjs-agent-rules -->
