import { Globe } from 'lucide-react';
import { useAsync } from '@/hooks/useAsync';
import { GlassCard } from '@/components/glass/GlassCard';
import { PageHeader } from '@/components/glass/PageHeader';
import { InfoRow } from '@/components/glass/StatTile';
import { Banner, EmptyState, SeverityIcon, Skeleton } from '@/components/glass/status';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { fmtDateTime, fmtMbps } from '@/lib/format';
import { errorMessage, useT } from '@/lib/i18n';
import type { Ipv6Check, MtuResult, NetInfo, PublicInfo } from '@/lib/types';

const LocalCard = ({ info }: { info: NetInfo | null }) => {
  const t = useT();
  if (!info) return <Skeleton className="h-[420px] rounded-[20px]" />;
  const v4 = info.ipv4[0];
  return (
    <GlassCard title={t.network.local} subtitle={info.description}>
      <dl>
        <InfoRow label={t.network.adapterName}>{info.name}</InfoRow>
        <InfoRow label={t.network.ipv4}>{v4 ? `${v4.address}/${v4.prefix}` : '—'}</InfoRow>
        <InfoRow label={t.network.mask}>{v4?.mask ?? '—'}</InfoRow>
        <InfoRow label={t.network.gateway}>{info.gateway ?? '—'}</InfoRow>
        <InfoRow label={t.network.dnsServers}>{info.dnsServers.join(', ') || '—'}</InfoRow>
        <InfoRow label={t.network.mac}>{info.mac}</InfoRow>
        <InfoRow label={t.network.dhcp}>{info.dhcpEnabled ? t.common.yes : t.common.no}</InfoRow>
        {info.dhcpEnabled && <InfoRow label={t.network.dhcpServer}>{info.dhcpServer ?? '—'}</InfoRow>}
        {info.leaseObtained && <InfoRow label={t.network.leaseObtained}>{fmtDateTime(info.leaseObtained)}</InfoRow>}
        {info.leaseExpires && <InfoRow label={t.network.leaseExpires}>{fmtDateTime(info.leaseExpires)}</InfoRow>}
        <InfoRow label={t.metric.linkRate} hint={t.explain.linkRate}>
          {fmtMbps(info.rxLinkBps / 1e6)} / {fmtMbps(info.txLinkBps / 1e6)}
        </InfoRow>
        <InfoRow label="MTU">{info.mtu}</InfoRow>
        <InfoRow label={t.network.ipv6Addresses}>{info.ipv6.length ? info.ipv6.join(', ') : '—'}</InfoRow>
      </dl>
    </GlassCard>
  );
};

const PublicCard = () => {
  const t = useT();
  const { data, error, loading, run } = useAsync<PublicInfo>(api.getPublicInfo, true);
  return (
    <GlassCard
      title={t.network.public}
      subtitle={t.network.publicNote}
      actions={
        <Button size="sm" variant="ghost" onClick={run} loading={loading}>
          {t.common.retry}
        </Button>
      }
    >
      {error ? (
        <EmptyState icon={<Globe />} title={errorMessage(t, error)} />
      ) : !data ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-7" />
          ))}
        </div>
      ) : (
        <dl>
          <InfoRow label={t.network.publicIp}>{data.ip ?? '—'}</InfoRow>
          <InfoRow label={t.network.isp}>{data.isp ?? '—'}</InfoRow>
          <InfoRow label={t.network.location}>{[data.city, data.region, data.country].filter(Boolean).join(', ') || '—'}</InfoRow>
          <InfoRow label={t.network.cfColo}>{data.cloudflareColo ?? '—'}</InfoRow>
        </dl>
      )}
    </GlassCard>
  );
};

const TestsCard = () => {
  const t = useT();
  const ipv6 = useAsync<Ipv6Check>(api.checkIpv6, false);
  const mtu = useAsync<MtuResult>(api.testMtu, false);
  const ipv6Text = ipv6.data
    ? ipv6.data.reachable
      ? t.network.ipv6Yes(ipv6.data.latencyMs)
      : ipv6.data.hasGlobalAddress
        ? t.network.ipv6Unreachable
        : t.network.ipv6NoAddr
    : null;
  return (
    <GlassCard title={t.network.tests}>
      <div className="divide-y divide-line">
        <div className="flex items-center justify-between gap-4 pb-4">
          <div className="flex items-start gap-3">
            {ipv6.data && <SeverityIcon severity={ipv6.data.reachable ? 'ok' : ipv6.data.hasGlobalAddress ? 'warn' : 'info'} />}
            <div>
              <p className="text-sm font-medium text-fg">{t.network.ipv6Test}</p>
              {ipv6Text && <p className="text-[13px] text-fg-muted">{ipv6Text}</p>}
            </div>
          </div>
          <Button size="sm" onClick={ipv6.run} loading={ipv6.loading}>
            {t.network.runTest}
          </Button>
        </div>
        <div className="flex items-center justify-between gap-4 pt-4">
          <div className="flex items-start gap-3">
            {mtu.data && <SeverityIcon severity={mtu.data.mtu === null ? 'warn' : mtu.data.mtu < 1500 ? 'info' : 'ok'} />}
            <div>
              <p className="text-sm font-medium text-fg">{t.network.mtuTest}</p>
              {mtu.data && <p className="text-[13px] text-fg-muted">{t.network.mtuResult(mtu.data.mtu)}</p>}
            </div>
          </div>
          <Button size="sm" onClick={mtu.run} loading={mtu.loading}>
            {t.network.runTest}
          </Button>
        </div>
      </div>
    </GlassCard>
  );
};

export const NetworkPage = () => {
  const t = useT();
  const local = useAsync<NetInfo>(api.getNetInfo, true);
  return (
    <>
      <PageHeader title={t.network.title} />
      {local.error ? <Banner severity="bad" title={errorMessage(t, local.error)} /> : null}
      <div className="grid grid-cols-2 items-start gap-5">
        <LocalCard info={local.data} />
        <div className="flex flex-col gap-5">
          <PublicCard />
          <TestsCard />
        </div>
      </div>
    </>
  );
};
