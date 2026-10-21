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
// ignore Vite hot reloads (other files changing mid-run would reload the page)
await page.routeWebSocket(/\?token=/, () => {});
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const shot = async n => page.screenshot({ path: `${out}/ph-${n}.png` });
await page.goto(base);
// the first-run tour is exercised by scripts/ux-shots.mjs; skip it here
await page.evaluate(() => { localStorage.setItem('tc.tutorial.wego', 'done'); localStorage.setItem('tc.tutorial.live', 'done'); localStorage.setItem('tc.herald.auto', 'off'); });
await page.waitForTimeout(800);
await shot('1-lobby');
await page.tap('[data-l=start]');
await page.waitForTimeout(1200);
await shot('2-game');
// tap own fleet
const xy = await page.evaluate(() => {
  const s = window.tc.screen; const f = s.st.fleets.find(d => d.owner === s.you);
  const p = s.map.toScreen(s.lastFleetPos.get(f.id)); const r = s.el.canvas.getBoundingClientRect(); return [p.x + r.left, p.y + r.top];
});
await page.touchscreen.tap(xy[0], xy[1]);
await page.waitForTimeout(1000);
await shot('3-fleet');
// tap-then-tap: the selected fleet's targets are lit; tapping one commits
await shot('4-targeting');
const tgt = await page.evaluate(() => {
  const s = window.tc.screen; const f = s.fleet(s.sel.id);
  const n = s.st.regions[f.region].neighbors.find(n => s.st.regions[n].owner === null && s.st.regions[n].kind !== 'lane');
  const p = s.map.toScreen(s.st.regions[n].site); const r = s.el.canvas.getBoundingClientRect(); return [p.x + r.left, p.y + r.top];
});
await page.touchscreen.tap(tgt[0], tgt[1]);
await page.waitForTimeout(500);
await shot('5-after-order');
await page.evaluate(() => window.tc.screen.select({ kind: 'region', id: window.tc.state.players[window.tc.screen.you].capital }));
await page.waitForTimeout(400);
await shot('6-region');
console.log('plan', await page.evaluate(() => window.tc.screen.plan.orders.map(o => o?.type ?? null).join(',')));
await page.evaluate(() => window.tc.screen.deselect());
await page.waitForTimeout(300);
await shot('7-strip');
const sub = await page.$('[data-submit]');
if (sub) { await sub.tap(); await page.waitForTimeout(400); await shot('7c-confirm'); const y = await page.$('[data-y]'); if (y) await y.tap(); }
await page.waitForTimeout(2500);
await shot('8-replay');
await page.evaluate(() => window.tc.screen.endReplay());
await page.waitForTimeout(400);
await shot('9-after');
const menu = await page.$('[data-act=menu]'); if (menu) { await menu.tap(); await page.waitForTimeout(300); await shot('10-menu'); await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
await page.evaluate(() => window.tc.screen.openModal('score'));
await page.waitForTimeout(300); await shot('11-score');
await page.evaluate(() => { document.querySelector('.modal-x, [data-modal-close]')?.click(); window.tc.screen.openModal('help'); });
await page.waitForTimeout(300); await shot('12-help');
const hasHScroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
console.log('horizontal overflow:', hasHScroll, 'errors:', JSON.stringify(errors));
await browser.close();
