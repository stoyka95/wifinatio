import { useState } from 'react';
import { Check, Copy, FileDown, FileJson, Printer, ShieldAlert } from 'lucide-react';
import logo from '@/assets/logo.svg';
import { GlassCard } from '@/components/glass/GlassCard';
import { SeverityIcon } from '@/components/glass/status';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { copyText, saveTextFile } from '@/lib/dialog';
import { fmtDateTime } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { reportToMarkdown, type DiagnosticReport, type ReportSection } from '@/lib/report';

const CopyCommand = ({ command }: { command: string }) => {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 flex items-center gap-2 rounded-xl bg-track py-1.5 pr-1.5 pl-3">
      <code className="selectable num min-w-0 flex-1 truncate text-[12.5px] text-fg print:break-all print:whitespace-normal" title={command}>
        {command}
      </code>
      <Button
        size="sm"
        variant="ghost"
        className="no-print"
        onClick={async () => {
          await copyText(command);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        {copied ? t.common.copied : t.wizard.copyCommand}
      </Button>
    </div>
  );
};

const scoreColor = { good: 'text-ok', fair: 'text-warn', poor: 'text-bad' } as const;

export const ReportView = ({ report }: { report: DiagnosticReport }) => {
  const t = useT();
  const [saved, setSaved] = useState<string | null>(null);
  const stamp = new Date(report.ts).toISOString().slice(0, 16).replace(/[:T]/g, '-');

  const exportFile = async (kind: 'md' | 'json') => {
    const contents = kind === 'md' ? reportToMarkdown(report, t) : JSON.stringify(report, null, 2);
    if (await saveTextFile(`wifinatio-${stamp}.${kind}`, contents, kind)) {
      setSaved(t.wizard.exported);
      window.setTimeout(() => setSaved(null), 2000);
    }
  };

  const sections = (Object.keys(t.report.sections) as ReportSection[]).filter((s) => report.findings.some((f) => f.section === s));

  return (
    <div className="print-area space-y-5">
      <GlassCard className="p-6">
        <div className="flex items-start justify-between gap-6">
          <div className="flex items-center gap-3">
            <img src={logo} alt="" className="size-10" />
            <div>
              <h2 className="text-[19px] font-semibold tracking-[-0.02em] text-fg">{t.wizard.reportTitle}</h2>
              <p className="text-[12.5px] text-fg-muted">{t.report.generated(fmtDateTime(report.ts))}</p>
            </div>
          </div>
          <div className="text-right">
            <p className={cn('num text-[34px] leading-none font-semibold tracking-[-0.03em]', scoreColor[report.health.level])}>
              {report.health.score}
              <span className="text-[15px] text-fg-faint">/100</span>
            </p>
            <p className="text-[12.5px] text-fg-muted">{t.health.title}</p>
          </div>
        </div>
        <div className="mt-6 flex items-start gap-3 border-t border-line pt-5">
          <SeverityIcon severity={report.verdict.severity} className="mt-0.5 size-6" />
          <div>
            <p className="text-[12.5px] font-medium text-fg-muted">{t.wizard.verdict}</p>
            <p className="mt-0.5 text-[18px] leading-snug font-semibold text-fg">{report.verdict.text}</p>
            <p className="accent-text mt-1 text-[13.5px] font-semibold">{report.verdict.where}</p>
          </div>
        </div>
        <div className="no-print mt-5 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => exportFile('md')}>
            <FileDown aria-hidden />
            {t.wizard.exportMd}
          </Button>
          <Button size="sm" onClick={() => window.print()}>
            <Printer aria-hidden />
            {t.wizard.exportPdf}
          </Button>
          <Button size="sm" onClick={() => exportFile('json')}>
            <FileJson aria-hidden />
            {t.wizard.exportJson}
          </Button>
          {saved && <span className="text-[12.5px] font-medium text-ok">{saved}</span>}
        </div>
      </GlassCard>

      <div className="grid grid-cols-2 items-start gap-5">
        <GlassCard title={t.wizard.findings}>
          <div className="space-y-5">
            {sections.map((section) => (
              <section key={section}>
                <h3 className="mb-2 text-[12.5px] font-medium text-fg-muted">{t.report.sections[section]}</h3>
                <ul className="space-y-2">
                  {report.findings
                    .filter((f) => f.section === section)
                    .map((f, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-[13.5px] text-fg">
                        <SeverityIcon severity={f.status} className="mt-px size-[18px]" />
                        <span>{f.text}</span>
                      </li>
                    ))}
                </ul>
              </section>
            ))}
          </div>
        </GlassCard>

        <GlassCard title={t.wizard.steps2}>
          <ol className="space-y-4">
            {report.actions.map((action, i) => (
              <li key={action.id} className="flex gap-3">
                <span className="glass-strong num flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold text-fg">{i + 1}</span>
                <div className="min-w-0 flex-1 text-[13.5px] text-fg">
                  <p>
                    {action.text}
                    {action.admin && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-warn-soft px-2 py-0.5 align-middle text-[11.5px] font-medium text-warn">
                        <ShieldAlert className="size-3" aria-hidden />
                        {t.common.adminRequired}
                      </span>
                    )}
                  </p>
                  {action.command && <CopyCommand command={action.command} />}
                </div>
              </li>
            ))}
          </ol>
        </GlassCard>
      </div>
    </div>
  );
};
