//! Speed test against Cloudflare's public endpoints (speed.cloudflare.com/__down and
//! /__up) with parallel connections, a warm-up phase and latency under load.

use std::net::Ipv4Addr;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures_util::stream;
use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, AppResult};
use crate::ping::{EchoOptions, Pinger};
use crate::wifi::{now_ms, WifiConnection};

pub const EVENT_SPEED_PROGRESS: &str = "speed-progress";
const DOWN_URL: &str = "https://speed.cloudflare.com/__down?bytes=";
const UP_URL: &str = "https://speed.cloudflare.com/__up";
const CONNECTIONS: usize = 6;
const DOWN_CHUNK_BYTES: u64 = 25_000_000;
const UP_CHUNK_BYTES: usize = 8_000_000;
const UP_PIECE: usize = 64 * 1024;
const WARMUP: Duration = Duration::from_secs(2);
const MEASURE: Duration = Duration::from_secs(8);
const LATENCY_TARGET: Ipv4Addr = Ipv4Addr::new(1, 1, 1, 1);

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Latency,
    Download,
    Upload,
    Done,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub phase: Phase,
    /// 0.0–1.0 within the current phase.
    pub progress: f64,
    pub mbps: Option<f64>,
    pub ping_ms: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeedResult {
    pub ts: i64,
    pub download_mbps: f64,
    pub upload_mbps: f64,
    pub idle_ping_ms: Option<f64>,
    pub idle_jitter_ms: Option<f64>,
    pub loaded_ping_down_ms: Option<f64>,
    pub loaded_ping_up_ms: Option<f64>,
    pub server: Option<String>,
    pub room: Option<String>,
    pub wifi: Option<WifiConnection>,
}

/// Guards against concurrent runs and carries the cancel flag.
#[derive(Default)]
pub struct SpeedControl {
    running: AtomicBool,
    cancel: AtomicBool,
}

impl SpeedControl {
    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
    }

    fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::SeqCst)
    }
}

pub async fn run(app: &AppHandle, control: &SpeedControl) -> AppResult<SpeedResult> {
    if control.running.swap(true, Ordering::SeqCst) {
        return Err(AppError::Busy);
    }
    control.cancel.store(false, Ordering::SeqCst);
    let result = run_inner(app, control).await;
    control.running.store(false, Ordering::SeqCst);
    result
}

async fn run_inner(app: &AppHandle, control: &SpeedControl) -> AppResult<SpeedResult> {
    let client = crate::netinfo::http_builder()
        .pool_max_idle_per_host(CONNECTIONS)
        .connect_timeout(Duration::from_secs(6))
        .build()?;

    let emit = |p: Progress| {
        let _ = app.emit(EVENT_SPEED_PROGRESS, p);
    };
    let idle = tokio::task::spawn_blocking(|| idle_latency(20)).await.map_err(|e| AppError::msg(e.to_string()))?;
    emit(Progress { phase: Phase::Latency, progress: 1.0, mbps: None, ping_ms: idle.0 });
    if control.cancelled() {
        return Err(AppError::Cancelled);
    }

    let server = colo(&client).await;
    let (download_mbps, loaded_down) = measure(&client, Direction::Download, control, &emit).await?;
    let (upload_mbps, loaded_up) = measure(&client, Direction::Upload, control, &emit).await?;
    emit(Progress { phase: Phase::Done, progress: 1.0, mbps: None, ping_ms: None });

    Ok(SpeedResult {
        ts: now_ms(),
        download_mbps,
        upload_mbps,
        idle_ping_ms: idle.0,
        idle_jitter_ms: idle.1,
        loaded_ping_down_ms: loaded_down,
        loaded_ping_up_ms: loaded_up,
        server,
        room: None,
        wifi: None,
    })
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Direction {
    Download,
    Upload,
}

/// Runs parallel transfers for warm-up + measurement and pings 1.1.1.1 meanwhile.
/// Returns (Mbps over the measurement window, median latency under load).
async fn measure(
    client: &reqwest::Client,
    direction: Direction,
    control: &SpeedControl,
    emit: &impl Fn(Progress),
) -> AppResult<(f64, Option<f64>)> {
    let bytes = Arc::new(AtomicU64::new(0));
    let stop = Arc::new(AtomicBool::new(false));
    let errors = Arc::new(AtomicU64::new(0));
    let workers: Vec<_> = (0..CONNECTIONS)
        .map(|_| {
            let (client, bytes, stop, errors) = (client.clone(), bytes.clone(), stop.clone(), errors.clone());
            tokio::spawn(async move {
                while !stop.load(Ordering::Relaxed) {
                    let ok = match direction {
                        Direction::Download => download_once(&client, &bytes, &stop).await,
                        Direction::Upload => upload_once(&client, &bytes, &stop).await,
                    };
                    if ok.is_err() {
                        errors.fetch_add(1, Ordering::Relaxed);
                        tokio::time::sleep(Duration::from_millis(200)).await;
                    }
                }
            })
        })
        .collect();

    let loaded_pings = Arc::new(Mutex::new(Vec::new()));
    let pinger_stop = stop.clone();
    let pings = loaded_pings.clone();
    let pinger_task = tokio::task::spawn_blocking(move || {
        let Ok(pinger) = Pinger::new() else { return };
        std::thread::sleep(WARMUP / 2);
        while !pinger_stop.load(Ordering::Relaxed) {
            if let Some(rtt) = pinger.echo(LATENCY_TARGET, 1000, EchoOptions::default()).rtt_ms {
                pings.lock().push(rtt);
            }
            std::thread::sleep(Duration::from_millis(250));
        }
    });

    let phase = if direction == Direction::Download { Phase::Download } else { Phase::Upload };
    let started = Instant::now();
    let mut baseline: Option<(Instant, u64)> = None;
    let mut window: (Instant, u64) = (started, 0);
    let total = WARMUP + MEASURE;
    while started.elapsed() < total {
        tokio::time::sleep(Duration::from_millis(250)).await;
        if control.cancelled() {
            stop.store(true, Ordering::Relaxed);
            return Err(AppError::Cancelled);
        }
        let now = Instant::now();
        let current = bytes.load(Ordering::Relaxed);
        if baseline.is_none() && started.elapsed() >= WARMUP {
            baseline = Some((now, current));
        }
        let mbps = if now.duration_since(window.0) > Duration::ZERO {
            Some(to_mbps(current - window.1, now.duration_since(window.0)))
        } else {
            None
        };
        if now.duration_since(window.0) >= Duration::from_millis(1000) {
            window = (now, current);
        }
        emit(Progress {
            phase,
            progress: (started.elapsed().as_secs_f64() / total.as_secs_f64()).min(1.0),
            mbps,
            ping_ms: loaded_pings.lock().last().copied(),
        });
    }
    stop.store(true, Ordering::Relaxed);
    let end = (Instant::now(), bytes.load(Ordering::Relaxed));
    for w in workers {
        w.abort();
    }
    let _ = pinger_task.await;

    let (base_time, base_bytes) = baseline.unwrap_or((started, 0));
    if end.1 == 0 {
        return Err(AppError::msg("speedtest_no_data"));
    }
    let mbps = to_mbps(end.1 - base_bytes, end.0.duration_since(base_time));
    let loaded = median(&loaded_pings.lock());
    Ok((mbps, loaded))
}

async fn download_once(client: &reqwest::Client, bytes: &AtomicU64, stop: &AtomicBool) -> AppResult<()> {
    let mut resp = client
        .get(format!("{DOWN_URL}{DOWN_CHUNK_BYTES}"))
        .send()
        .await?
        .error_for_status()?;
    while let Some(chunk) = resp.chunk().await? {
        bytes.fetch_add(chunk.len() as u64, Ordering::Relaxed);
        if stop.load(Ordering::Relaxed) {
            break;
        }
    }
    Ok(())
}

async fn upload_once(client: &reqwest::Client, bytes: &Arc<AtomicU64>, stop: &Arc<AtomicBool>) -> AppResult<()> {
    let piece = bytes::Bytes::from(vec![0x5Au8; UP_PIECE]);
    let (counter, stop_flag) = (bytes.clone(), stop.clone());
    let pieces = UP_CHUNK_BYTES / UP_PIECE;
    let body_stream = stream::iter((0..pieces).map(move |_| {
        if stop_flag.load(Ordering::Relaxed) {
            return Err(std::io::Error::other("stopped"));
        }
        counter.fetch_add(UP_PIECE as u64, Ordering::Relaxed);
        Ok::<_, std::io::Error>(piece.clone())
    }));
    client
        .post(UP_URL)
        .header("content-type", "application/octet-stream")
        .header("content-length", (pieces * UP_PIECE).to_string())
        .body(reqwest::Body::wrap_stream(body_stream))
        .send()
        .await?
        .error_for_status()?;
    Ok(())
}

/// Idle latency: (median, jitter as mean absolute difference of consecutive samples).
fn idle_latency(count: usize) -> (Option<f64>, Option<f64>) {
    let Ok(pinger) = Pinger::new() else { return (None, None) };
    let samples: Vec<f64> = (0..count)
        .filter_map(|_| {
            let rtt = pinger.echo(LATENCY_TARGET, 1000, EchoOptions::default()).rtt_ms;
            std::thread::sleep(Duration::from_millis(100));
            rtt
        })
        .collect();
    (median(&samples), jitter(&samples))
}

async fn colo(client: &reqwest::Client) -> Option<String> {
    let text = client.get("https://speed.cloudflare.com/cdn-cgi/trace").send().await.ok()?.text().await.ok()?;
    text.lines().find_map(|l| l.strip_prefix("colo=").map(String::from))
}

fn to_mbps(bytes: u64, elapsed: Duration) -> f64 {
    let secs = elapsed.as_secs_f64();
    if secs <= 0.0 {
        return 0.0;
    }
    bytes as f64 * 8.0 / secs / 1_000_000.0
}

pub fn median(values: &[f64]) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.total_cmp(b));
    let mid = sorted.len() / 2;
    Some(if sorted.len() % 2 == 0 { (sorted[mid - 1] + sorted[mid]) / 2.0 } else { sorted[mid] })
}

pub fn jitter(values: &[f64]) -> Option<f64> {
    if values.len() < 2 {
        return None;
    }
    let sum: f64 = values.windows(2).map(|w| (w[1] - w[0]).abs()).sum();
    Some(sum / (values.len() - 1) as f64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn median_and_jitter() {
        assert_eq!(median(&[3.0, 1.0, 2.0]), Some(2.0));
        assert_eq!(median(&[4.0, 1.0, 2.0, 3.0]), Some(2.5));
        assert_eq!(median(&[]), None);
        assert_eq!(jitter(&[10.0, 12.0, 10.0]), Some(2.0));
    }

    #[test]
    fn mbps_conversion() {
        assert_eq!(to_mbps(12_500_000, Duration::from_secs(1)), 100.0);
        assert_eq!(to_mbps(1, Duration::ZERO), 0.0);
    }
}
