use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Dark,
    Light,
    System,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    Cs,
    En,
}

/// User settings, persisted as JSON in SQLite. Unknown or missing fields fall back
/// to defaults so older databases keep working after upgrades.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub ping_interval_ms: u64,
    pub custom_targets: Vec<String>,
    /// A sample counts as a spike when it is this many ms above the window median.
    pub spike_threshold_ms: f64,
    pub weak_signal_dbm: i32,
    pub language: Language,
    pub theme: Theme,
    pub run_in_tray: bool,
    pub notifications: bool,
    /// 0 = automatic scanning disabled (default, scans cause latency spikes).
    pub auto_scan_minutes: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            ping_interval_ms: 1000,
            custom_targets: Vec::new(),
            spike_threshold_ms: 50.0,
            weak_signal_dbm: -70,
            language: Language::Cs,
            theme: Theme::Dark,
            run_in_tray: false,
            notifications: true,
            auto_scan_minutes: 0,
        }
    }
}

impl Settings {
    /// Clamps values to sane ranges so a bad frontend payload cannot stall the pinger.
    pub fn sanitized(mut self) -> Self {
        self.ping_interval_ms = self.ping_interval_ms.clamp(250, 10_000);
        self.spike_threshold_ms = self.spike_threshold_ms.clamp(5.0, 2_000.0);
        self.weak_signal_dbm = self.weak_signal_dbm.clamp(-95, -40);
        self.auto_scan_minutes = self.auto_scan_minutes.min(240);
        self.custom_targets = self
            .custom_targets
            .into_iter()
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .take(5)
            .collect();
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_fields_use_defaults() {
        let s: Settings = serde_json::from_str(r#"{"pingIntervalMs": 2000}"#).unwrap();
        assert_eq!(s.ping_interval_ms, 2000);
        assert_eq!(s.weak_signal_dbm, -70);
        assert_eq!(s.theme, Theme::Dark);
    }

    #[test]
    fn sanitize_clamps_values() {
        let s = Settings {
            ping_interval_ms: 10,
            custom_targets: vec![" 9.9.9.9 ".into(), "".into()],
            ..Settings::default()
        }
        .sanitized();
        assert_eq!(s.ping_interval_ms, 250);
        assert_eq!(s.custom_targets, vec!["9.9.9.9".to_string()]);
    }
}
