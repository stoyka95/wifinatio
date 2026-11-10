// Overrides for texts that talk about Windows. Applied on top of the base
// dictionary when the app runs on Android (see getDict in ./index.ts).
import type { Dict } from './cs';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends (...args: never[]) => unknown ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K] };

export type DictPatch = DeepPartial<Dict>;

export const csAndroid: DictPatch = {
  location: {
    deniedTitle: 'Android nepovolil přístup k Wi-Fi sítím',
    deniedBody:
      'Android zpřístupní název sítě, BSSID a okolní sítě jen aplikacím s povolenou polohou. Wifinatio polohu nikam neposílá.',
    openSettings: 'Povolit polohu',
    pendingTitle: 'Čekám na Android',
    pendingBody: 'Pokud se objevil dotaz na přístup k poloze, povolte ho. Bez něj Android nevydá údaje o Wi-Fi.',
  },
  metric: { profile: 'Síť' },
  dashboard: { notConnectedBody: 'Připojte telefon k Wi-Fi v nastavení Androidu. Wifinatio se hned začne měřit.' },
  channels: {
    cachedHint: 'Zobrazuji poslední výsledky, které má Android v paměti. Android povolí aplikaci jen 4 skeny za 2 minuty.',
  },
  dnsTrace: {
    dnsRecommend: (best: string, ms: number, sys: number) =>
      `Systémový DNS je výrazně pomalejší (${Math.round(sys)} ms) než ${best} (${Math.round(ms)} ms). Zvažte nastavení ${best} v routeru.`,
  },
  wizard: {
    subtitle: 'Projde připojení, stabilitu, DNS a nastavení telefonu a sepíše srozumitelnou zprávu.',
    steps: { system: 'Nastavení telefonu' },
  },
  report: {
    sections: { system: 'Telefon' },
    powerModes: { best_efficiency: 'zapnutý', balanced: 'vypnutý' },
    f: {
      powerMode: (mode: string) => `Spořič baterie: ${mode}.`,
      onBattery: 'Telefon se nenabíjí. Se zapnutým spořičem baterie Android omezuje Wi-Fi i aplikace na pozadí.',
    },
    actions: {
      changeDns: (name: string, ip: string) => `Nastavte DNS na ${name} (${ip}) v routeru, nebo v Androidu jako soukromé DNS.`,
      flushDns: 'Zapněte a vypněte režim Letadlo, tím se vyprázdní mezipaměť DNS.',
      plugIn: 'Vypněte spořič baterie, nebo telefon připojte k nabíječce.',
    },
  },
  errors: { location_denied: 'Android nepovolil přístup k poloze, bez něj nelze číst Wi-Fi sítě.' },
};

export const enAndroid: DictPatch = {
  location: {
    deniedTitle: 'Android blocked access to Wi-Fi networks',
    deniedBody:
      'Android only shares the network name, BSSID and nearby networks with apps that have location access. Wifinatio never sends your location anywhere.',
    openSettings: 'Allow location',
    pendingTitle: 'Waiting for Android',
    pendingBody: 'If Android asked for location access, allow it. Without it Android does not share Wi-Fi details.',
  },
  metric: { profile: 'Network' },
  dashboard: { notConnectedBody: 'Connect the phone to Wi-Fi in Android settings. Wifinatio starts measuring right away.' },
  channels: {
    cachedHint: 'Showing the latest results Android has cached. Android allows an app 4 scans per 2 minutes.',
  },
  dnsTrace: {
    dnsRecommend: (best: string, ms: number, sys: number) =>
      `The system DNS is much slower (${Math.round(sys)} ms) than ${best} (${Math.round(ms)} ms). Consider setting ${best} in the router.`,
  },
  wizard: {
    subtitle: 'Checks the connection, stability, DNS and phone settings and writes a clear report.',
    steps: { system: 'Phone settings' },
  },
  report: {
    sections: { system: 'Phone' },
    powerModes: { best_efficiency: 'on', balanced: 'off' },
    f: {
      powerMode: (mode: string) => `Battery saver: ${mode}.`,
      onBattery: 'The phone is not charging. With battery saver on, Android limits Wi-Fi and background apps.',
    },
    actions: {
      changeDns: (name: string, ip: string) => `Set DNS to ${name} (${ip}) in the router, or as Private DNS in Android.`,
      flushDns: 'Turn airplane mode on and off to clear the DNS cache.',
      plugIn: 'Turn off battery saver or connect the phone to a charger.',
    },
  },
  errors: { location_denied: 'Android denied location access, which is required to read Wi-Fi networks.' },
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Returns a copy of `base` with every value in `patch` replaced. */
export const applyPatch = <T>(base: T, patch: DeepPartial<T>): T => {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    out[key] = isObject(value) && isObject(out[key]) ? applyPatch(out[key], value) : value;
  }
  return out as T;
};
