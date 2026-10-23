// UX audit of the game board's HUD and cards: the top bar, plan strip + primary, tool buttons, the fleet and world
// cards in their states, the founding sheet, ring, drag preview, popovers, tips, toasts, callouts, the Charge offer,
// the hotseat curtain and the LIVE HUD, at PC, tablet and phone viewports. For every visible element it flags:
//   clip     text cut off (overflow hidden / ellipsis / line-clamp actually truncating)
//   off      element partly outside the viewport (or outside a non-scrolling clip box)
//   wrap     a button label wrapping onto two lines
//   noname   an icon-only button with no aria-label / title
//   overlap  interactive elements overlapping, or one covered by another
//   tap      tap target under 44x44 CSS px on touch devices
//   hscroll  horizontal page scroll
//   font     text under the floor (14px x ui on desktop/tablet, 13px on phones)
//   contrast small text under 4.5:1
// node scripts/ux-audit-hud.mjs [outdir] [base] [--only=tag,tag] [--report] [--verbose]
// Screenshots: <outdir>/<vp>-<surface>.jpg (default /tmp/claude-0/ux-pass/hud/now)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const args = process.argv.slice(2);
const pos = args.filter(a => !a.startsWith('--'));
const out = pos[0] ?? '/tmp/claude-0/ux-pass/hud/now';
const base = pos[1] ?? 'http://localhost:5173/';
const only = args.find(a => a.startsWith('--only='))?.slice(7);
const reportOnly = args.includes('--report');
const verbose = args.includes('--verbose');
mkdirSync(out, { recursive: true });

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const tab = (w, h) => ({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPAD_UA, touch: true });
const VPS = [
  { tag: 'pc1280', viewport: { width: 1280, height: 720 } },
  { tag: 'pc1366', viewport: { width: 1366, height: 768 } },
  { tag: 'pc1440', viewport: { width: 1440, height: 900 } },
  { tag: 'pc1920', viewport: { width: 1920, height: 1080 } },
  { tag: 'pc2560', viewport: { width: 2560, height: 1440 } },
  { tag: 'pc1024t', viewport: { width: 1024, height: 1200 } },
  { tag: 'mini', ...tab(744, 1133) },
  { tag: 'ipadP', ...tab(820, 1180) },
  { tag: 'ipadL', ...tab(1180, 820) },
  { tag: 'proP', ...tab(1024, 1366) },
  { tag: 'proL', ...tab(1366, 1024) },
  { tag: 'phone', viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA, touch: true },
  { tag: 'phoneL', viewport: { width: 852, height: 393 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA, touch: true },
].filter(v => !only || only.split(',').includes(v.tag));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const totals = {};
let total = 0;

const INIT = () => { try { localStorage.setItem('tc.tutorial.wego', 'done'); localStorage.setItem('tc.tutorial.live', 'done'); localStorage.setItem('tc.herald.auto', 'off'); } catch { /* */ } };

// ------------------------------------------------------------------ the in-page detector
const DETECT = ({ floor, touch }) => {
  const SCOPE = '.hud, .uxtip, .toast, .chargeoffer, .overlay:not(.mdl-back)';
  const SKIP = '.mdl-root, .herald-ov, .saga-ov, .bv-overlay, .lobby, script, style, canvas';
  const IA = 'button, a[href], input, select, textarea, [role=button], [data-a], [data-k], [data-n], [data-slot], [data-ship]';
  const W = innerWidth, H = innerHeight;
  const issues = [];
  const name = el => {
    const c = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
    const d = el.dataset?.a ? `[a=${el.dataset.a}]` : el.dataset?.k ? `[k=${el.dataset.k}]` : el.dataset?.act ? `[act=${el.dataset.act}]` : '';
    const p = el.parentElement;
    const pc = p && typeof p.className === 'string' && p.className.trim() ? '.' + p.className.trim().split(/\s+/)[0] : '';
    return `${p ? p.tagName.toLowerCase() + pc + ' > ' : ''}${el.tagName.toLowerCase()}${c}${d}`;
  };
  const txt = el => (el.innerText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const vis = el => {
    if (el.closest(SKIP)) return false;
    if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 1 && r.height >= 1;
  };
  const els = [...document.querySelectorAll(SCOPE)].flatMap(root => [root, ...root.querySelectorAll('*')]).filter(e => !(e instanceof SVGElement) && vis(e));
  const add = (k, el, msg) => issues.push({ k, w: `${name(el)} "${txt(el)}" ${msg}` });
  // clip boxes: the visible rect of an element after its clipping ancestors (scroll containers are fine to clip)
  const clipAnc = el => { for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const cs = getComputedStyle(a); if (/hidden|clip/.test(cs.overflowX + cs.overflowY) && !/auto|scroll/.test(cs.overflowX + cs.overflowY)) return a; if (/auto|scroll/.test(cs.overflowX + cs.overflowY)) return null; } return null; };
  const scrollAnc = el => { for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const cs = getComputedStyle(a); if (/auto|scroll/.test(cs.overflowY + cs.overflowX)) return a; } return null; };

  for (const el of els) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    const anyText = (el.textContent ?? '').trim().length > 0;
    // ---- clip
    if (anyText) {
      const ox = cs.overflowX, oy = cs.overflowY;
      const clamp = cs.webkitLineClamp && cs.webkitLineClamp !== 'none';
      if ((/hidden|clip/.test(ox) || cs.textOverflow === 'ellipsis') && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) add('clip', el, `x ${el.scrollWidth}>${el.clientWidth}`);
      else if ((/hidden|clip/.test(oy) || clamp) && el.scrollHeight > el.clientHeight + 1 && el.clientHeight > 0 && !/auto|scroll/.test(oy)) add('clip', el, `y ${el.scrollHeight}>${el.clientHeight}`);
    }
    // ---- off-screen / outside a clip box
    const ia = el.matches(IA);
    if ((ia || hasText) && !el.closest('.dragcard, .ghost, .banner')) {
      const sa = scrollAnc(el);
      if (!sa) {
        if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) add('off', el, `rect ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} vp ${W}x${H}`);
      } else {
        const sr = sa.getBoundingClientRect();
        if (sr.left < -1 || sr.top < -1 || sr.right > W + 1 || sr.bottom > H + 1) { if (!sa.dataset.auditOff) { sa.dataset.auditOff = '1'; add('off', sa, `scroll box ${Math.round(sr.left)},${Math.round(sr.top)} ${Math.round(sr.width)}x${Math.round(sr.height)} vp ${W}x${H}`); } }
        if (r.left < sr.left - 1 || r.right > sr.right + 1) add('off', el, 'sideways outside its scroll box');
      }
      const ca = clipAnc(el);
      if (ca && hasText) { const cr = ca.getBoundingClientRect(); if (r.left < cr.left - 1 || r.right > cr.right + 1 || r.top < cr.top - 1 || r.bottom > cr.bottom + 1) add('clip', el, `outside clip box ${name(ca)}`); }
    }
    // ---- buttons: wrapping labels, icon-only without a name
    if (el.matches('button, [role=button]')) {
      const t = (el.textContent ?? '').replace(/\s+/g, '');
      const named = el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('aria-labelledby');
      if ((t.length === 0 || (t.length <= 2 && !/[0-9A-Za-z]{2}/.test(t))) && !named) add('noname', el, 'icon-only, no aria-label/title');
      for (const n of el.querySelectorAll('*')) { if (n.closest('button, [role=button]') !== el) continue; }
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (!n.textContent.trim() || n.parentElement.closest('button, [role=button]') !== el) continue;
        const pe = n.parentElement, pcs = getComputedStyle(pe);
        if (pcs.whiteSpace === 'normal' && pe.matches('small, .twhy, .bet, .desc, em')) continue; // descriptions may wrap
        const rg = document.createRange(); rg.selectNodeContents(n);
        const tops = new Set([...rg.getClientRects()].filter(q => q.width > 0.5).map(q => Math.round(q.top)));
        if (tops.size > 1) { add('wrap', el, `"${n.textContent.trim().slice(0, 30)}" on ${tops.size} lines`); break; }
      }
    }
    // ---- tap size
    if (touch && ia && el.matches('button, a[href], input, select, [role=button]') && !el.closest('.uxtip, .toast, .dragcard') && cs.pointerEvents !== 'none') {
      // a checkbox's target is its label
      const tr = el.matches('input[type=checkbox], input[type=radio]') && el.closest('label') ? el.closest('label').getBoundingClientRect() : r;
      if (tr.width < 43.5 || tr.height < 43.5) add('tap', el, `${Math.round(tr.width)}x${Math.round(tr.height)}`);
    }
    // ---- font floor + contrast (text-bearing elements)
    if (hasText) {
      const px = parseFloat(cs.fontSize) * (el.currentCSSZoom ?? 1);
      if (px < floor - 0.01) add('font', el, `${px.toFixed(1)}px < ${floor}`);
      const big = px >= 24 || (px >= 18.66 && Number(cs.fontWeight) >= 700);
      const disabled = el.closest('[aria-disabled=true], :disabled, .locked, .done');
      if (!big && !disabled) {
        const parse = s => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
        const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
        const blend = (top, bot) => { const a = top[3]; return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1]; };
        // background stack: walk up collecting layers (solid colours and gradient stops: worst case)
        const layers = [];
        let op = 1;
        for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
          const s = getComputedStyle(a);
          op *= parseFloat(s.opacity);
          const bi = s.backgroundImage;
          // gradient stops: text sits mid-plate, so a 3+ stop gradient is judged on its inner stops, a 2-stop one on its midpoint
          let stops = bi && bi !== 'none' ? [...bi.matchAll(/rgba?\([^)]+\)/g)].map(m => parse(m[0])).filter(Boolean) : [];
          if (stops.length >= 3) stops = stops.slice(1, -1);
          else if (stops.length === 2) stops = [stops[0].map((v, i) => (v + stops[1][i]) / 2)];
          const bc = parse(s.backgroundColor);
          if (stops.length || (bc && bc[3] > 0)) layers.push({ stops: stops.length ? stops : [bc], bc });
          if ((bc && bc[3] >= 0.99) || (stops.length && stops.every(c => c[3] >= 0.99))) break;
        }
        const board = [11, 12, 16, 1];
        let fg = parse(cs.color); if (fg) { fg = [...fg]; fg[3] *= op; }
        // worst-case background: try every stop combination (first two layers)
        let worst = Infinity;
        const combos = layers.length ? layers.reverse().reduce((acc, L) => acc.flatMap(b => L.stops.map(c => blend(c, b))), [board]) : [board];
        for (const bg of combos.slice(0, 40)) {
          if (!fg) break;
          const f = blend(fg, bg);
          const l1 = lum(f), l2 = lum(bg);
          const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
          worst = Math.min(worst, ratio);
        }
        if (worst < 4.5) add('contrast', el, `${worst.toFixed(2)}:1 (${cs.color})`);
      }
    }
  }
  // ---- overlaps among interactive elements (not nested), and covered ones
  const ias = els.filter(e => e.matches('button, input, select, [role=button]') && getComputedStyle(e).pointerEvents !== 'none' && !e.closest('.uxtip, .toast'));
  // each element's visible rect: cut to its scroll container (what is scrolled away can't overlap anything)
  const rects = ias.map(e => { const r = e.getBoundingClientRect(); const s = scrollAnc(e); if (!s) return r; const q = s.getBoundingClientRect(); const top = Math.max(r.top, q.top), bottom = Math.min(r.bottom, q.bottom), left = Math.max(r.left, q.left), right = Math.min(r.right, q.right); return { top, bottom: Math.max(top, bottom), left, right: Math.max(left, right), width: Math.max(0, right - left), height: Math.max(0, bottom - top) }; });
  const layer = e => e.closest('.overlay') ? 'ov' : 'hud';
  // a sticky header / footer in a scroll box: what scrolls under it is reachable by scrolling, not covered
  const sticky = e => { for (let a = e; a && a !== document.body; a = a.parentElement) { const p = getComputedStyle(a).position; if (p === 'sticky') return true; if (/auto|scroll/.test(getComputedStyle(a).overflowY)) return false; } return false; };
  for (let i = 0; i < ias.length; i++) {
    for (let j = i + 1; j < ias.length; j++) {
      if (ias[i].contains(ias[j]) || ias[j].contains(ias[i]) || layer(ias[i]) !== layer(ias[j])) continue;
      if (!!ias[i].closest('.pop, .freelist') !== !!ias[j].closest('.pop, .freelist')) continue;
      if (sticky(ias[i]) !== sticky(ias[j])) continue;   // an open popover floats above the HUD on purpose
      const a = rects[i], b = rects[j];
      const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left), iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ix > 2 && iy > 2) {
        // only count what is actually stacked on screen (scroll containers clip their children)
        add('overlap', ias[i], `overlaps ${name(ias[j])} "${txt(ias[j])}" by ${Math.round(ix)}x${Math.round(iy)}`);
      }
    }
    // covered: the centre point hits something else (that is not a tooltip / drag preview)
    const r = rects[i];
    if (r.height < 4 || r.width < 4) continue;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cx < 0 || cy < 0 || cx > W || cy > H) continue;
    const sa = scrollAnc(ias[i]);
    if (sa) { const q = sa.getBoundingClientRect(); if (cy < q.top || cy > q.bottom) continue; }
    const hit = document.elementFromPoint(cx, cy);
    if (hit && !ias[i].contains(hit) && !hit.contains(ias[i]) && !(hit.closest('.pop, .freelist') && !ias[i].closest('.pop, .freelist')) && !(sticky(hit) && !sticky(ias[i])) && !hit.closest('.uxtip, .toast, .dragcard, .ghost, .callout') && !(hit.closest('.overlay') && !ias[i].closest('.overlay'))) {
      if (!hit.closest(SKIP)) add('overlap', ias[i], `covered by ${name(hit)}`);
    }
  }
  // ---- page scroll
  const sw = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
  if (sw > W + 1) issues.push({ k: 'hscroll', w: `page ${sw} > ${W}` });
  document.querySelectorAll('[data-audit-off]').forEach(e => delete e.dataset.auditOff);
  return issues;
};

// ------------------------------------------------------------------ flows
for (const vp of VPS) {
  const ctx = await browser.newContext(vp);
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  await page.routeWebSocket(/\?token=/, () => {});
  await page.emulateMedia({ reducedMotion: 'reduce' });   // fewer animations to wait out on a busy machine
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept().catch(() => {}));
  // a broken step (or another module mid-edit) must not stop the audit: log it and go on
  const ev = async (fn, a) => { try { return await page.evaluate(fn, a); } catch (e) { errors.push(String(e.message).split('\n')[0]); return null; } };
  const edit = (src, a) => ev(([src, a]) => { const s = window.tc.screen; new Function('s', 'st', 'a', src)(s, s.src.save.state, a); s.src.refresh(); s.onSourceChange('view'); }, [src, a]);
  const phone = vp.viewport.width <= 700;
  const isTouch = !!vp.touch;
  const counts = {};
  let n = 0;
  let ui = 1;
  const surf = async (nm, wait = 300) => {
    await page.waitForTimeout(wait);
    await page.screenshot({ path: `${out}/${vp.tag}-${nm}.jpg`, type: 'jpeg', quality: 80, scale: 'css' });
    const floor = phone ? 13 : 14 * ui;
    const t0 = Date.now();
    const iss = await ev(DETECT, { floor, touch: isTouch });
    if (!iss) { console.log(`  ${vp.tag} ${nm}: DETECT failed: ${errors.at(-1)}`); counts.error = (counts.error ?? 0) + 1; n++; return; }
    if (verbose && Date.now() - t0 > 3000) console.log(`  ${vp.tag} ${nm}: detect took ${Date.now() - t0}ms`);
    const uniq = [...new Map(iss.map(i => [i.k + i.w, i])).values()];
    for (const i of uniq) counts[i.k] = (counts[i.k] ?? 0) + 1;
    n += uniq.length;
    if (uniq.length) {
      console.log(`  ${vp.tag} ${nm}: ${uniq.length}`);
      for (const i of uniq.slice(0, verbose ? 999 : 14)) console.log(`      ${i.k.padEnd(8)} ${i.w}`);
      if (!verbose && uniq.length > 14) console.log(`      ... +${uniq.length - 14}`);
    }
  };
  const closeAll = () => ev(() => {
    document.querySelectorAll('.overlay:not(.curtain), .chargeoffer, .toast').forEach(x => x.remove());
    const s = window.tc.screen; s.hud.closePopovers?.(); s.deselect?.(); s.hideTip?.();
  });
  const select = (kind, id) => ev(([kind, id]) => { const s = window.tc.screen; s.select({ kind, id }); const site = kind === 'region' ? s.st.regions[id].site : s.st.regions[s.fleet(id).region].site; s.focus(site); }, [kind, id]);
  const startGame = async (opts = {}) => {
    await page.goto(base);
    await page.waitForSelector('[data-l=start]');
    if (opts.hotseat) await page.selectOption('[data-l=ai1]', 'human');
    if (opts.mode) await page.selectOption('[data-o=mode]', opts.mode);
    await page.fill('[data-l=seed]', '4242');
    await page.click('[data-l=start]');
    await page.waitForFunction(() => window.tc?.screen?.st);
    await ev(() => document.fonts.ready);
    ui = await ev(() => parseFloat(getComputedStyle(document.documentElement).fontSize) / 16);
    await page.waitForTimeout(900);
  };
  console.log(`${vp.tag} ${vp.viewport.width}x${vp.viewport.height}`);

  // ================================================================ WEGO, turn 1
  await startGame();
  await surf('01-hud');
  const keys = await ev(() => [...document.querySelectorAll('.hud-tc [data-k]')].map(e => e.dataset.k));
  for (const k of [keys[0], 'fate'].filter(k => keys.includes(k))) { await ev(k => window.tc.screen.hud.showPop('res:' + k, document.querySelector(`.hud-tc [data-k=${k}]`)), k); await surf(`02-pop-${k}`, 150); }
  for (const k of ['menu', 'lens', 'legend']) { await ev(k => window.tc.screen.hud.showPop(k, document.querySelector(`.hud-br [data-act=${k}]`) ?? document.querySelector('.hud-br [data-act=menu]')), k); await surf(`03-pop-${k}`, 150); }
  await ev(() => window.tc.screen.hud.closePopovers());
  // tooltip on the first crest (long text)
  await ev(() => { const e = document.querySelector('.pcrest'); const r = e.getBoundingClientRect(); e.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse', clientX: r.left + 4, clientY: r.top + 4 })); });
  if (isTouch) {
    await ev(() => { const e = document.querySelector('.pcrest'); const r = e.getBoundingClientRect(); e.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: r.left + 4, clientY: r.top + 4 })); });
    await page.waitForTimeout(600);
    await ev(() => document.querySelector('.pcrest').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' })));
  } else await page.hover('.pcrest');
  await surf('04-tooltip', 150);
  await ev(() => window.tc.screen.hideTip());
  await ev(async () => (await import('/src/ui/dom.ts')).toast('⚠ Short: 4 credits, 2 alloys for the Dreadnought at Wolf-Rayet Gate'));
  await surf('05-toast', 150);
  await ev(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
  // fleet card (biggest fleet) + more
  const fid = await ev(() => { const s = window.tc.screen; return s.st.fleets.filter(f => f.owner === s.you && f.ships.length).sort((a, b) => b.ships.length - a.ships.length)[0].id; });
  await select('fleet', fid);
  await surf('06-fleet');
  // the fleet card's Story verb (commander, boons, saga, rename), then back to Orders
  if (await page.$('.card [data-a=ftab][data-t=story]')) { await ev(() => document.querySelector('.card [data-a=ftab][data-t=story]').click()); await surf('07-fleet-story'); await ev(() => document.querySelector('.card [data-a=ftab][data-t=orders]')?.click()); }
  // drag-preview card (desktop hover over a neighbour)
  if (!isTouch) {
    const xy = await ev(fid => { const s = window.tc.screen; const f = s.fleet(fid); const n = s.st.regions[f.region].neighbors[0]; const p = s.map.toScreen(s.st.regions[n].site); const r = s.el.canvas.getBoundingClientRect(); return [p.x + r.left, p.y + r.top]; }, fid);
    await page.mouse.move(xy[0] - 3, xy[1] - 3); await page.mouse.move(xy[0], xy[1], { steps: 3 });
    await surf('08-preview', 250);
    await page.mouse.move(2, vp.viewport.height / 2);
  }
  // world card: capital, build tray
  const cap = await ev(() => { const s = window.tc.screen; return s.st.players[s.you].capital; });
  await select('region', cap);
  await surf('09-world', 500);
  // the world card's three verbs (Raise with its locks open, Improve with a track's buildings open, Story)
  await ev(() => document.querySelector('.card [data-a=tab][data-t=raise]')?.click());
  await ev(() => document.querySelector('.card [data-a=lockx]')?.click());
  await surf('10-world-build', 200);
  await ev(() => document.querySelector('.card [data-a=lockx]')?.click());
  await ev(() => document.querySelector('.card [data-a=tab][data-t=improve]')?.click());
  await ev(() => document.querySelector('.card [data-a=trkx][data-track=works]')?.click());
  await surf('10b-world-develop', 200);
  await ev(() => document.querySelector('.card [data-a=trkx][data-track=works]')?.click());
  await ev(() => document.querySelector('.card [data-a=tab][data-t=story]')?.click());
  await surf('10c-world-story', 200);
  await ev(() => document.querySelector('.card [data-a=tab][data-t=raise]')?.click());
  // founding sheet (Into: step the selector to a new banner)
  for (let i = 0; i < 5 && await ev(() => !!document.querySelector('.card [data-a=intonext]') && !/New banner/.test(document.querySelector('.card [data-a=intonext]').textContent)); i++) { await ev(() => document.querySelector('.card [data-a=intonext]').click()); await page.waitForTimeout(100); }
  if (await page.$('.card [data-a=build][data-cls=frigate]')) {
    await ev(() => document.querySelector('[data-a=build][data-cls=frigate]')?.click());
    await page.waitForSelector('[data-found]', { timeout: 4000 }).catch(() => {});
    await surf('11-founding');
    await ev(() => { const d = document.querySelector('[data-found]'); d?.closest('.dialog')?.scrollTo?.(0, 99999); d?.scrollTo?.(0, 99999); });
    await surf('11b-founding-end', 150);
    await ev(() => document.querySelector('[data-found]')?.closest('.overlay')?.remove());
  }
  // context ring
  await ev(() => window.tc.screen.deselect());
  await ev(fid => { const s = window.tc.screen; const p = s.map.toScreen(s.lastFleetPos.get(fid) ?? s.st.regions[s.fleet(fid).region].site); const r = s.el.canvas.getBoundingClientRect(); s.gest.openRingAt(p.x + r.left, p.y + r.top, null); }, fid).catch(() => {});
  await page.waitForTimeout(200);
  if (await ev(() => !document.querySelector('[data-h=ring]').classList.contains('hidden'))) await surf('12-ring');
  await page.keyboard.press('Escape');
  await closeAll();
  // strip: fill every slot + some free changes, open the free list
  await ev(fid => {
    const s = window.tc.screen, st = s.st;
    const mine = st.fleets.filter(f => f.owner === s.you && f.ships.length);
    for (const f of mine) { const n = st.regions[f.region].neighbors[0]; s.addOrder({ type: 'move', fleet: f.id, path: [n] }); }
    const cap = st.players[s.you].capital;
    s.addOrder({ type: 'scan', target: cap });
    s.addOrder({ type: 'develop', region: cap, project: 'develop' });
    s.addOrder({ type: 'fortify', fleet: fid });
    s.pushFree({ type: 'rename', fleet: fid, name: 'Renamed' });
    s.renderAll();
  }, fid);
  await ev(() => document.querySelector('[data-act=free]')?.click());
  await surf('13-strip-full');
  await ev(() => document.querySelector('[data-act=free]')?.click());
  // the onboarding callout (Seal when ready / Drag to seize)
  await ev(() => window.tc.screen.restartTeach());
  await surf('14-callout', 400);
  await ev(() => { window.tc.screen.teach.skipAll(); });
  await ev(() => { const s = window.tc.screen; s.plan.orders = s.plan.orders.map(() => null); s.plan.free = []; s.savePlan(); s.renderAll(); });

  // ================================================================ later: turn 5 (AI plays our seat)
  const me = await ev(() => window.tc.screen.you);
  await edit(`s.src.save.seats[s.you].kind = 'ai';`);
  for (let i = 0; i < 4; i++) await ev(() => { try { window.tc.screen.src.advance(); } catch { /* */ } });
  await edit(`s.src.save.seats[a].kind = 'human'; s.src.save.current = a; s.src.save.reveal = false;`, me);
  await ev(() => { const s = window.tc.screen; if (s.replay) s.endReplay(); document.querySelectorAll('.herald-ov').forEach(x => x.remove()); });
  await page.waitForTimeout(400);
  await surf('20-hud-later');
  // fleet with an honour waiting, Fate, postures, a vow choice
  const f2 = await ev(() => { const s = window.tc.screen; return s.st.fleets.filter(f => f.owner === s.you && f.ships.length).sort((a, b) => b.ships.length - a.ships.length)[0]?.id; });
  if (f2 !== undefined) {
    await edit(`const f = st.fleets.find(x => x.id === a); f.pendingHonour = { options: ['iron', 'medics'], since: st.turn }; f.commander.rank = Math.max(f.commander.rank, 3);`, f2);
    await select('fleet', f2);
    await surf('21-fleet-honour', 450);
    await ev(() => document.querySelector('.card .wc-body')?.scrollTo(0, 99999));
    await surf('21b-fleet-honour-end', 150);
    await edit(`const f = st.fleets.find(x => x.id === a); f.pendingHonour = null;`, f2);
    await select('fleet', f2);
    await ev(() => { const b = document.querySelector('.card [data-a=gambit]'); if (b && b.getAttribute('aria-expanded') !== 'true') b.click(); });
    await page.waitForTimeout(150);
    await ev(() => document.querySelector('.card [data-a=fate]')?.click());
    await surf('22-fleet-fate-armed', 300);
    await ev(() => document.querySelector('.card [data-a=gambit]')?.click());
    await ev(() => document.querySelector('.card [data-a=ftab][data-t=story]')?.click());
    await ev(() => document.querySelector('.card .wc-body')?.scrollTo(0, 99999));
    await surf('23-fleet-more-later', 200);
    await ev(() => document.querySelector('.card [data-a=ftab][data-t=orders]')?.click());
  }
  // a limping, scarred fleet
  const f3 = await ev(() => { const s = window.tc.screen; return s.st.fleets.filter(f => f.owner === s.you && f.ships.length)[1]?.id ?? null; });
  if (f3 !== null) {
    await edit(`const f = st.fleets.find(x => x.id === a); f.limping = { since: st.turn, to: st.players[f.owner].capital, by: 1 }; f.scars = [{ id: 'haunted', turn: st.turn }, { id: 'grudge', turn: st.turn, vs: 1 }];`, f3);
    await select('fleet', f3);
    await surf('24-fleet-limping', 400);
  }
  // the world card later: postures, a calling to choose
  await edit(`const r = st.regions[a]; r.story = r.story ?? { toil: 0, blood: 0, siege: 0, relic: 0, loss: 0, owners: [], epithet: null, calling: null, pendingCalling: null, tenureFrom: 1, deeds: [] }; r.story.pendingCalling = { options: ['arsenal', 'cenotaph'], since: st.turn, owner: r.owner };`, cap);
  await select('region', cap);
  await surf('25-world-calling', 450);
  await ev(() => document.querySelector('.card .wc-body')?.scrollTo(0, 99999));
  await surf('25b-world-calling-end', 150);
  // contested + tribute on our capital's neighbour
  const nb = await ev(() => { const s = window.tc.screen, st = s.st; const c = st.regions[st.players[s.you].capital]; return c.neighbors.find(n => st.regions[n].kind === 'colony') ?? c.neighbors[0]; });
  const rival = (me + 1) % 3;
  await edit(`const [A, R] = a; const r = st.regions[A]; r.owner = s.you; r.dev = 3; r.garrison = 30; r.project = null; r.buildings = { mine: 1 }; r.star = 'yellow'; r.trait = null;
    r.bodies = [{ kind: 'habitable', q: 'fair', name: 'Vel II', adj: 'ocean' }, { kind: 'gas', name: 'Tyr' }, { kind: 'belt', name: 'the Ashen Belt' }, { kind: 'moon', name: 'Ossa' }];
    r.contested = 2;
    const tmpl = st.fleets.find(f => f.owner === R && f.ships.length);
    if (tmpl) { const f = JSON.parse(JSON.stringify(tmpl)); f.id = st.nextId++; f.region = A; f.siege = A; f.route = null; f.name = 'The Black Lances'; st.fleets.push(f); }
    st.players[R].tributeOffers = [A];`, [nb, rival]);
  await select('region', nb);
  await surf('26-world-contested', 450);
  await ev(() => { const b = document.querySelector('.card [data-a=gambit]'); if (b && b.getAttribute('aria-expanded') !== 'true') b.click(); });
  await ev(() => document.querySelector('.card .wc-body')?.scrollTo(0, 99999));
  await surf('26b-world-contested-end', 150);
  // a rival world (seize odds)
  const rcap = await ev(r => window.tc.screen.st.players[r].capital, rival);
  await select('region', rcap);
  await surf('27-world-rival', 450);
  // a rival fleet
  const rf = await ev(r => window.tc.screen.st.fleets.find(f => f.owner === r && f.ships.length)?.id ?? null, rival);
  if (rf !== null) { await ev(id => window.tc.screen.select({ kind: 'fleet', id }), rf); await surf('28-fleet-rival', 350); }
  // the Charge offer
  if (f2 !== undefined) {
    await closeAll();
    await ev(async ([f, r]) => { const S = await import('/src/hud/signature.ts'); S.offerCharge(window.tc.screen, f, r); }, [f2, nb]);
    await surf('29-charge', 200);
  }
  await closeAll();
  // long names everywhere (40 chars)
  await edit(`const L = (s0) => (s0 + ' of the Unbroken Ascendant Dominion').slice(0, 40);
    for (const p of st.players) p.name = L(p.name.split(' ').slice(-1)[0]);
    for (const f of st.fleets) { f.name = L('The ' + f.name.replace(/^The /, '')); f.commander.name = L('Admiral Theodora Vasquez-Ironwood'); for (const sh of f.ships) sh.name = L(sh.name); }
    for (const r of st.regions) r.name = L(r.name);`);
  await ev(() => { const s = window.tc.screen, st = s.st; const mine = st.fleets.filter(f => f.owner === s.you && f.ships.length); for (const f of mine.slice(0, 2)) s.addOrder({ type: 'move', fleet: f.id, path: [st.regions[f.region].neighbors[0]] }); s.addOrder({ type: 'scan', target: st.players[s.you].capital }); s.renderAll(); });
  await surf('30-long-hud', 400);
  if (f2 !== undefined) { await select('fleet', f2); await surf('31-long-fleet', 400); await ev(() => document.querySelector('.card [data-a=ftab][data-t=story]')?.click()); await surf('31b-long-fleet-more', 200); await ev(() => document.querySelector('.card [data-a=ftab][data-t=orders]')?.click()); }
  await select('region', cap); await surf('32-long-world', 400);
  await select('region', nb); await surf('33-long-contested', 400);
  await select('region', rcap); await surf('34-long-rival', 400);
  await closeAll();
  // replay bar
  await ev(() => { const s = window.tc.screen; const h = s.src.save.history[s.src.save.history.length - 1]; if (h) s.startReplay(h); });
  await surf('35-replay', 700);
  await ev(() => { const s = window.tc.screen; if (s.replay) s.endReplay(); });
  await closeAll();
  // sealed / waiting
  await ev(() => { const s = window.tc.screen; s.submit?.(true); });
  await page.waitForTimeout(300);
  await ev(() => { const s = window.tc.screen; if (s.replay) s.endReplay(); });
  await surf('36-after-seal', 300);

  // ================================================================ hotseat curtain
  await startGame({ hotseat: true });
  await ev(() => window.tc.screen.handoff(1));
  await surf('40-curtain', 300);

  // ================================================================ LIVE
  await startGame({ mode: 'live-fast' });
  await page.waitForFunction(() => window.tc?.screen?.st?.live).catch(() => {});
  await surf('50-live-hud', 400);
  await ev(() => { const s = window.tc.screen; const cap = s.st.players[s.you].capital; for (let i = 0; i < 3 && s.bank > 0; i++) s.src.liveOrder?.({ type: 'scan', target: cap }); s.renderAll(); });
  await surf('51-live-queue', 400);
  const lf = await ev(() => { const s = window.tc.screen; return s.st.fleets.find(f => f.owner === s.you && f.ships.length)?.id; });
  if (lf !== undefined) { await select('fleet', lf); await surf('52-live-fleet', 400); }

  if (errors.length) { console.log(`  ${vp.tag} page errors: ${errors.slice(0, 3).join(' | ')}`); counts.error = errors.length; n += errors.length; }
  totals[vp.tag] = { n, counts };
  total += n;
  await ctx.close();
}
await browser.close();
console.log('\nsummary');
for (const [t, v] of Object.entries(totals)) console.log(`  ${t.padEnd(8)} ${String(v.n).padStart(4)}  ${Object.entries(v.counts).map(([k, c]) => `${k} ${c}`).join(', ')}`);
console.log(total ? `\n${total} issues` : '\nzero issues');
process.exit(total && !reportOnly ? 1 : 0);
