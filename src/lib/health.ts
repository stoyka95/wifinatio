import { THRESHOLDS, type Level } from './rating';
import type { PingStats } from './stats';

export interface HealthInput {
  connected: boolean;
  rssi: number | null;
  gateway: PingStats | null;
  internet: PingStats | null;
  dnsMs: number | null;
  dnsFailed: boolean;
}

export type HealthFactor = 'signal' | 'router' | 'internet' | 'loss' | 'dns';

export interface Health {
  score: number;
  level: Level;
  /** Penalty points per factor, for explaining the score. */
  penalties: Record<HealthFactor, number>;
}

const scale = (value: number, from: number, to: number, maxPenalty: number) => {
  if (value <= from) return 0;
  if (value >= to) return maxPenalty;
  return ((value - from) / (to - from)) * maxPenalty;
};

const levelForScore = (score: number): Level => (score >= 80 ? 'good' : score >= 55 ? 'fair' : 'poor');

/**
 * Keeps the score consistent with the verdict: a warning cannot read as "healthy"
 * and a problem cannot read as "minor issues".
 */
export const alignWithVerdict = (health: Health, severity: 'ok' | 'info' | 'warn' | 'bad'): Health => {
  const cap = severity === 'bad' ? 54 : severity === 'warn' ? 79 : 100;
  const score = Math.min(health.score, cap);
  return { ...health, score, level: levelForScore(score) };
};

/** Connection health 0–100 from signal, latency, jitter, loss and DNS. */
export const computeHealth = (input: HealthInput): Health => {
  const penalties: Record<HealthFactor, number> = { signal: 0, router: 0, internet: 0, loss: 0, dns: 0 };
  if (!input.connected) return { score: 0, level: 'poor', penalties: { ...penalties, signal: 100 } };

  if (input.rssi !== null) {
    penalties.signal = scale(-input.rssi, -THRESHOLDS.rssi.good, 85, 35);
  }
  if (input.gateway?.avg != null) {
    penalties.router =
      scale(input.gateway.avg, THRESHOLDS.gatewayLatency.good, 150, 22) +
      scale(input.gateway.jitter ?? 0, THRESHOLDS.gatewayJitter.good, 60, 12);
  }
  if (input.internet?.avg != null) {
    penalties.internet =
      scale(input.internet.avg, THRESHOLDS.internetLatency.good, 300, 15) +
      scale(input.internet.jitter ?? 0, THRESHOLDS.internetJitter.good, 100, 10);
  }
  const loss = Math.max(input.gateway?.lossPct ?? 0, input.internet?.lossPct ?? 0);
  penalties.loss = scale(loss, 0, 10, 35);
  if (input.internet && input.internet.count > 5 && input.internet.lossPct >= 90) penalties.loss = 60;
  penalties.dns = input.dnsFailed ? 15 : input.dnsMs !== null ? scale(input.dnsMs, THRESHOLDS.dns.good, 300, 10) : 0;

  const total = Object.values(penalties).reduce((a, b) => a + b, 0);
  const score = Math.round(Math.max(0, Math.min(100, 100 - total)));
  return { score, level: levelForScore(score), penalties };
};
