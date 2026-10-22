// Soul layer phase B through the UI (docs/SOUL.md): founding ritual (full + quick), honour and calling choices,
// vows, the Herald (+ a planted dispatch), retire, raze, limping / scarred fleets on the map, sworn pact words,
// and the end-of-game Saga (copy text, save image). Desktop 1440x900 and iPhone 15 Pro; screenshots of every screen.
// node scripts/soul-e2e.mjs [outdir] [base] [desk|phone]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? '/tmp/claude-0/soul-ui';
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
    : { viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  await page.routeWebSocket(/\?token=/, () => {});   // ignore Vite hot reloads (other files changing mid-run)
  page.on('pageerror', e => errors.push(`${tag}: ${e.message} ${e.stack?.split('\n')[1] ?? ''}`));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${tag}: ${m.text()}`); });
  const shot = n => page.screenshot({ path: `${out}/${tag}-${n}.png` });
  const tap = async sel => { await page.waitForSelector(sel, { timeout: 5000 }); if (phone) await page.tap(sel, { timeout: 5000 }); else await page.click(sel, { timeout: 5000 }); };
  const ev = (fn, arg) => page.evaluate(fn, arg);

  /** Open a card verb (a world's Raise / Improve / Story, a fleet's Orders / Story): on a phone this also opens the full sheet. */
  const verb = async sel => { await page.waitForSelector(sel, { timeout: 15000 }); await ev(sel => document.querySelector(sel)?.click(), sel); await page.waitForTimeout(300); };
  /** Raise into a new banner: step the Into selector until it says so. */
  const intoNew = async () => {
    await verb('.card [data-a=tab][data-t=raise]');
    for (let i = 0; i < 6 && await ev(() => !!document.querySelector('.card [data-a=intonext]') && !/New banner/.test(document.querySelector('.card [data-a=intonext]').textContent)); i++) { await ev(() => document.querySelector('.card [data-a=intonext]').click()); await page.waitForTimeout(150); }
  };
  const plan = () => ev(() => window.tc.screen.plan);
  /** Test-only state edit on the local save, then a fresh view. */
  const edit = (fn, arg) => page.evaluate(([src, a]) => { const s = window.tc.screen; const f = new Function('s', 'st', 'a', src); f(s, s.src.save.state, a); s.src.refresh(); s.onSourceChange('view'); }, [fn, arg]);

  await page.goto(base);
  await ev(() => { localStorage.clear(); localStorage.setItem('tc.tutorial.wego', 'done'); localStorage.setItem('tc.tutorial.live', 'done'); });
  await page.goto(base);
  await page.fill('[data-l=seed]', '4242');
  await page.click('[data-l=start]');
  await page.waitForFunction(() => window.tc?.screen?.st);
  await page.waitForTimeout(1200);
  await shot('01-hud');
  // more banners than a fresh empire has, so the test can found twice
  await edit(`st.rules.soul = { ...st.rules.soul, bannersBase: 6 };`);
  const me = await ev(() => window.tc.screen.you);
  const cap = await ev(() => { const s = window.tc.screen; return s.st.players[s.you].capital; });

  // ---------------------------------------------------------------- founding ritual (build into a new banner)
  await ev(id => { const s = window.tc.screen; s.select({ kind: 'region', id }); s.focus(s.st.regions[id].site); }, cap);
  await page.waitForTimeout(600);
  await intoNew();
  await shot('02-build-into');
  await tap('[data-a=build][data-cls=frigate]');
  await page.waitForSelector('[data-found]');
  await page.waitForTimeout(450);
  await shot('03-founding');
  await tap('[data-f=sigil][data-v=wolf]');
  await tap('[data-f=bane][data-v=hungry]');
  await tap('[data-f=bane][data-v=green]');
  await tap('[data-f=boon][data-v=siegebreakers]');
  await tap('[data-f=vow][data-v=throne]');
  await page.fill('[data-fname]', 'Grey Wolves of Test');
  await page.waitForTimeout(200);
  await shot('04-founding-picked');
  // a boon the balance can't pay for is refused
  check(await ev(() => document.querySelector('[data-f=boon][data-v=longrange]')?.getAttribute('aria-disabled') === 'true'), `${tag}: unaffordable boon is disabled`);
  await tap('[data-f=go]');
  await page.waitForTimeout(400);
  let p = await plan();
  const fb = p.orders.find(o => o?.type === 'build' && o.found);
  check(!!fb && fb.found.sigil === 'wolf' && fb.found.name === 'Grey Wolves of Test' && fb.found.boons?.includes('siegebreakers') && fb.found.banes?.length === 2, `${tag}: founding order carries sigil, name, boons, banes (${JSON.stringify(fb?.found)})`);
  // quick found (defaults)
  await ev(id => { const s = window.tc.screen; s.select({ kind: 'region', id }); }, cap);
  await page.waitForTimeout(300);
  await intoNew();
  await tap('[data-a=build][data-cls=corvette]');
  await page.waitForSelector('[data-found]');
  await tap('[data-f=quick]');
  await page.waitForTimeout(300);
  p = await plan();
  check(p.orders.filter(o => o?.type === 'build' && o.found).length === 2, `${tag}: quick found adds a default founding`);

  // ---------------------------------------------------------------- play a few turns (AI plays our seat), the Herald
  await edit(`s.src.save.seats[s.you].kind = 'ai'; s.plan.orders = s.plan.orders.map(() => null); s.savePlan();`);
  for (let i = 0; i < 9; i++) await ev(() => window.tc.screen.src.advance());
  await edit(`s.src.save.seats[a].kind = 'human'; s.src.save.current = a; s.src.save.reveal = false;`, me);
  await ev(() => { const s = window.tc.screen; if (s.replay) s.endReplay(); });
  await page.waitForTimeout(400);
  // a fresh edition with headlines, plus a rival's dispatch on the page
  await ev(() => { const s = window.tc.screen; s.heraldCheck(); if (!document.querySelector('.herald-ov')) s.openHerald(); });
  await page.waitForSelector('.herald-ov.show', { timeout: 5000 });
  await page.waitForTimeout(700);
  await shot('05-herald');
  check(await ev(() => document.querySelectorAll('.herald .hl').length >= 1), `${tag}: Herald prints headlines`);
  await page.fill('[data-dispatch]', 'The Azure fleet is at the Throne. Do not test us.');
  await tap('[data-h=file]');
  await page.waitForTimeout(300);
  p = await plan();
  check(p.free.some(f => f.type === 'dispatch' && /Throne/.test(f.text)), `${tag}: dispatch filed as a free action`);
  await shot('06-herald-filed');
  await tap('.hb[data-h=close]');
  // its leave animation runs on frames: poll (a loaded machine draws a frame or two a second)
  await page.waitForFunction(() => !document.querySelector('.herald-ov'), null, { timeout: 8000 }).catch(() => {});
  check(!(await ev(() => !!document.querySelector('.herald-ov'))), `${tag}: Herald dismisses to the board`);

  // ---------------------------------------------------------------- honour choice on a fleet
  const fid = await ev(() => { const s = window.tc.screen; return s.st.fleets.filter(f => f.owner === s.you && f.ships.length && f.banner).sort((a, b) => b.ships.length - a.ships.length)[0]?.id; });
  check(fid !== undefined, `${tag}: a bannered fleet exists`);
  await edit(`const f = st.fleets.find(x => x.id === a); f.pendingHonour = { options: ['iron', 'medics'], since: st.turn }; f.commander.rank = Math.max(f.commander.rank, 3);
    f.scars = [{ id: 'burned', turn: st.turn - 1 }]; f.epithets = ['the Unbroken']; f.vow = null;`, fid);
  await ev(id => { const s = window.tc.screen; s.select({ kind: 'fleet', id }); s.focus(s.st.regions[s.fleet(id).region].site); }, fid);
  await page.waitForTimeout(700);
  await shot('07-fleet-honour');
  await tap('[data-a=honour][data-pick=iron]');
  await page.waitForTimeout(250);
  p = await plan();
  check(p.free.some(f => f.type === 'honour' && f.fleet === fid && f.pick === 'iron'), `${tag}: honour picked (free action)`);
  // ---------------------------------------------------------------- splitting warships off raises a banner (founding sheet)
  await edit(`const f = st.fleets.find(x => x.id === a); while (f.ships.length < 3) f.ships.push({ ...structuredClone(f.ships[0]), id: 9000 + f.ships.length, name: 'Split Test ' + f.ships.length, cls: 'frigate' }); st.rules.soul = { ...st.rules.soul, bannersBase: 12 };`, fid);
  await ev(id => { const s = window.tc.screen; s.select({ kind: 'fleet', id }); }, fid);
  await page.waitForTimeout(300);
  await verb('.card [data-a=ftab][data-t=orders]');
  await tap('[data-a=split]');
  await page.waitForSelector('[data-found]', { timeout: 5000 });
  await page.waitForTimeout(350);
  await shot('07b-split-founding');
  await tap('[data-f=go]');
  await page.waitForTimeout(250);
  p = await plan();
  check(p.free.some(f => f.type === 'split' && f.fleet === fid && f.found?.sigil), `${tag}: split founds a banner (free action with found)`);
  await ev(() => { const s = window.tc.screen; s.plan.free = s.plan.free.filter(f => f.type !== 'split'); s.savePlan(); s.renderAll(); });
  // ---------------------------------------------------------------- vow
  await ev(id => { const s = window.tc.screen; s.select({ kind: 'fleet', id }); }, fid);
  await page.waitForTimeout(250);
  await verb('.card [data-a=ftab][data-t=story]');
  await tap('[data-a=vowpick]');
  await page.waitForTimeout(250);
  await shot('08-vow-picker');
  await tap('[data-a=vow][data-k=never_retreat]');
  await page.waitForTimeout(250);
  p = await plan();
  check(p.free.some(f => f.type === 'vow' && f.fleet === fid && f.vow === 'never_retreat'), `${tag}: vow sworn (free action)`);
  // the fleet record (full saga)
  await ev(id => { const s = window.tc.screen; s.select({ kind: 'fleet', id }); }, fid);
  await page.waitForTimeout(200);
  await verb('.card [data-a=ftab][data-t=story]');
  if (await page.$('[data-a=record]')) { await tap('[data-a=record]'); await page.waitForTimeout(400); await shot('09-record'); await page.keyboard.press('Escape'); await page.waitForTimeout(250); }

  // ---------------------------------------------------------------- retire (Storied fleet at an own world)
  await edit(`const f = st.fleets.find(x => x.id === a); f.commander.rank = 4; f.region = st.players[f.owner].capital; f.route = null;`, fid);
  await ev(id => { const s = window.tc.screen; s.select({ kind: 'fleet', id }); s.focus(s.st.regions[s.fleet(id).region].site); }, fid);
  await page.waitForTimeout(500);
  await verb('.card [data-a=ftab][data-t=orders]');
  check(!!(await page.$('[data-a=retire]')), `${tag}: Retire offered to a Storied fleet`);
  if (await ev(() => window.tc.screen.plan.orders.some(o => !o))) {
    await tap('[data-a=retire]');
    await page.waitForTimeout(250);
    p = await plan();
    check(p.orders.some(o => o?.type === 'retire' && o.fleet === fid), `${tag}: retire order queued`);
  }

  // ---------------------------------------------------------------- calling choice, deeds, raze on worlds
  const w = await ev(() => { const s = window.tc.screen, st = s.st; return st.regions.find(r => r.owner === s.you && r.id !== st.players[s.you].capital && r.kind !== 'lane' && r.kind !== 'void')?.id ?? st.players[s.you].capital; });
  await edit(`const r = st.regions[a]; r.story.pendingCalling = { options: ['arsenal', 'cenotaph'], since: st.turn, owner: r.owner };
    r.story.blood = 3; r.story.siege = 1; r.story.loss = 2; r.story.epithet = 'the Bloodied';
    r.story.deeds = [{ id: 'unbroken', turn: st.turn - 2, name: 'Unbroken', by: r.owner }];
    r.story.owners.push({ p: 1, turn: st.turn - 4, how: 'force' }, { p: r.owner, turn: st.turn - 2, how: 'force' });
    r.story.captured = { by: r.owner, from: 1, turn: st.turn };
    const c = st.regions[st.players[r.owner].capital]; c.story.calling = { id: 'arsenal', since: 1 }; c.story.tenureFrom = 1;
    c.story.deeds = [{ id: 'kings_seat', turn: 3, name: 'King’s Seat', by: r.owner, engraved: true }, { id: 'liberated', turn: 4, name: 'Liberated', by: r.owner }];`, w);
  await ev(id => { const s = window.tc.screen; s.select({ kind: 'region', id }); s.focus(s.st.regions[id].site); }, w);
  await page.waitForTimeout(700);
  await shot('10-world-calling');
  await tap('[data-a=calling][data-pick=cenotaph]');
  await page.waitForTimeout(250);
  p = await plan();
  check(p.free.some(f => f.type === 'calling' && f.region === w && f.pick === 'cenotaph'), `${tag}: calling picked (free action)`);
  await ev(id => { const s = window.tc.screen; s.select({ kind: 'region', id }); }, w);
  await page.waitForTimeout(250);
  if (await page.$('[data-a=raze][data-free]')) {
    await tap('[data-a=raze][data-free]');
    await page.waitForTimeout(250);
    p = await plan();
    check(p.free.some(f => f.type === 'raze' && f.region === w), `${tag}: raze right after capture (free action)`);
  } else check(false, `${tag}: raze offered after capture`);
  await ev(id => { const s = window.tc.screen; s.select({ kind: 'region', id }); s.focus(s.st.regions[id].site); }, cap);
  await page.waitForTimeout(700);
  await shot('11-world-capital');

  // ---------------------------------------------------------------- limping + scarred fleets on the map, a blood-debt
  const fid2 = await ev(() => { const s = window.tc.screen; return s.st.fleets.filter(f => f.owner === s.you && f.ships.length && f.banner)[1]?.id ?? null; });
  if (fid2 !== null) {
    await edit(`const f = st.fleets.find(x => x.id === a); f.limping = { since: st.turn, to: st.players[f.owner].capital, by: 1 }; f.scars = [{ id: 'haunted', turn: st.turn }, { id: 'grudge', turn: st.turn, vs: 1 }];
      const nb = st.regions[st.players[f.owner].capital].neighbors.find(n => st.regions[n].kind !== 'lane') ?? f.region; f.region = nb; f.route = { path: [st.players[f.owner].capital], seize: null, mp: 0 };
      (st.soul.debts ??= []).push({ id: 99, turn: st.turn, debtor: 1, creditor: f.owner, killer: 'X', victim: 'Test', fleet: 'Test', region: nb, cleared: null });`, fid2);
    await ev(id => { const s = window.tc.screen; s.deselect(); const f = s.fleet(id); s.map.flyTo(s.st.regions[f.region].site, Math.max(s.map.cam.z, 1.1), 1); }, fid2);
    await page.waitForTimeout(900);
    await shot('12-map-limping');
    await ev(id => { const s = window.tc.screen; s.select({ kind: 'fleet', id }); }, fid2);
    await page.waitForTimeout(500);
    await shot('13-card-limping');
  }
  await ev(() => { const s = window.tc.screen; s.deselect(); s.map.fit(s.st, s.st.regions[s.st.players[s.you].capital].site); });
  await page.waitForTimeout(800);
  await shot('14-map-soul');

  // ---------------------------------------------------------------- sworn pact words (Score modal)
  await ev(() => window.tc.screen.openModal('score'));
  await page.waitForTimeout(500);
  const rival = await ev(() => { const s = window.tc.screen; return s.st.players.find(p => p.id !== s.you && !s.st.pacts.some(x => x.until >= s.st.turn && (x.a === s.you || x.b === s.you) && (x.a === p.id || x.b === p.id)))?.id; });
  await edit(`st.players[1].oathbreaker = [{ turn: Math.max(1, st.turn - 2), victim: 2, words: 'I will not cross the Veil while the Crown stands' }];`);
  await page.waitForTimeout(300);
  if (rival !== undefined && await page.$(`[data-pact-words="${rival}"]`)) {
    await page.fill(`[data-pact-words="${rival}"]`, 'I will not cross the Veil while your Crown stands.');
    await page.click(`[data-a=pact][data-id="${rival}"]`).catch(() => {});
    await page.waitForTimeout(300);
    p = await plan();
    check(p.orders.some(o => o?.type === 'pact' && /Veil/.test(o.words ?? '')), `${tag}: pact offer carries sworn words`);
  } else check(false, `${tag}: pact words input present`);
  await shot('15-score-oaths');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  // Herald from the Chronicle
  await ev(() => window.tc.screen.openModal('chronicle'));
  await page.waitForTimeout(400);
  await shot('16-chronicle');
  await tap('[data-a=herald]');
  await page.waitForSelector('.herald-ov.show');
  check(true, `${tag}: Herald opens from the Chronicle`);
  await tap('.hb[data-h=close]');
  await page.waitForTimeout(300);

  // ---------------------------------------------------------------- a battle in the viewer (header, callouts)
  const bid = await ev(() => { const s = window.tc.screen; const h = s.src.save.history.slice().reverse().find(r => r.battles.length); return h ? [h.turn, h.battles[0].id] : null; });
  if (bid) {
    await ev(([turn, id]) => { const s = window.tc.screen; const r = s.src.save.history.find(h => h.turn === turn); s.startReplay(r); s.openBattle(id); }, bid);
    await page.waitForTimeout(2600);
    await shot('17-battle');
    const hdr = await ev(() => document.querySelector('.bv-title span')?.textContent ?? '');
    check(!/pulse/i.test(hdr), `${tag}: battle header has no pulse (${hdr})`);
    await page.keyboard.press('Escape');
    await ev(() => { const s = window.tc.screen; if (s.replay) s.endReplay(); });
    await page.waitForTimeout(300);
  }

  // ---------------------------------------------------------------- the end: the Saga
  await edit(`s.src.save.seats[s.you].kind = 'ai'; s.src.save.reveal = true;`);
  for (let i = 0; i < 60; i++) { const done = await ev(() => { const s = window.tc.screen; if (s.st.winner !== null) return true; s.src.advance(); return false; }); if (done) break; }
  await ev(() => { const s = window.tc.screen; if (s.replay) s.endReplay(); document.querySelectorAll('.herald-ov').forEach(x => x.remove()); });
  await page.waitForTimeout(500);
  const won = await ev(() => window.tc.screen.st.winner);
  check(won !== null, `${tag}: the game ended (winner ${won})`);
  await ev(() => { const s = window.tc.screen; document.querySelectorAll('[data-victory]').forEach(x => x.closest('.overlay')?.remove()); s.victoryShown = false; s.showVictory(); });
  await page.waitForTimeout(900);
  await shot('18-victory');
  await tap('[data-saga]');
  await page.waitForSelector('.saga-ov.show');
  await page.waitForTimeout(800);
  await shot('19-saga');
  check(await ev(() => document.querySelectorAll('.sg-fleet').length > 0), `${tag}: Saga lists fleet sagas`);
  await ev(() => document.querySelector('.saga-ov').scrollTo(0, 99999));
  await page.waitForTimeout(300);
  await shot('20-saga-end');
  await tap('[data-s=text]');
  await page.waitForTimeout(200);
  await tap('[data-s=image]');
  await page.waitForFunction(() => !!window.__sagaImage, null, { timeout: 8000 }).catch(() => {});
  const img = await ev(() => window.__sagaImage?.length ?? 0);
  check(img > 20000, `${tag}: Saga image rendered (${img} bytes as data URL)`);
  if (img && !phone) {
    const b64 = await ev(() => window.__sagaImage.split(',')[1]);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(`${out}/${tag}-21-saga-image.png`, Buffer.from(b64, 'base64'));
  }
  await ctx.close();
}

if (only !== 'phone') await run('desk', false);
if (only !== 'desk') await run('phone', true);
await browser.close();
console.log(errors.length ? `PAGE ERRORS:\n${errors.join('\n')}` : 'no page errors');
console.log(fails ? `${fails} check(s) FAILED` : 'all checks passed');
process.exit(errors.length || fails ? 1 : 0);
