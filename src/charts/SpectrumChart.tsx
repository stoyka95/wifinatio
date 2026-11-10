import { useMemo } from 'react';
import type { EChartsOption, SeriesOption } from 'echarts';
import { span } from '@/lib/channels';
import type { Band, BssInfo } from '@/lib/types';
import { Chart } from './Chart';
import { axisStyle, baseTooltip, useChartColors } from './echarts';

interface SpectrumChartProps {
  band: Band;
  networks: BssInfo[];
  ownSsid: string | null;
  hiddenLabel: string;
  height?: number;
}

const FLOOR = -100;
const STEPS = 28;

/** SSIDs are untrusted broadcast data and the tooltip renders HTML. */
const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);

const AXIS: Record<Band, { min: number; max: number; labels: number[] }> = {
  '2.4': { min: -1, max: 16, labels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] },
  '5': { min: 30, max: 170, labels: [36, 44, 52, 60, 100, 108, 116, 124, 132, 140, 149, 157, 165] },
  '6': { min: -3, max: 237, labels: [1, 33, 65, 97, 129, 161, 193, 225] },
};

/** Rounded hill: flat top that falls off smoothly (super-Gaussian), like a real channel mask. */
const hill = (from: number, to: number, rssi: number): [number, number][] => {
  const center = (from + to) / 2;
  const half = (to - from) / 2;
  return Array.from({ length: STEPS + 1 }, (_, i) => {
    const x = from + ((to - from) * i) / STEPS;
    const shape = Math.exp(-(((x - center) / (half * 0.92)) ** 6));
    return [x, FLOOR + (rssi - FLOOR) * shape];
  });
};

/**
 * Each network is drawn as a rounded hill over its channel width; height is
 * signal strength. The connected network sits on top with the accent gradient.
 */
export const SpectrumChart = ({ band, networks, ownSsid, hiddenLabel, height = 300 }: SpectrumChartProps) => {
  const c = useChartColors();
  const option = useMemo<EChartsOption>(() => {
    const visible = networks.filter((n) => n.band === band);
    const sorted = [...visible].sort((a, b) => Number(a.connected) - Number(b.connected) || a.rssi - b.rssi);
    // Label only the strongest few distinct names; labelling every network turns dense bands into noise.
    const strongest = new Set<string>();
    const seenNames = new Set<string>();
    for (const n of [...visible].sort((a, b) => b.rssi - a.rssi)) {
      if (strongest.size >= 4) break;
      if (n.connected || n.hidden || seenNames.has(n.ssid)) continue;
      seenNames.add(n.ssid);
      strongest.add(n.bssid);
    }

    const series: SeriesOption[] = sorted.map((n, i) => {
      const { from, to } = span(n);
      const own = n.connected || (ownSsid !== null && n.ssid === ownSsid);
      const color = n.connected ? c.cyan : own ? c.blue : c.palette[(i + 3) % c.palette.length];
      const name = n.hidden ? hiddenLabel : n.ssid;
      const points = hill(from, to, n.rssi);
      const mid = Math.floor(points.length / 2);
      const showLabel = n.connected || strongest.has(n.bssid);
      return {
        type: 'line',
        name,
        smooth: true,
        showSymbol: true,
        symbolSize: 0,
        z: n.connected ? 10 : 2,
        data: points.map((p, idx) =>
          idx === mid && showLabel
            ? {
                value: p,
                label: {
                  show: true,
                  position: 'top',
                  distance: 6,
                  formatter: name,
                  color: n.connected ? c.fg : c.muted,
                  fontSize: n.connected ? 12 : 11,
                  fontWeight: n.connected ? 600 : 400,
                },
              }
            : p,
        ),
        lineStyle: {
          width: n.connected ? 2.5 : 1.4,
          color: n.connected
            ? { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: c.cyan }, { offset: 0.5, color: c.blue }, { offset: 1, color: c.violet }] }
            : color,
        },
        itemStyle: { color },
        areaStyle: { color: `${color}${n.connected ? '40' : '16'}`, origin: 'start' },
        emphasis: { focus: 'series', lineStyle: { width: 2.5 } },
        labelLayout: { hideOverlap: true },
        tooltip: {
          formatter: () => `<b>${escapeHtml(name)}</b><br/>${n.bssid}<br/>Ch ${n.channel}, ${n.widthMhz} MHz, ${n.rssi} dBm`,
        },
      } as SeriesOption;
    });

    if (band === '5' && series.length) {
      (series[0] as { markArea?: unknown }).markArea = {
        silent: true,
        itemStyle: { color: `${c.warn}12` },
        label: { show: true, position: 'insideTop', color: c.faint, fontSize: 10, formatter: 'DFS' },
        data: [
          [{ xAxis: 50 }, { xAxis: 66 }],
          [{ xAxis: 98 }, { xAxis: 146 }],
        ],
      };
    }

    const axis = AXIS[band];
    return {
      animationDuration: 400,
      grid: { left: 52, right: 16, top: 28, bottom: 30 },
      tooltip: { ...baseTooltip(c), trigger: 'item' },
      xAxis: {
        type: 'value',
        min: axis.min,
        max: axis.max,
        ...axisStyle(c),
        splitLine: { show: false },
        axisTick: { show: false },
        axisLabel: { ...axisStyle(c).axisLabel, customValues: axis.labels, hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        min: FLOOR,
        max: -20,
        interval: 20,
        ...axisStyle(c),
        axisLabel: { ...axisStyle(c).axisLabel, formatter: '{value} dBm' },
      },
      series,
    };
  }, [band, networks, ownSsid, hiddenLabel, c]);

  return <Chart option={option} height={height} notMerge ariaLabel={`Spectrum ${band} GHz`} />;
};
