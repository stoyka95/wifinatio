import type { PingSample } from './types';

export interface PingStats {
  /** Samples considered (scan samples excluded). */
  count: number;
  lost: number;
  lossPct: number;
  min: number | null;
  avg: number | null;
  max: number | null;
  median: number | null;
  p95: number | null;
  /** Mean absolute difference between consecutive replies (RFC 3550 style). */
  jitter: number | null;
  spikes: number;
  spikeTimes: number[];
  /** Samples ignored because a Wi-Fi scan was running. */
  scanSamples: number;
}

export const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

export const percentile = (values: number[], p: number): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
};

export const jitter = (values: number[]): number | null => {
  if (values.length < 2) return null;
  let sum = 0;
  for (let i = 1; i < values.length; i++) sum += Math.abs(values[i] - values[i - 1]);
  return sum / (values.length - 1);
};

/** A spike is a reply slower than the window median by more than `spikeThresholdMs`. */
export const isSpike = (rtt: number, windowMedian: number, spikeThresholdMs: number) =>
  rtt > windowMedian + spikeThresholdMs;

export const computeStats = (samples: PingSample[], spikeThresholdMs: number): PingStats => {
  const relevant = samples.filter((s) => !s.scan);
  const replies = relevant.filter((s) => s.rtt !== null).map((s) => s.rtt as number);
  const lost = relevant.length - replies.length;
  const med = median(replies);
  const spikeTimes =
    med === null
      ? []
      : relevant.filter((s) => s.rtt !== null && isSpike(s.rtt, med, spikeThresholdMs)).map((s) => s.ts);
  return {
    count: relevant.length,
    lost,
    lossPct: relevant.length ? (lost / relevant.length) * 100 : 0,
    min: replies.length ? Math.min(...replies) : null,
    avg: replies.length ? replies.reduce((a, b) => a + b, 0) / replies.length : null,
    max: replies.length ? Math.max(...replies) : null,
    median: med,
    p95: percentile(replies, 95),
    jitter: jitter(replies),
    spikes: spikeTimes.length,
    spikeTimes,
    scanSamples: samples.length - relevant.length,
  };
};

/** Samples newer than `windowMs` before the latest sample (or now). */
export const sliceWindow = (samples: PingSample[], windowMs: number, now = Date.now()): PingSample[] => {
  const from = now - windowMs;
  let start = samples.length;
  while (start > 0 && samples[start - 1].ts >= from) start--;
  return samples.slice(start);
};

/** Merges the internet targets into one series: a tick counts as lost only when all targets lost it. */
export const mergeInternet = (series: PingSample[][]): PingSample[] => {
  const nonEmpty = series.filter((s) => s.length > 0);
  if (nonEmpty.length <= 1) return nonEmpty[0] ?? [];
  const byTick = new Map<number, PingSample[]>();
  for (const s of nonEmpty) {
    for (const sample of s) {
      const tick = Math.round(sample.ts / 1000);
      const list = byTick.get(tick) ?? [];
      list.push(sample);
      byTick.set(tick, list);
    }
  }
  return [...byTick.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, list]) => {
      const replies = list.filter((x) => x.rtt !== null).map((x) => x.rtt as number);
      return {
        target: 'internet',
        ts: list[0].ts,
        rtt: replies.length ? Math.min(...replies) : null,
        scan: list.some((x) => x.scan),
      };
    });
};
