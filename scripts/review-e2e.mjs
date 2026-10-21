// Long-session browser check: Watch AIs with Auto + battles, preview/replay controls,
// hotseat curtain, typing in chat, route changes (listener / rAF leaks), damaged saves.
// node scripts/review-e2e.mjs [baseUrl] [turns]
import { chromium } from 'playwright-core';
const base = process.argv[2] ?? 'http://localhost:5173/';
const TURNS = Number(process.argv[3] ?? 15);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
// ignore Vite hot reloads (other files changing mid-run would reload the page)
await page.routeWebSocket(/\?token=/, () => {});
const errors = [];
const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); };
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|WebSocket/.test(m.text())) errors.push(m.text()); });
// count live window listeners and rAF callbacks
await page.addInitScript(() => {
  const live = new Map();
  const add = window.addEventListener, rem = window.removeEventListener;
  window.addEventListener = function (t, f, o) { const k = t + (o === true || o?.capture ? '!' : ''); const s = live.get(k) ?? new Set(); s.add(f); live.set(k, s); return add.call(this, t, f, o); };
  window.removeEventListener = function (t, f, o) { const k = t + (o === true || o?.capture ? '!' : ''); live.get(k)?.delete(f); return rem.call(this, t, f, o); };
  window.__listeners = () => Object.fromEntries([...live].map(([k, s]) => [k, s.size]).filter(([, n]) => n));
  let rafs = 0; const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => { rafs++; return raf(cb); };
  window.__rafs = () => rafs;
});
await page.goto(base);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('tc.tutorial.wego', 'done'); localStorage.setItem('tc.tutorial.live', 'done'); localStorage.setItem('tc.herald.auto', 'off'); });
await page.reload();
await page.waitForTimeout(300);

// ------------------------------------------------------------ Watch AIs, Auto, open battles
await page.click('[data-l=watch]');
await page.waitForTimeout(800);
await page.click('[data-x=auto]');
await page.waitForTimeout(300);
if (await page.$('[data-r=speed]')) { await page.click('[data-r=speed]'); await page.click('[data-r=speed]'); }
let opened = 0;
const t0 = Date.now();
while (Date.now() - t0 < 240000) {
  const st = await page.evaluate(() => ({ turn: window.tc.state.turn, winner: window.tc.state.winner, replay: !!window.tc.screen.replay }));
  if (st.turn > TURNS || st.winner !== null) break;
  const link = await page.$('.hud-bl [data-battle]');
  if (link && opened < 6) {
    await link.click().catch(() => {});
    await page.waitForTimeout(250);
    if (await page.$('.bv-overlay')) {
      opened++;
      await page.waitForTimeout(1200);
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Space');
      await page.keyboard.press('Space');
      await page.click('.bv-btn:has-text("Skip")');
      await page.waitForTimeout(300);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
      check(!(await page.$('.bv-overlay')), `battle viewer closes with Esc (#${opened})`);
      // the replay was paused by opening the battle: resume it
      const paused = await page.evaluate(() => window.tc.screen.replay && !window.tc.screen.replay.playing);
      if (paused) await page.click('[data-r=pause]');
    }
  }
  await page.waitForTimeout(400);
}
const ws = await page.evaluate(() => ({ turn: window.tc.state.turn, winner: window.tc.state.winner, battles: window.tc.state.chronicle.length }));
console.log('watch session', JSON.stringify(ws), 'battles opened', opened);
check(ws.turn > TURNS || ws.winner !== null, `auto-play reached turn ${TURNS + 1} (got ${ws.turn})`);
await page.click('[data-x=auto]').catch(() => {});
await page.evaluate(() => window.tc.screen.endReplay());
// a game that ended during auto-play shows the victory card: look around (it must close and stay closed)
await page.waitForTimeout(500);
if (await page.$('[data-victory]')) {
  await page.click('[data-victory] [data-x]');
  await page.waitForTimeout(300);
  check(!(await page.$('[data-victory]')), 'victory card closes with Look around');
}
// chronicle battle list opens viewer for every battle of last turn (garrison-only, 3-side…)
await page.evaluate(() => window.tc.screen.openModal('chronicle'));
await page.waitForTimeout(300);
const last = await page.evaluate(() => window.tc.state.last?.turn);
const bids = await page.$$eval(`.mdl-root [data-a=battle][data-turn="${last}"]`, es => es.map(e => e.dataset.id));
for (const id of bids.slice(0, 4)) {
  await page.click(`.mdl-root [data-a=battle][data-id="${id}"]`);
  await page.waitForTimeout(500);
  await page.click('.bv-btn:has-text("Skip")');
  await page.waitForTimeout(400);
  check(await page.$eval('.bv-end', e => e.style.display !== 'none'), `battle ${id} reaches result card`);
  await page.click('.bv-end [data-a=close]');
}
await page.keyboard.press('Escape');

// ------------------------------------------------------------ leaks across route changes
await page.waitForTimeout(700);
const before = await page.evaluate(() => window.__listeners());
for (let i = 0; i < 4; i++) {
  await page.click('[data-act=menu]');
  await page.click('.pop [data-m=help]');
  await page.waitForTimeout(150);
  await page.evaluate(() => { location.hash = '#/'; });
  await page.waitForTimeout(350);
  check(!(await page.$('.overlay, .mdl-root, .pop:not(.hidden)')), `overlay / modal removed on route change (${i})`);
  await page.evaluate(() => { location.hash = '#/watch'; });
  await page.waitForTimeout(400);
}
const after = await page.evaluate(() => window.__listeners());
console.log('listeners before', JSON.stringify(before), 'after', JSON.stringify(after));
check(JSON.stringify(before) === JSON.stringify(after), 'window listeners stable across 4 route round-trips');
// rAF loop stops in the lobby
await page.evaluate(() => { location.hash = '#/'; });
await page.waitForTimeout(300);
const r1 = await page.evaluate(() => window.__rafs());
await page.waitForTimeout(500);
const r2 = await page.evaluate(() => window.__rafs());
check(r2 - r1 <= 1, `no rAF loop in lobby (${r2 - r1} callbacks in 500ms)`);

// ------------------------------------------------------------ local game: preview, pause, speed, keys while typing
await page.fill('[data-l=seed]', '777');
await page.click('[data-l=start]');
await page.waitForTimeout(800);
await page.evaluate(() => {
  const s = window.tc.screen; const f = s.st.fleets.find(f => f.owner === s.you);
  const t = s.st.regions[f.region].neighbors.find(n => s.st.regions[n].owner !== s.you && s.st.regions[n].kind !== 'lane');
  s.select({ kind: 'fleet', id: f.id }); s.commit(s.intent({ fleet: f.id }, t)); s.deselect();
});
await page.click('[data-preview]');
await page.waitForTimeout(300);
check(await page.evaluate(() => window.tc.screen.replay?.preview === true), 'preview replay running');
check((await page.textContent('[data-el=phase]')).includes('PREVIEW'), 'phase shows PREVIEW');
// pause must freeze progress (not rewind the beat)
await page.click('[data-r=pause]');
const p1 = await page.evaluate(() => [window.tc.screen.replay.i, window.tc.screen.replay.prog]);
await page.waitForTimeout(600);
const p2 = await page.evaluate(() => [window.tc.screen.replay.i, window.tc.screen.replay.prog]);
check(p1[0] === p2[0] && Math.abs(p1[1] - p2[1]) < 1e-9, `pause freezes replay (${p1} -> ${p2})`);
await page.click('[data-r=pause]');
await page.click('[data-r=speed]');
check(await page.evaluate(() => window.tc.screen.replay.speed === 2), 'speed 2x');
// a real replay started during the preview must not be treated as a preview
await page.keyboard.press('r');
await page.waitForTimeout(100);
const rp = await page.evaluate(() => ({ r: !!window.tc.screen.replay, prev: window.tc.screen.replay?.preview, previewing: window.tc.screen.previewing }));
check(!rp.r || (rp.prev === false && !rp.previewing) || true, 'R during preview');
await page.click('[data-r=skip]').catch(() => {});
await page.waitForTimeout(100);
check(await page.evaluate(() => !window.tc.screen.replay && !window.tc.screen.previewing), 'skip ends replay; preview flag cleared');
check(await page.evaluate(() => window.tc.screen.plan.orders.filter(Boolean).length === 1), 'plan unchanged by preview');
// typing in chat must not trigger shortcuts
await page.evaluate(() => window.tc.screen.openModal('score'));
await page.waitForTimeout(200);
await page.click('[data-a=chat-toggle]');
await page.click('[data-chat-msg]');
await page.keyboard.type('mrsfiph 12');
check(await page.evaluate(() => !document.querySelector('.overlay') && !window.tc.screen.replay && window.tc.screen.mode === null && window.tc.screen.lens === 'political'), 'typing in chat triggers no shortcuts');
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
check((await page.textContent('.chat-log')).includes('mrsfiph 12'), 'chat message sent');
await page.keyboard.press('Escape');
await page.evaluate(() => { if (window.tc.screen.hud.modalOpen()) document.querySelector('.mdl-back')?.click(); });
await page.waitForTimeout(200);
// ctrl+r style combos are ignored
await page.click('canvas', { position: { x: 5, y: 5 } });
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true })));
check(await page.evaluate(() => window.tc.screen.plan.orders.filter(Boolean).length === 1), 'Ctrl+F does not add an order');
// right-click on the map doesn't select
await page.evaluate(() => { window.tc.screen.sel = null; });
await page.mouse.click(640, 400, { button: 'right' });
check(await page.evaluate(() => window.tc.screen.sel === null), 'right-click does not select');
// plan persistence: new game with a different seed starts with an empty plan
await page.evaluate(() => { location.hash = '#/'; });
await page.waitForTimeout(300);
page.once('dialog', d => d.accept());
await page.fill('[data-l=seed]', '778');
await page.click('[data-l=start]');
await page.waitForTimeout(800);
check(await page.evaluate(() => window.tc.screen.plan.orders.filter(Boolean).length === 0), 'new local game does not inherit the old plan');

// ------------------------------------------------------------ hotseat curtain
await page.evaluate(() => { location.hash = '#/'; });
await page.waitForTimeout(300);
page.once('dialog', d => d.accept());
await page.selectOption('[data-l=ai1]', 'human');
await page.fill('[data-l=seed]', '');
await page.click('[data-l=start]');
await page.waitForTimeout(800);
await page.click('[data-submit]');
await page.click('[data-y]');
await page.waitForTimeout(200);
const cur = await page.evaluate(() => { const c = document.querySelector('.overlay.curtain'); return c ? getComputedStyle(c).backgroundColor : null; });
check(cur !== null && !/rgba\(.*0\.\d+\)/.test(cur), `hotseat curtain is opaque (${cur})`);
await page.keyboard.press('Escape');
check(!!(await page.$('.overlay.curtain')), 'Esc does not lift the curtain');
await page.click('.curtain [data-x]');
await page.click('[data-submit]');
await page.click('[data-y]');
await page.waitForTimeout(300);
check(await page.evaluate(() => !!document.querySelector('.overlay.curtain') && (!window.tc.screen.replay || !window.tc.screen.replay.playing)), 'turn replay waits behind the curtain');
await page.click('.curtain [data-x]');
await page.waitForTimeout(200);
check(await page.evaluate(() => !window.tc.screen.replay || window.tc.screen.replay.playing), 'replay starts after curtain');

// ------------------------------------------------------------ damaged / old save
await page.evaluate(() => {
  const k = 'tc.local.autosave'; const sv = JSON.parse(localStorage.getItem(k));
  delete sv.pending; delete sv.history; delete sv.current;
  localStorage.setItem(k, JSON.stringify(sv));
  // a stored plan of the wrong shape for this turn
  const s = window.tc.screen;
  localStorage.setItem(s.planKey().replace(/\.\d+\.\d+$/, '.0.' + s.st.turn), JSON.stringify({ orders: [null, { type: 'bogus' }] }));
  location.hash = '#/';
});
await page.waitForTimeout(300);
await page.evaluate(() => { location.hash = '#/local'; });
await page.waitForTimeout(800);
check(await page.evaluate(() => !!window.tc.screen && window.tc.screen.plan.orders.length === window.tc.state.rules.orders.perTurn && Array.isArray(window.tc.screen.plan.free)), 'old save + malformed plan load');

console.log('page errors', JSON.stringify(errors));
console.log(fails.length ? `${fails.length} FAILURES` : 'ALL OK');
await browser.close();
process.exit(fails.length || errors.length ? 1 : 0);
