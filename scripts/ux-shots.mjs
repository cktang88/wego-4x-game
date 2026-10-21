// Teach-by-doing walkthrough (docs/UX-V2.md §7) through the real UI, desktop + iPhone, WEGO + LIVE: the turn-1
// "Drag to seize" ghost arrow, then "Seal when ready", "Tap to build" on the build tray, skip, and restart from the
// menu. Screenshots every step. node scripts/ux-shots.mjs <outdir> [base] [wego-desk|wego-phone|live-desk|live-phone]
import { chromium, devices } from 'playwright-core';
const out = process.argv[2] ?? '.';
const base = process.argv[3] ?? 'http://localhost:5173/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };

async function run(tag, phone, live) {
  const ctx = phone ? await browser.newContext({ ...devices['iPhone 15 Pro'], defaultBrowserType: undefined }) : await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.routeWebSocket(/\?token=/, () => {});
  page.on('pageerror', e => errors.push(`${tag}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${tag}: ${m.text()}`); });
  let n = 0;
  const shot = async name => page.screenshot({ path: `${out}/${tag}-${String(n++).padStart(2, '0')}-${name}.png` });
  const callout = () => page.evaluate(() => { const c = document.querySelector('.callout'); return c && !c.classList.contains('hidden') ? c.querySelector('span')?.textContent.trim() ?? null : null; });
  const cdp = phone ? await ctx.newCDPSession(page) : null;
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const drag = async (a, b) => {
    const steps = 10;
    if (phone) {
      await touch('touchStart', a[0], a[1]);
      for (let i = 1; i <= steps; i++) await touch('touchMove', a[0] + ((b[0] - a[0]) * i) / steps, a[1] + ((b[1] + 48 - a[1]) * i) / steps);
      await page.waitForTimeout(150);
      await touch('touchEnd');
    } else {
      await page.mouse.move(a[0], a[1]); await page.mouse.down();
      await page.mouse.move(b[0], b[1], { steps });
      await page.waitForTimeout(150);
      await page.mouse.up();
    }
  };
  await page.goto(base);
  await page.evaluate(() => localStorage.clear());
  await page.goto(base);
  if (live) await page.selectOption('[data-l=mode]', 'live-blitz');
  await page.click('[data-l=start]');
  await page.waitForFunction(() => window.tc?.screen?.st);
  await page.waitForTimeout(1200);
  check(await callout() === 'Drag to seize' || false, `${tag}: turn 1 says "Drag to seize" (${await callout()})`);
  check(await page.evaluate(() => !!window.tc.screen.teachArrow), `${tag}: ghost arrow drawn`);
  await shot('drag-to-seize');
  // do exactly what it says: drag the fleet onto the arrow's target
  const pair = await page.evaluate(() => {
    const s = window.tc.screen, t = s.teachArrow, f = s.st.fleets.find(f => f.owner === s.you && f.region === t.from && s.isIdle(f));
    const a = s.map.toScreen(s.lastFleetPos.get(f.id)), b = s.map.toScreen(s.st.regions[t.to].site);
    return [[a.x, a.y], [b.x, b.y]];
  });
  await drag(pair[0], pair[1]);
  await page.waitForTimeout(500);
  const used = await page.evaluate(() => (window.tc.screen.live ? window.tc.screen.queue.length : window.tc.screen.plan.orders.filter(Boolean).length));
  check(used === 1, `${tag}: the drag gave an order (${used})`);
  await page.evaluate(() => window.tc.screen.deselect());
  await page.waitForTimeout(200);
  if (!live) check(await callout() === 'Seal when ready', `${tag}: then "Seal when ready" (${await callout()})`);
  await shot('after-drag');
  // the capital's card: "Tap to build" on the build tray
  await page.evaluate(() => { const s = window.tc.screen; s.select({ kind: 'region', id: s.st.players[s.you].capital }); });
  await page.waitForTimeout(800);
  check(await callout() === 'Tap to build', `${tag}: build tray says "Tap to build" (${await callout()})`);
  await shot('build');
  await page.click('.card [data-a=build]:not([aria-disabled=true])');
  await page.waitForTimeout(400);
  await shot('after-build');
  // skip everything, then restart from the menu
  await page.evaluate(() => window.tc.screen.deselect());
  await page.waitForTimeout(200);
  const x = await page.$('.callout [data-t=skip]');
  if (x) { await x.click({ force: true }); await page.waitForTimeout(200); }
  check(await callout() === null, `${tag}: × skips the tips`);
  await page.click('[data-act=menu]');
  await page.waitForTimeout(200);
  await shot('menu');
  await page.click('.pop [data-m=teach]');
  await page.waitForTimeout(300);
  check(await page.evaluate(() => localStorage.getItem(`tc.tutorial.${window.tc.screen.live ? 'live' : 'wego'}`) !== 'done'), `${tag}: Teach again re-enables tips`);
  await shot('restarted');
  await ctx.close();
}

const only = process.argv[4];
for (const [tag, phone, live] of [['wego-desk', false, false], ['wego-phone', true, false], ['live-desk', false, true], ['live-phone', true, true]]) {
  if (only && !tag.startsWith(only)) continue;
  await run(tag, phone, live);
}
console.log('errors', JSON.stringify(errors));
await browser.close();
if (fails || errors.length) process.exit(1);
