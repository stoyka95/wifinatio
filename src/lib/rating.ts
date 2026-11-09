// Single source of truth for "is this value good?". Every colour, badge and
// tooltip in the UI and every rule in the diagnosis uses these thresholds.

export type Level = 'good' | 'fair' | 'poor';

const byThresholds = (value: number, good: number, fair: number, higherIsBetter = false): Level => {
  if (higherIsBetter) return value >= good ? 'good' : value >= fair ? 'fair' : 'poor';
  return value <= good ? 'good' : value <= fair ? 'fair' : 'poor';
};

export const THRESHOLDS = {
  rssi: { good: -60, fair: -70 },
  rssi5GhzRecommended: -65,
  gatewayLatency: { good: 5, fair: 20 },
  internetLatency: { good: 30, fair: 80 },
  gatewayJitter: { good: 5, fair: 15 },
  internetJitter: { good: 10, fair: 30 },
  loss: { good: 0.5, fair: 2 },
  dns: { good: 40, fair: 100 },
  download: { good: 100, fair: 25 },
  upload: { good: 20, fair: 5 },
  linkRate: { good: 300, fair: 100 },
  utilization: { good: 0.4, fair: 0.7 },
} as const;

export const rateRssi = (dbm: number): Level => byThresholds(dbm, THRESHOLDS.rssi.good, THRESHOLDS.rssi.fair, true);
export const rateGatewayLatency = (ms: number): Level =>
  byThresholds(ms, THRESHOLDS.gatewayLatency.good, THRESHOLDS.gatewayLatency.fair);
export const rateInternetLatency = (ms: number): Level =>
  byThresholds(ms, THRESHOLDS.internetLatency.good, THRESHOLDS.internetLatency.fair);
export const rateGatewayJitter = (ms: number): Level =>
  byThresholds(ms, THRESHOLDS.gatewayJitter.good, THRESHOLDS.gatewayJitter.fair);
export const rateInternetJitter = (ms: number): Level =>
  byThresholds(ms, THRESHOLDS.internetJitter.good, THRESHOLDS.internetJitter.fair);
export const rateLoss = (pct: number): Level => byThresholds(pct, THRESHOLDS.loss.good, THRESHOLDS.loss.fair);
export const rateDns = (ms: number): Level => byThresholds(ms, THRESHOLDS.dns.good, THRESHOLDS.dns.fair);
export const rateDownload = (mbps: number): Level =>
  byThresholds(mbps, THRESHOLDS.download.good, THRESHOLDS.download.fair, true);
export const rateUpload = (mbps: number): Level =>
  byThresholds(mbps, THRESHOLDS.upload.good, THRESHOLDS.upload.fair, true);
export const rateLinkRate = (mbps: number): Level =>
  byThresholds(mbps, THRESHOLDS.linkRate.good, THRESHOLDS.linkRate.fair, true);
export const rateUtilization = (fraction: number): Level =>
  byThresholds(fraction, THRESHOLDS.utilization.good, THRESHOLDS.utilization.fair);

/** RSSI in dBm to an approximate 0–100 % scale (-100 dBm = 0 %, -50 dBm = 100 %). */
export const rssiToPercent = (dbm: number): number => Math.round(Math.min(100, Math.max(0, 2 * (dbm + 100))));

export type BufferbloatGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

/** Grade by how much latency grows under load (same scale as common bufferbloat tests). */
export const bufferbloatGrade = (idleMs: number | null, loadedMs: number | null): BufferbloatGrade | null => {
  if (idleMs === null || loadedMs === null) return null;
  const increase = Math.max(0, loadedMs - idleMs);
  if (increase < 5) return 'A+';
  if (increase < 30) return 'A';
  if (increase < 60) return 'B';
  if (increase < 200) return 'C';
  if (increase < 400) return 'D';
  return 'F';
};

export const gradeLevel = (grade: BufferbloatGrade): Level =>
  grade === 'A+' || grade === 'A' ? 'good' : grade === 'B' || grade === 'C' ? 'fair' : 'poor';

export const worstLevel = (levels: Level[]): Level =>
  levels.includes('poor') ? 'poor' : levels.includes('fair') ? 'fair' : 'good';
