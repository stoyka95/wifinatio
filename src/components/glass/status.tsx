import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { Level } from '@/lib/rating';
import type { Severity } from '@/lib/types';
import { useT } from '@/lib/i18n';

export const levelText: Record<Level, string> = { good: 'text-ok', fair: 'text-warn', poor: 'text-bad' };
export const levelBg: Record<Level, string> = { good: 'bg-ok', fair: 'bg-warn', poor: 'bg-bad' };
export const levelSoft: Record<Level, string> = { good: 'bg-ok-soft', fair: 'bg-warn-soft', poor: 'bg-bad-soft' };

export const severityLevel = (s: Severity | 'warn' | 'bad' | 'ok' | 'info'): Level | null =>
  s === 'ok' ? 'good' : s === 'warn' ? 'fair' : s === 'bad' ? 'poor' : null;

export const LevelDot = ({ level, className }: { level: Level | null; className?: string }) => (
  <span
    aria-hidden
    className={cn('inline-block size-2 shrink-0 rounded-full', level ? levelBg[level] : 'bg-fg-faint', className)}
  />
);

export const LevelBadge = ({ level, children }: { level: Level; children?: ReactNode }) => {
  const t = useT();
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-medium', levelSoft[level], levelText[level])}>
      <LevelDot level={level} className="size-1.5" />
      {children ?? t.levels[level]}
    </span>
  );
};

const severityIcon = { ok: CheckCircle2, warn: AlertTriangle, bad: XCircle, info: Info } as const;

export const SeverityIcon = ({ severity, className }: { severity: keyof typeof severityIcon; className?: string }) => {
  const Icon = severityIcon[severity];
  const color = { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad', info: 'text-blue' }[severity];
  return <Icon className={cn('size-5 shrink-0', color, className)} aria-hidden />;
};

export const Skeleton = ({ className }: { className?: string }) => <div className={cn('skeleton', className)} aria-hidden />;

interface EmptyStateProps {
  icon: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export const EmptyState = ({ icon, title, body, action, className }: EmptyStateProps) => (
  <motion.div
    initial={{ opacity: 0, y: 6 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.25 }}
    className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}
  >
    <div className="glass-strong mb-4 flex size-12 items-center justify-center rounded-2xl text-fg-muted [&_svg]:size-6">{icon}</div>
    <p className="text-[15px] font-semibold text-fg">{title}</p>
    {body && <p className="mt-1 max-w-[46ch] text-[13px] text-fg-muted">{body}</p>}
    {action && <div className="mt-5">{action}</div>}
  </motion.div>
);

export const Banner = ({
  severity,
  title,
  children,
  action,
}: {
  severity: 'ok' | 'warn' | 'bad' | 'info';
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) => (
  <div
    role="status"
    className={cn(
      'flex items-start gap-3 rounded-2xl border px-4 py-3.5',
      severity === 'ok' && 'border-ok/25 bg-ok-soft',
      severity === 'bad' && 'border-bad/25 bg-bad-soft',
      severity === 'warn' && 'border-warn/25 bg-warn-soft',
      severity === 'info' && 'border-blue/20 bg-[color-mix(in_srgb,var(--blue)_10%,transparent)]',
    )}
  >
    <SeverityIcon severity={severity} className="mt-0.5" />
    <div className="min-w-0 flex-1">
      <p className="text-sm font-semibold text-fg">{title}</p>
      {children && <div className="mt-0.5 text-[13px] text-fg-muted">{children}</div>}
    </div>
    {action && <div className="shrink-0 self-center">{action}</div>}
  </div>
);
