//! Traceroute with TTL-limited ICMP echoes. All TTLs are probed in parallel so a
//! full trace takes a few seconds even when some routers ignore ICMP.

use std::net::{IpAddr, Ipv4Addr};

use serde::Serialize;

use crate::dns;
use crate::error::{AppError, AppResult};
use crate::ping::{resolve_ipv4, EchoOptions, EchoStatus, Pinger};

const MAX_HOPS: u8 = 30;
const PROBES_PER_HOP: usize = 3;
const PROBE_TIMEOUT_MS: u32 = 1500;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hop {
    pub ttl: u8,
    pub address: Option<String>,
    pub hostname: Option<String>,
    pub rtts: Vec<Option<f64>>,
    pub avg_ms: Option<f64>,
    pub loss_pct: f64,
    pub is_destination: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceResult {
    pub target: String,
    pub resolved: String,
    pub reached: bool,
    pub hops: Vec<Hop>,
}

pub fn run(target: &str, dns_server: Option<IpAddr>) -> AppResult<TraceResult> {
    let dest = resolve_ipv4(target).ok_or_else(|| AppError::msg("resolve_failed"))?;
    let probes: Vec<Hop> = std::thread::scope(|scope| {
        let handles: Vec<_> = (1..=MAX_HOPS).map(|ttl| scope.spawn(move || probe_hop(dest, ttl))).collect();
        handles.into_iter().filter_map(|h| h.join().ok()).collect()
    });

    let reached_at = probes.iter().position(|h| h.is_destination);
    let mut hops: Vec<Hop> = match reached_at {
        Some(idx) => probes.into_iter().take(idx + 1).collect(),
        None => trim_trailing_silence(probes),
    };
    if let Some(server) = dns_server {
        resolve_hostnames(&mut hops, server);
    }
    Ok(TraceResult {
        target: target.to_string(),
        resolved: dest.to_string(),
        reached: reached_at.is_some(),
        hops,
    })
}

fn probe_hop(dest: Ipv4Addr, ttl: u8) -> Hop {
    let mut rtts = Vec::with_capacity(PROBES_PER_HOP);
    let mut address = None;
    let mut is_destination = false;
    if let Ok(pinger) = Pinger::new() {
        for _ in 0..PROBES_PER_HOP {
            let reply = pinger.echo(dest, PROBE_TIMEOUT_MS, EchoOptions { ttl: Some(ttl), ..Default::default() });
            match reply.status {
                EchoStatus::Reply | EchoStatus::TtlExpired => {
                    address = address.or(reply.from);
                    is_destination |= reply.status == EchoStatus::Reply;
                    rtts.push(reply.rtt_ms);
                }
                _ => rtts.push(None),
            }
        }
    }
    let ok: Vec<f64> = rtts.iter().flatten().copied().collect();
    Hop {
        ttl,
        address: address.map(|a| a.to_string()),
        hostname: None,
        avg_ms: (!ok.is_empty()).then(|| ok.iter().sum::<f64>() / ok.len() as f64),
        loss_pct: if rtts.is_empty() { 100.0 } else { (rtts.len() - ok.len()) as f64 * 100.0 / rtts.len() as f64 },
        rtts,
        is_destination,
    }
}

/// Without reaching the target, drop the long tail of silent hops but keep one
/// to show where answers stopped.
fn trim_trailing_silence(mut hops: Vec<Hop>) -> Vec<Hop> {
    let last_answer = hops.iter().rposition(|h| h.address.is_some()).unwrap_or(0);
    hops.truncate((last_answer + 2).min(hops.len()));
    hops
}

fn resolve_hostnames(hops: &mut [Hop], server: IpAddr) {
    std::thread::scope(|scope| {
        for hop in hops.iter_mut() {
            if let Some(ip) = hop.address.as_deref().and_then(|a| a.parse::<Ipv4Addr>().ok()) {
                scope.spawn(move || hop.hostname = dns::reverse_lookup(server, ip));
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hop(ttl: u8, addr: Option<&str>) -> Hop {
        Hop {
            ttl,
            address: addr.map(String::from),
            hostname: None,
            rtts: vec![],
            avg_ms: None,
            loss_pct: 0.0,
            is_destination: false,
        }
    }

    #[test]
    fn trims_silent_tail() {
        let hops = vec![hop(1, Some("a")), hop(2, None), hop(3, Some("b")), hop(4, None), hop(5, None)];
        let trimmed = trim_trailing_silence(hops);
        assert_eq!(trimmed.len(), 4);
        assert_eq!(trimmed.last().unwrap().ttl, 4);
    }

    #[test]
    fn traces_loopback() {
        let result = run("127.0.0.1", None).unwrap();
        assert!(result.reached);
        assert_eq!(result.hops.len(), 1);
    }
}
