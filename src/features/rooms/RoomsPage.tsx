import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowDownRight, ArrowUpRight, House, Save, Trash2 } from 'lucide-react';
import { BarCompare } from '@/charts/BarCompare';
import { GlassCard } from '@/components/glass/GlassCard';
import { PageHeader } from '@/components/glass/PageHeader';
import { StatTile } from '@/components/glass/StatTile';
import { Banner, EmptyState, LevelBadge } from '@/components/glass/status';
import { Button } from '@/components/ui/button';
import { Field, Input, Segmented, Select, Switch } from '@/components/ui/controls';
import { GATEWAY, INTERNET_TARGETS } from '@/hooks/useLiveAnalysis';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { confirmAction } from '@/lib/dialog';
import { bandLabel, fmtDateTime, fmtMbps, fmtMs, fmtNumber, fmtPercent } from '@/lib/format';
import { errorMessage, useT } from '@/lib/i18n';
import { rateDownload, rateGatewayLatency, rateInternetLatency, rateRssi } from '@/lib/rating';
import { computeStats, mergeInternet, type PingStats } from '@/lib/stats';
import type { SpeedResult, StoredRecord } from '@/lib/types';
import { useLiveStore } from '@/stores/live';
import { useSettingsStore } from '@/stores/settings';

const MEASURE_SECONDS = 30;

type StatsSummary = Pick<PingStats, 'avg' | 'jitter' | 'lossPct' | 'p95' | 'spikes'>;

export interface RoomSnapshot {
  ssid: string | null;
  bssid: string | null;
  band: string | null;
  channel: number | null;
  widthMhz: number | null;
  rssi: number | null;
  rxMbps: number | null;
  txMbps: number | null;
  gateway: StatsSummary | null;
  internet: StatsSummary | null;
  speed: SpeedResult | null;
}

type Metric = 'rssi' | 'gateway' | 'internet' | 'download';

const summary = (s: PingStats | null): StatsSummary | null =>
  s && s.count ? { avg: s.avg, jitter: s.jitter, lossPct: s.lossPct, p95: s.p95, spikes: s.spikes } : null;

const metricValue = (snap: RoomSnapshot, metric: Metric): number | null => {
  switch (metric) {
    case 'rssi':
      return snap.rssi;
    case 'gateway':
      return snap.gateway?.avg != null ? Math.round(snap.gateway.avg * 10) / 10 : null;
    case 'internet':
      return snap.internet?.avg != null ? Math.round(snap.internet.avg) : null;
    case 'download':
      return snap.speed ? Math.round(snap.speed.downloadMbps) : null;
  }
};

const SaveSnapshot = ({ rooms, onSaved }: { rooms: string[]; onSaved: () => void }) => {
  const t = useT();
  const [preset, setPreset] = useState(t.rooms.presets[0]);
  const [custom, setCustom] = useState('');
  const [note, setNote] = useState('');
  const [withSpeed, setWithSpeed] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [speedRunning, setSpeedRunning] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const spikeThreshold = useSettingsStore((s) => s.settings.spikeThresholdMs);
  const options = useMemo(() => [...new Set([...t.rooms.presets, ...rooms])], [t, rooms]);
  const roomName = preset === '__custom' ? custom.trim() : preset;
  const busy = remaining !== null || speedRunning;

  useEffect(() => () => window.clearInterval(timer.current), []);

  const save = async () => {
    if (!roomName) return;
    setMessage(null);
    const startedAt = Date.now();
    const signalStart = useLiveStore.getState().signal.length;
    setRemaining(MEASURE_SECONDS);
    await new Promise<void>((resolve) => {
      timer.current = window.setInterval(() => {
        const left = MEASURE_SECONDS - Math.floor((Date.now() - startedAt) / 1000);
        setRemaining(Math.max(0, left));
        if (left <= 0) {
          window.clearInterval(timer.current);
          resolve();
        }
      }, 250);
    });
    setRemaining(null);

    const live = useLiveStore.getState();
    const conn = live.wifi?.connection ?? null;
    const since = (id: string) => (live.ping[id] ?? []).filter((s) => s.ts >= startedAt);
    const rssiValues = live.signal.slice(signalStart).map((p) => p.rssi).filter((v): v is number => v !== null);
    let speed: SpeedResult | null = null;
    try {
      if (withSpeed) {
        setSpeedRunning(true);
        speed = await api.runSpeedtest(roomName);
      }
      const snapshot: RoomSnapshot = {
        ssid: conn?.ssid ?? null,
        bssid: conn?.bssid ?? null,
        band: conn?.band ?? null,
        channel: conn?.channel ?? null,
        widthMhz: conn?.channelWidthMhz ?? null,
        rssi: rssiValues.length ? Math.round(rssiValues.reduce((a, b) => a + b, 0) / rssiValues.length) : conn?.rssi ?? null,
        rxMbps: conn?.rxMbps ?? null,
        txMbps: conn?.txMbps ?? null,
        gateway: summary(computeStats(since(GATEWAY), spikeThreshold)),
        internet: summary(computeStats(mergeInternet(INTERNET_TARGETS.map(since)), spikeThreshold)),
        speed,
      };
      await api.saveSnapshot(roomName, note.trim() || null, snapshot);
      setMessage({ ok: true, text: `${t.rooms.saved}: ${roomName}` });
      setNote('');
      onSaved();
    } catch (e) {
      setMessage({ ok: false, text: errorMessage(t, e) });
    } finally {
      setSpeedRunning(false);
    }
  };

  return (
    <GlassCard title={t.rooms.save} className="lg:col-span-4">
      <div className="space-y-3">
        <label className="block text-[12.5px] text-fg-muted" htmlFor="room-select">
          {t.rooms.room}
        </label>
        <Select id="room-select" value={preset} onChange={(e) => setPreset(e.target.value)} disabled={busy}>
          {options.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
          <option value="__custom">{t.rooms.customRoom}</option>
        </Select>
        {preset === '__custom' && <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={t.rooms.room} aria-label={t.rooms.room} disabled={busy} />}
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t.rooms.note} aria-label={t.rooms.note} disabled={busy} />
        <Field label={t.rooms.withSpeed} htmlFor="with-speed">
          <Switch id="with-speed" checked={withSpeed} onCheckedChange={setWithSpeed} disabled={busy} />
        </Field>
        <Button variant="primary" className="w-full" onClick={save} disabled={!roomName} loading={busy}>
          {!busy && <Save aria-hidden />}
          {remaining !== null ? t.rooms.measuring(remaining) : speedRunning ? t.rooms.speedRunning : t.rooms.save}
        </Button>
        {remaining !== null && (
          <div className="h-1.5 overflow-hidden rounded-full bg-track" aria-hidden>
            <motion.div className="accent-gradient h-full" animate={{ width: `${((MEASURE_SECONDS - remaining) / MEASURE_SECONDS) * 100}%` }} transition={{ duration: 0.25 }} />
          </div>
        )}
        {message && <Banner severity={message.ok ? 'ok' : 'bad'} title={message.text} />}
      </div>
    </GlassCard>
  );
};

const Delta = ({ current, previous, higherIsBetter, unit }: { current: number | null; previous: number | null; higherIsBetter: boolean; unit: string }) => {
  if (current === null || previous === null || current === previous) return null;
  const diff = current - previous;
  const better = higherIsBetter ? diff > 0 : diff < 0;
  const Icon = diff > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn('num ml-1.5 inline-flex items-center text-[12px] font-medium', better ? 'text-ok' : 'text-bad')}>
      <Icon className="size-3.5" aria-hidden />
      {fmtNumber(Math.abs(diff), Math.abs(diff) < 10 ? 1 : 0)} {unit}
    </span>
  );
};

export const RoomsPage = () => {
  const t = useT();
  const [snapshots, setSnapshots] = useState<StoredRecord<RoomSnapshot>[]>([]);
  const [metric, setMetric] = useState<Metric>('rssi');
  const [timelineRoom, setTimelineRoom] = useState<string>('');

  const load = useCallback(() => {
    api.listSnapshots<RoomSnapshot>().then(setSnapshots).catch(() => setSnapshots([]));
  }, []);
  useEffect(load, [load]);

  const rooms = useMemo(() => [...new Set(snapshots.map((s) => s.room ?? ''))].filter(Boolean), [snapshots]);
  const latest = useMemo(() => rooms.map((room) => snapshots.find((s) => s.room === room)!), [rooms, snapshots]);
  const activeRoom = timelineRoom || rooms[0] || '';
  const timeline = useMemo(() => snapshots.filter((s) => s.room === activeRoom).slice().reverse(), [snapshots, activeRoom]);

  const remove = async (id: number) => {
    if (!(await confirmAction(t.rooms.deleteConfirm))) return;
    await api.deleteSnapshot(id);
    load();
  };

  return (
    <>
      <PageHeader title={t.rooms.title} subtitle={t.rooms.subtitle} />
      <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-12">
        <SaveSnapshot rooms={rooms} onSaved={load} />
        <GlassCard
          className="lg:col-span-8"
          title={t.rooms.compare}
          actions={
            <Segmented
              ariaLabel={t.rooms.compare}
              value={metric}
              onChange={setMetric}
              options={(Object.keys(t.rooms.chartMetric) as Metric[]).map((m) => ({ value: m, label: t.rooms.chartMetric[m].label }))}
            />
          }
        >
          {latest.length === 0 ? (
            <EmptyState icon={<House />} title={t.rooms.empty} />
          ) : (
            <BarCompare
              categories={latest.map((s) => s.room ?? '')}
              values={latest.map((s) => metricValue(s.data, metric))}
              unit={t.rooms.chartMetric[metric].unit}
              floor={metric === 'rssi' ? -100 : undefined}
              height={300}
            />
          )}
        </GlassCard>
      </div>

      {latest.length > 0 && (
        <div className="mb-5 grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-5">
          {latest.map((s) => {
            const d = s.data;
            return (
              <GlassCard key={s.id} title={s.room} subtitle={`${t.rooms.latest}: ${fmtDateTime(s.ts)}`}>
                <div className="grid grid-cols-2 gap-4">
                  <StatTile label={t.metric.rssi} value={d.rssi ?? '—'} unit="dBm" level={d.rssi !== null ? rateRssi(d.rssi) : null} size="sm" />
                  <StatTile label={t.metric.gatewayPing} value={fmtMs(d.gateway?.avg)} level={d.gateway?.avg != null ? rateGatewayLatency(d.gateway.avg) : null} size="sm" />
                  <StatTile label={t.metric.internetPing} value={fmtMs(d.internet?.avg)} level={d.internet?.avg != null ? rateInternetLatency(d.internet.avg) : null} size="sm" />
                  <StatTile label={t.speed.download} value={d.speed ? fmtMbps(d.speed.downloadMbps) : '—'} level={d.speed ? rateDownload(d.speed.downloadMbps) : null} size="sm" />
                </div>
                <p className="mt-3 text-[12px] text-fg-faint">
                  {[d.ssid, bandLabel(d.band), d.channel !== null ? `ch ${d.channel}` : null, d.widthMhz ? `${d.widthMhz} MHz` : null].filter(Boolean).join(', ')}
                </p>
              </GlassCard>
            );
          })}
        </div>
      )}

      {rooms.length > 0 && (
        <GlassCard
          padded={false}
          className="overflow-hidden"
          title={t.rooms.timeline}
          actions={
            <Select value={activeRoom} onChange={(e) => setTimelineRoom(e.target.value)} aria-label={t.rooms.pickRoom} className="w-48">
              {rooms.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          }
        >
          <div className="overflow-x-auto">
<table className="w-full text-left whitespace-nowrap text-[13px]">
            <thead className="text-[12px] text-fg-muted">
              <tr className="border-b border-line">
                <th className="py-3 pr-3 pl-5 font-medium">{t.common.time}</th>
                <th className="px-3 py-3 font-medium">{t.rooms.noteColumn}</th>
                <th className="px-3 py-3 font-medium">{t.metric.rssi}</th>
                <th className="px-3 py-3 font-medium">{t.metric.gatewayPing}</th>
                <th className="px-3 py-3 font-medium">{t.metric.internetPing}</th>
                <th className="px-3 py-3 font-medium">{t.metric.loss}</th>
                <th className="px-3 py-3 font-medium">{t.speed.download}</th>
                <th className="py-3 pr-5 pl-3" />
              </tr>
            </thead>
            <tbody className="num">
              {timeline.map((s, i) => {
                const prev = i > 0 ? timeline[i - 1].data : null;
                const d = s.data;
                const loss = Math.max(d.gateway?.lossPct ?? 0, d.internet?.lossPct ?? 0);
                return (
                  <tr key={s.id} className="border-b border-line last:border-b-0">
                    <td className="py-2.5 pr-3 pl-5 text-fg-muted">{fmtDateTime(s.ts)}</td>
                    <td className="px-3 py-2.5 text-fg">{s.note ?? '—'}</td>
                    <td className="px-3 py-2.5 text-fg">
                      {d.rssi ?? '—'} dBm
                      <Delta current={d.rssi} previous={prev?.rssi ?? null} higherIsBetter unit="dB" />
                    </td>
                    <td className="px-3 py-2.5 text-fg">
                      {fmtMs(d.gateway?.avg)}
                      <Delta current={d.gateway?.avg ?? null} previous={prev?.gateway?.avg ?? null} higherIsBetter={false} unit="ms" />
                    </td>
                    <td className="px-3 py-2.5 text-fg">
                      {fmtMs(d.internet?.avg)}
                      <Delta current={d.internet?.avg ?? null} previous={prev?.internet?.avg ?? null} higherIsBetter={false} unit="ms" />
                    </td>
                    <td className="px-3 py-2.5">{loss > 0 ? <LevelBadge level={loss > 2 ? 'poor' : 'fair'}>{fmtPercent(loss)}</LevelBadge> : fmtPercent(0)}</td>
                    <td className="px-3 py-2.5 text-fg">
                      {d.speed ? fmtMbps(d.speed.downloadMbps) : '—'}
                      <Delta current={d.speed?.downloadMbps ?? null} previous={prev?.speed?.downloadMbps ?? null} higherIsBetter unit="Mb/s" />
                    </td>
                    <td className="py-2.5 pr-5 pl-3 text-right">
                      <Button size="icon" variant="ghost" aria-label={t.common.delete} onClick={() => remove(s.id)}>
                        <Trash2 aria-hidden />
                      </Button>
                    </td>
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
