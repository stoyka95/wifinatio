# Wifinatio

Desktopová aplikace pro Windows 11, která ukáže stav Wi-Fi a internetového připojení a lidsky vysvětlí, kde je problém: ve Wi-Fi a zařízení, nebo u poskytovatele.

Stack: Tauri 2 (Rust) · React 19 + TypeScript + Vite · Tailwind CSS v4 · Framer Motion · Apache ECharts · Zustand · SQLite.

## Spuštění

```bash
npm install
npm run tauri dev
```

Build instalátorů (MSI + NSIS):

```bash
npm run tauri build -- --target aarch64-pc-windows-msvc
npm run tauri build -- --target x86_64-pc-windows-msvc
```

Výstup najdete v `src-tauri/target/<target>/release/bundle/{msi,nsis}`.

## Android (APK)

Stejné UI a stejný Rust backend běží i na Androidu (minSdk 24, Android 7+). Na šířce telefonu se místo postranního panelu zobrazí horní lišta a spodní navigace; desktop (≥ 1024 px) zůstává beze změny.

Potřeba: Android SDK (platform 37, build-tools), NDK 27, JDK 17+ a Rust targety `aarch64-linux-android` (případně `armv7-linux-androideabi`, `x86_64-linux-android`).

```bash
export ANDROID_HOME=~/Android/Sdk NDK_HOME=$ANDROID_HOME/ndk/27.2.12479018
npm run tauri android dev                          # běh na připojeném telefonu / emulátoru
npm run tauri android build -- --apk --target aarch64
```

Nepodepsané APK: `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk`. Podepsání:

```bash
keytool -genkeypair -v -keystore wifinatio.jks -alias wifinatio -keyalg RSA -keysize 2048 -validity 10000
$ANDROID_HOME/build-tools/36.0.0/zipalign -f 4 app-universal-release-unsigned.apk aligned.apk
$ANDROID_HOME/build-tools/36.0.0/apksigner sign --ks wifinatio.jks --out wifinatio.apk aligned.apk
```

Jak to funguje na Androidu:

- **Wi-Fi a síť**: `gen/android/.../NetBridge.kt` čte `WifiManager` a `ConnectivityManager` a vrací JSON; Rust ho volá přes JNI (`android_bridge.rs`). Skeny obsahují surové 802.11 IE (Android 11+), takže šířku kanálu, standard, zabezpečení a vytížení kanálu parsuje stejný `ie.rs` jako na Windows.
- **Ping, traceroute, MTU**: neprivilegované ICMP sockety (`SOCK_DGRAM` + `IPPROTO_ICMP`, `ping_unix.rs`), TTL-exceeded a „fragmentation needed“ přichází přes `IP_RECVERR`. Bez rootu a bez parsování `/system/bin/ping`.
- **TLS**: rustls s přibalenými kořenovými certifikáty (na Windows dál SChannel).
- **Oprávnění**: Android vydá SSID, BSSID a okolní sítě jen s povolenou polohou; aplikace o ni požádá při startu a tlačítko „Povolit polohu“ otevře dotaz nebo nastavení.
- **Omezení**: Android povolí aplikaci 4 skeny za 2 minuty. Úsporný režim adaptéru, ovladač a plán napájení Windows na telefonu nejsou; místo nich se hlásí spořič baterie a nabíjení. Export do PDF (tisk) na Androidu není, Markdown a JSON se ukládají do složky Stažené.
- Texty, které mluví o Windows, mají pro Android vlastní znění (`src/lib/i18n/android.ts`).

## Testy

```bash
npm test                      # pravidla hodnocení, diagnóza, kanály, zpráva (Vitest)
npm run typecheck
cd src-tauri && cargo test    # parser IE, DNS, ping, úložiště, nastavení
cargo test live_ -- --ignored --nocapture   # živý výpis ze skutečného Wi-Fi adaptéru
```

UI testy proti běžící aplikaci (WebView2 přes CDP):

```bash
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333 npm run tauri dev
node scripts/ui-check.mjs shots Přehled Ping Kanály
node scripts/ui-click.mjs "DNS a trasa" shots/dns.png 12000 "Otestovat DNS"
```

## Architektura

```
src-tauri/src/
  lib.rs         setup: Mica/Acrylic, tray, start pingu a monitoru
  wifi.rs        Native WiFi API (WlanQueryInterface, WlanGetNetworkBssList, WlanScan)
  ie.rs          parser 802.11 IE: šířka kanálu, standard, zabezpečení, BSS Load (s testy)
  ping.rs        ICMP přes IcmpSendEcho2, vlákno na cíl, události ping-sample
  monitor.rs     každou sekundu stav Wi-Fi, detekce událostí, DNS sonda, notifikace
  speedtest.rs   Cloudflare __down/__up, 6 spojení, zahřátí, ping pod zátěží
  dns.rs         vlastní UDP dotazy na každý resolver, PTR pro traceroute
  trace.rs       traceroute přes TTL, všechny hopy paralelně
  netinfo.rs     IP Helper API, veřejná IP, IPv6, MTU (DF ping)
  system.rs      úspora Wi-Fi adaptéru (PowerRead*ValueIndex), režim napájení, ovladač, poloha
  storage.rs     SQLite (rusqlite): nastavení, události, testy, snímky místností, zprávy
  commands.rs    typované Tauri příkazy
src/
  app/           okno, titlebar, sidebar, pozadí, motiv
  features/      jedna složka na obrazovku
  components/    glass komponenty a ui primitiva (shadcn styl)
  charts/        ECharts wrappery (sparkline, latence, spektrum, sloupce)
  lib/           rating.ts (jediné místo prahů), stats, health, diagnosis, channels, report, i18n
  stores/        Zustand: živá data, nastavení, UI
```

Živá data posílá backend událostmi (`wifi-status`, `ping-sample`, `dns-probe`, `net-event`, `speed-progress`), frontend nic nepolluje.

## Rozhodnutí a odchylky od zadání

- **Wi-Fi bez `netsh`**: vše přes Native WiFi a IP Helper API, výsledky nezávisí na jazyku Windows. `powercfg` se nevolá, úspora adaptéru se čte přes `PowerReadACValueIndex`.
- **SQLite přes `rusqlite`** místo `tauri-plugin-sql`: do databáze zapisuje hlavně backend (detektor událostí), takže úložiště žije v Rustu.
- **Typy ručně synchronizované** (`src/lib/types.ts`) místo `tauri-specta`, zadání to připouští.
- **Pravidla hodnocení a diagnózy v TypeScriptu** (`src/lib/rating.ts`, `diagnosis.ts`), protože jsou těsně svázaná s českými a anglickými texty. Rust měří a detekuje události.
- **Sken je jen na tlačítko** (automatický sken je ve výchozím stavu vypnutý). Vzorky pingu během skenu jsou označené a do diagnózy se nepočítají. Během odpojení od Wi-Fi se ping neodesílá, výpadek zaznamená detektor událostí.
- **Doporučení kanálu v 5 GHz** se drží kanálů 36–144: kanály 149–165 jsou v EU v režimu SRD a mnoho routerů je nenabízí. DFS kanály se doporučí, jen když jsou zřetelně čistší.
- **Export PDF** přes tiskový dialog Windows („Microsoft Print to PDF“) s vlastním tiskovým stylem. Markdown a JSON se ukládají přímo.
- **Poloha**: Windows 11 vyžaduje pro čtení Wi-Fi sítí povolené určování polohy. Při prvním spuštění se Windows zeptá, aplikace zobrazí vysvětlení a tlačítko do nastavení.

## Rozšíření do budoucna

Architektura počítá s napojením na MikroTik (RouterOS REST API) jako dalším zdrojem dat pro monitor, s heatmapou nad půdorysem (snímky místností se ukládají jako JSON, takže půjde přidat souřadnice bez migrace) a s plánovanými testy rychlosti (historie testů je v SQLite).

## Ikona

Zdroj: `design/icon/wifinatio.svg` (plná verze) a `wifinatio-small.svg` (zjednodušená pro 16–32 px). Přegenerování všech velikostí: `npm run icons`.
