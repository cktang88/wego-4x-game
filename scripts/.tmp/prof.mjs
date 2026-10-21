import { chromium } from 'playwright-core';
import { bootHarness } from '/home/user/wego-4x-game/scripts/map-harness.mjs';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const dev = process.argv[2] === 'ph' ? { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } };
const page = await browser.newPage(dev);
const errs = [];
await bootHarness(page, 'http://localhost:5173/', errs, true);
const r = await page.evaluate(async () => {
  const H = window.H, m = H.map, s = H.full;
  const med = (() => { const rs = s.regions.filter(r => r.poly.length > 2 && r.kind !== 'void').map(r => { let a = 0; const p = r.poly; for (let i = 0; i < p.length; i++) { const q = p[i], w = p[(i + 1) % p.length]; a += q.x * w.y - w.x * q.y; } return Math.sqrt(Math.abs(a / 2) / Math.PI); }).sort((a, b) => a - b); return rs[rs.length >> 1]; })();
  const out = {};
  const ods = m.drawStatic;
  for (const Rs of [55, 95, 130, 230, 320]) {
    m.cam.z = Rs / med;
    await new Promise(r => setTimeout(r, 1200)); // let lazy bakes land
    const times = [];
    for (let i = 0; i < 5; i++) { m.invalidate(); const t = performance.now(); m.draw(H.input(performance.now())); times.push(+(performance.now() - t).toFixed(1)); }
    // parts
    const parts = {};
    for (const k of ['drawSiteAndCap', 'drawBannerExtras', 'drawTokens', 'drawDynamic']) {
      const o = m[k]; let acc = 0; m[k] = function (...a) { const t = performance.now(); const v = o.apply(this, a); acc += performance.now() - t; return v; };
      m.invalidate(); m.draw(H.input(performance.now())); m[k] = o; parts[k] = +acc.toFixed(1);
    }
    out[Rs] = { tier: m.tier, times, parts };
  }
  return out;
});
console.log(JSON.stringify(r, null, 0), errs.slice(0, 3));
await browser.close();
