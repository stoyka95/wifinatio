import { describe, expect, it } from 'vitest';
import { diagnose } from './diagnosis';
import { computeHealth } from './health';
import { cs } from './i18n/cs';
import { en } from './i18n/en';
import { buildReport, parseDriverDate, reportToMarkdown, type ReportInput } from './report';
import { computeStats } from './stats';
import type { PingSample, SystemChecks, WifiStatus } from './types';

const samples = (ms: number, n = 60): PingSample[] => Array.from({ length: n }, (_, i) => ({ target: 't', ts: i * 1000, rtt: ms, scan: false }));

const wifi = (rssi: number): WifiStatus => ({
  ts: 0,
  adapter: 'Test adapter',
  interfaceGuid: 'X',
  state: 'connected',
  locationDenied: false,
  connection: {
    ssid: 'Home',
    bssid: 'aa:bb:cc:dd:ee:ff',
    profile: 'Home',
    standard: 'ax',
    signalQuality: 70,
    rssi,
    rxMbps: 600,
    txMbps: 600,
    channel: 36,
    frequencyMhz: 5180,
    band: '5',
    channelWidthMhz: 80,
    security: 'wpa2-personal',
    cipher: 'aes-ccmp',
  },
});

const system = (saving: number): SystemChecks => ({
  wifiPowerSavingAc: saving,
  wifiPowerSavingDc: saving,
  powerScheme: 'balanced',
  powerMode: 'balanced',
  onBattery: false,
  batteryPercent: 80,
  driver: { description: 'X', provider: 'Vendor', version: '1.0', date: '1-8-2020' },
  location: { system: 'allow', user: 'allow', desktopApps: 'allow' },
});

const input = (rssi: number, saving: number): ReportInput => {
  const gateway = computeStats(samples(3), 50);
  const internet = computeStats(samples(15), 50);
  const base = { adapterPresent: true, connected: true, rssi, gateway, internet, dnsMs: 20, dnsFailed: false };
  return {
    wifi: wifi(rssi),
    gateway,
    internet,
    diagnosis: diagnose(base),
    health: computeHealth(base),
    dns: {
      ts: 0,
      servers: [
        { id: 'system', label: 'system', address: '192.168.1.1', avgMs: 120, minMs: 90, worstMs: 300, failures: 0, samples: [] },
        { id: 'cloudflare', label: 'Cloudflare', address: '1.1.1.1', avgMs: 12, minMs: 8, worstMs: 20, failures: 0, samples: [] },
      ],
    },
    networks: null,
    speed: null,
    system: system(saving),
  };
};

describe('report', () => {
  it('parses registry driver dates', () => {
    expect(parseDriverDate('1-8-2026')).toBe(Date.UTC(2026, 0, 8));
    expect(parseDriverDate(null)).toBeNull();
    expect(parseDriverDate('garbage')).toBeNull();
  });

  it('flags weak signal, power saving, slow DNS and old driver with actions', () => {
    const report = buildReport(input(-80, 2), cs, Date.UTC(2026, 10, 9));
    const ids = report.actions.map((a) => a.id);
    expect(report.verdict.code).toBe('weak_signal');
    expect(ids).toEqual(expect.arrayContaining(['moveCloser', 'disablePowerSaving', 'changeDns', 'updateDriver']));
    expect(report.actions.find((a) => a.id === 'disablePowerSaving')?.command).toContain('powercfg');
    expect(report.findings.some((f) => f.section === 'dns' && f.status === 'warn')).toBe(true);
  });

  it('does not suggest disabling power saving that is already off', () => {
    const base = input(-55, 0);
    const jittery = computeStats(samples(3).map((s, i) => ({ ...s, rtt: [9, 21, 26, 40, 61, 70].includes(i) ? 300 : 3 })), 50);
    const diag = diagnose({ adapterPresent: true, connected: true, rssi: -55, gateway: jittery, internet: base.internet, dnsMs: 20, dnsFailed: false });
    expect(diag.code).toBe('local_unstable');
    const ids = buildReport({ ...base, gateway: jittery, diagnosis: diag }, cs).actions.map((a) => a.id);
    expect(ids).not.toContain('disablePowerSaving');
    expect(ids).toContain('interference');
  });

  it('suggests nothing for a healthy setup', () => {
    const healthy = input(-50, 0);
    healthy.dns = null;
    healthy.system = { ...system(0), driver: { description: null, provider: null, version: null, date: null } };
    const report = buildReport(healthy, en);
    expect(report.verdict.code).toBe('ok');
    expect(report.actions.map((a) => a.id)).toEqual(['allGood']);
  });

  it('renders markdown with sections and commands', () => {
    const md = reportToMarkdown(buildReport(input(-80, 2), cs, Date.UTC(2026, 10, 9)), cs);
    expect(md).toContain('# Wifinatio – Zpráva o připojení');
    expect(md).toContain('### Připojení');
    expect(md).toContain('powercfg /setacvalueindex');
  });
});
