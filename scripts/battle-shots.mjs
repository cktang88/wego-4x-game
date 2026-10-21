// Battle viewer screenshots + frame cost (battle-demo page): desktop 1440x900 and iPhone 15 Pro, at several moments.
// node scripts/battle-shots.mjs <outdir> [baseUrl]     (needs `npm run dev`)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? '/tmp/claude-0/art/battle';
const base = process.argv[3] ?? 'http://localhost:5173/';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const DEVICES = {
  dt: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  ph: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};
const errors = [];
for (const [tag, dev] of Object.entries(DEVICES)) {
  for (const mode of ['3', '2']) {
    const ctx = await browser.newContext(dev);
    const page = await ctx.newPage();
    await page.routeWebSocket(/\?token=/, () => {});
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${base}battle-demo.html?mode=${mode}`);
    await page.evaluate(() => { const o = performance.now.bind(performance); const raf = window.requestAnimationFrame.bind(window); window.__ft = []; window.requestAnimationFrame = cb => raf(t => { const a = o(); cb(t); window.__ft.push(o() - a); }); });
    for (const at of mode === '3' ? [3.2, 5.0, 7.5, 11] : [4.2, 8]) {
      await page.waitForTimeout(at * 1000 - (await page.evaluate(() => performance.now())) + (await page.evaluate(() => window.__t0 ??= performance.now())));
      await page.screenshot({ path: `${out}/${tag}-m${mode}-t${String(at).replace('.', '_')}.png` });
      console.log(`  ${tag}-m${mode}-t${at}.png`);
    }
    const ft = await page.evaluate(() => { const a = window.__ft.slice(10).sort((x, y) => x - y); return { n: a.length, avg: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2), p95: +a[Math.floor(a.length * 0.95)].toFixed(2) }; });
    console.log(`  ${tag} mode ${mode} viewer frame JS`, JSON.stringify(ft));
    await ctx.close();
  }
}
await browser.close();
console.log(errors.length ? `page errors: ${JSON.stringify(errors.slice(0, 5))}` : 'no page errors');
