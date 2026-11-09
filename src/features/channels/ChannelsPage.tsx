import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Radar, ScanLine } from 'lucide-react';
import { LocationNotice } from '@/app/LocationNotice';
import { SpectrumChart } from '@/charts/SpectrumChart';
import { GlassCard } from '@/components/glass/GlassCard';
import { PageHeader } from '@/components/glass/PageHeader';
import { Banner, EmptyState, LevelDot, Skeleton } from '@/components/glass/status';
import { Button } from '@/components/ui/button';
import { Input, Segmented } from '@/components/ui/controls';
import { InfoTip, Tooltip } from '@/components/ui/tooltip';
import { useTicker } from '@/hooks/useLiveAnalysis';
import { api } from '@/lib/api';
import { recommendChannel } from '@/lib/channels';
import { cn } from '@/lib/cn';
import { bandLabel, fmtPercent, shortStandard } from '@/lib/format';
import { errorMessage, useT } from '@/lib/i18n';
import { rateRssi, rateUtilization } from '@/lib/rating';
import type { Band, BssInfo, NetworkList } from '@/lib/types';
import { useLiveStore } from '@/stores/live';

type SortKey = 'ssid' | 'channel' | 'rssi' | 'band' | 'load';
type BandFilter = Band | 'all';

const sorters: Record<SortKey, (a: BssInfo, b: BssInfo) => number> = {
  ssid: (a, b) => a.ssid.localeCompare(b.ssid),
  channel: (a, b) => a.frequencyMhz - b.frequencyMhz,
  rssi: (a, b) => a.rssi - b.rssi,
  band: (a, b) => a.band.localeCompare(b.band),
  load: (a, b) => (a.channelUtilization ?? -1) - (b.channelUtilization ?? -1),
};

const Recommendation = ({ networks, band }: { networks: BssInfo[]; band: Band }) => {
  const t = useT();
  const conn = useLiveStore((s) => s.wifi?.connection ?? null);
  const own = conn && conn.band === band ? conn : null;
  const rec = useMemo(
    () => recommendChannel(networks, band, { ssid: conn?.ssid ?? null, widthMhz: own?.channelWidthMhz ?? null, channel: own?.channel ?? null }),
    [networks, band, conn?.ssid, own?.channelWidthMhz, own?.channel],
  );
  if (!rec) return <p className="text-[13.5px] text-fg-muted">{t.channels.noRecommendation}</p>;
  const best = rec.best;
  const isCurrent = rec.current?.channel === best.channel;
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-3">
        <span className="accent-text num text-[44px] leading-none font-semibold tracking-[-0.04em]">{best.channel}</span>
        <span className="text-[13px] text-fg-muted">
          {bandLabel(band)}, {best.widthMhz} MHz{best.dfs ? ', DFS' : ''}
        </span>
      </div>
      <p className="text-[13.5px] text-fg">{t.channels.recommendBody(best.channel, best.widthMhz, best.neighbours, best.strongestRssi, best.dfs)}</p>
      {own && <p className="text-[13.5px] font-medium text-fg">{isCurrent ? t.channels.currentIsBest : t.channels.currentOn(own.channel ?? 0)}</p>}
      {!isCurrent && <p className="text-[12.5px] text-fg-muted">{t.channels.changeHint}</p>}
    </div>
  );
};

const SortHeader = ({ label, k, sort, onSort, className }: { label: string; k: SortKey; sort: { key: SortKey; desc: boolean }; onSort: (k: SortKey) => void; className?: string }) => (
  <th className={cn('px-3 py-3 font-medium', className)} aria-sort={sort.key === k ? (sort.desc ? 'descending' : 'ascending') : undefined}>
    <button type="button" onClick={() => onSort(k)} className="inline-flex items-center gap-1 hover:text-fg">
      {label}
      {sort.key === k && (sort.desc ? <ArrowDown className="size-3" aria-hidden /> : <ArrowUp className="size-3" aria-hidden />)}
    </button>
  </th>
);

export const ChannelsPage = () => {
  const t = useT();
  const [data, setData] = useState<NetworkList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [band, setBand] = useState<Band>('2.4');
  const [tableBand, setTableBand] = useState<BandFilter>('all');
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'rssi', desc: true });
  const conn = useLiveStore((s) => s.wifi?.connection ?? null);
  const now = useTicker(30_000);

  const load = useCallback(async (scan: boolean) => {
    setError(null);
    if (scan) setScanning(true);
    try {
      setData(scan ? await api.scanNetworks() : await api.getNetworks());
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setScanning(false);
    }
  }, [t]);

  useEffect(() => {
    load(false);
  }, [load]);

  useEffect(() => {
    if (conn?.band) setBand(conn.band === '6' ? '6' : conn.band);
  }, [conn?.band]);

  const networks = data?.networks ?? [];
  const bands = useMemo(() => {
    const present = new Set(networks.map((n) => n.band));
    return (['2.4', '5', '6'] as Band[]).filter((b) => b !== '6' || present.has('6'));
  }, [networks]);

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return networks
      .filter((n) => tableBand === 'all' || n.band === tableBand)
      .filter((n) => !q || n.ssid.toLowerCase().includes(q) || n.bssid.includes(q))
      .sort((a, b) => (sort.desc ? -1 : 1) * sorters[sort.key](a, b));
  }, [networks, tableBand, filter, sort]);

  const own24Missing = useMemo(() => {
    if (!conn || !data?.lastScan || networks.length === 0) return false;
    if (conn.band === '2.4') return !networks.some((n) => n.connected);
    // Dual-band routers often name the 5 GHz network "<name> 5G"; look for its 2.4 GHz sibling.
    const base = conn.ssid.replace(/[\s_-]*5\s?G(hz)?$/i, '').trim().toLowerCase();
    if (!base || base === conn.ssid.toLowerCase()) return false;
    return !networks.some((n) => n.band === '2.4' && n.ssid.toLowerCase().startsWith(base));
  }, [conn, data, networks]);

  const onSort = (key: SortKey) => setSort((s) => ({ key, desc: s.key === key ? !s.desc : true }));
  const lastScanMinutes = data?.lastScan ? Math.floor((now - data.lastScan) / 60_000) : null;

  return (
    <>
      <PageHeader
        title={t.channels.title}
        subtitle={t.channels.subtitle}
        actions={
          <>
            <span className="flex items-center gap-1.5 text-[12.5px] text-fg-muted">
              {lastScanMinutes !== null ? t.channels.lastScan(t.common.minutesAgo(lastScanMinutes)) : t.channels.cachedHint}
              <InfoTip content={t.explain.scanNote} />
            </span>
            <Button variant="primary" onClick={() => load(true)} loading={scanning}>
              {!scanning && <ScanLine aria-hidden />}
              {scanning ? t.channels.scanning : t.channels.scan}
            </Button>
          </>
        }
      />

      {data?.locationDenied && (
        <div className="mb-5">
          <LocationNotice startedAt={0} forceDenied />
        </div>
      )}
      {error && (
        <div className="mb-5">
          <Banner severity="bad" title={error} />
        </div>
      )}
      {own24Missing && (
        <div className="mb-5">
          <Banner severity="warn" title={t.channels.own24Missing} />
        </div>
      )}

      <div className="mb-5 grid grid-cols-12 gap-5">
        <GlassCard
          className="col-span-8"
          title={t.channels.spectrum}
          actions={<Segmented ariaLabel={t.metric.band} value={band} onChange={setBand} options={bands.map((b) => ({ value: b, label: bandLabel(b) }))} />}
        >
          {!data ? (
            <Skeleton className="h-[300px] w-full" />
          ) : networks.some((n) => n.band === band) ? (
            <SpectrumChart band={band} networks={networks} ownSsid={conn?.ssid ?? null} hiddenLabel={t.channels.hidden} />
          ) : (
            <EmptyState icon={<Radar />} title={t.channels.empty} className="h-[300px]" />
          )}
        </GlassCard>
        <GlassCard className="col-span-4" title={t.channels.recommendation} subtitle={bandLabel(band)}>
          {data ? <Recommendation networks={networks} band={band} /> : <Skeleton className="h-40" />}
        </GlassCard>
      </div>

      <GlassCard
        padded={false}
        className="overflow-hidden"
        title={`${t.channels.table} (${t.common.networks(rows.length)})`}
        actions={
          <>
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t.channels.filter} aria-label={t.channels.filter} className="h-8 w-60 text-[13px]" />
            <Segmented
              ariaLabel={t.metric.band}
              value={tableBand}
              onChange={setTableBand}
              options={[{ value: 'all' as BandFilter, label: t.channels.bandAll }, ...bands.map((b) => ({ value: b as BandFilter, label: bandLabel(b) }))]}
            />
          </>
        }
      >
        {!data ? (
          <div className="space-y-2 px-5 pb-5">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<Radar />} title={t.channels.empty} />
        ) : (
          <div className="max-h-[480px] overflow-auto">
            <table className="w-full min-w-[1040px] text-left text-[13px]">
              <thead className="sticky top-0 z-10 bg-[var(--glass-strong)] text-[12px] text-fg-muted backdrop-blur-xl">
                <tr className="border-b border-line">
                  <SortHeader label={t.channels.columns.ssid} k="ssid" sort={sort} onSort={onSort} className="pl-5" />
                  <th className="px-3 py-3 font-medium">{t.channels.columns.bssid}</th>
                  <SortHeader label={t.channels.columns.channel} k="channel" sort={sort} onSort={onSort} />
                  <SortHeader label={t.channels.columns.band} k="band" sort={sort} onSort={onSort} />
                  <SortHeader label={t.channels.columns.rssi} k="rssi" sort={sort} onSort={onSort} />
                  <th className="px-3 py-3 font-medium">{t.channels.columns.standard}</th>
                  <th className="px-3 py-3 font-medium">{t.channels.columns.security}</th>
                  <th className="px-3 py-3 font-medium">{t.channels.columns.clients}</th>
                  <SortHeader label={t.channels.columns.load} k="load" sort={sort} onSort={onSort} className="pr-5" />
                </tr>
              </thead>
              <tbody className="num whitespace-nowrap">
                {rows.map((n) => (
                  <tr key={n.bssid} className={cn('border-b border-line last:border-b-0', n.connected && 'bg-[color-mix(in_srgb,var(--cyan)_9%,transparent)]')}>
                    <td className="max-w-[200px] py-2.5 pr-3 pl-5">
                      <span className="flex items-center gap-2">
                        <span className={cn('truncate font-medium', n.hidden ? 'text-fg-faint italic' : 'text-fg')}>{n.hidden ? t.channels.hidden : n.ssid}</span>
                        {n.connected && <span className="accent-gradient shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium text-white">{t.channels.yourNetwork}</span>}
                      </span>
                    </td>
                    <td className="selectable px-3 py-2.5 text-fg-muted">{n.bssid}</td>
                    <td className="px-3 py-2.5 text-fg">
                      {n.channel}
                      <span className="ml-1 text-fg-faint">({n.widthMhz})</span>
                      {n.dfs && (
                        <Tooltip content={t.explain.dfs}>
                          <span tabIndex={0} className="ml-1.5 rounded-md bg-warn-soft px-1.5 py-0.5 text-[10.5px] font-semibold text-warn">
                            DFS
                          </span>
                        </Tooltip>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-fg-muted">{bandLabel(n.band)}</td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-1.5 text-fg">
                        <LevelDot level={rateRssi(n.rssi)} className="size-1.5" />
                        {n.rssi} dBm
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-fg-muted">{shortStandard(n.standard)}</td>
                    <td className="px-3 py-2.5 text-fg-muted">{t.security[n.security] ?? n.security}</td>
                    <td className="px-3 py-2.5 text-fg-muted">{n.stationCount ?? '—'}</td>
                    <td className="py-2.5 pr-5 pl-3 text-fg-muted">
                      {n.channelUtilization !== null ? (
                        <Tooltip content={t.explain.utilization}>
                          <span tabIndex={0} className="inline-flex items-center gap-1.5">
                            <LevelDot level={rateUtilization(n.channelUtilization)} className="size-1.5" />
                            {fmtPercent(n.channelUtilization * 100, 0)}
                          </span>
                        </Tooltip>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>
    </>
  );
};
