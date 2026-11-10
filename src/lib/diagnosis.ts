// Rules that turn live measurements into a single human verdict: where the
// problem is (Wi-Fi / device vs. provider) and why.
import { rateRssi, THRESHOLDS } from './rating';
import type { PingStats } from './stats';

export type DiagnosisCode =
  | 'no_adapter'
  | 'disconnected'
  | 'collecting'
  | 'router_down'
  | 'internet_down'
  | 'periodic_spikes'
  | 'local_weak_signal'
  | 'local_unstable'
  | 'isp_unstable'
  | 'unstable_unknown'
  | 'dns_failing'
  | 'dns_slow'
  | 'weak_signal'
  | 'ok_router_silent'
  | 'ok';

export type Severity = 'ok' | 'warn' | 'bad' | 'info';

export interface Diagnosis {
  code: DiagnosisCode;
  severity: Severity;
  /** Values interpolated into the localized sentence. */
  params: { rssi?: number; periodSec?: number; dnsMs?: number };
  /** Where the problem sits, for the "Wi-Fi vs provider" verdict. */
  location: 'none' | 'local' | 'isp' | 'dns' | 'unknown';
}

export interface DiagnosisInput {
  adapterPresent: boolean;
  connected: boolean;
  rssi: number | null;
  gateway: PingStats | null;
  internet: PingStats | null;
  dnsMs: number | null;
  dnsFailed: boolean;
}

const MIN_SAMPLES = 10;
/** Router loss at or above this, with the internet answering, means the router ignores ping. */
const SILENT_ROUTER_LOSS_PCT = 95;

/**
 * Traffic to the internet goes through the router, so when the internet answers
 * while the router never does, the router only ignores ping (ICMP filtering,
 * guest networks). Its numbers then say nothing about the link.
 */
export const routerIgnoresPing = (gateway: PingStats | null, internet: PingStats | null): boolean =>
  !!gateway &&
  !!internet &&
  gateway.count >= MIN_SAMPLES &&
  internet.count >= MIN_SAMPLES &&
  gateway.lossPct >= SILENT_ROUTER_LOSS_PCT &&
  internet.lossPct < 50;
const HEAVY_LOSS_PCT = 10;

/** Unstable = noticeable loss, frequent spikes or high jitter. */
export const isUnstable = (stats: PingStats, jitterLimit: number): boolean => {
  if (stats.count < MIN_SAMPLES) return false;
  const spikeRate = stats.count ? stats.spikes / stats.count : 0;
  return stats.lossPct > THRESHOLDS.loss.fair || spikeRate > 0.03 || (stats.jitter ?? 0) > jitterLimit;
};

/**
 * Detects spikes that repeat at a fixed interval (background scanning, adapter
 * power saving). Returns the period in seconds or null.
 */
export const detectPeriodicSpikes = (spikeTimes: number[]): number | null => {
  if (spikeTimes.length < 4) return null;
  const intervals: number[] = [];
  for (let i = 1; i < spikeTimes.length; i++) intervals.push((spikeTimes[i] - spikeTimes[i - 1]) / 1000);
  const filtered = intervals.filter((s) => s >= 3);
  if (filtered.length < 3) return null;
  const mean = filtered.reduce((a, b) => a + b, 0) / filtered.length;
  const variance = filtered.reduce((a, b) => a + (b - mean) ** 2, 0) / filtered.length;
  const cv = Math.sqrt(variance) / mean;
  return cv < 0.2 && mean >= 5 && mean <= 600 ? Math.round(mean) : null;
};

const result = (
  code: DiagnosisCode,
  severity: Severity,
  location: Diagnosis['location'],
  params: Diagnosis['params'] = {},
): Diagnosis => ({ code, severity, location, params });

export const diagnose = (input: DiagnosisInput): Diagnosis => {
  if (!input.adapterPresent) return result('no_adapter', 'bad', 'local');
  if (!input.connected) return result('disconnected', 'bad', 'local');
  const { gateway, internet, rssi } = input;
  if (!gateway || !internet || gateway.count < MIN_SAMPLES || internet.count < MIN_SAMPLES) {
    return result('collecting', 'info', 'none');
  }
  const weak = rssi !== null && rateRssi(rssi) === 'poor';
  const rssiParam = rssi ?? undefined;

  const silentRouter = routerIgnoresPing(gateway, internet);
  if (gateway.lossPct >= 50 && !silentRouter) return result('router_down', 'bad', 'local', { rssi: rssiParam });
  if (internet.lossPct >= 50) return result('internet_down', 'bad', 'isp');

  const gatewayUnstable = !silentRouter && isUnstable(gateway, THRESHOLDS.gatewayJitter.fair);
  const internetUnstable = isUnstable(internet, THRESHOLDS.internetJitter.fair);

  const period = (silentRouter ? null : detectPeriodicSpikes(gateway.spikeTimes)) ?? detectPeriodicSpikes(internet.spikeTimes);
  if (period !== null && (gatewayUnstable || internetUnstable || gateway.spikes >= 4)) {
    return result('periodic_spikes', 'warn', 'local', { periodSec: period });
  }
  // Heavy loss or very high average latency is a problem, not just a warning.
  const heavy = (s: PingStats, latencyLimit: number) =>
    s.lossPct >= HEAVY_LOSS_PCT || (s.avg ?? 0) >= latencyLimit ? 'bad' : 'warn';
  if (gatewayUnstable) {
    return weak
      ? result('local_weak_signal', 'bad', 'local', { rssi: rssiParam })
      : result('local_unstable', heavy(gateway, 100), 'local', { rssi: rssiParam });
  }
  if (internetUnstable) {
    // Without the router as a reference point, Wi-Fi and provider cannot be told apart.
    return silentRouter
      ? result('unstable_unknown', heavy(internet, 200), 'unknown', { rssi: rssiParam })
      : result('isp_unstable', heavy(internet, 200), 'isp');
  }
  if (input.dnsFailed) return result('dns_failing', 'bad', 'dns');
  if (input.dnsMs !== null && input.dnsMs > THRESHOLDS.dns.fair) {
    return result('dns_slow', 'warn', 'dns', { dnsMs: Math.round(input.dnsMs) });
  }
  if (weak) return result('weak_signal', 'warn', 'local', { rssi: rssiParam });
  if (silentRouter) return result('ok_router_silent', 'ok', 'none');
  return result('ok', 'ok', 'none');
};
