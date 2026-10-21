// Renderer QA: exercises the map renderer (camera, hit-testing, cache invalidation, particles, resize, DPR,
// reduced motion, LIVE glide) and the battle viewer (open/close, stacking, keyboard, leaks), then prints
// frame-time numbers and a list of failed checks. Exits 1 if any check failed or the page threw.
// node scripts/render-check.mjs [outdir] [baseUrl]      (needs `npm run dev`; screenshots only if outdir is given)
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? null;
const base = process.argv[3] ?? 'http://localhost:5173/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const fails = [];
const check = (ok, what) => { if (!ok) { fails.push(what); console.log('  FAIL', what); } };

const DEVICES = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  desktop2x: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 },
  phone: {
    viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
};

/** rAF deltas + GameScreen.frame() cost + static-layer rebuilds over `ms`, while `during` runs. */
async function measure(page, ms, during) {
  const p = page.evaluate(ms => new Promise(res => {
    const s = window.tc.screen, m = s.map;
    const orig = s.frame.bind(s), cost = [];
    s.frame = () => { const t = performance.now(); orig(); cost.push(performance.now() - t); };
    const ods = m.drawStatic; let rebuilds = 0; m.drawStatic = function (I) { rebuilds++; return ods.call(this, I); };
    const d = []; let last = performance.now(); const end = last + ms;
    const q = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? { avg: +(b.reduce((x, y) => x + y, 0) / b.length).toFixed(2), p95: +b[Math.floor(b.length * 0.95)].toFixed(2), max: +b[b.length - 1].toFixed(2) } : null; };
    const tick = now => { d.push(now - last); last = now; if (now < end) requestAnimationFrame(tick); else { s.frame = orig; m.drawStatic = ods; res({ frames: d.length, delta: q(d), frameCpu: q(cost), rebuilds, particles: m.particles.length }); } };
    requestAnimationFrame(tick);
  }), ms);
  if (during) await during();
  return p;
}

const camOk = page => page.evaluate(() => { const c = window.tc.screen.map.cam; return Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.z) && c.z > 0; });
const frames = (page, n = 3) => page.evaluate(n => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

async function openGame(ctx, lobbyButton, opts = {}) {
  const page = await ctx.newPage();
  // ignore Vite HMR reloads (other files changing while this runs would navigate the page away)
  await page.routeWebSocket(/\?token=/, () => {});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('tc.tutorial.wego', 'done'); localStorage.setItem('tc.tutorial.live', 'done'); });
  await page.reload();
  await page.waitForTimeout(500);
  if (opts.mode) await page.selectOption('[data-l=mode]', opts.mode);
  await page.click(`[data-l=${lobbyButton}]`);
  await page.waitForFunction(() => window.tc?.screen?.map?.fitted);
  await frames(page, 5);
  return { page, errors };
}

/** Every visible fleet token and region site hit-tests to itself at several zoom levels. */
async function hitTests(page, label) {
  const res = await page.evaluate(() => {
    const s = window.tc.screen, m = s.map, st = s.st;
    const out = [];
    const saved = { ...m.cam };
    for (const z of [0.12, 0.25, 0.5, 1, 2, 3]) {
      m.cam.z = z;
      for (const r of st.regions) {
        m.cam.x = r.site.x; m.cam.y = r.site.y;
        const p = m.toScreen(r.site);
        const got = m.regionAt(st, p.x, p.y);
        if (got !== r.id) out.push(`regionAt z=${z} region ${r.id} -> ${got}`);
      }
      // fleets: draw one frame at this camera so drawnPos is current, then hit each token's drawn centre
      s.frame();
      const draws = s.currentFleetDraws();
      for (const f of draws) {
        const at = m.drawnPos.get(f.id) ?? f.pos;
        m.cam.x = at.x; m.cam.y = at.y;
        const p = m.toScreen(at);
        const hit = m.fleetAt(draws, p.x, p.y);
        if (!hit) { out.push(`fleetAt z=${z} fleet ${f.id} -> none`); continue; }
        const hp = m.toScreen(m.drawnPos.get(hit.id) ?? hit.pos);
        if (hit.id !== f.id && Math.hypot(hp.x - p.x, hp.y - p.y) > 0.5) out.push(`fleetAt z=${z} fleet ${f.id} -> ${hit.id}`);
      }
    }
    m.cam = saved;
    return out;
  });
  check(res.length === 0, `${label}: hit-tests ${res.slice(0, 5).join('; ')}${res.length > 5 ? ` (+${res.length - 5})` : ''}`);
}

async function cacheTests(page, label) {
  const r = await page.evaluate(async () => {
    const s = window.tc.screen, m = s.map, st = s.st;
    let n = 0; const ods = m.drawStatic; m.drawStatic = function (I) { n++; return ods.call(this, I); };
    const step = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    await step(); n = 0;
    await step(); const idle = n;
    const reg = st.regions.find(x => x.kind === 'colony') ?? st.regions[0];
    const out = { idle };
    // in-place mutations of things the static layer draws must rebuild it
    const muts = {
      battery: [() => { reg.buildings.battery = (reg.buildings.battery ?? 0) + 1; }, () => { reg.buildings.battery = (reg.buildings.battery ?? 1) - 1; }],
      vein: [() => { reg._v = reg.vein; reg.vein = reg.vein === 'antimatter' ? 'crystal' : 'antimatter'; }, () => { reg.vein = reg._v; delete reg._v; }],
      garrison: [() => { reg.garrison += 3; }, () => { reg.garrison -= 3; }],
      memorial: [() => { reg.memorials.push({ turn: 1, text: 'x' }); }, () => { reg.memorials.pop(); }],
    };
    for (const [k, [doIt, undo]] of Object.entries(muts)) { n = 0; doIt(); await step(); out[k] = n; undo(); await step(); }
    m.drawStatic = ods;
    return out;
  });
  check(r.idle === 0, `${label}: static layer rebuilt while idle (${r.idle})`);
  for (const k of ['battery', 'vein', 'garrison', 'memorial']) check(r[k] > 0, `${label}: in-place ${k} change did not rebuild the static layer`);
}

async function cameraTests(page, label, touch) {
  const box = await page.locator('canvas').first().boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  // extreme wheel zoom both ways
  if (!touch) {
    await page.mouse.move(cx, cy);
    for (let i = 0; i < 30; i++) await page.mouse.wheel(0, -400);
    await frames(page, 2);
    check(await camOk(page), `${label}: camera NaN after zoom-in`);
    for (let i = 0; i < 60; i++) await page.mouse.wheel(0, 400);
    await frames(page, 2);
    check(await camOk(page), `${label}: camera NaN after zoom-out`);
    for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -300);
  }
  // drag: frame cost while panning (cached-layer blit) vs the rebuild when it settles
  const drag = await measure(page, 1400, async () => {
    if (touch) {
      const cdp = await page.context().newCDPSession(page);
      const tp = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
      await tp('touchStart', [{ x: cx, y: cy, id: 1 }]);
      for (let i = 1; i <= 30; i++) { await tp('touchMove', [{ x: cx - i * 6, y: cy - i * 3, id: 1 }]); await page.waitForTimeout(16); }
      await tp('touchEnd', []);
      // pinch out then in around the centre
      await tp('touchStart', [{ x: cx - 40, y: cy, id: 1 }, { x: cx + 40, y: cy, id: 2 }]);
      for (let i = 1; i <= 20; i++) { await tp('touchMove', [{ x: cx - 40 - i * 6, y: cy, id: 1 }, { x: cx + 40 + i * 6, y: cy, id: 2 }]); await page.waitForTimeout(16); }
      for (let i = 20; i >= -5; i--) { await tp('touchMove', [{ x: cx - 40 - i * 6, y: cy, id: 1 }, { x: cx + 40 + i * 6, y: cy, id: 2 }]); await page.waitForTimeout(16); }
      await tp('touchEnd', []);
    } else {
      await page.mouse.move(cx, cy); await page.mouse.down();
      for (let i = 1; i <= 40; i++) { await page.mouse.move(cx - i * 8, cy - i * 4); await page.waitForTimeout(16); }
      await page.mouse.up();
    }
  });
  console.log(`  ${label} pan${touch ? '+pinch' : ''}`, JSON.stringify(drag));
  check(await camOk(page), `${label}: camera NaN after drag/pinch`);
  // flights: degenerate inputs must not poison the camera
  await page.evaluate(() => { const m = window.tc.screen.map; m.flyTo({ x: 0, y: 0 }, 0); m.flyTo({ x: NaN, y: 1 }); m.flyTo({ x: 100, y: 50 }, undefined, 300); });
  await page.waitForTimeout(450);
  check(await camOk(page), `${label}: camera NaN after flyTo`);
}

async function fxTests(page, label) {
  const r = await page.evaluate(async () => {
    const s = window.tc.screen, m = s.map, st = s.st, now = performance.now();
    for (let i = 0; i < 80; i++) {
      const site = st.regions[i % st.regions.length].site;
      s.fx.push({ kind: ['explode', 'capture', 'excavate', 'battle', 'build'][i % 5], pos: site, color: '#ff5d7a', t0: now, dur: 900, size: 2 });
    }
    await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    const peak = m.particles.length;
    let bad = 0; for (const p of m.particles) if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) bad++;
    return { peak, cap: m.compact ? 220 : 450, bad };
  });
  check(r.peak <= r.cap, `${label}: particles ${r.peak} over cap ${r.cap}`);
  check(r.bad === 0, `${label}: ${r.bad} NaN particles`);
  const m = await measure(page, 1200);
  console.log(`  ${label} fx storm`, JSON.stringify(m));
}

async function resizeTests(page, label, sizes) {
  for (const [w, h] of sizes) {
    await page.setViewportSize({ width: w, height: h });
    await frames(page, 4);
    const r = await page.evaluate(() => { const m = window.tc.screen.map, c = m.canvas, b = c.getBoundingClientRect(); return { mw: m.w, mh: m.h, bw: b.width, bh: b.height, cw: c.width, dpr: m.dpr }; });
    check(Math.abs(r.mw - r.bw) < 1 && Math.abs(r.mh - r.bh) < 1, `${label}: map size ${r.mw}x${r.mh} != canvas ${r.bw}x${r.bh} at ${w}x${h}`);
    check(Math.abs(r.cw - Math.round(r.bw * r.dpr)) <= 1, `${label}: backing store ${r.cw} != ${r.bw}*${r.dpr} at ${w}x${h}`);
    check(await camOk(page), `${label}: camera NaN after resize ${w}x${h}`);
  }
}

async function battleTests(page, label) {
  // find a battle report: advance the (all-AI) game until one appears
  let id = null;
  for (let i = 0; i < 14 && id === null; i++) {
    id = await page.evaluate(() => window.tc.screen.st.last?.battles?.[0]?.id ?? null);
    if (id === null) { await page.evaluate(() => { const s = window.tc.screen; s.src.advance?.(); }); await page.waitForTimeout(150); await page.evaluate(() => window.tc.screen.endReplay()); }
  }
  if (id === null) { console.log(`  ${label}: no battle found, viewer checks skipped`); return; }
  await page.evaluate(() => { const o = window.requestAnimationFrame.bind(window); window.__raf = 0; window.requestAnimationFrame = cb => { window.__raf++; return o(cb); }; });
  const rafRate = async () => { const a = await page.evaluate(() => window.__raf); await page.waitForTimeout(500); return (await page.evaluate(() => window.__raf)) - a; };
  const before = await rafRate();
  // open/close quickly, many times, mid-animation
  for (let i = 0; i < 8; i++) { await page.evaluate(id => window.tc.screen.openBattle(id), id); await page.waitForTimeout(40 + i * 30); await page.keyboard.press('Escape'); }
  await page.waitForTimeout(300);
  check(await page.evaluate(() => document.querySelectorAll('.bv-overlay,.bv-closing').length) === 0, `${label}: battle overlay left behind`);
  const after = await rafRate();
  check(after <= before * 1.3 + 3, `${label}: rAF callbacks grew ${before} -> ${after} per 500ms after closing viewers (leak)`);
  // two opens stack only one viewer
  await page.evaluate(id => { window.tc.screen.openBattle(id); window.tc.screen.openBattle(id); }, id);
  await page.waitForTimeout(200);
  check(await page.evaluate(() => document.querySelectorAll('.bv-overlay').length) === 1, `${label}: opening twice stacks viewers`);
  const sz = await page.evaluate(() => { const st = document.querySelector('.bv-stage'), c = st.querySelector('canvas'); return { cw: st.clientWidth, cnv: c.width, dpr: Math.min(2, devicePixelRatio) }; });
  check(Math.abs(sz.cnv - Math.round(sz.cw * sz.dpr)) <= 1, `${label}: viewer backing store ${sz.cnv} != ${sz.cw}*${sz.dpr}`);
  // keyboard: space pauses, arrows seek, the game does not react underneath
  await page.waitForTimeout(2000);
  const icon = () => page.evaluate(() => document.querySelector('.bv-ctrl .bv-btn[title^="Play"]').textContent);
  const i0 = await icon();
  await page.keyboard.press('Space'); await frames(page, 2);
  check((await icon()) !== i0, `${label}: Space did not toggle play/pause in the viewer`);
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Space');
  const vm = await (async () => page.evaluate(() => new Promise(res => { const d = []; let l = performance.now(); const t = n => { d.push(n - l); l = n; if (d.length < 90) requestAnimationFrame(t); else { d.sort((a, b) => a - b); res({ avg: +(d.reduce((a, b) => a + b) / d.length).toFixed(2), p95: +d[Math.floor(d.length * 0.95)].toFixed(2) }); } }; requestAnimationFrame(t); })))();
  console.log(`  ${label} battle viewer frame deltas`, JSON.stringify(vm));
  if (out) await page.screenshot({ path: `${out}/rc-${label}-battle.png` });
  await page.click('.bv-btn[title^="Skip"]');
  await page.waitForTimeout(300);
  if (out) await page.screenshot({ path: `${out}/rc-${label}-battle-end.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check(await page.evaluate(() => document.querySelectorAll('.bv-overlay,.bv-closing').length) === 0, `${label}: Escape did not close the viewer`);
}

for (const [name, dev] of Object.entries(DEVICES)) {
  console.log(`== ${name}`);
  const touch = !!dev.hasTouch;
  {
    // fogged single-player game: hit-tests, camera, cache, resize
    const ctx = await browser.newContext(dev);
    const { page, errors } = await openGame(ctx, 'start');
    console.log(`  ${name} idle`, JSON.stringify(await measure(page, 1200)));
    await hitTests(page, name);
    await cacheTests(page, name);
    await cameraTests(page, name, touch);
    if (out) await page.screenshot({ path: `${out}/rc-${name}-game.png` });
    await resizeTests(page, name, touch ? [[852, 393], [393, 852], [320, 568]] : [[900, 700], [600, 900], [1920, 1080], [1440, 900]]);
    if (out) await page.screenshot({ path: `${out}/rc-${name}-resized.png` });
    check(errors.length === 0, `${name} (game): page errors ${JSON.stringify(errors.slice(0, 3))}`);
    await ctx.close();
  }
  {
    // all-AI game: replays, fx, particles, battle viewer
    const ctx = await browser.newContext(dev);
    const { page, errors } = await openGame(ctx, 'watch');
    for (let t = 0; t < 3; t++) {
      await page.evaluate(() => window.tc.screen.src.advance());
      await page.waitForTimeout(100);
      if (await page.evaluate(() => !!window.tc.screen.replay)) {
        await page.evaluate(() => { window.tc.screen.replay.speed = 3; });
        console.log(`  ${name} replay t${t}`, JSON.stringify(await measure(page, 1500)));
        check(await camOk(page), `${name}: camera NaN during replay`);
        await page.evaluate(() => window.tc.screen.endReplay());
      }
    }
    await fxTests(page, name);
    await battleTests(page, name);
    check(errors.length === 0, `${name} (watch): page errors ${JSON.stringify(errors.slice(0, 3))}`);
    await ctx.close();
  }
}

{
  // reduced motion: no particles, no trails, camera flights snap
  console.log('== reduced motion');
  const ctx = await browser.newContext({ ...DEVICES.desktop, reducedMotion: 'reduce' });
  const { page, errors } = await openGame(ctx, 'watch');
  await page.evaluate(() => { const s = window.tc.screen, now = performance.now(); for (const r of s.st.regions.slice(0, 10)) s.fx.push({ kind: 'explode', pos: r.site, color: '#fff', t0: now, dur: 900 }); });
  await frames(page, 4);
  const r = await page.evaluate(() => { const m = window.tc.screen.map; m.flyTo({ x: 10, y: 10 }); return { particles: m.particles.length, flying: m.flying }; });
  check(r.particles === 0, `reduced motion: ${r.particles} particles spawned`);
  check(!r.flying, 'reduced motion: camera flight animated');
  check(errors.length === 0, `reduced motion: page errors ${JSON.stringify(errors.slice(0, 3))}`);
  await ctx.close();
}

{
  // LIVE blitz: ticks resolve while the map runs; tokens in transit stay hit-testable where drawn
  console.log('== live blitz');
  const ctx = await browser.newContext(DEVICES.desktop);
  const { page, errors } = await openGame(ctx, 'start', { mode: 'live-blitz' });
  const moved = await page.evaluate(() => {
    const s = window.tc.screen, st = s.st, f = st.fleets.find(x => x.owner === s.you);
    if (!f) return false;
    const far = st.regions.filter(r => r.kind !== 'void').sort((a, b) => Math.hypot(b.site.x - st.regions[f.region].site.x, b.site.y - st.regions[f.region].site.y) - Math.hypot(a.site.x - st.regions[f.region].site.x, a.site.y - st.regions[f.region].site.y))[0];
    const path = s.safePath(f.region, far.id);
    if (!path?.length) return false;
    s.src.liveOrder({ type: 'move', fleet: f.id, path });
    return true;
  });
  if (moved) {
    await page.waitForTimeout(12000); // a couple of blitz ticks
    console.log('  live', JSON.stringify(await measure(page, 1500)));
    await hitTests(page, 'live');
  }
  check(await camOk(page), 'live: camera NaN');
  check(errors.length === 0, `live: page errors ${JSON.stringify(errors.slice(0, 3))}`);
  await ctx.close();
}

{
  // battle demo page: both reports, phone and desktop
  console.log('== battle demo');
  for (const dev of [DEVICES.desktop, DEVICES.phone]) {
    const ctx = await browser.newContext(dev);
    const page = await ctx.newPage();
    await page.routeWebSocket(/\?token=/, () => {});
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(new URL('battle-demo.html?mode=none', base).href);
    for (const m of ['threeWay', 'twoWay']) {
      await page.evaluate(m => { const b = window.__bv; b.openBattleViewer(b[m](), b.ctx); }, m);
      await page.waitForTimeout(4000);
      if (out) await page.screenshot({ path: `${out}/rc-demo-${dev.isMobile ? 'ph' : 'dt'}-${m}.png` });
      await page.keyboard.press('Escape'); await page.waitForTimeout(250);
    }
    check(errors.length === 0, `battle demo: page errors ${JSON.stringify(errors.slice(0, 3))}`);
    await ctx.close();
  }
}

await browser.close();
console.log(fails.length ? `\n${fails.length} check(s) failed` : '\nall render checks passed');
process.exit(fails.length ? 1 : 0);
