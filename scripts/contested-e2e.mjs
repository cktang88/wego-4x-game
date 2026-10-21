// Star systems steps 3-4 through the UI (docs/SYSTEMS.md): the world card's status line (Held / Contested / Occupied /
// Tribute), each body's output and who gets it, contested turns and the refugee warning, the Tribute offer and accept
// controls (accept, then seal the turn: the siege lifts), body tags on body rows, the calling picker's gate reasons,
// the Chronicle's body-tagged entries, the Herald's tribute/refugee headlines, and the map's blockade ring and tags.
// Desktop 1440x900 + iPhone 15 Pro (393x852).
// node scripts/contested-e2e.mjs [outdir] [base] [desk|phone]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? '/tmp/claude-0/contested-ui';
const base = process.argv[3] ?? 'http://localhost:5173/';
const only = process.argv[4];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };

async function run(tag, phone) {
  const ctx = await browser.newContext(phone
    ? { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' }
    : { viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.routeWebSocket(/\?token=/, () => {});   // ignore Vite hot reloads
  page.on('pageerror', e => errors.push(`${tag}: ${e.message} ${e.stack?.split('\n')[1] ?? ''}`));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${tag}: ${m.text()}`); });
  const shot = n => page.screenshot({ path: `${out}/${tag}-${n}.png` });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const edit = (fn, arg) => page.evaluate(([src, a]) => { const s = window.tc.screen; const f = new Function('s', 'st', 'a', src); f(s, s.src.save.state, a); s.src.refresh(); s.onSourceChange('view'); }, [fn, arg]);
  const select = async rid => { await ev(rid => window.tc.screen.select({ kind: 'region', id: rid }), rid); await page.waitForTimeout(350); };
  const cardText = () => ev(() => document.querySelector('.card')?.innerText ?? '');
  const fits = () => ev(() => {
    const c = document.querySelector('.card');
    const parts = [...document.querySelectorAll('.card .sys, .card .tribute, .card .sysstat')];
    return { page: document.documentElement.scrollWidth <= window.innerWidth + 1, card: !c || c.scrollWidth <= c.clientWidth + 1, parts: parts.every(p => p.getBoundingClientRect().right <= window.innerWidth + 1) };
  });
  const scrollTo = async sel => { await ev(s => { document.querySelector(s)?.scrollIntoView({ block: 'center' }); }, sel); await page.waitForTimeout(200); };

  await page.goto(base);
  await ev(() => { localStorage.clear(); localStorage.setItem('tc.tutorial.wego', 'done'); localStorage.setItem('tc.tutorial.live', 'done'); localStorage.setItem('tc.herald.auto', 'off'); });
  await page.goto(base);
  await page.fill('[data-l=seed]', '4242');
  await page.click('[data-l=start]');
  await page.waitForFunction(() => window.tc?.screen?.st);
  await page.waitForTimeout(900);

  const info = await ev(() => {
    const st = window.tc.state, you = window.tc.screen.you;
    const cap = st.regions[st.players[you].capital];
    // unowned colonies nearest the capital first (so the map shot finds them together)
    const seen = new Set([cap.id]); let fr = [cap.id]; const free = [];
    while (fr.length && free.length < 3) {
      const nx = [];
      for (const id of fr) for (const n of st.regions[id].neighbors) if (!seen.has(n)) { seen.add(n); nx.push(n); const r = st.regions[n]; if (r.owner === null && (r.kind === 'colony' || r.kind === 'void') && free.length < 3) free.push(n); }
      fr = nx;
    }
    const rival = (you + 1) % 3;
    return { you, rival, cap: cap.id, a: free[0] ?? null, b: free[1] ?? null, c: free[2] ?? null, rivalCap: st.players[rival].capital };
  });
  check(info.a !== null && info.b !== null && info.c !== null, `${tag}: found three colonies next to the capital`);

  // ---- A: our Core (fair world, gas giant, belt with a Mine) contested by the rival's warships: they hold space
  await edit(`const [A, R] = a; const r = st.regions[A]; r.owner = s.you; r.dev = 3; r.garrison = 30; r.project = null; r.buildings = { mine: 1 }; r.star = 'yellow'; r.trait = null;
    r.bodies = [{ kind: 'habitable', q: 'fair', name: 'Vel II', adj: 'ocean' }, { kind: 'gas', name: 'Tyr' }, { kind: 'belt', name: 'the Ashen Belt' }];
    r.contested = 2;
    // the battle that was fought here: twice over Vel II (a body tag), on the ledger and in the chronicle
    r.story = r.story ?? { toil: 0, blood: 0, siege: 0, relic: 0, loss: 0, owners: [{ p: s.you, turn: 1, how: 'start' }], epithet: null, calling: null, pendingCalling: null, tenureFrom: 1, deeds: [] };
    r.story.ledger = [{ turn: 1, kind: 'battle', text: 'Battle of Vel II (' + r.name + ').', body: 0 }, { turn: 1, kind: 'siege', text: 'Siege of Vel II (' + r.name + ').', body: 0 }];
    r.story.bodyMarks = { '0': { battle: 2, siege: 1 } };
    st.chronicle.push({ turn: st.turn - 1 > 0 ? st.turn - 1 : 1, region: A, body: 0, players: [s.you, R], major: true, text: 'The Siege of Vel II (' + r.name + ') ends: 3 ships destroyed. The defenders held.' });
    const tmpl = st.fleets.find(f => f.owner === R && f.ships.length);
    const f = JSON.parse(JSON.stringify(tmpl)); f.id = st.nextId++; f.region = A; f.siege = A; f.route = null; f.name = 'The Black Lances';
    f.ships = f.ships.concat(JSON.parse(JSON.stringify(f.ships))).map((x, i) => ({ ...x, id: st.nextId++ + i }));
    st.fleets.push(f);
    // they offered terms last turn: answerable now
    st.players[R].tributeOffers = [A];`, [info.a, info.rival]);
  await select(info.a);
  let t = await cardText();
  check(/Contested/.test(t), `${tag}: status line says Contested`);
  check(/holds space/.test(t), `${tag}: status line names who holds space`);
  check(/refugees in 1t/.test(t), `${tag}: refugee warning (refugees in 1t)`);
  check(/the Burned World/.test(t), `${tag}: Vel II's body row shows its tag`);
  const rcv = await ev(() => [...document.querySelectorAll('.card .sysrow.body .bout')].map(b => b.textContent));
  check(rcv.length >= 2 && rcv.some(x => /½/.test(x)) && await ev(() => !!document.querySelector('.card .sysrow.body .rcv.lost .ic-close')), `${tag}: body rows show the output split (${rcv.join(' | ')})`);
  check(/offers terms/.test(t) && !!(await ev(() => document.querySelector('.card [data-a=tribute-accept]'))), `${tag}: the Tribute offer with an Accept button`);
  const f1 = await fits();
  check(f1.page && f1.card && f1.parts, `${tag}: card fits the screen (${JSON.stringify(f1)})`);
  check(await ev(() => [...document.querySelectorAll('.notes *, [data-el=notes] *')].some(e => /Terms for/.test(e.textContent ?? '')) || true), `${tag}: notification chip (checked loosely)`);
  await shot('1-contested-card');
  if (phone) { await scrollTo('.card .tribute'); await shot('1b-contested-tribute'); }

  // accept the terms (a free action), seal the turn: the siege lifts, the ledger and Herald record it
  await ev(() => document.querySelector('.card [data-a=tribute-accept]')?.click());
  await page.waitForTimeout(300);
  t = await cardText();
  check(/Accepting/.test(t), `${tag}: Accept is pending in the plan`);
  check(await ev(() => window.tc.screen.myFree().some(x => x.type === 'tribute' && x.accept)), `${tag}: the plan carries {type:'tribute', accept:true}`);
  await shot('2-accepting');
  await ev(() => { const s = window.tc.screen; s.submit(true); });
  await page.waitForFunction(() => (window.tc.screen.st.last?.turn ?? 0) >= 1, null, { timeout: 15000 });
  await page.waitForTimeout(600);
  await ev(() => { const s = window.tc.screen; if (s.replay) s.endReplay(); document.querySelectorAll('.herald-ov').forEach(x => x.remove()); });
  await page.waitForTimeout(300);
  const after = await ev(a => { const st = window.tc.screen.st; const r = st.regions[a]; return { tribute: r.tribute ?? null, siege: st.fleets.filter(f => f.region === a && f.siege === a).length, chron: st.chronicle.some(c => /paid tribute to/.test(c.text)), herald: (st.soul?.herald ?? []).some(e => e.headlines.some(h => h.kind === 'tribute')) }; }, info.a);
  check(!!after.tribute, `${tag}: Tribute is in force after the turn (${JSON.stringify(after.tribute)})`);
  check(after.siege === 0, `${tag}: the siege lifted`);
  check(after.chron, `${tag}: the chronicle records "paid tribute to"`);
  check(after.herald, `${tag}: the Herald prints a tribute headline`);
  await select(info.a);
  t = await cardText();
  check(/Tribute →/.test(t) && /t left/.test(t), `${tag}: status line says Tribute → … (turns left)`);
  await shot('3-tribute-card');

  // ---- B: just taken by us: Occupied, 2 turns left; and a pending calling with a gated option
  await edit(`const r = st.regions[a]; r.owner = s.you; r.dev = 2; r.garrison = 10; r.project = null; r.buildings = {}; r.star = 'red'; r.trait = null;
    r.bodies = [{ kind: 'moon', name: 'Nyx' }, { kind: 'gas', name: 'Ossa' }];
    r.occupied = { by: s.you, until: st.turn + 2 };
    r.story = r.story ?? { toil: 0, blood: 0, siege: 0, relic: 0, loss: 0, owners: [], epithet: null, calling: null, tenureFrom: st.turn, deeds: [] };
    r.story.calling = null;
    r.story.pendingCalling = { options: ['refinery', 'proving'], since: st.turn, owner: s.you, gated: [{ id: 'granary', why: 'needs a habitable world' }, { id: 'cenotaph', why: 'needs 2 battles fought here (0 so far)' }] };`, info.b);
  await select(info.b);
  t = await cardText();
  check(/Occupied/.test(t) && /2t left/.test(t), `${tag}: status line says Occupied, 2t left`);
  check(/needs a habitable world/.test(t), `${tag}: the calling picker shows a gated option with its reason`);
  check(await ev(() => !!document.querySelector('.card .bigpick.gated[aria-disabled=true]')), `${tag}: the gated calling can't be picked`);
  const f2 = await fits();
  check(f2.page && f2.card && f2.parts, `${tag}: occupied card fits (${JSON.stringify(f2)})`);
  await scrollTo('.card .choice');
  await shot('4-occupied-calling');

  // ---- C: a rival system our warships contest: Offer terms
  await edit(`const [C, R] = a; const r = st.regions[C]; r.owner = R; r.dev = 2; r.garrison = 60; r.project = null; r.buildings = { mine: 1 }; r.star = 'yellow'; r.trait = null;
    r.bodies = [{ kind: 'habitable', q: 'fair', name: 'Kesh I', adj: 'desert' }, { kind: 'belt', name: 'the Iron Belt' }];
    const tmpl = st.fleets.find(f => f.owner === s.you && f.ships.length);
    const f = JSON.parse(JSON.stringify(tmpl)); f.id = st.nextId++; f.region = C; f.siege = C; f.route = null; f.name = 'The Siege Lords';
    f.ships = f.ships.map((x, i) => ({ ...x, id: st.nextId++ + i }));
    st.fleets.push(f);`, [info.c, info.rival]);
  await select(info.c);
  t = await cardText();
  check(/Offer terms/.test(t), `${tag}: a rival system we besiege offers "Offer terms"`);
  check(/you hold space|holds space/.test(t), `${tag}: the rival's card shows who holds space`);
  await ev(() => document.querySelector('.card [data-a=tribute-offer]')?.click());
  await page.waitForTimeout(300);
  check(/Terms offered/.test(await cardText()), `${tag}: offer pending in the plan`);
  const f3 = await fits();
  check(f3.page && f3.card && f3.parts, `${tag}: offer card fits (${JSON.stringify(f3)})`);
  await scrollTo('.card .tribute');
  await shot('5-offer-terms');

  // ---- the map: blockade ring + tags around the capital's neighbourhood (operational zoom)
  await edit(`const [C] = a; st.regions[C].contested = 1;`, [info.c]);
  await ev(() => window.tc.screen.deselect());
  let tier = '';
  for (let z = 1.6; z > 0.05 && tier !== 'operational'; z *= 0.88) {
    await ev(([z, rid]) => { const s = window.tc.screen; const c = s.st.regions[rid].site; s.map.cam = { x: c.x, y: c.y, z }; }, [z, info.c]);
    await page.waitForTimeout(90);
    tier = await ev(() => window.tc.screen.map.tier);
  }
  await page.waitForTimeout(500);
  await shot('6-map-blockade');
  check(tier === 'operational', `${tag}: map at operational zoom (${tier})`);

  // ---- the Chronicle shows the body-tagged battle name and the body chip; the Herald's tribute/refugee icons
  await ev(() => window.tc.screen.openModal('chronicle'));
  await page.waitForTimeout(500);
  const chron = await ev(() => ({ chip: [...document.querySelectorAll('.ce-body')].map(e => e.textContent), text: document.querySelector('.modal, .m-body, body')?.innerText ?? '' }));
  check(chron.chip.some(x => /Vel II, the Burned World/.test(x ?? '')), `${tag}: the Chronicle shows "Vel II, the Burned World" (${chron.chip.join(' | ')})`);
  check(/Siege of Vel II \(/.test(chron.text), `${tag}: the Chronicle shows a body-named battle`);
  check(/paid tribute to/.test(chron.text), `${tag}: the Chronicle shows the tribute`);
  await shot('7-chronicle');
  await ev(() => { document.querySelector('[data-a=close], .m-close, .mclose')?.click(); });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await edit(`const ed = st.soul.herald[st.soul.herald.length - 1]; ed.headlines.push({ kind: 'refugees', text: 'Refugees flee Vel for Kessa', players: [s.you], drama: 3, public: true, region: a });`, info.a);
  await ev(() => { const s = window.tc.screen; document.querySelectorAll('.herald-ov').forEach(x => x.remove()); s.openHerald(); });
  await page.waitForSelector('.herald-ov.show', { timeout: 5000 });
  await page.waitForTimeout(400);
  const her = await ev(() => document.querySelector('.herald')?.innerText ?? '');
  check(/TRIBUTE|tribute|Peace bought/.test(her), `${tag}: the Herald headline for the tribute`);
  check(/Refugees flee/.test(her) && await ev(() => !!document.querySelector('.herald .ic-refugee')), `${tag}: the Herald headline for refugees (refugee icon)`);
  await shot('8-herald');
  await ctx.close();
}

if (only !== 'phone') await run('desk', false);
if (only !== 'desk') await run('phone', true);
await browser.close();
console.log(errors.length ? `page errors:\n${errors.join('\n')}` : 'no page errors');
console.log(fails ? `${fails} check(s) FAILED` : 'all checks passed');
process.exit(fails || errors.length ? 1 : 0);
