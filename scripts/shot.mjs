// Screenshot helper for visual QA: node scripts/shot.mjs <url> <out.png> [actions-json]
import { chromium } from 'playwright-core';
const [url, out, actions = '[]', w = '1440', h = '900'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
const logs = [];
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForTimeout(1200);
for (const a of JSON.parse(actions)) {
  if (a.click) await page.click(a.click);
  if (a.clickAt) await page.mouse.click(a.clickAt[0], a.clickAt[1]);
  if (a.key) await page.keyboard.press(a.key);
  if (a.eval) logs.push('[eval] ' + JSON.stringify(await page.evaluate(a.eval)));
  if (a.wait) await page.waitForTimeout(a.wait);
  if (a.shot) await page.screenshot({ path: a.shot });
}
await page.screenshot({ path: out });
console.log(logs.join('\n'));
await browser.close();
