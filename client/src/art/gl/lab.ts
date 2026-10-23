// Art Lab (client/art-lab.html): the GL stage (art/gl/stage.ts) over a mock board painted with the game's own 2D
// painters, plus the component kit (art/kit.css). Standalone: no game state, no network.
//   ?gl=0     force the 2D fallback        ?kit=1   open the kit specimen tray
//   ?panel=0  hide the controls            ?q=high|medium|low   fixed quality      ?t=12  freeze time at 12s
//   ?terr=neon  the current game's territory style, for comparison
import '../kit.css';
import { ArtStage, type CoronaStar, type Quality, type StageToggles } from './stage.ts';
import { drawStarNode, type StarKind } from '../stars.ts';
import { drawShip } from '../ships.ts';
import { drawBase } from '../minis.ts';
import { matBackdrop, starfield, nebulaPrint, lampOverlay } from '../mat.ts';
import { ic } from '../icons.ts';
import { FACTION, CORONA, TEXT } from '../bible.ts';

const Q = new URLSearchParams(location.search);
const TAU = Math.PI * 2;

// ------------------------------------------------------------------ the mock board
type House = 'azure' | 'crimson' | 'gilded';
interface Sys { id: number; x: number; y: number; name: string; kind: StarKind; owner: House | null }
const HOUSES: House[] = ['azure', 'crimson', 'gilded'];
// the retired neons, only for the ?terr=neon before/after comparison
const NEON: Record<House, string> = { azure: '#3fd0ff', crimson: '#ff4f7b', gilded: '#ffd23f' };
const SEAT: Record<House, number> = { azure: 0, crimson: 1, gilded: 2 };
const NAMES = ['Ninefold', 'Dark Ridge', 'Crying Sound', 'Ashfall', 'Widow Rift', 'Kappa Drift', 'Gamma Expanse', 'Sable Narrows', 'Crown of Thorns',
  'Crown of Ash', 'Mire of Aun', 'Old Lantern', 'Carina Gate', 'Vesper Fold', 'Marrow Field', 'Saltglass', 'Crown of Glass', 'Lepus Rift', 'Copper Tide',
  'Ember Wake', 'Draco Sector', 'Cowboy Leg', 'Wake District', 'Cygnus Gulf', 'Ilmar', 'Reliquary', 'Hollow Bell'];

function rng(seed: number) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function buildBoard() {
  const r = rng(4242);
  const sys: Sys[] = [];
  const cols = 7, rows = 4, W = 2600, H = 1640;
  const kinds: StarKind[] = ['yellow', 'yellow', 'red', 'red', 'blue', 'white', 'binary', 'pulsar', 'blackhole', 'yellow', 'white'];
  let n = 0;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    if ((i === 3 && j === 1) || (i === 3 && j === 2)) continue;
    const x = -W / 2 + (i + 0.5) * (W / cols) + (r() - 0.5) * 220 + (j % 2 ? 90 : -90);
    const y = -H / 2 + (j + 0.5) * (H / rows) + (r() - 0.5) * 200;
    sys.push({ id: n, x, y, name: NAMES[n % NAMES.length], kind: kinds[Math.floor(r() * kinds.length)], owner: null }); n++;
  }
  sys.push({ id: n, x: 0, y: 0, name: 'The Hollow Throne', kind: 'throne', owner: null });
  const caps: Record<House, [number, number]> = { azure: [-900, -560], crimson: [1000, -380], gilded: [-700, 640] };
  for (const h of HOUSES) {
    const [cx, cy] = caps[h];
    sys.filter(s => s.kind !== 'throne').map(s => ({ s, d: Math.hypot(s.x - cx, s.y - cy) })).sort((a, b) => a.d - b.d).slice(0, h === 'gilded' ? 4 : 5).forEach(({ s }) => { if (!s.owner) s.owner = h; });
  }
  const lanes: [Sys, Sys][] = [];
  const key = new Set<string>();
  for (const a of sys) {
    sys.filter(b => b !== a).map(b => ({ b, d: Math.hypot(b.x - a.x, b.y - a.y) })).sort((p, q) => p.d - q.d).slice(0, 3).forEach(({ b, d }) => {
      const k = a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`;
      if (d < 760 && !key.has(k)) { key.add(k); lanes.push([a, b]); }
    });
  }
  const fleets = [
    { house: 'azure' as House, x: -700, y: -430, cls: ['cruiser', 'frigate', 'frigate'], ang: 2.2 },
    { house: 'crimson' as House, x: 760, y: -180, cls: ['dread', 'corvette', 'corvette', 'frigate'], ang: 4.1 },
    { house: 'gilded' as House, x: -470, y: 430, cls: ['bombard', 'frigate'], ang: 0.7 },
    { house: 'crimson' as House, x: 260, y: 160, cls: ['scout'], ang: 3.7 },
  ];
  return { sys, lanes, fleets, bounds: { minX: -W / 2 - 200, minY: -H / 2 - 200, maxX: W / 2 + 200, maxY: H / 2 + 200 } };
}
const B = buildBoard();

// territories baked once in world space (S px per world unit), per style
const S = 0.5;
const terrCache = new Map<string, HTMLCanvasElement>();
function hatchTile(col: string): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = c.height = 10;
  const g = c.getContext('2d')!;
  g.strokeStyle = col; g.lineWidth = 1;
  g.beginPath(); g.moveTo(-2, 12); g.lineTo(12, -2); g.stroke();
  return c;
}
/** Influence masks: every pixel goes to the house with the strongest field above a threshold, with a thin gap
 *  where two houses meet (so borders read as two inlays side by side, not an overlap). */
function influenceMasks(W: number, H: number): HTMLCanvasElement[] {
  const { minX, minY } = B.bounds;
  const own = HOUSES.map(h => B.sys.filter(s => s.owner === h).map(s => [(s.x - minX) * S, (s.y - minY) * S]));
  const sig2 = (230 * S) ** 2, cut = sig2 * 9;
  const data = HOUSES.map(() => new ImageData(W, H));
  const f = [0, 0, 0];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let best = -1, b1 = 0, b2 = 0;
    for (let h = 0; h < 3; h++) {
      let v = 0;
      for (const [sx, sy] of own[h]) { const d2 = (x - sx) ** 2 + (y - sy) ** 2; if (d2 < cut) v += Math.exp(-d2 / sig2); }
      f[h] = v;
      if (v > b1) { b2 = b1; b1 = v; best = h; } else if (v > b2) b2 = v;
    }
    if (best < 0) continue;
    const edge = Math.min(1, Math.max(0, (b1 - 0.42) / 0.035)) * Math.min(1, Math.max(0, (b1 - b2 - 0.015) / 0.03));
    if (edge <= 0) continue;
    const i = (y * W + x) * 4, d = data[best].data;
    d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = edge * 255;
  }
  return data.map(img => { const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d')!.putImageData(img, 0, 0); return c; });
}
let masks: HTMLCanvasElement[] | null = null;
function tinted(m: HTMLCanvasElement, col: string, dilate = 0, dx = 0, dy = 0): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = m.width; c.height = m.height;
  const t = c.getContext('2d')!;
  if (dilate > 0) for (let k = 0; k < 16; k++) { const a = (k / 16) * TAU; t.drawImage(m, Math.cos(a) * dilate + dx, Math.sin(a) * dilate + dy); }
  else t.drawImage(m, dx, dy);
  t.globalCompositeOperation = 'source-in'; t.fillStyle = col; t.fillRect(0, 0, c.width, c.height);
  return c;
}
function territories(style: 'enamel' | 'neon'): HTMLCanvasElement {
  const hit = terrCache.get(style);
  if (hit) return hit;
  const { minX, minY, maxX, maxY } = B.bounds;
  const W = Math.ceil((maxX - minX) * S), H = Math.ceil((maxY - minY) * S);
  masks ??= influenceMasks(W, H);
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const o = out.getContext('2d')!;
  HOUSES.forEach((h, hi) => {
    const M = masks![hi];
    if (style === 'neon') {
      // the current game: flat translucent fill + a bright neon stroke
      const ring = tinted(M, NEON[h], 3.5);
      const rc = ring.getContext('2d')!; rc.globalCompositeOperation = 'destination-out'; rc.drawImage(M, 0, 0);
      o.globalAlpha = 0.33; o.drawImage(tinted(M, NEON[h]), 0, 0); o.globalAlpha = 1;
      o.drawImage(ring, 0, 0);
      return;
    }
    const F = FACTION[h];
    // 1) the enamel wash with engraved hatching
    const wash = tinted(M, F.base);
    const wc = wash.getContext('2d')!;
    wc.globalCompositeOperation = 'source-atop'; wc.globalAlpha = 0.5;
    wc.fillStyle = wc.createPattern(hatchTile(F.hi), 'repeat')!; wc.fillRect(0, 0, W, H);
    o.globalAlpha = 0.17; o.drawImage(wash, 0, 0); o.globalAlpha = 1;
    // 2) the inlay bevel: lit inner edge toward the lamp (upper left), shaded edge away from it
    const lit = tinted(M, F.hi); const lc = lit.getContext('2d')!; lc.globalCompositeOperation = 'destination-out'; lc.drawImage(M, 3, 4);
    const dark = tinted(M, '#000'); const dc = dark.getContext('2d')!; dc.globalCompositeOperation = 'destination-out'; dc.drawImage(M, -3, -4);
    o.globalAlpha = 0.35; o.drawImage(lit, 0, 0); o.globalAlpha = 0.45; o.drawImage(dark, 0, 0); o.globalAlpha = 1;
    // 3) the cloisonne wire: ink outside, a thin enamel-lit line, cut to outside the mask
    const ring = tinted(M, 'rgba(6,5,4,0.92)', 5);
    const rc = ring.getContext('2d')!;
    rc.drawImage(tinted(M, F.hi, 2), 0, 0);
    rc.globalCompositeOperation = 'destination-out'; rc.drawImage(M, 0, 0);
    o.save(); o.shadowColor = 'rgba(0,0,0,0.75)'; o.shadowBlur = 5; o.shadowOffsetX = 2; o.shadowOffsetY = 3;
    o.drawImage(ring, 0, 0); o.restore();
  });
  terrCache.set(style, out);
  return out;
}

const CORONA_AMP: Record<StarKind, number> = { throne: 1, blue: 0.8, white: 0.7, yellow: 0.62, binary: 0.7, red: 0.5, pulsar: 0.72, blackhole: 0.32 };

// ------------------------------------------------------------------ page
const root = document.getElementById('lab')!;
const style = document.createElement('style');
style.textContent = `
html, body { margin: 0; height: 100%; background: #07080c; color: ${TEXT.ivory}; overflow: hidden; font-family: var(--k-ui); }
#lab { position: fixed; inset: 0; }
.board { position: absolute; inset: 0; overflow: hidden; touch-action: none; background: #07080c; }
.board > canvas.map { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.vig2d { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(120% 95% at 45% 38%, transparent 45%, rgba(6,4,2,0.55) 85%, rgba(4,3,2,0.85) 100%); }
.lab-title { position: absolute; left: 16px; top: 16px; padding: 0.7rem 1rem 0.75rem; z-index: 5; }
.lab-title .k-display { font-size: 1.15rem; display: block; }
.lab-title .k-engraved { display: block; margin-top: 0.3rem; }
.lab-res { position: absolute; top: 18px; left: 50%; transform: translateX(-50%); display: flex; gap: 6px; z-index: 5; }
.lab-seal { position: absolute; right: calc(18.5rem + 40px); bottom: 22px; z-index: 5; display: flex; align-items: center; gap: 12px; }
.nopanel .lab-seal { right: 24px; }
.panel { position: absolute; right: 16px; top: 16px; width: 18.5rem; max-height: calc(100% - 32px); overflow: auto; z-index: 6; box-sizing: border-box; }
.panel h2 { margin: 0 0 0.25rem; font-size: 1rem; }
.panel .row { display: flex; flex-direction: column; gap: 0; }
.panel .k-seg { margin: 0.4rem 0 0.2rem; }
.panel .lbl { margin-top: 0.8rem; }
.panel .fps { margin-top: 0.8rem; display: flex; gap: 6px; flex-wrap: wrap; }
.panel .note { font-size: 0.95rem; margin: 0.6rem 0 0; }
.handle { display: none; }
.kit { position: absolute; inset: 0; z-index: 8; overflow: auto; padding: 24px 16px 40px; box-sizing: border-box; background: rgba(4,3,2,0.55); }
.kit .k-sheet { max-width: 60rem; margin: 0 auto; }
.kit .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: 1rem; margin-top: 1rem; }
.kit .line { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: center; margin: 0.5rem 0; }
.kit .spec { font-size: 0.95rem; }
.kit .num-cmp { display: grid; grid-template-columns: auto 1fr; gap: 0.3rem 1rem; align-items: baseline; font-size: 1.25rem; }
.kit .num-cmp span:nth-child(odd) { font-size: 0.8rem; }
@media (max-width: 720px) {
  .panel { left: 0; right: 0; top: auto; bottom: 0; width: auto; max-height: 62%; border-radius: 7px 7px 0 0; transform: translateY(calc(100% - 3.1rem)); transition: transform var(--k-t-sheet) var(--k-ease-heavy); }
  .panel.open { transform: none; }
  .handle { display: flex; justify-content: center; align-items: center; height: 2.2rem; margin: -0.6rem -0.6rem 0.4rem; cursor: pointer; }
  .handle::before { content: ''; width: 2.8rem; height: 0.3rem; border-radius: 2px; background: linear-gradient(180deg, #f4dc9c, #6b4a1c); box-shadow: 0 1px 0 #000; }
  .lab-title { left: 12px; top: 12px; padding: 0.55rem 0.8rem; }
  .lab-title .k-display { font-size: 0.95rem; }
  .lab-res { top: auto; bottom: calc(3.1rem + 14px); left: 12px; transform: none; }
  .lab-seal { right: 14px; bottom: calc(3.1rem + 12px); }
  .nopanel .lab-seal { bottom: 16px; }
  .lab-seal .k-btn { display: none; }
}`;
document.head.appendChild(style);

const board = document.createElement('div'); board.className = 'board';
const mapCanvas = document.createElement('canvas'); mapCanvas.className = 'map';
board.appendChild(mapCanvas);
root.appendChild(board);
const g = mapCanvas.getContext('2d')!;

const qParam = Q.get('q') as Quality | null;
const stage = ArtStage.create({ seed: 4242, quality: qParam ?? undefined, fixedQuality: !!qParam, onChange: () => syncPanel() });
if (stage) stage.mount(mapCanvas);
const vig = document.createElement('div'); vig.className = 'vig2d';
if (!stage) board.appendChild(vig);

// chrome samples from the kit
root.insertAdjacentHTML('beforeend', `
<div class="lab-title k-card riveted"><span class="k-display">Three Crowns</span><span class="k-engraved">Art Lab · ${stage ? 'WebGL2' : '2D fallback'}</span></div>
<div class="lab-res">
  <span class="k-token"><span class="boss">${ic('industry')}</span><span class="k-num">60</span><span class="delta k-num">+18</span></span>
  <span class="k-token"><span class="boss">${ic('credits')}</span><span class="k-num">40</span><span class="delta k-num">+5</span></span>
  <span class="k-token fate"><span class="boss">${ic('fate')}</span><span class="k-num">3</span></span>
</div>
<div class="lab-seal"><button class="k-btn">${ic('chronicle')}Chronicle</button><button class="k-seal" title="Seal the turn" data-seal>${ic('crown')}</button></div>
<aside class="panel k-sheet" data-panel>
  <div class="handle" data-handle></div>
  <h2 class="k-display">The Lamp Table</h2>
  <div class="k-prose note">Shaders over the painted board. Drag to pan, wheel or pinch to zoom.</div>
  <hr class="k-rule">
  <div class="row" data-toggles></div>
  <div class="k-engraved lbl">Territory</div>
  <div class="k-seg" data-seg="terr"><button data-v="enamel">Enamel</button><button data-v="neon">Current neon</button></div>
  <div class="k-engraved lbl">Quality</div>
  <div class="k-seg" data-seg="q"><button data-v="high">High</button><button data-v="medium">Medium</button><button data-v="low">Low</button></div>
  <div class="fps"><span class="k-token"><span class="boss">${ic('time')}</span><span class="k-num" data-fps>–</span></span><span class="k-token" data-gl><span class="boss">${ic('star')}</span><span data-glt>${stage ? 'WebGL2' : '2D'}</span></span></div>
  <hr class="k-rule">
  <button class="k-btn" data-kit style="width:100%">${ic('help')}Component kit</button>
</aside>`);

const toggleDefs: [keyof StageToggles | 'drift' | 'labels', string][] = [
  ['nebula', 'Living nebula'], ['stars', 'Parallax stars'], ['felt', 'Felt of the mat'], ['corona', 'Star coronas'], ['lamp', 'Lamp, beam and motes'],
  ['bloom', 'Bloom'], ['shade', 'Vignette and grain'], ['drift', 'Drift the camera'], ['labels', 'Labels and fleets'],
];
const local = { drift: Q.get('drift') !== '0', labels: Q.get('board') !== '0', terr: (Q.get('terr') === 'neon' ? 'neon' : 'enamel') as 'enamel' | 'neon' };
const tg = root.querySelector('[data-toggles]')!;
for (const [k, label] of toggleDefs) {
  const on = k === 'drift' || k === 'labels' ? local[k] : stage ? stage.toggles[k] : false;
  tg.insertAdjacentHTML('beforeend', `<label class="k-toggle"><input type="checkbox" data-t="${k}" ${on ? 'checked' : ''} ${!stage && k !== 'drift' && k !== 'labels' ? 'disabled' : ''}><span class="lever"></span>${label}</label>`);
}
tg.addEventListener('change', e => {
  const i = e.target as HTMLInputElement;
  const k = i.dataset.t as keyof StageToggles | 'drift' | 'labels';
  if (k === 'drift' || k === 'labels') local[k] = i.checked;
  else if (stage) stage.toggles[k] = i.checked;
});
function syncPanel() {
  root.querySelectorAll<HTMLButtonElement>('[data-seg=q] button').forEach(b => b.setAttribute('aria-pressed', String(!!stage && b.dataset.v === stage.quality)));
  root.querySelectorAll<HTMLButtonElement>('[data-seg=terr] button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === local.terr)));
  const t = root.querySelector('[data-glt]');
  if (t) t.textContent = !stage ? '2D fallback' : stage.lost ? 'context lost' : `WebGL2 · ${stage.quality}`;
}
root.querySelector('[data-seg=q]')!.addEventListener('click', e => { const v = (e.target as HTMLElement).closest('button')?.dataset.v as Quality | undefined; if (v && stage) { stage.setQuality(v); syncPanel(); } });
root.querySelector('[data-seg=terr]')!.addEventListener('click', e => { const v = (e.target as HTMLElement).closest('button')?.dataset.v; if (v === 'enamel' || v === 'neon') { local.terr = v; syncPanel(); } });
root.querySelector('[data-handle]')!.addEventListener('click', () => root.querySelector('[data-panel]')!.classList.toggle('open'));
root.querySelector('[data-seal]')!.addEventListener('click', e => { const s = e.currentTarget as HTMLElement; s.classList.remove('stamped'); void s.offsetWidth; s.classList.add('stamped'); });
if (Q.get('panel') === '0') { (root.querySelector('[data-panel]') as HTMLElement).style.display = 'none'; root.classList.add('nopanel'); }
if (Q.get('panel') === 'open') root.querySelector('[data-panel]')!.classList.add('open');
syncPanel();

// ------------------------------------------------------------------ the kit specimen tray
function kitHtml() {
  return `<div class="kit" data-kitov><div class="k-sheet">
  <div class="line" style="justify-content:space-between"><h2 class="k-display" style="margin:0;font-size:1.4rem">The Component Kit</h2><button class="k-btn ghost" data-kitclose>${ic('close')}Close</button></div>
  <p class="k-prose spec">Every control is an object on the war table: brass plates, steel, enamel, wax and vellum, all lit from one lamp at the upper left.</p>
  <div class="k-tabs" role="tablist"><button class="k-tab" role="tab" aria-selected="true">Research</button><button class="k-tab" role="tab" aria-selected="false">Laws</button><button class="k-tab" role="tab" aria-selected="false">Ships</button></div>
  <div class="grid">
    <div class="k-card riveted"><div class="k-engraved">Buttons</div>
      <div class="line"><button class="k-btn primary">${ic('build')}Raise</button><button class="k-btn">${ic('move')}Move</button></div>
      <div class="line"><button class="k-btn danger">${ic('raze')}Raze</button><button class="k-btn" disabled>${ic('lock')}Locked</button></div>
      <div class="line"><button class="k-btn ghost">Cancel</button><button class="k-seal" title="Seal">${ic('crown')}</button></div>
    </div>
    <div class="k-card"><div class="k-engraved">Enamel tokens</div>
      <div class="line"><span class="k-token"><span class="boss">${ic('industry')}</span><span class="k-num">60</span><span class="delta k-num">+18</span></span>
      <span class="k-token good"><span class="boss">${ic('check')}</span>Held</span><span class="k-token bad"><span class="boss">${ic('warning')}</span>Besieged</span></div>
      <div class="line"><span class="k-token warn"><span class="boss">${ic('time')}</span>2 turns</span><span class="k-token fate"><span class="boss">${ic('fate')}</span><span class="k-num">3</span></span></div>
      <div class="line"><span class="k-token azure"><span class="boss">${ic('crown')}</span><span class="k-num">3</span></span><span class="k-token crimson"><span class="boss">${ic('crown')}</span><span class="k-num">6</span></span><span class="k-token gilded"><span class="boss">${ic('crown')}</span><span class="k-num">11</span></span></div>
    </div>
    <div class="k-card" data-house="crimson"><div class="k-engraved">House card</div>
      <h3 class="k-display k-house" style="font-size:1.2rem">Crimson Dominion</h3>
      <div class="line"><span class="k-display" style="font-size:2.4rem">6</span><span class="k-prose">crowns of 40</span></div>
      <hr class="k-rule"><div class="k-prose">Owes the Azure Compact for Vasquez Varga.</div>
    </div>
    <div class="k-card"><div class="k-engraved">Vellum slip (tooltip)</div>
      <div class="k-slip" style="margin-top:0.6rem"><b>NINEFOLD</b><br>Capital of the Azure Compact. Defenders <span class="k-num">41</span>; fortress <span class="k-num">1</span>, shipyard <span class="k-num">1</span>.</div>
    </div>
    <div class="k-card"><div class="k-engraved">Slider and levers</div>
      <input class="k-slider" type="range" min="0" max="100" value="62" aria-label="Music">
      <label class="k-toggle"><input type="checkbox" checked><span class="lever"></span>Reveal map</label>
      <label class="k-toggle"><input type="checkbox"><span class="lever"></span>Signals</label>
      <div class="k-seg"><button aria-pressed="true">1×</button><button aria-pressed="false">2×</button><button aria-pressed="false">4×</button></div>
    </div>
    <div class="k-card"><div class="k-engraved">Type and figures</div>
      <div class="k-display" style="font-size:1.5rem">Crown of Thorns</div>
      <div style="font-family:var(--k-black);font-size:1.7rem;color:${TEXT.ivory}">The Herald</div>
      <div class="k-prose">“Whoever holds the Throne next, it will not be Azure Compact.”</div>
      <div class="num-cmp" style="margin-top:0.6rem">
        <span class="k-engraved">Alegreya Sans</span><span class="k-num">1 111 · 40 · 8,888</span>
        <span class="k-engraved">Cinzel</span><span style="font-family:var(--k-display);font-weight:700">1 111 · 40 · 8,888</span>
      </div>
    </div>
  </div></div></div>`;
}
function openKit() {
  root.insertAdjacentHTML('beforeend', kitHtml());
  root.querySelector('[data-kitclose]')!.addEventListener('click', () => root.querySelector('[data-kitov]')?.remove());
}
root.querySelector('[data-kit]')!.addEventListener('click', openKit);
if (Q.get('kit') === '1') openKit();

// ------------------------------------------------------------------ camera + input
const cam = { x: -60, y: -40, z: 0.55 };
let w = 0, h = 0, dpr = 1;
let bg2d: { mat: HTMLCanvasElement; stars: HTMLCanvasElement; lamp: HTMLCanvasElement } | null = null;
function resize() {
  const r = board.getBoundingClientRect();
  dpr = Math.min(2, window.devicePixelRatio || 1);
  if (r.width === w && r.height === h && mapCanvas.width === Math.round(r.width * dpr)) return;
  const first = !w;
  w = r.width; h = r.height;
  mapCanvas.width = Math.round(w * dpr); mapCanvas.height = Math.round(h * dpr);
  // fit the board on first layout (a later resize or rotation keeps the player's zoom)
  if (first) cam.z = Math.min(w / 2300, h / 1500) * (w < 600 ? 1.55 : 1);
  bg2d = null;
}
window.addEventListener('resize', resize);
resize();
const pts = new Map<number, { x: number; y: number }>();
let pinch0 = 0, z0 = cam.z, interacted = 0;
board.addEventListener('pointerdown', e => { board.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); z0 = cam.z; } });
board.addEventListener('pointermove', e => {
  const p = pts.get(e.pointerId);
  if (!p) return;
  interacted = performance.now();
  if (pts.size === 1) { cam.x -= (e.clientX - p.x) / cam.z; cam.y -= (e.clientY - p.y) / cam.z; }
  p.x = e.clientX; p.y = e.clientY;
  if (pts.size === 2) { const [a, b] = [...pts.values()]; cam.z = Math.max(0.15, Math.min(3, z0 * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch0))); }
});
const up = (e: PointerEvent) => { pts.delete(e.pointerId); };
board.addEventListener('pointerup', up); board.addEventListener('pointercancel', up);
board.addEventListener('wheel', e => { e.preventDefault(); interacted = performance.now(); cam.z = Math.max(0.15, Math.min(3, cam.z * Math.exp(-e.deltaY * 0.0015))); }, { passive: false });

// ------------------------------------------------------------------ 2D fallback backdrop (the current painters)
const haze = stage ? null : nebulaPrint(B.bounds.minX, B.bounds.minY, B.bounds.maxX, B.bounds.maxY, 4242);

// ------------------------------------------------------------------ frame
const toScreen = (x: number, y: number) => ({ x: (x - cam.x) * cam.z + w / 2, y: (y - cam.y) * cam.z + h / 2 });
const tFreeze = Q.get('t') !== null ? Number(Q.get('t')) : null;
const t0 = performance.now();
let frames = 0, fpsT = performance.now(), lastDraw = 0;

function draw(now: number) {
  resize();
  const t = tFreeze ?? (now - t0) / 1000;
  if (local.drift && tFreeze === null && now - interacted > 2500) { cam.x += Math.sin(t * 0.05) * 0.22; cam.y += Math.cos(t * 0.037) * 0.14; }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  // the 2D table also stands in while the stage's context is lost (it was a black board until it came back)
  const flat = !stage || stage.lost;
  if (flat) {
    bg2d ??= { mat: matBackdrop(w, h), stars: starfield(w, h, 4242), lamp: lampOverlay(w, h) };
    g.drawImage(bg2d.mat, 0, 0, w, h);
    g.globalAlpha = 0.8; g.drawImage(bg2d.stars, 0, 0, w, h); g.globalAlpha = 1;
  }
  // world
  g.save();
  g.translate(w / 2, h / 2); g.scale(cam.z, cam.z); g.translate(-cam.x, -cam.y);
  if (haze) g.drawImage(haze.c, haze.x, haze.y, haze.w, haze.h);
  const terr = Q.get('board') === '0' ? null : territories(local.terr);
  if (terr) g.drawImage(terr, B.bounds.minX, B.bounds.minY, terr.width / S, terr.height / S);
  // lanes: an engraved groove (dark under-stroke) with a brass inlay
  const px = 1 / cam.z;
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 3 * px;
  if (terr) { g.beginPath(); for (const [a, b] of B.lanes) { g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); } g.stroke(); }
  g.strokeStyle = local.terr === 'neon' ? 'rgba(150,170,255,0.28)' : 'rgba(214,170,98,0.34)'; g.lineWidth = 1.1 * px;
  if (terr) { g.beginPath(); for (const [a, b] of B.lanes) { g.moveTo(a.x, a.y - 0.6 * px); g.lineTo(b.x, b.y - 0.6 * px); } g.stroke(); }
  g.restore();

  // stars, labels, fleets in screen space
  const coronas: CoronaStar[] = [];
  const zr = Math.sqrt(cam.z / 0.55);
  for (const s of B.sys) {
    const p = toScreen(s.x, s.y);
    if (p.x < -60 || p.y < -60 || p.x > w + 60 || p.y > h + 60) continue;
    const r = Math.max(4, Math.min(30, (s.kind === 'throne' ? 15 : 8.5) * zr));
    drawStarNode(g, p.x, p.y, r, r * dpr, s.kind);
    coronas.push({ x: p.x, y: p.y, r, amp: CORONA_AMP[s.kind], color: CORONA[s.kind] ?? '#ffd9a0', seed: s.id * 37 + 11 });
    if (local.labels) {
      const fs = s.kind === 'throne' ? 15 : 12.5;
      g.font = `600 ${fs}px Cinzel, Georgia, serif`;
      (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '0.1em';
      g.textAlign = 'center'; g.textBaseline = 'top';
      const ty = p.y + r * 1.15 + 6;
      g.lineJoin = 'round'; g.strokeStyle = 'rgba(5,4,3,0.85)'; g.lineWidth = 3.5;
      g.strokeText(s.name.toUpperCase(), p.x, ty);
      g.fillStyle = s.owner ? (local.terr === 'neon' ? NEON[s.owner] : FACTION[s.owner].hi) : s.kind === 'throne' ? '#efd59a' : TEXT.parchment;
      g.fillText(s.name.toUpperCase(), p.x, ty);
      (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '0px';
    }
  }
  if (local.labels) for (const f of B.fleets) {
    const p = toScreen(f.x, f.y);
    const team = local.terr === 'neon' ? NEON[f.house] : FACTION[f.house].base;
    const L = Math.max(16, Math.min(60, 30 * zr));
    drawBase(g, p.x, p.y + L * 0.55, L * 0.75, L * 0.75 * dpr, team);
    f.cls.forEach((c, i) => {
      const ox = i === 0 ? 0 : (i % 2 ? -1 : 1) * L * 0.45 * Math.ceil(i / 2), oy = i === 0 ? 0 : L * 0.3 * Math.ceil(i / 2);
      const bob = Math.sin(t * 1.3 + i + f.x) * 1.2;
      drawShip(g, p.x + ox, p.y + oy - L * 0.25 + bob, L * (i === 0 ? 1 : 0.7), L * dpr, c, SEAT[f.house], team, f.ang, { shadow: { dx: 4, dy: 7, alpha: 0.5 }, engine: 0.6 });
    });
  }
  if (flat && bg2d) g.drawImage(bg2d.lamp, 0, 0, w, h);

  stage?.frame({ cam, t, stars: coronas, bloomSrc: mapCanvas, dt: lastDraw ? now - lastDraw : undefined }, w, h);
  lastDraw = now;

  frames++;
  if (now - fpsT > 500) {
    const el = root.querySelector('[data-fps]');
    if (el) el.textContent = `${Math.round((frames * 1000) / (now - fpsT))} fps${stage ? ` · ${stage.frameMs.toFixed(1)} ms` : ''}`;
    frames = 0; fpsT = now;
  }
  requestAnimationFrame(draw);
}
document.fonts?.ready.then(() => requestAnimationFrame(draw)).catch(() => requestAnimationFrame(draw));
(window as unknown as { artLab: unknown }).artLab = { stage, cam, local };
