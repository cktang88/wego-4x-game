// UX v2 map renderer screenshots from a self-contained harness: constructs MapRenderer directly from a simulated
// game (createGame + AI turns until a battle is on), so it works whatever state the game shell is in.
// node scripts/map-v2-shots.mjs <outdir> [baseUrl]     (needs `npm run dev`)
// Shots: three tiers, each lens, peek, a battle, a siege, drag arrows, an expanded stack; desktop 1440x900 and
// iPhone 15 Pro emulation. Also prints idle frame cost per tier.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { bootHarness } from './map-harness.mjs';
const out = process.argv[2] ?? '/tmp/claude-0/v2-map';
const base = process.argv[3] ?? 'http://localhost:5173/';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const DEVICES = {
  dt: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  ph: {
    viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
};
const errors = [];
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;

const boot = page => bootHarness(page, base, errors);

const setCam = (page, how) => page.evaluate(how => {
  const { map, full: s } = window.H;
  const R = window.H.M ? null : null; void R;
  const med = (() => { const rs = s.regions.filter(r => r.poly.length > 2 && r.kind !== 'void').map(r => { let a = 0; const p = r.poly; for (let i = 0; i < p.length; i++) { const q = p[i], w = p[(i + 1) % p.length]; a += q.x * w.y - w.x * q.y; } return Math.sqrt(Math.abs(a / 2) / Math.PI); }).sort((a, b) => a - b); return rs[rs.length >> 1]; })();
  let c = how.center;
  if (how.region !== undefined) c = s.regions[how.region].site;
  if (!c) { let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9; for (const r of s.regions) for (const p of r.poly) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); } c = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }; }
  map.cam = { x: c.x, y: c.y + (how.dy ?? 0), z: how.Rs ? how.Rs / med : how.z ?? map.cam.z };
  return { z: map.cam.z, med };
}, how);

const settle = (page, ms = 450) => page.waitForTimeout(ms);
const tierOf = page => page.evaluate(() => window.H.map.tier);

async function idleCost(page) {
  await page.evaluate(() => { window.H.frameCost.length = 0; });
  await page.waitForTimeout(1200);
  return page.evaluate(() => { const a = window.H.frameCost.slice(5).sort((x, y) => x - y); return { n: a.length, avg: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2), p95: +a[Math.floor(a.length * 0.95)].toFixed(2) }; });
}

for (const [tag, dev] of Object.entries(DEVICES)) {
  const ctx = await browser.newContext(dev);
  const page = await ctx.newPage();
  await boot(page);
  const info = await page.evaluate(() => {
    const s = window.H.full;
    const e = s.engagements.find(x => s.regions[x.region].garrison > 0) ?? s.engagements[0];
    return { turn: s.turn, eng: e ? e.region : null, engs: s.engagements.map(x => [x.region, s.regions[x.region].name, s.regions[x.region].garrison]), cap: s.players[0].capital };
  });
  console.log(tag, 'turn', info.turn, 'engagements', JSON.stringify(info.engs));
  const shot = async (name, o = {}) => {
    if (only && !only.some(k => name.includes(k))) return;
    await page.evaluate(o => { window.H.opts = o.opts ?? {}; window.H.fog = o.fog ?? true; }, o);
    await setCam(page, o.cam ?? {});
    await settle(page, o.wait ?? 450);
    const tier = await tierOf(page);
    await page.screenshot({ path: `${out}/${tag}-${name}.png` });
    console.log(`  ${tag}-${name}.png  tier=${tier}`);
  };
  const isPh = tag === 'ph';
  await shot('tier1-strategic', { cam: { Rs: isPh ? 40 : 55 } });
  await shot('tier2-operational', { cam: { Rs: isPh ? 100 : 95 } });
  await shot('tier3-detail', { cam: { Rs: isPh ? 200 : 230, region: info.cap } });
  await shot('lens-supply', { cam: { Rs: isPh ? 100 : 95 }, opts: { lens: 'supply' } });
  await shot('lens-economy', { cam: { Rs: isPh ? 100 : 95 }, opts: { lens: 'economy' } });
  await shot('lens-military', { cam: { Rs: isPh ? 100 : 95 }, opts: { lens: 'military' } });
  await shot('peek', { cam: { Rs: isPh ? 60 : 70 }, opts: { peek: true } });
  if (info.eng !== null) {
    await shot('battle-operational', { cam: { Rs: isPh ? 110 : 120, region: info.eng } });
    await shot('battle-strategic', { cam: { Rs: isPh ? 45 : 60, region: info.eng } });
    await shot('siege-detail', { cam: { Rs: isPh ? 190 : 220, region: info.eng }, opts: { selRegion: info.eng } });
  }
  // drag arrows (seize / move / overdrive / invalid) from your capital
  const drag = await page.evaluate(() => {
    const s = window.H.full, cap = s.regions[s.players[0].capital];
    const n = cap.neighbors.map(i => s.regions[i]);
    return { from: cap.site, a: n[0]?.site, b: n[1]?.site ?? n[0]?.site, c: n[2]?.site ?? n[0]?.site, col: s.players[0].color, nid: n.map(x => x.id) };
  });
  const hl = drag.nid.map(i => [i, '#ffffff']);
  for (const verb of ['seize', 'move', 'od', 'invalid', 'merge']) {
    await shot(`drag-${verb}`, { cam: { Rs: isPh ? 110 : 120, center: drag.from }, opts: { drag: { from: drag.from, to: verb === 'invalid' ? { x: drag.from.x + 300, y: drag.from.y - 260 } : drag.a, verb, color: verb === 'seize' ? '#ff5d7a' : drag.col }, highlight: hl } });
  }
  await shot('expanded-stack', { cam: { Rs: isPh ? 110 : 120, region: info.cap }, opts: { expanded: info.cap } });
  // idle frame cost per tier (fog on)
  for (const [n, Rs] of [['strategic', 55], ['operational', 95], ['detail', 230]]) {
    await page.evaluate(() => { window.H.opts = {}; });
    await setCam(page, { Rs, region: n === 'detail' ? info.cap : undefined });
    await settle(page, 300);
    console.log(`  ${tag} idle ${n}`, JSON.stringify(await idleCost(page)));
  }
  await ctx.close();
}
await browser.close();
console.log(errors.length ? `page errors: ${JSON.stringify(errors.slice(0, 5))}` : 'no page errors');
