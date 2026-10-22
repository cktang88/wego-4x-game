// UX audit of the Empire modal (Research / Laws / Ships) across PC, tablet and phone viewports. For each viewport it
// opens the modal early (turn 1) and later (a few AI turns, some modules researched, a pending design / research / law),
// screenshots every tab and flags: clipped text, elements outside the viewport or their scroll container, icon-only
// buttons with no name, overlapping controls, touch targets under 44px (touch devices), horizontal scroll, text under
// the font floor and small text under 4.5:1 contrast.
//   node scripts/ux-audit-empire.mjs [outdir=/tmp/claude-0/ships-tab] [baseUrl=http://localhost:5173/] [--only=tag,tag] [--report]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const pos = args.filter(a => !a.startsWith('--'));
const out = pos[0] ?? '/tmp/claude-0/ships-tab';
const base = pos[1] ?? 'http://localhost:5173/';
const only = args.find(a => a.startsWith('--only='))?.slice(7);
const reportOnly = args.includes('--report');
const repo = process.env.TC_REPO ?? resolve(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(out, { recursive: true });

const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const tab = (w, h) => ({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPAD, touch: true });
const VPS = [
  { tag: 'pc1280', viewport: { width: 1280, height: 720 } },
  { tag: 'pc1366', viewport: { width: 1366, height: 768 } },
  { tag: 'pc1440', viewport: { width: 1440, height: 900 } },
  { tag: 'pc1920', viewport: { width: 1920, height: 1080 } },
  { tag: 'pc2560', viewport: { width: 2560, height: 1440 } },
  { tag: 'pc1024x1200', viewport: { width: 1024, height: 1200 } },
  { tag: 'ipadmini', ...tab(744, 1133) },
  { tag: 'ipad-p', ...tab(820, 1180) },
  { tag: 'ipad-l', ...tab(1180, 820) },
  { tag: 'ipadpro-p', ...tab(1024, 1366) },
  { tag: 'ipadpro-l', ...tab(1366, 1024) },
  { tag: 'phone', viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IOS, touch: true, phone: true },
  { tag: 'phone-l', viewport: { width: 852, height: 393 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IOS, touch: true, phone: true },
].filter(v => !only || only.split(',').includes(v.tag));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const wait = (page, ms = 250) => page.waitForTimeout(ms);
const errors = [];
const issues = [];

async function start(vp, mode = 'wego') {
  const { tag, touch, phone, ...opts } = vp;
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  await page.routeWebSocket(/\?token=/, () => {});
  page.on('pageerror', e => errors.push(`[${tag}] ${e.message}`));
  page.on('dialog', d => d.accept());
  await page.goto(base);
  await page.evaluate(() => { localStorage.clear(); for (const k of ['wego', 'live', 'v2']) localStorage.setItem(`tc.tutorial.${k}`, 'done'); localStorage.setItem('tc.herald.auto', 'off'); });
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
async function playTurns(page, n) {
  for (let i = 0; i < n; i++) {
    try { await page.evaluate(() => { const g = window.tc.screen; g.src.submit(window.__ai.planTurn(g.st, g.you, 'expert')); }); }
    catch (e) { errors.push(`playTurns: ${String(e.message).split('\n')[0]}`); }
    await wait(page, 150);
    await page.evaluate(() => window.tc.screen.endReplay?.());
    await wait(page, 100);
  }
  await page.evaluate(() => { const g = window.tc.screen; g.loadPlan?.(); g.renderAll(); });
  await wait(page, 200);
}
const open = (page, name, t) => page.evaluate(([n, t]) => window.__m.openModal(window.tc.screen, n, t), [name, t]);

/** The in-page detector: returns a list of issue strings for the open modal. */
const DETECT = ({ touch, phone }) => {
  const out = [];
  const root = document.querySelector('.mdl-root');
  if (!root) return ['modal not open'];
  const vw = innerWidth, vh = innerHeight;
  const ui = parseFloat(getComputedStyle(document.documentElement).fontSize) / 16;
  const floor = phone ? 13 : 14;
  const vis = el => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05; };
  const name = el => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}${el.dataset.id ? `[${el.dataset.id}]` : ''} "${(el.textContent || '').trim().slice(0, 24)}"`;
  const scroller = el => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll)/.test(s.overflowX + s.overflowY)) return p; } return null; };
  if (document.scrollingElement.scrollWidth > vw + 1) out.push(`page scrolls sideways (${document.scrollingElement.scrollWidth} > ${vw})`);
  const body = root.querySelector('.mdl-body');
  if (body && body.scrollWidth > body.clientWidth + 1) out.push(`modal body scrolls sideways (${body.scrollWidth} > ${body.clientWidth})`);
  // only what can be seen: inside the viewport and every scrolling ancestor's visible box
  const shown = el => {
    const r = el.getBoundingClientRect();
    if (r.bottom <= 0 || r.top >= vh) return false;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ps = getComputedStyle(p);
      if (/(auto|scroll)/.test(ps.overflowY)) { const pr = p.getBoundingClientRect(); if (r.top < pr.top - 1 || r.bottom > pr.bottom + 1) return false; }
    }
    return true;
  };
  const all = [...root.querySelectorAll('*')].filter(el => vis(el) && shown(el));
  for (const el of all) {
    const s = getComputedStyle(el);
    const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    // clipped text
    if (hasText && /(hidden|clip)/.test(s.overflowX + s.overflowY) && el.tagName !== 'svg') {
      if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 2) out.push(`clipped: ${name(el)} ${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight}`);
    }
    // font floor
    if (hasText) {
      const fs = parseFloat(s.fontSize);
      if (fs < floor - 0.05) out.push(`font ${fs.toFixed(1)}px < ${floor}: ${name(el)}`);
      // contrast of small text against the nearest solid background
      if (fs < 18 * ui) {
        const rgb = c => (c.match(/[\d.]+/g) || []).map(Number);
        const fg = rgb(s.color);
        let bg = null;
        for (let p = el; p; p = p.parentElement) { const b = rgb(getComputedStyle(p).backgroundColor); if (b.length >= 3 && (b[3] ?? 1) > 0.85) { bg = b; break; } }
        if (!bg) bg = [18, 19, 24];
        const L = c => { const [r, g, b] = c.slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
        const a = fg[3] ?? 1;
        const mixed = fg.slice(0, 3).map((v, i) => v * a + bg[i] * (1 - a));
        const op = (() => { let o = 1; for (let p = el; p; p = p.parentElement) o *= Number(getComputedStyle(p).opacity); return o; })();
        const eff = mixed.map((v, i) => v * op + bg[i] * (1 - op));
        const l1 = L(eff), l2 = L(bg);
        const cr = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        if (cr < 4.5) out.push(`contrast ${cr.toFixed(2)}: ${name(el)}`);
      }
    }
    // outside the viewport / its scroll container
    const r = el.getBoundingClientRect();
    const sc = scroller(el);
    if (!sc || sc === document.scrollingElement) { if (r.right > vw + 1 || r.left < -1) out.push(`outside viewport: ${name(el)} x ${r.left.toFixed(0)}..${r.right.toFixed(0)}`); }
    else if (getComputedStyle(sc).overflowX === 'hidden' || getComputedStyle(sc).overflowX === 'clip') {
      const sr = sc.getBoundingClientRect();
      if (r.right > sr.right + 1 || r.left < sr.left - 1) out.push(`outside its container: ${name(el)}`);
    }
  }
  // buttons
  const btns = all.filter(el => el.matches('button,[role=button],a[href]'));
  for (const b of btns) {
    const r = b.getBoundingClientRect();
    if (!b.textContent.trim() && !b.getAttribute('aria-label') && !b.getAttribute('title')) out.push(`unnamed icon button: ${name(b)}`);
    if (touch && (r.width < 43.5 || r.height < 43.5) && !b.closest('.rn-dots')) out.push(`tap target ${r.width.toFixed(0)}x${r.height.toFixed(0)}: ${name(b)}`);
    const lh = parseFloat(getComputedStyle(b).lineHeight) || parseFloat(getComputedStyle(b).fontSize) * 1.2;
    void lh;
  }
  for (let i = 0; i < btns.length; i++) for (let j = i + 1; j < btns.length; j++) {
    const a = btns[i].getBoundingClientRect(), b = btns[j].getBoundingClientRect();
    if (btns[i].contains(btns[j]) || btns[j].contains(btns[i])) continue;
    const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (ox > 2 && oy > 2) out.push(`overlap: ${name(btns[i])} / ${name(btns[j])}`);
  }
  return [...new Set(out)];
};

async function audit(page, vp, label) {
  for (const t of ['research', 'laws', 'ships']) {
    await open(page, 'empire', t);
    await wait(page, 500);
    await page.evaluate(() => { const b = document.querySelector('.mdl-body'); if (b) b.scrollTop = 0; });
    await page.screenshot({ path: `${out}/${vp.tag}-${label}-${t}.png` });
    if (t === 'ships' || vp.phone) {
      // the rest of a long tab
      const more = await page.evaluate(() => { const b = document.querySelector('.mdl-body'); if (!b || b.scrollHeight <= b.clientHeight + 4) return false; b.scrollTop = b.scrollHeight; return true; });
      if (more) { await wait(page, 150); await page.screenshot({ path: `${out}/${vp.tag}-${label}-${t}-end.png` }); }
    }
    const found = await page.evaluate(DETECT, { touch: !!vp.touch, phone: !!vp.phone });
    for (const f of found) issues.push(`[${vp.tag} ${label} ${t}] ${f}`);
  }
}

for (const vp of VPS) {
  const { ctx, page } = await start(vp);
  await audit(page, vp, 'early');
  await page.evaluate(() => window.__m.closeModal?.());
  await playTurns(page, 6);
  // later: two modules known, a pending design, research and a law
  await page.evaluate(() => {
    const g = window.tc.screen, p = g.st.players[g.you];
    for (const t of ['railguns', 'deflectors']) if (!p.techs.includes(t)) p.techs.push(t);
    g.renderAll();
  });
  await open(page, 'empire', 'ships');
  await wait(page, 400);
  const bp = await page.$('.mod[data-a=bp]');
  if (bp) { await bp.click(); await wait(page, 300); }
  await audit(page, vp, 'later');
  // a locked module says what it needs, and the tech link opens Research on it
  await open(page, 'empire', 'ships');
  await wait(page, 300);
  const lk = await page.$('.mod.lock[data-a=mod-why]');
  if (lk) {
    await lk.scrollIntoViewIfNeeded(); await lk.click({ force: true }); await wait(page, 300);
    const note = await page.$('.arm-note.lockn');
    if (!note) issues.push(`[${vp.tag}] tapping a locked module shows no requirement`);
    else {
      await note.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${out}/${vp.tag}-later-ships-lockwhy.png` });
      await page.click('.arm-note.lockn .arm-link'); await wait(page, 500);
      const ok = await page.evaluate(() => document.querySelector('.mdl-root')?.dataset.tab === 'research' && !!document.querySelector('.tcard'));
      if (!ok) issues.push(`[${vp.tag}] tech link did not open Research on the tech`);
      await page.screenshot({ path: `${out}/${vp.tag}-later-goto-research.png` });
    }
  }
  await ctx.close();
}
// LIVE: laws with banked orders, then with none (countdown to the next)
for (const vp of VPS.filter(v => ['pc1440', 'ipad-l', 'phone'].includes(v.tag))) {
  const { ctx, page } = await start(vp, 'live-fast');
  await open(page, 'empire', 'laws');
  await wait(page, 500);
  await page.screenshot({ path: `${out}/${vp.tag}-live-laws-banked.png` });
  const law = await page.$eval('[data-a=enact]', e => e.dataset.id).catch(() => null);
  if (law) { await page.click(`[data-a=enact][data-id="${law}"]`); await wait(page, 400); await page.screenshot({ path: `${out}/${vp.tag}-live-laws-enacting.png` }); }
  await page.evaluate(() => { const g = window.tc.screen; g.st.live.bank[g.you] = 0; g.st.live.nextOrderAt[g.you] = Date.now() + 12000; window.__m.openModal(g, 'empire', 'laws'); window.__m.refreshModal?.(); });
  await wait(page, 600);
  await page.screenshot({ path: `${out}/${vp.tag}-live-laws-nobank.png` });
  const found = await page.evaluate(DETECT, { touch: !!vp.touch, phone: !!vp.phone });
  for (const f of found) issues.push(`[${vp.tag} live laws] ${f}`);
  await ctx.close();
}
await browser.close();

for (const i of issues) console.log(i);
for (const e of errors) console.log(`ERROR ${e}`);
console.log(`${issues.length} issue(s), ${errors.length} page error(s); screenshots in ${out}`);
process.exit(!reportOnly && (issues.length || errors.length) ? 1 : 0);
