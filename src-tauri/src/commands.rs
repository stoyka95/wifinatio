//! Tauri commands: the typed API surface used by the frontend (see src/lib/api.ts).

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr};
use std::sync::atomic::Ordering;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::error::{AppError, AppResult};
use crate::monitor::{DnsProbe, EVENT_SCAN_STATE};
use crate::netinfo::{self, Ipv6Check, MtuResult, NetInfo, PublicInfo};
use crate::ping::{default_targets, PingSample, PingTarget};
use crate::settings::{Settings, Theme};
use crate::speedtest::{self, SpeedResult};
use crate::state::AppState;
use crate::storage::{HistoryKind, NetEvent, StoredRecord};
use crate::system::{self, SystemChecks};
use crate::wifi::{now_ms, BssInfo, WifiStatus, WlanClient};
use crate::{dns, trace};

/// Scanning makes the adapter leave its channel; samples in this window are flagged.
const SCAN_SETTLE: Duration = Duration::from_millis(4500);
const SCAN_FLAG_MARGIN_MS: i64 = 1500;

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> AppResult<T> + Send + 'static) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::msg(e.to_string()))?
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    state.settings.read().clone()
}

#[tauri::command]
pub fn save_settings(app: AppHandle, state: State<'_, AppState>, settings: Settings) -> AppResult<Settings> {
    let settings = settings.sanitized();
    let previous = state.settings.read().clone();
    state.storage.save_settings(&settings)?;
    *state.settings.write() = settings.clone();
    if previous.ping_interval_ms != settings.ping_interval_ms || previous.custom_targets != settings.custom_targets {
        state
            .hub
            .restart(app.clone(), default_targets(&settings.custom_targets), settings.ping_interval_ms);
    }
    if previous.theme != settings.theme {
        crate::apply_window_effects(&app, settings.theme);
    }
    Ok(settings)
}

#[tauri::command]
pub fn set_window_theme(app: AppHandle, theme: Theme) {
    crate::apply_window_effects(&app, theme);
}

#[tauri::command]
pub async fn get_wifi_status(state: State<'_, AppState>) -> AppResult<WifiStatus> {
    if let Some(status) = state.wifi.read().clone() {
        return Ok(status);
    }
    blocking(|| Ok(WlanClient::open()?.status(None))).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PingHistory {
    targets: Vec<PingTarget>,
    samples: HashMap<String, Vec<PingSample>>,
    interval_ms: u64,
    dns_probes: Vec<DnsProbe>,
}

/// Everything measured so far, so a freshly opened window starts with full charts.
#[tauri::command]
pub fn get_ping_history(state: State<'_, AppState>) -> PingHistory {
    PingHistory {
        targets: state.hub.targets(),
        samples: state.hub.history(),
        interval_ms: state.settings.read().ping_interval_ms,
        dns_probes: state.dns_probes.read().clone(),
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NetworkList {
    networks: Vec<BssInfo>,
    last_scan: Option<i64>,
    location_denied: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ScanState {
    active: bool,
}

fn connected_bssid(state: &AppState) -> Option<String> {
    state.wifi.read().as_ref()?.connection.as_ref().map(|c| c.bssid.clone())
}

fn read_networks(state: &AppState) -> AppResult<NetworkList> {
    let bssid = connected_bssid(state);
    let last = state.last_scan.load(Ordering::Relaxed);
    match WlanClient::open()?.bss_list(bssid.as_deref()) {
        Ok(list) => {
            *state.networks.write() = list.clone();
            Ok(NetworkList { networks: list, last_scan: (last > 0).then_some(last), location_denied: false })
        }
        Err(AppError::LocationDenied) => Ok(NetworkList { networks: Vec::new(), last_scan: None, location_denied: true }),
        Err(e) => Err(e),
    }
}

/// Cached results only: reading the list does not trigger a radio scan.
#[tauri::command]
pub async fn get_networks(app: AppHandle) -> AppResult<NetworkList> {
    blocking(move || read_networks(&app.state::<AppState>())).await
}

/// Triggers a radio scan, waits for it to settle and returns fresh results.
pub fn perform_scan(app: &AppHandle) -> AppResult<NetworkList> {
    let state = app.state::<AppState>();
    if state.scanning.swap(true, Ordering::SeqCst) {
        return Err(AppError::Busy);
    }
    let result = (|| {
        let started = now_ms();
        state.hub.mark_scan(started + SCAN_SETTLE.as_millis() as i64 + SCAN_FLAG_MARGIN_MS);
        let _ = app.emit(EVENT_SCAN_STATE, ScanState { active: true });
        WlanClient::open()?.scan()?;
        std::thread::sleep(SCAN_SETTLE);
        state.last_scan.store(now_ms(), Ordering::Relaxed);
        read_networks(&state)
    })();
    state.scanning.store(false, Ordering::SeqCst);
    let _ = app.emit(EVENT_SCAN_STATE, ScanState { active: false });
    result
}

#[tauri::command]
pub async fn scan_networks(app: AppHandle) -> AppResult<NetworkList> {
    blocking(move || perform_scan(&app)).await
}

#[tauri::command]
pub async fn get_netinfo(state: State<'_, AppState>) -> AppResult<NetInfo> {
    let info = blocking(netinfo::primary_adapter).await?;
    *state.netinfo.write() = Some(info.clone());
    Ok(info)
}

#[tauri::command]
pub async fn get_public_info() -> AppResult<PublicInfo> {
    netinfo::public_info().await
}

#[tauri::command]
pub async fn check_ipv6() -> AppResult<Ipv6Check> {
    blocking(|| Ok(netinfo::ipv6_check(&netinfo::primary_adapter()?))).await
}

#[tauri::command]
pub async fn test_mtu() -> AppResult<MtuResult> {
    blocking(|| netinfo::mtu_test(Ipv4Addr::new(1, 1, 1, 1))).await
}

fn system_dns_servers(state: &AppState) -> Vec<String> {
    let cached = state.netinfo.read().as_ref().map(|n| n.dns_servers.clone());
    cached
        .filter(|s| !s.is_empty())
        .or_else(|| netinfo::primary_adapter().ok().map(|n| n.dns_servers))
        .unwrap_or_default()
}

#[tauri::command]
pub async fn run_dns_test(app: AppHandle) -> AppResult<dns::DnsTestResult> {
    blocking(move || Ok(dns::run_test(&system_dns_servers(&app.state::<AppState>())))).await
}

#[tauri::command]
pub async fn run_traceroute(app: AppHandle, target: String) -> AppResult<trace::TraceResult> {
    let target = target.trim().to_string();
    if target.is_empty() || target.len() > 253 || target.contains(char::is_whitespace) {
        return Err(AppError::msg("invalid_target"));
    }
    blocking(move || {
        let server = system_dns_servers(&app.state::<AppState>())
            .iter()
            .find_map(|s| s.parse::<IpAddr>().ok());
        trace::run(&target, server)
    })
    .await
}

#[tauri::command]
pub async fn run_speedtest(app: AppHandle, room: Option<String>) -> AppResult<SpeedResult> {
    let state = app.state::<AppState>();
    let mut result = speedtest::run(&app, &state.speed).await?;
    result.room = room.filter(|r| !r.trim().is_empty());
    result.wifi = state.wifi.read().as_ref().and_then(|w| w.connection.clone());
    state
        .storage
        .insert_speedtest(result.ts, result.room.as_deref(), &serde_json::to_value(&result)?)?;
    Ok(result)
}

#[tauri::command]
pub fn cancel_speedtest(state: State<'_, AppState>) {
    state.speed.cancel();
}

#[tauri::command]
pub fn list_speedtests(state: State<'_, AppState>, limit: Option<u32>) -> AppResult<Vec<StoredRecord>> {
    state.storage.list_speedtests(limit.unwrap_or(200))
}

#[tauri::command]
pub fn list_events(state: State<'_, AppState>, since: Option<i64>, limit: Option<u32>) -> AppResult<Vec<NetEvent>> {
    state.storage.list_events(since.unwrap_or(0), limit.unwrap_or(1000))
}

#[tauri::command]
pub fn save_snapshot(
    state: State<'_, AppState>,
    room: String,
    note: Option<String>,
    data: Value,
) -> AppResult<i64> {
    let room = room.trim();
    if room.is_empty() {
        return Err(AppError::msg("room_required"));
    }
    state.storage.insert_snapshot(now_ms(), room, note.as_deref().filter(|n| !n.trim().is_empty()), &data)
}

#[tauri::command]
pub fn list_snapshots(state: State<'_, AppState>) -> AppResult<Vec<StoredRecord>> {
    state.storage.list_snapshots(500)
}

#[tauri::command]
pub fn delete_snapshot(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    state.storage.delete_snapshot(id)
}

#[tauri::command]
pub fn save_report(state: State<'_, AppState>, data: Value) -> AppResult<i64> {
    state.storage.insert_report(now_ms(), &data)
}

#[tauri::command]
pub fn list_reports(state: State<'_, AppState>) -> AppResult<Vec<StoredRecord>> {
    state.storage.list_reports(50)
}

#[tauri::command]
pub fn clear_history(state: State<'_, AppState>, kind: HistoryKind) -> AppResult<()> {
    state.storage.clear(kind)
}

#[tauri::command]
pub async fn get_system_checks(app: AppHandle) -> AppResult<SystemChecks> {
    blocking(move || {
        let guid = app
            .state::<AppState>()
            .wifi
            .read()
            .as_ref()
            .and_then(|w| w.interface_guid.clone());
        Ok(system::collect(guid.as_deref()))
    })
    .await
}

#[tauri::command]
pub fn open_settings_page(uri: String) -> AppResult<()> {
    system::open_settings_page(&uri).map_err(Into::into)
}

/// Writes an exported report to a path the user picked in the save dialog.
#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> AppResult<()> {
    let lower = path.to_ascii_lowercase();
    if ![".md", ".json", ".txt"].iter().any(|ext| lower.ends_with(ext)) {
        return Err(AppError::msg("unsupported_extension"));
    }
    std::fs::write(path, contents).map_err(Into::into)
}

/// Close button: hide to tray when enabled, otherwise quit.
#[tauri::command]
pub fn request_close(app: AppHandle, state: State<'_, AppState>) {
    if state.settings.read().run_in_tray {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.hide();
        }
    } else {
        app.exit(0);
    }
}
