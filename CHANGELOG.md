# Changelog

## Unreleased

### Features

- Browser: Type column now reports the **default Content-Type S3 would assign** when no explicit type is set — `application/octet-stream` for files (including `.ttf`, `.svg`, `.txt`, `.png`, `.tar.gz`, etc.) and `—` for folders. The real `Content-Type` returned by the server is shown in Get Info.
- Browser: when a connection is selected without a bucket, the right pane now shows a Finder-style grid of buckets with cards instead of an empty state.
- Browser: when listing buckets fails because the credentials are scoped (no `s3:ListBuckets`), the bucket pane now explains the situation inline and offers a one-click **Edit Connection** button instead of relying on a toast that disappears.
- Copy to bucket: the destination prefix field now supports **browsing** the destination bucket (folder picker) and refuses to enqueue a copy that would overwrite the source files (same connection + bucket + identical destination, or destination nested inside a selected folder).
- Connections: the Secret Access Key for every connection is now stored in a **single Keychain entry** (`com.bucketdock.app` / `bucketdock://secrets-v2`). On first run after upgrade, legacy per-connection entries are migrated automatically and removed. The macOS keychain prompt is shown once and reused across the session.
- Browser: Rename / move support inside the same bucket — slashes in the new name move the object (or folder) into a sub-prefix.
- Browser: top toolbar reorganised — Refresh moved to the very right; Delete removed from the toolbar (still available from the per-row "…" menu and right-click), and the toolbar now wraps onto a second line on narrow windows so buttons can never overflow off-screen.
- Native macOS application menu — File (New Connection / New Folder / Upload Files / Upload Folder / Refresh / Get Info, with standard ⌘ accelerators), Edit (with native Cut / Copy / Paste / Find), View, Window and Help (Visit Website, Documentation, GitHub Repository, Report an Issue, About).
- Window is now draggable from a taller titlebar zone — the `core:window:allow-start-dragging` capability is now in `default.json`, fixing the "window.start_dragging not allowed" error.
- Connections: input is now validated client- and server-side with friendlier error messages (for AWS `AccessDenied`, `SignatureDoesNotMatch`, `InvalidAccessKeyId`, `NoSuchBucket`, network failures, etc.). When credentials are scoped to specific buckets and the user hasn't filled in the Buckets field, the error explicitly suggests it.
- CI: backend Rust unit tests (`cargo test`) **and** a new Vitest frontend suite (`pnpm test`) now gate the Smoke workflow and therefore every release. The frontend suite covers the Tauri IPC bridge command names + argument shapes, the secret-leak invariants, the app-store navigation reducer, the copy-to self-overwrite guard, and the MIME helper.

### Features (previous unreleased entries)

- Browser: inline filter box and sortable columns (Name, Type, Storage Class, Size, Modified) with per-row actions menu.
- Browser: dedicated "Get Info" view and a separate "Edit Headers" editor for object metadata.
- Browser: inline preview for images, audio, video, PDFs, and text files (range-fetched, capped at a few MiB).
- Browser: delete confirmation now lists the items that will be removed.
- Folders: rename / move support across an entire prefix (recursive copy + delete).
- Cross-bucket: copy whole folders between buckets (recursive multi-file copy).
- Transfer queue: per-byte upload progress for multipart uploads (previously start / complete only).
- UI: object listing exposes Storage Class; Modified column shows a short timestamp with the full date / relative time on hover.

### Fixes

- Upload menu was being painted behind the table header due to the sticky header's stacking context.

## [0.1.7](https://github.com/bucketdock/bucketdock/compare/v0.1.6...v0.1.7) (2026-05-03)

### Bug Fixes

- github workflow ([8789135](https://github.com/bucketdock/bucketdock/commit/8789135fd299ac08fc83cf4f7b3a7c541dbe1bc8))

## [0.1.6](https://github.com/bucketdock/bucketdock/compare/v0.1.5...v0.1.6) (2026-05-02)

### Bug Fixes

- fix github workflow ([e63113a](https://github.com/bucketdock/bucketdock/commit/e63113ae3ddf4b15c614d33402d1b5650df7579b))

## [0.1.5](https://github.com/bucketdock/bucketdock/compare/v0.1.4...v0.1.5) (2026-05-02)

### Bug Fixes

- fix links in README.md ([37f4b82](https://github.com/bucketdock/bucketdock/commit/37f4b826b51778e2f788289124b92d9628c6c3d6))
- fix website links ([9297bc5](https://github.com/bucketdock/bucketdock/commit/9297bc5ec7397708eb9e9a30735ea3367b034e2a))

## [0.1.4](https://github.com/bucketdock/bucketdock/compare/v0.1.3...v0.1.4) (2026-05-02)

### Bug Fixes

- iniate relese creation ([3802ab0](https://github.com/bucketdock/bucketdock/commit/3802ab0f29b9c86c35c6fd7deda7ac359a0e8492))

## [0.1.3](https://github.com/bucketdock/bucketdock/compare/v0.1.2...v0.1.3) (2026-05-02)

### Features

- improve installation instructions ([66a7a4f](https://github.com/bucketdock/bucketdock/commit/66a7a4f9dbb263288d013baa191f8bbfd96ce62e))

## [0.1.2](https://github.com/bucketdock/bucketdock/compare/v0.1.1...v0.1.2) (2026-05-01)

### Bug Fixes

- package versions ([34177a6](https://github.com/bucketdock/bucketdock/commit/34177a6fa01df0816da29cf0d766340517d4b00c))

## [0.1.1](https://github.com/bucketdock/bucketdock/compare/v0.1.0...v0.1.1) (2026-05-01)

### Features

- add basic coping from bucket to bucket, basic progress ([4cc0a89](https://github.com/bucketdock/bucketdock/commit/4cc0a892ab5e91c0b66bc8e6b89f6b437a15e554))
- add basic website ([8dfa608](https://github.com/bucketdock/bucketdock/commit/8dfa60869a74c2f903e50d17f369084145197e29))
- add github workflows ([70b00a3](https://github.com/bucketdock/bucketdock/commit/70b00a345a6c94fb555a5b7354e5d01a19292c7a))
- basic README.md ([ef07acb](https://github.com/bucketdock/bucketdock/commit/ef07acbaa22a0c60ddffd22d7b074c2dd47d023d))
- fix determining keys, improve readme ([a58c5ae](https://github.com/bucketdock/bucketdock/commit/a58c5ae2569cb7c0d0ad71de67e0c47d8056c232))
- improve README.md ([7361da3](https://github.com/bucketdock/bucketdock/commit/7361da3160c43bf1e9ecaab7b65124b8089b882e))
- use tauri, add basic functionality ([a99e203](https://github.com/bucketdock/bucketdock/commit/a99e203bb65b063cbd63026b3b62c2ae33b3d4d8))
