//! Platforms without system checks (Linux desktop, used for tests).

use super::SystemChecks;

pub fn collect(_wifi_interface_guid: Option<&str>) -> SystemChecks {
    SystemChecks { platform: "other".into(), ..SystemChecks::default() }
}

pub fn open_settings_page(_uri: &str) -> std::io::Result<()> {
    Err(std::io::Error::new(std::io::ErrorKind::Unsupported, "unsupported platform"))
}
