import { chromium } from 'playwright-core';
import { bootHarness } from '/home/user/wego-4x-game/scripts/map-harness.mjs';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await bootHarness(page, 'http://localhost:5173/', [], true);
const r = await page.evaluate(async () => {
  const H = window.H, m = H.map;
  await new Promise(r => setTimeout(r, 1500));
  const t = () => { const a = []; for (let i = 0; i < 4; i++) { m.invalidate(); const t0 = performance.now(); m.draw(H.input(performance.now())); m.ctx.getImageData(0, 0, 1, 1); a.push(performance.now() - t0); } return +(a.reduce((x, y) => x + y) / a.length).toFixed(1); };
  const out = { all: t() };
  for (const k of ['rocks', 'wash', 'halo', 'sites', 'extras']) { window.__off = new Set([k]); out[k] = t(); }
  window.__off = new Set(['rocks', 'wash', 'halo', 'sites', 'extras']); out.allOff = t();
  window.__off = null;
  m.weave = null; m.lamp = null; out.noWeaveLamp = t();
  return out;
});
console.log(JSON.stringify(r));
await browser.close();
