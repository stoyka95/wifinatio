//! ICMP echo over an unprivileged ICMP datagram socket (`SOCK_DGRAM` +
//! `IPPROTO_ICMP`). Android allows these for every app, so no root and no
//! `/system/bin/ping` parsing. TTL-exceeded and fragmentation-needed answers
//! arrive on the socket error queue (`IP_RECVERR`), which is what makes
//! traceroute and path MTU discovery possible.

use std::io;
use std::mem::{size_of, zeroed};
use std::net::Ipv4Addr;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::time::{Duration, Instant};

use super::{EchoOptions, EchoReply, EchoStatus};
use crate::error::{AppError, AppResult};

const ICMP_ECHO_REPLY: u8 = 0;
const ICMP_DEST_UNREACH: u8 = 3;
const ICMP_ECHO_REQUEST: u8 = 8;
const ICMP_TIME_EXCEEDED: u8 = 11;
const ICMP_FRAG_NEEDED: u8 = 4;
const SO_EE_ORIGIN_LOCAL: u8 = 1;
const SO_EE_ORIGIN_ICMP: u8 = 2;
const DEFAULT_TTL: i32 = 64;

/// Owns one ICMP socket; one per thread.
pub struct Pinger {
    fd: OwnedFd,
    seq: std::cell::Cell<u16>,
}

// The socket is only used by the thread that owns the Pinger at a time.
unsafe impl Send for Pinger {}

impl Pinger {
    pub fn new() -> AppResult<Self> {
        let raw = unsafe { libc::socket(libc::AF_INET, libc::SOCK_DGRAM | libc::SOCK_CLOEXEC, libc::IPPROTO_ICMP) };
        if raw < 0 {
            return Err(AppError::msg(format!("icmp socket: {}", io::Error::last_os_error())));
        }
        let fd = unsafe { OwnedFd::from_raw_fd(raw) };
        set_int(&fd, libc::IPPROTO_IP, libc::IP_RECVERR, 1)?;
        Ok(Self { fd, seq: std::cell::Cell::new(rand::random()) })
    }

    pub fn echo(&self, dest: Ipv4Addr, timeout_ms: u32, opts: EchoOptions) -> EchoReply {
        let seq = self.seq.get().wrapping_add(1);
        self.seq.set(seq);
        let lost = |status| EchoReply { status, rtt_ms: None, from: None };

        let ttl = opts.ttl.map(i32::from).unwrap_or(DEFAULT_TTL);
        let pmtu = if opts.dont_fragment { libc::IP_PMTUDISC_PROBE } else { libc::IP_PMTUDISC_DONT };
        if set_int(&self.fd, libc::IPPROTO_IP, libc::IP_TTL, ttl).is_err()
            || set_int(&self.fd, libc::IPPROTO_IP, libc::IP_MTU_DISCOVER, pmtu).is_err()
        {
            return lost(EchoStatus::Unreachable);
        }
        self.drain_error_queue();

        let packet = echo_request(seq, opts.payload_size.max(8) as usize);
        let addr = sockaddr(dest);
        let started = Instant::now();
        let sent = unsafe {
            libc::sendto(
                self.fd.as_raw_fd(),
                packet.as_ptr().cast(),
                packet.len(),
                0,
                (&addr as *const libc::sockaddr_in).cast(),
                size_of::<libc::sockaddr_in>() as libc::socklen_t,
            )
        };
        if sent < 0 {
            return match io::Error::last_os_error().raw_os_error() {
                Some(libc::EMSGSIZE) => lost(EchoStatus::TooBig),
                _ => lost(EchoStatus::Unreachable),
            };
        }

        let deadline = started + Duration::from_millis(timeout_ms as u64);
        loop {
            let Some(left) = deadline.checked_duration_since(Instant::now()) else {
                return lost(EchoStatus::Timeout);
            };
            let mut pfd = libc::pollfd { fd: self.fd.as_raw_fd(), events: libc::POLLIN, revents: 0 };
            let ready = unsafe { libc::poll(&mut pfd, 1, left.as_millis().max(1) as i32) };
            if ready == 0 {
                return lost(EchoStatus::Timeout);
            }
            if ready < 0 {
                if io::Error::last_os_error().kind() == io::ErrorKind::Interrupted {
                    continue;
                }
                return lost(EchoStatus::Unreachable);
            }
            let rtt = started.elapsed().as_secs_f64() * 1000.0;
            if pfd.revents & libc::POLLERR != 0 {
                if let Some((status, from)) = self.read_error(seq) {
                    let rtt_ms = (status == EchoStatus::TtlExpired).then_some(rtt);
                    return EchoReply { status, rtt_ms, from };
                }
            }
            if pfd.revents & libc::POLLIN != 0 {
                if let Some(from) = self.read_reply(seq) {
                    return EchoReply { status: EchoStatus::Reply, rtt_ms: Some(rtt), from: Some(from) };
                }
            }
        }
    }

    /// Reads one datagram; returns the sender when it is the echo reply we wait for.
    fn read_reply(&self, seq: u16) -> Option<Ipv4Addr> {
        let mut buf = [0u8; 2048];
        let mut from: libc::sockaddr_in = unsafe { zeroed() };
        let mut len = size_of::<libc::sockaddr_in>() as libc::socklen_t;
        let n = unsafe {
            libc::recvfrom(
                self.fd.as_raw_fd(),
                buf.as_mut_ptr().cast(),
                buf.len(),
                libc::MSG_DONTWAIT,
                (&mut from as *mut libc::sockaddr_in).cast(),
                &mut len,
            )
        };
        if n < 8 || buf[0] != ICMP_ECHO_REPLY || u16::from_be_bytes([buf[6], buf[7]]) != seq {
            return None;
        }
        Some(Ipv4Addr::from(u32::from_be(from.sin_addr.s_addr)))
    }

    /// Reads one error-queue entry: TTL exceeded, destination unreachable or
    /// "fragmentation needed", with the address of the router that reported it.
    fn read_error(&self, seq: u16) -> Option<(EchoStatus, Option<Ipv4Addr>)> {
        let mut data = [0u8; 2048];
        let mut control = [0u8; 512];
        let mut from: libc::sockaddr_in = unsafe { zeroed() };
        let mut iov = libc::iovec { iov_base: data.as_mut_ptr().cast(), iov_len: data.len() };
        let mut msg: libc::msghdr = unsafe { zeroed() };
        msg.msg_name = (&mut from as *mut libc::sockaddr_in).cast();
        msg.msg_namelen = size_of::<libc::sockaddr_in>() as libc::socklen_t;
        msg.msg_iov = &mut iov;
        msg.msg_iovlen = 1;
        msg.msg_control = control.as_mut_ptr().cast();
        msg.msg_controllen = control.len() as _;
        let n = unsafe { libc::recvmsg(self.fd.as_raw_fd(), &mut msg, libc::MSG_ERRQUEUE | libc::MSG_DONTWAIT) };
        if n < 0 {
            return None;
        }
        // The payload is our own echo request; skip errors for older probes.
        if n >= 8 && u16::from_be_bytes([data[6], data[7]]) != seq {
            return None;
        }
        let mut cmsg = unsafe { libc::CMSG_FIRSTHDR(&msg) };
        while !cmsg.is_null() {
            let header = unsafe { &*cmsg };
            if header.cmsg_level == libc::IPPROTO_IP && header.cmsg_type == libc::IP_RECVERR {
                let ee = unsafe { &*(libc::CMSG_DATA(cmsg) as *const libc::sock_extended_err) };
                let offender = unsafe { &*((ee as *const libc::sock_extended_err).add(1) as *const libc::sockaddr_in) };
                let from = (offender.sin_family as i32 == libc::AF_INET)
                    .then(|| Ipv4Addr::from(u32::from_be(offender.sin_addr.s_addr)));
                let status = match (ee.ee_origin, ee.ee_type, ee.ee_code) {
                    (SO_EE_ORIGIN_ICMP, ICMP_TIME_EXCEEDED, _) => EchoStatus::TtlExpired,
                    (SO_EE_ORIGIN_ICMP, ICMP_DEST_UNREACH, ICMP_FRAG_NEEDED) => EchoStatus::TooBig,
                    (SO_EE_ORIGIN_LOCAL, _, _) if ee.ee_errno as i32 == libc::EMSGSIZE => EchoStatus::TooBig,
                    _ => EchoStatus::Unreachable,
                };
                return Some((status, from));
            }
            cmsg = unsafe { libc::CMSG_NXTHDR(&msg, cmsg) };
        }
        None
    }

    /// Drops errors left over from earlier probes so they are not read as this one's.
    fn drain_error_queue(&self) {
        let mut data = [0u8; 64];
        for _ in 0..16 {
            let mut iov = libc::iovec { iov_base: data.as_mut_ptr().cast(), iov_len: data.len() };
            let mut msg: libc::msghdr = unsafe { zeroed() };
            msg.msg_iov = &mut iov;
            msg.msg_iovlen = 1;
            if unsafe { libc::recvmsg(self.fd.as_raw_fd(), &mut msg, libc::MSG_ERRQUEUE | libc::MSG_DONTWAIT) } < 0 {
                break;
            }
        }
    }
}

/// ICMP echo request; the kernel fills in the identifier and checksum.
fn echo_request(seq: u16, payload: usize) -> Vec<u8> {
    let mut packet = vec![0x57u8; 8 + payload];
    packet[..8].copy_from_slice(&[ICMP_ECHO_REQUEST, 0, 0, 0, 0, 0, 0, 0]);
    packet[6..8].copy_from_slice(&seq.to_be_bytes());
    packet
}

fn sockaddr(ip: Ipv4Addr) -> libc::sockaddr_in {
    let mut addr: libc::sockaddr_in = unsafe { zeroed() };
    addr.sin_family = libc::AF_INET as libc::sa_family_t;
    addr.sin_addr = libc::in_addr { s_addr: u32::from(ip).to_be() };
    addr
}

fn set_int(fd: &OwnedFd, level: i32, name: i32, value: i32) -> AppResult<()> {
    let rc = unsafe {
        libc::setsockopt(
            fd.as_raw_fd(),
            level,
            name,
            (&value as *const i32).cast(),
            size_of::<i32>() as libc::socklen_t,
        )
    };
    if rc < 0 {
        return Err(io::Error::last_os_error().into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_layout() {
        let p = echo_request(0x0102, 8);
        assert_eq!(p.len(), 16);
        assert_eq!(p[0], ICMP_ECHO_REQUEST);
        assert_eq!(&p[6..8], &[1, 2]);
    }
}
