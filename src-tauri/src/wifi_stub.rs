//! Platforms without a Wi-Fi backend (Linux desktop, used for tests): reports no adapter.

use super::{now_ms, BssInfo, WifiStatus};
use crate::error::{AppError, AppResult};

pub struct WlanClient;

impl WlanClient {
    pub fn open() -> AppResult<Self> {
        Ok(Self)
    }

    pub fn status(&self, _known_bss: Option<&BssInfo>) -> WifiStatus {
        WifiStatus::no_adapter(now_ms())
    }

    pub fn bss_list(&self, _connected_bssid: Option<&str>) -> AppResult<Vec<BssInfo>> {
        Err(AppError::NoWifiAdapter)
    }

    pub fn scan(&self) -> AppResult<()> {
        Err(AppError::NoWifiAdapter)
    }
}
