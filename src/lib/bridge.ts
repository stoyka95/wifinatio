// Subscribes to backend events once at startup and feeds the stores.
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useLiveStore } from '@/stores/live';
import { api } from './api';
import type { DnsProbe, NetEvent, PingSample, WifiStatus } from './types';

/** Samples are batched so charts redraw once per second, not once per target. */
const FLUSH_MS = 1000;

export const startBridge = async (): Promise<UnlistenFn> => {
  const live = useLiveStore.getState();
  let pending: PingSample[] = [];
  let timer: number | undefined;
  const flush = () => {
    timer = undefined;
    if (pending.length) live.addPingSamples(pending);
    pending = [];
  };

  const unlisteners = await Promise.all([
    listen<WifiStatus>('wifi-status', (e) => live.setWifi(e.payload)),
    listen<PingSample>('ping-sample', (e) => {
      pending.push(e.payload);
      timer ??= window.setTimeout(flush, FLUSH_MS);
    }),
    listen<DnsProbe>('dns-probe', (e) => live.addDnsProbe(e.payload)),
    listen<{ active: boolean }>('scan-state', (e) => live.setScanning(e.payload.active)),
    listen<NetEvent>('net-event', (e) => live.setLastEvent(e.payload)),
  ]);

  const [history, status] = await Promise.allSettled([api.getPingHistory(), api.getWifiStatus()]);
  if (history.status === 'fulfilled') {
    live.setPingHistory(history.value.targets, history.value.samples);
    history.value.dnsProbes.forEach((p) => live.addDnsProbe(p));
  }
  if (status.status === 'fulfilled' && !useLiveStore.getState().wifi) live.setWifi(status.value);

  return () => unlisteners.forEach((u) => u());
};

/** Re-reads targets after settings changed (custom targets, interval). */
export const reloadPingHistory = async () => {
  const history = await api.getPingHistory();
  useLiveStore.getState().setPingHistory(history.targets, history.samples);
};
