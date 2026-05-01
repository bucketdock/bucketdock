use thiserror::Error;

#[derive(Debug, Error)]
#[allow(dead_code)]
pub enum Error {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("S3 error: {0}")]
    S3(String),

    #[error("keyring error: {0}")]
    Keyring(String),

    #[error("serde error: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("{0}")]
    Other(String),
}

impl Error {
    fn kind(&self) -> &str {
        match self {
            Error::Io(_) => "Io",
            Error::S3(_) => "S3",
            Error::Keyring(_) => "Keyring",
            Error::Serde(_) => "Serde",
            Error::NotFound(_) => "NotFound",
            Error::Other(_) => "Other",
        }
    }
}

impl serde::Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        let mut map = serializer.serialize_map(Some(2))?;
        map.serialize_entry("kind", self.kind())?;
        map.serialize_entry("message", &self.to_string())?;
        map.end()
    }
}

pub type Result<T> = std::result::Result<T, Error>;
