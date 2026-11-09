import { chromium } from 'playwright-core';
const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
const p = b.contexts()[0].pages()[0];
const r = await p.evaluate(async (code) => { const f = new Function('inv', `return (async () => { ${code} })()`); return f(window.__TAURI_INTERNALS__.invoke); }, process.argv[2]);
console.log(JSON.stringify(r, null, 1));
await b.close();
