// UX v2 screenshot tour: desktop 1440x900 and iPhone 15 Pro portrait, every HUD state worth looking at.
// node scripts/ux-v2-shots.mjs [outdir] [base] [desk|phone]
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? '/tmp/claude-0/v2-shell';
const base = process.argv[3] ?? 'http://localhost:5173/';
const only = process.argv[4];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];

async function run(tag, phone) {
  const ctx = await browser.newContext(phone
    ? { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' }
    : { viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.routeWebSocket(/\?token=/, () => {});
  page.on('pageerror', e => errors.push(`${tag}: ${e.message} ${e.stack?.split('\n')[1] ?? ''}`));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${tag}: ${m.text()}`); });
  const shot = n => page.screenshot({ path: `${out}/${tag}-${n}.png` });
  const cdp = phone ? await ctx.newCDPSession(page) : null;
  const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  // pointer helpers (mouse on desktop, real touch events on phone)
  const press = async (x, y) => { if (phone) await touch('touchStart', x, y); else { await page.mouse.move(x, y); await page.mouse.down(); } };
  const moveTo = async (x, y, steps = 8) => {
    if (!phone) { await page.mouse.move(x, y, { steps }); return; }
    const from = moveTo.last ?? [x, y];
    for (let i = 1; i <= steps; i++) await touch('touchMove', from[0] + ((x - from[0]) * i) / steps, from[1] + ((y - from[1]) * i) / steps);
    moveTo.last = [x, y];
  };
  const release = async () => { if (phone) await touch('touchEnd'); else await page.mouse.up(); moveTo.last = null; };
  const tapAt = async (x, y) => (phone ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));
  const fleetXY = id => page.evaluate(id => { const s = window.tc.screen; const p = s.map.toScreen(s.lastFleetPos.get(id)); return [p.x, p.y]; }, id);
  const regionXY = id => page.evaluate(id => { const s = window.tc.screen; const p = s.map.toScreen(s.st.regions[id].site); return [p.x, p.y]; }, id);
  const start = async (opts = {}) => {
    await page.goto(base);
    await page.evaluate(o => { localStorage.clear(); if (o.noteach) { localStorage.setItem('tc.tutorial.wego', 'done'); localStorage.setItem('tc.tutorial.live', 'done'); } }, opts);
    await page.goto(base);
    if (opts.mode) await page.selectOption('[data-l=mode]', opts.mode);
    await page.fill('[data-l=seed]', opts.seed ?? '4242');
    await page.click('[data-l=start]');
    await page.waitForFunction(() => window.tc?.screen?.st);
    await page.waitForTimeout(1200);
  };
  // ---------------------------------------------------------------- WEGO
  await start();
  await shot('01-idle');
  const info = await page.evaluate(() => {
    const s = window.tc.screen, st = s.st, me = s.you;
    const fs = st.fleets.filter(f => f.owner === me && f.ships.length).sort((a, b) => b.ships.length - a.ships.length);
    const f = fs[0];
    const nb = st.regions[f.region].neighbors.filter(n => st.regions[n].kind !== 'lane');
    const links = st.regions[f.region].links ?? st.regions[f.region].neighbors;
    const seize = nb.find(n => st.regions[n].owner === null && st.regions[n].kind === 'colony') ?? nb.find(n => st.regions[n].owner !== me);
    // a move target: somewhere 2 steps away that is ours or empty void, else any region
    const moveT = st.regions.find(r => r.owner === me && r.id !== f.region)?.id ?? nb.find(n => n !== seize);
    return { f: f.id, f2: fs[1]?.id, f3: fs[2]?.id, seize, moveT, cap: st.players[me].capital, far: (st.regions.filter(r => r.kind === 'void' && r.owner === null && !st.fleets.some(x => x.region === r.id && x.owner !== me)).sort((a, b) => Math.hypot(a.site.x - st.regions[f.region].site.x, a.site.y - st.regions[f.region].site.y) - Math.hypot(b.site.x - st.regions[f.region].site.x, b.site.y - st.regions[f.region].site.y))[0] ?? st.regions.find(r => r.kind === 'throne')).id };
  });
  // select fleet
  await tapAt(...await fleetXY(info.f));
  await page.waitForTimeout(500);
  await shot('02-fleet-selected');
  // mid-drag move (M armed: the drop means Move even onto a neutral world)
  if (phone) await page.evaluate(id => { window.tc.screen.mode = { type: 'move', fleet: id }; }, info.f); else await page.keyboard.press('m');
  let [fx, fy] = await fleetXY(info.f);
  await press(fx, fy);
  await moveTo(fx + 12, fy + 12, 3);
  const [mx, my] = await regionXY(info.far);
  await moveTo(mx, phone ? my + 48 : my, 10);
  await page.waitForTimeout(300);
  await shot('03-drag-move');
  // mid-drag seize
  await page.evaluate(() => { window.tc.screen.mode = null; });
  const [sx, sy] = await regionXY(info.seize);
  await moveTo(sx, phone ? sy + 48 : sy, 8);
  await page.waitForTimeout(300);
  await shot('04-drag-seize');
  await release();
  await page.waitForTimeout(400);
  console.log(tag, 'after seize drop', await page.evaluate(() => window.tc.screen.plan.orders.map(o => o && o.type)));
  // invalid: merging two fleets would go over 8 ships (test-only state edit puts them together)
  await page.evaluate(({ a, b }) => {
    const s = window.tc.screen, st = s.src.save.state;
    const fa = st.fleets.find(f => f.id === a), fb = st.fleets.find(f => f.id === b);
    fb.region = fa.region;
    let n = 900;
    while (fa.ships.length < 5) fa.ships.push({ ...structuredClone(fa.ships[0]), id: n++, name: `Test ${n}` });
    while (fb.ships.length < 5) fb.ships.push({ ...structuredClone(fb.ships[0]), id: n++, name: `Test ${n}` });
    s.src.refresh(); s.onSourceChange('view'); s.deselect();
  }, { a: info.f, b: info.f2 });
  await page.waitForTimeout(700);
  {
    const [ax, ay] = await fleetXY(info.f), [bx, by] = await fleetXY(info.f2);
    await press(bx, by);
    await moveTo(bx + 40, by + 40, 4);
    await moveTo(ax, phone ? ay + 48 : ay, 6);
    await page.waitForTimeout(300);
    await shot('05-drag-invalid');
    await release();
    await page.waitForTimeout(300);
  }
  // own planet card with build tray
  await page.evaluate(id => { const s = window.tc.screen; s.select({ kind: 'region', id }); s.focus(s.st.regions[id].site); }, info.cap);
  await page.waitForTimeout(900);
  await shot('06-planet-build');
  // enemy / neutral planet card with seize odds
  const foe = await page.evaluate(f => { const s = window.tc.screen, st = s.st; const fl = s.fleet(f); return (st.regions[fl.region].neighbors.find(n => st.regions[n].owner !== null && st.regions[n].owner !== s.you) ?? st.regions[fl.region].neighbors.find(n => st.regions[n].owner === null && st.regions[n].kind !== 'lane')); }, info.f2 ?? info.f);
  await page.evaluate(id => { const s = window.tc.screen; s.select({ kind: 'region', id }); s.focus(s.st.regions[id].site); }, foe);
  await page.waitForTimeout(900);
  await shot('07-planet-foe');
  // context ring on a fleet
  await page.evaluate(() => window.tc.screen.deselect());
  const ringF = info.f;
  const [rx, ry] = await fleetXY(ringF);
  if (phone) { await touch('touchStart', rx, ry); await page.waitForTimeout(500); await touch('touchEnd'); }
  else await page.mouse.click(rx, ry, { button: 'right' });
  await page.waitForTimeout(300);
  if (!phone) { const b = await page.$('.ri'); if (b) await b.hover(); await page.waitForTimeout(150); }
  await shot('08-ring');
  await page.keyboard.press('Escape');
  // ship fan: lift two chips, drag them onto the map
  await page.evaluate(id => { const s = window.tc.screen; s.deselect(); s.select({ kind: 'fleet', id }); s.focus(s.st.regions[s.fleet(id).region].site); }, ringF);
  await page.waitForTimeout(800);
  const chips = await page.$$('.fan [data-ship]');
  if (chips.length >= 3) {
    for (const i of [1, 2]) { const sel = `.fan [data-ship]:nth-child(${i})`; if (phone) await page.tap(sel); else await page.click(sel); await page.waitForTimeout(150); }
    await shot('09a-fan-lifted');
    const bb = await (await page.$('.fan [data-ship]:nth-child(1)')).boundingBox();
    await press(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await moveTo(bb.x + 30, bb.y - 30, 3);
    const tgt = await page.evaluate(id => { const s = window.tc.screen, st = s.st, f = s.fleet(id); return st.regions[f.region].neighbors.find(n => st.regions[n].kind !== 'lane') ?? f.region; }, ringF);
    const [tx, ty] = await regionXY(tgt);
    await moveTo(tx, phone ? ty + 48 : ty, 10);
    await page.waitForTimeout(300);
    await shot('09b-fan-split-drag');
    await release();
    await page.waitForTimeout(300);
  } else console.log(tag, 'fleet has', chips.length, 'ships: skipping fan split');
  // a full plan strip
  await page.evaluate(() => {
    const s = window.tc.screen, st = s.st;
    const fill = [{ type: 'conceal' }, ...st.fleets.filter(f => f.owner === s.you).map(f => ({ type: 'fortify', fleet: f.id })), ...st.regions.filter(r => r.owner === s.you).map(r => ({ type: 'scan', target: r.id }))];
    for (const o of fill) { if (s.nextSlot() === null) break; s.addOrder(o); }
    s.deselect();
  });
  await page.waitForTimeout(400);
  await shot('10-strip-full');
  if (!phone) { await page.hover('.strip .chip.filled'); await page.waitForTimeout(200); await shot('10b-strip-hover'); }
  // replace flow: drag when full
  await page.evaluate(() => { const s = window.tc.screen; s.toolbar('signals'); s.toolbar('signals'); });
  // primary states
  await page.evaluate(() => { const s = window.tc.screen; s.plan = s.freshPlan(); s.savePlan(); s.renderAll(); });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/${tag}-11a-primary-idle.png`, clip: phone ? { x: 0, y: 700, width: 393, height: 152 } : { x: 300, y: 780, width: 900, height: 120 } });
  await page.evaluate(() => { const s = window.tc.screen; for (const f of s.st.fleets.filter(f => f.owner === s.you)) s.addOrder({ type: 'fortify', fleet: f.id }); s.renderAll(); });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/${tag}-11b-primary-next.png`, clip: phone ? { x: 0, y: 700, width: 393, height: 152 } : { x: 300, y: 780, width: 900, height: 120 } });
  await page.evaluate(() => { const s = window.tc.screen; s.addOrder({ type: 'conceal' }); s.canResearchNow = () => false; s.renderAll(); });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/${tag}-11c-primary-seal.png`, clip: phone ? { x: 0, y: 700, width: 393, height: 152 } : { x: 300, y: 780, width: 900, height: 120 } });
  await page.click('[data-submit]');
  await page.waitForTimeout(300);
  if (await page.$('[data-y]')) { await shot('11d-seal-ask'); await page.click('[data-y]'); }
  await page.waitForTimeout(1500);
  await shot('12-replay');
  await page.evaluate(() => window.tc.screen.endReplay());
  await page.waitForTimeout(500);
  await shot('13-turn2');
  // menu
  await page.click('[data-act=menu]');
  await page.waitForTimeout(200);
  await shot('14-menu');
  await page.keyboard.press('Escape');
  // ---------------------------------------------------------------- LIVE
  await start({ mode: 'live-fast', noteach: true });
  await page.evaluate(() => { const s = window.tc.screen, st = s.st; const f = st.fleets.find(f => f.owner === s.you); const n = (st.regions[f.region].links ?? st.regions[f.region].neighbors)[0]; s.addOrder({ type: 'move', fleet: f.id, path: [n] }); });
  await page.waitForTimeout(500);
  await shot('15-live');
  // ---------------------------------------------------------------- spectator (Watch AIs)
  await page.goto(base);
  await page.click('[data-l=watch]');
  await page.waitForTimeout(1200);
  await page.evaluate(() => { const s = window.tc.screen; s.endReplay(); s.src.advance(); });
  await page.waitForTimeout(600);
  await page.evaluate(() => window.tc.screen.endReplay());
  await page.waitForTimeout(400);
  await shot('16-spectator');
  await ctx.close();
}
for (const [tag, phone] of [['desk', false], ['phone', true]]) if (!only || only === tag) await run(tag, phone);
console.log('errors', JSON.stringify(errors));
await browser.close();
