// Pure map-model helpers for the renderer: semantic-zoom tiers, fleet-token anchor slots, empire label
// points, border edges and strength estimates. No canvas here (unit-testable, cheap, memoized per state).
import type { GameState, Region, Pt, Fleet } from '../../../shared/sim/types.ts';
import { fleetPower } from '../../../shared/sim/graph.ts';
import { maxGarrison } from '../../../shared/sim/setup.ts';
import { STAR_NODE, starKindOf } from '../art/stars.ts';

export type Tier = 'strategic' | 'operational' | 'detail';
export type Lens = 'political' | 'supply' | 'economy' | 'military';

/** Coarse pointer (touch): bigger numbers and hit radii. */
const coarseMQ = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(pointer: coarse)') : null;
export const coarsePointer = () => !!coarseMQ?.matches;

// ------------------------------------------------------------------ tiers
const medR = new WeakMap<Region[], number>();
/** Median region "radius" (sqrt(area/π)) in world units: the on-screen size of a typical region picks the tier. */
export function medianRegionRadius(st: GameState): number {
  const regs = st.regions;
  let v = medR.get(regs);
  if (v !== undefined) return v;
  const rs = regs.filter(r => r.kind !== 'void' && !isLane(r) && r.poly.length > 2).map(r => Math.sqrt(polyArea(r.poly) / Math.PI)).sort((a, b) => a - b);
  v = rs.length ? rs[rs.length >> 1] : 200;
  if (!(v > 1)) v = 200;
  medR.set(regs, v);
  return v;
}

/** On-screen median region radius (px) at which the tiers switch: [strategic→operational, operational→detail]. */
export function tierThresholds(coarse = coarsePointer()): [number, number] { return coarse ? [84, 178] : [74, 160]; }

/** The tier for a given on-screen region radius, with a little hysteresis around the current one so it doesn't flicker. */
export function tierFor(screenR: number, prev: Tier | null = null, coarse = coarsePointer()): Tier {
  const [a, b] = tierThresholds(coarse);
  const h = 0.06;
  const lo = prev === 'strategic' ? a * (1 + h) : prev === 'operational' ? a * (1 - h) : a;
  const hi = prev === 'detail' ? b * (1 - h) : prev === 'operational' ? b * (1 + h) : b;
  return screenR < lo ? 'strategic' : screenR >= hi ? 'detail' : 'operational';
}

// ------------------------------------------------------------------ continuous zoom
/*
 * INFORMATION BUDGET PER ZOOM (docs/UX-V2.md §2). Each tier shows only what a player cares about at that distance;
 * everything else is one hover / tap / click away (map tooltip, card). Tiers are not switches: every layer fades in
 * or out over a zoom range (zoomW), and sizes grow continuously with zoom (starScale, tokR).
 *
 *  STRATEGIC (zoomed out) - who owns what, where the armies are, where the fighting is, where the objectives are.
 *    Bold owner fills + big spaced empire names; stars as small glowing points; Crowns ringed in gold, the Throne a
 *    larger gold ring (named); fleets as owner-coloured chevron pips at their star / on their lane (a count only for
 *    a stack of 2+); battles as one small crossed-swords mark. NO numbers, plates, system names, pips or icons.
 *  OPERATIONAL (mid) - what can I reach and attack, and where are my forces.
 *    + system names written in space (letter-spaced, haloed, no plates; lower priority hides first, with hysteresis);
 *    fleets as compact owner-coloured counters; your idle fleets breathe softly while you plan; planned routes as
 *    one dashed line with a head (a seize ends in a target reticle). Garrison numbers only for the hovered / selected
 *    star and the current drag or seize target.
 *  DETAIL (close) - the full tabletop.
 *    + painted miniatures on bases, orbiting bodies, orbital structures, and a small garrison figure under each name.
 */
export const sstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export interface ZoomW { s: number; o: number; d: number }
/** How much of each tier's representation to draw at on-screen median region radius zr (sums to 1). */
export function zoomW(zr: number, coarse = coarsePointer()): ZoomW {
  const [a, b] = tierThresholds(coarse);
  const s = 1 - sstep(a * 0.8, a * 1.15, zr);
  const d = sstep(b * 0.82, b * 1.18, zr);
  return { s, o: Math.max(0, 1 - s - d), d };
}
/** How much the system art grows when zoomed in (1 up to the operational zoom). */
export const artGrow = (zr: number) => Math.max(1, Math.min(3.5, zr / 105));
/** A star's drawn size relative to its footprint: a small glowing point when zoomed out, the full painted star in
 *  the middle, growing with the region when zoomed in. Continuous in zr. */
export function starScale(zr: number): number {
  const lo = 0.4 + 0.6 * sstep(46, 112, zr);
  return lo * (1 + 0.6 * sstep(130, 230, zr)) * Math.sqrt(artGrow(zr));
}
/** A system's star radius in screen px at zoom zr. */
export function starPx(r: Region, zr: number): number {
  if (r.kind === 'void') return 2.5;
  const big = STAR_NODE[starKindOf(r)].foot + (r.kind === 'crown' ? 2 : r.kind === 'home' ? 1.5 : 0);
  return big * starScale(zr);
}
/** A fleet token's radius (screen px) at zoom zr: pip, counter, miniature base. */
export function tokR(zr: number, coarse = coarsePointer()): number {
  const w = zoomW(zr, coarse);
  return w.s * 6 + w.o * 11 + w.d * 22 * Math.pow(artGrow(zr), 0.75);
}

// ------------------------------------------------------------------ fleet anchor slots
/** Fleets park beside their star (a short tether to it): yours on the left, rivals opposite on the right (a second
 *  rival up and to the right), the Warden above. The name sits under the star, so tokens never cover it. Relative
 *  to the viewer, so "mine" is always on the same side; spectators see seat 0 on the left. */
let viewer: number | null = null;
export function setViewer(you: number | null) { viewer = you; }
export interface Slot { dx: number; dy: number; side: -1 | 1 }
const DIRS = { mine: { dx: -0.97, dy: -0.24 }, a: { dx: 0.97, dy: -0.24 }, b: { dx: 0.45, dy: -0.89 }, warden: { dx: -0.45, dy: -0.89 } };
export function slotFor(_tier: Tier | null, owner: number): Slot {
  if (owner < 0) return { ...DIRS.warden, side: -1 };
  const me = viewer ?? 0;
  if (owner === me) return { ...DIRS.mine, side: -1 };
  // the rival with the lower seat number after you takes the right, the other above-right
  const others = [0, 1, 2].filter(x => x !== me);
  return owner === others[0] ? { ...DIRS.a, side: 1 } : { ...DIRS.b, side: 1 };
}
/** Fleets on a hyperlane waypoint: on the dot itself; other owners nudged across it. */
export function laneSlot(owner: number): Slot {
  const me = viewer ?? 0;
  if (owner === me) return { dx: 0, dy: 0, side: -1 };
  return owner < 0 ? { dx: 0, dy: -14, side: 1 } : owner === [0, 1, 2].filter(x => x !== me)[0] ? { dx: 12, dy: -8, side: 1 } : { dx: -12, dy: -8, side: -1 };
}
/** Kept for callers of the old API (no longer scales anything). */
export function slotScale(_tier: Tier, _screenR: number): number { return 1; }

/** Where an owner's token parks in region r (world units), for `scale` world units per screen px; zr = the on-screen
 *  median region radius (px) the distances are sized for. */
export function anchorOf(r: Region, owner: number, scale: number, zr: number): Pt {
  if (isLane(r)) { const s = laneSlot(owner); return { x: r.site.x + s.dx * scale, y: r.site.y + s.dy * scale }; }
  const s = slotFor(null, owner);
  const d = starPx(r, zr) + 7 + tokR(zr);
  return { x: r.site.x + s.dx * d * scale, y: r.site.y + s.dy * d * scale };
}

// ------------------------------------------------------------------ hyperlanes (shared/ may add `kind: 'lane'` waypoint regions)
export interface LaneInfo { a: number; b: number; i: number; n: number }
type LaneRegion = Region & { lane?: LaneInfo; links?: number[] };
/** A hyperlane waypoint dot (a region with no polygon). */
export const isLane = (r: Region | undefined | null): boolean => !!r && (r.kind as string) === 'lane';
export const laneOf = (r: Region): LaneInfo | null => (r as LaneRegion).lane ?? null;
/** Movement adjacency (falls back to real adjacency before lanes exist). */
export const linksOf = (r: Region): number[] => (r as LaneRegion).links ?? r.neighbors;

/** Every hyperlane as a polyline of sites: planet → dots → planet (one per real link, deduplicated). */
const laneCache = new WeakMap<Region[], { pts: Pt[]; ids: number[] }[]>();
export function hyperlanes(st: GameState): { pts: Pt[]; ids: number[] }[] {
  const regs = st.regions;
  let v = laneCache.get(regs);
  if (v) return v;
  v = [];
  const byPair = new Map<string, Region[]>();
  for (const r of regs) {
    const L = isLane(r) ? laneOf(r) : null;
    if (!L) continue;
    const k = `${Math.min(L.a, L.b)}|${Math.max(L.a, L.b)}`;
    (byPair.get(k) ?? byPair.set(k, []).get(k)!).push(r);
  }
  const done = new Set<string>();
  for (const [k, dots] of byPair) {
    const L0 = laneOf(dots[0])!;
    dots.sort((x, y) => laneOf(x)!.i - laneOf(y)!.i);
    const a = regs[L0.a], b = regs[L0.b];
    if (!a || !b) continue;
    v.push({ pts: [a.site, ...dots.map(d => d.site), b.site], ids: [a.id, ...dots.map(d => d.id), b.id] });
    done.add(k);
  }
  for (const r of regs) {
    if (isLane(r)) continue;
    for (const n of linksOf(r)) {
      const o = regs[n];
      if (!o || isLane(o)) continue;
      const k = `${Math.min(r.id, n)}|${Math.max(r.id, n)}`;
      if (done.has(k)) continue;
      done.add(k);
      v.push({ pts: [r.site, o.site], ids: [r.id, o.id] });
    }
  }
  laneCache.set(regs, v);
  return v;
}

// ------------------------------------------------------------------ strength
const powCache = new WeakMap<Fleet, number>();
/** fleetPower, memoized per fleet object (state objects are replaced, never mutated in place between frames). */
export function powerOf(st: GameState, f: Fleet): number {
  let v = powCache.get(f);
  if (v === undefined || f.ships.length === 0) { v = f.ships.length ? fleetPower(st, f) : 0; powCache.set(f, v); }
  return v;
}

/** A garrison's fighting strength on the same scale as fleetPower (hp/2 + 2 × attack × shots), for the battle balance arc. */
export function garrisonPower(st: GameState, r: Region): number {
  const g = Math.max(0, r.garrison);
  if (!g) return 0;
  const R = st.rules.garrison, E = st.rules.empire as unknown as { batteryShots?: number; batteryAttack?: number } | undefined;
  const fort = r.buildings.fortress ?? 0, bat = r.buildings.battery ?? 0;
  const shots = R.shotsBase + fort * R.shotsPerFortress + bat * (E?.batteryShots ?? 0) + Math.floor(g / Math.max(1, R.hpPerShot));
  const atk = R.attackBase + fort * R.attackPerFortress + bat * (E?.batteryAttack ?? 0);
  return Math.round(g * 0.5 + shots * atk * 2);
}

/** The siege bar's full length: the garrison's maximum (neutrals: their starting garrison). */
export function garrisonMax(st: GameState, r: Region, engStart = 0): number {
  let m = 0;
  try { m = r.owner === null ? Math.max(r.baseGarrison ?? 0, r.garrison) : maxGarrison(st, r.id); } catch { m = r.garrison; }
  return Math.max(1, m, engStart, r.garrison);
}

/** Fortification level drawn as the chunky ring around a banner's shield cap (0 = none). */
export function fortLevel(r: Region): number {
  const b = r.buildings;
  return (b.fortress ?? 0) * 2 + (b.battery ?? 0) + (b.pshield ? 2 : 0);
}

// ------------------------------------------------------------------ geometry
export function polyArea(p: Pt[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[i], r = p[(i + 1) % p.length]; a += q.x * r.y - r.x * q.y; }
  return Math.abs(a / 2);
}

/** For every region, the polygon edges it shares with each neighbour (or with nothing: the map's rim). */
export interface EdgeRun { a: Pt; b: Pt; other: number }
const edgeCache = new WeakMap<Region[], EdgeRun[][]>();
export function regionEdges(st: GameState): EdgeRun[][] {
  const regs = st.regions;
  let v = edgeCache.get(regs);
  if (v) return v;
  const k = (p: Pt) => `${Math.round(p.x * 2)},${Math.round(p.y * 2)}`;
  const owners = new Map<string, number[]>();
  for (const r of regs) for (let i = 0; i < r.poly.length; i++) {
    const a = r.poly[i], b = r.poly[(i + 1) % r.poly.length];
    const ka = k(a), kb = k(b), key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    const l = owners.get(key);
    if (l) l.push(r.id); else owners.set(key, [r.id]);
  }
  v = regs.map(r => r.poly.map((a, i) => {
    const b = r.poly[(i + 1) % r.poly.length];
    const ka = k(a), kb = k(b), key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    const l = owners.get(key) ?? [];
    return { a, b, other: l.find(x => x !== r.id) ?? -1 };
  }));
  edgeCache.set(regs, v);
  return v;
}

/** One label point per player: the area-weighted centre of their largest connected block of regions, pulled onto
 *  their own territory if it falls outside; `span` is the block's width (world) to size the name. */
export function empireLabels(st: GameState, owners: (number | null)[]): { owner: number; p: Pt; span: number; n: number }[] {
  const out: { owner: number; p: Pt; span: number; n: number }[] = [];
  for (const pl of st.players) {
    const mine = st.regions.filter(r => owners[r.id] === pl.id && !isLane(r) && r.poly.length > 2);
    if (!mine.length) continue;
    // largest connected component
    const seen = new Set<number>();
    let best: Region[] = [];
    for (const r0 of mine) {
      if (seen.has(r0.id)) continue;
      const comp: Region[] = [];
      const q = [r0]; seen.add(r0.id);
      while (q.length) {
        const r = q.pop()!; comp.push(r);
        for (const n of r.neighbors) if (!seen.has(n) && owners[n] === pl.id && st.regions[n] && !isLane(st.regions[n])) { seen.add(n); q.push(st.regions[n]); }
      }
      if (comp.length > best.length) best = comp;
    }
    let ax = 0, ay = 0, aw = 0, minX = Infinity, maxX = -Infinity;
    for (const r of best) {
      const w = polyArea(r.poly);
      ax += r.centroid.x * w; ay += r.centroid.y * w; aw += w;
      for (const p of r.poly) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); }
    }
    // the candidate inside the block that is furthest from every planet (plates sit on planets), mildly preferring the middle
    const mid = { x: ax / aw, y: ay / aw };
    const cands: Pt[] = [mid, ...best.map(r => r.centroid)];
    for (const r of best) for (const n of r.neighbors) if (best.some(b => b.id === n)) { const o = st.regions[n]; cands.push({ x: (r.centroid.x + o.centroid.x) / 2, y: (r.centroid.y + o.centroid.y) / 2 }); }
    // a small block (a capital alone at the start): its centroid is its star, so the name sat on the star and the
    // fleets parked beside it; offer points half-way out toward its rim too
    if (best.length <= 3) for (const r of best) r.poly.forEach((v, i) => {
      const w = r.poly[(i + 1) % r.poly.length];
      cands.push({ x: (r.site.x + v.x) / 2, y: (r.site.y + v.y) / 2 }, { x: r.site.x + ((v.x + w.x) / 2 - r.site.x) * 0.5, y: r.site.y + ((v.y + w.y) / 2 - r.site.y) * 0.5 });
    });
    const sites = st.regions.filter(r => !isLane(r)).map(r => r.site);
    let p = mid, bestScore = -Infinity;
    for (const c of cands) {
      if (!best.some(r => pointIn(c, r.poly))) continue;
      let clear = Infinity;
      for (const q of sites) clear = Math.min(clear, Math.hypot(q.x - c.x, (q.y - c.y) * 1.6));
      const score = clear - 0.15 * Math.hypot(c.x - mid.x, c.y - mid.y);
      if (score > bestScore) { bestScore = score; p = c; }
    }
    if (bestScore === -Infinity) p = { ...best[0].centroid };
    out.push({ owner: pl.id, p, span: maxX - minX, n: best.length });
  }
  return out;
}

export function pointIn(p: Pt, poly: Pt[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/** Closest region site to p (any kind). */
export function nearestRegion(st: GameState, p: Pt): number {
  let best = 0, bd = Infinity;
  for (const r of st.regions) { const d = (r.site.x - p.x) ** 2 + (r.site.y - p.y) ** 2; if (d < bd) { bd = d; best = r.id; } }
  return best;
}

export const ROMAN = /^[IVX]+$/;
