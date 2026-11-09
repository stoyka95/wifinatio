import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { Level } from '@/lib/rating';
import { Tooltip } from '@/components/ui/tooltip';
import { LevelDot } from './status';

interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  level?: Level | null;
  hint?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * A labelled value with its rating dot. When `hint` is given the whole tile is a
 * focusable tooltip trigger, so the explanation is reachable by keyboard too.
 */
export const StatTile = ({ label, value, unit, level, hint, size = 'md', className }: StatTileProps) => {
  const body = (
    <div className={cn('min-w-0 rounded-xl text-left outline-none', hint && 'cursor-help', className)} tabIndex={hint ? 0 : undefined}>
      <div className="flex items-center gap-1.5 text-[12.5px] text-fg-muted">
        {level !== undefined && <LevelDot level={level} />}
        <span className="truncate">{label}</span>
      </div>
      <div
        className={cn(
          'num mt-1 font-semibold tracking-[-0.02em] text-fg',
          size === 'sm' && 'text-[17px]',
          size === 'md' && 'text-[22px]',
          size === 'lg' && 'text-[30px]',
        )}
      >
        {value}
        {unit && <span className="ml-1 text-[0.55em] font-medium text-fg-muted">{unit}</span>}
      </div>
    </div>
  );
  return hint ? <Tooltip content={hint}>{body}</Tooltip> : body;
};

/** Definition-list row for detail cards (label left, value right). */
export const InfoRow = ({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) => (
  <div className="flex items-baseline justify-between gap-4 border-b border-line py-2.5 last:border-b-0">
    <dt className="shrink-0 text-[13px] text-fg-muted">{label}</dt>
    <dd className="num selectable min-w-0 truncate text-right text-[13.5px] font-medium text-fg" title={typeof children === 'string' ? children : undefined}>
      {hint ? (
        <Tooltip content={hint}>
          <span tabIndex={0} className="cursor-help underline decoration-line decoration-dotted underline-offset-4">
            {children}
          </span>
        </Tooltip>
      ) : (
        children
      )}
    </dd>
  </div>
);
