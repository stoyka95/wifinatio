// Tree-shaken ECharts build: only the pieces Wifinatio draws.
import * as echarts from 'echarts/core';
import { BarChart, LineChart, ScatterChart } from 'echarts/charts';
import {
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { useMemo } from 'react';
import { isMobile } from '@/lib/platform';
import { useUiStore } from '@/stores/ui';

echarts.use([
  LineChart,
  BarChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  CanvasRenderer,
]);

export { echarts };

export interface ChartColors {
  fg: string;
  muted: string;
  faint: string;
  grid: string;
  cyan: string;
  blue: string;
  violet: string;
  ok: string;
  warn: string;
  bad: string;
  tooltipBg: string;
  tooltipBorder: string;
  /** Distinct series colours for many networks. */
  palette: string[];
}

const read = (style: CSSStyleDeclaration, name: string) => style.getPropertyValue(name).trim();

/** Chart colours resolved from the CSS tokens of the active theme. */
export const useChartColors = (): ChartColors => {
  const theme = useUiStore((s) => s.resolvedTheme);
  return useMemo(() => {
    const style = getComputedStyle(document.documentElement);
    const dark = theme === 'dark';
    return {
      fg: read(style, '--fg'),
      muted: read(style, '--fg-muted'),
      faint: read(style, '--fg-faint'),
      grid: read(style, '--chart-grid'),
      cyan: read(style, '--cyan'),
      blue: read(style, '--blue'),
      violet: read(style, '--violet'),
      ok: read(style, '--ok'),
      warn: read(style, '--warn'),
      bad: read(style, '--bad'),
      tooltipBg: dark ? 'rgba(16,22,46,0.92)' : 'rgba(255,255,255,0.96)',
      tooltipBorder: dark ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.1)',
      palette: dark
        ? ['#22d3ee', '#60a5fa', '#a78bfa', '#f472b6', '#34d399', '#fbbf24', '#fb923c', '#2dd4bf', '#818cf8', '#e879f9', '#a3e635', '#38bdf8']
        : ['#0891b2', '#2563eb', '#7c3aed', '#db2777', '#059669', '#b45309', '#ea580c', '#0d9488', '#4f46e5', '#c026d3', '#65a30d', '#0284c7'],
    };
  }, [theme]);
};

export const baseTooltip = (c: ChartColors) => ({
  backgroundColor: c.tooltipBg,
  borderColor: c.tooltipBorder,
  borderWidth: 1,
  padding: [8, 12],
  textStyle: { color: c.fg, fontFamily: 'Geist Variable, Segoe UI, sans-serif', fontSize: 12 },
  extraCssText: 'border-radius:12px;backdrop-filter:blur(16px);box-shadow:0 12px 32px -12px rgba(0,0,0,.4);',
  // On touch a tapped tooltip stays open; keep it inside the chart so it never covers the card title.
  confine: isMobile,
});

export const axisStyle = (c: ChartColors) => ({
  axisLine: { show: false },
  axisTick: { show: false },
  axisLabel: { color: c.faint, fontSize: 11, fontFamily: 'Geist Variable, Segoe UI, sans-serif' },
  splitLine: { lineStyle: { color: c.grid } },
});
