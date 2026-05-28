use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;

use crate::error::{Error, Result};
use crate::s3::{ConnectionLike, S3Client};
use crate::state::AppState;

const TRANSFER_EVENT: &str = "transfer://progress";

#[derive(Clone, Serialize)]
struct TransferProgress<'a> {
    id: &'a str,
    status: &'a str,
    loaded: u64,
    total: u64,
    error: Option<String>,
}

fn emit(app: &AppHandle, id: &str, status: &str, loaded: u64, total: u64, error: Option<String>) {
    let _ = app.emit(
        TRANSFER_EVENT,
        TransferProgress {
            id,
            status,
            loaded,
            total,
            error,
        },
    );
}

/// Run an async operation as a cancellable task, registering its abort handle
/// in `AppState::transfers` keyed by `transfer_id` so `cancel_transfer` can
/// abort it. Always emits a final event (done / error / cancelled).
async fn run_tracked<F, Fut>(
    app: AppHandle,
    state: &AppState,
    transfer_id: String,
    total_hint: u64,
    f: F,
) -> Result<()>
where
    F: FnOnce(AppHandle, String) -> Fut + Send + 'static,
    Fut: std::future::Future<Output = Result<u64>> + Send + 'static,
{
    let app_for_task = app.clone();
    let id_for_task = transfer_id.clone();
    let handle = tokio::spawn(async move { f(app_for_task, id_for_task).await });

    state
        .transfers
        .lock()
        .await
        .insert(transfer_id.clone(), handle.abort_handle());

    let res = handle.await;
    state.transfers.lock().await.remove(&transfer_id);

    match res {
        Ok(Ok(loaded)) => {
            emit(&app, &transfer_id, "done", loaded, loaded.max(total_hint), None);
            Ok(())
        }
        Ok(Err(e)) => {
            let msg = e.to_string();
            emit(&app, &transfer_id, "failed", 0, total_hint, Some(msg.clone()));
            Err(e)
        }
        Err(join_err) if join_err.is_cancelled() => {
            emit(&app, &transfer_id, "cancelled", 0, total_hint, None);
            Err(Error::Other("cancelled".into()))
        }
        Err(e) => {
            let msg = e.to_string();
            emit(&app, &transfer_id, "failed", 0, total_hint, Some(msg.clone()));
            Err(Error::Other(msg))
        }
    }
}

#[tauri::command]
pub async fn upload_file_tracked(
    connection_id: String,
    bucket: String,
    key: String,
    local_path: String,
    transfer_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<()> {
    let conn = state.get_connection(&connection_id).await?;
    let client = S3Client::from_connection(&ConnectionLike::from(&conn)).await?;
    let total = std::fs::metadata(&local_path).map(|m| m.len()).unwrap_or(0);

    emit(&app, &transfer_id, "running", 0, total, None);

    // Bridge sync progress callbacks from the upload task into async events.
    // The `mpsc` channel decouples the upload's blocking-style callback from
    // the Tauri event emitter, which needs `&AppHandle`.
    let (tx, mut rx) = mpsc::unbounded_channel::<u64>();
    let app_for_progress = app.clone();
    let id_for_progress = transfer_id.clone();
    let progress_task = tokio::spawn(async move {
        while let Some(loaded) = rx.recv().await {
            emit(
                &app_for_progress,
                &id_for_progress,
                "running",
                loaded,
                loaded.max(total),
                None,
            );
        }
    });

    let res = run_tracked(
        app.clone(),
        &state,
        transfer_id.clone(),
        total,
        move |_app, _id| async move {
            let uploaded = client
                .upload_file_with_progress(&bucket, &key, &local_path, |loaded| {
                    let _ = tx.send(loaded);
                })
                .await?;
            Ok(uploaded)
        },
    )
    .await;

    // Stop the bridge once the task is done.
    progress_task.abort();
    let _ = progress_task.await;
    res
}

#[tauri::command]
pub async fn download_file_tracked(
    connection_id: String,
    bucket: String,
    key: String,
    local_path: String,
    transfer_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<()> {
    let conn = state.get_connection(&connection_id).await?;
    let client = S3Client::from_connection(&ConnectionLike::from(&conn)).await?;

    // Best-effort total from HEAD; fall back to 0 if it fails.
    let total = client
        .get_object_metadata(&bucket, &key)
        .await
        .map(|m| m.size as u64)
        .unwrap_or(0);

    emit(&app, &transfer_id, "running", 0, total, None);

    run_tracked(app.clone(), &state, transfer_id.clone(), total, move |app, id| async move {
        let mut stream = client.get_object_stream(&bucket, &key).await?;
        if let Some(parent) = std::path::Path::new(&local_path).parent() {
            tokio::fs::create_dir_all(parent).await.ok();
        }
        let mut file = tokio::fs::File::create(&local_path).await?;
        let mut loaded: u64 = 0;
        let mut last_emit: u64 = 0;
        while let Some(chunk) = stream
            .next()
            .await
            .transpose()
            .map_err(|e| Error::S3(e.to_string()))?
        {
            file.write_all(&chunk).await?;
            loaded += chunk.len() as u64;
            // Throttle events to ~256 KB to avoid flooding the IPC bridge.
            if loaded - last_emit >= 256 * 1024 {
                emit(&app, &id, "running", loaded, total.max(loaded), None);
                last_emit = loaded;
            }
        }
        file.flush().await?;
        Ok(loaded)
    })
    .await
}

#[tauri::command]
pub async fn copy_object_tracked(
    src_connection_id: String,
    src_bucket: String,
    src_key: String,
    dst_connection_id: String,
    dst_bucket: String,
    dst_key: String,
    transfer_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<()> {
    let src_conn = state.get_connection(&src_connection_id).await?;
    let dst_conn = state.get_connection(&dst_connection_id).await?;
    let src_client = S3Client::from_connection(&ConnectionLike::from(&src_conn)).await?;
    let dst_client = S3Client::from_connection(&ConnectionLike::from(&dst_conn)).await?;

    let total = src_client
        .get_object_metadata(&src_bucket, &src_key)
        .await
        .map(|m| m.size as u64)
        .unwrap_or(0);

    emit(&app, &transfer_id, "running", 0, total, None);

    run_tracked(app.clone(), &state, transfer_id.clone(), total, move |app, id| async move {
        // Stream source -> temp file -> dest. Keeps memory usage bounded and
        // works across providers with different signing rules.
        let tmp_dir = std::env::temp_dir();
        let tmp_name = format!("bucketdock-{}.part", uuid::Uuid::new_v4());
        let tmp_path = tmp_dir.join(tmp_name);
        let tmp_str = tmp_path.to_string_lossy().to_string();

        let mut stream = src_client.get_object_stream(&src_bucket, &src_key).await?;
        let mut file = tokio::fs::File::create(&tmp_path).await?;
        let mut loaded: u64 = 0;
        let mut last_emit: u64 = 0;
        while let Some(chunk) = stream
            .next()
            .await
            .transpose()
            .map_err(|e| Error::S3(e.to_string()))?
        {
            file.write_all(&chunk).await?;
            loaded += chunk.len() as u64;
            // First half of progress = download phase.
            let half = total.max(loaded) * 1 / 2;
            let scaled = if total > 0 { loaded.min(total) / 2 } else { loaded };
            if loaded - last_emit >= 256 * 1024 {
                emit(&app, &id, "running", scaled, total.max(loaded).max(half), None);
                last_emit = loaded;
            }
        }
        file.flush().await?;
        drop(file);

        // Upload to destination using multipart progress.
        let half = total / 2;
        emit(&app, &id, "running", half, total.max(loaded), None);
        let upload_res = dst_client
            .upload_file_with_progress(&dst_bucket, &dst_key, &tmp_str, |up_loaded| {
                // Second half of progress = upload phase.
                let scaled = if total > 0 {
                    half + (up_loaded.min(total) / 2)
                } else {
                    half + up_loaded
                };
                emit(&app, &id, "running", scaled, total.max(loaded), None);
            })
            .await;
        let _ = tokio::fs::remove_file(&tmp_path).await;
        upload_res?;
        Ok(loaded)
    })
    .await
}

#[tauri::command]
pub async fn cancel_transfer(transfer_id: String, state: State<'_, AppState>) -> Result<()> {
    if let Some(handle) = state.transfers.lock().await.remove(&transfer_id) {
        handle.abort();
    }
    Ok(())
}

/// Tracked bulk delete used to power the progress row in the transfer
/// queue. `keys` are deleted directly; each entry in `prefixes` is expanded
/// to all of its descendants (folder delete) before deletion. Progress is
/// reported in object-count units, in batches of `CHUNK` keys per round-trip
/// so the bar moves smoothly even for very large folders.
///
/// The reason this lives next to the file-transfer commands instead of in
/// `commands_s3.rs` is that the user-facing semantics are identical to a
/// transfer: the operation can be slow, must be cancellable, and the
/// frontend wants live progress through the existing `transfer://progress`
/// event channel.
#[tauri::command]
pub async fn delete_tracked(
    connection_id: String,
    bucket: String,
    keys: Vec<String>,
    prefixes: Vec<String>,
    transfer_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<()> {
    let conn = state.get_connection(&connection_id).await?;
    let client = S3Client::from_connection(&ConnectionLike::from(&conn)).await?;

    emit(&app, &transfer_id, "running", 0, 0, None);

    run_tracked(
        app.clone(),
        &state,
        transfer_id.clone(),
        0,
        move |app, id| async move {
            // Expand every prefix into a flat key list. Doing this up front
            // lets us emit an honest total so the progress bar can fill in
            // a single direction instead of jumping when a folder is
            // discovered late.
            let mut all_keys: Vec<String> = keys;
            for p in &prefixes {
                let listed = client.list_all_keys(&bucket, p).await?;
                for o in listed {
                    all_keys.push(o.key);
                }
            }
            let total = all_keys.len() as u64;
            emit(&app, &id, "running", 0, total, None);

            // S3 DeleteObjects accepts up to 1000 keys per call. We chunk
            // smaller than that on purpose so progress events arrive
            // frequently and a cancel takes effect within one round-trip.
            const CHUNK: usize = 500;
            let mut loaded: u64 = 0;
            for chunk in all_keys.chunks(CHUNK) {
                client.delete_objects(&bucket, chunk.to_vec()).await?;
                loaded += chunk.len() as u64;
                emit(&app, &id, "running", loaded, total, None);
            }
            Ok(loaded)
        },
    )
    .await
}
