// Art gallery: renders the procedural painters (ship miniatures per class × house, planets, bases, FX) onto one
// canvas for visual review. node scripts/art-gallery.mjs <out.png> [baseUrl] [section]   (needs `npm run dev`)
import { chromium } from 'playwright-core';
const out = process.argv[2] ?? '/tmp/claude-0/art/gallery.png';
const base = process.argv[3] ?? 'http://localhost:5173/';
const section = process.argv[4] ?? 'ships';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: Number(process.env.DPR ?? 1) });
await page.routeWebSocket(/\?token=/, () => {});
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(base);
await page.evaluate(async section => {
  document.body.innerHTML = '';
  document.body.style.cssText = 'margin:0;background:#05030b';
  const c = document.createElement('canvas');
  const dpr = devicePixelRatio;
  c.width = 1400 * dpr; c.height = 900 * dpr; c.style.cssText = 'width:1400px;height:900px;display:block';
  document.body.appendChild(c);
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  g.fillStyle = '#0b0f1e'; g.fillRect(0, 0, 1400, 900);
  const mod = await import('/src/art/gallery.ts');
  await mod.gallery(g, section, dpr);
}, section);
await page.waitForTimeout(200);
await page.screenshot({ path: out });
console.log(out, errors.length ? JSON.stringify(errors) : 'ok');
await browser.close();
