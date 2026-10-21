// Art review screenshots of the map renderer (harness, no game shell): every tier on desktop 1440x900 and iPhone 15
// Pro, close-ups of minis, a battle, a siege, lanes with a moving fleet, effects (capture, build, explode, warden,
// stamps), plus idle frame cost per tier. node scripts/art-shots.mjs <outdir> [baseUrl]   (needs `npm run dev`)
// ONLY=a,b limits shots by name substring; DEV=dt|ph limits devices.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { bootHarness } from './map-harness.mjs';
const out = process.argv[2] ?? '/tmp/claude-0/art/shots';
const base = process.argv[3] ?? 'http://localhost:5173/';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const DEVICES = {
  dt: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  dt2: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  ph: {
    viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
};
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const devs = process.env.DEV ? process.env.DEV.split(',') : ['dt', 'ph'];
const errors = [];

const setCam = (page, how) => page.evaluate(how => {
  const { map, full: s } = window.H;
  const med = (() => { const rs = s.regions.filter(r => r.poly.length > 2 && r.kind !== 'void').map(r => { let a = 0; const p = r.poly; for (let i = 0; i < p.length; i++) { const q = p[i], w = p[(i + 1) % p.length]; a += q.x * w.y - w.x * q.y; } return Math.sqrt(Math.abs(a / 2) / Math.PI); }).sort((a, b) => a - b); return rs[rs.length >> 1]; })();
  let c = how.center;
  if (how.region !== undefined) c = s.regions[how.region].site;
  if (!c) { let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9; for (const r of s.regions) for (const p of r.poly) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); } c = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }; }
  map.cam = { x: c.x + (how.dx ?? 0), y: c.y + (how.dy ?? 0), z: how.Rs / med };
  return map.cam;
}, how);

for (const tag of devs) {
  const ctx = await browser.newContext(DEVICES[tag]);
  const page = await ctx.newPage();
  await bootHarness(page, base, errors, true);
  const info = await page.evaluate(() => {
    const s = window.H.full;
    const e = s.engagements.find(x => s.regions[x.region].garrison > 0) ?? s.engagements[0];
    const own = s.fleets.filter(f => f.owner === 0);
    const by = new Map(); for (const f of own) by.set(f.region, (by.get(f.region) ?? 0) + 1);
    const stack = [...by].sort((a, b) => b[1] - a[1])[0]?.[0] ?? s.players[0].capital;
    const big = s.fleets.slice().sort((a, b) => b.ships.length - a.ships.length)[0];
    const mover = s.fleets.find(f => f.route?.path?.length);
    return { eng: e ? e.region : null, cap: s.players[0].capital, stack, big: big?.region, mover: mover?.region ?? null };
  });
  const isPh = tag === 'ph';
  const shot = async (name, o = {}) => {
    if (only && !only.some(k => name.includes(k))) return;
    await page.evaluate(o => { window.H.opts = o.opts ?? {}; window.H.fog = o.fog ?? true; }, o);
    await setCam(page, o.cam ?? { Rs: 95 });
    if (o.before) await page.evaluate(o.before);
    await page.waitForTimeout(o.wait ?? 500);
    const tier = await page.evaluate(() => window.H.map.tier);
    await page.screenshot({ path: `${out}/${tag}-${name}.png`, clip: o.clip });
    console.log(`  ${tag}-${name}.png tier=${tier}`);
  };
  await shot('t1-strategic', { cam: { Rs: isPh ? 40 : 55 } });
  await shot('t2-operational', { cam: { Rs: isPh ? 100 : 110, region: info.cap } });
  await shot('t3-detail', { cam: { Rs: isPh ? 200 : 260, region: info.cap } });
  await shot('t3-detail-stack', { cam: { Rs: isPh ? 200 : 260, region: info.stack } });
  await shot('t3-detail-big', { cam: { Rs: isPh ? 240 : 320, region: info.big } });
  if (info.eng !== null) {
    await shot('battle-op', { cam: { Rs: isPh ? 110 : 130, region: info.eng } });
    await shot('battle-detail', { cam: { Rs: isPh ? 210 : 280, region: info.eng } });
    await shot('battle-strat', { cam: { Rs: isPh ? 45 : 60, region: info.eng } });
    await shot('siege-detail', { cam: { Rs: isPh ? 210 : 280, region: info.eng }, opts: { selRegion: info.eng } });
  }
  if (info.mover !== null) await shot('lanes-moving', { cam: { Rs: isPh ? 120 : 150, region: info.mover } });
  await shot('expanded', { cam: { Rs: isPh ? 120 : 130, region: info.stack }, opts: { expanded: info.stack } });
  await shot('lens-military', { cam: { Rs: isPh ? 100 : 110, region: info.cap }, opts: { lens: 'military' } });
  // effects at the capital
  const fx = async (name, kinds) => shot(name, {
    cam: { Rs: isPh ? 160 : 200, region: info.cap }, wait: 650,
    before: `(() => { const H = window.H, s = H.full, r = s.regions[s.players[0].capital], n = s.regions[r.neighbors[0]]; const now = performance.now(); H.extraFx = ${JSON.stringify(kinds)}.map((k, i) => ({ kind: k, pos: i % 2 ? n.site : r.site, color: s.players[i % 3].color, t0: now - 100, dur: 2200, text: k === 'stamp' ? (i % 2 ? 'CAUGHT OUT' : 'CALLED IT') : k === 'text' ? '+12' : undefined, cls: 'cruiser', owner: 0, size: 1.4 })); })()`,
  });
  await fx('fx-capture-build', ['capture', 'build']);
  await fx('fx-explode-warden', ['explode', 'warden']);
  await fx('fx-stamp', ['stamp', 'excavate']);
  for (const [n, Rs] of [['strategic', isPh ? 40 : 55], ['operational', isPh ? 100 : 110], ['detail', isPh ? 200 : 260]]) {
    await page.evaluate(() => { window.H.opts = {}; window.H.extraFx = []; });
    await setCam(page, { Rs, region: n === 'strategic' ? undefined : info.cap });
    await page.waitForTimeout(400);
    await page.evaluate(() => { window.H.frameCost.length = 0; });
    await page.waitForTimeout(1500);
    const c = await page.evaluate(() => { const a = window.H.frameCost.slice(5).sort((x, y) => x - y); return { n: a.length, avg: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2), p95: +a[Math.floor(a.length * 0.95)].toFixed(2) }; });
    console.log(`  ${tag} idle ${n}`, JSON.stringify(c));
  }
  await ctx.close();
}
await browser.close();
const errs = errors.filter(e => !/seesFleet|Failed to load resource/.test(e));
console.log(errs.length ? `page errors: ${JSON.stringify(errs.slice(0, 5))}` : 'no page errors');
