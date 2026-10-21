// Fog of war: what each player can see. Used by the server to filter state
// before sending it to a client, by signals, and by fair AIs.
import { withinArea } from './graph.ts';
import type { Fleet, GameState, PlayerId, RegionId } from './types.ts';
import { soulSensor, soulOn, SR, hasBane, hasBoon } from './soul.ts';
import { traitFx } from './shiptraits.ts';
import { sigOn, isExposed } from './signature.ts';
import { starSensor } from './systems.ts';

export function coverage(s: GameState, p: PlayerId): Set<RegionId> {
  const R = s.rules.sensors;
  const out = new Set<RegionId>();
  const bonus = (s.players[p]?.relics.includes('chorus') ? 1 : 0) + (s.players[p]?.techs?.includes('scanners') && s.rules.empire?.enabled !== false ? 1 : 0);
  for (const r of s.regions) {
    if (r.owner !== p) continue;
    for (const x of withinArea(s, r.id, R.ownedRange + (r.buildings.sensor ?? 0) + bonus + soulSensor(s, r) + starSensor(s, r))) out.add(x);
  }
  for (const f of s.fleets) {
    if (f.owner !== p || !f.ships.length) continue;
    const extra = Math.max(0, ...f.ships.map(sh => (s.rules.ships[sh.cls]?.sensor ?? 0) + traitFx(sh).sensor));
    for (const x of withinArea(s, f.region, R.fleetRange + extra + bonus)) out.add(x);
  }
  for (const sc of s.scans) if (sc.owner === p && sc.until >= s.turn) for (const x of withinArea(s, sc.region, R.scanRange)) out.add(x);
  return out;
}

/**
 * Can player p see this particular fleet? Region visibility (seesFleetsIn), plus the Soul layer:
 * Conspicuous and limping fleets are seen by everyone; Ghosts only by rivals in or next to its region
 * (with a fleet), owning its region, or scanning it.
 */
export function seesFleet(s: GameState, p: PlayerId, f: Fleet, cov?: Set<RegionId>): boolean {
  if (f.owner === p) return true;
  // Signature: an exposed ambusher is seen by everyone; one lying in Ambush only by a scan or a fleet beside it
  if (sigOn(s) && isExposed(s, f)) return true;
  if (sigOn(s) && f.posture === 'ambush' && !postureSeenBy(s, p, f)) return false;
  const on = soulOn(s);
  if (on && f.banner && hasBane(s, f, 'conspicuous')) return true;
  if (on && f.limping && SR(s).limpingVisible) return true;
  if (!seesFleetsIn(s, p, f.region, cov)) return false;
  if (on && f.banner && hasBoon(s, f, 'ghosts')) {
    const reg = s.regions[f.region];
    const near = new Set([f.region, ...(reg.links ?? reg.neighbors)]);
    const present = s.fleets.some(x => x.owner === p && x.ships.length && near.has(x.region)) || reg.owner === p;
    const scanned = s.scans.some(sc => sc.owner === p && sc.until >= s.turn && (sc.region === f.region || s.regions[sc.region]?.neighbors.includes(f.region)));
    return present || scanned;
  }
  return true;
}

/** Signature: can player p see this rival fleet's (secret) posture? Only with a fleet in the same system or a scan over it. */
export function postureSeenBy(s: GameState, p: PlayerId, f: Fleet): boolean {
  if (f.owner === p) return true;
  if (s.fleets.some(x => x.owner === p && x.ships.length && x.region === f.region)) return true;
  return s.scans.some(sc => sc.owner === p && sc.until >= s.turn && withinArea(s, sc.region, s.rules.sensors.scanRange).has(f.region));
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
    return scanned || present || r.owner === p || (!!s.players[p]?.techs?.includes('scanners') && s.rules.empire?.enabled !== false);
  }
  return true;
}
