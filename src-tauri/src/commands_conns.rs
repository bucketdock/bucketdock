use tauri::State;

use crate::connections::{self, Connection, ConnectionInput};
use crate::error::{Error, Result};
use crate::state::AppState;

#[tauri::command]
pub async fn list_connections(state: State<'_, AppState>) -> Result<Vec<Connection>> {
    let guard = state.connections.lock().await;
    Ok(guard.values().cloned().collect())
}

#[tauri::command]
pub async fn add_connection(
    input: ConnectionInput,
    state: State<'_, AppState>,
) -> Result<Connection> {
    connections::validate_input(&input)?;

    let id = uuid::Uuid::new_v4().to_string();
    let conn = Connection {
        id: id.clone(),
        name: input.name,
        provider: input.provider,
        endpoint: input.endpoint,
        region: input.region,
        access_key_id: input.access_key_id,
        secret_access_key: input.secret_access_key.clone(),
        bucket_filter: input.bucket_filter,
    };

    connections::store_secret(&id, &input.secret_access_key)?;

    let mut list = connections::load_metadata()?;
    list.push(conn.clone());
    connections::save_metadata(&list)?;

    state.reload().await?;
    Ok(conn)
}

#[tauri::command]
pub async fn update_connection(
    id: String,
    input: ConnectionInput,
    state: State<'_, AppState>,
) -> Result<Connection> {
    let mut list = connections::load_metadata()?;
    let pos = list
        .iter()
        .position(|c| c.id == id)
        .ok_or_else(|| Error::NotFound(id.clone()))?;

    let resolved_secret = if input.secret_access_key.is_empty() {
        connections::load_secret(&id)?
    } else {
        connections::store_secret(&id, &input.secret_access_key)?;
        input.secret_access_key.clone()
    };

    // Validate against the resolved secret so we catch the case where the
    // user blanked the field on a fresh connection, not just on edit.
    let to_validate = ConnectionInput {
        secret_access_key: resolved_secret.clone(),
        ..input.clone()
    };
    connections::validate_input(&to_validate)?;

    let conn = Connection {
        id: id.clone(),
        name: input.name,
        provider: input.provider,
        endpoint: input.endpoint,
        region: input.region,
        access_key_id: input.access_key_id,
        secret_access_key: resolved_secret,
        bucket_filter: input.bucket_filter,
    };

    list[pos] = conn.clone();
    connections::save_metadata(&list)?;
    state.reload().await?;
    Ok(conn)
}

#[tauri::command]
pub async fn delete_connection(id: String, state: State<'_, AppState>) -> Result<()> {
    let mut list = connections::load_metadata()?;
    list.retain(|c| c.id != id);
    connections::save_metadata(&list)?;
    connections::delete_secret(&id)?;
    state.reload().await?;
    Ok(())
}

#[tauri::command]
pub async fn test_connection(
    input: ConnectionInput,
    _state: State<'_, AppState>,
) -> Result<u32> {
    connections::validate_input(&input)?;

    let conn_like = crate::s3::ConnectionLike {
        provider: input.provider.clone(),
        endpoint: input.endpoint.clone(),
        region: input.region.clone(),
        access_key_id: input.access_key_id.clone(),
        secret_access_key: input.secret_access_key.clone(),
    };
    let client = crate::s3::S3Client::from_connection(&conn_like).await?;

    // If the user pinned the connection to specific buckets, don't call the
    // account-wide ListBuckets (which scoped tokens cannot do). Instead probe
    // each named bucket with a head/list and report success on the first one.
    if let Some(filter) = input.bucket_filter.as_ref() {
        let names = connections::parse_bucket_filter(filter);
        if !names.is_empty() {
            let mut last_err: Option<Error> = None;
            for name in &names {
                match client.list_objects(name, "").await {
                    Ok(_) => return Ok(names.len() as u32),
                    Err(e) => last_err = Some(humanize_s3_error(e, Some(name))),
                }
            }
            return Err(last_err.unwrap_or_else(|| Error::Other("no buckets to test".into())));
        }
    }

    match client.list_buckets().await {
        Ok(buckets) => Ok(buckets.len() as u32),
        Err(e) => Err(humanize_s3_error(e, None)),
    }
}

/// Wrap a raw S3 error with hints that help the user fix it.
fn humanize_s3_error(err: Error, bucket: Option<&str>) -> Error {
    let raw = err.to_string();
    let lower = raw.to_lowercase();

    let hint = if lower.contains("accessdenied")
        || lower.contains("not authorized")
        || lower.contains("forbidden")
    {
        Some(
            "Access denied. If your credentials are scoped to specific buckets, list those bucket names in the Buckets field — scoped tokens cannot call account-wide ListBuckets.",
        )
    } else if lower.contains("signaturedoesnotmatch") {
        Some("Signature mismatch. Double-check the Secret Access Key (and that it has not been pasted with extra whitespace).")
    } else if lower.contains("invalidaccesskeyid") || lower.contains("invalid access key") {
        Some("The Access Key ID was rejected by the provider. Re-check it.")
    } else if lower.contains("nosuchbucket") {
        match bucket {
            Some(b) => return Error::Other(format!("Bucket '{}' was not found at this endpoint.", b)),
            None => Some("Bucket not found."),
        }
    } else if lower.contains("dispatch failure")
        || lower.contains("connectorerror")
        || lower.contains("dns error")
        || lower.contains("connection refused")
        || lower.contains("timed out")
    {
        Some("Could not reach the S3 endpoint. Check the endpoint URL, your network, and (for R2) that you used the account endpoint.")
    } else {
        None
    };

    match hint {
        Some(h) => Error::Other(format!("{} — {}", raw, h)),
        None => err,
    }
}

