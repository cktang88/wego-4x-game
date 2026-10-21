// End-to-end smoke test in a real browser: start a local game, issue orders through
// the UI, seal, watch the replay, open a battle. node scripts/play-e2e.mjs <outdir>
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? '.';
const base = process.argv[3] ?? 'http://localhost:5173/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
// ignore Vite hot reloads (other files changing mid-run would reload the page)
await page.routeWebSocket(/\?token=/, () => {});
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(base);
// the first-run tour is exercised by scripts/ux-shots.mjs; skip it here
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('tc.tutorial.wego', 'done'); localStorage.setItem('tc.tutorial.live', 'done'); localStorage.setItem('tc.herald.auto', 'off'); });
await page.click('[data-l=start]');
await page.waitForTimeout(800);
// helper: screen coordinates of a fleet / region
const fleetXY = id => page.evaluate(id => {
  const s = window.tc.screen; const lay = s.currentFleetDraws().find(f => f.id === id);
  const p = s.map.toScreen(s.lastFleetPos.get(id) ?? lay.pos); const r = s.el.canvas.getBoundingClientRect(); return [p.x + r.left, p.y + r.top];
}, id);
const regionXY = id => page.evaluate(id => {
  const s = window.tc.screen; const p = s.map.toScreen(s.st.regions[id].site); const r = s.el.canvas.getBoundingClientRect(); return [p.x + r.left, p.y + r.top - 4];
}, id);
for (let turn = 0; turn < Number(process.argv[4] ?? 3); turn++) {
  const info = await page.evaluate(() => {
    const s = window.tc.screen, st = s.st, me = s.you;
    const fleets = st.fleets.filter(f => f.owner === me);
    const targets = fleets.map(f => st.regions[f.region].neighbors.find(n => st.regions[n].owner !== me && st.regions[n].kind !== 'crown' && st.regions[n].kind !== 'throne' && st.regions[n].kind !== 'lane'));
    return { fleets: fleets.map(f => f.id), targets, cap: st.players[me].capital };
  });
  // seize with the first two fleets: the first by dragging its token, the second by click, S, click
  for (let i = 0; i < Math.min(2, info.fleets.length); i++) {
    if (info.targets[i] === undefined) continue;
    const [fx, fy] = await fleetXY(info.fleets[i]);
    const [rx, ry] = await regionXY(info.targets[i]);
    if (i === 0) {
      await page.mouse.move(fx, fy); await page.mouse.down();
      await page.mouse.move(fx + 10, fy + 10, { steps: 3 });
      await page.mouse.move(rx, ry, { steps: 8 });
      await page.waitForTimeout(150);
      await page.mouse.up();
    } else {
      await page.mouse.click(fx, fy);
      await page.keyboard.press('s');
      await page.mouse.click(rx, ry);
    }
    await page.waitForTimeout(150);
  }
  console.log('planned', await page.evaluate(() => window.tc.screen.plan.orders.map(o => o?.type ?? null).join(',')));
  // build at capital
  await page.evaluate(id => window.tc.screen.select({ kind: 'region', id }), info.cap);
  await page.waitForTimeout(200);
  const b = await page.$('[data-a=build][data-cls=frigate]');
  if (b) await b.click();
  // building into a new fleet raises a banner: the founding sheet (found with its defaults)
  await page.waitForTimeout(200);
  const go = await page.$('[data-found] [data-f=go]');
  if (go) { await page.screenshot({ path: `${out}/e2e-founding-${turn}.png` }); if ((await go.getAttribute('aria-disabled')) === 'true') await page.click('[data-f=cancel]'); else await go.click(); }
  await page.screenshot({ path: `${out}/e2e-plan-${turn}.png` });
  await page.click('[data-submit]');
  await page.waitForTimeout(300);
  const dlg = await page.$('[data-y]'); if (dlg) await dlg.click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/e2e-replay-${turn}.png` });
  console.log('after seal', turn, await page.evaluate(() => [window.tc.state.turn, !!window.tc.screen.src.mySubmission, window.tc.screen.canPlan, document.querySelector('.overlay')?.textContent?.slice(0,80)]));
  await page.evaluate(() => window.tc.screen.endReplay());
  await page.waitForTimeout(300);
}
await page.screenshot({ path: `${out}/e2e-end.png` });
const battle = await page.$('[data-battle]');
if (battle) { await battle.click(); await page.waitForTimeout(3500); await page.screenshot({ path: `${out}/e2e-battle.png` }); }
const st = await page.evaluate(() => ({ turn: window.tc.state.turn, vp: window.tc.state.players.map(p => p.vp), regions: window.tc.state.regions.filter(r => r.owner === 0).length }));
console.log('state', JSON.stringify(st));
console.log('errors', JSON.stringify(errors));
await browser.close();
