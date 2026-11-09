//! Windows settings that affect Wi-Fi stability: adapter power saving, power plan
//! and mode, AC/battery, driver version and location permission. Read-only, no admin.

use serde::Serialize;
use windows::core::GUID;
use windows::Win32::Foundation::{LocalFree, HLOCAL};
use windows::Win32::System::Power::{
    GetSystemPowerStatus, PowerGetActiveScheme, PowerReadACValueIndex, PowerReadDCValueIndex, SYSTEM_POWER_STATUS,
};
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
use winreg::RegKey;

const WIRELESS_SUBGROUP: GUID = GUID::from_u128(0x19cbb8fa_5279_450e_9fac_8a3d5fedd0c1);
const WIRELESS_POWER_SAVING: GUID = GUID::from_u128(0x12bbebe6_58d6_4636_95bb_3217ef867c1a);
const NET_CLASS_KEY: &str = r"SYSTEM\CurrentControlSet\Control\Class\{4d36e972-e325-11ce-bfc1-08002be10318}";
const LOCATION_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\location";

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
}

pub fn collect(wifi_interface_guid: Option<&str>) -> SystemChecks {
    let (ac, dc) = wifi_power_saving();
    let power = power_status();
    let on_battery = power.map(|p| p.ACLineStatus == 0);
    SystemChecks {
        wifi_power_saving_ac: ac,
        wifi_power_saving_dc: dc,
        power_scheme: active_scheme().map(|g| scheme_name(&g)),
        power_mode: power_mode(on_battery.unwrap_or(false)),
        on_battery,
        battery_percent: power.map(|p| p.BatteryLifePercent).filter(|&p| p <= 100),
        driver: wifi_interface_guid.map(driver_info).unwrap_or_default(),
        location: location_status(),
    }
}

fn active_scheme() -> Option<GUID> {
    let mut scheme: *mut GUID = std::ptr::null_mut();
    let rc = unsafe { PowerGetActiveScheme(None, &mut scheme) };
    if rc.0 != 0 || scheme.is_null() {
        return None;
    }
    let guid = unsafe { *scheme };
    unsafe {
        LocalFree(Some(HLOCAL(scheme.cast())));
    }
    Some(guid)
}

fn wifi_power_saving() -> (Option<u32>, Option<u32>) {
    let Some(scheme) = active_scheme() else { return (None, None) };
    let mut ac = 0u32;
    let mut dc = 0u32;
    let ac_rc = unsafe {
        PowerReadACValueIndex(None, Some(&scheme), Some(&WIRELESS_SUBGROUP), Some(&WIRELESS_POWER_SAVING), &mut ac)
    };
    let dc_rc = unsafe {
        PowerReadDCValueIndex(None, Some(&scheme), Some(&WIRELESS_SUBGROUP), Some(&WIRELESS_POWER_SAVING), &mut dc)
    };
    ((ac_rc.0 == 0).then_some(ac), (dc_rc == 0).then_some(dc))
}

fn scheme_name(guid: &GUID) -> String {
    match guid.to_u128() {
        0x381b4222_f694_41f0_9685_ff5bb260df2e => "balanced".into(),
        0x8c5e7fda_e8bf_4a96_9a85_a6e23a8c635c => "high_performance".into(),
        0xa1841308_3541_4fab_bc81_f71556f20b4a => "power_saver".into(),
        0xe9a42b02_d5df_448d_aa00_03f14749eb61 => "ultimate".into(),
        _ => "custom".into(),
    }
}

/// Windows 11 power mode overlay (Settings > System > Power).
fn power_mode(on_battery: bool) -> Option<String> {
    let key = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(r"SYSTEM\CurrentControlSet\Control\Power\User\PowerSchemes")
        .ok()?;
    let name = if on_battery { "ActiveOverlayDcPowerScheme" } else { "ActiveOverlayAcPowerScheme" };
    let value: String = key.get_value(name).ok()?;
    let mode = match value.to_ascii_lowercase().trim_matches(|c| c == '{' || c == '}') {
        "961cc777-2547-4f9d-8174-7d86181b8a7a" => "best_efficiency",
        "3af9b8d9-7c97-431d-ad78-34a8bfea439f" => "balanced_performance",
        "ded574b5-45a0-4f42-8737-46345c09c238" => "best_performance",
        "00000000-0000-0000-0000-000000000000" | "" => "balanced",
        _ => "balanced",
    };
    Some(mode.to_string())
}

fn power_status() -> Option<SYSTEM_POWER_STATUS> {
    let mut status = SYSTEM_POWER_STATUS::default();
    unsafe { GetSystemPowerStatus(&mut status) }.ok()?;
    (status.ACLineStatus != 255).then_some(status)
}

/// Finds the driver of the adapter whose NetCfgInstanceId matches the WLAN interface GUID.
pub fn driver_info(interface_guid: &str) -> DriverInfo {
    let wanted = interface_guid.trim_matches(|c| c == '{' || c == '}').to_ascii_lowercase();
    let Ok(class) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(NET_CLASS_KEY) else {
        return DriverInfo::default();
    };
    for name in class.enum_keys().flatten() {
        let Ok(key) = class.open_subkey(&name) else { continue };
        let id: String = key.get_value("NetCfgInstanceId").unwrap_or_default();
        if id.trim_matches(|c| c == '{' || c == '}').to_ascii_lowercase() == wanted {
            return DriverInfo {
                description: key.get_value("DriverDesc").ok(),
                provider: key.get_value("ProviderName").ok(),
                version: key.get_value("DriverVersion").ok(),
                date: key.get_value("DriverDate").ok(),
            };
        }
    }
    DriverInfo::default()
}

pub fn location_status() -> LocationStatus {
    let read = |root, path: &str| -> String {
        RegKey::predef(root)
            .open_subkey(path)
            .and_then(|k| k.get_value::<String, _>("Value"))
            .map(|v| v.to_ascii_lowercase())
            .unwrap_or_else(|_| "unknown".into())
    };
    LocationStatus {
        system: read(HKEY_LOCAL_MACHINE, LOCATION_KEY),
        user: read(HKEY_CURRENT_USER, LOCATION_KEY),
        desktop_apps: read(HKEY_CURRENT_USER, &format!(r"{LOCATION_KEY}\NonPackaged")),
    }
}

/// Opens a Windows Settings page. Only `ms-settings:` URIs are accepted.
pub fn open_settings_page(uri: &str) -> std::io::Result<()> {
    if !uri.starts_with("ms-settings:") || uri.contains(['"', '&', '|', ' ']) {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "unsupported uri"));
    }
    std::process::Command::new("explorer.exe").arg(uri).spawn().map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_settings_uris() {
        assert!(open_settings_page("https://example.com").is_err());
        assert!(open_settings_page("ms-settings:x & calc").is_err());
    }

    #[test]
    fn collect_does_not_panic() {
        let checks = collect(None);
        assert!(checks.power_scheme.is_some());
    }
}
