import ReactEChartsCore from 'echarts-for-react/esm/core';
import type { EChartsOption } from 'echarts';
import { echarts } from './echarts';

interface ChartProps {
  option: EChartsOption;
  height: number | string;
  className?: string;
  /** Replace the whole option instead of merging (needed when series count changes). */
  notMerge?: boolean;
  ariaLabel?: string;
}

export const Chart = ({ option, height, className, notMerge = false, ariaLabel }: ChartProps) => (
  <div role="img" aria-label={ariaLabel} className={className}>
    <ReactEChartsCore
      echarts={echarts}
      option={option}
      notMerge={notMerge}
      lazyUpdate
      style={{ height, width: '100%' }}
      opts={{ renderer: 'canvas' }}
    />
  </div>
);
