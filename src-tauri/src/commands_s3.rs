use tauri::State;

use crate::error::Result;
use crate::s3::{BucketInfo, ConnectionLike, ListPage, ObjectInfo, ObjectMetadata, ObjectPreview, S3Client};
use crate::state::AppState;

#[tauri::command]
pub async fn list_buckets(
    connection_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<BucketInfo>> {
    let conn = state.get_connection(&connection_id).await?;

    // If the user provided an explicit list of bucket names (comma/space/newline
    // separated), use those directly. This is required for scoped credentials
    // (e.g. a Cloudflare R2 token limited to specific buckets) which are not
    // allowed to call the account-wide ListBuckets API.
    if let Some(filter) = conn.bucket_filter.as_ref() {
        let explicit = crate::connections::parse_bucket_filter(filter);
        if !explicit.is_empty() {
            return Ok(explicit
                .into_iter()
                .map(|name| BucketInfo { name, creation_date: None })
                .collect());
        }
    }

    let client = S3Client::from_connection(&ConnectionLike::from(&conn)).await?;
    client.list_buckets().await
}

#[tauri::command]
pub async fn list_objects(
    connection_id: String,
    bucket: String,
    prefix: String,
    state: State<'_, AppState>,
) -> Result<ListPage> {
    let conn = state.get_connection(&connection_id).await?;
    let client = S3Client::from_connection(&ConnectionLike::from(&conn)).await?;
    client.list_objects(&bucket, &prefix).await
}

#[tauri::command]
pub async fn upload_file(
    connection_id: String,
    bucket: String,
    key: String,
    local_path: String,
    state: State<'_, AppState>,
) -> Result<()> {
    let conn = state.get_connection(&connection_id).await?;
    let client = S3Client::from_connection(&ConnectionLike::from(&conn)).await?;
    client.upload_file(&bucket, &key, &local_path).await
}

#[tauri::command]
pub async fn download_file(
    connection_id: String,
    bucket: String,
    key: String,
    local_path: String,
    state: State<'_, AppState>,
) -> Result<()> {
    let conn = state.get_connection(&connection_id).await?;
    let client = S3Client::from_connection(&ConnectionLike::from(&conn)).await?;
    client.download_file(&bucket, &key, &local_path).await
}

#[tauri::command]
pub async fn delete_object(
    connection_id: String,
    bucket: String,
    key: String,
    state: State<'_, AppState>,
) -> Result<()> {
    let conn = state.get_connection(&connection_id).await?;
    let client = S3Client::from_connection(&ConnectionLike::from(&conn)).await?;
    client.delete_object(&bucket, &key).await
}

#[tauri::command]
pub async fn delete_objects(
    connection_id: String,
    bucket: String,
    keys: Vec<String>,
    state: State<'_, AppState>,
) -> Result<()> {
    let conn = state.get_connection(&connection_id).await?;
    let client = S3Client::from_connection(&ConnectionLike::from(&conn)).await?;
    client.delete_objects(&bucket, keys).await
}

#[tauri::command]
pub async fn create_folder(
    connection_id: String,
    bucket: String,
    prefix: String,
    state: State<'_, AppState>,
) -> Result<()> {
    let conn = state.get_connection(&connection_id).await?;
    let client = S3Client::from_connection(&ConnectionLike::from(&conn)).await?;
    client.create_folder(&bucket, &prefix).await
}

#[tauri::command]
pub async fn rename_object(
    connection_id: String,
    bucket: String,
    old_key: String,
    new_key: String,
    state: State<'_, AppState>,
) -> Result<()> {
    let conn = state.get_connection(&connection_id).await?;
    let client = S3Client::from_connection(&ConnectionLike::from(&conn)).await?;
    client.rename_object(&bucket, &old_key, &new_key).await
}

#[tauri::command]
pub async fn get_presigned_url(
    connection_id: String,
    bucket: String,
    key: String,
    expires_secs: u64,
    state: State<'_, AppState>,
) -> Result<String> {
    let conn = state.get_connection(&connection_id).await?;
    let client = S3Client::from_connection(&ConnectionLike::from(&conn)).await?;
    client.presign_get(&bucket, &key, expires_secs).await
}

#[tauri::command]
pub async fn upload_folder(
    connection_id: String,
    bucket: String,
    prefix: String,
    local_dir: String,
    state: State<'_, AppState>,
) -> Result<(u64, u64)> {
    let conn = state.get_connection(&connection_id).await?;
    let client = S3Client::from_connection(&ConnectionLike::from(&conn)).await?;
    client.upload_folder(&bucket, &prefix, &local_dir).await
}

#[tauri::command]
pub async fn download_folder(
    connection_id: String,
    bucket: String,
    prefix: String,
    local_dir: String,
    state: State<'_, AppState>,
) -> Result<(u64, u64)> {
    let conn = state.get_connection(&connection_id).await?;
    let client = S3Client::from_connection(&ConnectionLike::from(&conn)).await?;
    client.download_folder(&bucket, &prefix, &local_dir).await
}

#[tauri::command]
pub async fn delete_prefix(
    connection_id: String,
    bucket: String,
    prefix: String,
    state: State<'_, AppState>,
) -> Result<u64> {
    let conn = state.get_connection(&connection_id).await?;
    let client = S3Client::from_connection(&ConnectionLike::from(&conn)).await?;
    client.delete_prefix(&bucket, &prefix).await
}

#[tauri::command]
pub async fn get_object_metadata(
    connection_id: String,
    bucket: String,
    key: String,
    state: State<'_, AppState>,
) -> Result<ObjectMetadata> {
    let conn = state.get_connection(&connection_id).await?;
    let client = S3Client::from_connection(&ConnectionLike::from(&conn)).await?;
    client.get_object_metadata(&bucket, &key).await
}

#[tauri::command]
pub async fn update_object_metadata(
    connection_id: String,
    bucket: String,
    key: String,
    metadata: ObjectMetadata,
    state: State<'_, AppState>,
) -> Result<()> {
    let conn = state.get_connection(&connection_id).await?;
    let client = S3Client::from_connection(&ConnectionLike::from(&conn)).await?;
    client.update_object_metadata(&bucket, &key, &metadata).await
}

#[tauri::command]
pub async fn rename_prefix(
    connection_id: String,
    bucket: String,
    old_prefix: String,
    new_prefix: String,
    state: State<'_, AppState>,
) -> Result<u64> {
    let conn = state.get_connection(&connection_id).await?;
    let client = S3Client::from_connection(&ConnectionLike::from(&conn)).await?;
    client.rename_prefix(&bucket, &old_prefix, &new_prefix).await
}

#[tauri::command]
pub async fn list_keys_under(
    connection_id: String,
    bucket: String,
    prefix: String,
    state: State<'_, AppState>,
) -> Result<Vec<ObjectInfo>> {
    let conn = state.get_connection(&connection_id).await?;
    let client = S3Client::from_connection(&ConnectionLike::from(&conn)).await?;
    client.list_keys_under(&bucket, &prefix).await
}

#[tauri::command]
pub async fn read_object_preview(
    connection_id: String,
    bucket: String,
    key: String,
    max_bytes: u64,
    state: State<'_, AppState>,
) -> Result<ObjectPreview> {
    let conn = state.get_connection(&connection_id).await?;
    let client = S3Client::from_connection(&ConnectionLike::from(&conn)).await?;
    client.read_object_preview(&bucket, &key, max_bytes).await
}

/// HEAD a batch of object keys in parallel and return the per-key
/// `Content-Type` header (or `None` when the object has none stored).
///
/// The browser's listing API (`list_objects_v2`) does not return Content-Type,
/// so the only honest way to show the real S3 type in the Type column is to
/// perform one HEAD per file. We fan out with bounded concurrency so a folder
/// of hundreds of files doesn't open a thousand sockets at once. Errors on a
/// single key are absorbed — a missing entry just means "unknown".
#[tauri::command]
pub async fn head_object_content_types(
    connection_id: String,
    bucket: String,
    keys: Vec<String>,
    state: State<'_, AppState>,
) -> Result<std::collections::HashMap<String, Option<String>>> {
    use futures::stream::{self, StreamExt};

    let conn = state.get_connection(&connection_id).await?;
    let client = std::sync::Arc::new(
        S3Client::from_connection(&ConnectionLike::from(&conn)).await?,
    );

    // Hard cap on concurrency keeps us friendly to provider rate limits and
    // avoids exhausting the file-descriptor / socket budget on big folders.
    const CONCURRENCY: usize = 8;
    let bucket = std::sync::Arc::new(bucket);

    let results: Vec<(String, Option<String>)> = stream::iter(keys.into_iter())
        .map(|key| {
            let c = client.clone();
            let b = bucket.clone();
            async move {
                let res = c.head_content_type(&b, &key).await.ok().flatten();
                (key, res)
            }
        })
        .buffer_unordered(CONCURRENCY)
        .collect()
        .await;

    Ok(results.into_iter().collect())
}

/// Recursively enumerate every regular file under `local_dir` so the
/// frontend can enqueue each one as an individual upload (with progress
/// reported through the transfer queue). Returns the absolute path,
/// forward-slash relative path (the suffix to append to the destination
/// prefix) and size in bytes for every file. Symlinks and directories
/// themselves are not yielded.
#[tauri::command]
pub async fn walk_local_files(local_dir: String) -> Result<Vec<LocalFileEntry>> {
    use walkdir::WalkDir;

    let root = std::path::PathBuf::from(&local_dir);
    let entries = tokio::task::spawn_blocking(move || -> Result<Vec<LocalFileEntry>> {
        let mut out = Vec::new();
        for entry in WalkDir::new(&root).into_iter().filter_map(|e| e.ok()) {
            if !entry.file_type().is_file() {
                continue;
            }
            let abs = entry.path().to_path_buf();
            let rel = abs
                .strip_prefix(&root)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default();
            let size = abs.metadata().map(|m| m.len()).unwrap_or(0);
            out.push(LocalFileEntry {
                absolute_path: abs.to_string_lossy().into_owned(),
                relative_path: rel,
                size,
            });
        }
        Ok(out)
    })
    .await
    .map_err(|e| crate::error::Error::Other(e.to_string()))??;

    Ok(entries)
}

#[derive(serde::Serialize)]
pub struct LocalFileEntry {
    pub absolute_path: String,
    pub relative_path: String,
    pub size: u64,
}
