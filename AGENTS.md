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
- The object browser Type column shows the real `Content-Type` returned by a per-file HEAD request (batched, concurrency-limited in `commands_s3::head_object_content_types`); it falls back to the extension-based default while requests are in flight.
- If a saved connection behaves differently from a form test, inspect keychain persistence before changing S3 logic.

## Readability and Review

- Apply YAGNI (You Aren't Gonna Need It): implement only current requirements.
  Do not add speculative features, configuration, dependencies, or abstractions
  for hypothetical future needs.
- Keep changes focused and easy to review; avoid unrelated cleanup.
- Prefer descriptive names and straightforward code over unnecessary wrappers
  or abstractions. Keep individual CI checks visible as named workflow steps.
- Explain non-obvious decisions with concise comments. Review the final diff
  and summarize what changed, why, and how it was verified.

## Validation

- Before handing off code changes, and before any separately authorized commit
  or push, run `pnpm check` and fix failures. This installs the frozen lockfile,
  runs ESLint with zero warnings, frontend tests, the production build including
  TypeScript, and locked Rust checks for all targets and backend tests.
- For changes to dependencies, build configuration, Rust code, packaging, or
  GitHub workflows, run `pnpm check:release` instead. It includes `pnpm check`
  and builds unsigned app/DMG bundles for both Apple Silicon and Intel macOS.
- Stop development servers before these checks: development and production
  builds share generated output. Run checks sequentially with packaging.
- `.github/workflows/smoke.yml` keeps each check in a separately named step.
  Keep its commands and flags in sync with `scripts/check.sh` whenever either
  changes; never bypass a failing check with
  `continue-on-error` or by disabling lint rules to make CI green.
- Report the checks actually completed and any environment blockers. Local
  validation does not verify GitHub permissions, publishing, Apple signing,
  notarization, or live storage-provider behavior.
- Use `pnpm tauri dev` for desktop interaction checks and `pnpm dev --port 1420`
  for frontend-only checks when relevant to the change.
<!-- END:nextjs-agent-rules -->
