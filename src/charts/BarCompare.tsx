import { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import { Chart } from './Chart';
import { axisStyle, baseTooltip, useChartColors } from './echarts';

interface BarCompareProps {
  categories: string[];
  values: (number | null)[];
  unit: string;
  /**
   * Baseline for negative scales such as dBm: bars grow from the floor upward
   * (-100 dBm is empty, -40 dBm is tall) while labels show the real value.
   */
  floor?: number;
  height?: number;
}

export const BarCompare = ({ categories, values, unit, floor, height = 260 }: BarCompareProps) => {
  const c = useChartColors();
  const option = useMemo<EChartsOption>(() => {
    const offset = floor ?? 0;
    const real = (v: number) => Math.round((v + offset) * 10) / 10;
    return {
      animationDuration: 400,
      grid: { left: 52, right: 12, top: 22, bottom: 32 },
      tooltip: {
        ...baseTooltip(c),
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        valueFormatter: (v) => (v === null || v === undefined ? '—' : `${real(Number(v))} ${unit}`),
      },
      xAxis: { type: 'category', data: categories, ...axisStyle(c), splitLine: { show: false } },
      yAxis: {
        type: 'value',
        min: 0,
        ...axisStyle(c),
        axisLabel: { ...axisStyle(c).axisLabel, formatter: (v: number) => String(real(v)) },
      },
      series: [
        {
          type: 'bar',
          barMaxWidth: 44,
          data: values.map((v) => (v === null ? null : v - offset)),
          itemStyle: {
            borderRadius: [8, 8, 2, 2],
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: c.cyan },
                { offset: 1, color: c.violet },
              ],
            },
          },
          label: {
            show: true,
            position: 'top',
            color: c.muted,
            fontSize: 11,
            formatter: (p) => (p.value === null || p.value === undefined ? '' : String(real(Number(p.value)))),
          },
        },
      ],
    };
  }, [categories, values, unit, floor, c]);
  return <Chart option={option} height={height} notMerge ariaLabel={categories.join(', ')} />;
};
