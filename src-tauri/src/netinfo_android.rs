//! Active network on Android: ConnectivityManager.getLinkProperties via NetBridge.kt,
//! which answers in the NetInfo JSON shape.

use super::{prefix_to_mask, NetInfo};
use crate::android_bridge;
use crate::error::{AppError, AppResult};

pub fn primary_adapter() -> AppResult<NetInfo> {
    let mut info: NetInfo = android_bridge::call_json("linkInfo")?;
    if info.adapter_id.is_empty() {
        return Err(AppError::msg("no_adapter"));
    }
    for entry in &mut info.ipv4 {
        entry.mask = prefix_to_mask(entry.prefix).to_string();
    }
    Ok(info)
}
