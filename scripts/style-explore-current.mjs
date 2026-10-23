// The CURRENT look of the live game (the comparison column for the style exploration, docs: /tmp/claude-0/style-explore/README.md).
// Starts a local game, lets the AI play ~10 turns for both sides so there are fleets, routes and battles, then shoots the
// strategic, operational and detail tiers at 1440x900 and on an iPhone 15 Pro. Also measures the board's value range.
// node scripts/style-explore-current.mjs [outdir] [base]      (needs `npm run dev`)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? '/tmp/claude-0/style-explore/current';
const base = process.argv[3] ?? 'http://localhost:5173/';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const DEV = {
  desk: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
};
const TIERS = { desk: { strategic: 55, operational: 105, detail: 230 }, phone: { strategic: 42, operational: 110, detail: 210 } };
for (const [tag, dev] of Object.entries(DEV)) {
  const ctx = await browser.newContext(dev);
  const page = await ctx.newPage();
  await page.routeWebSocket(/\?token=/, () => {});
  page.on('pageerror', e => console.log('pageerror', e.message));
  await page.goto(base);
  await page.evaluate(() => localStorage.clear());
  await page.goto(base);
  await page.click('[data-l=start]');
  await page.waitForFunction(() => window.tc?.screen?.st);
  await page.waitForTimeout(1500);
  const me = await page.evaluate(() => window.tc.screen.you);
  await page.evaluate(() => { const s = window.tc.screen; s.src.save.seats[s.you].kind = 'ai'; s.plan.orders = s.plan.orders.map(() => null); s.savePlan(); });
  for (let i = 0; i < 11; i++) await page.evaluate(() => { try { window.tc.screen.src.advance(); } catch { /* */ } });
  await page.evaluate(a => { const s = window.tc.screen; s.src.save.seats[a].kind = 'human'; s.src.save.current = a; s.src.save.reveal = false; s.src.refresh(); s.onSourceChange('view'); if (s.replay) s.endReplay(); }, me);
  await page.waitForTimeout(600);
  await page.evaluate(async () => {
    const M = await import('/src/ui/modals.ts'); if (M.isModalOpen()) M.closeModal();
    document.querySelectorAll('.herald-ov, .saga-ov, .bv-overlay, .overlay, .dl-title, .cr-room, .callout').forEach(x => x.remove());
    const s = window.tc.screen; s.hud.closePopovers?.(); s.deselect?.(); s.hideTip?.();
  });
  for (const [tier, Rs] of Object.entries(TIERS[tag])) {
    await page.evaluate(({ Rs, tier }) => {
      const s = window.tc.screen, st = s.st, map = s.map;
      const rs = st.regions.filter(r => r.poly.length > 2 && r.kind !== 'void' && r.kind !== 'lane').map(r => { let a = 0; const p = r.poly; for (let i = 0; i < p.length; i++) { const q = p[i], w = p[(i + 1) % p.length]; a += q.x * w.y - w.x * q.y; } return Math.sqrt(Math.abs(a / 2) / Math.PI); }).sort((a, b) => a - b);
      const med = rs[rs.length >> 1];
      // centre: the board for strategic, the busiest engagement (or the Throne) closer in
      let c;
      const eng = st.engagements?.[0];
      const throne = st.regions.find(r => r.kind === 'throne');
      if (tier === 'strategic') { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const r of st.regions) for (const p of r.poly) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); } c = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }; }
      else c = (eng ? st.regions[eng.region] : throne).site;
      map.cam = { x: c.x, y: c.y, z: Rs / med };
      map.invalidate?.();
    }, { Rs, tier });
    await page.evaluate(() => document.querySelectorAll('.callout').forEach(x => x.remove()));
    await page.waitForTimeout(1600);
    await page.screenshot({ path: `${out}/${tag}-${tier}.png` });
    console.log(`${tag}-${tier}`, await page.evaluate(() => window.tc.screen.map.tier));
  }
  await ctx.close();
}
await browser.close();
