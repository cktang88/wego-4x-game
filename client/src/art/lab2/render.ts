// Style lab renderer: one layout, three looks. Lays out the mock board (board.ts) for a camera exactly the way the
// game's map does (render/map.ts + mapmodel.ts: tier crossfade, star and token sizes, fleet slots beside the star,
// names under it, the per-zoom information budget of docs/UX-V2.md §2), and asks the direction's Style to paint
// each thing. Every indicator it draws also leaves a readability probe (kit.measure).
import {
  SYSTEMS, FLEETS, ROUTES, BATTLES, LANES, LOOPS, HOUSES, HOVER, SELECTED_SYS, YOU, HOUSE_NAME,
  laneKey, EMPIRE_AT, type House, type Sys, type Fleet, type Pt, type StarKind,
} from './board.ts';
import { type View, type Probe, sstep, loopsPath, TAU } from './kit.ts';

type G = CanvasRenderingContext2D;
export type NameKind = 'throne' | 'crown' | 'home' | 'colony';
export interface Style {
  id: 'A' | 'B' | 'C'; name: string; tagline: string;
  /** the room / table / plate behind everything, for the whole viewport */
  ground(g: G, v: View): void;
  territory(g: G, v: View, h: House, path: Path2D): void;
  lane(g: G, v: View, a: Pt, b: Pt, lit: number, fog: boolean): void;
  waypoint(g: G, v: View, x: number, y: number, lit: number): void;
  bodies(g: G, v: View, s: Sys, x: number, y: number, R: number, alpha: number): void;
  star(g: G, v: View, kind: StarKind, x: number, y: number, R: number, fog: boolean, seed: number): void;
  objective(g: G, v: View, x: number, y: number, R: number, throne: boolean, fog: boolean): void;
  contested(g: G, v: View, x: number, y: number, R: number, holder: House | null, kingly: boolean): void;
  occupied(g: G, v: View, x: number, y: number, R: number, by: House): void;
  tribute(g: G, v: View, x: number, y: number, R: number, to: House): void;
  label(g: G, v: View, text: string, x: number, y: number, fs: number, kind: NameKind, owner: House | null, fog: boolean): number;
  empireName(g: G, v: View, text: string, x: number, y: number, fs: number, h: House): void;
  garrison(g: G, v: View, n: number, x: number, y: number, fs: number): number;
  route(g: G, v: View, pts: Pt[], h: House, seize: boolean): void;
  reticle(g: G, v: View, x: number, y: number, R: number, h: House): void;
  tether(g: G, v: View, x0: number, y0: number, x1: number, y1: number, h: House): void;
  pip(g: G, v: View, x: number, y: number, ang: number, r: number, h: House, sel: boolean): void;
  counter(g: G, v: View, x: number, y: number, ang: number, r: number, h: House, sel: boolean): void;
  mini(g: G, v: View, x: number, y: number, ang: number, r: number, h: House, ships: string[], sel: boolean): void;
  stack(g: G, v: View, n: number, x: number, y: number, r: number, h: House): void;
  idle(g: G, v: View, x: number, y: number, r: number, phase: number): void;
  oos(g: G, v: View, x: number, y: number, r: number): void;
  strength(g: G, v: View, n: number, x: number, y: number): void;
  battle(g: G, v: View, x: number, y: number, D: number): void;
  /** one discharge at detail zoom, `k` 0..1 along its flight */
  shot(g: G, v: View, a: Pt, b: Pt, h: House, k: number): void;
  /** the lamp and the falloff, over the board */
  light(g: G, v: View): void;
}

/** Geometry every style agrees on (so probes land on the marks): the objective ring, the contested ring and the
 *  corner marks (occupied lower right, tribute lower left). */
export const objR = (R: number, throne: boolean) => Math.max(R * (throne ? 1.5 : 1.36), throne ? 10 : 7.5) + 2;
export const contestR = (R: number, kingly: boolean) => (kingly ? objR(R, false) + 5 : R * 1.5 + 4);
export const markSz = (R: number) => Math.max(10, R * 0.95);
export const FOOT: Record<StarKind, number> = { red: 10, yellow: 12.5, white: 12, blue: 15, binary: 13.5, pulsar: 11.5, blackhole: 14, throne: 18 };
const artGrow = (zr: number) => Math.max(1, Math.min(3.5, zr / 105));
export const starScale = (zr: number) => (0.4 + 0.6 * sstep(46, 112, zr)) * (1 + 0.6 * sstep(130, 230, zr)) * Math.sqrt(artGrow(zr));
export const starR = (s: Sys, v: View) => (FOOT[s.star] + (s.kind === 'crown' ? 2 : s.kind === 'home' ? 1.5 : 0)) * starScale(v.zr) * (v.coarse ? 1.08 : 1);
export const tokR = (v: View) => v.W.s * (v.coarse ? 9 : 8) + v.W.o * (v.coarse ? 12.5 : 11) + v.W.d * 22 * Math.pow(artGrow(v.zr), 0.75);
const SLOT: Record<string, Pt> = { mine: { x: -0.97, y: -0.24 }, a: { x: 0.97, y: -0.24 }, b: { x: 0.45, y: -0.89 }, warden: { x: -0.45, y: -0.89 } };
const slotOf = (h: House): Pt => (h === YOU ? SLOT.mine : h === 'warden' ? SLOT.warden : h === 'crimson' ? SLOT.a : SLOT.b);
const nameFs = (s: Sys) => (s.kind === 'throne' ? 15 : s.kind === 'crown' ? 13.5 : s.kind === 'home' ? 13 : 12);

export interface Layer { ground?: boolean; terr?: boolean; lanes?: boolean; marks?: boolean }
export interface Frame { probes: Probe[]; tokens: { f: Fleet; x: number; y: number; r: number }[]; stars: { s: Sys; x: number; y: number; R: number }[] }

/** Lane brightness this frame: lanes touching the hovered or selected star 0.5, the planned routes 1. */
function laneFocus(): Map<string, number> {
  const m = new Map<string, number>();
  for (const [a, b] of LANES) if (a === HOVER || b === HOVER || a === SELECTED_SYS || b === SELECTED_SYS) m.set(laneKey(a, b), 0.5);
  for (const r of ROUTES) for (let i = 1; i < r.path.length; i++) m.set(laneKey(r.path[i - 1], r.path[i]), 1);
  return m;
}

/** Draw the board. `layer` limits it to the background layers (for the readability measurement). */
export function drawBoard(g: G, v: View, st: Style, layer: Layer = { ground: true, terr: true, lanes: true, marks: true }): Frame {
  const W = v.W;
  const probes: Probe[] = [];
  const P = (kind: string, x: number, y: number, w: number, h: number, bg: 0 | 1 | 2 = 1) => {
    if (x - w / 2 < 2 || y - h / 2 < 2 || x + w / 2 > v.w - 2 || y + h / 2 > v.h - 2) return; // only marks fully in view
    probes.push({ kind, x, y, w, h, bg });
  };
  const frame: Frame = { probes, tokens: [], stars: [] };
  if (layer.ground) st.ground(g, v);
  // ---------------------------------------------------------------- territories
  if (layer.terr) for (const h of HOUSES) {
    const path = loopsPath(LOOPS[h], v);
    st.territory(g, v, h, path);
  }
  if (layer.marks) for (const h of HOUSES) {
    // a border probe on the longest edge of each loop (the wire must read against both sides)
    const L = LOOPS[h][0];
    if (!L) continue;
    let best = 0, bi = 0;
    for (let i = 0; i < L.length; i++) { const p = L[i], q = L[(i + 1) % L.length]; const d = Math.hypot(q.x - p.x, q.y - p.y); if (d > best) { best = d; bi = i; } }
    const p = L[bi], q = L[(bi + 1) % L.length];
    P('territory border', v.sx((p.x + q.x) / 2), v.sy((p.y + q.y) / 2), 8, 8, 0);
  }
  // ---------------------------------------------------------------- lanes
  const focus = laneFocus();
  if (layer.lanes) {
    for (const [a, b] of LANES) {
      const A = SYSTEMS[a], B = SYSTEMS[b];
      const lit = focus.get(laneKey(a, b)) ?? 0;
      const rA = starR(A, v) * 1.05, rB = starR(B, v) * 1.05;
      const x0 = v.sx(A.x), y0 = v.sy(A.y), x1 = v.sx(B.x), y1 = v.sy(B.y);
      const d = Math.hypot(x1 - x0, y1 - y0);
      if (d < rA + rB + 4) continue;
      const ux = (x1 - x0) / d, uy = (y1 - y0) / d;
      st.lane(g, v, { x: x0 + ux * rA, y: y0 + uy * rA }, { x: x1 - ux * rB, y: y1 - uy * rB }, lit, A.fog || B.fog);
      // waypoint dots only where a lane is lit, or faintly up close
      const wl = lit > 0 ? lit : W.d * 0.35;
      if (wl > 0.02) {
        const n = Math.max(1, Math.round(Math.hypot(B.x - A.x, B.y - A.y) / 200));
        for (let i = 1; i <= n; i++) { const t = i / (n + 1); st.waypoint(g, v, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, wl); }
      }
    }
  }
  if (!layer.marks) return frame;
  for (const [a, b] of LANES) {
    const A = SYSTEMS[a], B = SYSTEMS[b], lit = focus.get(laneKey(a, b)) ?? 0;
    const mx = v.sx((A.x * 0.6 + B.x * 0.4)), my = v.sy((A.y * 0.6 + B.y * 0.4));
    if (lit < 1) P(lit >= 0.5 ? 'lane (lit)' : 'lane (rest)', mx, my, 6, 6, 1); // route lanes are measured as the route
  }
  // ---------------------------------------------------------------- systems
  for (const s of SYSTEMS) {
    const x = v.sx(s.x), y = v.sy(s.y), R = starR(s, v);
    if (x < -R * 6 || y < -R * 6 || x > v.w + R * 6 || y > v.h + R * 6) continue;
    frame.stars.push({ s, x, y, R });
    if (W.d > 0.02 && s.bodies.length) st.bodies(g, v, s, x, y, R, W.d);
    st.star(g, v, s.star, x, y, R, s.fog, s.id * 37 + 11);
    P(s.fog ? 'star (fogged)' : `star: ${s.star}`, x, y, R * 2, R * 2, 1);
    if (s.kind === 'crown' || s.kind === 'throne') {
      st.objective(g, v, x, y, R, s.kind === 'throne', s.fog);
      const rr = objR(R, s.kind === 'throne');
      P(s.kind === 'throne' ? 'throne ring' : 'crown ring', x + rr * 0.71, y + rr * 0.71, 5, 5, 1);
    }
    if (s.contested && W.s < 0.98) { st.contested(g, v, x, y, R, s.contested.holder, s.kind === 'crown' || s.kind === 'throne'); const rc = contestR(R, s.kind === 'crown' || s.kind === 'throne'); P('contested', x - rc * 0.94, y + rc * 0.34, 6, 6); }
    // corner marks are operational-and-closer information (UX-V2 §2: no icons at the strategic tier)
    const ca = 1 - W.s;
    g.save(); g.globalAlpha = ca;
    if (s.occupied && ca > 0.02) { st.occupied(g, v, x, y, R, s.occupied.by); P('occupied', x + R * 1.25, y + R * 0.95, markSz(R) * 0.8, markSz(R) * 0.8); }
    if (s.tribute && ca > 0.02) { st.tribute(g, v, x, y, R, s.tribute.to); P('tribute', x - R * 1.25, y + R * 0.95, markSz(R) * 0.8, markSz(R) * 0.8); }
    g.restore();
  }
  // ---------------------------------------------------------------- routes and the seize reticle
  for (const r of ROUTES) {
    const f = FLEETS.find(q => q.id === r.fleet)!;
    const pts = r.path.map(id => ({ x: v.sx(SYSTEMS[id].x), y: v.sy(SYSTEMS[id].y) }));
    // the line starts at the piece's side of the star and stops at the destination's edge (or its reticle)
    const end = SYSTEMS[r.path[r.path.length - 1]];
    const R1 = starR(end, v) + (r.seize !== null ? 9 : 4);
    const R0 = starR(SYSTEMS[r.path[0]], v) + 2;
    const trim = (a: Pt, b: Pt, d: number): Pt => { const L = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: a.x + (b.x - a.x) * d / L, y: a.y + (b.y - a.y) * d / L }; };
    pts[0] = trim(pts[0], pts[1], R0);
    const n = pts.length;
    pts[n - 1] = trim(pts[n - 1], pts[n - 2], R1);
    st.route(g, v, pts, f.owner, r.seize !== null);
    const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    P(r.seize !== null ? 'route (seize)' : 'route (move)', mid.x, mid.y, 7, 7);
    if (r.seize !== null) {
      const t = SYSTEMS[r.seize];
      const RR = starR(t, v) + 7;
      st.reticle(g, v, v.sx(t.x), v.sy(t.y), RR, f.owner);
      P('seize reticle', v.sx(t.x), v.sy(t.y) - RR, 7, 7);
    }
  }
  // ---------------------------------------------------------------- names (operational and closer), garrisons
  const nameA = 1 - W.s;
  const gfocus = new Set<number>([HOVER, SELECTED_SYS, ...ROUTES.filter(r => r.seize !== null).map(r => r.seize as number)]);
  for (const { s, x, y, R } of frame.stars) {
    const kind: NameKind = s.kind === 'relic' ? 'colony' : s.kind;
    const fs = nameFs(s) * (v.coarse ? 1.12 : 1);
    const a = s.kind === 'throne' ? Math.max(nameA, 0.9) : nameA;
    let below = R + 4;
    if (a > 0.02) {
      g.save(); g.globalAlpha = a;
      const ny = y + R + 5 + fs * 0.6 + (s.contested ? 3 : 0);
      const w = st.label(g, v, s.kind === 'throne' && W.s > 0.5 ? s.name.toUpperCase() : s.name, x, ny, s.kind === 'throne' && W.s > 0.5 ? 12 * (v.coarse ? 1.12 : 1) : fs, kind, s.owner, s.fog);
      g.restore();
      P(s.fog ? 'name (fogged)' : kind === 'throne' || kind === 'crown' ? 'name (objective)' : 'name', x, ny, Math.min(w, 60), fs * 0.62);
      below = ny - y + fs * 0.55;
    }
    const ga = gfocus.has(s.id) ? 1 - W.s : W.d * 0.85;
    if (ga > 0.05) {
      g.save(); g.globalAlpha = ga;
      const gy = y + below + 9;
      st.garrison(g, v, s.garrison, x, gy, 12.5 * (v.coarse ? 1.1 : 1));
      g.restore();
      P('garrison', x + 4, gy, 10, 9);
    }
  }
  // empire names (strategic only): spaced capitals inside each land, one word per line
  if (W.s > 0.02) {
    g.save(); g.globalAlpha = W.s;
    for (const h of HOUSES) {
      const c = EMPIRE_AT[h];
      const fs = Math.max(9, Math.min(26, 70 * v.z));
      const words = HOUSE_NAME[h].toUpperCase().split(' ');
      words.forEach((wd, i) => {
        const y = v.sy(c.y) + (i - (words.length - 1) / 2) * fs * 1.25;
        st.empireName(g, v, wd, v.sx(c.x), y, fs, h);
        P('empire name', v.sx(c.x), y, Math.min(40, fs * 2), fs * 0.6, 1);
      });
    }
    g.restore();
  }
  // ---------------------------------------------------------------- fleets
  const tr = tokR(v);
  const byStar = new Map<number, Fleet[]>();
  for (const f of FLEETS) if (!f.lane) byStar.set(f.at, [...(byStar.get(f.at) ?? []), f]);
  for (const f of FLEETS) {
    const S0 = SYSTEMS[f.at];
    let x: number, y: number, ang: number, tether: Pt | null = null;
    if (f.lane) {
      const T = SYSTEMS[f.lane.to];
      x = v.sx(S0.x + (T.x - S0.x) * f.lane.t); y = v.sy(S0.y + (T.y - S0.y) * f.lane.t);
      ang = Math.atan2(T.y - S0.y, T.x - S0.x);
    } else {
      const sl = slotOf(f.owner);
      const R = starR(S0, v);
      const d = R + tr + 6 + W.d * 10;
      const sx = v.sx(S0.x), sy = v.sy(S0.y);
      x = sx + sl.x * d; y = sy + sl.y * d * (W.d > 0.5 ? 0.8 : 1);
      // heading: toward its planned route, else facing the star's far side
      const r = ROUTES.find(q => q.fleet === f.id);
      if (r) { const n = SYSTEMS[r.path[1]]; ang = Math.atan2(v.sy(n.y) - y, v.sx(n.x) - x); }
      else ang = Math.atan2(sy - y, sx - x) + (f.owner === YOU ? 0 : Math.PI) * 0;
      tether = { x: sx + sl.x * (R + 1.5), y: sy + sl.y * (R + 1.5) * (W.d > 0.5 ? 0.8 : 1) };
    }
    if (x < -60 || y < -60 || x > v.w + 60 || y > v.h + 60) continue;
    frame.tokens.push({ f, x, y, r: tr });
    if (tether && W.s < 0.95) st.tether(g, v, tether.x, tether.y, x - Math.cos(Math.atan2(y - tether.y, x - tether.x)) * tr * 0.9, y - Math.sin(Math.atan2(y - tether.y, x - tether.x)) * tr * 0.9, f.owner);
    if (W.d > 0.01) { g.save(); g.globalAlpha = W.d; st.mini(g, v, x, y, ang, tr, f.owner, f.ships, !!f.selected); g.restore(); }
    if (W.o > 0.01) { g.save(); g.globalAlpha = W.o; st.counter(g, v, x, y, ang, tr, f.owner, !!f.selected); g.restore(); }
    if (W.s > 0.01) { g.save(); g.globalAlpha = W.s; st.pip(g, v, x, y, ang, tr, f.owner, !!f.selected); g.restore(); }
    const tier = W.d > 0.5 ? 'miniature' : W.o > 0.5 ? 'fleet counter' : 'fleet pip';
    P(`${tier} (${f.owner})`, x, y, tr * 2.2, tr * 2.2);
    if (f.idle && W.s < 0.98) { st.idle(g, v, x, y, tr, 0.5); P('idle rim', x - tr * 1.3, y, 5, 5); }
    if (f.oos) { st.oos(g, v, x, y, tr); P('out-of-supply rim', x + tr * 1.25, y + 0.3 * tr, 5, 5); }
    if (f.stack > 1) { st.stack(g, v, f.stack, x, y, tr, f.owner); P('stack count', x + tr * 0.95, y + tr * 0.95, 9, 9); }
    if (f.selected && W.s < 0.98) {
      const sy = y - tr - 10 - W.d * tr * 0.9;
      st.strength(g, v, f.power, x, sy); P('strength', x + 4, sy, 12, 10);
    }
  }
  // ---------------------------------------------------------------- battles
  for (const b of BATTLES) {
    const s = SYSTEMS[b.at];
    const R = starR(s, v);
    const D = W.s * 8.5 + (1 - W.s) * 11 + (v.coarse ? 1.5 : 0) + W.d * Math.max(4, R * 0.35);
    const lift = (1 - W.s) * (R + D + 4);
    const x = v.sx(s.x), y = v.sy(s.y) - lift;
    // up close the pieces exchange fire (the game's drawBattle): two shots each way, frozen mid-flight
    if (W.d > 0.3) {
      const toks = frame.tokens.filter(t => t.f.at === b.at && !t.f.lane);
      g.save(); g.globalAlpha = W.d;
      for (const t of toks) for (const o of toks) if (o.f.owner !== t.f.owner) for (let j = 0; j < 2; j++) {
        const a = { x: t.x + (j - 0.5) * t.r * 0.5, y: t.y - t.r * 0.7 }, e = { x: o.x + (0.5 - j) * o.r * 0.5, y: o.y - o.r * 0.6 };
        st.shot(g, v, a, e, t.f.owner, 0.35 + j * 0.3);
      }
      g.restore();
    }
    st.battle(g, v, x, y, D);
    P('battle mark', x, y, D * 1.5, D * 1.5);
  }
  return frame;
}

/** Orbit geometry shared by the styles: body i of n round a star of radius R (screen px). */
export function orbitOf(i: number, R: number, seed: number, t = 0): { rx: number; ry: number; a: number } {
  const rx = R * (1.85 + i * 0.62), ry = rx * 0.42;
  const a = ((seed * 0.6180339 + i * 0.37) % 1) * TAU + t * (0.05 / (1 + i));
  return { rx, ry, a };
}
