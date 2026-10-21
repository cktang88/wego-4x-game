// Visual + performance check of map/UI animations: screenshot sequences mid-replay, frame timings.
// node scripts/fx-shots.mjs <outdir> [phone] [baseUrl]
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? '.';
const phone = process.argv[3] === 'phone';
const base = process.argv[4] ?? 'http://localhost:5173/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext(phone ? {
  viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
} : { viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
// ignore Vite hot reloads (other files changing mid-run would reload the page)
await page.routeWebSocket(/\?token=/, () => {});
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const tag = phone ? 'ph' : 'dt';
const shot = n => page.screenshot({ path: `${out}/${tag}-${n}.png` });
await page.goto(base);
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('tc.tutorial.wego', 'done'); localStorage.setItem('tc.tutorial.live', 'done'); });
await page.reload();
await page.waitForTimeout(700);
await shot('00-lobby');
await page.click('[data-l=watch]');
await page.waitForTimeout(1000);

/** Measures rAF deltas and the CPU cost of GameScreen.frame() for `ms`. */
const measure = ms => page.evaluate(ms => new Promise(res => {
  const s = window.tc.screen;
  const orig = s.frame.bind(s);
  const cost = [];
  s.frame = () => { const t = performance.now(); orig(); cost.push(performance.now() - t); };
  const m = s.map, ods = m.drawStatic; let rebuilds = 0; m.drawStatic = function (I) { rebuilds++; return ods.call(this, I); };
  const d = []; let last = performance.now();
  const end = last + ms;
  const tick = now => { d.push(now - last); last = now; if (now < end) requestAnimationFrame(tick); else { s.frame = orig; m.drawStatic = ods; const q = a => { const b = a.slice().sort((x, y) => x - y); return { avg: +(b.reduce((x, y) => x + y, 0) / b.length).toFixed(2), p95: +b[Math.floor(b.length * 0.95)].toFixed(2), max: +b[b.length - 1].toFixed(2) }; }; res({ frames: d.length, delta: q(d), frameCpu: q(cost), particles: s.map.particles.length, rebuilds }); } };
  requestAnimationFrame(tick);
}), ms);

console.log('idle', JSON.stringify(await measure(1500)));
// play turns until something interesting happens in a replay
let caps = 0;
for (let turn = 0; turn < 8; turn++) {
  await page.evaluate(() => window.tc.screen.src.advance());
  await page.waitForTimeout(150);
  const info = await page.evaluate(() => { const r = window.tc.screen.replay; return r ? { beats: r.beats.length, kinds: r.result.events.map(e => e.k) } : null; });
  if (!info) continue;
  const interesting = info.kinds.includes('capture') || info.kinds.includes('battle') || info.kinds.includes('build');
  if (!interesting) { await page.evaluate(() => window.tc.screen.endReplay()); continue; }
  await page.evaluate(() => { window.tc.screen.replay.speed = 2; });
  const m = measure(2500);
  for (let i = 0; i < 10; i++) { if (!process.env.NOSHOT) await shot(`t${turn}-r${String(i).padStart(2, "0")}`); await page.waitForTimeout(220); }
  console.log(`replay t${turn}`, JSON.stringify(await m));
  // wait for the end of the replay (or cut it)
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.tc.screen.endReplay());
  await page.waitForTimeout(400);
  caps++;
  if (caps >= 2) break;
}
// selection + hover + toast + dialog
const fxy = await page.evaluate(() => { const s = window.tc.screen; const f = s.currentFleetDraws()[0]; const p = s.map.toScreen(f.pos); const r = s.el.canvas.getBoundingClientRect(); return [p.x + r.left, p.y + r.top]; });
await page.mouse.click(fxy[0], fxy[1]);
await page.waitForTimeout(90); await shot('sel-1');
await page.waitForTimeout(400); await shot('sel-2');
await page.evaluate(() => window.tc.screen.banner('PULSE III'));
await page.waitForTimeout(120); await shot('banner-1');
await page.waitForTimeout(250); await shot('banner-2');
await page.evaluate(() => import('/src/ui/dom.ts').then(d => d.toast('Fleet launched from the shipyard')));
await page.waitForTimeout(100); await shot('toast');
// explosion + capture + build fx directly on the map
await page.evaluate(() => {
  const s = window.tc.screen, st = s.st, now = performance.now();
  const r = st.regions.find(x => x.kind === 'colony' && s.map.onScreen(x.site, 120)) ?? st.regions[0];
  s.map.flyTo(r.site, s.map.cam.z, 400);
  s.fx.push({ kind: 'explode', pos: { x: r.site.x + 40, y: r.site.y + 60 }, color: '#ff5d7a', t0: now + 500, dur: 900, size: 1.5 });
  s.fx.push({ kind: 'capture', pos: r.site, color: st.players[0].color, t0: now + 500, dur: 1100, text: 'CAPTURED' });
  s.fx.push({ kind: 'build', pos: { x: r.site.x - 120, y: r.site.y }, color: st.players[1].color, t0: now + 500, dur: 800 });
});
for (let i = 0; i < 5; i++) { await page.waitForTimeout(i ? 160 : 560); await shot(`fx-${i}`); }
// a battle report
const bat = await page.evaluate(() => { const l = window.tc.screen.st.last; return l?.battles?.[0]?.id ?? null; });
if (bat !== null) {
  await page.evaluate(id => window.tc.screen.openBattle(id), bat);
  await page.waitForTimeout(150); await shot('bv-0-open');
  await page.waitForTimeout(2600); await shot('bv-1');
  await page.waitForTimeout(700); await shot('bv-2');
  await page.waitForTimeout(700); await shot('bv-3');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(80); await shot('bv-4-closing');
}
console.log('errors', errors.length ? errors : 'none');
await browser.close();
