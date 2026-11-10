// Builds the human-readable diagnostic report from collected measurements.
import { recommendChannel, span } from './channels';
import { routerIgnoresPing, type Diagnosis } from './diagnosis';
import { bandLabel, fmtDateTime, fmtMbps, fmtMs, fmtPercent } from './format';
import type { Health } from './health';
import type { Dict } from './i18n/cs';
import { bufferbloatGrade, gradeLevel, rateDns, rateGatewayJitter, rateGatewayLatency, rateInternetJitter, rateInternetLatency, rateLoss, rateRssi, worstLevel, type Level } from './rating';
import type { PingStats } from './stats';
import type { BssInfo, DnsTestResult, SpeedResult, SystemChecks, WifiStatus } from './types';

export type FindingStatus = 'ok' | 'warn' | 'bad' | 'info';
export type ReportSection = keyof Dict['report']['sections'];

export interface Finding {
  section: ReportSection;
  status: FindingStatus;
  text: string;
}

export interface Action {
  id: string;
  text: string;
  command?: string;
  admin?: boolean;
}

export interface DiagnosticReport {
  version: 1;
  ts: number;
  language: string;
  health: { score: number; level: Level };
  verdict: { code: Diagnosis['code']; severity: Diagnosis['severity']; location: Diagnosis['location']; text: string; where: string };
  findings: Finding[];
  actions: Action[];
  data: ReportInput;
}

export interface ReportInput {
  wifi: WifiStatus | null;
  gateway: PingStats | null;
  internet: PingStats | null;
  diagnosis: Diagnosis;
  health: Health;
  dns: DnsTestResult | null;
  networks: BssInfo[] | null;
  speed: SpeedResult | null;
  system: SystemChecks | null;
}

const levelStatus = (level: Level): FindingStatus => (level === 'good' ? 'ok' : level === 'fair' ? 'warn' : 'bad');
const TWO_YEARS_MS = 2 * 365 * 24 * 3600 * 1000;

/** Driver dates in the registry are "M-D-YYYY". */
export const parseDriverDate = (value: string | null): number | null => {
  if (!value) return null;
  const [m, d, y] = value.split(/[-/.]/).map(Number);
  if (!m || !d || !y) return null;
  return Date.UTC(y, m - 1, d);
};

export const buildReport = (input: ReportInput, t: Dict, now = Date.now()): DiagnosticReport => {
  const findings: Finding[] = [];
  const actions = new Map<string, Action>();
  const addAction = (action: Action) => actions.set(action.id, action);
  const f = t.report.f;
  const a = t.report.actions;
  const conn = input.wifi?.connection ?? null;

  // Connection
  if (!conn) {
    findings.push({ section: 'connection', status: 'bad', text: f.notConnected });
  } else {
    const rssiLevel = conn.rssi !== null ? rateRssi(conn.rssi) : 'fair';
    findings.push({
      section: 'connection',
      status: levelStatus(rssiLevel),
      text: `${f.connected(conn.ssid, bandLabel(conn.band).replace(' GHz', ''), conn.channel, conn.rssi)} ${
        rssiLevel === 'good' ? f.signalGood : rssiLevel === 'fair' ? f.signalFair : f.signalPoor
      }`,
    });
    if (rssiLevel === 'poor') {
      addAction({ id: 'moveCloser', text: a.moveCloser });
      if (conn.band === '2.4') addAction({ id: 'use5ghz', text: a.use5ghz });
    }
  }

  // Stability
  const { gateway, internet } = input;
  if (gateway?.count && routerIgnoresPing(gateway, internet ?? null)) {
    findings.push({ section: 'stability', status: 'info', text: f.gatewaySilent });
  } else if (gateway?.count) {
    const level = worstLevel([
      gateway.avg !== null ? rateGatewayLatency(gateway.avg) : 'poor',
      gateway.jitter !== null ? rateGatewayJitter(gateway.jitter) : 'good',
      rateLoss(gateway.lossPct),
    ]);
    findings.push({ section: 'stability', status: levelStatus(level), text: f.gateway(fmtMs(gateway.avg), fmtMs(gateway.jitter), fmtPercent(gateway.lossPct)) });
  }
  if (internet?.count) {
    const level = worstLevel([
      internet.avg !== null ? rateInternetLatency(internet.avg) : 'poor',
      internet.jitter !== null ? rateInternetJitter(internet.jitter) : 'good',
      rateLoss(internet.lossPct),
    ]);
    findings.push({ section: 'stability', status: levelStatus(level), text: f.internet(fmtMs(internet.avg), fmtMs(internet.jitter), fmtPercent(internet.lossPct)) });
  }

  // DNS
  const sys = input.dns?.servers.find((s) => s.id === 'system');
  if (sys?.avgMs != null) {
    const others = input.dns!.servers.filter((s) => s.id !== 'system' && s.avgMs !== null && s.failures < 3);
    const best = others.sort((x, y) => (x.avgMs ?? 1e9) - (y.avgMs ?? 1e9))[0];
    const muchFaster = best && best.avgMs! < sys.avgMs * 0.6 && sys.avgMs - best.avgMs! > 20;
    const level = rateDns(sys.avgMs);
    findings.push({
      section: 'dns',
      status: muchFaster ? 'warn' : levelStatus(level),
      text: `${f.dnsSystem(fmtMs(sys.avgMs))}${muchFaster ? ` ${f.dnsBetter(t.dnsTrace.servers[best.id], fmtMs(best.avgMs))}` : ''}`,
    });
    if (muchFaster) addAction({ id: 'changeDns', text: a.changeDns(t.dnsTrace.servers[best.id], best.address) });
  }

  // Channels
  if (conn && input.networks?.length && conn.band && conn.channel !== null) {
    const own = input.networks.find((n) => n.connected);
    const ownSpan = own ? span(own) : null;
    const neighbours = ownSpan
      ? input.networks.filter((n) => !n.connected && n.band === conn.band && n.ssid !== conn.ssid && span(n).to > ownSpan.from && span(n).from < ownSpan.to)
      : [];
    const rec = recommendChannel(input.networks, conn.band, { ssid: conn.ssid, widthMhz: conn.channelWidthMhz, channel: conn.channel });
    const better = rec && rec.current && rec.best.channel !== rec.current.channel && rec.best.score < rec.current.score * 0.5;
    findings.push({
      section: 'channels',
      status: better ? 'warn' : neighbours.length > 4 ? 'warn' : 'ok',
      text: `${f.channel(conn.channel, neighbours.length)}${better ? ` ${f.channelBetter(rec.best.channel)}` : ''}`,
    });
    if (better && rec) addAction({ id: 'changeChannel', text: a.changeChannel(rec.best.channel) });
    if (neighbours.length > 4 && (conn.channelWidthMhz ?? 0) >= 80) addAction({ id: 'narrowWidth', text: a.narrowWidth });
  }

  // Speed
  if (input.speed) {
    const s = input.speed;
    const grade = bufferbloatGrade(s.idlePingMs, Math.max(s.loadedPingDownMs ?? 0, s.loadedPingUpMs ?? 0) || null);
    const level = grade ? gradeLevel(grade) : 'good';
    findings.push({ section: 'speed', status: levelStatus(level), text: f.speed(fmtMbps(s.downloadMbps), fmtMbps(s.uploadMbps), grade ?? '—') });
    if (grade && level !== 'good') addAction({ id: 'fixBufferbloat', text: a.fixBufferbloat });
  }

  // Windows (or the phone on Android, where shell commands and adapter power saving do not exist)
  const sysChecks = input.system;
  const android = sysChecks?.platform === 'android';
  const powerSaving = sysChecks ? (sysChecks.onBattery ? sysChecks.wifiPowerSavingDc : sysChecks.wifiPowerSavingAc) : null;
  // Suggest turning power saving off only when it is on or could not be read.
  const suggestPowerSaving = () => {
    if (!android && powerSaving !== 0) addAction({ id: 'disablePowerSaving', text: a.disablePowerSaving, command: a.powerSavingCommand });
  };
  if (sysChecks) {
    const saving = powerSaving;
    if (saving !== null && saving > 0) {
      findings.push({ section: 'system', status: 'warn', text: `${f.powerSaving} (${t.report.powerSavingLevels[saving] ?? saving})` });
      addAction({ id: 'disablePowerSaving', text: a.disablePowerSaving, command: a.powerSavingCommand });
    } else if (saving === 0) {
      findings.push({ section: 'system', status: 'ok', text: f.powerSavingOff });
    }
    if (sysChecks.powerMode) {
      findings.push({
        section: 'system',
        status: sysChecks.powerMode === 'best_efficiency' ? 'warn' : 'info',
        text: f.powerMode(t.report.powerModes[sysChecks.powerMode] ?? sysChecks.powerMode),
      });
    }
    if (sysChecks.onBattery) {
      findings.push({ section: 'system', status: 'info', text: f.onBattery });
      if (sysChecks.powerMode === 'best_efficiency') addAction({ id: 'plugIn', text: a.plugIn });
    }
    const driver = sysChecks.driver;
    if (driver.version) {
      const date = parseDriverDate(driver.date);
      const old = date !== null && now - date > TWO_YEARS_MS;
      findings.push({ section: 'system', status: old ? 'warn' : 'ok', text: `${f.driver(driver.provider ?? '', driver.version, driver.date ?? '?')}${old ? ` ${f.driverOld}` : ''}` });
      if (old) addAction({ id: 'updateDriver', text: a.updateDriver });
    }
  }

  // Actions from the overall verdict
  switch (input.diagnosis.code) {
    case 'local_weak_signal':
    case 'weak_signal':
      addAction({ id: 'moveCloser', text: a.moveCloser });
      if (conn?.band === '2.4') addAction({ id: 'use5ghz', text: a.use5ghz });
      break;
    case 'local_unstable':
      suggestPowerSaving();
      if (conn?.band === '2.4') addAction({ id: 'use5ghz', text: a.use5ghz });
      addAction({ id: 'interference', text: a.interference });
      break;
    case 'periodic_spikes':
      addAction({ id: 'disableBackgroundScan', text: a.disableBackgroundScan });
      suggestPowerSaving();
      break;
    case 'isp_unstable':
      addAction({ id: 'restartRouter', text: a.restartRouter });
      addAction({ id: 'contactIsp', text: a.contactIsp });
      break;
    case 'internet_down':
      addAction({ id: 'restartRouter', text: a.restartRouter });
      addAction({ id: 'contactIsp', text: a.contactIsp });
      break;
    case 'router_down':
      addAction({ id: 'checkRouter', text: a.checkRouter });
      if (!android) addAction({ id: 'resetNetwork', text: a.resetNetwork, command: a.resetNetworkCommand, admin: true });
      break;
    case 'dns_failing':
    case 'dns_slow':
      addAction({ id: 'flushDns', text: a.flushDns, command: android ? undefined : a.flushDnsCommand });
      break;
    default:
      break;
  }
  if (actions.size === 0) addAction({ id: 'allGood', text: a.allGood });

  const d = input.diagnosis;
  return {
    version: 1,
    ts: now,
    language: t.locale,
    health: { score: input.health.score, level: input.health.level },
    verdict: { code: d.code, severity: d.severity, location: d.location, text: t.diagnosis[d.code](d.params), where: t.diagnosis.whereLabel[d.location] },
    findings,
    actions: [...actions.values()],
    data: input,
  };
};

const statusMark: Record<FindingStatus, string> = { ok: '✅', warn: '⚠️', bad: '❌', info: 'ℹ️' };

export const reportToMarkdown = (report: DiagnosticReport, t: Dict): string => {
  const lines: string[] = [];
  lines.push(`# Wifinatio – ${t.wizard.reportTitle}`, '', `_${t.report.generated(fmtDateTime(report.ts))}_`, '');
  lines.push(`**${t.health.title}:** ${report.health.score}/100 (${t.health.levelText[report.health.level]})`, '');
  lines.push(`## ${t.wizard.verdict}`, '', `${report.verdict.text}`, '', `**${report.verdict.where}**`, '');
  lines.push(`## ${t.wizard.findings}`, '');
  for (const section of Object.keys(t.report.sections) as ReportSection[]) {
    const items = report.findings.filter((x) => x.section === section);
    if (!items.length) continue;
    lines.push(`### ${t.report.sections[section]}`, '');
    for (const item of items) lines.push(`- ${statusMark[item.status]} ${item.text}`);
    lines.push('');
  }
  lines.push(`## ${t.wizard.steps2}`, '');
  report.actions.forEach((action, i) => {
    lines.push(`${i + 1}. ${action.text}${action.admin ? ` _(${t.common.adminRequired})_` : ''}`);
    if (action.command) lines.push('', '   ```', `   ${action.command}`, '   ```');
  });
  lines.push('');
  return lines.join('\n');
};
