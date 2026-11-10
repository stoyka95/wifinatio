//! ICMP echo via IcmpSendEcho2.

use std::net::Ipv4Addr;
use std::time::Instant;

use windows::Win32::Foundation::{GetLastError, HANDLE};
use windows::Win32::NetworkManagement::IpHelper::{
    IcmpCloseHandle, IcmpCreateFile, IcmpSendEcho2, ICMP_ECHO_REPLY, IP_FLAG_DF, IP_OPTION_INFORMATION,
    IP_PACKET_TOO_BIG, IP_SUCCESS, IP_TTL_EXPIRED_TRANSIT,
};

use super::{EchoOptions, EchoReply, EchoStatus};
use crate::error::{AppError, AppResult};

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
