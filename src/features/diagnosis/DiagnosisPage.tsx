import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Circle, Loader2, RotateCcw, Stethoscope } from 'lucide-react';
import { GlassCard } from '@/components/glass/GlassCard';
import { PageHeader } from '@/components/glass/PageHeader';
import { Banner } from '@/components/glass/status';
import { Button } from '@/components/ui/button';
import { Field, Segmented, Switch } from '@/components/ui/controls';
import { InfoTip } from '@/components/ui/tooltip';
import { GATEWAY, INTERNET_TARGETS } from '@/hooks/useLiveAnalysis';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { diagnose } from '@/lib/diagnosis';
import { fmtDateTime } from '@/lib/format';
import { alignWithVerdict, computeHealth } from '@/lib/health';
import { errorMessage, useT } from '@/lib/i18n';
import { buildReport, type DiagnosticReport } from '@/lib/report';
import { computeStats, mergeInternet } from '@/lib/stats';
import type { BssInfo, DnsTestResult, SpeedResult, StoredRecord, SystemChecks } from '@/lib/types';
import { useLiveStore } from '@/stores/live';
import { useSettingsStore } from '@/stores/settings';
import { ReportView } from './ReportView';

type StepId = 'connection' | 'ping' | 'dns' | 'scan' | 'speed' | 'system' | 'report';
type StepState = 'pending' | 'running' | 'done' | 'skipped';

const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

export const DiagnosisPage = () => {
  const t = useT();
  const [duration, setDuration] = useState<'30' | '60'>('30');
  const [includeScan, setIncludeScan] = useState(false);
  const [includeSpeed, setIncludeSpeed] = useState(false);
  const [steps, setSteps] = useState<Record<StepId, StepState> | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<StoredRecord<DiagnosticReport>[]>([]);
  const cancelled = useRef(false);
  const spikeThreshold = useSettingsStore((s) => s.settings.spikeThresholdMs);

  const loadHistory = useCallback(() => {
    api.listReports<DiagnosticReport>().then(setHistory).catch(() => setHistory([]));
  }, []);
  useEffect(() => {
    loadHistory();
    return () => {
      cancelled.current = true;
    };
  }, [loadHistory]);

  const run = async () => {
    cancelled.current = false;
    setError(null);
    setReport(null);
    const plan: Record<StepId, StepState> = {
      connection: 'pending',
      ping: 'pending',
      dns: 'pending',
      scan: includeScan ? 'pending' : 'skipped',
      speed: includeSpeed ? 'pending' : 'skipped',
      system: 'pending',
      report: 'pending',
    };
    setSteps({ ...plan });
    const mark = (id: StepId, state: StepState) => {
      plan[id] = state;
      setSteps({ ...plan });
    };
    const soft = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
      try {
        return await fn();
      } catch {
        return null;
      }
    };

    try {
      mark('connection', 'running');
      await sleep(400);
      mark('connection', 'done');

      mark('ping', 'running');
      const startedAt = Date.now();
      const seconds = Number(duration);
      for (let left = seconds; left > 0; left--) {
        if (cancelled.current) return;
        setCountdown(left);
        await sleep(1000);
      }
      setCountdown(null);
      const live = useLiveStore.getState();
      const since = (id: string) => (live.ping[id] ?? []).filter((s) => s.ts >= startedAt);
      const gateway = computeStats(since(GATEWAY), spikeThreshold);
      const internet = computeStats(mergeInternet(INTERNET_TARGETS.map(since)), spikeThreshold);
      mark('ping', 'done');

      mark('dns', 'running');
      const dns: DnsTestResult | null = await soft(api.runDnsTest);
      mark('dns', 'done');

      let networks: BssInfo[] | null = null;
      if (includeScan) {
        mark('scan', 'running');
        networks = (await soft(api.scanNetworks))?.networks ?? null;
        mark('scan', 'done');
      } else {
        networks = (await soft(api.getNetworks))?.networks ?? null;
      }

      let speed: SpeedResult | null = null;
      if (includeSpeed) {
        mark('speed', 'running');
        speed = await soft(() => api.runSpeedtest(null));
        mark('speed', 'done');
      }

      mark('system', 'running');
      const system: SystemChecks | null = await soft(api.getSystemChecks);
      mark('system', 'done');

      mark('report', 'running');
      const wifi = useLiveStore.getState().wifi;
      const sys = dns?.servers.find((s) => s.id === 'system');
      const base = {
        adapterPresent: wifi ? wifi.state !== 'no_adapter' : true,
        connected: wifi?.state === 'connected',
        rssi: wifi?.connection?.rssi ?? null,
        gateway,
        internet,
        dnsMs: sys?.avgMs ?? null,
        dnsFailed: !!sys && sys.avgMs === null,
      };
      const diagnosis = diagnose(base);
      const health = alignWithVerdict(computeHealth(base), diagnosis.severity);
      const built = buildReport({ wifi, gateway, internet, diagnosis, health, dns, networks, speed, system }, t);
      await soft(() => api.saveReport(built));
      mark('report', 'done');
      setReport(built);
      loadHistory();
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setCountdown(null);
    }
  };

  const running = steps !== null && !report && !error && Object.values(steps).some((s) => s === 'pending' || s === 'running');

  return (
    <>
      <PageHeader
        title={t.wizard.title}
        subtitle={t.wizard.subtitle}
        actions={
          report && (
            <Button onClick={() => { setReport(null); setSteps(null); }}>
              <RotateCcw aria-hidden />
              {t.wizard.again}
            </Button>
          )
        }
      />
      {error && (
        <div className="mb-5">
          <Banner severity="bad" title={error} />
        </div>
      )}

      {report ? (
        <ReportView report={report} />
      ) : (
        <div className="grid grid-cols-12 gap-5">
          <GlassCard className="col-span-7 flex flex-col items-center justify-center px-10 py-12 text-center">
            {running && steps ? (
              <div className="w-full max-w-md text-left">
                <p className="mb-5 text-[17px] font-semibold text-fg">{t.wizard.running}</p>
                <ol className="space-y-3">
                  {(Object.keys(steps) as StepId[])
                    .filter((id) => steps[id] !== 'skipped')
                    .map((id) => (
                      <motion.li key={id} layout className="flex items-center gap-3 text-[14px]">
                        {steps[id] === 'done' ? (
                          <span className="flex size-6 items-center justify-center rounded-full bg-ok-soft text-ok">
                            <Check className="size-3.5" aria-hidden />
                          </span>
                        ) : steps[id] === 'running' ? (
                          <Loader2 className="size-6 animate-spin text-blue" aria-hidden />
                        ) : (
                          <Circle className="size-6 text-fg-faint" strokeWidth={1.5} aria-hidden />
                        )}
                        <span className={cn(steps[id] === 'pending' ? 'text-fg-faint' : 'text-fg', steps[id] === 'running' && 'font-medium')}>
                          {t.wizard.steps[id]}
                          {id === 'ping' && countdown !== null && <span className="num ml-2 text-fg-muted">{countdown} s</span>}
                        </span>
                      </motion.li>
                    ))}
                </ol>
              </div>
            ) : (
              <>
                <div className="accent-gradient mb-6 flex size-20 items-center justify-center rounded-[26px] text-white shadow-[0_18px_40px_-16px_var(--blue)]">
                  <Stethoscope className="size-9" strokeWidth={1.6} aria-hidden />
                </div>
                <p className="mb-6 max-w-[46ch] text-[14px] text-fg-muted">{t.wizard.subtitle}</p>
                <Button variant="primary" size="lg" onClick={run}>
                  {t.wizard.start}
                </Button>
              </>
            )}
          </GlassCard>

          <div className="col-span-5 flex flex-col gap-5">
            <GlassCard>
              <Field label={t.wizard.duration}>
                <Segmented ariaLabel={t.wizard.duration} value={duration} onChange={setDuration} options={[{ value: '30', label: '30 s' }, { value: '60', label: '60 s' }]} />
              </Field>
              <Field
                htmlFor="wiz-scan"
                label={
                  <span className="inline-flex items-center gap-1.5">
                    {t.wizard.includeScan} <InfoTip content={t.explain.scanNote} />
                  </span>
                }
              >
                <Switch id="wiz-scan" checked={includeScan} onCheckedChange={setIncludeScan} disabled={running} />
              </Field>
              <Field htmlFor="wiz-speed" label={t.wizard.includeSpeed} hint={t.speed.dataNote}>
                <Switch id="wiz-speed" checked={includeSpeed} onCheckedChange={setIncludeSpeed} disabled={running} />
              </Field>
            </GlassCard>

            {history.length > 0 && (
              <GlassCard title={t.wizard.history}>
                <ul className="-mx-2 max-h-[300px] space-y-0.5 overflow-y-auto">
                  {history.map((h) => (
                    <li key={h.id}>
                      <button
                        type="button"
                        onClick={() => setReport(h.data)}
                        className="flex w-full items-center justify-between gap-3 rounded-xl px-2 py-2 text-left text-[13px] transition-colors hover:bg-glass-hover"
                      >
                        <span className="min-w-0">
                          <span className="block text-fg">{fmtDateTime(h.ts)}</span>
                          <span className="block truncate text-[12px] text-fg-muted">{h.data.verdict?.where}</span>
                        </span>
                        <span className={cn('num text-[15px] font-semibold', { good: 'text-ok', fair: 'text-warn', poor: 'text-bad' }[h.data.health?.level ?? 'fair'])}>
                          {h.data.health?.score ?? '—'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </GlassCard>
            )}
          </div>
        </div>
      )}
    </>
  );
};
