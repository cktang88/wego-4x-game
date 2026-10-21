// LIVE mode smoke test: start a blitz live game vs AI, spend banked orders through the UI,
// watch ticks pass. node scripts/live-e2e.mjs <outdir> [base] [phone]
import { chromium, devices } from 'playwright-core';
const out = process.argv[2] ?? '.';
const base = process.argv[3] ?? 'http://localhost:5173/';
const phone = process.argv[4] === 'phone';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = phone ? await browser.newContext({ ...devices['iPhone 15 Pro'], defaultBrowserType: undefined }) : await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
// ignore Vite hot reloads (other files changing mid-run would reload the page)
await page.routeWebSocket(/\?token=/, () => {});
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(base);
await page.evaluate(() => localStorage.clear());
// the first-run tour is exercised by scripts/ux-shots.mjs; skip it here
await page.evaluate(() => { localStorage.setItem('tc.tutorial.wego', 'done'); localStorage.setItem('tc.tutorial.live', 'done'); localStorage.setItem('tc.herald.auto', 'off'); });
await page.goto(base);
await page.selectOption('[data-l=mode]', 'live-blitz');
await page.click('[data-l=start]');
await page.waitForTimeout(1000);
await page.screenshot({ path: `${out}/live-0.png` });
const fleetXY = id => page.evaluate(id => {
  const s = window.tc.screen; const lay = s.currentFleetDraws().find(f => f.id === id);
  const p = s.map.toScreen(s.lastFleetPos.get(id) ?? lay.pos); const r = s.el.canvas.getBoundingClientRect(); return [p.x + r.left, p.y + r.top];
}, id);
const regionXY = id => page.evaluate(id => {
  const s = window.tc.screen; const p = s.map.toScreen(s.st.regions[id].site); const r = s.el.canvas.getBoundingClientRect(); return [p.x + r.left, p.y + r.top - 4];
}, id);
const info = await page.evaluate(() => {
  const s = window.tc.screen, st = s.st, me = s.you;
  const f = st.fleets.find(f => f.owner === me);
  // a far-away target: 3 hops
  const d = new Map([[f.region, 0]]); const q = [f.region];
  while (q.length) { const r = q.shift(); for (const n of st.regions[r].neighbors) if (!d.has(n)) { d.set(n, d.get(r) + 1); q.push(n); } }
  const far = [...d].find(([r, k]) => k === 3 && st.regions[r].owner !== me)?.[0];
  return { fleet: f.id, far, bank: s.bank };
});
console.log('info', info);
const [fx, fy] = await fleetXY(info.fleet);
await page.mouse.click(fx, fy);
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/live-1-selected.png` });
await page.keyboard.press('m');
const [rx, ry] = await regionXY(info.far);
await page.mouse.move(rx, ry);
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/live-2-targeting.png` });
await page.mouse.click(rx, ry);
await page.waitForTimeout(400);
const q = await page.evaluate(() => ({ bank: window.tc.screen.bank, queue: window.tc.screen.queue.length }));
console.log('after order', q);
await page.screenshot({ path: `${out}/live-3-queued.png` });
await page.waitForTimeout(8000);
const st = await page.evaluate(f => { const s = window.tc.screen; const fl = s.st.fleets.find(x => x.id === f); return { tick: s.st.live.tick, region: fl?.region, route: fl?.route, bank: s.bank }; }, info.fleet);
console.log('after ticks', st);
await page.screenshot({ path: `${out}/live-4-travel.png` });
await page.waitForTimeout(12000);
await page.screenshot({ path: `${out}/live-5-later.png` });
console.log('tick', await page.evaluate(() => window.tc.screen.st.live.tick));
console.log('errors', errors);
await browser.close();
