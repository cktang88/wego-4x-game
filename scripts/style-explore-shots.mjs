// Style exploration screenshots (client/style-lab.html): three unified art directions (A printed chart, B painted
// diorama, C enamel-and-gold orrery) x three zoom tiers x two devices (1440x900, iPhone 15 Pro), close-ups of a battle,
// a crowded star and the legend, the measured readability of every indicator, the frame cost, and side-by-side
// comparison sheets with the current look (scripts/style-explore-current.mjs) as the fourth column.
//   node scripts/style-explore-shots.mjs [outdir] [base]          (needs `npm run dev`)
//   ONLY=A,B  TIERS=detail  DEV=desk   narrow the run
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
const out = process.argv[2] ?? '/tmp/claude-0/style-explore';
const base = (process.argv[3] ?? 'http://localhost:5173/') + 'style-lab.html';
const STYLES = (process.env.ONLY ?? 'A,B,C').split(',');
const TIERS = (process.env.TIERS ?? 'strategic,operational,detail').split(',');
const DEVS = {
  desk: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
};
const devs = (process.env.DEV ?? 'desk,phone').split(',');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const metricsPath = `${out}/metrics.json`;
const metrics = existsSync(metricsPath) ? JSON.parse(readFileSync(metricsPath, 'utf8')) : {};
let errors = 0;

/** Summarise one measure(): the worst contrast per indicator kind, the failures (< 4.5:1; the resting lanes are
 *  quiet by design and reported apart), and the background's value range. */
function summarise(m) {
  const by = {};
  for (const p of m.probes) if (p.n >= 4) by[p.kind] = Math.min(by[p.kind] ?? 99, +p.contrast.toFixed(2));
  const fails = Object.entries(by).filter(([k, c]) => c < 4.5 && k !== 'lane (rest)').map(([k, c]) => `${k} ${c}`);
  return { worst: by, fails, range: m.range.map(x => +x.toFixed(4)) };
}

async function open(ctx, qs) {
  const page = await ctx.newPage();
  await page.routeWebSocket(/\?token=/, () => {});
  page.on('pageerror', e => { errors++; console.log('pageerror', qs, e.message); });
  page.on('console', m => { if (m.type() === 'error') console.log('console', qs, m.text()); });
  await page.goto(`${base}?ui=0&${qs}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.lab2?.ready, null, { timeout: 180000 });
  await page.waitForTimeout(250);
  return page;
}

for (const S of STYLES) {
  mkdirSync(`${out}/${S}`, { recursive: true });
  metrics[S] ??= {};
  for (const dk of devs) {
    const ctx = await browser.newContext(DEVS[dk]);
    for (const tier of TIERS) {
      const page = await open(ctx, `style=${S}&tier=${tier}`);
      const m = summarise(await page.evaluate(() => window.lab2.measure()));
      if (dk === 'desk') m.perf = await page.evaluate(() => window.lab2.perf(12));
      await page.evaluate(() => window.lab2.render());
      await page.screenshot({ path: `${out}/${S}/${dk}-${tier}.png` });
      metrics[S][`${dk}-${tier}`] = m;
      console.log(`${S} ${dk}-${tier}`, m.fails.length ? `FAIL ${m.fails.join(', ')}` : 'all >= 4.5', `range ${m.range.join('/')}`, m.perf ? `perf ${JSON.stringify(m.perf)}` : '');
      await page.close();
    }
    if (dk === 'desk') {
      for (const [name, qs] of [['closeup-battle', 'focus=battle&hud=0'], ['closeup-crowded', 'focus=crowded&hud=tip']]) {
        const page = await open(ctx, `style=${S}&${qs}`);
        const m = summarise(await page.evaluate(() => window.lab2.measure()));
        await page.evaluate(() => window.lab2.render());
        await page.screenshot({ path: `${out}/${S}/${name}.png`, clip: { x: 320, y: 150, width: 800, height: 600 } });
        metrics[S][name] = m;
        console.log(`${S} ${name}`, m.fails.length ? `FAIL ${m.fails.join(', ')}` : 'all >= 4.5');
        await page.close();
      }
      const page = await open(ctx, `style=${S}&legend=1`);
      const m = summarise(await page.evaluate(() => window.lab2.measure()));
      await page.waitForTimeout(150);
      await page.screenshot({ path: `${out}/${S}/legend.png`, fullPage: true });
      metrics[S].legend = m;
      console.log(`${S} legend`, m.fails.length ? `FAIL ${m.fails.join(', ')}` : 'all >= 4.5');
      await page.close();
    }
    if (dk === 'phone') {
      const page = await open(ctx, `style=${S}&focus=crowded`);
      await page.screenshot({ path: `${out}/${S}/phone-closeup-crowded.png` });
      await page.close();
    }
    await ctx.close();
  }
}
writeFileSync(metricsPath, JSON.stringify(metrics, null, 1));

// ------------------------------------------------------------------ comparison sheets: Current | A | B | C
const COLS = [['current', 'Current look (live game)'], ['A', 'A. The printed star chart'], ['B', 'B. Painted diorama'], ['C', 'C. Enamel and gold orrery']];
const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
for (const tier of ['strategic', 'operational', 'detail']) {
  const imgs = {};
  for (const [k] of COLS) for (const dk of ['desk', 'phone']) {
    const p = `${out}/${k}/${dk}-${tier}.png`;
    if (existsSync(p)) imgs[`${k}-${dk}`] = `data:image/png;base64,${readFileSync(p).toString('base64')}`;
  }
  const png = await page.evaluate(async ({ imgs, COLS, tier }) => {
    const load = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = src; });
    const cw = 720, dh = 450, ph = 620, pw = Math.round(ph * 393 / 852), gap = 24, top = 70, lab = 34;
    const W = gap + COLS.length * (cw + gap), H = top + lab + dh + gap + ph + gap;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#0b0b0e'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#efe3c4'; g.font = '700 30px Georgia, serif'; g.fillText(`Three Crowns: style exploration, ${tier} tier`, gap, 44);
    g.font = '15px Georgia, serif'; g.fillStyle = '#a89c80'; g.fillText('top: 1440x900   bottom: iPhone 15 Pro (393x852 @3x)', W - 420, 44);
    for (let i = 0; i < COLS.length; i++) {
      const [k, name] = COLS[i], x = gap + i * (cw + gap);
      g.fillStyle = '#efe3c4'; g.font = '700 20px Georgia, serif'; g.fillText(name, x, top + 22);
      const d = imgs[`${k}-desk`] && await load(imgs[`${k}-desk`]);
      if (d) g.drawImage(d, x, top + lab, cw, dh); else { g.strokeStyle = '#444'; g.strokeRect(x, top + lab, cw, dh); }
      const p = imgs[`${k}-phone`] && await load(imgs[`${k}-phone`]);
      if (p) g.drawImage(p, x + (cw - pw) / 2, top + lab + dh + gap, pw, ph);
    }
    return c.toDataURL('image/png');
  }, { imgs, COLS, tier });
  writeFileSync(`${out}/compare-${tier}.png`, Buffer.from(png.split(',')[1], 'base64'));
  console.log(`compare-${tier}.png`);
}
await browser.close();
if (errors) { console.log(`${errors} page errors`); process.exit(1); }
