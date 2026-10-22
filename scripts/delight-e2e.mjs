// The reward moments end to end (client/src/fx, docs/LOOPS.md wave 1): plays real turns in Chromium and records frame
// sequences of the seal ritual, the five-act reveal (seals cracking, the flop, moves, battles in ascending stakes with
// the hold plate and the main-event title, the decisive volley's slow motion), the VP count-up with the Reckoning
// ribbon, and the crowning with its awards; then a phone, reduced motion, hotseat behind the curtain, and LIVE.
// Checks the truth rules as it goes: the crests end on the real VP, every house gets an award, slow motion only on a
// decided battle, nothing staged behind the curtain or in LIVE, no page errors, and the per-frame cost of the fx code.
//
// Frames are captured on Chromium's virtual time (CDP Emulation.setVirtualTimePolicy): the page's clock advances
// exactly `step` ms between two screenshots, so a sequence shows what a player sees at that rate even though this
// sandbox renders the WebGL table in software at about one frame a second.
//
// node scripts/delight-e2e.mjs [outdir] [baseUrl] [--only=desk,phone,rm,hotseat,live] [--fast]
// Frames: <outdir>/<scene>/NNN.jpg and a contact sheet <outdir>/<scene>/sheet.jpg (needs ImageMagick's montage).
import { chromium } from 'playwright-core';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const pos = args.filter(a => !a.startsWith('--'));
const out = pos[0] ?? '/tmp/claude-0/delight';
const base = (pos[1] ?? 'http://localhost:5173/').replace(/\/?$/, '/');
const only = args.find(a => a.startsWith('--only='))?.slice(7).split(',');
const fast = args.includes('--fast');
const want = s => !only || only.includes(s);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--autoplay-policy=no-user-gesture-required'] });
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };
const SHARED = '/@fs' + new URL('../shared/', import.meta.url).pathname;
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const INIT = () => {
  try { localStorage.clear(); localStorage.setItem('tc.tutorial.wego', 'done'); localStorage.setItem('tc.tutorial.live', 'done'); localStorage.setItem('tc.herald.auto', 'off'); } catch { /* */ }
  window.__tcAudioLog = [];
  window.__tcHaptics = [];
  // what got staged, by class, as it appears
  window.__dl = { seals: 0, hold: 0, title: 0, ribbon: 0, coin: 0, ritual: 0, crowning: 0, card: 0 };
  const map = { 'dl-seals': 'seals', 'dl-hold': 'hold', 'dl-title': 'title', 'dl-ribbon': 'ribbon', 'dl-coin': 'coin', 'dl-ritual': 'ritual', 'crowning': 'crowning', 'cr-card': 'card' };
  new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) for (const [c, k] of Object.entries(map)) if (n.classList.contains(c)) window.__dl[k]++; })
    .observe(document, { childList: true, subtree: true });
  // under virtual time (see SYNC_ANIMS), every new animation is caught before it renders and paused
  window.__animT = new WeakMap();
  const grab = () => {
    if (!window.__vt) return;
    const now = performance.now();
    for (const a of document.getAnimations()) if (!window.__animT.has(a)) { window.__animT.set(a, now - (a.currentTime ?? 0)); try { a.pause(); } catch { /* */ } }
  };
  window.__grabAnims = grab;
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (...x) {
    const a = animate.apply(this, x);
    if (window.__vt) { window.__animT.set(a, performance.now()); try { a.pause(); } catch { /* */ } }
    return a;
  };
  new MutationObserver(grab).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
};

async function scene(vp, opts = {}) {
  const ctx = await browser.newContext(vp);
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  await page.routeWebSocket(/\?token=/, () => {});
  const errors = [];
  page.on('pageerror', e => errors.push(`${e.message} ${e.stack?.split('\n')[1] ?? ''}`));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  if (opts.reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(base);
  await page.waitForSelector('[data-l=start]');
  return { ctx, page, errors };
}
const ev = (page, fn, a) => page.evaluate(fn, a);
/**
 * CSS and Web Animations run on the compositor's clock, which in this sandbox follows real time (a frame takes
 * seconds to render), not the virtual clock: left alone they jump to their end between two frames. So every animation
 * is paused when first seen and driven by hand from performance.now() (which is virtual), finishing it on time so its
 * finish handlers run as they would.
 */
const SYNC_ANIMS = () => {
  window.__grabAnims?.();
  const now = performance.now();
  for (const a of document.getAnimations()) {
    const t0 = window.__animT.get(a);
    if (t0 === undefined) continue;
    const timing = a.effect?.getComputedTiming();
    const end = timing ? (timing.endTime ?? Infinity) : Infinity;
    const t = (now - t0) * (a.playbackRate || 1);
    try { if (Number.isFinite(end) && t >= end) a.finish(); else a.currentTime = t; } catch { /* */ }
  }
};
/** Switch the page to virtual time; returns advance(ms). From here on, waits must go through advance. */
async function virtualTime(page) {
  const cdp = await page.context().newCDPSession(page);
  // every face the moments use, loaded now (a font fetched later would stall a screenshot on frozen time)
  await page.evaluate(() => Promise.all([...document.fonts].map(f => f.load().catch(() => null))));
  await cdp.send('Emulation.setVirtualTimePolicy', { policy: 'pause' });
  await page.evaluate(() => { window.__vt = true; window.__grabAnims(); });
  return async ms => {
    // one rendered frame per call: keep steps at or under 250 ms (the replay clamps a frame's dt there)
    for (let left = ms; left > 0; left -= 200) {
      const d = new Promise(r => cdp.once('Emulation.virtualTimeBudgetExpired', r));
      await cdp.send('Emulation.setVirtualTimePolicy', { policy: 'pauseIfNetworkFetchesPending', budget: Math.min(200, left) });
      await d;
      await page.evaluate(SYNC_ANIMS);
    }
  };
}
/** Record frames into <out>/<name>/ every `step` ms of page time, for `ms` or until `until()` holds. */
async function record(page, adv, name, { ms = 4000, step = 100, until = null, max = 400, quality = 64 } = {}) {
  const dir = `${out}/${name}`;
  if (existsSync(dir)) rmSync(dir, { recursive: true });
  mkdirSync(dir, { recursive: true });
  let n = 0;
  for (let t = 0; t < ms && n < max; t += step) {
    await adv(step);
    await page.screenshot({ path: `${dir}/${String(n).padStart(3, '0')}.jpg`, type: 'jpeg', quality, scale: 'css' });
    n++;
    if (until && await ev(page, until)) break;
  }
  try {
    const k = Math.max(1, Math.ceil(n / 30));
    const files = Array.from({ length: n }, (_, i) => i).filter(i => i % k === 0).map(i => `${dir}/${String(i).padStart(3, '0')}.jpg`);
    execFileSync('montage', [...files, '-tile', '5x', '-geometry', '384x+3+3', '-background', '#111', `${dir}/sheet.jpg`]);
  } catch { /* no montage: frames only */ }
  console.log(`  recorded ${name}: ${n} frames @ ${step} ms`);
  return n;
}
const startLocal = async (page, { seed = '4242', mode = null, hotseat = false } = {}) => {
  if (hotseat) await page.selectOption('[data-l=ai1]', 'human');
  if (mode) await page.selectOption('[data-l=mode]', mode);
  await page.fill('[data-l=seed]', seed);
  page.once('dialog', d => d.accept());
  await page.click('[data-l=start]');
  await page.waitForFunction(() => window.tc?.screen?.st);
  await page.waitForTimeout(600);
};
/** Let the AIs play `n` turns for every seat (no replays), then hand the seat back. */
const fastForward = (page, n) => ev(page, ([n]) => {
  const s = window.tc.screen, me = s.you;
  s.src.save.seats[me].kind = 'ai';
  for (let i = 0; i < n && s.st.winner === null; i++) { s.src.advance(); if (s.replay) s.endReplay(); }
  s.src.save.seats[me].kind = 'human'; s.src.save.current = me; s.src.save.reveal = false;
  s.src.refresh(); s.onSourceChange('view'); if (s.replay) s.endReplay();
  s.reck.finish(true); s.reck.dismiss();
}, [n]);
/** Give the human seat the AI's plan for this turn; returns how many orders. */
const aiPlan = page => ev(page, async SH => {
  const { planTurn } = await import(SH + 'sim/ai.ts');
  const s = window.tc.screen;
  s.plan = s.normalizePlan(planTurn(s.src.save.state, s.you)); s.savePlan(); s.renderAll();
  return s.plan.orders.filter(Boolean).length;
}, SHARED);
/** What the coming turn will hold if every seat plays the AI's plan (the sim is deterministic). */
const predict = page => ev(page, async SH => {
  const { planTurn } = await import(SH + 'sim/ai.ts');
  const { resolveTurn } = await import(SH + 'sim/resolve.ts');
  const { decisiveVolley } = await import('/src/fx/battlefacts.ts');
  const st = window.tc.screen.src.save.state;
  const subs = Object.fromEntries(st.players.map(p => [p.id, planTurn(st, p.id)]));
  const r = resolveTurn(structuredClone(st), subs).last;
  return r ? { battles: r.battles.length, decided: r.battles.filter(b => decisiveVolley(b)).length, mine: r.battles.filter(b => b.sides.some(x => x.owner === window.tc.screen.you)).length, called: r.events.filter(e => e.k === 'posture' && e.outcome === 'called').length } : null;
}, SHARED);
const sealAndSkip = page => ev(page, () => { const s = window.tc.screen; s.submit(true); if (s.replay) s.endReplay(); s.reck.finish(true); s.reck.dismiss(); });
const replayInfo = page => ev(page, () => {
  const R = window.tc.screen.replay;
  if (!R) return null;
  return { kinds: R.beats.map(b => b.kind ?? b.events[0]?.k), battles: R.beats.filter(b => b.events[0]?.k === 'battle').length, big: R.big, fresh: R.fresh, dur: Math.round(R.beats.reduce((a, b) => a + b.dur, 0)) };
});
/** Wrap the fx code paths that run every frame and time them. */
const meter = page => ev(page, () => {
  const s = window.tc.screen;
  window.__cost = [];
  for (const [o, k] of [[s.stage, 'frame'], [s, 'beginBeat']]) {
    const f = o[k].bind(o);
    o[k] = (...a) => { const t = performance.now(); const r = f(...a); window.__cost.push(performance.now() - t); return r; };
  }
});
const crestsTrue = page => ev(page, () => ({ shown: [...document.querySelectorAll('.pcrest [data-vp]')].map(e => Number(e.textContent)), vp: window.tc.state.players.map(p => p.vp) }));
const toWinner = async (page, adv) => {
  await ev(page, () => { const s = window.tc.screen; s.src.save.seats[s.you].kind = 'ai'; s.src.save.reveal = true; s.reck.finish(true); s.reck.dismiss(); });
  for (let i = 0; i < 90; i++) { const done = await ev(page, () => { const s = window.tc.screen; if (s.st.winner !== null) return true; try { s.src.advance(); } catch { return true; } if (s.replay) s.endReplay(); return false; }); if (done) break; }
  await ev(page, () => { const s = window.tc.screen; if (s.replay) s.endReplay(); document.querySelectorAll('.herald-ov').forEach(x => x.remove()); window.__tcAudioLog.length = 0; });
  for (let i = 0; i < 20 && !(await page.$('[data-victory]')); i++) await adv(100);
};
const crowningCheck = async (page, tag) => {
  const cr = await ev(page, () => ({
    seats: [...document.querySelectorAll('.cr-seat')].map(e => ({ seat: Number(e.dataset.seat), cards: e.querySelectorAll('.cr-card').length, vp: Number(e.querySelector('[data-cvp]')?.textContent) })),
    vp: window.tc.state.players.map(p => p.vp), audio: window.__tcAudioLog.map(x => x.n),
    cards: [...document.querySelectorAll('.cr-card')].map(c => c.getAttribute('aria-label')),
    sw: [document.documentElement.scrollWidth, innerWidth],
  }));
  console.log(`  ${tag} awards: ${cr.cards.join(' | ')}`);
  check(cr.seats.length === 3 && cr.seats.every(s => s.cards >= 1), `${tag} crowning: every house was dealt a card (${cr.seats.map(s => s.cards)})`);
  check(cr.seats.every(s => s.vp === cr.vp[s.seat]), `${tag} crowning: banners end on the true VP (${cr.seats.map(s => s.vp)} = ${cr.vp})`);
  check(cr.audio.includes('st_victory') || cr.audio.includes('st_defeat'), `${tag} crowning: the sting played`);
  check(cr.sw[0] <= cr.sw[1], `${tag} crowning: no sideways scroll (${cr.sw})`);
};

/** Play to an interesting turn (≥ 2 battles, one decided, one yours if possible), then record it on virtual time. */
async function revealScene(tag, vp, { seed, forward, step, maxTurns = 14 }) {
  const { ctx, page, errors } = await scene(vp);
  await startLocal(page, { seed });
  if (vp.hasTouch) await page.tap('canvas').catch(() => {}); else await page.mouse.click(720, 450);
  await fastForward(page, forward);
  let p = null;
  for (let t = 0; t < maxTurns; t++) {
    p = await predict(page);
    if (p && p.battles >= 2 && p.decided >= 1 && (p.mine >= 1 || t >= maxTurns / 2)) break;
    await aiPlan(page); await sealAndSkip(page);
  }
  console.log(`${tag}: recording turn ${await ev(page, () => window.tc.state.turn)} (${JSON.stringify(p)})`);
  await aiPlan(page);
  await meter(page);
  await ev(page, () => { window.__tcAudioLog.length = 0; for (const k in window.__dl) window.__dl[k] = 0; });
  const vp0 = await ev(page, () => window.tc.state.players.map(p => p.vp));
  const adv = await virtualTime(page);
  // seal (as Enter does: no "seal anyway?" question); the ritual rises from the primary button
  await ev(page, () => window.tc.screen.submit(true));
  await record(page, adv, `${tag}-0-seal`, { ms: 900, step: fast ? 120 : 50 });
  const info = await replayInfo(page);
  console.log(`  reveal: ${info ? `${info.kinds.length} beats, ${info.battles} battles, big ${info.big}, ${(info.dur / 1000).toFixed(1)} s: ${info.kinds.join(' ')}` : 'none'}`);
  if (info) await record(page, adv, `${tag}-1-reveal`, { ms: 70000, step, until: () => !window.tc.screen.replay, quality: 60 });
  await record(page, adv, `${tag}-2-reckoning`, { ms: 3400, step: fast ? 200 : 90 });
  await record(page, adv, `${tag}-2b-ribbon`, { ms: 600, step: 300 });
  const st = await ev(page, () => ({ dl: { ...window.__dl }, audio: window.__tcAudioLog.map(x => x.n), cost: window.__cost.slice(), ribbon: document.querySelector('.dl-ribbon')?.innerText ?? null }));
  const c = await crestsTrue(page);
  const worst = st.cost.length ? Math.max(...st.cost) : 0;
  const mean = st.cost.length ? st.cost.reduce((a, b) => a + b, 0) / st.cost.length : 0;
  console.log(`  ribbon: ${st.ribbon?.replace(/\n/g, ' | ')}`);
  console.log(`  staged ${JSON.stringify(st.dl)}; fx cost per call mean ${mean.toFixed(2)} ms, worst ${worst.toFixed(2)} ms (${st.cost.length} calls)`);
  check(JSON.stringify(c.shown) === JSON.stringify(c.vp), `${tag}: crests end on the true VP (${c.shown} = ${c.vp}; was ${vp0})`);
  check(st.dl.ritual >= 1, `${tag}: the seal ritual played`);
  if (info?.fresh) {
    check(st.audio.includes('syn_wax') && st.audio.includes('syn_inhale'), `${tag}: the seals cracked and the room inhaled`);
    check(st.dl.seals >= 1, `${tag}: Act I seals staged`);
  }
  if (info?.battles) check(st.dl.hold >= info.battles, `${tag}: a hold plate before each battle (${st.dl.hold}/${info.battles})`);
  if (info?.battles >= 2) check(st.dl.title >= 1, `${tag}: the main event is introduced`);
  if (info?.big !== null && info?.big !== undefined) check(st.audio.includes('syn_slowmo'), `${tag}: the decisive volley went slow`);
  if (c.vp.some((v, i) => v !== vp0[i])) check(st.audio.some(n => n.startsWith('syn_coin')) && st.dl.coin > 0, `${tag}: VP coins flew and rang`);
  check(st.dl.ribbon >= 1, `${tag}: the Reckoning ribbon appeared`);
  check(mean < 2 && worst < 25, `${tag}: fx per-frame cost is small`);
  // the crowning
  await toWinner(page, adv);
  await record(page, adv, `${tag}-3-crowning`, { ms: 6600, step: fast ? 300 : 120 });
  await crowningCheck(page, tag);
  await page.screenshot({ path: `${out}/${tag}-3-crowning-final.png` });
  if (await page.$('[data-saga]')) { await ev(page, () => document.querySelector('[data-saga]').click()); await adv(900); await page.screenshot({ path: `${out}/${tag}-4-saga.png` }); }
  check(errors.length === 0, `${tag}: no page errors ${errors.slice(0, 3).join(' | ')}`);
  await ctx.close();
}

if (want('desk')) await revealScene('desk', { viewport: { width: 1440, height: 900 } }, { seed: '4242', forward: 7, step: fast ? 400 : 150 });
if (want('phone')) await revealScene('phone', { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE }, { seed: '777', forward: 8, step: fast ? 400 : 200 });

// =====================================================================================================  reduced motion
if (want('rm')) {
  const { ctx, page, errors } = await scene({ viewport: { width: 1440, height: 900 } }, { reduced: true });
  await startLocal(page, { seed: '4242' });
  await page.mouse.click(720, 450);
  await fastForward(page, 9);
  await aiPlan(page);
  const adv = await virtualTime(page);
  await ev(page, () => window.tc.screen.submit(true));
  const scales = [];
  await record(page, adv, 'rm-0-seal', { ms: 400, step: 200 });
  for (let i = 0; i < 400 && await ev(page, () => !!window.tc.screen.replay); i++) { await adv(150); scales.push(await ev(page, () => window.tc.screen.clock.scale)); }
  await record(page, adv, 'rm-2-reckoning', { ms: 1200, step: 300 });
  check(!scales.some(x => x > 0 && x < 1), `reduced motion: no slow motion (${scales.length} clock samples)`);
  check(await ev(page, () => window.__dl.coin === 0), 'reduced motion: no coin flights (the numbers change in place)');
  const c = await crestsTrue(page);
  check(JSON.stringify(c.shown) === JSON.stringify(c.vp), `reduced motion: crests end on the true VP (${c.shown})`);
  await toWinner(page, adv);
  await adv(1200);
  await page.screenshot({ path: `${out}/rm-3-crowning.png` });
  const anims = await ev(page, () => document.getAnimations().filter(a => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity && (a.effect?.getComputedTiming().duration ?? 0) > 450)
    .map(a => `${a.animationName ?? a.transitionProperty ?? 'waapi'}@${a.effect?.target?.className ?? '?'}`));
  check(anims.length === 0, `reduced motion crowning: no long travel animations (${anims.join(', ')})`);
  await crowningCheck(page, 'rm');
  check(errors.length === 0, `rm: no page errors ${errors.slice(0, 3).join(' | ')}`);
  await ctx.close();
}

// =====================================================================================================  hotseat (real time)
if (want('hotseat')) {
  const { ctx, page, errors } = await scene({ viewport: { width: 1280, height: 800 } });
  await startLocal(page, { seed: '31', hotseat: true });
  if (await page.$('.curtain [data-x]')) await page.click('.curtain [data-x]');
  await aiPlan(page);
  await ev(page, () => window.tc.screen.submit(true));
  await page.waitForTimeout(200);
  const mid = await ev(page, () => ({ curtain: !!document.querySelector('.curtain'), ritual: !!document.querySelector('.dl-ritual'), sealing: !window.tc.screen.canPlan }));
  check(!mid.curtain && mid.ritual && mid.sealing, `hotseat: the ritual plays before the curtain, orders locked (${JSON.stringify(mid)})`);
  await page.waitForSelector('.curtain', { timeout: 3000 }).catch(() => {});
  check(await ev(page, () => !!document.querySelector('.curtain')), 'hotseat: then the curtain hides the board');
  await page.click('.curtain [data-x]');
  await page.waitForTimeout(300);
  await aiPlan(page);
  await ev(page, () => window.tc.screen.submit(true));
  await page.waitForFunction(() => window.tc.screen.replay && document.querySelector('.curtain'), null, { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(600);
  const behind = await ev(page, () => ({ curtain: !!document.querySelector('.curtain'), seals: !!document.querySelector('.dl-seals'), playing: window.tc.screen.replay?.playing ?? null, ribbon: !!document.querySelector('.dl-ribbon'), audio: window.__tcAudioLog.filter(x => x.n.startsWith('syn_wax')).length }));
  check(behind.curtain && !behind.seals && behind.playing === false && !behind.ribbon && behind.audio === 0, `hotseat: nothing of the reveal plays behind the curtain (${JSON.stringify(behind)})`);
  await page.click('.curtain [data-x]');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/hotseat-after-curtain.png` });
  check(await ev(page, () => window.__dl.seals >= 1), 'hotseat: the seals crack once the curtain lifts');
  check(errors.length === 0, `hotseat: no page errors ${errors.slice(0, 3).join(' | ')}`);
  await ctx.close();
}

// =====================================================================================================  LIVE (real time)
if (want('live')) {
  const { ctx, page, errors } = await scene({ viewport: { width: 1440, height: 900 } });
  await startLocal(page, { seed: '777', mode: 'live-blitz' });
  await page.mouse.click(720, 450);
  const kinds = new Set();
  let ticks = 0;
  // watch every tick's animation (the director is wrapped so none slips between two polls)
  await ev(page, () => { const s = window.tc.screen; window.__ticks = []; const f = s.startReplay.bind(s); s.startReplay = (...a) => { f(...a); if (s.replay) window.__ticks.push(s.replay.beats.map(b => b.kind ?? '').filter(Boolean)); }; });
  // give the tick something to show: move a fleet one jump
  await ev(page, () => { const s = window.tc.screen; const f = s.st.fleets.find(x => x.owner === s.you && x.ships.length); if (f) s.src.liveOrder?.({ type: 'move', fleet: f.id, path: [s.st.regions[f.region].neighbors[0]] }); });
  await page.waitForTimeout(25000);
  // and replay a stored tick that has movement and fights in it (the AIs take a while to get going)
  await ev(page, () => { const s = window.tc.screen; const r = s.src.save.history.slice().reverse().find(h => h.events.some(e => e.k === 'move' || e.k === 'battle')); if (r && !s.replay) s.startReplay(r); });
  for (const k of await ev(page, () => window.__ticks)) { ticks++; k.forEach(x => kinds.add(x)); }
  await page.screenshot({ path: `${out}/live-1.png` });
  console.log(`  LIVE: saw ${ticks} tick animations`, JSON.stringify(await ev(page, () => ({ tick: window.tc.screen.st.live?.tick, hidden: document.hidden, last: window.tc.screen.st.last?.events.map(e => e.k).join(',') }))));
  check(!kinds.has('seals') && !kinds.has('flop') && !kinds.has('title') && !kinds.has('hold'), `LIVE: no staged acts (${[...kinds].join(',') || 'none'})`);
  check(await ev(page, () => window.__dl.ribbon === 0 && window.__dl.seals === 0 && window.__dl.ritual === 0), 'LIVE: no ribbon, no seals');
  check(errors.length === 0, `LIVE: no page errors ${errors.slice(0, 3).join(' | ')}`);
  await ctx.close();
}

await browser.close();
console.log(fails ? `\n${fails} FAILED` : '\nall ok');
console.log(`frames: ${out}`);
process.exit(fails ? 1 : 0);
