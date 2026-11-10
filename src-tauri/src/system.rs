//! System settings that affect Wi-Fi stability. Windows: adapter power saving,
//! power plan, driver and location consent. Android: battery saver, battery and
//! the location permission that Wi-Fi details depend on.

use serde::Serialize;

#[cfg(target_os = "android")]
#[path = "system_android.rs"]
mod imp;
#[cfg(not(any(windows, target_os = "android")))]
#[path = "system_stub.rs"]
mod imp;
#[cfg(windows)]
#[path = "system_windows.rs"]
mod imp;

pub use imp::{collect, open_settings_page};

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DriverInfo {
    pub description: Option<String>,
    pub provider: Option<String>,
    pub version: Option<String>,
    pub date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LocationStatus {
    /// "allow" | "deny" | "unknown"
    pub system: String,
    pub user: String,
    pub desktop_apps: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SystemChecks {
    /// 0 = max performance, 1 = low, 2 = medium, 3 = maximum power saving.
    pub wifi_power_saving_ac: Option<u32>,
    pub wifi_power_saving_dc: Option<u32>,
    pub power_scheme: Option<String>,
    /// "best_efficiency" | "balanced" | "best_performance" | None
    pub power_mode: Option<String>,
    pub on_battery: Option<bool>,
    pub battery_percent: Option<u8>,
    pub driver: DriverInfo,
    pub location: LocationStatus,
    /// "windows" | "android" | "other": which of the checks above apply.
    pub platform: String,
}
