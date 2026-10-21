// Regression checks for the game screen & panels (client/src/game.ts, ui/*, main.ts): LIVE ticks vs. what you
// are doing (selection, targeting, chat draft, doctrine), Ctrl+Enter in LIVE, per-fleet order cap with slot
// targeting, join-assault cap, repeat-fee display, hotseat preview leak, plans leaking between games, blocked
// storage, phone chat badge, stale info popovers. Prints ok/FAIL per check; exits 1 on any failure.
// node scripts/ui-e2e.mjs [outdir] [baseUrl]
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? '.';
const base = process.argv[3] ?? 'http://localhost:5173/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };

async function open(opts = {}, init) {
  const ctx = await browser.newContext(opts.phone
    ? { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
    : { viewport: { width: 1440, height: 900 } });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  // ignore Vite hot reloads (other files changing mid-run would reload the page)
  await page.routeWebSocket(/\?token=/, () => {});
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base);
  await page.evaluate(() => { try { localStorage.clear(); localStorage.setItem('tc.tutorial.wego', 'done'); localStorage.setItem('tc.tutorial.live', 'done'); localStorage.setItem('tc.herald.auto', 'off'); } catch { /* blocked */ } });
  await page.goto(base);
  return { ctx, page };
}
async function startLocal(page, { mode = 'wego', seed = '', ai1 } = {}) {
  await page.selectOption('[data-l=mode]', mode);
  if (seed) await page.fill('[data-l=seed]', seed);
  if (ai1) await page.selectOption('[data-l=ai1]', ai1);
  page.once('dialog', d => d.accept());
  await page.click('[data-l=start]');
  await page.waitForFunction(() => window.tc?.screen?.st);
  await page.waitForTimeout(300);
}
const waitTick = (page, n) => page.waitForFunction(n => window.tc.screen.st.live.tick >= n, n, { timeout: 30000 });

// ------------------------------------------------------------------ LIVE
{
  const { ctx, page } = await open();
  await startLocal(page, { mode: 'live-blitz', seed: '11' });
  // Ctrl+Enter used to seal (and locally resolve) a whole WEGO turn in a LIVE game
  const t0 = await page.evaluate(() => [window.tc.state.turn, window.tc.state.live.tick]);
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(300);
  check(!(await page.$('[data-y]')), 'live: Ctrl+Enter opens no seal dialog');
  check(JSON.stringify(await page.evaluate(() => [window.tc.state.turn, window.tc.state.live.tick])) === JSON.stringify(t0), 'live: Ctrl+Enter resolves nothing');
  // one fleet sets off (a visible move at the next ticks), another is selected and in move-targeting
  const ids = await page.evaluate(() => {
    const s = window.tc.screen, st = s.st;
    const fs = st.fleets.filter(f => f.owner === s.you && f.ships.length);
    const a = fs[0], n = st.regions[a.region].neighbors[0];
    s.addOrder({ type: 'move', fleet: a.id, path: [n, st.regions[n].neighbors.find(x => x !== a.region)] });
    const b = fs[1] ?? fs[0];
    s.select({ kind: 'fleet', id: b.id });
    s.mode = { type: 'move', fleet: b.id };
    return { a: a.id, b: b.id };
  });
  await waitTick(page, 2);
  await page.waitForTimeout(200);
  const st1 = await page.evaluate(() => ({ sel: window.tc.screen.sel, mode: window.tc.screen.mode?.type, seen: window.tc.screen.lastSeenTick, tick: window.tc.screen.st.live.tick }));
  check(st1.sel?.id === ids.b && st1.mode === 'move', `live: selection and targeting survive ticks (${JSON.stringify(st1)})`);
  check(st1.seen === st1.tick, 'live: the client notices every tick (tick animations can play)');
  // a doctrine change waits for the next tick: the card must show the new stance, not snap back
  await page.keyboard.press('Escape');
  await page.evaluate(id => window.tc.screen.select({ kind: 'fleet', id }), ids.b);
  await page.click('.card [data-a=stance][data-s=evasive]');
  await page.waitForTimeout(200);
  check(!!(await page.$('.card [data-a=stance][data-s=evasive].on')), 'live: pending doctrine shown before the tick');
  // a half-typed fleet name survives ticks (the card re-renders on every tick)
  await page.click('.card [data-a=more]');
  await page.fill('[data-rename]', 'Half typed');
  const tk0 = await page.evaluate(() => window.tc.screen.st.live.tick);
  await waitTick(page, tk0 + 1);
  await page.waitForTimeout(200);
  const rn = await page.evaluate(() => ({ v: document.querySelector('[data-rename]')?.value, focused: document.activeElement?.hasAttribute('data-rename') }));
  check(rn.v === 'Half typed' && rn.focused, `live: half-typed fleet name and focus survive a tick (${JSON.stringify(rn)})`);
  // the chat draft (Score modal) survives ticks
  await page.evaluate(() => { document.activeElement?.blur(); window.tc.screen.openModal('score'); });
  await page.waitForTimeout(200);
  await page.click('[data-a=chat-toggle]');
  await page.fill('[data-chat-msg]', 'draft message');
  const tk = await page.evaluate(() => window.tc.screen.st.live.tick);
  await waitTick(page, tk + 1);
  await page.waitForTimeout(200);
  const ch = await page.evaluate(() => ({ v: document.querySelector('[data-chat-msg]')?.value, focused: document.activeElement?.hasAttribute('data-chat-msg') }));
  check(ch.v === 'draft message' && ch.focused, `live: chat draft and focus survive a tick (${JSON.stringify(ch)})`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  // replaying a tick by its number: the client maps ticks to cycles the same way the history does
  await waitTick(page, 9);
  const map = await page.evaluate(() => { const s = window.tc.screen; return s.src.save.history.filter(h => h.tick).map(h => [h.tick, h.turn, s.turnOfTick(h.tick)]); });
  check(map.length > 8 && map.every(([, t, c]) => t === c), `live: tick → cycle mapping matches the history (${map.length} ticks)`);
  const rt = await page.evaluate(async () => { const s = window.tc.screen; const h = await s.src.history(s.turnOfTick(2), 2); await s.replayTurn(s.turnOfTick(2), 2); return { h: h?.tick, r: s.replay ? s.replay.result.tick : 'none' }; });
  check(rt.h === 2 && (rt.r === 2 || rt.r === 'none'), `live: Replay tick 2 plays tick 2, not the cycle's first tick (${JSON.stringify(rt)})`);
  // the lobby's throwaway source must not keep ticking its own copy of the game into the autosave
  const route = await page.evaluate(id => JSON.parse(localStorage.getItem('tc.local.autosave')).state.fleets.find(f => f.id === id)?.route, ids.a);
  const route2 = await page.evaluate(id => window.tc.screen.src.save.state.fleets.find(f => f.id === id)?.route, ids.a);
  check(JSON.stringify(route) === JSON.stringify(route2), 'live: the autosave is the game you are playing');
  await ctx.close();
}

// ------------------------------------------------------------------ WEGO planning
{
  const { ctx, page } = await open();
  await startLocal(page, { seed: '5' });
  // two orders for a fleet in later slots; slot I targeted: a third must be refused
  const r = await page.evaluate(() => {
    const s = window.tc.screen, st = s.st;
    const f = st.fleets.find(x => x.owner === s.you && x.ships.length);
    s.targetSlot = 3; s.addOrder({ type: 'fortify', fleet: f.id });
    s.targetSlot = 4; s.addOrder({ type: 'fortify', fleet: f.id });
    s.targetSlot = 0;
    const why = s.fleetBlock(f);
    s.addOrder({ type: 'fortify', fleet: f.id });
    return { why, uses: s.plan.orders.filter(o => o && o.fleet === f.id).length };
  });
  check(r.uses === 2 && /already has 2 orders/.test(r.why ?? ''), `wego: slot targeting can't give a fleet a 3rd order (${JSON.stringify(r)})`);
  // repeat fee: a fleet that joined an earlier seize pays it on its own later order (same as the total)
  const fee = await page.evaluate(() => {
    const s = window.tc.screen, st = s.st;
    s.plan = s.freshPlan();
    const fs = st.fleets.filter(x => x.owner === s.you && x.ships.length);
    s.plan.orders[0] = { type: 'seize', fleet: fs[0].id, target: st.regions[fs[0].region].neighbors[0], also: [fs[1].id] };
    s.plan.orders[1] = { type: 'fortify', fleet: fs[1].id };
    s.savePlan(); s.renderAll();
    return { spend: s.plannedSpend().credits, rep: st.rules.orders.repeatFleetCredits };
  });
  check(fee.spend >= fee.rep, `wego: repeat fee counted for a joiner's own order (${JSON.stringify(fee)})`);
  // joining an assault: at most MAX_JOINERS (3); a 4th drop on the target is refused with a reason
  const jc = await page.evaluate(() => {
    const s = window.tc.screen, st = s.st;
    const fs = st.fleets.filter(x => x.owner === s.you && x.ships.length);
    const main = fs[0];
    // put four more of our fleets next to the target (a test-only reshuffle of the view)
    const target = st.regions[main.region].neighbors[0];
    const extra = [];
    for (let i = 0; i < 4; i++) { const g = structuredClone(main); g.id = 9000 + i; g.name = `Test ${i}`; g.region = main.region; st.fleets.push(g); extra.push(g.id); }
    s.plan = s.freshPlan();
    s.plan.orders[0] = { type: 'seize', fleet: main.id, target, also: extra.slice(0, 2) };
    const third = s.intent({ fleet: extra[2] }, target);
    s.plan.orders[0].also = extra.slice(0, 3);
    const fourth = s.intent({ fleet: extra[3] }, target);
    s.renderAll();
    return { third: third && [third.verb, third.ok], fourth: fourth && [fourth.verb, fourth.ok, fourth.text] };
  });
  check(jc.third?.[0] === 'join' && jc.third[1] && jc.fourth && !jc.fourth[1] && /3 joiners/.test(jc.fourth[2]), `wego: a 4th joiner can't be added (${JSON.stringify(jc)})`);
  await ctx.close();
}

// ------------------------------------------------------------------ plans don't leak into a new game with the same seed
{
  const { ctx, page } = await open();
  await startLocal(page, { seed: '42' });
  await page.evaluate(() => { const s = window.tc.screen; s.addOrder({ type: 'conceal' }); });
  await page.evaluate(() => { location.hash = '#/'; });
  await page.waitForSelector('[data-l=start]');
  await startLocal(page, { seed: '42' });
  check(await page.evaluate(() => window.tc.screen.plan.orders.filter(Boolean).length) === 0, 'new game with the same seed starts with an empty plan');
  await ctx.close();
}

// ------------------------------------------------------------------ hotseat: a Preview never plays on for the next player
{
  const { ctx, page } = await open();
  await startLocal(page, { seed: '7', ai1: 'human' });
  await page.evaluate(() => { const s = window.tc.screen, st = s.st; const f = st.fleets.find(f => f.owner === s.you); s.commit(s.intent({ fleet: f.id }, st.regions[f.region].neighbors.find(n => st.regions[n].owner !== s.you && st.regions[n].kind !== 'lane'))); });
  await page.click('[data-preview]');
  await page.waitForTimeout(300);
  await page.evaluate(() => window.tc.screen.submit());
  await page.click('[data-y]');
  await page.waitForTimeout(200);
  await page.click('.curtain [data-x]');
  await page.waitForTimeout(200);
  const h = await page.evaluate(() => ({ you: window.tc.screen.you, preview: !!window.tc.screen.replay?.preview, plan: window.tc.screen.plan.orders.filter(Boolean).length }));
  check(h.you === 1 && !h.preview && h.plan === 0, `hotseat: next player sees no Preview of the last plan (${JSON.stringify(h)})`);
  await ctx.close();
}

// ------------------------------------------------------------------ storage blocked (private mode / site data off)
{
  const block = () => {
    const thrower = () => { throw new DOMException('blocked', 'SecurityError'); };
    Object.defineProperty(window, 'localStorage', { get: thrower, configurable: true });
  };
  const { ctx, page } = await open({}, block);
  check(!!(await page.$('[data-l=start]')), 'blocked storage: the lobby renders');
  await page.click('[data-l=start]');
  await page.waitForTimeout(800);
  const ok = await page.evaluate(() => !!window.tc?.screen?.st);
  check(ok, 'blocked storage: a local game starts');
  if (ok) {
    await page.evaluate(() => { const s = window.tc.screen; s.addOrder({ type: 'conceal' }); s.submit(); });
    await page.click('[data-y]').catch(() => {});
    await page.waitForTimeout(500);
    check(await page.evaluate(() => window.tc.state.turn) === 2, 'blocked storage: a turn resolves');
  }
  await ctx.close();
}

// ------------------------------------------------------------------ phone: chat badge on the dock, popovers
{
  const { ctx, page } = await open({ phone: true });
  await startLocal(page, { seed: '3' });
  await page.evaluate(() => { const s = window.tc.screen; s.src.chat.push({ at: Date.now(), seat: 1, to: null, text: 'hi' }); s.src.onChange('chat'); });
  await page.waitForTimeout(100);
  check(!!(await page.$('.hud-bl .nbadge')) && !!(await page.$('.hud-br [data-act=menu] .dot')), 'phone: unread chat shows on the badge and the menu');
  await page.tap('.hud-bl .nbadge');
  await page.waitForTimeout(150);
  await page.tap('.nlist [data-pop="note:chat"]');
  await page.waitForTimeout(300);
  check(await page.evaluate(() => window.tc.screen.hud.modalOpen() && window.tc.screen.unreadChat === 0), 'phone: the badge opens Score (chat) and clears it');
  await page.screenshot({ path: `${out}/ui-phone-chat.png` });
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.tc.screen.hud.modal && document.querySelector('[data-a=close], .modal-x')?.click());
  await page.waitForTimeout(200);
  // a resource pill opens its breakdown; tapping the board closes it
  await page.tap('.respill[data-k=industry]');
  await page.waitForTimeout(100);
  const shown = await page.evaluate(() => !document.querySelector('.pop').classList.contains('hidden'));
  await page.touchscreen.tap(200, 400);
  await page.waitForTimeout(100);
  const after = await page.evaluate(() => !document.querySelector('.pop').classList.contains('hidden'));
  check(shown && !after, `phone: resource breakdown opens and closes (${shown}/${after})`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(!overflow, 'phone: no horizontal overflow');
  await ctx.close();
}

// ------------------------------------------------------------------ victory card: "Victory" when you won (the finished game's view is seatless)
{
  const { ctx, page } = await open({}, () => { try { localStorage.setItem('tc.rules.overrides', JSON.stringify({ victory: { turnLimit: 1 } })); } catch { /* */ } });
  await startLocal(page, { seed: '9' });
  await page.evaluate(() => window.tc.screen.submit());
  await page.click('[data-y]');
  await page.waitForTimeout(300);
  await page.evaluate(() => window.tc.screen.endReplay());
  await page.waitForSelector('[data-victory]', { timeout: 5000 }).catch(() => {});
  const v = await page.evaluate(() => ({ w: window.tc.state.winner, h: document.querySelector('[data-victory] h2')?.textContent, first: document.querySelector('.vic-rank')?.textContent, name: window.tc.state.players[window.tc.state.winner]?.name }));
  check(v.h === (v.w === 0 ? 'Victory' : 'has won') && v.first?.startsWith(v.name), `victory card names you as the victor and lists the winner first (${JSON.stringify(v)})`);
  await page.click('[data-victory] [data-x]');
  await page.keyboard.press('r');
  await page.evaluate(() => window.tc.screen.endReplay());
  await page.waitForTimeout(500);
  check(!(await page.$('[data-victory]')), 'victory card stays closed after a replay');
  await ctx.close();
}

// ------------------------------------------------------------------ online (needs the server): unseal, chat, spectator
if (process.env.NO_SERVER !== '1') {
  const { ctx: ca, page: a } = await open();
  await a.fill('[data-l=name]', 'Alice');
  await a.selectOption('[data-o=s2]', 'standard');
  await a.click('[data-o=create]');
  await a.waitForSelector('[data-go]');
  const link = await a.inputValue('.dialog input');
  await a.click('[data-go]');
  await a.waitForFunction(() => window.tc?.screen?.st);
  const { ctx: cb, page: b } = await open();
  await b.goto(link);
  await b.waitForSelector('[data-seat]');
  await b.fill('[data-name]', 'Bob');
  await b.click('[data-seat]');
  await b.waitForFunction(() => window.tc?.screen?.st);
  // Alice plans, seals, unseals: the plan comes back
  await a.evaluate(() => { const s = window.tc.screen; s.addOrder({ type: 'conceal' }); s.submit(); });
  await a.click('[data-y]');
  await a.waitForFunction(() => !!window.tc.screen.src.mySubmission);
  await a.click('[data-unsubmit]');
  await a.waitForFunction(() => !window.tc.screen.src.mySubmission);
  await a.waitForTimeout(200);
  check(await a.evaluate(() => window.tc.screen.plan.orders.filter(Boolean).length) === 1, 'online: unsealing gives the plan back');
  // Alice is typing when Bob's message (and a seal) arrive
  await a.evaluate(() => window.tc.screen.openModal('score'));
  await a.click('[data-a=chat-toggle]');
  await a.fill('[data-chat-msg]', 'half a thought');
  await b.evaluate(() => window.tc.screen.openModal('score'));
  await b.click('[data-a=chat-toggle]');
  await b.fill('[data-chat-msg]', 'hello Alice');
  await b.press('[data-chat-msg]', 'Enter');
  await b.keyboard.press('Escape');
  await b.evaluate(() => window.tc.screen.submit());
  await b.click('[data-y]').catch(() => {});
  await a.waitForFunction(() => window.tc.screen.src.chat.length > 0);
  await a.waitForTimeout(300);
  const d = await a.evaluate(() => ({ v: document.querySelector('[data-chat-msg]')?.value, f: document.activeElement?.hasAttribute('data-chat-msg'), log: document.querySelector('.chat-log')?.textContent.includes('hello Alice') }));
  check(d.v === 'half a thought' && d.f && d.log, `online: a rival's message doesn't wipe your draft (${JSON.stringify(d)})`);
  // spectator: read-only orders, empire picker
  const { ctx: cc, page: c } = await open();
  await c.goto(link);
  const spec = await c.waitForSelector('[data-spec]', { timeout: 5000 }).catch(() => null);
  if (spec) { await spec.click(); await c.waitForFunction(() => window.tc?.screen?.st); }
  else await c.waitForFunction(() => window.tc?.screen?.st);
  check(await c.evaluate(() => window.tc.screen.you === null && !window.tc.screen.canPlan), 'online: spectator cannot plan');
  await c.evaluate(() => window.tc.screen.openModal('empire'));
  await c.waitForTimeout(200);
  check(!!(await c.$('[data-a=emp-pid]')), 'online: spectator can browse empires');
  check(!(await c.$('.strip .chip')) && !(await c.$('[data-submit]')), 'online: spectator has no plan strip');
  await Promise.all([ca.close(), cb.close(), cc.close()]);
}

check(!errors.length, `no page errors ${JSON.stringify(errors.slice(0, 5))}`);
console.log(fails ? `${fails} FAILED` : 'ALL OK');
await browser.close();
process.exit(fails ? 1 : 0);
