// Sweep 3: UI, lobby, League and push (repros for the fixes of the third client sweep).
// node scripts/sweep3-ui.mjs [base] [part...]   parts: league lobby kselect push sw modals herald route (default: all)
// parts also: rematch modals. Needs vite proxying /api to a game server. The League part plays ~20 short games to the
// end via the REST API (empty orders, a 3-turn limit) under hostile League and house names: the dev server's create
// rate limit (429) stops it, so point it at a server started with startServer({ createPerWindow: 10000, pushAnyHost:
// true }) behind a second vite whose proxy targets it (the push part's API check needs pushAnyHost too).
import { chromium, devices } from 'playwright-core';
const base = process.argv[2] ?? 'http://localhost:5173/';
const api = base.replace(/\/$/, '');
const parts = process.argv.slice(3);
const want = p => (parts.length ? parts.includes(p) : true);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let fails = 0;
const check = (ok, what, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra ? ' · ' + extra : ''}`); if (!ok) fails++; };
const XSS = '<img src=x onerror="window.__xss=1">';
const wait = ms => new Promise(r => setTimeout(r, ms));
const VIEWS = {
  desk: { viewport: { width: 1440, height: 900 } },
  big: { viewport: { width: 2560, height: 1440 } },
  phone: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: devices['iPhone 15 Pro']?.userAgent },
};

async function mkCtx(view = 'desk', init) {
  const ctx = await browser.newContext({ ...VIEWS[view] });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('tc.tutorial.wego', 'done'); localStorage.setItem('tc.tutorial.live', 'done'); localStorage.setItem('tc.herald.auto', 'off'); } catch { /* */ }
  });
  if (init) await ctx.addInitScript(init.fn, init.arg);
  return ctx;
}
async function mkPage(ctx, errors, tag) {
  const p = await ctx.newPage();
  await p.routeWebSocket(/\?token=/, () => {});
  p.on('pageerror', e => errors.push(`${tag}: ${e.message}`));
  p.on('console', m => { if (m.type() === 'error' && !/WebSocket|ERR_CONNECTION|Failed to load resource/.test(m.text())) errors.push(`${tag} console: ${m.text()}`); });
  return p;
}
async function until(p, fn, arg, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await p.evaluate(fn, arg)) return true; } catch { /* navigating */ } await wait(150); }
  return false;
}
async function call(method, path, body, token) {
  const r = await fetch(`${api}${path}`, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${j.error ?? ''}`);
  return j;
}
async function playToEnd(id, token) {
  for (let n = 0; n < 40; n++) {
    const { meta } = await call('GET', `/api/games/${id}/view`, undefined, token);
    if (meta.winner !== null) return meta;
    await call('POST', `/api/games/${id}/orders`, { token, submission: { orders: [], free: [] }, turn: meta.turn }).catch(() => {});
    await wait(60);
  }
  throw new Error(`game ${id} did not end`);
}
/** Overflow / off-screen check of the visible elements under `sel`. */
const offscreen = (p, sel) => p.evaluate(s => {
  const out = [];
  for (const el of document.querySelectorAll(`${s}, ${s} *`)) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
    if (r.right > innerWidth + 1 || r.left < -1) out.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} ${Math.round(r.left)}..${Math.round(r.right)}`);
  }
  return out.slice(0, 6);
}, sel);
const hScroll = p => p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);

// ================================================================ League: a new League, then 20 games
let seeded = null;
async function seedLeague(n = 20) {
  if (seeded) return seeded;
  const RULES = { victory: { turnLimit: 3 } };
  const longHouse = 'The Most Serene and Interminable House of Throckmorton-Vandersloot';
  const g1 = await call('POST', '/api/games', { name: `League ${XSS}`, rules: RULES, league: { name: `${XSS} Friday “League” & co` },
    seats: [{ kind: 'human' }, { kind: 'ai', aiLevel: 'novice', name: `${XSS}` }, { kind: 'ai', aiLevel: 'novice', name: longHouse }] });
  const league = g1.meta.league;
  const seats = {};
  let tok = (await call('POST', `/api/games/${g1.id}/join`, { seat: 0, name: `"><svg onload=window.__xss=2>` })).token;
  seats[g1.id] = { token: tok, seat: 0 };
  // an empty League first: just a running game
  const empty = await call('GET', `/api/league/${league}`);
  let prev = g1.id;
  await playToEnd(g1.id, tok);
  for (let i = 1; i < n; i++) {
    const g = await call('POST', '/api/games', { league: { rematchOf: prev, token: tok } });
    tok = (await call('POST', `/api/games/${g.id}/join`, { seat: 0, name: `"><svg onload=window.__xss=2>` })).token;
    seats[g.id] = { token: tok, seat: 0 };
    await playToEnd(g.id, tok);
    prev = g.id;
  }
  seeded = { league, seats, empty, last: prev, tok };
  return seeded;
}

if (want('league')) {
  const errors = [];
  // a brand-new League (no game ended): every tab says so
  const g0 = await call('POST', '/api/games', { name: 'Fresh table', league: { name: `${XSS} empty` }, seats: [{ kind: 'human' }, { kind: 'ai', aiLevel: 'novice' }, { kind: 'ai', aiLevel: 'novice' }] });
  const t0 = (await call('POST', `/api/games/${g0.id}/join`, { seat: 0, name: 'Solo' })).token;
  for (const view of ['desk', 'phone']) {
    const ctx = await mkCtx(view, { fn: s => { for (const [g, v] of Object.entries(s)) localStorage.setItem(`tc.token.${g}`, JSON.stringify(v)); }, arg: { [g0.id]: { token: t0, seat: 0 } } });
    const p = await mkPage(ctx, errors, `league-empty-${view}`);
    await p.goto(base);
    await p.click('[data-l="league"]');
    await p.waitForSelector('.tcl-ledger .tcl-tabs', { timeout: 8000 });
    for (const tab of ['table', 'hall', 'rivals', 'oaths']) {
      await p.click(`[data-tab="${tab}"]`);
      const t = await p.textContent('.tcl-pane');
      check(/yet|empty/i.test(t), `empty League · ${view} · ${tab} explains itself`, t.slice(0, 60));
    }
    check(!(await p.evaluate(() => window.__xss)), `empty League · ${view} · hostile League name escaped`);
    await ctx.close();
  }

  console.log('     seeding 20 games…');
  const s = await seedLeague(20);
  const lv = await call('GET', `/api/league/${s.league}`);
  check(lv.played === 20, `League has 20 games (${lv.played})`);
  for (const view of ['desk', 'big', 'phone']) {
    const ctx = await mkCtx(view, { fn: s => { for (const [g, v] of Object.entries(s)) localStorage.setItem(`tc.token.${g}`, JSON.stringify(v)); }, arg: { ...s.seats, [g0.id]: { token: t0, seat: 0 } } });
    const p = await mkPage(ctx, errors, `league-${view}`);
    await p.goto(base);
    await p.click('[data-l="league"]');
    await p.waitForSelector('.tcl-ledger .tcl-card', { timeout: 8000 });
    check((await p.$$('.tcl-card')).length === 2, `${view} · two League cards listed`);
    await p.click(`.tcl-card[data-league="${s.league}"]`);
    await p.waitForSelector('.tcl-ledger .tcl-tabs');
    for (const tab of ['table', 'hall', 'rivals', 'oaths']) {
      await p.click(`[data-tab="${tab}"]`);
      await wait(100);
      if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/league-${view}-${tab}.png`, fullPage: false });
      const off = await offscreen(p, '.tcl-sheet');
      check(!off.length, `${view} · ${tab} · nothing off-screen`, off.join(', '));
      const html = await p.evaluate(() => document.body.innerHTML);
      check(!Object.values(s.seats).some(x => html.includes(x.token)) && !html.includes(t0), `${view} · ${tab} · no seat token in the DOM`);
    }
    check(!(await hScroll(p)), `${view} · no horizontal page scroll`);
    // back to the list, Esc closes, focus restored
    await p.click('[data-l="back"]');
    await p.waitForSelector('.tcl-card');
    await p.keyboard.press('Escape');
    check(await until(p, () => !document.querySelector('.tcl-ov'), null, 3000), `${view} · Esc closes the ledger`);
    check(!(await p.evaluate(() => window.__xss)), `${view} · hostile names escaped in the ledger`);
    // the lobby's League picker: the League's houses, escaped, and it makes a game in that League
    const pick = await p.$(`[data-pick="${s.league}"]`);
    check(!!pick, `${view} · the lobby offers the League in the picker`);
    if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/lobby-${view}.png`, fullPage: true });
    if (view === 'desk' && pick) {
      await pick.click();
      await p.fill('[data-o="name"]', 'Picker game');
      await p.click('[data-o="create"]');
      await p.waitForSelector('[data-go]');
      const link = await p.inputValue('.lb-link');
      const id = link.split('/').pop();
      const meta = await call('GET', `/api/games/${id}`);
      check(meta.league === s.league, 'a game created with the League picked joins that League', meta.league);
      await p.click('[data-go]');
    }
    if (view === 'phone') {
      const off = await offscreen(p, '.tcl-picker');
      check(!off.length, 'phone · the League picker fits', off.join(', '));
    }
    await ctx.close();
  }
  check(!errors.length, 'league: no page errors', errors.slice(0, 5).join(' | '));
}

// ================================================================ end of game: the League result card and rematch
if (want('rematch')) {
  const errors = [];
  const s = await seedLeague(20);
  const ctx = await mkCtx('desk', { fn: s => { for (const [g, v] of Object.entries(s)) localStorage.setItem(`tc.token.${g}`, JSON.stringify(v)); }, arg: s.seats });
  const p = await mkPage(ctx, errors, 'rematch');
  await p.goto(`${base}#/g/${s.last}`);
  const ok = await until(p, () => !!document.querySelector('.tcl-result:not([hidden])'), null, 20000);
  check(ok, 'the end screen shows the League result card');
  if (ok) {
    check(!(await p.evaluate(() => window.__xss)), 'result card escapes hostile names');
    await p.click('.tcl-result [data-l="again"]');
    const moved = await until(p, last => !location.hash.includes(last) && /#\/g\/[0-9a-f]+$/.test(location.hash) && !!window.tc?.screen, s.last, 15000);
    check(moved, 'Again? opens the rematch, seated', await p.evaluate(() => location.hash));
    if (moved) check(await p.evaluate(() => window.tc.screen.you) === 0, 'rematch: this browser holds its old seat');
  }
  check(!errors.length, 'rematch: no page errors', errors.slice(0, 5).join(' | '));
  await ctx.close();
}

// ================================================================ push: prompt, settings, unsubscribe (a faked PushManager)
const FAKE_PUSH = {
  fn: () => {
    window.__push = [];
    const fake = { endpoint: `https://push.example.test/ep/${localStorage.getItem('fake.ep') ?? (localStorage.setItem('fake.ep', Math.random().toString(36).slice(2)), localStorage.getItem('fake.ep'))}`, toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'BOrkm4K7n2yZpGVxM4aC1sA8b9qQ', auth: 'aGVsbG93b3JsZA' } }; },
      async unsubscribe() { window.__push.push('unsub'); fake.live = false; return true; },
      get live() { return localStorage.getItem('fake.live') === '1'; }, set live(v) { localStorage.setItem('fake.live', v ? '1' : '0'); } };
    if (window.PushManager) {
      PushManager.prototype.subscribe = async function () { window.__push.push('sub'); fake.live = true; return fake; };
      PushManager.prototype.getSubscription = async function () { return fake.live ? fake : null; };
    }
    let perm = localStorage.getItem('fake.live') ? 'granted' : 'default';
    Object.defineProperty(Notification, 'permission', { get: () => perm, configurable: true });
    Notification.requestPermission = async () => (perm = 'granted');
    const f = window.fetch;
    window.fetch = (u, o) => { if (String(u).startsWith('/api/push/')) window.__push.push(`${String(u).slice(10)} ${o?.body ?? ''}`); return f(u, o); };
  },
};
if (want('push')) {
  const errors = [];
  const ctx = await mkCtx('desk', FAKE_PUSH);
  const p = await mkPage(ctx, errors, 'push');
  await p.goto(base);
  await p.fill('[data-l=name]', 'Pusher');
  await p.selectOption('[data-o=s1]', 'human');
  await p.selectOption('[data-o=s2]', 'novice');
  await p.click('[data-o=create]');
  await p.waitForSelector('[data-go]');
  await p.click('[data-go]');
  await until(p, () => !!window.tc?.screen?.src?.view);
  check(!(await p.$('.tcp-sheet')), 'push: no prompt on load');
  await p.evaluate(() => window.tc.screen.submit?.(true) ?? window.tc.screen.src.submit(window.tc.screen.plan));
  const shown = await until(p, () => !!document.querySelector('.tcp-sheet'), null, 6000);
  check(shown, 'push: the prompt is offered after the first seal');
  if (shown) {
    await p.click('[data-p="yes"]');
    const ok = await until(p, () => /reach you/.test(document.querySelector('.tcp-status')?.textContent ?? ''), null, 6000);
    check(ok, 'push: Send word subscribes', await p.textContent('.tcp-status'));
    const log = await p.evaluate(() => window.__push);
    check(log.some(x => x.startsWith('subscribe') && /"games":\[\{"game"/.test(x)), 'push: the subscription binds this browser’s seats', log.join(' | ').slice(0, 200));
    check(!log.some(x => /token/.test(x) && !x.startsWith('subscribe')), 'push: tokens only go to /subscribe');
  }
  // settings persist, quiet hours post, off unsubscribes
  await p.goto(base);
  await p.click('[data-l="notify"]');
  await p.waitForSelector('.tcp-settings [data-s="on"]');
  check(await p.isChecked('[data-s="on"]'), 'push settings: on after the prompt');
  await p.click('.tcp-settings label:has([data-s="quiet"])');
  await until(p, () => !document.querySelector('.tcp-hours')?.hidden);
  await p.click('[data-from="23"]');
  await wait(300);
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('tc.push.v1')));
  check(saved.quiet?.from === 23 && saved.quiet?.to === 8, 'push settings: quiet hours saved', JSON.stringify(saved.quiet));
  check((await p.evaluate(() => window.__push)).some(x => x.startsWith('settings') && /"from":23/.test(x)), 'push settings: quiet hours sent to the server');
  await p.keyboard.press('Escape');
  await p.reload();
  await p.click('[data-l="notify"]');
  await p.waitForSelector('.tcp-settings [data-s="on"]');
  check(await p.isChecked('[data-s="quiet"]') && await p.getAttribute('[data-from="23"]', 'aria-pressed') === 'true', 'push settings: survive a reload');
  await p.click('.tcp-settings label:has([data-s="on"])');
  await until(p, () => !document.querySelector('[data-s="on"]')?.checked && !document.querySelector('[data-s="on"]')?.disabled);
  const log2 = await p.evaluate(() => window.__push);
  check(log2.includes('unsub') && log2.some(x => x.startsWith('unsubscribe')), 'push settings: off unsubscribes (browser and server)', log2.join(' | ').slice(-160));
  check(!(await p.evaluate(() => JSON.parse(localStorage.getItem('tc.push.v1')).on)), 'push settings: off is saved');
  await ctx.close();

  // the server binds only running games (finished ones crowded running ones out of its 64-seat cap)
  {
    const mk = async rules => { const g = await call('POST', '/api/games', { rules, seats: [{ kind: 'human' }, { kind: 'ai', aiLevel: 'novice' }, { kind: 'ai', aiLevel: 'novice' }] }); return { id: g.id, token: (await call('POST', `/api/games/${g.id}/join`, { seat: 0, name: 'B' })).token }; };
    const done = await mk({ victory: { turnLimit: 1 } }), run = await mk(undefined);
    await playToEnd(done.id, done.token);
    const sub = { endpoint: `https://push.example.test/ep/bind${Date.now()}`, keys: { p256dh: 'BOrkm4K7n2yZpGVxM4aC1sA8b9qQ', auth: 'aGVsbG93b3JsZA' } };
    const r = await call('POST', '/api/push/subscribe', { subscription: sub, games: [{ game: done.id, token: done.token }, { game: run.id, token: run.token }] });
    check(JSON.stringify(r.games) === JSON.stringify([run.id]), 'push server: binds running games only', JSON.stringify(r.games));
    await call('POST', '/api/push/unsubscribe', { endpoint: sub.endpoint });
  }

  // iPhone outside an installed web app: the prompt and Settings explain Add to Home Screen
  const ictx = await mkCtx('phone');
  const ip = await mkPage(ictx, errors, 'ios');
  await ip.goto(base);
  const sup = await ip.evaluate(async () => (await import('/src/push/push.ts')).pushSupport());
  check(sup === 'ios-install', 'iPhone Safari: ios-install', sup);
  await ip.click('[data-l="notify"]');
  await ip.waitForSelector('.tcp-settings');
  check(/Home Screen/.test(await ip.textContent('.tcp-settings')), 'iPhone: Settings explains Add to Home Screen');
  await ip.keyboard.press('Escape');
  await ip.evaluate(async () => (await import('/src/push/push.ts')).mountPushPrompt());
  await ip.waitForSelector('.tcp-sheet [data-p="ok"]');
  const off = await offscreen(ip, '.tcp-sheet');
  check(!off.length, 'iPhone: the prompt fits', off.join(', '));
  await ip.tap('[data-p="ok"]');
  await wait(400);
  check(!(await ip.$('.tcl-ov')) && await ip.evaluate(async () => !(await import('/src/push/push.ts')).shouldOfferPush()), 'iPhone: Understood closes it for good');
  await ictx.close();
  check(!errors.length, 'push: no page errors', errors.slice(0, 5).join(' | '));
}

// ================================================================ the service worker's routing (sw.js in a fake worker scope)
if (want('sw')) {
  const { readFileSync } = await import('node:fs');
  const vm = await import('node:vm');
  const src = readFileSync(new URL('../client/public/sw.js', import.meta.url), 'utf8');
  const ORIGIN = 'https://tc.example';
  function scope(tabs) {
    const L = {}, shown = [], opened = [], log = [];
    const self = {
      location: { origin: ORIGIN }, addEventListener: (t, f) => { L[t] = f; }, skipWaiting() {},
      registration: { showNotification: async (title, o) => { shown.push({ title, ...o }); } },
      clients: { claim: async () => {}, matchAll: async () => tabs, openWindow: async u => { opened.push(u); return null; } },
    };
    vm.runInNewContext(src, { self, URL, fetch: async () => ({}), console, decodeURIComponent, JSON });
    const fire = async (t, e) => { let p; L[t]({ ...e, waitUntil: x => { p = x; } }); await p; };
    return { fire, shown, opened, log };
  }
  const tab = (url, o = {}) => ({ url, visibilityState: 'visible', focused: true, msgs: [], navs: [], focuses: 0, controlled: true, ...o,
    postMessage(m) { this.msgs.push(m); }, async focus() { this.focuses++; return this; },
    async navigate(u) { if (!this.controlled) throw new TypeError('not controlled'); this.navs.push(u); this.url = u; return this; } });
  const data = p => ({ data: { json: () => p, text: () => JSON.stringify(p) } });

  // push: shown unless a focused tab is on that very game
  let s = scope([tab(`${ORIGIN}/#/g/abc1234567`)]);
  await s.fire('push', data({ title: 'T', body: 'B', tag: 'turn:abc1234567', url: '/#/g/abc1234567', game: 'abc1234567', kind: 'turn' }));
  check(!s.shown.length, 'sw: no notification while the game is on screen');
  s = scope([tab(`${ORIGIN}/#/g/abc1234567`, { focused: false })]);
  await s.fire('push', data({ title: 'T', body: 'B', tag: 'x', url: '/#/g/abc1234567', game: 'abc1234567', kind: 'turn' }));
  check(s.shown.length === 1 && s.shown[0].data.url === '/#/g/abc1234567', 'sw: a background tab still gets the notification');
  s = scope([]);
  for (const bad of ['//evil.example/x', 'https://evil.example/', 'javascript:alert(1)', '/\\evil.example']) {
    await s.fire('push', data({ title: 'T', url: bad, game: 'g', kind: 'turn' }));
  }
  check(s.shown.every(n => n.data.url === '/'), 'sw: only our own pages are opened', s.shown.map(n => n.data.url).join(' '));
  await s.fire('push', { data: { json: () => { throw new Error('x'); }, text: () => 'plain words' } });
  check(s.shown.at(-1).body === 'plain words', 'sw: a non-JSON push still shows its text');

  // notificationclick routing
  const note = url => ({ notification: { data: { url }, close() {} } });
  let t1 = tab(`${ORIGIN}/#/g/abc1234567`), t2 = tab(`${ORIGIN}/`);
  s = scope([t2, t1]);
  await s.fire('notificationclick', note('/#/g/abc1234567'));
  check(t1.focuses === 1 && !t1.navs.length && !t2.focuses, 'sw click: focuses the tab already on that game');
  t2 = tab(`${ORIGIN}/`);
  s = scope([t2]);
  await s.fire('notificationclick', note('/#/g/abc1234567'));
  check(t2.navs[0] === `${ORIGIN}/#/g/abc1234567` && t2.focuses === 1, 'sw click: moves a lobby tab to the game');
  t2 = tab(`${ORIGIN}/`, { controlled: false });
  s = scope([t2]);
  await s.fire('notificationclick', note('/#/g/abc1234567'));
  check(s.opened[0] === `${ORIGIN}/#/g/abc1234567` || t2.msgs.some(m => m.url), 'sw click: an uncontrolled tab still gets the player to the game', JSON.stringify({ opened: s.opened, msgs: t2.msgs, focus: t2.focuses }));
  s = scope([]);
  await s.fire('notificationclick', note('/#/g/abc1234567'));
  check(s.opened[0] === `${ORIGIN}/#/g/abc1234567`, 'sw click: no tab: opens one');
  s = scope([]);
  await s.fire('notificationclick', { notification: { data: { url: 'https://evil.example/' }, close() {} } });
  check(s.opened[0]?.startsWith(ORIGIN), 'sw click: never leaves the origin', s.opened[0]);
}

// ================================================================ lobby: vellum selects, dialogs, seat links, leftovers
async function cdpSwipe(p, x, y, dy) {
  const s = await p.context().newCDPSession(p);
  await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 6; i++) await s.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - (dy * i) / 6 }] });
  await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await s.detach();
}
if (want('kselect')) {
  const errors = [];
  const ctx = await mkCtx('desk');
  const p = await mkPage(ctx, errors, 'ksel');
  await p.goto(base);
  await p.waitForSelector('[data-l="ai1"][data-ksel]');
  await p.focus('[data-l="ai1"]');
  await p.keyboard.press('Enter');
  check(!!(await p.$('.ksel-list')), 'kselect: Enter opens the vellum list');
  await p.keyboard.press('End');
  await p.keyboard.press('Enter');
  check(await p.inputValue('[data-l="ai1"]') === 'human' && /Hotseat/.test(await p.textContent('[data-l="hint"]')), 'kselect: End + Enter picks, change fires');
  check(await p.evaluate(() => document.activeElement?.dataset.l) === 'ai1', 'kselect: focus returns to the select');
  await p.keyboard.press(' ');
  await p.keyboard.press('Escape');
  check(!(await p.$('.ksel-list')) && await p.evaluate(() => document.activeElement?.dataset.l) === 'ai1', 'kselect: Esc closes it');
  await p.keyboard.press('Enter');
  await p.keyboard.press('a');
  await p.keyboard.press('a');
  check(/AI standard/.test(await p.evaluate(() => document.activeElement?.textContent)), 'kselect: letters cycle', await p.evaluate(() => document.activeElement?.textContent));
  await p.keyboard.press('Escape');
  // the list scrolls in a short window without closing itself
  await p.setViewportSize({ width: 900, height: 260 });
  await p.evaluate(() => document.querySelector('[data-o="deadline"]').scrollIntoView({ block: 'center' }));
  await p.click('[data-o="deadline"]');
  await wait(150);
  const scrolls = await p.evaluate(() => { const l = document.querySelector('.ksel-list'); return l ? l.scrollHeight > l.clientHeight : null; });
  if (scrolls) {
    await p.evaluate(() => { const l = document.querySelector('.ksel-list'); l.scrollTop = l.scrollHeight; });
    await wait(150);
  }
  check(!!(await p.$('.ksel-list')), 'kselect: scrolling the list keeps it open', `overflowing: ${scrolls}`);
  // leaving the lobby with a list open leaves nothing behind
  await p.evaluate(() => { location.hash = '#/g/ffffffffff'; });
  await wait(400);
  check(!(await p.$('.ksel-list')), 'kselect: a route change removes an open list');
  await ctx.close();

  // touch: a tap opens, a scroll that starts on a select does not
  const tctx = await mkCtx('phone');
  const tp = await mkPage(tctx, errors, 'ksel-phone');
  await tp.goto(base);
  await tp.waitForSelector('[data-o="s1"][data-ksel]');
  await tp.evaluate(() => document.querySelector('[data-o="s1"]').scrollIntoView({ block: 'center' }));
  await tp.tap('[data-o="s1"]');
  await wait(150);
  check(!!(await tp.$('.ksel-list')), 'kselect phone: a tap opens the list');
  const off = await offscreen(tp, '.ksel-list');
  check(!off.length, 'kselect phone: the list fits', off.join(', '));
  await tp.tap('.ksel-opt[data-i="2"]');
  check(await tp.inputValue('[data-o="s1"]') === 'standard' && !(await tp.$('.ksel-list')), 'kselect phone: tapping an option picks it');
  const r = await tp.evaluate(() => { const b = document.querySelector('[data-o="s2"]').getBoundingClientRect(); return { x: b.left + 20, y: b.top + b.height / 2, y0: scrollY }; });
  await tp.evaluate(() => { window.__kselSeen = false; new MutationObserver(() => { if (document.querySelector('.ksel-list')) window.__kselSeen = true; }).observe(document.body, { childList: true }); });
  await cdpSwipe(tp, r.x, r.y, 160);
  await wait(300);
  const y1 = await tp.evaluate(() => scrollY);
  check(!(await tp.evaluate(() => window.__kselSeen)), 'kselect phone: scrolling the page from a select does not open it', `scrolled ${r.y0}→${y1}`);
  check(!(await hScroll(tp)), 'lobby phone: no horizontal scroll');
  await tctx.close();
  check(!errors.length, 'kselect: no page errors', errors.slice(0, 5).join(' | '));
}

if (want('lobby')) {
  const errors = [];
  for (const view of ['desk', 'big', 'phone']) {
    const ctx = await mkCtx(view);
    const p = await mkPage(ctx, errors, `lobby-${view}`);
    await p.goto(base);
    await p.waitForSelector('[data-l="tweaks"]');
    const off = await offscreen(p, '.lobby');
    check(!off.length && !(await hScroll(p)), `lobby ${view}: nothing off-screen`, off.join(', '));
    for (const [btn, sel] of [['tweaks', '.tw-dlg'], ['sound', '.overlay .dialog'], ['gfx', '.gfx-dlg'], ['notify', '.lb-notify'], ['help', '.help']]) {
      await p.click(`[data-l="${btn}"]`);
      await p.waitForSelector(sel);
      const o = await offscreen(p, '.overlay');
      check(!o.length, `lobby ${view}: ${btn} dialog fits`, o.join(', '));
      await p.keyboard.press('Escape');
      await wait(300);
      check(!(await p.$('.overlay')), `lobby ${view}: Esc closes ${btn}`);
    }
    await ctx.close();
  }
  // Tweaks: a change counts on the lobby button, Esc keeps it
  {
    const ctx = await mkCtx('desk');
    const p = await mkPage(ctx, errors, 'tweaks');
    await p.goto(base);
    await p.click('[data-l="tweaks"]');
    const inp = await p.$('.tw-dlg input[data-type="number"]');
    await inp.fill('7');
    await inp.press('Tab');
    await p.keyboard.press('Escape');
    await wait(300);
    check(/1 changed/.test(await p.textContent('[data-l="tweaks"]')), 'tweaks: the lobby button counts the change after Esc');
    // Sound: the speaker follows mute, and the listener goes when the dialog does
    await p.click('[data-l="sound"]');
    await p.waitForSelector('.overlay .dialog');
    const subs0 = await p.evaluate(() => window.tcAudio.subs?.size ?? window.tcAudio.listeners?.size ?? -1);
    await p.keyboard.press('Escape');
    await wait(200);
    const subs1 = await p.evaluate(() => window.tcAudio.subs?.size ?? window.tcAudio.listeners?.size ?? -1);
    check(subs0 < 0 || subs1 < subs0, 'sound: closing the dialog drops its mute listener', `${subs0}→${subs1}`);
    await ctx.close();
  }
  // seat links: a good one seats you and cleans the URL; a bad one says so and keeps you out of no seat
  {
    const g = await call('POST', '/api/games', { name: 'Seat link', seats: [{ kind: 'human' }, { kind: 'human' }, { kind: 'ai', aiLevel: 'novice' }] });
    const j = await call('POST', `/api/games/${g.id}/join`, { seat: 1, name: 'Linked' });
    const ctx = await mkCtx('phone');
    const p = await mkPage(ctx, errors, 'seatlink');
    await p.goto(`${base}#/g/${g.id}/${j.token}`);
    await until(p, () => !!window.tc?.screen);
    check(await p.evaluate(() => window.tc.screen.you) === 1 && !(await p.evaluate(() => location.hash)).includes(j.token), 'seat link: seated on seat 2, token gone from the URL');
    const p2 = await mkPage(await mkCtx('desk'), errors, 'seatlink-bad');
    await p2.goto(`${base}#/g/${g.id}/deadbeefdeadbeefdeadbeef`);
    const t = await until(p2, () => /not valid/.test(document.querySelector('.toast')?.textContent ?? ''), null, 6000);
    check(t, 'seat link: a bad token says so');
    check(await until(p2, () => !!document.querySelector('[data-seat]')), 'seat link: a bad token still offers the join dialog');
    await ctx.close();
  }
  check(!errors.length, 'lobby: no page errors', errors.slice(0, 5).join(' | '));
}

// ================================================================ route: trays and lists never outlive their screen
if (want('route')) {
  const errors = [];
  const ctx = await mkCtx('desk');
  const p = await mkPage(ctx, errors, 'route');
  await p.goto(base);
  await p.click('[data-l="league"]');
  await p.waitForSelector('.tcl-ov');
  await p.evaluate(() => { location.hash = '#/g/ffffffffff'; });
  await wait(500);
  check(!(await p.$('.tcl-ov')), 'route: the League ledger closes when the route changes');
  await p.evaluate(() => { location.hash = '#/'; });
  await p.waitForSelector('[data-l="notify"]');
  await p.evaluate(async () => (await import('/src/push/push.ts')).mountPushPrompt());
  await p.waitForSelector('.tcp-sheet');
  await p.evaluate(() => { location.hash = '#/g/ffffffffff'; });
  await wait(500);
  check(!(await p.$('.tcl-ov')), 'route: the push prompt closes when the route changes');
  // the page side of a notification click on an uncontrolled tab
  await p.evaluate(() => { location.hash = '#/'; });
  await wait(300);
  await p.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'tc-open', url: `${location.origin}/#/g/eeeeeeeeee` } })));
  await wait(200);
  check(await p.evaluate(() => location.hash) === '#/g/eeeeeeeeee', 'route: tc-open from the service worker moves the tab');
  // the real sw.js installs and activates
  const sw = await p.evaluate(async () => { const r = await navigator.serviceWorker.register('/sw.js', { scope: '/' }); await navigator.serviceWorker.ready; return !!r.active; });
  check(sw, 'route: sw.js registers and activates in Chromium');
  check(!errors.length, 'route: no page errors', errors.slice(0, 5).join(' | '));
  await ctx.close();
}

// ================================================================ the Herald: hotseat drafts, phone layout, hostile dispatches
async function startLocal(p, { ai1 = 'standard', seed = '' } = {}) {
  await p.goto(base);
  await p.waitForSelector('[data-l=start]');
  await p.selectOption('[data-l=ai1]', ai1);
  if (seed) await p.fill('[data-l=seed]', seed);
  p.once('dialog', d => d.accept());
  await p.click('[data-l=start]');
  await until(p, () => !!window.tc?.screen?.st);
}
/** Hotseat: seal for whoever is seated, then lift the curtain for the next player. */
async function sealHot(p) {
  const you = await p.evaluate(() => window.tc.screen.you);
  await p.evaluate(() => window.tc.screen.submit(true));
  await until(p, y => !!document.querySelector('.curtain [data-x]') || window.tc.screen.you !== y, you, 8000);
  if (await p.$('.curtain [data-x]')) await p.click('.curtain [data-x]');
  await wait(300);
}
if (want('herald')) {
  const errors = [];
  for (const view of ['desk', 'phone']) {
    const ctx = await mkCtx(view);
    const p = await mkPage(ctx, errors, `herald-${view}`);
    await startLocal(p, { ai1: 'human', seed: '11' });
    // turn 1 for both, so an edition exists
    await sealHot(p); await sealHot(p);
    await until(p, () => (window.tc.screen.st.soul?.herald?.length ?? 0) > 0 && window.tc.screen.canPlan, null, 20000);
    await p.evaluate(() => { window.tc.screen.replay && window.tc.screen.endReplay?.(); });
    while (await p.$('.curtain [data-x]')) { await p.click('.curtain [data-x]'); await wait(200); }
    const H = '/src/ui/herald.ts';
    const seat0 = await p.evaluate(() => window.tc.screen.you);
    await p.evaluate(async H => (await import(H)).openHerald(window.tc.screen), H);
    await p.waitForSelector('.herald [data-dispatch]');
    await p.fill('.herald [data-dispatch]', `SECRET draft of seat ${seat0} ${XSS}`);
    await p.click('.herald [data-h="as"][data-v="source"]');
    await wait(900);
    if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/herald0-${view}.png` });
    let off = [];
    for (let i = 0; i < 10; i++) { off = await offscreen(p, '.herald'); if (!off.length) break; await wait(300); }   // it slides in
    check(!off.length, `herald ${view}: the front page fits`, off.join(', '));
    await p.keyboard.press('Escape');
    await wait(300);
    check(await until(p, () => !document.querySelector('.herald-ov'), null, 2000), `herald ${view}: Esc closes it`);
    // sworn words drafted for a pact offer (Score), not offered
    const M = "/src/ui/modals.ts";
    await p.evaluate(async M => (await import(M)).openModal(window.tc.screen, 'score'), M);
    await wait(400);
    const pw = await p.$('input.pact-words');
    if (pw) { for (const x of await p.$$('input.pact-words')) await x.fill('SECRET words'); await wait(100); }
    await p.evaluate(async M => (await import(M)).closeModal(), M);
    await wait(300);
    // seal, hand over: the next player must not see the draft (or its signing choice)
    await sealHot(p);
    if (pw) {
      await p.evaluate(async M => (await import(M)).openModal(window.tc.screen, 'score'), M);
      await wait(400);
      const vals = await p.$$eval('input.pact-words', xs => xs.map(x => x.value));
      check(!vals.some(v => /SECRET/.test(v)), `score ${view}: hotseat: the next player does not see the last player's pact words`, JSON.stringify(vals));
      await p.evaluate(async M => (await import(M)).closeModal(), M);
      await wait(300);
    } else console.log('     (no pact offer available: pact words not checked)');
    const seat1 = await p.evaluate(() => window.tc.screen.you);
    await p.evaluate(async H => (await import(H)).openHerald(window.tc.screen), H);
    await p.waitForSelector('.herald');
    const leak = await p.evaluate(() => ({ text: document.querySelector('.herald [data-dispatch]')?.value ?? '', source: !!document.querySelector('.herald [data-h="as"][data-v="source"].on') }));
    check(seat1 !== seat0 && !/SECRET/.test(leak.text) && !leak.source, `herald ${view}: hotseat: the next player does not inherit the last player's dispatch draft`, JSON.stringify({ seat0, seat1, ...leak }));
    // a planted dispatch with hostile text prints escaped (file it as this seat; it prints next edition)
    await p.fill('.herald [data-dispatch]', XSS);
    await p.click('.herald [data-h="file"]');
    check(!(await p.evaluate(() => window.__xss)), `herald ${view}: a hostile dispatch is escaped`);
    await p.keyboard.press('Escape');
    if (process.env.SHOTS) { await p.evaluate(async H => (await import(H)).openHerald(window.tc.screen), H); await wait(500); await p.screenshot({ path: `${process.env.SHOTS}/herald-${view}.png` }); await p.keyboard.press('Escape'); }
    await ctx.close();
  }
  check(!errors.length, 'herald: no page errors', errors.slice(0, 5).join(' | '));
}

// ================================================================ Help follows the rules: rules.world (new games) vs old saves
if (want('modals')) {
  const errors = [];
  const ctx = await mkCtx('desk');
  const p = await mkPage(ctx, errors, 'help');
  await p.goto(base);
  const r = await p.evaluate(async () => {
    const { helpHtml } = await import('/src/ui/help.ts');
    const { helpBody } = await import('/src/ui/modal-help.ts');
    const { createGame } = await import('/shared/sim/setup.ts').catch(() => import('/@fs/home/user/wego-4x-game/shared/sim/setup.ts'));
    const out = {};
    for (const [k, rules] of [['world', {}], ['old', { world: { enabled: false } }]]) {
      const st = createGame({ seed: 3, players: [], rules });
      const g = { st, you: 0, live: false };
      out[k] = { page: helpHtml(st), empire: helpBody({ g, tab: 'empire' }), soul: helpBody({ g, tab: 'soul' }), bets: helpBody({ g, tab: 'bets' }) };
    }
    return out;
  });
  const w = r.world, o = r.old;
  check(/tracks/.test(w.page) && !/engrave/i.test(w.page) && !/Open the Gates/.test(w.page) && !/a <b>Station<\/b> adds a slot/.test(w.page), 'help page: a rules.world game describes tracks, no slots / Engrave / Open the Gates');
  check(/a <b>Station<\/b> adds a slot/.test(o.page) && /engrave/.test(o.page) && /Open the Gates/.test(o.page), 'help page: an old save keeps slots, Engrave and Open the Gates');
  check(/Works/.test(w.empire) && !/Civil slots/.test(w.empire) && !/engrave/.test(w.soul) && !/<b>Gates<\/b>/.test(w.bets), 'help modal: rules.world cards');
  check(/Civil slots/.test(o.empire) && /engrave/.test(o.soul) && /<b>Gates<\/b>/.test(o.bets), 'help modal: old-save cards');
  check(!errors.length, 'help: no page errors', errors.slice(0, 5).join(' | '));
  await ctx.close();
}

export { mkCtx, mkPage, until, call, check, offscreen, hScroll, seedLeague };
if (!process.env.SWEEP3_NO_EXIT) {
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : '\nall checks passed');
  process.exit(fails ? 1 : 0);
}
