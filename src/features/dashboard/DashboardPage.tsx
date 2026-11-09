import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { MapPin, Stethoscope, WifiOff } from 'lucide-react';
import { api, LOCATION_SETTINGS_URI } from '@/lib/api';
import { Sparkline } from '@/charts/Sparkline';
import { GlassCard } from '@/components/glass/GlassCard';
import { HealthGauge } from '@/components/glass/HealthGauge';
import { InfoRow, StatTile } from '@/components/glass/StatTile';
import { EmptyState, LevelBadge, SeverityIcon, Skeleton } from '@/components/glass/status';
import { Button } from '@/components/ui/button';
import { useLiveAnalysis, GATEWAY, INTERNET_TARGETS } from '@/hooks/useLiveAnalysis';
import { cn } from '@/lib/cn';
import { bandLabel, fmtMbps, fmtMhz, fmtMs, fmtNumber, fmtPercent, standardLabel } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { rateDns, rateGatewayLatency, rateInternetLatency, rateLinkRate, rateLoss, rateRssi } from '@/lib/rating';
import { sliceWindow } from '@/lib/stats';
import { useLiveStore } from '@/stores/live';
import { useUiStore } from '@/stores/ui';

const FIVE_MIN = 5 * 60_000;

const Verdict = () => {
  const t = useT();
  const { diagnosis, health } = useLiveAnalysis();
  const go = useUiStore((s) => s.go);
  return (
    <div className="flex min-w-0 flex-1 flex-col justify-center gap-5">
      <div className="flex items-start gap-3">
        <SeverityIcon severity={diagnosis.severity} className="mt-1 size-6" />
        <motion.p
          key={diagnosis.code}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25 }}
          className="max-w-[52ch] text-[21px] leading-snug font-semibold tracking-[-0.015em] text-fg text-balance"
        >
          {t.diagnosis[diagnosis.code](diagnosis.params)}
        </motion.p>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-9">
        {diagnosis.location !== 'none' && diagnosis.code !== 'collecting' && (
          <span className="glass-strong rounded-full px-3 py-1 text-[12.5px] font-medium text-fg">{t.diagnosis.whereLabel[diagnosis.location]}</span>
        )}
        {health.level !== 'good' && diagnosis.code !== 'collecting' && (
          <Button size="sm" variant="ghost" onClick={() => go('diagnosis')}>
            <Stethoscope aria-hidden />
            {t.dashboard.runDiagnosis}
          </Button>
        )}
      </div>
    </div>
  );
};

const KeyNumbers = () => {
  const t = useT();
  const { gateway, internet, dnsMs } = useLiveAnalysis();
  const rssi = useLiveStore((s) => s.wifi?.connection?.rssi ?? null);
  const band = useLiveStore((s) => s.wifi?.connection?.band ?? null);
  const loss = Math.max(gateway?.lossPct ?? 0, internet?.lossPct ?? 0);
  const rssiLevel = rssi !== null ? rateRssi(rssi) : null;
  return (
    <div className="grid grid-cols-5 gap-4 border-t border-line pt-5">
      <StatTile label={t.metric.rssi} value={rssi ?? '—'} unit="dBm" level={rssiLevel} hint={rssi !== null && rssiLevel ? t.explain.rssi(rssi, band, rssiLevel) : undefined} />
      <StatTile
        label={t.metric.gatewayPing}
        value={gateway?.avg != null ? fmtNumber(gateway.avg, gateway.avg < 10 ? 1 : 0) : '—'}
        unit="ms"
        level={gateway?.avg != null ? rateGatewayLatency(gateway.avg) : null}
        hint={t.explain.gatewayPing}
      />
      <StatTile
        label={t.metric.internetPing}
        value={internet?.avg != null ? fmtNumber(internet.avg) : '—'}
        unit="ms"
        level={internet?.avg != null ? rateInternetLatency(internet.avg) : null}
        hint={t.explain.internetPing}
      />
      <StatTile label={t.metric.loss} value={gateway ? fmtNumber(loss, loss ? 1 : 0) : '—'} unit="%" level={gateway ? rateLoss(loss) : null} hint={t.explain.loss} />
      <StatTile label={t.metric.dns} value={dnsMs !== null ? fmtNumber(dnsMs) : '—'} unit="ms" level={dnsMs !== null ? rateDns(dnsMs) : null} hint={t.explain.dns} />
    </div>
  );
};

const HealthHero = () => {
  const t = useT();
  const { health, diagnosis } = useLiveAnalysis();
  const collecting = diagnosis.code === 'collecting';
  return (
    <GlassCard className="flex flex-col gap-2 p-6">
      <div className="flex items-center gap-8">
        <HealthGauge
          score={collecting ? null : health.score}
          level={collecting ? null : health.level}
          label={t.health.title}
          caption={collecting ? t.common.loading : t.health.levelText[health.level]}
        />
        <Verdict />
      </div>
      <KeyNumbers />
    </GlassCard>
  );
};

const ConnectionCard = () => {
  const t = useT();
  const wifi = useLiveStore((s) => s.wifi);
  const conn = wifi?.connection;

  if (!wifi) {
    return (
      <GlassCard title={t.dashboard.connection} className="col-span-7">
        <div className="grid grid-cols-2 gap-x-10 gap-y-3">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-7" />
          ))}
        </div>
      </GlassCard>
    );
  }
  if (!conn) {
    // Connected but without details: Windows withholds them until location access is granted.
    const withheld = wifi.state === 'connected';
    return (
      <GlassCard title={t.dashboard.connection} className="col-span-7">
        {withheld ? (
          <EmptyState
            icon={<MapPin />}
            title={wifi.locationDenied ? t.location.deniedTitle : t.location.pendingTitle}
            body={wifi.locationDenied ? t.location.deniedBody : t.location.pendingBody}
            action={
              <Button onClick={() => api.openSettingsPage(LOCATION_SETTINGS_URI)}>
                <MapPin aria-hidden />
                {t.location.openSettings}
              </Button>
            }
          />
        ) : (
          <EmptyState icon={<WifiOff />} title={wifi.state === 'no_adapter' ? t.wifiState.no_adapter : t.dashboard.notConnectedTitle} body={t.dashboard.notConnectedBody} />
        )}
      </GlassCard>
    );
  }
  const rssiLevel = conn.rssi !== null ? rateRssi(conn.rssi) : null;
  return (
    <GlassCard
      title={
        <span className="flex items-center gap-2.5">
          <span className="selectable">{conn.ssid}</span>
          {rssiLevel && <LevelBadge level={rssiLevel} />}
        </span>
      }
      subtitle={wifi.adapter}
      className="col-span-7"
    >
      <dl className="grid grid-cols-2 gap-x-10">
        <div>
          <InfoRow label={t.metric.rssi} hint={conn.rssi !== null && rssiLevel ? t.explain.rssi(conn.rssi, conn.band, rssiLevel) : undefined}>
            {conn.rssi !== null ? `${conn.rssi} dBm (${fmtPercent(conn.signalQuality, 0)})` : fmtPercent(conn.signalQuality, 0)}
          </InfoRow>
          <InfoRow label={t.metric.band}>{bandLabel(conn.band)}</InfoRow>
          <InfoRow label={t.metric.channel}>
            {conn.channel ?? '—'}
            {conn.frequencyMhz ? ` (${fmtMhz(conn.frequencyMhz)})` : ''}
          </InfoRow>
          <InfoRow label={t.metric.width} hint={t.explain.width}>
            {conn.channelWidthMhz ? `${conn.channelWidthMhz} MHz` : '—'}
          </InfoRow>
          <InfoRow label={t.metric.standard}>{standardLabel(conn.standard, conn.band)}</InfoRow>
        </div>
        <div>
          <InfoRow label={t.metric.linkRate} hint={t.explain.linkRate}>
            <span className={cn(rateLinkRate(conn.rxMbps) === 'poor' && 'text-warn')}>
              {fmtNumber(conn.rxMbps)} / {fmtMbps(conn.txMbps)}
            </span>
          </InfoRow>
          <InfoRow label={t.metric.securityLabel}>{t.security[conn.security] ?? conn.security}</InfoRow>
          <InfoRow label={t.metric.bssid} hint={t.explain.bssid}>
            {conn.bssid}
          </InfoRow>
          <InfoRow label={t.metric.cipher}>{conn.cipher.toUpperCase()}</InfoRow>
          <InfoRow label={t.metric.profile}>{conn.profile}</InfoRow>
        </div>
      </dl>
    </GlassCard>
  );
};

const SparkCard = ({ title, value, children }: { title: string; value: string; children: React.ReactNode }) => (
  <GlassCard className="px-5 pt-4 pb-3">
    <div className="flex items-baseline justify-between">
      <h3 className="text-[13px] font-medium text-fg-muted">{title}</h3>
      <span className="num text-[15px] font-semibold text-fg">{value}</span>
    </div>
    <div className="mt-1">{children}</div>
  </GlassCard>
);

const Sparklines = () => {
  const t = useT();
  const pingVersion = useLiveStore((s) => s.pingVersion);
  const ping = useLiveStore((s) => s.ping);
  const signal = useLiveStore((s) => s.signal);
  const { gateway, internet } = useLiveAnalysis();
  const rssi = useLiveStore((s) => s.wifi?.connection?.rssi ?? null);

  const { gw, inet, sig } = useMemo(() => {
    const now = Date.now();
    const toPoints = (id: string) => sliceWindow(ping[id] ?? [], FIVE_MIN, now).map((s) => [s.ts, s.rtt] as [number, number | null]);
    const internetId = INTERNET_TARGETS.find((id) => (ping[id] ?? []).length) ?? INTERNET_TARGETS[0];
    return {
      gw: toPoints(GATEWAY),
      inet: toPoints(internetId),
      sig: signal.filter((p) => p.ts >= now - FIVE_MIN).map((p) => [p.ts, p.rssi] as [number, number | null]),
    };
    // pingVersion bumps when buffers (mutated in place) change.
  }, [ping, pingVersion, signal]);

  return (
    <div className="col-span-5 flex flex-col gap-4">
      <SparkCard title={`${t.metric.gatewayPing}, ${t.dashboard.last5min.toLowerCase()}`} value={fmtMs(gateway?.avg)}>
        <Sparkline points={gw} color="cyan" unit="ms" ariaLabel={t.metric.gatewayPing} height={56} />
      </SparkCard>
      <SparkCard title={t.metric.internetPing} value={fmtMs(internet?.avg)}>
        <Sparkline points={inet} color="blue" unit="ms" ariaLabel={t.metric.internetPing} height={56} />
      </SparkCard>
      <SparkCard title={t.metric.signalHistory} value={rssi !== null ? `${rssi} dBm` : '—'}>
        <Sparkline points={sig} color="violet" unit="dBm" min={-95} max={-30} ariaLabel={t.metric.signalHistory} height={56} />
      </SparkCard>
    </div>
  );
};

export const DashboardPage = () => (
  <div className="flex flex-col gap-5 pt-1">
    <HealthHero />
    <div className="grid grid-cols-12 gap-5">
      <ConnectionCard />
      <Sparklines />
    </div>
  </div>
);
