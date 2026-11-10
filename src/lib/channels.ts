// Channel occupancy maths and the channel recommendation.
import type { Band, BssInfo } from './types';

export const CHANNELS_24 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
export const CHANNELS_5 = [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144, 149, 153, 157, 161, 165];

/** Occupied span in "channel units" (5 MHz per channel number). */
export const span = (bss: Pick<BssInfo, 'centerChannel' | 'widthMhz' | 'band'>) => {
  const half = bss.widthMhz / 10; // width MHz / 5 MHz per unit / 2
  // 2.4 GHz transmissions occupy ~22 MHz even on a 20 MHz channel.
  const extra = bss.band === '2.4' ? 0.2 : 0;
  return { from: bss.centerChannel - half - extra, to: bss.centerChannel + half + extra };
};

export const isDfs = (channel: number) => channel >= 52 && channel <= 144;

const overlap = (a: { from: number; to: number }, b: { from: number; to: number }) =>
  Math.max(0, Math.min(a.to, b.to) - Math.max(a.from, b.from)) / (a.to - a.from);

/** Relative interference weight: a -50 dBm neighbour counts 100× more than -70 dBm. */
const powerWeight = (rssi: number) => 10 ** ((rssi + 90) / 10);

export interface ChannelCandidate {
  /** Primary channel to set in the router. */
  channel: number;
  widthMhz: number;
  score: number;
  neighbours: number;
  strongestRssi: number | null;
  avgUtilization: number | null;
  dfs: boolean;
}

export interface Recommendation {
  band: Band;
  best: ChannelCandidate;
  current: ChannelCandidate | null;
  candidates: ChannelCandidate[];
}

interface Block {
  primary: number;
  center: number;
  widthMhz: number;
}

const blocksFor = (band: Band, widthMhz: number): Block[] => {
  if (band === '2.4') {
    return [1, 6, 11].map((c) => ({ primary: c, center: c, widthMhz: 20 }));
  }
  const width = [20, 40, 80, 160].includes(widthMhz) ? widthMhz : 80;
  const group = width / 20;
  // Channels 149–165 are short-range devices in the EU and many routers sold here
  // do not offer them, so recommendations stay within 36–144.
  const usable = width === 160 ? [36, 100] : CHANNELS_5.filter((c) => c <= 144);
  const blocks: Block[] = [];
  for (let i = 0; i < usable.length; i++) {
    const first = usable[i];
    const indexInGroup = width === 160 ? 0 : ((first - (first >= 149 ? 149 : first >= 100 ? 100 : 36)) / 4) % group;
    if (indexInGroup !== 0) continue;
    blocks.push({ primary: first, center: first + (group - 1) * 2, widthMhz: width });
  }
  return blocks;
};

const evaluate = (band: Band, block: Block, neighbours: BssInfo[]): ChannelCandidate => {
  const blockSpan = span({ band, centerChannel: block.center, widthMhz: block.widthMhz });
  let score = 0;
  let count = 0;
  let strongest: number | null = null;
  const utils: number[] = [];
  for (const n of neighbours) {
    const o = overlap(blockSpan, span(n));
    if (o <= 0) continue;
    count++;
    strongest = strongest === null ? n.rssi : Math.max(strongest, n.rssi);
    score += o * powerWeight(n.rssi) * (1 + (n.channelUtilization ?? 0.2) * 2);
    if (n.channelUtilization !== null) utils.push(n.channelUtilization);
  }
  const dfs = band === '5' && isDfs(block.primary);
  // DFS channels can be vacated after radar detection. Count that risk like an extra
  // co-channel neighbour at about -75 dBm, so DFS wins only when clearly cleaner.
  if (dfs) score = score * 1.15 + powerWeight(-75);
  return {
    channel: block.primary,
    widthMhz: block.widthMhz,
    score,
    neighbours: count,
    strongestRssi: strongest,
    avgUtilization: utils.length ? utils.reduce((a, b) => a + b, 0) / utils.length : null,
    dfs,
  };
};

/** "36–48" for an 80 MHz block starting at 36, "6" for a 20 MHz channel. */
export const blockLabel = (c: { channel: number; widthMhz: number }): string =>
  c.widthMhz > 20 ? `${c.channel}–${c.channel + (c.widthMhz / 20 - 1) * 4}` : `${c.channel}`;

/**
 * Ranks channels for `band` against the visible neighbours. Networks broadcast by
 * the user's own router (same SSID or the connected BSSID) are ignored.
 */
export const recommendChannel = (
  networks: BssInfo[],
  band: Band,
  own: { ssid: string | null; widthMhz: number | null; channel: number | null },
): Recommendation | null => {
  if (band === '6') return null;
  const neighbours = networks.filter((n) => n.band === band && !n.connected && (own.ssid === null || n.ssid !== own.ssid));
  const width = band === '2.4' ? 20 : own.widthMhz ?? 80;
  const candidates = blocksFor(band, width).map((b) => evaluate(band, b, neighbours));
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => a.score - b.score);
  const current =
    own.channel === null
      ? null
      : candidates.find((c) => own.channel! >= c.channel && own.channel! < c.channel + (c.widthMhz / 20) * 4) ?? null;
  return { band, best: sorted[0], current, candidates };
};
