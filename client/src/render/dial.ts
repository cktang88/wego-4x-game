// The board's ground: the black-enamel dial of the orrery (docs/ART-BIBLE.md §13), baked in world space.
//
// What is baked: the velvet round the instrument, the dial and its cast shadow, the guilloché (engine-turned rings
// round the Throne) under the glaze, the nebulae as cloisonné fields of deep enamel separated by fine bronze wire
// (vector contours: marching squares once per map, smoothed, filled even-odd, so edges never step), the territories
// as champlevé house enamel with the house hatch engraved under the glaze in a band along each wall (screen-constant
// spacing: the colour-blind cue at every tier), antique bronze walls, the resting hyperlanes as inlaid gold wire, fog
// (colour removed, value kept), the lens tints, cut-off hatching and the polished gold bezel with its degree scale.
//
// How: 512 px tiles per zoom bucket (three buckets an octave, so a tile is never drawn more than ~12% off its baked
// scale: the hatch stays within a hair of its screen spacing). A frame draws the visible tiles of the bucket it has;
// the tiles of a new bucket (or new content: a capture, the fog moving, a lens) are baked a few per frame inside a
// time budget and crossfade in when the view is complete, so a zoom never stalls and nothing pops. A small overview
// bake of the whole board stands under any tile not baked yet (a fast pan into new ground).
import type { GameState, Region, Pt } from '../../../shared/sim/types.ts';
import { regionEdges, hyperlanes, isLane, zoomW, medianRegionRadius, type ZoomW } from './mapmodel.ts';
// (bbox culling of the per-map geometry: see Loop / pick below)
import { HATCH, type HouseKey } from '../art/bible.ts';
import { FIELD, HI, BRONZE, houseOf, gold } from '../art/orrery.ts';
import { fbm2, noise2, rand, canvas } from '../art/util.ts';

const TILE = 512;
const TAU = Math.PI * 2;
/** Zoom buckets per octave. */
const PER_OCT = 3;

export interface DialContent {
  st: GameState;
  owners: (number | null)[];
  /** regions shown under fog of war */
  fogged: Set<number>;
  lens: string;
  cutOff: Set<number> | null;
  /** supply lens: regions out of your supply */
  unsup: Set<number> | null;
  /** a string that changes whenever any of the above does */
  key: string;
  /** measurement only: 0 the dial alone (no territories, walls or lanes), 1 no resting lanes */
  bare?: 0 | 1;
}
export interface DialView { cx: number; cy: number; z: number; w: number; h: number; dpr: number; ui: number; coarse: boolean; now: number; reduced: boolean; sync?: boolean }

// ------------------------------------------------------------------ per-map geometry (once per st.regions)
interface Geo {
  x0: number; y0: number; x1: number; y1: number;
  union: Path2D;
  outer: { a: Pt; b: Pt; nx: number; ny: number }[];
  outerPath: Path2D;
  seams: Path2D;
  regionPath: Map<number, Path2D>;
  fields: Fields;
  guilloche: Loop[];
  regionBox: Map<number, Box>;
  pins: { x: number; y: number; r: number; warm: boolean }[];
  lanes: { pts: Pt[]; ids: number[] }[];
  voids: Path2D;
  rocks: { x: number; y: number; r: number }[];
}
const geoCache = new WeakMap<Region[], Geo>();

/** Marching squares: closed iso-contours of `f` (grid nx × ny, spacing `cs`, origin ox, oy) at threshold `t`, as a
 *  smoothed Path2D (quadratic curves through the segment midpoints). The grid's border is forced below `t`, so every
 *  contour closes and an even-odd fill gives exactly {f >= t}. */
/** A closed contour (or an open run of one) with its bounding box: a tile only takes the ones that touch it (a loop
 *  that misses a tile cannot change the even-odd parity inside it), so a tile never walks the whole map's geometry. */
export interface Box { x0: number; y0: number; x1: number; y1: number }
export interface Loop extends Box { p: Path2D }
const hits = (a: Box, b: Box) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;
/** One Path2D of the loops touching `r` (all of them when r is null). */
export function pick(loops: Loop[], r: Box | null): Path2D {
  const P = new Path2D();
  for (const l of loops) if (!r || hits(l, r)) P.addPath(l.p);
  return P;
}
export function contours(f: Float32Array, nx: number, ny: number, ox: number, oy: number, cs: number, t: number): Loop[] {
  const v = (i: number, j: number) => (i <= 0 || j <= 0 || i >= nx - 1 || j >= ny - 1 ? -1 : f[j * nx + i]);
  // edge ids: horizontal (i,j)-(i+1,j) = 2*(j*nx+i); vertical (i,j)-(i,j+1) = 2*(j*nx+i)+1
  const pt = new Map<number, Pt>();
  const edgePt = (id: number): Pt => {
    let p = pt.get(id);
    if (p) return p;
    const base = id >> 1, i = base % nx, j = (base / nx) | 0;
    const a = v(i, j), b = (id & 1) ? v(i, j + 1) : v(i + 1, j);
    const k = Math.max(0, Math.min(1, (t - a) / (b - a || 1e-9)));
    p = (id & 1) ? { x: ox + i * cs, y: oy + (j + k) * cs } : { x: ox + (i + k) * cs, y: oy + j * cs };
    pt.set(id, p);
    return p;
  };
  const link = new Map<number, number[]>();
  const seg = (e1: number, e2: number) => { (link.get(e1) ?? link.set(e1, []).get(e1)!).push(e2); (link.get(e2) ?? link.set(e2, []).get(e2)!).push(e1); };
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = v(i, j) >= t ? 1 : 0, b = v(i + 1, j) >= t ? 1 : 0, c = v(i + 1, j + 1) >= t ? 1 : 0, d = v(i, j + 1) >= t ? 1 : 0;
    const code = a | (b << 1) | (c << 2) | (d << 3);
    if (code === 0 || code === 15) continue;
    const top = 2 * (j * nx + i), bottom = 2 * ((j + 1) * nx + i), left = 2 * (j * nx + i) + 1, right = 2 * (j * nx + i + 1) + 1;
    switch (code) {
      case 1: case 14: seg(left, top); break;
      case 2: case 13: seg(top, right); break;
      case 3: case 12: seg(left, right); break;
      case 4: case 11: seg(right, bottom); break;
      case 6: case 9: seg(top, bottom); break;
      case 7: case 8: seg(left, bottom); break;
      case 5: case 10: {
        const mid = (v(i, j) + v(i + 1, j) + v(i + 1, j + 1) + v(i, j + 1)) / 4 >= t;
        if ((code === 5) === mid) { seg(left, bottom); seg(top, right); } else { seg(left, top); seg(right, bottom); }
        break;
      }
    }
  }
  const out: Loop[] = [];
  const used = new Set<number>();
  for (const start of link.keys()) {
    if (used.has(start)) continue;
    const loop: number[] = [start];
    used.add(start);
    let prev = -1, cur = start;
    for (let guard = 0; guard < 200000; guard++) {
      const nb = link.get(cur)!;
      const nxt = nb.find(e => e !== prev && !used.has(e)) ?? (nb.includes(start) && loop.length > 2 ? start : undefined);
      if (nxt === undefined || nxt === start) break;
      loop.push(nxt); used.add(nxt); prev = cur; cur = nxt;
    }
    if (loop.length < 3) continue;
    const pts = loop.map(edgePt);
    const n = pts.length;
    const m = (k: number) => { const p = pts[k % n], q = pts[(k + 1) % n]; return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }; };
    const s0 = m(0);
    const P = new Path2D();
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const q of pts) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
    P.moveTo(s0.x, s0.y);
    for (let k = 1; k <= n; k++) { const c = pts[k % n], e = m(k); P.quadraticCurveTo(c.x, c.y, e.x, e.y); }
    P.closePath();
    out.push({ p: P, x0, y0, x1, y1 });
  }
  return out;
}

function geometry(st: GameState, seed: number): Geo {
  let g = geoCache.get(st.regions);
  if (g) return g;
  const regs = st.regions.filter(r => !isLane(r) && r.poly.length > 2);
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const r of regs) for (const p of r.poly) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  if (!Number.isFinite(x0)) { x0 = y0 = -1000; x1 = y1 = 1000; }
  const union = new Path2D(), seams = new Path2D(), voids = new Path2D();
  const regionPath = new Map<number, Path2D>();
  for (const r of regs) {
    const p = new Path2D();
    r.poly.forEach((q, i) => (i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y))); p.closePath();
    regionPath.set(r.id, p);
    union.addPath(p);
    seams.addPath(p);
    if (r.kind === 'void') voids.addPath(p);
  }
  const edges = regionEdges(st);
  const outer: Geo['outer'] = [];
  const outerPath = new Path2D();
  for (const r of regs) for (const e of edges[r.id]) {
    const o = e.other >= 0 ? st.regions[e.other] : null;
    if (o && !isLane(o) && o.poly.length > 2) continue;
    const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, L = Math.hypot(dx, dy) || 1;
    let nx = dy / L, ny = -dx / L;
    if (nx * ((e.a.x + e.b.x) / 2 - r.site.x) + ny * ((e.a.y + e.b.y) / 2 - r.site.y) < 0) { nx = -nx; ny = -ny; }
    outer.push({ a: e.a, b: e.b, nx, ny });
    outerPath.moveTo(e.a.x, e.a.y); outerPath.lineTo(e.b.x, e.b.y);
  }
  // ---- the cloisonné: an fbm density field, thinner in the middle of the board (the fields gather toward the rim)
  // and raised inside the map's real nebulae, contoured at three levels; a second field splits the hues
  const cs = 14, pad = 120;
  const ox = x0 - pad, oy = y0 - pad, nx = Math.ceil((x1 - x0 + pad * 2) / cs) + 1, ny = Math.ceil((y1 - y0 + pad * 2) / cs) + 1;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
  const neb = st.regions.filter(r => r.feature === 'nebula' && !isLane(r)).map(r => ({ x: r.centroid.x, y: r.centroid.y, R: Math.sqrt(Math.abs(area(r.poly)) / Math.PI) * 1.15 }));
  const fd = new Float32Array(nx * ny), fk = new Float32Array(nx * ny);
  const s = (seed % 997) + 3;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const wx = ox + i * cs, wy = oy + j * cs;
    let d = fbm2(wx * 0.0017 + 7, wy * 0.0017 - 3, 4, s) + (fbm2(wx * 0.0055, wy * 0.0055, 2, s + 9) - 0.5) * 0.06;
    const rim = Math.min(1, Math.hypot((wx - cx) / rx, (wy - cy) / ry));
    d -= (1 - rim) * 0.07;
    for (const n of neb) { const q = Math.hypot(wx - n.x, wy - n.y) / n.R; if (q < 1.4) d += 0.16 * (1 - Math.max(0, q - 0.4)); }
    fd[j * nx + i] = d;
    fk[j * nx + i] = noise2(wx * 0.0022 + 40, wy * 0.0022, s + 3);
  }
  const fields = cloisonne(fd, fk, nx, ny, ox, oy, cs);
  // ---- the guilloché: the engine-turned wave's crests round the Throne, as fine rings
  const th = st.regions.find(r => r.kind === 'throne');
  const gc = th ? th.site : { x: cx, y: cy };
  const guilloche = guillocheRuns(gc.x, gc.y, Math.hypot(Math.max(x1 - gc.x, gc.x - x0), Math.max(y1 - gc.y, gc.y - y0) * 1.45));
  // ---- pin-head brilliants: the background stars set in the glaze
  const rr = rand(seed ^ 0x5eed);
  const pins: Geo['pins'] = [];
  for (let i = 0; i < 700; i++) { const m = rr() ** 3; pins.push({ x: x0 + rr() * (x1 - x0), y: y0 + rr() * (y1 - y0), r: 0.5 + m * 1.3, warm: m > 0.6 }); }
  // ---- asteroid fields: bronze granules
  const rocks: Geo['rocks'] = [];
  for (const r of st.regions) {
    if (r.feature !== 'asteroids') continue;
    const q = rand((seed ^ (r.id * 7919)) >>> 0);
    for (let i = 0; i < 160 && rocks.length < 2000; i++) {
      const p = { x: r.centroid.x + (q() - 0.5) * 420, y: r.centroid.y + (q() - 0.5) * 420 };
      if (inPoly(p, r.poly) && Math.hypot(p.x - r.site.x, p.y - r.site.y) > 40) rocks.push({ ...p, r: 1.2 + q() * 2.4 });
    }
  }
  const regionBox = new Map<number, Box>();
  for (const r of regs) { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const q of r.poly) { a = Math.min(a, q.x); b = Math.min(b, q.y); c = Math.max(c, q.x); d = Math.max(d, q.y); } regionBox.set(r.id, { x0: a, y0: b, x1: c, y1: d }); }
  g = { x0, y0, x1, y1, union, outer, outerPath, seams, regionPath, regionBox, voids, guilloche, pins, rocks, fields, lanes: hyperlanes(st) };
  geoCache.set(st.regions, g);
  return g;
}
export interface Fields { L1: Loop[]; L2: Loop[]; L3: Loop[]; K2: Loop[]; K3: Loop[] }
/** The cloisonné fields from a density field `fd` (three levels) and a hue field `fk` (splits levels 2 and 3). */
export function cloisonne(fd: Float32Array, fk: Float32Array, nx: number, ny: number, ox: number, oy: number, cs: number): Fields {
  return {
    L1: contours(fd, nx, ny, ox, oy, cs, 0.47), L2: contours(fd, nx, ny, ox, oy, cs, 0.53), L3: contours(fd, nx, ny, ox, oy, cs, 0.6),
    K2: contours(fk, nx, ny, ox, oy, cs, 0.5), K3: contours(fk, nx, ny, ox, oy, cs, 0.45),
  };
}
/** Fill the deep enamels (indigo, oxblood, verdigris, umber) and draw the bronze cloisons, for the part of the board
 *  in `r` (null: all); `u` = one design px. */
export function paintFields(g: CanvasRenderingContext2D, F: Fields, u: number, r: Box | null = null, wires = true, before?: () => void) {
  const L1 = pick(F.L1, r), L2 = pick(F.L2, r), L3 = pick(F.L3, r), K2 = pick(F.K2, r), K3 = pick(F.K3, r);
  g.fillStyle = '#10142c'; g.fill(L1, 'evenodd');
  g.fillStyle = '#280e16'; g.fill(L2, 'evenodd');
  g.save(); g.clip(K2, 'evenodd'); g.fillStyle = '#0d2428'; g.fill(L2, 'evenodd'); g.restore();
  g.fillStyle = '#280e16'; g.fill(L3, 'evenodd');
  g.save(); g.clip(K3, 'evenodd'); g.fillStyle = '#2c1e10'; g.fill(L3, 'evenodd'); g.restore();
  before?.();
  if (!wires) return;
  g.lineWidth = 0.9 * u; g.strokeStyle = 'rgba(150,116,60,0.5)';
  g.stroke(L1); g.stroke(L2); g.stroke(L3);
  // the hue splits: wire only where the level they split is (L2 outside L3 for K2; L3 for K3)
  const ring2 = new Path2D(); ring2.addPath(L2); ring2.addPath(L3);
  g.save(); g.clip(ring2, 'evenodd'); g.stroke(K2); g.restore();
  g.save(); g.clip(L3, 'evenodd'); g.stroke(K3); g.restore();
}
/** The guilloché round (cx, cy): the crests of an engine-turned wave, out to radius `maxR` (`k` rings per unit), as
 *  short runs (a tile strokes only the runs that cross it). */
export function guillocheRuns(cx: number, cy: number, maxR: number, k = 0.11): Loop[] {
  const out: Loop[] = [];
  const N = 720, RUN = 24;
  for (let n = 1; ; n++) {
    const base = (Math.PI / 2 + TAU * n) / k;
    if (base - 2.2 / k > maxR) break;
    for (let i0 = 0; i0 < N; i0 += RUN) {
      const P = new Path2D();
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (let i = i0; i <= i0 + RUN; i++) {
        const a = (i / N) * TAU, r = (Math.PI / 2 + TAU * n - 2.2 * Math.sin(a * 12)) / k;
        const px = cx + r * Math.cos(a), py = cy + (r * Math.sin(a)) / 1.45;
        if (i > i0) P.lineTo(px, py); else P.moveTo(px, py);
        x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py);
      }
      out.push({ p: P, x0, y0, x1, y1 });
    }
  }
  return out;
}
function area(p: Pt[]) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[i], w = p[(i + 1) % p.length]; a += q.x * w.y - w.x * q.y; } return a / 2; }
function inPoly(p: Pt, poly: Pt[]) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c; } return c; }

// ------------------------------------------------------------------ hatch patterns (device px, one period)
const hatchTiles = new Map<string, HTMLCanvasElement>();
function hatchTile(color: string, lw: number, gap: number): HTMLCanvasElement {
  const k = `${color}|${lw.toFixed(2)}|${gap.toFixed(2)}`;
  let t = hatchTiles.get(k);
  if (t) return t;
  const n = Math.max(2, Math.round(gap));
  t = canvas(n, 2);
  const g = t.getContext('2d')!;
  g.fillStyle = color; g.fillRect(n / 2 - lw / 2, 0, lw, 2);
  hatchTiles.set(k, t);
  return t;
}

// ------------------------------------------------------------------ the dial
interface Tile { c: HTMLCanvasElement; gen: number; b: number; tx: number; ty: number; used: number }
type SetId = { gen: number; b: number };

export class Dial {
  private tiles = new Map<string, Tile>();
  private gen = 0;
  private genKey = '';
  private content: DialContent | null = null;
  private quality: 'high' | 'low' = 'high';
  private shown: SetId | null = null;
  private fadeFrom: { set: SetId; t0: number } | null = null;
  private over: { c: HTMLCanvasElement; gen: number; s: number; x: number; y: number } | null = null;
  private pool: HTMLCanvasElement[] = [];
  private felt: HTMLImageElement | null = null;
  private feltOk = false;
  /** ms spent baking in the last frame (kept out of the frame-budget governor) */
  bakeMs = 0;
  /** tiles baked in the last frame */
  baked = 0;
  /** true while two sets crossfade (a zoom bucket or content change) */
  get fading() { return !!this.fadeFrom; }
  /** how many tiles of the wanted set are still missing */
  missing = 0;

  constructor() {
    if (typeof Image !== 'undefined') { const im = new Image(); im.onload = () => { this.feltOk = true; this.felt = im; this.invalidate(); }; im.src = '/tex/felt.webp'; }
  }
  /** Rebake everything (progressively: the old tiles stand in until the new ones are ready). */
  invalidate() { this.genKey = ''; }
  get tileCount() { return this.tiles.size; }

  private eff(dpr: number) { return this.quality === 'low' ? Math.min(dpr, 1.5) : Math.min(dpr, 3); }
  private bucketFor(z: number, dpr: number) { return Math.round(Math.log2(z * this.eff(dpr)) * PER_OCT); }
  private scale(b: number) { return Math.pow(2, b / PER_OCT); }

  /** Draw the ground for this view into `ctx` (device space). */
  draw(ctx: CanvasRenderingContext2D, C: DialContent, V: DialView, quality: 'high' | 'low', budgetMs: number) {
    const t0 = performance.now();
    this.baked = 0;
    if (quality !== this.quality) { this.quality = quality; this.genKey = ''; }
    const key = `${C.key}|${V.ui}|${V.coarse ? 1 : 0}|${this.feltOk ? 1 : 0}|${quality}`;
    if (key !== this.genKey) { this.genKey = key; this.gen++; }
    this.content = C;
    const geo = geometry(C.st, C.st.seed);
    // the bucket: keep the one on screen while the zoom is within ~19% of it (no flapping between two)
    const want = Math.log2(V.z * this.eff(V.dpr)) * PER_OCT;
    const b = this.shown && this.shown.gen === this.gen && Math.abs(want - this.shown.b) < 0.75 ? this.shown.b : this.bucketFor(V.z, V.dpr);
    const target: SetId = { gen: this.gen, b };
    const vis = this.visibleTiles(b, V, geo, 0);
    const need = vis.filter(([tx, ty]) => !this.tiles.has(this.key(target, tx, ty)));
    this.missing = need.length;
    // nothing on screen yet (first frame): bake the view now
    const sync = !this.shown || !!V.sync;
    const maxTiles = budgetMs >= 9 ? 4 : 1;
    // bake: centre first, inside the budget (at least one tile a frame)
    if (need.length) {
      const ctr = this.tileAt(b, V.cx, V.cy);
      need.sort((p, q) => Math.hypot(p[0] - ctr[0], p[1] - ctr[1]) - Math.hypot(q[0] - ctr[0], q[1] - ctr[1]));
      for (const [tx, ty] of need) {
        // a new tile costs its bake and its first blit (an upload): while the camera moves, one a frame
        if (!sync && this.baked > 0 && (performance.now() - t0 > budgetMs || this.baked >= maxTiles)) break;
        this.bakeTile(target, tx, ty, geo, V);
      }
    }
    this.missing = vis.filter(([tx, ty]) => !this.tiles.has(this.key(target, tx, ty))).length;
    if (!this.missing && performance.now() - t0 < budgetMs * 0.7) {
      // spare time: the ring of tiles just off screen (a pan finds them ready)
      for (const [tx, ty] of this.visibleTiles(b, V, geo, 1)) {
        if (performance.now() - t0 > budgetMs * 0.8 || this.baked >= maxTiles) break;
        if (!this.tiles.has(this.key(target, tx, ty))) this.bakeTile(target, tx, ty, geo, V);
      }
    }
    // the set on screen: the target once its view is complete (crossfading from the previous set), else the old one
    if (!this.missing && (!this.shown || this.shown.gen !== target.gen || this.shown.b !== target.b)) {
      if (this.shown && !V.reduced && !V.sync) this.fadeFrom = { set: this.shown, t0: V.now };
      this.shown = target;
    }
    const FADE = 170;
    if (this.fadeFrom && (V.now - this.fadeFrom.t0 >= FADE || V.reduced)) this.fadeFrom = null;
    const shown = this.shown!;
    // under it: the overview, wherever a tile of the shown set is missing (a pan into new ground)
    const visShown = shown.b === b && shown.gen === target.gen ? vis : this.visibleTiles(shown.b, V, geo, 0);
    // a set baked much finer than the view (a fast zoom out) would mean dozens of heavily shrunk tiles: the overview
    // stands in for it until the coarser bucket is ready
    const fine = (b0: number, k = 1.7) => this.scale(b0) / (V.z * this.eff(V.dpr)) > k;
    const gap = fine(shown.b) || visShown.some(([tx, ty]) => !this.tiles.has(this.key(shown, tx, ty)));
    if (gap || this.fadeFrom) this.drawOverview(ctx, geo, V);
    if (this.fadeFrom) {
      const fs = this.fadeFrom.set;
      // (the set fading out is drawn only while it is not much finer than the view: else the overview stands in)
      if (!fine(fs.b, 1.3)) this.blitSet(ctx, fs, V, geo, 1);
      const e = Math.min(1, (V.now - this.fadeFrom.t0) / FADE);
      this.blitSet(ctx, shown, V, geo, 1 - (1 - e) ** 3);
    } else if (!fine(shown.b)) this.blitSet(ctx, shown, V, geo, 1);
    this.evict([target, shown, ...(this.fadeFrom ? [this.fadeFrom.set] : [])], V.now);
    this.bakeMs = this.baked ? performance.now() - t0 : 0;
  }

  private key(s: SetId, tx: number, ty: number) { return `${s.gen}|${s.b}|${tx}|${ty}`; }
  private tileAt(b: number, x: number, y: number): [number, number] { const T = TILE / this.scale(b); return [Math.floor(x / T), Math.floor(y / T)]; }
  private visibleTiles(b: number, V: DialView, geo: Geo, margin: number): [number, number][] {
    const T = TILE / this.scale(b);
    const hw = V.w / 2 / V.z, hh = V.h / 2 / V.z;
    // the bake covers the board and a margin round it (the bezel's ticks and the dial's shadow)
    const pad = 80;
    const ax = Math.max(V.cx - hw, geo.x0 - pad), bx = Math.min(V.cx + hw, geo.x1 + pad);
    const ay = Math.max(V.cy - hh, geo.y0 - pad), by = Math.min(V.cy + hh, geo.y1 + pad);
    if (ax >= bx || ay >= by) return [];
    const out: [number, number][] = [];
    const i0 = Math.floor(ax / T) - margin, i1 = Math.floor(bx / T) + margin, j0 = Math.floor(ay / T) - margin, j1 = Math.floor(by / T) + margin;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (margin && i > i0 && i < i1 && j > j0 && j < j1) continue;
      if ((i + 1) * T < geo.x0 - pad || i * T > geo.x1 + pad || (j + 1) * T < geo.y0 - pad || j * T > geo.y1 + pad) continue;
      out.push([i, j]);
    }
    return out;
  }
  private blitSet(ctx: CanvasRenderingContext2D, s: SetId, V: DialView, geo: Geo, alpha: number) {
    const sc = this.scale(s.b), T = TILE / sc;
    const k = V.z * V.dpr; // device px per world unit on screen
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'medium';
    for (const [tx, ty] of this.visibleTiles(s.b, V, geo, 0)) {
      const t = this.tiles.get(this.key(s, tx, ty));
      if (!t) continue;
      t.used = V.now;
      // snap to whole device px (no hairline seams between tiles)
      const dx0 = Math.round((tx * T - V.cx) * k + V.w * V.dpr / 2), dy0 = Math.round((ty * T - V.cy) * k + V.h * V.dpr / 2);
      const dx1 = Math.round(((tx + 1) * T - V.cx) * k + V.w * V.dpr / 2), dy1 = Math.round(((ty + 1) * T - V.cy) * k + V.h * V.dpr / 2);
      ctx.drawImage(t.c, dx0, dy0, dx1 - dx0, dy1 - dy0);
    }
    ctx.restore();
  }
  private evict(keep: SetId[], now: number) {
    const MAX = this.quality === 'low' ? 56 : 84;
    if (this.tiles.size <= MAX) return;
    const pinned = (t: Tile) => keep.some(s => s.gen === t.gen && s.b === t.b);
    const old = [...this.tiles.entries()].filter(([, t]) => !pinned(t) || now - t.used > 2000).sort((a, b) => a[1].used - b[1].used);
    for (const [k, t] of old) { if (this.tiles.size <= MAX) break; this.tiles.delete(k); if (this.pool.length < 32) this.pool.push(t.c); }
  }

  // ---- the overview: the whole board at a small scale, the stand-in for tiles not baked yet
  private drawOverview(ctx: CanvasRenderingContext2D, geo: Geo, V: DialView) {
    if (!this.over || this.over.gen !== this.gen) {
      const pad = 80, W = geo.x1 - geo.x0 + pad * 2, H = geo.y1 - geo.y0 + pad * 2;
      const s = Math.min(1100 / W, 1100 / H);
      const c = this.over?.c && this.over.c.width === Math.ceil(W * s) ? this.over.c : canvas(W * s, H * s);
      const g = c.getContext('2d')!;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height);
      g.setTransform(s, 0, 0, s, -(geo.x0 - pad) * s, -(geo.y0 - pad) * s);
      this.paint(g, geo, s, s / this.eff(V.dpr) / V.ui, V, c.width, c.height, null);
      this.over = { c, gen: this.gen, s, x: geo.x0 - pad, y: geo.y0 - pad };
    }
    const o = this.over, k = V.z * V.dpr;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(o.c, (o.x - V.cx) * k + V.w * V.dpr / 2, (o.y - V.cy) * k + V.h * V.dpr / 2, o.c.width / o.s * k, o.c.height / o.s * k);
    ctx.restore();
  }

  private bakeTile(s: SetId, tx: number, ty: number, geo: Geo, V: DialView) {
    const sc = this.scale(s.b), T = TILE / sc;
    // tiles are recycled (an evicted tile's canvas is the next one baked): zooming back and forth allocates nothing
    const c = this.pool.pop() ?? canvas(TILE, TILE);
    const g = c.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.setTransform(sc, 0, 0, sc, -tx * T * sc, -ty * T * sc);
    const de = this.eff(V.dpr);
    const zd = sc / de / V.ui;            // design px per world unit at this bucket
    this.paint(g, geo, sc, zd, V, TILE, TILE, { x0: tx * T, y0: ty * T, x1: (tx + 1) * T, y1: (ty + 1) * T });
    this.tiles.set(this.key(s, tx, ty), { c, gen: s.gen, b: s.b, tx, ty, used: V.now });
    this.baked++;
  }

  /** Paint the ground into `g` (its transform maps world to device px at `sc` device px per world unit). */
  private paint(g: CanvasRenderingContext2D, geo: Geo, sc: number, zd: number, V: DialView, cw: number, ch: number, rect: { x0: number; y0: number; x1: number; y1: number } | null) {
    const C = this.content!;
    const st = C.st;
    const u = 1 / zd; // one design px in world units
    // only tiles near the rim carry the dial's shadow, the velvet's felt and the bezel
    const reach = 60 * u;
    const rim = !rect || geo.outer.some(e => Math.min(e.a.x, e.b.x) - reach < rect.x1 && Math.max(e.a.x, e.b.x) + reach > rect.x0 && Math.min(e.a.y, e.b.y) - reach < rect.y1 && Math.max(e.a.y, e.b.y) + reach > rect.y0);
    const zr = medianRegionRadius(st) * zd;
    const W: ZoomW = zoomW(zr, V.coarse);
    const political = C.lens === 'political';
    const m = g.getTransform();
    const dev = (fn: () => void) => { g.save(); g.setTransform(1, 0, 0, 1, 0, 0); fn(); g.restore(); };
    // ---- velvet round the instrument
    dev(() => {
      g.fillStyle = '#060608'; g.fillRect(0, 0, cw, ch);
      if (this.felt && rim) {
        // the felt's tooth at a screen-constant scale, anchored to the board
        const p = g.createPattern(this.felt, 'repeat');
        if (p) { p.setTransform(new DOMMatrix().translateSelf(m.e % (512 * sc * u * 0.6), m.f % (512 * sc * u * 0.6)).scaleSelf(sc * u * 0.6)); g.globalCompositeOperation = 'soft-light'; g.globalAlpha = 0.16; g.fillStyle = p; g.fillRect(0, 0, cw, ch); }
      }
    });
    // ---- the dial: its cast shadow on the velvet, then the black enamel
    g.save();
    if (rim) { g.shadowColor = 'rgba(0,0,0,0.85)'; g.shadowBlur = 26 * sc * u; g.shadowOffsetX = 7 * sc * u; g.shadowOffsetY = 12 * sc * u; }
    g.fillStyle = '#0a0b10'; g.fill(geo.union);
    g.restore();
    g.save();
    g.clip(geo.union);
    // the enamel fields; then the guilloché under the glaze; then the cloisons, fine bronze wire where two enamels meet
    const box = rect ? { x0: rect.x0 - 4 * u, y0: rect.y0 - 4 * u, x1: rect.x1 + 4 * u, y1: rect.y1 + 4 * u } : null;
    paintFields(g, geo.fields, u, box, true, () => { g.lineWidth = Math.max(0.7 * u, 2.2); g.strokeStyle = 'rgba(112,94,64,0.15)'; g.stroke(pick(geo.guilloche, box)); });
    // pin-head brilliants
    const pinR = Math.max(0.45 * u, 0.6);
    const inBox = (p: { x: number; y: number }) => !box || (p.x > box.x0 - 4 && p.x < box.x1 + 4 && p.y > box.y0 - 4 && p.y < box.y1 + 4);
    g.fillStyle = 'rgba(255,236,190,0.62)';
    g.beginPath(); for (const p of geo.pins) if (p.warm && inBox(p)) { const r = Math.max(pinR, p.r * 0.7); g.moveTo(p.x + r, p.y); g.arc(p.x, p.y, r, 0, TAU); } g.fill();
    g.fillStyle = 'rgba(190,200,230,0.36)';
    g.beginPath(); for (const p of geo.pins) if (!p.warm && inBox(p)) { const r = Math.max(pinR, p.r * 0.5); g.moveTo(p.x + r, p.y); g.arc(p.x, p.y, r, 0, TAU); } g.fill();
    // void: black and starless
    g.fillStyle = '#040406'; g.fill(geo.voids);
    g.restore();

    // ---- territories: champlevé house enamel, the hatch engraved under the glaze, strongest in a band along the wall
    const houses = new Map<number, { h: HouseKey; P: Path2D; E: Path2D }>();
    const edges = regionEdges(st);
    for (const pl of st.players) {
      // only the regions that reach this tile (with the hatch band's and the walls' reach)
      const near = rect ? { x0: rect.x0 - 30 * u, y0: rect.y0 - 30 * u, x1: rect.x1 + 30 * u, y1: rect.y1 + 30 * u } : null;
      const mine = st.regions.filter(r => C.owners[r.id] === pl.id && !isLane(r) && r.poly.length > 2 && (!near || hits(geo.regionBox.get(r.id)!, near)));
      if (!mine.length) continue;
      const P = new Path2D(), E = new Path2D();
      for (const r of mine) {
        P.addPath(geo.regionPath.get(r.id)!);
        for (const e of edges[r.id]) { if (e.other >= 0 && C.owners[e.other] === pl.id) continue; E.moveTo(e.a.x, e.a.y); E.lineTo(e.b.x, e.b.y); }
      }
      if (C.bare !== 0) houses.set(pl.id, { h: houseOf(pl.color), P, E });
    }
    const wash = political ? W.s * 0.72 + W.o * 0.62 + W.d * 0.52 : 0.3;
    const band = (W.s * 8 + W.o * 14 + W.d * 20) * u;
    const de = sc * u; // device px per design px
    const gap = 4.5 * de;
    for (const { h, P, E } of houses.values()) {
      g.globalAlpha = wash; g.fillStyle = FIELD[h]; g.fill(P);
      g.globalAlpha = 1;
      const gl = g.createLinearGradient(geo.x0, geo.y0, geo.x1, geo.y1); gl.addColorStop(0, 'rgba(255,255,255,0.05)'); gl.addColorStop(1, 'rgba(0,0,0,0.12)');
      g.fillStyle = gl; g.fill(P);
      const H = HATCH[h];
      const pats = (alphaHex: string) => (H.cross ? [H.a, H.a + Math.PI / 2] : [H.a]).map(a => {
        const p = g.createPattern(hatchTile(HI[h] + alphaHex, Math.max(1, 0.9 * de), gap), 'repeat')!;
        p.setTransform(new DOMMatrix().scaleSelf(1 / sc, 1 / sc).rotateSelf(((a - Math.PI / 2) * 180) / Math.PI));
        return p;
      });
      // the whole field faintly; the band along the wall strongly: the wall stroked with the hatch, clipped inside
      for (const p of pats(political ? '12' : '0a')) { g.fillStyle = p; g.fill(P); }
      g.save(); g.clip(P);
      g.lineWidth = band * 2; g.lineJoin = 'round'; g.lineCap = 'round';
      for (const p of pats(political ? (H.cross ? '2a' : '3a') : '18')) { g.strokeStyle = p; g.stroke(E); }
      g.restore();
    }
    // ---- lenses and supply, under the walls
    if (C.lens === 'economy') for (const r of st.regions) {
      if (isLane(r) || r.poly.length < 3 || r.kind === 'void') continue;
      const o = C.owners[r.id];
      const d = o !== null && o !== undefined ? r.dev : 0, v = r.vein ? 1 : 0;
      if (d || v) { g.fillStyle = `rgba(255,200,110,${0.05 + 0.05 * d + 0.04 * v})`; g.fill(geo.regionPath.get(r.id)!); }
    }
    if (C.unsup) for (const rid of C.unsup) {
      const p = geo.regionPath.get(rid); if (!p) continue;
      g.fillStyle = 'rgba(0,0,0,0.4)'; g.fill(p);
    }
    if (C.cutOff) for (const rid of C.cutOff) {
      const p = geo.regionPath.get(rid); if (!p) continue;
      const pt = g.createPattern(hatchTile('rgba(239,213,154,0.42)', Math.max(1, 1.4 * de), 8 * de), 'repeat');
      if (pt) { pt.setTransform(new DOMMatrix().scaleSelf(1 / sc, 1 / sc).rotateSelf(-45)); g.fillStyle = pt; g.fill(p); }
      g.save(); g.setLineDash([7 * u, 5 * u]); g.strokeStyle = 'rgba(239,213,154,0.7)'; g.lineWidth = 1.4 * u; g.stroke(p); g.restore();
    }
    // ---- asteroid fields: bronze granules lit from the lamp
    if (geo.rocks.length) {
      const rk = Math.max(1, Math.sqrt(Math.max(1, zr / 105)));
      g.fillStyle = 'rgba(0,0,0,0.5)';
      const rs = rect ? geo.rocks.filter(q => q.x > rect.x0 - 10 && q.x < rect.x1 + 10 && q.y > rect.y0 - 10 && q.y < rect.y1 + 10) : geo.rocks;
      g.beginPath(); for (const q of rs) { const r = q.r * 0.45 * rk * u; g.moveTo(q.x + r + 0.6 * u, q.y + 0.9 * u); g.arc(q.x + 0.6 * u, q.y + 0.9 * u, r, 0, TAU); } g.fill();
      g.fillStyle = 'rgba(150,118,66,0.45)';
      g.beginPath(); for (const q of rs) { const r = q.r * 0.45 * rk * u; g.moveTo(q.x + r, q.y); g.arc(q.x, q.y, r, 0, TAU); } g.fill();
    }
    // ---- engraved seams between regions
    g.lineJoin = 'round';
    g.lineWidth = 0.9 * u; g.strokeStyle = 'rgba(150,120,70,0.16)'; g.stroke(geo.seams);
    // ---- the walls: antique bronze in a cut groove, the house's lifted enamel catching inside
    // (every groove first, then every wall: a neighbour's groove never cuts into a wall already laid)
    for (const { P, E } of houses.values()) { g.save(); g.clip(P); g.lineWidth = 6 * u; g.strokeStyle = 'rgba(2,2,4,0.75)'; g.lineCap = 'round'; g.stroke(E); g.restore(); }
    g.lineCap = 'round';
    for (const { E } of houses.values()) { g.lineWidth = 2.4 * u; g.strokeStyle = BRONZE; g.stroke(E); }
    for (const { h, P, E } of houses.values()) { g.save(); g.clip(P); g.translate(-0.9 * u, -1.2 * u); g.lineWidth = 0.9 * u; g.strokeStyle = HI[h]; g.globalAlpha = 0.65; g.stroke(E); g.restore(); }
    // ---- resting hyperlanes: a quiet inlaid gold wire (fogged ends: dotted)
    g.lineCap = 'round';
    for (const L of C.bare !== undefined ? [] : geo.lanes) {
      const fog = L.ids.length > 1 && (C.fogged.has(L.ids[0]) || C.fogged.has(L.ids[L.ids.length - 1]));
      g.beginPath(); L.pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      if (fog) g.setLineDash([2 * u, 4 * u]);
      g.lineWidth = 2.8 * u; g.strokeStyle = 'rgba(2,2,4,0.45)'; g.stroke();
      g.lineWidth = 1 * u; g.strokeStyle = political ? 'rgba(214,170,90,0.42)' : 'rgba(214,170,90,0.28)'; g.stroke();
      g.setLineDash([]);
    }
    if (W.d > 0.05 && C.bare === undefined) {
      g.fillStyle = `rgba(184,149,90,${(0.45 * W.d).toFixed(3)})`;
      g.beginPath();
      for (const r of st.regions) if (isLane(r)) { g.moveTo(r.site.x + 1.6 * u, r.site.y); g.arc(r.site.x, r.site.y, 1.6 * u, 0, TAU); }
      g.fill();
    }
    // ---- fog of war: the colour goes, the value stays (the hatch still tells the house)
    if (C.fogged.size) {
      g.save();
      g.globalCompositeOperation = 'saturation';
      g.fillStyle = 'rgba(128,128,128,0.82)';
      for (const rid of C.fogged) { const p = geo.regionPath.get(rid); if (p) g.fill(p); }
      g.restore();
    }
    // ---- the bezel: a polished gold band round the dial, its degree scale engraved outside
    if (!rim) return;
    const bw = Math.max(4 * u, Math.min(16 * u, 9));
    const gd = gold(g, geo.x0, geo.y0, geo.x1, geo.y1);
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.lineWidth = bw + 3 * u; g.strokeStyle = '#1a1206'; g.stroke(geo.outerPath);
    g.lineWidth = bw; g.strokeStyle = gd; g.stroke(geo.outerPath);
    g.lineWidth = 0.9 * u; g.strokeStyle = 'rgba(60,36,6,0.9)'; g.stroke(geo.outerPath);
    const step = Math.max(14 * u, 22);
    g.strokeStyle = 'rgba(232,190,110,0.78)';
    let acc = 0, n = 0;
    const ticks = new Path2D(), big = new Path2D();
    for (const e of geo.outer) {
      const L = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
      for (; acc < L; acc += step) {
        const t = acc / L, x = e.a.x + (e.b.x - e.a.x) * t, y = e.a.y + (e.b.y - e.a.y) * t;
        const long = n++ % 5 === 0, o0 = bw / 2 + 2.5 * u, o1 = o0 + (long ? 6 : 2.5) * u;
        const P = long ? big : ticks;
        P.moveTo(x + e.nx * o0, y + e.ny * o0); P.lineTo(x + e.nx * o1, y + e.ny * o1);
      }
      acc -= L;
    }
    g.lineWidth = 0.8 * u; g.stroke(ticks); g.lineWidth = 1.4 * u; g.stroke(big);
  }

}
export type { Geo };
