import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeftRight, CircleCheck, Globe, History, Radio, Router, ServerCrash, SignalLow, Unplug, Waves, type LucideIcon } from 'lucide-react';
import { GlassCard } from '@/components/glass/GlassCard';
import { PageHeader } from '@/components/glass/PageHeader';
import { StatTile } from '@/components/glass/StatTile';
import { EmptyState, Skeleton } from '@/components/glass/status';
import { Segmented } from '@/components/ui/controls';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtDuration, fmtNumber, fmtTime } from '@/lib/format';
import { useT } from '@/lib/i18n';
import type { NetEvent } from '@/lib/types';
import { useLiveStore } from '@/stores/live';

type Range = '1h' | '24h' | '7d' | 'all';
const RANGE_MS: Record<Range, number | null> = { '1h': 3_600_000, '24h': 86_400_000, '7d': 604_800_000, all: null };
const OUTAGE_KINDS = new Set(['disconnected', 'internet_down', 'router_unreachable']);

const ICONS: Record<string, LucideIcon> = {
  disconnected: Unplug,
  connected: CircleCheck,
  roam: ArrowLeftRight,
  channel_change: Radio,
  weak_signal: SignalLow,
  packet_loss: Waves,
  internet_down: Globe,
  router_unreachable: Router,
  dns_failure: ServerCrash,
};

const tone: Record<string, string> = {
  ok: 'text-ok bg-ok-soft',
  info: 'text-blue bg-[color-mix(in_srgb,var(--blue)_12%,transparent)]',
  warn: 'text-warn bg-warn-soft',
  bad: 'text-bad bg-bad-soft',
};

const dayKey = (ts: number, locale: string) => new Date(ts).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });

export const EventsPage = () => {
  const t = useT();
  const [events, setEvents] = useState<NetEvent[] | null>(null);
  const [range, setRange] = useState<Range>('24h');
  const [problemsOnly, setProblemsOnly] = useState<'all' | 'problems'>('all');
  const lastEvent = useLiveStore((s) => s.lastEvent);

  const load = useCallback(() => {
    const span = RANGE_MS[range];
    api
      .listEvents(span === null ? 0 : Date.now() - span, 2000)
      .then(setEvents)
      .catch(() => setEvents([]));
  }, [range]);

  useEffect(load, [load, lastEvent]);

  const filtered = useMemo(
    () => (events ?? []).filter((e) => problemsOnly === 'all' || e.severity === 'warn' || e.severity === 'bad'),
    [events, problemsOnly],
  );

  const summary = useMemo(() => {
    const outages = (events ?? []).filter((e) => OUTAGE_KINDS.has(e.kind));
    const offline = outages.reduce((sum, e) => sum + ((e.endTs ?? Date.now()) - e.ts), 0);
    const problems = (events ?? []).filter((e) => e.severity === 'warn' || e.severity === 'bad').length;
    return { outages: outages.length, offline, problems };
  }, [events]);

  const groups = useMemo(() => {
    const map = new Map<string, NetEvent[]>();
    for (const e of filtered) {
      const key = dayKey(e.ts, t.locale);
      map.set(key, [...(map.get(key) ?? []), e]);
    }
    return [...map.entries()];
  }, [filtered, t.locale]);

  return (
    <>
      <PageHeader
        title={t.events.title}
        subtitle={t.events.subtitle}
        actions={
          <>
            <Segmented
              ariaLabel={t.events.filterAll}
              value={problemsOnly}
              onChange={setProblemsOnly}
              options={[
                { value: 'all', label: t.events.filterAll },
                { value: 'problems', label: t.events.filterProblems },
              ]}
            />
            <Segmented ariaLabel={t.events.rangeLabel} value={range} onChange={setRange} options={(Object.keys(RANGE_MS) as Range[]).map((r) => ({ value: r, label: t.events.range[r] }))} />
          </>
        }
      />

      <GlassCard className="mb-5">
        <div className="grid grid-cols-3 gap-4">
          <StatTile label={t.events.outagesTotal} value={events ? fmtNumber(summary.outages) : '—'} level={events ? (summary.outages === 0 ? 'good' : summary.outages < 3 ? 'fair' : 'poor') : null} />
          <StatTile label={t.events.outageTime} value={events ? fmtDuration(summary.offline) : '—'} />
          <StatTile label={t.events.filterProblems} value={events ? fmtNumber(summary.problems) : '—'} />
        </div>
      </GlassCard>

      <GlassCard>
        {!events ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <EmptyState icon={<History />} title={t.events.empty} />
        ) : (
          <div className="space-y-6">
            {groups.map(([day, items]) => (
              <section key={day}>
                <h3 className="mb-2 text-[12.5px] font-medium text-fg-muted first-letter:uppercase">{day}</h3>
                <ol className="relative ml-4 border-l border-line">
                  {items.map((e) => {
                    const Icon = ICONS[e.kind] ?? History;
                    const ongoing = e.endTs === null;
                    const duration = e.endTs !== null && e.endTs > e.ts ? e.endTs - e.ts : null;
                    return (
                      <motion.li key={e.id} layout="position" className="relative py-2.5 pl-8">
                        <span className={cn('absolute top-2.5 -left-[15px] flex size-[30px] items-center justify-center rounded-full ring-4 ring-[var(--tint)]', tone[e.severity])}>
                          <Icon className="size-4" aria-hidden />
                        </span>
                        <div className="flex items-baseline justify-between gap-4">
                          <p className="text-[14px] font-medium text-fg">{t.events.kinds[e.kind] ?? e.kind}</p>
                          <span className="num shrink-0 text-[12.5px] text-fg-muted">{fmtTime(e.ts)}</span>
                        </div>
                        <p className="text-[13px] text-fg-muted">
                          {t.events.describe(e.kind, e.data)}
                          {duration !== null && (
                            <span className="num ml-2 text-fg">
                              {t.events.duration}: {fmtDuration(duration)}
                            </span>
                          )}
                          {ongoing && <span className={cn('pulse-dot ml-2 rounded-full px-2 py-0.5 text-[11.5px] font-medium', tone[e.severity])}>{t.events.ongoing}</span>}
                        </p>
                      </motion.li>
                    );
                  })}
                </ol>
              </section>
            ))}
          </div>
        )}
      </GlassCard>
    </>
  );
};
