// Procedural ship miniatures. Every hull is built from a handful of "modelled" parts (bevelled plates, pyramid
// spires, domes, turrets, engine bells) and painted like a tabletop mini: base coat with a lamp gradient, black-lined
// recesses, edge highlights on the edges that face the lamp, metallic trim, glowing ports and engines.
// Sprites are baked per class × house × angle bucket (32) × size bucket (4 per octave) and drawn rotated by the
// small residual angle, so lighting stays fixed to the table while ships turn smoothly.
import { type RGB, LIGHT, LIGHT3, TAU, css, lit, shade, mix, canvas, SpriteCache, sizeBucket, rand } from './util.ts';
import { type Scheme, type Faction, scheme, factionOf } from './palette.ts';

type V = [number, number];
type Mat = 'hull' | 'hull2' | 'trim' | 'dark' | 'accent' | 'team' | 'gun';
type Op =
  | { t: 'poly'; pts: V[]; mat: Mat; bevel?: number; lines?: [V, V][]; edge?: Mat; ew?: number; round?: boolean; minL?: number }
  | { t: 'pyr'; x: number; y: number; w: number; h: number; mat: Mat; tip?: number }
  | { t: 'dome'; x: number; y: number; r: number; mat: Mat; glass?: boolean }
  | { t: 'turret'; x: number; y: number; r: number; mat: Mat; barrels?: number; dir?: number }
  | { t: 'eng'; x: number; y: number; r: number }
  | { t: 'win'; pts: V[]; r?: number }
  | { t: 'stripe'; a: V; b: V; w: number; mat: Mat }
  | { t: 'ports'; a: V; b: V; n: number; s: number };
export interface Design { ops: Op[]; engines: V[]; guns: V[]; sil: V[][] }

const CLASSES = ['scout', 'corvette', 'frigate', 'bombard', 'cruiser', 'dread'];
const ci = (cls: string) => Math.max(0, CLASSES.indexOf(cls) < 0 ? 2 : CLASSES.indexOf(cls));

/** Right half (x ≥ 0) from nose to tail → full symmetric polygon. */
function sym(half: V[]): V[] {
  const out: V[] = half.map(p => [p[0], p[1]]);
  for (let i = half.length - 1; i >= 0; i--) if (half[i][0] > 1e-6) out.push([-half[i][0], half[i][1]]);
  return out;
}
const mirX = (pts: V[]): V[] => pts.map(p => [-p[0], p[1]] as V).reverse();
const sx = (pts: V[], k: number): V[] => pts.map(p => [p[0] * k, p[1]] as V);
const rect = (x0: number, y0: number, x1: number, y1: number): V[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
function inPoly(p: V, poly: V[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c; }
  return c;
}
/** Mirrored pairs of little raised blocks (vents, hatches, sensor housings) scattered over a hull: only at sizes
 *  where they can be seen. */
function greebles(ops: Op[], hull: V[], n: number, seed: number, mat: Mat = 'hull2', y0 = -0.3, y1 = 0.42) {
  let s = seed;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  let placed = 0;
  for (let i = 0; i < n * 8 && placed < n; i++) {
    const w = 0.018 + r() * 0.03, h = 0.02 + r() * 0.045;
    const x = 0.02 + r() * 0.12, y = y0 + r() * (y1 - y0);
    const box = rect(x, y, x + w, y + h);
    if (!box.every(p => inPoly(p, hull))) continue;
    placed++;
    const m: Mat = r() < 0.3 ? 'gun' : mat;
    ops.push({ t: 'poly', pts: box, mat: m, bevel: 0.006, minL: 44, round: false }, { t: 'poly', pts: mirX(box), mat: m, bevel: 0.006, minL: 44, round: false });
  }
}

// ================================================================== designs
function azure(k: number): Design {
  const ops: Op[] = [], engines: V[] = [], guns: V[] = [], sil: V[][] = [];
  const wf = [0.78, 0.86, 1, 1.35, 1.08, 1.22][k];
  const ws = [0.75, 0.95, 1, 0.8, 1.1, 1.25][k];
  // swept wings (under the hull)
  const wing: V[] = [[0.07, -0.02], [0.3 * ws, 0.2], [0.36 * ws, 0.33], [0.32 * ws, 0.36], [0.08, 0.3]];
  ops.push({ t: 'poly', pts: wing, mat: 'hull2', bevel: 0.022, edge: 'accent', ew: 0.018 }, { t: 'poly', pts: mirX(wing), mat: 'hull2', bevel: 0.022, edge: 'accent', ew: 0.018 });
  sil.push(wing, mirX(wing));
  if (k >= 4) {
    // forward canards + outrigger nacelles
    const can: V[] = [[0.06, -0.28], [0.2 * ws, -0.16], [0.21 * ws, -0.1], [0.07, -0.12]];
    ops.push({ t: 'poly', pts: can, mat: 'hull2', bevel: 0.018 }, { t: 'poly', pts: mirX(can), mat: 'hull2', bevel: 0.018 });
    sil.push(can, mirX(can));
    for (const s of [1, -1]) {
      const x = s * 0.25 * ws;
      const nac = sym([[0, -0.12], [0.03, -0.08], [0.035, 0.38], [0.025, 0.44]]).map(p => [p[0] + x, p[1]] as V);
      ops.push({ t: 'poly', pts: nac, mat: 'trim', bevel: 0.012, lines: [[[x - 0.03, 0.1], [x + 0.03, 0.1]]] });
      sil.push(nac);
      ops.push({ t: 'eng', x, y: 0.44, r: 0.022 }); engines.push([x, 0.46]);
    }
  }
  const hull = sx(sym([[0, -0.5], [0.04, -0.4], [0.08, -0.16], [0.1, 0.1], [0.095, 0.36], [0.07, 0.48]]), wf);
  sil.push(hull);
  ops.push({ t: 'poly', pts: hull, mat: 'hull', bevel: 0.03, lines: [[[-0.08 * wf, -0.05], [0.08 * wf, -0.05]], [[-0.09 * wf, 0.24], [0.09 * wf, 0.24]]] });
  greebles(ops, hull, 2 + k, 101 + k * 7);
  // accent stripe + silver spine
  ops.push({ t: 'stripe', a: [0, -0.42], b: [0, 0.4], w: 0.05 * wf, mat: 'accent' });
  ops.push({ t: 'stripe', a: [0, -0.4], b: [0, 0.38], w: 0.014, mat: 'trim' });
  if (k === 3) {
    // the bombard: a spinal rail-cannon running out past the nose
    ops.push({ t: 'poly', pts: rect(-0.028, -0.58, 0.028, -0.1), mat: 'dark', bevel: 0.01 });
    ops.push({ t: 'poly', pts: rect(-0.04, -0.2, 0.04, 0.0), mat: 'trim', bevel: 0.012 });
    guns.push([0, -0.58]);
    sil.push(rect(-0.028, -0.58, 0.028, -0.1));
  }
  // turrets along the spine
  const tur = [0, 0, 1, 1, 2, 3][k];
  for (let i = 0; i < tur; i++) { const y = -0.28 + i * 0.13; ops.push({ t: 'turret', x: 0, y, r: 0.04, mat: 'gun', barrels: 2 }); guns.push([0, y]); }
  if (k === 5) {
    ops.push({ t: 'poly', pts: sym([[0, 0.02], [0.07, 0.06], [0.08, 0.24], [0, 0.28]]), mat: 'hull2', bevel: 0.025 });
  }
  ops.push({ t: 'dome', x: 0, y: k === 5 ? 0.14 : 0.16, r: k >= 4 ? 0.055 : 0.045, mat: 'dark', glass: true });
  ops.push({ t: 'win', pts: [[0.055 * wf, 0.02], [-0.055 * wf, 0.02], [0.06 * wf, 0.1], [-0.06 * wf, 0.1]] });
  const ne = k >= 4 ? 3 : 2;
  for (let i = 0; i < ne; i++) { const x = (i - (ne - 1) / 2) * 0.05 * wf; ops.push({ t: 'eng', x, y: 0.47, r: 0.024 }); engines.push([x, 0.49]); }
  if (!guns.length) guns.push([0, -0.45]);
  return { ops, engines, guns, sil };
}

function crimson(k: number): Design {
  const ops: Op[] = [], engines: V[] = [], guns: V[] = [], sil: V[][] = [];
  const wf = [0.78, 0.86, 1, 1.25, 1.05, 1.15][k];
  const W = 0.12 * wf;
  // broadside batteries (buttresses) along the flanks, under the hull
  const nb = [0, 1, 3, 2, 4, 6][k];
  for (let i = 0; i < nb; i++) {
    const y = -0.18 + (i + 0.5) * (0.5 / Math.max(1, nb)) - 0.03;
    for (const s of [1, -1]) {
      const b: V[] = s > 0 ? [[W - 0.01, y - 0.035], [W + 0.055, y - 0.02], [W + 0.055, y + 0.035], [W - 0.01, y + 0.045]] : mirX([[W - 0.01, y - 0.035], [W + 0.055, y - 0.02], [W + 0.055, y + 0.035], [W - 0.01, y + 0.045]]);
      ops.push({ t: 'poly', pts: b, mat: 'hull2', bevel: 0.014, edge: 'trim', ew: 0.01 });
      sil.push(b);
      guns.push([s * (W + 0.055), y + 0.008]);
    }
  }
  // the long cathedral hull
  const hull = sym([[0, -0.44], [W * 0.72, -0.36], [W, -0.28], [W, 0.38], [W * 0.85, 0.47], [W * 0.6, 0.5]]);
  sil.push(hull);
  const lines: [V, V][] = [];
  for (let y = -0.18; y < 0.4; y += 0.11) lines.push([[-W, y], [W, y]]);
  ops.push({ t: 'poly', pts: hull, mat: 'hull', bevel: 0.026, lines });
  greebles(ops, hull, 2 + k, 211 + k * 5, 'hull2', -0.22, 0.08);
  // armoured prow: the ram
  const prow = sym([[0, -0.5], [W * 0.62, -0.4], [W * 1.02, -0.27], [W * 0.5, -0.24], [0, -0.3]]);
  ops.push({ t: 'poly', pts: prow, mat: 'trim', bevel: 0.03 });
  sil.push(prow);
  // gun decks: rows of lit ports along the flanks
  if (k >= 1) {
    ops.push({ t: 'ports', a: [W * 0.78, -0.2], b: [W * 0.78, 0.34], n: 3 + k * 2, s: 0.014 });
    ops.push({ t: 'ports', a: [-W * 0.78, -0.2], b: [-W * 0.78, 0.34], n: 3 + k * 2, s: 0.014 });
  }
  ops.push({ t: 'stripe', a: [0, -0.24], b: [0, 0.4], w: 0.03 * wf, mat: 'accent' });
  // dorsal lance turrets
  const tur = [0, 0, 1, 0, 2, 2][k];
  for (let i = 0; i < tur; i++) { const y = -0.17 + i * 0.12; ops.push({ t: 'turret', x: 0, y, r: 0.038, mat: 'gun', barrels: 1 }); guns.push([0, y]); }
  if (k === 3) {
    // siege mortars: two fat barrels
    for (const s of [1, -1]) { ops.push({ t: 'turret', x: s * 0.05, y: -0.16, r: 0.05, mat: 'gun', barrels: 1 }); guns.push([s * 0.05, -0.2]); }
  }
  // the cathedral: stepped towers and spires astern
  const ty = k === 5 ? 0.2 : 0.22;
  ops.push({ t: 'poly', pts: rect(-W * 0.62, ty - 0.12, W * 0.62, ty + 0.14), mat: 'hull2', bevel: 0.03, edge: 'trim', ew: 0.008 });
  ops.push({ t: 'win', pts: [[-W * 0.35, ty - 0.08], [W * 0.35, ty - 0.08], [-W * 0.35, ty], [W * 0.35, ty], [-W * 0.35, ty + 0.08], [W * 0.35, ty + 0.08]], r: 0.009 });
  ops.push({ t: 'pyr', x: 0, y: ty + 0.02, w: W * 0.8, h: 0.13, mat: 'hull', tip: 1 });
  if (k >= 2) ops.push({ t: 'pyr', x: 0, y: ty + 0.02, w: W * 0.38, h: 0.06, mat: 'trim' });
  if (k === 5) {
    ops.push({ t: 'poly', pts: rect(-W * 0.5, -0.08, W * 0.5, 0.06), mat: 'hull2', bevel: 0.025 });
    ops.push({ t: 'pyr', x: 0, y: -0.01, w: W * 0.6, h: 0.1, mat: 'hull' });
    for (const s of [1, -1]) ops.push({ t: 'pyr', x: s * W * 0.6, y: ty + 0.12, w: 0.035, h: 0.05, mat: 'trim' });
  }
  // engine block
  ops.push({ t: 'poly', pts: rect(-W * 0.8, 0.43, W * 0.8, 0.52), mat: 'dark', bevel: 0.012 });
  const ne = k >= 4 ? 4 : k >= 2 ? 3 : 2;
  for (let i = 0; i < ne; i++) { const x = (i - (ne - 1) / 2) * (W * 1.4 / ne); ops.push({ t: 'eng', x, y: 0.5, r: 0.024 }); engines.push([x, 0.52]); }
  return { ops, engines, guns, sil };
}

function gilded(k: number): Design {
  const ops: Op[] = [], engines: V[] = [], guns: V[] = [], sil: V[][] = [];
  const wf = [0.78, 0.88, 1, 1.25, 1.1, 1.2][k];
  const ws = [0.7, 0.85, 1, 0.9, 1.15, 1.3][k];
  // crescent sails curling forward around the body
  const sail: V[] = [[0.08, 0.02], [0.2 * ws, -0.14], [0.3 * ws, -0.28], [0.36 * ws, -0.16], [0.33 * ws, 0.1], [0.24 * ws, 0.26], [0.1, 0.3]];
  const fil: [V, V][] = [[[0.12, 0.0], [0.3 * ws, -0.2]], [[0.12, 0.12], [0.32 * ws, 0.02]], [[0.12, 0.22], [0.26 * ws, 0.18]]];
  const filM = fil.map(([a, b]) => [[-a[0], a[1]], [-b[0], b[1]]] as [V, V]);
  ops.push({ t: 'poly', pts: sail, mat: 'hull2', bevel: 0.03, edge: 'trim', ew: 0.016, lines: fil, round: false }, { t: 'poly', pts: mirX(sail), mat: 'hull2', bevel: 0.03, edge: 'trim', ew: 0.016, lines: filM, round: false });
  sil.push(sail, mirX(sail));
  if (k >= 4) for (const s of [1, -1]) { ops.push({ t: 'pyr', x: s * 0.33 * ws, y: -0.12, w: 0.05, h: 0.07, mat: 'trim' }); }
  const body = sx(sym([[0, -0.44], [0.06, -0.38], [0.1, -0.22], [0.12, 0.08], [0.1, 0.34], [0.05, 0.48]]), wf);
  sil.push(body);
  ops.push({ t: 'poly', pts: body, mat: 'hull', bevel: 0.035, lines: [[[-0.1 * wf, -0.1], [0.1 * wf, -0.1]], [[-0.11 * wf, 0.2], [0.11 * wf, 0.2]]] });
  greebles(ops, body, 1 + k, 307 + k * 3, 'trim');
  ops.push({ t: 'stripe', a: [0, -0.36], b: [0, 0.42], w: 0.045 * wf, mat: 'accent' });
  // the crown prow: three gilded tines
  const tine = (x: number, y0: number, h: number): V[] => [[x, y0 - h], [x + 0.022, y0], [x - 0.022, y0]];
  for (const [x, h] of [[0, 0.1], [0.045 * wf, 0.065], [-0.045 * wf, 0.065]] as V[]) { const t = tine(x, -0.39, h); ops.push({ t: 'poly', pts: t, mat: 'trim', bevel: 0.008 }); sil.push(t); }
  // spires along the spine
  const ns = [1, 1, 2, 2, 3, 5][k];
  for (let i = 0; i < ns; i++) { const y = -0.2 + i * (0.5 / ns); ops.push({ t: 'pyr', x: 0, y, w: 0.06 * wf, h: 0.075, mat: 'trim', tip: 1 }); }
  if (k === 3) { ops.push({ t: 'dome', x: 0, y: 0.08, r: 0.075, mat: 'trim' }); ops.push({ t: 'turret', x: 0, y: -0.27, r: 0.05, mat: 'gun', barrels: 1 }); guns.push([0, -0.3]); }
  const tur = [0, 1, 1, 0, 2, 2][k];
  for (let i = 0; i < tur; i++) for (const s of [1, -1]) { const p: V = [s * 0.075 * wf, -0.06 + i * 0.16]; ops.push({ t: 'turret', x: p[0], y: p[1], r: 0.03, mat: 'gun', barrels: 1 }); guns.push(p); }
  if (k === 5) { for (const s of [1, -1]) ops.push({ t: 'pyr', x: s * 0.07 * wf, y: 0.26, w: 0.045, h: 0.06, mat: 'trim' }); ops.push({ t: 'dome', x: 0, y: 0.32, r: 0.05, mat: 'accent' }); }
  ops.push({ t: 'win', pts: [[0.07 * wf, 0.0], [-0.07 * wf, 0.0], [0.08 * wf, 0.1], [-0.08 * wf, 0.1], [0.07 * wf, 0.2], [-0.07 * wf, 0.2]] });
  const ne = k >= 4 ? 3 : 2;
  for (let i = 0; i < ne; i++) { const x = (i - (ne - 1) / 2) * 0.05 * wf; ops.push({ t: 'eng', x, y: 0.47, r: 0.024 }); engines.push([x, 0.49]); }
  if (!guns.length) guns.push([0, -0.44]);
  return { ops, engines, guns, sil };
}

function warden(k: number): Design {
  const ops: Op[] = [], engines: V[] = [], guns: V[] = [], sil: V[][] = [];
  const wf = [0.8, 0.9, 1, 1.2, 1.1, 1.3][k];
  const shard = sx(sym([[0, -0.5], [0.1, -0.2], [0.2, 0.05], [0.13, 0.2], [0.16, 0.42], [0.04, 0.5]]), wf);
  sil.push(shard);
  ops.push({ t: 'poly', pts: shard, mat: 'hull', bevel: 0.05, edge: 'accent', ew: 0.01 });
  ops.push({ t: 'pyr', x: 0, y: -0.05, w: 0.12 * wf, h: 0.32, mat: 'hull2', tip: 1 });
  for (const s of [1, -1]) { ops.push({ t: 'pyr', x: s * 0.12 * wf, y: 0.12, w: 0.06, h: 0.12, mat: 'accent' }); }
  if (k >= 4) ops.push({ t: 'pyr', x: 0, y: 0.3, w: 0.09, h: 0.12, mat: 'accent' });
  ops.push({ t: 'stripe', a: [0, -0.44], b: [0, 0.44], w: 0.012, mat: 'accent' });
  for (const x of [-0.05, 0.05]) { ops.push({ t: 'eng', x: x * wf, y: 0.47, r: 0.022 }); engines.push([x * wf, 0.49]); }
  guns.push([0, -0.45]);
  return { ops, engines, guns, sil };
}

const designCache = new Map<string, Design>();
export function design(cls: string, f: Faction): Design {
  const key = `${f}|${cls}`;
  let d = designCache.get(key);
  if (!d) {
    const k = ci(cls);
    d = f === 'crimson' ? crimson(k) : f === 'gilded' ? gilded(k) : f === 'warden' ? warden(k) : azure(k);
    designCache.set(key, d);
  }
  return d;
}

// ================================================================== painting
interface Xf { cx: number; cy: number; c: number; s: number; L: number }
const tp = (X: Xf, p: V): V => [X.cx + (p[0] * X.c - p[1] * X.s) * X.L, X.cy + (p[0] * X.s + p[1] * X.c) * X.L];

function matColor(S: Scheme, m: Mat): RGB {
  switch (m) { case 'gun': return mix(S.trim, S.dark, 0.62); case 'hull': return S.hull; case 'hull2': return S.hull2; case 'trim': return S.trim; case 'dark': return S.dark; case 'accent': return S.accent; default: return S.team; }
}
const metallic = (m: Mat) => m === 'trim';

function polyPath(g: CanvasRenderingContext2D, pts: V[]) { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); }
function area(pts: V[]) { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
function normals(pts: V[]): V[] {
  const s = area(pts) >= 0 ? 1 : -1;
  return pts.map((p, i) => { const q = pts[(i + 1) % pts.length]; const ex = q[0] - p[0], ey = q[1] - p[1], l = Math.hypot(ex, ey) || 1; return [s * ey / l, -s * ex / l] as V; });
}
function inset(pts: V[], ns: V[], d: number): V[] {
  return pts.map((p, i) => {
    const a = ns[(i - 1 + pts.length) % pts.length], b = ns[i];
    const mx = a[0] + b[0], my = a[1] + b[1];
    const k = 1 + a[0] * b[0] + a[1] * b[1];
    let ox = k > 0.15 ? mx / k : mx / 0.15, oy = k > 0.15 ? my / k : my / 0.15;
    const m = Math.hypot(ox, oy);
    if (m > 2.5) { ox *= 2.5 / m; oy *= 2.5 / m; }
    return [p[0] - ox * d, p[1] - oy * d] as V;
  });
}

/** A bevelled plate: sloped facets lit by their normals, a flat top with a lamp gradient, black-lining, edge highlights. */
let curLat: V | null = null;
function plate(g: CanvasRenderingContext2D, P: V[], col: RGB, bevelPx: number, shiny: boolean, px: number, lines?: [V, V][], edge?: RGB, ew = 0, round = false) {
  const ns = normals(P);
  const Q = bevelPx > 0.6 ? inset(P, ns, bevelPx) : P;
  // black-lining: a dark outline that reads as the recess around the part
  polyPath(g, P); g.fillStyle = css(shade(col, -0.75), 0.9); g.fill();
  g.lineJoin = 'round'; g.strokeStyle = 'rgba(4,4,10,0.75)'; g.lineWidth = Math.max(0.8, px * 0.9); g.stroke();
  const amp = shiny ? 0.62 : 0.42;
  if (Q !== P) for (let i = 0; i < P.length; i++) {
    const j = (i + 1) % P.length;
    const k = ns[i][0] * LIGHT.x + ns[i][1] * LIGHT.y;
    g.beginPath(); g.moveTo(P[i][0], P[i][1]); g.lineTo(P[j][0], P[j][1]); g.lineTo(Q[j][0], Q[j][1]); g.lineTo(Q[i][0], Q[i][1]); g.closePath();
    g.fillStyle = css(lit(col, k * amp - 0.12));
    g.fill();
  }
  // top face with a lamp gradient across its extent
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of Q) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, r = Math.max(2, Math.hypot(x1 - x0, y1 - y0) / 2);
  let gr: CanvasGradient;
  if (curLat && round) {
    // a rounded hull: shade across the ship like a cylinder lit by the lamp (lit flank, dark far flank)
    let w = 0;
    for (const q of Q) w = Math.max(w, Math.abs((q[0] - cx) * curLat[0] + (q[1] - cy) * curLat[1]));
    w = Math.max(1, w);
    gr = g.createLinearGradient(cx - curLat[0] * w, cy - curLat[1] * w, cx + curLat[0] * w, cy + curLat[1] * w);
    const lx = curLat[0] * LIGHT3[0] + curLat[1] * LIGHT3[1];
    for (let i = 0; i <= 8; i++) {
      const u = (i / 8) * 2 - 1;
      const d = u * lx + Math.sqrt(1 - u * u) * LIGHT3[2];
      gr.addColorStop(i / 8, css(lit(col, (d - 0.55) * (shiny ? 1.3 : 0.95) + (Math.abs(u) > 0.9 ? -0.15 : 0))));
    }
  } else gr = g.createLinearGradient(cx + LIGHT.x * r, cy + LIGHT.y * r, cx - LIGHT.x * r, cy - LIGHT.y * r);
  if (curLat && round) { /* stops set above */ } else if (shiny) { gr.addColorStop(0, css(lit(col, 0.55))); gr.addColorStop(0.35, css(lit(col, 0.05))); gr.addColorStop(0.6, css(lit(col, -0.3))); gr.addColorStop(1, css(lit(col, 0.1))); }
  else { gr.addColorStop(0, css(lit(col, 0.2))); gr.addColorStop(1, css(lit(col, -0.28))); }
  polyPath(g, Q); g.fillStyle = gr; g.fill();
  // panel lines: engraved (dark groove, lit lip)
  if (lines && px > 0.5) {
    g.save(); polyPath(g, Q); g.clip();
    g.lineWidth = Math.max(0.6, px * 0.55);
    for (const [a, b] of lines) {
      g.strokeStyle = css(shade(col, -0.6), 0.75); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
      g.strokeStyle = css(lit(col, 0.45), 0.35); g.beginPath(); g.moveTo(a[0] - LIGHT.x * px * 0.7, a[1] - LIGHT.y * px * 0.7); g.lineTo(b[0] - LIGHT.x * px * 0.7, b[1] - LIGHT.y * px * 0.7); g.stroke();
    }
    g.restore();
  }
  // trim edging (painted metal band around the part)
  if (edge && ew > 0) { polyPath(g, Q); g.strokeStyle = css(lit(edge, 0.1)); g.lineWidth = ew; g.stroke(); }
  // edge highlights: the hardest edges that face the lamp get a bright line (the mini painter's signature)
  g.lineCap = 'round';
  for (let i = 0; i < P.length; i++) {
    const k = ns[i][0] * LIGHT.x + ns[i][1] * LIGHT.y;
    if (k < 0.15) continue;
    const j = (i + 1) % P.length;
    g.strokeStyle = css(lit(col, shiny ? 0.85 : 0.65), Math.min(1, k * (shiny ? 1.1 : 0.85)));
    g.lineWidth = Math.max(0.6, px * 0.7);
    g.beginPath(); g.moveTo(P[i][0], P[i][1]); g.lineTo(P[j][0], P[j][1]); g.stroke();
  }
}

/** A four-facet pyramid (a spire or tower seen from above). */
function pyramid(g: CanvasRenderingContext2D, X: Xf, x: number, y: number, w: number, h: number, col: RGB, shiny: boolean, tip: boolean) {
  const c = tp(X, [x, y]);
  const corners: V[] = [tp(X, [x - w / 2, y - h / 2]), tp(X, [x + w / 2, y - h / 2]), tp(X, [x + w / 2, y + h / 2]), tp(X, [x - w / 2, y + h / 2])];
  const ns = normals(corners);
  polyPath(g, corners); g.fillStyle = 'rgba(4,4,10,0.8)'; g.fill();
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const k = ns[i][0] * LIGHT.x + ns[i][1] * LIGHT.y;
    g.beginPath(); g.moveTo(corners[i][0], corners[i][1]); g.lineTo(corners[j][0], corners[j][1]); g.lineTo(c[0], c[1]); g.closePath();
    g.fillStyle = css(lit(col, k * (shiny ? 0.75 : 0.55) + (shiny ? 0.05 : -0.05)));
    g.fill();
  }
  // ridge highlight toward the lamp
  g.strokeStyle = css(lit(col, 0.8), 0.6); g.lineWidth = Math.max(0.5, X.L * 0.006);
  let best = 0, bd = -Infinity;
  for (let i = 0; i < 4; i++) { const d = (corners[i][0] - c[0]) * LIGHT.x + (corners[i][1] - c[1]) * LIGHT.y; if (d > bd) { bd = d; best = i; } }
  g.beginPath(); g.moveTo(c[0], c[1]); g.lineTo(corners[best][0], corners[best][1]); g.stroke();
  if (tip) { g.fillStyle = 'rgba(255,250,235,0.9)'; g.beginPath(); g.arc(c[0], c[1], Math.max(0.5, X.L * 0.008), 0, TAU); g.fill(); }
}

function dome(g: CanvasRenderingContext2D, X: Xf, x: number, y: number, r: number, col: RGB, glass: boolean) {
  const c = tp(X, [x, y]), R = r * X.L;
  g.beginPath(); g.arc(c[0], c[1], R + Math.max(0.6, X.L * 0.006), 0, TAU); g.fillStyle = 'rgba(4,4,10,0.85)'; g.fill();
  const gr = g.createRadialGradient(c[0] + LIGHT.x * R * 0.45, c[1] + LIGHT.y * R * 0.45, R * 0.05, c[0], c[1], R);
  gr.addColorStop(0, css(lit(col, glass ? 0.75 : 0.6))); gr.addColorStop(0.45, css(lit(col, glass ? 0.0 : 0.05))); gr.addColorStop(1, css(lit(col, -0.45)));
  g.beginPath(); g.arc(c[0], c[1], R, 0, TAU); g.fillStyle = gr; g.fill();
  if (glass) { g.fillStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); g.ellipse(c[0] + LIGHT.x * R * 0.42, c[1] + LIGHT.y * R * 0.42, R * 0.28, R * 0.14, Math.atan2(LIGHT.y, LIGHT.x) + Math.PI / 2, 0, TAU); g.fill(); }
}

function paint(g: CanvasRenderingContext2D, d: Design, S: Scheme, X: Xf) {
  const px = 1; // device px per unit of line weight
  const L = X.L;
  curLat = [X.c, X.s];
  for (const op of d.ops) {
    switch (op.t) {
      case 'poly': {
        if (op.minL && L < op.minL) break;
        const P = op.pts.map(p => tp(X, p));
        plate(g, P, matColor(S, op.mat), (op.bevel ?? 0) * L, metallic(op.mat), px * Math.max(0.7, L / 60), op.lines?.map(([a, b]) => [tp(X, a), tp(X, b)] as [V, V]), op.edge ? matColor(S, op.edge) : undefined, (op.ew ?? 0) * L, op.round ?? (op.mat === 'hull' || op.mat === 'trim'));
        break;
      }
      case 'pyr': pyramid(g, X, op.x, op.y, op.w, op.h, matColor(S, op.mat), metallic(op.mat), !!op.tip); break;
      case 'dome': dome(g, X, op.x, op.y, op.r, matColor(S, op.mat), !!op.glass); break;
      case 'turret': {
        const c = tp(X, [op.x, op.y]);
        const col = matColor(S, op.mat);
        const n = op.barrels ?? 1;
        g.lineCap = 'round';
        for (let i = 0; i < n; i++) {
          const ox = (i - (n - 1) / 2) * op.r * 0.7;
          const a = tp(X, [op.x + ox, op.y]), b = tp(X, [op.x + ox, op.y - op.r * 2.1]);
          g.strokeStyle = 'rgba(4,4,10,0.9)'; g.lineWidth = Math.max(1, op.r * L * 0.55); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
          g.strokeStyle = css(lit(col, 0.15)); g.lineWidth = Math.max(0.6, op.r * L * 0.3); g.stroke();
        }
        void c;
        dome(g, X, op.x, op.y, op.r * 0.8, col, false);
        break;
      }
      case 'eng': {
        const c = tp(X, [op.x, op.y]), R = op.r * L;
        g.beginPath(); g.arc(c[0], c[1], R * 1.25, 0, TAU); g.fillStyle = css(lit(S.trim, -0.3)); g.fill();
        const gr = g.createRadialGradient(c[0], c[1], 0, c[0], c[1], R);
        gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.45, css(S.engine)); gr.addColorStop(1, css(shade(S.engine, -0.5)));
        g.beginPath(); g.arc(c[0], c[1], R, 0, TAU); g.fillStyle = gr; g.fill();
        break;
      }
      case 'win': {
        const r = Math.max(0.55, (op.r ?? 0.008) * L);
        for (const p of op.pts) {
          const c = tp(X, p);
          g.fillStyle = css(S.window, 0.35); g.beginPath(); g.arc(c[0], c[1], r * 2.2, 0, TAU); g.fill();
          g.fillStyle = css(mix(S.window, [255, 255, 255], 0.5)); g.beginPath(); g.arc(c[0], c[1], r, 0, TAU); g.fill();
        }
        break;
      }
      case 'stripe': {
        const a = tp(X, op.a), b = tp(X, op.b);
        const col = matColor(S, op.mat);
        g.lineCap = 'butt';
        g.strokeStyle = css(lit(col, -0.1)); g.lineWidth = Math.max(0.6, op.w * L); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
        if (op.w * L > 2.2) { g.strokeStyle = css(lit(col, 0.45), 0.6); g.lineWidth = Math.max(0.5, op.w * L * 0.3); g.beginPath(); g.moveTo(a[0] - LIGHT.x * op.w * L * 0.25, a[1] - LIGHT.y * op.w * L * 0.25); g.lineTo(b[0] - LIGHT.x * op.w * L * 0.25, b[1] - LIGHT.y * op.w * L * 0.25); g.stroke(); }
        break;
      }
      case 'ports': {
        if (L < 26) break;
        for (let i = 0; i < op.n; i++) {
          const t = op.n > 1 ? i / (op.n - 1) : 0.5;
          const c = tp(X, [op.a[0] + (op.b[0] - op.a[0]) * t, op.a[1] + (op.b[1] - op.a[1]) * t]);
          const r = Math.max(0.6, op.s * L * 0.5);
          g.fillStyle = 'rgba(6,4,8,0.9)'; g.fillRect(c[0] - r, c[1] - r, r * 2, r * 2);
          g.fillStyle = css(S.window, 0.9); g.fillRect(c[0] - r * 0.5, c[1] - r * 0.5, r, r);
        }
        break;
      }
    }
  }
}

// ================================================================== sprites
export interface ShipSprite { img: HTMLCanvasElement; shadow: HTMLCanvasElement; size: number; L: number }
const cache = new SpriteCache<ShipSprite>(700);
export const ANGLE_BUCKETS = 32;

/** Bake one sprite: hull length L device px, heading a (radians, 0 = nose up / −y, clockwise). */
function bake(cls: string, owner: number, team: string, L: number, a: number): ShipSprite {
  const S = scheme(owner, team);
  const d = design(cls, S.faction);
  const size = Math.ceil(L * 1.4) + 4;
  const img = canvas(size, size);
  const g = img.getContext('2d')!;
  const X: Xf = { cx: size / 2, cy: size / 2, c: Math.cos(a), s: Math.sin(a), L };
  paint(g, d, S, X);
  // drybrush grain: the faint speckle of hand painting (only where it can be seen)
  if (L >= 40) {
    g.save(); g.globalCompositeOperation = 'source-atop';
    const r = rand(cls.length * 131 + owner * 7 + 3);
    const n = Math.round(L * L * 0.05);
    for (let i = 0; i < n; i++) { g.fillStyle = r() < 0.5 ? 'rgba(255,245,225,0.07)' : 'rgba(0,0,10,0.09)'; g.fillRect(r() * size, r() * size, 1, 1); }
    g.restore();
  }
  // shadow: the silhouette, blurred, cast on the mat (offset is applied when drawn)
  const shadow = canvas(size, size);
  const sg = shadow.getContext('2d')!;
  const blur = Math.max(1, L * 0.06);
  sg.shadowColor = 'rgba(0,0,6,0.85)'; sg.shadowBlur = blur; sg.shadowOffsetX = size * 4;
  sg.fillStyle = '#000';
  for (const p of d.sil) { sg.beginPath(); p.forEach((q, i) => { const v = tp(X, q); const x = v[0] - size * 4; if (i) sg.lineTo(x, v[1]); else sg.moveTo(x, v[1]); }); sg.closePath(); sg.fill(); }
  return { img, shadow, size, L };
}

export function shipSprite(cls: string, owner: number, team: string, lenDev: number, angle: number): { spr: ShipSprite; rot: number } {
  const step = TAU / ANGLE_BUCKETS;
  const b = ((Math.round(angle / step) % ANGLE_BUCKETS) + ANGLE_BUCKETS) % ANGLE_BUCKETS;
  const L = sizeBucket(lenDev);
  const spr = cache.get(`${cls}|${owner}|${team}|${L}|${b}`, () => bake(cls, owner, team, L, b * step));
  return { spr, rot: angle - Math.round(angle / step) * step };
}

export interface ShipDrawOpts {
  alpha?: number;
  /** cast shadow offset in ctx units (null = no shadow) */
  shadow?: { dx: number; dy: number; alpha?: number } | null;
  /** roll while turning: −1..1 (squashes the hull across) */
  bank?: number;
  /** engine plume intensity 0..1+ (dynamic glow behind the engine bells) */
  engine?: number;
  /** white hit flash 0..1 */
  flash?: number;
  /** darken (wrecks) 0..1 */
  char?: number;
}

/** Draw a miniature with its nose along `angle` (0 = up), centred on (x, y); `len` in ctx units, `lenDev` the same
 *  length in device pixels (picks the bake size). */
export function drawShip(g: CanvasRenderingContext2D, x: number, y: number, len: number, lenDev: number, cls: string, owner: number, team: string, angle: number, o: ShipDrawOpts = {}) {
  const { spr, rot } = shipSprite(cls, owner, team, lenDev, angle);
  const k = len / spr.L;
  const sz = spr.size * k;
  const a0 = g.globalAlpha;
  const alpha = o.alpha ?? 1;
  if (alpha <= 0.01) return;
  if (o.shadow) {
    g.globalAlpha = a0 * alpha * (o.shadow.alpha ?? 0.5);
    g.save(); g.translate(x + o.shadow.dx, y + o.shadow.dy); g.rotate(rot); g.drawImage(spr.shadow, -sz / 2, -sz / 2, sz, sz); g.restore();
  }
  if (o.engine && o.engine > 0.02) drawPlumes(g, x, y, len, cls, owner, team, angle, o.engine, alpha * a0);
  g.globalAlpha = a0 * alpha;
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  if (o.bank) { g.rotate(angle - rot); g.scale(1 - Math.min(0.45, Math.abs(o.bank) * 0.4), 1); g.rotate(-(angle - rot)); }
  g.drawImage(spr.img, -sz / 2, -sz / 2, sz, sz);
  if (o.char && o.char > 0) {
    // charring: the (soft) hull silhouette in black over the paint
    g.globalAlpha = a0 * alpha * Math.min(1, o.char) * 0.85;
    g.drawImage(spr.shadow, -sz / 2, -sz / 2, sz, sz);
  }
  if (o.flash && o.flash > 0) {
    g.globalAlpha = a0 * alpha * Math.min(1, o.flash);
    g.globalCompositeOperation = 'lighter';
    g.drawImage(spr.img, -sz / 2, -sz / 2, sz, sz);
  }
  g.restore();
  g.globalAlpha = a0;
}

/** Engine plumes: additive glow sprites behind each bell (moving ships burn brighter). */
export function drawPlumes(g: CanvasRenderingContext2D, x: number, y: number, len: number, cls: string, owner: number, team: string, angle: number, k: number, alpha = 1) {
  const S = scheme(owner, team);
  const d = design(cls, S.faction);
  const c = Math.cos(angle), s = Math.sin(angle);
  const prev = g.globalCompositeOperation, pa = g.globalAlpha;
  g.globalCompositeOperation = 'lighter';
  for (const e of d.engines) {
    const ex = x + (e[0] * c - e[1] * s) * len, ey = y + (e[0] * s + e[1] * c) * len;
    const r = len * (0.06 + 0.07 * Math.min(1.5, k));
    g.globalAlpha = alpha * Math.min(1, 0.45 + 0.4 * k);
    const spr = glowSprite(S.engine);
    g.drawImage(spr, ex - r, ey - r, r * 2, r * 2);
    if (k > 0.3) {
      // the plume streams aft
      const tl = len * 0.22 * Math.min(1.6, k);
      g.globalAlpha = alpha * 0.55 * Math.min(1, k);
      g.save(); g.translate(ex, ey); g.rotate(angle);
      g.drawImage(spr, -r * 0.55, 0, r * 1.1, tl);
      g.restore();
    }
  }
  g.globalCompositeOperation = prev; g.globalAlpha = pa;
}

const glowCache = new Map<string, HTMLCanvasElement>();
/** Soft additive glow sprite (64px), white-hot core fading through `col`. */
export function glowSprite(col: RGB | string, hot = 0.6): HTMLCanvasElement {
  const c = typeof col === 'string' ? col : css(col);
  const key = `${c}|${hot}`;
  let s = glowCache.get(key);
  if (!s) {
    s = canvas(64, 64);
    const g = s.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, `rgba(255,255,255,${hot})`); gr.addColorStop(0.18, c); gr.addColorStop(0.5, c.replace('rgb(', 'rgba(').replace(')', ',0.28)')); gr.addColorStop(1, 'rgba(0,0,0,0)');
    if (!c.startsWith('rgb(')) { gr.addColorStop(0.5, c); }
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    glowCache.set(key, s);
  }
  return s;
}

/** Where a ship's guns are, in ctx units, for weapon effects. */
export function gunPoints(cls: string, owner: number, team: string, x: number, y: number, len: number, angle: number): V[] {
  const d = design(cls, scheme(owner, team).faction);
  const c = Math.cos(angle), s = Math.sin(angle);
  return d.guns.map(e => [x + (e[0] * c - e[1] * s) * len, y + (e[0] * s + e[1] * c) * len] as V);
}

export { factionOf };
export const shipCacheSize = () => cache.size;
