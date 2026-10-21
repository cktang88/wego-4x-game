import { chromium } from 'playwright-core';
import { bootHarness } from '/home/user/wego-4x-game/scripts/map-harness.mjs';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
await bootHarness(page, 'http://localhost:5173/', errs, true);
const r = await page.evaluate(async () => {
  const H = window.H, m = H.map, s = H.full;
  const e = s.engagements[0];
  m.cam = { x: s.regions[e.region].site.x, y: s.regions[e.region].site.y, z: 1.2 };
  await new Promise(r => setTimeout(r, 300));
  return { eng: s.engagements.map(x => x.region), tier: m.tier, disp: [...m.tokDisp].filter(([k]) => k.startsWith('b')).map(([k, d]) => [k, d.ang]) };
});
console.log(JSON.stringify(r), errs.slice(0,3));
await browser.close();
