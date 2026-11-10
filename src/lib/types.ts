// Types mirrored from the Rust backend (src-tauri/src). Keep in sync with the
// `#[serde(rename_all = "camelCase")]` structs there.

export type ThemeSetting = 'dark' | 'light' | 'system';
export type Language = 'cs' | 'en';
export type Band = '2.4' | '5' | '6';

export interface Settings {
  pingIntervalMs: number;
  customTargets: string[];
  spikeThresholdMs: number;
  weakSignalDbm: number;
  language: Language;
  theme: ThemeSetting;
  runInTray: boolean;
  notifications: boolean;
  autoScanMinutes: number;
}

export interface WifiConnection {
  ssid: string;
  bssid: string;
  profile: string;
  standard: string;
  signalQuality: number;
  rssi: number | null;
  rxMbps: number;
  txMbps: number;
  channel: number | null;
  frequencyMhz: number | null;
  band: Band | null;
  channelWidthMhz: number | null;
  security: string;
  cipher: string;
}

export interface WifiStatus {
  ts: number;
  adapter: string | null;
  interfaceGuid: string | null;
  state: 'connected' | 'disconnected' | 'connecting' | 'no_adapter';
  locationDenied: boolean;
  connection: WifiConnection | null;
}

export interface BssInfo {
  ssid: string;
  hidden: boolean;
  bssid: string;
  rssi: number;
  linkQuality: number;
  frequencyMhz: number;
  band: Band;
  channel: number;
  centerChannel: number;
  widthMhz: number;
  standard: string;
  security: string;
  stationCount: number | null;
  channelUtilization: number | null;
  dfs: boolean;
  connected: boolean;
  lastSeen: number;
}

export interface NetworkList {
  networks: BssInfo[];
  lastScan: number | null;
  locationDenied: boolean;
}

export interface PingTarget {
  id: string;
  label: string;
  address: string | null;
}

export interface PingSample {
  target: string;
  ts: number;
  rtt: number | null;
  scan: boolean;
}

export interface PingHistory {
  targets: PingTarget[];
  samples: Record<string, PingSample[]>;
  intervalMs: number;
  dnsProbes: DnsProbe[];
}

export interface Ipv4Entry {
  address: string;
  prefix: number;
  mask: string;
}

export interface NetInfo {
  adapterId: string;
  name: string;
  description: string;
  isWifi: boolean;
  mac: string;
  ipv4: Ipv4Entry[];
  ipv6: string[];
  gateway: string | null;
  gatewayV6: string | null;
  dnsServers: string[];
  dhcpEnabled: boolean;
  dhcpServer: string | null;
  leaseObtained: number | null;
  leaseExpires: number | null;
  mtu: number;
  rxLinkBps: number;
  txLinkBps: number;
}

export interface PublicInfo {
  ip: string | null;
  isp: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  cloudflareColo: string | null;
  cloudflareLoc: string | null;
}

export interface Ipv6Check {
  hasGlobalAddress: boolean;
  reachable: boolean;
  latencyMs: number | null;
}

export interface MtuResult {
  mtu: number | null;
  target: string;
}

export interface DnsSample {
  domain: string;
  ms: number | null;
}

export interface DnsServerResult {
  id: 'system' | 'cloudflare' | 'google' | 'quad9';
  label: string;
  address: string;
  avgMs: number | null;
  minMs: number | null;
  worstMs: number | null;
  failures: number;
  samples: DnsSample[];
}

export interface DnsTestResult {
  ts: number;
  servers: DnsServerResult[];
}

export interface DnsProbe {
  ts: number;
  server: string | null;
  ms: number | null;
}

export interface Hop {
  ttl: number;
  address: string | null;
  hostname: string | null;
  rtts: (number | null)[];
  avgMs: number | null;
  lossPct: number;
  isDestination: boolean;
}

export interface TraceResult {
  target: string;
  resolved: string;
  reached: boolean;
  hops: Hop[];
}

export type SpeedPhase = 'latency' | 'download' | 'upload' | 'done';

export interface SpeedProgress {
  phase: SpeedPhase;
  progress: number;
  mbps: number | null;
  pingMs: number | null;
}

export interface SpeedResult {
  ts: number;
  downloadMbps: number;
  uploadMbps: number;
  idlePingMs: number | null;
  idleJitterMs: number | null;
  loadedPingDownMs: number | null;
  loadedPingUpMs: number | null;
  server: string | null;
  room: string | null;
  wifi: WifiConnection | null;
}

export type EventKind =
  | 'disconnected'
  | 'connected'
  | 'roam'
  | 'channel_change'
  | 'weak_signal'
  | 'packet_loss'
  | 'internet_down'
  | 'router_unreachable'
  | 'dns_failure';

export type Severity = 'ok' | 'info' | 'warn' | 'bad';

export interface NetEvent {
  id: number;
  ts: number;
  endTs: number | null;
  kind: EventKind;
  severity: Severity;
  data: Record<string, unknown>;
}

export interface StoredRecord<T> {
  id: number;
  ts: number;
  room: string | null;
  note: string | null;
  data: T;
}

export interface DriverInfo {
  description: string | null;
  provider: string | null;
  version: string | null;
  date: string | null;
}

export interface LocationStatus {
  system: string;
  user: string;
  desktopApps: string;
}

export interface SystemChecks {
  wifiPowerSavingAc: number | null;
  wifiPowerSavingDc: number | null;
  powerScheme: string | null;
  powerMode: string | null;
  onBattery: boolean | null;
  batteryPercent: number | null;
  driver: DriverInfo;
  location: LocationStatus;
  /** Which checks apply; absent in reports saved before Android support. */
  platform?: 'windows' | 'android' | 'other';
}

export type HistoryKind = 'events' | 'speedtests' | 'snapshots' | 'reports' | 'all';
