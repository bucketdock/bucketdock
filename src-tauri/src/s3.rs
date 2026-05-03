use chrono::{DateTime, TimeZone, Utc};
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

/// Format an AWS SDK error including its source chain so the user sees the
/// underlying cause (e.g. SignatureDoesNotMatch, NoSuchBucket, hyper/timeout)
/// instead of the generic "service error".
fn fmt_sdk_err<E: std::error::Error + 'static>(e: E) -> Error {
    let mut out = e.to_string();
    let mut src: Option<&(dyn std::error::Error + 'static)> = e.source();
    while let Some(s) = src {
        let msg = s.to_string();
        if !out.contains(&msg) {
            out.push_str(": ");
            out.push_str(&msg);
        }
        src = s.source();
    }
    Error::S3(out)
}

// ---------------------------------------------------------------------------
// ConnectionLike — decoupled connection descriptor used by S3Client
// ---------------------------------------------------------------------------

/// Plain data struct carrying the fields S3Client needs.
/// Commands build this from `crate::connections::Connection` via `From`.
#[derive(Debug, Clone)]
pub struct ConnectionLike {
    pub provider: String,
    pub endpoint: Option<String>,
    pub region: String,
    pub access_key_id: String,
    pub secret_access_key: String,
}

impl From<&crate::connections::Connection> for ConnectionLike {
    fn from(c: &crate::connections::Connection) -> Self {
        ConnectionLike {
            provider: c.provider.clone(),
            endpoint: c.endpoint.clone(),
            region: c.region.clone(),
            access_key_id: c.access_key_id.clone(),
            secret_access_key: c.secret_access_key.clone(),
        }
    }
}

// ---------------------------------------------------------------------------
// Return types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObjectMetadata {
    pub content_type: Option<String>,
    pub cache_control: Option<String>,
    pub content_disposition: Option<String>,
    pub content_encoding: Option<String>,
    pub content_language: Option<String>,
    pub metadata: std::collections::HashMap<String, String>,
    pub size: i64,
    pub last_modified: Option<chrono::DateTime<chrono::Utc>>,
    pub etag: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BucketInfo {
    pub name: String,
    pub creation_date: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ObjectInfo {
    /// Full S3 key (includes prefix).
    pub key: String,
    pub size: i64,
    pub last_modified: Option<DateTime<Utc>>,
    pub etag: Option<String>,
    /// e.g. STANDARD, INTELLIGENT_TIERING, GLACIER, ...
    pub storage_class: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ObjectPreview {
    /// Detected content type (from S3 head, or sniffed from first bytes).
    pub content_type: Option<String>,
    /// Total object size.
    pub size: i64,
    /// True if the returned bytes are the entire object.
    pub complete: bool,
    /// Base64-encoded body slice (always base64 so the JSON IPC bridge stays
    /// safe for binary data).
    pub body_b64: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ListPage {
    /// Relative folder names (prefix stripped).
    pub folders: Vec<String>,
    pub files: Vec<ObjectInfo>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn aws_dt_to_chrono(dt: &aws_smithy_types::DateTime) -> Option<DateTime<Utc>> {
    Utc.timestamp_opt(dt.secs(), dt.subsec_nanos()).single()
}

/// Percent-encode a path key, preserving "/" as segment separator.
fn percent_encode_key(key: &str) -> String {
    key.split('/')
        .map(|seg| {
            seg.bytes()
                .map(|b| match b {
                    b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                        (b as char).to_string()
                    }
                    other => format!("%{:02X}", other),
                })
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("/")
}

// ---------------------------------------------------------------------------
// S3Client
// ---------------------------------------------------------------------------

pub struct S3Client {
    client: aws_sdk_s3::Client,
}

impl S3Client {
    pub async fn from_connection(conn: &ConnectionLike) -> Result<Self> {
        use aws_config::BehaviorVersion;
        use aws_credential_types::Credentials;
        use aws_sdk_s3::config::Region;

        if conn.access_key_id.trim().is_empty() || conn.secret_access_key.trim().is_empty() {
            return Err(Error::Keyring(
                "missing stored secret for this connection; open Edit Connection, enter the Secret Access Key, and save it again".into(),
            ));
        }

        let region = if conn.provider == "r2" {
            "auto".to_string()
        } else {
            conn.region.trim().to_string()
        };

        let creds = Credentials::new(
            conn.access_key_id.trim().to_string(),
            conn.secret_access_key.trim().to_string(),
            None,
            None,
            "bucketdock",
        );

        let mut loader = aws_config::defaults(BehaviorVersion::latest())
            .region(Region::new(region))
            .credentials_provider(creds);

        if let Some(ep) = &conn.endpoint {
            loader = loader.endpoint_url(ep.trim_end_matches('/').to_string());
        }

        let sdk_config = loader.load().await;

        let s3_config = aws_sdk_s3::config::Builder::from(&sdk_config)
            // R2 connections are configured with the account endpoint
            // (https://<account>.r2.cloudflarestorage.com). Keep bucket names
            // in the request path so scoped tokens and account-endpoint signing
            // stay aligned.
            .force_path_style(conn.provider == "custom" || conn.provider == "r2")
            .build();

        Ok(S3Client {
            client: aws_sdk_s3::Client::from_conf(s3_config),
        })
    }

    // -----------------------------------------------------------------------
    // Bucket operations
    // -----------------------------------------------------------------------

    pub async fn list_buckets(&self) -> Result<Vec<BucketInfo>> {
        let resp = self
            .client
            .list_buckets()
            .send()
            .await
            .map_err(fmt_sdk_err)?;

        let buckets = resp
            .buckets()
            .iter()
            .map(|b| BucketInfo {
                name: b.name().unwrap_or("").to_string(),
                creation_date: b.creation_date().and_then(aws_dt_to_chrono),
            })
            .collect();

        Ok(buckets)
    }

    // -----------------------------------------------------------------------
    // Object listing
    // -----------------------------------------------------------------------

    pub async fn list_objects(&self, bucket: &str, prefix: &str) -> Result<ListPage> {
        let resp = self
            .client
            .list_objects_v2()
            .bucket(bucket)
            .prefix(prefix)
            .delimiter("/")
            .send()
            .await
            .map_err(fmt_sdk_err)?;

        // Strip prefix from folder names so front-end sees relative names.
        let folders = resp
            .common_prefixes()
            .iter()
            .filter_map(|cp| cp.prefix())
            .map(|p| p.strip_prefix(prefix).unwrap_or(p).to_string())
            .collect();

        // Files — keep full key; filter out the prefix placeholder itself.
        let files = resp
            .contents()
            .iter()
            .filter(|obj| obj.key().map(|k| k != prefix).unwrap_or(false))
            .map(|obj| ObjectInfo {
                key: obj.key().unwrap_or("").to_string(),
                size: obj.size().unwrap_or(0),
                last_modified: obj.last_modified().and_then(aws_dt_to_chrono),
                etag: obj.e_tag().map(|s| s.trim_matches('"').to_string()),
                storage_class: obj.storage_class().map(|sc| sc.as_str().to_string()),
            })
            .collect();

        Ok(ListPage { folders, files })
    }

    // -----------------------------------------------------------------------
    // Upload / download
    // -----------------------------------------------------------------------

    pub async fn upload_file(&self, bucket: &str, key: &str, local_path: &str) -> Result<()> {
        use aws_sdk_s3::primitives::ByteStream;
        use std::path::Path;

        let body = ByteStream::from_path(Path::new(local_path))
            .await
            .map_err(fmt_sdk_err)?;

        self.client
            .put_object()
            .bucket(bucket)
            .key(key)
            .body(body)
            .send()
            .await
            .map_err(fmt_sdk_err)?;

        Ok(())
    }

    pub async fn download_file(&self, bucket: &str, key: &str, local_path: &str) -> Result<()> {
        use tokio::io::AsyncWriteExt;

        let resp = self
            .client
            .get_object()
            .bucket(bucket)
            .key(key)
            .send()
            .await
            .map_err(fmt_sdk_err)?;

        let data = resp
            .body
            .collect()
            .await
            .map_err(fmt_sdk_err)?
            .into_bytes();

        let mut file = tokio::fs::File::create(local_path).await?;
        file.write_all(&data).await?;

        Ok(())
    }

    /// Open a streaming reader over an object body. Used by the transfer
    /// queue so it can write to disk incrementally and emit progress.
    pub async fn get_object_stream(
        &self,
        bucket: &str,
        key: &str,
    ) -> Result<aws_sdk_s3::primitives::ByteStream> {
        let resp = self
            .client
            .get_object()
            .bucket(bucket)
            .key(key)
            .send()
            .await
            .map_err(fmt_sdk_err)?;
        Ok(resp.body)
    }

    // -----------------------------------------------------------------------
    // Delete operations
    // -----------------------------------------------------------------------

    pub async fn delete_object(&self, bucket: &str, key: &str) -> Result<()> {
        self.client
            .delete_object()
            .bucket(bucket)
            .key(key)
            .send()
            .await
            .map_err(fmt_sdk_err)?;
        Ok(())
    }

    pub async fn delete_objects(&self, bucket: &str, keys: Vec<String>) -> Result<()> {
        use aws_sdk_s3::types::{Delete, ObjectIdentifier};

        for chunk in keys.chunks(1000) {
            let objects: Vec<ObjectIdentifier> = chunk
                .iter()
                .map(|k| {
                    ObjectIdentifier::builder()
                        .key(k)
                        .build()
                        .map_err(fmt_sdk_err)
                })
                .collect::<Result<Vec<_>>>()?;

            let delete = Delete::builder()
                .set_objects(Some(objects))
                .build()
                .map_err(fmt_sdk_err)?;

            self.client
                .delete_objects()
                .bucket(bucket)
                .delete(delete)
                .send()
                .await
                .map_err(fmt_sdk_err)?;
        }

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Folder / rename
    // -----------------------------------------------------------------------

    pub async fn create_folder(&self, bucket: &str, prefix: &str) -> Result<()> {
        use aws_sdk_s3::primitives::ByteStream;

        let key = if prefix.ends_with('/') {
            prefix.to_string()
        } else {
            format!("{}/", prefix)
        };

        self.client
            .put_object()
            .bucket(bucket)
            .key(&key)
            .body(ByteStream::from_static(b""))
            .send()
            .await
            .map_err(fmt_sdk_err)?;

        Ok(())
    }

    pub async fn rename_object(&self, bucket: &str, old_key: &str, new_key: &str) -> Result<()> {
        let copy_source = format!("{}/{}", bucket, percent_encode_key(old_key));

        self.client
            .copy_object()
            .bucket(bucket)
            .copy_source(&copy_source)
            .key(new_key)
            .send()
            .await
            .map_err(fmt_sdk_err)?;

        self.delete_object(bucket, old_key).await
    }

    // -----------------------------------------------------------------------
    // Bulk listing (no delimiter)
    // -----------------------------------------------------------------------

    pub async fn list_all_keys(&self, bucket: &str, prefix: &str) -> Result<Vec<ObjectInfo>> {
        let mut all = Vec::new();
        let mut continuation_token: Option<String> = None;

        loop {
            let mut req = self
                .client
                .list_objects_v2()
                .bucket(bucket)
                .prefix(prefix);

            if let Some(token) = continuation_token {
                req = req.continuation_token(token);
            }

            let resp = req.send().await.map_err(fmt_sdk_err)?;

            for obj in resp.contents() {
                all.push(ObjectInfo {
                    key: obj.key().unwrap_or("").to_string(),
                    size: obj.size().unwrap_or(0),
                    last_modified: obj.last_modified().and_then(aws_dt_to_chrono),
                    etag: obj.e_tag().map(|s| s.trim_matches('"').to_string()),
                    storage_class: obj.storage_class().map(|sc| sc.as_str().to_string()),
                });
            }

            if resp.is_truncated().unwrap_or(false) {
                continuation_token = resp.next_continuation_token().map(|s| s.to_string());
            } else {
                break;
            }
        }

        Ok(all)
    }

    // -----------------------------------------------------------------------
    // Folder upload / download / delete
    // -----------------------------------------------------------------------

    pub async fn upload_folder(
        &self,
        bucket: &str,
        prefix: &str,
        local_dir: &str,
    ) -> Result<(u64, u64)> {
        use aws_sdk_s3::primitives::ByteStream;
        use walkdir::WalkDir;

        let mut file_count: u64 = 0;
        let mut total_bytes: u64 = 0;

        for entry in WalkDir::new(local_dir).into_iter().filter_map(|e| e.ok()) {
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path();
            let rel = path
                .strip_prefix(local_dir)
                .map_err(fmt_sdk_err)?
                .to_string_lossy()
                .replace('\\', "/");

            let key = format!("{}{}", prefix, rel);
            let size = path.metadata().map(|m| m.len()).unwrap_or(0);

            let body = ByteStream::from_path(path)
                .await
                .map_err(fmt_sdk_err)?;

            self.client
                .put_object()
                .bucket(bucket)
                .key(&key)
                .body(body)
                .send()
                .await
                .map_err(fmt_sdk_err)?;

            file_count += 1;
            total_bytes += size;
        }

        Ok((file_count, total_bytes))
    }

    pub async fn download_folder(
        &self,
        bucket: &str,
        prefix: &str,
        local_dir: &str,
    ) -> Result<(u64, u64)> {
        use std::path::Path;
        use tokio::io::AsyncWriteExt;

        let objects = self.list_all_keys(bucket, prefix).await?;
        let mut file_count: u64 = 0;
        let mut total_bytes: u64 = 0;

        for obj in &objects {
            let key = &obj.key;
            if key.ends_with('/') {
                continue;
            }
            let relative = key.strip_prefix(prefix).unwrap_or(key.as_str());
            if relative.is_empty() {
                continue;
            }

            let mut local_path = Path::new(local_dir).to_path_buf();
            for seg in relative.split('/') {
                if !seg.is_empty() {
                    local_path = local_path.join(seg);
                }
            }

            if let Some(parent) = local_path.parent() {
                tokio::fs::create_dir_all(parent).await?;
            }

            let resp = self
                .client
                .get_object()
                .bucket(bucket)
                .key(key)
                .send()
                .await
                .map_err(fmt_sdk_err)?;

            let data = resp
                .body
                .collect()
                .await
                .map_err(fmt_sdk_err)?
                .into_bytes();

            let size = data.len() as u64;
            let mut file = tokio::fs::File::create(&local_path).await?;
            file.write_all(&data).await?;

            file_count += 1;
            total_bytes += size;
        }

        Ok((file_count, total_bytes))
    }

    pub async fn delete_prefix(&self, bucket: &str, prefix: &str) -> Result<u64> {
        let objects = self.list_all_keys(bucket, prefix).await?;
        let count = objects.len() as u64;
        let keys: Vec<String> = objects.into_iter().map(|o| o.key).collect();
        if !keys.is_empty() {
            self.delete_objects(bucket, keys).await?;
        }
        Ok(count)
    }

    // -----------------------------------------------------------------------
    // Presigned URLs
    // -----------------------------------------------------------------------

    pub async fn presign_get(&self, bucket: &str, key: &str, expires_secs: u64) -> Result<String> {
        use aws_sdk_s3::presigning::PresigningConfig;
        use std::time::Duration;

        let config = PresigningConfig::builder()
            .expires_in(Duration::from_secs(expires_secs))
            .build()
            .map_err(fmt_sdk_err)?;

        let presigned = self
            .client
            .get_object()
            .bucket(bucket)
            .key(key)
            .presigned(config)
            .await
            .map_err(fmt_sdk_err)?;

        Ok(presigned.uri().to_string())
    }

    // -----------------------------------------------------------------------
    // Object metadata (head + copy-replace)
    // -----------------------------------------------------------------------

    pub async fn get_object_metadata(&self, bucket: &str, key: &str) -> Result<ObjectMetadata> {
        let resp = self
            .client
            .head_object()
            .bucket(bucket)
            .key(key)
            .send()
            .await
            .map_err(fmt_sdk_err)?;

        Ok(ObjectMetadata {
            content_type: resp.content_type().map(|s| s.to_string()),
            cache_control: resp.cache_control().map(|s| s.to_string()),
            content_disposition: resp.content_disposition().map(|s| s.to_string()),
            content_encoding: resp.content_encoding().map(|s| s.to_string()),
            content_language: resp.content_language().map(|s| s.to_string()),
            metadata: resp
                .metadata()
                .map(|m| {
                    m.iter()
                        .map(|(k, v)| (k.clone(), v.clone()))
                        .collect()
                })
                .unwrap_or_default(),
            size: resp.content_length().unwrap_or(0),
            last_modified: resp.last_modified().and_then(aws_dt_to_chrono),
            etag: resp.e_tag().map(|s| s.trim_matches('"').to_string()),
        })
    }

    pub async fn update_object_metadata(
        &self,
        bucket: &str,
        key: &str,
        m: &ObjectMetadata,
    ) -> Result<()> {
        use aws_sdk_s3::types::MetadataDirective;

        let copy_source = format!("{}/{}", bucket, percent_encode_key(key));

        let mut builder = self
            .client
            .copy_object()
            .bucket(bucket)
            .key(key)
            .copy_source(&copy_source)
            .metadata_directive(MetadataDirective::Replace)
            .set_metadata(Some(m.metadata.clone()));

        if let Some(v) = &m.content_type {
            if !v.is_empty() {
                builder = builder.content_type(v);
            }
        }
        if let Some(v) = &m.cache_control {
            if !v.is_empty() {
                builder = builder.cache_control(v);
            }
        }
        if let Some(v) = &m.content_disposition {
            if !v.is_empty() {
                builder = builder.content_disposition(v);
            }
        }
        if let Some(v) = &m.content_encoding {
            if !v.is_empty() {
                builder = builder.content_encoding(v);
            }
        }
        if let Some(v) = &m.content_language {
            if !v.is_empty() {
                builder = builder.content_language(v);
            }
        }

        builder
            .send()
            .await
            .map_err(fmt_sdk_err)?;

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Streaming upload with progress (multipart for large files)
    // -----------------------------------------------------------------------

    /// Upload a local file emitting a callback for every bytes-written
    /// milestone. For files larger than `part_size` a multipart upload is
    /// used so each completed part fires a progress callback.
    ///
    /// Returns the total uploaded byte count. The caller is responsible for
    /// translating the callback into transfer-queue events.
    pub async fn upload_file_with_progress<F>(
        &self,
        bucket: &str,
        key: &str,
        local_path: &str,
        mut on_progress: F,
    ) -> Result<u64>
    where
        F: FnMut(u64) + Send,
    {
        use aws_sdk_s3::primitives::ByteStream;
        use aws_sdk_s3::types::{CompletedMultipartUpload, CompletedPart};
        use bytes::Bytes;
        use std::path::Path;
        use tokio::io::AsyncReadExt;

        let size = std::fs::metadata(local_path).map(|m| m.len()).unwrap_or(0);
        // S3 minimum part size is 5 MiB; use 8 MiB so we don't fragment too much.
        let part_size: u64 = 8 * 1024 * 1024;

        // Small file \u2014 single PutObject.
        if size <= part_size {
            let body = ByteStream::from_path(Path::new(local_path))
                .await
                .map_err(fmt_sdk_err)?;
            self.client
                .put_object()
                .bucket(bucket)
                .key(key)
                .body(body)
                .send()
                .await
                .map_err(fmt_sdk_err)?;
            on_progress(size);
            return Ok(size);
        }

        // Multipart upload.
        let create = self
            .client
            .create_multipart_upload()
            .bucket(bucket)
            .key(key)
            .send()
            .await
            .map_err(fmt_sdk_err)?;
        let upload_id = create
            .upload_id()
            .ok_or_else(|| Error::S3("missing upload id".into()))?
            .to_string();

        let result: Result<Vec<CompletedPart>> = async {
            let mut file = tokio::fs::File::open(local_path).await?;
            let mut completed: Vec<CompletedPart> = Vec::new();
            let mut buf = vec![0u8; part_size as usize];
            let mut part_number: i32 = 1;
            let mut loaded: u64 = 0;
            loop {
                // Fill buffer; read may return short reads.
                let mut filled = 0usize;
                while filled < buf.len() {
                    let n = file.read(&mut buf[filled..]).await?;
                    if n == 0 {
                        break;
                    }
                    filled += n;
                }
                if filled == 0 {
                    break;
                }
                let chunk = Bytes::copy_from_slice(&buf[..filled]);
                let body = ByteStream::from(chunk);
                let resp = self
                    .client
                    .upload_part()
                    .bucket(bucket)
                    .key(key)
                    .upload_id(&upload_id)
                    .part_number(part_number)
                    .body(body)
                    .send()
                    .await
                    .map_err(fmt_sdk_err)?;
                completed.push(
                    CompletedPart::builder()
                        .set_e_tag(resp.e_tag().map(|s| s.to_string()))
                        .part_number(part_number)
                        .build(),
                );
                loaded += filled as u64;
                on_progress(loaded);
                part_number += 1;
                if filled < buf.len() {
                    break;
                }
            }
            Ok(completed)
        }
        .await;

        match result {
            Ok(completed) => {
                let mp = CompletedMultipartUpload::builder()
                    .set_parts(Some(completed))
                    .build();
                self.client
                    .complete_multipart_upload()
                    .bucket(bucket)
                    .key(key)
                    .upload_id(&upload_id)
                    .multipart_upload(mp)
                    .send()
                    .await
                    .map_err(fmt_sdk_err)?;
                Ok(size)
            }
            Err(e) => {
                // Best-effort abort to avoid lingering multipart charges.
                let _ = self
                    .client
                    .abort_multipart_upload()
                    .bucket(bucket)
                    .key(key)
                    .upload_id(&upload_id)
                    .send()
                    .await;
                Err(e)
            }
        }
    }

    // -----------------------------------------------------------------------
    // Folder rename / move (same bucket) and cross-bucket folder copy
    // -----------------------------------------------------------------------

    /// Rename / move a folder within the same bucket by copying every key
    /// under `old_prefix` to the equivalent location under `new_prefix` and
    /// then deleting the originals. Both prefixes must end with '/'.
    pub async fn rename_prefix(
        &self,
        bucket: &str,
        old_prefix: &str,
        new_prefix: &str,
    ) -> Result<u64> {
        if !old_prefix.ends_with('/') || !new_prefix.ends_with('/') {
            return Err(Error::Other("folder prefixes must end with '/'".into()));
        }
        if old_prefix == new_prefix {
            return Ok(0);
        }
        if new_prefix.starts_with(old_prefix) {
            return Err(Error::Other(
                "cannot move a folder into itself".into(),
            ));
        }
        let objects = self.list_all_keys(bucket, old_prefix).await?;
        let mut count: u64 = 0;
        for obj in &objects {
            let suffix = obj.key.strip_prefix(old_prefix).unwrap_or("");
            let new_key = format!("{}{}", new_prefix, suffix);
            let copy_source = format!("{}/{}", bucket, percent_encode_key(&obj.key));
            self.client
                .copy_object()
                .bucket(bucket)
                .copy_source(&copy_source)
                .key(&new_key)
                .send()
                .await
                .map_err(fmt_sdk_err)?;
            count += 1;
        }
        let keys: Vec<String> = objects.into_iter().map(|o| o.key).collect();
        if !keys.is_empty() {
            self.delete_objects(bucket, keys).await?;
        }
        // Also create a placeholder for the new folder if the old one was empty.
        if count == 0 {
            self.create_folder(bucket, new_prefix).await?;
        }
        Ok(count)
    }

    /// List every (full) key under `prefix` for use by callers that want to
    /// enumerate folder contents (e.g. to fan out copy transfers).
    pub async fn list_keys_under(&self, bucket: &str, prefix: &str) -> Result<Vec<ObjectInfo>> {
        self.list_all_keys(bucket, prefix).await
    }

    // -----------------------------------------------------------------------
    // Preview — read up to `max_bytes` from an object
    // -----------------------------------------------------------------------

    pub async fn read_object_preview(
        &self,
        bucket: &str,
        key: &str,
        max_bytes: u64,
    ) -> Result<ObjectPreview> {
        use base64::Engine;

        let head = self
            .client
            .head_object()
            .bucket(bucket)
            .key(key)
            .send()
            .await
            .map_err(fmt_sdk_err)?;
        let total = head.content_length().unwrap_or(0);
        let content_type = head.content_type().map(|s| s.to_string());

        let mut req = self.client.get_object().bucket(bucket).key(key);
        let last = max_bytes.saturating_sub(1);
        let range = format!("bytes=0-{}", last);
        req = req.range(range);

        let resp = req.send().await.map_err(fmt_sdk_err)?;
        let bytes = resp
            .body
            .collect()
            .await
            .map_err(fmt_sdk_err)?
            .into_bytes();
        let complete = (bytes.len() as i64) >= total;
        let body_b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);

        Ok(ObjectPreview {
            content_type,
            size: total,
            complete,
            body_b64,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_encode_preserves_slash() {
        assert_eq!(percent_encode_key("a/b/c"), "a/b/c");
    }

    #[test]
    fn percent_encode_escapes_unreserved() {
        // Spaces must become %20, not '+', and "?" must be escaped so the
        // copy-source header is parsed as a single key, not a query.
        assert_eq!(percent_encode_key("foo bar"), "foo%20bar");
        assert_eq!(percent_encode_key("a?b#c"), "a%3Fb%23c");
        assert_eq!(percent_encode_key("ümlaut"), "%C3%BCmlaut");
    }

    #[test]
    fn percent_encode_keeps_unreserved_chars() {
        // Per RFC 3986: A-Z a-z 0-9 - _ . ~ are kept verbatim.
        assert_eq!(
            percent_encode_key("Hello-World_2025.tar~bak"),
            "Hello-World_2025.tar~bak"
        );
    }

    /// Mirrors the validation used by `rename_prefix` so we can exercise the
    /// edge cases without standing up an S3 endpoint.
    fn validate_rename_prefix(old_prefix: &str, new_prefix: &str) -> Result<()> {
        if !old_prefix.ends_with('/') || !new_prefix.ends_with('/') {
            return Err(Error::Other("folder prefixes must end with '/'".into()));
        }
        if old_prefix == new_prefix {
            return Ok(());
        }
        if new_prefix.starts_with(old_prefix) {
            return Err(Error::Other("cannot move a folder into itself".into()));
        }
        Ok(())
    }

    #[test]
    fn rename_prefix_requires_trailing_slash() {
        assert!(validate_rename_prefix("a", "b/").is_err());
        assert!(validate_rename_prefix("a/", "b").is_err());
        validate_rename_prefix("a/", "b/").unwrap();
    }

    #[test]
    fn rename_prefix_rejects_self_nest() {
        // Moving "a/" into "a/b/" would create infinite recursion.
        let err = validate_rename_prefix("a/", "a/b/").unwrap_err();
        assert!(err.to_string().contains("itself"));
    }

    #[test]
    fn rename_prefix_allows_sibling_move() {
        validate_rename_prefix("a/", "b/").unwrap();
        validate_rename_prefix("parent/a/", "parent/b/").unwrap();
    }
}
