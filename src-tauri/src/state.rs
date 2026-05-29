use std::collections::HashMap;
use std::path::PathBuf;
use tokio::sync::Mutex;
use tokio::task::AbortHandle;

use crate::connections::{self, Connection};
use crate::error::{Error, Result};

pub struct AppState {
    pub connections: Mutex<HashMap<String, Connection>>,
    #[allow(dead_code)]
    pub data_dir: PathBuf,
    /// In-flight transfers keyed by transfer id. Used by the transfer queue
    /// to cancel running uploads/downloads/copies.
    pub transfers: Mutex<HashMap<String, AbortHandle>>,
}

fn connections_to_map(with_secrets: Vec<Connection>) -> HashMap<String, Connection> {
    with_secrets
        .into_iter()
        .map(|c| (c.id.clone(), c))
        .collect()
}

impl AppState {
    pub fn new() -> Result<Self> {
        let data_dir = connections::data_dir();
        let metas = connections::load_metadata()?;
        let with_secrets = connections::merge_secrets(metas)?;
        let map = connections_to_map(with_secrets);
        Ok(Self {
            connections: Mutex::new(map),
            data_dir,
            transfers: Mutex::new(HashMap::new()),
        })
    }

    pub async fn reload(&self) -> Result<()> {
        let metas = connections::load_metadata()?;
        let with_secrets = connections::merge_secrets(metas)?;
        let map = connections_to_map(with_secrets);
        let mut guard = self.connections.lock().await;
        *guard = map;
        Ok(())
    }

    pub async fn get_connection(&self, id: &str) -> Result<Connection> {
        let guard = self.connections.lock().await;
        guard
            .get(id)
            .cloned()
            .ok_or_else(|| Error::NotFound(format!("connection '{}'", id)))
    }
}

#[cfg(test)]
mod tests {
    use super::{connections_to_map, AppState};
    use crate::connections::Connection;
    use tokio::sync::Mutex;

    fn conn(id: &str, name: &str) -> Connection {
        Connection {
            id: id.into(),
            name: name.into(),
            provider: "aws".into(),
            endpoint: None,
            region: "us-east-1".into(),
            access_key_id: "AKIA".into(),
            secret_access_key: "secret".into(),
            bucket_filter: None,
        }
    }

    #[test]
    fn connections_to_map_keeps_last_entry_for_duplicate_ids() {
        let map = connections_to_map(vec![conn("c1", "Old"), conn("c1", "New")]);
        assert_eq!(map.len(), 1);
        assert_eq!(map.get("c1").map(|c| c.name.as_str()), Some("New"));
    }

    #[tokio::test]
    async fn get_connection_returns_cloned_connection() {
        let state = AppState {
            connections: Mutex::new(connections_to_map(vec![conn("c1", "Primary")])),
            data_dir: std::env::temp_dir(),
            transfers: Mutex::new(std::collections::HashMap::new()),
        };

        let got = state
            .get_connection("c1")
            .await
            .expect("connection should exist");
        assert_eq!(got.id, "c1");
        assert_eq!(got.name, "Primary");
    }

    #[tokio::test]
    async fn get_connection_reports_not_found_with_connection_context() {
        let state = AppState {
            connections: Mutex::new(std::collections::HashMap::new()),
            data_dir: std::env::temp_dir(),
            transfers: Mutex::new(std::collections::HashMap::new()),
        };

        let err = state
            .get_connection("missing")
            .await
            .expect_err("should return not found");
        assert!(err.to_string().contains("connection 'missing'"));
    }
}
