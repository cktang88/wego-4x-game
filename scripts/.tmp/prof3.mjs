import { chromium } from 'playwright-core';
import { bootHarness } from '/home/user/wego-4x-game/scripts/map-harness.mjs';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await bootHarness(page, 'http://localhost:5173/', [], true);
const r = await page.evaluate(async () => {
  const H = window.H, m = H.map;
  await new Promise(r => setTimeout(r, 1500));
  const res = [];
  for (let i = 0; i < 3; i++) { window.__pt = [[0, performance.now()]]; m.invalidate(); m.draw(H.input(performance.now())); window.__pt.push([9999, performance.now()]); res.push(window.__pt.map((p, j, a) => j ? [a[j-1][0], +(p[1] - a[j-1][1]).toFixed(1)] : null).filter(Boolean)); }
  return res;
});
console.log(JSON.stringify(r));
await browser.close();
