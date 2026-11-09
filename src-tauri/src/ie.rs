//! Parsing of 802.11 information elements (IEs) from beacon / probe responses.
//! Pure functions, independent of the Windows API so they can be unit tested.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Band {
    G2,
    G5,
    G6,
}

impl Band {
    pub fn from_frequency_mhz(mhz: u32) -> Option<Self> {
        match mhz {
            2400..=2500 => Some(Self::G2),
            5150..=5925 => Some(Self::G5),
            5926..=7125 => Some(Self::G6),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::G2 => "2.4",
            Self::G5 => "5",
            Self::G6 => "6",
        }
    }

    pub fn channel_from_frequency(self, mhz: u32) -> u32 {
        match self {
            Self::G2 if mhz == 2484 => 14,
            Self::G2 => mhz.saturating_sub(2407) / 5,
            Self::G5 => mhz.saturating_sub(5000) / 5,
            Self::G6 if mhz == 5935 => 2,
            Self::G6 => mhz.saturating_sub(5950) / 5,
        }
    }

    pub fn frequency_from_channel(self, channel: u32) -> u32 {
        match self {
            Self::G2 if channel == 14 => 2484,
            Self::G2 => 2407 + 5 * channel,
            Self::G5 => 5000 + 5 * channel,
            Self::G6 if channel == 2 => 5935,
            Self::G6 => 5950 + 5 * channel,
        }
    }
}

/// 5 GHz channels 52–144 require radar detection (DFS) in the EU.
pub fn is_dfs_channel(band: Band, channel: u32) -> bool {
    band == Band::G5 && (52..=144).contains(&channel)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Security {
    Open,
    Wep,
    WpaPersonal,
    Wpa2Personal,
    Wpa3Transition,
    Wpa3Personal,
    Wpa2Enterprise,
    Wpa3Enterprise,
    Owe,
}

impl Security {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Wep => "wep",
            Self::WpaPersonal => "wpa-personal",
            Self::Wpa2Personal => "wpa2-personal",
            Self::Wpa3Transition => "wpa2-wpa3-personal",
            Self::Wpa3Personal => "wpa3-personal",
            Self::Wpa2Enterprise => "wpa2-enterprise",
            Self::Wpa3Enterprise => "wpa3-enterprise",
            Self::Owe => "owe",
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct IeInfo {
    pub ssid: Option<Vec<u8>>,
    pub primary_channel: Option<u32>,
    pub has_ht: bool,
    pub has_vht: bool,
    pub has_he: bool,
    pub has_eht: bool,
    ht_secondary_offset: u8,
    ht_40_allowed: bool,
    vht_op: Option<(u8, u8, u8)>,
    he_6ghz_op: Option<(u8, u8, u8, u8)>,
    eht_op: Option<(u8, u8, u8)>,
    rsn_akms: Vec<u8>,
    has_wpa1: bool,
    pub station_count: Option<u16>,
    pub channel_utilization: Option<u8>,
}

/// Effective channel geometry: width and the centre channel of the occupied span.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ChannelSpan {
    pub width_mhz: u32,
    pub center_channel: u32,
}

pub fn parse(data: &[u8]) -> IeInfo {
    let mut info = IeInfo::default();
    let mut i = 0usize;
    while i + 2 <= data.len() {
        let id = data[i];
        let len = data[i + 1] as usize;
        let Some(body) = data.get(i + 2..i + 2 + len) else { break };
        apply_element(&mut info, id, body);
        i += 2 + len;
    }
    info
}

fn apply_element(info: &mut IeInfo, id: u8, body: &[u8]) {
    match id {
        0 => info.ssid = Some(body.to_vec()),
        3 if !body.is_empty() => info.primary_channel = Some(body[0] as u32),
        11 if body.len() >= 3 => {
            info.station_count = Some(u16::from_le_bytes([body[0], body[1]]));
            info.channel_utilization = Some(body[2]);
        }
        45 => info.has_ht = true,
        48 => info.rsn_akms = parse_rsn_akms(body),
        61 if body.len() >= 2 => {
            info.primary_channel = Some(body[0] as u32);
            info.ht_secondary_offset = body[1] & 0x03;
            info.ht_40_allowed = body[1] & 0x04 != 0;
        }
        191 => info.has_vht = true,
        192 if body.len() >= 3 => info.vht_op = Some((body[0], body[1], body[2])),
        221 if body.len() >= 4 && body[..4] == [0x00, 0x50, 0xF2, 0x01] => info.has_wpa1 = true,
        255 if !body.is_empty() => apply_extension(info, body[0], &body[1..]),
        _ => {}
    }
}

fn apply_extension(info: &mut IeInfo, ext_id: u8, body: &[u8]) {
    match ext_id {
        35 => info.has_he = true,
        36 => {
            info.has_he = true;
            info.he_6ghz_op = parse_he_6ghz_info(body);
        }
        106 => info.eht_op = parse_eht_op_info(body),
        108 => info.has_eht = true,
        _ => {}
    }
}

/// HE Operation: 3 bytes parameters, 1 byte BSS colour, 2 bytes basic MCS, then
/// optional VHT info (3), co-hosted BSS (1) and 6 GHz operation info (5).
fn parse_he_6ghz_info(body: &[u8]) -> Option<(u8, u8, u8, u8)> {
    if body.len() < 6 {
        return None;
    }
    let params = u32::from(body[0]) | u32::from(body[1]) << 8 | u32::from(body[2]) << 16;
    let mut offset = 6;
    if params & (1 << 14) != 0 {
        offset += 3;
    }
    if params & (1 << 15) != 0 {
        offset += 1;
    }
    if params & (1 << 17) == 0 {
        return None;
    }
    let op = body.get(offset..offset + 4)?;
    Some((op[0], op[1] & 0x03, op[2], op[3]))
}

/// EHT Operation: 1 byte parameters, 4 bytes basic MCS, optional info (control, ccfs0, ccfs1).
fn parse_eht_op_info(body: &[u8]) -> Option<(u8, u8, u8)> {
    if body.first()? & 0x01 == 0 {
        return None;
    }
    let op = body.get(5..8)?;
    Some((op[0] & 0x07, op[1], op[2]))
}

fn parse_rsn_akms(body: &[u8]) -> Vec<u8> {
    // version(2) group cipher(4) pairwise count(2) + n*4, AKM count(2) + m*4
    let read_u16 = |pos: usize| body.get(pos..pos + 2).map(|b| u16::from_le_bytes([b[0], b[1]]) as usize);
    let Some(pairwise) = read_u16(6) else { return Vec::new() };
    let akm_pos = 8 + pairwise * 4;
    let Some(akm_count) = read_u16(akm_pos) else { return Vec::new() };
    (0..akm_count)
        .filter_map(|n| body.get(akm_pos + 2 + n * 4..akm_pos + 6 + n * 4))
        .filter(|suite| suite[..3] == [0x00, 0x0F, 0xAC])
        .map(|suite| suite[3])
        .collect()
}

impl IeInfo {
    pub fn is_hidden(&self) -> bool {
        match &self.ssid {
            None => true,
            Some(s) => s.is_empty() || s.iter().all(|&b| b == 0),
        }
    }

    pub fn security(&self, privacy_bit: bool) -> Security {
        let akms = &self.rsn_akms;
        let has = |v: &[u8]| akms.iter().any(|a| v.contains(a));
        if has(&[12, 13]) {
            Security::Wpa3Enterprise
        } else if has(&[8, 24, 9]) && has(&[2, 4, 6]) {
            Security::Wpa3Transition
        } else if has(&[8, 24, 9]) {
            Security::Wpa3Personal
        } else if has(&[18]) {
            Security::Owe
        } else if has(&[1, 3, 5]) {
            Security::Wpa2Enterprise
        } else if has(&[2, 4, 6]) {
            Security::Wpa2Personal
        } else if self.has_wpa1 {
            Security::WpaPersonal
        } else if privacy_bit {
            Security::Wep
        } else {
            Security::Open
        }
    }

    /// 802.11 amendment letter of the newest PHY advertised.
    pub fn standard(&self, band: Band) -> &'static str {
        if self.has_eht {
            "be"
        } else if self.has_he {
            "ax"
        } else if self.has_vht {
            "ac"
        } else if self.has_ht {
            "n"
        } else if band == Band::G2 {
            "g"
        } else {
            "a"
        }
    }

    pub fn channel_span(&self, band: Band, primary: u32) -> ChannelSpan {
        if let Some((width_code, ccfs0, ccfs1)) = self.eht_op {
            if let Some(span) = eht_span(width_code, ccfs0, ccfs1) {
                return span;
            }
        }
        if band == Band::G6 {
            if let Some((_, width_code, seg0, seg1)) = self.he_6ghz_op {
                return wide_span(width_code, seg0, seg1, primary);
            }
            return ChannelSpan { width_mhz: 20, center_channel: primary };
        }
        if let Some((cw, seg0, seg1)) = self.vht_op {
            if cw >= 1 {
                return vht_span(cw, seg0, seg1);
            }
        }
        if self.ht_40_allowed {
            match self.ht_secondary_offset {
                1 => return ChannelSpan { width_mhz: 40, center_channel: primary + 2 },
                3 => return ChannelSpan { width_mhz: 40, center_channel: primary.saturating_sub(2) },
                _ => {}
            }
        }
        ChannelSpan { width_mhz: 20, center_channel: primary }
    }
}

/// VHT width code 1 means 80 MHz, or 160 MHz when a second segment 8 channels away
/// is present. Codes 2 (160) and 3 (80+80) are deprecated but still seen.
fn vht_span(cw: u8, seg0: u8, seg1: u8) -> ChannelSpan {
    match cw {
        1 if seg1 == 0 => ChannelSpan { width_mhz: 80, center_channel: seg0 as u32 },
        1 if seg0.abs_diff(seg1) == 8 => ChannelSpan { width_mhz: 160, center_channel: seg1 as u32 },
        _ => ChannelSpan { width_mhz: 160, center_channel: seg0 as u32 },
    }
}

/// HE 6 GHz width codes: 0=20, 1=40, 2=80, 3=160 (80+80 when segments differ by more than 8).
fn wide_span(width_code: u8, seg0: u8, seg1: u8, primary: u32) -> ChannelSpan {
    match width_code {
        0 => ChannelSpan { width_mhz: 20, center_channel: primary },
        1 => ChannelSpan { width_mhz: 40, center_channel: seg0 as u32 },
        2 => ChannelSpan { width_mhz: 80, center_channel: seg0 as u32 },
        _ if seg1 != 0 && seg0.abs_diff(seg1) == 8 => ChannelSpan { width_mhz: 160, center_channel: seg1 as u32 },
        _ => ChannelSpan { width_mhz: 160, center_channel: seg0 as u32 },
    }
}

fn eht_span(width_code: u8, ccfs0: u8, ccfs1: u8) -> Option<ChannelSpan> {
    let (width_mhz, center) = match width_code {
        3 => (160, ccfs1),
        4 => (320, ccfs1),
        _ => return None,
    };
    let center = if center == 0 { ccfs0 } else { center };
    Some(ChannelSpan { width_mhz, center_channel: center as u32 })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ie(id: u8, body: &[u8]) -> Vec<u8> {
        let mut v = vec![id, body.len() as u8];
        v.extend_from_slice(body);
        v
    }

    fn rsn(akm: u8) -> Vec<u8> {
        let mut b = vec![1, 0, 0x00, 0x0F, 0xAC, 4, 1, 0, 0x00, 0x0F, 0xAC, 4, 1, 0];
        b.extend_from_slice(&[0x00, 0x0F, 0xAC, akm]);
        b.extend_from_slice(&[0, 0]);
        ie(48, &b)
    }

    #[test]
    fn band_and_channel_math() {
        assert_eq!(Band::from_frequency_mhz(2437), Some(Band::G2));
        assert_eq!(Band::G2.channel_from_frequency(2437), 6);
        assert_eq!(Band::G2.channel_from_frequency(2484), 14);
        assert_eq!(Band::G5.channel_from_frequency(5180), 36);
        assert_eq!(Band::G6.channel_from_frequency(5955), 1);
        assert_eq!(Band::G5.frequency_from_channel(149), 5745);
        assert!(is_dfs_channel(Band::G5, 100));
        assert!(!is_dfs_channel(Band::G5, 36));
    }

    #[test]
    fn hidden_ssid_detection() {
        assert!(parse(&ie(0, &[])).is_hidden());
        assert!(parse(&ie(0, &[0, 0, 0])).is_hidden());
        assert!(!parse(&ie(0, b"Home")).is_hidden());
    }

    #[test]
    fn ht40_above_and_bss_load() {
        let mut data = ie(61, &[6, 0x05, 0, 0, 0]);
        data.extend(ie(45, &[0; 26]));
        data.extend(ie(11, &[12, 0, 128, 0, 0]));
        let info = parse(&data);
        assert_eq!(info.channel_span(Band::G2, 6), ChannelSpan { width_mhz: 40, center_channel: 8 });
        assert_eq!(info.station_count, Some(12));
        assert_eq!(info.channel_utilization, Some(128));
        assert_eq!(info.standard(Band::G2), "n");
    }

    #[test]
    fn vht80_and_vht160() {
        let mut data = ie(61, &[36, 0x05]);
        data.extend(ie(192, &[1, 42, 0]));
        data.extend(ie(191, &[0; 12]));
        let info = parse(&data);
        assert_eq!(info.channel_span(Band::G5, 36), ChannelSpan { width_mhz: 80, center_channel: 42 });
        assert_eq!(info.standard(Band::G5), "ac");

        let info160 = parse(&ie(192, &[1, 42, 50]));
        assert_eq!(info160.channel_span(Band::G5, 36), ChannelSpan { width_mhz: 160, center_channel: 50 });
    }

    #[test]
    fn he_6ghz_operation_info() {
        // params with bit 17 set (6 GHz info present), colour, MCS, then 6 GHz info
        let body = [36, 0x00, 0x00, 0x02, 0x01, 0xFF, 0xFF, 37, 0x02, 39, 0, 0];
        let info = parse(&ie(255, &body));
        assert!(info.has_he);
        assert_eq!(info.channel_span(Band::G6, 37), ChannelSpan { width_mhz: 80, center_channel: 39 });
        assert_eq!(info.standard(Band::G6), "ax");
    }

    #[test]
    fn eht_320() {
        let mut data = ie(255, &[108, 0, 0]);
        data.extend(ie(255, &[106, 0x01, 0, 0, 0, 0, 0x04, 31, 63]));
        let info = parse(&data);
        assert_eq!(info.standard(Band::G6), "be");
        assert_eq!(info.channel_span(Band::G6, 33), ChannelSpan { width_mhz: 320, center_channel: 63 });
    }

    #[test]
    fn security_variants() {
        assert_eq!(parse(&rsn(2)).security(true), Security::Wpa2Personal);
        assert_eq!(parse(&rsn(8)).security(true), Security::Wpa3Personal);
        assert_eq!(parse(&rsn(1)).security(true), Security::Wpa2Enterprise);
        assert_eq!(parse(&rsn(18)).security(true), Security::Owe);
        assert_eq!(parse(&[]).security(true), Security::Wep);
        assert_eq!(parse(&[]).security(false), Security::Open);
        let wpa1 = ie(221, &[0x00, 0x50, 0xF2, 0x01, 1, 0]);
        assert_eq!(parse(&wpa1).security(true), Security::WpaPersonal);
    }

    #[test]
    fn truncated_data_does_not_panic() {
        let info = parse(&[61, 10, 1, 2]);
        assert_eq!(info.primary_channel, None);
        assert!(parse_rsn_akms(&[1, 0, 0]).is_empty());
    }
}
