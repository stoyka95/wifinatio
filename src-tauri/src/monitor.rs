//! Background monitor: polls Wi-Fi state every second, keeps the gateway for the
//! pinger up to date, probes DNS periodically and records network events
//! (disconnects, roaming, weak signal, packet loss, outages) into SQLite.

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::dns;
use crate::ping::{PingHub, GATEWAY_ID};
use crate::settings::Language;
use crate::state::AppState;
use crate::wifi::{now_ms, BssInfo, WifiStatus, WlanClient};

pub const EVENT_WIFI_STATUS: &str = "wifi-status";
pub const EVENT_NET_EVENT: &str = "net-event";
pub const EVENT_DNS_PROBE: &str = "dns-probe";
pub const EVENT_SCAN_STATE: &str = "scan-state";

const LOSS_STREAK: usize = 3;
const WEAK_SIGNAL_SECONDS: u32 = 5;
const DNS_PROBE_EVERY: Duration = Duration::from_secs(30);
const NETINFO_EVERY: Duration = Duration::from_secs(15);
const BSS_REFRESH_EVERY: Duration = Duration::from_secs(30);
const DNS_PROBE_DOMAINS: [&str; 4] = ["www.google.com", "www.seznam.cz", "www.cloudflare.com", "www.wikipedia.org"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsProbe {
    pub ts: i64,
    pub server: Option<String>,
    pub ms: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Ongoing {
    Disconnected,
    WeakSignal,
    InternetDown,
    RouterUnreachable,
    PacketLoss,
    DnsFailure,
}

impl Ongoing {
    fn kind(self) -> &'static str {
        match self {
            Self::Disconnected => "disconnected",
            Self::WeakSignal => "weak_signal",
            Self::InternetDown => "internet_down",
            Self::RouterUnreachable => "router_unreachable",
            Self::PacketLoss => "packet_loss",
            Self::DnsFailure => "dns_failure",
        }
    }

    fn severity(self) -> &'static str {
        match self {
            Self::WeakSignal | Self::PacketLoss => "warn",
            _ => "bad",
        }
    }

    fn notify(self) -> bool {
        matches!(self, Self::Disconnected | Self::InternetDown | Self::RouterUnreachable | Self::DnsFailure)
    }
}

struct Monitor {
    app: AppHandle,
    hub: Arc<PingHub>,
    client: Option<WlanClient>,
    previous: Option<WifiStatus>,
    own_bss: Option<BssInfo>,
    open: HashMap<Ongoing, i64>,
    weak_seconds: u32,
    strong_seconds: u32,
    dns_failures: u32,
    last_dns: Option<Instant>,
    last_netinfo: Option<Instant>,
    last_bss: Option<Instant>,
    last_auto_scan: Instant,
    last_tooltip: Option<Instant>,
    force_netinfo: bool,
    dns_server: Option<IpAddr>,
}

pub fn start(app: AppHandle, hub: Arc<PingHub>) {
    thread::Builder::new()
        .name("monitor".into())
        .spawn(move || {
            let mut monitor = Monitor {
                app,
                hub,
                client: WlanClient::open().ok(),
                previous: None,
                own_bss: None,
                open: HashMap::new(),
                weak_seconds: 0,
                strong_seconds: 0,
                dns_failures: 0,
                last_dns: None,
                last_netinfo: None,
                last_bss: None,
                last_auto_scan: Instant::now(),
                last_tooltip: None,
                force_netinfo: true,
                dns_server: None,
            };
            loop {
                let tick = Instant::now();
                monitor.tick();
                thread::sleep(Duration::from_secs(1).saturating_sub(tick.elapsed()));
            }
        })
        .expect("spawn monitor");
}

impl Monitor {
    fn state(&self) -> tauri::State<'_, AppState> {
        self.app.state::<AppState>()
    }

    fn tick(&mut self) {
        if self.client.is_none() {
            self.client = WlanClient::open().ok();
        }
        self.refresh_netinfo_if_due();
        let status = self.read_status();
        // A machine without a Wi-Fi adapter (Ethernet only) keeps pinging normally.
        self.hub.set_offline(!status.is_connected() && status.state != "no_adapter");
        self.detect_wifi_events(&status);
        self.detect_ping_events(status.is_connected());
        self.probe_dns_if_due(status.is_connected());
        self.auto_scan_if_due();
        let _ = self.app.emit(EVENT_WIFI_STATUS, &status);
        self.update_tray_tooltip(&status);
        *self.state().wifi.write() = Some(status.clone());
        self.previous = Some(status);
    }

    fn read_status(&mut self) -> WifiStatus {
        let Some(client) = self.client.as_ref() else {
            return WifiStatus {
                ts: now_ms(),
                adapter: None,
                interface_guid: None,
                state: "no_adapter".into(),
                location_denied: false,
                connection: None,
            };
        };
        let mut status = client.status(self.own_bss.as_ref());
        let bssid = status.connection.as_ref().map(|c| c.bssid.clone());
        let bssid_changed = bssid.as_deref() != self.own_bss.as_ref().map(|b| b.bssid.as_str());
        let due = self.last_bss.is_none_or(|t| t.elapsed() >= BSS_REFRESH_EVERY);
        if bssid.is_some() && (bssid_changed || due) {
            self.last_bss = Some(Instant::now());
            match client.bss_list(bssid.as_deref()) {
                Ok(list) => {
                    self.own_bss = list.into_iter().find(|b| b.connected);
                    status = client.status(self.own_bss.as_ref());
                }
                Err(crate::error::AppError::LocationDenied) => status.location_denied = true,
                Err(_) => {}
            }
        }
        status
    }

    fn refresh_netinfo_if_due(&mut self) {
        let due = self.last_netinfo.is_none_or(|t| t.elapsed() >= NETINFO_EVERY);
        if !due && !self.force_netinfo {
            return;
        }
        self.force_netinfo = false;
        self.last_netinfo = Some(Instant::now());
        if let Ok(info) = crate::netinfo::primary_adapter() {
            self.hub.set_gateway(info.gateway.as_deref().and_then(|g| g.parse::<Ipv4Addr>().ok()));
            self.dns_server = info.dns_servers.iter().find_map(|s| s.parse::<IpAddr>().ok());
            *self.state().netinfo.write() = Some(info);
        } else {
            self.hub.set_gateway(None);
        }
    }

    fn detect_wifi_events(&mut self, status: &WifiStatus) {
        let Some(prev) = self.previous.clone() else {
            if !status.is_connected() && status.state != "no_adapter" {
                self.start_event(Ongoing::Disconnected, json!({}));
            }
            return;
        };
        let (was, is) = (prev.connection.as_ref(), status.connection.as_ref());
        if prev.is_connected() != status.is_connected() || was.map(|c| &c.bssid) != is.map(|c| &c.bssid) {
            self.force_netinfo = true;
        }
        match (prev.is_connected(), status.is_connected()) {
            (true, false) => {
                let ssid = was.map(|c| c.ssid.clone()).unwrap_or_default();
                self.start_event(Ongoing::Disconnected, json!({ "ssid": ssid }));
            }
            (false, true) => {
                self.end_event(Ongoing::Disconnected);
                self.instant_event("connected", "ok", json!({ "ssid": is.map(|c| c.ssid.clone()) }));
            }
            _ => {}
        }
        if let (Some(a), Some(b)) = (was, is) {
            if a.bssid != b.bssid && a.ssid == b.ssid {
                self.instant_event(
                    "roam",
                    "info",
                    json!({ "ssid": b.ssid, "from": a.bssid, "to": b.bssid, "fromRssi": a.rssi, "toRssi": b.rssi }),
                );
            } else if a.bssid == b.bssid && a.channel.is_some() && b.channel.is_some() && a.channel != b.channel {
                self.instant_event("channel_change", "warn", json!({ "from": a.channel, "to": b.channel, "ssid": b.ssid }));
            }
        }
        self.track_signal(is.and_then(|c| c.rssi));
    }

    fn track_signal(&mut self, rssi: Option<i32>) {
        let threshold = self.state().settings.read().weak_signal_dbm;
        match rssi {
            Some(r) if r < threshold => {
                self.weak_seconds += 1;
                self.strong_seconds = 0;
                if self.weak_seconds == WEAK_SIGNAL_SECONDS {
                    self.start_event(Ongoing::WeakSignal, json!({ "rssi": r, "threshold": threshold }));
                }
            }
            Some(r) if r >= threshold + 3 => {
                self.strong_seconds += 1;
                self.weak_seconds = 0;
                if self.strong_seconds >= WEAK_SIGNAL_SECONDS {
                    self.end_event(Ongoing::WeakSignal);
                }
            }
            None => {
                self.weak_seconds = 0;
                self.end_event(Ongoing::WeakSignal);
            }
            _ => {}
        }
    }

    fn detect_ping_events(&mut self, wifi_connected: bool) {
        if !wifi_connected {
            for kind in [Ongoing::InternetDown, Ongoing::RouterUnreachable, Ongoing::PacketLoss] {
                self.end_event(kind);
            }
            return;
        }
        let lost_streak = |samples: &[crate::ping::PingSample]| {
            samples.len() >= LOSS_STREAK && samples.iter().all(|s| s.rtt.is_none() && !s.scan)
        };
        let all_ok = |samples: &[crate::ping::PingSample]| !samples.is_empty() && samples.iter().all(|s| s.rtt.is_some());

        let gateway = self.hub.recent(GATEWAY_ID, LOSS_STREAK);
        let internet: Vec<_> = ["cloudflare", "google"].iter().map(|id| self.hub.recent(id, LOSS_STREAK)).collect();
        let gateway_lost = lost_streak(&gateway);
        let internet_lost = internet.iter().all(|s| lost_streak(s));
        let any_lost = gateway_lost || internet.iter().any(|s| lost_streak(s));

        self.set_ongoing(Ongoing::RouterUnreachable, gateway_lost, json!({}));
        self.set_ongoing(Ongoing::InternetDown, internet_lost && !gateway_lost && all_ok(&gateway), json!({}));
        let lone_loss = any_lost && !internet_lost && !gateway_lost;
        if lone_loss {
            self.set_ongoing(Ongoing::PacketLoss, true, json!({}));
        } else if internet.iter().chain(std::iter::once(&gateway)).all(|s| all_ok(s)) {
            self.end_event(Ongoing::PacketLoss);
        }
    }

    fn probe_dns_if_due(&mut self, connected: bool) {
        if !connected || self.last_dns.is_some_and(|t| t.elapsed() < DNS_PROBE_EVERY) {
            return;
        }
        self.last_dns = Some(Instant::now());
        let Some(server) = self.dns_server else { return };
        let domain = DNS_PROBE_DOMAINS[(now_ms() as usize / 1000) % DNS_PROBE_DOMAINS.len()];
        let ms = dns::timed_query(server, domain, Duration::from_millis(2500)).ok();
        let probe = DnsProbe { ts: now_ms(), server: Some(server.to_string()), ms };
        {
            let state = self.state();
            let mut probes = state.dns_probes.write();
            probes.push(probe.clone());
            let excess = probes.len().saturating_sub(20);
            probes.drain(..excess);
        }
        let _ = self.app.emit(EVENT_DNS_PROBE, probe);
        if ms.is_some() {
            self.dns_failures = 0;
            self.end_event(Ongoing::DnsFailure);
        } else {
            self.dns_failures += 1;
            let internet_ok = self.hub.recent("cloudflare", 2).iter().any(|s| s.rtt.is_some());
            if self.dns_failures >= 2 && internet_ok {
                self.start_event(Ongoing::DnsFailure, json!({ "server": server.to_string() }));
            }
        }
    }

    fn auto_scan_if_due(&mut self) {
        let minutes = self.state().settings.read().auto_scan_minutes;
        if minutes == 0 || self.last_auto_scan.elapsed() < Duration::from_secs(minutes as u64 * 60) {
            return;
        }
        self.last_auto_scan = Instant::now();
        let app = self.app.clone();
        thread::spawn(move || {
            let _ = crate::commands::perform_scan(&app);
        });
    }

    fn update_tray_tooltip(&mut self, status: &WifiStatus) {
        if self.last_tooltip.is_some_and(|t| t.elapsed() < Duration::from_secs(5)) {
            return;
        }
        self.last_tooltip = Some(Instant::now());
        let cs = self.state().settings.read().language == Language::Cs;
        let text = match &status.connection {
            Some(c) => match c.rssi {
                Some(rssi) => format!("Wifinatio\n{} ({rssi} dBm)", c.ssid),
                None => format!("Wifinatio\n{}", c.ssid),
            },
            None if cs => "Wifinatio\nNepřipojeno".to_string(),
            None => "Wifinatio\nNot connected".to_string(),
        };
        if let Some(tray) = self.app.tray_by_id("main") {
            let _ = tray.set_tooltip(Some(text));
        }
    }

    fn set_ongoing(&mut self, kind: Ongoing, active: bool, data: Value) {
        if active {
            self.start_event(kind, data);
        } else {
            self.end_event(kind);
        }
    }

    fn start_event(&mut self, kind: Ongoing, data: Value) {
        if self.open.contains_key(&kind) {
            return;
        }
        let state = self.state();
        let Ok(event) = state.storage.insert_event(now_ms(), kind.kind(), kind.severity(), &data) else { return };
        self.open.insert(kind, event.id);
        let _ = self.app.emit(EVENT_NET_EVENT, &event);
        if kind.notify() {
            self.notify(kind);
        }
    }

    fn end_event(&mut self, kind: Ongoing) {
        let Some(id) = self.open.remove(&kind) else { return };
        if let Ok(Some(event)) = self.state().storage.close_event(id, now_ms()) {
            let _ = self.app.emit(EVENT_NET_EVENT, &event);
        }
    }

    fn instant_event(&mut self, kind: &str, severity: &str, data: Value) {
        let ts = now_ms();
        let state = self.state();
        let storage = &state.storage;
        if let Ok(event) = storage.insert_event(ts, kind, severity, &data) {
            let event = storage.close_event(event.id, ts).ok().flatten().unwrap_or(event);
            let _ = self.app.emit(EVENT_NET_EVENT, &event);
        }
    }

    fn notify(&self, kind: Ongoing) {
        let settings = self.state().settings.read().clone();
        if !settings.notifications {
            return;
        }
        let (title, body) = notification_text(kind, settings.language);
        let _ = self.app.notification().builder().title(title).body(body).show();
    }
}

fn notification_text(kind: Ongoing, lang: Language) -> (&'static str, &'static str) {
    match (kind, lang) {
        (Ongoing::Disconnected, Language::Cs) => ("Wi-Fi odpojena", "Počítač ztratil spojení s Wi-Fi sítí."),
        (Ongoing::Disconnected, Language::En) => ("Wi-Fi disconnected", "The computer lost its Wi-Fi connection."),
        (Ongoing::InternetDown, Language::Cs) => ("Internet nedostupný", "Router odpovídá, ale internet ne. Problém je nejspíš u poskytovatele."),
        (Ongoing::InternetDown, Language::En) => ("Internet unreachable", "The router responds but the internet does not. Likely an ISP issue."),
        (Ongoing::RouterUnreachable, Language::Cs) => ("Router neodpovídá", "Spojení s routerem se přerušilo. Zkontrolujte signál nebo router."),
        (Ongoing::RouterUnreachable, Language::En) => ("Router not responding", "The connection to the router dropped. Check the signal or the router."),
        (Ongoing::DnsFailure, Language::Cs) => ("DNS neodpovídá", "Překlad adres selhává, i když internet funguje."),
        (Ongoing::DnsFailure, Language::En) => ("DNS not responding", "Name resolution fails even though the internet works."),
        (_, Language::Cs) => ("Problém se sítí", "Wifinatio zaznamenalo problém s připojením."),
        (_, Language::En) => ("Network problem", "Wifinatio detected a connection problem."),
    }
}
