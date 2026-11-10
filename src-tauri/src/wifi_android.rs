//! Wi-Fi state on Android via WifiManager / ConnectivityManager (NetBridge.kt).
//! Scan results carry the raw information elements on Android 11+, so they go
//! through the same IE parser as on Windows.

use serde::Deserialize;

use super::{enrich_with_bss, now_ms, rssi_to_quality, BssInfo, WifiConnection, WifiStatus};
use crate::android_bridge;
use crate::error::{AppError, AppResult};
use crate::ie::{self, Band, Security};

pub struct WlanClient;

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct RawStatus {
    wifi_enabled: bool,
    has_permission: bool,
    location_on: bool,
    connected: bool,
    connecting: bool,
    ssid: Option<String>,
    bssid: Option<String>,
    rssi: Option<i32>,
    link_mbps: Option<f64>,
    tx_mbps: Option<f64>,
    rx_mbps: Option<f64>,
    frequency: Option<u32>,
    standard: Option<String>,
    security: Option<String>,
    device: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct RawScan {
    ssid: String,
    bssid: String,
    level: i32,
    frequency: u32,
    /// ScanResult.CHANNEL_WIDTH_*: 0 = 20, 1 = 40, 2 = 80, 3 = 160, 4 = 80+80, 5 = 320 MHz.
    channel_width: Option<u32>,
    center_freq0: Option<u32>,
    capabilities: String,
    last_seen: i64,
    standard: Option<String>,
    /// Raw information elements as hex (id, length, body …), Android 11+.
    ies: Option<String>,
}

impl WlanClient {
    pub fn open() -> AppResult<Self> {
        Ok(Self)
    }

    pub fn status(&self, known_bss: Option<&BssInfo>) -> WifiStatus {
        let ts = now_ms();
        let Ok(raw) = android_bridge::call_json::<RawStatus>("wifiStatus") else {
            return WifiStatus::no_adapter(ts);
        };
        let state = match (raw.wifi_enabled, raw.connected, raw.connecting) {
            (_, true, _) => "connected",
            (true, false, true) => "connecting",
            _ => "disconnected",
        };
        let mut status = WifiStatus {
            ts,
            adapter: raw.device.clone(),
            interface_guid: None,
            state: state.into(),
            location_denied: false,
            connection: None,
        };
        if !raw.connected {
            return status;
        }
        // Without the location permission (or with location off) Android hides SSID and BSSID.
        let hidden = raw.bssid.as_deref().is_none_or(|b| b == "02:00:00:00:00:00");
        if !raw.has_permission || !raw.location_on || hidden {
            status.location_denied = true;
            return status;
        }
        let frequency = raw.frequency.filter(|&f| f > 0);
        let band = frequency.and_then(Band::from_frequency_mhz);
        let mut conn = WifiConnection {
            ssid: raw.ssid.unwrap_or_default(),
            bssid: raw.bssid.unwrap_or_default().to_ascii_lowercase(),
            // Android has no saved-profile names distinct from the SSID.
            profile: String::new(),
            standard: raw.standard.unwrap_or_else(|| "unknown".into()),
            signal_quality: raw.rssi.map(rssi_to_quality).unwrap_or(0),
            rssi: raw.rssi,
            rx_mbps: raw.rx_mbps.filter(|&v| v > 0.0).or(raw.link_mbps).unwrap_or(0.0),
            tx_mbps: raw.tx_mbps.filter(|&v| v > 0.0).or(raw.link_mbps).unwrap_or(0.0),
            channel: band.zip(frequency).map(|(b, f)| b.channel_from_frequency(f)),
            frequency_mhz: frequency,
            band: band.map(|b| b.as_str().to_string()),
            channel_width_mhz: None,
            security: raw.security.unwrap_or_else(|| "unknown".into()),
            cipher: String::new(),
        };
        enrich_with_bss(&mut conn, known_bss);
        status.connection = Some(conn);
        status
    }

    /// Last scan results kept by the system (no new radio scan).
    pub fn bss_list(&self, connected_bssid: Option<&str>) -> AppResult<Vec<BssInfo>> {
        let permission: bool = android_bridge::call_json("hasLocation")?;
        if !permission {
            return Err(AppError::LocationDenied);
        }
        let raw: Vec<RawScan> = android_bridge::call_json("scanResults")?;
        let mut list: Vec<BssInfo> = raw.into_iter().filter_map(bss_from_scan).collect();
        for bss in &mut list {
            bss.connected = connected_bssid.is_some_and(|b| b.eq_ignore_ascii_case(&bss.bssid));
        }
        list.sort_by_key(|b| std::cmp::Reverse(b.rssi));
        Ok(list)
    }

    /// Requests a scan. Android throttles apps to four scans per two minutes;
    /// a refused request still leaves the previous results readable.
    pub fn scan(&self) -> AppResult<()> {
        android_bridge::call_string("startScan").map(|_| ())
    }
}

fn bss_from_scan(raw: RawScan) -> Option<BssInfo> {
    let band = Band::from_frequency_mhz(raw.frequency)?;
    let channel = band.channel_from_frequency(raw.frequency);
    let ies = raw.ies.as_deref().and_then(hex_decode).unwrap_or_default();
    let info = ie::parse(&ies);
    let has_ies = !ies.is_empty();

    let (center_channel, width_mhz) = if has_ies {
        let span = info.channel_span(band, channel);
        (span.center_channel, span.width_mhz)
    } else {
        let width = match raw.channel_width {
            Some(1) => 40,
            Some(2) => 80,
            Some(3) | Some(4) => 160,
            Some(5) => 320,
            _ => 20,
        };
        let center = raw
            .center_freq0
            .filter(|&f| f > 0 && width > 20)
            .map(|f| band.channel_from_frequency(f))
            .unwrap_or(channel);
        (center, width)
    };
    let privacy = ["WEP", "WPA", "SAE", "OWE", "EAP"].iter().any(|k| raw.capabilities.contains(k));
    let security = if has_ies { info.security(privacy).as_str().to_string() } else { security_from_capabilities(&raw.capabilities) };
    let standard = match (has_ies, raw.standard) {
        (true, _) => info.standard(band).to_string(),
        (false, Some(s)) => s,
        (false, None) => "unknown".into(),
    };
    let hidden = raw.ssid.is_empty() || (info.ssid.is_some() && info.is_hidden());
    Some(BssInfo {
        ssid: raw.ssid,
        hidden,
        bssid: raw.bssid.to_ascii_lowercase(),
        rssi: raw.level,
        link_quality: rssi_to_quality(raw.level),
        frequency_mhz: raw.frequency,
        band: band.as_str().to_string(),
        channel,
        center_channel,
        width_mhz,
        standard,
        security,
        station_count: info.station_count,
        channel_utilization: info.channel_utilization.map(|u| u as f64 / 255.0),
        dfs: ie::is_dfs_channel(band, channel),
        connected: false,
        last_seen: raw.last_seen,
    })
}

/// "[WPA2-PSK-CCMP][RSN-SAE-CCMP][ESS]" style capability strings (pre-Android 11).
fn security_from_capabilities(caps: &str) -> String {
    let s = if caps.contains("EAP") {
        if caps.contains("SUITE_B") || caps.contains("EAP_SUITE_B_192") { Security::Wpa3Enterprise } else { Security::Wpa2Enterprise }
    } else if caps.contains("SAE") && caps.contains("PSK") {
        Security::Wpa3Transition
    } else if caps.contains("SAE") {
        Security::Wpa3Personal
    } else if caps.contains("OWE") {
        Security::Owe
    } else if caps.contains("RSN") || caps.contains("WPA2") {
        Security::Wpa2Personal
    } else if caps.contains("WPA") {
        Security::WpaPersonal
    } else if caps.contains("WEP") {
        Security::Wep
    } else {
        Security::Open
    };
    s.as_str().to_string()
}

fn hex_decode(hex: &str) -> Option<Vec<u8>> {
    if hex.len() % 2 != 0 {
        return None;
    }
    (0..hex.len()).step_by(2).map(|i| u8::from_str_radix(&hex[i..i + 2], 16).ok()).collect()
}
