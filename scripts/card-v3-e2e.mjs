// The world and fleet cards v3 (docs/WORLD-CARD.md §8.7): three verbs on every own world; the phone face fits at
// 393x852 without scrolling; the Gambit is absent without a threat and present under one; a peek on long-press
// (touch) and hover (mouse); and a screenshot of every card state on PC (1440x900), iPad (1180x820) and phone
// (393x852): Raise / Improve / Story, locks open, no yard, Gambit open, contested + terms, just taken (raze or keep),
// a Calling to choose, tribute, a rival world, a neutral one, a fogged one, the fleet card (Orders, Story + Gambit),
// a rival fleet, and the phone sheet at peek and full.
// node scripts/card-v3-e2e.mjs [outdir] [base] [pc|ipad|phone]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? '/tmp/claude-0/cards';
const base = process.argv[3] ?? 'http://localhost:5173/';
const only = process.argv[4];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const DEVICES = {
  pc: { viewport: { width: 1440, height: 900 } },
  ipad: { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPAD },
  phone: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE },
};

async function run(tag) {
  const touch = tag !== 'pc', phone = tag === 'phone';
  const ctx = await browser.newContext(DEVICES[tag]);
  const page = await ctx.newPage();
  await page.routeWebSocket(/\?token=/, () => {});
  page.on('pageerror', e => errors.push(`${tag}: ${e.message} ${e.stack?.split('\n')[1] ?? ''}`));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${tag}: ${m.text()}`); });
  const shot = n => page.screenshot({ path: `${out}/${tag}-${n}.png` });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const edit = (fn, arg) => page.evaluate(([src, a]) => { const s = window.tc.screen; const f = new Function('s', 'st', 'a', src); f(s, s.src.save.state, a); s.src.refresh(); s.onSourceChange('view'); }, [fn, arg]);
  const select = async (kind, id) => { await ev(([kind, id]) => { const s = window.tc.screen; s.select({ kind, id }); }, [kind, id]); await page.waitForTimeout(450); };
  const click = async sel => { await ev(sel => document.querySelector(sel)?.click(), sel); await page.waitForTimeout(300); };
  const full = async () => { if (phone) { await ev(() => { const c = document.querySelector('.card'); if (c?.dataset.snap === 'peek') document.querySelector('.card .wc-tabs .on')?.click(); }); await page.waitForTimeout(300); } };

  await page.goto(base);
  await ev(() => { localStorage.clear(); localStorage.setItem('tc.tutorial.wego', 'done'); localStorage.setItem('tc.tutorial.live', 'done'); localStorage.setItem('tc.herald.auto', 'off'); });
  await page.goto(base);
  await page.fill('[data-l=seed]', '4242');
  await page.click('[data-l=start]');
  await page.waitForFunction(() => window.tc?.screen?.st);
  await page.waitForTimeout(1200);
  const info = await ev(() => {
    const s = window.tc.screen, st = s.st, you = s.you;
    const cap = st.players[you].capital;
    const near = [];
    const seen = new Set([cap]); let fr = [cap];
    while (fr.length && near.length < 6) { const nx = []; for (const id of fr) for (const n of st.regions[id].neighbors) if (!seen.has(n)) { seen.add(n); nx.push(n); if (st.regions[n].kind === 'colony' && st.regions[n].owner === null) near.push(n); } fr = nx; }
    const vis = s.visibleSet();
    const fog = st.regions.find(r => r.kind === 'colony' && !vis.has(r.id))?.id ?? null;
    const rival = (you + 1) % 3;
    return { you, rival, cap, near, fog, rivalCap: st.players[rival].capital, fleet: st.fleets.find(f => f.owner === you && f.ships.length)?.id };
  });

  // ---------------------------------------------------------------- your capital: face + the three verbs
  await select('region', info.cap);
  check(!(await page.$('.card .gambit')), `${tag}: no Gambit on turn 1 without a threat`);
  check(await ev(() => document.querySelectorAll('.card .wc-tabs [data-a=tab]').length === 3), `${tag}: three verbs`);
  if (phone) {
    const fit = await ev(() => { const c = document.querySelector('.card'), r = c.getBoundingClientRect(); return { snap: c.dataset.snap, inView: r.top >= 0 && r.bottom <= innerHeight, noScroll: c.scrollHeight <= c.clientHeight + 1, primary: !!c.querySelector('.primary') }; });
    check(fit.snap === 'peek' && fit.inView && fit.noScroll, `${tag}: the face fits at 393x852 without scrolling (${JSON.stringify(fit)})`);
    check(fit.primary, `${tag}: the peek carries one big suggested action`);
    await shot('01-peek');
  }
  await click('.card [data-a=tab][data-t=raise]');
  await full();
  await page.waitForTimeout(600);   // the planner's suggestion lands in idle time
  await shot('02-raise');
  // a peek on a hull: long-press on touch, hover with a mouse
  const hull = await page.$('.card .hull[data-peek]');
  if (hull) {
    const b = await hull.boundingBox();
    if (touch) {
      const cdp = await ctx.newCDPSession(page);
      const pt = [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt });
      const peeked = await page.waitForSelector('.cardpeek.on', { timeout: 4000 }).then(() => true, () => false);
      check(peeked, `${tag}: a long-press peeks at a hull`);
      await shot('03-peek-hull');
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(200);
      check(!(await ev(() => window.tc.screen.plan.orders.some(Boolean))), `${tag}: the long-press did not also queue the hull`);
    } else {
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForTimeout(250);
      check(await ev(() => !!document.querySelector('.cardpeek.on')), `${tag}: hovering a hull peeks at it`);
      await shot('03-peek-hull');
      await page.mouse.move(5, 300);
    }
  }
  await click('.card [data-a=lockx]');
  await shot('04-raise-locks');
  await click('.card [data-a=lockx]');
  await click('.card [data-a=tab][data-t=improve]');
  await shot('05-improve');
  await click('.card [data-a=tab][data-t=story]');
  await shot('06-story');

  // ---------------------------------------------------------------- a threat next door from turn 3: the Gambit
  await edit(`st.turn = 4; const [cap, R] = a; const n = st.regions[cap].neighbors.find(x => st.regions[x].kind !== 'lane');
    const tmpl = st.fleets.find(f => f.owner === R && f.ships.length); const f = JSON.parse(JSON.stringify(tmpl)); f.id = st.nextId++; f.region = n; f.route = null; f.name = 'The Black Lances'; st.fleets.push(f);`, [info.cap, info.rival]);
  await select('region', info.cap);
  check(/next door|here/.test(await ev(() => document.querySelector('.card .gchip')?.textContent ?? '')), `${tag}: a hostile fleet next door raises the Gambit`);
  if (phone) await shot('07-peek-gambit');
  await click('.card [data-a=gambit]');
  await click('.card [data-a=wposture][data-p=levies]');
  check(await ev(() => !!document.querySelector('.card .bet.on') && /siege lands/.test(document.querySelector('.card .betline')?.textContent ?? '')), `${tag}: Levies chosen: its bet lines show`);
  check(!(await page.$('.card [data-a=wposture][data-p=gates]')), `${tag}: no Open the Gates in the simplified world`);
  await shot('08-gambit-open');
  await click('.card [data-a=wposture][data-p=""]');
  await click('.card [data-a=gambit]');

  // ---------------------------------------------------------------- a 1-citizen world: no yard (the locked verb teaches)
  const [A, B, C, D, E] = info.near;
  await edit(`const r = st.regions[a]; r.owner = s.you; r.dev = 1; r.garrison = 10; r.project = null; r.buildings = {}; r.star = 'red';
    r.bodies = [{ kind: 'barren', q: 'rich', name: r.name + ' I' }, { kind: 'barren', name: 'Ash' }, { kind: 'belt', name: 'the Iron Belt' }];`, A);
  await select('region', A);
  await click('.card [data-a=tab][data-t=raise]');
  await full();
  check(/No yard here/.test(await ev(() => document.querySelector('.card')?.innerText ?? '')), `${tag}: Raise at a world without a yard teaches the step`);
  await shot('09-no-yard');

  // ---------------------------------------------------------------- contested, terms offered
  await edit(`const [A, R] = a; const r = st.regions[A]; r.owner = s.you; r.dev = 3; r.garrison = 23; r.project = null; r.buildings = { mine: 1 }; r.star = 'yellow';
    r.bodies = [{ kind: 'habitable', q: 'fair', name: 'Vel II', adj: 'ocean' }, { kind: 'gas', name: 'Tyr' }, { kind: 'belt', name: 'the Ashen Belt' }]; r.contested = 1;
    const tmpl = st.fleets.find(f => f.owner === R && f.ships.length); const f = JSON.parse(JSON.stringify(tmpl)); f.id = st.nextId++; f.region = A; f.siege = A; f.route = null;
    f.ships = f.ships.concat(JSON.parse(JSON.stringify(f.ships))).map((x, i) => ({ ...x, id: st.nextId++ + i })); st.fleets.push(f); st.players[R].tributeOffers = [A];`, [B, info.rival]);
  await select('region', B);
  check(await ev(() => !!document.querySelector('.card .prompt.terms') && !!document.querySelector('.card .ribbon.war') && !!document.querySelector('.card .gchip')), `${tag}: contested: war ribbon, terms prompt, Gambit`);
  await shot('10-contested-terms');

  // ---------------------------------------------------------------- just taken: raze or keep; a Calling to choose
  await edit(`const [C, R] = a; const r = st.regions[C]; r.owner = s.you; r.dev = 3; r.garrison = 6; r.project = null; r.buildings = {}; r.star = 'yellow';
    r.bodies = [{ kind: 'habitable', q: 'fair', name: 'Kessa I', adj: 'steppe' }, { kind: 'moon', name: 'Nyx' }];
    r.occupied = { by: s.you, until: st.turn + 2 };
    r.story = r.story ?? { toil: 0, blood: 0, siege: 0, relic: 0, loss: 0, owners: [], epithet: null, calling: null, tenureFrom: st.turn, deeds: [] };
    r.story.owners.push({ p: R, turn: 2, how: 'start' }, { p: s.you, turn: st.turn, how: 'seized' });
    r.story.captured = { by: s.you, turn: st.turn, from: R };
    r.story.calling = { id: 'bastion', since: 2, dormantUntil: st.turn + 3 };`, [C, info.rival]);
  await select('region', C);
  check(await ev(() => !!document.querySelector('.card .prompt.raze [data-a=raze]') && !!document.querySelector('.card .wc-calling.dorm')), `${tag}: just taken: Raze / Keep prompt, dormant Calling`);
  await shot('11-occupied-raze');
  await edit(`const r = st.regions[a]; r.owner = s.you; r.dev = 3; r.garrison = 30; r.project = null; r.star = 'yellow'; r.buildings = {};
    r.bodies = [{ kind: 'habitable', q: 'fair', name: 'Mire I', adj: 'jungle' }, { kind: 'moon', name: 'Lanthe' }, { kind: 'belt', name: 'the Glass Belt' }];
    r.story = r.story ?? { toil: 0, blood: 0, siege: 0, relic: 0, loss: 0, owners: [], epithet: null, calling: null, tenureFrom: st.turn, deeds: [] };
    r.story.calling = null; r.story.pendingCalling = { options: ['granary', 'proving'], since: st.turn, owner: s.you, gated: [{ id: 'cenotaph', why: 'needs 2 battles fought here (0 so far)' }] };`, D);
  await select('region', D);
  check(await ev(() => document.querySelectorAll('.card .prompt.calling .pick:not(.gated)').length === 2), `${tag}: a Calling to choose: two picks on the face`);
  await shot('12-calling');

  // ---------------------------------------------------------------- paying tribute
  await edit(`const [E, R] = a; const r = st.regions[E]; r.owner = s.you; r.dev = 1; r.garrison = 20; r.project = null; r.buildings = {}; r.star = 'blue';
    r.bodies = [{ kind: 'gas', name: 'Orrin' }]; r.tribute = { from: s.you, to: R, since: st.turn - 1, until: st.turn + 3 };`, [E, info.rival]);
  await select('region', E);
  check(/Tribute/.test(await ev(() => document.querySelector('.card .ribbon')?.textContent ?? '')), `${tag}: paying tribute: the ribbon says so`);
  await shot('13-tribute');

  // ---------------------------------------------------------------- a rival's world, a neutral one, a fogged one
  await select('region', info.rivalCap);
  check(!(await page.$('.card .wc-tabs')) && await ev(() => !!document.querySelector('.card .intrigue')), `${tag}: a rival's world: read-only face, intrigue verbs`);
  await shot('14-rival-world');
  const neutral = await ev(() => { const s = window.tc.screen; const vis = s.visibleSet(); return s.st.regions.find(r => r.owner === null && r.kind === 'colony' && vis.has(r.id))?.id ?? null; });
  if (neutral !== null) { await select('region', neutral); await shot('15-neutral'); }
  const fogged = await ev(() => { const s = window.tc.screen; const vis = s.visibleSet(); return s.st.regions.find(r => (r.kind === 'colony' || r.kind === 'crown') && !vis.has(r.id) && r.owner !== s.you)?.id ?? null; });
  if (fogged !== null) {
    await select('region', fogged);
    check(await ev(() => !!document.querySelector('.card .wc-art.fog') && /\?/.test(document.querySelector('.card .garr')?.textContent ?? '')), `${tag}: a fogged world: desaturated art, garrison "?"`);
    await shot('16-fogged');
  }

  // ---------------------------------------------------------------- the fleet card, a rival fleet
  await select('fleet', info.fleet);
  await full();
  check(await ev(() => document.querySelectorAll('.card .wc-tabs [data-a=ftab]').length === 2 && !!document.querySelector('.card .fan')), `${tag}: the fleet card: two verbs and the ship fan on the face`);
  await shot('17-fleet-orders');
  await click('.card [data-a=ftab][data-t=story]');
  await click('.card [data-a=gambit]');
  check(await ev(() => document.querySelectorAll('.card .gopen .bet').length >= 4), `${tag}: the fleet's Gambit: postures and Fate on one control`);
  await shot('18-fleet-story-gambit');
  await click('.card [data-a=gambit]');
  await click('.card [data-a=ftab][data-t=orders]');
  const foe = await ev(() => { const s = window.tc.screen; return s.st.fleets.find(f => f.owner !== s.you && f.ships.length && s.visibleSet().has(f.region))?.id ?? null; });
  if (foe !== null) { await select('fleet', foe); await shot('19-rival-fleet'); }
  if (phone) {
    await select('region', info.cap);
    await click('.card [data-a=tab][data-t=improve]');
    check(await ev(() => document.querySelector('.card')?.dataset.snap === 'full'), `${tag}: a verb opens the full sheet`);
    await shot('20-full-improve');
  }
  await ctx.close();
}

for (const t of ['pc', 'ipad', 'phone']) if (!only || only === t) await run(t);
await browser.close();
console.log(errors.length ? `page errors:\n${errors.join('\n')}` : 'no page errors');
console.log(fails ? `${fails} check(s) FAILED` : 'all checks passed');
process.exit(fails || errors.length ? 1 : 0);
