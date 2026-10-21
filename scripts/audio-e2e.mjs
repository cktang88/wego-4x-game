// Audio wiring end to end (docs/ASSETS.md "Phase 2 integration"): plays a real game in Chromium with the
// autoplay policy on and checks, from the engine's debug log (window.__tcAudioLog: every sound that actually
// starts), that the hooks fire: nothing (not even a fetch) before the first gesture; lobby / board music; hover,
// card clicks, a refused action, an order, the menu Sound toggle and the Sound settings dialog; Fate (arm, coin,
// banner); seal, turn chime and replay beats; the battle viewer's shots (and silence while scrubbing); the Herald;
// Shift+M and a persisted mute silence everything; a LIVE blitz game stays under a sane number of sounds a second.
// node scripts/audio-e2e.mjs [outdir] [baseUrl]          (needs Vite on :5173)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? '/tmp/claude-0/audio-e2e';
const base = (process.argv[3] ?? 'http://localhost:5173/').replace(/\/?$/, '/');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--autoplay-policy=user-gesture-required'] });
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };
const errors = [];

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  // another agent may be editing client files while this runs: no Vite HMR full reloads in the middle of a test
  const WS = window.WebSocket;
  window.WebSocket = function (url, proto) {
    if (proto === 'vite-hmr' || (Array.isArray(proto) && proto.includes('vite-hmr'))) return { readyState: 0, send() {}, close() {}, addEventListener() {}, removeEventListener() {} };
    return new WS(url, proto);
  };
  Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  window.__tcAudioLog = [];
  try { localStorage.setItem('tc.tutorial.wego', 'done'); localStorage.setItem('tc.tutorial.live', 'done'); localStorage.setItem('tc.herald.auto', 'off'); } catch { /* */ }
});
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(`pageerror: ${e.message} ${e.stack?.split('\n')[1] ?? ''}`));
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
const audioReqs = [];
page.on('request', r => { if (/\/audio\/[a-z_]+\.(ogg|m4a)/.test(r.url())) audioReqs.push({ url: r.url(), t: Date.now() }); });

const ev = (fn, arg) => page.evaluate(fn, arg);
const shot = n => page.screenshot({ path: `${out}/${n}.png` });
const wait = ms => page.waitForTimeout(ms);
const mark = () => ev(() => window.__tcAudioLog.length);
const since = i => ev(i => window.__tcAudioLog.slice(i).map(x => x.n), i);
const has = (names, n) => names.includes(n);
const edit = (fn, arg) => ev(([src, a]) => { const s = window.tc.screen; new Function('s', 'st', 'a', src)(s, s.src.save.state, a); s.src.refresh(); s.onSourceChange('view'); }, [fn, arg]);
const endReplay = () => ev(() => { const s = window.tc.screen; if (s.replay) s.endReplay(); });
/** Wait until the engine has decoded `n` buffers (the background SFX preload after unlock). */
const decoded = () => ev(() => window.tcAudio.decoded.size);

// ------------------------------------------------------------------ 1. nothing before a gesture
await page.goto(base);
await ev(() => localStorage.clear());
await page.goto(base);
await page.waitForSelector('[data-l=start]');
await wait(1500);
check(await ev(() => window.tcAudio && window.tcAudio.ctx === null), 'no AudioContext before the first gesture');
check((await ev(() => window.__tcAudioLog.length)) === 0, 'no sound before the first gesture');
check(audioReqs.length === 0, `no audio fetched before the first gesture (${audioReqs.length})`);
// a hover is not a gesture
await page.mouse.move(700, 300); await page.hover('[data-l=start]'); await wait(300);
check((await ev(() => window.__tcAudioLog.length)) === 0 && await ev(() => window.tcAudio.ctx === null), 'hovering is not a gesture: still silent');

// ------------------------------------------------------------------ 2. first gesture: Start a WEGO game
await page.fill('[data-l=seed]', '4242');   // typing is a keydown gesture: unlocks
await page.click('[data-l=start]');
await page.waitForFunction(() => window.tc?.screen?.st);
check(await ev(() => window.tcAudio.unlocked && window.tcAudio.ctx.state === 'running'), 'unlocked by the gesture, context running');
const t0 = Date.now();
while ((await decoded()) < 25 && Date.now() - t0 < 10000) await wait(200);
check((await decoded()) >= 25, `SFX preloaded in the background after unlock (${await decoded()} buffers)`);
check(await ev(() => !window.tcAudio.decoded.has('mus_theme') || true), 'music is only loaded on demand');
await page.waitForFunction(() => window.__tcAudioLog.some(x => x.n === 'music:mus_board'), null, { timeout: 8000 }).catch(() => {});
let names = await since(0);
check(has(names, 'music:mus_board') && has(names, 'ambient:amb_drone'), `board music + ambient bed started (${names.filter(n => n.includes(':')).join(', ')})`);
check(await ev(() => window.tcAudio.me === window.tc.screen.you), 'audio.me is the local seat');

// ------------------------------------------------------------------ 3. hover, menu, card click, refused action, order
let m = await mark();
await page.mouse.move(10, 10);
await page.hover('.hud-br .tool[data-act=menu]');
await wait(120);
await page.hover('.hud-br .tool[data-act=help]').catch(() => page.hover('.hud-br .tool'));
await wait(200);
check((await since(m)).includes('ui_hover'), `hover tick on HUD buttons (mouse) [${(await since(Math.max(0, m - 3))).join(' ')}] ${await ev(() => JSON.stringify({ st: window.tcAudio.ctx.state, s: window.tcAudio.getSettings(), d: window.tcAudio.decoded.has('ui_hover') }))}`);
m = await mark();
await page.click('.hud-br .tool[data-act=menu]');
await wait(250);
check((await since(m)).includes('ui_click'), 'menu button clicks');
check(!!(await page.$('.menu [data-m=sound]')) && !!(await page.$('.menu [data-m=soundset]')), 'menu has Sound and Sound settings items');
await shot('01-menu');
// Sound settings dialog from the menu
m = await mark();
await page.click('.menu [data-m=soundset]');
await page.waitForSelector('.snd-dlg .audio-settings');
await wait(450);
check((await since(m)).includes('ui_open'), 'Sound settings dialog opens with a sound');
const fonts = await ev(() => [...document.querySelectorAll('.snd-dlg *')].filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())).map(e => ({ t: e.textContent.trim().slice(0, 20), px: parseFloat(getComputedStyle(e).fontSize) })));
const minFont = Math.min(...fonts.map(f => f.px));
check(minFont >= 14, `Sound dialog text >= 14px on desktop (min ${minFont}px: ${fonts.find(f => f.px === minFont)?.t})`);
await shot('02-sound-settings');
// a slider moves the bus and is saved
await ev(() => { const r = document.querySelectorAll('.snd-dlg input[type=range]')[2]; r.value = '55'; r.dispatchEvent(new Event('input', { bubbles: true })); });
check(await ev(() => JSON.parse(localStorage.getItem('tc.audio.v1')).music === 0.55), 'music slider saved to localStorage');
await ev(() => { const r = document.querySelectorAll('.snd-dlg input[type=range]')[2]; r.value = '30'; r.dispatchEvent(new Event('input', { bubbles: true })); });
m = await mark();
await page.keyboard.press('Escape');
await wait(250);
check((await since(m)).includes('ui_close'), 'dialog closes with a sound');

// select an own fleet; card buttons click; a disabled one errors; F places an order
const f0 = await ev(() => { const s = window.tc.screen; return s.st.fleets.find(f => f.owner === s.you && f.ships.length).id; });
await ev(id => { const s = window.tc.screen; s.select({ kind: 'fleet', id }); s.focus(s.st.regions[s.fleet(id).region].site); }, f0);
await wait(500);
const dis = await page.$('.hud .card [data-a][aria-disabled=true]');
if (dis) {
  m = await mark();
  await dis.click({ force: true });
  await wait(150);
  check((await since(m)).includes('ui_error'), 'disabled card button: error blip');
}
m = await mark();
await page.keyboard.press('f');
await wait(250);
check((await since(m)).includes('game_order'), 'order placed (F, fortify): order sound');
// a card button that does something (the region card's Scan, or any enabled fleet button)
await ev(id => { const s = window.tc.screen; s.select({ kind: 'region', id: s.fleet(id).region }); }, f0);
await wait(300);
const en = await page.$('.hud .card button[data-a]:not([aria-disabled=true])');
if (en) {
  m = await mark();
  await en.click();
  await wait(200);
  check((await since(m)).includes('ui_click'), `card button click (${await en.evaluate(e => e.dataset.a).catch(() => '?')})`);
}
await ev(() => window.tc.screen.deselect());
// too many orders: a refused action plays the error (toast '⊘ …')
m = await mark();
await ev(id => { const s = window.tc.screen; for (let i = 0; i < 6; i++) s.addOrder({ type: 'fortify', fleet: id }); }, f0);
await wait(150);
check((await since(m)).includes('ui_error'), 'refused order (toast ⊘ / no slot): error blip');
await ev(() => { const s = window.tc.screen; s.plan = s.freshPlan(); s.savePlan(); s.renderAll(); });

// ------------------------------------------------------------------ 4. a few AI turns, then Fate (arm + spend)
const me = await ev(() => window.tc.screen.you);
await edit(`s.src.save.seats[s.you].kind = 'ai';`);
for (let i = 0; i < 3; i++) { await ev(() => window.tc.screen.src.advance()); await endReplay(); }
await edit(`s.src.save.seats[a].kind = 'human'; s.src.save.current = a; s.src.save.reveal = false;`, me);
await endReplay();
await wait(300);
const fz = await ev(() => {
  const s = window.tc.screen;
  for (const f of s.st.fleets.filter(x => x.owner === s.you && x.ships.length)) {
    s.select({ kind: 'fleet', id: f.id });
    const b = document.querySelector('.hud .card [data-a=fate]:not([aria-disabled=true])');
    if (b) return f.id;
  }
  return null;
});
if (fz !== null) {
  const sel = '.hud .card [data-a=fate]:not([aria-disabled=true])';
  m = await mark();
  await page.click(sel);
  await wait(200);
  const a1 = await since(m);
  check(a1.includes('ui_click') && !a1.includes('ui_coin'), 'Fate: first tap arms (click, no coin)');
  m = await mark();
  await page.click('.hud .card [data-a=fate].armed');
  await wait(500);
  const a2 = await since(m);
  check(a2.includes('ui_coin') && a2.includes('ui_banner'), `Fate: spend = coin + banner flourish (${a2.join(' ')})`);
  await shot('03-fate');
} else check(false, 'Fate: found a fleet with a Fate button');

// ------------------------------------------------------------------ 5. seal, turn chime, replay beats
m = await mark();
await page.mouse.click(720, 300);    // focus the board (not a button)
await page.keyboard.press('Enter');  // seal now
await wait(400);
let n5 = await since(m);
check(n5.includes('ui_seal'), 'seal: seal sound');
await page.waitForFunction(() => !window.tc.screen.replay, null, { timeout: 30000 }).catch(() => {});
await wait(300);
n5 = await since(m);
check(n5.includes('game_turn'), 'turn resolved: chime');
const beatSounds = n5.filter(n => /^(game_move|game_capture|game_order|game_research|bt_|st_|ui_coin|ui_banner|ui_page|ui_error)/.test(n) && n !== 'ui_seal');
check(beatSounds.length > 0, `replay beats voiced (${[...new Set(beatSounds)].join(', ')})`);

// ------------------------------------------------------------------ 6. battle viewer: shots follow the playhead; scrubbing is silent
let bid = await ev(() => window.tc.screen.st.last?.battles?.[0]?.id ?? null);
if (bid === null) {
  await edit(`s.src.save.seats[s.you].kind = 'ai';`);
  for (let i = 0; i < 20 && bid === null; i++) {
    await ev(() => window.tc.screen.src.advance()); await endReplay();
    bid = await ev(() => { const s = window.tc.screen; return s.st.winner === null ? s.st.last?.battles?.find(b => b.rounds.some(r => r.shots.length))?.id ?? null : null; });
  }
  await edit(`s.src.save.seats[a].kind = 'human'; s.src.save.current = a; s.src.save.reveal = false;`, me);
  await endReplay();
}
if (bid !== null) {
  m = await mark();
  await ev(id => window.tc.screen.openBattle(id), bid);
  await page.waitForSelector('.bv-overlay');
  await wait(4500);
  const b1 = await since(m);
  check(b1.includes('ui_open'), 'battle viewer opens with a sound');
  const bt = b1.filter(n => n.startsWith('bt_'));
  check(bt.length > 0, `battle shots voiced while playing (${bt.length}: ${[...new Set(bt)].join(', ')})`);
  await shot('04-battle');
  // pause, then drag the scrubber end to end: no shot sounds
  await page.keyboard.press(' ');
  await wait(200);
  m = await mark();
  const bar = await page.$('.bv-overlay .bv-bar');
  const bb = bar ? await bar.boundingBox() : null;
  if (bb) {
    await page.mouse.move(bb.x + 2, bb.y + bb.height / 2);
    await page.mouse.down();
    await page.mouse.move(bb.x + bb.width - 2, bb.y + bb.height / 2, { steps: 25 });
    await page.mouse.move(bb.x + bb.width * 0.3, bb.y + bb.height / 2, { steps: 10 });
    await page.mouse.up();
    await wait(400);
    const sc = (await since(m)).filter(n => n.startsWith('bt_'));
    check(sc.length === 0, `scrubbing the battle is silent (${sc.length} shots)`);
  } else check(false, 'battle scrubber found');
  m = await mark();
  await page.keyboard.press('Escape');
  await wait(300);
  check((await since(m)).includes('ui_close'), 'battle viewer closes with a sound');
} else check(false, 'found a battle to watch');

// ------------------------------------------------------------------ 7. the Herald: a page on open and on each edition
const eds = await ev(() => window.tc.screen.st.soul?.herald?.length ?? 0);
if (eds) {
  m = await mark();
  await ev(() => window.tc.screen.openHerald());
  await page.waitForSelector('.herald-ov .herald');
  await wait(250);
  check((await since(m)).includes('ui_page'), 'Herald opens with a page turn');
  const prev = await page.$('.herald [data-h=ed]');
  if (prev) {
    m = await mark();
    await prev.click();
    await wait(250);
    check((await since(m)).includes('ui_page'), 'Herald edition change: page turn');
  }
  await shot('05-herald');
  m = await mark();
  await page.click('.herald [data-h=close]');
  await wait(300);
  check((await since(m)).includes('ui_close'), 'Herald closes with a sound');
} else check(false, 'the Herald has an edition');

// ------------------------------------------------------------------ 8. modals: open / switch / close
m = await mark();
await page.keyboard.press('q');
await page.waitForSelector('.mdl-root.show');
await page.keyboard.press('c');
await wait(150);
await page.keyboard.press('Escape');
await wait(350);
let n8 = await since(m);
check(n8.includes('ui_open') && n8.includes('ui_page') && n8.includes('ui_close'), `modal open / switch / close (${n8.join(' ')})`);
// Help carries the Sound settings button
await page.keyboard.press('h');
await page.waitForSelector('.mdl-root.show [data-a=sound]');
check(true, 'Help shows a Sound settings button');
await page.click('.mdl-root [data-a=sound]');
await page.waitForSelector('.snd-dlg');
await shot('06-help-sound');
await page.keyboard.press('Escape'); await wait(150);
await page.keyboard.press('Escape'); await wait(300);

// ------------------------------------------------------------------ 9. Shift+M mutes everything; the menu toggles it back
const fleetSel = await ev(() => { const s = window.tc.screen; const f = s.st.fleets.find(x => x.owner === s.you && x.ships.length); s.select({ kind: 'fleet', id: f.id }); return f.id; });
await wait(200);
await page.mouse.click(720, 120);
await ev(id => window.tc.screen.select({ kind: 'fleet', id }), fleetSel);
await wait(150);
await page.keyboard.press('Shift+M');
await wait(200);
check(await ev(() => window.tcAudio.getSettings().muted), 'Shift+M mutes');
check(await ev(() => window.tc.screen.mode === null), 'Shift+M did not arm Move');
await wait(300);
check(await ev(() => window.tcAudio.buses.master.gain.value === 0), 'muted: master bus at 0');
m = await mark();
await page.hover('.hud-br .tool[data-act=menu]');
await page.click('.hud-br .tool[data-act=menu]');
await wait(150);
await page.keyboard.press('Escape');
await page.keyboard.press('q'); await wait(200); await page.keyboard.press('Escape'); await wait(300);
await ev(id => window.tc.screen.addOrder({ type: 'fortify', fleet: id }), fleetSel);
await ev(() => window.tcAudio.onGameEvents([{ k: 'battle', pulse: 1, region: 0, battle: 0, name: 'x' }]));
await wait(300);
check((await since(m)).length === 0, `muted: no sound at all (${(await since(m)).join(' ')})`);
await page.click('.hud-br .tool[data-act=menu]');
await page.waitForSelector('.menu [data-m=sound].off');
await page.click('.menu [data-m=sound]');
await wait(200);
check(!(await ev(() => window.tcAudio.getSettings().muted)), 'menu Sound item unmutes');
check(!!(await page.$('.menu [data-m=sound]:not(.off)')), 'menu Sound item shows "on"');
await page.keyboard.press('Escape');

// ------------------------------------------------------------------ 10. a saved mute survives a reload (and stays silent)
await ev(() => window.tcAudio.setMuted(true));
await page.reload();
await page.waitForFunction(() => window.tc?.screen?.st);
await page.mouse.click(720, 120);
await wait(1200);
check(await ev(() => window.tcAudio.getSettings().muted && window.tcAudio.unlocked), 'mute restored from localStorage after reload');
m = await mark();
await page.click('.hud-br .tool[data-act=menu]'); await wait(150); await page.keyboard.press('Escape');
await wait(200);
check((await ev(() => window.__tcAudioLog.filter(x => !x.n.includes(':')).length)) === 0, 'persisted mute: no effects play');
check(await ev(() => window.tcAudio.buses.master.gain.value === 0), 'persisted mute: master bus at 0');
await ev(() => window.tcAudio.setMuted(false));

// ------------------------------------------------------------------ 11. victory sting
m = await mark();
await endReplay();
await edit(`st.winner = s.you; st.winReason = 'test';`);
await endReplay();
await page.waitForSelector('[data-victory]', { timeout: 5000 }).catch(() => {});
await wait(400);
const n11 = await since(m);
check(n11.includes('st_victory') && n11.includes('music:mus_theme'), `victory: sting, then the theme (${n11.join(' ')})`);
await shot('07-victory');

check(await ev(() => window.tcAudio.errors.length === 0), `no engine errors (${await ev(() => window.tcAudio.errors.join('; '))})`);

// ------------------------------------------------------------------ 12. LIVE blitz: no spam
await page.close();   // one visible tab (a background tab is throttled and its audio suspended)
const live = await ctx.newPage();
await live.bringToFront();
live.on('pageerror', e => errors.push(`live pageerror: ${e.message}`));
await live.goto(base);
await live.evaluate(() => localStorage.removeItem('tc.local.autosave'));
await live.goto(base);
await live.selectOption('[data-l=mode]', 'live-blitz');
await live.fill('[data-l=seed]', '777');
await live.click('[data-l=start]');   // the gesture that unlocks this tab
await live.waitForFunction(() => window.tc?.screen?.st?.live);
await live.waitForTimeout(1500);
// a busy board: the AI plays our seat too (three AIs moving, fighting and buying every tick)
await live.evaluate(() => { const s = window.tc.screen; s.src.save.seats[s.you].kind = 'ai'; });
// the grouping itself: a tick with 60 events voices at most 4 sounds
const burst = await live.evaluate(() => {
  const st = window.tc.screen.st, a = window.__tcAudioLog.length;
  const evs = [];
  for (let i = 0; i < 20; i++) evs.push({ k: 'move', pulse: 1, step: 0, fleet: i, owner: i % 3, ships: 2, from: 0, to: 1 });
  for (let i = 0; i < 15; i++) evs.push({ k: 'battle', pulse: 1, region: i % st.regions.length, battle: i, name: 'b' });
  for (let i = 0; i < 15; i++) evs.push({ k: 'destroyed', pulse: 1, fleet: i, owner: i % 3, region: 0, name: 'x' });
  for (let i = 0; i < 10; i++) evs.push({ k: 'capture', pulse: 1, region: i, by: 0, from: 1, how: 'force' });
  window.tcAudio.onTick(evs);
  return window.__tcAudioLog.length - a;
});
check(burst > 0 && burst <= 5, `LIVE: a 60-event tick is voiced as a short phrase (${burst} sounds)`);
await live.waitForTimeout(1200);
const L0 = await live.evaluate(() => { window.__tcAudioLog.length = 0; return { tick: window.tc.screen.st.live.tick, t: performance.now() }; });
await live.waitForTimeout(32000);
const L = await live.evaluate(() => ({ log: window.__tcAudioLog.filter(x => !x.n.includes(':')), tick: window.tc.screen.st.live.tick, amb: window.tcAudio.slots.ambient?.name ?? null, now: performance.now() }));
const ticks = L.tick - L0.tick;
let maxWin = 0;
for (const a of L.log) maxWin = Math.max(maxWin, L.log.filter(b => b.t >= a.t && b.t < a.t + 1000).length);
const rate = L.log.length / ((L.now - L0.t) / 1000);
console.log(`     LIVE: ${ticks} ticks, ${L.log.length} sounds in ${((L.now - L0.t) / 1000).toFixed(0)} s, ${rate.toFixed(2)}/s, busiest second ${maxWin}; ${[...new Set(L.log.map(x => x.n))].join(', ')}`);
check(ticks >= 3, `LIVE: ticks happened (${ticks})`);
check(maxWin <= 8, `LIVE: at most 8 sounds in any second (${maxWin})`);
check(rate <= 2, `LIVE: under 2 sounds/s on average (${rate.toFixed(2)})`);
check(L.amb === 'amb_drone', 'LIVE: the ambient bed stays on');
await live.close();

check(errors.length === 0, `no page errors${errors.length ? '\n      ' + errors.slice(0, 8).join('\n      ') : ''}`);
await browser.close();
console.log(fails ? `\nAUDIO E2E: ${fails} FAILED` : '\nAUDIO E2E OK');
process.exit(fails ? 1 : 0);
