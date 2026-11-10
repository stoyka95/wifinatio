import { useEffect, useMemo, useState } from 'react';
import { diagnose, routerIgnoresPing, type Diagnosis } from '@/lib/diagnosis';
import { alignWithVerdict, computeHealth, type Health } from '@/lib/health';
import { computeStats, mergeInternet, sliceWindow, type PingStats } from '@/lib/stats';
import type { PingSample } from '@/lib/types';
import { useLiveStore } from '@/stores/live';
import { useSettingsStore } from '@/stores/settings';

export const INTERNET_TARGETS = ['cloudflare', 'google'];
export const GATEWAY = 'gateway';

export interface LiveAnalysis {
  gateway: PingStats | null;
  internet: PingStats | null;
  dnsMs: number | null;
  dnsFailed: boolean;
  /** The router drops ping while the internet answers: its latency and loss are unknown, not bad. */
  routerSilent: boolean;
  health: Health;
  diagnosis: Diagnosis;
}

/** Re-renders at most every `ms` regardless of how often samples arrive. */
export const useTicker = (ms: number) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
};

export const analyse = (
  ping: Record<string, PingSample[]>,
  windowMs: number,
  now: number,
  spikeThresholdMs: number,
  extra: { adapterPresent: boolean; connected: boolean; rssi: number | null; dnsMs: number | null; dnsFailed: boolean },
): LiveAnalysis => {
  const gwSamples = sliceWindow(ping[GATEWAY] ?? [], windowMs, now);
  const inetSamples = mergeInternet(INTERNET_TARGETS.map((id) => sliceWindow(ping[id] ?? [], windowMs, now)));
  const gateway = gwSamples.length ? computeStats(gwSamples, spikeThresholdMs) : null;
  const internet = inetSamples.length ? computeStats(inetSamples, spikeThresholdMs) : null;
  const diagnosis = diagnose({ ...extra, gateway, internet });
  const routerSilent = routerIgnoresPing(gateway, internet);
  const health = alignWithVerdict(
    computeHealth({
      connected: extra.connected,
      rssi: extra.rssi,
      gateway: routerSilent ? null : gateway,
      internet,
      dnsMs: extra.dnsMs,
      dnsFailed: extra.dnsFailed,
    }),
    diagnosis.severity,
  );
  return { gateway, internet, dnsMs: extra.dnsMs, dnsFailed: extra.dnsFailed, routerSilent, health, diagnosis };
};

/** Live stats, health and diagnosis over the last `windowMs`. */
export const useLiveAnalysis = (windowMs = 5 * 60_000): LiveAnalysis => {
  const now = useTicker(1000);
  const wifi = useLiveStore((s) => s.wifi);
  const ping = useLiveStore((s) => s.ping);
  const dnsProbes = useLiveStore((s) => s.dnsProbes);
  const spikeThreshold = useSettingsStore((s) => s.settings.spikeThresholdMs);

  return useMemo(() => {
    const recentDns = dnsProbes.slice(-5);
    const okDns = recentDns.filter((p) => p.ms !== null).map((p) => p.ms as number);
    const dnsFailed = recentDns.length >= 2 && recentDns.slice(-2).every((p) => p.ms === null);
    return analyse(ping, windowMs, now, spikeThreshold, {
      adapterPresent: wifi ? wifi.state !== 'no_adapter' : true,
      connected: wifi ? wifi.state === 'connected' : true,
      rssi: wifi?.connection?.rssi ?? null,
      dnsMs: okDns.length ? okDns.reduce((a, b) => a + b, 0) / okDns.length : null,
      dnsFailed,
    });
    // `now` drives recomputation once per second; `ping` is mutated in place.
  }, [now, wifi, ping, dnsProbes, spikeThreshold, windowMs]);
};
