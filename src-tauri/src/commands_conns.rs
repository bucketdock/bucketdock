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
        let names: Vec<String> = filter
            .split(|c: char| c == ',' || c == ' ' || c == '\n' || c == ';')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        if !names.is_empty() {
            let mut last_err: Option<Error> = None;
            for name in &names {
                match client.list_objects(name, "").await {
                    Ok(_) => return Ok(names.len() as u32),
                    Err(e) => last_err = Some(e),
                }
            }
            return Err(last_err.unwrap_or_else(|| Error::Other("no buckets to test".into())));
        }
    }

    let buckets = client.list_buckets().await?;
    Ok(buckets.len() as u32)
}
