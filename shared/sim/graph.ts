import { shipStats } from './empire.ts';
import type { GameState, RegionId, Fleet, PlayerId } from './types.ts';

/** BFS shortest path from a to b (inclusive of b, exclusive of a). null if unreachable. */
export function findPath(s: GameState, a: RegionId, b: RegionId, maxLen = 99): RegionId[] | null {
  if (a === b) return [];
  const prev = new Map<RegionId, RegionId>();
  const q: RegionId[] = [a];
  const seen = new Set([a]);
  while (q.length) {
    const cur = q.shift()!;
    for (const n of s.regions[cur].neighbors) {
      if (seen.has(n)) continue;
      seen.add(n); prev.set(n, cur);
      if (n === b) {
        const path: RegionId[] = [b];
        let c = b;
        while (prev.get(c) !== a) { c = prev.get(c)!; path.unshift(c); }
        return path.length <= maxLen ? path : null;
      }
      q.push(n);
    }
  }
  return null;
}

/** All regions within `range` jumps of `from` (including from). */
export function within(s: GameState, from: RegionId, range: number): Set<RegionId> {
  const out = new Set([from]);
  let frontier = [from];
  for (let i = 0; i < range; i++) {
    const nxt: RegionId[] = [];
    for (const r of frontier) for (const n of s.regions[r].neighbors) if (!out.has(n)) { out.add(n); nxt.push(n); }
    frontier = nxt;
  }
  return out;
}

export function distance(s: GameState, a: RegionId, b: RegionId): number {
  if (a === b) return 0;
  const p = findPath(s, a, b);
  return p ? p.length : 999;
}

export function fleetSpeed(s: GameState, f: Fleet): number {
  if (!f.ships.length) return 0;
  let sp = 99;
  for (const sh of f.ships) {
    const base = shipStats(s, sh, f.owner).speed;
    sp = Math.min(sp, sh.sys.engines ? base : 1);
  }
  return sp;
}

export function fleetPower(s: GameState, f: Fleet): number {
  let p = 0;
  for (const sh of f.ships) {
    if (!s.rules.ships[sh.cls]) continue;
    const d = shipStats(s, sh, f.owner);
    const atk = sh.sys.weapons ? d.attack * d.shots : 0;
    p += (sh.hp + (sh.sys.shields ? d.shields * 4 : 0)) * 0.5 + atk * 2;
  }
  return Math.round(p);
}

export function strengthBand(ships: number): string {
  return ships <= 2 ? 'small' : ships <= 5 ? 'medium' : 'large';
}

export function playerFleets(s: GameState, p: PlayerId): Fleet[] {
  return s.fleets.filter(f => f.owner === p);
}
