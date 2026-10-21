// UI audit: screenshots of the lobby, a mid-game map, fleet/region selection, the Empire tab and a zoomed-out view,
// on desktop and iPhone 15 Pro. Needs the dev servers. node scripts/ui-audit.mjs <outdir>
import { chromium, devices } from 'playwright-core';
const out = process.argv[2];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const [tag, ctxOpts] of [['d', { viewport: { width: 1440, height: 900 } }], ['p', { ...devices['iPhone 15 Pro'] }]]) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  await page.routeWebSocket(/\?token=/, () => {});
  await page.goto('http://localhost:5173/');
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('tc.tutorial.wego', 'done'); localStorage.setItem('tc.tutorial.live', 'done'); });
  await page.goto('http://localhost:5173/');
  await page.screenshot({ path: `${out}/${tag}-lobby.png` });
  await page.click('[data-l=start]'); await page.waitForTimeout(1200);
  // play a few turns via the AI for this seat to get a busier map
  for (let i = 0; i < 6; i++) {
    await page.evaluate(async () => { const s = window.tc.screen; const { planTurn } = await import('/@fs/home/user/wego-4x-game/shared/sim/ai.ts'); const sub = planTurn(s.st, s.you, 'expert'); s.plan = sub; s.submit?.(true); s.src.submit?.(sub); });
    await page.waitForTimeout(1500);
    await page.evaluate(() => { const s = window.tc.screen; s.endReplay?.(); document.querySelectorAll('.overlay').forEach(o => o.remove()); });
  }
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${tag}-map.png` });
  // select own biggest fleet
  await page.evaluate(() => { const s = window.tc.screen; const f = s.st.fleets.filter(f => f.owner === s.you).sort((a, b) => b.ships.length - a.ships.length)[0]; s.select({ kind: 'fleet', id: f.id }); s.renderAll(); });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${tag}-fleet.png` });
  await page.evaluate(() => { const s = window.tc.screen; s.select({ kind: 'region', id: s.st.players[s.you].capital }); s.renderAll(); });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${tag}-region.png` });
  await page.evaluate(() => { const b = [...document.querySelectorAll('.tabs button')].find(b => /empire/i.test(b.textContent)); b?.click(); });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${tag}-empire.png` });
  await page.evaluate(() => { window.tc.screen.map.cam.zoom *= 0.45; });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${tag}-zoomout.png` });
  await ctx.close();
}
await browser.close();
