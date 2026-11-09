//! DNS resolution timing with hand-built UDP queries, so each resolver is measured
//! directly (no OS cache in between), plus PTR lookups for traceroute hops.

use std::net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::error::{AppError, AppResult};

pub const TEST_DOMAINS: [&str; 6] = ["google.com", "seznam.cz", "wikipedia.org", "youtube.com", "github.com", "idnes.cz"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsSample {
    pub domain: String,
    pub ms: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsServerResult {
    pub id: String,
    pub label: String,
    pub address: String,
    pub avg_ms: Option<f64>,
    pub min_ms: Option<f64>,
    pub worst_ms: Option<f64>,
    pub failures: u32,
    pub samples: Vec<DnsSample>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsTestResult {
    pub ts: i64,
    pub servers: Vec<DnsServerResult>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecordType {
    A = 1,
    Ptr = 12,
}

pub fn build_query(id: u16, name: &str, rtype: RecordType) -> Vec<u8> {
    let mut packet = Vec::with_capacity(32 + name.len());
    packet.extend_from_slice(&id.to_be_bytes());
    packet.extend_from_slice(&[0x01, 0x00]); // standard query, recursion desired
    packet.extend_from_slice(&[0, 1, 0, 0, 0, 0, 0, 0]); // 1 question
    for label in name.trim_end_matches('.').split('.') {
        let bytes = label.as_bytes();
        packet.push(bytes.len().min(63) as u8);
        packet.extend_from_slice(&bytes[..bytes.len().min(63)]);
    }
    packet.push(0);
    packet.extend_from_slice(&(rtype as u16).to_be_bytes());
    packet.extend_from_slice(&[0, 1]); // class IN
    packet
}

#[derive(Debug, PartialEq)]
pub struct ParsedResponse {
    pub rcode: u8,
    pub answers: u16,
}

pub fn parse_header(buf: &[u8], expected_id: u16) -> Option<ParsedResponse> {
    if buf.len() < 12 || u16::from_be_bytes([buf[0], buf[1]]) != expected_id || buf[2] & 0x80 == 0 {
        return None;
    }
    Some(ParsedResponse { rcode: buf[3] & 0x0F, answers: u16::from_be_bytes([buf[6], buf[7]]) })
}

/// Sends one query and returns the round trip in ms. NXDOMAIN counts as a valid answer.
pub fn timed_query(server: IpAddr, name: &str, timeout: Duration) -> AppResult<f64> {
    let (_, ms) = query(server, name, RecordType::A, timeout)?;
    Ok(ms)
}

fn query(server: IpAddr, name: &str, rtype: RecordType, timeout: Duration) -> AppResult<(Vec<u8>, f64)> {
    let bind: SocketAddr = if server.is_ipv4() { "0.0.0.0:0".parse().unwrap() } else { "[::]:0".parse().unwrap() };
    let socket = UdpSocket::bind(bind)?;
    socket.set_read_timeout(Some(timeout))?;
    let id: u16 = rand::random();
    let packet = build_query(id, name, rtype);
    let started = Instant::now();
    socket.send_to(&packet, SocketAddr::new(server, 53))?;
    let mut buf = [0u8; 1500];
    loop {
        let (len, _) = socket.recv_from(&mut buf)?;
        if let Some(parsed) = parse_header(&buf[..len], id) {
            let ms = started.elapsed().as_secs_f64() * 1000.0;
            return match parsed.rcode {
                0 | 3 => Ok((buf[..len].to_vec(), ms)),
                code => Err(AppError::msg(format!("dns rcode {code}"))),
            };
        }
        if started.elapsed() > timeout {
            return Err(AppError::msg("dns timeout"));
        }
    }
}

/// Runs every domain twice against each resolver; the first pass may include
/// recursive resolution, the second reflects the resolver's cache.
pub fn run_test(system_servers: &[String]) -> DnsTestResult {
    let mut resolvers: Vec<(String, String, String)> = Vec::new();
    if let Some(sys) = system_servers.iter().find(|s| s.parse::<Ipv4Addr>().is_ok()).or(system_servers.first()) {
        resolvers.push(("system".into(), "system".into(), sys.clone()));
    }
    resolvers.push(("cloudflare".into(), "Cloudflare".into(), "1.1.1.1".into()));
    resolvers.push(("google".into(), "Google".into(), "8.8.8.8".into()));
    resolvers.push(("quad9".into(), "Quad9".into(), "9.9.9.9".into()));

    let servers = std::thread::scope(|scope| {
        let handles: Vec<_> = resolvers
            .iter()
            .map(|(id, label, address)| scope.spawn(move || measure_server(id, label, address)))
            .collect();
        handles.into_iter().filter_map(|h| h.join().ok()).collect()
    });
    DnsTestResult { ts: crate::wifi::now_ms(), servers }
}

fn measure_server(id: &str, label: &str, address: &str) -> DnsServerResult {
    let ip: Option<IpAddr> = address.parse().ok();
    let mut samples = Vec::new();
    for _round in 0..2 {
        for domain in TEST_DOMAINS {
            let ms = ip.and_then(|ip| timed_query(ip, domain, Duration::from_millis(2000)).ok());
            samples.push(DnsSample { domain: domain.to_string(), ms });
        }
    }
    let ok: Vec<f64> = samples.iter().filter_map(|s| s.ms).collect();
    DnsServerResult {
        id: id.into(),
        label: label.into(),
        address: address.into(),
        avg_ms: (!ok.is_empty()).then(|| ok.iter().sum::<f64>() / ok.len() as f64),
        min_ms: ok.iter().cloned().reduce(f64::min),
        worst_ms: ok.iter().cloned().reduce(f64::max),
        failures: (samples.len() - ok.len()) as u32,
        samples,
    }
}

/// Reverse lookup (PTR) of an IPv4 address via the given resolver.
pub fn reverse_lookup(server: IpAddr, ip: Ipv4Addr) -> Option<String> {
    let o = ip.octets();
    let name = format!("{}.{}.{}.{}.in-addr.arpa", o[3], o[2], o[1], o[0]);
    let (buf, _) = query(server, &name, RecordType::Ptr, Duration::from_millis(1200)).ok()?;
    parse_first_ptr(&buf)
}

fn parse_first_ptr(buf: &[u8]) -> Option<String> {
    let answers = u16::from_be_bytes([*buf.get(6)?, *buf.get(7)?]);
    if answers == 0 {
        return None;
    }
    let mut pos = skip_name(buf, 12)? + 4; // question name + type + class
    for _ in 0..answers {
        pos = skip_name(buf, pos)?;
        let rtype = u16::from_be_bytes([*buf.get(pos)?, *buf.get(pos + 1)?]);
        let rdlen = u16::from_be_bytes([*buf.get(pos + 8)?, *buf.get(pos + 9)?]) as usize;
        let rdata = pos + 10;
        if rtype == RecordType::Ptr as u16 {
            return read_name(buf, rdata);
        }
        pos = rdata + rdlen;
    }
    None
}

fn skip_name(buf: &[u8], mut pos: usize) -> Option<usize> {
    loop {
        let len = *buf.get(pos)? as usize;
        if len == 0 {
            return Some(pos + 1);
        }
        if len & 0xC0 == 0xC0 {
            return Some(pos + 2);
        }
        pos += len + 1;
    }
}

fn read_name(buf: &[u8], mut pos: usize) -> Option<String> {
    let mut labels = Vec::new();
    for _ in 0..64 {
        let len = *buf.get(pos)? as usize;
        if len == 0 {
            return Some(labels.join("."));
        }
        if len & 0xC0 == 0xC0 {
            pos = ((len & 0x3F) << 8) | *buf.get(pos + 1)? as usize;
            continue;
        }
        labels.push(String::from_utf8_lossy(buf.get(pos + 1..pos + 1 + len)?).into_owned());
        pos += len + 1;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_encoding() {
        let q = build_query(0xABCD, "a.cz", RecordType::A);
        assert_eq!(&q[..2], &[0xAB, 0xCD]);
        assert_eq!(&q[12..18], &[1, b'a', 2, b'c', b'z', 0]);
        assert_eq!(&q[18..22], &[0, 1, 0, 1]);
    }

    #[test]
    fn header_parsing() {
        let mut resp = vec![0x12, 0x34, 0x81, 0x80, 0, 1, 0, 2, 0, 0, 0, 0];
        assert_eq!(parse_header(&resp, 0x1234), Some(ParsedResponse { rcode: 0, answers: 2 }));
        assert_eq!(parse_header(&resp, 0x9999), None);
        resp[2] = 0x01; // not a response
        assert_eq!(parse_header(&resp, 0x1234), None);
    }

    #[test]
    fn ptr_answer_with_compression() {
        let mut buf = vec![0, 1, 0x81, 0x80, 0, 1, 0, 1, 0, 0, 0, 0];
        let qname_pos = buf.len();
        buf.extend_from_slice(&[1, b'1', 1, b'1', 1, b'1', 1, b'1', 7]);
        buf.extend_from_slice(b"in-addr");
        buf.extend_from_slice(&[4]);
        buf.extend_from_slice(b"arpa");
        buf.extend_from_slice(&[0, 0, 12, 0, 1]);
        buf.extend_from_slice(&[0xC0, qname_pos as u8, 0, 12, 0, 1, 0, 0, 0, 60, 0, 5]);
        buf.extend_from_slice(&[3, b'o', b'n', b'e', 0]);
        assert_eq!(parse_first_ptr(&buf), Some("one".into()));
    }
}
