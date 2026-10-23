// Style lab (client/style-lab.html): three unified art directions for the map, on one mock board, at the three zoom
// tiers, with the HUD chrome restyled to match. Exploration only: nothing here is wired into the game.
//   ?style=A|B|C    the direction (A printed chart, B painted diorama, C enamel-and-gold orrery)
//   ?tier=strategic|operational|detail      or  ?focus=battle|crowded   (camera presets)
//   ?legend=1       the legend sheet (every indicator, with its measured contrast)
//   ?hud=0  ?tip=0  ?ui=0 (hide the style switcher)   ?phone=1 (force the touch layout)
// window.lab2: { measure(), perf(n), state }   (scripts/style-explore-shots.mjs drives it)
import './lab2.css';
import { chart } from './chart.ts';
import { diorama } from './diorama.ts';
import { orrery } from './orrery.ts';
import { drawBoard, starR, type Style } from './render.ts';
import { drawLegend, legendLayout, TIP_CELL, lastCells } from './legend.ts';
import { makeView, measure, valueRange, loadTex, cv, type View, type ProbeResult } from './kit.ts';
import { MEDIAN_R, SYSTEMS, HOVER, type House } from './board.ts';
import { ic } from '../icons.ts';

const Q = new URLSearchParams(location.search);
const STYLES: Record<string, Style> = { A: chart, B: diorama, C: orrery };
const coarse = Q.get('phone') === '1' || (Q.get('phone') !== '0' && matchMedia('(pointer: coarse)').matches);
let style: Style = STYLES[(Q.get('style') ?? 'A').toUpperCase()] ?? chart;
const legend = Q.get('legend') === '1';
type Tier = 'strategic' | 'operational' | 'detail';
let tier: Tier = (Q.get('tier') as Tier) ?? 'operational';
const focus = Q.get('focus');

/** Camera presets: the same on-screen region size per tier as the live-game captures (scripts/style-explore-current.mjs). */
function preset(): { cx: number; cy: number; Rs: number } {
  if (focus === 'battle') return { cx: 160, cy: -385, Rs: 470 };
  if (focus === 'crowded') return { cx: -430, cy: -150, Rs: 400 };
  if (coarse) return tier === 'strategic' ? { cx: 0, cy: 0, Rs: 29 } : tier === 'operational' ? { cx: -380, cy: -230, Rs: 100 } : { cx: -330, cy: -110, Rs: 210 };
  return tier === 'strategic' ? { cx: 0, cy: 0, Rs: 55 } : tier === 'operational' ? { cx: -60, cy: -40, Rs: 105 } : { cx: -170, cy: -250, Rs: 230 };
}
const root = document.getElementById('lab')!;
const canvas = document.createElement('canvas');
canvas.className = 'board';
root.appendChild(canvas);
const hud = document.createElement('div'); hud.className = 'hud'; root.appendChild(hud);
const leg = document.createElement('div'); leg.className = 'legend'; root.appendChild(leg);
if (coarse) root.classList.add('phone');

let view: View | null = null;
let lastFrameMs = 0, lastStaticMs = 0;
let results: ProbeResult[] = [];

function size() {
  const dpr = Math.min(3, devicePixelRatio || 1);
  const w = innerWidth;
  const h = legend ? legendLayout(w).height : innerHeight;
  if (legend) { document.body.classList.add('scroll'); root.style.height = `${h}px`; }
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  return { w, h, dpr };
}

// static layers (ground, territories, lanes) cached per camera; marks every frame
let cache: HTMLCanvasElement | null = null, cacheKey = '';
function render() {
  const { w, h, dpr } = size();
  root.className = `dir${style.id}${coarse ? ' phone' : ''}`;
  const g = canvas.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const t0 = performance.now();
  if (legend) {
    drawLegend(g, w, h, dpr, style);
    lastFrameMs = performance.now() - t0;
    legendDom(w);
    return;
  }
  const p = preset();
  const v = view = makeView(w, h, dpr, Number(Q.get('cx') ?? p.cx), Number(Q.get('cy') ?? p.cy), Number(Q.get('Rs') ?? p.Rs) / MEDIAN_R, MEDIAN_R, coarse, Number(Q.get('t') ?? 14));
  const key = `${style.id}|${w}|${h}|${dpr}|${v.cx}|${v.cy}|${v.z}`;
  if (key !== cacheKey) {
    const s0 = performance.now();
    cache = cv(w * dpr, h * dpr);
    const cg = cache.getContext('2d')!; cg.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBoard(cg, v, style, { ground: true, terr: true, lanes: true, marks: false });
    cacheKey = key; lastStaticMs = performance.now() - s0;
  }
  const t1 = performance.now();
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(cache!, 0, 0); g.restore();
  drawBoard(g, v, style, { marks: true });
  style.light(g, v);
  lastFrameMs = performance.now() - t1;
  hudDom(v);
}

// ------------------------------------------------------------------ HUD chrome (DOM, restyled per direction)
const HOUSE_SH: Record<House, string> = { azure: '#2f6ea6', crimson: '#a3303a', gilded: '#c79a2c', warden: '#6e58a0' };
function hudDom(v: View) {
  if (Q.get('hud') === '0') { hud.innerHTML = ''; return; }
  const tipOnly = Q.get('hud') === 'tip';
  const crest = (h: House, name: string, vp: number, you = false) => `<div class="crest${you ? ' you' : ''}"><div class="sh" style="background:${HOUSE_SH[h]}">${ic(h === 'azure' ? 'star' : h === 'crimson' ? 'wolf' : 'sun')}</div>${vp}<span>${name}</span></div>`;
  const tipOn = Q.get('tip') !== '0' && (v.W.s < 0.5) && (!coarse || tier === 'detail' || focus === 'crowded');
  let tip = '';
  if (tipOn) {
    const s = SYSTEMS[HOVER];
    const x = v.sx(s.x), y = v.sy(s.y), R = starR(s, v);
    const tw = coarse ? 210 : 238;
    // below-left of the star, where the operational view is emptiest (the pointer sits on the star)
    let tx = x - R - 24 - tw, ty = y + R + 26;
    if (tx < 8) tx = x + R + 24;
    tx = Math.max(8, Math.min(v.w - tw - 8, tx)); ty = Math.max(coarse ? 120 : 64, ty);
    tip = `<div class="tip" style="left:${tx}px;top:${ty}px"><b>CROWN OF THORNS</b><i>A Crown, held by the Azure Compact</i>
      <p>Worth <span class="k">3 VP</span> a turn to its holder.</p>
      <p>Defenders <span class="k">48</span>: the garrison you must beat to take it.</p>
      <p>Contested: the Crimson Dominion holds its space, <span class="k">2</span> turns so far.</p></div>`;
  }
  if (tipOnly) { hud.innerHTML = tip; return; }
  hud.innerHTML = `
    <div class="row turn"><div class="plate"><b>TURN 12 <small style="font-size:12px">/32</small></b><em>PLAN</em></div></div>
    <div class="row res">
      <div class="tok">${ic('industry')} 62 <small>+18</small></div>
      <div class="tok">${ic('credits')} 31 <small>+9</small></div>
      <div class="tok">${ic('influence')} 10 <small class="neg">−2</small></div>
      ${coarse ? '' : `<div class="tok">${ic('fate')}${ic('fate')}<span style="opacity:.45">${ic('fate')}</span></div>`}
    </div>
    <div class="row crests">${crest('azure', 'Azure', 6, true)}${crest('crimson', 'Crimson', 5)}${crest('gilded', 'Gilded', 9)}</div>
    <div class="row strip">
      <div class="slot full">${ic('seize')} Old Lantern</div><div class="slot full">${ic('move')} Crying Sd.</div>
      <div class="slot">III</div>${coarse ? '' : '<div class="slot">IV</div><div class="slot">V</div>'}
      <div class="prim">${ic('crown')} SEAL</div>
    </div>
    <div class="row btns"><div class="rb">${ic('empire')}</div><div class="rb">${ic('crown')}</div><div class="rb">${ic('chronicle')}</div><div class="rb keep">${ic('political')}</div><div class="rb keep">${ic('menu')}</div></div>
    ${tip}`;
}

function legendDom(w: number) {
  const cells = lastCells.length ? lastCells : legendLayout(w).cells;
  const byKind = new Map<string, number>();
  for (const r of results) byKind.set(r.kind, Math.min(byKind.get(r.kind) ?? Infinity, r.contrast));
  const tipCell = cells[TIP_CELL] ?? { x: 12 + (TIP_CELL % 6) * 238, y: 54 + Math.floor(TIP_CELL / 6) * 158, w: 230, h: 150 };
  leg.innerHTML = `<h1>${style.id}. ${style.name}<small>legend: every indicator, with its measured effective contrast (target 4.5:1)</small></h1>` +
    cells.map(c => {
      // a resting lane is quiet by design (UX-V2 §2: a faint thread); it is shown, not held to 4.5:1
      const ks = [...new Set(c.probes)].filter(k => k !== 'lane (rest)');
      const worst = ks.length ? Math.min(...ks.map(k => byKind.get(k) ?? Infinity)) : NaN;
      const em = Number.isFinite(worst) ? `<em class="${worst < 4.5 ? 'bad' : ''}">${worst.toFixed(1)}:1</em>` : '';
      return `<div class="cell" style="left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px"><div class="lab">${c.label}${em}</div></div>`;
    }).join('') +
    `<div class="hud" style="position:absolute;left:${tipCell.x}px;top:${tipCell.y}px;width:${tipCell.w * 1.6}px;height:${tipCell.h}px"><div class="tip" style="left:0;top:0;width:${Math.min(300, tipCell.w * 1.5)}px"><b>CROWN OF THORNS</b><i>A Crown, held by the Azure Compact</i><p>Defenders <span class="k">48</span>: the garrison you must beat to take it.</p></div></div>`;
}

// ------------------------------------------------------------------ measurement (readability) and cost
function measureNow() {
  const { w, h, dpr } = { w: innerWidth, h: legend ? legendLayout(innerWidth).height : innerHeight, dpr: Math.min(3, devicePixelRatio || 1) };
  const W = Math.round(w * dpr), H = Math.round(h * dpr);
  const layerImg = (fn: (g: CanvasRenderingContext2D) => void) => { const c = cv(W, H); const g = c.getContext('2d', { willReadFrequently: true })!; g.setTransform(dpr, 0, 0, dpr, 0, 0); fn(g); return g.getImageData(0, 0, W, H); };
  let probes;
  let bgs: ImageData[];
  if (legend) {
    const bg0 = layerImg(g => drawLegend(g, w, h, dpr, style, false, false));
    const bg1 = layerImg(g => drawLegend(g, w, h, dpr, style, false, true));
    bgs = [bg0, bg1, bg1];
    const c = cv(W, H); const g = c.getContext('2d', { willReadFrequently: true })!; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    probes = drawLegend(g, w, h, dpr, style).probes;
    results = measure(g.getImageData(0, 0, W, H), bgs, probes, dpr);
    legendDom(w);
  } else {
    const v = view!;
    const bgImg = (layer: { ground?: boolean; terr?: boolean; lanes?: boolean }) => layerImg(g => { drawBoard(g, v, style, layer); style.light(g, v); });
    bgs = [bgImg({ ground: true }), bgImg({ ground: true, terr: true }), bgImg({ ground: true, terr: true, lanes: true })];
    const c = cv(W, H); const g = c.getContext('2d', { willReadFrequently: true })!; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBoard(g, v, style, { ground: true, terr: true, lanes: true, marks: false });
    probes = drawBoard(g, v, style, { marks: true }).probes;
    style.light(g, v);
    results = measure(g.getImageData(0, 0, W, H), bgs, probes, dpr);
  }
  const range = valueRange(bgs[1]);
  return { style: style.id, tier: legend ? 'legend' : focus ?? tier, coarse, probes: results, range };
}
function perf(n = 30) {
  // full redraws (static + marks) and marks-only frames
  const t0 = performance.now();
  for (let i = 0; i < n; i++) { cacheKey = ''; render(); }
  const full = (performance.now() - t0) / n;
  const t1 = performance.now();
  for (let i = 0; i < n; i++) render();
  const frame = (performance.now() - t1) / n;
  // the static layers one by one (where a rebuild's time goes)
  const layers: Record<string, number> = {};
  if (view) {
    const v = view, c = cv(v.w * v.dpr, v.h * v.dpr), g = c.getContext('2d')!;
    g.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    for (const [k, l] of [['ground', { ground: true }], ['territories', { terr: true }], ['lanes', { lanes: true }], ['marks', { marks: true }], ['light', null]] as const) {
      const t = performance.now();
      for (let i = 0; i < n; i++) { if (l) drawBoard(g, v, style, l); else style.light(g, v); }
      layers[k] = +((performance.now() - t) / n).toFixed(2);
    }
  }
  return { full: +full.toFixed(2), frame: +frame.toFixed(2), staticMs: +lastStaticMs.toFixed(2), marksMs: +lastFrameMs.toFixed(2), layers };
}

// ------------------------------------------------------------------ the switcher
function switcher() {
  if (Q.get('ui') === '0') return;
  const sw = document.createElement('div'); sw.className = 'switch';
  const set = () => sw.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.s === style.id || b.dataset.t === tier)));
  for (const id of Object.keys(STYLES)) { const b = document.createElement('button'); b.textContent = id; b.dataset.s = id; b.title = STYLES[id].name; b.onclick = () => { style = STYLES[id]; set(); render(); }; sw.appendChild(b); }
  if (!legend) for (const t of ['strategic', 'operational', 'detail'] as Tier[]) { const b = document.createElement('button'); b.textContent = t[0].toUpperCase(); b.dataset.t = t; b.title = t; b.onclick = () => { tier = t; Q.delete('focus'); set(); render(); }; sw.appendChild(b); }
  root.appendChild(sw); set();
}

(async () => {
  await loadTex(['parchment.webp', 'wood-dark.webp', 'leather.webp', 'felt.webp', 'brass-grime.webp', 'metal-brushed.webp']);
  try { await Promise.all(['600 12px Cinzel', '700 12px Cinzel', 'italic 12px "IM Fell English"', '12px "IM Fell English"', '700 12px "Alegreya Sans"', '800 12px "Alegreya Sans"'].map(f => document.fonts.load(f))); await document.fonts.ready; } catch { /* offline: fallbacks */ }
  render();
  switcher();
  addEventListener('resize', () => render());
  (window as unknown as { lab2: unknown }).lab2 = { measure: measureNow, perf, ready: true, render };
})();
