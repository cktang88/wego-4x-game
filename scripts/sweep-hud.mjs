// HUD / gestures sweep: regression checks for bugs found in the planning flow (desktop 1440x900 + iPhone 15 Pro touch,
// plus an online LIVE game against the :8787 server). node scripts/sweep-hud.mjs [base]
//  - phone: sliding a long-press onto a ring item commits it (the ring used to rebuild on hover and lose the item)
//  - phone: swiping the bottom sheet's header down dismisses it (it became a native pan: pointercancel)
//  - phone: a long-press that shows a tip never also clicks, however long it is held
//  - phone: tips / popovers / the ring stay clear of the safe areas (simulated via the shell's --safe-* variables)
//  - online LIVE: dragging a fleet with a queued move to a new target re-targets it even with an empty bank
//  - desktop: Enter in the fleet-name field renames and leaves the field (the board's shortcuts work again)
//  - desktop: Halt is planned once and the card says Halting; repeated Splits never take the same ships twice
//  - desktop: the open free-changes list follows a replaced doctrine; removing a research there drops designs needing it
//  - hotseat: the curtain hides the previous seat's plan; shortcuts stay quiet under it; the replay waits behind it
import { chromium } from 'playwright-core';
const base = process.argv[2] ?? 'http://localhost:5173/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };
const VIEW = {
  desk: { viewport: { width: 1440, height: 900 } },
  phone: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
};
async function open(tag, view) {
  const ctx = await browser.newContext(VIEW[view]);
  const page = await ctx.newPage();
  await page.routeWebSocket(/\?token=/, () => {});
  page.on('pageerror', e => errors.push(`${tag}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${tag}: ${m.text()}`); });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const prep = async () => {
    await page.goto(base);
    await ev(() => { localStorage.clear(); localStorage.setItem('tc.tutorial.wego', 'done'); localStorage.setItem('tc.tutorial.live', 'done'); localStorage.setItem('tc.herald.auto', 'off'); });
    await page.goto(base);
  };
  const start = async (opts = {}) => {
    await prep();
    if (opts.hotseat) await page.selectOption('[data-l=ai1]', 'human');
    await page.fill('[data-l=seed]', '4242');
    await page.click('[data-l=start]');
    await page.waitForFunction(() => window.tc?.screen?.st);
    await page.waitForTimeout(900);
  };
  const edit = (fn, arg) => page.evaluate(([src, a]) => { const s = window.tc.screen; new Function('s', 'st', 'a', src)(s, s.src.save.state, a); s.src.refresh(); s.onSourceChange('view'); }, [fn, arg]);
  const fleetXY = id => ev(id => { const s = window.tc.screen; const p = s.map.toScreen(s.lastFleetPos.get(id)); const r = s.el.canvas.getBoundingClientRect(); return [p.x + r.left, p.y + r.top]; }, id);
  const regionXY = id => ev(id => { const s = window.tc.screen; const p = s.map.toScreen(s.st.regions[id].site); const r = s.el.canvas.getBoundingClientRect(); return [p.x + r.left, p.y + r.top]; }, id);
  const myFleet = () => ev(() => { const s = window.tc.screen; return s.st.fleets.find(f => f.owner === s.you && f.ships.length).id; });
  let cdp = null;
  const tp = async (type, x, y) => { cdp ??= await ctx.newCDPSession(page); return cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] }); };
  const drag = async (fid, rid) => { const [fx, fy] = await fleetXY(fid); const [rx, ry] = await regionXY(rid); await page.mouse.move(fx, fy); await page.mouse.down(); await page.mouse.move(fx + 10, fy + 10, { steps: 3 }); await page.mouse.move(rx, ry, { steps: 8 }); await page.waitForTimeout(150); await page.mouse.up(); await page.waitForTimeout(600); };
  return { ctx, page, ev, prep, start, edit, fleetXY, regionXY, myFleet, tp, drag };
}

// ---------------------------------------------------------------- phone
{
  const P = await open('phone', 'phone');
  const { page, ev, start, fleetXY, myFleet, tp } = P;
  await start();
  // ring: long-press a fleet, slide onto an item in small steps, release
  const f = await myFleet();
  const [fx, fy] = await fleetXY(f);
  await tp('touchStart', fx, fy); await page.waitForTimeout(600);
  const it = await ev(() => { const b = document.querySelector('.ring [data-ring=fortify]') ?? document.querySelector('.ring [data-ring]'); const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, b.dataset.ring]; });
  for (let i = 1; i <= 6; i++) { await tp('touchMove', fx + (it[0] - fx) * i / 6, fy + (it[1] - fy) * i / 6); await page.waitForTimeout(16); }
  await tp('touchEnd'); await page.waitForTimeout(300);
  const pl = await ev(() => window.tc.screen.plan.orders.filter(Boolean).map(o => o.type));
  check(pl.length === 1, `phone: ring slide commits ${it[2]} (${pl})`);
  // the sheet: swipe its header down
  const cap = await ev(() => window.tc.screen.st.players[window.tc.screen.you].capital);
  await ev(id => window.tc.screen.select({ kind: 'region', id }), cap);
  await page.waitForTimeout(400);
  const top = await ev(() => document.querySelector('.card').getBoundingClientRect().top);
  await tp('touchStart', 150, top + 30);
  for (let i = 1; i <= 10; i++) { await tp('touchMove', 150, top + 30 + 22 * i); await page.waitForTimeout(16); }
  await tp('touchEnd'); await page.waitForTimeout(300);
  check(await ev(() => window.tc.screen.sel === null), 'phone: swiping the sheet header down dismisses it');
  // safe areas (simulated) + a long-held tip on a crest
  await ev(() => { const s = document.querySelector('.shell'); s.style.setProperty('--safe-t', '59px'); s.style.setProperty('--safe-b', '34px'); });
  const cr = await ev(() => { const r = document.querySelector('[data-crest]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await tp('touchStart', cr[0], cr[1]); await page.waitForTimeout(900);
  const tipTop = await ev(() => { const t = document.querySelector('.uxtip'); return t.classList.contains('hidden') ? -1 : t.getBoundingClientRect().top; });
  check(tipTop >= 59, `phone: a top-bar tip clears the notch (top ${Math.round(tipTop)})`);
  await tp('touchEnd'); await page.waitForTimeout(400);
  check(await ev(() => !document.querySelector('.mdl-root.show')), 'phone: a long-press that showed a tip does not also click');
  await ev(([x, y]) => { const s = window.tc.screen; s.map.cam.y += (y - 20) / s.map.cam.z; }, [fx, fy]);
  await page.waitForTimeout(100);
  const [gx, gy] = await fleetXY(f);
  await tp('touchStart', gx, gy); await page.waitForTimeout(600); await tp('touchEnd'); await page.waitForTimeout(100);
  const ringTop = await ev(() => Math.min(...[...document.querySelectorAll('.ring [data-ring]')].map(b => b.getBoundingClientRect().top)));
  check(ringTop >= 59, `phone: the ring clears the notch (top ${Math.round(ringTop)})`);
  await P.ctx.close();
}

// ---------------------------------------------------------------- online LIVE: re-target a queued move with an empty bank
{
  const L = await open('live', 'desk');
  const { page, ev, prep, drag } = L;
  await prep();
  await page.fill('[data-l=name]', 'Sweep');
  await page.selectOption('[data-o=mode]', 'live-fast');
  await page.click('[data-o=create]');
  await page.waitForSelector('[data-go]');
  await page.click('[data-go]');
  await page.waitForFunction(() => window.tc?.screen?.st?.live);
  await page.waitForTimeout(1200);
  const info = await ev(() => { const s = window.tc.screen, st = s.st; const f = st.fleets.find(f => f.owner === s.you && f.ships.length); return { f: f.id, t: st.regions[f.region].neighbors.filter(n => s.intent({ fleet: f.id }, n)?.ok) }; });
  await drag(info.f, info.t[0]);
  await ev(() => { const s = window.tc.screen; for (let i = 0; i < 6 && s.bank > 0; i++) s.src.liveOrder({ type: 'scan', target: s.st.players[s.you].capital }); });
  await page.waitForTimeout(800);
  const bank = await ev(() => window.tc.screen.bank);
  await drag(info.f, info.t[1]);
  const q = await ev(() => window.tc.screen.queue.filter(o => o.type === 'move' || o.type === 'seize').map(o => o.target ?? o.path.at(-1)));
  check(bank === 0 && q.length === 1 && q[0] === info.t[1], `LIVE online: drag re-targets a queued move with the bank empty (${q})`);
  await L.ctx.close();
}

// ---------------------------------------------------------------- desktop WEGO
{
  const D = await open('desk', 'desk');
  const { page, ev, start, edit, myFleet } = D;
  await start();
  const f = await myFleet();
  await ev(id => window.tc.screen.select({ kind: 'fleet', id }), f);
  await page.click('[data-a=more]'); await page.waitForTimeout(100);
  await page.fill('[data-rename]', 'Iron Tide');
  await page.keyboard.press('Enter'); await page.waitForTimeout(100);
  const s = await ev(() => ({ focus: document.activeElement?.tagName, free: window.tc.screen.plan.free.map(x => x.name) }));
  check(s.focus !== 'INPUT' && s.free.includes('Iron Tide'), 'Enter in the name field renames and leaves the field');
  await page.click('[data-a=more]');
  // the free-changes list follows a replaced doctrine
  await page.click('[data-a=stance][data-s=aggressive]', { force: true });
  await ev(() => window.tc.screen.deselect());
  await page.click('[data-act=free]'); await page.waitForTimeout(100);
  await ev(id => window.tc.screen.select({ kind: 'fleet', id }), f);
  await page.click('[data-a=stance][data-s=evasive]', { force: true });
  await page.waitForTimeout(100);
  check(/evasive/.test(await ev(() => document.querySelector('.freelist')?.textContent ?? '')), 'the open free list follows a replaced doctrine');
  // halt once
  await edit(`const f = st.fleets.find(x => x.id === a); const n = st.regions[f.region].neighbors[0]; f.route = { path: [n, st.regions[n].neighbors[0]], seize: null, mp: 0 };`, f);
  await ev(id => window.tc.screen.select({ kind: 'fleet', id }), f);
  await page.waitForTimeout(100);
  await page.click('[data-a=halt]'); await page.waitForTimeout(100);
  const h = await ev(() => ({ n: window.tc.screen.plan.free.filter(x => x.type === 'halt').length, btn: !!document.querySelector('[data-a=halt]') }));
  check(h.n === 1 && !h.btn, 'Halt is planned once; the card then says Halting');
  // splits never share ships
  const big = await ev(() => { const s = window.tc.screen; return s.st.fleets.filter(f => f.owner === s.you).sort((a, b) => b.ships.length - a.ships.length)[0].id; });
  for (let i = 0; i < 3; i++) {
    await ev(id => window.tc.screen.select({ kind: 'fleet', id }), big);
    await page.waitForTimeout(100);
    await page.click('[data-a=split]', { force: true }).catch(() => {});
    await page.waitForTimeout(150);
    await ev(() => document.querySelector('[data-f=quick]')?.click()); await page.waitForTimeout(150);
    await ev(() => document.querySelector('[data-f=cancel]')?.click());
  }
  const all = await ev(id => window.tc.screen.plan.free.filter(x => x.type === 'split' && x.fleet === id).flatMap(x => x.ships), big);
  check(new Set(all).size === all.length, `planned splits never take the same ship twice (${all})`);
  // taking a research out from the strip also drops a queued design that needed it
  await ev(() => { const s = window.tc.screen; s.plan.free = [{ type: 'research', tech: 'railguns' }, { type: 'blueprint', cls: 'frigate', mod: 'railgun' }]; s.savePlan(); s.deselect(); });
  if (!(await page.$('.freelist'))) { await page.click('[data-act=free]'); await page.waitForTimeout(100); }
  await page.click('.freelist [data-delfree="0"]'); await page.waitForTimeout(100);
  check(!(await ev(() => window.tc.screen.plan.free.some(x => x.type === 'blueprint'))), 'removing a research from the strip drops the design that needed it');
  await D.ctx.close();
}

// ---------------------------------------------------------------- hotseat
{
  const H = await open('hotseat', 'desk');
  const { page, ev, start, myFleet, drag } = H;
  await start({ hotseat: true });
  const me = await ev(() => window.tc.screen.you);
  const f = await myFleet();
  const t = await ev(id => { const s = window.tc.screen; return s.st.regions[s.fleet(id).region].neighbors.find(n => s.intent({ fleet: id }, n)?.verb === 'seize'); }, f);
  await drag(f, t);
  await page.mouse.move(700, 450);
  await page.keyboard.press('Enter'); await page.waitForTimeout(500);
  const s1 = await ev(() => ({ you: window.tc.screen.you, curtain: !!document.querySelector('.overlay.curtain'), orders: window.tc.screen.plan.orders.filter(Boolean).length, free: window.tc.screen.plan.free.length, charge: !!document.querySelector('.chargeoffer') }));
  check(s1.curtain && s1.you !== me && !s1.orders && !s1.free && !s1.charge, `hotseat: curtain up, the next seat starts clean ${JSON.stringify(s1)}`);
  await page.keyboard.press('e'); await page.keyboard.press('Tab'); await page.waitForTimeout(200);
  check(await ev(() => !document.querySelector('.mdl-root.show') && window.tc.screen.sel === null), 'hotseat: shortcuts quiet under the curtain');
  await page.click('.curtain [data-x]'); await page.waitForTimeout(300);
  await page.keyboard.press('Enter'); await page.waitForTimeout(800);
  const s3 = await ev(() => ({ turn: window.tc.state.turn, curtain: !!document.querySelector('.overlay.curtain'), playing: !!window.tc.screen.replay?.playing }));
  check(s3.curtain && s3.turn === 2 && !s3.playing, 'hotseat: the turn resolves behind the curtain, the replay waits');
  await H.ctx.close();
}

console.log(errors.length ? `page errors:\n${errors.join('\n')}` : 'no page errors');
console.log(fails ? `${fails} FAILED` : 'all checks passed');
await browser.close();
process.exit(fails || errors.length ? 1 : 0);
