import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface GlassCardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  padded?: boolean;
}

export const GlassCard = ({ title, subtitle, actions, padded = true, className, children, ...props }: GlassCardProps) => (
  <section className={cn('glass rounded-[20px]', padded && 'p-5', className)} {...props}>
    {(title || actions) && (
      <header className={cn('mb-4 flex items-start justify-between gap-4', !padded && 'px-5 pt-5')}>
        <div className="min-w-0">
          {title && <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-fg">{title}</h2>}
          {subtitle && <p className="mt-0.5 text-[12.5px] text-fg-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
    )}
    {children}
  </section>
);
