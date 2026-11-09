import { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import { Chart } from './Chart';
import { baseTooltip, useChartColors } from './echarts';

interface SparklineProps {
  points: [number, number | null][];
  color: 'cyan' | 'blue' | 'violet';
  height?: number;
  unit: string;
  /** Fixed y range, e.g. signal in dBm. */
  min?: number;
  max?: number;
  ariaLabel: string;
}

export const Sparkline = ({ points, color, height = 64, unit, min, max, ariaLabel }: SparklineProps) => {
  const c = useChartColors();
  const stroke = c[color];
  const option = useMemo<EChartsOption>(
    () => ({
      animation: false,
      grid: { left: 0, right: 0, top: 6, bottom: 2 },
      tooltip: {
        ...baseTooltip(c),
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: c.faint, width: 1 } },
        valueFormatter: (v) => (v === null || v === undefined ? '—' : `${Math.round(Number(v) * 10) / 10} ${unit}`),
      },
      xAxis: { type: 'time', show: false },
      // Pad the data range so a steady value sits mid-height instead of on an edge.
      yAxis: {
        type: 'value',
        show: false,
        scale: true,
        min: (v: { min: number; max: number }) => Math.max(min ?? -Infinity, v.min - Math.max(3, (v.max - v.min) * 0.15)),
        max: (v: { min: number; max: number }) => Math.min(max ?? Infinity, v.max + Math.max(3, (v.max - v.min) * 0.15)),
      },
      series: [
        {
          type: 'line',
          data: points,
          showSymbol: false,
          smooth: 0.35,
          connectNulls: false,
          lineStyle: { width: 2, color: stroke },
          areaStyle: {
            origin: 'start',
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `${stroke}55` },
                { offset: 1, color: `${stroke}00` },
              ],
            },
          },
        },
      ],
    }),
    [points, stroke, c, unit, min, max],
  );
  return <Chart option={option} height={height} ariaLabel={ariaLabel} />;
};
