<table style="border: none;">
  <tr style="border: none;">
    <td width="88" style="border: none;">
      <img src="src-tauri/icons/128x128.png" alt="BucketDock icon" width="72" height="72" />
    </td>
    <td style="border: none;">
      <h1>BucketDock</h1>
      <p>Native macOS desktop browser for S3-compatible object storage.</p>
    </td>
  </tr>
</table>

It combines:

- a Next.js 16 + React 19 frontend
- a Tauri 2 desktop shell
- a Rust backend that performs all storage operations

BucketDock is built for AWS S3, Cloudflare R2, and other S3-compatible providers when you want a desktop UI instead of the CLI or a browser dashboard.

## Implemented Features

### Connections

- Multiple saved connections
- Providers: AWS S3, Cloudflare R2, generic S3-compatible endpoints
- Connection testing from the UI
- Optional fixed bucket list for scoped credentials
- Edit and delete connection profiles

### Bucket And Object Browsing

- Bucket sidebar per connection
- Folder-like navigation over object prefixes
- Breadcrumb navigation
- Multi-select in the current listing
- Context menus for common actions
- Empty states and loading skeletons

### Object Operations

- Upload files
- Upload folders recursively
- Drag-and-drop file upload into the current prefix
- Download a file
- Download multiple selected items
- Download folders recursively
- Create folder placeholder objects
- Rename objects
- Delete single objects
- Delete multiple selected objects
- Delete prefixes recursively
- Open a file through a presigned URL

### Metadata

- View object size, modified time, ETag, and key
- Edit Content-Type
- Edit Cache-Control
- Edit Content-Disposition
- Edit Content-Encoding
- Edit Content-Language
- Edit custom user metadata

### Desktop Behavior

- Native macOS window via Tauri
- Native file and directory pickers
- macOS Keychain secret storage
- Light and dark appearance support
- Persistent sidebar width
- Persistent selected connection, bucket, and prefix state

## Not Implemented Yet

The following items are not implemented in the current codebase and should not be treated as shipped features:

- object tags
- search and filter UI
- user-selectable sort controls
- transfer queue or per-transfer progress UI
- folder rename or move
- Finder reveal or open-downloaded-file action
- bucket policy inspection

## Keyboard Shortcuts

Current object browser shortcuts:

- `Delete` or `Backspace` with a selection: delete selected items
- `Enter` with one selected folder: open that folder
- `Cmd+A` or `Ctrl+A`: select all visible items
- `Cmd+I` or `Ctrl+I`: open info for one selected file

## Architecture

BucketDock uses a split desktop architecture:

```text
Next.js frontend
  -> Tauri command bridge
    -> Rust backend
      -> AWS SDK for S3 / R2 / compatible providers
```

The frontend never talks directly to S3.

All storage requests are executed by the Rust backend through Tauri commands. That keeps request signing logic and secrets out of the browser runtime.

## Local Data And Secrets

Connection metadata is stored in:

```text
~/Library/Application Support/BucketDock/connections.json
```

Stored there:

- connection name
- provider
- endpoint
- region
- access key id
- optional bucket list

Secret access keys are stored separately in the macOS Keychain under the service name:

```text
com.bucketdock.app
```

If a connection was created before native Keychain persistence was enabled, edit that connection, enter the Secret Access Key again, and save it once so the secret is written into the macOS Keychain.

## Repository Layout

```text
bucketdock/
├── src/
│   ├── app/                    # Next.js app router entrypoints and global styles
│   ├── components/             # Desktop UI, browser, forms, modals, primitives
│   ├── lib/                    # Tauri bridge helpers and shared utilities
│   └── store/                  # Zustand app state
├── src-tauri/
│   ├── src/
│   │   ├── commands_conns.rs   # Connection management commands
│   │   ├── commands_s3.rs      # Bucket and object commands
│   │   ├── connections.rs      # Metadata persistence and Keychain helpers
│   │   ├── s3.rs               # AWS SDK client setup and S3 operations
│   │   ├── state.rs            # Shared Tauri app state
│   │   └── lib.rs              # Tauri bootstrap and command registration
│   ├── Cargo.toml
│   └── tauri.conf.json
├── next.config.ts
├── package.json
└── README.md
```

## Tech Stack

### Frontend

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS 4
- Zustand
- Sonner
- Lucide React

### Desktop Shell

- Tauri 2
- tauri-plugin-dialog
- tauri-plugin-opener
- tauri-plugin-log

### Backend

- Rust
- aws-config
- aws-sdk-s3
- tokio
- keyring
- chrono
- walkdir

## Development

### Prerequisites

- macOS
- Node.js
- pnpm
- Rust
- Tauri prerequisites for macOS

Tauri setup instructions:

https://tauri.app/start/prerequisites/

### Install Dependencies

```bash
pnpm install
```

### Run The Desktop App

```bash
pnpm tauri dev
```

This starts the Next.js frontend on port `1420` and launches the Tauri shell.

### Run Only The Frontend

```bash
pnpm dev --port 1420
```

This is useful for UI work, but storage operations require the Tauri shell and Rust backend.

### Build

```bash
pnpm tauri build
```

The Next.js frontend is exported to `out/`, and Tauri bundles the macOS app from there.

Build artifacts are written under:

```text
src-tauri/target/release/bundle/
```

### Useful Backend Check

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

## Provider Setup

### AWS S3

Typical AWS S3 setup:

```text
Provider: AWS S3
Region: eu-central-1
Endpoint: leave empty
Buckets: leave empty to auto-list, or set one or more names
```

### Cloudflare R2

Use the account endpoint and keep the bucket name separate.

Standard R2 setup:

```text
Provider: Cloudflare R2
Endpoint: https://<ACCOUNT_ID>.r2.cloudflarestorage.com
Region: auto
Buckets: your-bucket-name
```

If you have access to more than one bucket, the `Buckets` field can contain a comma-, space-, newline-, or semicolon-separated list.

Important rules:

- Do not append the bucket name to the endpoint URL
- Keep region set to `auto`
- For bucket-scoped credentials, enter the exact bucket name in the `Buckets` field
- For jurisdiction-specific R2 endpoints, paste the full endpoint manually

Correct:

```text
Endpoint: https://<ACCOUNT_ID>.r2.cloudflarestorage.com
Buckets: media-assets
Region: auto
```

Incorrect:

```text
Endpoint: https://<ACCOUNT_ID>.r2.cloudflarestorage.com/media-assets
Buckets: media-assets
Region: auto
```

### Generic S3-Compatible Providers

Example:

```text
Provider: S3-Compatible
Endpoint: https://s3.example.com
Region: us-east-1
Buckets: my-bucket
```

## Troubleshooting Cloudflare R2

### SignatureDoesNotMatch

If opening a bucket fails with an error like:

```text
Failed to list objects: S3 error: service error: unhandled error (SignatureDoesNotMatch)
```

check the following first:

1. The endpoint must be the account endpoint, not an endpoint with the bucket appended.
2. The region must be exactly `auto`.
3. The bucket name must be entered separately in the `Buckets` field.
4. If the credentials are scoped to one specific bucket, that bucket must be listed explicitly.
5. Remove any trailing spaces from endpoint, access key id, bucket name, and secret.

For bucket-scoped R2 credentials, BucketDock skips the account-wide `ListBuckets` call and uses the configured bucket names directly.

### Saved Connection Works Only While Editing

If typing the secret into the edit form makes `Test` pass, but testing the saved connection fails, the saved secret is missing. Open `Edit Connection`, enter the Secret Access Key again, and click `Save` so BucketDock can write it into the macOS Keychain.

## Notes On Current Behavior

- Folder rename is not supported yet.
- Object rename is implemented as copy plus delete.
- Recursive folder delete removes all objects under the selected prefix.
- Metadata editing uses a copy-with-replace flow through S3-compatible APIs.
- The frontend is exported statically and loaded by Tauri from `out/`.

## License

This repository does not currently declare a license.
