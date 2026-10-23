// Before/after captures for the board's art direction (docs/STYLE-EXPLORE.md, direction C: the enamel and gold orrery).
// Plays ~11 AI turns once (the state is saved to <out>/state.json and reused, so "before" and "after" show the same
// board), then for 1440x900, 2560x1440, iPad landscape and an iPhone 15 Pro shoots: the three zoom tiers, a battle
// close-up, the most crowded star, the lobby and the battle viewer (battle-demo page). Also measures the frame cost
// while panning and zooming (JS time per animation frame, which includes the map's whole 2D draw).
//   node scripts/orrery-shots.mjs <tag: before|after> [out=/tmp/claude-0/orrery] [base]
import { chromium } from 'playwright-core';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
const tag = process.argv[2] ?? 'after';
const root = process.argv[3] ?? '/tmp/claude-0/orrery';
const base = process.argv[4] ?? 'http://localhost:5173/';
const out = `${root}/${tag}`;
mkdirSync(out, { recursive: true });
const statePath = `${root}/state.json`;
const ONLY = (process.env.ONLY ?? '').split(',').filter(Boolean);
const SKIP = (process.env.SKIP ?? '').split(',').filter(Boolean);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const phoneUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const DEV = {
  d1440: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  d2560: { viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 },
  ipad: { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  phone: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: phoneUA },
};
// on-screen median region radius (design px) per tier
const TIERS = { strategic: 52, operational: 110, detail: 230 };
const perf = {};
const errors = [];

async function openGame(dev) {
  const ctx = await browser.newContext(dev);
  const page = await ctx.newPage();
  await page.routeWebSocket(/\?token=/, () => {});
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('tc.tutorial.wego', 'done'); localStorage.setItem('tc.tutorial.live', 'done'); localStorage.setItem('tc.herald.auto', 'off'); });
  await page.reload();
  await page.waitForTimeout(400);
  return { ctx, page };
}
async function startGame(page) {
  await page.click('[data-l=start]');
  await page.waitForFunction(() => window.tc?.screen?.map?.fitted);
  await page.waitForTimeout(800);
  if (existsSync(statePath)) {
    await page.evaluate(json => { const s = window.tc.screen; s.src.save.state = JSON.parse(json); s.src.save.pending = {}; s.src.refresh(); s.onSourceChange('view'); }, readFileSync(statePath, 'utf8'));
  } else {
    const me = await page.evaluate(() => window.tc.screen.you);
    await page.evaluate(() => { const s = window.tc.screen; s.src.save.seats[s.you].kind = 'ai'; s.plan.orders = s.plan.orders.map(() => null); s.savePlan(); });
    // play on until a battle is being fought (turn 8 or later) so the battle close-up has one
    for (let i = 0; i < 26; i++) {
      await page.evaluate(() => { try { window.tc.screen.src.advance(); } catch { /* */ } });
      if (i >= 7 && await page.evaluate(() => (window.tc.screen.src.save.state.engagements ?? []).length > 0)) break;
    }
    await page.evaluate(a => { const s = window.tc.screen; s.src.save.seats[a].kind = 'human'; s.src.save.current = a; s.src.save.reveal = false; s.src.refresh(); s.onSourceChange('view'); }, me);
    writeFileSync(statePath, await page.evaluate(() => JSON.stringify(window.tc.screen.src.save.state)));
  }
  await page.waitForTimeout(500);
  await page.evaluate(async () => {
    const s = window.tc.screen; if (s.replay) s.endReplay();
    const M = await import('/src/ui/modals.ts'); if (M.isModalOpen()) M.closeModal();
    document.querySelectorAll('.herald-ov, .saga-ov, .bv-overlay, .overlay, .dl-title, .cr-room, .callout').forEach(x => x.remove());
    s.hud.closePopovers?.(); s.deselect?.(); s.hideTip?.(); s.map.mouse = null;
  });
  await page.mouse.move(1, 1);
}
/** Camera on a target at a tier (`Rs` design px median region radius). */
async function aim(page, what, Rs) {
  return page.evaluate(({ what, Rs }) => {
    const s = window.tc.screen, st = s.st, map = s.map;
    const area = p => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[i], w = p[(i + 1) % p.length]; a += q.x * w.y - w.x * q.y; } return Math.abs(a / 2); };
    const rs = st.regions.filter(r => r.poly.length > 2 && r.kind !== 'void' && r.kind !== 'lane').map(r => Math.sqrt(area(r.poly) / Math.PI)).sort((a, b) => a - b);
    const med = rs[rs.length >> 1];
    let c, label = what;
    if (what === 'board') { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const r of st.regions) for (const p of r.poly) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); } c = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }; }
    else if (what === 'battle') { const e = st.engagements?.[0]; const r = e ? st.regions[e.region] : st.regions.find(q => q.kind === 'throne'); c = r.site; label = `battle@${r.name}`; }
    else if (what === 'crowded') {
      // the star with the most owners parked at it, crowns and contests breaking ties
      let best = null, bs = -1;
      for (const r of st.regions) {
        if (r.kind === 'lane' || r.kind === 'void') continue;
        const owners = new Set(st.fleets.filter(f => f.region === r.id && f.ships.length).map(f => f.owner));
        const sc = owners.size * 10 + (r.kind === 'crown' || r.kind === 'throne' ? 4 : 0) + (st.engagements?.some(e => e.region === r.id) ? 3 : 0) + st.fleets.filter(f => f.region === r.id).length;
        if (sc > bs) { bs = sc; best = r; }
      }
      c = best.site; label = `crowded@${best.name}`;
    } else c = st.regions[st.players[s.you ?? 0].capital].site;
    map.cam = { x: c.x, y: c.y, z: (Rs * map.ui) / med };
    map.invalidate?.();
    return label;
  }, { what, Rs });
}

for (const [dn, dev] of Object.entries(DEV)) {
  if (ONLY.length && !ONLY.includes(dn)) continue;
  console.log(`== ${dn}`);
  // ---- lobby
  {
    const { ctx, page } = await openGame(dev);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${out}/${dn}-lobby.png` });
    await ctx.close();
  }
  // ---- board
  const { ctx, page } = await openGame(dev);
  await startGame(page);
  for (const [tier, Rs] of Object.entries(TIERS)) {
    await aim(page, tier === 'strategic' ? 'board' : 'capital', Rs);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/${dn}-${tier}.png` });
  }
  for (const w of ['battle', 'crowded']) {
    const lab = await aim(page, w, w === 'battle' ? 200 : 150);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/${dn}-${w}.png` });
    console.log(`  ${w}: ${lab}`);
  }
  // ---- frame cost while panning and zooming (JS per rAF; the map draw is all of it)
  if (!SKIP.includes('perf')) {
    const r = await page.evaluate(async () => {
      const m = window.tc.screen.map, st = window.tc.screen.st;
      const area = p => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[i], w = p[(i + 1) % p.length]; a += q.x * w.y - w.x * q.y; } return Math.abs(a / 2); };
      const rs = st.regions.filter(r => r.poly.length > 2 && r.kind !== 'void' && r.kind !== 'lane').map(r => Math.sqrt(area(r.poly) / Math.PI)).sort((a, b) => a - b), med = rs[rs.length >> 1];
      const cap = st.regions[st.players[window.tc.screen.you ?? 0].capital].site;
      const proto = Object.getPrototypeOf(m), draw0 = proto.draw;
      let acc = [];
      proto.draw = function (I) { const t = performance.now(); draw0.call(this, I); acc.push(performance.now() - t); };
      const frame = () => new Promise(r => requestAnimationFrame(() => r()));
      const stats = a => { const s = a.slice().sort((x, y) => x - y); return { n: s.length, mean: +(s.reduce((x, y) => x + y, 0) / Math.max(1, s.length)).toFixed(2), p95: +(s[Math.floor(s.length * 0.95)] ?? 0).toFixed(2), max: +(s[s.length - 1] ?? 0).toFixed(1) }; };
      const out = {};
      for (const [nm, Rs] of [['pan-strategic', 52], ['pan-operational', 110], ['pan-detail', 230]]) {
        const z = Rs * m.ui / med;
        m.cam = { x: cap.x, y: cap.y, z }; await frame(); await frame(); await new Promise(r => setTimeout(r, 300));
        acc = [];
        for (let i = 0; i < 90; i++) { m.cam = { x: cap.x + Math.sin(i / 14) * 260 / z, y: cap.y + Math.cos(i / 19) * 140 / z, z }; await frame(); }
        out[nm] = stats(acc);
      }
      // a zoom sweep strategic -> detail -> strategic, one frame per step (the camera never settles: the cached layer
      // is blitted while moving and rebuilt only when the zoom leaves its range)
      acc = [];
      const z0 = 40 * m.ui / med, z1 = 240 * m.ui / med;
      for (let i = 0; i <= 120; i++) { const k = i <= 60 ? i / 60 : 2 - i / 60; m.cam = { x: cap.x, y: cap.y, z: Math.exp(Math.log(z0) + (Math.log(z1) - Math.log(z0)) * k) }; await frame(); }
      out.zoom = stats(acc);
      // wheel-style glides: zoomAt, then settle (the rebuild after a zoom lands here)
      acc = [];
      m.cam = { x: cap.x, y: cap.y, z: 60 * m.ui / med }; await frame(); await new Promise(r => setTimeout(r, 300));
      for (let k = 0; k < 6; k++) { m.zoomAt(m.w / 2, m.h / 2, k < 3 ? 1.5 : 1 / 1.5); for (let i = 0; i < 24; i++) await frame(); }
      out.glide = stats(acc);
      proto.draw = draw0;
      return out;
    });
    perf[dn] = r;
    console.log(`  perf ${JSON.stringify(r)}`);
  }
  await ctx.close();
  // ---- battle viewer (demo page)
  {
    const c2 = await browser.newContext(dev);
    const p2 = await c2.newPage();
    await p2.routeWebSocket(/\?token=/, () => {});
    p2.on('pageerror', e => errors.push(e.message));
    await p2.goto(`${base}battle-demo.html?mode=3`);
    await p2.waitForTimeout(5200);
    await p2.screenshot({ path: `${out}/${dn}-viewer.png` });
    await c2.close();
  }
}
writeFileSync(`${out}/perf.json`, JSON.stringify(perf, null, 1));
await browser.close();
console.log(errors.length ? `page errors: ${JSON.stringify([...new Set(errors)].slice(0, 5))}` : 'no page errors');
