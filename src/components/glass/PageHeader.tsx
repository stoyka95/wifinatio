import type { ReactNode } from 'react';

export const PageHeader = ({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) => (
  <header className="mb-5 flex lg:mb-6 flex-wrap items-end justify-between gap-4">
    <div className="min-w-0">
      <h1 className="text-[22px] leading-tight lg:text-[26px] font-semibold tracking-[-0.025em] text-fg">{title}</h1>
      {subtitle && <p className="mt-1 max-w-[70ch] text-[13.5px] text-fg-muted">{subtitle}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </header>
);
