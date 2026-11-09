import { motion, useReducedMotion } from 'framer-motion';
import { AnimatedNumber } from '@/components/glass/AnimatedNumber';

interface SpeedDialProps {
  mbps: number | null;
  label: string;
  progress: number;
}

const SIZE = 300;
const C = SIZE / 2;
const R = 120;
const START = 150;
const SWEEP = 240;

/** Logarithmic scale so 5 Mb/s and 1 Gb/s both read well on one dial. */
const scale = (mbps: number) => Math.min(1, Math.log10(1 + mbps) / Math.log10(1 + 1000));
const TICKS = [0, 10, 50, 100, 250, 500, 1000];

const point = (r: number, deg: number) => {
  const rad = (deg * Math.PI) / 180;
  return { x: C + r * Math.cos(rad), y: C + r * Math.sin(rad) };
};

const arcPath = (r: number, from: number, to: number) => {
  const a = point(r, from);
  const b = point(r, to);
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${b.x} ${b.y}`;
};

export const SpeedDial = ({ mbps, label, progress }: SpeedDialProps) => {
  const reduced = useReducedMotion();
  const fraction = mbps === null ? 0 : scale(mbps);
  const track = arcPath(R, START, START + SWEEP);
  return (
    <figure className="relative mx-auto w-[300px]" aria-live="polite" aria-label={`${label}: ${mbps === null ? '—' : Math.round(mbps)} Mb/s`}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE * 0.86}`} className="w-full overflow-visible" aria-hidden>
        <defs>
          <linearGradient id="dial" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="var(--cyan)" />
            <stop offset="0.55" stopColor="var(--blue)" />
            <stop offset="1" stopColor="var(--violet)" />
          </linearGradient>
        </defs>
        <path d={track} fill="none" stroke="var(--track)" strokeWidth={16} strokeLinecap="round" />
        <motion.path
          d={track}
          fill="none"
          stroke="url(#dial)"
          strokeWidth={16}
          strokeLinecap="round"
          initial={false}
          animate={{ pathLength: fraction, opacity: fraction > 0 ? 1 : 0 }}
          transition={{ duration: reduced ? 0 : 0.35, ease: 'easeOut' }}
        />
        {progress > 0.005 && (
          <path d={arcPath(R + 18, START, START + SWEEP * Math.min(progress, 0.999))} fill="none" stroke="var(--fg-faint)" strokeOpacity={0.5} strokeWidth={2} strokeLinecap="round" />
        )}
        {TICKS.map((v) => {
          const deg = START + SWEEP * scale(v);
          const p = point(R - 30, deg);
          return (
            <text key={v} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" fontSize={11} fill="var(--fg-faint)" className="num">
              {v}
            </text>
          );
        })}
      </svg>
      <figcaption className="absolute inset-x-0 top-[38%] flex flex-col items-center">
        <AnimatedNumber value={mbps === null ? null : Math.round(mbps * 10) / 10} digits={mbps !== null && mbps < 10 ? 1 : 0} className="text-[52px] leading-none font-semibold tracking-[-0.04em] text-fg" />
        <span className="mt-1 text-[13px] text-fg-muted">Mb/s</span>
        <span className="mt-2 text-[13px] font-medium text-fg">{label}</span>
      </figcaption>
    </figure>
  );
};
