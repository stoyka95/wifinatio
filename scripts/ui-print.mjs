// Opens the latest saved diagnostic report and captures its print (PDF) layout.
//   node scripts/ui-print.mjs <out.png>
import { chromium } from 'playwright-core';

const out = process.argv[2] ?? 'print.png';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages()[0];
await page.evaluate(() => window.__stores.ui.getState().go('diagnosis'));
await page.waitForTimeout(1200);
await page.locator('main ul button').first().click();
await page.waitForTimeout(800);
await page.emulateMedia({ media: 'print' });
await page.screenshot({ path: out, fullPage: true });
await page.emulateMedia({ media: 'screen' });
console.log('SHOT', out);
await browser.close();
