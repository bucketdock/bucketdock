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
            // Cloudflare R2 expects virtual-hosted style signing against the
            // account endpoint. Keep path-style only for generic custom S3
            // endpoints where that is commonly required.
            .force_path_style(conn.provider == "custom")
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
}
