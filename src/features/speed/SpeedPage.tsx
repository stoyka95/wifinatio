import { useCallback, useEffect, useMemo, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Gauge, Play, Square } from 'lucide-react';
import { BarCompare } from '@/charts/BarCompare';
import { GlassCard } from '@/components/glass/GlassCard';
import { PageHeader } from '@/components/glass/PageHeader';
import { StatTile } from '@/components/glass/StatTile';
import { Banner, EmptyState, LevelBadge } from '@/components/glass/status';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/controls';
import { InfoTip } from '@/components/ui/tooltip';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtDateTime, fmtMbps, fmtMs, fmtNumber } from '@/lib/format';
import { errorMessage, useT } from '@/lib/i18n';
import { bufferbloatGrade, gradeLevel, rateDownload, rateInternetLatency, rateUpload } from '@/lib/rating';
import type { SpeedPhase, SpeedProgress, SpeedResult, StoredRecord } from '@/lib/types';
import { SpeedDial } from './SpeedDial';

const PHASES: SpeedPhase[] = ['latency', 'download', 'upload'];

export const loadedPing = (r: SpeedResult) => {
  const values = [r.loadedPingDownMs, r.loadedPingUpMs].filter((v): v is number => v !== null);
  return values.length ? Math.max(...values) : null;
};

export const ResultTiles = ({ result }: { result: SpeedResult }) => {
  const t = useT();
  const loaded = loadedPing(result);
  const grade = bufferbloatGrade(result.idlePingMs, loaded);
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
      <StatTile label={t.speed.download} value={fmtNumber(result.downloadMbps, result.downloadMbps < 10 ? 1 : 0)} unit="Mb/s" level={rateDownload(result.downloadMbps)} size="lg" />
      <StatTile label={t.speed.upload} value={fmtNumber(result.uploadMbps, result.uploadMbps < 10 ? 1 : 0)} unit="Mb/s" level={rateUpload(result.uploadMbps)} size="lg" />
      <StatTile label={t.speed.idlePing} value={fmtMs(result.idlePingMs).replace(' ms', '')} unit="ms" level={result.idlePingMs !== null ? rateInternetLatency(result.idlePingMs) : null} size="lg" />
      <StatTile label={t.speed.loadedPing} value={fmtMs(loaded).replace(' ms', '')} unit="ms" level={loaded !== null ? rateInternetLatency(loaded) : null} size="lg" />
      <div>
        <div className="flex items-center gap-1.5 text-[12.5px] text-fg-muted">
          {t.speed.bufferbloat} <InfoTip content={t.speed.bufferbloatHelp} />
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className="num text-[30px] font-semibold tracking-[-0.02em] text-fg">{grade ?? '—'}</span>
          {grade && <LevelBadge level={gradeLevel(grade)} />}
        </div>
      </div>
    </div>
  );
};

export const SpeedPage = () => {
  const t = useT();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<SpeedProgress | null>(null);
  const [result, setResult] = useState<SpeedResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [room, setRoom] = useState('');
  const [history, setHistory] = useState<StoredRecord<SpeedResult>[]>([]);

  const loadHistory = useCallback(() => {
    api.listSpeedtests(50).then(setHistory).catch(() => setHistory([]));
  }, []);

  useEffect(() => {
    loadHistory();
    const unlisten = listen<SpeedProgress>('speed-progress', (e) => setProgress(e.payload));
    return () => {
      unlisten.then((u) => u()).catch(() => undefined);
    };
  }, [loadHistory]);

  const start = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    setProgress({ phase: 'latency', progress: 0, mbps: null, pingMs: null });
    try {
      setResult(await api.runSpeedtest(room.trim() || null));
      loadHistory();
    } catch (e) {
      const msg = errorMessage(t, e);
      setError(msg === t.errors.cancelled ? null : msg === t.errors.generic ? t.speed.failed : msg);
    } finally {
      setRunning(false);
    }
  };

  const phase = progress?.phase ?? 'latency';
  const lastDownload = result?.downloadMbps ?? history[0]?.data.downloadMbps ?? null;
  const dialValue = running ? (phase === 'download' || phase === 'upload' ? progress?.mbps ?? null : null) : lastDownload;
  const dialLabel = running ? t.speed.phases[phase] : lastDownload !== null ? t.speed.lastDownload : t.speed.ready;
  const overall = running && progress ? (PHASES.indexOf(phase as SpeedPhase) + progress.progress) / PHASES.length : result ? 1 : 0;

  const chart = useMemo(() => {
    const items = [...history].reverse().slice(-12);
    return {
      categories: items.map((h) => (h.room ? `${h.room}` : fmtDateTime(h.ts).split(' ').slice(-1)[0])),
      values: items.map((h) => Math.round(h.data.downloadMbps)),
    };
  }, [history]);

  return (
    <>
      <PageHeader title={t.speed.title} subtitle={t.speed.subtitle} />
      <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-12">
        <GlassCard className="flex flex-col items-center justify-between gap-4 py-7 lg:col-span-5">
          <SpeedDial mbps={dialValue} label={dialLabel} progress={overall} />
          <ol className="flex flex-wrap justify-center gap-2" aria-label={t.speed.title}>
            {PHASES.map((p, i) => {
              const done = (running && PHASES.indexOf(phase as SpeedPhase) > i) || (!running && !!result);
              const active = running && phase === p;
              return (
                <li
                  key={p}
                  className={cn(
                    'rounded-full px-3 py-1 text-[12px] font-medium transition-colors',
                    active ? 'accent-gradient text-white' : done ? 'glass-strong text-fg' : 'text-fg-faint',
                  )}
                >
                  {t.speed.phases[p]}
                </li>
              );
            })}
          </ol>
          <div className="flex w-full max-w-sm items-center gap-2">
            <Input value={room} onChange={(e) => setRoom(e.target.value)} placeholder={t.speed.room} aria-label={t.speed.room} disabled={running} className="flex-1" />
            {running ? (
              <Button onClick={() => api.cancelSpeedtest()}>
                <Square aria-hidden />
                {t.common.stop}
              </Button>
            ) : (
              <Button variant="primary" onClick={start}>
                <Play aria-hidden />
                {t.speed.start}
              </Button>
            )}
          </div>
          <p className="text-[12px] text-fg-faint">{t.speed.dataNote}</p>
        </GlassCard>

        <div className="flex flex-col gap-5 lg:col-span-7">
          {error && <Banner severity="bad" title={error} />}
          <GlassCard title={result ? t.speed.phases.done : t.speed.historyChart} className="flex-1">
            {result ? (
              <div className="space-y-5">
                <ResultTiles result={result} />
                {result.server && (
                  <p className="text-[12.5px] text-fg-muted">
                    {t.speed.server}: Cloudflare {result.server}
                  </p>
                )}
              </div>
            ) : history.length ? (
              <BarCompare categories={chart.categories} values={chart.values} unit="Mb/s" height={230} />
            ) : (
              <EmptyState icon={<Gauge />} title={t.speed.noHistory} />
            )}
          </GlassCard>
        </div>
      </div>

      {history.length > 0 && (
        <GlassCard padded={false} title={t.speed.history} className="overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px] whitespace-nowrap">
            <thead className="text-[12px] text-fg-muted">
              <tr className="border-b border-line">
                <th className="py-3 pr-3 pl-5 font-medium">{t.common.time}</th>
                <th className="px-3 py-3 font-medium">{t.rooms.room}</th>
                <th className="px-3 py-3 font-medium">{t.speed.download}</th>
                <th className="px-3 py-3 font-medium">{t.speed.upload}</th>
                <th className="px-3 py-3 font-medium">{t.speed.idlePing}</th>
                <th className="px-3 py-3 font-medium">{t.speed.loadedPing}</th>
                <th className="px-3 py-3 font-medium">{t.speed.bufferbloat}</th>
                <th className="py-3 pr-5 pl-3 font-medium">{t.metric.rssi}</th>
              </tr>
            </thead>
            <tbody className="num">
              {history.map((h) => {
                const r = h.data;
                const grade = bufferbloatGrade(r.idlePingMs, loadedPing(r));
                return (
                  <tr key={h.id} className="border-b border-line last:border-b-0">
                    <td className="py-2.5 pr-3 pl-5 text-fg-muted">{fmtDateTime(h.ts)}</td>
                    <td className="px-3 py-2.5 text-fg">{h.room ?? '—'}</td>
                    <td className="px-3 py-2.5 font-medium text-fg">{fmtMbps(r.downloadMbps)}</td>
                    <td className="px-3 py-2.5 text-fg">{fmtMbps(r.uploadMbps)}</td>
                    <td className="px-3 py-2.5 text-fg-muted">{fmtMs(r.idlePingMs)}</td>
                    <td className="px-3 py-2.5 text-fg-muted">{fmtMs(loadedPing(r))}</td>
                    <td className="px-3 py-2.5">{grade ? <LevelBadge level={gradeLevel(grade)}>{grade}</LevelBadge> : '—'}</td>
                    <td className="py-2.5 pr-5 pl-3 text-fg-muted">{r.wifi?.rssi != null ? `${r.wifi.rssi} dBm` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </GlassCard>
      )}
    </>
  );
};
