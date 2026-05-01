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

impl AppState {
    pub fn new() -> Result<Self> {
        let data_dir = connections::data_dir();
        let metas = connections::load_metadata()?;
        let with_secrets = connections::merge_secrets(metas)?;
        let map = with_secrets.into_iter().map(|c| (c.id.clone(), c)).collect();
        Ok(Self {
            connections: Mutex::new(map),
            data_dir,
            transfers: Mutex::new(HashMap::new()),
        })
    }

    pub async fn reload(&self) -> Result<()> {
        let metas = connections::load_metadata()?;
        let with_secrets = connections::merge_secrets(metas)?;
        let map: HashMap<String, Connection> =
            with_secrets.into_iter().map(|c| (c.id.clone(), c)).collect();
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
