// Star systems (docs/SYSTEMS.md, steps 1-4): stars and bodies, the citizens cap and growth, civil and
// military slots, build gates, the waystation discount and the black hole's gravity well; (step 4) bodies in the
// story: battlefields, the body-tagged ledger, body tags and Calling gates. Step 3 (Contested, Occupied,
// Tribute) lives in contest.ts.
// Pure helpers used by mapgen, the resolver, orders, the AI and the UI.
//
// Everything here is off (old behaviour) when the rules have no `systems` group, when it is disabled, or
// when the map was generated before systems existed (no star on the Throne): see sysOn.
import { SYSTEMS_DEFAULTS } from '../config/rules.ts';
import { BELT_NAMES, BODY_TAGS, BODY_TAG_ORDER, GIANT_NAMES, HAB_ADJ, MOON_NAMES, ORBITAL, RUIN_NAMES, type BodyKind, type BodyQuality, type StarKind, type SystemRole } from '../config/systems.ts';
import { Rng, hashString } from './rng.ts';
import type { Body, Feature, GameEvent, GameState, LedgerEntry, PlayerId, Region, RegionId, RegionKind } from './types.ts';

export type SysRules = typeof SYSTEMS_DEFAULTS.systems;
const cache = new WeakMap<object, SysRules>();

/** Are star systems on? Needs the `systems` rule group (enabled) AND a map generated with stars. */
export const sysOn = (s: GameState): boolean =>
  !!s.rules.systems && s.rules.systems.enabled !== false && s.regions[0]?.star !== undefined;
/** The systems knobs with defaults for anything missing. */
export function SY(s: GameState): SysRules {
  const r = s.rules.systems as SysRules | undefined;
  if (!r) return SYSTEMS_DEFAULTS.systems;
  let c = cache.get(r);
  if (!c) { c = { ...SYSTEMS_DEFAULTS.systems, ...r }; cache.set(r, c); }
  return c;
}
/** Systems on, and this region is a real system with a star (not a lane waypoint). */
export const sysAt = (s: GameState, r: Region | undefined): r is Region & { bodies: Body[] } =>
  !!r && sysOn(s) && r.kind !== 'lane' && Array.isArray(r.bodies);

// ------------------------------------------------------------------ building classes
/** Civil buildings take a civil slot (from bodies); military/logistics ones a military slot. */
export const CIVIL = ['mine', 'tradehub', 'extractor', 'academy', 'shipyard'] as const;
export const MILITARY = ['fortress', 'battery', 'pshield', 'sensor', 'depot', 'gate'] as const;
export const isCivil = (k: string) => (CIVIL as readonly string[]).includes(k);
export const isMilitary = (k: string) => (MILITARY as readonly string[]).includes(k);

// ------------------------------------------------------------------ bodies & roles
const has = (r: Region, k: BodyKind, q?: BodyQuality) => !!r.bodies?.some(b => b.kind === k && (!q || b.q === q));
const habitable = (r: Region) => r.bodies?.find(b => b.kind === 'habitable');

/** The derived role (never chosen): Core > Forge (rich barren) > Harbor > Forge (belt) > Waystation. Null on old maps / lanes. */
export function roleOf(r: Region): SystemRole | null {
  if (!r.bodies || r.kind === 'lane') return null;
  const h = habitable(r);
  if (h && (h.q === 'fair' || h.q === 'rich')) return 'core';
  if (has(r, 'barren', 'rich')) return 'forge';
  if (has(r, 'gas')) return 'harbor';
  if (has(r, 'belt')) return 'forge';
  return 'waystation';
}

/**
 * The old world traits, now carried by bodies (when systems are on; otherwise `Region.trait`):
 * Forge = a rich barren world, Garden = a rich habitable colony (homes, crowns and the Throne are rich
 * by birthright and get no Garden bonus), Bulwark = a moon with no habitable world, Gas = a gas giant.
 */
export function worldFx(s: GameState, r: Region): { forge: boolean; garden: boolean; bulwark: boolean; gas: boolean } {
  if (!sysAt(s, r)) return { forge: r.trait === 'forge', garden: r.trait === 'garden', bulwark: r.trait === 'bulwark', gas: r.trait === 'gas' };
  return {
    forge: has(r, 'barren', 'rich'),
    garden: r.kind === 'colony' && has(r, 'habitable', 'rich'),
    bulwark: has(r, 'moon') && !habitable(r),
    gas: has(r, 'gas'),
  };
}

/** Citizens cap: body caps + the star, clamped to 0..maxCitizens. Null when systems are off (use maxDev). */
export function citizenCap(s: GameState, r: Region): number | null {
  if (!sysAt(s, r)) return null;
  const Y = SY(s);
  const h = habitable(r);
  let cap = 0;
  if (h) {
    let hc = Y.capHabitable[h.q ?? 'fair'] ?? 0;
    if (r.star === 'yellow') hc += Y.capYellow;
    if (r.star === 'red') hc += Y.capRed;
    if (r.star === 'blue') hc = Math.min(hc, Y.blueHabitableMax);
    cap += Math.max(0, hc);
    cap += r.bodies.filter(b => b.kind === 'moon').length * Y.capMoon;
  }
  cap += r.bodies.filter(b => b.kind === 'barren').length * Y.capBarren;
  if ((r.buildings.station ?? 0) > 0) cap += Y.capStation;
  return Math.max(0, Math.min(Y.maxCitizens, cap));
}

let chokeMemo: { regions: Region[]; set: Set<RegionId> } | null = null;
/** Chokepoint overlay: `chokeDegree`+ borders, or a cut vertex of the system graph. */
export function isChokepoint(s: GameState, rid: RegionId): boolean {
  if (!chokeMemo || chokeMemo.regions !== s.regions) chokeMemo = { regions: s.regions, set: chokepoints(s) };
  return chokeMemo.set.has(rid);
}
function chokepoints(s: GameState): Set<RegionId> {
  const deg = SY(s).chokeDegree;
  const real = s.regions.filter(r => r.kind !== 'lane');
  const out = new Set<RegionId>(real.filter(r => r.neighbors.length >= deg).map(r => r.id));
  // articulation points (Tarjan) over real borders
  const disc = new Map<RegionId, number>(), low = new Map<RegionId, number>();
  let t = 0;
  const dfs = (u: RegionId, parent: RegionId) => {
    disc.set(u, t); low.set(u, t); t++;
    let kids = 0;
    for (const v of s.regions[u].neighbors) {
      if (s.regions[v]?.kind === 'lane') continue;
      if (!disc.has(v)) {
        kids++; dfs(v, u);
        low.set(u, Math.min(low.get(u)!, low.get(v)!));
        if (parent !== -1 && low.get(v)! >= disc.get(u)!) out.add(u);
      } else if (v !== parent) low.set(u, Math.min(low.get(u)!, disc.get(v)!));
    }
    if (parent === -1 && kids > 1) out.add(u);
  };
  if (real.length) dfs(real[0].id, -1);
  return out;
}

export interface Slots { civil: number; civilUsed: number; mil: number; milUsed: number }
/** Civil slots come from bodies (+1 for a Station); military/logistics slots are `milSlots` (+1 at chokepoints). */
export function slotsOf(s: GameState, r: Region): Slots | null {
  if (!sysAt(s, r)) return null;
  const Y = SY(s);
  const lv = (k: string) => (r.buildings[k] ?? 0) > 0;
  return {
    civil: r.bodies.length + ((r.buildings.station ?? 0) > 0 ? Y.stationCivilSlots : 0),
    civilUsed: CIVIL.filter(lv).length,
    mil: Y.milSlots + (isChokepoint(s, r.id) ? Y.chokeSlots : 0),
    milUsed: MILITARY.filter(lv).length,
  };
}

/** A waystation (citizens <= waystationCitizens) builds military/logistics projects cheaper. */
export const isWaystation = (s: GameState, r: Region) => sysAt(s, r) && r.dev <= SY(s).waystationCitizens;

/** Cost multiplier from the system for a project (waystation discount, pulsar gates). 1 = none. */
export function systemCostMult(s: GameState, r: Region | undefined, key: string): number {
  if (!sysAt(s, r)) return 1;
  const Y = SY(s);
  let m = 1;
  if (isMilitary(key) && isWaystation(s, r)) m *= 1 - Math.max(0, Math.min(1, Y.waystationDiscount));
  if (key === 'gate' && r.star === 'pulsar') m *= 1 - Math.max(0, Math.min(1, Y.pulsarGateDiscount));
  return m;
}

/**
 * Why this project can't start here under the systems rules (cap, site, gate, slot), or null.
 * Existing buildings are grandfathered: only new projects are checked.
 */
export function systemsBlock(s: GameState, key: string, r: Region): string | null {
  if (!sysAt(s, r)) return key === 'station' ? 'not in these rules' : null;
  const Y = SY(s);
  if (key === 'develop') {
    const cap = citizenCap(s, r)!;
    return r.dev >= cap ? `citizens at the cap (${r.dev}/${cap})${(r.buildings.station ?? 0) || cap >= Y.maxCitizens ? '' : ': a Station raises it'}` : null;
  }
  if (key === 'station') return (r.buildings.station ?? 0) > 0 ? 'already has a Station' : null;
  if (key === 'mine' && !r.bodies.some(b => b.kind === 'belt' || b.kind === 'barren') && !r.vein)
    return r.bodies.some(b => b.kind === 'gas') ? 'gas giants have no surface to mine' : 'no belt, barren world or vein to mine';
  if (key === 'tradehub' && !r.bodies.some(b => b.kind === 'habitable' || b.kind === 'gas')) return 'a Trade Hub needs a habitable world or a gas giant';
  if (key === 'shipyard' && r.dev < Y.shipyardCitizens && !(r.buildings.station ?? 0)) return `a Shipyard needs ${Y.shipyardCitizens} citizens or a Station (${r.dev} now)`;
  if (key === 'academy' && r.dev < Y.academyCitizens) return `an Academy needs ${Y.academyCitizens} citizens (${r.dev} now)`;
  if ((r.buildings[key] ?? 0) > 0) return null;   // a level-up uses the slot it already has
  const sl = slotsOf(s, r)!;
  if (isCivil(key) && sl.civilUsed >= sl.civil) return `no free civil slot (${sl.civilUsed}/${sl.civil})${(r.buildings.station ?? 0) ? '' : ': a Station adds one'}`;
  if (isMilitary(key) && sl.milUsed >= sl.mil) return `no free military slot (${sl.milUsed}/${sl.mil})`;
  return null;
}

/** Black hole: fleets entering this system stop here. */
export const gravityWell = (s: GameState, rid: RegionId): boolean => {
  const r = s.regions[rid];
  return !!r && r.star === 'blackhole' && sysOn(s) && SY(s).gravityWell !== false;
};

/** Owned-garrison bonus from the star (binary). */
export const starGarrison = (s: GameState, r: Region): number => (sysAt(s, r) && r.star === 'binary' ? SY(s).binaryGarrison : 0);
/** Sensor range bonus from the star (pulsar) for the system's owner. */
export const starSensor = (s: GameState, r: Region): number => (sysAt(s, r) && r.star === 'pulsar' ? SY(s).pulsarSensor : 0);
/** Extra industry from the star (blue giant: per Mine and Extractor level). */
export const starIndustry = (s: GameState, r: Region): number =>
  (sysAt(s, r) && r.star === 'blue' ? SY(s).blueMineIndustry * ((r.buildings.mine ?? 0) + (r.buildings.extractor ?? 0)) : 0);

/**
 * End of turn: an owned, uncontested Core below its cap banks a turn of growth; every `growthEvery`
 * (a Garden: `gardenGrowthEvery`) it gains a citizen. Contested turns neither grow nor reset the count.
 */
export function growSystem(s: GameState, r: Region, contested: boolean, pulse: number, emit: (e: GameEvent) => void) {
  if (!sysAt(s, r) || r.owner === null || roleOf(r) !== 'core') return;
  const cap = citizenCap(s, r)!;
  if (r.dev >= cap) { r.growth = 0; return; }
  if (contested) return;
  const Y = SY(s);
  const every = Math.max(1, worldFx(s, r).garden ? Y.gardenGrowthEvery : Y.growthEvery);
  r.growth = (r.growth ?? 0) + 1;
  if (r.growth >= every) {
    r.growth = 0;
    r.dev = Math.min(cap, r.dev + 1);
    emit({ k: 'note', pulse, owner: r.owner, text: `${r.name} grows: citizens ${r.dev}/${cap}.`, region: r.id });
  }
}

// ------------------------------------------------------------------ map generation
export interface BodyPlan { kind: BodyKind; q?: BodyQuality; vein?: string | null }
export interface SystemPlan { star: StarKind; bodies: BodyPlan[] }
interface SiteLike { kind: RegionKind; feature: Feature; trait?: string | null; vein?: string | null }

/**
 * The star and bodies of one wedge-template site (so all three wedges get the same systems, rotated).
 * The old fields decide the anchor body: trait forge → rich barren, garden → rich habitable, bulwark →
 * a lone moon, gas → gas giant; asteroids → a belt; antimatter sits on a gas giant, crystals on a belt.
 * Flavour bodies never carry an old trait's effect (no extra gas giants, rich worlds or lone moons), so
 * yields and garrisons match the old traits.
 */
export function planSystem(rng: Rng, t: SiteLike, relicIdx: number): SystemPlan {
  const pick = <T>(a: readonly T[]) => a[Math.floor(rng.next() * a.length)];
  const B: BodyPlan[] = [];
  let star: StarKind;
  const filler = (opts: BodyPlan[]) => { const b = pick(opts); B.push({ ...b }); };
  switch (t.kind) {
    case 'throne': return { star: 'yellow', bodies: [{ kind: 'habitable', q: 'rich' }, { kind: 'ruin' }, { kind: 'moon' }] };
    case 'home': star = 'yellow'; B.push({ kind: 'habitable', q: 'rich' }, { kind: 'moon' }, { kind: 'belt' }); break;
    case 'crown':
      star = pick(['yellow', 'binary'] as const);
      B.push({ kind: 'habitable', q: 'rich' }, { kind: 'ruin' });
      filler([{ kind: 'moon' }, { kind: 'belt' }]);
      break;
    case 'relic':
      // relic sites: a Ruin under a pulsar or (the second one per wedge) a black hole
      star = relicIdx % 2 === 1 ? 'blackhole' : 'pulsar';
      B.push({ kind: 'ruin' });
      if (rng.next() < 0.6) filler([{ kind: 'barren', q: 'poor' }, { kind: 'belt' }]);
      break;
    case 'void':
      star = pick(['red', 'pulsar'] as const);
      if (t.vein === 'antimatter') B.push({ kind: 'gas', vein: 'antimatter' });
      else if (t.vein === 'crystal') B.push({ kind: 'belt', vein: 'crystal' });
      else if (rng.next() < 0.5) B.push({ kind: 'barren', q: 'poor' });
      break;
    default: {
      // colonies
      if (t.vein === 'antimatter') {
        star = pick(['red', 'blue', 'yellow', 'binary'] as const);
        B.push({ kind: 'gas', vein: 'antimatter' });
        filler([{ kind: 'barren', q: 'poor' }, { kind: 'belt' }, { kind: 'habitable', q: 'poor' }]);
      } else if (t.vein === 'crystal') {
        star = pick(['red', 'blue', 'yellow', 'binary'] as const);
        B.push({ kind: 'belt', vein: 'crystal' });
        filler([{ kind: 'barren', q: 'poor' }, { kind: 'habitable', q: 'poor' }]);
      } else if (t.trait === 'garden') {
        star = pick(['yellow', 'binary'] as const);
        B.push({ kind: 'habitable', q: 'rich' }, { kind: 'moon' });
      } else if (t.trait === 'forge') {
        star = pick(['blue', 'red'] as const);
        B.push({ kind: 'barren', q: 'rich' });
        filler([{ kind: 'belt' }, { kind: 'habitable', q: 'poor' }]);
      } else if (t.trait === 'gas') {
        star = pick(['yellow', 'red', 'blue', 'pulsar'] as const);
        B.push({ kind: 'gas' });
        filler([{ kind: 'belt' }, { kind: 'barren', q: 'poor' }]);
      } else if (t.trait === 'bulwark') {
        star = pick(['red', 'blue', 'pulsar', 'binary'] as const);
        B.push({ kind: 'moon' });
        filler([{ kind: 'barren', q: 'poor' }, { kind: 'belt' }]);
      } else {
        // a plain colony: a fair world (a border Core)
        star = pick(['yellow', 'red', 'binary'] as const);
        B.push({ kind: 'habitable', q: 'fair' });
        filler([{ kind: 'moon' }, { kind: 'belt' }, { kind: 'barren', q: 'poor' }]);
      }
    }
  }
  // pulsars and black holes have no habitable world (only bulwark/gas/relic/void sites roll them, none habitable)
  if (t.feature === 'asteroids' && !B.some(b => b.kind === 'belt')) {
    if (B.length < 3) B.push({ kind: 'belt' });
    else B[B.length - 1] = { kind: 'belt' };
  }
  // a binary may hold a third body
  if (star === 'binary' && B.length < 3) {
    const hab = B.some(b => b.kind === 'habitable');
    filler(hab ? [{ kind: 'moon' }, { kind: 'belt' }, { kind: 'barren', q: 'poor' }] : [{ kind: 'belt' }, { kind: 'barren', q: 'poor' }]);
  }
  return { star, bodies: B.slice(0, 3) };
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];
/** Evocative, deterministic names for a system's bodies ("Vel II", "the Ashen Belt", "Tyr"). */
export function nameBodies(plan: SystemPlan, regionName: string, kind: RegionKind, seed: number, id: number): Body[] {
  const rng = new Rng(hashString(`${seed}|bodies|${id}`));
  const pick = <T>(a: readonly T[]) => a[Math.floor(rng.next() * a.length)];
  const stem = regionName.replace(/^The /, '');
  return plan.bodies.map((b, i) => {
    const out: Body = { kind: b.kind, name: '' };
    if (b.q) out.q = b.q;
    if (b.vein) out.vein = b.vein;
    switch (b.kind) {
      case 'habitable':
        out.adj = pick(HAB_ADJ[b.q ?? 'fair']);
        out.name = kind === 'throne' ? 'the Throneworld' : `${stem} ${ROMAN[i + 1]}`;
        break;
      case 'barren': out.name = `${stem} ${ROMAN[i + 1]}`; break;
      case 'gas': out.name = pick(GIANT_NAMES); break;
      case 'belt': out.name = `the ${pick(BELT_NAMES)} Belt`; break;
      case 'moon': out.name = pick(MOON_NAMES); break;
      case 'ruin': out.name = kind === 'throne' ? 'the Ring' : `the ${pick(RUIN_NAMES)}`; break;
    }
    return out;
  });
}

/** One line for a body: "Vel II · rich ocean world (cap 4)". */
export function bodyLine(b: Body): string {
  const q = b.q ? `${b.q} ` : '';
  switch (b.kind) {
    case 'habitable': return `${q}${b.adj ?? ''} world`.replace(/\s+/g, ' ').trim();
    case 'barren': return b.q === 'rich' ? 'rich barren world (forge)' : 'barren world';
    case 'gas': return 'gas giant';
    case 'belt': return 'asteroid belt';
    case 'moon': return 'moon';
    case 'ruin': return 'ruins';
  }
}

/** Convenience for UIs: everything about a system's economy in one object (null when systems are off). */
export function systemInfo(s: GameState, rid: RegionId, p?: PlayerId) {
  const r = s.regions[rid];
  if (!sysAt(s, r)) return null;
  void p;
  return { role: roleOf(r), cap: citizenCap(s, r)!, citizens: r.dev, slots: slotsOf(s, r)!, choke: isChokepoint(s, r.id), waystation: isWaystation(s, r), growth: r.growth ?? 0 };
}

/**
 * AI: would a Station unblock this project here (a full civil slot, the Shipyard gate, the citizens cap)?
 * The planner then offers the Station instead of a project it can't start.
 */
export function stationUnblocks(s: GameState, key: string, r: Region): boolean {
  if (!sysAt(s, r) || (r.buildings.station ?? 0) > 0 || r.kind === 'lane' || key === 'station') return false;
  if (!systemsBlock(s, key, r)) return false;
  r.buildings.station = 1;
  try { return !systemsBlock(s, key, r); } finally { delete r.buildings.station; }
}
/** AI: value multiplier for a military/logistics project here (the waystation discount and pulsar gates make it cheaper). */
export const aiSiteBonus = (s: GameState, r: Region, key: string): number => (1 - systemCostMult(s, r, key)) * 2;

// ------------------------------------------------------------------ step 3 support: tribute & orbital bodies
/** An accepted Tribute between these two houses covers this system: they do not fight there. */
export function tributeCovers(s: GameState, a: number, b: number, rid: RegionId): boolean {
  const t = tributeInForce(s, s.regions[rid]);
  return !!t && ((t.from === a && t.to === b) || (t.from === b && t.to === a));
}
/** The system's Tribute while it runs (not lapsed, paid by its current owner, to a house still in the game), or null. */
export function tributeInForce(s: GameState, r: Region | undefined): NonNullable<Region['tribute']> | null {
  const t = r?.tribute;
  return t && s.turn < t.until && t.from === r!.owner && s.players[t.to] && !s.players[t.to].eliminated ? t : null;
}
/** Index of the Station in body-tagged records (bodies hold at most 3). */
export const BODY_STATION = 3;
const stem = (r: Region) => r.name.replace(/^The /, '');
const hasStation = (r: Region) => (r.buildings.station ?? 0) > 0;
/** The kind of a body index (3 = the Station), or null. */
export function bodyKindAt(r: Region, idx: number | undefined): BodyKind | 'station' | null {
  if (idx === undefined) return null;
  if (idx === BODY_STATION) return hasStation(r) ? 'station' : null;
  return r.bodies?.[idx]?.kind ?? null;
}
/** Is this body orbital (gas giant, belt, Station)? An index with no body (`undefined`) is open space: orbital. */
export const isOrbitalAt = (r: Region, idx: number | undefined): boolean => { const k = bodyKindAt(r, idx); return k === null ? true : ORBITAL[k]; };
/** A body's name ("Vel II", "the Ashen Belt", "Vel Station"), or null. */
export function bodyName(r: Region, idx: number | undefined): string | null {
  const k = bodyKindAt(r, idx);
  if (k === null) return null;
  return k === 'station' ? `${stem(r)} Station` : r.bodies![idx!].name;
}
const firstOf = (r: Region, kinds: BodyKind[]): number | undefined => {
  for (const k of kinds) { const i = (r.bodies ?? []).findIndex(b => b.kind === k); if (i >= 0) return i; }
  return undefined;
};
/**
 * Where a system's people live (its citizens' output, refugees, captures, tribute): the habitable world, else a
 * barren world or moon, else the Station, else open space (undefined).
 */
export function citizenBody(r: Region): number | undefined {
  return firstOf(r, ['habitable', 'barren', 'moon', 'ruin']) ?? (hasStation(r) ? BODY_STATION : undefined);
}
/** The body each kind of output comes from (for the blockade split and the card's per-body rows). */
export function outputBodies(r: Region) {
  const vi = (r.bodies ?? []).findIndex(b => !!b.vein);
  const vein = vi >= 0 ? vi : undefined;
  return {
    cit: citizenBody(r),
    forge: firstOf(r, ['barren']),
    mine: firstOf(r, ['belt', 'barren']) ?? vein,
    hub: firstOf(r, ['habitable', 'gas']),
    gas: firstOf(r, ['gas']),
    vein,
    depot: hasStation(r) ? BODY_STATION : undefined,
  };
}

// ------------------------------------------------------------------ step 4: bodies in the story
/**
 * The deterministic battlefield of a new engagement: a siege is fought over the habitable world (else the
 * Station); an ambush or interception at the belt; otherwise a body picked by hash. undefined when systems are off.
 */
export function battleBody(s: GameState, r: Region, siege: boolean): number | undefined {
  if (!sysAt(s, r)) return undefined;
  const pick = siege ? firstOf(r, ['habitable']) ?? (hasStation(r) ? BODY_STATION : undefined) : firstOf(r, ['belt']);
  if (pick !== undefined) return pick;
  const all = [...r.bodies.map((_, i) => i), ...(hasStation(r) ? [BODY_STATION] : [])];
  return all.length ? all[hashString(`${s.seed}:${r.id}:${r.battles}:field`) % all.length] : undefined;
}
/** "Battle of the Ashen Belt (Vel)" (null when the battle has no body). */
export function battleName(r: Region, body: number | undefined, kind: string, ord: string): string | null {
  const n = bodyName(r, body);
  return n ? `${ord}${kind} of ${n} (${r.name})` : null;
}
/** Add an entry to a system's ledger (needs the Soul layer's story) and count it on its body for body tags. */
export function ledgerAdd(s: GameState, r: Region, e: LedgerEntry) {
  if (!sysAt(s, r) || !r.story) return;
  const L = (r.story.ledger ??= []);
  const entry: LedgerEntry = { ...e };
  if (entry.body === undefined) delete entry.body;
  L.push(entry);
  const keep = Math.max(1, SY(s).ledgerKeep);
  if (L.length > keep) L.splice(0, L.length - keep);
  if (e.body !== undefined && bodyKindAt(r, e.body)) {
    const m = (r.story.bodyMarks ??= {});
    const x = (m[String(e.body)] ??= {});
    x[e.kind] = (x[e.kind] ?? 0) + 1;
  }
}
/** A body's tag ("the Burned World"), earned after bodyTagEvents events there; at most one per body. */
export function bodyTag(s: GameState, r: Region, idx: number): string | null {
  if (!sysAt(s, r)) return null;
  const k = bodyKindAt(r, idx);
  const m = r.story?.bodyMarks?.[String(idx)];
  if (!k || !m) return null;
  const total = BODY_TAG_ORDER.reduce((a, k) => a + (m[k] ?? 0), 0);
  if (total < Math.max(1, SY(s).bodyTagEvents)) return null;
  let best: string | null = null;
  for (const kind of BODY_TAG_ORDER) if ((m[kind] ?? 0) > 0 && (best === null || m[kind] > m[best])) best = kind;
  return best ? BODY_TAGS[best]?.[k] ?? null : null;
}
/** "Vel II, the Burned World" (or just the name). */
export function taggedBodyName(s: GameState, r: Region, idx: number): string {
  const n = bodyName(r, idx) ?? '?';
  const t = bodyTag(s, r, idx);
  return t ? `${n}, ${t}` : n;
}

/** Why this world can't take that Calling (star systems: the bodies or history it lacks), or null. */
export function callingGate(s: GameState, r: Region, id: string): string | null {
  if (!sysAt(s, r) || SY(s).callingGates === false) return null;
  const B = r.bodies;
  switch (id) {
    case 'granary': return B.some(b => b.kind === 'habitable') ? null : 'needs a habitable world';
    case 'refinery': return B.some(b => b.kind === 'belt' || b.kind === 'gas') || r.vein ? null : 'needs a belt, gas giant or vein';
    case 'oracle': return B.some(b => b.kind === 'ruin') || r.star === 'pulsar' ? null : 'needs a ruin or a pulsar';
    case 'arsenal': return (r.buildings.shipyard ?? 0) > 0 ? null : 'needs a shipyard';
    case 'cenotaph': { const n = SY(s).cenotaphBattles; return r.battles >= n ? null : `needs ${n} battles fought here (${r.battles} so far)`; }
  }
  return null;
}
