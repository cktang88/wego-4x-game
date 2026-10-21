// The Empire layer: research, laws, modules, traits, veins, supply. Pure helpers
// used by the resolver, combat, orders, AI and UI. Design: docs/EMPIRE.md.
import type { Res } from '../config/rules.ts';
import { TECH, TECHS, LAW, MODULE, type TechDef } from '../config/empire.ts';
import type { Fleet, GameState, PlayerId, RegionId, Ship } from './types.ts';

const on = (s: GameState) => s.rules.empire?.enabled !== false;

export const hasTech = (s: GameState, p: PlayerId | null | undefined, t: string): boolean =>
  on(s) && p !== null && p !== undefined && p >= 0 && !!s.players[p]?.techs?.includes(t);
export const hasLaw = (s: GameState, p: PlayerId | null | undefined, l: string): boolean =>
  on(s) && p !== null && p !== undefined && p >= 0 && !!s.players[p]?.laws?.includes(l);

// ------------------------------------------------------------------ research
/** Who owns a ★ technology (one owner per game), or null. */
export function starOwner(s: GameState, tech: string): PlayerId | null {
  const p = s.players.find(x => x.techs?.includes(tech));
  return p ? p.id : null;
}

export function academyLevels(s: GameState, p: PlayerId): number {
  return s.regions.reduce((a, r) => a + (r.owner === p ? r.buildings.academy ?? 0 : 0), 0);
}

export function techCost(s: GameState, p: PlayerId, id: string): Partial<Res> {
  const E = s.rules.empire, t = TECH[id];
  if (!t) return {};
  const regions = s.regions.filter(r => r.owner === p).length;
  const disc = Math.min(E.academyMaxDiscount, academyLevels(s, p) * E.academyDiscount);
  const total = (E.techBase[t.tier] + E.techPerRegionPerTier * t.tier * regions) * (1 - disc);
  const credits = Math.round(total * E.techCreditShare);
  return { industry: Math.round(total) - credits, credits };
}

/** Why `p` can't research `id` right now (ignoring cost), or null. */
export function researchBlock(s: GameState, p: PlayerId, id: string): string | null {
  const t = TECH[id];
  if (!on(s)) return 'research is off in these rules';
  if (!t) return 'unknown technology';
  const mine = s.players[p]?.techs ?? [];
  if (mine.includes(id)) return 'already researched';
  const inBranch = TECHS.filter(x => x.branch === t.branch);
  const need = t.tier === 4 ? 3 : t.tier - 1;
  if (need >= 1 && !inBranch.some(x => x.tier === need && mine.includes(x.id))) return `needs a tier ${need === 3 ? 'III' : need === 2 ? 'II' : 'I'} ${t.branch === 'state' ? 'Statecraft' : t.branch === 'war' ? 'Warfare' : t.branch === 'bulwark' ? 'Bulwark' : 'Logistics'} technology first`;
  if (t.tier === 3) {
    const other = inBranch.find(x => x.tier === 3 && x.id !== id)!;
    if (mine.includes(other.id)) return `you chose ${other.name} instead`;
  }
  if (t.tier === 4) {
    const o = starOwner(s, id);
    if (o !== null && o !== p) return `${s.players[o].name} already owns it`;
  }
  if ((s.players[p].researched ?? 0) >= s.rules.empire.researchPerTurn) return `one technology per ${s.live ? 'cycle' : 'turn'}`;
  return null;
}

/** Technologies `p` could buy next (prerequisites met, ignoring cost and the per-turn limit). */
export function researchable(s: GameState, p: PlayerId): TechDef[] {
  return TECHS.filter(t => { const b = researchBlock(s, p, t.id); return !b || b.startsWith('one technology'); });
}

// ------------------------------------------------------------------ laws
export function lawSlots(s: GameState, p: PlayerId): number {
  const E = s.rules.empire;
  return E.lawSlotsStart + E.lawSlotTurns.filter(t => s.turn >= t).length + (hasTech(s, p, 'bureaucracy') ? 1 : 0);
}
/** The law on the other side of `id`'s pair. */
export const opposite = (id: string) => Object.values(LAW).find(l => l.pair === LAW[id]?.pair && l.id !== id)?.id ?? null;
export function lawCost(s: GameState, p: PlayerId, id: string): number {
  const opp = opposite(id);
  return s.rules.empire.lawCost * (opp && hasLaw(s, p, opp) ? 2 : 1);
}
export function lawBlock(s: GameState, p: PlayerId, id: string): string | null {
  if (!on(s)) return 'laws are off in these rules';
  if (!LAW[id]) return 'unknown law';
  const laws = s.players[p]?.laws ?? [];
  if (laws.includes(id)) return 'already enacted';
  const opp = opposite(id);
  if (!(opp && laws.includes(opp)) && laws.length >= lawSlots(s, p)) return `no free law slot (${laws.length}/${lawSlots(s, p)}); revoke one first`;
  return null;
}

// ------------------------------------------------------------------ veins & supply
/** Owned regions linked to your capital through your territory with no hostile warships in them. */
export function connected(s: GameState, p: PlayerId): Set<RegionId> {
  const out = new Set<RegionId>();
  const pl = s.players[p];
  if (!pl) return out;
  let src = pl.capital;
  if (s.regions[src]?.owner !== p) {
    const alt = s.regions.filter(r => r.owner === p).sort((a, b) => b.dev - a.dev || a.id - b.id)[0];
    if (!alt) return out;
    src = alt.id;
  }
  const blocked = (rid: RegionId) => s.fleets.some(f => f.region === rid && f.owner !== p && f.ships.length && f.ships.some(sh => sh.sys.weapons) && hostileTo(s, f.owner, p));
  if (blocked(src)) return out;
  const q = [src]; out.add(src);
  while (q.length) {
    const r = q.shift()!;
    for (const n of gateNeighbors(s, p, r)) {
      if (out.has(n) || s.regions[n].owner !== p || blocked(n)) continue;
      out.add(n); q.push(n);
    }
  }
  return out;
}
function hostileTo(s: GameState, a: number, b: number) {
  if (a === b) return false;
  if (a === -1 || b === -1) return true;
  return !s.pacts.some(x => x.until >= s.turn && ((x.a === a && x.b === b) || (x.a === b && x.b === a)));
}

/** Neighbours, plus (for the gate owner) every other gate they own. */
export function gateNeighbors(s: GameState, p: PlayerId, rid: RegionId): RegionId[] {
  const r = s.regions[rid];
  if (!r) return [];
  if (!(r.buildings.gate && r.owner === p)) return r.neighbors;
  const gates = s.regions.filter(x => x.id !== rid && x.owner === p && x.buildings.gate && !r.neighbors.includes(x.id)).map(x => x.id);
  return gates.length ? [...r.neighbors, ...gates] : r.neighbors;
}

export function hasVein(s: GameState, p: PlayerId, vein: string, conn = connected(s, p)): boolean {
  if (!on(s)) return true;
  return s.regions.some(r => r.owner === p && r.vein === vein && (r.buildings.extractor ?? 0) > 0 && conn.has(r.id));
}

/** Regions where `p`'s fleets are in supply. */
export function supplied(s: GameState, p: PlayerId, conn = connected(s, p)): Set<RegionId> {
  const E = s.rules.empire;
  const out = new Set<RegionId>();
  const spread = (from: RegionId, range: number) => {
    let frontier = [from]; out.add(from);
    for (let i = 0; i < range; i++) {
      const next: RegionId[] = [];
      for (const r of frontier) for (const n of s.regions[r].neighbors) if (!out.has(n)) { out.add(n); next.push(n); }
      frontier = next;
    }
  };
  for (const r of conn) spread(r, s.regions[r].buildings.depot ? Math.max(E.depotRange, E.supplyRange) : E.supplyRange);
  return out;
}

// ------------------------------------------------------------------ ships
export interface ShipStats { hp: number; attack: number; shots: number; shields: number; speed: number; siege: number; evasion: number; sensor: number }
/** A ship's effective stats for its owner: class + module + technologies. */
export function shipStats(s: GameState, sh: Ship, owner: PlayerId | -1): ShipStats {
  const d = s.rules.ships[sh.cls] ?? s.rules.ships.frigate;
  const st: ShipStats = { hp: sh.maxHp, attack: d.attack, shots: d.shots, shields: d.shields, speed: d.speed, siege: d.siege, evasion: d.evasion, sensor: d.sensor };
  if (!on(s)) return st;
  if (sh.mod === 'railgun') { st.attack += 1; st.shots += st.shots >= 3 ? 1 : 0; }
  if (sh.mod === 'deflector') { st.shields += 2; st.evasion += 0.03; }
  if (sh.mod === 'ion') { st.speed += 1; st.evasion += 0.08; }
  if (owner >= 0) {
    if (hasTech(s, owner, 'sunhammer')) st.attack += 1;
    if (hasTech(s, owner, 'siege')) st.siege += s.rules.empire.siegeDoctrineBonus;
    if (hasTech(s, owner, 'jump')) st.speed += 1;
  }
  return st;
}
export function baseHp(s: GameState, cls: string, mod: string | null | undefined): number {
  const hp = s.rules.ships[cls]?.hp ?? 10;
  return on(s) && mod === 'armor' ? Math.round(hp * s.rules.empire.armorHpMult) : hp;
}
/** Which module new ships of this class get. */
export function blueprintFor(s: GameState, p: PlayerId, cls: string): string | null {
  if (!on(s) || p < 0) return null;
  const m = s.players[p]?.blueprint?.[cls] ?? 'armor';
  return MODULE[m] && (MODULE[m].tech === null || hasTech(s, p, MODULE[m].tech!)) ? m : 'armor';
}
/** Why `p` can't build this class at all (tech / vein), or null. Shipyard & money are checked elsewhere. */
export function classBlock(s: GameState, p: PlayerId, cls: string, conn?: Set<RegionId>): string | null {
  const d = s.rules.ships[cls];
  if (!d || !on(s)) return null;
  if (d.tech?.length && !d.tech.some(t => hasTech(s, p, t))) return `needs ${d.tech.map(t => TECH[t]?.name ?? t).join(' or ')}`;
  if (d.vein && !hasVein(s, p, d.vein, conn)) return `needs ${d.vein === 'antimatter' ? '⚛ Antimatter' : '◆ Crystals'} (an Extractor connected to your capital)`;
  return null;
}
/** Why `p` can't start this project here (tech / vein / trait), or null. */
export function projectBlock(s: GameState, p: PlayerId, key: string, rid: RegionId): string | null {
  const pd = s.rules.projects[key];
  const r = s.regions[rid];
  if (!pd || !r) return null;
  if (!on(s) && ['academy', 'extractor', 'battery', 'pshield', 'depot', 'gate'].includes(key)) return 'not in these rules';
  if (pd.tech && !hasTech(s, p, pd.tech)) return `needs ${TECH[pd.tech]?.name ?? pd.tech}`;
  if (pd.vein && !r.vein) return 'no vein here';
  if (pd.needs && !hasVein(s, p, pd.needs)) return `needs ${pd.needs === 'crystal' ? '◆ Crystals' : '⚛ Antimatter'} (an Extractor connected to your capital)`;
  if (key === 'mine' && r.trait === 'gas') return 'gas giants have no surface to mine';
  return null;
}
export function maxDevAt(s: GameState, rid: RegionId): number {
  const r = s.regions[rid];
  return s.rules.economy.maxDev + (on(s) && r?.trait === 'garden' ? s.rules.empire.gardenDevBonus : 0);
}

// ------------------------------------------------------------------ cost modifiers
export function shipCostMod(s: GameState, p: PlayerId, cls: string, c: Partial<Res>): Partial<Res> {
  if (!on(s)) return c;
  const E = s.rules.empire;
  if (c.industry && hasLaw(s, p, 'industrial')) c.industry = Math.round(c.industry * (1 - E.industrialShipDiscount));
  if (c.industry && cls === 'bombard' && hasTech(s, p, 'siege')) c.industry = Math.round(c.industry * 0.75);
  return c;
}
export function projectCostMod(s: GameState, p: PlayerId, key: string, rid: RegionId, c: Partial<Res>): Partial<Res> {
  if (!on(s) || key !== 'develop') return c;
  const E = s.rules.empire;
  let m = 1;
  if (hasLaw(s, p, 'federal')) m *= 1 - E.federalDevelopDiscount;
  if (s.regions[rid]?.trait === 'garden') m *= 1 - E.gardenDevelopDiscount;
  if (m === 1) return c;
  const out: Partial<Res> = {};
  for (const [k, v] of Object.entries(c)) out[k as keyof Res] = Math.round((v ?? 0) * m);
  return out;
}

/** Fleets that fought or scanned can read a rival's modules; everyone sees techs and laws. */
export function describeFleetMods(s: GameState, f: Fleet): string {
  const mods = [...new Set(f.ships.map(x => x.mod).filter(Boolean))] as string[];
  return mods.map(m => `${MODULE[m]?.icon ?? ''} ${MODULE[m]?.name ?? m}`).join(', ');
}
