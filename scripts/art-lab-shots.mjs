// Art Lab screenshots: client/art-lab.html (the GL stage over a mock board, and the component kit) at desktop
// 1440x900 and an iPhone 15 Pro. node scripts/art-lab-shots.mjs [outdir] [baseUrl]   (needs `npm run dev`)
// Headless Chromium renders WebGL2 with SwiftShader (CPU), so the fps it reports says nothing about a phone GPU.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? '/tmp/claude-0/art-lab';
const base = (process.argv[3] ?? 'http://localhost:5173/') + 'art-lab.html';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const VPS = [
  { tag: 'desk', viewport: { width: 1440, height: 900 } },
  { tag: 'phone', viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
];
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const SHOTS_ALL = [
  ['01-stage', '?t=14&drift=0&q=high'],
  ['02-stage-panel', '?t=14&drift=0&q=high&panel=open'],
  ['03-neon-compare', '?t=14&drift=0&q=high&terr=neon&panel=0'],
  ['04-fallback-2d', '?gl=0&t=14&drift=0&panel=0'],
  ['05-kit', '?t=14&drift=0&q=high&kit=1'],
  ['06-low', '?t=14&drift=0&q=low&panel=0'],
  ['07-close', '?t=14&drift=0&q=high&panel=0&zoom=2.4'],
];
const SHOTS = SHOTS_ALL.filter(([n]) => !ONLY || ONLY.some(o => n.startsWith(o)));
const VPS_ = VPS.filter(v => !process.env.VP || v.tag === process.env.VP);
let errors = 0;
for (const vp of VPS_) {
  const ctx = await browser.newContext(vp);
  for (const [name, qs] of SHOTS) {
    const page = await ctx.newPage();
    await page.routeWebSocket(/\?token=/, () => {});
    page.on('pageerror', e => { errors++; console.log('pageerror', name, e.message); });
    page.on('console', m => { if ((m.type() === 'warning' || m.type() === 'error') && !m.text().includes('GL Driver')) console.log(`[${vp.tag} ${name}] ${m.type()}: ${m.text()}`); });
    try {
    await page.goto(base + qs, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => window.artLab, null, { timeout: 120000 });
    const zoom = new URLSearchParams(qs).get('zoom');
    if (zoom) await page.evaluate(z => { const c = window.artLab.cam; c.z *= Number(z); c.x = -420; c.y = -330; }, zoom);
    await page.waitForTimeout(4000);
    const fps = await page.evaluate(() => document.querySelector('[data-fps]')?.textContent);
    await page.screenshot({ path: `${out}/${vp.tag}-${name}.png`, timeout: 180000 });
    console.log(`${vp.tag}-${name}  ${fps}`);
    } catch (e) { errors++; console.log(`${vp.tag}-${name}  FAILED ${e.message.split('\n')[0]}`); }
    await page.close();
  }
  await ctx.close();
}
await browser.close();
process.exit(errors ? 1 : 0);
