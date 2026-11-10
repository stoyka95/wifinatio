//! Wi-Fi state shared by all platforms. The platform layer (`WlanClient`) reads
//! the radio: Native WiFi API on Windows, WifiManager (via JNI) on Android.

use serde::Serialize;

use crate::ie::Band;

#[cfg(target_os = "android")]
#[path = "wifi_android.rs"]
mod imp;
#[cfg(not(any(windows, target_os = "android")))]
#[path = "wifi_stub.rs"]
mod imp;
#[cfg(windows)]
#[path = "wifi_windows.rs"]
mod imp;

pub use imp::WlanClient;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WifiConnection {
    pub ssid: String,
    pub bssid: String,
    pub profile: String,
    pub standard: String,
    pub signal_quality: u32,
    pub rssi: Option<i32>,
    pub rx_mbps: f64,
    pub tx_mbps: f64,
    pub channel: Option<u32>,
    pub frequency_mhz: Option<u32>,
    pub band: Option<String>,
    pub channel_width_mhz: Option<u32>,
    pub security: String,
    pub cipher: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WifiStatus {
    pub ts: i64,
    pub adapter: Option<String>,
    pub interface_guid: Option<String>,
    /// "connected" | "disconnected" | "connecting" | "no_adapter"
    pub state: String,
    pub location_denied: bool,
    pub connection: Option<WifiConnection>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BssInfo {
    pub ssid: String,
    pub hidden: bool,
    pub bssid: String,
    pub rssi: i32,
    pub link_quality: u32,
    pub frequency_mhz: u32,
    pub band: String,
    pub channel: u32,
    pub center_channel: u32,
    pub width_mhz: u32,
    pub standard: String,
    pub security: String,
    pub station_count: Option<u16>,
    /// 0.0–1.0, from the BSS Load element when the AP advertises it.
    pub channel_utilization: Option<f64>,
    pub dfs: bool,
    pub connected: bool,
    pub last_seen: i64,
}

impl WifiStatus {
    pub(crate) fn no_adapter(ts: i64) -> Self {
        Self {
            ts,
            adapter: None,
            interface_guid: None,
            state: "no_adapter".into(),
            location_denied: false,
            connection: None,
        }
    }

    pub fn is_connected(&self) -> bool {
        self.state == "connected"
    }
}

/// Fills frequency, band and width of the connection from its BSS entry when known.
pub(crate) fn enrich_with_bss(conn: &mut WifiConnection, bss: Option<&BssInfo>) {
    match bss.filter(|b| b.bssid.eq_ignore_ascii_case(&conn.bssid)) {
        Some(b) => {
            conn.frequency_mhz = Some(b.frequency_mhz);
            conn.band = Some(b.band.clone());
            conn.channel_width_mhz = Some(b.width_mhz);
            conn.channel = conn.channel.or(Some(b.channel));
            if conn.standard == "unknown" {
                conn.standard = b.standard.clone();
            }
            if conn.security == "unknown" {
                conn.security = b.security.clone();
            }
        }
        None => {
            // Without the BSS entry the band is inferred from the channel number.
            if let Some(ch) = conn.channel {
                if conn.frequency_mhz.is_none() {
                    let band = if ch <= 14 { Band::G2 } else { Band::G5 };
                    conn.band = Some(band.as_str().to_string());
                    conn.frequency_mhz = Some(band.frequency_from_channel(ch));
                }
            }
        }
    }
}

/// Converts RSSI to a 0–100 quality figure the way Windows does (−100 dBm = 0, −50 dBm = 100).
#[cfg_attr(windows, allow(dead_code))]
pub fn rssi_to_quality(rssi: i32) -> u32 {
    ((rssi + 100) * 2).clamp(0, 100) as u32
}

#[cfg_attr(not(windows), allow(dead_code))]
pub fn format_mac(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect::<Vec<_>>().join(":")
}

#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn ssid_to_string(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).trim_end_matches('\0').to_string()
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mac_formatting() {
        assert_eq!(format_mac(&[0xAA, 0x01, 0x02, 0x03, 0x04, 0xFF]), "aa:01:02:03:04:ff");
    }

    #[test]
    fn quality_from_rssi() {
        assert_eq!(rssi_to_quality(-50), 100);
        assert_eq!(rssi_to_quality(-75), 50);
        assert_eq!(rssi_to_quality(-110), 0);
    }
}
