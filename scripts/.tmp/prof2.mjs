import { chromium } from 'playwright-core';
import { bootHarness } from '/home/user/wego-4x-game/scripts/map-harness.mjs';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await bootHarness(page, 'http://localhost:5173/', [], true);
const r = await page.evaluate(async () => {
  const H = window.H, m = H.map;
  await new Promise(r => setTimeout(r, 1500));
  const t = () => { const a = []; for (let i = 0; i < 4; i++) { m.invalidate(); const t0 = performance.now(); m.draw(H.input(performance.now())); a.push(performance.now() - t0); } return +(a.reduce((x, y) => x + y) / a.length).toFixed(1); };
  const out = { all: t() };
  const w = m.weave; m.weave = null; out.noWeave = t();
  const l = m.lamp; m.lamp = null; out.noWeaveLamp = t();
  const h = m.haze; m.haze = null; out.noWeaveLampHaze = t();
  const sp = m.starPattern; m.starPattern = null; out.noStars = t();
  m.weave = w; m.lamp = l; m.haze = h; m.starPattern = sp;
  return out;
});
console.log(JSON.stringify(r));
await browser.close();
