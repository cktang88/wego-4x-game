// iPhone 15 Pro emulation (393x852 @3x, touch, mobile UA) for visual QA of the phone layout.
// node scripts/phone.mjs <outdir> [baseUrl]
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? '.';
const base = process.argv[3] ?? 'http://localhost:5173/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({
  viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const shot = async n => page.screenshot({ path: `${out}/ph-${n}.png` });
await page.goto(base);
await page.waitForTimeout(800);
await shot('1-lobby');
await page.tap('[data-l=start]');
await page.waitForTimeout(1200);
await shot('2-game');
// tap own fleet
const xy = await page.evaluate(() => {
  const s = window.tc.screen; const f = s.currentFleetDraws().find(d => d.owner === s.you);
  const p = s.map.toScreen(f.pos); const r = s.el.canvas.getBoundingClientRect(); return [p.x + r.left, p.y + r.top];
});
await page.touchscreen.tap(xy[0], xy[1]);
await page.waitForTimeout(500);
await shot('3-fleet');
const seize = await page.$('[data-a=seize]');
if (seize) { await seize.tap(); await page.waitForTimeout(400); await shot('4-targeting'); }
const tgt = await page.evaluate(() => {
  const s = window.tc.screen; const f = s.st.fleets.find(x => x.owner === s.you);
  const n = s.st.regions[f.region].neighbors.find(n => s.st.regions[n].owner === null);
  const p = s.map.toScreen(s.st.regions[n].site); const r = s.el.canvas.getBoundingClientRect(); return [p.x + r.left, p.y + r.top];
});
await page.touchscreen.tap(tgt[0], tgt[1]);
await page.waitForTimeout(500);
await shot('5-after-order');
await page.evaluate(() => window.tc.screen.select({ kind: 'region', id: window.tc.state.players[window.tc.screen.you].capital }));
await page.waitForTimeout(400);
await shot('6-region');
await page.evaluate(() => { window.tc.screen.sel = null; window.tc.screen.renderAll(); });
const open = await page.$('[data-d=sheet]'); if (open) { await open.tap(); await page.waitForTimeout(400); }
await shot('7-orders');
const close = await page.$('[data-sheetx]'); if (close) { await close.tap(); await page.waitForTimeout(300); }
await shot('7b-closed');
const sub = await page.$('[data-d=seal]');
if (sub) { await sub.tap(); await page.waitForTimeout(400); await shot('7c-confirm'); const y = await page.$('[data-y]'); if (y) await y.tap(); }
await page.waitForTimeout(2500);
await shot('8-replay');
await page.evaluate(() => window.tc.screen.endReplay());
await page.waitForTimeout(400);
await shot('9-after');
const menu = await page.$('[data-act=menu]'); if (menu) { await menu.tap(); await page.waitForTimeout(300); await shot('10-menu'); await page.keyboard.press('Escape'); }
await page.evaluate(() => window.tc.screen.openSheet('score'));
await page.waitForTimeout(300); await shot('11-score');
await page.evaluate(() => window.tc.screen.toolbar('help'));
await page.waitForTimeout(300); await shot('12-help');
const hasHScroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
console.log('horizontal overflow:', hasHScroll, 'errors:', JSON.stringify(errors));
await browser.close();
