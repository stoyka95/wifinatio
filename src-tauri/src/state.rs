use std::sync::atomic::{AtomicBool, AtomicI64};
use std::sync::Arc;

use parking_lot::RwLock;

use crate::monitor::DnsProbe;
use crate::netinfo::NetInfo;
use crate::ping::PingHub;
use crate::settings::Settings;
use crate::speedtest::SpeedControl;
use crate::storage::Storage;
use crate::wifi::{BssInfo, WifiStatus};

/// Shared application state, managed by Tauri.
pub struct AppState {
    pub storage: Storage,
    pub settings: RwLock<Settings>,
    pub hub: Arc<PingHub>,
    pub wifi: RwLock<Option<WifiStatus>>,
    pub netinfo: RwLock<Option<NetInfo>>,
    pub networks: RwLock<Vec<BssInfo>>,
    pub dns_probes: RwLock<Vec<DnsProbe>>,
    pub last_scan: AtomicI64,
    pub scanning: AtomicBool,
    pub speed: SpeedControl,
}

impl AppState {
    pub fn new(storage: Storage) -> Self {
        let settings = storage.load_settings().sanitized();
        Self {
            storage,
            settings: RwLock::new(settings),
            hub: PingHub::new(),
            wifi: RwLock::new(None),
            netinfo: RwLock::new(None),
            networks: RwLock::new(Vec::new()),
            dns_probes: RwLock::new(Vec::new()),
            last_scan: AtomicI64::new(0),
            scanning: AtomicBool::new(false),
            speed: SpeedControl::default(),
        }
    }
}
