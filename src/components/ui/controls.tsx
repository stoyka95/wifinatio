import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { Switch as SwitchPrimitive } from 'radix-ui';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'glass-strong h-10 w-full rounded-xl px-3 text-sm text-fg placeholder:text-fg-faint focus-visible:outline-2',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <div className={cn('relative', className)}>
      <select
        ref={ref}
        className="glass-strong h-10 w-full cursor-pointer appearance-none rounded-xl pr-9 pl-3 text-sm text-fg"
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-fg-faint" aria-hidden />
    </div>
  ),
);
Select.displayName = 'Select';

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  id?: string;
  disabled?: boolean;
}

export const Switch = ({ checked, onCheckedChange, id, disabled }: SwitchProps) => (
  <SwitchPrimitive.Root
    id={id}
    checked={checked}
    disabled={disabled}
    onCheckedChange={onCheckedChange}
    className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full bg-track transition-colors data-[state=checked]:bg-blue disabled:opacity-50"
  >
    <SwitchPrimitive.Thumb className="block size-5 translate-x-0.5 rounded-full bg-white shadow transition-transform duration-200 data-[state=checked]:translate-x-[22px]" />
  </SwitchPrimitive.Root>
);

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode }[];
  ariaLabel: string;
  size?: 'sm' | 'md';
}

/** Compact radio group styled as a segmented control. */
export const Segmented = <T extends string>({ value, onChange, options, ariaLabel, size = 'sm' }: SegmentedProps<T>) => (
  <div role="radiogroup" aria-label={ariaLabel} className="glass-strong inline-flex rounded-xl p-0.5">
    {options.map((o) => {
      const active = o.value === value;
      return (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={active}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded-[10px] font-medium transition-colors duration-150',
            size === 'sm' ? 'h-7 px-2.5 text-[12.5px]' : 'h-9 px-3.5 text-sm',
            active ? 'bg-[var(--glass-highlight)] text-fg shadow-sm dark:bg-white/12' : 'text-fg-muted hover:text-fg',
          )}
        >
          {o.label}
        </button>
      );
    })}
  </div>
);

export const Field = ({ label, hint, htmlFor, children }: { label: ReactNode; hint?: ReactNode; htmlFor?: string; children: ReactNode }) => (
  <div className="flex items-center justify-between gap-6 py-3">
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="text-sm font-medium text-fg">
        {label}
      </label>
      {hint && <p className="mt-0.5 text-[12.5px] text-fg-muted">{hint}</p>}
    </div>
    <div className="shrink-0">{children}</div>
  </div>
);
