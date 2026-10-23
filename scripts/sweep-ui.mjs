// UI/lobby/multiplayer bug sweep (repros for the fixes in the modal/lobby/net sweep).
// node scripts/sweep-ui.mjs [base] [part...]   parts: mp empire lobby seatlink live leak shots restart (default: all but restart)
// `restart` needs SERVER_PID=<pid of the tsx server node process>; it kills and restarts the game server.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
const base = process.argv[2] ?? 'http://localhost:5173/';
const parts = process.argv.slice(3);
const want = p => (parts.length ? parts.includes(p) : p !== 'restart');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fails = 0;
const check = (ok, what, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra ? ' · ' + extra : ''}`); if (!ok) fails++; };
const XSS = '<img src=x onerror="window.__xss=1">';

async function mkCtx(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...opts });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('tc.tutorial.wego', 'done'); localStorage.setItem('tc.tutorial.live', 'done'); localStorage.setItem('tc.herald.auto', 'off'); } catch { /* */ }
    // count live window/document listeners (leak check)
    const live = new Map();
    for (const T of [Window.prototype, Document.prototype]) {
      const add = T.addEventListener, rem = T.removeEventListener;
      T.addEventListener = function (t, f, o) { if (this === window || this === document) { const k = `${this === window ? 'w' : 'd'}:${t}`; live.set(f, k); } return add.call(this, t, f, o); };
      T.removeEventListener = function (t, f, o) { live.delete(f); return rem.call(this, t, f, o); };
    }
    window.__listeners = () => { const c = {}; for (const k of live.values()) c[k] = (c[k] ?? 0) + 1; return c; };
  });
  return ctx;
}
async function mkPage(ctx, errors, tag) {
  const p = await ctx.newPage();
  await p.routeWebSocket(/\?token=/, () => {});
  p.on('pageerror', e => errors.push(`${tag}: ${e.message}`));
  p.on('console', m => { if (m.type() === 'error' && !/WebSocket|ERR_CONNECTION|Failed to load resource/.test(m.text())) errors.push(`${tag} console: ${m.text()}`); });
  return p;
}
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(p, fn, arg, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await p.evaluate(fn, arg)) return true; } catch { /* navigating */ } await wait(150); }
  return false;
}

async function createGame(page, { name = 'Alice', mode = 'wego', s1 = 'human', s2 = 'human' } = {}) {
  await page.goto(base);
  await page.fill('[data-l=name]', name);
  await page.selectOption('[data-o=mode]', mode);
  await page.selectOption('[data-o=s1]', s1);
  await page.selectOption('[data-o=s2]', s2);
  await page.click('[data-o=create]');
  await page.waitForSelector('[data-go]');
  const link = await page.inputValue('.dialog input');
  await page.click('[data-go]');
  await until(page, () => !!window.tc?.screen);
  return link;
}
async function joinGame(page, link, name) {
  await page.goto(link);
  await page.waitForSelector('[data-seat]');
  await page.fill('[data-name]', name);
  await page.click('[data-seat]');
  await until(page, () => !!window.tc?.screen);
}
const seal = p => p.evaluate(() => window.tc.screen.src.submit(window.tc.screen.plan));

// ================================================================ WEGO multiplayer
if (want('mp')) {
  const errors = [];
  const [ca, cb, cc] = [await mkCtx(), await mkCtx(), await mkCtx()];
  const a = await mkPage(ca, errors, 'A'), b = await mkPage(cb, errors, 'B'), c = await mkPage(cc, errors, 'C');
  const link = await createGame(a, { name: XSS });
  await joinGame(b, link, 'Bob');
  await joinGame(c, link, 'Cara');
  check(!(await a.evaluate(() => window.__xss)) && !(await b.evaluate(() => window.__xss)), 'hostile player name is escaped');
  // second tab on seat A (same browser)
  const a2 = await mkPage(ca, errors, 'A2');
  await a2.goto(link);
  await until(a2, () => !!window.tc?.screen && window.tc.screen.you === 0);
  check(await a2.evaluate(() => window.tc.screen.you) === 0, 'second tab is seated on the same seat');
  await seal(a);
  await wait(800);
  check(await a.evaluate(() => !!window.tc.screen.src.mySubmission), 'A sealed');
  check(await a2.evaluate(() => !!window.tc.screen.src.mySubmission), 'second tab of A sees the seal');
  // unseal from tab 2: tab 1 must see it too
  await a2.evaluate(() => window.tc.screen.src.unsubmit());
  await wait(800);
  check(await a.evaluate(() => !window.tc.screen.src.mySubmission), 'unseal from the second tab reaches the first');
  // resubmit
  await seal(a); await seal(a); await wait(500);
  check(await a.evaluate(() => !!window.tc.screen.src.mySubmission), 'resubmit keeps the seal');
  // tab closed and reopened
  await b.close();
  const b2 = await mkPage(cb, errors, 'B2');
  await b2.goto(base + '#/g/' + link.split('#/g/')[1]);
  await until(b2, () => !!window.tc?.screen && window.tc.screen.you === 1);
  check(await b2.evaluate(() => window.tc?.screen?.you) === 1, 'reopened tab keeps its seat');
  // spectator
  const cs = await mkCtx();
  const s = await mkPage(cs, errors, 'S');
  await s.goto(link);
  await until(s, () => !!window.tc?.screen);
  check(await s.evaluate(() => window.tc?.screen?.you === null), 'spectator link spectates (all seats taken)');
  // notification title while hidden
  await a.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); });
  await seal(b2); await seal(c);
  await until(a, () => window.tc.state.turn === 2);
  const turns = await Promise.all([a, a2, b2, c, s].map(p => p.evaluate(() => window.tc.state.turn)));
  check(turns.every(t => t === 2), 'turn resolved for all', JSON.stringify(turns));
  check(await a.evaluate(() => document.title.startsWith('(!)')), 'hidden tab gets the turn-ready title', await a.evaluate(() => document.title));
  // notifications must not repeat for every later view of the same turn
  await a.evaluate(() => { window.__notes = 0; window.Notification = class { static permission = 'granted'; constructor() { window.__notes++; } }; });
  await seal(b2); await wait(400); await b2.evaluate(() => window.tc.screen.src.unsubmit()); await wait(400);
  await a2.evaluate(() => window.tc.screen.src.submit(window.tc.screen.plan)); await wait(400);
  check(await a.evaluate(() => window.__notes) === 0, 'no repeat notification for the same turn', `notes=${await a.evaluate(() => window.__notes)}`);
  await a.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  check(await a.evaluate(() => document.title) === 'Three Crowns', 'title restored when visible');
  console.log('mp errors', JSON.stringify(errors));
  check(!errors.length, 'no page errors (mp)');
  for (const x of [ca, cb, cc, cs]) await x.close();
}

// ================================================================ Empire modal: research change vs a module that needed it
async function research(p, id) {
  await p.$eval(`.rn[data-id=${id}]`, e => e.click()); await wait(150);
  await p.$eval('.tcard [data-a=research]', e => e.click()); await wait(150);
}
if (want('empire')) {
  const errors = [];
  const ctx = await mkCtx();
  const p = await mkPage(ctx, errors, 'E');
  p.on('dialog', d => d.accept());
  await p.goto(base + '#/');
  await p.click('[data-l=start]');
  await until(p, () => !!window.tc?.screen);
  await p.evaluate(async () => { window.__m = await import('/src/ui/modals.ts'); const pl = window.tc.state.players[window.tc.screen.you]; pl.res.industry += 200; pl.res.credits += 200; pl.res.influence += 50; });
  await p.evaluate(() => window.__m.openModal(window.tc.screen, 'empire', 'research'));
  await research(p, 'railguns');
  await p.evaluate(() => window.__m.openModal(window.tc.screen, 'empire', 'ships'));
  const bp = await p.$('.mod[data-a=bp][data-id$=":railgun"]');
  check(!!bp, 'railgun module offered once Railguns is queued');
  if (bp) await bp.click();
  await p.evaluate(() => window.__m.openModal(window.tc.screen, 'empire', 'research'));
  // research something else instead: the railgun design can no longer be built
  await research(p, 'deflectors');
  let free = await p.evaluate(() => window.tc.screen.plan.free.map(f => f.type + ':' + (f.tech ?? f.mod)));
  check(!free.includes('blueprint:railgun'), 'changing research drops a design that needed the old tech', JSON.stringify(free));
  // research then a design that needs it: research must stay ahead of the design in the plan
  await p.evaluate(() => window.__m.openModal(window.tc.screen, 'empire', 'ships'));
  const bp2 = await p.$('.mod[data-a=bp][data-id$=":deflector"]');
  if (bp2) await bp2.click();
  await p.evaluate(() => window.__m.openModal(window.tc.screen, 'empire', 'research'));
  await research(p, 'railguns');
  await research(p, 'deflectors');
  free = await p.evaluate(() => window.tc.screen.plan.free.map(f => f.type + ':' + (f.tech ?? f.mod)));
  const ri = free.findIndex(x => x.startsWith('research')), bi = free.findIndex(x => x === 'blueprint:deflector');
  check(bi < 0 || ri < bi, 'research is applied before the design that needs it', JSON.stringify(free));
  await p.evaluate(() => window.__m.openModal(window.tc.screen, 'empire', 'ships'));
  const bp3 = await p.$('.mod[data-a=bp][data-id$=":deflector"]');
  if (bp3) await bp3.click();
  await p.evaluate(() => window.__m.closeModal());
  await p.evaluate(() => window.tc.screen.src.submit(window.tc.screen.plan));
  await until(p, () => window.tc.state.turn === 2);
  const res = await p.evaluate(() => { const s = window.tc.screen; const pl = s.st.players[s.you]; return { techs: pl.techs, bp: pl.blueprint, fails: (s.st.last?.events ?? []).filter(e => e.k === 'fail' && e.owner === s.you).map(e => e.text) }; });
  check(!res.fails.length && Object.values(res.bp).includes('deflector'), 'research + design both applied, no failed free actions', JSON.stringify(res));
  console.log('empire errors', JSON.stringify(errors));
  check(!errors.length, 'no page errors (empire)');
  await ctx.close();
}

// ================================================================ lobby: tweaks and sound
if (want('lobby')) {
  const errors = [];
  const ctx = await mkCtx();
  const p = await mkPage(ctx, errors, 'Lb');
  await p.goto(base + '#/');
  await p.evaluate(() => { localStorage.removeItem('tc.rules.overrides'); localStorage.removeItem('tc.audio.v1'); });
  await p.reload();
  await p.click('[data-l=tweaks]');
  const inp = '.tweaks input[data-path="orders.perTurn"]';
  await p.fill(inp, '4'); await p.press(inp, 'Tab');
  await p.click('[data-x=close]');
  await wait(300);
  check(/1 (groups )?changed/.test(await p.textContent('[data-l=tweaks]')), 'lobby Tweaks button recounts after closing', await p.textContent('[data-l=tweaks]'));
  await p.click('[data-l=tweaks]');
  await p.fill(inp, ''); await p.press(inp, 'Tab');
  const ov = await p.evaluate(() => localStorage.getItem('tc.rules.overrides'));
  check(ov === '{}' && await p.inputValue(inp) === '5', 'an emptied number reverts to the default (not 0)', `${ov} ${await p.inputValue(inp)}`);
  await p.click('[data-x=close]');
  await p.click('[data-l=sound]');
  const before = await p.innerHTML('[data-l=sound]');
  await p.click('.audio-mute');
  await wait(200);
  check(await p.innerHTML('[data-l=sound]') !== before, 'lobby Sound button shows the mute state');
  console.log('lobby errors', JSON.stringify(errors));
  check(!errors.length, 'no page errors (lobby)');
  await ctx.close();
}

// ================================================================ seat links
if (want('seatlink')) {
  const errors = [];
  const [ca, cb, cx] = [await mkCtx(), await mkCtx(), await mkCtx()];
  const a = await mkPage(ca, errors, 'A');
  const link = await createGame(a, { name: 'Alice' });
  const seatLink = await a.evaluate(() => `${location.origin}${location.pathname}#/g/${window.tc.screen.src.meta.id}/${window.tc.screen.src.token}`);
  // another device opens the private seat link: seated as Alice
  const b = await mkPage(cb, errors, 'B');
  await b.goto(seatLink);
  await until(b, () => !!window.tc?.screen);
  check(await b.evaluate(() => window.tc.screen.you) === 0 && !/\/g\/[^/]+\//.test(await b.evaluate(() => location.hash)), 'seat link seats you and hides the token from the URL');
  // a mistyped seat link: must not lock the browser out of the join dialog
  const x = await mkPage(cx, errors, 'X');
  await x.goto(link + '/not-a-real-token');
  await x.waitForSelector('[data-seat]', { timeout: 8000 }).catch(() => {});
  check(!!(await x.$('[data-seat]')), 'a bad seat link still offers the open seats');
  check(await x.evaluate(id => localStorage.getItem(`tc.token.${id}`), link.split('#/g/')[1]) === null, 'a bad seat link is not remembered');
  console.log('seatlink errors', JSON.stringify(errors));
  check(!errors.length, 'no page errors (seatlink)');
  for (const c of [ca, cb, cx]) await c.close();
}

// ================================================================ LIVE multiplayer
if (want('live')) {
  const errors = [];
  const [ca, cb, cc] = [await mkCtx(), await mkCtx(), await mkCtx()];
  const a = await mkPage(ca, errors, 'A'), b = await mkPage(cb, errors, 'B'), c = await mkPage(cc, errors, 'C');
  const link = await createGame(a, { name: 'Alice', mode: 'live-blitz' });
  await joinGame(b, link, 'Bob');
  await joinGame(c, link, 'Cara');
  const a2 = await mkPage(ca, errors, 'A2');
  await a2.goto(link);
  await until(a2, () => window.tc?.screen?.you === 0);
  const tick0 = await a.evaluate(() => window.tc.state.live.tick);
  // a fleet move order from A: the second tab of A sees the queue
  const order = await a.evaluate(() => {
    const s = window.tc.screen, st = s.st, f = st.fleets.find(f => f.owner === s.you);
    const n = st.regions[f.region].neighbors[0];
    return { type: 'move', fleet: f.id, path: [n] };
  });
  const bank0 = await Promise.all([a, a2].map(p => p.evaluate(() => window.tc.screen.bank)));
  for (const n of await a.evaluate(f => window.tc.state.regions[window.tc.state.fleets.find(x => x.id === f).region].neighbors, order.fleet)) {
    await a.evaluate(o => window.tc.screen.src.liveOrder(o), { ...order, path: [n] });
    await wait(600);
    if (await a.evaluate(() => window.tc.screen.bank) < bank0[0]) break;
  }
  const bank1 = await Promise.all([a, a2].map(p => p.evaluate(() => window.tc.screen.bank)));
  const err = await a.evaluate(() => window.tc.screen.src.lastError);
  check(bank1[0] === bank0[0] - 1 && bank1[1] === bank1[0], 'LIVE order spends a banked order on both tabs of the seat', JSON.stringify({ bank0, bank1, err }));
  // a hostile dispatch, filed by B in LIVE (free action)
  await b.evaluate(t => window.tc.screen.src.liveFree({ type: 'dispatch', text: t, as: 'house' }), XSS);
  await until(a, t0 => window.tc.state.live.tick > t0 + 1, tick0, 20000);
  const ticks = await Promise.all([a, a2, b, c].map(p => p.evaluate(() => window.tc.state.live.tick)));
  check(Math.max(...ticks) - Math.min(...ticks) <= 1, 'LIVE clients agree on the tick', JSON.stringify(ticks));
  // open the Herald on every edition: no injected markup
  for (const p of [a, b]) {
    await p.evaluate(async () => { const { openHerald, editions } = await import('/src/ui/herald.ts'); const eds = editions(window.tc.screen); for (const e of eds) openHerald(window.tc.screen, e.turn); });
    await wait(300);
  }
  check(!(await a.evaluate(() => window.__xss)) && !(await b.evaluate(() => window.__xss)) && !(await a.evaluate(() => document.querySelector('.herald img'))), 'hostile dispatch is escaped in the Herald');
  // a hidden LIVE tab: one notification per new cycle at most, not one per tick
  await c.evaluate(() => { window.__notes = 0; window.Notification = class { static permission = 'granted'; constructor() { window.__notes++; } }; Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); });
  const t1 = await c.evaluate(() => [window.tc.state.live.tick, window.tc.state.turn]);
  await until(c, t0 => window.tc.state.turn >= t0 + 1 && window.tc.state.live.tick % (window.tc.state.rules.live.ticksPerCycle) >= 2, t1[1], 90000);
  const t2 = await c.evaluate(() => [window.tc.state.live.tick, window.tc.state.turn, window.__notes, document.title]);
  check(t2[1] > t1[1] && t2[2] <= t2[1] - t1[1], 'hidden LIVE tab: no notification spam per tick', JSON.stringify({ t1, t2 }));
  console.log('live errors', JSON.stringify(errors));
  check(!errors.length, 'no page errors (live)');
  for (const x of [ca, cb, cc]) await x.close();
}

// ================================================================ leaks: leave a game, join another
if (want('leak')) {
  const errors = [];
  const ctx = await mkCtx();
  const p = await mkPage(ctx, errors, 'L');
  p.on('dialog', d => d.accept());
  await p.goto(base);
  const counts = [];
  const bodyKids = () => p.evaluate(() => [...document.body.children].filter(e => e.id !== 'app' && e.tagName !== 'SCRIPT' && !(e.tagName === 'svg' && e.getAttribute('aria-hidden'))).map(e => e.className.baseVal ?? e.className));
  for (let i = 0; i < 3; i++) {
    await p.goto(base + '#/');
    await p.click('[data-l=start]');
    await until(p, () => !!window.tc?.screen);
    await wait(500);
    // open things that live on <body>: a modal, the Herald (needs an edition: play a turn), the Saga
    await p.evaluate(() => window.tc.screen.src.submit(window.tc.screen.plan));
    await until(p, () => window.tc.state.turn >= 2);
    await p.keyboard.press('Escape');
    await p.evaluate(async () => { const { openHerald } = await import('/src/ui/herald.ts'); openHerald(window.tc.screen); });
    await wait(300);
    check(await p.evaluate(() => !!document.querySelector('.herald-ov')), `herald open before leaving (${i})`);
    // leave with the browser's Back / a hash change while it is open
    await p.evaluate(() => { location.hash = '#/'; });
    await p.waitForSelector('[data-l=start]');
    await wait(400);
    const left = await bodyKids();
    check(!left.some(c => /herald|saga|mdl-root/.test(c)), `nothing of the game left on the lobby (${i})`, JSON.stringify(left));
    counts.push(await p.evaluate(() => window.__listeners()));
  }
  const tot = c => Object.values(c).reduce((a, b) => a + b, 0);
  check(tot(counts[2]) <= tot(counts[0]), 'listener count stable after games', counts.map(tot).join(' → ') + ' ' + JSON.stringify(counts[2]));
  console.log('leak errors', JSON.stringify(errors));
  check(!errors.length, 'no page errors (leak)');
  await ctx.close();
}

// ================================================================ screens at three sizes: off-screen / clipped UI
if (want('shots')) {
  const out = process.env.SHOTS ?? '/tmp';  // SHOTS=<dir> for the screenshots
  const sizes = [
    ['desk', { viewport: { width: 1440, height: 900 } }],
    ['big', { viewport: { width: 2560, height: 1440 } }],
    ['phone', { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }],
  ];
  // anything visible that sticks out of the viewport (or out of a non-scrolling dialog) horizontally
  const offscreen = sel => document.querySelectorAll(sel).length ? [...document.querySelectorAll(`${sel} *`)].filter(e => {
    const r = e.getBoundingClientRect(); if (!r.width || !r.height) return false;
    const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.position === 'fixed') return false;
    let p = e.parentElement; while (p) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') { const pr = p.getBoundingClientRect(); if (pr.right <= innerWidth + 1 && pr.left >= -1) return false; } p = p.parentElement; }
    return r.right > innerWidth + 1 || r.left < -1;
  }).slice(0, 4).map(e => `${e.tagName}.${String(e.className.baseVal ?? e.className).slice(0, 30)} ${Math.round(e.getBoundingClientRect().left)}..${Math.round(e.getBoundingClientRect().right)}`) : ['(missing)'];
  for (const [tag, opts] of sizes) {
    const errors = [];
    const ctx = await mkCtx(opts);
    const p = await mkPage(ctx, errors, tag);
    p.on('dialog', d => d.accept());
    await p.goto(base + '#/');
    await p.waitForSelector('[data-l=start]');
    check(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag}: lobby has no horizontal scroll`);
    await wait(800);
    const clipped = await p.evaluate(() => [...document.querySelectorAll('.lobby .card')].filter(c => c.scrollWidth > c.clientWidth + 1 || c.scrollHeight > c.clientHeight + 1 || c.getBoundingClientRect().right > innerWidth + 1).map(c => c.querySelector('h2')?.textContent));
    check(!clipped.length, `${tag}: lobby cards are not clipped`, JSON.stringify(clipped));
    await p.screenshot({ path: `${out}/ui-${tag}-lobby.png` });
    for (const [btn, sel] of [['tweaks', '.overlay .tweaks'], ['sound', '.overlay .snd-dlg'], ['help', '.overlay .help']]) {
      await p.click(`[data-l=${btn}]`);
      await p.waitForSelector(sel);
      await wait(350);
      const bad = await p.evaluate(offscreen, '.overlay:not(.overlay-ghost)');
      check(!bad.length, `${tag}: lobby ${btn} fits`, JSON.stringify(bad));
      await p.screenshot({ path: `${out}/ui-${tag}-lobby-${btn}.png` });
      await p.keyboard.press('Escape');
      await wait(300);
    }
    // a game: the modals and tabs
    await p.click('[data-l=start]');
    await until(p, () => !!window.tc?.screen);
    await p.evaluate(async () => { window.__m = await import('/src/ui/modals.ts'); });
    for (let t = 0; t < 2; t++) { await p.evaluate(() => window.tc.screen.src.submit(window.tc.screen.plan)); await until(p, n => window.tc.state.turn === n, t + 2); }
    for (const [name, tabs] of [['empire', ['research', 'laws', 'ships']], ['score', [null]], ['chronicle', [null]], ['help', ['win', 'orders', 'combat', 'soul', 'bets', 'empire', 'live']]]) {
      for (const tab of tabs) {
        await p.evaluate(([n, t]) => window.__m.openModal(window.tc.screen, n, t ?? undefined), [name, tab]);
        await wait(450);
        const bad = await p.evaluate(offscreen, '.mdl-root');
        check(!bad.length, `${tag}: ${name}${tab ? '/' + tab : ''} fits`, JSON.stringify(bad));
        await p.screenshot({ path: `${out}/ui-${tag}-${name}-${tab ?? ''}.png` });
      }
    }
    await p.evaluate(() => window.__m.closeModal());
    await p.evaluate(async () => { const { openHerald } = await import('/src/ui/herald.ts'); openHerald(window.tc.screen); });
    await wait(500);
    check(!(await p.evaluate(offscreen, '.herald-ov')).length, `${tag}: herald fits`, JSON.stringify(await p.evaluate(offscreen, '.herald-ov')));
    await p.screenshot({ path: `${out}/ui-${tag}-herald.png` });
    await p.keyboard.press('Escape');
    await p.evaluate(() => window.tc.screen.openSaga());
    await wait(500);
    check(!(await p.evaluate(offscreen, '.saga-ov')).length, `${tag}: saga fits`, JSON.stringify(await p.evaluate(offscreen, '.saga-ov')));
    await p.screenshot({ path: `${out}/ui-${tag}-saga.png` });
    await p.click('.saga [data-s=image]');
    check(await until(p, () => (window.__sagaImage ?? '').startsWith('data:image/png'), null, 5000), `${tag}: saga image export`);
    console.log(`${tag} errors`, JSON.stringify(errors));
    check(!errors.length, `${tag}: no page errors`);
    await ctx.close();
  }
}

// ================================================================ server restart mid-game
if (want('restart')) {
  const pid = Number(process.env.SERVER_PID);
  if (!pid) throw new Error('SERVER_PID= the tsx parent of the game server');
  const errors = [];
  const [ca, cb] = [await mkCtx(), await mkCtx()];
  const a = await mkPage(ca, errors, 'A'), b = await mkPage(cb, errors, 'B');
  const link = await createGame(a, { name: 'Alice', s2: 'standard' });
  await joinGame(b, link, 'Bob');
  await seal(a);
  await wait(500);
  process.kill(pid);
  await wait(1000);
  // while it is down: an action warns rather than failing silently
  await b.evaluate(() => window.tc.screen.src.submit(window.tc.screen.plan));
  check(await b.evaluate(() => /Not connected/.test(document.querySelector('.toast')?.textContent ?? '')), 'submitting while the server is down warns');
  const srv = spawn('node_modules/.bin/tsx', ['server/index.ts'], { detached: true, stdio: 'ignore' });
  srv.unref();
  console.log('new server pid', srv.pid);
  const ok = await until(b, () => window.tc.screen.src.connected, null, 20000);
  check(ok, 'client reconnects after the server restart');
  await b.evaluate(() => window.tc.screen.src.submit(window.tc.screen.plan));
  check(await until(a, () => window.tc.state.turn === 2, null, 10000), 'turn resolves after the restart (A’s seal survived)');
  console.log('restart errors', JSON.stringify(errors));
  check(!errors.length, 'no page errors (restart)');
  for (const x of [ca, cb]) await x.close();
}

console.log(fails ? `${fails} FAILED` : 'all ok');
await browser.close();
process.exit(fails ? 1 : 0);
