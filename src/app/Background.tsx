import { useEffect, useRef } from 'react';
import { useUiStore } from '@/stores/ui';

const FPS = 8;
/** Tiny backing store: the gradients are so soft that upscaling is invisible, and the
 * GPU keeps one small texture instead of several full-window layers. */
const W = 160;
const H = 100;

interface Blob {
  token: string;
  x: number;
  y: number;
  r: number;
  period: number;
  phase: number;
  ax: number;
  ay: number;
}

const BLOBS: Blob[] = [
  { token: '--blob-a', x: 0.12, y: 0.05, r: 0.62, period: 38_000, phase: 0, ax: 0.06, ay: 0.05 },
  { token: '--blob-b', x: 0.92, y: 0.4, r: 0.58, period: 46_000, phase: 1.7, ax: -0.05, ay: 0.07 },
  { token: '--blob-c', x: 0.5, y: 1.05, r: 0.55, period: 52_000, phase: 3.1, ax: 0.05, ay: -0.06 },
];

/**
 * Slow ambient colour fields behind the glass, drawn at 8 fps into a small canvas.
 * Paused while the window is hidden or unfocused; static for reduced motion.
 */
export const Background = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const theme = useUiStore((s) => s.resolvedTheme);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const style = getComputedStyle(document.documentElement);
    const colors = BLOBS.map((b) => style.getPropertyValue(b.token).trim());
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const start = performance.now();

    const draw = (t: number) => {
      ctx.clearRect(0, 0, W, H);
      BLOBS.forEach((b, i) => {
        const a = (t / b.period) * Math.PI * 2 + b.phase;
        const cx = (b.x + Math.sin(a) * b.ax) * W;
        const cy = (b.y + Math.cos(a * 0.8) * b.ay) * H;
        const r = b.r * W * (1 + Math.sin(a * 0.6) * 0.05);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, colors[i]);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      });
    };

    draw(0);
    const id = window.setInterval(() => {
      if (reduced.matches || document.documentElement.classList.contains('idle')) return;
      draw(performance.now() - start);
    }, 1000 / FPS);
    return () => window.clearInterval(id);
  }, [theme]);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
      <div className="app-tint absolute inset-0" />
      <canvas ref={canvasRef} width={W} height={H} className="absolute inset-0 h-full w-full" />
    </div>
  );
};
