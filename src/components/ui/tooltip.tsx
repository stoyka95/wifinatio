import type { ReactNode } from 'react';
import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { Info } from 'lucide-react';
import { cn } from '@/lib/cn';

export const TooltipProvider = TooltipPrimitive.Provider;

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

export const Tooltip = ({ content, children, side = 'top', className }: TooltipProps) => (
  <TooltipPrimitive.Root>
    <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        side={side}
        sideOffset={8}
        collisionPadding={12}
        className={cn(
          'z-50 max-w-[300px] rounded-xl border border-glass-border bg-[color-mix(in_srgb,var(--glass-strong)_70%,var(--tint))] px-3 py-2 text-[12.5px] leading-relaxed text-fg shadow-xl backdrop-blur-2xl',
          className,
        )}
      >
        {content}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  </TooltipPrimitive.Root>
);

/** Small (i) affordance next to a label, revealing an explanation. */
export const InfoTip = ({ content, label }: { content: ReactNode; label?: string }) => (
  <Tooltip content={content}>
    <button
      type="button"
      aria-label={label ?? 'Info'}
      className="inline-flex size-4 items-center justify-center rounded-full text-fg-faint transition-colors hover:text-fg"
    >
      <Info className="size-3.5" aria-hidden />
    </button>
  </Tooltip>
);
