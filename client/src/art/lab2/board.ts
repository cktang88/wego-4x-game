// Style lab (client/style-lab.html): the ONE mock board every art direction draws, so the directions are compared on
// identical content. Hand-placed, deterministic: 28 systems of every star kind, four owners plus the unclaimed,
// Voronoi territories, hyperlanes, fleets (pips / counters / minis), a battle, a move route and a seize route, the
// Crowns and the Throne, contested / occupied / tribute systems, fog, idle and out-of-supply pieces.
// No game state, no network: pure data plus geometry helpers.

export type House = 'azure' | 'crimson' | 'gilded' | 'warden';
export type StarKind = 'yellow' | 'red' | 'blue' | 'white' | 'binary' | 'pulsar' | 'blackhole' | 'throne';
export type SysKind = 'throne' | 'crown' | 'home' | 'colony' | 'relic';
export type BodyKind = 'rock' | 'gas' | 'ice' | 'lava' | 'belt' | 'station';
export interface Pt { x: number; y: number }

export interface Sys {
  id: number; name: string; x: number; y: number; star: StarKind; kind: SysKind;
  owner: House | null; garrison: number; fog: boolean; bodies: BodyKind[];
  contested?: { holder: House | null; turns: number };
  occupied?: { by: House; left: number };
  tribute?: { to: House; left: number };
}
export interface Fleet {
  id: number; owner: House; name: string; ships: string[]; stack: number;
  at: number;                         // system id (or the lane's first end when in transit)
  lane?: { to: number; t: number };   // in transit along a lane
  idle?: boolean; oos?: boolean; selected?: boolean; power: number;
}
export interface Route { fleet: number; path: number[]; seize: number | null; owner: House }
export interface Battle { at: number; sides: House[]; round: number; odds: number }
export interface Cell { sys: number; poly: Pt[]; tags: number[] }

/** The viewer's seat. */
export const YOU: House = 'azure';

const S = (id: number, name: string, x: number, y: number, star: StarKind, kind: SysKind, owner: House | null, garrison: number, bodies: BodyKind[] = [], fog = false): Sys =>
  ({ id, name, x, y, star, kind, owner, garrison, fog, bodies });

export const SYSTEMS: Sys[] = [
  S(0, 'The Hollow Throne', 0, 0, 'throne', 'throne', null, 60, ['ice', 'belt', 'station']),
  S(1, 'Crown of Thorns', -440, -170, 'yellow', 'crown', 'azure', 48, ['rock', 'gas']),
  S(2, 'Crown of Ash', 430, -210, 'yellow', 'crown', 'crimson', 48, ['lava', 'gas', 'station']),
  S(3, 'Crown of Glass', 30, 400, 'yellow', 'crown', 'gilded', 48, ['ice', 'rock']),
  // Azure Compact (north-west): the viewer
  S(4, 'Ninefold', -860, -540, 'yellow', 'home', 'azure', 31, ['rock', 'gas', 'station']),
  S(5, 'Dark Ridge', -560, -640, 'red', 'colony', 'azure', 12, ['rock']),
  S(6, 'Crying Sound', -250, -560, 'pulsar', 'colony', 'azure', 13, ['belt']),
  S(7, 'Vesper Fold', -1080, -190, 'blue', 'colony', 'azure', 14, ['ice', 'gas']),
  S(8, 'Kappa Drift', -760, -250, 'binary', 'colony', 'azure', 12, ['rock']),
  // Crimson Dominion (north-east)
  S(9, 'Mire of Aun', 880, -470, 'red', 'home', 'crimson', 31, ['lava', 'rock', 'station']),
  S(10, 'Ashfall', 560, -650, 'blackhole', 'relic', 'crimson', 12, []),
  S(11, 'Lepus Rift', 1110, -120, 'yellow', 'colony', 'crimson', 9, ['gas']),
  S(12, 'Copper Tide', 740, 90, 'binary', 'colony', 'crimson', 12, ['rock', 'belt']),
  // Gilded Throneholders (south-west)
  S(13, 'Marrow Field', -760, 520, 'yellow', 'home', 'gilded', 31, ['rock', 'gas', 'station']),
  S(14, 'Saltglass', -430, 690, 'white', 'colony', 'gilded', 10, ['ice']),
  S(15, 'Cygnus Gulf', -1050, 260, 'red', 'colony', 'gilded', 11, ['rock']),
  S(16, 'Wake District', -330, 360, 'blue', 'colony', 'gilded', 9, ['gas']),
  // unclaimed
  S(17, 'Old Lantern', -250, 110, 'white', 'colony', null, 9, ['rock']),
  S(18, 'Sable Narrows', 160, -360, 'binary', 'colony', null, 10, ['rock', 'gas']),
  S(19, 'Ember Wake', 400, 320, 'red', 'colony', null, 8, ['lava']),
  S(20, 'Carina Gate', 760, 470, 'blue', 'colony', null, 12, ['ice', 'gas']),
  S(21, 'Draco Sector', 1110, 330, 'pulsar', 'colony', null, 14, ['belt']),
  S(22, 'Reliquary', -40, -760, 'blackhole', 'relic', null, 20, []),
  S(23, 'Widow Rift', 250, -760, 'red', 'colony', null, 9, ['rock']),
  S(24, 'Gamma Expanse', -1200, -560, 'blackhole', 'relic', null, 16, [], true),
  S(25, 'Cowboy Leg', 420, 760, 'yellow', 'colony', null, 9, ['rock', 'ice'], true),
  S(26, 'Hollow Bell', 1080, 700, 'white', 'colony', null, 10, ['gas'], true),
  S(27, 'Lyra Sector', -10, 760, 'red', 'colony', 'gilded', 8, ['rock']),
];
// statuses
SYSTEMS[1].contested = { holder: 'crimson', turns: 2 };
SYSTEMS[16].occupied = { by: 'crimson', left: 3 };
SYSTEMS[12].tribute = { to: 'azure', left: 4 };

export const FLEETS: Fleet[] = [
  { id: 1, owner: 'azure', name: 'Home Guard', ships: ['cruiser', 'frigate', 'frigate'], stack: 1, at: 4, idle: true, power: 58 },
  { id: 2, owner: 'azure', name: 'Lapis Lance', ships: ['dread', 'cruiser', 'frigate'], stack: 2, at: 8, selected: true, power: 112 },
  { id: 3, owner: 'azure', name: 'Silver Wake', ships: ['cruiser', 'corvette'], stack: 1, at: 18, power: 44 },
  { id: 4, owner: 'crimson', name: 'Red Tithe', ships: ['dread', 'corvette', 'corvette'], stack: 1, at: 18, power: 61 },
  { id: 5, owner: 'crimson', name: 'Vigil of Ash', ships: ['bombard', 'frigate'], stack: 1, at: 1, power: 40 },
  { id: 6, owner: 'azure', name: 'Far Picket', ships: ['scout'], stack: 1, at: 23, oos: true, power: 9 },
  { id: 7, owner: 'crimson', name: 'Ember Host', ships: ['cruiser', 'frigate'], stack: 1, at: 2, lane: { to: 0, t: 0.5 }, power: 38 },
  { id: 8, owner: 'gilded', name: 'Saffron Oath', ships: ['bombard', 'frigate'], stack: 3, at: 3, power: 96 },
  { id: 9, owner: 'gilded', name: 'Marrow Watch', ships: ['frigate', 'corvette'], stack: 1, at: 13, power: 30 },
  { id: 10, owner: 'crimson', name: 'Occupiers', ships: ['cruiser', 'corvette'], stack: 1, at: 16, power: 42 },
  { id: 11, owner: 'warden', name: 'The Warden', ships: ['dread', 'cruiser'], stack: 1, at: 22, power: 90 },
  { id: 12, owner: 'azure', name: 'Tide Runner', ships: ['frigate', 'corvette'], stack: 1, at: 7, lane: { to: 15, t: 0.42 }, idle: true, power: 26 },
];
export const ROUTES: Route[] = [
  { fleet: 2, path: [8, 1, 17], seize: 17, owner: 'azure' },
  { fleet: 1, path: [4, 5, 6], seize: null, owner: 'azure' },
];
export const BATTLES: Battle[] = [{ at: 18, sides: ['azure', 'crimson'], round: 2, odds: 0.58 }];
/** The star the pointer rests on (its lanes light up; the tooltip names it). */
export const HOVER = 1;
export const SELECTED_SYS = 8;

/** Where each empire's name is lettered at the strategic tier (inside its land, clear of the Throne). */
export const EMPIRE_AT: Record<string, Pt> = { azure: { x: -720, y: -400 }, crimson: { x: 900, y: -250 }, gilded: { x: -640, y: 420 } };
export const HOUSE_NAME: Record<House, string> = { azure: 'Azure Compact', crimson: 'Crimson Dominion', gilded: 'Gilded Throneholders', warden: 'the Warden' };
export const SIGIL: Record<House, string> = { azure: 'star', crimson: 'serpent', gilded: 'sun', warden: 'eye' };

// ------------------------------------------------------------------ geometry
const TAU = Math.PI * 2;
function hash(n: number) { n = Math.imul(n ^ (n >>> 16), 0x7feb352d); n = Math.imul(n ^ (n >>> 15), 0x846ca68b); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; }

/** The board's outline: an organic blob (space beyond it is off the chart). */
export const OUTLINE: Pt[] = (() => {
  const out: Pt[] = [];
  const N = 72;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU;
    const w = 1 + 0.05 * Math.sin(a * 3 + 1.2) + 0.035 * Math.sin(a * 7 + 0.4) + 0.02 * (hash(i * 31 + 7) - 0.5);
    out.push({ x: Math.cos(a) * 1390 * w, y: Math.sin(a) * 950 * w });
  }
  return out;
})();

interface TP { x: number; y: number; t: number }
function clipHalf(poly: TP[], a: Pt, b: Pt, tag: number): TP[] {
  // keep points closer to a than to b
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, nx = b.x - a.x, ny = b.y - a.y;
  const side = (p: Pt) => (p.x - mx) * nx + (p.y - my) * ny; // <0 inside
  const out: TP[] = [];
  for (let i = 0; i < poly.length; i++) {
    const P = poly[i], Q = poly[(i + 1) % poly.length];
    const sp = side(P), sq = side(Q);
    const inter = (): Pt => { const k = sp / (sp - sq); return { x: P.x + (Q.x - P.x) * k, y: P.y + (Q.y - P.y) * k }; };
    if (sp <= 0 && sq <= 0) out.push(P);
    else if (sp <= 0 && sq > 0) { out.push(P); const I = inter(); out.push({ ...I, t: tag }); }
    else if (sp > 0 && sq <= 0) { const I = inter(); out.push({ ...I, t: P.t }); }
  }
  return out;
}

export const CELLS: Cell[] = SYSTEMS.map(s => {
  let poly: TP[] = OUTLINE.map(p => ({ ...p, t: -1 }));
  for (const o of SYSTEMS) if (o !== s && Math.hypot(o.x - s.x, o.y - s.y) < 1500) poly = clipHalf(poly, s, o, o.id);
  return { sys: s.id, poly: poly.map(p => ({ x: p.x, y: p.y })), tags: poly.map(p => p.t) };
});

/** Region "radius" sqrt(area/π) median: the tier picker, like the game (mapmodel.medianRegionRadius). */
export const MEDIAN_R = (() => {
  const rs = CELLS.map(c => { let a = 0; const p = c.poly; for (let i = 0; i < p.length; i++) { const q = p[i], w = p[(i + 1) % p.length]; a += q.x * w.y - w.x * q.y; } return Math.sqrt(Math.abs(a / 2) / Math.PI); }).sort((a, b) => a - b);
  return rs[rs.length >> 1];
})();

/** Hyperlanes: Voronoi neighbours (cells sharing an edge longer than 40) closer than 640. */
export const LANES: [number, number][] = (() => {
  const set = new Set<string>(), out: [number, number][] = [];
  for (const c of CELLS) {
    const p = c.poly;
    for (let i = 0; i < p.length; i++) {
      const j = c.tags[i];
      if (j < 0) continue;
      const q = p[(i + 1) % p.length];
      if (Math.hypot(q.x - p[i].x, q.y - p[i].y) < 40) continue;
      const a = SYSTEMS[c.sys], b = SYSTEMS[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) > 640) continue;
      const k = c.sys < j ? `${c.sys}-${j}` : `${j}-${c.sys}`;
      if (!set.has(k)) { set.add(k); out.push(c.sys < j ? [c.sys, j] : [j, c.sys]); }
    }
  }
  return out;
})();
export const laneKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/** Closed outline loops of one house's territory (the union of its cells), chained from border edges. */
export function territoryLoops(h: House): Pt[][] {
  const segs: [Pt, Pt][] = [];
  for (const c of CELLS) {
    if (SYSTEMS[c.sys].owner !== h) continue;
    const p = c.poly;
    for (let i = 0; i < p.length; i++) {
      const j = c.tags[i];
      if (j >= 0 && SYSTEMS[j].owner === h) continue;
      segs.push([p[i], p[(i + 1) % p.length]]);
    }
  }
  const loops: Pt[][] = [];
  const used = new Array(segs.length).fill(false);
  const near = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;
  for (let s = 0; s < segs.length; s++) {
    if (used[s]) continue;
    used[s] = true;
    const loop: Pt[] = [segs[s][0]];
    let end = segs[s][1];
    for (let guard = 0; guard < 2000; guard++) {
      if (near(end, loop[0])) break;
      loop.push(end);
      let k = -1;
      for (let t = 0; t < segs.length; t++) if (!used[t] && near(segs[t][0], end)) { k = t; break; }
      if (k < 0) break;
      used[k] = true; end = segs[k][1];
    }
    if (loop.length > 2) loops.push(loop);
  }
  return loops;
}
export const HOUSES: House[] = ['azure', 'crimson', 'gilded'];
export const LOOPS: Record<string, Pt[][]> = Object.fromEntries(HOUSES.map(h => [h, territoryLoops(h)]));

/** Borders where two houses meet (for a shared wire). */
export function houseCentroid(h: House): Pt {
  const ss = SYSTEMS.filter(s => s.owner === h);
  return { x: ss.reduce((a, s) => a + s.x, 0) / ss.length, y: ss.reduce((a, s) => a + s.y, 0) / ss.length };
}

/** Systems you can see (fog): everything but the fogged ones. */
export const visible = (s: Sys) => !s.fog;
export const lanesOf = (id: number) => LANES.filter(([a, b]) => a === id || b === id);
