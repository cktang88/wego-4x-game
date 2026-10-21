// Full-screen modals (client/src/ui/modals.ts) end to end: start a local game, play a few turns with the
// AI planning for you, then open Empire / Score / Chronicle / Help through the module API and exercise
// research, laws, blueprints, pacts, chat, replay and keyboard switching. Screenshots at desktop 1440x900
// and iPhone 15 Pro; fails on page errors.
//   node scripts/modals-check.mjs [outdir=/tmp/claude-0/v2-modals] [baseUrl=http://localhost:5173/] [turns=8]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const out = process.argv[2] ?? '/tmp/claude-0/v2-modals';
const base = process.argv[3] ?? 'http://localhost:5173/';
const turns = Number(process.argv[4] ?? 8);
const repo = process.env.TC_REPO ?? resolve(dirname(fileURLToPath(import.meta.url)), '..');   // the tree Vite serves
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };
const wait = (page, ms = 250) => page.waitForTimeout(ms);

async function start(ctxOpts, tag, mode = 'wego') {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  await page.routeWebSocket(/\?token=/, () => {});   // no Vite hot reloads mid-run
  page.on('pageerror', e => errors.push(`[${tag}] ${e.message}`));
  // the lobby polls the game server (/api), which this check doesn't need; other failed loads count
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`[${tag}] ${m.text()}`); });
  page.on('response', r => { if (r.status() >= 400 && !new URL(r.url()).pathname.startsWith('/api/')) errors.push(`[${tag}] ${r.status()} ${r.url()}`); });
  page.on('dialog', d => d.accept());
  await page.goto(base);
  await page.evaluate(() => { localStorage.clear(); for (const k of ['wego', 'live', 'v2']) localStorage.setItem(`tc.tutorial.${k}`, 'done'); });
  await page.reload();
  await wait(page, 600);
  await page.fill('[data-l=seed]', '4242');
  if (mode !== 'wego') await page.selectOption('[data-l=mode]', mode);
  await page.click('[data-l=start]');
  await wait(page, 1000);
  await page.evaluate(async repo => {
    window.__m = await import('/src/ui/modals.ts');
    window.__ai = await import(`/@fs${repo}/shared/sim/ai.ts`);
  }, repo);
  return { ctx, page };
}
/** Let the AI plan your turn (expert), seal, skip the replay. */
async function playTurns(page, n) {
  for (let i = 0; i < n; i++) {
    await page.evaluate(() => {
      const g = window.tc.screen;
      const sub = window.__ai.planTurn(g.st, g.you, 'expert');
      g.src.submit(sub);
    });
    await wait(page, 150);
    await page.evaluate(() => { const g = window.tc.screen; g.endReplay?.(); });
    await wait(page, 100);
  }
  await page.evaluate(() => { const g = window.tc.screen; g.loadPlan?.(); g.renderAll(); });
  await wait(page, 200);
}
const open = (page, name, tab) => page.evaluate(([n, t]) => window.__m.openModal(window.tc.screen, n, t), [name, tab]);
const isOpen = page => page.evaluate(() => window.__m.isModalOpen());
const plan = page => page.evaluate(() => JSON.parse(JSON.stringify(window.tc.screen.plan)));
const shot = (page, name) => page.screenshot({ path: `${out}/${name}.png` });

// ============================================================ desktop
{
  const { ctx, page } = await start({ viewport: { width: 1440, height: 900 } }, 'desktop');
  // turn 1: the empty empire
  await open(page, 'empire', 'research');
  await wait(page, 450);
  check(await isOpen(page), 'empire modal opens');
  await shot(page, 'd-empire-research-t1');
  // research: tap an affordable node, read the card, buy it
  const tech = await page.$eval('.rn.s-avail', e => e.dataset.id);
  await page.click(`.rn[data-id="${tech}"]`);
  await wait(page);
  check(await page.$('.tcard') !== null, 'tapping a node expands its card');
  await shot(page, 'd-empire-research-card');
  await page.click('.tcard [data-a=research]');
  await wait(page, 400);
  let p = await plan(page);
  check(p.free.some(f => f.type === 'research' && f.tech === tech), `research ${tech} queued as a free action`);
  check(await page.$(`.rn.s-pending[data-id="${tech}"]`) !== null, 'node shows queued');
  await shot(page, 'd-empire-research-queued');
  await page.click('.rx-status [data-a=unresearch]');
  await wait(page);
  p = await plan(page);
  check(!p.free.some(f => f.type === 'research'), 'undo removes the research');
  await page.click(`.rn[data-id="${tech}"]`);
  await wait(page, 150);
  if (!(await page.$('.tcard'))) await page.click(`.rn[data-id="${tech}"]`);
  await page.click('.tcard [data-a=research]');
  await wait(page);
  // laws (key 2)
  await page.keyboard.press('2');
  await wait(page, 300);
  check(await page.$('.lw') !== null, 'key 2 switches to Laws');
  await shot(page, 'd-empire-laws-t1');
  const law = await page.$eval('[data-a=enact]', e => e.dataset.id);
  await page.click(`[data-a=enact][data-id="${law}"]`);
  await wait(page, 500);
  p = await plan(page);
  check(p.orders.some(o => o && o.type === 'law' && o.law === law), `law ${law} added as an order`);
  check(await page.$(`.lw-card.s-pending[data-law="${law}"]`) !== null, 'law card shows queued');
  await shot(page, 'd-empire-laws-queued');
  // ships (key 3)
  await page.keyboard.press('3');
  await wait(page, 300);
  await shot(page, 'd-empire-ships-t1');
  // the score modal (Q) + pact
  await page.keyboard.press('q');
  await wait(page, 300);
  check(await page.$('.sco') !== null, 'Q switches to Score');
  const rival = await page.$eval('[data-a=pact]', e => e.dataset.id);
  await page.click(`[data-a=pact][data-id="${rival}"]`);
  await wait(page, 400);
  p = await plan(page);
  check(p.orders.some(o => o && o.type === 'pact' && o.with === Number(rival)), 'pact offer added as an order');
  await shot(page, 'd-score-t1');
  // chat drawer: half-typed text survives a refresh, sending works
  await page.click('[data-a=chat-toggle]');
  await wait(page, 300);
  await page.click('[data-chat-msg]');
  await page.keyboard.type('Truce on the');
  await page.evaluate(() => window.__m.refreshModal());
  await page.evaluate(() => { window.tc.screen.renderAll(); window.__m.refreshModal(); });
  await wait(page, 100);
  check(await page.$eval('[data-chat-msg]', e => e.value) === 'Truce on the', 'chat draft survives re-renders');
  check(await page.evaluate(() => document.activeElement?.matches('[data-chat-msg]')), 'chat input keeps focus');
  await page.keyboard.type(' border?');
  const n0 = await page.evaluate(() => window.tc.screen.src.chat.length);
  await page.keyboard.press('Enter');
  await wait(page, 300);
  check(await page.evaluate(() => window.tc.screen.src.chat.length) === n0 + 1, 'chat message sent');
  check(await page.$eval('[data-chat-msg]', e => e.value) === '', 'chat input cleared after send');
  await shot(page, 'd-score-chat');
  await page.keyboard.press('Escape');   // closes the chat drawer first (input focused)
  await wait(page, 200);
  check(await isOpen(page), 'Esc in chat closes only the drawer');
  await page.keyboard.press('Escape');
  await wait(page, 350);
  check(!(await isOpen(page)), 'Esc closes the modal');

  // a few turns later: a real empire, chronicle, battles
  await playTurns(page, turns);
  await open(page, 'empire', 'research');
  await wait(page, 450);
  await shot(page, 'd-empire-research-mid');
  await page.keyboard.press('2'); await wait(page, 300);
  await shot(page, 'd-empire-laws-mid');
  // law slide: revoke the enacted law (free action), then keep it
  const on = await page.$('.lw-card.s-on [data-a=revoke]');
  if (on) {
    const id = await on.evaluate(e => e.dataset.id);
    await on.click(); await wait(page, 300);
    check((await plan(page)).free.some(f => f.type === 'revoke' && f.law === id), 'revoke queued as a free action');
    await page.click(`[data-a=unrevoke][data-id="${id}"]`); await wait(page, 300);
    check(!(await plan(page)).free.some(f => f.type === 'revoke'), 'keep removes the revoke');
  }
  await page.keyboard.press('3'); await wait(page, 300);
  const bp = await page.$('.mod[data-a=bp]');
  if (bp) {
    const id = await bp.evaluate(e => e.dataset.id);
    await bp.click(); await wait(page, 300);
    const [cls, mod] = id.split(':');
    check((await plan(page)).free.some(f => f.type === 'blueprint' && f.cls === cls && f.mod === mod), `blueprint ${id} queued`);
  } else console.log('note: no researched module to pick yet');
  await shot(page, 'd-empire-ships-mid');
  await page.keyboard.press('q'); await wait(page, 350);
  await shot(page, 'd-score-mid');
  await page.keyboard.press('c'); await wait(page, 600);
  check(await page.$('.chron') !== null, 'C switches to Chronicle');
  await shot(page, 'd-chronicle');
  const more = await page.$('.ce-b:not([data-static])');
  if (more) { await more.click(); await wait(page, 200); check(await page.$('.ce.open') !== null, 'chronicle entry expands'); }
  await page.keyboard.press('2'); await wait(page, 250);
  await shot(page, 'd-chronicle-battles');
  await page.keyboard.press('1'); await wait(page, 250);
  const bchip = await page.$('.bchip');
  if (bchip) {
    await bchip.click(); await wait(page, 700);
    check(await page.evaluate(() => !!document.querySelector('.bv-overlay')), 'battle chip opens the battle viewer');
    await page.keyboard.press('Escape'); await wait(page, 500);
    check(await isOpen(page), 'closing the battle viewer leaves the chronicle open');
  } else console.log('note: no battle in the recent turns');
  await page.click('[data-a=replay]');
  await wait(page, 500);
  check(!(await isOpen(page)), 'replay closes the modal');
  check(await page.evaluate(() => !!window.tc.screen.replay), 'replay started');
  await page.evaluate(() => window.tc.screen.endReplay?.());
  await open(page, 'help'); await wait(page, 400);
  await shot(page, 'd-help');
  await page.keyboard.press('4'); await wait(page, 250);
  await shot(page, 'd-help-empire');
  // backdrop click closes
  await page.mouse.click(8, 450); await wait(page, 350);
  check(!(await isOpen(page)), 'backdrop click closes');
  await ctx.close();
}

// ============================================================ phone (iPhone 15 Pro)
{
  const { ctx, page } = await start({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }, 'phone');
  await playTurns(page, turns);
  await open(page, 'empire', 'research'); await wait(page, 500);
  await shot(page, 'p-empire-research');
  const avail = await page.$('.rn.s-avail');
  if (avail) { await avail.tap(); await wait(page, 300); await shot(page, 'p-empire-research-card'); }
  await page.tap('[data-a=tab][data-id=laws]'); await wait(page, 300);
  await shot(page, 'p-empire-laws');
  await page.tap('[data-a=tab][data-id=ships]'); await wait(page, 300);
  await shot(page, 'p-empire-ships');
  await page.tap('[data-a=modal][data-id=score]'); await wait(page, 350);
  await shot(page, 'p-score');
  await page.tap('[data-a=chat-toggle]'); await wait(page, 300);
  await shot(page, 'p-score-chat');
  await page.tap('.chat [data-a=chat-toggle]'); await wait(page, 200);
  await page.tap('[data-a=modal][data-id=chronicle]'); await wait(page, 500);
  await shot(page, 'p-chronicle');
  await page.tap('[data-a=modal][data-id=help]'); await wait(page, 350);
  await shot(page, 'p-help');
  // swipe down on the grip closes
  const box = await page.$eval('.mdl-grip', e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.evaluate(({ x, y }) => {
    const el = document.querySelector('.mdl-grip');
    const ev = (type, yy) => new PointerEvent(type, { pointerId: 7, pointerType: 'touch', clientX: x, clientY: yy, bubbles: true });
    el.dispatchEvent(ev('pointerdown', y));
    for (let i = 1; i <= 10; i++) window.dispatchEvent(ev('pointermove', y + i * 22));
    window.dispatchEvent(ev('pointerup', y + 220));
  }, box);
  await wait(page, 450);
  check(!(await isOpen(page)), 'swipe down closes the sheet');
  await ctx.close();
}


// ============================================================ LIVE: free actions and orders go straight to the source
{
  const { ctx, page } = await start({ viewport: { width: 1440, height: 900 } }, 'live', 'live-normal');
  const L = () => page.evaluate(() => { const g = window.tc.screen, s = g.st; return JSON.parse(JSON.stringify({ free: s.live.free[g.you], queue: s.live.queue[g.you], bank: s.live.bank[g.you] })); });
  check(await page.evaluate(() => !!window.tc.screen.st.live), 'live game started');
  await open(page, 'empire', 'research'); await wait(page, 450);
  const tech = await page.$eval('.rn.s-avail', e => e.dataset.id).catch(() => null);
  if (tech) {
    await page.click(`.rn[data-id="${tech}"]`); await wait(page, 200);
    await page.click('.tcard [data-a=research]'); await wait(page, 400);
    check((await L()).free.some(f => f.type === 'research' && f.tech === tech), `LIVE research ${tech} queued for the next tick`);
    check(await page.$(`.rn.s-pending[data-id="${tech}"]`) !== null, 'LIVE node shows next tick');
  }
  await page.keyboard.press('2'); await wait(page, 300);
  const law = await page.$eval('[data-a=enact]', e => e.dataset.id).catch(() => null);
  if (law && (await L()).bank > 0) {
    await page.click(`[data-a=enact][data-id="${law}"]`); await wait(page, 400);
    check((await L()).queue.some(o => o.type === 'law' && o.law === law), `LIVE law ${law} queued`);
    await shot(page, 'l-empire-laws');
    await page.click(`[data-a=unlaw][data-id="${law}"]`); await wait(page, 400);
    check(!(await L()).queue.some(o => o.type === 'law'), 'LIVE law order cancelled (refunded)');
  } else console.log('note: LIVE law not testable (no bank / no open law)');
  await page.keyboard.press('Escape'); await wait(page, 300);
  await ctx.close();
}

// ============================================================ spectator (AI exhibition)
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.routeWebSocket(/\?token=/, () => {});
  page.on('pageerror', e => errors.push(`[spectator] ${e.message}`));
  await page.goto(base);
  await page.evaluate(() => { localStorage.clear(); for (const k of ['wego', 'live', 'v2']) localStorage.setItem(`tc.tutorial.${k}`, 'done'); });
  await page.reload(); await wait(page, 600);
  await page.click('[data-l=watch]'); await wait(page, 1500);
  await page.evaluate(async () => { window.__m = await import('/src/ui/modals.ts'); });
  const you = await page.evaluate(() => window.tc.screen.you);
  if (you === null) {
    await open(page, 'empire', 'research'); await wait(page, 450);
    check(await page.$$eval('[data-a=emp-pid]', e => e.length) === 3, 'spectator gets a player picker');
    check(await page.$('[data-a=research], [data-a=enact]') === null, 'spectator view is read-only');
    await page.click('[data-a=emp-pid][data-id="1"]'); await wait(page, 250);
    await shot(page, 's-empire');
  } else console.log('note: exhibition has a seat; spectator check skipped');
  await ctx.close();
}

await browser.close();
for (const e of errors) console.log('ERROR', e);
console.log(fails || errors.length ? `${fails} failed, ${errors.length} page errors` : 'all good');
process.exit(fails || errors.length ? 1 : 0);
