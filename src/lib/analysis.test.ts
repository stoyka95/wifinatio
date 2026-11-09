import { describe, expect, it } from 'vitest';
import { recommendChannel, span } from './channels';
import { detectPeriodicSpikes, diagnose, type DiagnosisInput } from './diagnosis';
import { alignWithVerdict, computeHealth } from './health';
import { bufferbloatGrade, rateRssi, rssiToPercent, worstLevel } from './rating';
import { computeStats, mergeInternet, sliceWindow } from './stats';
import type { BssInfo, PingSample } from './types';

const series = (rtts: (number | null)[], opts: { start?: number; step?: number; scanAt?: number[] } = {}): PingSample[] =>
  rtts.map((rtt, i) => ({
    target: 't',
    ts: (opts.start ?? 0) + i * (opts.step ?? 1000),
    rtt,
    scan: opts.scanAt?.includes(i) ?? false,
  }));

const steady = (ms: number, n = 60) => series(Array.from({ length: n }, () => ms));

describe('stats', () => {
  it('computes loss, median, jitter and spikes', () => {
    const s = computeStats(series([10, 12, null, 11, 200, 10]), 50);
    expect(s.count).toBe(6);
    expect(s.lost).toBe(1);
    expect(s.lossPct).toBeCloseTo(16.67, 1);
    expect(s.median).toBe(11);
    expect(s.spikes).toBe(1);
    expect(s.min).toBe(10);
    expect(s.max).toBe(200);
  });

  it('ignores samples taken during a scan', () => {
    const s = computeStats(series([10, 300, null, 10], { scanAt: [1, 2] }), 50);
    expect(s.count).toBe(2);
    expect(s.spikes).toBe(0);
    expect(s.lost).toBe(0);
    expect(s.scanSamples).toBe(2);
  });

  it('slices a time window', () => {
    const s = series([1, 2, 3, 4, 5]);
    expect(sliceWindow(s, 2000, 4000).map((x) => x.rtt)).toEqual([3, 4, 5]);
  });

  it('merges internet targets: lost only when all are lost', () => {
    const a = series([10, null, null]);
    const b = series([12, 14, null]);
    expect(mergeInternet([a, b]).map((x) => x.rtt)).toEqual([10, 14, null]);
  });
});

describe('rating', () => {
  it('rates RSSI', () => {
    expect(rateRssi(-55)).toBe('good');
    expect(rateRssi(-67)).toBe('fair');
    expect(rateRssi(-78)).toBe('poor');
    expect(rssiToPercent(-50)).toBe(100);
    expect(rssiToPercent(-75)).toBe(50);
  });

  it('grades bufferbloat', () => {
    expect(bufferbloatGrade(15, 18)).toBe('A+');
    expect(bufferbloatGrade(15, 40)).toBe('A');
    expect(bufferbloatGrade(15, 300)).toBe('D');
    expect(bufferbloatGrade(15, 900)).toBe('F');
    expect(bufferbloatGrade(null, 10)).toBeNull();
  });

  it('picks the worst level', () => {
    expect(worstLevel(['good', 'fair'])).toBe('fair');
    expect(worstLevel(['good', 'poor', 'fair'])).toBe('poor');
  });
});

describe('health', () => {
  it('scores a clean connection high', () => {
    const h = computeHealth({
      connected: true,
      rssi: -52,
      gateway: computeStats(steady(3), 50),
      internet: computeStats(steady(15), 50),
      dnsMs: 20,
      dnsFailed: false,
    });
    expect(h.score).toBeGreaterThanOrEqual(95);
    expect(h.level).toBe('good');
  });

  it('penalises weak signal and loss', () => {
    const lossy = series(Array.from({ length: 60 }, (_, i) => (i % 10 === 0 ? null : 5)));
    const h = computeHealth({
      connected: true,
      rssi: -80,
      gateway: computeStats(lossy, 50),
      internet: computeStats(lossy, 50),
      dnsMs: 30,
      dnsFailed: false,
    });
    expect(h.level).toBe('poor');
  });

  it('caps the score to match the verdict', () => {
    const healthy = computeHealth({ connected: true, rssi: -50, gateway: computeStats(steady(3), 50), internet: computeStats(steady(15), 50), dnsMs: 20, dnsFailed: false });
    expect(alignWithVerdict(healthy, 'warn')).toMatchObject({ score: 79, level: 'fair' });
    expect(alignWithVerdict(healthy, 'bad').level).toBe('poor');
    expect(alignWithVerdict(healthy, 'ok').score).toBe(healthy.score);
  });

  it('is zero when disconnected', () => {
    expect(computeHealth({ connected: false, rssi: null, gateway: null, internet: null, dnsMs: null, dnsFailed: false }).score).toBe(0);
  });
});

describe('diagnosis', () => {
  const base: DiagnosisInput = {
    adapterPresent: true,
    connected: true,
    rssi: -55,
    gateway: computeStats(steady(3), 50),
    internet: computeStats(steady(15), 50),
    dnsMs: 20,
    dnsFailed: false,
  };
  const spiky = (baseMs: number, every: number, n = 120) =>
    computeStats(series(Array.from({ length: n }, (_, i) => (i % every === 7 ? baseMs + 250 : baseMs + (i % 3)))), 50);
  const randomSpiky = (baseMs: number) =>
    computeStats(series(Array.from({ length: 120 }, (_, i) => ([5, 9, 21, 26, 40, 61, 70, 93, 101].includes(i) ? baseMs + 300 : baseMs))), 50);

  it('reports ok for a clean line', () => {
    expect(diagnose(base).code).toBe('ok');
  });

  it('blames the provider when only internet spikes', () => {
    const d = diagnose({ ...base, internet: randomSpiky(15) });
    expect(d.code).toBe('isp_unstable');
    expect(d.location).toBe('isp');
  });

  it('blames Wi-Fi when the router already spikes, mentioning weak signal', () => {
    const d = diagnose({ ...base, rssi: -78, gateway: randomSpiky(3), internet: randomSpiky(15) });
    expect(d.code).toBe('local_weak_signal');
    expect(d.location).toBe('local');
    expect(diagnose({ ...base, gateway: randomSpiky(3) }).code).toBe('local_unstable');
  });

  it('detects periodic spikes', () => {
    const d = diagnose({ ...base, gateway: spiky(3, 30), internet: spiky(15, 30) });
    expect(d.code).toBe('periodic_spikes');
    expect(d.params.periodSec).toBe(30);
    expect(detectPeriodicSpikes([0, 10_000, 23_000, 29_000, 61_000])).toBeNull();
  });

  it('detects outages', () => {
    expect(diagnose({ ...base, internet: computeStats(series(Array(20).fill(null)), 50) }).code).toBe('internet_down');
    expect(diagnose({ ...base, gateway: computeStats(series(Array(20).fill(null)), 50) }).code).toBe('router_down');
    expect(diagnose({ ...base, connected: false }).code).toBe('disconnected');
  });

  it('waits for enough samples', () => {
    expect(diagnose({ ...base, gateway: computeStats(steady(3, 4), 50) }).code).toBe('collecting');
  });

  it('flags slow DNS', () => {
    expect(diagnose({ ...base, dnsMs: 250 }).code).toBe('dns_slow');
  });
});

describe('channels', () => {
  const net = (over: Partial<BssInfo>): BssInfo => ({
    ssid: 'N',
    hidden: false,
    bssid: Math.random().toString(),
    rssi: -60,
    linkQuality: 50,
    frequencyMhz: 2437,
    band: '2.4',
    channel: 6,
    centerChannel: 6,
    widthMhz: 20,
    standard: 'n',
    security: 'wpa2-personal',
    stationCount: null,
    channelUtilization: null,
    dfs: false,
    connected: false,
    lastSeen: 0,
    ...over,
  });

  it('computes spans', () => {
    expect(span({ band: '5', centerChannel: 42, widthMhz: 80 })).toEqual({ from: 34, to: 50 });
  });

  it('recommends the least crowded 2.4 GHz channel', () => {
    const rec = recommendChannel(
      [net({ channel: 1, centerChannel: 1, rssi: -45 }), net({ channel: 6, centerChannel: 6, rssi: -50 }), net({ channel: 11, centerChannel: 11, rssi: -85 })],
      '2.4',
      { ssid: 'Mine', widthMhz: 20, channel: 6 },
    );
    expect(rec?.best.channel).toBe(11);
    expect(rec?.current?.channel).toBe(6);
  });

  it('ignores own networks and prefers non-DFS on 5 GHz', () => {
    const rec = recommendChannel(
      [net({ ssid: 'Mine', band: '5', channel: 36, centerChannel: 42, widthMhz: 80, rssi: -40 })],
      '5',
      { ssid: 'Mine', widthMhz: 80, channel: 36 },
    );
    expect(rec?.best.channel).toBe(36);
    expect(rec?.best.dfs).toBe(false);
  });
});
