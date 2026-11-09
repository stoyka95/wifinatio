// Live data pushed by the backend through Tauri events (no frontend polling).
import { create } from 'zustand';
import type { DnsProbe, NetEvent, PingSample, PingTarget, WifiStatus } from '@/lib/types';

const SIGNAL_HISTORY_MAX = 3600;
const PING_HISTORY_MS = 60 * 60 * 1000;

export interface SignalPoint {
  ts: number;
  rssi: number | null;
}

interface LiveState {
  wifi: WifiStatus | null;
  wifiReceivedAt: number | null;
  signal: SignalPoint[];
  targets: PingTarget[];
  /** Ring buffers per target; mutated in place, `pingVersion` signals changes. */
  ping: Record<string, PingSample[]>;
  pingVersion: number;
  dnsProbes: DnsProbe[];
  scanning: boolean;
  lastEvent: NetEvent | null;
  setWifi: (status: WifiStatus) => void;
  setPingHistory: (targets: PingTarget[], samples: Record<string, PingSample[]>) => void;
  addPingSamples: (samples: PingSample[]) => void;
  addDnsProbe: (probe: DnsProbe) => void;
  setScanning: (active: boolean) => void;
  setLastEvent: (event: NetEvent) => void;
}

export const useLiveStore = create<LiveState>((set, get) => ({
  wifi: null,
  wifiReceivedAt: null,
  signal: [],
  targets: [],
  ping: {},
  pingVersion: 0,
  dnsProbes: [],
  scanning: false,
  lastEvent: null,
  setWifi: (status) => {
    const signal = get().signal;
    const next = signal.length >= SIGNAL_HISTORY_MAX ? signal.slice(-SIGNAL_HISTORY_MAX + 1) : signal.slice();
    next.push({ ts: status.ts, rssi: status.connection?.rssi ?? null });
    set({ wifi: status, wifiReceivedAt: Date.now(), signal: next });
  },
  setPingHistory: (targets, samples) => {
    const ping: Record<string, PingSample[]> = {};
    for (const t of targets) ping[t.id] = [...(samples[t.id] ?? [])].sort((a, b) => a.ts - b.ts);
    set({ targets, ping, pingVersion: get().pingVersion + 1 });
  },
  addPingSamples: (samples) => {
    const ping = get().ping;
    const cutoff = Date.now() - PING_HISTORY_MS;
    for (const sample of samples) {
      const buf = (ping[sample.target] ??= []);
      buf.push(sample);
      if (buf.length > 0 && buf[0].ts < cutoff) {
        const keepFrom = buf.findIndex((s) => s.ts >= cutoff);
        buf.splice(0, keepFrom === -1 ? buf.length : keepFrom);
      }
    }
    set({ pingVersion: get().pingVersion + 1 });
  },
  addDnsProbe: (probe) => set({ dnsProbes: [...get().dnsProbes.slice(-19), probe] }),
  setScanning: (active) => set({ scanning: active }),
  setLastEvent: (event) => set({ lastEvent: event }),
}));
