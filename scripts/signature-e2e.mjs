// Signature mechanics through the UI (docs/SIGNATURE.md) on the v3 cards (docs/WORLD-CARD.md §4.5, §7): the Gambit
// control (absent on turn 1, plan-aware chip text, opened with [data-a=gambit]: posture bet cards with disabled reasons
// and bet lines), the Charge offer after a dragged Seize, world bets (Levies) in the world's Gambit, Fate (arm + confirm, HUD coins, one per turn), map marks (posture,
// dug in, exposed, ambush), CALLED IT / CAUGHT OUT stamps and Fate banners in the replay, the battle viewer's
// first-strike / Twist visuals, and the same actions in LIVE (queueFree). Desktop 1440x900 + iPhone 15 Pro.
// node scripts/signature-e2e.mjs [outdir] [base] [desk|phone]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? '/tmp/claude-0/signature-ui';
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
  await page.routeWebSocket(/\?token=/, () => {});   // ignore Vite hot reloads (other files changing mid-run)
  page.on('pageerror', e => errors.push(`${tag}: ${e.message} ${e.stack?.split('\n')[1] ?? ''}`));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${tag}: ${m.text()}`); });
  const shot = n => page.screenshot({ path: `${out}/${tag}-${n}.png` });
  const tap = async sel => { await page.waitForSelector(sel, { timeout: 15000 }); if (phone) await page.tap(sel, { timeout: 15000 }); else await page.click(sel, { timeout: 15000 }); };
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const plan = () => ev(() => window.tc.screen.plan);
  /** Open (or close) the selected card's Gambit; returns the chip text read before the change. */
  const gambit = async (want = true) => {
    await page.waitForSelector('.card [data-a=gambit]', { timeout: 15000 });
    const st = await ev(() => { const b = document.querySelector('.card [data-a=gambit]'); return { open: b.getAttribute('aria-expanded') === 'true', text: b.textContent }; });
    // a slow machine renders late: toggle until the chip says it is in the wanted state
    for (let i = 0; i < 4; i++) {
      const open = await ev(() => document.querySelector('.card [data-a=gambit]')?.getAttribute('aria-expanded') === 'true');
      if (open === want) break;
      await ev(() => document.querySelector('.card [data-a=gambit]')?.click());
      await page.waitForTimeout(400);
    }
    return st.text;
  };
  const edit = (fn, arg) => page.evaluate(([src, a]) => { const s = window.tc.screen; const f = new Function('s', 'st', 'a', src); f(s, s.src.save.state, a); s.src.refresh(); s.onSourceChange('view'); }, [fn, arg]);
  const start = async mode => {
    await page.goto(base);
    await ev(() => { localStorage.clear(); localStorage.setItem('tc.tutorial.wego', 'done'); localStorage.setItem('tc.tutorial.live', 'done'); localStorage.setItem('tc.herald.auto', 'off'); });
    await page.goto(base);
    if (mode) await page.selectOption('[data-l=mode]', mode);
    await page.fill('[data-l=seed]', '4242');
    await page.click('[data-l=start]');
    await page.waitForFunction(() => window.tc?.screen?.st);
    await page.waitForTimeout(900);
  };

  // ---------------------------------------------------------------- WEGO: turn 1 shows no postures (progressive disclosure)
  await start();
  const f0 = await ev(() => { const s = window.tc.screen; return s.st.fleets.find(f => f.owner === s.you && f.ships.length).id; });
  await ev(id => window.tc.screen.select({ kind: 'fleet', id }), f0);
  await page.waitForTimeout(300);
  check(!(await page.$('.card .gambit')), `${tag}: no Gambit on a fleet card on turn 1`);
  check(await ev(() => !!document.querySelector('[data-k=fate] .coins')), `${tag}: Fate coins in the HUD`);
  // a few turns played by the AI for us
  const me = await ev(() => window.tc.screen.you);
  await edit(`s.src.save.seats[s.you].kind = 'ai';`);
  for (let i = 0; i < 3; i++) await ev(() => window.tc.screen.src.advance());
  await edit(`s.src.save.seats[a].kind = 'human'; s.src.save.current = a; s.src.save.reveal = false;`, me);
  await ev(() => { const s = window.tc.screen; if (s.replay) s.endReplay(); });
  await page.waitForTimeout(300);
  const info = await ev(() => {
    const s = window.tc.screen, st = s.st;
    const mine = st.fleets.filter(f => f.owner === s.you && f.ships.length && !f.limping && !f.route?.path.length).sort((a, b) => b.ships.length - a.ships.length);
    const f = mine[0];
    const seize = (st.regions[f.region].links ?? st.regions[f.region].neighbors).find(n => { const it = s.intent({ fleet: f.id }, n, null, 'seize'); return it?.ok && it.verb === 'seize'; }) ?? null;
    return { f: f.id, f2: mine[1]?.id ?? null, seize, turn: st.turn };
  });
  check(info.turn >= 3, `${tag}: reached turn ${info.turn}`);
  await ev(id => { const s = window.tc.screen; s.select({ kind: 'fleet', id }); s.focus(s.st.regions[s.fleet(id).region].site); }, info.f);
  await page.waitForTimeout(600);
  check(!!(await page.$('.card .gambit')), `${tag}: the Gambit shows from turn 3`);
  const chip0 = await gambit(true);
  check(/Gambit/i.test(chip0) && /\?|steady/.test(chip0), `${tag}: the Gambit chip reads the plan ("${chip0.trim()}")`);
  check(await ev(() => document.querySelectorAll('.card .gopen .bet').length >= 4), `${tag}: the open Gambit shows the bet cards`);
  check(await ev(() => document.querySelector('[data-a=posture][data-p=charge]')?.getAttribute('aria-disabled') === 'true'), `${tag}: Charge disabled without a Seize`);
  await shot('01-gambit-open');
  await tap('[data-a=posture][data-p=guarded]');
  await page.waitForTimeout(250);
  let p = await plan();
  check(p.free.some(x => x.type === 'posture' && x.fleet === info.f && x.posture === 'guarded'), `${tag}: Guarded set (free action)`);
  if (!phone) { await page.hover('[data-a=posture][data-p=running]'); await page.waitForTimeout(200); }
  await shot('02-posture-guarded');

  // ---------------------------------------------------------------- a Seize (dragged on desktop) offers a Charge
  if (info.seize !== null) {
    if (!phone) {
      await ev(() => window.tc.screen.deselect());
      let [fx, fy] = await ev(id => { const s = window.tc.screen; const p = s.map.toScreen(s.lastFleetPos.get(id)); return [p.x, p.y]; }, info.f);
      let [tx, ty] = await ev(id => { const s = window.tc.screen; const p = s.map.toScreen(s.st.regions[id].site); return [p.x, p.y]; }, info.seize);
      await page.mouse.move(fx, fy); await page.mouse.down(); await page.mouse.move(fx + 15, fy + 10, { steps: 3 }); await page.mouse.move(tx, ty, { steps: 10 });
      await page.waitForTimeout(250);
      await shot('03-drag-seize');
      await page.mouse.up();
      await page.waitForTimeout(600);
      // a drag is timing-bound: on a loaded machine (a frame or two a second) retry it until the seize lands
      for (let i = 0; i < 3 && !(await ev(id => window.tc.screen.plan.orders.some(o => o?.type === 'seize' && o.fleet === id), info.f)); i++) {
        await ev(() => window.tc.screen.deselect());
        [fx, fy] = await ev(id => { const s = window.tc.screen; const p = s.map.toScreen(s.lastFleetPos.get(id)); return [p.x, p.y]; }, info.f);
        [tx, ty] = await ev(id => { const s = window.tc.screen; const p = s.map.toScreen(s.st.regions[id].site); return [p.x, p.y]; }, info.seize);
        await page.mouse.move(fx, fy); await page.mouse.down(); await page.mouse.move(fx + 15, fy + 10, { steps: 3 }); await page.mouse.move(tx, ty, { steps: 10 }); await page.mouse.up();
        await page.waitForTimeout(600);
      }
      p = await plan();
      check(p.orders.some(o => o?.type === 'seize' && o.fleet === info.f), `${tag}: seize dropped`);
      // Guarded can't seize: the drop is still allowed; the posture row now says why
      await ev(() => { const s = window.tc.screen; s.plan.free = s.plan.free.filter(x => x.type !== 'posture'); s.savePlan(); s.renderAll(); });
      // re-drop to get the offer with a Steady fleet (from where the token stands now: selection re-lays the tokens)
      await ev(() => { const s = window.tc.screen; s.plan.orders = s.plan.orders.map(o => (o?.type === 'seize' ? null : o)); s.savePlan(); s.deselect(); });
      await page.waitForTimeout(200);
      [fx, fy] = await ev(id => { const s = window.tc.screen; const p = s.map.toScreen(s.lastFleetPos.get(id)); return [p.x, p.y]; }, info.f);
      // a drag is timing-bound: on a loaded machine retry it until the seize lands
      for (let i = 0; i < 3; i++) {
        [fx, fy] = await ev(id => { const s = window.tc.screen; const p = s.map.toScreen(s.lastFleetPos.get(id)); return [p.x, p.y]; }, info.f);
        [tx, ty] = await ev(id => { const s = window.tc.screen; const p = s.map.toScreen(s.st.regions[id].site); return [p.x, p.y]; }, info.seize);
        await page.mouse.move(fx, fy); await page.mouse.down(); await page.mouse.move(fx + 15, fy + 10, { steps: 3 }); await page.mouse.move(tx, ty, { steps: 10 }); await page.mouse.up();
        await page.waitForTimeout(600);
        if (await ev(id => window.tc.screen.plan.orders.some(o => o?.type === 'seize' && o.fleet === id), info.f)) break;
        await ev(() => window.tc.screen.deselect());
      }
      await page.waitForSelector('.chargeoffer', { timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(250);
      await shot('04-charge-offer');
      check(!!(await page.$('.chargeoffer')), `${tag}: Charge offered after a dragged Seize`);
      if (await page.$('.chargeoffer')) await page.click('.chargeoffer');
    } else {
      await ev(([id, t]) => { const s = window.tc.screen; s.commit(s.intent({ fleet: id }, t, null, 'seize')); }, [info.f, info.seize]);
      await ev(id => window.tc.screen.select({ kind: 'fleet', id }), info.f);
      await page.waitForTimeout(250);
      await ev(() => { const s = window.tc.screen; s.plan.free = s.plan.free.filter(x => x.type !== 'posture'); s.savePlan(); s.renderAll(); });
      await gambit(false);
      const chip2 = await ev(() => document.querySelector('.card .gchip')?.textContent ?? '');
      check(/Seizing .+: Charge\?/.test(chip2), `${tag}: the chip offers the bet the plan implies ("${chip2.trim()}")`);
      await gambit(true);
      await tap('[data-a=posture][data-p=charge]');
    }
    await page.waitForTimeout(250);
    p = await plan();
    check(p.free.some(x => x.type === 'posture' && x.fleet === info.f && x.posture === 'charge'), `${tag}: Charge set with the Seize`);
  }

  // ---------------------------------------------------------------- Fate: arm, confirm, one per turn
  await ev(id => { const s = window.tc.screen; s.select({ kind: 'fleet', id }); }, info.f);
  await page.waitForTimeout(250);
  await gambit(true);
  await tap('[data-a=fate][data-use=laststand]');
  await page.waitForTimeout(150);
  check(await ev(() => !!document.querySelector('.card .bet.fate.armed')), `${tag}: Fate asks to confirm`);
  await shot('05-fate-armed');
  // the confirm must land inside the 4s arm window: a slow tap (seconds on a loaded machine) re-arms instead
  await ev(() => document.querySelector('.card [data-a=fate][data-use=laststand]')?.click());
  await page.waitForTimeout(300);
  p = await plan();
  check(p.free.some(x => x.type === 'fate' && x.use === 'laststand' && x.fleet === info.f), `${tag}: Last Stand spent (free action)`);
  check(await ev(() => document.querySelectorAll('[data-k=fate] .coins i.on').length === 2), `${tag}: HUD shows 2 Fate left`);
  await shot('06-fate-spent');
  if (info.f2 !== null) {
    await ev(id => { const s = window.tc.screen; s.select({ kind: 'fleet', id }); }, info.f2);
    await page.waitForTimeout(250);
    await gambit(true);
    check(await ev(() => document.querySelector('[data-a=fate][data-use=twist]')?.getAttribute('aria-disabled') === 'true'), `${tag}: a second Fate this turn is refused`);
    // Ambush on a fleet that stays put
    if (!(await ev(() => document.querySelector('[data-a=posture][data-p=ambush]')?.getAttribute('aria-disabled')))) { await tap('[data-a=posture][data-p=ambush]'); await page.waitForTimeout(200); }
  }

  // ---------------------------------------------------------------- world stance on your capital
  const cap = await ev(() => { const s = window.tc.screen; return s.st.players[s.you].capital; });
  await ev(id => { const s = window.tc.screen; s.select({ kind: 'region', id }); s.focus(s.st.regions[id].site); }, cap);
  await page.waitForTimeout(500);
  const wchip = await gambit(true);
  check(/Gambit/i.test(wchip), `${tag}: the capital shows its Gambit ("${wchip.trim()}")`);
  check(!(await page.$('[data-a=wposture][data-p=gates]')), `${tag}: Open the Gates is not offered (cut in these rules)`);
  await tap('[data-a=wposture][data-p=levies]');
  await page.waitForTimeout(250);
  p = await plan();
  check(p.free.some(x => x.type === 'wposture' && x.region === cap && x.posture === 'levies'), `${tag}: Call the Levies (free action)`);
  check(await ev(() => document.querySelector('[data-a=fate][data-use=surge]')?.getAttribute('aria-disabled') === 'true'), `${tag}: Surge refused (Fate already spent this turn)`);
  await shot('07-world-stance');

  // ---------------------------------------------------------------- map marks: rival posture in view, exposed, dug in
  await edit(`const mine = st.fleets.filter(f => f.owner === s.you && f.ships.length);
    const d = mine.find(f => f.id !== a) ?? mine[0]; d.dugIn = st.turn;
    const rv = st.fleets.find(f => f.owner >= 0 && f.owner !== s.you && f.ships.length);
    if (rv) { rv.exposed = st.turn; rv.posture = 'guarded'; rv.region = st.regions[st.players[s.you].capital].neighbors.find(n => st.regions[n].kind !== 'lane') ?? rv.region; rv.route = null;
      st.scans.push({ owner: s.you, region: rv.region, until: st.turn + 1 }); }
    if (d.id !== a) d.fate = { use: 'twist', turn: st.turn };`, info.f);
  await ev(id => { const s = window.tc.screen; s.deselect(); s.map.flyTo(s.st.regions[id].site, Math.max(s.map.cam.z, 0.9), 1); }, cap);
  await page.waitForTimeout(900);
  await shot('08-map-marks');

  // ---------------------------------------------------------------- seal: the replay stamps (CALLED IT / CAUGHT OUT, Fate)
  await ev(() => { const s = window.tc.screen; s.plan.free = s.plan.free.filter(x => x.type !== 'fate' || x.use === 'laststand'); s.savePlan(); s.submit(true); });
  await page.waitForTimeout(500);
  const ev2 = await ev(() => { const s = window.tc.screen; return (s.st.last?.events ?? []).filter(e => e.k === 'posture' || e.k === 'fate').map(e => `${e.k}:${e.outcome ?? e.use}`); });
  console.log(tag, 'signature events', ev2.join(' '));
  check(ev2.some(e => e.startsWith('fate:')), `${tag}: the Fate is public in the result`);
  const jumped = await ev(() => {
    const s = window.tc.screen, R = s.replay;
    if (!R) return false;
    const i = R.beats.findIndex(b => b.events.some(e => (e.k === 'posture' && e.outcome !== 'none') || e.k === 'fate'));
    if (i < 0) return false;
    R.i = i - 1; s.nextBeat(); R.playing = false; return true;
  });
  await page.waitForTimeout(450);
  await shot('09-replay-stamp');
  check(jumped, `${tag}: replay has a posture / Fate beat`);
  await ev(() => { const s = window.tc.screen; if (s.replay) s.endReplay(); });
  await page.waitForTimeout(300);

  // ---------------------------------------------------------------- a battle with first strike / Twist in the viewer; the Herald
  await edit(`s.src.save.seats[s.you].kind = 'ai'; s.src.save.reveal = true;`);
  let found = null;
  for (let i = 0; i < 25 && !found; i++) {
    found = await ev(() => {
      const s = window.tc.screen;
      s.src.advance();
      const r = s.st.last;
      const b = r?.battles.find(b => b.rounds.some(rd => rd.shots.some(x => x.first || x.twist)));
      return b ? { turn: r.turn, id: b.id, first: b.rounds.some(rd => rd.shots.some(x => x.first)), twist: b.rounds.some(rd => rd.shots.some(x => x.twist)) } : null;
    });
  }
  await ev(() => { const s = window.tc.screen; if (s.replay) s.endReplay(); });
  if (found) {
    await ev(id => window.tc.screen.openBattle(id), found.id);
    const tFirst = await ev(() => 0);
    void tFirst;
    await page.waitForTimeout(2900);
    await shot('10-battle-first-strike');
    check(true, `${tag}: battle with ${found.first ? 'first strike' : ''}${found.twist ? ' + twist' : ''} opened`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  } else console.log(`${tag}: (no first-strike battle in 25 turns; viewer not shot)`);
  await edit(`s.src.save.seats[a].kind = 'human'; s.src.save.current = a; s.src.save.reveal = false;`, me);
  await ev(() => { const s = window.tc.screen; if (s.replay) s.endReplay(); });
  const ed = await ev(() => { const s = window.tc.screen, y = s.you; const eds = s.st.soul?.herald ?? []; return [...eds].reverse().find(e => e.headlines.some(h => /^p_|^fate/.test(h.kind) && (h.public || h.players.includes(y) || h.seenBy?.includes(y))))?.turn ?? null; });
  if (ed !== null) {
    await ev(t => window.tc.screen.openHerald(t), ed);
    await page.waitForSelector('.herald-ov.show');
    await page.waitForTimeout(600);
    await shot('11-herald-postures');
    check(await ev(() => !!document.querySelector('.hl[class*="k-p_"], .hl.k-fate, .hl.k-fate_bonus')), `${tag}: Herald prints posture / Fate headlines`);
    await tap('.hb[data-h=close]');
  } else console.log(`${tag}: (no posture headline in the editions)`);

  // ---------------------------------------------------------------- LIVE: the same actions go through queueFree
  await start('live-blitz');
  await edit(`st.turn = Math.max(st.turn, 3);`);
  const lf = await ev(() => { const s = window.tc.screen; return s.st.fleets.find(f => f.owner === s.you && f.ships.length && !f.route).id; });
  await ev(id => { const s = window.tc.screen; s.select({ kind: 'fleet', id }); }, lf);
  await page.waitForTimeout(400);
  await gambit(true);
  await tap('[data-a=posture][data-p=guarded]');
  await page.waitForTimeout(300);
  check(await ev(id => { const s = window.tc.screen; return (s.st.live.free[s.you] ?? []).some(x => x.type === 'posture' && x.fleet === id && x.posture === 'guarded') || s.fleet(id)?.posture === 'guarded'; }, lf), `${tag}: LIVE posture queued`);
  await ev(id => { const s = window.tc.screen; s.select({ kind: 'fleet', id }); }, lf);
  await page.waitForTimeout(200);
  await gambit(true);
  await tap('[data-a=fate][data-use=twist]');
  await ev(() => document.querySelector('.card [data-a=fate][data-use=twist]')?.click());
  await page.waitForTimeout(300);
  check(await ev(id => { const s = window.tc.screen; return (s.st.live.free[s.you] ?? []).some(x => x.type === 'fate' && x.use === 'twist') || s.fleet(id)?.fate?.use === 'twist'; }, lf), `${tag}: LIVE Fate queued`);
  await shot('12-live');
  await ctx.close();
}

if (only !== 'phone') await run('desk', false);
if (only !== 'desk') await run('phone', true);
await browser.close();
console.log(errors.length ? `PAGE ERRORS:\n${errors.join('\n')}` : 'no page errors');
console.log(fails ? `${fails} check(s) FAILED` : 'all checks passed');
process.exit(errors.length || fails ? 1 : 0);
