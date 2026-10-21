// Pure map-model helpers for the renderer: semantic-zoom tiers, fleet-token anchor slots, empire label
// points, border edges and strength estimates. No canvas here (unit-testable, cheap, memoized per state).
import type { GameState, Region, Pt, Fleet } from '../../../shared/sim/types.ts';
import { fleetPower } from '../../../shared/sim/graph.ts';
import { maxGarrison } from '../../../shared/sim/setup.ts';

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

// ------------------------------------------------------------------ fleet anchor slots
/** Screen-px offset of an owner's fleet token from its region's site, per tier, and which side its number sits on.
 *  Fixed per owner so a colour always parks in the same place; chosen so tokens never sit on the banner (below
 *  the planet at operational/detail) or on the garrison plate (on the planet at strategic), nor on each other. */
export interface Slot { dx: number; dy: number; side: -1 | 1 }
const SLOTS: Record<Tier, Record<string, Slot>> = {
  strategic: {
    0: { dx: -27, dy: -4, side: -1 },
    1: { dx: 27, dy: -4, side: 1 },
    2: { dx: 0, dy: 27, side: 1 },
    [-1]: { dx: 0, dy: -29, side: 1 },
  },
  operational: {
    0: { dx: -26, dy: -20, side: -1 },
    1: { dx: 26, dy: -20, side: 1 },
    2: { dx: 0, dy: -46, side: 1 },
    [-1]: { dx: -30, dy: -48, side: -1 },
  },
  detail: {
    0: { dx: -32, dy: -24, side: -1 },
    1: { dx: 32, dy: -24, side: 1 },
    2: { dx: 0, dy: -56, side: 1 },
    [-1]: { dx: -36, dy: -58, side: -1 },
  },
};
/** Fleets sitting on a hyperlane waypoint dot: centred on the dot, owners nudged apart. */
const LANE_SLOTS: Record<string, Slot> = { 0: { dx: -9, dy: -9, side: -1 }, 1: { dx: 9, dy: -9, side: 1 }, 2: { dx: 0, dy: 12, side: 1 }, [-1]: { dx: 0, dy: -16, side: 1 } };
export function laneSlot(owner: number): Slot { return LANE_SLOTS[String(owner)] ?? LANE_SLOTS['0']; }
export function slotFor(tier: Tier, owner: number): Slot { return SLOTS[tier][String(owner)] ?? SLOTS[tier][String(((owner % 3) + 3) % 3)]; }

/** At strategic zoom on a small screen the slots pull in a little so tokens stay inside their region. */
export function slotScale(tier: Tier, screenR: number): number {
  if (tier === 'strategic') return Math.max(0.72, Math.min(1, screenR / 66));
  // zoomed in: the system's art grows with the region, and the tokens park further out around it
  if (tier === 'detail') return Math.max(1, Math.min(3.5, screenR / 105));
  return 1;
}

/** Where an owner's token parks in region r (world units), for `scale` world units per screen px. */
export function anchorOf(r: Region, owner: number, tier: Tier, scale: number, k = 1): Pt {
  const s = isLane(r) ? laneSlot(owner) : slotFor(tier, owner);
  return { x: r.site.x + s.dx * scale * k, y: r.site.y + s.dy * scale * k };
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
