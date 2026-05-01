use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::error::{Error, Result};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Connection {
    pub id: String,
    pub name: String,
    /// "aws" | "r2" | "custom"
    pub provider: String,
    pub endpoint: Option<String>,
    pub region: String,
    pub access_key_id: String,
    #[serde(skip)]
    pub secret_access_key: String,
    pub bucket_filter: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionInput {
    pub name: String,
    pub provider: String,
    pub endpoint: Option<String>,
    pub region: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    pub bucket_filter: Option<String>,
}

pub fn data_dir() -> PathBuf {
    let dir = dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("BucketDock");
    std::fs::create_dir_all(&dir).ok();
    dir
}

pub fn metadata_path() -> PathBuf {
    data_dir().join("connections.json")
}

pub fn keychain_service() -> &'static str {
    "com.bucketdock.app"
}

pub fn load_metadata() -> Result<Vec<Connection>> {
    let path = metadata_path();
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = std::fs::read_to_string(&path)?;
    let list: Vec<Connection> = serde_json::from_str(&content)?;
    Ok(list)
}

pub fn save_metadata(list: &[Connection]) -> Result<()> {
    let path = metadata_path();
    let tmp = path.with_extension("json.tmp");
    let content = serde_json::to_string_pretty(list)?;
    std::fs::write(&tmp, &content)?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

pub fn store_secret(id: &str, secret: &str) -> Result<()> {
    let entry = keyring::Entry::new(keychain_service(), id)
        .map_err(|e| Error::Keyring(e.to_string()))?;
    entry
        .set_password(secret)
        .map_err(|e| Error::Keyring(e.to_string()))
}

pub fn load_secret(id: &str) -> Result<String> {
    let entry = keyring::Entry::new(keychain_service(), id)
        .map_err(|e| Error::Keyring(e.to_string()))?;
    match entry.get_password() {
        Ok(s) => Ok(s),
        Err(keyring::Error::NoEntry) => Ok(String::new()),
        Err(e) => Err(Error::Keyring(e.to_string())),
    }
}

pub fn delete_secret(id: &str) -> Result<()> {
    let entry = keyring::Entry::new(keychain_service(), id)
        .map_err(|e| Error::Keyring(e.to_string()))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(Error::Keyring(e.to_string())),
    }
}

pub fn merge_secrets(metas: Vec<Connection>) -> Result<Vec<Connection>> {
    metas
        .into_iter()
        .map(|mut conn| {
            conn.secret_access_key = load_secret(&conn.id)?;
            Ok(conn)
        })
        .collect()
}
