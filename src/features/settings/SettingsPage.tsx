import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { Trash2 } from 'lucide-react';
import logo from '@/assets/logo.svg';
import { GlassCard } from '@/components/glass/GlassCard';
import { PageHeader } from '@/components/glass/PageHeader';
import { Button } from '@/components/ui/button';
import { Field, Input, Segmented, Select, Switch } from '@/components/ui/controls';
import { api } from '@/lib/api';
import { reloadPingHistory } from '@/lib/bridge';
import { confirmAction } from '@/lib/dialog';
import { useT } from '@/lib/i18n';
import type { HistoryKind, Settings } from '@/lib/types';
import { isMobile } from '@/lib/platform';
import { useSettingsStore } from '@/stores/settings';

const INTERVALS = [500, 1000, 2000, 5000];
const SPIKES = [20, 30, 50, 100, 200];
const WEAK = [-65, -67, -70, -75, -80];
const AUTO_SCAN = [0, 5, 15, 30, 60];

export const SettingsPage = () => {
  const t = useT();
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const [targets, setTargets] = useState(settings.customTargets.join(', '));
  const [status, setStatus] = useState<string | null>(null);
  const [version, setVersion] = useState('1.0.0');

  useEffect(() => {
    getVersion().then(setVersion).catch(() => undefined);
  }, []);

  const flash = (text: string) => {
    setStatus(text);
    window.setTimeout(() => setStatus(null), 1800);
  };

  const apply = async (patch: Partial<Settings>, restartsPing = false) => {
    await update(patch);
    if (restartsPing) await reloadPingHistory();
    flash(t.settings.saved);
  };

  const saveTargets = () => {
    const list = targets
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 5);
    apply({ customTargets: list }, true);
  };

  const clear = async (kind: HistoryKind) => {
    if (!(await confirmAction(t.settings.clearConfirm))) return;
    await api.clearHistory(kind);
    flash(t.settings.cleared);
  };

  return (
    <>
      <PageHeader title={t.settings.title} actions={status && <span className="text-[13px] font-medium text-ok" role="status">{status}</span>} />
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-5">
          <GlassCard title={t.settings.measurement}>
            <div className="divide-y divide-line">
              <Field label={t.settings.pingInterval} htmlFor="interval">
                <Select id="interval" value={settings.pingIntervalMs} onChange={(e) => apply({ pingIntervalMs: Number(e.target.value) }, true)} className="w-36">
                  {INTERVALS.map((ms) => (
                    <option key={ms} value={ms}>
                      {ms < 1000 ? `${ms} ms` : `${ms / 1000} s`}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="py-3">
                <label htmlFor="targets" className="text-sm font-medium text-fg">
                  {t.settings.customTargets}
                </label>
                <p className="mt-0.5 mb-2 text-[12.5px] text-fg-muted">{t.settings.customTargetsHint}</p>
                <div className="flex gap-2">
                  <Input id="targets" value={targets} onChange={(e) => setTargets(e.target.value)} placeholder="9.9.9.9, seznam.cz" />
                  <Button onClick={saveTargets}>{t.common.save}</Button>
                </div>
              </div>
              <Field label={t.settings.spikeThreshold} hint={t.settings.spikeThresholdHint} htmlFor="spike">
                <Select id="spike" value={settings.spikeThresholdMs} onChange={(e) => apply({ spikeThresholdMs: Number(e.target.value) })} className="w-36">
                  {SPIKES.map((ms) => (
                    <option key={ms} value={ms}>
                      +{ms} ms
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t.settings.weakSignal} htmlFor="weak">
                <Select id="weak" value={settings.weakSignalDbm} onChange={(e) => apply({ weakSignalDbm: Number(e.target.value) })} className="w-36">
                  {WEAK.map((dbm) => (
                    <option key={dbm} value={dbm}>
                      {dbm} dBm
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t.settings.autoScan} hint={t.settings.autoScanHint} htmlFor="autoscan">
                <Select id="autoscan" value={settings.autoScanMinutes} onChange={(e) => apply({ autoScanMinutes: Number(e.target.value) })} className="w-48">
                  {AUTO_SCAN.map((m) => (
                    <option key={m} value={m}>
                      {m === 0 ? t.settings.autoScanOff : t.settings.autoScanEvery(m)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </GlassCard>

          <GlassCard title={t.settings.data}>
            <div className="flex flex-wrap gap-2">
              {(['events', 'speedtests', 'snapshots', 'reports'] as HistoryKind[]).map((kind) => (
                <Button key={kind} size="sm" onClick={() => clear(kind)}>
                  {t.settings.clear[kind as keyof typeof t.settings.clear]}
                </Button>
              ))}
              <Button size="sm" variant="danger" onClick={() => clear('all')}>
                <Trash2 aria-hidden />
                {t.settings.clear.all}
              </Button>
            </div>
          </GlassCard>
        </div>

        <div className="flex flex-col gap-5">
          <GlassCard title={t.settings.appearance}>
            <div className="divide-y divide-line">
              <Field label={t.settings.language}>
                <Segmented
                  ariaLabel={t.settings.language}
                  value={settings.language}
                  onChange={(language) => apply({ language })}
                  options={[
                    { value: 'cs', label: 'Čeština' },
                    { value: 'en', label: 'English' },
                  ]}
                />
              </Field>
              <Field label={t.settings.theme}>
                <Segmented
                  ariaLabel={t.settings.theme}
                  value={settings.theme}
                  onChange={(theme) => apply({ theme })}
                  options={(['dark', 'light', 'system'] as const).map((v) => ({ value: v, label: t.settings.themes[v] }))}
                />
              </Field>
            </div>
          </GlassCard>

          <GlassCard title={t.settings.behaviour}>
            <div className="divide-y divide-line">
              {!isMobile && (
                <Field label={t.settings.tray} hint={t.settings.trayHint} htmlFor="tray">
                  <Switch id="tray" checked={settings.runInTray} onCheckedChange={(runInTray) => apply({ runInTray })} />
                </Field>
              )}
              <Field label={t.settings.notifications} htmlFor="notify">
                <Switch id="notify" checked={settings.notifications} onCheckedChange={(notifications) => apply({ notifications })} />
              </Field>
            </div>
          </GlassCard>

          <GlassCard title={t.settings.about}>
            <div className="flex items-center gap-4">
              <img src={logo} alt="" className="size-14" />
              <div>
                <p className="text-[15px] font-semibold text-fg">{t.settings.version(version)}</p>
                <p className="text-[12.5px] text-fg-muted">© 2026 Semakod</p>
              </div>
            </div>
          </GlassCard>
        </div>
      </div>
    </>
  );
};
