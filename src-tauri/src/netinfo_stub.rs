//! Platforms without a network backend (Linux desktop, used for tests).

use super::NetInfo;
use crate::error::{AppError, AppResult};

pub fn primary_adapter() -> AppResult<NetInfo> {
    Err(AppError::msg("no_adapter"))
}
