// Clicks buttons by visible text in the running app (over CDP) and takes a screenshot.
//   node scripts/ui-click.mjs <section> <out.png> <waitMs> "Button text" ["Another"...]
import { chromium } from 'playwright-core';

const [section, out, waitMs, ...buttons] = process.argv.slice(2);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages()[0];
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.locator('nav button', { hasText: new RegExp(`^${section}$`) }).first().click();
await page.waitForTimeout(800);
for (const text of buttons) {
  // Matches plain buttons and segmented-control radios alike.
  await page.locator(`main button:text-is("${text}")`).first().click();
}
await page.waitForTimeout(Number(waitMs));
await page.screenshot({ path: out });
console.log('SHOT', out, 'ERRORS', JSON.stringify(errors));
await browser.close();
