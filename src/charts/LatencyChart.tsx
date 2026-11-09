import { useMemo } from 'react';
import type { EChartsOption, SeriesOption } from 'echarts';
import { fmtTime } from '@/lib/format';
import { median } from '@/lib/stats';
import type { PingSample } from '@/lib/types';
import { Chart } from './Chart';
import { axisStyle, baseTooltip, useChartColors } from './echarts';

export interface LatencySeries {
  id: string;
  label: string;
  samples: PingSample[];
}

interface LatencyChartProps {
  series: LatencySeries[];
  spikeThresholdMs: number;
  windowMs: number;
  now: number;
  height?: number;
  labels: { lost: string; spike: string; scan: string };
}

/** Contiguous time ranges in which samples were taken during a Wi-Fi scan. */
const scanRanges = (samples: PingSample[]): [number, number][] => {
  const ranges: [number, number][] = [];
  let start: number | null = null;
  let last = 0;
  for (const s of samples) {
    if (s.scan && start === null) start = s.ts;
    if (!s.scan && start !== null) {
      ranges.push([start, last]);
      start = null;
    }
    last = s.ts;
  }
  if (start !== null) ranges.push([start, last]);
  return ranges;
};

export const LatencyChart = ({ series, spikeThresholdMs, windowMs, now, height = 320, labels }: LatencyChartProps) => {
  const c = useChartColors();

  const option = useMemo<EChartsOption>(() => {
    const colors = [c.cyan, c.blue, c.violet, ...c.palette.slice(3)];
    const allSamples = series.flatMap((s) => s.samples);
    const maxRtt = Math.max(10, ...allSamples.map((s) => s.rtt ?? 0));
    const lostY = maxRtt * 1.06;
    const out: SeriesOption[] = [];
    series.forEach((s, i) => {
      const color = colors[i % colors.length];
      const replies = s.samples.filter((x) => x.rtt !== null && !x.scan).map((x) => x.rtt as number);
      const med = median(replies);
      out.push({
        type: 'line',
        name: s.label,
        data: s.samples.map((x) => [x.ts, x.rtt]),
        showSymbol: false,
        connectNulls: false,
        smooth: 0.2,
        sampling: 'lttb',
        lineStyle: { width: i === 0 ? 2 : 1.6, color },
        itemStyle: { color },
        emphasis: { disabled: true },
        markArea:
          i === 0
            ? {
                silent: true,
                itemStyle: { color: `${c.faint}22` },
                label: { show: true, color: c.faint, fontSize: 10, position: 'insideTop', formatter: labels.scan },
                data: scanRanges(s.samples).map(([a, b]) => [{ xAxis: a - 500 }, { xAxis: b + 500 }]),
              }
            : undefined,
      });
      if (med !== null) {
        out.push({
          type: 'scatter',
          name: `${s.label} – ${labels.spike}`,
          data: s.samples.filter((x) => x.rtt !== null && !x.scan && x.rtt > med + spikeThresholdMs).map((x) => [x.ts, x.rtt]),
          symbolSize: 7,
          itemStyle: { color: c.bad, borderColor: color, borderWidth: 1.5 },
          tooltip: { show: false },
          z: 5,
        });
      }
      out.push({
        type: 'scatter',
        name: `${s.label} – ${labels.lost}`,
        data: s.samples.filter((x) => x.rtt === null && !x.scan).map((x) => [x.ts, lostY]),
        symbol: 'triangle',
        symbolRotate: 180,
        symbolSize: 8,
        itemStyle: { color: c.bad },
        tooltip: { show: false },
        z: 5,
      });
    });

    return {
      animation: false,
      grid: { left: 44, right: 16, top: 36, bottom: 28 },
      legend: {
        top: 0,
        left: 0,
        icon: 'roundRect',
        itemWidth: 12,
        itemHeight: 4,
        textStyle: { color: c.muted, fontSize: 12 },
        data: series.map((s) => s.label),
      },
      tooltip: {
        ...baseTooltip(c),
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: c.faint } },
        formatter: (params) => {
          const list = (Array.isArray(params) ? params : [params]).filter((p) => p.seriesType === 'line');
          if (!list.length) return '';
          const ts = (list[0].value as [number, number])[0];
          const rows = list
            .map((p) => {
              const v = (p.value as [number, number | null])[1];
              return `<div style="display:flex;justify-content:space-between;gap:16px"><span>${p.marker}${p.seriesName}</span><b>${v === null || v === undefined ? labels.lost : `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`}</b></div>`;
            })
            .join('');
          return `<div style="font-size:11px;opacity:.7;margin-bottom:4px">${fmtTime(ts)}</div>${rows}`;
        },
      },
      xAxis: {
        type: 'time',
        min: now - windowMs,
        max: now,
        ...axisStyle(c),
        splitLine: { show: false },
        axisLabel: { ...axisStyle(c).axisLabel, hideOverlap: true, formatter: (v: number) => fmtTime(v).slice(0, windowMs > 10 * 60_000 ? 5 : 8) },
      },
      yAxis: { type: 'value', min: 0, ...axisStyle(c), axisLabel: { ...axisStyle(c).axisLabel, formatter: '{value} ms' } },
      series: out,
    };
  }, [series, spikeThresholdMs, windowMs, now, c, labels]);

  return <Chart option={option} height={height} notMerge ariaLabel={series.map((s) => s.label).join(', ')} />;
};
