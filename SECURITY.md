# BucketDock — Security Model

This document describes how BucketDock handles your S3 / R2 / S3-compatible
credentials and what trust assumptions the application makes.

## TL;DR

- **Secret access keys are stored in the macOS Keychain** (`keyring` crate,
  service identifier `com.bucketdock.app`). The Keychain encrypts them at rest
  using your login password, and macOS gates access to that user account.
- Non-secret connection metadata (name, region, endpoint, access key id, bucket
  filter) is stored in a plain JSON file at:
  `~/Library/Application Support/BucketDock/connections.json`
- Credentials are **only ever sent to the S3 endpoint you configured** to sign
  AWS SigV4 API requests. No telemetry. No third-party services.
- The app is fully **local-first** and runs offline (apart from talking to the
  S3 endpoint).

## Where each piece of data lives

| Data                       | Storage                                                                  | Encrypted? |
|----------------------------|--------------------------------------------------------------------------|------------|
| Secret Access Key          | macOS Keychain (`com.bucketdock.app`, account = connection UUID)         | Yes (login keychain) |
| Access Key ID              | `~/Library/Application Support/BucketDock/connections.json`              | No (filesystem perms only) |
| Endpoint / Region / Name   | Same JSON file                                                           | No |
| Object data (downloads)    | Wherever you choose via the system file dialog                           | N/A |

The JSON file is only readable by your user account (standard macOS user-home
permissions). The secret access key field on the in-memory `Connection` struct
is annotated with `#[serde(skip)]` so it is **never** serialized to the file or
returned to the frontend over the IPC boundary.

## Network surface

- All S3 API calls go through `aws-sdk-s3` over **HTTPS** by default.
- AWS Signature V4 is used; **secrets never leave the device on the wire** —
  only HMAC signatures derived from them.
- Presigned URLs (used to "open" a file in your default browser) are generated
  locally and have a 1-hour expiry. Be aware they are written to your
  browser's history.
- If you configure a `http://` endpoint (S3-compatible servers on a local
  network), the app shows an inline warning in the connection form. Avoid this
  outside trusted networks because it sends your credentials in plain text.

## Tauri / IPC hardening

- A strict **Content Security Policy** is enforced
  (`default-src 'self'; script-src 'self'; connect-src 'self' ipc: …`).
- Capabilities are scoped to the minimum the app needs:
  `core:default`, `dialog:default`, `opener:default`. The `tauri-plugin-fs`
  plugin is **not enabled**; all filesystem IO goes through Rust commands that
  the frontend cannot bypass.
- The Tauri command surface is explicit (`generate_handler!`) — only the
  listed commands are reachable from the renderer.
- Tauri 2 disables WebKit DevTools in `--release` builds by default.

## Threat model & non-goals

BucketDock protects against:
- An attacker reading credentials from disk without your login password
  (they're in the Keychain).
- Network observers (everything is HTTPS by default; SigV4 hides the secret).
- Untrusted scripts loaded into the WebView (CSP blocks remote origins).

BucketDock **does not** protect against:
- A privileged process running as your macOS user (it can ask the Keychain for
  the secret just like the app does).
- A compromised AWS/R2 account — credential rotation/revocation is on you.
- Physical access while unlocked.

## Supply chain

- Open-source dependencies pinned via `Cargo.lock` and `pnpm-lock.yaml`.
- Code is small and auditable. Review the `src-tauri/src/connections.rs`,
  `state.rs`, and `commands_conns.rs` modules to verify exactly how secrets
  are handled.

## Reporting a vulnerability

Open an issue (or a private security advisory if the platform supports it) at
the project repository.
