// Locale-aware number, time and unit formatting. The locale follows the app language.
let locale = 'cs-CZ';

export const setFormatLocale = (value: string) => {
  locale = value;
};

const nf = (digits: number) =>
  new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const fmtNumber = (value: number | null | undefined, digits = 0): string =>
  value === null || value === undefined || Number.isNaN(value) ? '—' : nf(digits).format(value);

/** Milliseconds: one decimal below 10 ms so router pings stay readable. */
export const fmtMs = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : `${fmtNumber(value, value < 10 ? 1 : 0)} ms`;

export const fmtMbps = (value: number | null | undefined): string => {
  if (value === null || value === undefined) return '—';
  return `${fmtNumber(value, value < 10 ? 1 : 0)} Mb/s`;
};

export const fmtDbm = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : `${value} dBm`;

export const fmtPercent = (value: number | null | undefined, digits = 1): string =>
  value === null || value === undefined ? '—' : `${fmtNumber(value, value === 0 ? 0 : digits)} %`;

export const fmtMhz = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : `${fmtNumber(value)} MHz`;

export const fmtTime = (ts: number): string =>
  new Date(ts).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export const fmtDateTime = (ts: number): string =>
  new Date(ts).toLocaleString(locale, { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export const fmtDuration = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min ${s} s`;
  return `${s} s`;
};

export const bandLabel = (band: string | null | undefined): string =>
  band ? `${band.replace('.', locale.startsWith('cs') ? ',' : '.')} GHz` : '—';

export const standardLabel = (std: string, band?: string | null): string => {
  const map: Record<string, string> = {
    be: 'Wi-Fi 7 (802.11be)',
    ax: band === '6' ? 'Wi-Fi 6E (802.11ax)' : 'Wi-Fi 6 (802.11ax)',
    ac: 'Wi-Fi 5 (802.11ac)',
    n: 'Wi-Fi 4 (802.11n)',
    g: '802.11g',
    a: '802.11a',
    b: '802.11b',
  };
  return map[std] ?? std;
};

export const shortStandard = (std: string): string =>
  ({ be: 'Wi-Fi 7', ax: 'Wi-Fi 6', ac: 'Wi-Fi 5', n: 'Wi-Fi 4' })[std] ?? `802.11${std}`;
