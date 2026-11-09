//! Local network configuration (IP Helper API), public IP / ISP lookup,
//! IPv6 reachability and path MTU discovery.

use std::ffi::CStr;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, TcpStream};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use windows::Win32::NetworkManagement::IpHelper::{
    GetAdaptersAddresses, GetAdaptersInfo, GAA_FLAG_INCLUDE_GATEWAYS, GAA_FLAG_SKIP_ANYCAST, GAA_FLAG_SKIP_MULTICAST,
    IP_ADAPTER_ADDRESSES_LH, IP_ADAPTER_INFO,
};
use windows::Win32::Networking::WinSock::{SOCKET_ADDRESS, AF_UNSPEC};

use crate::error::{AppError, AppResult};
use crate::ping::{EchoOptions, EchoStatus, Pinger};

const IF_TYPE_IEEE80211: u32 = 71;
const ERROR_BUFFER_OVERFLOW: u32 = 111;

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Ipv4Entry {
    pub address: String,
    pub prefix: u8,
    pub mask: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
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

/// The adapter carrying the default route, preferring Wi-Fi.
pub fn primary_adapter() -> AppResult<NetInfo> {
    let mut adapters = list_adapters()?;
    adapters.sort_by_key(|a| (a.gateway.is_none(), !a.is_wifi));
    adapters.into_iter().next().ok_or_else(|| AppError::msg("no_adapter"))
}

pub fn list_adapters() -> AppResult<Vec<NetInfo>> {
    let flags = GAA_FLAG_INCLUDE_GATEWAYS | GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST;
    let mut size: u32 = 16 * 1024;
    let mut buf: Vec<u64> = Vec::new();
    for _ in 0..3 {
        buf = vec![0u64; size as usize / 8 + 1];
        let rc = unsafe {
            GetAdaptersAddresses(AF_UNSPEC.0 as u32, flags, None, Some(buf.as_mut_ptr().cast()), &mut size)
        };
        match rc {
            0 => break,
            ERROR_BUFFER_OVERFLOW => continue,
            rc => return Err(AppError::msg(format!("GetAdaptersAddresses failed: {rc}"))),
        }
    }
    let leases = dhcp_leases();
    let mut result = Vec::new();
    let mut ptr = buf.as_ptr() as *const IP_ADAPTER_ADDRESSES_LH;
    while !ptr.is_null() {
        let a = unsafe { &*ptr };
        ptr = a.Next;
        if a.OperStatus.0 != 1 || a.IfType == 24 {
            continue; // not up, or loopback
        }
        let mut info = unsafe { adapter_to_info(a) };
        if let Some(lease) = leases.iter().find(|l| l.adapter_id.eq_ignore_ascii_case(&info.adapter_id)) {
            info.dhcp_enabled = lease.dhcp_enabled;
            info.lease_obtained = lease.obtained;
            info.lease_expires = lease.expires;
            if info.dhcp_server.is_none() {
                info.dhcp_server = lease.server.clone();
            }
        }
        result.push(info);
    }
    Ok(result)
}

unsafe fn adapter_to_info(a: &IP_ADAPTER_ADDRESSES_LH) -> NetInfo {
    let mut info = NetInfo {
        adapter_id: a.AdapterName.to_string().unwrap_or_default(),
        name: a.FriendlyName.to_string().unwrap_or_default(),
        description: a.Description.to_string().unwrap_or_default(),
        is_wifi: a.IfType == IF_TYPE_IEEE80211,
        mac: crate::wifi::format_mac(&a.PhysicalAddress[..a.PhysicalAddressLength.min(8) as usize]),
        mtu: a.Mtu,
        rx_link_bps: a.ReceiveLinkSpeed,
        tx_link_bps: a.TransmitLinkSpeed,
        dhcp_server: socket_ip(&a.Dhcpv4Server).map(|ip| ip.to_string()),
        ..NetInfo::default()
    };
    let mut uni = a.FirstUnicastAddress;
    while !uni.is_null() {
        let u = &*uni;
        match socket_ip(&u.Address) {
            Some(IpAddr::V4(v4)) => info.ipv4.push(Ipv4Entry {
                address: v4.to_string(),
                prefix: u.OnLinkPrefixLength,
                mask: prefix_to_mask(u.OnLinkPrefixLength).to_string(),
            }),
            Some(IpAddr::V6(v6)) => info.ipv6.push(v6.to_string()),
            None => {}
        }
        uni = u.Next;
    }
    let mut gw = a.FirstGatewayAddress;
    while !gw.is_null() {
        let g = &*gw;
        match socket_ip(&g.Address) {
            Some(IpAddr::V4(v4)) if info.gateway.is_none() => info.gateway = Some(v4.to_string()),
            Some(IpAddr::V6(v6)) if info.gateway_v6.is_none() => info.gateway_v6 = Some(v6.to_string()),
            _ => {}
        }
        gw = g.Next;
    }
    let mut dns = a.FirstDnsServerAddress;
    while !dns.is_null() {
        let d = &*dns;
        if let Some(ip) = socket_ip(&d.Address) {
            info.dns_servers.push(ip.to_string());
        }
        dns = d.Next;
    }
    info
}

/// Reads an IPv4/IPv6 address from a SOCKET_ADDRESS via its sockaddr byte layout.
unsafe fn socket_ip(sa: &SOCKET_ADDRESS) -> Option<IpAddr> {
    if sa.lpSockaddr.is_null() {
        return None;
    }
    let raw = sa.lpSockaddr as *const u8;
    let family = u16::from_ne_bytes([*raw, *raw.add(1)]);
    match family {
        2 => {
            let b = std::slice::from_raw_parts(raw.add(4), 4);
            let ip = Ipv4Addr::new(b[0], b[1], b[2], b[3]);
            (!ip.is_unspecified()).then_some(IpAddr::V4(ip))
        }
        23 => {
            let b: [u8; 16] = std::slice::from_raw_parts(raw.add(8), 16).try_into().ok()?;
            Some(IpAddr::V6(Ipv6Addr::from(b)))
        }
        _ => None,
    }
}

pub fn prefix_to_mask(prefix: u8) -> Ipv4Addr {
    let bits = if prefix == 0 { 0 } else { u32::MAX << (32 - prefix.min(32) as u32) };
    Ipv4Addr::from(bits)
}

struct DhcpLease {
    adapter_id: String,
    dhcp_enabled: bool,
    server: Option<String>,
    obtained: Option<i64>,
    expires: Option<i64>,
}

fn dhcp_leases() -> Vec<DhcpLease> {
    let mut size: u32 = 16 * 1024;
    let mut buf: Vec<u64> = vec![0u64; size as usize / 8 + 1];
    let mut rc = unsafe { GetAdaptersInfo(Some(buf.as_mut_ptr().cast()), &mut size) };
    if rc == ERROR_BUFFER_OVERFLOW {
        buf = vec![0u64; size as usize / 8 + 1];
        rc = unsafe { GetAdaptersInfo(Some(buf.as_mut_ptr().cast()), &mut size) };
    }
    if rc != 0 {
        return Vec::new();
    }
    let mut leases = Vec::new();
    let mut ptr = buf.as_ptr() as *const IP_ADAPTER_INFO;
    while !ptr.is_null() {
        let a = unsafe { &*ptr };
        ptr = a.Next;
        let server = cstr(&a.DhcpServer.IpAddress.String).filter(|s| s != "0.0.0.0" && !s.is_empty());
        leases.push(DhcpLease {
            adapter_id: cstr(&a.AdapterName).unwrap_or_default(),
            dhcp_enabled: a.DhcpEnabled != 0,
            server,
            obtained: (a.LeaseObtained > 0).then_some(a.LeaseObtained * 1000),
            expires: (a.LeaseExpires > 0).then_some(a.LeaseExpires * 1000),
        });
    }
    leases
}

fn cstr(chars: &[i8]) -> Option<String> {
    let bytes: Vec<u8> = chars.iter().map(|&c| c as u8).collect();
    CStr::from_bytes_until_nul(&bytes).ok().map(|c| c.to_string_lossy().into_owned())
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

pub fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(concat!("Wifinatio/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(8))
        .build()
        .expect("http client")
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

    #[test]
    fn lists_some_adapter() {
        assert!(list_adapters().is_ok());
    }
}
