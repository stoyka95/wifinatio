// Typed wrappers around the Tauri commands in src-tauri/src/commands.rs.
import { invoke } from '@tauri-apps/api/core';
import type {
  DnsTestResult,
  HistoryKind,
  Ipv6Check,
  MtuResult,
  NetEvent,
  NetInfo,
  NetworkList,
  PingHistory,
  PublicInfo,
  Settings,
  SpeedResult,
  StoredRecord,
  SystemChecks,
  ThemeSetting,
  TraceResult,
  WifiStatus,
} from './types';

export const api = {
  getSettings: () => invoke<Settings>('get_settings'),
  saveSettings: (settings: Settings) => invoke<Settings>('save_settings', { settings }),
  setWindowTheme: (theme: ThemeSetting) => invoke<void>('set_window_theme', { theme }),
  getWifiStatus: () => invoke<WifiStatus>('get_wifi_status'),
  getPingHistory: () => invoke<PingHistory>('get_ping_history'),
  getNetworks: () => invoke<NetworkList>('get_networks'),
  scanNetworks: () => invoke<NetworkList>('scan_networks'),
  getNetInfo: () => invoke<NetInfo>('get_netinfo'),
  getPublicInfo: () => invoke<PublicInfo>('get_public_info'),
  checkIpv6: () => invoke<Ipv6Check>('check_ipv6'),
  testMtu: () => invoke<MtuResult>('test_mtu'),
  runDnsTest: () => invoke<DnsTestResult>('run_dns_test'),
  runTraceroute: (target: string) => invoke<TraceResult>('run_traceroute', { target }),
  runSpeedtest: (room: string | null) => invoke<SpeedResult>('run_speedtest', { room }),
  cancelSpeedtest: () => invoke<void>('cancel_speedtest'),
  listSpeedtests: (limit?: number) => invoke<StoredRecord<SpeedResult>[]>('list_speedtests', { limit }),
  listEvents: (since?: number, limit?: number) => invoke<NetEvent[]>('list_events', { since, limit }),
  saveSnapshot: <T>(room: string, note: string | null, data: T) =>
    invoke<number>('save_snapshot', { room, note, data }),
  listSnapshots: <T>() => invoke<StoredRecord<T>[]>('list_snapshots'),
  deleteSnapshot: (id: number) => invoke<void>('delete_snapshot', { id }),
  saveReport: <T>(data: T) => invoke<number>('save_report', { data }),
  listReports: <T>() => invoke<StoredRecord<T>[]>('list_reports'),
  clearHistory: (kind: HistoryKind) => invoke<void>('clear_history', { kind }),
  getSystemChecks: () => invoke<SystemChecks>('get_system_checks'),
  openSettingsPage: (uri: string) => invoke<void>('open_settings_page', { uri }),
  writeTextFile: (path: string, contents: string) => invoke<void>('write_text_file', { path, contents }),
  saveDownload: (name: string, contents: string) => invoke<string>('save_download', { name, contents }),
  requestClose: () => invoke<void>('request_close'),
};

/** Backend errors arrive as strings; known codes are mapped to messages in i18n. */
export const errorCode = (error: unknown): string =>
  typeof error === 'string' ? error : error instanceof Error ? error.message : String(error);

export const LOCATION_SETTINGS_URI = 'ms-settings:privacy-location';
