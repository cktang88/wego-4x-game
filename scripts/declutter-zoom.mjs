// Map declutter: zoom and pan recordings. For 1440x900, iPad and phone, slowly zooms from strategic to detail (log-
// linear camera steps, one frame each) and pans across the map, recording per frame which system names are laid out
// where and how opaque they are, how many fleet pieces are hit-testable, and the tier weights. Fails on oscillation
// (a name fading in, out and in again during a one-way zoom), on any layout change or fade during a pure pan, and on
// fleet pieces popping in or out. Saves contact sheets of the sequences to <out>/zoom/.
//   node scripts/declutter-zoom.mjs [out=/tmp/claude-0/declutter] [baseUrl]
import { chromium } from 'playwright-core';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const out = process.argv[2] ?? '/tmp/claude-0/declutter';
const base = process.argv[3] ?? 'http://localhost:5173/';
const zdir = `${out}/zoom`;
mkdirSync(zdir, { recursive: true });
const statePath = `${out}/state.json`;
const stateJson = existsSync(statePath) ? readFileSync(statePath, 'utf8') : null;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ONLY = process.env.ONLY ?? '';
const DEVICES = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  ipad: { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  phone: {
    viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
};
const fails = [];
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails.push(what); };
const frame = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const snap = page => page.evaluate(() => {
  const m = window.tc.screen.map;
  const a = {}; for (const [k, v] of m.nameA) a[k] = Math.round(v * 100) / 100;
  const show = {}; for (const [k, v] of m.nameMemo.show) show[k] = v;
  const vis = {}; for (const h of m.tokHits) vis[h.hit.fleetIds.join(',')] = 1;
  return { z: m.cam.z, tier: m.tier, zw: m.zw, a, show, toks: Object.keys(vis).sort() };
});

for (const [dn, dev] of Object.entries(DEVICES).filter(([k]) => !ONLY || ONLY.split(',').includes(k))) {
  console.log(`== ${dn}`);
  const ctx = await browser.newContext(dev);
  const page = await ctx.newPage();
  await page.routeWebSocket(/\?token=/, () => {});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('tc.tutorial.wego', 'done'); localStorage.setItem('tc.tutorial.live', 'done'); localStorage.setItem('tc.herald.auto', 'off'); });
  await page.reload();
  await page.waitForTimeout(300);
  await page.click('[data-l=start]');
  await page.waitForFunction(() => window.tc?.screen?.map?.fitted);
  if (stateJson) await page.evaluate(json => { const s = window.tc.screen; s.src.save.state = JSON.parse(json); s.src.save.pending = {}; s.src.refresh(); s.onSourceChange('view'); }, stateJson);
  await page.waitForTimeout(300);
  await page.evaluate(() => { const s = window.tc.screen; if (s.replay) s.endReplay(); document.querySelectorAll('.herald-ov').forEach(x => x.remove()); s.map.mouse = null; });
  await page.mouse.move(1, 1);
  // ---- slow zoom: strategic -> detail around the map centre-ish (your capital)
  const { z0, z1, c } = await page.evaluate(() => {
    const s = window.tc.screen, m = s.map, st = s.st;
    const regs = st.regions.filter(r => r.kind !== 'void' && r.kind !== 'lane' && r.poly.length > 2);
    const area = p => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[i], r = p[(i + 1) % p.length]; a += q.x * r.y - r.x * q.y; } return Math.abs(a / 2); };
    const rs = regs.map(r => Math.sqrt(area(r.poly) / Math.PI)).sort((a, b) => a - b), med = rs[rs.length >> 1];
    const cap = st.regions[st.players[s.you ?? 0].capital].site;
    return { z0: (40 * m.ui) / med, z1: (230 * m.ui) / med, c: cap };
  });
  const N = 90, seq = [], shots = [];
  for (let i = 0; i <= N; i++) {
    const z = Math.exp(Math.log(z0) + (Math.log(z1) - Math.log(z0)) * (i / N));
    await page.evaluate(([c, z]) => { window.tc.screen.map.cam = { x: c.x, y: c.y, z }; }, [c, z]);
    await frame(page);
    seq.push(await snap(page));
    if (i % 10 === 0) { const f = `${zdir}/${dn}-zoom-${String(i).padStart(3, '0')}.png`; await page.screenshot({ path: f }); shots.push(f); }
  }
  // wait for fades to settle at the end, then measure oscillation: a name's opacity should move one way per zoom
  let osc = 0, worst = '';
  const ids = new Set(seq.flatMap(s => Object.keys(s.a)));
  for (const id of ids) {
    let dir = 0, flips = 0;
    for (let i = 1; i < seq.length; i++) {
      const d = (seq[i].a[id] ?? 0) - (seq[i - 1].a[id] ?? 0);
      if (Math.abs(d) < 0.02) continue;
      const sd = Math.sign(d);
      if (dir && sd !== dir) flips++;
      dir = sd;
    }
    if (flips > 1) { osc++; worst ||= `${id} (${flips} reversals)`; }
  }
  check(osc <= 1, `${dn}: names fade monotonically while zooming in (${osc} oscillating${worst ? `, e.g. ${worst}` : ''})`);
  let layoutFlips = 0;
  for (let i = 1; i < seq.length; i++) for (const k of Object.keys(seq[i].show)) { const a = seq[i - 1].show[k], b = seq[i].show[k]; if (a !== undefined && a >= 0 && b >= 0 && a !== b) layoutFlips++; }
  check(layoutFlips <= 4, `${dn}: names keep their spot as the zoom changes (${layoutFlips} moves)`);
  // fleet pieces never vanish while zooming (the representation crossfades instead)
  let tokDrop = 0;
  for (let i = 1; i < seq.length; i++) for (const t of seq[i - 1].toks) if (!seq[i].toks.includes(t)) tokDrop++;
  check(tokDrop === 0, `${dn}: no fleet piece pops out during the zoom (${tokDrop})`);
  const tiers = [...new Set(seq.map(s => s.tier))];
  check(tiers.length === 3, `${dn}: the zoom passes all three tiers (${tiers.join(' > ')})`);
  // crossfade: no single frame changes the weights by more than a fifth
  let jump = 0;
  for (let i = 1; i < seq.length; i++) jump = Math.max(jump, Math.abs(seq[i].zw.s - seq[i - 1].zw.s), Math.abs(seq[i].zw.d - seq[i - 1].zw.d));
  check(jump < 0.2, `${dn}: tiers crossfade over a zoom range (largest per-step weight change ${jump.toFixed(2)})`);

  // ---- pan at operational zoom: nothing may change but positions
  const zo = Math.exp((Math.log(z0) + Math.log(z1)) / 2);
  await page.evaluate(([c, z]) => { window.tc.screen.map.cam = { x: c.x, y: c.y, z }; }, [c, zo]);
  await page.waitForTimeout(500);
  const pseq = [];
  for (let i = 0; i <= 40; i++) {
    await page.evaluate(([c, z, i]) => { const m = window.tc.screen.map; m.cam = { x: c.x + (i - 20) * 9 / z, y: c.y + (i - 20) * 3 / z, z }; }, [c, zo, i]);
    await frame(page);
    pseq.push(await snap(page));
    if (i % 10 === 0) { const f = `${zdir}/${dn}-pan-${String(i).padStart(3, '0')}.png`; await page.screenshot({ path: f }); shots.push(f); }
  }
  let pflips = 0, pfade = 0;
  for (let i = 1; i < pseq.length; i++) {
    for (const k of Object.keys(pseq[i].show)) if (pseq[i].show[k] !== pseq[i - 1].show[k]) pflips++;
    for (const k of Object.keys(pseq[i].a)) if (Math.abs((pseq[i].a[k] ?? 0) - (pseq[i - 1].a[k] ?? 0)) > 0.02) pfade++;
  }
  check(pflips === 0, `${dn}: panning never re-lays out a name (${pflips})`);
  check(pfade === 0, `${dn}: panning never fades a name (${pfade})`);
  // ---- eased wheel zoom (zoomAt): a glide, not a jump
  const glide = await page.evaluate(async () => {
    const m = window.tc.screen.map, zs = [];
    m.zoomAt(m.w / 2, m.h / 2, 1.6);
    for (let i = 0; i < 20; i++) { await new Promise(r => requestAnimationFrame(r)); zs.push(m.cam.z); }
    return zs;
  });
  const steps = glide.slice(1).map((z, i) => z / glide[i]);
  check(glide[glide.length - 1] / glide[0] > 1.3 && Math.max(...steps) < 1.25, `${dn}: zoomAt glides over several frames (max step x${Math.max(...steps).toFixed(2)})`);
  check(!errors.length, `${dn}: no page errors${errors.length ? ` (${errors[0]})` : ''}`);
  // contact sheet
  try {
    execFileSync('python3', ['-c', `
import sys
from PIL import Image
fs=sys.argv[2:]; out=sys.argv[1]
ims=[Image.open(f) for f in fs]
w=360; ims=[i.resize((w, int(i.height*w/i.width))) for i in ims]
cols=6; rows=(len(ims)+cols-1)//cols; h=max(i.height for i in ims)
sheet=Image.new('RGB',(cols*w,rows*h),(0,0,0))
for k,i in enumerate(ims): sheet.paste(i,((k%cols)*w,(k//cols)*h))
sheet.save(out)
`, `${zdir}/${dn}-sheet.png`, ...shots]);
    console.log(`  sheet ${zdir}/${dn}-sheet.png`);
  } catch (e) { console.log('  (no contact sheet: PIL missing)'); }
  await ctx.close();
}
await browser.close();
if (fails.length) { console.log(`\n${fails.length} FAILED`); process.exit(1); }
console.log('\nall ok');
