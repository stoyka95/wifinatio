use serde::{Serialize, Serializer};

/// Errors returned from Tauri commands. They serialize to a stable string code
/// (for known cases) or a readable message, which the frontend localizes.
#[derive(Debug, thiserror::Error)]
#[cfg_attr(not(windows), allow(dead_code))]
pub enum AppError {
    #[error("location_denied")]
    LocationDenied,
    #[error("no_wifi_adapter")]
    NoWifiAdapter,
    #[error("cancelled")]
    Cancelled,
    #[error("busy")]
    Busy,
    #[error("wlan_error:{0}")]
    Wlan(u32),
    #[error("{0}")]
    Message(String),
    #[error("database: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("http: {0}")]
    Http(#[from] reqwest::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
}

impl AppError {
    pub fn msg(text: impl Into<String>) -> Self {
        Self::Message(text.into())
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
