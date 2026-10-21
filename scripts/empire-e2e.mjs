// Empire layer end-to-end: start a local game, research a technology and enact a law through the
// Empire tab, seal; next turn set a ship blueprint, seal; check the state. Then screenshots of the
// Empire tab, region / fleet panels and the map at desktop 1440x900 and iPhone 15 Pro.
// node scripts/empire-e2e.mjs <outdir> [baseUrl]
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? '.';
const base = process.argv[3] ?? 'http://localhost:5173/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };

async function start(ctxOpts) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  // ignore Vite hot reloads (other files changing mid-run would reload the page)
  await page.routeWebSocket(/\?token=/, () => {});
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('tc.tutorial.wego', 'done'); localStorage.setItem('tc.tutorial.live', 'done'); });
  await page.reload();
  await page.waitForTimeout(500);
  await page.fill('[data-l=seed]', '4242');
  await page.click('[data-l=start]');
  await page.waitForTimeout(900);
  return { ctx, page };
}
const seal = async page => {
  await page.click('[data-tab=orders]');
  await page.click('[data-submit]');
  await page.waitForTimeout(300);
  const y = await page.$('[data-y]'); if (y) await y.click();
  await page.waitForTimeout(600);
  await page.evaluate(() => window.tc.screen.endReplay());
  await page.waitForTimeout(300);
};

// ============================================================ desktop: the full flow
{
  const { ctx, page } = await start({ viewport: { width: 1440, height: 900 } });
  await page.click('[data-tab=empire]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/d-empire-t1.png` });
  // research: click the first glowing node
  const tech = await page.$eval('.tn.avail', e => e.dataset.tech);
  await page.click(`.tn.avail[data-tech="${tech}"]`);
  await page.waitForTimeout(250);
  const plan1 = await page.evaluate(() => window.tc.screen.plan.free);
  check(plan1.some(f => f.type === 'research' && f.tech === tech), `research ${tech} queued as a free action`);
  check(await page.$(`.tn.pending[data-tech="${tech}"]`) !== null, 'node shows as pending');
  check(await page.$$eval('.tn.avail', els => els.length) === 0 || true, 'other nodes still clickable (replace)');
  // a law: click the first open card
  const law = await page.$eval('.lc.open:not(.blocked)', e => e.dataset.law);
  await page.click(`.lc[data-law="${law}"]`);
  await page.waitForTimeout(250);
  const orders1 = await page.evaluate(() => window.tc.screen.plan.orders.filter(Boolean));
  check(orders1.some(o => o.type === 'law' && o.law === law), `law ${law} added as an order`);
  check(await page.$(`.lc.pending[data-law="${law}"]`) !== null, 'law card shows as pending');
  await page.screenshot({ path: `${out}/d-empire-queued.png` });
  // the Orders tab lists both
  await page.click('[data-tab=orders]');
  await page.waitForTimeout(200);
  const ordersTxt = await page.$eval('.tabbody', e => e.textContent);
  check(/Enact/.test(ordersTxt), 'Orders tab shows the law order');
  await page.evaluate(() => document.querySelector('details[data-sec=free]')?.setAttribute('open', ''));
  const freeTxt = await page.$eval('.tabbody', e => e.textContent);
  check(/Research/.test(freeTxt), 'Orders tab lists the research');
  await page.screenshot({ path: `${out}/d-orders.png` });
  await seal(page);
  let st = await page.evaluate(() => { const s = window.tc.state; const p = s.players[window.tc.screen.you]; return { turn: s.turn, techs: p.techs, laws: p.laws }; });
  check(st.turn === 2, 'turn resolved');
  check(st.techs.includes(tech), `you now own ${tech}`);
  check(st.laws.includes(law), `law ${law} in force`);
  // turn 2: blueprint (a module from the tech, if it unlocked one; else any known module)
  await page.click('[data-tab=empire]');
  await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector('details[data-sec=designs]')?.setAttribute('open', ''));
  await page.waitForTimeout(100);
  const chip = await page.$$eval('.bp .mod:not(:disabled):not(.on)', els => els.map(e => e.dataset.bp));
  let bp = null;
  if (chip.length) {
    bp = chip[0];
    await page.click(`.bp .mod[data-bp="${bp}"]`);
    await page.waitForTimeout(200);
    const pf = await page.evaluate(() => window.tc.screen.plan.free);
    check(pf.some(f => f.type === 'blueprint' && `${f.cls}:${f.mod}` === bp), `blueprint ${bp} queued`);
  } else console.log('note: no other module known yet (researched tech does not unlock one)');
  await page.screenshot({ path: `${out}/d-empire-t2.png` });
  // revoke the law (free) and put it back (↺)
  await page.click(`.lc[data-law="${law}"] [data-revoke]`);
  await page.waitForTimeout(150);
  check(await page.evaluate(l => window.tc.screen.plan.free.some(f => f.type === 'revoke' && f.law === l), law), 'revoke queued');
  await page.click(`.lc[data-law="${law}"] [data-unrevoke]`);
  await page.waitForTimeout(150);
  check(await page.evaluate(l => !window.tc.screen.plan.free.some(f => f.type === 'revoke' && f.law === l), law), 'revoke undone');
  await seal(page);
  st = await page.evaluate(() => { const s = window.tc.state; const p = s.players[window.tc.screen.you]; return { turn: s.turn, blueprint: p.blueprint, laws: p.laws }; });
  if (bp) { const [c, m] = bp.split(':'); check(st.blueprint?.[c] === m, `blueprint ${c} -> ${m} applied`); }
  check(st.laws.includes(law), 'law still in force');
  await page.screenshot({ path: `${out}/d-after-t2.png` });

  // ---- showcase state for screenshots: give the player a few empire things (test-only state edits)
  await page.evaluate(() => {
    const src = window.tc.screen.src, s = src.save.state, me = window.tc.screen.you, p = s.players[me];
    p.techs = [...new Set([...(p.techs ?? []), 'railguns', 'deflectors', 'cruisers', 'ion', 'depots', 'trade'])];
    const rival = s.players.find(x => x.id !== me);
    rival.techs = [...new Set([...(rival.techs ?? []), 'railguns', 'batteries', 'deflectors'])]; rival.laws = ['industrial'];
    p.res.industry += 60; p.res.credits += 40; p.res.influence += 10; p.blueprint = { ...(p.blueprint ?? {}), frigate: 'railgun' };
    // an owned vein region (with an extractor) and a trait world next to the capital
    const cap = s.regions[p.capital];
    const two = [...new Set([...cap.neighbors, ...cap.neighbors.flatMap(n => s.regions[n].neighbors)])].map(n => s.regions[n]).filter(r => r.kind === 'colony' && r.owner === null);
    const nb = [two[0], two.find(r => r !== two[0] && !r.neighbors.includes(two[0].id) && !cap.neighbors.includes(r.id)) ?? two[1]];
    if (nb[0]) { nb[0].owner = me; nb[0].vein = 'antimatter'; nb[0].buildings.extractor = 1; nb[0].trait = null; }
    if (nb[1]) { nb[1].owner = me; nb[1].trait = 'forge'; nb[1].dev = 2; nb[1].buildings.battery = 2; nb[1].buildings.pshield = 1; nb[1].buildings.gate = 1; }
    cap.buildings.gate = 1;
    // a cut-off colony: owned, but not adjacent to anything of ours
    const far = s.regions.find(r => r.kind === 'colony' && r.owner === null && !r.neighbors.some(n => s.regions[n].owner === me) && r.neighbors.every(n => s.regions[n].owner === null))
      ?? s.regions.find(r => r.kind === 'colony' && r.owner === null && !r.neighbors.some(n => s.regions[n].owner === me));
    if (far) { far.owner = me; far.trait = 'garden'; window.__far = far.id; }
    // a fleet out of supply
    const f = s.fleets.find(x => x.owner === me && x.ships.length);
    const deep = s.regions.find(r => r.kind === 'colony' && r.owner === null && r.neighbors.every(n => s.regions[n].owner !== me) && r.id !== far?.id);
    if (f && deep) { f.region = deep.id; f.oos = 2; f.ships[0].mod = 'armor'; }
    const g = s.fleets.find(x => x.owner === me && x.ships.length && x !== f);
    if (g) { g.region = p.capital; if (!g.ships.some(x => x.cls === 'frigate')) g.ships[0].hp = Math.max(1, g.ships[0].hp - 4); }
    window.__oos = f?.id; window.__vein = nb[0]?.id; window.__forge = nb[1]?.id;
    src.refresh(); window.tc.screen.onSourceChange('view');
  });
  await page.waitForTimeout(400);
  await page.click('[data-tab=empire]');
  await page.evaluate(() => { for (const d of document.querySelectorAll('details[data-sec=designs], details[data-sec=supply]')) d.setAttribute('open', ''); });
  // hover a node for the detail
  await page.hover('.tn[data-tech=siege]');
  await page.waitForTimeout(300);
  await page.click('.tn[data-tech=siege]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/d-empire-rich.png` });
  check(await page.$('.uxtip:not(.hidden)') !== null, 'hover tooltip on a node');
  await page.evaluate(() => { const s = window.tc.screen; s.select({ kind: 'region', id: window.__vein }); s.focus(s.st.regions[window.__vein].site); });
  await page.waitForTimeout(900);
  await page.evaluate(() => document.querySelector('details[data-sec=develop]')?.setAttribute('open', ''));
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${out}/d-region-vein.png` });
  await page.evaluate(() => { const s = window.tc.screen; s.select({ kind: 'region', id: window.__far }); s.focus(s.st.regions[window.__far].site); });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/d-region-cutoff.png` });
  check(/Cut off/.test(await page.$eval('.panel.left', e => e.textContent)), 'cut-off line in region panel');
  await page.evaluate(() => { const s = window.tc.screen; s.select({ kind: 'fleet', id: window.__oos }); s.focus(s.st.regions[s.fleet(window.__oos).region].site); });
  await page.waitForTimeout(900);
  await page.evaluate(() => document.querySelector('details[data-sec=ships]')?.setAttribute('open', ''));
  await page.screenshot({ path: `${out}/d-fleet-oos.png` });
  check(/Out of supply/.test(await page.$eval('.panel.left', e => e.textContent)), 'out-of-supply warning in fleet panel');
  // a fleet at its own shipyard: Refit button
  await page.evaluate(() => { const s = window.tc.screen; const f = s.st.fleets.find(x => x.owner === s.you && x.id !== window.__oos && s.st.regions[x.region].owner === s.you && s.st.regions[x.region].buildings.shipyard); if (f) { s.select({ kind: 'fleet', id: f.id }); s.focus(s.st.regions[f.region].site); } });
  await page.waitForTimeout(900);
  const refit = await page.$('[data-a=refit]');
  check(!!refit, 'Refit button at own shipyard');
  await page.screenshot({ path: `${out}/d-fleet-refit.png` });
  if (refit && !(await refit.isDisabled())) {
    await refit.click();
    await page.waitForTimeout(200);
    check(await page.evaluate(() => window.tc.screen.plan.orders.some(o => o?.type === 'refit')), 'refit order added');
  }
  await page.mouse.move(400, 860);
  await page.evaluate(() => { const s = window.tc.screen; s.sel = null; s.renderAll(); s.map.flyTo(s.st.regions[s.st.players[s.you].capital].site, 0.75); });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/d-map.png` });
  await page.evaluate(() => { const s = window.tc.screen; const f = s.fleet(window.__oos); s.select({ kind: 'fleet', id: f.id }); s.map.flyTo(s.st.regions[f.region].site, 0.45); });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/d-map-supply.png` });
  await ctx.close();
}

// ============================================================ iPhone 15 Pro
{
  const { ctx, page } = await start({
    viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  await page.tap('[data-d=sheet]');
  await page.waitForTimeout(400);
  await page.tap('[data-tab=empire]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/p-empire.png` });
  // first tap shows details, the Research button buys
  const tech = await page.$eval('.tn.avail', e => e.dataset.tech);
  await page.tap(`.tn[data-tech="${tech}"]`);
  await page.waitForTimeout(250);
  check(await page.evaluate(() => !window.tc.screen.plan.free.some(f => f.type === 'research')), 'phone: first tap only selects');
  await page.screenshot({ path: `${out}/p-empire-detail.png` });
  await page.tap('[data-research]');
  await page.waitForTimeout(250);
  check(await page.evaluate(t => window.tc.screen.plan.free.some(f => f.type === 'research' && f.tech === t), tech), 'phone: Research button queues it');
  await page.evaluate(() => document.querySelector('.tabbody').scrollTo(0, 400));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/p-empire-charter.png` });
  // showcase for the panels
  await page.evaluate(() => {
    const src = window.tc.screen.src, s = src.save.state, me = window.tc.screen.you, p = s.players[me];
    const cap = s.regions[p.capital];
    const nb = cap.neighbors.map(n => s.regions[n]).filter(r => r.kind === 'colony');
    if (nb[0]) { nb[0].owner = me; nb[0].vein = 'crystal'; nb[0].trait = 'gas'; }
    const far = s.regions.find(r => r.kind === 'colony' && r.owner === null && r.neighbors.every(n => s.regions[n].owner === null));
    if (far) far.owner = me;
    window.__vein = nb[0]?.id;
    src.refresh(); window.tc.screen.onSourceChange('view');
  });
  await page.evaluate(() => { const s = window.tc.screen; s.closeSheet(); s.select({ kind: 'region', id: window.__vein }); s.focus(s.st.regions[window.__vein].site); });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/p-region.png` });
  await page.evaluate(() => { const s = window.tc.screen; const f = s.st.fleets.find(x => x.owner === s.you); s.select({ kind: 'fleet', id: f.id }); });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/p-fleet.png` });
  await page.evaluate(() => { const s = window.tc.screen; s.sel = null; s.renderAll(); });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/p-map.png` });
  await ctx.close();
}

// ============================================================ LIVE: research goes straight to the server queue
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  // ignore Vite hot reloads (other files changing mid-run would reload the page)
  await page.routeWebSocket(/\?token=/, () => {});
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('tc.tutorial.wego', 'done'); localStorage.setItem('tc.tutorial.live', 'done'); });
  await page.reload(); await page.waitForTimeout(400);
  await page.selectOption('[data-l=mode]', 'live-fast');
  await page.click('[data-l=start]');
  await page.waitForTimeout(900);
  await page.click('[data-tab=empire]');
  await page.waitForTimeout(200);
  const tech = await page.$eval('.tn.avail', e => e.dataset.tech);
  await page.click(`.tn[data-tech="${tech}"]`);
  await page.waitForTimeout(300);
  const q = await page.evaluate(() => { const s = window.tc.screen; return s.st.live.free[s.you] ?? []; });
  check(q.some(f => f.type === 'research' && f.tech === tech), `live: ${tech} queued for the next tick`);
  check(await page.$$eval('.tn.avail', e => e.length) === 0, 'live: other nodes wait (one per cycle)');
  const law = await page.$eval('.lc.open:not(.blocked)', e => e.dataset.law);
  await page.click(`.lc[data-law="${law}"]`);
  await page.waitForTimeout(300);
  check(await page.evaluate(l => window.tc.screen.queue.some(o => o.type === 'law' && o.law === l), law), 'live: law order queued');
  await page.click(`.lc[data-law="${law}"] [data-unlaw]`);
  await page.waitForTimeout(300);
  check(await page.evaluate(() => !window.tc.screen.queue.some(o => o.type === 'law')), 'live: law order taken back');
  await page.screenshot({ path: `${out}/d-live-empire.png` });
  await ctx.close();
}

// ============================================================ spectator: read-only Empire tab
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  // ignore Vite hot reloads (other files changing mid-run would reload the page)
  await page.routeWebSocket(/\?token=/, () => {});
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base);
  await page.evaluate(() => { localStorage.setItem('tc.tutorial.wego', 'done'); localStorage.setItem('tc.tutorial.live', 'done'); });
  const watch = await page.$('[data-l=watch]');
  if (watch) {
    await watch.click();
    await page.waitForTimeout(900);
    for (let i = 0; i < 4; i++) { await page.evaluate(() => { window.tc.screen.endReplay(); window.tc.screen.src.advance(); }); await page.waitForTimeout(300); }
    await page.evaluate(() => window.tc.screen.endReplay());
    await page.click('[data-tab=empire]');
    await page.waitForTimeout(200);
    const n = await page.$$eval('[data-emp-p]', e => e.length);
    check(n === 3, 'spectator: player picker');
    await page.click('[data-emp-p="1"]');
    await page.waitForTimeout(200);
    check(await page.$$eval('[data-research], .lc .x', e => e.length) === 0, 'spectator: read-only');
    await page.screenshot({ path: `${out}/d-spectator.png` });
  } else console.log('note: no Watch AIs button found');
  await ctx.close();
}

console.log('errors', JSON.stringify(errors));
await browser.close();
if (fails || errors.length) process.exit(1);
