import { motion, useReducedMotion } from 'framer-motion';
import type { Level } from '@/lib/rating';
import { AnimatedNumber } from './AnimatedNumber';

interface HealthGaugeProps {
  score: number | null;
  level: Level | null;
  label: string;
  caption: string;
}

const SIZE = 220;
const CENTER = SIZE / 2;
const RADIUS = 84;
const SWEEP = 270;
const START = 135;

const polar = (r: number, deg: number) => {
  const rad = (deg * Math.PI) / 180;
  return { x: CENTER + r * Math.cos(rad), y: CENTER + r * Math.sin(rad) };
};

const arc = (r: number, from: number, to: number) => {
  const a = polar(r, from);
  const b = polar(r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`;
};

const levelColor: Record<Level, string> = { good: 'var(--ok)', fair: 'var(--warn)', poor: 'var(--bad)' };

/**
 * Health ring. The two thin outer arcs echo the signal waves of the app icon and
 * light up with the score, so the gauge reads as "signal" at a glance.
 */
export const HealthGauge = ({ score, level, label, caption }: HealthGaugeProps) => {
  const reduced = useReducedMotion();
  const fraction = score === null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  const color = level ? levelColor[level] : 'var(--fg-faint)';
  const track = arc(RADIUS, START, START + SWEEP);
  const waves = [
    { r: RADIUS + 16, from: 232, to: 308, on: fraction > 0.55 },
    { r: RADIUS + 28, from: 244, to: 296, on: fraction > 0.8 },
  ];

  return (
    <figure className="relative mx-auto flex w-[220px] flex-col items-center" aria-label={`${label}: ${score ?? '—'} / 100`}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-[220px] w-[220px] overflow-visible" aria-hidden>
        <defs>
          <filter id="gauge-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>
        {waves.map((w) => (
          <path
            key={w.r}
            d={arc(w.r, w.from, w.to)}
            fill="none"
            strokeWidth={3}
            strokeLinecap="round"
            stroke={w.on ? color : 'var(--track)'}
            style={{ transition: 'stroke 300ms ease' }}
          />
        ))}
        <path d={track} fill="none" stroke="var(--track)" strokeWidth={14} strokeLinecap="round" />
        <motion.path
          d={track}
          fill="none"
          stroke={color}
          strokeWidth={14}
          strokeLinecap="round"
          filter="url(#gauge-glow)"
          initial={false}
          animate={{ pathLength: fraction, opacity: fraction > 0 ? 0.45 : 0 }}
          transition={{ duration: reduced ? 0 : 0.8, ease: [0.22, 1, 0.36, 1] }}
        />
        <motion.path
          d={track}
          fill="none"
          stroke={color}
          strokeWidth={14}
          strokeLinecap="round"
          initial={false}
          animate={{ pathLength: fraction, opacity: fraction > 0 ? 1 : 0 }}
          transition={{ duration: reduced ? 0 : 0.8, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <figcaption className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pt-2">
        <AnimatedNumber value={score} className="text-[56px] leading-none font-semibold tracking-[-0.04em] text-fg" />
        <span className="mt-2 text-[13px] font-medium" style={{ color }}>
          {caption}
        </span>
      </figcaption>
    </figure>
  );
};
