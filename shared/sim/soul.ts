// ============================================================================
//  THE SOUL LAYER (docs/SOUL.md, phase A): fleets as characters, worlds with a
//  story, blood-debts. Pure helpers and resolver hooks; the Herald and the Saga
//  live in herald.ts, ship traits in shiptraits.ts. Every number: rules.soul.
//
//  Design decisions (the contract for the UI):
//  - Founding: a Build with fleet:null raises a new BANNER (Build.found = name,
//    sigil, boons, banes; missing = deterministic defaults from foundingOffer).
//    It needs a free banner: bannersBase + 1 per Crown held (maxFleets is still
//    the hard cap). Scout-only fleets are PICKETS: no banner, no boons, and they
//    only carry scouts. A split founds a new banner the same way (FreeAction
//    split.found). There are no anonymous fleets any more.
//  - Fleet modifiers are point-buy (Fallout traits): boons cost points, banes
//    give them back; boon cost <= bane value + soul.freePoints, max 3 + 3.
//  - Defeat routs instead of erasing (see routFate). Limping fleets auto-route
//    home and die if caught.
//  - Choices (honours, callings) are free actions; unpicked ones default to the
//    first option after soul.honourAutoTurns turns. The AI picks at once.
// ============================================================================
import { BOONS, BANES, SIGILS, VOWS, SCARS, CALLINGS, TRAIT_CALLING, MARK_CALLING, DEEDS, WORLD_EPITHETS, FOUNDING_NAMES, LEGEND_EPITHETS, HERALD_TEMPLATES } from '../config/content.ts';
import { SOUL_DEFAULTS } from '../config/rules.ts';
import { hashString } from './rng.ts';
import { callingGate } from './systems.ts';
import type { Banner, Deed, Fleet, FleetRecord, FoundSpec, GameEvent, GameState, Headline, PlayerId, Region, RegionId, RegionStory, SoulState, Vow, VowKind } from './types.ts';

export type SoulRules = typeof SOUL_DEFAULTS.soul;
export const RANK_NAMES = ['', 'Untried', 'Blooded', 'Veteran', 'Storied', 'Legend'];

const cache = new WeakMap<object, SoulRules>();
/** Is the Soul layer on in these rules? (Old saves without a `soul` rule group: off.) */
export const soulOn = (s: GameState): boolean => !!s.rules.soul && s.rules.soul.enabled !== false;
/** The soul knobs with defaults for anything missing (rules from an older version). */
export function SR(s: GameState): SoulRules {
  const r = s.rules.soul as SoulRules | undefined;
  if (!r) return SOUL_DEFAULTS.soul;
  let c = cache.get(r);
  if (!c) { c = { ...SOUL_DEFAULTS.soul, ...r }; cache.set(r, c); }
  return c;
}
const tierOf = (arr: number[] | undefined, i: number) => (arr && arr.length ? arr[Math.max(0, Math.min(arr.length - 1, i))] : 0);
const hostileP = (s: GameState, a: number, b: number) => {
  if (a === b) return false;
  if (a === -1 || b === -1) return true;
  return !s.pacts.some(x => x.until >= s.turn && ((x.a === a && x.b === b) || (x.a === b && x.b === a)));
};
const pname = (s: GameState, p: PlayerId | -1 | null | undefined) => (p === -1 ? 'the Warden' : p === null || p === undefined ? 'no one' : s.players[p]?.name ?? '?');

// ------------------------------------------------------------------ state
export function emptySoulState(): SoulState {
  return { debts: [], reigns: [], herald: [], beats: [], dispatches: [], fallen: [], moments: [] };
}
export function newStory(r: Region): RegionStory {
  return {
    toil: 0, blood: 0, siege: 0, relic: 0, loss: r.memorials?.length ?? 0,
    owners: r.owner !== null ? [{ p: r.owner, turn: r.heldSince || 1, how: 'start' }] : [],
    epithet: null, calling: null, pendingCalling: null, tenureFrom: r.heldSince || 1, deeds: [],
  };
}
/** Create any missing Soul state (new games, old saves). Returns null when the layer is off. */
export function ensureSoul(s: GameState): SoulState | null {
  if (!soulOn(s)) return null;
  const st = (s.soul ??= emptySoulState());
  st.debts ??= []; st.reigns ??= []; st.herald ??= []; st.beats ??= []; st.dispatches ??= []; st.fallen ??= []; st.moments ??= [];
  for (const r of s.regions) if (!r.story) r.story = newStory(r);
  for (const f of s.fleets) if (f.owner >= 0 && f.banner === undefined && f.ships.some(sh => sh.cls !== 'scout')) {
    // a fleet from before banners existed: it flies a plain banner (no boons, no banes)
    f.banner = { sigil: SIGILS[(f.id + f.owner) % SIGILS.length].id, boons: [], banes: [], home: s.players[f.owner]?.capital ?? f.region, foundedTurn: f.bornTurn };
  }
  return st;
}

// ------------------------------------------------------------------ banners & founding
export const isPicket = (f: Fleet) => !f.banner;
export const bannered = (s: GameState, p: PlayerId) => s.fleets.filter(f => f.owner === p && f.ships.length && f.banner);
export function bannerLimit(s: GameState, p: PlayerId): number {
  const S = SR(s);
  return S.bannersBase + S.bannersPerCrown * s.regions.filter(r => r.kind === 'crown' && r.owner === p).length;
}
export const bannersFree = (s: GameState, p: PlayerId) => bannerLimit(s, p) - bannered(s, p).length;

/** Point-buy accounting for a set of boons and banes. */
export function modPoints(boons: string[], banes: string[]) {
  const cost = boons.reduce((a, b) => a + (Object.hasOwn(BOONS, b) ? BOONS[b].cost : 99), 0);
  const value = banes.reduce((a, b) => a + (Object.hasOwn(BANES, b) ? BANES[b].cost : 0), 0);
  return { cost, value };
}
/** The house a Grudge-bound fleet hates when none is named: the next living rival in seat order. */
const defaultGrudge = (s: GameState, p: PlayerId) => {
  for (let i = 1; i < s.players.length; i++) { const q = s.players[(p + i) % s.players.length]; if (!q.eliminated) return q; }
  return undefined;
};
/** Why this boon/bane selection is not allowed, or null. */
export function modsBlock(s: GameState, p: PlayerId, boons: unknown, banes: unknown, grudgeVs?: unknown): string | null {
  const S = SR(s);
  if (!Array.isArray(boons) || !Array.isArray(banes)) return 'bad modifiers';
  if (boons.some(b => typeof b !== 'string' || !Object.hasOwn(BOONS, b))) return 'unknown boon';
  if (banes.some(b => typeof b !== 'string' || !Object.hasOwn(BANES, b))) return 'unknown bane';
  if (new Set(boons).size !== boons.length || new Set(banes).size !== banes.length) return 'a modifier is listed twice';
  if (boons.length > S.maxBoons) return `at most ${S.maxBoons} boons`;
  if (banes.length > S.maxBanes) return `at most ${S.maxBanes} banes`;
  const { cost, value } = modPoints(boons, banes);
  if (cost > value + S.freePoints) return `boons cost ${cost} points but banes give only ${value}${S.freePoints ? ` (+${S.freePoints} free)` : ''}`;
  if (banes.includes('grudgebound')) {
    if (grudgeVs !== undefined && (!Number.isInteger(grudgeVs) || grudgeVs === p || !s.players[grudgeVs as number])) return 'Grudge-bound needs a rival house';
    // a grudge against a fallen house never bites: its points would be free
    const vs = grudgeVs !== undefined ? s.players[grudgeVs as number] : defaultGrudge(s, p);
    if (!vs || vs.eliminated) return 'Grudge-bound needs a living rival house';
  }
  if (boons.includes('ghosts') && banes.includes('conspicuous')) return 'a fleet cannot be both Ghosts and Conspicuous';
  return null;
}

/** What the founding dialog offers at a world: 3 suggested names, a default sigil, the point budget. Pure and deterministic. */
export function foundingOffer(s: GameState, p: PlayerId, region: RegionId): { names: string[]; sigil: string; freePoints: number; bannersFree: number; bannerLimit: number } {
  const S = SR(s);
  const home = s.regions[region]?.name ?? 'Home';
  const used = new Set(s.fleets.map(f => f.name));
  const h = hashString(`${s.seed}:${s.turn}:${p}:${region}`);
  const names: string[] = [];
  for (let i = 0; i < FOUNDING_NAMES.length && names.length < 3; i++) {
    const n = FOUNDING_NAMES[(h + i * 5) % FOUNDING_NAMES.length].replace('{home}', home).slice(0, 40);
    if (!used.has(n) && !names.includes(n)) names.push(n);
  }
  const mine = new Set(s.fleets.filter(f => f.owner === p && f.banner).map(f => f.banner!.sigil));
  const sigil = SIGILS.map((_, i) => SIGILS[(i + p * 4) % SIGILS.length].id).find(x => !mine.has(x)) ?? SIGILS[p % SIGILS.length].id;
  return { names, sigil, freePoints: S.freePoints, bannersFree: soulOn(s) ? bannersFree(s, p) : 0, bannerLimit: soulOn(s) ? bannerLimit(s, p) : 0 };
}

/** Normalize founding data (defaults filled in), or an error. */
export function resolveFound(s: GameState, p: PlayerId, region: RegionId, spec?: FoundSpec | null): { name: string; banner: Banner } | string {
  const off = foundingOffer(s, p, region);
  const boons = spec?.boons ?? [], banes = spec?.banes ?? [];
  const err = modsBlock(s, p, boons, banes, spec?.grudgeVs);
  if (err) return err;
  const sigil = spec?.sigil && SIGILS.some(x => x.id === spec.sigil) ? spec.sigil : off.sigil;
  const name = cleanText(spec?.name ?? '', 40) || off.names[0] || 'New Banner';
  const grudgeVs = banes.includes('grudgebound') ? (Number.isInteger(spec?.grudgeVs) ? spec!.grudgeVs! : defaultGrudge(s, p)?.id ?? (p + 1) % s.players.length) : null;
  return { name, banner: { sigil, boons: boons.slice(), banes: banes.slice(), grudgeVs, home: region, foundedTurn: s.turn } };
}

/** Raise a banner over a fleet (founding). */
export function raiseBanner(s: GameState, f: Fleet, name: string, banner: Banner) {
  f.name = name;
  f.banner = banner;
  f.tally = { sieges: 0, defences: 0, interceptions: 0, wins: 0, routs: 0 };
  if (banner.banes.includes('reckless') && f.doctrine.stance === 'evasive') f.doctrine = { ...f.doctrine, stance: 'defensive' };
  sagaBeat(f, s.turn, 'founded', `Founded at ${s.regions[banner.home]?.name ?? '?'}${banner.boons.length ? ` (${banner.boons.map(b => BOONS[b]?.name ?? b).join(', ')})` : ''}.`, banner.home);
}

/** Strip control characters and markup, collapse whitespace, cap the length. */
export function cleanText(x: unknown, max: number): string {
  if (typeof x !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const t = x.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff<>]/g, ' ')
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '')   // lone surrogates
    .replace(/\s+/g, ' ').trim();
  let out = t.slice(0, max);
  if (/[\ud800-\udbff]$/.test(out)) out = out.slice(0, -1);   // don't cut an emoji in half
  return out.trim();
}

// ------------------------------------------------------------------ modifiers
export function hasBoon(s: GameState, f: Fleet | null | undefined, id: string): boolean {
  if (!f || !f.banner || !soulOn(s)) return false;
  if ((f.sulkUntil ?? -1) >= s.turn) return false;   // Grudge-bound and sulking: boons fail
  if (f.banner.boons.includes(id) || (f.honours ?? []).some(h => h.id === id)) return true;
  const r = s.regions[f.region];
  return !!r?.story && r.owner === f.owner && r.story.deeds.some(d => d.id === 'haven' && d.boon === id);
}
export const hasBane = (s: GameState, f: Fleet | null | undefined, id: string) => !!f?.banner && soulOn(s) && f.banner.banes.includes(id);
export const scarOf = (f: Fleet | null | undefined, id: string) => f?.scars?.find(x => x.id === id);
/** All boons a fleet has right now (banner, honours, a Haven it stands in). */
export function boonsOf(s: GameState, f: Fleet): string[] {
  return Object.keys(BOONS).filter(b => hasBoon(s, f, b));
}

/** Movement change from banes, boons, scars, limping and the relic vow (fleetSpeed applies it, minimum 1). */
export function soulSpeedMod(s: GameState, f: Fleet): number {
  if (!soulOn(s) || !f.banner && !f.limping) return 0;
  const S = SR(s);
  let d = 0;
  if (f.limping) d -= S.limpSpeedPenalty;
  if (hasBoon(s, f, 'longrange')) d += 1;
  if (hasBane(s, f, 'ponderous')) d -= 1;
  if (scarOf(f, 'haunted')) d -= S.hauntedSpeed;
  // the relic vow speeds the fleet only on its way home with the relic
  if (f.vow?.kind === 'relic' && f.vow.carrying && f.banner && f.route?.path.length && f.route.path[f.route.path.length - 1] === f.banner.home) d += S.vowRelicSpeed;
  return d;
}

// ------------------------------------------------------------------ combat hooks
export interface SoulHitCtx {
  region: Region;
  moved: (f: Fleet) => boolean;       // came in this turn
  outnumbered: boolean;               // shooter's side has fewer hulls
  enemiesHaunted: boolean;            // a haunted fleet fights the shooter
  homeDist?: (f: Fleet) => number;
}
/** Hit-chance change for a shot from fleet `f` (null = garrison) at `tf` (null = garrison of `tgOwner`). */
export function soulHit(s: GameState, f: Fleet | null, tf: Fleet | null, tgOwner: PlayerId | -1, c: SoulHitCtx): number {
  if (!soulOn(s)) return 0;
  const S = SR(s);
  let h = 0;
  const r = c.region;
  if (f && f.owner >= 0) {
    const v = f.vow;
    if (v?.kind === 'throne' && r.kind === 'throne') h += S.vowThroneHit;
    if (v?.kind === 'never_retreat') h += S.vowNeverRetreatHit;
    if (v?.kind === 'guard' && v.region === r.id) h += S.vowGuardHit;
    if (hasBane(s, f, 'green') && f.commander.deeds.wins + f.commander.deeds.losses === 0) h -= S.greenHit;
    if (tf && hasBoon(s, f, 'hunters') && (tf.limping || tf.scars?.length)) h += S.hunterHit;
    const g = scarOf(f, 'grudge');
    if (g && tgOwner !== g.vs) h -= S.grudgeOtherHit;
    if (scarOf(f, 'skeleton')) h -= S.skeletonHit;
    if (scarOf(f, 'burned') && c.outnumbered) h += S.burnedNerveHit;
    h += debtHit(s, f.owner, tgOwner, tf?.commander.name);
    if ((s.players[f.owner]?.vendettas ?? []).some(x => x.vs === tgOwner && x.until >= s.turn)) h += S.vendettaHit;
    if (r.owner === f.owner && r.story) {
      if (r.story.deeds.some(d => d.id === 'fell')) h += S.deedFellHit;
      const t = callingTier(s, r, 'cenotaph');
      if (t >= 0) h += tierOf(S.cenotaphHit, t);
    }
  }
  if (c.enemiesHaunted) h -= S.hauntedMorale;
  if (tf && tf.vow?.kind === 'guard' && tf.vow.region === r.id) h -= S.vowGuardEvasion;
  return h;
}
/** Extra damage per hit from fleet `f` against a ship of fleet `tf`. */
export function soulDmg(s: GameState, f: Fleet | null, tf: Fleet | null): number {
  if (!soulOn(s) || !tf) return 0;
  const S = SR(s);
  let d = 0;
  if (f && f.vow?.kind === 'avenge' && avengeHits(f.vow, tf.commander.name, tf.owner)) d += S.vowAvengeDmg;
  const g = scarOf(f, 'grudge');
  if (g && g.vs === tf.owner) d += S.grudgeDmg;
  if (hasBane(s, tf, 'glass')) d += S.glassDmg;
  return d;
}
/** Extra siege damage per hit against a garrison (boons/honours), minus the world's Bulwark calling. */
export function soulSiege(s: GameState, f: Fleet | null, r: Region): number {
  if (!soulOn(s)) return 0;
  const S = SR(s);
  let d = f && hasBoon(s, f, 'siegebreakers') ? S.siegebreakerSiege : 0;
  const t = callingTier(s, r, 'bulwark');
  if (t >= 0) d -= tierOf(S.bulwarkSiegeCut, t);
  return d;
}
/** Extra garrison armor from deeds and callings. */
export function soulArmor(s: GameState, r: Region): number {
  if (!soulOn(s) || !r.story || r.owner === null) return 0;
  const S = SR(s);
  let a = r.story.deeds.some(d => d.id === 'unbroken') ? S.deedUnbrokenArmor : 0;
  const t = callingTier(s, r, 'cenotaph');
  if (t >= 0) a += tierOf(S.cenotaphArmor, t);
  return a;
}
/** Rounds added to (or taken from) the moment this owner's side is forced out. */
export function soulForceRounds(s: GameState, fleets: Fleet[]): number {
  if (!soulOn(s)) return 0;
  const S = SR(s);
  let n = 0;
  if (fleets.some(f => hasBoon(s, f, 'iron'))) n += S.ironRounds;
  if (fleets.some(f => hasBane(s, f, 'brittle'))) n -= S.brittleRounds;
  return n;
}
/** Does this fleet want to retreat voluntarily at this strength (frac of its starting hp)? */
export function soulWantsRetreat(s: GameState, f: Fleet, frac: number, base: boolean): boolean {
  if (!soulOn(s) || !f.banner) return base;
  if (f.vow?.kind === 'never_retreat') return false;
  let want = base;
  if (hasBane(s, f, 'brittle') && frac < SR(s).brittleRetreat) want = true;
  if (hasBoon(s, f, 'iron') && frac >= SR(s).ironHoldFrac) want = false;
  return want;
}
export function debtHit(s: GameState, shooter: PlayerId | -1, target: PlayerId | -1, targetCmd?: string): number {
  if (!soulOn(s) || shooter < 0 || target < 0 || !s.soul) return 0;
  const S = SR(s);
  let h = 0;
  for (const d of s.soul.debts) {
    if (d.cleared || d.creditor !== shooter || d.debtor !== target) continue;
    h = Math.max(h, S.debtHit + (targetCmd && d.killer === targetCmd ? S.debtKillerHit : 0));
  }
  return h;
}

// ------------------------------------------------------------------ rout
/**
 * A beaten bannered fleet routs unless: it was hopelessly outmatched (own strength < routMinStrength of
 * the winner's), it is trapped (no exit free of hostile fleets and garrisons), it is already limping,
 * it routed within the last routRepeatTurns turns, or it was routed by another rival before (and is caught
 * by a second one: covered by the two previous rules). Returns why it dies, or null if it routs.
 */
export function routBlock(s: GameState, f: Fleet, own: number, winner: number, exit: RegionId | null): string | null {
  if (!soulOn(s) || !f.banner || f.owner < 0) return 'no banner';
  const S = SR(s);
  if (f.limping) return 'caught limping';
  if ((f.routs ?? []).some(t => s.turn - t < S.routRepeatTurns)) return 'routed twice';
  if (exit === null) return 'trapped';
  if (own < S.routMinStrength * winner) return 'hopelessly outmatched';
  return null;
}
/** A safe exit for a rout: no hostile fleets, no hostile garrison. Prefers where it came from, then own worlds. */
export function routExit(s: GameState, f: Fleet, from: RegionId, cameFrom: RegionId | undefined): RegionId | null {
  const safe = (rid: RegionId) => {
    const r = s.regions[rid];
    if (!r || rid === from) return false;
    if (s.fleets.some(x => x.region === rid && x.ships.length && !x.limping && hostileP(s, x.owner, f.owner))) return false;
    return !(r.owner !== null && r.garrison > 0 && hostileP(s, r.owner, f.owner));
  };
  const reg = s.regions[from];
  const links = (reg.links ?? reg.neighbors).slice().sort((a, b) => a - b);
  if (cameFrom !== undefined && safe(cameFrom)) return cameFrom;
  const own = links.filter(n => safe(n) && s.regions[n].owner === f.owner);
  if (own.length) return own[0];
  return links.find(safe) ?? null;
}
/** Can a limping fleet of `p` end its limp here (its own shipyard or depot)? */
const isYard = (s: GameState, rid: RegionId, p: PlayerId) => { const r = s.regions[rid]; return !!r && r.owner === p && ((r.buildings.shipyard ?? 0) > 0 || (r.buildings.depot ?? 0) > 0); };
/** Nearest friendly shipyard (else owned world) along a safe path. */
export function limpRoute(s: GameState, f: Fleet): { to: RegionId; path: RegionId[] } | null {
  const blocked = (rid: RegionId) => {
    const r = s.regions[rid];
    if (s.fleets.some(x => x.region === rid && x.ships.length && !x.limping && hostileP(s, x.owner, f.owner))) return true;
    return r.owner !== null && r.garrison > 0 && hostileP(s, r.owner, f.owner);
  };
  const yard = (rid: RegionId) => isYard(s, rid, f.owner);
  const owned = (rid: RegionId) => s.regions[rid].owner === f.owner && s.regions[rid].kind !== 'lane';
  for (const goal of [yard, owned]) {
    if (goal(f.region)) return { to: f.region, path: [] };
    const prev = new Map<RegionId, RegionId>([[f.region, -1]]);
    const q = [f.region];
    while (q.length) {
      const cur = q.shift()!;
      for (const n of s.regions[cur].links ?? s.regions[cur].neighbors) {
        if (prev.has(n) || blocked(n)) continue;
        prev.set(n, cur);
        if (goal(n)) {
          const path: RegionId[] = [];
          for (let x = n; x !== f.region; x = prev.get(x)!) path.unshift(x);
          return { to: n, path };
        }
        q.push(n);
      }
    }
  }
  return null;
}

type Emit = (e: GameEvent) => void;

/**
 * Apply a rout (the fleet has already been moved to its exit): a scar, hulls capped, limping home.
 * Returns 'broken' if this was its third scar (the fleet is disbanded: caller drops it).
 */
export function applyRout(s: GameState, f: Fleet, from: RegionId, by: PlayerId | -1, pulse: number, emit: Emit): 'routed' | 'broken' {
  const S = SR(s);
  (f.routs ??= []).push(s.turn);
  (f.tally ??= { sieges: 0, defences: 0, interceptions: 0, wins: 0, routs: 0 }).routs++;
  if (f.vow?.kind === 'never_retreat') breakVow(s, f, pulse, emit, 'was routed');
  // the scar: deterministic, never one it already bears
  const held = new Set((f.scars ?? []).map(x => x.id));
  const pool = Object.keys(SCARS).filter(k => !held.has(k) && (k !== 'grudge' || by >= 0));
  const scar = pool.length ? pool[hashString(`${s.seed}:${f.id}:${s.turn}`) % pool.length] : null;
  if (scar) {
    (f.scars ??= []).push({ id: scar, turn: s.turn, ...(scar === 'grudge' ? { vs: by } : {}) });
    if (scar === 'burned') for (const sh of f.ships) { sh.maxHp = Math.max(1, Math.round(sh.maxHp * S.burnedHullMult)); sh.hp = Math.min(sh.hp, sh.maxHp); }
  }
  const fromName = s.regions[from]?.name ?? '?';
  emit({ k: 'rout', pulse, fleet: f.id, owner: f.owner, from, to: f.region, by, scar });
  if ((f.scars?.length ?? 0) >= S.breakAtScars) {
    breakFleet(s, f, from, pulse, emit);
    // broken is still beaten: blood-debts owed to the winner clear, avenge vows on this commander are kept
    if (by >= 0) onBeaten(s, f.owner, by, f.commander.name, from, pulse, emit);
    return 'broken';
  }
  for (const sh of f.ships) sh.hp = Math.max(1, Math.min(sh.hp, Math.floor(sh.maxHp * S.routHullCap)));
  const rt = limpRoute(s, f);
  f.limping = { since: s.turn, to: rt?.to ?? f.region, by };
  f.route = rt && rt.path.length ? { path: rt.path, seize: null, mp: 0 } : null;
  f.siege = null; f.fortified = false;
  sagaBeat(f, s.turn, 'rout', `Routed at ${fromName}${by >= 0 ? ` by ${pname(s, by)}` : ''}${scar ? `; took the scar ${SCARS[scar].name}` : ''}.`, from);
  beat(s, { kind: 'rout', text: headline(s, 'rout', { f: f.name, r: fromName, a: pname(s, f.owner) }), region: from, players: [f.owner, ...(by >= 0 ? [by] : [])], drama: 3 + f.commander.rank + (f.epithets?.length ?? 0), public: false });
  if (by >= 0) onBeaten(s, f.owner, by, f.commander.name, from, pulse, emit);
  return 'routed';
}

/** The third scar: the fleet is disbanded with honours; its home world remembers it. */
export function breakFleet(s: GameState, f: Fleet, at: RegionId, pulse: number, emit: Emit) {
  const home = s.regions[f.banner?.home ?? at];
  if (home?.story) addDeed(s, home, { id: 'fell', turn: s.turn, name: `Where ${f.name} Fell`, by: f.owner, fleet: f.name });
  if (f.commander.alive && !f.commander.name.endsWith('flag captain')) (s.players[f.owner].reserveCommanders ??= []).push(f.commander);
  sagaBeat(f, s.turn, 'broken', `Broken by its third scar and disbanded with honours.`, at);
  // public news, but where it broke is not (the rout itself is only seen by those who watched): no region
  emit({ k: 'soul', pulse, kind: 'broken', owner: null, text: `${f.name} is broken by its third scar and disbanded with honours.`, fleet: f.id, players: [f.owner] });
  beat(s, { kind: 'broken', text: headline(s, 'broken', { f: f.name, a: pname(s, f.owner) }), players: [f.owner], drama: 7 + f.commander.rank, public: true });
  archiveFleet(s, f, 'broken', at);
  s.chronicle.push({ turn: s.turn, players: [f.owner], region: at, major: true, text: `${f.name} is broken by its third scar. ${s.players[f.owner].name} disbands it with honours.` });
  f.ships = [];
}

/** A limping fleet caught by a hostile fleet (or garrison) dies. */
export function catchLimping(s: GameState, f: Fleet, by: PlayerId | -1, killer: Fleet | null, pulse: number, emit: Emit) {
  const r = s.regions[f.region];
  emit({ k: 'destroyed', pulse, fleet: f.id, owner: f.owner, region: r.id, name: f.name });
  for (const sh of f.ships) { r.wreckage++; if (sh.title) r.memorials.push(`${sh.name} ${sh.title}, lost limping home at ${r.name} (turn ${s.turn})`); }
  if (killer?.tally) killer.tally.interceptions++;
  f.ships = [];
  // the commander falls with it or escapes to command again (as for any lost fleet; deterministic, no rng draw)
  const c = f.commander;
  if (f.owner >= 0 && c.alive && !c.name.endsWith('flag captain')) {
    if ((hashString(`${s.seed}:${s.turn}:${f.id}:caught`) % 1000) / 1000 < (s.rules.commanderFate?.dieChance ?? 0.5)) {
      c.alive = false;
      r.memorials.push(`${c.name} fell with ${f.name}, caught limping home at ${r.name}, turn ${s.turn}.`);
    } else (s.players[f.owner].reserveCommanders ??= []).push(c);
  }
  onFleetLost(s, f, r.id, 'caught', by, killer?.commander.name ?? null, pulse, emit);
}

/** Bookkeeping for a lost bannered fleet: archive, blood-debt, avenge vows, deeds, the Herald. */
export function onFleetLost(s: GameState, f: Fleet, at: RegionId, fate: 'destroyed' | 'caught', by: PlayerId | -1 | null, killerCmd: string | null, pulse: number, emit: Emit) {
  if (!soulOn(s) || f.owner < 0) return;
  const st = ensureSoul(s)!;
  const r = s.regions[at];
  const storied = f.commander.rank >= 2 || (f.epithets?.length ?? 0) > 0;
  if (f.banner) {
    sagaBeat(f, s.turn, fate, fate === 'caught' ? `Caught limping at ${r.name} and destroyed.` : `Destroyed at ${r.name}.`, at);
    if (storied && r.story) addDeed(s, r, { id: 'fell', turn: s.turn, name: `Where ${f.name} Fell`, by: r.owner, fleet: f.name });
    archiveFleet(s, f, fate, at);
  }
  const cmdDied = !f.commander.alive;
  beat(s, { kind: fate, text: headline(s, fate, { f: f.name, r: r.name, a: pname(s, f.owner) }), region: at, players: [f.owner, ...(by !== null && by >= 0 ? [by] : [])], drama: (fate === 'caught' ? 6 : 3) + f.commander.rank, public: false });
  if (cmdDied) beat(s, { kind: 'death', text: headline(s, 'death', { c: f.commander.name, f: f.name, r: r.name }), region: at, players: [f.owner], drama: 4 + f.commander.rank, public: false });
  if (by !== null && by >= 0 && by !== f.owner) {
    // blood-debt: the killer's house owes the victim's
    if (f.banner || cmdDied) {
      const d = { id: st.debts.length + 1, turn: s.turn, debtor: by, creditor: f.owner, killer: killerCmd ?? pname(s, by), victim: f.commander.name, fleet: f.name, region: at, cleared: null };
      st.debts.push(d);
      emit({ k: 'soul', pulse, kind: 'debt', owner: null, text: `Blood-debt: ${pname(s, by)} owes ${pname(s, f.owner)} for ${f.name}.`, region: at, players: [by, f.owner] });
      beat(s, { kind: 'debt', text: headline(s, 'debt', { a: pname(s, by), b: pname(s, f.owner), c: f.commander.name }), region: at, players: [by, f.owner], drama: 4, public: true });
    }
    onBeaten(s, f.owner, by, f.commander.name, at, pulse, emit);
  }
}

/** `winner` beat a fleet of `loser` (commanded by `cmd`): clears blood-debts owed to the winner, fulfils avenge vows. */
export function onBeaten(s: GameState, loser: PlayerId, winner: PlayerId, cmd: string, at: RegionId, pulse: number, emit: Emit) {
  const st = s.soul;
  if (!st) return;
  for (const d of st.debts) {
    if (d.cleared || d.creditor !== winner || d.debtor !== loser) continue;
    d.cleared = s.turn;
    emit({ k: 'soul', pulse, kind: 'vengeance', owner: null, text: `${pname(s, winner)} avenges ${d.victim}.`, region: at, players: [winner, loser] });
    beat(s, { kind: 'vengeance', text: headline(s, 'vengeance', { a: pname(s, winner), b: pname(s, loser), c: d.victim, r: s.regions[at]?.name ?? '?' }), region: at, players: [winner, loser], drama: 7, public: true });
  }
  for (const f of s.fleets) {
    if (f.owner !== winner || f.vow?.kind !== 'avenge' || !avengeHits(f.vow, cmd, loser)) continue;
    if (f.region === at) fulfilVow(s, f, pulse, emit);
  }
}

// ------------------------------------------------------------------ vows
/** Why this vow can't be sworn, or null. */
export function vowBlock(s: GameState, p: PlayerId, f: Fleet | undefined, kind: unknown, region?: unknown, target?: unknown): string | null {
  if (!soulOn(s)) return 'vows are off in these rules';
  if (!f || f.owner !== p || !f.ships.length) return 'no such fleet of yours';
  if (!f.banner) return 'pickets swear no vows';
  if (typeof kind !== 'string' || !Object.hasOwn(VOWS, kind)) return 'unknown vow';
  if (f.vow) return 'it already has a vow';
  if (kind === 'guard') {
    if (!Number.isInteger(region) || !s.regions[region as number]) return 'name a world to guard';
    const r = s.regions[region as number];
    if (r.owner !== p) return 'you can only guard your own world';
    if (f.region !== r.id) return 'the fleet must be at the world it guards';
  }
  if (kind === 'avenge') {
    const t = s.fleets.find(x => x.id === target);
    if (!t || t.owner < 0 || t.owner === p || !t.ships.length) return 'no such rival fleet';
    const grievance = !!f.commander.rivals[t.commander.name] || (s.soul?.debts ?? []).some(d => !d.cleared && d.creditor === p && d.killer === t.commander.name);
    if (!grievance) return 'there is no grievance to avenge against that commander';
  }
  return null;
}
export function swearVow(s: GameState, f: Fleet, kind: VowKind, region?: RegionId, target?: Fleet) {
  const v: Vow = { kind, since: s.turn, progress: 0 };
  if (kind === 'guard') v.region = region;
  if (kind === 'avenge' && target) { v.target = target.commander.name; v.targetOwner = target.owner; }
  f.vow = v;
  const text = vowText(s, v);
  sagaBeat(f, s.turn, 'vow', `Swore: ${text}.`, f.region);
  // vows are public; the fleet's whereabouts are not (Ghosts, fog): public fleet news carries no region
  beat(s, { kind: 'vow_sworn', text: headline(s, 'vow_sworn', { f: f.name, x: text }), players: [f.owner], drama: 2, public: true });
}
/** Is this commander (of house `owner`) the one an avenge vow names? Names can repeat across houses: match the house too. */
export const avengeHits = (v: Vow, cmd: string, owner: PlayerId | -1) => v.target === cmd && (v.targetOwner === undefined || v.targetOwner === owner);
export function vowText(s: GameState, v: Vow): string {
  const d = VOWS[v.kind];
  if (v.kind === 'guard') return `${d.name} ${s.regions[v.region ?? 0]?.name ?? '?'}`;
  if (v.kind === 'avenge') return `${d.name} ${v.target ?? '?'}`;
  return d.name;
}
export function fulfilVow(s: GameState, f: Fleet, pulse: number, emit: Emit) {
  const v = f.vow;
  if (!v) return;
  const ep = VOWS[v.kind].epithet.replace('{world}', s.regions[v.region ?? 0]?.name ?? '?');
  if (!(f.epithets ??= []).includes(ep)) f.epithets.push(ep);
  f.vow = null;
  sagaBeat(f, s.turn, 'vow_kept', `Kept its vow (${vowText(s, v)}) and is now called ${ep}.`, f.region);
  emit({ k: 'soul', pulse, kind: 'vow_kept', owner: null, text: `${f.name} keeps its vow and is now called ${ep}.`, fleet: f.id, players: [f.owner] });
  beat(s, { kind: 'vow_kept', text: headline(s, 'vow_kept', { f: f.name, x: ep }), players: [f.owner], drama: 6, public: true });
}
export function breakVow(s: GameState, f: Fleet, pulse: number, emit: Emit, why: string) {
  const v = f.vow;
  if (!v) return;
  f.vow = null;
  f.oathbreaker = { turn: s.turn, vow: vowText(s, v) };
  sagaBeat(f, s.turn, 'vow_broken', `Broke its vow (${vowText(s, v)}): it ${why}. Oathbreaker.`, f.region);
  emit({ k: 'soul', pulse, kind: 'vow_broken', owner: null, text: `${f.name} breaks its vow (${vowText(s, v)}): Oathbreaker.`, fleet: f.id, players: [f.owner] });
  beat(s, { kind: 'vow_broken', text: headline(s, 'vow_broken', { f: f.name, x: vowText(s, v) }), players: [f.owner], drama: 6, public: true });
}
/** A vow that can no longer be kept or broken (its world fell, its target is gone): it lapses quietly. */
export function lapseVow(s: GameState, f: Fleet, why: string) {
  if (!f.vow) return;
  sagaBeat(f, s.turn, 'vow_lapsed', `Its vow (${vowText(s, f.vow)}) lapsed: ${why}.`, f.region);
  f.vow = null;
}

// ------------------------------------------------------------------ honours & rank
/** Two boons the fleet doesn't have, shaped by how it fought (tally). Deterministic. */
export function honourOptions(s: GameState, f: Fleet): string[] {
  const t = f.tally ?? { sieges: 0, defences: 0, interceptions: 0, wins: 0, routs: 0 };
  const cats = (['sieges', 'defences', 'interceptions', 'wins'] as const).slice().sort((a, b) => t[b] - t[a] || 0);
  const have = new Set([...(f.banner?.boons ?? []), ...(f.honours ?? []).map(h => h.id)]);
  const out: string[] = [];
  for (const c of cats) {
    const b = Object.keys(BOONS).filter(k => BOONS[k].from === c && !have.has(k) && !out.includes(k));
    if (b.length) out.push(b[hashString(`${f.id}:${c}:${f.commander.rank}`) % b.length]);
    if (out.length >= 2) break;
  }
  for (const k of Object.keys(BOONS)) { if (out.length >= 2) break; if (!have.has(k) && !out.includes(k) && !(k === 'ghosts' && f.banner?.banes.includes('conspicuous'))) out.push(k); }
  return out.filter(k => !(k === 'ghosts' && f.banner?.banes.includes('conspicuous')));
}
/** Called by combat on each commander rank-up of a bannered fleet. */
export function onRankUp(s: GameState, f: Fleet, hl: (t: string) => void) {
  if (!soulOn(s) || !f.banner || f.owner < 0) return;
  const S = SR(s);
  const rank = f.commander.rank;
  if (rank >= 5) {
    const ep = LEGEND_EPITHETS[f.banner.boons[0] ?? ''] ?? LEGEND_EPITHETS[''];
    if (!(f.epithets ??= []).includes(ep)) {
      f.epithets.push(ep);
      // a Legend outgrows its first flaw
      const shed = f.banner.banes.shift();
      hl(`${f.name} passes into legend as ${ep}${shed ? ` and sheds ${BANES[shed]?.name ?? shed}` : ''}.`);
      sagaBeat(f, s.turn, 'legend', `Became a Legend: ${ep}${shed ? `; shed ${BANES[shed]?.name ?? shed}` : ''}.`, f.region);
      beat(s, { kind: 'legend', text: headline(s, 'legend', { f: f.name, x: ep }), players: [f.owner], drama: 7, public: true });
    }
  }
  if ((f.honours?.length ?? 0) >= S.maxHonours || f.pendingHonour) return;
  const options = honourOptions(s, f);
  if (options.length) {
    f.pendingHonour = { options, since: s.turn };
    hl(`${f.commander.name} (${RANK_NAMES[rank] ?? `rank ${rank}`}) may choose an honour: ${options.map(o => BOONS[o].name).join(' or ')}.`);
  }
}
export function pickHonour(s: GameState, f: Fleet, pick: unknown): string | null {
  const ph = f.pendingHonour;
  if (!ph) return 'no honour to choose';
  const id = typeof pick === 'number' ? ph.options[pick] : typeof pick === 'string' ? pick : undefined;
  if (!id || !ph.options.includes(id)) return 'not one of the offered honours';
  (f.honours ??= []).push({ id, turn: s.turn });
  f.pendingHonour = null;
  sagaBeat(f, s.turn, 'honour', `Honoured: ${BOONS[id].name}.`, f.region);
  beat(s, { kind: 'honour', text: headline(s, 'honour', { f: f.name, c: f.commander.name, x: BOONS[id].name }), players: [f.owner], drama: 2, public: true });
  return null;
}

// ------------------------------------------------------------------ worlds
export const tenureTurns = (s: GameState, r: Region) => (r.owner === null || !r.story ? 0 : Math.max(0, s.turn - r.story.tenureFrom));
export function tenureTier(s: GameState, r: Region): number {
  const t = tenureTurns(s, r);
  return SR(s).tenureTiers.filter(x => t >= x).length;
}
/** The tier (0-3) at which a calling works here, or -1 if it isn't active (none, another one, dormant, unowned). */
export function callingTier(s: GameState, r: Region, id?: string): number {
  if (!soulOn(s) || !r.story?.calling || r.owner === null) return -1;
  const c = r.story.calling;
  if (id && c.id !== id) return -1;
  if ((c.dormantUntil ?? -1) > s.turn) return -1;
  return tenureTier(s, r);
}
/** The two callings a world is offered: one from its trait (or kind), one from its strongest mark. */
export function callingOptions(s: GameState, r: Region): string[] {
  const a = TRAIT_CALLING[r.trait ?? ''] ?? TRAIT_CALLING[r.kind] ?? 'granary';
  const m = strongestMark(s, r);
  let b = MARK_CALLING[m?.mark ?? ''] ?? 'cenotaph';
  if (b === a) b = Object.keys(CALLINGS).filter(k => CALLINGS[k].from === 'mark' && k !== a)[r.id % 4];
  return [a, b];
}
/**
 * The callings a world is offered now. Star systems (step 4): a calling needs the right bodies or history
 * (systems.ts callingGate); one the world can't take is listed in `gated` (with why) and replaced by the first
 * fitting fallback (trait side: Refinery, Granary, Arsenal, Bastion; history side: Oracle, Cenotaph, Proving Ground,
 * Bulwark), so there are always two valid choices. Off: exactly callingOptions.
 */
export function callingOffer(s: GameState, r: Region): { options: string[]; gated: { id: string; why: string }[] } {
  const base = callingOptions(s, r);
  const gated: { id: string; why: string }[] = [];
  const out: string[] = [];
  base.forEach((id, i) => {
    const why = callingGate(s, r, id);
    if (!why) { if (!out.includes(id)) out.push(id); return; }
    gated.push({ id, why });
    const pool = i === 0 ? ['refinery', 'granary', 'arsenal', 'bastion'] : ['oracle', 'cenotaph', 'proving', 'bulwark'];
    const alt = pool.find(x => !callingGate(s, r, x) && !out.includes(x) && !base.includes(x))
      ?? [...pool, 'bastion', 'proving', 'bulwark'].find(x => !callingGate(s, r, x) && !out.includes(x) && !base.slice(i + 1).includes(x));
    if (alt) out.push(alt);
  });
  return { options: out, gated };
}
export function pickCalling(s: GameState, r: Region, pick: unknown): string | null {
  const pc = r.story?.pendingCalling;
  if (!pc) return 'no calling to choose here';
  const id = typeof pick === 'number' ? pc.options[pick] : typeof pick === 'string' ? pick : undefined;
  if (!id || !pc.options.includes(id)) return 'not one of the offered callings';
  r.story!.calling = { id, since: s.turn };
  r.story!.pendingCalling = null;
  beat(s, { kind: 'calling', text: `${r.name} finds its calling: ${CALLINGS[id].name}`, region: r.id, players: [r.owner ?? pc.owner], drama: 1, public: false });
  return null;
}

function markLevels(s: GameState, r: Region): { mark: string; level: number }[] {
  const st = r.story!;
  const taken = st.owners.filter(o => o.how !== 'start' && o.how !== 'razed').length;
  const lv = (x: number, t: number[]) => t.filter(y => x >= y).length - 1;
  return [
    { mark: 'siege', level: lv(st.siege, [1, 2, 4]) },
    { mark: 'blood', level: lv(st.blood, [2, 4, 7]) },
    { mark: 'loss', level: lv(st.loss, [2, 4, 7]) },
    { mark: 'taken', level: taken >= 3 ? 2 : taken >= 2 ? 1 : -1 },
    { mark: 'relic', level: st.relic > 0 ? 0 : -1 },
    { mark: 'toil', level: lv(st.toil, [5, 10, 16]) },
  ];
}
export function strongestMark(s: GameState, r: Region): { mark: string; level: number } | null {
  if (!r.story) return null;
  let best: { mark: string; level: number } | null = null;
  for (const m of markLevels(s, r)) if (m.level >= 0 && (!best || m.level > best.level)) best = m;
  return best;
}
/** "Kessa the Unbroken": the world's epithet from its strongest mark (cosmetic), or null. */
export function worldEpithet(s: GameState, r: Region): string | null {
  const m = strongestMark(s, r);
  return m ? WORLD_EPITHETS[m.mark]?.[m.level] ?? null : null;
}

export function addDeed(s: GameState, r: Region, d: Deed) {
  const st = r.story;
  if (!st) return;
  const S = SR(s);
  if (st.deeds.some(x => x.id === d.id && x.name === d.name)) return;
  const text = d.name;
  if (st.deeds.length < S.maxDeeds) st.deeds.push(d);
  else {
    // engraved deeds and Havens (permanent, docs/SOUL.md) are never replaced
    const i = st.deeds.findIndex(x => !x.engraved && x.id !== 'haven');
    if (i < 0) return;   // both engraved: history is full
    st.deeds.splice(i, 1);
    st.deeds.push(d);
  }
  beat(s, { kind: 'deed', text: `${r.name} earns a deed: ${text}`, region: r.id, players: r.owner !== null ? [r.owner] : [], drama: 2, public: true });
}
export const hasDeed = (r: Region, id: string) => !!r.story?.deeds.some(d => d.id === id);

/** Story bookkeeping when a world changes hands. Returns true if this was a Liberation. */
export function onCapture(s: GameState, r: Region, by: PlayerId, from: PlayerId | null, how: string, pulse: number, emit: Emit, scorched = false): boolean {
  if (!soulOn(s)) return false;
  const st = (r.story ??= newStory({ ...r, owner: from }));
  const S = SR(s);
  const prevLost = st.lost;
  const oldTenure = from !== null ? Math.max(0, s.turn - st.tenureFrom) : 0;
  const oldCalling = st.calling ? { id: st.calling.id, since: st.calling.since } : null;
  st.owners.push({ p: by, turn: s.turn, how });
  st.pendingCalling = null;
  st.captured = { by, from, turn: s.turn };
  st.lost = from !== null ? { p: from, turn: s.turn, tenure: oldTenure, calling: oldCalling } : null;
  let liberated = false;
  if (prevLost && prevLost.p === by && s.turn - prevLost.turn <= S.liberateWithin) {
    liberated = true;
    st.tenureFrom = s.turn - prevLost.tenure;
    st.calling = prevLost.calling ? { ...prevLost.calling } : st.calling ? { id: st.calling.id, since: st.calling.since } : null;
    addDeed(s, r, { id: 'liberated', turn: s.turn, name: 'Liberated', by });
    emit({ k: 'soul', pulse, kind: 'liberated', owner: null, text: `${s.players[by].name} liberates ${r.name}.`, region: r.id, players: [by] });
    beat(s, { kind: 'liberated', text: headline(s, 'liberated', { a: pname(s, by), r: r.name }), region: r.id, players: [by, ...(from !== null ? [from] : [])], drama: 6, public: true });
  } else {
    st.tenureFrom = s.turn;
    if (st.calling) st.calling.dormantUntil = s.turn + S.dormantTurns;
  }
  const taken = st.owners.filter(o => o.how === 'force' || o.how === 'influence').length;
  if (taken >= S.thriceCaptures) addDeed(s, r, { id: 'thrice', turn: s.turn, name: 'Thrice-Taken', by });
  if (from !== null && !liberated) {
    const cap = r.homeOf === from;
    beat(s, { kind: cap ? 'capital' : 'capture', text: headline(s, cap ? 'capital' : 'capture', { a: pname(s, by), b: pname(s, from), r: r.name }), region: r.id, players: [by, from], drama: cap ? 9 : r.kind === 'crown' || r.kind === 'throne' ? 5 : 2, public: true });
  }
  // fleets of the taker standing here: tallies, raiders' loot, the Throne vow
  for (const f of s.fleets) {
    if (f.owner !== by || f.region !== r.id || !f.ships.length || !f.banner) continue;
    if (how === 'force' && f.tally) f.tally.sieges++;
    if (how === 'force' && hasBoon(s, f, 'raiders') && !scorched) {   // Scorched Earth: nothing to loot
      const lump = S.raiderLoot + S.raiderLootPerDev * r.dev;
      s.players[by].res.credits += lump;
      sagaBeat(f, s.turn, 'loot', `Looted ${r.name} (+${lump}¢).`, r.id);
    }
    if (f.vow?.kind === 'throne' && r.kind === 'throne') fulfilVow(s, f, pulse, emit);
  }
  return liberated;
}

/** Why `p` can't raze this world now (`free`: as a free action, i.e. right after the capture), or null. */
export function razeBlock(s: GameState, p: PlayerId, rid: unknown, free: boolean): string | null {
  if (!soulOn(s)) return 'razing is off in these rules';
  const r = Number.isInteger(rid) ? s.regions[rid as number] : undefined;
  if (!r) return 'no such region';
  if (r.owner !== p) return 'not your world';
  const c = r.story?.captured;
  if (!c || c.by !== p) return 'you can only raze a world you just captured';
  const age = s.turn - c.turn;
  // free: in the planning right after the capture (LIVE: the same cycle or the next); order: one turn later too
  if (age < 0 || age > (free ? 1 : 2)) return free ? 'too late to raze for free (use a Raze order next turn)' : 'too late to raze';
  if (r.id === s.players[p].capital) return 'you cannot raze your own capital';
  return null;
}
export function raze(s: GameState, p: PlayerId, r: Region, pulse: number, emit: Emit) {
  const S = SR(s);
  const st = r.story!;
  const from = st.captured?.from ?? null;
  const lump = S.razeLump + S.razeLumpPerDev * r.dev;
  s.players[p].res.credits += lump;
  s.players[p].res.industry += lump;
  r.dev = Math.max(Math.min(1, r.dev), r.dev - 1);   // never raises a 0-citizen world
  r.project = null;
  st.calling = null; st.pendingCalling = null; st.captured = null;
  if (st.lost) st.lost.calling = null;   // a razed calling does not wake on liberation
  st.tenureFrom = s.turn;
  st.owners.push({ p, turn: s.turn, how: 'razed' });
  if (from !== null && from !== p) {
    const pl = s.players[from];
    (pl.vendettas ??= []).push({ vs: p, until: s.turn + S.razeVendettaTurns, region: r.id });
  }
  emit({ k: 'soul', pulse, kind: 'razed', owner: null, text: `${s.players[p].name} razes ${r.name} (+${lump}⚙ +${lump}¢).`, region: r.id, players: [p, ...(from !== null ? [from] : [])] });
  s.chronicle.push({ turn: s.turn, region: r.id, players: [p, ...(from !== null ? [from] : [])], major: true, text: `${s.players[p].name} razes ${r.name}.${from !== null ? ` ${s.players[from].name} swears vengeance.` : ''}` });
  beat(s, { kind: 'razed', text: headline(s, 'razed', { a: pname(s, p), r: r.name }), region: r.id, players: [p, ...(from !== null ? [from] : [])], drama: 6, public: true });
}

/** Garrison bonus from the world's calling and deeds (maxGarrison adds it). */
export function soulGarrison(s: GameState, r: Region): number {
  if (!soulOn(s) || !r.story || r.owner === null) return 0;
  const S = SR(s);
  let g = 0;
  const t = callingTier(s, r, 'bastion');
  if (t >= 0) g += tierOf(S.bastionGarrison, t);
  if (hasDeed(r, 'kings_seat')) g += S.deedSeatGarrison;
  return g;
}
/** Extra garrison regeneration per turn (Bastion calling, an Inspiring fleet). */
export function soulRegen(s: GameState, r: Region): number {
  if (!soulOn(s) || r.owner === null) return 0;
  const S = SR(s);
  let g = 0;
  const t = callingTier(s, r, 'bastion');
  if (t >= 0) g += tierOf(S.bastionRegen, t);
  if (s.fleets.some(f => f.owner === r.owner && f.region === r.id && f.ships.length && hasBoon(s, f, 'inspiring'))) g += S.inspiringRegen;
  return g;
}
/** Per-world income from callings and deeds. */
export function soulYield(s: GameState, r: Region): { industry: number; credits: number; influence: number } {
  const out = { industry: 0, credits: 0, influence: 0 };
  if (!soulOn(s) || !r.story || r.owner === null) return out;
  const S = SR(s);
  let t = callingTier(s, r, 'granary');
  if (t >= 0) { out.industry += tierOf(S.granaryIndustry, t); out.credits += tierOf(S.granaryCredits, t); }
  t = callingTier(s, r, 'refinery');
  if (t >= 0) out.credits += tierOf(S.refineryCredits, t);
  if (hasDeed(r, 'liberated')) out.influence += S.deedLiberatedInfluence;
  return out;
}
/** Extra sensor range from this world (Oracle calling). */
export function soulSensor(s: GameState, r: Region): number {
  if (!soulOn(s) || !r.story?.calling) return 0;
  const t = callingTier(s, r, 'oracle');
  return t >= 0 ? tierOf(SR(s).oracleRange, t) : 0;
}
/** Industry discount for ships built here (Arsenal calling). */
export function soulShipDiscount(s: GameState, r: Region | undefined): number {
  if (!r || !soulOn(s)) return 0;
  const t = callingTier(s, r, 'arsenal');
  return t >= 0 ? tierOf(SR(s).arsenalDiscount, t) : 0;
}
/** Extra credits upkeep for a fleet (rank, Hungry; Skeleton Crew halves the fleet's whole upkeep). */
export function soulUpkeep(s: GameState, f: Fleet, base: number): number {
  if (!soulOn(s) || !f.banner) return base;
  const S = SR(s);
  let u = base + (S.upkeepByRank[f.commander.rank] ?? 0) + (hasBane(s, f, 'hungry') ? S.hungryUpkeep : 0);
  if (scarOf(f, 'skeleton')) u = Math.round(u * S.skeletonUpkeepMult);
  return u;
}

// ------------------------------------------------------------------ saga & herald plumbing
export function sagaBeat(f: Fleet, turn: number, kind: string, text: string, region?: RegionId) {
  const list = (f.saga ??= []);
  list.push({ turn, kind, text, ...(region !== undefined ? { region } : {}) });
  if (list.length > 40) list.splice(1, list.length - 40);   // keep the founding line
}
/** Queue material for the next Herald edition. */
export function beat(s: GameState, h: Headline) {
  if (!soulOn(s)) return;
  const st = ensureSoul(s)!;
  if (st.beats.length < 200) st.beats.push(h);
}
/** Fill a Herald template (variant chosen by hash: deterministic, no Math.random). */
export function headline(s: GameState, kind: string, vars: Record<string, string | number>): string {
  const t = HERALD_TEMPLATES[kind] ?? ['{x}'];
  const key = `${s.seed}:${s.turn}:${kind}:${Object.values(vars).join('|')}`;
  let out = t[hashString(key) % t.length];
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(typeof v === 'string' ? cleanText(v, 200) : String(v));
  return out;
}
export function archiveFleet(s: GameState, f: Fleet, fate: FleetRecord['fate'], at: RegionId) {
  const st = s.soul;
  if (!st || !f.banner || f.owner < 0 || st.fallen.some(x => x.id === f.id)) return;
  st.fallen.push(recordOf(s, f, fate, at));
}
export function recordOf(s: GameState, f: Fleet, fate: FleetRecord['fate'], at: RegionId): FleetRecord {
  return {
    id: f.id, owner: f.owner, name: f.name, commander: f.commander.name, rank: f.commander.rank,
    sigil: f.banner?.sigil ?? '', boons: [...(f.banner?.boons ?? [])], banes: [...(f.banner?.banes ?? [])],
    home: f.banner?.home ?? at, foundedTurn: f.banner?.foundedTurn ?? f.bornTurn, fate, fateTurn: s.turn, fateRegion: at,
    epithets: [...(f.epithets ?? [])], scars: [...(f.scars ?? [])], honours: (f.honours ?? []).map(h => h.id), oathbreaker: !!f.oathbreaker,
    routs: f.routs?.length ?? 0, saga: [...(f.saga ?? [])],
    public: fate === 'broken' || fate === 'retired' || f.commander.rank >= 4 || (f.epithets?.length ?? 0) > 0,
  };
}

// ------------------------------------------------------------------ end of turn
/**
 * End-of-turn Soul bookkeeping (WEGO turn / LIVE cycle), after upkeep and repairs:
 * vows on guard and relics, limping fleets home, default choices, raiders, Beloved,
 * Grudge-bound, the world ledger (toil, loss), callings offered at development 3,
 * epithets and deeds. `fought` = fleet ids that fought a battle this turn.
 */
export function soulEndTurn(s: GameState, pulse: number, emit: Emit, fought: Set<number>) {
  if (!soulOn(s)) return;
  const S = SR(s);
  ensureSoul(s);
  for (const f of s.fleets) {
    if (f.owner < 0 || !f.ships.length) continue;
    const r = s.regions[f.region];
    // ---- vows
    const v = f.vow;
    if (v?.kind === 'guard') {
      const g = s.regions[v.region ?? -1];
      if (!g || g.owner !== f.owner) lapseVow(s, f, `${g?.name ?? 'its world'} fell`);
      else if (f.region !== g.id) breakVow(s, f, pulse, emit, `left ${g.name}`);
      else if ((v.progress = (v.progress ?? 0) + 1) >= S.vowGuardTurns) fulfilVow(s, f, pulse, emit);
    } else if (v?.kind === 'relic' && v.carrying && f.banner && f.region === f.banner.home) fulfilVow(s, f, pulse, emit);
    else if (v?.kind === 'avenge') {
      const alive = s.fleets.some(x => avengeHits(v, x.commander.name, x.owner) && x.ships.length && x.commander.alive)
        || s.players.some(p => (p.reserveCommanders ?? []).some(c => avengeHits(v, c.name, p.id)));
      if (!alive) lapseVow(s, f, `${v.target} is gone`);
    }
    // ---- limping home
    if (f.limping) {
      const yard = isYard(s, r.id, f.owner);
      const healed = r.owner === f.owner && f.ships.every(sh => sh.hp >= sh.maxHp * S.limpClearHp);
      // Slow Refits never repair away from a yard: home with no yard to reach, the limp ends here (or it never would)
      const stranded = !yard && !healed && r.owner === f.owner && hasBane(s, f, 'slowrefit') && !isYard(s, limpRoute(s, f)?.to ?? r.id, f.owner);
      if (yard || healed || stranded) {
        f.limping = null;
        if (f.route && !f.route.path.length) f.route = null;
        sagaBeat(f, s.turn, 'home', `Limped home to ${r.name}.`, r.id);
      } else if (!f.route || !f.route.path.length) {
        const rt = limpRoute(s, f);
        if (rt) { f.limping.to = rt.to; f.route = rt.path.length ? { path: rt.path, seize: null, mp: 0 } : null; }
        // a house with no worlds left has nowhere to limp to: the fleet rallies where it is (or it never could act again)
        else if (!s.regions.some(x => x.owner === f.owner)) { f.limping = null; sagaBeat(f, s.turn, 'home', `With no home left, rallied at ${r.name}.`, r.id); }
      }
    }
    // ---- a choice left unmade defaults to the first option
    if (f.pendingHonour && s.turn - f.pendingHonour.since >= S.honourAutoTurns) pickHonour(s, f, 0);
    // ---- boons & banes that act at the end of a turn
    if (r.owner !== null && r.owner !== f.owner && hostileP(s, r.owner, f.owner) && hasBoon(s, f, 'raiders')) {
      const q = s.players[r.owner];
      const amt = Math.min(Math.max(0, q.res.credits), S.raiderPlunder + r.dev);
      if (amt > 0) {
        q.res.credits -= amt; s.players[f.owner].res.credits += amt;
        emit({ k: 'soul', pulse, kind: 'plunder', owner: f.owner, text: `${f.name} plunders ${amt}¢ from ${q.name} at ${r.name}.`, region: r.id, fleet: f.id });
        // the victim learns of it too (it is their system): a loss should be readable
        emit({ k: 'soul', pulse, kind: 'plunder', owner: r.owner, text: `${f.name} plunders ${amt}¢ from you at ${r.name}.`, region: r.id, fleet: f.id });
      }
    }
    if (f.banner && f.region === f.banner.home && r.owner === f.owner && hasBoon(s, f, 'beloved')) s.players[f.owner].res.influence += S.beloveInfluence;
    const vs = f.banner?.grudgeVs;
    if (vs !== null && vs !== undefined && !f.limping && hasBane(s, f, 'grudgebound') && s.players[vs] && !s.players[vs].eliminated && hostileP(s, f.owner, vs) && !fought.has(f.id)) {
      const near = [f.region, ...(r.links ?? r.neighbors)].some(x => s.regions[x].owner === vs || s.fleets.some(y => y.owner === vs && y.region === x && y.ships.length));
      if (near) { f.sulkUntil = s.turn + 1; sagaBeat(f, s.turn, 'sulk', `Did not attack ${s.players[vs].name} when it could: its boons fail next turn.`, f.region); }
    }
  }
  for (const pl of s.players) if (pl.vendettas) pl.vendettas = pl.vendettas.filter(x => x.until >= s.turn);
  // ---- worlds
  for (const r of s.regions) {
    const st = (r.story ??= newStory(r));
    st.loss = r.memorials.length;
    if (r.owner !== null && r.dev >= S.callingAtDev && r.kind !== 'void' && r.kind !== 'lane') {
      st.toil++;
      if (!st.calling && !st.pendingCalling) {
        const off = callingOffer(s, r);
        st.pendingCalling = { options: off.options, since: s.turn, owner: r.owner, ...(off.gated.length ? { gated: off.gated } : {}) };
      }
    }
    if (st.pendingCalling) {
      if (st.pendingCalling.owner !== r.owner) st.pendingCalling = null;
      else if (s.turn - st.pendingCalling.since >= S.honourAutoTurns) pickCalling(s, r, 0);
    }
    if (st.calling?.dormantUntil !== undefined && st.calling.dormantUntil <= s.turn + 1) delete st.calling.dormantUntil;
    // Unbroken is earned once: if newer history later replaces it, it does not come back by itself
    const earned = ((st as RegionStory & { earned?: string[] }).earned ??= []);
    if (st.siege >= S.unbrokenSieges && !earned.includes('unbroken')) {
      earned.push('unbroken');
      addDeed(s, r, { id: 'unbroken', turn: s.turn, name: 'Unbroken', by: r.owner });
    }
    st.epithet = worldEpithet(s, r);
  }
}

/** The Throne's reigns (after scoring): a new holder is crowned, the King's Seat remembers. */
export function soulReigns(s: GameState, pulse: number, emit: Emit) {
  if (!soulOn(s)) return;
  const st = ensureSoul(s)!;
  const holder = s.throne.owner;
  const open = st.reigns.find(x => x.to === null);
  if ((open?.p ?? null) === holder) return;
  if (open) open.to = s.turn;
  if (holder === null) return;
  st.reigns.push({ p: holder, from: s.turn, to: null });
  const throne = s.regions.find(r => r.kind === 'throne');
  if (throne?.story) addDeed(s, throne, { id: 'kings_seat', turn: s.turn, name: 'King’s Seat', by: holder });
  emit({ k: 'soul', pulse, kind: 'coronation', owner: null, text: `${s.players[holder].name} takes the Hollow Throne.`, region: throne?.id, players: [holder] });
  beat(s, { kind: 'coronation', text: headline(s, 'coronation', { a: pname(s, holder) }), region: throne?.id, players: [holder], drama: 8, public: true });
}
