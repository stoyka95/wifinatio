import { useMemo, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { LatencyChart, type LatencySeries } from '@/charts/LatencyChart';
import { GlassCard } from '@/components/glass/GlassCard';
import { PageHeader } from '@/components/glass/PageHeader';
import { EmptyState, LevelDot, SeverityIcon } from '@/components/glass/status';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/controls';
import { InfoTip } from '@/components/ui/tooltip';
import { analyse, GATEWAY, useTicker } from '@/hooks/useLiveAnalysis';
import { fmtMs, fmtNumber, fmtPercent } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { rateGatewayJitter, rateGatewayLatency, rateInternetJitter, rateInternetLatency, rateLoss } from '@/lib/rating';
import { computeStats, sliceWindow } from '@/lib/stats';
import { useLiveStore } from '@/stores/live';
import { useSettingsStore } from '@/stores/settings';
import { Activity } from 'lucide-react';

type WindowKey = '1m' | '5m' | '30m' | '1h';
const WINDOWS: Record<WindowKey, number> = { '1m': 60_000, '5m': 300_000, '30m': 1_800_000, '1h': 3_600_000 };

export const PingPage = () => {
  const t = useT();
  const [windowKey, setWindowKey] = useState<WindowKey>('5m');
  const [paused, setPaused] = useState<number | null>(null);
  const tick = useTicker(1000);
  const now = paused ?? tick;
  const windowMs = WINDOWS[windowKey];
  const targets = useLiveStore((s) => s.targets);
  const ping = useLiveStore((s) => s.ping);
  const pingVersion = useLiveStore((s) => s.pingVersion);
  const wifi = useLiveStore((s) => s.wifi);
  const dnsProbes = useLiveStore((s) => s.dnsProbes);
  const spikeThreshold = useSettingsStore((s) => s.settings.spikeThresholdMs);

  const series = useMemo<LatencySeries[]>(
    () =>
      targets.map((target) => ({
        id: target.id,
        label: t.ping.targets[target.id] ?? target.label,
        samples: sliceWindow(ping[target.id] ?? [], windowMs, now),
      })),
    // pingVersion: buffers are mutated in place.
    [targets, ping, pingVersion, windowMs, now, t],
  );

  const analysis = useMemo(() => {
    const okDns = dnsProbes.filter((p) => p.ms !== null).map((p) => p.ms as number);
    return analyse(ping, windowMs, now, spikeThreshold, {
      adapterPresent: wifi ? wifi.state !== 'no_adapter' : true,
      connected: wifi ? wifi.state === 'connected' : true,
      rssi: wifi?.connection?.rssi ?? null,
      dnsMs: okDns.length ? okDns.reduce((a, b) => a + b, 0) / okDns.length : null,
      dnsFailed: false,
    });
  }, [ping, pingVersion, windowMs, now, spikeThreshold, wifi, dnsProbes]);

  const labels = useMemo(() => ({ lost: t.ping.lost, spike: t.ping.spike, scan: t.ping.scanBand }), [t]);
  const hasData = series.some((s) => s.samples.length > 0);
  const d = analysis.diagnosis;

  return (
    <>
      <PageHeader
        title={t.ping.title}
        subtitle={t.ping.subtitle}
        actions={
          <>
            <Segmented
              ariaLabel={t.ping.window}
              value={windowKey}
              onChange={setWindowKey}
              options={(Object.keys(WINDOWS) as WindowKey[]).map((k) => ({ value: k, label: k === '1h' ? '1 h' : k.replace('m', ' min') }))}
            />
            <Button size="sm" onClick={() => setPaused(paused === null ? Date.now() : null)}>
              {paused === null ? <Pause aria-hidden /> : <Play aria-hidden />}
              {paused === null ? t.common.pause : t.common.resume}
            </Button>
          </>
        }
      />

      <GlassCard className="mb-5 flex items-start gap-3 py-4">
        <SeverityIcon severity={d.severity} className="mt-0.5" />
        <div>
          <p className="text-[12.5px] font-medium text-fg-muted">{t.ping.cause}</p>
          <p className="mt-0.5 text-[15px] font-medium text-fg">{t.diagnosis[d.code](d.params)}</p>
          {paused !== null && <p className="mt-1 text-[12.5px] text-fg-faint">{t.ping.paused}</p>}
        </div>
      </GlassCard>

      <GlassCard className="mb-5">
        {hasData ? (
          <LatencyChart series={series} spikeThresholdMs={spikeThreshold} windowMs={windowMs} now={now} labels={labels} height={340} />
        ) : (
          <EmptyState icon={<Activity />} title={t.dashboard.noData} body={t.ping.noGateway} />
        )}
      </GlassCard>

      <GlassCard padded={false} className="overflow-hidden">
        <div className="overflow-x-auto">
<table className="w-full text-left whitespace-nowrap text-[13.5px]">
          <thead className="text-[12px] text-fg-muted">
            <tr className="border-b border-line">
              <th className="px-5 py-3 font-medium">{t.ping.target}</th>
              <th className="px-3 py-3 font-medium">{t.metric.min}</th>
              <th className="px-3 py-3 font-medium">{t.metric.avg}</th>
              <th className="px-3 py-3 font-medium">{t.metric.median}</th>
              <th className="px-3 py-3 font-medium">{t.metric.max}</th>
              <th className="px-3 py-3 font-medium">
                <span className="inline-flex items-center gap-1">
                  {t.metric.jitter} <InfoTip content={t.explain.jitter} />
                </span>
              </th>
              <th className="px-3 py-3 font-medium">
                <span className="inline-flex items-center gap-1">
                  {t.metric.loss} <InfoTip content={t.explain.loss} />
                </span>
              </th>
              <th className="px-5 py-3 font-medium">
                <span className="inline-flex items-center gap-1">
                  {t.metric.spikes} <InfoTip content={`${t.explain.spikes(spikeThreshold)} ${t.explain.scanNote}`} />
                </span>
              </th>
            </tr>
          </thead>
          <tbody className="num">
            {series.map((s) => {
              const st = computeStats(s.samples, spikeThreshold);
              const isGw = s.id === GATEWAY;
              const latLevel = st.avg === null ? null : isGw ? rateGatewayLatency(st.avg) : rateInternetLatency(st.avg);
              const jitLevel = st.jitter === null ? null : isGw ? rateGatewayJitter(st.jitter) : rateInternetJitter(st.jitter);
              return (
                <tr key={s.id} className="border-b border-line last:border-b-0">
                  <td className="px-5 py-3 font-medium text-fg">
                    <span className="flex items-center gap-2">
                      <LevelDot level={latLevel} />
                      {s.label}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-fg-muted">{fmtMs(st.min)}</td>
                  <td className="px-3 py-3 font-medium text-fg">{fmtMs(st.avg)}</td>
                  <td className="px-3 py-3 text-fg-muted">{fmtMs(st.median)}</td>
                  <td className="px-3 py-3 text-fg-muted">{fmtMs(st.max)}</td>
                  <td className="px-3 py-3">
                    <span className="inline-flex items-center gap-1.5">
                      <LevelDot level={jitLevel} className="size-1.5" />
                      {fmtMs(st.jitter)}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <span className="inline-flex items-center gap-1.5">
                      <LevelDot level={st.count ? rateLoss(st.lossPct) : null} className="size-1.5" />
                      {fmtPercent(st.lossPct)}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-fg-muted">
                    {fmtNumber(st.spikes)}
                    {st.scanSamples > 0 && <span className="ml-2 text-[12px] text-fg-faint">({t.ping.scanBand}: {st.scanSamples})</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
</div>
      </GlassCard>
    </>
  );
};
