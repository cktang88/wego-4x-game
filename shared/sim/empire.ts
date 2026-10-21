// The Empire layer: research, laws, modules, traits, veins, supply. Pure helpers
// used by the resolver, combat, orders, AI and UI. Design: docs/EMPIRE.md.
import type { Res } from '../config/rules.ts';
import { TECH, TECHS, LAW, MODULE, type TechDef } from '../config/empire.ts';
import type { Fleet, GameState, PlayerId, RegionId, Ship } from './types.ts';
import { traitFx } from './shiptraits.ts';
import { citizenCap, systemCostMult, systemsBlock, sysOn, worldFx } from './systems.ts';

const on = (s: GameState) => s.rules.empire?.enabled !== false;

/** Own-property lookup: ids may come from untrusted clients, and `TECH['constructor']` etc. must not resolve. */
export function lookup<T>(table: Record<string, T> | null | undefined, key: unknown): T | undefined {
  return table && typeof key === 'string' && Object.hasOwn(table, key) ? table[key] : undefined;
}

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
  const E = s.rules.empire, t = lookup(TECH, id);
  if (!t) return {};
  const regions = s.regions.filter(r => r.owner === p).length;
  // a tweaked rule set must never make research free money: clamp the discount, the price and the split
  const disc = Math.max(0, Math.min(1, E.academyMaxDiscount, academyLevels(s, p) * E.academyDiscount));
  const total = Math.max(0, ((E.techBase[t.tier] ?? 0) + E.techPerRegionPerTier * t.tier * regions) * (1 - disc)) || 0;
  const share = Math.max(0, Math.min(1, E.techCreditShare)) || 0;
  const credits = Math.round(total * share);
  return { industry: Math.max(0, Math.round(total) - credits), credits };
}

/**
 * Technologies `p` has bought this turn (LIVE: this cycle). `Player.researched` is only reset when the
 * NEXT turn/cycle starts resolving, so between turns it still holds last turn's count: read raw, it
 * would block planning a purchase every other turn. While a turn/tick is resolving `s.last` is null.
 */
export function researchedThisTurn(s: GameState, p: PlayerId): number {
  const n = s.players[p]?.researched ?? 0;
  if (s.last == null) return n;                          // resolving (or nothing resolved yet): the counter is live
  if (!s.live) return 0;                                  // WEGO planning: a fresh turn always starts at 0
  const per = Math.max(1, Math.floor(s.rules.live?.ticksPerCycle ?? 1) || 1);   // as live.ts ticksPerCycle
  return s.live.tick % per === 0 ? 0 : n;                 // LIVE: the next tick opens a new cycle and resets it
}

/** Why `p` can't research `id` right now (ignoring cost), or null. */
export function researchBlock(s: GameState, p: PlayerId, id: string): string | null {
  const t = lookup(TECH, id);
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
  if (researchedThisTurn(s, p) >= s.rules.empire.researchPerTurn) return `one technology per ${s.live ? 'cycle' : 'turn'}`;
  return null;
}

/** Technologies `p` could buy next (prerequisites met, ignoring cost and the per-turn limit). */
export function researchable(s: GameState, p: PlayerId): TechDef[] {
  return TECHS.filter(t => { const b = researchBlock(s, p, t.id); return !b || b.startsWith('one technology'); });
}

// ------------------------------------------------------------------ laws
export function lawSlots(s: GameState, p: PlayerId): number {
  const E = s.rules.empire;
  return E.lawSlotsStart + (Array.isArray(E.lawSlotTurns) ? E.lawSlotTurns : []).filter(t => s.turn >= t).length + (hasTech(s, p, 'bureaucracy') ? 1 : 0);
}
/** The law on the other side of `id`'s pair. */
export const opposite = (id: string) => { const me = lookup(LAW, id); return me ? Object.values(LAW).find(l => l.pair === me.pair && l.id !== id)?.id ?? null : null; };
export function lawCost(s: GameState, p: PlayerId, id: string): number {
  const opp = opposite(id);
  // switching sides costs double, also if you revoked the other side earlier this turn
  const switching = !!opp && (hasLaw(s, p, opp) || !!s.players[p]?.revokedThisTurn?.includes(opp));
  return s.rules.empire.lawCost * (switching ? 2 : 1);
}
export function lawBlock(s: GameState, p: PlayerId, id: string): string | null {
  if (!on(s)) return 'laws are off in these rules';
  if (!lookup(LAW, id)) return 'unknown law';
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
  // a blockade needs real warships (not a lone scout), and holds only while none of your own warships contest it
  const warship = (f: Fleet) => f.ships.some(sh => sh.sys.weapons && sh.cls !== 'scout');
  const blocked = (rid: RegionId) => s.fleets.some(f => f.region === rid && f.owner !== p && warship(f) && hostileTo(s, f.owner, p))
    && !s.fleets.some(f => f.region === rid && f.owner === p && warship(f));
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
/** Movement neighbours (through hyperlane waypoints), plus (for the gate owner) every other gate they own. */
export function moveNeighbors(s: GameState, p: PlayerId, rid: RegionId): RegionId[] {
  const r = s.regions[rid];
  if (!r) return [];
  const base = r.links ?? r.neighbors;
  if (!(r.buildings.gate && r.owner === p)) return base;
  const gates = s.regions.filter(x => x.id !== rid && x.owner === p && x.buildings.gate && !base.includes(x.id)).map(x => x.id);
  return gates.length ? [...base, ...gates] : base;
}

/** Territory neighbours (real borders, ignoring waypoints), plus the owner's gates. Used for supply connection. */
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
  // hyperlane waypoints are in supply when their lane touches supplied space
  for (const r of s.regions) if (r.lane && (out.has(r.lane.a) || out.has(r.lane.b))) out.add(r.id);
  return out;
}

// ------------------------------------------------------------------ ships
export interface ShipStats { hp: number; attack: number; shots: number; shields: number; speed: number; siege: number; evasion: number; sensor: number }
/** A ship's effective stats for its owner: class + module + technologies. */
export function shipStats(s: GameState, sh: Ship, owner: PlayerId | -1): ShipStats {
  const d = lookup(s.rules.ships, sh.cls) ?? s.rules.ships.frigate;
  const st: ShipStats = { hp: sh.maxHp, attack: d.attack, shots: d.shots, shields: d.shields, speed: d.speed, siege: d.siege, evasion: d.evasion, sensor: d.sensor };
  if (sh.traits?.length) {
    // Soul layer: rolled ship traits (small, double-edged)
    const t = traitFx(sh);
    st.attack = Math.max(1, st.attack + t.attack); st.shields = Math.max(0, st.shields + t.shields); st.speed = Math.max(1, st.speed + t.speed);
    st.siege = Math.max(0, st.siege + t.siege); st.evasion = Math.max(-0.1, st.evasion + t.evasion); st.sensor = Math.max(0, st.sensor + t.sensor);
  }
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
  const hp = lookup(s.rules.ships, cls)?.hp ?? 10;
  return on(s) && mod === 'armor' ? Math.round(hp * s.rules.empire.armorHpMult) : hp;
}
/** Which module new ships of this class get. */
export function blueprintFor(s: GameState, p: PlayerId, cls: string): string | null {
  if (!on(s) || p < 0) return null;
  const m = lookup(s.players[p]?.blueprint, cls) ?? 'armor';
  const md = lookup(MODULE, m);
  return md && (md.tech === null || hasTech(s, p, md.tech)) ? m : 'armor';
}
/** Why `p` can't build this class at all (tech / vein), or null. Shipyard & money are checked elsewhere. */
export function classBlock(s: GameState, p: PlayerId, cls: string, conn?: Set<RegionId>): string | null {
  const d = lookup(s.rules.ships, cls);
  if (!d || !on(s)) return null;
  if (d.tech?.length && !d.tech.some(t => hasTech(s, p, t))) return `needs ${d.tech.map(t => TECH[t]?.name ?? t).join(' or ')}`;
  if (d.vein && !hasVein(s, p, d.vein, conn)) return `needs ${d.vein === 'antimatter' ? '⚛ Antimatter' : '◆ Crystals'} (an Extractor connected to your capital)`;
  return null;
}
/** Why `p` can't start this project here (tech / vein / trait), or null. */
export function projectBlock(s: GameState, p: PlayerId, key: string, rid: RegionId): string | null {
  const pd = lookup(s.rules.projects, key);
  const r = Number.isInteger(rid) ? s.regions[rid] : undefined;
  if (!pd || !r) return null;
  if (!on(s) && ['academy', 'extractor', 'battery', 'pshield', 'depot', 'gate'].includes(key)) return 'not in these rules';
  if (pd.tech && !hasTech(s, p, pd.tech)) return `needs ${TECH[pd.tech]?.name ?? pd.tech}`;
  if (pd.vein && !r.vein) return 'no vein here';
  if (pd.needs && !hasVein(s, p, pd.needs)) return `needs ${pd.needs === 'crystal' ? '◆ Crystals' : '⚛ Antimatter'} (an Extractor connected to your capital)`;
  // star systems: the citizens cap, body sites, citizen gates and slots (docs/SYSTEMS.md)
  const sb = systemsBlock(s, key, r);
  if (sb) return sb;
  if (key === 'mine' && !sysOn(s) && r.trait === 'gas') return 'gas giants have no surface to mine';
  return null;
}
/** The most citizens (development) a system can reach: its citizens cap with star systems, else maxDev (+1 on a Garden). */
export function maxDevAt(s: GameState, rid: RegionId): number {
  const r = s.regions[rid];
  const cap = r ? citizenCap(s, r) : null;
  if (cap !== null) return cap;
  return s.rules.economy.maxDev + (on(s) && r && worldFx(s, r).garden ? s.rules.empire.gardenDevBonus : 0);
}

// ------------------------------------------------------------------ cost modifiers
export function shipCostMod(s: GameState, p: PlayerId, cls: string, c: Partial<Res>): Partial<Res> {
  c = { ...c };   // never write through to the rules' own cost object
  if (!on(s)) return c;
  const E = s.rules.empire;
  if (c.industry && hasLaw(s, p, 'industrial')) c.industry = Math.round(c.industry * (1 - E.industrialShipDiscount));
  if (c.industry && cls === 'bombard' && hasTech(s, p, 'siege')) c.industry = Math.round(c.industry * 0.75);
  return c;
}
export function projectCostMod(s: GameState, p: PlayerId, key: string, rid: RegionId, c: Partial<Res>): Partial<Res> {
  const E = s.rules.empire;
  const r = s.regions[rid];
  // star systems: the waystation discount (military/logistics where citizens <= 1) and pulsar gates
  let m = systemCostMult(s, r, key);
  if (on(s) && key === 'develop') {
    if (hasLaw(s, p, 'federal')) m *= 1 - E.federalDevelopDiscount;
    if (r && worldFx(s, r).garden) m *= 1 - E.gardenDevelopDiscount;
  }
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
