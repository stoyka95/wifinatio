//! Local network configuration (IP Helper API on Windows, LinkProperties on
//! Android), public IP / ISP lookup,
//! IPv6 reachability and path MTU discovery.

use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr, TcpStream};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::ping::{EchoOptions, EchoStatus, Pinger};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Ipv4Entry {
    pub address: String,
    pub prefix: u8,
    pub mask: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct NetInfo {
    pub adapter_id: String,
    pub name: String,
    pub description: String,
    pub is_wifi: bool,
    pub mac: String,
    pub ipv4: Vec<Ipv4Entry>,
    pub ipv6: Vec<String>,
    pub gateway: Option<String>,
    pub gateway_v6: Option<String>,
    pub dns_servers: Vec<String>,
    pub dhcp_enabled: bool,
    pub dhcp_server: Option<String>,
    pub lease_obtained: Option<i64>,
    pub lease_expires: Option<i64>,
    pub mtu: u32,
    pub rx_link_bps: u64,
    pub tx_link_bps: u64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PublicInfo {
    pub ip: Option<String>,
    pub isp: Option<String>,
    pub city: Option<String>,
    pub region: Option<String>,
    pub country: Option<String>,
    pub cloudflare_colo: Option<String>,
    pub cloudflare_loc: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ipv6Check {
    pub has_global_address: bool,
    pub reachable: bool,
    pub latency_ms: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MtuResult {
    pub mtu: Option<u32>,
    pub target: String,
}

#[cfg(target_os = "android")]
#[path = "netinfo_android.rs"]
mod imp;
#[cfg(not(any(windows, target_os = "android")))]
#[path = "netinfo_stub.rs"]
mod imp;
#[cfg(windows)]
#[path = "netinfo_windows.rs"]
mod imp;

/// The adapter carrying the default route, preferring Wi-Fi.
pub fn primary_adapter() -> AppResult<NetInfo> {
    imp::primary_adapter()
}

pub fn prefix_to_mask(prefix: u8) -> Ipv4Addr {
    let bits = if prefix == 0 { 0 } else { u32::MAX << (32 - prefix.min(32) as u32) };
    Ipv4Addr::from(bits)
}

#[derive(Deserialize)]
struct IpInfoResponse {
    ip: Option<String>,
    org: Option<String>,
    city: Option<String>,
    region: Option<String>,
    country: Option<String>,
}

#[derive(Deserialize)]
struct IpApiResponse {
    query: Option<String>,
    isp: Option<String>,
    city: Option<String>,
    #[serde(rename = "regionName")]
    region_name: Option<String>,
    country: Option<String>,
}

/// Client builder with the platform's TLS: SChannel on Windows, rustls with the
/// bundled Mozilla roots elsewhere (Android has no OpenSSL to link against).
pub fn http_builder() -> reqwest::ClientBuilder {
    let builder = reqwest::Client::builder().user_agent(concat!("Wifinatio/", env!("CARGO_PKG_VERSION")));
    #[cfg(not(windows))]
    let builder = {
        let roots = rustls::RootCertStore { roots: webpki_roots::TLS_SERVER_ROOTS.to_vec() };
        let provider = std::sync::Arc::new(rustls::crypto::ring::default_provider());
        let tls = rustls::ClientConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .expect("tls versions")
            .with_root_certificates(roots)
            .with_no_client_auth();
        builder.tls_backend_preconfigured(tls)
    };
    builder
}

pub fn http_client() -> reqwest::Client {
    http_builder().timeout(Duration::from_secs(8)).build().expect("http client")
}

/// Public IP via Cloudflare trace, ISP and location via ipinfo.io with ip-api.com as fallback.
pub async fn public_info() -> AppResult<PublicInfo> {
    let client = http_client();
    let mut info = PublicInfo::default();
    if let Ok(resp) = client.get("https://www.cloudflare.com/cdn-cgi/trace").send().await {
        if let Ok(text) = resp.text().await {
            for line in text.lines() {
                match line.split_once('=') {
                    Some(("ip", v)) => info.ip = Some(v.to_string()),
                    Some(("colo", v)) => info.cloudflare_colo = Some(v.to_string()),
                    Some(("loc", v)) => info.cloudflare_loc = Some(v.to_string()),
                    _ => {}
                }
            }
        }
    }
    match client.get("https://ipinfo.io/json").send().await {
        Ok(resp) if resp.status().is_success() => {
            if let Ok(r) = resp.json::<IpInfoResponse>().await {
                info.ip = info.ip.or(r.ip);
                info.isp = r.org.map(|o| strip_asn(&o));
                info.city = r.city;
                info.region = r.region;
                info.country = r.country;
            }
        }
        _ => {
            if let Ok(resp) = client.get("http://ip-api.com/json/?fields=query,isp,city,regionName,country").send().await {
                if let Ok(r) = resp.json::<IpApiResponse>().await {
                    info.ip = info.ip.or(r.query);
                    info.isp = r.isp;
                    info.city = r.city;
                    info.region = r.region_name;
                    info.country = r.country;
                }
            }
        }
    }
    if info.ip.is_none() {
        return Err(AppError::msg("offline"));
    }
    Ok(info)
}

/// "AS12345 Example ISP" -> "Example ISP"
fn strip_asn(org: &str) -> String {
    match org.split_once(' ') {
        Some((asn, rest)) if asn.starts_with("AS") => rest.to_string(),
        _ => org.to_string(),
    }
}

pub fn ipv6_check(local: &NetInfo) -> Ipv6Check {
    let has_global_address = local
        .ipv6
        .iter()
        .filter_map(|a| a.parse::<Ipv6Addr>().ok())
        .any(|a| (a.segments()[0] & 0xe000) == 0x2000);
    let addr: SocketAddr = "[2606:4700:4700::1111]:443".parse().expect("valid literal");
    let started = std::time::Instant::now();
    let reachable = TcpStream::connect_timeout(&addr, Duration::from_secs(3)).is_ok();
    Ipv6Check {
        has_global_address,
        reachable,
        latency_ms: reachable.then(|| started.elapsed().as_secs_f64() * 1000.0),
    }
}

/// Path MTU discovery with "don't fragment" pings (binary search over payload size).
pub fn mtu_test(target: Ipv4Addr) -> AppResult<MtuResult> {
    let pinger = Pinger::new()?;
    let fits = |payload: u16| {
        (0..2).any(|_| {
            let opts = EchoOptions { dont_fragment: true, payload_size: payload, ..Default::default() };
            pinger.echo(target, 1000, opts).status == EchoStatus::Reply
        })
    };
    if !fits(548) {
        return Ok(MtuResult { mtu: None, target: target.to_string() });
    }
    let (mut lo, mut hi) = (548u16, 1472u16);
    if fits(hi) {
        lo = hi;
    }
    while lo < hi {
        let mid = lo + (hi - lo).div_ceil(2);
        if fits(mid) {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    Ok(MtuResult { mtu: Some(lo as u32 + 28), target: target.to_string() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks() {
        assert_eq!(prefix_to_mask(24), Ipv4Addr::new(255, 255, 255, 0));
        assert_eq!(prefix_to_mask(0), Ipv4Addr::new(0, 0, 0, 0));
        assert_eq!(prefix_to_mask(32), Ipv4Addr::new(255, 255, 255, 255));
    }

    #[test]
    fn asn_stripping() {
        assert_eq!(strip_asn("AS5610 O2 Czech Republic"), "O2 Czech Republic");
        assert_eq!(strip_asn("Vodafone"), "Vodafone");
    }

}
