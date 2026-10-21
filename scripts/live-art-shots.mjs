// Live app screenshots (real game shell): desktop 1440x900 and iPhone 15 Pro, Watch AIs a few turns in, at the
// default view and zoomed in. node scripts/live-art-shots.mjs <outdir> [baseUrl]   (needs `npm run dev`)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? '/tmp/claude-0/art/live';
const base = process.argv[3] ?? 'http://localhost:5173/';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const DEVICES = {
  dt: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  ph: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
};
const errors = [];
for (const [tag, dev] of Object.entries(DEVICES)) {
  const ctx = await browser.newContext(dev);
  const page = await ctx.newPage();
  await page.routeWebSocket(/\?token=/, () => {});
  page.on('pageerror', e => errors.push(`${tag}: ${e.message}`));
  await page.goto(base);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('tc.tutorial.wego', 'done'); localStorage.setItem('tc.tutorial.live', 'done'); });
  await page.reload();
  await page.waitForTimeout(600);
  await page.click('[data-l=start]');
  await page.waitForFunction(() => window.tc?.screen?.map?.fitted, null, { timeout: 15000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/${tag}-start.png` });
  const z = await page.evaluate(() => { const m = window.tc.screen.map, s = window.tc.screen.st, c = s.regions[s.players[window.tc.screen.you ?? 0]?.capital ?? 0].site; m.flyTo(c, m.cam.z * 2.4, 1); return m.cam.z; });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/${tag}-zoom.png` });
  console.log(`  ${tag} ok z=${z}`);
  await ctx.close();
}
await browser.close();
console.log(errors.length ? `page errors: ${JSON.stringify(errors.slice(0, 5))}` : 'no page errors');
