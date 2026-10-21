// Star systems through the UI (docs/SYSTEMS.md, steps 1-2): the world card's star header, body chips, role badge,
// citizens x/cap and slots; the develop tray's gate/slot reasons and the waystation discount; the Station tile;
// map marks (the painted stars, citizen pips) at strategic and operational zoom. Desktop 1440x900 + iPhone 15 Pro.
// node scripts/systems-e2e.mjs [outdir] [base] [desk|phone]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? '/tmp/claude-0/systems-ui';
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
  // ignore Vite hot reloads (other files changing mid-run would reload the page)
  await page.routeWebSocket(/\?token=/, () => {});
  page.on('pageerror', e => errors.push(`${tag}: ${e.message} ${e.stack?.split('\n')[1] ?? ''}`));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${tag}: ${m.text()}`); });
  const shot = n => page.screenshot({ path: `${out}/${tag}-${n}.png` });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const edit = (fn, arg) => page.evaluate(([src, a]) => { const s = window.tc.screen; const f = new Function('s', 'st', 'a', src); f(s, s.src.save.state, a); s.src.refresh(); s.onSourceChange('view'); }, [fn, arg]);
  const select = async rid => { await ev(rid => window.tc.screen.select({ kind: 'region', id: rid }), rid); await page.waitForTimeout(350); };
  const cardText = () => ev(() => document.querySelector('.card')?.innerText ?? '');
  const tile = proj => ev(p => { const b = document.querySelector(`.card [data-proj="${p}"]`); return b ? { locked: b.getAttribute('aria-disabled') === 'true', why: b.querySelector('.twhy')?.textContent ?? null, disc: b.querySelector('.tdisc')?.textContent ?? null, cost: b.querySelector('.tcost')?.textContent ?? null } : null; }, proj);
  const fits = () => ev(() => {
    const c = document.querySelector('.card');
    const sys = document.querySelector('.card .sys');
    return { page: document.documentElement.scrollWidth <= window.innerWidth + 1, card: !c || c.scrollWidth <= c.clientWidth + 1, sys: !sys || sys.getBoundingClientRect().right <= window.innerWidth + 1 };
  });

  await page.goto(base);
  await ev(() => { localStorage.clear(); localStorage.setItem('tc.tutorial.wego', 'done'); localStorage.setItem('tc.tutorial.live', 'done'); localStorage.setItem('tc.herald.auto', 'off'); });
  await page.goto(base);
  await page.fill('[data-l=seed]', '4242');
  await page.click('[data-l=start]');
  await page.waitForFunction(() => window.tc?.screen?.st);
  await page.waitForTimeout(900);

  const info = await ev(() => {
    const st = window.tc.state, you = window.tc.screen.you;
    const real = st.regions.filter(r => r.kind !== 'lane');
    return {
      you, cap: st.players[you].capital, starsAll: real.every(r => !!r.star && Array.isArray(r.bodies)), lanesBare: st.regions.filter(r => r.kind === 'lane').every(r => !r.star && !r.bodies),
      hole: real.find(r => r.star === 'blackhole')?.id ?? null,
      nb: st.regions[st.players[you].capital].neighbors.find(n => st.regions[n].owner === null && st.regions[n].kind === 'colony') ?? null,
    };
  });
  check(info.starsAll, `${tag}: every system in the view has a star and bodies`);
  check(info.lanesBare, `${tag}: lane waypoints have no star or bodies`);

  // ---- own capital: star line, 3 body rows, Core badge, citizens 3/5, slots
  await select(info.cap);
  const capTxt = await cardText();
  check(/Yellow dwarf/.test(capTxt), `${tag}: capital card shows its star`);
  check(await ev(() => document.querySelectorAll('.card .syschips .bchip').length === 3), `${tag}: capital card shows 3 body chips`);
  check(/Core/.test(capTxt), `${tag}: role badge Core`);
  check(/3\/5/.test(capTxt) && await ev(() => !!document.querySelector('.card .syscit .ic-citizen')), `${tag}: citizens 3/5`);
  check(/1\/3/.test(capTxt) && /1\/[23]/.test(capTxt) && await ev(() => !!document.querySelector('.card .sysslot .ic-industry') && !!document.querySelector('.card .sysslot .ic-garrison')), `${tag}: civil and military slots used/total`);
  const f1 = await fits();
  check(f1.page && f1.card && f1.sys, `${tag}: card fits the screen (${JSON.stringify(f1)})`);
  await shot('1-capital');
  if (phone) { await ev(() => { const c = document.querySelector('.card'); if (c) c.scrollTop = 1e4; }); await page.waitForTimeout(200); await shot('1b-capital-tray'); }

  // ---- a 1-citizen colony of ours: the Shipyard gate, the waystation discount, the Station tile
  await edit(`const r = st.regions[a]; r.owner = s.you; r.dev = 1; r.garrison = 10; r.project = null; r.buildings = {}; r.star = 'yellow';
    r.bodies = [{ kind: 'habitable', q: 'fair', name: r.name + ' I', adj: 'ocean' }, { kind: 'belt', name: 'the Ashen Belt' }];
    st.players[s.you].res = { industry: 400, credits: 400, influence: 40 };`, info.nb);
  await select(info.nb);
  const yard = await tile('shipyard'), fort = await tile('fortress'), station = await tile('station'), cit = await tile('develop');
  check(!!yard?.locked && /2 citizens or Station/.test(yard.why ?? ''), `${tag}: Shipyard tile says "${yard?.why}"`);
  check(!!fort && !fort.locked && /−30%/.test(fort.disc ?? ''), `${tag}: Fortress tile shows the waystation discount (${fort?.disc})`);
  check(!!station && !station.locked, `${tag}: Station tile offered`);
  check(!!cit && !cit.locked, `${tag}: Citizen (develop) tile open below the cap`);
  check(/military −30%/.test(await cardText()), `${tag}: tray header names the waystation discount`);
  await ev(() => { const t = document.querySelector('.card [data-tray=develop]'); t?.scrollIntoView({ block: 'end' }); });
  await page.waitForTimeout(200);
  await shot('2-waystation-tray');

  // ---- civil slots full: Academy says so; at the cap: Citizen says so
  await edit(`const r = st.regions[a]; r.dev = 4; r.buildings = { mine: 1, tradehub: 1 };`, info.nb);
  await select(info.nb);
  const acad = await tile('academy'), cit2 = await tile('develop');
  check(!!acad?.locked && /no civil slot/.test(acad.why ?? ''), `${tag}: Academy tile says "${acad?.why}"`);
  check(!!cit2?.locked && /at cap/.test(cit2.why ?? ''), `${tag}: Citizen tile at the cap says "${cit2?.why}"`);
  await ev(() => { const t = document.querySelector('.card [data-tray=develop]'); t?.scrollIntoView({ block: 'end' }); });
  await page.waitForTimeout(200);
  await shot('3-slots-full');

  // ---- a foreign system (the black hole, if the map has one in view): star line, no build trays
  if (info.hole !== null) {
    await select(info.hole);
    check(/Black hole/.test(await cardText()), `${tag}: black hole card shows its star and gravity well`);
    await shot('4-black-hole');
  }

  // ---- map marks: operational and strategic zoom around the capital
  await ev(() => window.tc.screen.deselect());
  for (const [n, want] of [['5-map-operational', 'operational'], ['6-map-strategic', 'strategic']]) {
    // zoom out from close in until the map is at the wanted tier
    let tier = '';
    for (let z = 1.6; z > 0.05 && tier !== want; z *= 0.88) {
      await ev(([z, cap]) => { const s = window.tc.screen; const c = s.st.regions[cap].site; s.map.cam = { x: c.x, y: c.y, z }; }, [z, info.cap]);
      await page.waitForTimeout(90);
      tier = await ev(() => window.tc.screen.map.tier);
    }
    await page.waitForTimeout(500);
    await shot(n);
    check(tier === want, `${tag} ${n}: map at ${tier} zoom`);
  }
  await ctx.close();
}

if (only !== 'phone') await run('desk', false);
if (only !== 'desk') await run('phone', true);
await browser.close();
console.log(errors.length ? `page errors:\n${errors.join('\n')}` : 'no page errors');
console.log(fails ? `${fails} check(s) FAILED` : 'all checks passed');
process.exit(fails || errors.length ? 1 : 0);
