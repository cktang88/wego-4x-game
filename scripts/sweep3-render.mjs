// Render sweep 3: the WebGL stage (context loss/restore, quality tiers mid-game, ?gl=0, DPR, GPU memory), the map
// (crossfades, zoomAt, tooltips, fleet placement, names, enamel hatching, lane focus, pan perf) and the battle viewer
// (decisive slow-mo, crowded / 3-way / garrison-only battles, speeds, scrubbing, phone landscape).
// node scripts/sweep3-render.mjs [shotsDir=/tmp/claude-0/s3] [baseUrl]   (needs `npm run dev`); ONLY=gl|map|bv
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? '/tmp/claude-0/s3';
const base = process.argv[3] ?? 'http://localhost:5173/';
const ONLY = process.env.ONLY ?? '';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
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

async function openGame(dev, { gfx = 'high', query = '', lobby = 'start', init = null } = {}) {
  const ctx = await browser.newContext(dev);
  const page = await ctx.newPage();
  if (init) await page.addInitScript(init);
  await page.routeWebSocket(/\?token=/, () => {});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base + query);
  await page.evaluate(g => { localStorage.clear(); localStorage.setItem('tc.tutorial.wego', 'done'); localStorage.setItem('tc.tutorial.live', 'done'); localStorage.setItem('tc.herald.auto', 'off'); if (g) localStorage.setItem('tc.gfx', g); }, gfx);
  await page.reload();
  await page.waitForTimeout(400);
  await page.click(`[data-l=${lobby}]`);
  await page.waitForFunction(() => window.tc?.screen?.map?.fitted);
  await frames(page, 5);
  return { ctx, page, errors };
}
/** The game's own instance of art/gl/table.ts (Vite serves it with a ?t= stamp after edits: a bare import would be a second copy). */
const tableMod = `(() => { const u = performance.getEntriesByType('resource').map(e => e.name).find(n => /\\/src\\/art\\/gl\\/table\\.ts/.test(n)) ?? '/src/art/gl/table.ts'; return import(u); })()`;
const T = page => page.evaluate(`${tableMod}.then(m => ({ status: m.gfxStatus(), setting: m.gfxSetting() }))`);
const setGfx = (page, v) => page.evaluate(`${tableMod}.then(m => m.setGfxSetting(${JSON.stringify(v)}))`);
const layers = page => page.evaluate(() => [...document.querySelectorAll('canvas.artgl')].map(c => ({ cls: c.className, w: c.width, h: c.height, vis: c.style.visibility, disp: c.style.display, lost: c.getContext('webgl2')?.isContextLost() ?? null })));



// ------------------------------------------------------------------ GL stage
/** Live WebGL object counts (create minus delete; a lost context frees everything it held). */
const GLCOUNT = () => {
  const live = new Map(); window.__glLive = live;
  const P = WebGL2RenderingContext.prototype;
  for (const k of ['Texture', 'Framebuffer', 'Buffer', 'Program', 'VertexArray']) {
    const c = P['create' + k], d = P['delete' + k];
    P['create' + k] = function (...a) { const o = c.apply(this, a); if (o) { let s = live.get(this); if (!s) { live.set(this, s = {}); const g = this; this.canvas.addEventListener('webglcontextlost', () => live.set(g, {})); } s[k] = (s[k] ?? 0) + 1; } return o; };
    P['delete' + k] = function (o) { if (o) { const s = live.get(this); if (s) s[k] = (s[k] ?? 0) - 1; } return d.call(this, o); };
  }
};
const glLive = page => page.evaluate(() => { const t = {}; for (const [g, s] of window.__glLive) { if (g.isContextLost()) continue; for (const k in s) t[k] = (t[k] ?? 0) + s[k]; } return t; });
/** mean luminance of a screenshot region via canvas readback of the composited page is not possible: sample the layers instead */
async function gl(tag, dev) {
  console.log(`== GL stage (${tag})`);
  const { ctx, page, errors } = await openGame(dev, { gfx: 'high', init: GLCOUNT });
  await frames(page, 10);
  const L0 = await layers(page);
  check(L0.length === 3 && L0.every(l => !l.lost), `${tag}: three live GL layers`);
  const dpr = dev.deviceScaleFactor ?? 1, vw = dev.viewport.width;
  check(L0[0].w === Math.round(vw * Math.min(2, dpr)), `${tag}: under layer at min(2, dpr) (${L0[0].w} for ${vw}@${dpr})`);
  const base0 = await glLive(page);
  // every quality tier, set mid-game, at this viewport
  for (const q of ['medium', 'low', 'high', 'auto']) {
    await setGfx(page, q); await frames(page, 6);
    const s = await T(page), L = await layers(page);
    check(q === 'auto' ? /WebGL2|2D/.test(s.status) : s.status === `WebGL2 · ${q}`, `${tag}: Graphics ${q} -> "${s.status}"`);
    if (q !== 'auto') await page.screenshot({ path: `${out}/gl-${tag}-${q}.png` });
    if (q === 'low') check(L[2].w === Math.round(vw * 0.5), `${tag}: low shade layer half size (${L[2].w})`);
  }
  // the Auto governor: a paced still board (stage drawn every 2nd/3rd frame) at 60 fps is not a slow device, nor is
  // the lobby's 10 fps timer; a real 30 fps device is
  const gov = await page.evaluate(() => {
    const st = window.tc.screen.map.stage, saved = { q: st.quality, fixed: st.fixed };
    const run = (gap, dt, ms = 6000) => { st.setQuality('high'); st.setFixed(false); st.lastT = 0; st.ema = 16.7; for (let t = 1000; t < 1000 + ms; t += gap) st.govern(t, dt); return st.quality; };
    const r = { paced: run(33.4, 16.7), paced3: run(50, 16.7), timer: run(100, undefined), slow: run(33.4, 33.4), slowNoDt: run(33.4, undefined) };
    st.setQuality(saved.q); st.setFixed(saved.fixed);
    // and the map passes its frame interval
    let seen = null; const of = st.frame; st.frame = function (f, w, h) { seen = f.dt; return of.call(this, f, w, h); };
    return new Promise(res => setTimeout(() => { st.frame = of; res({ ...r, mapDt: seen }); }, 600));
  });
  check(gov.paced === 'high' && gov.paced3 === 'high' && gov.timer === 'high', `${tag}: Auto keeps its tier on a paced still board / timer-driven caller ${JSON.stringify(gov)}`);
  check(gov.slow === 'low' && gov.slowNoDt === 'low', `${tag}: Auto still steps down on a real 30 fps device`);
  check(typeof gov.mapDt === 'number', `${tag}: the map passes its frame interval to the stage (${gov.mapDt})`);
  await setGfx(page, 'off'); await frames(page, 6);
  check((await layers(page)).length === 0 && (await T(page)).status === '2D table', `${tag}: Graphics off removes the layers`);
  await page.screenshot({ path: `${out}/gl-${tag}-off.png` });
  await setGfx(page, 'high'); await frames(page, 6);
  check((await layers(page)).length === 3 && (await T(page)).status === 'WebGL2 · high', `${tag}: Graphics back on`);
  // context loss: one layer, then all three restored one at a time (in both orders)
  const lose = sel => page.evaluate(sel => { window.__ext = [...document.querySelectorAll(sel)].map(c => c.getContext('webgl2').getExtension('WEBGL_lose_context')); window.__ext.forEach(e => e.loseContext()); }, sel);
  const restore = i => page.evaluate(i => window.__ext[i].restoreContext(), i);
  await lose('canvas.artgl-light'); await page.waitForTimeout(200); await frames(page, 3);
  check((await T(page)).status.startsWith('Graphics context lost') && !(await page.evaluate(() => !!window.tc.screen.map.stage)), `${tag}: a lost layer drops the map to the 2D table`);
  await page.screenshot({ path: `${out}/gl-${tag}-lost.png` });
  await restore(0); await page.waitForTimeout(500);
  check((await T(page)).status === 'WebGL2 · high', `${tag}: restored`);
  for (const order of [[0, 1, 2], [2, 1, 0]]) {
    await lose('canvas.artgl'); await page.waitForTimeout(200);
    for (let k = 0; k < 3; k++) {
      await restore(order[k]); await page.waitForTimeout(300);
      const st = (await T(page)).status;
      check(k < 2 ? st.startsWith('Graphics context lost') : st === 'WebGL2 · high', `${tag}: restore ${order.slice(0, k + 1)} -> "${st}"`);
    }
  }
  await frames(page, 6);
  await page.screenshot({ path: `${out}/gl-${tag}-restored.png` });
  // GPU objects stay bounded: tier switches, resizes and context cycles leave no extra textures/programs
  for (let i = 0; i < 4; i++) {
    for (const q of ['low', 'medium', 'high']) { await setGfx(page, q); await frames(page, 3); }
    await page.setViewportSize({ width: vw - 37 * (i + 1), height: dev.viewport.height }); await frames(page, 3);
    await lose('canvas.artgl-under'); await page.waitForTimeout(80); await restore(0); await page.waitForTimeout(200);
  }
  await page.setViewportSize(dev.viewport); await frames(page, 6);
  const base1 = await glLive(page);
  check(JSON.stringify(base1) === JSON.stringify(base0), `${tag}: live GL objects bounded ${JSON.stringify(base0)} -> ${JSON.stringify(base1)}`);
  // lobby <-> game: one stage, still three contexts
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => { location.hash = '#/'; }); await page.waitForTimeout(500);
    await page.evaluate(() => document.querySelector('[data-l=start]').click()); await page.waitForFunction(() => window.tc?.screen?.map?.fitted); await frames(page, 4);
  }
  const ctxs = await page.evaluate(() => [...window.__glLive.keys()].filter(g => !g.isContextLost()).length);
  check(ctxs <= 3, `${tag}: live GL contexts after 3 lobby round trips: ${ctxs}`);
  check(errors.length === 0, `${tag}: no page errors ${JSON.stringify(errors.slice(0, 3))}`);
  await ctx.close();
}
async function gl2d(tag, dev) {
  console.log(`== ?gl=0 (${tag})`);
  const { ctx, page, errors } = await openGame(dev, { gfx: null, query: '?gl=0' });
  const s = await T(page);
  check(s.status === '2D table' && (await layers(page)).length === 0, `${tag} ?gl=0: 2D table (${s.status})`);
  await page.screenshot({ path: `${out}/gl0-${tag}.png` });
  // a pan with the 2D table
  await page.evaluate(() => { const m = window.tc.screen.map; m.cam.x += 200; }); await frames(page, 10);
  check(errors.length === 0, `${tag} ?gl=0: no page errors ${JSON.stringify(errors.slice(0, 3))}`);
  await ctx.close();
}
DEVICES.landscape = { ...DEVICES.phone, viewport: { width: 852, height: 393 } };
const ALL = { desktop: DEVICES.desktop, big: DEVICES.big, phone: DEVICES.phone };
const DEVS = process.env.DEV ? { [process.env.DEV]: DEVICES[process.env.DEV] } : ALL;
if (!ONLY || ONLY === 'gl') for (const [tag, dev] of Object.entries(DEVS)) { await gl(tag, dev); await gl2d(tag, dev); }

// ------------------------------------------------------------------ map: tooltips at the edges, zoomAt, crossfades, names, pan perf
async function mapChecks(tag, dev, gfx) {
  console.log(`== map (${tag}, gfx ${gfx})`);
  const { ctx, page, errors } = await openGame(dev, { gfx });
  page.setDefaultTimeout(90000);
  const touch = !!dev.hasTouch;
  const W = dev.viewport.width, H = dev.viewport.height;
  // ---- zoomed out, a press on a star's centre picks the star, not the piece parked beside it; a tap's tooltip stays
  // with what was tapped while the camera glides after the selection
  {
    const sp = await page.evaluate(() => { const s = window.tc.screen, m = s.map; m.cam.z = 0.26; return s.st.players[s.you].capital; });
    await frames(page, 6);
    const p = await page.evaluate(rid => window.tc.screen.map.screenOfRegion(rid), sp);
    if (touch) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(900); await frames(page, 3);
    const r = await page.evaluate(() => ({ sel: window.tc.screen.sel, name: window.tc.screen.st.regions[window.tc.screen.st.players[window.tc.screen.you].capital].name, tip: document.querySelector('.maptip')?.style.display !== 'none' ? document.querySelector('.maptip')?.innerText.split('\n')[0] : null }));
    check(r.sel?.kind === 'region', `${tag}: ${touch ? 'tap' : 'click'} on the capital's star at z 0.26 selects it (${JSON.stringify(r.sel)})`);
    if (touch) check(r.tip === r.name, `${tag}: the tap tooltip names the tapped star after the camera moves ("${r.tip}" vs ${r.name})`);
    await page.keyboard.press('Escape'); await page.evaluate(() => window.tc.screen.deselect?.()); await page.waitForTimeout(200);
  }
  // ---- tooltips: a star parked at each screen edge, hovered (mouse) or tapped (touch)
  const rid = await page.evaluate(() => { const s = window.tc.screen; return s.st.players[s.you].capital; });
  const tipTexts = [];
  for (const [ex, ey, nm] of [[0.5, 0, 'top'], [0.5, 1, 'bottom'], [0, 0.5, 'left'], [1, 0.5, 'right'], [0, 0, 'top-left'], [1, 1, 'bottom-right']]) {
    const want = { x: Math.round(14 + ex * (W - 28)), y: Math.round(14 + ey * (H - 28)) };
    // the HUD covers the very top and bottom: pick the nearest point the map itself receives
    const p = await page.evaluate(({ rid, want }) => {
      const m = window.tc.screen.map, r = window.tc.screen.st.regions[rid];
      for (let k = 0; k < 40; k++) {
        const x = want.x + (want.x < innerWidth / 2 ? k * 6 : -k * 6) * (want.x === Math.round(innerWidth / 2) ? 0 : 1);
        const y = want.y + (want.y < innerHeight / 2 ? k * 6 : -k * 6) * (want.y === Math.round(innerHeight / 2) ? 0 : 1);
        const el = document.elementFromPoint(x, y);
        if (el === m.canvas) {
          m.cam.x = r.site.x - (x - m.w / 2) / m.cam.z; m.cam.y = r.site.y - (y - m.h / 2) / m.cam.z;
          return { x, y };
        }
      }
      return null;
    }, { rid, want });
    if (!p) { console.log(`  (no map point near the ${nm} edge)`); continue; }
    await frames(page, 4);
    const sp = await page.evaluate(rid => window.tc.screen.map.screenOfRegion(rid), rid);
    // touch: a real tap also selects (the card sheet opens and the camera glides to keep it clear, tested above), so
    // the placement at the edge is checked with the renderer's own tap record
    if (touch) await page.evaluate(rid => { const s = window.tc.screen, m = s.map; s.select({ kind: 'region', id: rid }); m.tapAt = { ...s.st.regions[rid].site, until: performance.now() + 3500 }; }, rid); else { await page.mouse.move(sp.x - 3, sp.y); await page.mouse.move(sp.x, sp.y); }
    await page.waitForTimeout(touch ? 400 : 700);
    await frames(page, 3);
    const tip = await page.evaluate(() => { const t = document.querySelector('.maptip'); if (!t || t.style.display === 'none') return null; const r = t.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, text: t.innerText }; });
    if (!tip) { check(false, `${tag}: a tooltip for the star at the ${nm} edge ${JSON.stringify(await page.evaluate(rid => { const m = window.tc.screen.map; return { sel: window.tc.screen.sel, sp: m.screenOfRegion(rid), tap: m.tapAt && m.toScreen(m.tapAt), q: m.quietUntil - performance.now(), el: document.elementFromPoint(m.screenOfRegion(rid).x, m.screenOfRegion(rid).y)?.className }; }, rid))}`); continue; }
    tipTexts.push(tip.text.replace(/\s+/g, ' ').slice(0, 160));
    check(tip.l >= 0 && tip.t >= 0 && tip.r <= W && tip.b <= H, `${tag}: ${nm} edge tooltip inside the viewport (${[tip.l, tip.t, tip.r, tip.b].map(Math.round)})`);
    if (touch) Object.assign(sp, await page.evaluate(rid => window.tc.screen.map.screenOfRegion(rid), rid));
    const covers = sp.x >= tip.l && sp.x <= tip.r && sp.y >= tip.t && sp.y <= tip.b;
    check(!covers, `${tag}: ${nm} edge tooltip does not cover the star it describes`);
    if (nm === 'bottom' || nm === 'right') await page.screenshot({ path: `${out}/map-${tag}-${gfx}-tip-${nm}.png` });
    await page.mouse.move(W / 2, H / 2).catch(() => {});
    await page.evaluate(() => window.tc.screen.deselect?.());
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
  console.log('  tip:', tipTexts[0]);
  // ---- zoomAt: smooth, anchored, crosses tiers with a crossfade, never NaN
  const zr = await page.evaluate(() => new Promise(res => {
    const m = window.tc.screen.map; m.cam.z = 0.3;
    const sx = m.w * 0.3, sy = m.h * 0.6;
    const w0 = m.toWorld(sx, sy);
    const tiers = new Set(), zs = []; let fades = 0, drift = 0, k = 0;
    const f = () => {
      if (k % 6 === 0 && k < 60) m.zoomAt(sx, sy, 1.25);
      const w = m.toWorld(sx, sy); drift = Math.max(drift, Math.hypot(w.x - w0.x, w.y - w0.y) * m.cam.z);
      tiers.add(m.tier); zs.push(m.cam.z); if (m.fade) fades++;
      if (++k < 110) requestAnimationFrame(f); else res({ tiers: [...tiers], drift: +drift.toFixed(2), z: m.cam.z, fades, mono: zs.every((z, i) => !i || z >= zs[i - 1] - 1e-9), finite: zs.every(Number.isFinite) });
    };
    requestAnimationFrame(f);
  }));
  check(zr.finite && zr.mono && zr.drift < 1.5, `${tag}: zoomAt glides monotonically, anchored (drift ${zr.drift}px) to z ${zr.z.toFixed(2)}`);
  check(zr.tiers.length >= 2 && zr.fades > 0, `${tag}: zoom crosses tiers ${zr.tiers} with a crossfade (${zr.fades} frames)`);
  // ---- names: the layout is world-space (panning cannot move it); wobbling the zoom between two steps must settle
  const nm = await page.evaluate(() => new Promise(res => {
    const m = window.tc.screen.map, orig = m.layoutNames; let last = null;
    m.layoutNames = function (I) { const r = orig.call(this, I); last = r; return r; };
    const zs = [0.5, 0.5 * Math.exp(1.2 / 40)];
    const snaps = []; let k = 0;
    const f = () => {
      m.cam.z = zs[Math.floor(k / 3) % 2];
      if (k % 3 === 2 && last) snaps.push([...last].map(([i, p]) => `${i}:${p}`).join(','));
      if (++k < 60) requestAnimationFrame(f); else { m.layoutNames = orig; let late = 0; for (let i = 4; i < snaps.length; i++) if (snaps[i] !== snaps[i - 2]) late++; res({ snaps: snaps.length, lateFlips: late }); }
    };
    requestAnimationFrame(f);
  }));
  check(nm.lateFlips === 0, `${tag}: name placement settles under a zoom wobble (${JSON.stringify(nm)})`);
  // ---- pan cost: frame CPU while dragging the map
  const cost = await page.evaluate(() => new Promise(res => {
    const s = window.tc.screen, m = s.map, orig = s.frame.bind(s), c = [];
    s.frame = () => { const t = performance.now(); orig(); c.push(performance.now() - t); };
    let k = 0;
    const f = () => { m.cam.x += 6 / m.cam.z; m.cam.y += 2 / m.cam.z; if (++k < 120) requestAnimationFrame(f); else { s.frame = orig; c.sort((a, b) => a - b); res({ avg: +(c.reduce((a, b) => a + b, 0) / c.length).toFixed(2), p95: +c[Math.floor(c.length * 0.95)].toFixed(2), n: c.length }); } };
    requestAnimationFrame(f);
  }));
  console.log('  pan frame cpu', JSON.stringify(cost));
  check(errors.length === 0, `${tag}: no page errors ${JSON.stringify(errors.slice(0, 3))}`);
  await ctx.close();
}
if (!ONLY || ONLY === 'map') for (const [tag, dev] of Object.entries(DEVS)) for (const g of ['high', 'off']) await mapChecks(tag, dev, g);

// ------------------------------------------------------------------ battle viewer
async function bv(tag, dev) {
  console.log(`== battle viewer (${tag})`);
  const ctx = await browser.newContext(dev);
  const page = await ctx.newPage();
  await page.routeWebSocket(/\?token=/, () => {});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(new URL('battle-demo.html?mode=none', base).href);
  await page.evaluate(() => localStorage.setItem('tc.gfx', 'low'));
  await page.reload();
  page.setDefaultTimeout(90000);
  const open = k => page.evaluate(k => {
    const b = window.__bv;
    const cls = ['corvette', 'frigate', 'cruiser', 'scout', 'dread', 'bombard'];
    const many = (n, o, pre) => Array.from({ length: n }, (_, i) => [cls[(i * 7 + o) % cls.length], `${pre} ${['Vigil', 'Ardent', 'Lantern', 'Morrow', 'Sable', 'Quill', 'Ember', 'Harrow'][i % 8]} ${i + 1}`]);
    const rep = k === 'crowded' ? b.buildReport([
      { owner: 0, fleets: [{ id: 10, name: 'Grand Lance', commander: 'Adm. Vance', ships: many(14, 0, 'HMS') }, { id: 11, name: 'Second Lance', commander: 'Cmdr. Rask', ships: many(8, 3, 'HMS') }] },
      { owner: 1, fleets: [{ id: 20, name: 'Red Tide', commander: 'Kor', ships: many(16, 1, 'Red') }] },
      { owner: 2, garrison: 40, fleets: [{ id: 30, name: 'Gilt Host', commander: 'Marrow', ships: many(12, 2, 'Gilt') }] },
    ], 7, 'Battle of Many Ships', 99) : k === 'garrison' ? b.buildReport([
      { owner: 0, fleets: [{ id: 10, name: 'First Lance', commander: 'Adm. Vance', ships: [['cruiser', 'Resolute'], ['frigate', 'Kestrel']] }] },
      { owner: -1, garrison: 18, fleets: [] },
    ], 12, 'Siege of Widow Rift', 5) : b[k]();
    window.__rep = rep;
    b.openBattleViewer(rep, b.ctx);
  }, k);
  const st = () => page.evaluate(() => ({ d: window.__bvDecisive?.(), round: document.querySelector('.bv-round')?.textContent, end: getComputedStyle(document.querySelector('.bv-end')).display !== 'none', fill: parseFloat(document.querySelector('.bv-bar em')?.style.width ?? '0') }));
  const offscreen = () => page.evaluate(() => [...document.querySelectorAll('.bv-panel button, .bv-round, .bv-bar, .bv-caption, .bv-x, .bv-speed')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1); }).map(e => e.className));
  for (const k of ['threeWay', 'twoWay', 'garrison', 'crowded']) {
    // every speed on the short battles; the long ones at the faster speeds (a slow-mo is a crossing test, any speed)
    for (const speed of k === 'twoWay' || k === 'garrison' ? ['1×', '2×', '4×'] : k === 'threeWay' ? ['2×', '4×'] : ['4×']) {
      // count slow-mo starts by watching __bvDecisive().fired flip, frame by frame
      await open(k);
      await page.evaluate(v => [...document.querySelectorAll('.bv-speed .bv-btn')].find(b => b.textContent === v).click(), speed);
      const r = await page.evaluate(() => new Promise(res => {
        let flips = 0, last = window.__bvDecisive().fired, t0 = performance.now();
        const f = () => {
          const d = window.__bvDecisive(); if (d.fired !== last) { flips++; last = d.fired; }
          const end = getComputedStyle(document.querySelector('.bv-end')).display !== 'none';
          if (end || performance.now() - t0 > 120000) return res({ flips, d, end, ms: Math.round(performance.now() - t0) });
          requestAnimationFrame(f);
        };
        requestAnimationFrame(f);
      }));
      const expect = r.d.at !== null && !matchMediaReduced ? 1 : 0;
      check(r.end && r.flips === expect, `${tag} ${k} @${speed}: decisive slow-mo ${r.flips}x (decisive at ${r.d.at}, ${r.d.kind}), ended in ${r.ms}ms`);
      if (speed === (k === 'twoWay' || k === 'garrison' ? '1×' : k === 'threeWay' ? '2×' : '4×')) {
        await page.screenshot({ path: `${out}/bv-${tag}-${k}-end.png` });
        // replay from the start: the slow-mo stays spent
        await page.evaluate(() => document.querySelector('.bv-btn[title^="Restart"]').click());
        await page.waitForTimeout(300);
        if (r.d.at !== null) check((await st()).d.fired === true, `${tag} ${k}: restart keeps the slow-mo spent`);
      }
      await page.keyboard.press('Escape'); await page.waitForTimeout(260);
    }
    // scrub through the decisive volley: no slow-mo; a mid-battle screenshot for crowding
    await open(k);
    await page.waitForTimeout(400);
    const bar = await page.locator('.bv-bar').boundingBox();
    await page.mouse.move(bar.x + 2, bar.y + bar.height / 2); await page.mouse.down();
    for (let i = 1; i <= 20; i++) { await page.mouse.move(bar.x + bar.width * i / 20 - 1, bar.y + bar.height / 2); await page.waitForTimeout(16); }
    await page.mouse.up();
    check((await st()).d.fired === false, `${tag} ${k}: scrubbing past the decisive volley plays no slow-mo`);
    await page.mouse.move(bar.x + bar.width * 0.45, bar.y + bar.height / 2); await page.mouse.down(); await page.mouse.up();
    if (await page.evaluate(() => document.querySelector('.bv-btn[data-state]')?.dataset.state === 'playing')) await page.evaluate(() => document.querySelector('.bv-btn[data-state]').click());
    await page.waitForTimeout(300);
    check((await offscreen()).length === 0, `${tag} ${k}: controls on screen ${JSON.stringify(await offscreen())}`);
    await page.screenshot({ path: `${out}/bv-${tag}-${k}-mid.png` });
    await page.keyboard.press('Escape'); await page.waitForTimeout(260);
  }
  check(await page.evaluate(() => !document.querySelector('.bv-overlay')), `${tag}: viewer closed`);
  check(errors.length === 0, `${tag} viewer: no page errors ${JSON.stringify(errors.slice(0, 3))}`);
  await ctx.close();
}
const matchMediaReduced = false;
const BVDEVS = { ...DEVS, landscape: DEVICES.landscape };
if (!ONLY || ONLY === 'bv') for (const [tag, dev] of Object.entries(process.env.DEV ? DEVS : BVDEVS)) await bv(tag, dev);

// ------------------------------------------------------------------ the viewer keeps the GL table while it is open
async function bvTable(tag, dev) {
  console.log(`== viewer + GL table in game (${tag})`);
  const { ctx, page, errors } = await openGame(dev, { gfx: 'high' });
  page.setDefaultTimeout(90000);
  const mod = n => `(() => { const u = performance.getEntriesByType('resource').map(e => e.name).find(x => x.includes('/src/${n}')); return import(u); })()`;
  await page.evaluate(`${mod('render/battle.ts')}.then(B => {
    const rep = { id: 991, name: 'Siege of Test', turn: 3, region: 12, winner: 0, losses: {}, highlights: ['The garrison falls.'],
      sides: [ { owner: 0, fleets: [{ id: 10, name: 'First Lance', commander: 'Adm. Vance' }], ships: [{ id: 100, name: 'Resolute', cls: 'cruiser', hp: 30, maxHp: 30, fleet: 10 }] },
               { owner: -1, fleets: [], ships: [], garrison: { id: -13, hp: 12, maxHp: 12 } } ],
      rounds: [{ shots: [{ from: 100, to: -13, dmg: 5 }], retreats: [] }] };
    const s = window.tc.screen;
    B.openBattleViewer(rep, { rules: s.st.rules, playerName: o => 'P' + o, playerColor: o => '#5577ff', regionName: () => 'X', you: 0 });
  })`);
  await page.waitForTimeout(800);
  const where = () => page.evaluate(() => { const u = document.querySelector('canvas.artgl-under'); return u ? (u.closest('.bv-overlay') ? 'viewer' : 'map') : 'none'; });
  check(await where() === 'viewer', `${tag}: the open viewer holds the GL table`);
  await setGfx(page, 'low'); await page.waitForTimeout(600);
  check(await where() === 'viewer', `${tag}: a tier change mid-battle leaves the table under the viewer (${await where()})`);
  await page.evaluate(() => { window.__ext = [...document.querySelectorAll('canvas.artgl')].map(c => c.getContext('webgl2').getExtension('WEBGL_lose_context')); window.__ext.forEach(e => e.loseContext()); });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/bvtable-${tag}-lost.png` });
  await page.evaluate(() => window.__ext.forEach(e => e.restoreContext()));
  await page.waitForTimeout(800);
  check(await where() === 'viewer' && (await T(page)).status.startsWith('WebGL2'), `${tag}: context lost and restored mid-battle, table back under the viewer`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(500); await frames(page, 4);
  check(await where() === 'map', `${tag}: closing the viewer hands the table back to the map (${await where()})`);
  check(errors.length === 0, `${tag}: no page errors ${JSON.stringify(errors.slice(0, 3))}`);
  await ctx.close();
}
if (!ONLY || ONLY === 'bvt') for (const [tag, dev] of Object.entries(DEVS)) await bvTable(tag, dev);

// ------------------------------------------------------------------ end
await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED:\n- ${fails.join('\n- ')}` : '\nall checks passed');
process.exit(fails.length ? 1 : 0);
