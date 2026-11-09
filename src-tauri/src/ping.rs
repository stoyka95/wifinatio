//! ICMP echo via IcmpSendEcho2 (no admin rights, no ping.exe) and the background
//! multi-target ping monitor that streams samples to the frontend.

use std::collections::{HashMap, VecDeque};
use std::net::Ipv4Addr;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use parking_lot::{Mutex, RwLock};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use windows::Win32::Foundation::{GetLastError, HANDLE};
use windows::Win32::NetworkManagement::IpHelper::{
    IcmpCloseHandle, IcmpCreateFile, IcmpSendEcho2, ICMP_ECHO_REPLY, IP_FLAG_DF, IP_OPTION_INFORMATION,
    IP_PACKET_TOO_BIG, IP_SUCCESS, IP_TTL_EXPIRED_TRANSIT,
};

use crate::error::{AppError, AppResult};
use crate::wifi::now_ms;

pub const EVENT_PING_SAMPLE: &str = "ping-sample";
const HISTORY_SECONDS: u64 = 3600;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EchoStatus {
    Reply,
    TtlExpired,
    TooBig,
    Timeout,
    Unreachable,
}

#[derive(Debug, Clone, Copy)]
pub struct EchoReply {
    pub status: EchoStatus,
    pub rtt_ms: Option<f64>,
    pub from: Option<Ipv4Addr>,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct EchoOptions {
    pub ttl: Option<u8>,
    pub dont_fragment: bool,
    pub payload_size: u16,
}

/// Owns an ICMP handle; one per thread.
pub struct Pinger {
    handle: HANDLE,
}

impl Pinger {
    pub fn new() -> AppResult<Self> {
        let handle = unsafe { IcmpCreateFile() }.map_err(|e| AppError::msg(format!("IcmpCreateFile: {e}")))?;
        Ok(Self { handle })
    }

    pub fn echo(&self, dest: Ipv4Addr, timeout_ms: u32, opts: EchoOptions) -> EchoReply {
        let payload_size = opts.payload_size.max(8);
        let payload = vec![0x57u8; payload_size as usize];
        let mut reply_buf = vec![0u8; std::mem::size_of::<ICMP_ECHO_REPLY>() + payload_size as usize + 1024];
        let options = IP_OPTION_INFORMATION {
            Ttl: opts.ttl.unwrap_or(128),
            Tos: 0,
            Flags: if opts.dont_fragment { IP_FLAG_DF as u8 } else { 0 },
            OptionsSize: 0,
            OptionsData: std::ptr::null_mut(),
        };
        let started = Instant::now();
        let count = unsafe {
            IcmpSendEcho2(
                self.handle,
                None,
                None,
                None,
                u32::from_ne_bytes(dest.octets()),
                payload.as_ptr().cast(),
                payload_size,
                Some(&options),
                reply_buf.as_mut_ptr().cast(),
                reply_buf.len() as u32,
                timeout_ms,
            )
        };
        let elapsed = started.elapsed().as_secs_f64() * 1000.0;
        let reply = unsafe { &*(reply_buf.as_ptr() as *const ICMP_ECHO_REPLY) };
        let status_code = if count > 0 { reply.Status } else { unsafe { GetLastError().0 } };
        let from = (reply.Address != 0).then(|| Ipv4Addr::from(reply.Address.to_ne_bytes()));
        let status = match status_code {
            IP_SUCCESS if count > 0 => EchoStatus::Reply,
            IP_TTL_EXPIRED_TRANSIT => EchoStatus::TtlExpired,
            IP_PACKET_TOO_BIG => EchoStatus::TooBig,
            11010 => EchoStatus::Timeout,
            _ if count == 0 && elapsed >= timeout_ms as f64 * 0.9 => EchoStatus::Timeout,
            _ => EchoStatus::Unreachable,
        };
        let rtt_ms = matches!(status, EchoStatus::Reply | EchoStatus::TtlExpired).then_some(elapsed);
        EchoReply { status, rtt_ms, from }
    }
}

impl Drop for Pinger {
    fn drop(&mut self) {
        unsafe {
            let _ = IcmpCloseHandle(self.handle);
        }
    }
}

// ICMP handles are not tied to the creating thread.
unsafe impl Send for Pinger {}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PingTarget {
    pub id: String,
    pub label: String,
    /// None for the gateway, which is resolved at runtime.
    pub address: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PingSample {
    pub target: String,
    pub ts: i64,
    /// None means the probe was lost.
    pub rtt: Option<f64>,
    /// True when a Wi-Fi scan was running; such samples are excluded from diagnosis.
    pub scan: bool,
}

pub const GATEWAY_ID: &str = "gateway";

pub fn default_targets(custom: &[String]) -> Vec<PingTarget> {
    let mut targets = vec![
        PingTarget { id: GATEWAY_ID.into(), label: "Router".into(), address: None },
        PingTarget { id: "cloudflare".into(), label: "1.1.1.1".into(), address: Some("1.1.1.1".into()) },
        PingTarget { id: "google".into(), label: "8.8.8.8".into(), address: Some("8.8.8.8".into()) },
    ];
    targets.extend(custom.iter().map(|addr| PingTarget {
        id: format!("custom:{addr}"),
        label: addr.clone(),
        address: Some(addr.clone()),
    }));
    targets
}

/// Shared state of the ping monitor. Worker threads exit when `generation` changes.
pub struct PingHub {
    targets: RwLock<Vec<PingTarget>>,
    buffers: Mutex<HashMap<String, VecDeque<PingSample>>>,
    gateway: RwLock<Option<Ipv4Addr>>,
    generation: AtomicU64,
    interval_ms: AtomicU64,
    scan_until: AtomicI64,
    /// Set while Wi-Fi is disconnected: probes would only measure the outage the
    /// event log already records, and would read as packet loss.
    offline: AtomicBool,
}

impl PingHub {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            targets: RwLock::new(Vec::new()),
            buffers: Mutex::new(HashMap::new()),
            gateway: RwLock::new(None),
            generation: AtomicU64::new(0),
            interval_ms: AtomicU64::new(1000),
            scan_until: AtomicI64::new(0),
            offline: AtomicBool::new(false),
        })
    }

    pub fn set_offline(&self, offline: bool) {
        self.offline.store(offline, Ordering::Relaxed);
    }

    pub fn set_gateway(&self, gw: Option<Ipv4Addr>) {
        *self.gateway.write() = gw;
    }

    pub fn gateway(&self) -> Option<Ipv4Addr> {
        *self.gateway.read()
    }

    pub fn targets(&self) -> Vec<PingTarget> {
        self.targets.read().clone()
    }

    /// Marks a time window in which samples are flagged as "during scan".
    pub fn mark_scan(&self, until_ms: i64) {
        self.scan_until.fetch_max(until_ms, Ordering::Relaxed);
    }

    pub fn scan_active(&self) -> bool {
        now_ms() <= self.scan_until.load(Ordering::Relaxed)
    }

    pub fn history(&self) -> HashMap<String, Vec<PingSample>> {
        self.buffers
            .lock()
            .iter()
            .map(|(k, v)| (k.clone(), v.iter().cloned().collect()))
            .collect()
    }

    /// The latest `n` samples of one target, oldest first.
    pub fn recent(&self, target: &str, n: usize) -> Vec<PingSample> {
        self.buffers
            .lock()
            .get(target)
            .map(|buf| buf.iter().rev().take(n).rev().cloned().collect())
            .unwrap_or_default()
    }

    /// (Re)starts one worker thread per target.
    pub fn restart(self: &Arc<Self>, app: AppHandle, targets: Vec<PingTarget>, interval_ms: u64) {
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        self.interval_ms.store(interval_ms, Ordering::Relaxed);
        {
            let ids: Vec<&str> = targets.iter().map(|t| t.id.as_str()).collect();
            self.buffers.lock().retain(|k, _| ids.contains(&k.as_str()));
        }
        *self.targets.write() = targets.clone();
        for target in targets {
            let hub = Arc::clone(self);
            let app = app.clone();
            thread::Builder::new()
                .name(format!("ping-{}", target.id))
                .spawn(move || hub.worker(app, target, generation))
                .expect("spawn ping worker");
        }
    }

    fn worker(&self, app: AppHandle, target: PingTarget, generation: u64) {
        let Ok(pinger) = Pinger::new() else { return };
        let fixed = target.address.as_deref().and_then(resolve_ipv4);
        while self.generation.load(Ordering::SeqCst) == generation {
            let interval = self.interval_ms.load(Ordering::Relaxed);
            let tick = Instant::now();
            let ts = now_ms();
            // Without a known gateway there is nothing to measure; recording a loss here
            // would report false packet loss right after start-up or while disconnected.
            let destination = fixed.or_else(|| self.gateway()).filter(|_| !self.offline.load(Ordering::Relaxed));
            if let Some(ip) = destination {
                let rtt = pinger.echo(ip, interval.min(2000) as u32, EchoOptions::default()).rtt_ms;
                let sample = PingSample { target: target.id.clone(), ts, rtt, scan: self.scan_active() };
                self.push(sample.clone(), interval);
                let _ = app.emit(EVENT_PING_SAMPLE, &sample);
            }
            let spent = tick.elapsed();
            if let Some(rest) = Duration::from_millis(interval).checked_sub(spent) {
                thread::sleep(rest);
            }
        }
    }

    fn push(&self, sample: PingSample, interval_ms: u64) {
        let cap = (HISTORY_SECONDS * 1000 / interval_ms.max(1)) as usize;
        let mut buffers = self.buffers.lock();
        let buf = buffers.entry(sample.target.clone()).or_default();
        buf.push_back(sample);
        while buf.len() > cap {
            buf.pop_front();
        }
    }
}

pub fn resolve_ipv4(host: &str) -> Option<Ipv4Addr> {
    if let Ok(ip) = host.parse::<Ipv4Addr>() {
        return Some(ip);
    }
    use std::net::ToSocketAddrs;
    (host, 0).to_socket_addrs().ok()?.find_map(|a| match a.ip() {
        std::net::IpAddr::V4(v4) => Some(v4),
        _ => None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_targets_include_gateway_and_custom() {
        let t = default_targets(&["9.9.9.9".to_string()]);
        assert_eq!(t[0].id, GATEWAY_ID);
        assert_eq!(t.len(), 4);
        assert_eq!(t[3].id, "custom:9.9.9.9");
    }

    #[test]
    fn resolve_literal_ip() {
        assert_eq!(resolve_ipv4("1.1.1.1"), Some(Ipv4Addr::new(1, 1, 1, 1)));
    }

    #[test]
    fn loopback_echo_replies() {
        let pinger = Pinger::new().unwrap();
        let reply = pinger.echo(Ipv4Addr::LOCALHOST, 1000, EchoOptions::default());
        assert_eq!(reply.status, EchoStatus::Reply);
        assert!(reply.rtt_ms.unwrap() < 100.0);
    }
}
