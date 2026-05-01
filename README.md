# BucketDock

**BucketDock** is a native macOS desktop file manager for AWS S3, Cloudflare R2, and S3-compatible object storage.
It is built with **Tauri**, **Rust**, **Next.js**, and **TypeScript**.
BucketDock gives you a desktop-style interface for browsing buckets, uploading files, downloading objects, deleting files, and managing object metadata without using the AWS CLI or a browser dashboard.

---

## Features

### Storage providers

- AWS S3
- Cloudflare R2
- Custom S3-compatible providers
- MinIO-compatible endpoints
- Other S3-compatible object storage services

### Bucket browser

- Browse objects and folder-like prefixes
- Navigate prefixes like folders
- View object size, last modified date, ETag, content type, and storage class
- Refresh bucket contents
- Search and filter objects
- Sort objects by name, size, type, and last modified date

### File operations

- Upload files
- Upload folders recursively
- Download files
- Download folders recursively
- Delete objects
- Delete prefixes/folders recursively
- Rename or move objects using copy + delete
- Create folder placeholders
- Copy object keys

### Metadata and tags

- View object metadata
- View object tags
- Edit content type
- Edit cache-control
- Edit custom metadata
- Edit object tags

### Desktop experience

- Native macOS desktop app
- Native file picker
- Native folder picker
- Drag-and-drop upload support
- Transfer queue
- Upload/download progress
- Open downloaded files in Finder
- Dark mode
- Keyboard shortcuts

---

## Tech Stack

### Frontend

- [Next.js](https://nextjs.org/)
- [TypeScript](https://www.typescriptlang.org/)
- [Tailwind CSS](https://tailwindcss.com/)
- [shadcn/ui](https://ui.shadcn.com/)
- [TanStack Table](https://tanstack.com/table)
- [Zustand](https://zustand-demo.pmnd.rs/)

### Desktop Shell

- [Tauri v2](https://tauri.app/)

### Backend

- Rust
- `aws-sdk-s3`
- `tokio`
- `serde`
- `keyring`

---

## Architecture

BucketDock uses a split architecture:

```text
BucketDock
├── Next.js frontend
│   ├── UI
│   ├── object browser
│   ├── profile editor
│   ├── transfer queue
│   └── metadata panel
│
└── Rust backend
    ├── S3/R2 API calls
    ├── local filesystem access
    ├── credential storage
    ├── profile management
    └── Tauri commands
```

The frontend does not communicate directly with AWS S3, Cloudflare R2, or any S3-compatible endpoint.

All storage operations are handled by Rust through Tauri commands.

This keeps credentials out of frontend code and avoids exposing secrets to browser APIs.

---

## Security Model

### BucketDock is designed so that:

- S3 credentials are not stored in frontend code
- secrets are not stored in localStorage
- secrets are not stored in plain-text config files
- access keys are stored securely using the operating system keychain
- profile config stores only non-secret metadata
- credentials are never logged
- S3 operations are performed only from the Rust backend

---

## Project Structure

```text
bucketdock/
├── src-tauri/
│ ├── src/
│ │ ├── main.rs
│ │ ├── commands/
│ │ ├── config/
│ │ ├── credentials/
│ │ ├── errors/
│ │ ├── models/
│ │ ├── storage/
│ │ └── transfers/
│ ├── Cargo.toml
│ └── tauri.conf.json
│
├── src/
│ ├── app/
│ ├── components/
│ │ ├── browser/
│ │ ├── metadata/
│ │ ├── profile/
│ │ └── transfers/
│ ├── lib/
│ ├── store/
│ └── types/
│
├── public/
├── package.json
├── next.config.ts
├── tailwind.config.ts
└── README.md
```

---

## Getting Started

### Prerequisites

Install:

- Node.js
- npm, pnpm, or yarn
- Rust
- Tauri prerequisites for macOS

For Tauri setup instructions, see:

https://tauri.app/start/prerequisites/

---

### Install Dependencies

Using npm:

```bash
npm install
```

Using pnpm:

```bash
pnpm install
```

---

### Run in Development

```bash
npm run tauri dev
```

or:

```bash
pnpm tauri dev
```

---

### Build the macOS App

```bash
npm run tauri build
```

or:

```bash
pnpm tauri build
```

The built app will be created inside:

```text
src-tauri/target/release/bundle/
```

---

### Next.js Static Export

BucketDock is intended to run as a static frontend inside Tauri.

The Next.js config should use static export:

```typescript
const nextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
};
export default nextConfig;
```

---

### Cloudflare R2 Setup

Cloudflare R2 is S3-compatible, but it uses slightly different configuration from AWS S3.

Standard R2 endpoint

Use:

```text
Endpoint: https://<ACCOUNT_ID>.r2.cloudflarestorage.com
Region: auto
Bucket: your-bucket-name
Path-style addressing: true
```

Example:

```text
Endpoint: https://9cxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.r2.cloudflarestorage.com
Region: auto
Bucket: attributionhub
Path-style addressing: true
```

Do not include the bucket name in the endpoint.

Correct:

```text
Endpoint: https://9cxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.r2.cloudflarestorage.com
Bucket: attributionhub
```

Incorrect:

```text
Endpoint: https://9cxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.r2.cloudflarestorage.com/attributionhub
Bucket: attributionhub
```

EU / jurisdiction-specific R2 endpoint

For jurisdiction-specific buckets, use the jurisdiction in the endpoint.

Example:

```text
Endpoint: https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com
Region: auto
Bucket: your-bucket-name
Path-style addressing: true
```

Recommended Cloudflare R2 values

```text
Provider: Cloudflare R2
Region: auto
Path-style addressing: true
```

---

### AWS S3 Setup

For AWS S3, use the normal AWS region and bucket name.

Example:

```text
Provider: AWS S3
Region: eu-central-1
Bucket: my-bucket
Endpoint: empty
Path-style addressing: false
```

For AWS S3-compatible custom endpoints, provide the endpoint URL manually.

---

### Custom S3-Compatible Setup

Example for a custom S3-compatible provider:

```text
Provider: Custom S3
Endpoint: https://s3.example.com
Region: us-east-1
Bucket: my-bucket
Path-style addressing: true
```

Some providers require path-style addressing. Others support virtual-hosted-style addressing.

If connection testing works but listing objects fails, check:

- endpoint URL
- region
- bucket name
- path-style addressing
- access key permissions
- secret key
- whether the bucket name was accidentally added to the endpoint

---

## Common Cloudflare R2 Error

### SignatureDoesNotMatch

If you see:

```text
SignatureDoesNotMatch
The request signature we calculated does not match the signature you provided.
```

Check that your R2 profile does not include the bucket name inside the endpoint URL.

Use:

```text
Endpoint: https://<ACCOUNT_ID>.r2.cloudflarestorage.com
Bucket: your-bucket-name
Region: auto
Path-style addressing: true
```

Not:

```text
Endpoint: https://<ACCOUNT_ID>.r2.cloudflarestorage.com/your-bucket-name
```

Also make sure:

- region is auto
- endpoint starts with https://
- there are no trailing spaces
- bucket name contains only the bucket name
- test connection and object listing use the same normalized profile config

---

## Planned Tauri Commands

BucketDock uses Tauri commands to communicate between the frontend and Rust backend.

```text
list_profiles()
get_profile(profile_id)
save_profile(profile)
delete_profile(profile_id)
test_profile_connection(profile_id)

list_objects(profile_id, prefix)
upload_file(profile_id, local_path, destination_key)
upload_folder(profile_id, local_folder_path, destination_prefix)
download_file(profile_id, object_key, destination_path)
download_folder(profile_id, prefix, destination_folder_path)

delete_object(profile_id, object_key)
delete_objects(profile_id, object_keys)
count_prefix_objects(profile_id, prefix)
delete_prefix(profile_id, prefix)

create_folder(profile_id, prefix)
rename_object(profile_id, source_key, destination_key)

get_object_metadata(profile_id, object_key)
update_object_metadata(profile_id, object_key, metadata_update)

get_object_tags(profile_id, object_key)
update_object_tags(profile_id, object_key, tags)

reveal_in_finder(path)
choose_files()
choose_folder()
```

---

## Keyboard Shortcuts

```text
Shortcut Action
Cmd + N New profile
Cmd + R Refresh
Cmd + U Upload
Cmd + D Download
Delete Delete selected object
Enter Open folder/prefix
Backspace Go to parent prefix
Cmd + F Search/filter
Cmd + I Show object details
```

---

## MVP Scope

The first working version should include:

- profile creation
- secure credential saving
- bucket object listing
- prefix navigation
- file upload
- file download
- object delete with confirmation
- basic metadata details panel
- Cloudflare R2 support
- AWS S3 support

---

## Roadmap

- Transfer queue
- Recursive folder upload
- Recursive folder download
- Recursive prefix delete
- Object rename/move
- Metadata editing
- Tag editing
- Drag-and-drop upload
- Multi-select operations
- Search and advanced filtering
- Finder integration
- Signed URL generation
- Bucket policy viewer
- Public/private object indicators
- Import/export profiles without secrets
- App signing and notarization for macOS

---

## Development Notes

S3 key behavior

S3 does not have real folders.

Folders are represented by object key prefixes.

Example:

```text
photos/2026/image.jpg
```

The folders photos/ and photos/2026/ are virtual prefixes.

BucketDock treats prefixes as folders in the UI.

---

## Safety

BucketDock should always ask for confirmation before destructive actions.

Recursive delete must:

1. Count objects first
2. Show the number of objects to be deleted
3. Ask for explicit confirmation
4. Never delete silently

---

## License

This project is not yet licensed.

---

## Name

BucketDock means:

- Bucket: object storage bucket
- Dock: native desktop/macOS feeling

Tagline:

BucketDock — your S3 buckets, on your desktop.
