// Fog of war: what each player can see. Used by the server to filter state
// before sending it to a client, by signals, and by fair AIs.
import { within } from './graph.ts';
import type { GameState, PlayerId, RegionId } from './types.ts';

export function coverage(s: GameState, p: PlayerId): Set<RegionId> {
  const R = s.rules.sensors;
  const out = new Set<RegionId>();
  const bonus = s.players[p]?.relics.includes('chorus') ? 1 : 0;
  for (const r of s.regions) {
    if (r.owner !== p) continue;
    for (const x of within(s, r.id, R.ownedRange + (r.buildings.sensor ?? 0) + bonus)) out.add(x);
  }
  for (const f of s.fleets) {
    if (f.owner !== p || !f.ships.length) continue;
    const extra = Math.max(0, ...f.ships.map(sh => s.rules.ships[sh.cls]?.sensor ?? 0));
    for (const x of within(s, f.region, R.fleetRange + extra + bonus)) out.add(x);
  }
  for (const sc of s.scans) if (sc.owner === p && sc.until >= s.turn) for (const x of within(s, sc.region, R.scanRange)) out.add(x);
  return out;
}

/** Can player p see fleets in region rid? */
export function seesFleetsIn(s: GameState, p: PlayerId, rid: RegionId, cov?: Set<RegionId>): boolean {
  const r = s.regions[rid];
  if (r.kind === 'throne' && s.rules.throne.holderVisible) return true;
  const c = cov ?? coverage(s, p);
  if (!c.has(rid)) return false;
  if (r.feature === 'nebula' && s.rules.sensors.nebulaHidesFleets) {
    const scanned = s.scans.some(sc => sc.owner === p && sc.until >= s.turn && (sc.region === rid || s.regions[sc.region].neighbors.includes(rid)));
    const present = s.fleets.some(f => f.owner === p && f.region === rid && f.ships.length);
    return scanned || present || r.owner === p;
  }
  return true;
}
