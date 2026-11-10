//! Adapters, gateways, DNS servers and DHCP leases via the IP Helper API.

use std::ffi::CStr;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use windows::Win32::NetworkManagement::IpHelper::{
    GetAdaptersAddresses, GetAdaptersInfo, GAA_FLAG_INCLUDE_GATEWAYS, GAA_FLAG_SKIP_ANYCAST, GAA_FLAG_SKIP_MULTICAST,
    IP_ADAPTER_ADDRESSES_LH, IP_ADAPTER_INFO,
};
use windows::Win32::Networking::WinSock::{SOCKET_ADDRESS, AF_UNSPEC};

use super::{prefix_to_mask, Ipv4Entry, NetInfo};
use crate::error::{AppError, AppResult};

const IF_TYPE_IEEE80211: u32 = 71;
const ERROR_BUFFER_OVERFLOW: u32 = 111;

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_some_adapter() {
        assert!(list_adapters().is_ok());
    }
}
