// Map declutter: before/after screenshots of ONE mid-game state (turn ~9, fleets, a battle, a planned route) at
// strategic / operational / detail zoom on desktop, iPad and phone, plus a hover-tooltip shot per device.
//   node scripts/declutter-shots.mjs <tag=before|after> [outDir=/tmp/claude-0/declutter] [baseUrl]
// The first run generates the state (AI plays every seat) and saves it to <outDir>/state.json; later runs reuse it.
import { chromium } from 'playwright-core';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
const tag = process.argv[2] ?? 'after';
const out = process.argv[3] ?? '/tmp/claude-0/declutter';
const base = process.argv[4] ?? 'http://localhost:5173/';
mkdirSync(out, { recursive: true });
const statePath = `${out}/state.json`;
// the sim, imported in the page to generate the state and plan my orders (env SHARED for a copy served elsewhere)
const SHARED = process.env.SHARED ?? '/@fs/home/user/wego-4x-game/shared/index.ts';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const DEVICES = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  ipad: { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  phone: {
    viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
};
const frames = (page, n = 3) => page.evaluate(n => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const errors = [];

async function open(dev) {
  const ctx = await browser.newContext(dev);
  const page = await ctx.newPage();
  await page.routeWebSocket(/\?token=/, () => {});
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('tc.tutorial.wego', 'done'); localStorage.setItem('tc.tutorial.live', 'done'); localStorage.setItem('tc.herald.auto', 'off'); });
  await page.reload();
  await page.waitForTimeout(400);
  await page.click('[data-l=start]');
  await page.waitForFunction(() => window.tc?.screen?.map?.fitted);
  await page.evaluate(s => { window.__SHARED = s; }, SHARED);
  return { ctx, page };
}

// ---- the state: generated once
if (!existsSync(statePath)) {
  const { ctx, page } = await open(DEVICES.desktop);
  const json = await page.evaluate(async () => {
    const sim = await import(window.__SHARED);
    let st = window.tc.screen.src.save.state;
    const me = window.tc.screen.you;
    let best = null;
    for (let t = 0; t < 14; t++) {
      const subs = {};
      for (let i = 0; i < 3; i++) subs[i] = sim.planTurn(st, i);
      st = sim.resolveTurn(st, subs);
      const battle = (st.engagements ?? []).length > 0;
      const mine = st.fleets.some(f => f.owner === me && f.ships.length);
      if (st.turn >= 8 && battle && mine) { best = st; break; }
      if (st.turn >= 8 && mine && !best) best = st;
    }
    return JSON.stringify(best ?? st);
  });
  writeFileSync(statePath, json);
  await ctx.close();
  console.log('generated state', statePath);
}
const stateJson = readFileSync(statePath, 'utf8');

async function load(page) {
  return page.evaluate(async json => {
    const sim = await import(window.__SHARED);
    const s = window.tc.screen;
    s.src.save.state = JSON.parse(json);
    s.src.save.pending = {};
    s.src.refresh();
    s.onSourceChange('view');
    if (s.replay) s.endReplay();
    document.querySelectorAll('.herald-ov').forEach(x => x.remove());
    const st = s.st, me = s.you;
    // my plan this turn: what the AI would order (moves and seizes give planned arrows)
    const p = s.normalizePlan(sim.planTurn(st, me));
    if (p) { s.plan = p; s.savePlan(); s.renderAll(); }
    const e = (st.engagements ?? [])[0];
    const mine = st.fleets.filter(f => f.owner === me && f.ships.length);
    const focus = e ? st.regions[e.region].site : st.regions[mine[0]?.region ?? st.players[me].capital].site;
    const cap = st.regions[st.players[me].capital].site;
    return { focus: { x: (focus.x + cap.x) / 2, y: (focus.y + cap.y) / 2 }, battle: e?.region ?? null, turn: st.turn, myFleets: mine.length, orders: s.plan.orders.filter(Boolean).length };
  }, stateJson);
}

const Z = { strategic: 58, operational: 112, detail: 200 };   // on-screen median region radius (design px)
for (const [dn, dev] of Object.entries(DEVICES)) {
  const { ctx, page } = await open(dev);
  const info = await load(page);
  await page.waitForTimeout(300);
  await page.evaluate(() => { const s = window.tc.screen; if (s.replay) s.endReplay(); document.querySelectorAll('.herald-ov').forEach(x => x.remove()); });
  console.log(dn, JSON.stringify(info));
  for (const [tn, sr] of Object.entries(Z)) {
    const tier = await page.evaluate(([f, sr, phone]) => {
      const m = window.tc.screen.map, st = window.tc.screen.st;
      const regs = st.regions.filter(r => r.kind !== 'void' && r.kind !== 'lane' && r.poly.length > 2);
      const area = p => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[i], r = p[(i + 1) % p.length]; a += q.x * r.y - r.x * q.y; } return Math.abs(a / 2); };
      const rs = regs.map(r => Math.sqrt(area(r.poly) / Math.PI)).sort((a, b) => a - b);
      const med = rs[rs.length >> 1];
      m.cam = { x: f.x, y: f.y + (phone ? 40 : 0), z: (sr * m.ui) / med };
      window.tc.screen.hoverRegion = null; m.mouse = null;
      return null;
    }, [info.focus, sr, dn === 'phone']);
    void tier;
    await page.mouse.move(1, 1);
    await page.waitForTimeout(450);
    await frames(page, 4);
    const t = await page.evaluate(() => window.tc.screen.map.tier);
    await page.screenshot({ path: `${out}/${tag}-${dn}-${tn}.png` });
    console.log('  shot', `${tag}-${dn}-${tn}.png`, 'tier', t);
  }
  // hover / tap a star and a fleet at operational zoom (the tooltip, after)
  await page.evaluate(([f, sr]) => {
    const m = window.tc.screen.map, st = window.tc.screen.st;
    const regs = st.regions.filter(r => r.kind !== 'void' && r.kind !== 'lane' && r.poly.length > 2);
    const area = p => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[i], r = p[(i + 1) % p.length]; a += q.x * r.y - r.x * q.y; } return Math.abs(a / 2); };
    const rs = regs.map(r => Math.sqrt(area(r.poly) / Math.PI)).sort((a, b) => a - b);
    m.cam = { x: f.x, y: f.y, z: (sr * m.ui) / rs[rs.length >> 1] };
  }, [info.focus, Z.operational]);
  await page.waitForTimeout(400);
  const tgt = await page.evaluate(() => {
    const s = window.tc.screen, st = s.st, m = s.map, me = s.you;
    const rc = s.el.canvas.getBoundingClientRect();
    const inView = p => p.x > 60 && p.y > 90 && p.x < m.w - 60 && p.y < m.h - 160;
    const star = st.regions.filter(r => r.kind !== 'lane' && r.kind !== 'void' && r.owner !== me).map(r => ({ r, p: m.toScreen(r.site) })).find(q => inView(q.p));
    const fl = st.fleets.filter(f => f.owner === me && f.ships.length).map(f => ({ f, p: m.tokenScreenPos(f.region, me) })).find(q => inView(q.p));
    return { star: star ? [star.p.x + rc.left, star.p.y + rc.top] : null, fleet: fl ? [fl.p.x + rc.left, fl.p.y + rc.top - 8] : null };
  });
  const touch = !!dev.hasTouch;
  for (const [k, xy] of Object.entries(tgt)) {
    if (!xy) continue;
    if (touch) await page.touchscreen.tap(xy[0], xy[1]); else await page.mouse.move(xy[0], xy[1]);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${tag}-${dn}-hover-${k}.png` });
    if (touch) { await page.evaluate(() => window.tc.screen.deselect()); await page.waitForTimeout(200); }
  }
  await ctx.close();
}
await browser.close();
if (errors.length) { console.log('page errors:', errors.slice(0, 5)); process.exit(1); }
console.log('done');
