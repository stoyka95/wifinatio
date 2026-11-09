// Drives the running app's WebView2 over CDP: visits every section, captures
// screenshots and collects console errors. Start the app with
//   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333 npm run tauri dev
// then: node scripts/ui-check.mjs <outDir> [section ...] [--theme=light] [--lang=en] [--wait=ms]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const outDir = args[0] ?? 'ui-shots';
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const sections = args.slice(1).filter((a) => !a.startsWith('--'));
mkdirSync(outDir, { recursive: true });

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages().find((p) => p.url().includes('localhost:1420')) ?? browser.contexts()[0].pages()[0];
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));

if (flags.eval) console.log('EVAL', JSON.stringify(await page.evaluate(flags.eval)));

const navLabels = await page.$$eval('nav button[aria-current], nav button', (els) => els.map((e) => e.textContent?.trim()));
console.log('NAV', JSON.stringify(navLabels));

for (const name of sections) {
  const button = page.locator('nav button', { hasText: new RegExp(`^${name}$`) }).first();
  if (await button.count()) await button.click();
  await page.waitForTimeout(Number(flags.wait ?? 1200));
  const file = join(outDir, `${name.replace(/\W+/g, '_')}.png`);
  await page.screenshot({ path: file });
  console.log('SHOT', file);
}
console.log('ERRORS', JSON.stringify(errors.slice(0, 20)));
await browser.close();
