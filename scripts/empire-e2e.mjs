// Empire layer end-to-end through the UX v2 shell: start a local game, research a technology and enact a law in
// the Empire modal, seal; next turn set a ship blueprint, revoke + keep the law, seal; check the state. Then the
// selection cards for a vein world, a cut-off colony, an out-of-supply fleet and a fleet at its shipyard (Refit),
// at desktop 1440x900 and iPhone 15 Pro; LIVE research/law; spectator read-only Empire.
// node scripts/empire-e2e.mjs <outdir> [baseUrl]
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? '.';
const base = process.argv[3] ?? 'http://localhost:5173/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };
const wait = (page, ms = 250) => page.waitForTimeout(ms);

async function newPage(ctxOpts) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  await page.routeWebSocket(/\?token=/, () => {});
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(base);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('tc.tutorial.wego', 'done'); localStorage.setItem('tc.tutorial.live', 'done'); });
  await page.reload();
  await wait(page, 400);
  return { ctx, page };
}
async function start(ctxOpts, mode) {
  const { ctx, page } = await newPage(ctxOpts);
  if (mode) await page.selectOption('[data-l=mode]', mode);
  await page.fill('[data-l=seed]', '4242');
  await page.click('[data-l=start]');
  await page.waitForFunction(() => window.tc?.screen?.st);
  await wait(page, 700);
  return { ctx, page };
}
const openEmpire = async (page, tab) => { await page.evaluate(t => window.tc.screen.openModal('empire', t), tab); await wait(page, 350); };
const closeModal = async page => { await page.keyboard.press('Escape'); await wait(page, 350); };
const seal = async page => {
  await page.click('[data-submit]');
  await wait(page, 300);
  const y = await page.$('[data-y]'); if (y) await y.click();
  await wait(page, 600);
  await page.evaluate(() => window.tc.screen.endReplay());
  await wait(page, 300);
};
const research = async page => {
  const tech = await page.$eval('.rn.s-avail', e => e.dataset.id);
  await page.click(`.rn[data-id="${tech}"]`); await wait(page, 200);
  if (!(await page.$('.tcard [data-a=research]'))) await page.click(`.rn[data-id="${tech}"]`);
  await page.click('.tcard [data-a=research]'); await wait(page, 300);
  return tech;
};

// ============================================================ desktop: the full flow
{
  const { ctx, page } = await start({ viewport: { width: 1440, height: 900 } });
  check(await page.evaluate(() => !!document.querySelector('.hud-br [data-act=empire] .dot')), 'Empire button shows a dot: research available');
  await page.click('[data-act=empire]');
  await wait(page, 350);
  await page.screenshot({ path: `${out}/d-empire-t1.png` });
  const tech = await research(page);
  check(await page.evaluate(t => window.tc.screen.plan.free.some(f => f.type === 'research' && f.tech === t), tech), `research ${tech} queued as a free action`);
  await page.keyboard.press('2'); await wait(page, 300);
  const law = await page.$eval('[data-a=enact]', e => e.dataset.id);
  await page.click(`[data-a=enact][data-id="${law}"]`);
  await wait(page, 300);
  check(await page.evaluate(l => window.tc.screen.plan.orders.some(o => o?.type === 'law' && o.law === l), law), `law ${law} added as an order`);
  await page.screenshot({ path: `${out}/d-empire-queued.png` });
  await closeModal(page);
  // the strip shows the law order and the free change (research)
  check(!!(await page.$('.strip .chip.k-law')), 'strip shows the law order');
  check(!!(await page.$('.strip [data-act=free]')), 'strip shows the free change');
  await page.click('.strip [data-act=free]');
  await wait(page, 150);
  check(/Research|research/.test(await page.$eval('.freelist', e => e.textContent)), 'free list names the research');
  await page.screenshot({ path: `${out}/d-strip.png` });
  await seal(page);
  let st = await page.evaluate(() => { const s = window.tc.state; const p = s.players[window.tc.screen.you]; return { turn: s.turn, techs: p.techs, laws: p.laws }; });
  check(st.turn === 2, 'turn resolved');
  check(st.techs.includes(tech), `you now own ${tech}`);
  check(st.laws.includes(law), `law ${law} in force`);
  // turn 2: blueprint, revoke + keep
  await openEmpire(page, 'ships');
  const bp = await page.$('.mod[data-a=bp]');
  let bpId = null;
  if (bp) {
    bpId = await bp.evaluate(e => e.dataset.id);
    await bp.click(); await wait(page, 300);
    const [cls, mod] = bpId.split(':');
    check(await page.evaluate(([c, m]) => window.tc.screen.plan.free.some(f => f.type === 'blueprint' && f.cls === c && f.mod === m), [cls, mod]), `blueprint ${bpId} queued`);
  } else console.log('note: no other module known yet');
  await page.keyboard.press('2'); await wait(page, 300);
  const rv = await page.$(`.lw-card.s-on [data-a=revoke]`);
  if (rv) {
    await rv.click(); await wait(page, 200);
    check(await page.evaluate(l => window.tc.screen.plan.free.some(f => f.type === 'revoke' && f.law === l), law), 'revoke queued');
    await page.click(`[data-a=unrevoke][data-id="${law}"]`); await wait(page, 200);
    check(await page.evaluate(l => !window.tc.screen.plan.free.some(f => f.type === 'revoke' && f.law === l), law), 'revoke undone');
  } else check(false, 'revoke button on the enacted law');
  await closeModal(page);
  await seal(page);
  st = await page.evaluate(() => { const s = window.tc.state; const p = s.players[window.tc.screen.you]; return { blueprint: p.blueprint, laws: p.laws }; });
  if (bpId) { const [c, m] = bpId.split(':'); check(st.blueprint?.[c] === m, `blueprint ${c} -> ${m} applied`); }
  check(st.laws.includes(law), 'law still in force');

  // ---- showcase state for the cards (test-only state edits)
  await page.evaluate(() => {
    const src = window.tc.screen.src, s = src.save.state, me = window.tc.screen.you, p = s.players[me];
    p.res.industry += 60; p.res.credits += 40;
    const cap = s.regions[p.capital];
    const two = [...new Set([...cap.neighbors, ...cap.neighbors.flatMap(n => s.regions[n].neighbors)])].map(n => s.regions[n]).filter(r => r.kind === 'colony' && r.owner === null);
    const nb = two[0];
    if (nb) { nb.owner = me; nb.vein = 'antimatter'; nb.buildings.extractor = 1; nb.trait = 'forge'; nb.dev = 2; }
    const far = s.regions.find(r => r.kind === 'colony' && r.owner === null && !r.neighbors.some(n => s.regions[n].owner === me));
    if (far) { far.owner = me; window.__far = far.id; }
    const f = s.fleets.find(x => x.owner === me && x.ships.length);
    const deep = s.regions.find(r => r.kind === 'colony' && r.owner === null && r.neighbors.every(n => s.regions[n].owner !== me) && r.id !== far?.id);
    if (f && deep) { f.region = deep.id; f.oos = 2; f.route = null; }
    const g = s.fleets.find(x => x.owner === me && x.ships.length && x !== f);
    if (g) { g.region = p.capital; g.route = null; g.ships[0].hp = Math.max(1, g.ships[0].hp - 4); window.__yard = g.id; }
    window.__oos = f?.id; window.__vein = nb?.id;
    src.refresh(); window.tc.screen.onSourceChange('view');
  });
  await wait(page, 400);
  const card = () => page.$eval('.card', e => e.textContent);
  await page.evaluate(() => { const s = window.tc.screen; s.select({ kind: 'region', id: window.__vein }); s.focus(s.st.regions[window.__vein].site); });
  await wait(page, 900);
  await page.screenshot({ path: `${out}/d-region-vein.png` });
  check(!!(await page.$('.card [data-tray=develop]')), 'own planet card has the develop tray');
  await page.evaluate(() => { const s = window.tc.screen; s.select({ kind: 'region', id: window.__far }); s.focus(s.st.regions[window.__far].site); });
  await wait(page, 900);
  await page.screenshot({ path: `${out}/d-region-cutoff.png` });
  check(/½/.test(await card()), 'cut-off mark on the planet card');
  await page.evaluate(() => { const s = window.tc.screen; s.select({ kind: 'fleet', id: window.__oos }); s.focus(s.st.regions[s.fleet(window.__oos).region].site); });
  await wait(page, 900);
  await page.screenshot({ path: `${out}/d-fleet-oos.png` });
  check(/No supply/.test(await card()), 'out-of-supply mark on the fleet card');
  await page.evaluate(() => { const s = window.tc.screen; s.select({ kind: 'fleet', id: window.__yard }); s.focus(s.st.regions[s.fleet(window.__yard).region].site); });
  await wait(page, 900);
  const refit = await page.$('.card [data-a=refit]');
  check(!!refit, 'Refit button at own shipyard');
  await page.screenshot({ path: `${out}/d-fleet-refit.png` });
  if (refit && (await refit.getAttribute('aria-disabled')) !== 'true') {
    await refit.click(); await wait(page, 200);
    check(await page.evaluate(() => window.tc.screen.plan.orders.some(o => o?.type === 'refit')), 'refit order added');
  }
  await page.evaluate(() => { const s = window.tc.screen; s.deselect(); s.setLens('supply'); });
  await wait(page, 600);
  await page.screenshot({ path: `${out}/d-map-supply-lens.png` });
  await ctx.close();
}

// ============================================================ iPhone 15 Pro
{
  const { ctx, page } = await start({
    viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  // the modal buttons fold into the menu on a phone
  await page.tap('[data-act=menu]');
  await wait(page, 250);
  await page.tap('.pop [data-m=empire]');
  await wait(page, 450);
  await page.screenshot({ path: `${out}/p-empire.png` });
  const tech = await page.$eval('.rn.s-avail', e => e.dataset.id);
  await page.tap(`.rn[data-id="${tech}"]`); await wait(page, 250);
  check(await page.evaluate(() => !window.tc.screen.plan.free.some(f => f.type === 'research')), 'phone: first tap only selects');
  await page.screenshot({ path: `${out}/p-empire-detail.png` });
  await page.tap('.tcard [data-a=research]'); await wait(page, 250);
  check(await page.evaluate(t => window.tc.screen.plan.free.some(f => f.type === 'research' && f.tech === t), tech), 'phone: Research button queues it');
  await page.evaluate(() => window.tc.screen.hud.modalOpen() && document.querySelector('.mdl-back')?.click());
  await wait(page, 400);
  await page.evaluate(() => { const s = window.tc.screen; s.select({ kind: 'region', id: s.st.players[s.you].capital }); });
  await wait(page, 900);
  await page.screenshot({ path: `${out}/p-region.png` });
  await page.evaluate(() => { const s = window.tc.screen; const f = s.st.fleets.find(x => x.owner === s.you); s.select({ kind: 'fleet', id: f.id }); });
  await wait(page, 900);
  await page.screenshot({ path: `${out}/p-fleet.png` });
  await ctx.close();
}

// ============================================================ LIVE: research goes straight to the server queue
{
  const { ctx, page } = await start({ viewport: { width: 1440, height: 900 } }, 'live-fast');
  await openEmpire(page, 'research');
  const tech = await research(page);
  const q = await page.evaluate(() => { const s = window.tc.screen; return s.st.live.free[s.you] ?? []; });
  check(q.some(f => f.type === 'research' && f.tech === tech), `live: ${tech} queued for the next tick`);
  await page.keyboard.press('2'); await wait(page, 300);
  const law = await page.$eval('[data-a=enact]', e => e.dataset.id).catch(() => null);
  if (law) {
    await page.click(`[data-a=enact][data-id="${law}"]`); await wait(page, 300);
    check(await page.evaluate(l => window.tc.screen.queue.some(o => o.type === 'law' && o.law === l), law), 'live: law order queued');
    await page.click(`[data-a=unlaw][data-id="${law}"]`); await wait(page, 300);
    check(await page.evaluate(() => !window.tc.screen.queue.some(o => o.type === 'law')), 'live: law order taken back');
  } else check(false, 'live: an enactable law');
  await page.screenshot({ path: `${out}/d-live-empire.png` });
  await ctx.close();
}

// ============================================================ spectator: read-only Empire
{
  const { ctx, page } = await newPage({ viewport: { width: 1440, height: 900 } });
  await page.click('[data-l=watch]');
  await wait(page, 900);
  for (let i = 0; i < 4; i++) { await page.evaluate(() => { window.tc.screen.endReplay(); window.tc.screen.src.advance(); }); await wait(page, 300); }
  await page.evaluate(() => window.tc.screen.endReplay());
  await openEmpire(page);
  check(await page.$$eval('[data-a=emp-pid]', e => e.length) === 3, 'spectator: player picker');
  await page.click('[data-a=emp-pid][data-id="1"]'); await wait(page, 250);
  check(await page.$$eval('[data-a=research], [data-a=enact]', e => e.length) === 0, 'spectator: read-only');
  await page.screenshot({ path: `${out}/d-spectator.png` });
  await ctx.close();
}

console.log('errors', JSON.stringify(errors));
await browser.close();
if (fails || errors.length) process.exit(1);
