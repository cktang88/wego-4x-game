// Board / cards / reward moments sweep (wave 3): regression checks for the bugs found while playing the board end
// to end. node scripts/sweep3-board.mjs [base] [--only=coins,crown,ribbon,leak,hotseat,keys,online]
//  - coins:   a coin still in the air when the count-up settles (hidden tab, slow device) no longer lands afterwards
//             and leaves the crest stuck on a stale number (it counted again from `before`)
//  - crown:   the crowning lamp aims at the middle of the winner's banner (it aimed at the rolled-up strip) and
//             follows it on a resize or a turned phone (it kept pointing at the old spot, off-screen on a phone)
//  - ribbon:  the Reckoning ribbon moves with the top bar on a resize (it sat over the crests at 2560x1440)
//  - leak:    leaving a game drops every document listener and the screen itself (the card's peek listener, the
//             ribbon's "away" listener, the animated numbers and the notices' timer each held a finished game)
//  - hotseat: news chips are per seat (the next player found them already stale); the hand-off closes popovers
//  - keys:    Tab moves a keyboard player's focus through the card; after a mouse click it still cycles idle fleets
//  - online:  the push offer waits for the reveal (it covered Act I for the last sealer) and appears once
import { chromium } from 'playwright-core';
const args = process.argv.slice(2);
const base = args.find(a => !a.startsWith('--')) ?? 'http://localhost:5173/';
const only = args.find(a => a.startsWith('--only='))?.slice(7).split(',');
const want = s => !only || only.includes(s);
const SHARED = '/@fs' + new URL('../shared/', import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };
const VIEW = {
  desk: { viewport: { width: 1440, height: 900 } },
  phone: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
};
async function open(tag, view = 'desk') {
  const ctx = await browser.newContext(VIEW[view]);
  await ctx.addInitScript(() => { if (!sessionStorage.getItem('init')) { sessionStorage.setItem('init', '1'); try { localStorage.clear(); localStorage.setItem('tc.tutorial.wego', 'done'); localStorage.setItem('tc.tutorial.live', 'done'); localStorage.setItem('tc.herald.auto', 'off'); localStorage.setItem('tc.gfx', 'off'); } catch { /* */ } } });
  const page = await ctx.newPage();
  await page.routeWebSocket(/\?token=/, () => {});
  page.on('pageerror', e => errors.push(`${tag}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${tag}: ${m.text()}`); });
  page.on('dialog', d => d.accept().catch(() => {}));
  await page.goto(base);
  await page.waitForSelector('[data-l=start]');
  return { ctx, page, ev: (fn, a) => page.evaluate(fn, a) };
}
async function start(page, { seed = '4242', hotseat = 0 } = {}) {
  if (hotseat >= 1) await page.selectOption('[data-l=ai1]', 'human');
  if (hotseat >= 2) await page.selectOption('[data-l=ai2]', 'human');
  await page.fill('[data-l=seed]', seed);
  await page.click('[data-l=start]');
  await page.waitForFunction(() => window.tc?.screen?.st);
  await page.waitForTimeout(500);
}
const aiPlan = page => page.evaluate(async SH => {
  const { planTurn } = await import(SH + 'sim/ai.ts');
  const s = window.tc.screen;
  s.plan = s.normalizePlan(planTurn(s.src.save?.state ?? s.st, s.you)); s.savePlan(); s.renderAll();
}, SHARED);
async function toWinner(page) {
  await page.evaluate(() => { const s = window.tc.screen; s.src.save.seats.forEach(x => (x.kind = 'ai')); s.src.save.reveal = true; s.reck.finish(true); s.reck.dismiss(); });
  for (let i = 0; i < 90; i++) if (await page.evaluate(() => { const s = window.tc.screen; if (s.st.winner !== null) return true; s.src.advance(); if (s.replay) s.endReplay(); return false; })) break;
  await page.evaluate(() => { const s = window.tc.screen; if (s.replay) s.endReplay(); document.querySelectorAll('.herald-ov').forEach(x => x.remove()); });
  await page.waitForFunction(() => !!document.querySelector('[data-victory]'), null, { timeout: 5000 });
}
const lampErr = page => page.evaluate(() => {
  const ov = document.querySelector('.crowning'), lamp = ov.querySelector('.cr-lamp'), w = window.tc.screen.st.winner;
  const cloth = ov.querySelector(`.cr-seat[data-seat="${w}"] .cr-cloth`), b = cloth.getBoundingClientRect(), L = lamp.getBoundingClientRect();
  const m = new DOMMatrix(getComputedStyle(lamp).transform), ang = Math.atan2(m.b, m.a) * 180 / Math.PI;
  const want = -Math.atan2(b.left + b.width / 2 - L.left, b.top + b.height * 0.45 - L.top) * 180 / Math.PI;
  return Math.abs(ang - want);
});

// ------------------------------------------------------------------ coins: late coins after the settle
if (want('coins')) {
  const { ctx, page, ev } = await open('coins');
  await start(page);
  const r = await ev(async () => {
    const s = window.tc.screen, p = s.st.players[1];
    p.vp += 5; p.vpLog.push({ turn: 99, amount: 3, why: 'Edict' }, { turn: 99, amount: 2, why: 'Law' });
    const { vpChanges, turnEntries } = await import('/src/fx/vp.ts');
    s.reck.start(vpChanges(s.st, turnEntries(s.st, 99), null), null, { ribbon: false });
    s.renderAll();
    await new Promise(r => setTimeout(r, 30));
    // the last two coins are held back (as a hidden tab or a slow device holds their animations) past the settle
    const late = document.getAnimations().filter(a => a.effect?.target?.classList?.contains('dl-coin')).slice(-2);
    late.forEach(a => a.pause());
    await new Promise(r => setTimeout(r, 2500));
    late.forEach(a => a.play());
    await new Promise(r => setTimeout(r, 1500));
    s.renderAll();
    return { vp: p.vp, shown: Number(document.querySelector('[data-vp="1"]').textContent), stale: s.vpShown.size };
  });
  check(r.shown === r.vp && r.stale === 0, `coins: late coins never leave the crest on a stale number (shows ${r.shown}, VP ${r.vp}, ${r.stale} overrides left)`);
  await ctx.close();
}

// ------------------------------------------------------------------ crown: the lamp's aim, and on a resize
if (want('crown')) {
  const { ctx, page } = await open('crown');
  await start(page);
  await toWinner(page);
  await page.waitForTimeout(4500);
  check(await lampErr(page) < 2, `crown: the lamp settles on the winner's banner (off by ${(await lampErr(page)).toFixed(1)}°)`);
  for (const vp of [{ width: 852, height: 393 }, { width: 393, height: 852 }, { width: 2560, height: 1440 }]) {
    await page.setViewportSize(vp);
    await page.waitForTimeout(500);
    const e = await lampErr(page);
    check(e < 2, `crown: after a resize to ${vp.width}x${vp.height} the lamp still points at the winner (off by ${e.toFixed(1)}°)`);
  }
  await ctx.close();
}

// ------------------------------------------------------------------ ribbon: follows the top bar on a resize
if (want('ribbon')) {
  const { ctx, page, ev } = await open('ribbon');
  await page.setViewportSize({ width: 852, height: 393 });
  await start(page);
  await page.mouse.click(400, 200);
  await aiPlan(page);
  await ev(() => window.tc.screen.submit(true));
  await page.waitForTimeout(300);
  await ev(() => { const s = window.tc.screen; if (s.replay) s.endReplay(); });
  await page.waitForSelector('.dl-ribbon', { timeout: 5000 }).catch(() => {});
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.waitForTimeout(500);
  const r = await ev(() => {
    const rb = document.querySelector('.dl-ribbon'); if (!rb) return null;
    const a = rb.getBoundingClientRect();
    return ['res', 'crests', 'turn'].map(k => window.tc.screen.hud.h[k].getBoundingClientRect()).some(h => h.width && a.top < h.bottom && a.bottom > h.top && a.left < h.right && a.right > h.left);
  });
  check(r === false, `ribbon: after a resize it stays clear of the top bar (${r === null ? 'no ribbon' : r ? 'overlaps' : 'clear'})`);
  await ctx.close();
}

// ------------------------------------------------------------------ leak: games in a row
if (want('leak')) {
  const { ctx, page, ev } = await open('leak');
  const cdp = await ctx.newCDPSession(page);
  const docListeners = async () => {
    const { result } = await cdp.send('Runtime.evaluate', { expression: 'document' });
    return (await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId })).listeners.filter(l => l.type === 'pointerdown').length;
  };
  const before = await docListeners();
  for (let g = 0; g < 3; g++) {
    await start(page, { seed: String(100 + g) });
    await ev(() => { (window.__wr ??= []).push(new WeakRef(window.tc.screen)); });
    await page.mouse.click(700, 400);
    for (let t = 0; t < 2; t++) {
      await aiPlan(page);
      await ev(() => window.tc.screen.submit(true));
      await page.waitForTimeout(400);
      await ev(() => { const s = window.tc.screen; if (s.replay) s.endReplay(); });
      await page.waitForTimeout(600);
    }
    // a peek, a card and a ribbon up as the player leaves
    await ev(() => { const s = window.tc.screen; s.select({ kind: 'region', id: s.st.players[s.you].capital }); });
    if (g === 1) { await toWinner(page); await page.waitForTimeout(2500); await ev(() => document.querySelector('[data-victory] [data-l]').click()); }
    else await ev(() => window.tc.screen.onExit());
    await page.waitForSelector('[data-l=start]');
  }
  await ev(() => { window.tc = null; });
  await page.waitForTimeout(1500);
  await cdp.send('HeapProfiler.collectGarbage'); await cdp.send('HeapProfiler.collectGarbage');
  const after = await docListeners();
  check(after === before, `leak: document pointerdown listeners back to ${before} after 3 games (${after})`);
  const alive = await ev(() => window.__wr.map(w => !!w.deref()));
  check(!alive.some(Boolean), `leak: no finished game's screen survives (${alive})`);
  check(await ev(() => !document.querySelector('.cardpeek.on, .dl-ribbon, .chargeoffer')), 'leak: no peek, ribbon or Charge offer left over the lobby');
  await ctx.close();
}

// ------------------------------------------------------------------ hotseat: per-seat news, popovers at the hand-off
if (want('hotseat')) {
  const { ctx, page, ev } = await open('hotseat');
  await start(page, { seed: '31', hotseat: 1 });
  const lift = async () => { if (await page.$('.curtain [data-x]')) await page.click('.curtain [data-x]'); await page.waitForTimeout(300); };
  // turn 1: both seal; the reveal for seat 0
  for (let k = 0; k < 2; k++) { await lift(); await aiPlan(page); await ev(() => window.tc.screen.submit(true)); await page.waitForTimeout(1200); }
  await lift();
  await ev(() => { const s = window.tc.screen; if (s.replay) s.endReplay(); s.reck.finish(true); s.reck.dismiss(); });
  const news0 = await ev(() => document.querySelectorAll('.hud-bl .nchip:not(.more)').length);
  // seat 0 takes its time (the news goes stale for it), opens a resource breakdown and seals
  await page.waitForTimeout(12600);
  await page.hover('[data-k=industry]').catch(() => {});
  await aiPlan(page);
  await ev(() => window.tc.screen.submit(true));
  await page.waitForTimeout(1200);
  check(await ev(() => document.querySelector('.hud .pop')?.classList.contains('hidden') !== false), 'hotseat: the hand-off closes the previous player\'s popover');
  await lift();
  await ev(() => { const s = window.tc.screen; if (s.replay) s.endReplay(); s.reck.finish(true); s.reck.dismiss(); });
  const news1 = await ev(() => document.querySelectorAll('.hud-bl .nchip:not(.more)').length);
  check(news0 === 0 || news1 > 0, `hotseat: the next player still gets fresh news chips (seat 0 saw ${news0}, seat 1 sees ${news1})`);
  await ctx.close();
}

// ------------------------------------------------------------------ keys: Tab
if (want('keys')) {
  const { ctx, page, ev } = await open('keys');
  await start(page);
  await ev(() => { const s = window.tc.screen; s.select({ kind: 'region', id: s.st.players[s.you].capital }); });
  await page.waitForTimeout(200);
  await ev(() => document.querySelector('.card [data-a=tab]').focus({ focusVisible: true }));
  const fv = await ev(() => document.activeElement.matches(':focus-visible'));
  await page.keyboard.press('Tab');
  const k = await ev(() => ({ sel: window.tc.screen.sel?.kind, inCard: !!document.activeElement.closest('.card') }));
  check(!fv || (k.sel === 'region' && k.inCard), `keys: Tab moves a keyboard player's focus within the card (${JSON.stringify(k)})`);
  await page.click('.card [data-a=tab][data-t=story]');
  await page.keyboard.press('Tab');
  check(await ev(() => window.tc.screen.sel?.kind === 'fleet'), 'keys: after a mouse click on a card button, Tab still cycles idle fleets');
  await ctx.close();
}

// ------------------------------------------------------------------ online: the push offer
if (want('online')) {
  const P = [await open('A'), await open('B'), await open('C')];
  const a = P[0].page;
  await a.fill('[data-l=name]', 'Alice');
  await a.click('[data-o=create]');
  await a.waitForSelector('[data-go]');
  const link = await a.inputValue('.dialog input');
  await a.click('[data-go]');
  await a.waitForFunction(() => window.tc?.screen?.st);
  for (const [i, n] of [[1, 'Bob'], [2, 'Cara']]) {
    const p = P[i].page;
    await p.goto(link);
    await p.waitForSelector('[data-seat]');
    await p.fill('[data-name]', n);
    await p.click('[data-seat]');
    await p.waitForFunction(() => window.tc?.screen?.st);
    await p.waitForTimeout(600);
  }
  const C = P[2];
  // Bob seals, unseals and reseals at once: one offer, not two
  await aiPlan(P[1].page);
  await P[1].ev(() => { const s = window.tc.screen; s.submit(true); s.src.unsubmit(); });
  await P[1].page.waitForTimeout(300);
  await P[1].ev(() => window.tc.screen.submit(true));
  await P[1].page.waitForTimeout(2500);
  check(await P[1].ev(() => document.querySelectorAll('.tcp-sheet').length) <= 1, 'online: a quick unseal + reseal offers notifications once');
  await aiPlan(a); await P[0].ev(() => window.tc.screen.submit(true));
  // Cara seals last: the turn resolves and the reveal plays; the offer must not cover it
  await aiPlan(C.page);
  await C.ev(() => window.tc.screen.submit(true));
  let during = false;
  for (let i = 0; i < 40; i++) {
    await C.page.waitForTimeout(200);
    const s = await C.ev(() => ({ r: !!window.tc.screen.replay, sheet: !!document.querySelector('.tcp-sheet') }));
    if (s.r && s.sheet) during = true;
    if (!s.r && i > 10) break;
  }
  check(!during, 'online: the notification offer waits until the reveal is over');
  for (const x of P) await x.ctx.close();
}

check(errors.length === 0, `no page errors ${errors.slice(0, 4).join(' | ')}`);
await browser.close();
console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
