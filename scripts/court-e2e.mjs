// The Court through the UI (docs/SOUL.md §4; client/src/hud/court.ts + client/src/court/): constructed states in
// WEGO (solo vs AI, at 1440, iPad landscape and phone), hotseat, online WEGO (two browsers on a real server) and LIVE.
//   - a commander is captured: the captor ransoms, turns or executes (the card face's prompt, its wax seal, the sheet)
//   - the owner pays or refuses the terms (the ransom letter)
//   - the Throne is taken: Kneel or Defy is prompted (face, "to do", the decree opening by itself) and shown on the crests
//   - a human seat is eliminated and uses the whisper panel (local: pending[seat]; online: a submission; LIVE: the queue)
// Every step asserts what the sim or the server received and what the UI shows. The same detector as
// scripts/ux-audit-hud.mjs runs on each court surface (clip, overlap, tap size, font floor, contrast...).
// Online WEGO runs its own game server in this process (a temp data dir); the page's /api and /ws are routed to it.
//   npx tsx scripts/court-e2e.mjs [outdir] [base] [--only=wego,hotseat,online,live]
import { chromium } from 'playwright-core';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { startServer } from '../server/index.ts';

const args = process.argv.slice(2);
const pos = args.filter(a => !a.startsWith('--'));
const out = pos[0] ?? '/tmp/claude-0/court-wired';
const base = pos[1] ?? 'http://localhost:5173/';
const only = args.find(a => a.startsWith('--only='))?.slice(7).split(',');
const want = k => !only || only.includes(k);
const vps = args.find(a => a.startsWith('--vp='))?.slice(5).split(',') ?? ['pc1440', 'ipadL', 'phone'];
mkdirSync(out, { recursive: true });

// the HUD audit's in-page detector, reused as is
const auditSrc = readFileSync(new URL('./ux-audit-hud.mjs', import.meta.url), 'utf8');
const DETECT = auditSrc.slice(auditSrc.indexOf('const DETECT = '), auditSrc.indexOf('// ------------------------------------------------------------------ flows')).replace(/^const DETECT = /, '').trim().replace(/;$/, '');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
let fails = 0, auditTotal = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const VPS = {
  pc1440: { viewport: { width: 1440, height: 900 } },
  ipadL: { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPAD_UA },
  phone: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA },
};
const INIT = () => { try { localStorage.setItem('tc.tutorial.wego', 'done'); localStorage.setItem('tc.tutorial.live', 'done'); localStorage.setItem('tc.herald.auto', 'off'); } catch { /* */ } };

async function newPage(vpTag, tag, opts = {}) {
  const vp = VPS[vpTag];
  const ctx = await browser.newContext(vp);
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  await page.routeWebSocket(/\?token=/, () => {});   // ignore Vite hot reloads (other files change mid-run)
  if (opts.server) await routeToServer(page, opts.server);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  page.on('pageerror', e => errors.push(`${tag}: ${e.message} ${e.stack?.split('\n')[1] ?? ''}`));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|WebSocket/.test(m.text())) errors.push(`${tag}: ${m.text()}`); });
  page.on('dialog', d => d.accept().catch(() => {}));
  const touch = !!vp.hasTouch, phone = vp.viewport.width <= 700;
  const ev = (fn, a) => page.evaluate(fn, a);
  const P = {
    page, ctx, ev, touch, phone, tag,
    shot: n => page.screenshot({ path: `${out}/${tag}-${n}.png` }),
    edit: (src, a) => ev(([src, a]) => { const s = window.tc.screen; new Function('s', 'st', 'a', src)(s, s.src.save.state, a); s.src.refresh(); s.onSourceChange('view'); }, [src, a]),
    click: async sel => { await page.waitForSelector(sel, { timeout: 6000 }); await ev(sel => document.querySelector(sel).click(), sel); await page.waitForTimeout(250); },
    has: sel => ev(sel => !!document.querySelector(sel) && document.querySelector(sel).getClientRects().length > 0, sel),
    text: sel => ev(sel => document.querySelector(sel)?.textContent?.replace(/\s+/g, ' ').trim() ?? '', sel),
    free: () => ev(() => window.tc.screen.myFree()),
    select: rid => ev(id => { const s = window.tc.screen; s.select({ kind: 'region', id }); s.focus(s.st.regions[id].site); }, rid),
    audit: async name => {
      const ui = await ev(() => parseFloat(getComputedStyle(document.documentElement).fontSize) / 16);
      const floor = phone ? 13 : 14 * ui;
      const iss = await page.evaluate(`(${DETECT})(${JSON.stringify({ floor, touch })})`).catch(e => [{ k: 'error', w: String(e.message).split('\n')[0] }]);
      const uniq = [...new Map(iss.map(i => [i.k + i.w, i])).values()];
      auditTotal += uniq.length;
      console.log(`     audit ${tag} ${name}: ${uniq.length}${uniq.length ? '\n       ' + uniq.slice(0, 40).map(i => `${i.k.padEnd(8)} ${i.w}`).join('\n       ') : ''}`);
    },
  };
  return P;
}
async function startLocal(P, opts = {}) {
  const { page } = P;
  await page.goto(base);
  await P.ev(() => { localStorage.removeItem('tc.local.autosave'); for (const k of Object.keys(localStorage)) if (k.startsWith('tc.court.')) localStorage.removeItem(k); });
  await page.goto(base);
  await page.waitForSelector('[data-l=start]');
  if (opts.hotseat) await page.selectOption('[data-l=ai1]', 'human');
  if (opts.mode) await page.selectOption('[data-l=mode]', opts.mode);
  await page.fill('[data-l=seed]', '4242');
  await page.click('[data-l=start]');
  await page.waitForFunction(() => window.tc?.screen?.st);
  await P.ev(() => document.fonts.ready);
  await page.waitForTimeout(900);
}

// ------------------------------------------------------------------ constructed court states (the same in page and server)
// A captive is copied from a real fleet's commander (so the portrait, rank and scars are real data).
const COURT_SETUP = `
  const C = st.court ??= { nextId: 1, captives: [], records: [], coronation: null, kneels: [], decrees: [], paid: [], exiles: [] };
  for (const k of ['captives', 'records', 'kneels', 'decrees', 'paid', 'exiles']) C[k] ??= [];
  const cap = (captor, owner, opts = {}) => {
    const f = st.fleets.find(x => x.owner === owner && x.commander);
    const cmd = JSON.parse(JSON.stringify(f.commander));
    cmd.name = opts.name ?? cmd.name; cmd.rank = opts.rank ?? 3; cmd.alive = true;
    const c = { id: C.nextId++, cmd, owner, captor, fleet: f.name, region: opts.region, turn: st.turn - 1, until: st.turn + 3,
      scars: [{ id: 'burned', turn: st.turn - 2 }], offer: opts.offer ?? null, refused: null, ...(opts.acted !== undefined ? { acted: opts.acted } : {}) };
    C.captives.push(c);
    return c;
  };
  const crown = (holder, answers = {}) => { st.throne.owner = holder; const tr = st.regions.find(r => r.kind === 'throne'); tr.owner = holder; st.soul?.reigns?.push?.({ p: holder, from: st.turn, to: null }); C.coronation = { holder, since: st.turn, until: st.turn + 1, answers }; };
  const exile = p => {
    const pl = st.players[p]; pl.eliminated = true;
    const heir = st.players.find(x => x.id !== p && !x.eliminated).id;
    for (const r of st.regions) if (r.owner === p) r.owner = heir;
    st.fleets = st.fleets.filter(f => f.owner !== p);
    C.exiles.push({ p, since: st.turn, whisper: null, vote: null, tally: [0, 0, 0] });
  };
`;

// ================================================================== WEGO (solo vs AI) at three viewports
async function wegoSolo(vpTag) {
  const P = await newPage(vpTag, `wego-${vpTag}`);
  const { page, ev } = P;
  await startLocal(P);
  const me = await ev(() => window.tc.screen.you);
  // a colony of yours where the prisoners were taken, the Throne, the rivals' commanders
  const where = await ev(() => { const s = window.tc.screen; const cap = s.st.players[s.you].capital; return s.st.regions[cap].neighbors.find(n => s.st.regions[n].kind !== 'lane' && s.st.regions[n].kind !== 'void') ?? cap; });
  const throne = await ev(() => window.tc.screen.st.regions.find(r => r.kind === 'throne').id);
  await P.edit(`${COURT_SETUP}
    st.players[a.me].res.influence = 30; st.players[a.me].res.credits = 60;
    cap(a.me, 1, { region: a.where, name: 'Ines Achterberg', rank: 3 });                                      // you hold Ines
    cap(a.me, 2, { region: a.where, name: 'Odo Marwick', rank: 2 });                                          // and Odo
    cap(1, a.me, { region: a.where, name: 'Theodora Vasquez', rank: 2, acted: st.turn, offer: { res: 'credits', amount: 20, turn: st.turn - 1 } });   // your commander: terms named
    cap(2, a.me, { region: a.where, name: 'Pell Hargreave', rank: 1, acted: st.turn, offer: { res: 'influence', amount: 5, turn: st.turn - 1 } });
    crown(1, { 2: 'defy' });`, { me, where });
  const ids = await ev(() => window.tc.screen.st.court.captives.map(c => c.id));
  const [ines, odo, theo, pell] = ids;

  // ---- the strip's "to do" tab names the prisoner, the terms and the decree
  const todo = await ev(() => { const s = window.tc.screen; return (s.hud.h.strip.querySelector('.stodo')?.getAttribute('aria-label') ?? ''); });
  check(/Prisoner: decide/.test(todo) && /Ransom terms arrived/.test(todo) && /Kneel or Defy/.test(todo), `${P.tag}: to-do tab lists the court nags (${todo})`);
  // tapping it walks to the next one: the first selects the world where they were taken
  await P.click('.stodo');
  check(await ev(w => window.tc.screen.sel?.kind === 'region' && window.tc.screen.sel.id === w, where), `${P.tag}: to-do tab selects the world of the prisoners`);
  await page.waitForTimeout(400);
  check(await P.has('.card .prompt.ct-cap') && await P.has('.card .prompt.ct-ran'), `${P.tag}: card face shows the prisoner and the ransom letter prompts`);
  check(await P.has('.card .prompt.ct-cap img.ct-fport'), `${P.tag}: the prisoner prompt carries the commander's portrait`);
  await P.shot('01-face-captive');
  await P.audit('face-captive');

  // ---- the captor: ransom (credits), then change to turn, then execute with the two-press wax seal
  await P.click(`.card [data-a=ct-ransom][data-id="${ines}"]`);
  let fr = await P.free();
  check(fr.some(x => x.type === 'captive' && x.id === ines && x.act === 'ransom' && x.res === 'credits'), `${P.tag}: Ransom puts {captive, ransom, credits} in the plan`);
  check(/Terms: \d+/.test(await P.text('.card .prompt.ct-cap')), `${P.tag}: the prompt shows the chosen terms`);
  await P.click(`.card [data-a=ct-undo][data-k="cap:${ines}"]`);
  check(!(await P.free()).some(x => x.type === 'captive' && x.id === ines), `${P.tag}: Undo takes it back out`);
  await P.click(`.card [data-a=ct-turn][data-id="${ines}"]`);
  check((await P.free()).some(x => x.type === 'captive' && x.id === ines && x.act === 'turn'), `${P.tag}: Turn puts {captive, turn} in the plan`);
  await P.click(`.card [data-a=ct-undo][data-k="cap:${ines}"]`);
  await P.click(`.card [data-a=ct-exec][data-id="${ines}"]`);
  check(!(await P.free()).some(x => x.type === 'captive' && x.id === ines) && /Press again/.test(await P.text(`.card [data-a=ct-exec][data-id="${ines}"]`)), `${P.tag}: Execute's first press only warms the seal`);
  await P.shot('02-face-exec-armed');
  await P.click(`.card [data-a=ct-exec][data-id="${ines}"]`);
  check((await P.free()).some(x => x.type === 'captive' && x.id === ines && x.act === 'execute'), `${P.tag}: the second press seals {captive, execute}`);
  // Odo: name the terms in influence, from the full captive card in the sheet
  const odoBtn = `.card .prompt.ct-cap [data-a=ct-open][data-k="cap:${odo}"]`;
  await P.click(odoBtn);
  check(await P.has('.overlay.ct-ov .ct-captive') && await P.has('.overlay.ct-ov .ct-captive img.ct-portrait'), `${P.tag}: Details opens the captive card (with its portrait) in a sheet`);
  await P.shot('03-sheet-captive');
  await P.audit('sheet-captive');
  await P.click('.overlay.ct-ov [data-res=influence]');
  await P.click('.overlay.ct-ov [data-act=ransom]');
  check((await P.free()).some(x => x.type === 'captive' && x.id === odo && x.act === 'ransom' && x.res === 'influence'), `${P.tag}: the sheet's Ransom (influence) reaches the plan`);
  check(await P.has('.overlay.ct-ov .ct-chosen'), `${P.tag}: the sheet shows the choice at the seal`);
  await ev(() => document.querySelector('.overlay.ct-ov')?.remove());
  await page.waitForTimeout(300);

  // ---- the owner: pay Theodora's terms (face), refuse Pell's (the letter in the sheet)
  await P.shot('04-face-ransom');
  await P.click(`.card [data-a=ct-pay][data-id="${theo}"]`);
  check((await P.free()).some(x => x.type === 'ransom' && x.id === theo && x.pay === true), `${P.tag}: Pay puts {ransom, pay} in the plan`);
  await P.click(`.card .prompt.ct-ran [data-a=ct-open][data-k="ran:${pell}"]`);
  check(await P.has('.overlay.ct-ov .ct-ransom .ct-letter'), `${P.tag}: the ransom letter opens in a sheet`);
  await P.shot('05-sheet-ransom');
  await P.audit('sheet-ransom');
  await P.click('.overlay.ct-ov [data-act=refuse]');
  check((await P.free()).some(x => x.type === 'ransom' && x.id === pell && x.pay === false), `${P.tag}: Refuse puts {ransom, refuse} in the plan`);
  await ev(() => document.querySelector('.overlay.ct-ov')?.remove());
  await page.waitForTimeout(300);

  // ---- the Throne: the decree on its face, the crests, and the decree opening by itself once
  check(await ev(() => !!document.querySelector('.pcrest[data-crest="1"] .ct-ans.crowned') && !!document.querySelector('.pcrest[data-crest="2"] .ct-ans.defy')), `${P.tag}: crests show the crowned holder and the house that defied`);
  check(/defied/.test(await ev(() => document.querySelector('.pcrest[data-crest="2"]').dataset.tip)), `${P.tag}: the defier's crest tooltip says so`);
  await P.select(throne);
  await page.waitForTimeout(500);
  check(await P.has('.card .prompt.ct-dec [data-a=ct-kneel]') && await P.has('.card .prompt.ct-dec [data-a=ct-defy]'), `${P.tag}: the Throne's face prompts Kneel or Defy`);
  check(/Defies/.test(await P.text('.card .prompt.ct-dec .ct-fans')), `${P.tag}: the face shows the answers so far`);
  await P.shot('06-face-decree');
  await P.audit('face-decree');
  await P.click('.card [data-a=ct-defy]');
  await P.click('.card [data-a=ct-defy]');
  check((await P.free()).some(x => x.type === 'decree' && x.answer === 'defy'), `${P.tag}: Defy (two presses of the wax) reaches the plan`);
  await P.click('.card [data-a=ct-undo][data-k=dec]');
  await P.click('.card [data-a=ct-kneel]');
  fr = await P.free();
  check(fr.some(x => x.type === 'decree' && x.answer === 'kneel') && !fr.some(x => x.type === 'decree' && x.answer === 'defy'), `${P.tag}: Kneel replaces it`);
  await ev(() => window.tc.screen.deselect());
  // the decree opens by itself at the start of a turn (once per coronation), when the Herald is allowed to
  await ev(() => { localStorage.removeItem('tc.herald.auto'); window.tc.screen.heraldCheck(); });
  await page.waitForTimeout(500);
  check(await P.has('.overlay.ct-ov .ct-decree'), `${P.tag}: the decree opens by itself for a new coronation`);
  await P.shot('07-sheet-decree');
  await P.audit('sheet-decree');
  await ev(() => document.querySelector('.overlay.ct-ov')?.remove());
  await ev(() => window.tc.screen.heraldCheck());
  await page.waitForTimeout(300);
  check(!(await P.has('.overlay.ct-ov')), `${P.tag}: ...and only once`);
  await ev(() => { localStorage.setItem('tc.herald.auto', 'off'); document.querySelectorAll('.herald-ov').forEach(x => x.remove()); });
  // the strip's free list names them
  if (!P.phone) {
    await P.click('.strip [data-act=free]');
    const fl = await P.text('.strip .freelist');
    check(/Execute Ines/.test(fl) && /Kneel to/.test(fl), `${P.tag}: the free-changes list names the court choices`);
    await P.shot('08-freelist');
    await P.click('.strip [data-act=free]');
  }

  // ---- seal: the sim applies every choice
  const before = await ev(m => ({ cr: window.tc.save.state.players[m].res.credits, inf: window.tc.save.state.players[m].res.influence }), me);
  await ev(() => window.tc.screen.submit(true));
  await page.waitForFunction(t => window.tc.save.state.turn > t, 1, { timeout: 15000 });
  await ev(() => window.tc.screen.endReplay?.());
  await page.waitForTimeout(600);
  const res = await ev(([m, ids]) => {
    const st = window.tc.save.state, C = st.court;
    const [ines, odo, theo, pell] = ids;
    return {
      executed: C.records.some(r => r.kind === 'executed' && r.captor === m),
      odoOffer: C.captives.find(c => c.id === odo)?.offer ?? null,
      theoHome: !C.captives.some(c => c.id === theo) && C.records.some(r => r.kind === 'ransomed' && r.owner === m),
      pellRefused: C.captives.find(c => c.id === pell)?.refused ?? null,
      knelt: C.coronation?.answers?.[m] ?? null, kneels: C.kneels.some(k => k.p === m),
      cr: st.players[m].res.credits, inf: st.players[m].res.influence, turn: st.turn,
    };
  }, [me, ids]);
  check(res.executed, `${P.tag}: sim executed the prisoner (record)`);
  check(res.odoOffer?.res === 'influence', `${P.tag}: sim named influence terms for the second prisoner (${JSON.stringify(res.odoOffer)})`);
  check(res.theoHome, `${P.tag}: sim ransomed your commander home`);
  check(res.pellRefused === res.turn - 1, `${P.tag}: sim recorded the refusal (${res.pellRefused})`);
  check(res.knelt === 'kneel' && res.kneels, `${P.tag}: sim recorded the kneel`);
  // the UI after the turn: the kneel on your crest, the executed prisoner gone from the face
  await page.waitForTimeout(400);
  check(await ev(m => !!document.querySelector(`.pcrest[data-crest="${m}"] .ct-ans.kneel`) && /knelt to/.test(document.querySelector(`.pcrest[data-crest="${m}"]`).dataset.tip), me), `${P.tag}: your crest shows the kneel`);
  await P.select(where);
  await page.waitForTimeout(400);
  const face = await P.text('.card .wc-face');
  check(!/Ines/.test(face) || !(await P.has(`.card [data-k="cap:${ines}"]`)), `${P.tag}: the executed prisoner is gone from the face`);
  check(/Your terms/.test(face), `${P.tag}: the captor's face shows its terms waiting`);
  await P.shot('09-after-turn');
  await ev(() => window.tc.screen.deselect());

  // ---- exile: your house falls; the whisper panel takes the card slot
  await P.edit(`${COURT_SETUP} exile(a);`, me);
  await page.waitForTimeout(500);
  check(await P.has('.hud .ct-exilecard .ct-whisper'), `${P.tag}: the exile's whisper panel is shown in place of the planning HUD`);
  check(!(await P.has('.hud .strip .slots')), `${P.tag}: no plan strip for the exile`);
  await P.shot('10-exile');
  await P.audit('exile');
  const live = await ev(m => window.tc.save.state.players.filter(p => !p.eliminated && p.id !== m).map(p => p.id), me);
  await P.click(`.ct-exilecard [data-kind=whisper][data-p="${live[0]}"]`);
  await P.click(`.ct-exilecard [data-kind=vote][data-p="${live[1]}"]`);
  const pend = await ev(m => window.tc.save.pending[m], me);
  check(pend?.free?.some(x => x.type === 'exile' && x.whisper === live[0] && x.vote === live[1]), `${P.tag}: local: the exile's choice is stored in pending[seat] (${JSON.stringify(pend)})`);
  check(await P.has('.ct-exilecard .ct-pick.on'), `${P.tag}: the panel marks the picks`);
  await P.shot('11-exile-chosen');
  // the AIs play on (Watch): the next turn resolves with the whisper
  await ev(() => window.tc.screen.src.advance());
  await page.waitForTimeout(800);
  const ex = await ev(m => window.tc.save.state.court.exiles.find(e => e.p === m), me);
  check(ex?.whisper === live[0] && ex?.vote === live[1], `${P.tag}: sim set the whisper and the ghost vote (${JSON.stringify(ex)})`);
  check(await ev(([m, q]) => !!document.querySelector(`.pcrest[data-crest="${m}"] .ct-ans.exile`), [me, live[1]]), `${P.tag}: the exile's crest wears its mark`);
  await P.shot('12-exile-after');
  await P.ctx.close();
}

// ================================================================== hotseat: captor ransoms, owner pays; an exile passes the device
async function hotseat() {
  const P = await newPage('pc1440', 'hotseat');
  const { page, ev } = P;
  await startLocal(P, { hotseat: true });
  const pass = async () => { await page.waitForSelector('.curtain [data-x]', { timeout: 8000 }); await page.click('.curtain [data-x]'); await page.waitForTimeout(500); await ev(() => window.tc.screen.endReplay?.()); };
  const where = await ev(() => window.tc.screen.st.players[0].capital);
  await P.edit(`${COURT_SETUP} st.players[1].res.credits = 80; cap(0, 1, { region: a, name: 'Ines Achterberg', rank: 2 });`, where);
  const id = await ev(() => window.tc.save.state.court.captives[0].id);
  // seat 0: name the terms
  check(await ev(() => window.tc.screen.you) === 0, 'hotseat: seat 0 plans first');
  await P.select(where);
  await page.waitForTimeout(400);
  await P.click(`.card [data-a=ct-ransom][data-id="${id}"]`);
  check((await P.free()).some(x => x.type === 'captive' && x.act === 'ransom'), 'hotseat: seat 0 names the terms');
  await P.shot('01-captor');
  await ev(() => window.tc.screen.submit(true));
  await pass();
  check(await ev(() => window.tc.screen.you) === 1, 'hotseat: seat 1 has the device');
  await ev(() => window.tc.screen.submit(true));
  await page.waitForFunction(() => window.tc.save.state.turn === 2, null, { timeout: 15000 });
  await pass();
  const offer = await ev(i => window.tc.save.state.court.captives.find(c => c.id === i)?.offer, id);
  check(offer?.res === 'credits', `hotseat: sim recorded the terms (${JSON.stringify(offer)})`);
  // turn 2: seat 0 waits; seat 1 pays from the letter
  await ev(() => window.tc.screen.submit(true));
  await pass();
  check(await ev(() => window.tc.screen.you) === 1, 'hotseat: the owner has the device');
  const todo = await ev(() => document.querySelector('.stodo')?.getAttribute('aria-label') ?? '');
  check(/Ransom terms arrived/.test(todo), `hotseat: the owner's to-do tab says the terms arrived (${todo})`);
  await P.click('.stodo');
  await page.waitForTimeout(400);
  check(await P.has(`.card [data-a=ct-pay][data-id="${id}"]`), 'hotseat: the letter prompt is on the face');
  await P.shot('02-owner-letter');
  const before = await ev(() => window.tc.save.state.players.map(p => p.res.credits));
  await P.click(`.card [data-a=ct-pay][data-id="${id}"]`);
  check((await P.free()).some(x => x.type === 'ransom' && x.pay), 'hotseat: the owner pays');
  await ev(() => window.tc.screen.submit(true));
  await page.waitForFunction(() => window.tc.save.state.turn === 3, null, { timeout: 15000 });
  const after = await ev(([i]) => ({ gone: !window.tc.save.state.court.captives.some(c => c.id === i), rec: window.tc.save.state.court.records.find(r => r.kind === 'ransomed') }), [id]);
  check(after.gone && after.rec?.amount === offer.amount && after.rec.owner === 1 && after.rec.captor === 0, `hotseat: sim ransomed the commander home (${JSON.stringify(after.rec)}; credits before ${before})`);
  await pass();
  // seat 1 falls: an exile, it gets the device after the living, whispers, and passes it on
  await P.edit(`${COURT_SETUP} exile(1);`);
  await page.waitForTimeout(300);
  if (await ev(() => window.tc.screen.you) !== 0) { await ev(() => window.tc.screen.submit(true)); await pass(); }
  await ev(() => window.tc.screen.submit(true));
  await pass();
  check(await ev(() => window.tc.screen.you) === 1 && await P.has('.ct-exilecard .ct-whisper'), 'hotseat: the exile gets the device and its whisper panel');
  await P.click('.ct-exilecard [data-kind=whisper][data-p="2"]');
  await P.click('.ct-exilecard [data-kind=vote][data-p="0"]');
  check(await ev(() => window.tc.save.pending[1]?.free?.some(x => x.type === 'exile' && x.whisper === 2 && x.vote === 0)), 'hotseat: the whisper is stored in pending[1]');
  check(await P.has('.ct-exilecard [data-ct=pass]'), 'hotseat: the exile has a Done button to pass the device');
  await P.shot('03-exile');
  await P.audit('exile');
  const t = await ev(() => window.tc.save.state.turn);
  await P.click('.ct-exilecard [data-ct=pass]');
  await page.waitForFunction(t => window.tc.save.state.turn > t, t, { timeout: 15000 });
  const ex = await ev(() => window.tc.save.state.court.exiles.find(e => e.p === 1));
  check(ex?.whisper === 2 && ex?.vote === 0, `hotseat: sim set the exile's whisper and vote (${JSON.stringify(ex)})`);
  check(await ev(() => window.tc.screen.you) === 0, 'hotseat: the next turn starts with the living seat');
  await P.ctx.close();
}

// ================================================================== online WEGO: two browsers, a real server in this process
async function routeToServer(page, port) {
  await page.route('**/api/**', async route => {
    const u = new URL(route.request().url());
    const resp = await route.fetch({ url: `http://localhost:${port}${u.pathname}${u.search}` });
    await route.fulfill({ response: resp });
  });
  await page.routeWebSocket(/\/ws\?game=/, ws => {
    const u = new URL(ws.url());
    const up = new WebSocket(`ws://localhost:${port}/ws${u.search}`);
    const q = [];
    up.on('open', () => { for (const m of q) up.send(m); q.length = 0; });
    up.on('message', d => { try { ws.send(d.toString()); } catch { /* closed */ } });
    up.on('close', () => ws.close().catch(() => {}));
    up.on('error', () => {});
    ws.onMessage(m => (up.readyState === 1 ? up.send(m) : q.push(m)));
    ws.onClose(() => up.close());
  });
}
async function online() {
  const dir = mkdtempSync(join(tmpdir(), 'court-e2e-'));
  const srv = await startServer({ port: 0, dataDir: dir, pushDir: false, tickMs: 60_000 });
  const api = (p, body) => fetch(`http://localhost:${srv.port}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
  try {
    const { id } = await api('/api/games', { name: 'Court e2e', seed: 4242, seats: [{ kind: 'human', name: 'Azure' }, { kind: 'human', name: 'Crimson' }, { kind: 'ai', aiLevel: 'standard' }], league: 'none' });
    const t0 = (await api(`/api/games/${id}/join`, { seat: 0, name: 'Azure' })).token;
    const t1 = (await api(`/api/games/${id}/join`, { seat: 1, name: 'Crimson' })).token;
    const g = srv.store.games.get(id);
    const st = g.state;
    const where = st.players[0].capital;
    new Function('st', 'a', `${COURT_SETUP}
      st.players[0].res.influence = 30; st.players[1].res.credits = 60;
      cap(0, 1, { region: a, name: 'Ines Achterberg', rank: 2 });
      cap(1, 0, { region: a, name: 'Theodora Vasquez', rank: 2, acted: st.turn, offer: { res: 'credits', amount: 20, turn: st.turn - 1 } });
      crown(2, {});`)(st, where);
    srv.store.save(g);
    const [ines, theo] = st.court.captives.map(c => c.id);
    const A = await newPage('pc1440', 'online-a', { server: srv.port });
    const B = await newPage('pc1440', 'online-b', { server: srv.port });
    for (const [P, tk] of [[A, t0], [B, t1]]) {
      await P.page.goto(`${base}#/g/${id}/${tk}`);
      await P.page.waitForFunction(() => window.tc?.screen?.st, null, { timeout: 15000 });
      await P.page.waitForTimeout(900);
    }
    check(await A.ev(() => window.tc.screen.you) === 0 && await B.ev(() => window.tc.screen.you) === 1, 'online: two seats connected');
    // fog: Crimson sees only its own captive's letter, never Azure's prisoner list beyond its commander
    // A: turn Ines (captor), refuse Theodora's terms (owner), defy the crown
    await A.select(where);
    await A.page.waitForTimeout(400);
    await A.click(`.card [data-a=ct-turn][data-id="${ines}"]`);
    await A.click(`.card [data-a=ct-refuse][data-id="${theo}"]`);
    await A.shot('01-face');
    const throne = await A.ev(() => window.tc.screen.st.regions.find(r => r.kind === 'throne').id);
    await A.select(throne);
    await A.page.waitForTimeout(400);
    await A.click('.card [data-a=ct-defy]');
    await A.click('.card [data-a=ct-defy]');
    await A.shot('02-defy');
    // B: kneel (from the to-do tab's Throne)
    check(/Kneel or Defy/.test(await B.ev(() => document.querySelector('.stodo')?.getAttribute('aria-label') ?? '')), 'online: B is asked to Kneel or Defy');
    await B.select(throne);
    await B.page.waitForTimeout(400);
    await B.click('.card [data-a=ct-kneel]');
    await B.shot('01-kneel');
    for (const P of [A, B]) { await P.ev(() => window.tc.screen.submit(true)); await P.page.waitForTimeout(1200); }
    await A.page.waitForFunction(() => window.tc.screen.st.turn === 2, null, { timeout: 15000 });
    const C = srv.store.games.get(id).state.court;
    check(C.records.some(r => r.kind === 'turned' && r.captor === 0), 'online: server applied Turn (record)');
    check(C.captives.find(c => c.id === theo)?.refused === 1, 'online: server applied the refusal');
    check(C.coronation?.answers[0] === 'defy' && C.coronation?.answers[1] === 'kneel', `online: server recorded the answers (${JSON.stringify(C.coronation?.answers)})`);
    await A.ev(() => window.tc.screen.endReplay?.());
    await A.page.waitForTimeout(600);
    check(await A.ev(() => !!document.querySelector('.pcrest[data-crest="0"] .ct-ans.defy') && !!document.querySelector('.pcrest[data-crest="1"] .ct-ans.kneel')), 'online: crests show who defied and who knelt');
    await A.shot('03-crests');
    // Crimson falls between turns: the exile reconnects and whispers; a submission reaches the server
    new Function('st', `${COURT_SETUP} exile(1);`)(srv.store.games.get(id).state);
    srv.store.save(srv.store.games.get(id));
    await B.page.reload();
    await B.page.waitForFunction(() => window.tc?.screen?.st, null, { timeout: 15000 });
    await B.page.waitForTimeout(900);
    check(await B.has('.ct-exilecard .ct-whisper'), 'online: the exile sees the whisper panel');
    await B.click('.ct-exilecard [data-kind=whisper][data-p="2"]');
    await B.page.waitForTimeout(600);
    const pend = srv.store.games.get(id).pending[1];
    check(pend?.free?.some(x => x.type === 'exile' && x.whisper === 2), `online: server received the exile's submission (${JSON.stringify(pend)})`);
    await B.click('.ct-exilecard [data-kind=vote][data-p="0"]');
    await B.page.waitForTimeout(600);
    check(srv.store.games.get(id).pending[1]?.free?.some(x => x.type === 'exile' && x.whisper === 2 && x.vote === 0), 'online: a re-sent whisper replaces the pending one');
    check(await B.has('.ct-exilecard .ct-chosen'), 'online: the panel shows the whisper on its way');
    await B.shot('02-exile');
    await B.audit('exile');
    await A.ev(() => window.tc.screen.submit(true));
    await A.page.waitForFunction(() => window.tc.screen.st.turn === 3, null, { timeout: 15000 });
    const ex = srv.store.games.get(id).state.court.exiles.find(e => e.p === 1);
    check(ex?.whisper === 2 && ex?.vote === 0, `online: server applied the whisper and the ghost vote (${JSON.stringify(ex)})`);
    await A.ctx.close(); await B.ctx.close();
  } finally {
    await srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

// ================================================================== LIVE: the queue takes the choices; the tick applies them
async function liveMode() {
  const P = await newPage('pc1440', 'live');
  const { page, ev } = P;
  await startLocal(P, { mode: 'live-blitz' });
  const where = await ev(() => window.tc.screen.st.players[0].capital);
  await P.edit(`${COURT_SETUP} st.players[0].res.influence = 30; cap(0, 1, { region: a, name: 'Ines Achterberg', rank: 2 }); crown(1, {});`, where);
  const id = await ev(() => window.tc.save.state.court.captives[0].id);
  await P.select(where);
  await page.waitForTimeout(400);
  await P.click(`.card [data-a=ct-ransom][data-id="${id}"]`);
  check(await ev(i => window.tc.save.state.live.free[0]?.some(x => x.type === 'captive' && x.id === i && x.act === 'ransom'), id), 'live: Ransom is queued for the next tick');
  check(!(await P.has('.card [data-a=ct-undo][data-k^=cap]:not([aria-disabled=true])')), 'live: no undo (LIVE has none)');
  const throne = await ev(() => window.tc.screen.st.regions.find(r => r.kind === 'throne').id);
  await P.select(throne);
  await page.waitForTimeout(400);
  await P.click('.card [data-a=ct-defy]');
  await P.click('.card [data-a=ct-defy]');
  check(await ev(() => window.tc.save.state.live.free[0]?.some(x => x.type === 'decree' && x.answer === 'defy')), 'live: Defy is queued');
  await P.shot('01-queued');
  const tick = await ev(() => window.tc.save.state.live.tick);
  await page.waitForFunction(t => window.tc.save.state.live.tick > t, tick, { timeout: 90000 });
  await page.waitForTimeout(500);
  const r = await ev(i => { const C = window.tc.save.state.court; return { offer: C.captives.find(c => c.id === i)?.offer, ans: C.coronation?.answers?.[0] ?? C.decrees.find(d => d.p === 0)?.answer }; }, id);
  check(r.offer?.res === 'credits' && r.ans === 'defy', `live: the tick applied the terms and the defiance (${JSON.stringify(r)})`);
  await ev(() => window.tc.screen.deselect());
  await page.waitForTimeout(300);
  check(await ev(() => !!document.querySelector('.pcrest[data-crest="0"] .ct-ans.defy')), 'live: your crest shows the defiance');
  // exile in LIVE: the panel queues the whisper (queueFree accepts it from an eliminated seat)
  await P.edit(`${COURT_SETUP} exile(0);`);
  await page.waitForTimeout(500);
  check(await P.has('.ct-exilecard .ct-whisper'), 'live: the exile sees the whisper panel');
  await P.click('.ct-exilecard [data-kind=whisper][data-p="1"]');
  check(await ev(() => window.tc.save.state.live.free[0]?.some(x => x.type === 'exile' && x.whisper === 1)), 'live: the whisper is queued');
  await P.shot('02-exile');
  const t2 = await ev(() => window.tc.save.state.live.tick);
  await page.waitForFunction(t => window.tc.save.state.live.tick > t, t2, { timeout: 90000 });
  await page.waitForTimeout(300);
  check(await ev(() => window.tc.save.state.court.exiles.find(e => e.p === 0)?.whisper === 1), 'live: the tick applied the whisper');
  await P.ctx.close();
}

try {
  if (want('wego')) for (const vp of vps) { console.log(`---- WEGO ${vp}`); await wegoSolo(vp); }
  if (want('hotseat')) { console.log('---- hotseat'); await hotseat(); }
  if (want('online')) { console.log('---- online WEGO'); await online(); }
  if (want('live')) { console.log('---- LIVE'); await liveMode(); }
} catch (e) {
  fails++;
  console.log('FAIL (threw)', e.stack ?? e);
}
await browser.close();
console.log(`audit issues on court surfaces: ${auditTotal}`);
console.log(`page errors: ${errors.length ? '\n  ' + errors.join('\n  ') : 0}`);
console.log(fails || errors.length ? `${fails} failed` : 'all passed');
process.exit(fails || errors.length ? 1 : 0);
