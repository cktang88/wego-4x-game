// Render sweep: lane focus (faint lanes, lit on star hover / fleet selection / reach, quiet while dragging) with
// screenshots, plus regression checks for bugs found in the render sweep (battle viewer controls, sprite caches,
// RAF loops after leaving a game, DPR). Exits 1 on any failed check or page error.
// node scripts/sweep-render.mjs [shotsDir=/tmp/claude-0/lanes] [baseUrl]     (needs `npm run dev`)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? '/tmp/claude-0/lanes';
const base = process.argv[3] ?? 'http://localhost:5173/';
const ONLY = process.env.ONLY ?? '';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const fails = [];
const check = (ok, what) => { if (!ok) { fails.push(what); console.log('  FAIL', what); } else console.log('  ok', what); };
const DEVICES = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  big: { viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 },
  phone: {
    viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
};
const frames = (page, n = 3) => page.evaluate(n => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

async function openGame(dev, lobby = 'start', mode) {
  const ctx = await browser.newContext(dev);
  const page = await ctx.newPage();
  await page.routeWebSocket(/\?token=/, () => {});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('tc.tutorial.wego', 'done'); localStorage.setItem('tc.tutorial.live', 'done'); localStorage.setItem('tc.herald.auto', 'off'); });
  await page.reload();
  await page.waitForTimeout(400);
  if (mode) await page.selectOption('[data-l=mode]', mode);
  await page.click(`[data-l=${lobby}]`);
  await page.waitForFunction(() => window.tc?.screen?.map?.fitted);
  await frames(page, 5);
  return { ctx, page, errors };
}

/** Sum of lane-focus brightness (what drawLaneFocus is currently lighting) and the number of lit segments. */
const laneLit = page => page.evaluate(() => { const m = window.tc.screen.map; let s = 0, n = 0; for (const a of m.laneA.values()) { s += a; if (a > 0.3) n++; } return { sum: +s.toFixed(2), n }; });

// ------------------------------------------------------------------ lanes
async function lanes(tag, dev) {
  console.log(`== lanes (${tag})`);
  const { ctx, page, errors } = await openGame(dev);
  const touch = !!dev.hasTouch;
  // a home system and one of your fleets there; frame it at operational zoom
  const info = await page.evaluate(() => {
    const s = window.tc.screen, st = s.st, me = s.you;
    const cap = st.players[me].capital;
    const f = st.fleets.find(x => x.owner === me && x.ships.length) ?? null;
    const m = s.map;
    m.cam.x = st.regions[cap].site.x; m.cam.y = st.regions[cap].site.y - m.h * 0.08 / m.cam.z;
    return { cap, fleet: f?.id ?? null, fleetRegion: f?.region ?? null };
  });
  await page.mouse.move(2, 2); // off the stars
  await page.evaluate(() => { const m = window.tc.screen.map; m.mouse = null; });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${tag}-1-idle.png` });
  const idle = await laneLit(page);
  check(idle.n === 0, `${tag}: idle map lights no lanes (${idle.n})`);

  // star hover (desktop) / star selected (phone)
  if (touch) await page.evaluate(cap => window.tc.screen.select({ kind: 'region', id: cap }), info.cap);
  else {
    const p = await page.evaluate(cap => window.tc.screen.map.screenOfRegion(cap), info.cap);
    await page.mouse.move(p.x, p.y);
  }
  await page.waitForTimeout(60);
  const mid = await laneLit(page);
  await page.waitForTimeout(400);
  const star = await laneLit(page);
  await page.screenshot({ path: `${out}/${tag}-2-star${touch ? '-selected' : '-hover'}.png` });
  check(star.n > 0, `${tag}: star ${touch ? 'selection' : 'hover'} lights its lanes (${star.n})`);
  check(mid.sum < star.sum, `${tag}: lane light eases in (${mid.sum} -> ${star.sum})`);
  if (!touch) {
    // anywhere else inside the region (not on the star) does not count as hovering the star
    const off = await page.evaluate(cap => {
      const m = window.tc.screen.map, r = window.tc.screen.st.regions[cap];
      const c = m.toScreen(r.centroid), s = m.toScreen(r.site);
      // a point inside the region, far from the star
      for (const q of r.poly) { const p = m.toScreen({ x: (q.x * 2 + r.site.x) / 3, y: (q.y * 2 + r.site.y) / 3 }); if (Math.hypot(p.x - s.x, p.y - s.y) > 80 && p.x > 0 && p.y > 0 && p.x < m.w && p.y < m.h) return p; }
      return c;
    }, info.cap);
    await page.mouse.move(off.x, off.y);
    await page.waitForTimeout(400);
    const away = await laneLit(page);
    check(away.n === 0, `${tag}: pointer inside the region but off the star lights nothing (${away.n})`);
  }
  await page.evaluate(() => window.tc.screen.deselect());

  // fleet selected
  if (info.fleet !== null) {
    await page.evaluate(id => window.tc.screen.select({ kind: 'fleet', id }), info.fleet);
    await page.mouse.move(2, 2);
    await page.waitForTimeout(450);
    const fl = await laneLit(page);
    await page.screenshot({ path: `${out}/${tag}-3-fleet-selected.png` });
    check(fl.n > 0, `${tag}: selected fleet lights its reach (${fl.n}) ${fl.n ? "" : JSON.stringify(await page.evaluate(() => ({ sel: window.tc.screen.sel, key: window.tc.screen.map.laneMemo.key })))}`);
    await page.evaluate(() => window.tc.screen.deselect());
    await page.waitForTimeout(300);

    // mid-drag: drag the fleet token toward a neighbour (no lane focus, the preview path stays bright)
    const pts = await page.evaluate(({ id, rid }) => {
      const s = window.tc.screen, m = s.map, st = s.st;
      const r = st.regions[rid];
      const hit = m.tokHits.find(h => h.hit.fleetIds.includes(id));
      const from = hit ? m.toScreen(hit) : m.screenOfRegion(rid);
      const links = (r.links ?? r.neighbors).map(n => st.regions[n]);
      // the far end of the first lane: the next real system
      let n = links[0];
      const seen = new Set([rid]);
      while (n && n.kind === 'lane') { seen.add(n.id); n = (n.links ?? n.neighbors).map(k => st.regions[k]).find(q => !seen.has(q.id)); }
      return { from, to: m.screenOfRegion(n.id) };
    }, { id: info.fleet, rid: info.fleetRegion });
    if (touch) {
      const cdp = await ctx.newCDPSession(page);
      const tp = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: p.x, y: p.y, id: 1 }] });
      await tp('touchStart', pts.from);
      for (let i = 1; i <= 12; i++) { await tp('touchMove', { x: pts.from.x + (pts.to.x - pts.from.x) * i / 12, y: pts.from.y + (pts.to.y - pts.from.y) * i / 12 }); await page.waitForTimeout(16); }
      await page.waitForTimeout(350);
      const dr = await laneLit(page);
      const dragging = await page.evaluate(() => !!window.tc.screen.gest.dragFleet());
      await page.screenshot({ path: `${out}/${tag}-4-mid-drag.png` });
      check(dragging, `${tag}: touch drag started`);
      check(dr.n === 0, `${tag}: no lane focus while dragging (${dr.n})`);
      await tp('touchCancel', pts.to).catch(() => tp('touchEnd', pts.to));
      await tp('touchEnd', pts.to).catch(() => {});
    } else {
      await page.mouse.move(pts.from.x, pts.from.y);
      await page.mouse.down();
      for (let i = 1; i <= 12; i++) { await page.mouse.move(pts.from.x + (pts.to.x - pts.from.x) * i / 12, pts.from.y + (pts.to.y - pts.from.y) * i / 12); await page.waitForTimeout(16); }
      await page.waitForTimeout(350);
      const dr = await laneLit(page);
      const dragging = await page.evaluate(() => !!window.tc.screen.gest.dragFleet());
      await page.screenshot({ path: `${out}/${tag}-4-mid-drag.png` });
      check(dragging, `${tag}: mouse drag started`);
      check(dr.n === 0, `${tag}: no lane focus while dragging (${dr.n})`);
      await page.mouse.up(); // drop: commits the move order
    }
    // fleet with an order: its planned path is lit strongest
    await page.waitForTimeout(300);
    const planned = await page.evaluate(id => {
      const s = window.tc.screen;
      s.select({ kind: 'fleet', id });
      return s.plan.orders.some(o => o && 'fleet' in o && o.fleet === id) || s.plan.orders.some(o => o && Array.isArray(o.fleets) && o.fleets.includes(id));
    }, info.fleet);
    await page.mouse.move(2, 2);
    await page.waitForTimeout(450);
    const pl = await page.evaluate(() => Math.max(0, ...window.tc.screen.map.laneA.values()));
    if (planned) {
      await page.screenshot({ path: `${out}/${tag}-5-fleet-planned.png` });
      check(pl > 0.9, `${tag}: planned path lit at full strength (${pl.toFixed(2)})`);
    } else console.log(`  (${tag}: drag did not leave an order; planned-path check skipped)`);
    await page.evaluate(() => window.tc.screen.deselect());
  }
  // strategic tier: lanes still drawn (faint) and focus still works
  await page.evaluate(() => { const m = window.tc.screen.map; m.cam.z *= 0.35; });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${tag}-6-strategic-idle.png` });
  check(errors.length === 0, `${tag}: no page errors ${JSON.stringify(errors.slice(0, 3))}`);
  await ctx.close();
}

if (!ONLY || ONLY === 'lanes') for (const [tag, dev] of Object.entries({ desktop: DEVICES.desktop, phone: DEVICES.phone })) await lanes(tag, dev);


// ------------------------------------------------------------------ battle viewer (battle-demo page)
/** A report where one side is only a garrison (no ships), the other a small fleet; optionally no rounds at all. */
const garrisonOnly = (rounds = true) => ({
  id: 991, name: 'Siege of Test', turn: 3, region: 12, winner: rounds ? 0 : null, losses: {}, highlights: ['The garrison falls.'],
  sides: [
    { owner: 0, fleets: [{ id: 10, name: 'First Lance', commander: 'Adm. Vance' }], ships: [{ id: 100, name: 'Resolute', cls: 'cruiser', hp: 30, maxHp: 30, fleet: 10 }, { id: 101, name: 'Kestrel', cls: 'frigate', hp: 16, maxHp: 16, fleet: 10 }] },
    { owner: -1, fleets: [], ships: [], garrison: { id: -13, hp: 12, maxHp: 12 } },
  ],
  rounds: rounds ? [
    { shots: [{ from: 100, to: -13, dmg: 5 }, { from: 101, to: -13, dmg: 3 }, { from: -13, to: 101, dmg: 2 }, { from: -13, to: 100, dmg: 0, miss: true }], retreats: [] },
    { shots: [{ from: 100, to: -13, dmg: 6 }, { from: -13, to: 101, dmg: 3 }], retreats: [] },
  ] : [],
});

async function viewer(tag, dev) {
  console.log(`== battle viewer (${tag})`);
  const ctx = await browser.newContext(dev);
  const page = await ctx.newPage();
  await page.routeWebSocket(/\?token=/, () => {});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); }); // the dev page has no favicon
  page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(new URL('battle-demo.html?mode=none', base).href);
  const open = (k, arg) => page.evaluate(([k, arg]) => { const b = window.__bv; b.openBattleViewer(k === 'custom' ? arg : b[k](), b.ctx); }, [k, arg]);
  const state = () => page.evaluate(() => {
    const st = document.querySelector('.bv-stage'), c = st?.querySelector('canvas'), ctrl = document.querySelector('.bv-ctrl');
    const off = [...document.querySelectorAll('.bv-panel button, .bv-round, .bv-bar')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1); }).map(e => e.className + ':' + e.textContent.trim());
    return { cw: st?.clientWidth, ch: st?.clientHeight, w: c?.width, h: c?.height, dpr: Math.min(2, devicePixelRatio), off, round: document.querySelector('.bv-round')?.textContent, play: document.querySelector('.bv-ctrl .bv-btn[title^="Play"]')?.dataset.state, end: getComputedStyle(document.querySelector('.bv-end')).display !== 'none', ctrlH: ctrl?.getBoundingClientRect().height };
  });
  const sizeOk = s => Math.abs(s.w - Math.round(s.cw * s.dpr)) <= 1 && Math.abs(s.h - Math.round(s.ch * s.dpr)) <= 1;
  const clickCenter = async sel => { const b = await page.locator(sel).first().boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.waitForTimeout(70); await page.mouse.up(); };
  for (const k of ['threeWay', 'twoWay']) {
    await open(k);
    await page.waitForTimeout(2600);
    let s = await state();
    check(sizeOk(s), `${tag} ${k}: backing store ${s.w}x${s.h} matches stage ${s.cw}x${s.ch} @${s.dpr}`);
    check(s.off.length === 0, `${tag} ${k}: controls on screen ${JSON.stringify(s.off)}`);
    // real (held) mouse clicks on play/pause toggle it
    const p0 = s.play; await clickCenter('.bv-ctrl .bv-btn[title^="Play"]'); await page.waitForTimeout(60);
    const p1 = (await state()).play; await clickCenter('.bv-ctrl .bv-btn[title^="Play"]'); await page.waitForTimeout(60);
    check(p0 !== p1 && (await state()).play === p0, `${tag} ${k}: held clicks toggle play/pause (${p0} -> ${p1})`);
    // speeds
    for (const v of ['4×', '2×', '1×']) { await page.click(`.bv-speed .bv-btn:text("${v}")`); await page.waitForTimeout(250); }
    check(await page.evaluate(() => document.querySelector('.bv-speed .bv-on')?.textContent) === '1×', `${tag} ${k}: speed buttons`);
    // scrub: drag along the bar
    const bar = await page.locator('.bv-bar').boundingBox();
    await page.mouse.move(bar.x + 2, bar.y + bar.height / 2); await page.mouse.down();
    for (let i = 1; i <= 10; i++) { await page.mouse.move(bar.x + bar.width * i / 10 * 0.6, bar.y + bar.height / 2); await page.waitForTimeout(20); }
    await page.mouse.up();
    const fillW = await page.evaluate(() => parseFloat(document.querySelector('.bv-bar em').style.width));
    check(fillW > 50 && fillW < 70, `${tag} ${k}: scrub moved the playhead (${fillW}%)`);
    // resize mid-battle
    const vp = page.viewportSize();
    await page.setViewportSize({ width: vp.height, height: vp.width }); await page.waitForTimeout(300);
    s = await state();
    check(sizeOk(s), `${tag} ${k}: after rotate backing store ${s.w}x${s.h} matches stage ${s.cw}x${s.ch}`);
    check(s.off.length === 0, `${tag} ${k}: controls on screen after rotate ${JSON.stringify(s.off)}`);
    await page.screenshot({ path: `${out}/bv-${tag}-${k}-rotated.png` });
    await page.setViewportSize(vp); await page.waitForTimeout(300);
    // skip -> end card
    await page.click('.bv-btn[title^="Skip"]'); await page.waitForTimeout(400);
    s = await state();
    check(s.end, `${tag} ${k}: skip shows the end card`);
    const tbl = await page.evaluate(() => { const t = document.querySelector('.bv-end table'), c = document.querySelector('.bv-stage'); const a = t.getBoundingClientRect(), b = c.getBoundingClientRect(); return { l: a.left - b.left, r: b.right - a.right }; });
    check(tbl.l >= 0 && tbl.r >= 0, `${tag} ${k}: end table inside the stage (${tbl.l.toFixed(0)}, ${tbl.r.toFixed(0)})`);
    await page.screenshot({ path: `${out}/bv-${tag}-${k}-end.png` });
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    check(await page.evaluate(() => !document.querySelector('.bv-overlay,.bv-closing')), `${tag} ${k}: closed`);
  }
  for (const [k, rep] of [['garrison-only', garrisonOnly(true)], ['no-rounds', garrisonOnly(false)]]) {
    await open('custom', rep);
    await page.waitForTimeout(2400);
    await page.screenshot({ path: `${out}/bv-${tag}-${k}.png` });
    await page.click('.bv-btn[title^="Skip"]'); await page.waitForTimeout(400);
    const s = await state();
    check(s.end, `${tag} ${k}: end card`);
    await page.screenshot({ path: `${out}/bv-${tag}-${k}-end.png` });
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  }
  check(errors.length === 0, `${tag} viewer: no page errors ${JSON.stringify(errors.slice(0, 3))}`);
  await ctx.close();
}
if (!ONLY || ONLY === 'viewer') for (const [tag, dev] of Object.entries(DEVICES)) await viewer(tag, dev);


// ------------------------------------------------------------------ zoom soak: sprite caches and heap stay bounded
async function soak(tag, dev) {
  console.log(`== zoom soak (${tag})`);
  const { ctx, page, errors } = await openGame(dev);
  const cdp = await ctx.newCDPSession(page);
  await page.evaluate(() => { const o = document.createElement.bind(document); window.__cv = 0; document.createElement = (t, ...a) => { if (String(t).toLowerCase() === 'canvas') window.__cv++; return o(t, ...a); }; });
  const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); return (await cdp.send('Runtime.getHeapUsage')).usedSize / 1e6; };
  const cycle = () => page.evaluate(() => new Promise(res => {
    const m = window.tc.screen.map, st = window.tc.screen.st;
    const caps = st.players.map(p => st.regions[p.capital].site);
    let k = 0; const N = 160;
    const step = () => {
      const t = k / N, z = 0.12 * Math.pow(25, 0.5 - 0.5 * Math.cos(t * Math.PI * 2));
      const c = caps[Math.floor(t * caps.length) % caps.length];
      m.cam.z = z; m.cam.x = c.x + Math.sin(t * 9) * 300; m.cam.y = c.y + Math.cos(t * 7) * 300;
      if (++k < N) requestAnimationFrame(step); else res();
    };
    requestAnimationFrame(step);
  }));
  const h0 = await heap(); const per = [];
  for (let i = 0; i < 8; i++) { const a = await page.evaluate(() => window.__cv); await cycle(); await page.waitForTimeout(500); per.push((await page.evaluate(() => window.__cv)) - a); }
  const h1 = await heap();
  console.log(`  ${tag} canvases created per zoom cycle ${JSON.stringify(per)}; heap ${h0.toFixed(1)} -> ${h1.toFixed(1)} MB`);
  check(per.slice(4).reduce((a, b) => a + b, 0) <= per.slice(0, 2).reduce((a, b) => a + b, 0) + 40, `${tag}: sprite creation settles after warm-up`);
  check(h1 - h0 < 25, `${tag}: heap growth over 8 zoom cycles ${(h1 - h0).toFixed(1)} MB`);
  // leaving the game stops every map RAF loop and listener-driven redraw
  await page.evaluate(() => { const o = window.requestAnimationFrame.bind(window); window.__raf = 0; window.requestAnimationFrame = cb => { window.__raf++; return o(cb); }; });
  const rate = async () => { const a = await page.evaluate(() => window.__raf); await page.waitForTimeout(1000); return (await page.evaluate(() => window.__raf)) - a; };
  const inGame = await rate();
  await page.evaluate(() => window.tc.screen.onExit());
  await page.waitForTimeout(500);
  const after = await rate();
  console.log(`  ${tag} rAF/s in game ${inGame}, after leaving ${after}`);
  check(after <= 2, `${tag}: no rAF loop left after leaving the game (${after}/s)`);
  check(errors.length === 0, `${tag} soak: no page errors ${JSON.stringify(errors.slice(0, 3))}`);
  await ctx.close();
}
if (!ONLY || ONLY === 'soak') for (const tag of ['desktop', 'phone']) await soak(tag, DEVICES[tag]);


// ------------------------------------------------------------------ real clicks on tokens and stars (uiScale, DPR)
async function clicks(tag, dev) {
  console.log(`== clicks (${tag})`);
  const { ctx, page, errors } = await openGame(dev);
  const ui = await page.evaluate(() => ({ ui: window.tc.screen.map.ui, dpr: window.tc.screen.map.dpr, cw: window.tc.screen.map.canvas.width, w: window.tc.screen.map.w }));
  console.log(`  ${tag} ui=${ui.ui} dpr=${ui.dpr} canvas ${ui.cw} for ${ui.w} css px`);
  check(Math.abs(ui.cw - Math.round(ui.w * ui.dpr)) <= 1, `${tag}: map backing store matches css size x dpr`);
  for (const z of ['strategic', 'operational', 'detail']) {
    await page.evaluate(z => { const s = window.tc.screen, m = s.map, st = s.st; const cap = st.regions[st.players[s.you].capital]; m.cam.x = cap.site.x; m.cam.y = cap.site.y; m.cam.z = z === 'strategic' ? 0.15 : z === 'operational' ? 0.5 : 1.6; s.deselect(); }, z);
    await page.waitForTimeout(400);
    const tier = await page.evaluate(() => window.tc.screen.map.tier);
    // your fleet tokens: click the drawn centre
    const toks = await page.evaluate(() => { const m = window.tc.screen.map, you = window.tc.screen.you; return m.tokHits.filter(h => h.hit.owner === you).map(h => ({ p: m.toScreen(h), ids: h.hit.fleetIds })).filter(t => t.p.x > 30 && t.p.y > 80 && t.p.x < m.w - 30 && t.p.y < m.h - 120); });
    let bad = [];
    for (const t of toks.slice(0, 4)) {
      await page.evaluate(() => window.tc.screen.deselect());
      if (dev.hasTouch) await page.touchscreen.tap(t.p.x, t.p.y); else await page.mouse.click(t.p.x, t.p.y);
      await page.waitForTimeout(150);
      const sel = await page.evaluate(() => window.tc.screen.sel);
      if (!(sel?.kind === 'fleet' && t.ids.includes(sel.id))) bad.push(`${t.ids}->${JSON.stringify(sel)}`);
      await page.keyboard.press('Escape');
    }
    check(bad.length === 0, `${tag} ${tier}: clicking ${toks.slice(0, 4).length} fleet token(s) selects them ${bad.join('; ')}`);
    // stars: click a few system sites that no token / banner covers
    const stars = await page.evaluate(() => { const s = window.tc.screen, m = s.map; return s.st.regions.filter(r => r.kind !== 'lane' && r.kind !== 'void' && r.poly.length > 2).map(r => ({ id: r.id, p: m.toScreen(r.site) })).filter(o => o.p.x > 40 && o.p.y > 90 && o.p.x < m.w - 40 && o.p.y < m.h - 140 && !m.tokenAt(o.p.x, o.p.y)).slice(0, 4); });
    bad = [];
    for (const o0 of stars) {
      // a phone selection flies the camera (clears the bottom sheet): re-aim after it settles
      await page.evaluate(() => window.tc.screen.deselect());
      await page.waitForFunction(() => !window.tc.screen.map.flying);
      await page.waitForTimeout(200);
      const o = await page.evaluate(id => { const m = window.tc.screen.map; const p = m.screenOfRegion(id); const ok = p.x > 30 && p.y > 90 && p.x < m.w - 30 && p.y < m.h - 140 && !m.tokenAt(p.x, p.y) && !document.elementsFromPoint(p.x, p.y)[0]?.closest('.card,.sheet,.hud,.panel'); return { id, p, ok, top: document.elementFromPoint(p.x, p.y)?.tagName }; }, o0.id);
      if (!o.ok || o.top !== 'CANVAS') continue;
      if (dev.hasTouch) await page.touchscreen.tap(o.p.x, o.p.y); else await page.mouse.click(o.p.x, o.p.y);
      await page.waitForTimeout(150);
      const sel = await page.evaluate(() => window.tc.screen.sel);
      if (!(sel?.kind === 'region' && sel.id === o.id)) bad.push(`${o.id}->${JSON.stringify(sel)}`);
    }
    check(bad.length === 0, `${tag} ${tier}: clicking ${stars.length} star(s) selects their system ${bad.join('; ')}`);
    await page.screenshot({ path: `${out}/clicks-${tag}-${tier}.png` });
  }
  check(errors.length === 0, `${tag} clicks: no page errors ${JSON.stringify(errors.slice(0, 3))}`);
  await ctx.close();
}
if (!ONLY || ONLY === 'clicks') for (const [tag, dev] of Object.entries(DEVICES)) await clicks(tag, dev);


// ------------------------------------------------------------------ hotseat: the map's fog memory is per seat
async function hotseat() {
  console.log('== hotseat fog memory');
  const ctx = await browser.newContext(DEVICES.desktop);
  const page = await ctx.newPage();
  await page.routeWebSocket(/\?token=/, () => {});
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(base);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('tc.tutorial.wego', 'done'); localStorage.setItem('tc.herald.auto', 'off'); });
  await page.reload(); await page.waitForTimeout(400);
  await page.selectOption('[data-l=ai1]', 'human');
  await page.click('[data-l=start]');
  await page.waitForFunction(() => window.tc?.screen?.map?.fitted);
  await page.waitForTimeout(400);
  if (await page.locator('.curtain [data-x]').count()) await page.click('.curtain [data-x]');
  await page.waitForTimeout(300);
  await page.evaluate(() => window.tc.screen.submit(true));
  await page.waitForSelector('.curtain [data-x]');
  await page.click('.curtain [data-x]');
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const s = window.tc.screen, m = s.map, h = s.st.players[0].capital, reg = s.st.regions[h];
    const I = { you: s.you, visible: s.visibleSet(), owners: s.st.regions.map(x => x.owner) };
    return { you: s.you, vis: I.visible.has(h), txt: m.garrisonText(reg, I).txt };
  });
  check(r.you === 1 && (r.vis || r.txt === '?'), `hotseat: seat 2 does not see seat 1's capital garrison from seat 1's view (${JSON.stringify(r)})`);
  check(errors.length === 0, `hotseat: no page errors ${JSON.stringify(errors.slice(0, 3))}`);
  await ctx.close();
}
if (!ONLY || ONLY === 'hotseat') await hotseat();

await browser.close();
console.log(fails.length ? `\n${fails.length} check(s) failed` : '\nall sweep-render checks passed');
process.exit(fails.length ? 1 : 0);
