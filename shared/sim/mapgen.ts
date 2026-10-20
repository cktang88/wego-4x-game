// Map generation: irregular Voronoi regions with 3-fold rotational symmetry
// (so all three players get an identical-but-rotated slice of the map).
import type { Rules } from '../config/rules.ts';
import { REGION_NAMES, CROWN_NAMES, THRONE_NAME } from '../config/content.ts';
import { Rng, hashString } from './rng.ts';
import type { Pt, Region, RegionKind, Feature } from './types.ts';

interface Site { p: Pt; kind: RegionKind; feature: Feature; garrisonRoll: number; wedge: number; relic: boolean }

const rot = (p: Pt, a: number): Pt => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) });
const polar = (r: number, a: number): Pt => ({ x: r * Math.cos(a), y: r * Math.sin(a) });
const d2 = (a: Pt, b: Pt) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

export interface GeneratedMap { regions: Region[]; homes: number[] }

export function generateMap(rules: Rules, seed: number): GeneratedMap {
  for (let attempt = 0; attempt < 50; attempt++) {
    const m = tryGenerate(rules, seed + attempt * 7919);
    if (m) return m;
  }
  throw new Error('map generation failed');
}

function tryGenerate(rules: Rules, seed: number): GeneratedMap | null {
  const rng = new Rng(seed);
  const R = rules.map.radius;
  const TAU = Math.PI * 2;
  const W = TAU / 3;
  const base = -Math.PI / 2; // wedge 0 points "up"

  // ---- wedge template (in wedge-local polar coordinates, angle relative to wedge center)
  const tmpl: Site[] = [];
  tmpl.push({ p: polar(0.8 * R, 0), kind: 'home', feature: 'none', garrisonRoll: 0, wedge: 0, relic: false });
  tmpl.push({ p: polar(0.42 * R, W / 2), kind: 'crown', feature: 'none', garrisonRoll: 0, wedge: 0, relic: false });
  const all = (pts: Pt[]) => { const out: Pt[] = [{ x: 0, y: 0 }]; for (const p of pts) for (let w = 0; w < 3; w++) out.push(rot(p, w * W)); return out; };
  const ok = (p: Pt) => all(tmpl.map(t => t.p)).every(q => d2(p, q) >= rules.map.minSiteDist ** 2) &&
    [1, 2].every(w => d2(p, rot(p, w * W)) >= rules.map.minSiteDist ** 2);
  const want = Math.max(3, rules.map.regionsPerWedge);
  let relicPlaced = 0;
  for (let tries = 0; tmpl.length < want && tries < 4000; tries++) {
    const a = (rng.next() - 0.5) * W;
    const r = R * (0.22 + 0.74 * Math.sqrt(rng.next()));
    const p = polar(r, a);
    if (!ok(p)) continue;
    let kind: RegionKind = 'colony';
    if (relicPlaced < rules.map.relicsPerWedge && r > 0.35 * R) { kind = 'relic'; relicPlaced++; }
    else if (rng.chance(rules.map.voidChance)) kind = 'void';
    const fr = rng.next();
    const feature: Feature = fr < rules.map.nebulaChance ? 'nebula' : fr < rules.map.nebulaChance + rules.map.asteroidChance ? 'asteroids' : 'none';
    tmpl.push({ p, kind, feature, garrisonRoll: rng.next(), wedge: 0, relic: kind === 'relic' });
  }
  if (tmpl.length < 4) return null;

  // ---- realise all sites (throne + 3 rotated wedges)
  const sites: Site[] = [{ p: { x: 0, y: 0 }, kind: 'throne', feature: 'none', garrisonRoll: 1, wedge: -1, relic: false }];
  for (let w = 0; w < 3; w++) for (const t of tmpl) sites.push({ ...t, p: rot(rot(t.p, base), w * W), wedge: w });

  // ---- bounding polygon: wobbly circle, also 3-fold symmetric
  const B: Pt[] = [];
  const NB = 96;
  const bumps = [rng.next(), rng.next(), rng.next(), rng.next()];
  for (let i = 0; i < NB; i++) {
    const a = (i / NB) * TAU;
    const rr = R * (1.12 + 0.05 * Math.sin(3 * a * 2 + bumps[0] * 6) + 0.03 * Math.sin(3 * a * 5 + bumps[1] * 6));
    B.push(polar(rr, a));
  }

  // ---- Voronoi cells via half-plane clipping
  const cells: Pt[][] = sites.map((s, i) => {
    let poly = B.slice();
    for (let j = 0; j < sites.length; j++) {
      if (i === j) continue;
      const o = sites[j].p;
      const nx = o.x - s.p.x, ny = o.y - s.p.y;
      const c = (o.x * o.x + o.y * o.y - s.p.x * s.p.x - s.p.y * s.p.y) / 2;
      poly = clip(poly, nx, ny, c);
      if (poly.length < 3) break;
    }
    return poly;
  });

  // ---- adjacency by shared edge length
  const n = sites.length;
  const shared: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    const poly = cells[i];
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k], b = poly[(k + 1) % poly.length];
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const di = Math.sqrt(d2(m, sites[i].p));
      let best = -1, bestDiff = 1e9;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const diff = Math.abs(Math.sqrt(d2(m, sites[j].p)) - di);
        if (diff < bestDiff) { bestDiff = diff; best = j; }
      }
      if (bestDiff < 1e-3 * R) shared[i][best] += Math.sqrt(d2(a, b));
    }
  }
  const neighbors: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i !== j && Math.min(shared[i][j], shared[j][i]) >= rules.map.minSharedEdge) neighbors[i].push(j);
  }
  // connectivity check
  const seen = new Set([0]); const q = [0];
  while (q.length) { const c = q.shift()!; for (const nb of neighbors[c]) if (!seen.has(nb)) { seen.add(nb); q.push(nb); } }
  if (seen.size !== n) return null;
  // fairness / pacing constraints
  const bfs = (from: number) => { const d = new Array(n).fill(99); d[from] = 0; const qq = [from]; while (qq.length) { const c = qq.shift()!; for (const nb of neighbors[c]) if (d[nb] === 99) { d[nb] = d[c] + 1; qq.push(nb); } } return d; };
  for (let i = 0; i < n; i++) {
    if (sites[i].kind !== 'home') continue;
    const d = bfs(i);
    for (let j = 0; j < n; j++) {
      if (sites[j].kind === 'crown' && d[j] < 2) return null;
      if (sites[j].kind === 'throne' && d[j] < 3) return null;
      if (sites[j].kind === 'home' && j !== i && d[j] < 3) return null;
    }
  }

  // ---- names
  const names = rng.shuffle(REGION_NAMES.slice());
  let ni = 0; let ci = 0;

  // ---- regions
  const regions: Region[] = sites.map((s, i) => {
    const poly = wobble(cells[i], rules.map.borderWobble, seed);
    let name: string;
    if (s.kind === 'throne') name = THRONE_NAME;
    else if (s.kind === 'crown') name = CROWN_NAMES[ci++ % CROWN_NAMES.length];
    else name = names[ni++ % names.length];
    const g = rules.garrison;
    let garrison = 0;
    if (s.kind === 'throne') garrison = g.throneNeutral;
    else if (s.kind === 'crown') garrison = g.crownNeutral;
    else if (s.kind === 'void') garrison = 0;
    else if (s.kind !== 'home') garrison = Math.round(g.neutralMin + (g.neutralMax - g.neutralMin) * s.garrisonRoll);
    return {
      id: i, name, kind: s.kind, feature: s.feature, site: s.p, poly, centroid: centroid(poly), neighbors: neighbors[i],
      owner: null, homeOf: null, dev: s.kind === 'void' ? 0 : 1, buildings: {}, project: null, garrison,
      loyalty: [0, 0, 0], relic: s.relic ? 'unclaimed' : null, wreckage: 0, battles: 0, heldSince: 0,
      memorials: [],
    } as Region;
  });
  const homes = [0, 1, 2].map(w => sites.findIndex(s => s.kind === 'home' && s.wedge === w));
  return { regions, homes };
}

/** Sutherland–Hodgman clip of a polygon against the half-plane nx*x + ny*y <= c */
function clip(poly: Pt[], nx: number, ny: number, c: number): Pt[] {
  const out: Pt[] = [];
  const inside = (p: Pt) => nx * p.x + ny * p.y <= c;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ia = inside(a), ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) {
      const da = nx * a.x + ny * a.y - c, db = nx * b.x + ny * b.y - c;
      const t = da / (da - db);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

/** Midpoint-displacement each edge, keyed by its endpoints so shared edges wobble identically on both sides. */
function wobble(poly: Pt[], amount: number, seed: number): Pt[] {
  if (amount <= 0) return poly.slice();
  const key = (p: Pt) => `${Math.round(p.x)},${Math.round(p.y)}`;
  const out: Pt[] = [];
  for (let k = 0; k < poly.length; k++) {
    let a = poly[k], b = poly[(k + 1) % poly.length];
    const ka = key(a), kb = key(b);
    const flip = ka > kb;
    if (flip) [a, b] = [b, a];
    const rng = new Rng(hashString(`${seed}|${flip ? kb : ka}|${flip ? ka : kb}`));
    let pts: Pt[] = [a, b];
    const len = Math.sqrt(d2(a, b));
    const depth = len > 120 ? 3 : len > 50 ? 2 : len > 15 ? 1 : 0;
    let amp = amount * len * 0.5;
    for (let d = 0; d < depth; d++) {
      const nxt: Pt[] = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const p = pts[i], q = pts[i + 1];
        const dx = q.x - p.x, dy = q.y - p.y;
        const l = Math.hypot(dx, dy) || 1;
        const off = (rng.next() - 0.5) * 2 * amp;
        nxt.push({ x: (p.x + q.x) / 2 - (dy / l) * off, y: (p.y + q.y) / 2 + (dx / l) * off }, q);
      }
      pts = nxt; amp *= 0.5;
    }
    if (flip) pts.reverse();
    pts.pop(); // next edge starts with b
    out.push(...pts);
  }
  return out;
}

function centroid(poly: Pt[]): Pt {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const cr = p.x * q.y - q.x * p.y;
    a += cr; cx += (p.x + q.x) * cr; cy += (p.y + q.y) * cr;
  }
  a /= 2;
  if (Math.abs(a) < 1e-9) return poly[0];
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function pointInPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
