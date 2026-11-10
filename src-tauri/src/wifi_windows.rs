//! Wi-Fi state via the Windows Native WiFi API (wlanapi.dll). No `netsh` parsing,
//! so results are identical on Czech, English or any other Windows locale.

use std::ffi::c_void;
use std::ptr;

use windows::core::GUID;
use windows::Win32::Foundation::{ERROR_ACCESS_DENIED, HANDLE};
use windows::Win32::NetworkManagement::WiFi::*;

use super::{enrich_with_bss, format_mac, now_ms, ssid_to_string, BssInfo, WifiConnection, WifiStatus};
use crate::error::{AppError, AppResult};
use crate::ie::{self, Band};

const ERROR_SUCCESS: u32 = 0;
const FILETIME_UNIX_EPOCH_MS: i64 = 11_644_473_600_000;

/// Owns a WLAN client handle; closed on drop.
pub struct WlanClient {
    handle: HANDLE,
}

// The WLAN client handle is a process-wide token, safe to use from any thread.
unsafe impl Send for WlanClient {}
unsafe impl Sync for WlanClient {}

struct Interface {
    guid: GUID,
    description: String,
    state: WLAN_INTERFACE_STATE,
}

impl WlanClient {
    pub fn open() -> AppResult<Self> {
        let mut negotiated = 0u32;
        let mut handle = HANDLE::default();
        let rc = unsafe { WlanOpenHandle(2, None, &mut negotiated, &mut handle) };
        check(rc)?;
        Ok(Self { handle })
    }

    fn primary_interface(&self) -> AppResult<Interface> {
        let mut list: *mut WLAN_INTERFACE_INFO_LIST = ptr::null_mut();
        check(unsafe { WlanEnumInterfaces(self.handle, None, &mut list) })?;
        let _guard = WlanMem(list.cast());
        let interfaces = unsafe {
            let count = (*list).dwNumberOfItems as usize;
            std::slice::from_raw_parts((*list).InterfaceInfo.as_ptr(), count)
        };
        let pick = interfaces
            .iter()
            .find(|i| i.isState == wlan_interface_state_connected)
            .or_else(|| interfaces.first())
            .ok_or(AppError::NoWifiAdapter)?;
        Ok(Interface {
            guid: pick.InterfaceGuid,
            description: utf16_to_string(&pick.strInterfaceDescription),
            state: pick.isState,
        })
    }

    pub fn interface_guid(&self) -> AppResult<GUID> {
        Ok(self.primary_interface()?.guid)
    }

    /// Reads the current connection. `known_bss` lets the caller supply the cached
    /// BSS entry (for frequency and width) without re-querying the list every second.
    pub fn status(&self, known_bss: Option<&BssInfo>) -> WifiStatus {
        let ts = now_ms();
        let iface = match self.primary_interface() {
            Ok(i) => i,
            Err(_) => return WifiStatus::no_adapter(ts),
        };
        let mut status = WifiStatus {
            ts,
            adapter: Some(iface.description.clone()),
            interface_guid: Some(format!("{:?}", iface.guid)),
            state: interface_state_name(iface.state).to_string(),
            location_denied: false,
            connection: None,
        };
        if iface.state != wlan_interface_state_connected {
            return status;
        }
        match self.current_connection(&iface.guid) {
            Ok(attrs) => {
                let mut conn = connection_from_attributes(&attrs);
                conn.rssi = self.query_u32(&iface.guid, wlan_intf_opcode_rssi).ok().map(|v| v as i32);
                conn.channel = self.query_u32(&iface.guid, wlan_intf_opcode_channel_number).ok();
                enrich_with_bss(&mut conn, known_bss);
                status.connection = Some(conn);
            }
            Err(AppError::LocationDenied) => status.location_denied = true,
            Err(_) => {}
        }
        status
    }

    fn current_connection(&self, guid: &GUID) -> AppResult<WLAN_CONNECTION_ATTRIBUTES> {
        let data = self.query(guid, wlan_intf_opcode_current_connection)?;
        let attrs = unsafe { *(data.0 as *const WLAN_CONNECTION_ATTRIBUTES) };
        Ok(attrs)
    }

    fn query_u32(&self, guid: &GUID, opcode: WLAN_INTF_OPCODE) -> AppResult<u32> {
        let data = self.query(guid, opcode)?;
        Ok(unsafe { *(data.0 as *const u32) })
    }

    fn query(&self, guid: &GUID, opcode: WLAN_INTF_OPCODE) -> AppResult<WlanMem> {
        let mut size = 0u32;
        let mut data: *mut c_void = ptr::null_mut();
        check(unsafe { WlanQueryInterface(self.handle, guid, opcode, None, &mut size, &mut data, None) })?;
        Ok(WlanMem(data))
    }

    /// Cached BSS list (no radio scan, so it does not disturb latency).
    pub fn bss_list(&self, connected_bssid: Option<&str>) -> AppResult<Vec<BssInfo>> {
        let guid = self.interface_guid()?;
        let mut list: *mut WLAN_BSS_LIST = ptr::null_mut();
        let rc = unsafe { WlanGetNetworkBssList(self.handle, &guid, None, dot11_BSS_type_any, false, None, &mut list) };
        check(rc)?;
        let _guard = WlanMem(list.cast());
        let entries = unsafe {
            let count = (*list).dwNumberOfItems as usize;
            std::slice::from_raw_parts((*list).wlanBssEntries.as_ptr(), count)
        };
        let mut result: Vec<BssInfo> = entries
            .iter()
            .filter_map(|e| unsafe { bss_from_entry(e) })
            .collect();
        for bss in &mut result {
            bss.connected = connected_bssid.is_some_and(|b| b.eq_ignore_ascii_case(&bss.bssid));
        }
        result.sort_by_key(|b| std::cmp::Reverse(b.rssi));
        Ok(result)
    }

    /// Asks the driver to scan. Results appear in `bss_list` a few seconds later.
    pub fn scan(&self) -> AppResult<()> {
        let guid = self.interface_guid()?;
        check(unsafe { WlanScan(self.handle, &guid, None, None, None) })
    }
}

impl Drop for WlanClient {
    fn drop(&mut self) {
        unsafe {
            WlanCloseHandle(self.handle, None);
        }
    }
}

/// Frees memory allocated by wlanapi.
struct WlanMem(*mut c_void);

impl Drop for WlanMem {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { WlanFreeMemory(self.0) };
        }
    }
}

fn check(rc: u32) -> AppResult<()> {
    match rc {
        ERROR_SUCCESS => Ok(()),
        rc if rc == ERROR_ACCESS_DENIED.0 => Err(AppError::LocationDenied),
        rc => Err(AppError::Wlan(rc)),
    }
}

fn interface_state_name(state: WLAN_INTERFACE_STATE) -> &'static str {
    match state.0 {
        1 => "connected",
        2 | 5 | 6 | 7 => "connecting",
        _ => "disconnected",
    }
}

fn connection_from_attributes(attrs: &WLAN_CONNECTION_ATTRIBUTES) -> WifiConnection {
    let assoc = &attrs.wlanAssociationAttributes;
    let sec = &attrs.wlanSecurityAttributes;
    WifiConnection {
        ssid: ssid_to_string(&assoc.dot11Ssid.ucSSID[..assoc.dot11Ssid.uSSIDLength.min(32) as usize]),
        bssid: format_mac(&assoc.dot11Bssid),
        profile: utf16_to_string(&attrs.strProfileName),
        standard: phy_standard(assoc.dot11PhyType).to_string(),
        signal_quality: assoc.wlanSignalQuality,
        rssi: None,
        rx_mbps: assoc.ulRxRate as f64 / 1000.0,
        tx_mbps: assoc.ulTxRate as f64 / 1000.0,
        channel: None,
        frequency_mhz: None,
        band: None,
        channel_width_mhz: None,
        security: auth_name(sec.dot11AuthAlgorithm, sec.bSecurityEnabled.as_bool()).to_string(),
        cipher: cipher_name(sec.dot11CipherAlgorithm).to_string(),
    }
}

unsafe fn bss_from_entry(entry: &WLAN_BSS_ENTRY) -> Option<BssInfo> {
    let freq_mhz = entry.ulChCenterFrequency / 1000;
    let band = Band::from_frequency_mhz(freq_mhz)?;
    let ies = std::slice::from_raw_parts(
        (entry as *const WLAN_BSS_ENTRY as *const u8).add(entry.ulIeOffset as usize),
        entry.ulIeSize as usize,
    );
    let info = ie::parse(ies);
    let channel = band.channel_from_frequency(freq_mhz);
    let span = info.channel_span(band, channel);
    let ssid_len = entry.dot11Ssid.uSSIDLength.min(32) as usize;
    let ssid_bytes = &entry.dot11Ssid.ucSSID[..ssid_len];
    let privacy = entry.usCapabilityInformation & 0x0010 != 0;
    Some(BssInfo {
        ssid: ssid_to_string(ssid_bytes),
        hidden: ssid_len == 0 || ssid_bytes.iter().all(|&b| b == 0) || (info.ssid.is_some() && info.is_hidden()),
        bssid: format_mac(&entry.dot11Bssid),
        rssi: entry.lRssi,
        link_quality: entry.uLinkQuality,
        frequency_mhz: freq_mhz,
        band: band.as_str().to_string(),
        channel,
        center_channel: span.center_channel,
        width_mhz: span.width_mhz,
        standard: info.standard(band).to_string(),
        security: info.security(privacy).as_str().to_string(),
        station_count: info.station_count,
        channel_utilization: info.channel_utilization.map(|u| u as f64 / 255.0),
        dfs: ie::is_dfs_channel(band, channel),
        connected: false,
        last_seen: (entry.ullHostTimestamp / 10_000) as i64 - FILETIME_UNIX_EPOCH_MS,
    })
}

fn phy_standard(phy: DOT11_PHY_TYPE) -> &'static str {
    match phy.0 {
        11 => "be",
        10 => "ax",
        8 => "ac",
        7 => "n",
        6 => "g",
        4 => "a",
        5 | 2 => "b",
        _ => "unknown",
    }
}

fn auth_name(algo: DOT11_AUTH_ALGORITHM, enabled: bool) -> &'static str {
    match algo.0 {
        1 if !enabled => "open",
        1 | 2 => "wep",
        3 => "wpa-enterprise",
        4 => "wpa-personal",
        6 => "wpa2-enterprise",
        7 => "wpa2-personal",
        8 | 11 => "wpa3-enterprise",
        9 => "wpa3-personal",
        10 => "owe",
        _ => "unknown",
    }
}

fn cipher_name(cipher: DOT11_CIPHER_ALGORITHM) -> &'static str {
    match cipher.0 {
        0 => "none",
        1 | 5 | 257 | 258 => "wep",
        2 => "tkip",
        4 | 0x10 => "aes-ccmp",
        8 | 9 => "gcmp",
        _ => "other",
    }
}

fn utf16_to_string(buf: &[u16]) -> String {
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..len])
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Live check against the real adapter: `cargo test live_ -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live_wifi_snapshot() {
        let client = WlanClient::open().unwrap();
        let status = client.status(None);
        println!("STATUS {}", serde_json::to_string_pretty(&status).unwrap());
        match client.bss_list(status.connection.as_ref().map(|c| c.bssid.as_str())) {
            Ok(list) => {
                println!("BSS count {}", list.len());
                for b in list.iter().take(8) {
                    println!("{}", serde_json::to_string(b).unwrap());
                }
            }
            Err(e) => println!("BSS error {e}"),
        }
        let net = crate::netinfo::primary_adapter().unwrap();
        println!("NET {}", serde_json::to_string_pretty(&net).unwrap());
        if let Some(gw) = net.gateway.and_then(|g| g.parse().ok()) {
            let pinger = crate::ping::Pinger::new().unwrap();
            for _ in 0..3 {
                let r = pinger.echo(gw, 1000, Default::default());
                println!("gw ping {:?} {:?}", r.status, r.rtt_ms);
            }
        }
        println!("SYS {}", serde_json::to_string_pretty(&crate::system::collect(status.interface_guid.as_deref())).unwrap());
    }

    #[test]
    fn utf16_stops_at_nul() {
        let mut buf = [0u16; 8];
        for (i, c) in "Wi-Fi".encode_utf16().enumerate() {
            buf[i] = c;
        }
        assert_eq!(utf16_to_string(&buf), "Wi-Fi");
    }

    #[test]
    fn auth_mapping() {
        assert_eq!(auth_name(DOT11_AUTH_ALGORITHM(7), true), "wpa2-personal");
        assert_eq!(auth_name(DOT11_AUTH_ALGORITHM(9), true), "wpa3-personal");
        assert_eq!(auth_name(DOT11_AUTH_ALGORITHM(1), false), "open");
    }
}
