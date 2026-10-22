// UX audit of the modals and overlays: the modal shell (header, screen switcher, close, tab bars), Score (+ chat),
// Chronicle (filters, long entries, body chips), Help (every tab, Keys, Credits), the lobby's "How to play", the Herald
// (masthead, columns, dispatch form, edition navigation) and the Saga, at PC, tablet and phone sizes. The Empire
// modal's body is audited by its own owner; only its header (the shared shell and tab bar) is checked here.
//
// For every visible element inside the surface it flags:
//   clip      text cut by overflow hidden/clip (scroll size > client size), or an ellipsis that truncates
//   out       an element partly outside the viewport or a clipping ancestor (with no scroll container to reach it)
//   wrap      a short button label that wraps onto 2+ lines
//   label     an icon-only control with no title / aria-label
//   overlap   two interactive elements overlapping
//   tap       a touch target under 44x44 CSS px (touch viewports)
//   hscroll   horizontal page scroll
//   font      text under the floor (14px x UI scale on PC / tablet, 13px on phones)
//   contrast  small text under 4.5:1 (large text under 3:1) against its painted background
//
// node scripts/ux-audit-modals.mjs [--only=tag,tag] [--label=before|after] [--report] [--base=http://localhost:5173/]
// Screenshots: /tmp/claude-0/ux-pass/modals/<label>/<vp>-<state>.png
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = k => args.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const only = opt('only');
const label = opt('label') ?? 'after';
const base = opt('base') ?? 'http://localhost:5173/';
const reportOnly = args.includes('--report');
const verbose = args.includes('--verbose');
const out = `/tmp/claude-0/ux-pass/modals/${label}`;
mkdirSync(out, { recursive: true });

const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const tab = (w, h) => ({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPAD, touch: true });
const VPS = [
  { tag: 'pc1280', viewport: { width: 1280, height: 720 } },
  { tag: 'pc1366', viewport: { width: 1366, height: 768 } },
  { tag: 'pc1440', viewport: { width: 1440, height: 900 }, live: true },
  { tag: 'pc1920', viewport: { width: 1920, height: 1080 } },
  { tag: 'pc2560', viewport: { width: 2560, height: 1440 } },
  { tag: 'pc1024t', viewport: { width: 1024, height: 1200 } },
  { tag: 'mini', ...tab(744, 1133) },
  { tag: 'ipad', ...tab(820, 1180), live: true },
  { tag: 'ipadL', ...tab(1180, 820) },
  { tag: 'pro', ...tab(1024, 1366) },
  { tag: 'proL', ...tab(1366, 1024) },
  { tag: 'phone', viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IOS, touch: true, phone: true, live: true },
  { tag: 'phoneL', viewport: { width: 852, height: 393 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IOS, touch: true, phone: true },
].filter(v => !only || only.split(',').includes(v.tag));

const LONG = 'Archduchess Seraphine of the Ashen Reach'; // 40 chars
const LONG2 = 'The Most Serene Hegemony of Vel Anthrax'; // 39
const LONG3 = 'Grand Covenant of the Nine Silent Suns X'; // 40

// ------------------------------------------------------------------ in-page detector
const DETECT = ({ roots, touch, floor }) => {
  const issues = [];
  const W = innerWidth, H = innerHeight;
  const add = (k, el, msg) => issues.push({ k, el: desc(el), msg });
  function desc(el) {
    if (!el || !el.tagName) return '?';
    const c = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    const p = el.parentElement;
    const pc = p && typeof p.className === 'string' && p.className.trim() ? '.' + p.className.trim().split(/\s+/)[0] : '';
    const t = (el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 28);
    return `${p ? p.tagName.toLowerCase() + pc + ' > ' : ''}${el.tagName.toLowerCase()}${c}${t ? ` "${t}"` : ''}`;
  }
  const rootEls = roots.flatMap(s => [...document.querySelectorAll(s)]);
  const all = [];
  for (const r of rootEls) { all.push(r); r.querySelectorAll('*').forEach(e => all.push(e)); }
  const visible = el => {
    if (el.closest('[aria-hidden="true"], svg, script, style, template, option')) return false;
    if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0.5 && r.height > 0.5;
  };
  const ownText = el => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
  const hasText = el => !!el.textContent.trim();
  const INTER = 'button, a[href], input:not([type=hidden]), select, textarea, [role=tab], [data-a]:not(section):not(aside):not(div.mdl-back), [data-h]:not(.herald-back):not(section), [data-s]';
  // ---------------------------------------------------------------- clip / ellipsis
  for (const el of all) {
    if (!visible(el) || !hasText(el)) continue;
    const cs = getComputedStyle(el);
    const clipX = /hidden|clip/.test(cs.overflowX), clipY = /hidden|clip/.test(cs.overflowY);
    if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) { add('clip', el, `ellipsis truncates (${el.scrollWidth}>${el.clientWidth})`); continue; }
    if (clipX && el.scrollWidth > el.clientWidth + 1) add('clip', el, `text cut horizontally (${el.scrollWidth}>${el.clientWidth})`);
    else if (clipY && el.scrollHeight > el.clientHeight + 1 && el.clientHeight > 0) add('clip', el, `text cut vertically (${el.scrollHeight}>${el.clientHeight})`);
  }
  // ---------------------------------------------------------------- out of view / clipped by an ancestor
  for (const el of all) {
    if (!visible(el)) continue;
    const leaf = el.matches(INTER) || (ownText(el) && !el.closest(INTER));
    if (!leaf) continue;
    const r = el.getBoundingClientRect();
    let reach = { x: false, y: false }, fixed = false;
    let bad = '';
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.position === 'fixed') fixed = true;
      const ar = a.getBoundingClientRect();
      for (const ax of ['x', 'y']) {
        const ov = ax === 'x' ? cs.overflowX : cs.overflowY;
        if (ov === 'visible' || reach[ax]) continue;
        const lo = ax === 'x' ? r.left < ar.left - 1 : r.top < ar.top - 1;
        const hi = ax === 'x' ? r.right > ar.right + 1 : r.bottom > ar.bottom + 1;
        if (/auto|scroll/.test(ov) && (ax === 'x' ? a.scrollWidth > a.clientWidth + 1 : a.scrollHeight > a.clientHeight + 1)) { reach[ax] = true; continue; }
        if (/auto|scroll/.test(ov)) { reach[ax] = true; continue; }
        if ((lo || hi) && !bad) bad = `cut by ${desc(a).split(' "')[0]} on ${ax}`;
      }
      if (fixed) break;
    }
    if (bad) { add('out', el, bad); continue; }
    if ((!reach.x && (r.left < -1 || r.right > W + 1)) || (!reach.y && (r.top < -1 || r.bottom > H + 1))) add('out', el, `outside the viewport (${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)})`);
  }
  // ---------------------------------------------------------------- interactive elements: labels, wraps, taps, overlaps
  const inter = all.filter(el => el.matches(INTER) && visible(el) && getComputedStyle(el).pointerEvents !== 'none');
  const top = el => { // is the element (its centre) actually on top?
    const r = el.getBoundingClientRect();
    const x = Math.min(W - 1, Math.max(0, r.left + r.width / 2)), y = Math.min(H - 1, Math.max(0, r.top + r.height / 2));
    const t = document.elementFromPoint(x, y);
    return !!t && (el.contains(t) || t.contains(el));
  };
  const shown = [];
  for (const el of inter) {
    if (el.matches('[data-a="noop"]')) continue;
    const r = el.getBoundingClientRect();
    const txt = el.textContent.replace(/\s+/g, ' ').trim();
    const named = el.getAttribute('aria-label') || el.getAttribute('title') || (el.id && document.querySelector(`label[for="${el.id}"]`)) || el.closest('label') || el.getAttribute('placeholder');
    if (!/[\p{L}\p{N}]{2,}/u.test(txt) && !named && !el.matches('input, textarea, select')) add('label', el, 'icon-only control with no title or aria-label');
    const inlineA = el.tagName === 'A' && getComputedStyle(el).display === 'inline';
    if (el.matches('button, [role=tab], a') && !inlineA && txt && txt.length <= 32) {
      const rg = document.createRange(); rg.selectNodeContents(el);
      const tops = [];
      for (const q of rg.getClientRects()) if (q.width > 1 && !tops.some(t => Math.abs(t - q.top) < q.height * 0.6)) tops.push(q.top);
      const lh = parseFloat(getComputedStyle(el).fontSize) * 1.6;
      if (tops.length > 1 && Math.max(...tops) - Math.min(...tops) > lh * 0.5) add('wrap', el, `label wraps onto ${tops.length} lines`);
    }
    const onTop = top(el);
    if (onTop) shown.push(el);
    const inlineLink = el.tagName === 'A' && getComputedStyle(el).display === 'inline';
    if (touch && onTop && !inlineLink && (r.width < 43.5 || r.height < 43.5)) add('tap', el, `touch target ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  const pinned = el => { for (let a = el; a; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.position === 'sticky' || cs.position === 'fixed' || (cs.position === 'absolute' && cs.zIndex !== 'auto')) return a; } return null; };
  for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) {
    const a = shown[i], b = shown[j];
    if (a.contains(b) || b.contains(a)) continue;
    // content under a sticky bar or a drawer (another layer) is not an overlap
    if (pinned(a) !== pinned(b)) continue;
    // inline links wrap across lines: compare their line boxes, not their bounding boxes
    let hit = null;
    for (const p of a.getClientRects()) for (const q of b.getClientRects()) {
      const ix = Math.min(p.right, q.right) - Math.max(p.left, q.left), iy = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
      if (ix > 2 && iy > 2) hit = [ix, iy];
    }
    if (hit) add('overlap', a, `overlaps ${desc(b)} (${Math.round(hit[0])}x${Math.round(hit[1])})`);
  }
  // ---------------------------------------------------------------- gaps: a bar (tabs, buttons) much taller or wider than its items
  for (const el of all) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    if (!/flex|grid/.test(cs.display) || ownText(el) || el.matches(INTER)) continue;
    const kids = [...el.children].filter(visible);
    if (!kids.length || !kids.every(k => k.matches(INTER) || k.matches('nav, kbd, .mh-tabs, .mh-seg'))) continue;
    const r = el.getBoundingClientRect();
    let top = Infinity, bot = -Infinity;
    for (const k of kids) { const q = k.getBoundingClientRect(); top = Math.min(top, q.top); bot = Math.max(bot, q.bottom); }
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    const empty = r.height - pad - (bot - top);
    if (empty > 24) add('gap', el, `bar is ${Math.round(empty)}px taller than its items`);
  }
  // the modal header must leave room for the content
  for (const h of document.querySelectorAll('.mdl-head')) {
    if (!rootEls.some(r => r.contains(h) || r === h)) continue;
    const hh = h.getBoundingClientRect().height;
    if (hh > H * 0.4 && hh > 200) add('gap', h, `header takes ${Math.round(hh)}px of ${H}px`);
  }
  // ---------------------------------------------------------------- page scroll
  const sw = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
  if (sw > W + 1) issues.push({ k: 'hscroll', el: 'document', msg: `page scrolls sideways (${sw}>${W})` });
  // ---------------------------------------------------------------- font floor and contrast
  const cv = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true });
  const rgba = c => { cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#000'; cv.fillStyle = c; cv.fillRect(0, 0, 1, 1); const d = cv.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const COLRE = /(rgba?\([^)]*\)|color\([^)]*\)|oklab\([^)]*\)|oklch\([^)]*\)|#[0-9a-f]{3,8}\b)/gi;
  const over = (top, bot) => { const a = top[3]; return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1]; };
  const bgOf = el => {
    const layers = [];
    for (let a = el; a; a = a.parentElement) {
      const cs = getComputedStyle(a);
      const img = cs.backgroundImage;
      if (img && img !== 'none' && !/url\(/.test(img)) {
        // split the layer list at top-level commas; each gradient layer: alpha-weighted mean colour, mean alpha
        const parts = []; let d = 0, s0 = 0;
        for (let i = 0; i < img.length; i++) { const ch = img[i]; if (ch === '(') d++; else if (ch === ')') d--; else if (ch === ',' && d === 0) { parts.push(img.slice(s0, i)); s0 = i + 1; } }
        parts.push(img.slice(s0));
        for (const part of parts) {
          const cols = (part.replace(/^[a-z-]+\(/, '').match(COLRE) || []).map(rgba);
          if (!cols.length) continue;
          const wa = cols.reduce((s, c) => s + c[3], 0);
          if (wa <= 0.001) continue;
          layers.push([cols.reduce((s, c) => s + c[0] * c[3], 0) / wa, cols.reduce((s, c) => s + c[1] * c[3], 0) / wa, cols.reduce((s, c) => s + c[2] * c[3], 0) / wa, wa / cols.length]);
        }
      }
      const bc = rgba(cs.backgroundColor);
      if (bc[3] > 0) layers.push(bc);
      if (bc[3] >= 0.99) break;
    }
    let c = [11, 12, 16, 1];
    for (let i = layers.length - 1; i >= 0; i--) c = over(layers[i], c);
    return c;
  };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const seen = new Set();
  for (const r of rootEls) {
    const tw = document.createTreeWalker(r, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      const el = n.parentElement;
      if (!el || seen.has(el) || !n.textContent.trim()) continue;
      seen.add(el);
      if (!visible(el) || el.closest('textarea, input, select, kbd.decor')) continue;
      const rg = document.createRange(); rg.selectNodeContents(n);
      const rr = rg.getBoundingClientRect();
      if (rr.width < 1 || rr.height < 1) continue;
      const cs = getComputedStyle(el);
      const px = parseFloat(cs.fontSize) * (el.currentCSSZoom ?? 1);
      const isText = /[\p{L}\p{N}]/u.test(n.textContent);
      if (isText && px < floor - 0.01) add('font', el, `${px.toFixed(1)}px < ${floor.toFixed(1)}px`);
      if (!isText || el.closest(':disabled, [aria-disabled=true]')) continue;
      let op = 1;
      for (let a = el; a; a = a.parentElement) op *= parseFloat(getComputedStyle(a).opacity);
      if (op < 0.05) continue;
      const fg = rgba(cs.color); fg[3] *= op;
      const bg = bgOf(el);
      const f = over(fg, bg);
      const L1 = lum(f), L2 = lum(bg);
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const big = px >= 24 * (floor / 14 > 1 ? floor / 14 : 1) || (px >= 18.66 && parseInt(cs.fontWeight) >= 700);
      const need = big ? 3 : 4.5;
      if (ratio < need - 0.01) add('contrast', el, `${ratio.toFixed(2)}:1 < ${need} (${cs.color} on rgb(${bg.slice(0, 3).map(Math.round).join(',')}))`);
    }
  }
  return issues;
};

// ------------------------------------------------------------------ runner
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const totals = new Map(); // screen -> Map(kind -> n)
const allIssues = [];
let errorsTotal = 0;

async function runVp(vp, mode) {
  const ctx = await browser.newContext(vp);
  await ctx.addInitScript(() => {
    try { localStorage.clear(); localStorage.setItem('tc.tutorial.wego', 'done'); localStorage.setItem('tc.tutorial.live', 'done'); localStorage.setItem('tc.herald.auto', 'off'); } catch { /* */ }
  });
  const page = await ctx.newPage();
  if (mode === 'live') await page.clock.install();
  await page.routeWebSocket(/\?token=/, () => {});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const ev = (fn, a) => page.evaluate(fn, a);
  const tag = mode === 'live' ? `${vp.tag}-live` : vp.tag;
  let floor = 14;
  const audit = async (screen, roots, opts = {}) => {
    await page.waitForTimeout(opts.wait ?? 420);
    await page.screenshot({ path: `${out}/${tag}-${screen}.png`, timeout: 120000 }).catch(e => console.log(`warn ${tag} ${screen}: screenshot ${e.message.split('\n')[0]}`));
    const iss = await ev(DETECT, { roots, touch: !!vp.touch, floor });
    const key = screen.replace(/^\d+-/, '').replace(/-(late|long|early)$/, '');
    const dedup = new Map();
    for (const i of iss) dedup.set(`${i.k}|${i.el}|${i.msg}`, i);
    for (const i of dedup.values()) {
      allIssues.push({ vp: tag, screen, ...i });
      if (!totals.has(key)) totals.set(key, new Map());
      const m = totals.get(key); m.set(i.k, (m.get(i.k) ?? 0) + 1);
    }
    const list = [...dedup.values()];
    console.log(`${list.length ? 'FAIL' : 'ok  '} ${tag} ${screen}: ${list.length} issue(s)`);
    if (list.length) for (const i of list.slice(0, verbose ? 999 : 14)) console.log(`       [${i.k}] ${i.el} :: ${i.msg}`);
    if (list.length > 14 && !verbose) console.log(`       … +${list.length - 14} more`);
  };
  const closeAll = () => ev(async () => {
    const M = await import('/src/ui/modals.ts'); if (M.isModalOpen()) M.closeModal();
    document.querySelectorAll('.herald-ov, .saga-ov, .bv-overlay, .overlay').forEach(x => x.remove());
    const s = window.tc?.screen; s?.hud?.closePopovers?.(); s?.deselect?.();
  });
  const modal = async (m, t) => { await ev(([m, t]) => window.tc.screen.openModal(m, t || undefined), [m, t]); await page.waitForSelector('.mdl-root.show'); };
  const MODAL = ['.mdl-root'];

  // ---------------------------------------------------------------- lobby: How to play
  await page.goto(base);
  await page.waitForSelector('[data-l=start]');
  await ev(() => document.fonts.ready);
  floor = vp.phone ? 13 : 14 * await ev(() => parseFloat(getComputedStyle(document.documentElement).fontSize) / 16);
  if (mode !== 'live') {
    await page.click('[data-l=help]');
    await page.waitForSelector('.dialog.help');
    await audit('00-howto', ['.overlay:has(.dialog.help)']);
    await ev(() => document.querySelector('.dialog.help')?.scrollTo(0, 99999));
    await audit('00-howto-end', ['.overlay:has(.dialog.help)']);
    await closeAll();
  }

  // ---------------------------------------------------------------- start a game (long player name)
  await page.fill('[data-l=name]', LONG);
  await page.fill('[data-l=seed]', '4242');
  if (mode === 'live') await page.selectOption('[data-l=mode]', 'live-fast');
  page.on('dialog', d => d.accept());
  await page.click('[data-l=start]');
  await page.waitForFunction(() => window.tc?.screen?.st);
  await page.waitForTimeout(900);
  await closeAll();

  // ---------------------------------------------------------------- early game: every modal / tab
  await modal('empire', 'research');
  await audit('01-empire-head', ['.mdl-head']);
  await modal('score');
  await audit('02-score-early', MODAL);
  await ev(() => document.querySelector('[data-a="chat-toggle"]')?.click());
  await audit('03-score-chat', MODAL);
  await ev(() => document.querySelector('.chat [data-a="chat-toggle"]')?.click());
  await modal('chronicle');
  await audit('04-chronicle-early', MODAL);
  const helpTabs = await ev(async () => (await import('/src/ui/modal-help.ts')).HELP_TABS.map(t => t[0]));
  for (const t of mode === 'live' ? ['win', 'live'] : helpTabs) {
    await modal('help', t);
    await audit(`05-help-${t}`, MODAL);
    if (t === 'win') { await ev(() => document.querySelector('.mdl-body')?.scrollTo(0, 99999)); await audit('05-help-win-end', MODAL); }
  }
  await closeAll();

  // ---------------------------------------------------------------- play turns (AI on our seat), then long names everywhere
  const me = await ev(() => window.tc.screen.you);
  if (mode === 'live') {
    await page.clock.fastForward('04:00:00');
    await ev(() => { try { window.tc.screen.src.tickLive(); } catch { /* */ } });
  } else {
    await ev(() => { const s = window.tc.screen; s.src.save.seats[s.you].kind = 'ai'; s.plan.orders = s.plan.orders.map(() => null); s.savePlan(); });
    for (let i = 0; i < 12; i++) await ev(() => { try { window.tc.screen.src.advance(); } catch { /* */ } });
    await ev(a => { const s = window.tc.screen; s.src.save.seats[a].kind = 'human'; s.src.save.current = a; s.src.save.reveal = false; s.src.refresh(); s.onSourceChange('view'); if (s.replay) s.endReplay(); }, me);
  }
  await page.waitForTimeout(500);
  await closeAll();
  const longNames = () => ev(([a, b, c]) => {
    const st = window.tc.screen.st;
    const names = [a, b, c];
    st.players.forEach((p, i) => { p.name = names[i % 3]; });
    st.regions.forEach((r, i) => { if (i % 3 === 0) r.name = 'Hollowmere Cradle of Vanished Kings ' + (i % 10); });
    st.fleets.forEach((f, i) => { if (f.name && i % 2 === 0) f.name = 'The Unrepentant Lanterns of Morrow Gate'; });
    for (const e of st.chronicle.slice(-6)) e.text = `${a} takes Hollowmere Cradle of Vanished Kings from ${b} after a long and bloody siege that lasted many turns. The garrison was put to the sword.`;
    for (const ed of st.soul?.herald ?? []) for (const h of ed.headlines) if (h.drama > 0) h.text = h.text.length < 60 ? `${h.text}: ${b} Swears Revenge on ${c}` : h.text;
    const STORY = [
      `The siege lines closed at dawn. By the third pulse the garrison of Hollowmere had spent its last torpedoes, and the banners of ${b} came down one by one over the burning docks.`,
      'Witnesses on the orbital ring speak of a single frigate that refused to strike its colours, holding the gate alone until its reactor failed. Its name is not yet known.',
      `In the capital, ${c} has called the fall "a debt that will be paid in kind". Few doubt the words; fewer doubt the fleets now gathering behind them.`,
    ];
    for (const e2 of st.soul?.herald ?? []) e2.headlines.forEach((h, i) => { if (!h.body) { h.body = STORY.slice(0, i === 0 ? 3 : 1 + (i % 2)).join('\n'); if (i === 0) h.byline = 'From our correspondent at the front'; } });
    const ed = st.soul?.herald?.[st.soul.herald.length - 1];
    if (ed) {
      ed.dispatches = [
        { player: 1, text: 'Our fleets stand ready at every gate of the Reach; let the pretender come and see what waits for her there.', byline: b, as: 'house' },
        { player: 2, text: 'A source close to the throne says the Archduchess has no ships left.', byline: 'A source close to the court', as: 'source' },
      ];
    }
    for (const p of st.players) { p.vpLog = p.vpLog ?? []; }
  }, [LONG, LONG2, LONG3]);
  // the Herald as old saves print it (headlines only), unless the sim already writes stories
  await ev(() => window.tc.screen.openHerald());
  await page.waitForSelector('.herald-ov.show', { timeout: 5000 }).catch(() => {});
  await audit('11-herald-plain', ['.herald-ov'], { wait: 900 });
  await closeAll();
  await longNames();
  await modal('score');
  await audit('06-score-late', MODAL);
  await ev(() => document.querySelector('.mdl-body')?.scrollTo(0, 99999));
  await audit('06-score-late-end', MODAL);
  await ev(() => document.querySelector('[data-a="chat-toggle"]')?.click());
  await ev(() => { const s = window.tc.screen; for (let i = 0; i < 6; i++) s.src.chat.push({ seat: i % 3, to: i === 4 ? 1 : null, at: Date.now(), text: i % 2 ? 'Short.' : 'We will hold the line at Hollowmere until the last ship burns, and then some more after that.' }); });
  await ev(async () => { (await import('/src/ui/modals.ts')).refreshModal(); });
  await audit('07-score-chat-late', MODAL);
  await ev(() => document.querySelector('.chat [data-a="chat-toggle"]')?.click());
  await modal('chronicle');
  await ev(() => document.querySelectorAll('.ce-b:not([data-static])').forEach((b, i) => { if (i < 3) b.click(); }));
  await audit('08-chronicle-late', MODAL);
  for (const f of ['battles', 'mine']) {
    await ev(f => document.querySelector(`[data-a="chron-f"][data-id="${f}"]`)?.click(), f);
    await audit(`09-chronicle-${f}`, MODAL);
  }
  await ev(() => document.querySelector('[data-a="chron-f"][data-id="all"]')?.click());
  await modal('empire', 'laws');
  await audit('10-empire-head-late', ['.mdl-head']);
  await closeAll();

  // ---------------------------------------------------------------- the Herald
  await ev(() => window.tc.screen.openHerald());
  await page.waitForSelector('.herald-ov.show', { timeout: 5000 }).catch(() => {});
  await audit('11-herald', ['.herald-ov'], { wait: 900 });
  await ev(() => document.querySelector('.herald')?.scrollTo(0, 99999));
  await audit('11-herald-end', ['.herald-ov']);
  await ev(() => { const t = document.querySelector('[data-dispatch]'); if (t) { t.value = 'Let it be known that the Hegemony fears the dark between the stars.'; t.dispatchEvent(new Event('input', { bubbles: true })); } document.querySelector('[data-h="file"]')?.click(); });
  await page.waitForTimeout(300);
  await audit('12-herald-filed', ['.herald-ov']);
  await ev(() => document.querySelector('.hd-nav [data-h="ed"]')?.click());
  await audit('13-herald-prev', ['.herald-ov'], { wait: 700 });
  await closeAll();

  // ---------------------------------------------------------------- the end: victory (game.ts) and the Saga
  if (mode !== 'live') {
    await ev(() => { const s = window.tc.screen; s.src.save.seats[s.you].kind = 'ai'; s.src.save.reveal = true; });
    for (let i = 0; i < 80; i++) { const done = await ev(() => { const s = window.tc.screen; if (s.st.winner !== null) return true; try { s.src.advance(); } catch { return true; } return false; }); if (done) break; }
    await ev(() => { const s = window.tc.screen; if (s.replay) s.endReplay(); document.querySelectorAll('.herald-ov').forEach(x => x.remove()); });
    await page.waitForTimeout(900);
    await longNames();
    if (await page.$('[data-victory]')) await audit('14-victory', ['[data-victory]']);
    await ev(() => { document.querySelectorAll('.overlay').forEach(x => x.remove()); window.tc.screen.openSaga(); });
    await page.waitForSelector('.saga-ov.show', { timeout: 5000 }).catch(() => {});
    await audit('15-saga', ['.saga-ov'], { wait: 900 });
    await ev(() => document.querySelector('.saga-ov')?.scrollTo(0, 99999));
    await audit('15-saga-end', ['.saga-ov']);
    await closeAll();
    await modal('score');
    await audit('16-score-end', MODAL);
    await modal('chronicle');
    await audit('16-chronicle-end', MODAL);
  }
  if (errors.length) { console.log(`FAIL ${tag}: page errors: ${errors.slice(0, 3).join(' | ')}`); errorsTotal += errors.length; }
  await ctx.close();
}

const jobs = [];
for (const vp of VPS) { jobs.push([vp, 'wego']); if (vp.live) jobs.push([vp, 'live']); }
const par = Number(opt('par') ?? 3);
let next = 0;
await Promise.all(Array.from({ length: par }, async () => {
  while (next < jobs.length) {
    const [vp, mode] = jobs[next++];
    try { await runVp(vp, mode); } catch (e) { console.log(`FAIL ${vp.tag} ${mode}: ${e.message.split('\n')[0]}`); errorsTotal++; }
  }
}));
await browser.close();

console.log('\nissues per screen:');
for (const [s, m] of [...totals].sort()) console.log(`  ${s.padEnd(22)} ${[...m].map(([k, n]) => `${k} ${n}`).join(', ')}`);
const n = allIssues.length;
console.log(n || errorsTotal ? `\n${n} issue(s), ${errorsTotal} error(s)` : '\nall ok: 0 issues');
process.exit((n || errorsTotal) && !reportOnly ? 1 : 0);
