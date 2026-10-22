// Star systems through the world card v3 (docs/SYSTEMS.md steps 1-2, docs/WORLD-CARD.md §8.7): the painted diorama
// (one tappable body per body: .wc-art .bd), the system line, the role crest, the citizen pips (.wc-cit), the Improve
// tracks (.trk) with their reasons inline (the Yard gate as the Yard track's .go.why, the waystation discount as
// .go .disc), the simplified world's rules (no Station member, the Works sites as the cap), and the map marks at
// strategic and operational zoom. Desktop 1440x900 + iPhone 15 Pro.
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
  const tab = async t => { await ev(t => document.querySelector(`.card [data-a=tab][data-t=${t}]`)?.click(), t); await page.waitForTimeout(250); };
  const cardText = () => ev(() => document.querySelector('.card')?.innerText ?? '');
  /** One Improve track row: its level pips, its button's label, reason, discount. */
  const track = t => ev(t => {
    const row = [...document.querySelectorAll('.card .trk')].find(x => x.querySelector(`[data-track="${t}"]`));
    const go = row?.querySelector('.go');
    return row ? { on: row.querySelectorAll('.lv i.on').length, of: row.querySelectorAll('.lv i').length, why: go?.classList.contains('why') ? go.textContent.trim() : null, label: go?.querySelector('b')?.textContent ?? '', disc: go?.querySelector('.disc')?.textContent ?? null, struck: !!go?.querySelector('s') } : null;
  }, t);
  const fits = () => ev(() => {
    const c = document.querySelector('.card');
    const r = c?.getBoundingClientRect();
    return { page: document.documentElement.scrollWidth <= window.innerWidth + 1, card: !c || c.scrollWidth <= c.clientWidth + 1, inView: !r || (r.left >= 0 && r.right <= window.innerWidth + 1 && r.top >= 0 && r.bottom <= window.innerHeight + 1) };
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
      hole: real.find(r => r.star === 'blackhole')?.id ?? null, world: st.rules.world?.enabled === true,
      nb: st.regions[st.players[you].capital].neighbors.find(n => st.regions[n].owner === null && st.regions[n].kind === 'colony') ?? null,
    };
  });
  check(info.starsAll, `${tag}: every system in the view has a star and bodies`);
  check(info.lanesBare, `${tag}: lane waypoints have no star or bodies`);
  check(info.world, `${tag}: a new game plays the simplified world (rules.world on)`);

  // ---- own capital: the diorama (3 bodies), the system line, the Core crest, citizens 3 of 5, the four tracks
  await select(info.cap);
  const capTxt = await cardText();
  check(/Yellow sun/.test(capTxt), `${tag}: the capital's system line names its star`);
  check(await ev(() => document.querySelectorAll('.card .wc-art .bd').length === 3), `${tag}: the diorama shows 3 bodies`);
  check(await ev(() => [...document.querySelectorAll('.card .wc-art canvas[data-art]')].every(c => c.dataset.painted)), `${tag}: the diorama is painted`);
  check(/core/i.test(await ev(() => document.querySelector('.card .wc-crest')?.textContent ?? '')) && await ev(() => document.querySelector('.card')?.dataset.role === 'core'), `${tag}: the role is the frame (Core) and the crest`);
  check(await ev(() => document.querySelectorAll('.card .wc-cit i').length === 5 && document.querySelectorAll('.card .wc-cit i.on').length === 3), `${tag}: citizen pips 3 of 5`);
  check(await ev(() => document.querySelectorAll('.card .wc-tabs [data-a=tab]').length === 3), `${tag}: three verbs`);
  const f1 = await fits();
  check(f1.page && f1.card && f1.inView, `${tag}: card fits the screen (${JSON.stringify(f1)})`);
  await shot('1-capital');
  await tab('improve');
  check(await ev(() => document.querySelectorAll('.card .trk').length === 5), `${tag}: Improve: citizens + four track rows`);
  check(/grow by themselves/.test(await cardText()), `${tag}: a Core's citizens grow by themselves (no button)`);
  await shot('1b-capital-improve');
  // a peek: hover (desk) or tap (phone) a body
  if (phone) await page.tap('.card .wc-art .bd'); else await page.hover('.card .wc-art .bd');
  await page.waitForTimeout(250);
  check(await ev(() => !!document.querySelector('.cardpeek.on') && /·/.test(document.querySelector('.cardpeek')?.textContent ?? '')), `${tag}: a body peeks at what it is`);
  await shot('1c-body-peek');
  if (phone) await page.tap('.card .wc-art .bd'); else await page.mouse.move(5, 450);

  // ---- a 1-citizen colony of ours: the Yard gate on the Yard track, the waystation discount, no Station
  await edit(`const r = st.regions[a]; r.owner = s.you; r.dev = 1; r.garrison = 10; r.project = null; r.buildings = {}; r.star = 'yellow';
    r.bodies = [{ kind: 'habitable', q: 'poor', name: r.name + ' I', adj: 'arid' }, { kind: 'belt', name: 'the Ashen Belt' }];
    st.players[s.you].res = { industry: 400, credits: 400, influence: 40 };`, info.nb);
  await select(info.nb);
  await tab('improve');
  const yard = await track('yard'), walls = await track('walls');
  check(!!yard?.why && /needs\s*2 citizens/.test(yard.why), `${tag}: the Yard track says "${yard?.why}"`);
  check(!!walls && !walls.why && /−30%/.test(walls.disc ?? '') && walls.struck, `${tag}: Walls shows the waystation discount (${walls?.disc}, struck price)`);
  await ev(() => document.querySelector('.card .trk [data-a=trkx][data-track=works]')?.click());
  await page.waitForTimeout(250);
  const mem = await ev(() => [...document.querySelectorAll('.card .members .mem')].map(m => m.dataset.proj));
  check(mem.includes('develop') && !mem.includes('station'), `${tag}: Works members: +1 citizen offered, no Station (${mem.join(',')})`);
  await shot('2-waystation-improve');
  await tab('raise');
  check(/No yard here/.test(await cardText()) && await ev(() => !!document.querySelector('.card .wc-tabs [data-t=raise].off')), `${tag}: Raise without a yard stays in its slot and teaches`);
  await shot('2b-no-yard');

  // ---- the Works sites full: Academy says so; at the cap: Citizen says so
  await edit(`const r = st.regions[a]; r.dev = 4; r.bodies[0].q = 'fair'; r.buildings = { mine: 1, tradehub: 1 };`, info.nb);
  await select(info.nb);
  await tab('improve');
  const ws = await track('works');
  check(!!ws && ws.on === 2 && ws.of === 2, `${tag}: Works pips: 2 of 2 sites (${JSON.stringify(ws)})`);
  await ev(() => { if (!document.querySelector('.card .members')) document.querySelector('.card .trk [data-a=trkx][data-track=works]')?.click(); });
  await page.waitForTimeout(250);
  const acad = await ev(() => document.querySelector('.card .members .mem[data-proj=academy]')?.textContent ?? '');
  check(/no site left/.test(acad), `${tag}: Academy says "${acad.trim()}"`);
  await shot('3-works-full');

  // ---- a foreign system (the black hole, if the map has one in view): system line, no verbs
  if (info.hole !== null) {
    await select(info.hole);
    check(/Black hole/.test(await cardText()) && !(await page.$('.card .wc-tabs')), `${tag}: a foreign card: the black hole, read-only`);
    await shot('4-black-hole');
  }

  // ---- map marks: operational and strategic zoom around the capital
  await ev(() => window.tc.screen.deselect());
  for (const [n, want] of [['5-map-operational', 'operational'], ['6-map-strategic', 'strategic']]) {
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
