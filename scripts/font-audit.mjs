// Font-size audit: opens every major surface at 2560x1440, 1440x900 and an iPhone 15 Pro (393x852 @3x) and fails
// on any visible text below the readability floor. DOM text: computed font-size times CSS zoom, in CSS px.
// Canvas text (map, battle viewer): every fillText/strokeText is recorded with its font size times the current
// transform scale, divided by the canvas's backing-store ratio, i.e. the size it lands on screen in CSS px.
// Floors scale with the UI factor (html font-size / 16): DOM 14px x ui on desktop, 13px on phones; canvas 12px x ui.
// Also checks the phone never scrolls sideways. Screenshots: /tmp/claude-0/font-audit/<vp>-<surface>.png
// node scripts/font-audit.mjs [outdir] [baseUrl] [--only=desk|wide|phone] [--report]   (--report: never exit 1)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
const args = process.argv.slice(2);
const pos = args.filter(a => !a.startsWith('--'));
const out = pos[0] ?? '/tmp/claude-0/font-audit';
const base = pos[1] ?? 'http://localhost:5173/';
const only = args.find(a => a.startsWith('--only='))?.slice(7);
const reportOnly = args.includes('--report');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

const VPS = [
  { tag: 'wide', viewport: { width: 2560, height: 1440 }, ui: [1.4, 1.5] },
  { tag: 'desk', viewport: { width: 1440, height: 900 }, ui: [1, 1] },
  { tag: 'phone', viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, phone: true, ui: [1, 1],
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
].filter(v => !only || only.split(',').includes(v.tag));

let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };
const summary = [];

// ------------------------------------------------------------------ in-page instrumentation
const INIT = () => {
  try { localStorage.setItem('tc.tutorial.wego', 'done'); localStorage.setItem('tc.tutorial.live', 'done'); localStorage.setItem('tc.herald.auto', 'off'); } catch { /* */ }
  window.__ct = new Map();
  const rec = function (orig) {
    return function (text, x, y, ...rest) {
      try {
        const s = String(text);
        if (s.trim() && this.globalAlpha > 0.2) {
          const m = /(\d+(?:\.\d+)?)px/.exec(this.font);
          const c = this.canvas;
          let dpr = 0;
          if (c && c.isConnected && c.clientWidth > 0) dpr = c.width / c.clientWidth;
          else if (c && window.__mapCanvas && c.width === window.__mapCanvas.width && c.height === window.__mapCanvas.height && window.__mapCanvas.clientWidth > 0) dpr = c.width / window.__mapCanvas.clientWidth;
          if (m && dpr > 0) {
            const t = this.getTransform();
            const px = parseFloat(m[1]) * Math.hypot(t.a, t.b) / dpr;
            const key = s.slice(0, 24);
            const prev = window.__ct.get(key);
            if (!prev || px < prev.px) window.__ct.set(key, { px, font: this.font, where: c.isConnected ? (c.closest('.bv-overlay') ? 'battle' : 'map') : 'layer' });
          }
        }
      } catch { /* */ }
      return orig.call(this, text, x, y, ...rest);
    };
  };
  const P = CanvasRenderingContext2D.prototype;
  P.fillText = rec(P.fillText);
  P.strokeText = rec(P.strokeText);
};

/** Every visible text node's rendered font size; the smallest offenders below `floor`. */
const AUDIT = ({ floor, cfloor }) => {
  const res = { min: Infinity, minText: '', bad: [], n: 0, cmin: Infinity, cminText: '', cbad: [] };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const txt = n.textContent.replace(/\s+/g, ' ').trim();
    if (!txt) continue;
    const el = n.parentElement;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    if (el.closest('script,style,noscript,option,datalist,[hidden]')) continue;
    if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    const r = document.createRange(); r.selectNodeContents(n);
    const rr = r.getBoundingClientRect();
    if (rr.width < 1 || rr.height < 1) continue;
    const cs = getComputedStyle(el);
    if (parseFloat(cs.opacity) < 0.05) continue;
    const z = el.currentCSSZoom ?? 1;
    const px = parseFloat(cs.fontSize) * z;
    res.n++;
    const path = [el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''),
      el.parentElement ? el.parentElement.tagName.toLowerCase() + (typeof el.parentElement.className === 'string' && el.parentElement.className ? '.' + el.parentElement.className.trim().split(/\s+/)[0] : '') : ''].reverse().join(' > ');
    if (px < res.min) { res.min = px; res.minText = `${txt.slice(0, 30)} [${path}]`; }
    if (px < floor - 0.01) res.bad.push(`${px.toFixed(2)}px "${txt.slice(0, 30)}" [${path}]`);
  }
  for (const [k, v] of window.__ct) {
    if (v.px < res.cmin) { res.cmin = v.px; res.cminText = `${k} (${v.where}, ${v.font})`; }
    if (v.px < cfloor - 0.01) res.cbad.push(`${v.px.toFixed(2)}px "${k}" (${v.where}, ${v.font})`);
  }
  return res;
};

for (const vp of VPS) {
  const ctx = await browser.newContext(vp);
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  await page.routeWebSocket(/\?token=/, () => {});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const ev = (fn, a) => page.evaluate(fn, a);
  const vmin = { dom: Infinity, domText: '', canvas: Infinity, canvasText: '' };
  let ui = 1;
  const surf = async (name, { canvas = false } = {}) => {
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${out}/${vp.tag}-${name}.png` });
    const floor = vp.phone ? 13 : 14 * ui, cfloor = 12 * ui;
    const r = await ev(AUDIT, { floor, cfloor });
    if (r.min < vmin.dom) { vmin.dom = r.min; vmin.domText = `${name}: ${r.minText}`; }
    const bad = [...new Set(r.bad)];
    check(bad.length === 0, `${vp.tag} ${name}: ${r.n} text nodes, smallest ${r.min.toFixed(1)}px (floor ${floor.toFixed(1)})${bad.length ? '\n      ' + bad.slice(0, 12).join('\n      ') + (bad.length > 12 ? `\n      … +${bad.length - 12} more` : '') : ''}`);
    if (canvas) {
      if (r.cmin < vmin.canvas) { vmin.canvas = r.cmin; vmin.canvasText = `${name}: ${r.cminText}`; }
      check(r.cbad.length === 0, `${vp.tag} ${name} canvas: smallest ${r.cmin === Infinity ? '-' : r.cmin.toFixed(1)}px (floor ${cfloor.toFixed(1)})${r.cbad.length ? '\n      ' + r.cbad.slice(0, 12).join('\n      ') : ''}`);
    }
    if (vp.phone) {
      const sw = await ev(() => [document.documentElement.scrollWidth, document.body.scrollWidth, innerWidth]);
      check(sw[0] <= sw[2] && sw[1] <= sw[2], `${vp.tag} ${name}: no horizontal overflow (${sw.join('/')})`);
    }
  };
  const resetCanvas = () => ev(() => { window.__ct = new Map(); });
  const redrawMap = async () => { await ev(() => { window.__ct = new Map(); window.tc.screen.map.invalidate?.(); window.tc.screen.renderAll?.(); }); await page.waitForTimeout(500); };
  const tap = async sel => { await page.waitForSelector(sel, { timeout: 5000 }); if (vp.phone) await page.tap(sel); else await page.click(sel); };
  const closeAll = () => ev(async () => {
    const M = await import('/src/ui/modals.ts'); if (M.isModalOpen()) M.closeModal();
    document.querySelectorAll('.herald-ov, .saga-ov, .bv-overlay, .overlay').forEach(x => x.remove());
    const s = window.tc.screen; s.hud.closePopovers?.(); s.deselect?.(); s.hideTip?.();
  });

  // ---------------------------------------------------------------- lobby / menu
  await page.goto(base);
  await page.waitForSelector('[data-l=start]');
  await ev(() => document.fonts.ready);
  ui = await ev(() => parseFloat(getComputedStyle(document.documentElement).fontSize) / 16);
  check(ui >= vp.ui[0] - 0.01 && ui <= vp.ui[1] + 0.01, `${vp.tag}: UI scale ${ui.toFixed(3)} in [${vp.ui.join(', ')}]`);
  await surf('01-lobby');
  await page.evaluate(() => document.querySelector('.lobby')?.scrollTo(0, 99999));
  await surf('02-lobby-end');
  await page.evaluate(() => document.querySelector('.lobby')?.scrollTo(0, 0));

  // ---------------------------------------------------------------- start a local game
  await page.fill('[data-l=seed]', '4242');
  page.once('dialog', d => d.accept());
  await page.click('[data-l=start]');
  await page.waitForFunction(() => window.tc?.screen?.st);
  await ev(() => { window.__mapCanvas = window.tc.screen.el.canvas; });
  await page.waitForTimeout(1200);
  await redrawMap();
  await surf('03-hud', { canvas: true });

  // map at every zoom tier (fit, zoomed out, operational, detail)
  const z0 = await ev(() => window.tc.screen.map.cam.z);
  for (const [k, f] of [['out', 0.55], ['fit', 1], ['in', 1.9], ['close', 3.6]]) {
    await ev(z => { const m = window.tc.screen.map; m.camAnim = null; m.cam = { ...m.cam, z }; }, z0 * f);
    await redrawMap();
    const tier = await ev(() => window.tc.screen.map.tier);
    await surf(`04-map-${k}-${tier}`, { canvas: true });
  }
  await ev(z => { const m = window.tc.screen.map; m.cam = { ...m.cam, z }; }, z0);
  await resetCanvas();

  // ---------------------------------------------------------------- resource / fate / menu / lens popovers
  const keys = await ev(() => [...document.querySelectorAll('.hud-tc [data-k]')].map(e => e.dataset.k));
  for (const k of keys.slice(0, 4)) {
    await ev(k => window.tc.screen.hud.showPop('res:' + k, null), k);
    await surf(`05-pop-${k}`);
  }
  for (const k of ['menu', 'lens']) {
    await ev(k => window.tc.screen.hud.showPop(k, null), k);
    await surf(`06-pop-${k}`);
  }
  await ev(() => window.tc.screen.hud.closePopovers());

  // ---------------------------------------------------------------- tooltip
  const tipSel = await ev(() => { const e = [...document.querySelectorAll('.shell [data-tip]')].find(e => e.getBoundingClientRect().width > 0); if (!e) return null; e.setAttribute('data-audit-tip', '1'); return '[data-audit-tip]'; });
  if (tipSel) {
    if (vp.phone) {
      await ev(() => { const e = document.querySelector('[data-audit-tip]'); const r = e.getBoundingClientRect(); e.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: r.left + 4, clientY: r.top + 4 })); });
      await page.waitForTimeout(600);
      await ev(() => document.querySelector('[data-audit-tip]').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' })));
    } else await page.hover(tipSel);
    await surf('07-tooltip');
    check(await ev(() => !!document.querySelector('.uxtip:not(.hidden)')), `${vp.tag}: tooltip shown`);
    await page.mouse.move(2, vp.viewport.height / 2);
  }

  // ---------------------------------------------------------------- toast
  await ev(async () => (await import('/src/ui/dom.ts')).toast('⚠ Short: 4 credits, 2 alloys'));
  await page.waitForTimeout(150);
  await surf('08-toast');

  // ---------------------------------------------------------------- fleet card, world card + build tray, founding sheet
  const fid = await ev(() => { const s = window.tc.screen; const f = s.st.fleets.filter(f => f.owner === s.you && f.ships.length).sort((a, b) => b.ships.length - a.ships.length)[0]; s.select({ kind: 'fleet', id: f.id }); return f.id; });
  await page.waitForTimeout(400);
  await surf('09-fleet-card');
  if (await page.$('.card [data-a=more]')) { await tap('.card [data-a=more]'); await surf('10-fleet-more'); }
  const cap = await ev(() => { const s = window.tc.screen; const c = s.st.players[s.you].capital; s.select({ kind: 'region', id: c }); s.focus(s.st.regions[c].site); return c; });
  await page.waitForTimeout(600);
  await surf('11-world-card');
  await ev(() => { const t = document.querySelector('.card [data-tray=build]'); t?.scrollIntoView({ block: 'center' }); });
  await surf('12-build-tray');
  if (await page.$('[data-a=into][data-id=new]')) {
    await tap('[data-a=into][data-id=new]');
    await page.waitForTimeout(200);
    if (await page.$('[data-a=build][data-cls=frigate]')) {
      await tap('[data-a=build][data-cls=frigate]');
      await page.waitForSelector('[data-found]', { timeout: 5000 }).catch(() => {});
      await surf('13-founding');
      await ev(() => document.querySelector('[data-found]')?.closest('.scroll, .found, .overlay, .card')?.scrollTo?.(0, 99999));
      await surf('13b-founding-end');
      await ev(() => { const q = document.querySelector('[data-f=quick]'); q?.click(); });
      await page.waitForTimeout(300);
    }
  }
  // context ring (right-click a world)
  if (!vp.phone) {
    const xy = await ev(c => { const s = window.tc.screen; s.deselect(); const p = s.map.toScreen(s.st.regions[c].site); const r = s.el.canvas.getBoundingClientRect(); return [p.x + r.left, p.y + r.top]; }, cap);
    await page.mouse.click(xy[0], xy[1], { button: 'right' });
    await page.waitForTimeout(300);
    if (await ev(() => !document.querySelector('[data-h=ring]').classList.contains('hidden'))) await surf('14-ring');
    await page.keyboard.press('Escape');
  }
  await closeAll();
  // plan strip with orders in it
  await ev(fid => { const s = window.tc.screen; const f = s.fleet(fid); const n = s.st.regions[f.region].neighbors[0]; s.addOrder({ type: 'move', fleet: fid, path: [n] }); s.renderAll(); }, fid);
  await surf('15-strip');

  // ---------------------------------------------------------------- modals: every tab
  for (const [m, tabs] of [['empire', ['research', 'laws', 'ships']], ['score', ['']], ['chronicle', ['']], ['help', ['win', 'orders', 'combat', 'soul', 'bets', 'empire', 'live']]]) {
    for (const t of tabs) {
      await ev(([m, t]) => window.tc.screen.openModal(m, t || undefined), [m, t]);
      await page.waitForTimeout(250);
      await surf(`16-${m}${t ? '-' + t : ''}`);
    }
    await closeAll();
  }

  // ---------------------------------------------------------------- play some turns (AI on our seat): Herald, battles
  const me = await ev(() => window.tc.screen.you);
  await ev(() => { const s = window.tc.screen; s.src.save.seats[s.you].kind = 'ai'; s.plan.orders = s.plan.orders.map(() => null); s.savePlan(); });
  for (let i = 0; i < 10; i++) await ev(() => { try { window.tc.screen.src.advance(); } catch { /* */ } });
  await ev(a => { const s = window.tc.screen; s.src.save.seats[a].kind = 'human'; s.src.save.current = a; s.src.save.reveal = false; s.src.refresh(); s.onSourceChange('view'); if (s.replay) s.endReplay(); }, me);
  await page.waitForTimeout(400);
  await redrawMap();
  await surf('17-hud-later', { canvas: true });
  await ev(() => { const s = window.tc.screen; s.heraldCheck?.(); if (!document.querySelector('.herald-ov')) s.openHerald(); });
  await page.waitForSelector('.herald-ov.show', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(700);
  await surf('18-herald');
  await closeAll();
  await ev(() => window.tc.screen.openModal('chronicle'));
  await surf('19-chronicle-later');
  await ev(() => window.tc.screen.openModal('score'));
  await surf('19b-score-later');
  await closeAll();
  // the replay of the last turn (HUD in replay mode)
  await ev(() => { const s = window.tc.screen; if (s.st.last) s.startReplay(s.st.last); });
  await page.waitForTimeout(1500);
  await resetCanvas(); await page.waitForTimeout(400);
  await surf('20-replay', { canvas: true });
  await ev(() => { const s = window.tc.screen; if (s.replay) s.endReplay(); });
  // a battle in the viewer
  const bid = await ev(() => { const s = window.tc.screen; const h = s.src.save.history.slice().reverse().find(r => r.battles.length); return h ? [h.turn, h.battles[0].id] : null; });
  if (bid) {
    await ev(([turn, id]) => { const s = window.tc.screen; const r = s.src.save.history.find(h => h.turn === turn); s.startReplay(r); s.openBattle(id); }, bid);
    await resetCanvas();
    await page.waitForTimeout(600);
    await surf('21-battle-intro', { canvas: true });
    await resetCanvas();
    await page.waitForTimeout(2600);
    await surf('22-battle', { canvas: true });
    // jump to the end card
    await ev(() => { const b = [...document.querySelectorAll('.bv-overlay .bv-btn')].find(b => b.title === 'Skip to the result'); b?.click(); });
    await page.waitForTimeout(1500);
    await resetCanvas(); await page.waitForTimeout(300);
    await surf('23-battle-end', { canvas: true });
    await page.keyboard.press('Escape');
    await ev(() => { const s = window.tc.screen; if (s.replay) s.endReplay(); });
  } else check(false, `${vp.tag}: no battle found for the viewer`);
  await closeAll();

  // ---------------------------------------------------------------- the end: victory and the Saga
  await ev(() => { const s = window.tc.screen; s.src.save.seats[s.you].kind = 'ai'; s.src.save.reveal = true; });
  for (let i = 0; i < 70; i++) { const done = await ev(() => { const s = window.tc.screen; if (s.st.winner !== null) return true; try { s.src.advance(); } catch { return true; } return false; }); if (done) break; }
  await ev(() => { const s = window.tc.screen; if (s.replay) s.endReplay(); document.querySelectorAll('.herald-ov').forEach(x => x.remove()); });
  await page.waitForTimeout(800);
  if (await page.$('[data-victory]')) await surf('24-victory');
  if (await page.$('[data-saga]')) {
    await tap('[data-saga]');
    await page.waitForSelector('.saga-ov.show', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(600);
    await surf('25-saga');
    await ev(() => document.querySelector('.saga-ov')?.scrollTo(0, 99999));
    await surf('26-saga-end');
  }

  check(errors.length === 0, `${vp.tag}: no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  summary.push(`${vp.tag.padEnd(5)} ui ${ui.toFixed(2)}  smallest DOM ${vmin.dom.toFixed(1)}px (${vmin.domText})\n${' '.repeat(15)}smallest canvas ${vmin.canvas.toFixed(1)}px (${vmin.canvasText})`);
  await ctx.close();
}
await browser.close();
console.log('\n' + summary.join('\n'));
console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails && !reportOnly ? 1 : 0);
