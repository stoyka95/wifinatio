import { useEffect, useRef } from 'react';
import { animate, useReducedMotion } from 'framer-motion';
import { fmtNumber } from '@/lib/format';

interface AnimatedNumberProps {
  value: number | null;
  digits?: number;
  className?: string;
}

/** Counts smoothly to the new value; writes to the DOM directly to avoid re-renders. */
export const AnimatedNumber = ({ value, digits = 0, className }: AnimatedNumberProps) => {
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef<number | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (value === null) {
      node.textContent = '—';
      previous.current = null;
      return;
    }
    const from = previous.current ?? value;
    previous.current = value;
    if (reduced || from === value) {
      node.textContent = fmtNumber(value, digits);
      return;
    }
    const controls = animate(from, value, {
      duration: 0.3,
      ease: 'easeOut',
      onUpdate: (v) => {
        node.textContent = fmtNumber(v, digits);
      },
    });
    return () => controls.stop();
  }, [value, digits, reduced]);

  return <span ref={ref} className={className ? `num ${className}` : 'num'} />;
};
