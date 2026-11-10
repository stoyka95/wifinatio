import { useMemo, useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { Route, Search, ServerCog } from 'lucide-react';
import { GlassCard } from '@/components/glass/GlassCard';
import { PageHeader } from '@/components/glass/PageHeader';
import { Banner, EmptyState, LevelDot } from '@/components/glass/status';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/controls';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtMs, fmtPercent } from '@/lib/format';
import { errorMessage, useT } from '@/lib/i18n';
import { rateDns, rateInternetLatency } from '@/lib/rating';
import type { DnsTestResult, Hop, TraceResult } from '@/lib/types';

/** A hop where latency jumps clearly above everything before it. */
export const findLatencyJumps = (hops: Hop[]): Set<number> => {
  const jumps = new Set<number>();
  let previous: number | null = null;
  for (const hop of hops) {
    if (hop.avgMs === null) continue;
    if (previous !== null && hop.avgMs - previous > 20 && hop.avgMs > previous * 1.8) jumps.add(hop.ttl);
    previous = Math.max(previous ?? 0, hop.avgMs);
  }
  return jumps;
};

const DnsCard = () => {
  const t = useT();
  const [result, setResult] = useState<DnsTestResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      setResult(await api.runDnsTest());
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setRunning(false);
    }
  };

  const maxMs = Math.max(50, ...(result?.servers.map((s) => s.worstMs ?? 0) ?? []));
  const advice = useMemo(() => {
    const sys = result?.servers.find((s) => s.id === 'system');
    const best = result?.servers.filter((s) => s.id !== 'system' && s.avgMs !== null).sort((a, b) => a.avgMs! - b.avgMs!)[0];
    if (!sys?.avgMs || !best?.avgMs) return null;
    const slower = sys.avgMs > best.avgMs * 1.6 && sys.avgMs - best.avgMs > 20;
    return slower ? t.dnsTrace.dnsRecommend(t.dnsTrace.servers[best.id], best.avgMs, sys.avgMs) : t.dnsTrace.dnsOk;
  }, [result, t]);

  return (
    <GlassCard
      title={t.dnsTrace.dnsTitle}
      subtitle={t.dnsTrace.dnsSubtitle}
      actions={
        <Button variant="primary" size="sm" onClick={run} loading={running}>
          {t.dnsTrace.runDns}
        </Button>
      }
    >
      {error && <Banner severity="bad" title={error} />}
      {!result ? (
        <EmptyState icon={<ServerCog />} title={t.dnsTrace.dnsTitle} body={t.explain.dns} />
      ) : (
        <div className="space-y-4">
          <ul className="space-y-3">
            {result.servers.map((s) => (
              <li key={s.id}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="flex items-center gap-2 font-medium text-fg">
                    <LevelDot level={s.avgMs !== null ? rateDns(s.avgMs) : 'poor'} />
                    {t.dnsTrace.servers[s.id] ?? s.label}
                    <span className="num font-normal text-fg-faint">{s.address}</span>
                  </span>
                  <span className="num text-fg-muted">
                    {t.dnsTrace.avg} <b className="font-semibold text-fg">{fmtMs(s.avgMs)}</b>
                    <span className="ml-3">
                      {t.dnsTrace.worst} {fmtMs(s.worstMs)}
                    </span>
                    {s.failures > 0 && <span className="ml-2 text-bad">{t.dnsTrace.failures}: {s.failures}</span>}
                  </span>
                </div>
                <div className="relative h-2.5 overflow-hidden rounded-full bg-track">
                  <motion.div
                    className="absolute inset-y-0 left-0 rounded-full bg-[color-mix(in_srgb,var(--blue)_35%,transparent)]"
                    initial={{ width: 0 }}
                    animate={{ width: `${((s.worstMs ?? 0) / maxMs) * 100}%` }}
                    transition={{ duration: 0.4 }}
                  />
                  <motion.div
                    className="accent-gradient absolute inset-y-0 left-0 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${((s.avgMs ?? 0) / maxMs) * 100}%` }}
                    transition={{ duration: 0.4 }}
                  />
                </div>
              </li>
            ))}
          </ul>
          {advice && <p className="text-[13.5px] text-fg">{advice}</p>}
        </div>
      )}
    </GlassCard>
  );
};

const TraceCard = () => {
  const t = useT();
  const [target, setTarget] = useState('1.1.1.1');
  const [result, setResult] = useState<TraceResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (e?: FormEvent) => {
    e?.preventDefault();
    setRunning(true);
    setError(null);
    try {
      setResult(await api.runTraceroute(target));
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setRunning(false);
    }
  };

  const jumps = useMemo(() => findLatencyJumps(result?.hops ?? []), [result]);
  const maxMs = Math.max(20, ...(result?.hops.map((h) => h.avgMs ?? 0) ?? []));

  return (
    <GlassCard title={t.dnsTrace.traceTitle} subtitle={t.dnsTrace.traceSubtitle}>
      <form onSubmit={run} className="mb-4 flex gap-2">
        <Input value={target} onChange={(e) => setTarget(e.target.value)} aria-label={t.dnsTrace.target} placeholder="1.1.1.1" className="max-w-xs" />
        <Button type="submit" variant="primary" loading={running}>
          {!running && <Search aria-hidden />}
          {t.dnsTrace.runTrace}
        </Button>
      </form>
      {error && <Banner severity="bad" title={error} />}
      {!result ? (
        <EmptyState icon={<Route />} title={t.dnsTrace.traceTitle} body={t.dnsTrace.icmpNote} />
      ) : (
        <>
          <p className={cn('mb-3 text-[13px] font-medium', result.reached ? 'text-ok' : 'text-warn')}>
            {result.reached ? t.dnsTrace.reached : t.dnsTrace.notReached} ({result.resolved})
          </p>
          <ol className="space-y-1.5">
            {result.hops.map((hop) => {
              const jump = jumps.has(hop.ttl);
              return (
                <li key={hop.ttl} className={cn('grid grid-cols-[20px_minmax(0,1fr)_96px_36px] items-center gap-2 rounded-xl px-1 py-2 text-[13px] sm:grid-cols-[24px_minmax(0,1fr)_140px_44px] sm:gap-3 sm:px-2', jump && 'bg-warn-soft')}>
                  <span className="num text-fg-faint">{hop.ttl}</span>
                  <span className="min-w-0">
                    {hop.address ? (
                      <>
                        <span className="selectable num block truncate font-medium text-fg">{hop.hostname ?? hop.address}</span>
                        {hop.hostname && <span className="num block text-[12px] text-fg-faint">{hop.address}</span>}
                      </>
                    ) : (
                      <span className="text-fg-faint">* * * {t.dnsTrace.noReply}</span>
                    )}
                    {jump && <span className="text-[12px] font-medium text-warn">{t.dnsTrace.jump}</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-track">
                      {hop.avgMs !== null && (
                        <span
                          className={cn('absolute inset-y-0 left-0 rounded-full', rateInternetLatency(hop.avgMs) === 'poor' ? 'bg-bad' : 'accent-gradient')}
                          style={{ width: `${Math.max(3, (hop.avgMs / maxMs) * 100)}%` }}
                        />
                      )}
                    </span>
                    <span className="num w-14 shrink-0 text-right text-fg">{fmtMs(hop.avgMs)}</span>
                  </span>
                  <span className={cn('num text-right', hop.lossPct > 0 && hop.address ? 'text-warn' : 'text-fg-faint')}>{hop.address ? fmtPercent(hop.lossPct, 0) : ''}</span>
                </li>
              );
            })}
          </ol>
          <p className="mt-4 text-[12.5px] text-fg-muted">{t.dnsTrace.icmpNote}</p>
        </>
      )}
    </GlassCard>
  );
};

export const DnsTracePage = () => {
  const t = useT();
  return (
    <>
      <PageHeader title={t.dnsTrace.title} />
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <DnsCard />
        <TraceCard />
      </div>
    </>
  );
};
