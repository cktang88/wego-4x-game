// UX audit: lobby, dialogs (tweaks, sound, help, game created, join, seat link, connection errors) and the battle
// viewer (battle-demo.html), at PC, tablet and phone sizes. For every visible element it flags clipped text,
// elements outside the viewport or their clip container, badly wrapping buttons, unlabeled icon-only buttons,
// overlapping interactive elements, small tap targets on touch screens, horizontal page scroll, text under the
// font floor and low contrast (inactive controls are exempt, as in WCAG). On the battle canvas it records every fillText box per frame and flags text that
// overprints other text (side labels, roster, callouts) or leaves the stage.
//   node scripts/ux-audit-lobby.mjs [outdir] [baseUrl] [--only=tag1,tag2] [--report]
// Screenshots: <outdir>/<vp>-<surface>.png (default /tmp/claude-0/ux-pass/lobby/after)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const pos = args.filter(a => !a.startsWith('--'));
const out = pos[0] ?? '/tmp/claude-0/ux-pass/lobby/after';
const base = (pos[1] ?? 'http://localhost:5173/').replace(/\/?$/, '/');
const only = args.find(a => a.startsWith('--only='))?.slice(7);
const reportOnly = args.includes('--report');
mkdirSync(out, { recursive: true });

const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const pc = (w, h) => ({ tag: `pc${w}x${h}`, viewport: { width: w, height: h } });
const tab = (tag, w, h) => ({ tag, viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPAD });
const VPS = [
  pc(1280, 720), pc(1366, 768), pc(1440, 900), pc(1920, 1080), pc(2560, 1440), pc(1024, 1200),
  tab('ipadmini', 744, 1133), tab('ipad-p', 820, 1180), tab('ipad-l', 1180, 820), tab('ipadpro-p', 1024, 1366), tab('ipadpro-l', 1366, 1024),
  { tag: 'phone', viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, phone: true, userAgent: IOS },
  { tag: 'phone-l', viewport: { width: 852, height: 393 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, phone: true, userAgent: IOS },
].filter(v => !only || only.split(',').includes(v.tag));

const LONG = 'Commander Maximiliana Ophelia Throckmorto';           // 41
const LONG_GAME = 'The Interminable Friday Night War of Ages';         // 41
const issues = new Map();   // surface key -> count
let total = 0;
const report = (vp, surface, list) => {
  const key = surface.replace(/^\d+[a-z]?-/, '');
  issues.set(key, (issues.get(key) ?? 0) + list.length);
  total += list.length;
  console.log(`${list.length ? 'FAIL' : 'ok  '} ${vp} ${surface}${list.length ? '\n      ' + list.slice(0, 14).join('\n      ') + (list.length > 14 ? `\n      ... +${list.length - 14} more` : '') : ''}`);
};

// ------------------------------------------------------------------ in-page: battle canvas text boxes per frame
const INIT = () => {
  try { localStorage.setItem('tc.tutorial.wego', 'done'); localStorage.setItem('tc.tutorial.live', 'done'); localStorage.setItem('tc.herald.auto', 'off'); } catch { /* */ }
  window.__bvText = [];
  const P = CanvasRenderingContext2D.prototype;
  const clear = P.clearRect;
  P.clearRect = function (...a) { if (this.canvas.closest?.('.bv-stage')) window.__bvText = []; return clear.apply(this, a); };
  const rec = orig => function (text, x, y, ...rest) {
    try {
      const c = this.canvas;
      if (c.closest?.('.bv-stage') && this.globalAlpha > 0.35 && String(text).trim()) {
        const m = this.measureText(String(text));
        const t = this.getTransform();
        const dpr = c.width / c.clientWidth;
        const k = Math.hypot(t.a, t.b) / dpr;
        const w = (m.actualBoundingBoxLeft + m.actualBoundingBoxRight) * k, h = (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) * k;
        const px = (t.a * x + t.c * y + t.e) / dpr, py = (t.b * x + t.d * y + t.f) / dpr;
        const l = px - m.actualBoundingBoxLeft * k, top = py - m.actualBoundingBoxAscent * k;
        const prev = window.__bvText.find(b => b.text === String(text) && Math.abs(b.l - l) < 1 && Math.abs(b.t - top) < 1);
        if (!prev) window.__bvText.push({ text: String(text), l, t: top, r: l + w, b: top + h, W: c.clientWidth, H: c.clientHeight });
      }
    } catch { /* */ }
    return orig.call(this, text, x, y, ...rest);
  };
  P.fillText = rec(P.fillText);
  P.strokeText = rec(P.strokeText);
};

// ------------------------------------------------------------------ in-page: the DOM detector
const AUDIT = ({ floor, touch, phone, scope }) => {
  const bad = [];
  // a modal covers the page: audit only the topmost one (what's under it is not reachable anyway)
  const top = [...document.querySelectorAll('.overlay, .bv-overlay')].pop();
  const root = scope ? document.querySelector(scope) ?? document.body : top ?? document.body;
  /** The part of el's box not clipped away by overflow ancestors (null when nothing of it shows). */
  const clipRect = el => {
    const r = el.getBoundingClientRect();
    let l = r.left, t = r.top, rr = r.right, b = r.bottom;
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
      const p = e.getBoundingClientRect();
      l = Math.max(l, p.left); t = Math.max(t, p.top); rr = Math.min(rr, p.right); b = Math.min(b, p.bottom);
    }
    return rr - l > 0.5 && b - t > 0.5 ? { left: l, top: t, right: rr, bottom: b, width: rr - l, height: b - t } : null;
  };
  const vis = el => {
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && !!clipRect(el);
  };
  const name = el => {
    const t = (el.getAttribute('aria-label') || el.title || el.textContent || el.value || el.placeholder || '').replace(/\s+/g, ' ').trim().slice(0, 32);
    const c = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    return `${el.tagName.toLowerCase()}${c} "${t}"`;
  };
  const VW = innerWidth, VH = innerHeight;
  // ---- colour helpers
  const parse = s => { const m = /rgba?\(([^)]+)\)/.exec(s); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; };
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const blend = (top, bot) => { const a = top[3]; return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1]; };
  const bgOf = el => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      const img = cs.backgroundImage;
      if (img && img !== 'none' && /gradient/.test(img)) {
        const cols = [...img.matchAll(/rgba?\([^)]+\)|#[0-9a-f]{3,8}/gi)].map(m => parse(m[0]) ?? null).filter(Boolean);
        if (cols.length) {
          // the lightest stop is the worst case for light text
          const c = cols.reduce((a, b) => (lum(b) * b[3] > lum(a) * a[3] ? b : a));
          layers.push(c);
          if (c[3] >= 0.99) break;
        }
      }
      const c = parse(cs.backgroundColor);
      if (c && c[3] > 0) { layers.push(c); if (c[3] >= 0.99) break; }
    }
    let col = [11, 12, 16, 1];
    for (let i = layers.length - 1; i >= 0; i--) col = blend(layers[i], col);
    return col;
  };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

  // ---- page scroll
  const sw = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
  if (sw > VW + 1) bad.push(`horizontal page scroll ${sw} > ${VW}`);

  const all = [...root.querySelectorAll('*')].filter(e => !e.closest('script,style,svg,[aria-hidden=true],.overlay-ghost,.bv-closing,.toast-out') && vis(e));
  // ---- text: clipping, font floor, contrast
  const textSeen = new Set();
  for (const el of all) {
    const cs = getComputedStyle(el);
    const ownText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    // clipped text (overflow hidden / clip and content bigger than the box)
    const ox = cs.overflowX, oy = cs.overflowY;
    if (!/^(INPUT|SELECT|TEXTAREA|CANVAS|IMG)$/.test(el.tagName) && el.textContent.trim()) {
      if ((ox === 'hidden' || ox === 'clip') && el.scrollWidth > el.clientWidth + 1) bad.push(`text clipped (x ${el.scrollWidth}>${el.clientWidth}${cs.textOverflow === 'ellipsis' ? ', ellipsis' : ''}): ${name(el)}`);
      else if ((oy === 'hidden' || oy === 'clip') && el.scrollHeight > el.clientHeight + 1 && !/^(BODY|HTML)$/.test(el.tagName)) bad.push(`text clipped (y ${el.scrollHeight}>${el.clientHeight}): ${name(el)}`);
    }
    // a select whose chosen option is wider than the box
    if (el.tagName === 'SELECT' && el.selectedOptions[0]) {
      const c = document.createElement('canvas').getContext('2d');
      c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const w = c.measureText(el.selectedOptions[0].text).width;
      const room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 18;
      if (w > room + 1) bad.push(`select text clipped (${Math.round(w)}>${Math.round(room)}): ${name(el)} "${el.selectedOptions[0].text.slice(0, 30)}"`);
    }
    if (ownText && !textSeen.has(el)) {
      textSeen.add(el);
      const px = parseFloat(cs.fontSize) * (el.currentCSSZoom ?? 1);
      if (px < floor - 0.01) bad.push(`font ${px.toFixed(1)}px < ${floor}: ${name(el)}`);
      const fg = parse(cs.color);
      if (fg && !el.closest('button.primary,[disabled],.bv-done,.bv-stage canvas')) {
        // mid-fade (a transition or animation running on it or an ancestor): judge it once it has settled
        let op = 1, moving = false;
        for (let e = el; e; e = e.parentElement) { op *= parseFloat(getComputedStyle(e).opacity); if (e.getAnimations().some(a => a.playState === 'running')) moving = true; }
        const bgc = bgOf(el);
        const fgc = blend([fg[0], fg[1], fg[2], fg[3] * op], bgc);
        const big = px >= 24 || (px >= 18.66 && Number(cs.fontWeight) >= 700);
        const cr = contrast(fgc, bgc);
        if (!moving && !big && cr < 4.5) bad.push(`contrast ${cr.toFixed(2)} < 4.5: ${name(el)}`);
      }
    }
    // outside the viewport (horizontally always; vertically only for fixed layers) or its clipping ancestor
    const r = el.getBoundingClientRect();
    if (r.right > VW + 1 || r.left < -1) bad.push(`outside viewport x [${Math.round(r.left)},${Math.round(r.right)}]: ${name(el)}`);
    else {
      let fixed = false;
      for (let e = el; e; e = e.parentElement) if (getComputedStyle(e).position === 'fixed') { fixed = true; break; }
      if (fixed && (r.bottom > VH + 1 || r.top < -1)) {
        // inside a scroll container that is itself on screen: fine
        let sc = null;
        for (let e = el.parentElement; e; e = e.parentElement) { const s = getComputedStyle(e); if (/(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight) { sc = e; break; } }
        if (!sc) bad.push(`outside viewport y [${Math.round(r.top)},${Math.round(r.bottom)}]: ${name(el)}`);
      }
      for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (/(hidden|clip)/.test(s.overflowX + s.overflowY) && !/(auto|scroll)/.test(s.overflowX + s.overflowY)) {
          const pr = e.getBoundingClientRect();
          if (r.right > pr.right + 1 || r.left < pr.left - 1 || r.bottom > pr.bottom + 1 || r.top < pr.top - 1) bad.push(`outside its clip box ${name(e)}: ${name(el)}`);
          break;
        }
        if (/(auto|scroll)/.test(s.overflowX)) { const pr = e.getBoundingClientRect(); if (r.right > pr.right + 1 || r.left < pr.left - 1) bad.push(`outside its scroller x: ${name(el)}`); break; }
      }
    }
  }
  // ---- interactive elements
  const inter = all.filter(e => e.matches('button,a[href],input:not([type=hidden]),select,textarea,[role=button],[tabindex]:not([tabindex="-1"])') && !e.closest('[inert]'));
  // half scrolled out of its scroller: the user scrolls it into view before touching it (sizes are still checked)
  const mostly = e => { const c = clipRect(e), f = e.getBoundingClientRect(); return c && c.width * c.height >= 0.6 * f.width * f.height; };
  for (const el of inter) {
    const r = clipRect(el);
    const cs = getComputedStyle(el);
    if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') {
      const txt = el.textContent.replace(/\s+/g, '').trim();
      if (!txt && !el.getAttribute('aria-label') && !el.title) bad.push(`icon-only button without a label: ${name(el)} ${el.outerHTML.slice(0, 60)}`);
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.25;
      const mids = [];
      const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = tw.nextNode(); n; n = tw.nextNode()) {
        if (!n.textContent.trim()) continue;
        const rg = document.createRange(); rg.selectNodeContents(n);
        for (const q of rg.getClientRects()) if (q.width > 1) mids.push((q.top + q.bottom) / 2);
      }
      mids.sort((a, b) => a - b);
      const lines = { size: mids.length ? 1 + mids.filter((m, i) => i && m - mids[i - 1] > parseFloat(cs.fontSize) * 0.7).length : 0 };
      if (txt && lines.size > 1) bad.push(`button label wraps (${lines.size} lines): ${name(el)}`);
    }
    if (touch) {
      const inline = el.tagName === 'A' && el.closest('p,li');
      const full = el.getBoundingClientRect();
      if (!inline && (full.width < 43.5 || full.height < 43.5) && !(el.tagName === 'INPUT' && /checkbox|radio/.test(el.type) && el.closest('label') && el.closest('label').getBoundingClientRect().height >= 43.5))
        bad.push(`tap target ${Math.round(full.width)}x${Math.round(full.height)} < 44: ${name(el)}`);
    }
    // occluded by something else at its centre (when on screen)
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (mostly(el) && cx > 0 && cy > 0 && cx < VW && cy < VH) {
      const hit = document.elementFromPoint(cx, cy);
      if (hit && hit !== el && !el.contains(hit) && !hit.contains(el) && !hit.closest('.toast,.uxtip') && !(el.tagName === 'INPUT' && hit.tagName === 'LABEL'))
        bad.push(`covered by ${name(hit)}: ${name(el)}`);
    }
  }
  for (let i = 0; i < inter.length; i++) for (let j = i + 1; j < inter.length; j++) {
    const a = inter[i], b = inter[j];
    if (a.contains(b) || b.contains(a) || !mostly(a) || !mostly(b)) continue;
    const p = clipRect(a), q = clipRect(b);
    const ox = Math.min(p.right, q.right) - Math.max(p.left, q.left), oy = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
    if (ox > 2 && oy > 2) bad.push(`interactive overlap: ${name(a)} / ${name(b)}`);
  }
  return [...new Set(bad)];
};

/** Battle canvas: text boxes drawn this frame that overprint each other or leave the stage. */
const CANVAS_AUDIT = () => {
  const bx = window.__bvText ?? [];
  const bad = [];
  for (const b of bx) if (b.l < -1 || b.r > b.W + 1 || b.t < -1 || b.b > b.H + 1) bad.push(`canvas text off stage: "${b.text.slice(0, 30)}" [${Math.round(b.l)},${Math.round(b.t)},${Math.round(b.r)},${Math.round(b.b)}] in ${b.W}x${b.H}`);
  for (let i = 0; i < bx.length; i++) for (let j = i + 1; j < bx.length; j++) {
    const a = bx[i], b = bx[j];
    if (a.text === b.text) continue;
    const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l), oy = Math.min(a.b, b.b) - Math.max(a.t, b.t);
    if (ox > 2 && oy > 2) bad.push(`canvas text overprint: "${a.text.slice(0, 26)}" / "${b.text.slice(0, 26)}"`);
  }
  return [...new Set(bad)];
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

// a game on the real server with a long name and open seats, for the join dialog
const mkGame = await fetch('http://localhost:8787/api/games', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: LONG_GAME, seats: [{ kind: 'human', name: LONG }, { kind: 'human' }, { kind: 'ai', aiLevel: 'expert' }] }) }).then(r => r.json()).catch(() => null);
const gameId = mkGame?.id;
if (gameId) await fetch(`http://localhost:8787/api/games/${gameId}/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seat: 0, name: LONG }) });

const FAKE_GAMES = [
  { id: 'g1', name: LONG_GAME, turn: 12, winner: null, mode: 'wego', seats: [
    { seat: 0, name: LONG, kind: 'human', aiLevel: 'standard', claimed: true, online: true, submitted: true },
    { seat: 1, name: 'Crimson Dominion', kind: 'human', aiLevel: 'standard', claimed: false, online: false, submitted: false },
    { seat: 2, name: 'Gilded Throneholders of the Western Reach', kind: 'ai', aiLevel: 'expert', claimed: true, online: false, submitted: true }] },
  { id: 'g2', name: 'Friday war', turn: 40, winner: 1, mode: 'live', seats: [
    { seat: 0, name: 'Azure', kind: 'human', aiLevel: 'standard', claimed: true, online: false, submitted: false },
    { seat: 1, name: 'Crimson', kind: 'human', aiLevel: 'standard', claimed: true, online: false, submitted: false },
    { seat: 2, name: 'Gilded', kind: 'ai', aiLevel: 'novice', claimed: true, online: false, submitted: false }] },
];

for (const vp of VPS) {
  const ctx = await browser.newContext(vp);
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  await page.routeWebSocket(/\?token=/, () => {});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  const touch = !!vp.hasTouch;
  let ui = 1;
  const surf = async (name, { scope, canvas = false, settle = 350 } = {}) => {
    await page.waitForTimeout(settle);
    await page.screenshot({ path: `${out}/${vp.tag}-${name}.png` });
    const floor = vp.phone ? 13 : 14 * ui;
    const list = await page.evaluate(AUDIT, { floor, touch, phone: !!vp.phone, scope });
    if (canvas) list.push(...await page.evaluate(CANVAS_AUDIT));
    report(vp.tag, name, list);
  };
  let gamesMode = 'fake';
  await page.route('**/api/games', r => {
    if (r.request().method() !== 'GET') return r.fallback();
    if (gamesMode === 'error') return r.abort();
    if (gamesMode === 'empty') return r.fulfill({ json: [] });
    return r.fulfill({ json: FAKE_GAMES });
  });

  // ---------------------------------------------------------------- lobby
  await page.goto(base);
  await page.evaluate(n => localStorage.setItem('tc.name', n), LONG);
  await page.reload();
  await page.waitForSelector('[data-l=start]');
  await page.evaluate(() => document.fonts.ready);
  ui = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize) / 16);
  await page.waitForTimeout(700);
  await surf('01-lobby');
  await page.evaluate(() => document.querySelector('.lobby')?.scrollTo(0, 99999));
  await surf('02-lobby-end');
  await page.evaluate(() => document.querySelector('.lobby')?.scrollTo(0, 0));
  // hotseat + live selections (longest option labels)
  await page.selectOption('[data-l=ai1]', 'human');
  await page.selectOption('[data-l=mode]', 'live-normal');
  await page.selectOption('[data-o=mode]', 'live-fast');
  await page.selectOption('[data-o=deadline]', '0');
  await surf('03-lobby-hotseat-live');
  gamesMode = 'empty'; await page.reload(); await page.waitForSelector('[data-l=start]'); await page.waitForTimeout(600);
  await page.evaluate(() => document.querySelector('[data-o=list]')?.scrollIntoView({ block: 'center' }));
  await surf('04-lobby-nogames');
  gamesMode = 'error'; await page.reload(); await page.waitForSelector('[data-l=start]'); await page.waitForTimeout(600);
  await page.evaluate(() => document.querySelector('[data-o=list]')?.scrollIntoView({ block: 'center' }));
  await surf('05-lobby-offline');
  gamesMode = 'fake'; await page.reload(); await page.waitForSelector('[data-l=start]'); await page.waitForTimeout(500);

  // ---------------------------------------------------------------- tweaks editor
  await page.evaluate(() => localStorage.setItem('tc.rules.overrides', JSON.stringify({ orders: { perTurn: 4 } })));
  await page.reload(); await page.waitForSelector('[data-l=tweaks]');
  await page.click('[data-l=tweaks]');
  await page.waitForSelector('.tweaks');
  await surf('06-tweaks', { scope: '.overlay' });
  await page.evaluate(() => { const d = document.querySelector('.overlay .dialog'); d?.scrollTo(0, d.scrollHeight / 2); });
  await surf('07-tweaks-mid', { scope: '.overlay' });
  await page.evaluate(() => { const d = document.querySelector('.overlay .dialog'); d?.scrollTo(0, 99999); });
  await surf('08-tweaks-end', { scope: '.overlay' });
  await page.keyboard.press('Escape');
  await page.evaluate(() => localStorage.removeItem('tc.rules.overrides'));
  await page.waitForTimeout(300);

  // ---------------------------------------------------------------- sound settings
  await page.click('[data-l=sound]');
  await page.waitForSelector('.snd-dlg');
  await surf('09-sound', { scope: '.overlay' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // ---------------------------------------------------------------- how to play
  await page.click('[data-l=help]');
  await page.waitForSelector('.overlay .help', { timeout: 8000 });
  await surf('10-help', { scope: '.overlay' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // ---------------------------------------------------------------- game created (mock the server)
  await page.route('**/api/games', r => r.request().method() === 'POST' ? r.fulfill({ json: { id: 'abcdef123456', meta: {} } }) : r.fallback());
  await page.route('**/api/games/abcdef123456/join', r => r.fulfill({ json: { token: 'tok', seat: 0 } }));
  await page.fill('[data-o=name]', LONG_GAME);
  await page.click('[data-o=create]');
  await page.waitForSelector('[data-go]');
  await surf('11-created', { scope: '.overlay' });
  await page.evaluate(() => document.querySelectorAll('.overlay').forEach(o => o.remove()));
  await page.unroute('**/api/games/abcdef123456/join');
  await page.evaluate(() => localStorage.removeItem('tc.token.abcdef123456'));

  // ---------------------------------------------------------------- join dialog, bad seat link, connection errors
  if (gameId) {
    await page.goto(`${base}#/g/${gameId}`);
    await page.waitForSelector('[data-seat]', { timeout: 8000 }).catch(() => {});
    await surf('12-join');
    await page.goto(`${base}#/g/${gameId}/not-a-real-token`);
    await page.waitForSelector('[data-seat]', { timeout: 8000 }).catch(() => {});
    await surf('13-seatlink-bad', { settle: 100 });
  } else report(vp.tag, '12-join', ['game server not reachable: join dialog not audited']);
  await page.goto(`${base}#/g/zzzz-no-such-game`);
  await page.waitForTimeout(800);
  await surf('14-no-such-game', { settle: 100 });
  await page.waitForTimeout(6000);
  await surf('15-no-such-game-later', { settle: 100 });
  await page.goto(`${base}#/`);
  await page.waitForTimeout(300);

  // ---------------------------------------------------------------- battle viewer (battle-demo.html)
  await page.goto(`${base}battle-demo.html?mode=none`);
  await page.waitForFunction(() => window.__bv);
  await page.evaluate(() => document.fonts.ready);
  for (const [tag, mk, long] of [['3way', 'threeWay', false], ['3way-long', 'threeWay', true], ['2way-long', 'twoWay', true]]) {
    await page.evaluate(([mk, long, LONG]) => {
      const { ctx, openBattleViewer } = window.__bv;
      const rep = window.__bv[mk]();
      const c = long ? { ...ctx, playerName: o => o === -1 ? 'The Warden of the Forgotten Southern Rift' : [LONG, 'Crimson Dominion of the Burning Reach', 'Gilded Throneholders of the Western Reach'][o],
        regionName: () => 'Widow Rift of the Shattered Crown Nebula' } : ctx;
      if (long) { rep.name = '2nd Battle of the Widow Rift of the Shattered Crown'; rep.sides.forEach(s => s.fleets.forEach(f => { f.name += ' of the Long Night'; })); }
      openBattleViewer(rep, c);
    }, [mk, long, LONG]);
    await page.waitForSelector('.bv-overlay [data-state=playing]');
    // pause on the opening card (it fades out at the end of the intro), then scrub through the fight
    await page.waitForTimeout(450);
    await page.evaluate(() => document.querySelector('.bv-overlay [data-state=playing]')?.click());
    await surf(`20-bv-${tag}-intro`, { canvas: true, settle: 400 });
    const fracs = [0.18, 0.3, 0.42, 0.55, 0.68, 0.8, 0.9];
    let k = 0;
    for (const f of fracs) {
      await page.evaluate(f => {
        const bar = document.querySelector('.bv-bar'); const r = bar.getBoundingClientRect();
        const o = { bubbles: true, clientX: r.left + r.width * f, clientY: r.top + r.height / 2, pointerId: 1 };
        bar.dispatchEvent(new PointerEvent('pointerdown', o)); bar.dispatchEvent(new PointerEvent('pointerup', o));
      }, f);
      await page.waitForTimeout(120);
      await surf(`21-bv-${tag}-t${String(++k)}`, { canvas: true, settle: 0 });
    }
    // play a stretch at normal speed, sampling frames for transient callouts
    await page.evaluate(() => document.querySelector('.bv-overlay [data-state=paused]')?.click());
    const seen = new Set();
    for (let i = 0; i < 16; i++) {
      await page.waitForTimeout(260);
      const l = await page.evaluate(CANVAS_AUDIT);
      for (const x of l) seen.add(x);
    }
    report(vp.tag, `22-bv-${tag}-play`, [...seen]);
    await page.evaluate(() => [...document.querySelectorAll('.bv-overlay .bv-btn')].find(b => b.title === 'Skip to the result')?.click());
    await page.waitForTimeout(500);
    await surf(`23-bv-${tag}-end`, { settle: 200 });
    await page.evaluate(() => document.querySelector('.bv-overlay .bv-card.bv-end')?.scrollTo(0, 99999));
    await surf(`24-bv-${tag}-end-scrolled`, { settle: 100 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  if (errors.length) report(vp.tag, '99-errors', errors.slice(0, 5));
  await ctx.close();
}
await browser.close();
console.log('\nissues per surface:');
for (const [k, v] of issues) if (v) console.log(`  ${k}: ${v}`);
console.log(total ? `\n${total} issues` : '\nzero issues');
process.exit(total && !reportOnly ? 1 : 0);
