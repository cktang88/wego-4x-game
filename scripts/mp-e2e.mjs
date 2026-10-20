// Online multiplayer in real browsers: 3 isolated contexts create/join/seal a turn.
import { chromium } from 'playwright-core';
const base = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? '.';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
const mk = async () => { const c = await browser.newContext({ viewport: { width: 1280, height: 820 } }); const p = await c.newPage(); p.on('pageerror', e => errors.push(e.message)); return p; };
const a = await mk(), b = await mk(), c = await mk();
await a.goto(base);
await a.fill('[data-l=name]', 'Alice');
await a.click('[data-o=create]');
await a.waitForSelector('[data-go]');
const link = await a.inputValue('.dialog input');
await a.click('[data-go]');
await a.waitForTimeout(1200);
for (const [p, n] of [[b, 'Bob'], [c, 'Cara']]) {
  await p.goto(link);
  await p.waitForSelector('[data-seat]');
  await p.fill('[data-name]', n);
  await p.click('[data-seat]');
  await p.waitForTimeout(1200);
}
await a.screenshot({ path: `${out}/mp-a-before.png` });
for (const p of [a, b, c]) {
  await p.click('[data-tab=orders]');
  await p.click('[data-submit]');
  await p.waitForTimeout(200);
  const y = await p.$('[data-y]'); if (y) await y.click();
  await p.waitForTimeout(500);
}
await a.waitForTimeout(1500);
await b.screenshot({ path: `${out}/mp-b-after.png` });
const turns = await Promise.all([a, b, c].map(p => p.evaluate(() => [window.tc.state.turn, window.tc.screen.you])));
console.log('turn/seat per client', JSON.stringify(turns));
console.log('errors', JSON.stringify(errors));
await browser.close();
