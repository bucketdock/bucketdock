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

/// Single keychain account that holds *all* connection secrets as a JSON map
/// keyed by connection id. Storing them together means the user only gets one
/// macOS keychain authorization prompt per app launch instead of one per
/// connection (or one per call if "Always Allow" is not chosen).
pub fn keychain_bundle_account() -> &'static str {
    "bucketdock://secrets-v2"
}

fn read_bundle() -> Result<std::collections::HashMap<String, String>> {
    let entry = keyring::Entry::new(keychain_service(), keychain_bundle_account())
        .map_err(|e| Error::Keyring(e.to_string()))?;
    match entry.get_password() {
        Ok(s) if s.is_empty() => Ok(std::collections::HashMap::new()),
        Ok(s) => serde_json::from_str(&s)
            .map_err(|e| Error::Keyring(format!("failed to parse stored secrets: {}", e))),
        Err(keyring::Error::NoEntry) => Ok(std::collections::HashMap::new()),
        Err(e) => Err(Error::Keyring(e.to_string())),
    }
}

fn write_bundle(map: &std::collections::HashMap<String, String>) -> Result<()> {
    let entry = keyring::Entry::new(keychain_service(), keychain_bundle_account())
        .map_err(|e| Error::Keyring(e.to_string()))?;
    let blob = serde_json::to_string(map)?;
    entry
        .set_password(&blob)
        .map_err(|e| Error::Keyring(e.to_string()))
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
    let mut bundle = read_bundle()?;
    bundle.insert(id.to_string(), secret.to_string());
    write_bundle(&bundle)
}

pub fn load_secret(id: &str) -> Result<String> {
    let bundle = read_bundle()?;
    if let Some(s) = bundle.get(id) {
        return Ok(s.clone());
    }
    // Fall back to the legacy per-id keychain entry written by previous
    // versions. If found, migrate it into the bundle so subsequent launches
    // only need a single keychain unlock.
    let entry = keyring::Entry::new(keychain_service(), id)
        .map_err(|e| Error::Keyring(e.to_string()))?;
    match entry.get_password() {
        Ok(s) => {
            let _ = store_secret(id, &s);
            let _ = entry.delete_credential();
            Ok(s)
        }
        Err(keyring::Error::NoEntry) => Ok(String::new()),
        Err(e) => Err(Error::Keyring(e.to_string())),
    }
}

pub fn delete_secret(id: &str) -> Result<()> {
    let mut bundle = read_bundle()?;
    bundle.remove(id);
    write_bundle(&bundle)?;
    // Best-effort cleanup of any legacy per-id entry.
    if let Ok(entry) = keyring::Entry::new(keychain_service(), id) {
        let _ = entry.delete_credential();
    }
    Ok(())
}

/// Look up secrets for every connection in `metas` using a single keychain
/// read (and migrating any legacy per-id entries on the fly).
pub fn merge_secrets(metas: Vec<Connection>) -> Result<Vec<Connection>> {
    let mut bundle = read_bundle()?;
    let mut migrated = false;
    let result: Vec<Connection> = metas
        .into_iter()
        .map(|mut conn| {
            if let Some(s) = bundle.get(&conn.id) {
                conn.secret_access_key = s.clone();
            } else {
                // Migrate legacy per-id entry, if any.
                if let Ok(entry) = keyring::Entry::new(keychain_service(), &conn.id) {
                    if let Ok(s) = entry.get_password() {
                        bundle.insert(conn.id.clone(), s.clone());
                        let _ = entry.delete_credential();
                        conn.secret_access_key = s;
                        migrated = true;
                    }
                }
            }
            conn
        })
        .collect();
    if migrated {
        let _ = write_bundle(&bundle);
    }
    Ok(result)
}

/// Parse a free-form bucket filter into a list of bucket names. Accepts
/// commas, spaces, semicolons or newlines as separators. Empty entries are
/// dropped, and surrounding whitespace is trimmed.
pub fn parse_bucket_filter(raw: &str) -> Vec<String> {
    raw.split(|c: char| c == ',' || c == ' ' || c == '\n' || c == ';' || c == '\t')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// Validate a connection input and return a user-facing error if anything is
/// missing or obviously wrong. Catches mistakes locally before we even try to
/// hit the network.
pub fn validate_input(input: &ConnectionInput) -> Result<()> {
    if input.name.trim().is_empty() {
        return Err(Error::Other("Connection name is required.".into()));
    }
    if input.access_key_id.trim().is_empty() {
        return Err(Error::Other("Access Key ID is required.".into()));
    }
    if input.secret_access_key.trim().is_empty() {
        return Err(Error::Other(
            "Secret Access Key is required (it is stored in the macOS Keychain).".into(),
        ));
    }
    if input.region.trim().is_empty() {
        return Err(Error::Other("Region is required.".into()));
    }
    match input.provider.as_str() {
        "aws" | "r2" | "custom" => {}
        other => {
            return Err(Error::Other(format!(
                "Unknown provider '{}'. Use aws, r2 or custom.",
                other
            )));
        }
    }
    if matches!(input.provider.as_str(), "r2" | "custom") {
        let ep = input.endpoint.as_deref().unwrap_or("").trim();
        if ep.is_empty() {
            return Err(Error::Other(
                "Endpoint URL is required for this provider.".into(),
            ));
        }
        if !(ep.starts_with("http://") || ep.starts_with("https://")) {
            return Err(Error::Other(
                "Endpoint must start with http:// or https://".into(),
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_bucket_filter_with_mixed_separators() {
        let parsed = parse_bucket_filter("alpha, beta;gamma\n delta\tepsilon");
        assert_eq!(parsed, vec!["alpha", "beta", "gamma", "delta", "epsilon"]);
    }

    #[test]
    fn empty_bucket_filter_returns_empty_vec() {
        assert!(parse_bucket_filter("").is_empty());
        assert!(parse_bucket_filter("   ,, ; \n  ").is_empty());
    }

    #[test]
    fn keychain_service_is_app_bundle_id() {
        // Keep the keychain entry under our bundle ID so we don't collide
        // with anything else and so users can find it in Keychain Access.
        assert_eq!(keychain_service(), "com.bucketdock.app");
    }

    #[test]
    fn keychain_bundle_account_is_versioned() {
        // The bundled account name carries an explicit "v2" suffix so future
        // schema changes can migrate forward without colliding with the
        // legacy per-id entries that older builds wrote.
        let acct = keychain_bundle_account();
        assert!(acct.contains("v2"), "expected v2 in bundle account: {}", acct);
    }

    #[test]
    fn metadata_path_is_under_data_dir() {
        let p = metadata_path();
        assert!(p.ends_with("connections.json"));
        assert!(p.parent().unwrap().ends_with("BucketDock"));
    }

    fn input(provider: &str) -> ConnectionInput {
        ConnectionInput {
            name: "test".into(),
            provider: provider.into(),
            endpoint: Some("https://example.com".into()),
            region: "us-east-1".into(),
            access_key_id: "AKIA0000".into(),
            secret_access_key: "secret".into(),
            bucket_filter: None,
        }
    }

    #[test]
    fn validate_passes_for_aws() {
        let mut i = input("aws");
        i.endpoint = None;
        validate_input(&i).expect("aws without endpoint should be valid");
    }

    #[test]
    fn validate_rejects_empty_name() {
        let mut i = input("aws");
        i.name = "  ".into();
        assert!(validate_input(&i).is_err());
    }

    #[test]
    fn validate_rejects_missing_secret() {
        let mut i = input("aws");
        i.secret_access_key = "".into();
        let err = validate_input(&i).unwrap_err().to_string();
        assert!(err.contains("Secret Access Key"));
    }

    #[test]
    fn validate_rejects_unknown_provider() {
        let i = input("gcp");
        let err = validate_input(&i).unwrap_err().to_string();
        assert!(err.contains("Unknown provider"));
    }

    #[test]
    fn validate_requires_endpoint_for_r2() {
        let mut i = input("r2");
        i.endpoint = None;
        assert!(validate_input(&i).is_err());
        i.endpoint = Some("not-a-url".into());
        assert!(validate_input(&i).is_err());
        i.endpoint = Some("https://abcd.r2.cloudflarestorage.com".into());
        validate_input(&i).expect("https endpoint should be accepted");
    }

    #[test]
    fn validate_requires_endpoint_for_custom() {
        let mut i = input("custom");
        i.endpoint = None;
        assert!(validate_input(&i).is_err());
    }

    #[test]
    fn save_load_metadata_roundtrip() {
        // Use the real data_dir but a unique connection ID so we don't
        // disturb the user's actual config.
        let unique = format!("test-{}", uuid::Uuid::new_v4());
        let conn = Connection {
            id: unique.clone(),
            name: "round-trip".into(),
            provider: "aws".into(),
            endpoint: None,
            region: "eu-west-1".into(),
            access_key_id: "AKIA0000".into(),
            secret_access_key: "must-not-be-serialized".into(),
            bucket_filter: Some("a,b".into()),
        };

        let mut current = load_metadata().unwrap_or_default();
        current.push(conn.clone());
        save_metadata(&current).unwrap();

        let reloaded = load_metadata().unwrap();
        let found = reloaded
            .iter()
            .find(|c| c.id == unique)
            .expect("connection must round-trip");
        assert_eq!(found.name, "round-trip");
        assert_eq!(found.bucket_filter.as_deref(), Some("a,b"));
        // secret is `#[serde(skip)]` and must never round-trip.
        assert_eq!(found.secret_access_key, "");

        // Cleanup so subsequent runs stay deterministic.
        let cleaned: Vec<Connection> = reloaded.into_iter().filter(|c| c.id != unique).collect();
        save_metadata(&cleaned).unwrap();
    }
}
