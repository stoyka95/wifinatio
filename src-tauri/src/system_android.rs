//! Android checks: battery saver, battery level and the location permission
//! (Wi-Fi names and scans are hidden without it).

use serde::Deserialize;

use super::{LocationStatus, SystemChecks};
use crate::android_bridge;

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct RawDevice {
    power_save: Option<bool>,
    charging: Option<bool>,
    battery_percent: Option<u8>,
    has_permission: bool,
    location_on: bool,
}

pub fn collect(_wifi_interface_guid: Option<&str>) -> SystemChecks {
    let raw: RawDevice = android_bridge::call_json("deviceInfo").unwrap_or_default();
    let allow = |ok: bool| if ok { "allow" } else { "deny" }.to_string();
    SystemChecks {
        power_mode: raw.power_save.map(|on| if on { "best_efficiency" } else { "balanced" }.to_string()),
        on_battery: raw.charging.map(|c| !c),
        battery_percent: raw.battery_percent.filter(|&p| p <= 100),
        location: LocationStatus {
            system: allow(raw.location_on),
            user: allow(raw.has_permission),
            desktop_apps: allow(raw.has_permission),
        },
        platform: "android".into(),
        ..SystemChecks::default()
    }
}

/// The frontend passes Windows `ms-settings:` URIs; they map to the nearest Android
/// screen. Location first asks for the permission and opens settings only when
/// the system will no longer show the prompt.
pub fn open_settings_page(uri: &str) -> std::io::Result<()> {
    let page = if uri.contains("location") { "location" } else if uri.contains("network") { "wifi" } else { "app" };
    android_bridge::call_string_arg("openSettings", page)
        .map(|_| ())
        .map_err(|e| std::io::Error::other(e.to_string()))
}
