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

#[cfg(test)]
mod tests {
    use super::Error;

    #[test]
    fn kind_maps_each_variant_stably() {
        let io = Error::Io(std::io::Error::other("disk"));
        let s3 = Error::S3("denied".into());
        let keyring = Error::Keyring("locked".into());
        let serde = Error::Serde(serde_json::from_str::<serde_json::Value>("{").unwrap_err());
        let not_found = Error::NotFound("conn-1".into());
        let other = Error::Other("oops".into());

        assert_eq!(io.kind(), "Io");
        assert_eq!(s3.kind(), "S3");
        assert_eq!(keyring.kind(), "Keyring");
        assert_eq!(serde.kind(), "Serde");
        assert_eq!(not_found.kind(), "NotFound");
        assert_eq!(other.kind(), "Other");
    }

    #[test]
    fn serializes_as_kind_and_message_object() {
        let err = Error::NotFound("conn-1".into());
        let v = serde_json::to_value(&err).expect("serialize error");

        assert_eq!(v["kind"], "NotFound");
        assert_eq!(v["message"], "not found: conn-1");
    }
}
