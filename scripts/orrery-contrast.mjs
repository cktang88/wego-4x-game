// Readability of every indicator on the LIVE board (adapted from scripts/style-explore-shots.mjs, which measured the
// style lab): the map draws one frame with every mark and leaves a probe per indicator, then the ground alone (and the
// bare ground for walls and resting lanes), and MapRenderer.measureContrast() scores each probe the way
// docs/STYLE-EXPLORE.md §2 does. Runs the three tiers, a battle and the most crowded star, with one of your fleets
// selected (strength, lit lanes) and without, on 1440x900, 2560x1440, iPad landscape and an iPhone 15 Pro, on the
// saved mid-game board (scripts/orrery-shots.mjs makes it) and on turn 1 (mostly fogged).
// Target: no indicator under 4.5:1 (resting lanes are quiet by design: reported, not held).
//   node scripts/orrery-contrast.mjs [out=/tmp/claude-0/orrery] [base]       DEV=d1440,phone  narrows the run
import { chromium } from 'playwright-core';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
const out = process.argv[2] ?? '/tmp/claude-0/orrery';
const base = process.argv[3] ?? 'http://localhost:5173/';
mkdirSync(`${out}/contrast`, { recursive: true });
const statePath = `${out}/state.json`;
const phoneUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const DEV = {
  d1440: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  d2560: { viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 },
  ipad: { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  phone: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: phoneUA },
};
const devs = (process.env.DEV ?? Object.keys(DEV).join(',')).split(',');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const all = [];
const worst = {};
let errors = 0;

const VIEWS = [
  ['strategic', 'board', 50], ['strategic-capital', 'capital', 62], ['operational', 'capital', 110], ['detail', 'capital', 230],
  ['battle-op', 'battle', 120], ['battle-detail', 'battle', 220], ['crowded', 'crowded', 150], ['throne', 'throne', 120],
];

for (const dn of devs) {
  for (const board of ['mid', 'turn1']) {
    if (board === 'mid' && !existsSync(statePath)) { console.log('no saved board: run scripts/orrery-shots.mjs first'); continue; }
    const ctx = await browser.newContext(DEV[dn]);
    const page = await ctx.newPage();
    await page.routeWebSocket(/\?token=/, () => {});
    page.on('pageerror', e => { errors++; console.log('pageerror', e.message); });
    await page.goto(base);
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem('tc.tutorial.wego', 'done'); localStorage.setItem('tc.tutorial.live', 'done'); localStorage.setItem('tc.herald.auto', 'off'); });
    await page.reload(); await page.waitForTimeout(300);
    await page.click('[data-l=start]');
    await page.waitForFunction(() => window.tc?.screen?.map?.fitted);
    if (board === 'mid') await page.evaluate(json => { const s = window.tc.screen; s.src.save.state = JSON.parse(json); s.src.save.pending = {}; s.src.refresh(); s.onSourceChange('view'); }, readFileSync(statePath, 'utf8'));
    await page.waitForTimeout(600);
    // routes on the board (the saved state may have none): two of yours and two rivals', a move and a seize each
    await page.evaluate(() => {
      const st = window.tc.screen.st, you = window.tc.screen.you;
      const links = r => r.links ?? r.neighbors;
      const bfs = (from, hops) => {
        const prev = new Map([[from, -1]]); let q = [from];
        for (let d = 0; d < 12 && q.length; d++) { const n = []; for (const x of q) for (const y of links(st.regions[x])) if (!prev.has(y)) { prev.set(y, x); n.push(y); } q = n; }
        const sys = [...prev.keys()].filter(k => k !== from && st.regions[k].kind !== 'lane' && st.regions[k].kind !== 'void');
        const t = sys[Math.min(sys.length - 1, hops)];
        const path = []; for (let c = t; c !== from && c !== -1; c = prev.get(c)) path.unshift(c);
        return path;
      };
      let mine = 0, theirs = 0;
      for (const f of st.fleets) {
        if (!f.ships.length || f.route?.path?.length) continue;
        const isMine = f.owner === you;
        if (isMine ? mine >= 2 : theirs >= 2) continue;
        const k = isMine ? mine++ : theirs++;
        const path = bfs(f.region, 2 + k * 3);
        if (path.length) f.route = { path, seize: k === 1 ? path[path.length - 1] : null };
      }
    });
    await page.evaluate(async () => {
      const s = window.tc.screen; if (s.replay) s.endReplay();
      const M = await import('/src/ui/modals.ts'); if (M.isModalOpen()) M.closeModal();
      document.querySelectorAll('.herald-ov, .saga-ov, .bv-overlay, .overlay, .dl-title, .cr-room, .callout, .dl-banner, .hd-banner').forEach(x => x.remove());
      s.hud.closePopovers?.(); s.deselect?.(); s.map.mouse = null;
    });
    await page.mouse.move(1, 1);
    for (const sel of [false, true]) {
      for (const [name, what, Rs] of VIEWS.filter(v => !process.env.VIEWS || process.env.VIEWS.split(',').includes(v[0]))) {
        if (board === 'turn1' && (what === 'battle' || what === 'crowded')) continue;
        const lab = await page.evaluate(({ what, Rs, sel }) => {
          const s = window.tc.screen, st = s.st, map = s.map;
          const area = p => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[i], w = p[(i + 1) % p.length]; a += q.x * w.y - w.x * q.y; } return Math.abs(a / 2); };
          const rs = st.regions.filter(r => r.poly.length > 2 && r.kind !== 'void' && r.kind !== 'lane').map(r => Math.sqrt(area(r.poly) / Math.PI)).sort((a, b) => a - b), med = rs[rs.length >> 1];
          let c, label = what;
          if (what === 'board') { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const r of st.regions) for (const p of r.poly) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); } c = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }; }
          else if (what === 'battle') { const e = st.engagements?.[0]; const r = e ? st.regions[e.region] : st.regions.find(q => q.kind === 'throne'); c = r.site; label = r.name; }
          else if (what === 'throne') { c = st.regions.find(q => q.kind === 'throne').site; }
          else if (what === 'crowded') {
            let best = null, bs = -1;
            for (const r of st.regions) { if (r.kind === 'lane' || r.kind === 'void') continue; const owners = new Set(st.fleets.filter(f => f.region === r.id && f.ships.length).map(f => f.owner)); const sc = owners.size * 10 + (r.kind === 'crown' ? 4 : 0) + st.fleets.filter(f => f.region === r.id).length; if (sc > bs) { bs = sc; best = r; } }
            c = best.site; label = best.name;
          } else c = st.regions[st.players[s.you ?? 0].capital].site;
          s.deselect?.();
          if (sel) { const f = st.fleets.find(q => q.owner === s.you && q.ships.length); if (f) s.select({ kind: 'fleet', id: f.id }); }
          map.cam = { x: c.x, y: c.y, z: (Rs * map.ui) / med };
          return label;
        }, { what, Rs, sel });
        await page.evaluate(() => document.querySelectorAll('.callout, .maptip').forEach(x => x.remove()));
        // let selection glides settle, then put the camera back where it was aimed
        await page.waitForTimeout(900);
        const res = await page.evaluate(() => window.tc.screen.map.measureContrast());
        const tag = `${dn}-${board}-${name}${sel ? '-sel' : ''}`;
        if (sel && name === 'operational') await page.screenshot({ path: `${out}/contrast/${tag}.png` });
        const by = {};
        for (const p of res) { if (p.n < 4) continue; by[p.kind] = Math.min(by[p.kind] ?? 99, p.contrast); all.push({ tag, ...p }); const w = worst[p.kind]; if (!w || p.contrast < w.c) worst[p.kind] = { c: p.contrast, tag, x: p.x, y: p.y }; }
        const fails = Object.entries(by).filter(([k, c]) => c < 4.5 && k !== 'lane (rest)');
        console.log(`${tag} (${lab}): ${res.length} probes${fails.length ? `  FAIL ${fails.map(([k, c]) => `${k} ${c}`).join(', ')}` : ''}`);
        if (process.env.KINDS) { const k = {}; for (const p of res) k[p.kind] = (k[p.kind] ?? 0) + 1; console.log('   ', JSON.stringify(k)); }
        if (process.env.VERBOSE) for (const p of res) if (p.n >= 4 && p.contrast < 4.5 && p.kind !== 'lane (rest)') console.log(`    ${p.kind} @${p.x},${p.y} ${p.contrast} tones ${JSON.stringify(p.tones)} n${p.n}`);
        if (process.env.SHOTS) await page.screenshot({ path: `${out}/contrast/${tag}.png` });
      }
    }
    await ctx.close();
  }
}
await browser.close();
const held = all.filter(p => p.kind !== 'lane (rest)');
const below = held.filter(p => p.contrast < 4.5);
const sorted = Object.entries(worst).sort((a, b) => a[1].c - b[1].c);
console.log('\nworst per indicator kind:');
for (const [k, w] of sorted) console.log(`  ${k.padEnd(28)} ${w.c.toFixed(2)}  (${w.tag} @${w.x},${w.y})`);
console.log(`\n${held.length} checks, ${below.length} below 4.5:1${below.length ? `: ${below.slice(0, 12).map(p => `${p.tag} ${p.kind} ${p.contrast}`).join('; ')}` : ''}`);
writeFileSync(`${out}/contrast/metrics.json`, JSON.stringify({ worst, below, n: held.length }, null, 1));
process.exit(below.length || errors ? 1 : 0);
