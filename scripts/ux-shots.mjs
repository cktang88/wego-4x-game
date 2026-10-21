// UX walkthrough: plays the first-run tour through the real UI (desktop + iPhone, WEGO + LIVE)
// and screenshots every step. node scripts/ux-shots.mjs <outdir> [base]
import { chromium, devices } from 'playwright-core';
const out = process.argv[2] ?? '.';
const base = process.argv[3] ?? 'http://localhost:5173/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];

async function run(tag, phone, live) {
  const ctx = phone ? await browser.newContext({ ...devices['iPhone 15 Pro'], defaultBrowserType: undefined }) : await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  // ignore Vite hot reloads (other files changing mid-run would reload the page)
  await page.routeWebSocket(/\?token=/, () => {});
  page.on('pageerror', e => errors.push(`${tag}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`${tag}: ${m.text()}`); });
  let n = 0;
  const shot = async name => page.screenshot({ path: `${out}/${tag}-${String(n++).padStart(2, '0')}-${name}.png` });
  const step = () => page.evaluate(() => window.tc.screen.coach?.cur?.id ?? null);
  const tapAt = async (x, y) => (phone ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));
  const tapSel = async sel => { const e = await page.$(sel); if (!e) { console.log(tag, 'missing', sel); return false; } if (phone) await e.tap(); else await e.click(); return true; };
  const xy = (what, id) => page.evaluate(([what, id]) => {
    const s = window.tc.screen; const r = s.el.canvas.getBoundingClientRect();
    const pos = what === 'fleet' ? s.currentFleetDraws().find(f => f.id === id).pos : s.st.regions[id].site;
    const p = s.map.toScreen(pos); return [p.x + r.left, p.y + r.top];
  }, [what, id]);
  await page.goto(base);
  await page.evaluate(() => localStorage.clear());
  await page.goto(base);
  if (live) await page.selectOption('[data-l=mode]', 'live-blitz');
  await tapSel('[data-l=start]');
  await page.waitForTimeout(1200);
  console.log(tag, 'step', await step());
  await shot('start');
  const info = await page.evaluate(() => {
    const s = window.tc.screen, st = s.st, me = s.you;
    const f = st.fleets.filter(f => f.owner === me).sort((a, b) => b.ships.length - a.ships.length)[0];
    const nb = st.regions[f.region].neighbors.filter(n => st.regions[n].owner !== me);
    const t = nb.find(n => st.regions[n].owner === null && st.regions[n].kind === 'colony') ?? nb.find(n => st.regions[n].owner === null) ?? nb[0];
    return { fleet: f.id, target: t, cap: st.players[me].capital };
  });
  await tapAt(...await xy('fleet', info.fleet));
  await page.waitForTimeout(400);
  console.log(tag, 'step', await step());
  await shot('fleet-selected');
  if (!phone) {
    const pw = await page.$('.stat .nt');
    if (pw) { await pw.hover(); await page.waitForTimeout(200); await shot('tip-power'); }
  }
  await tapSel('[data-a=seize]');
  await page.waitForTimeout(400);
  const [tx, ty] = await xy('region', info.target);
  if (!phone) { await page.mouse.move(tx, ty); await page.waitForTimeout(250); }
  console.log(tag, 'step', await step());
  await shot('targeting');
  await tapAt(tx, ty - 4);
  await page.waitForTimeout(500);
  console.log(tag, 'step', await step());
  await shot('after-order');
  await tapSel('[data-coach=next]');
  await page.waitForTimeout(400);
  console.log(tag, 'step', await step());
  await shot('capital');
  // a point inside the capital that isn't on a fleet token
  const capXY = await page.evaluate(id => {
    const s = window.tc.screen, c = s.el.canvas.getBoundingClientRect(), p = s.map.toScreen(s.st.regions[id].site), draws = s.currentFleetDraws();
    for (let r = 10; r < 120; r += 6) for (let a = 0; a < 6.28; a += 0.4) {
      const x = p.x + Math.cos(a) * r, y = p.y + Math.sin(a) * r;
      if (s.map.regionAt(s.st, x, y) === id && !s.map.fleetAt(draws, x, y)) return [x + c.left, y + c.top];
    }
    return [p.x + c.left, p.y + c.top];
  }, info.cap);
  if (phone) await page.evaluate(() => { window.tc.screen.sel = null; window.tc.screen.renderAll(); });
  await tapAt(...capXY);
  await page.waitForTimeout(500);
  console.log(tag, 'step', await step());
  await shot('region');
  await tapSel('[data-a=build]:not(:disabled)');
  await page.waitForTimeout(500);
  console.log(tag, 'step', await step());
  await shot('after-build');
  if (!live) {
    if (phone) { await tapSel('[data-d=seal]'); } else { await tapSel('[data-submit]'); }
    await page.waitForTimeout(400);
    await shot('seal-confirm');
    await tapSel('[data-y]');
    await page.waitForTimeout(1500);
    await shot('replay');
    await page.evaluate(() => window.tc.screen.endReplay());
    await page.waitForTimeout(500);
  } else {
    await page.waitForTimeout(6000);
    await page.evaluate(() => { if (window.tc.screen.replay) window.tc.screen.endReplay(); });
    await page.waitForTimeout(300);
  }
  console.log(tag, 'step', await step());
  if (await step() === 'empire') { await shot('empire-step'); await tapSel('[data-coach=next]'); await page.waitForTimeout(300); console.log(tag, 'step', await step()); }
  await shot('end');
  await tapSel('[data-coach=finish]');
  await page.waitForTimeout(200);
  if (await step() !== null) { console.log(tag, 'FAIL tour did not finish'); errors.push(`${tag}: tour did not finish`); }
  await page.waitForTimeout(300);
  // a fleet panel with a section open, then the orders tab
  await tapAt(...await xy('fleet', info.fleet));
  await page.waitForTimeout(400);
  const sum = await page.$('.panel.left details.sec[data-sec=ships] > summary');
  if (sum) { if (phone) await sum.tap(); else await sum.click(); await page.waitForTimeout(250); }
  await shot('fleet-ships-open');
  if (phone) { await page.evaluate(() => { const s = window.tc.screen; s.sel = null; s.openSheet('orders'); }); }
  else { await page.evaluate(() => { window.tc.screen.sel = null; window.tc.screen.renderAll(); }); await tapSel('[data-tab=orders]'); }
  await page.waitForTimeout(300);
  await shot('orders-tab');
  if (!phone) { const r = await page.$('.res .r'); if (r) { await r.hover(); await page.waitForTimeout(200); await shot('tip-res'); } }
  await ctx.close();
}

const only = process.argv[4];
for (const [tag, phone, live] of [['wego-desk', false, false], ['wego-phone', true, false], ['live-desk', false, true], ['live-phone', true, true]]) {
  if (only && !tag.startsWith(only)) continue;
  await run(tag, phone, live);
}
console.log('errors', JSON.stringify(errors));
await browser.close();
