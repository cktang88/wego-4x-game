// Per-player views: what the server sends to each client (fog of war applied).
import { within } from './graph.ts';
import { coverage, seesFleetsIn } from './visibility.ts';
import type { Doctrine, Fleet, GameState, PlayerId, RegionId, TurnResult } from './types.ts';

/** Remember what a player last saw of each region (for fogged regions). */
export interface PlayerView {
  state: GameState;          // filtered state
  you: PlayerId | null;      // null = spectator / full view
  visible: number[];         // regions currently in sensor coverage
}

/** What a rival fleet's (secret) standing orders look like from outside: the newFleet() default. */
const HIDDEN_DOCTRINE: Doctrine = { stance: 'defensive', retreatAt: 0.35, target: 'weakest', guard: false };

/** Battle lines in the chronicle (see recordBattle in resolve.ts). */
const BATTLE_LINE = /^The .+: \d+ ships destroyed\./;

function maskRivalFleet(f: Fleet) {
  // doctrine (stance, retreat threshold, guard) is a secret standing order
  f.doctrine = { ...HIDDEN_DOCTRINE };
}

export function viewFor(s: GameState, p: PlayerId | null): PlayerView {
  if (p === null) return { state: s, you: null, visible: s.regions.map(r => r.id) };
  const cov = coverage(s, p);
  const v: GameState = structuredClone({ ...s, last: null, log: [] });
  v.fleets = v.fleets.filter(f => f.owner === p || seesFleetsIn(s, p, f.region, cov));
  for (const f of v.fleets) if (f.owner !== p) maskRivalFleet(f);
  for (const pl of v.players) {
    if (pl.id === p) continue;
    // rivals' stockpiles are secret; VP is public
    pl.res = { industry: -1, credits: -1, influence: -1 };
    pl.pactOffers = (pl.pactOffers ?? []).filter(x => x === p);
    pl.reserveCommanders = [];
    // VP amounts are public, but an honors line names a battle you may not have seen
    pl.vpLog = (pl.vpLog ?? []).map(e => e.why.startsWith('Battle honors') ? { ...e, why: 'Battle honors' } : e);
  }
  for (const r of v.regions) {
    if (cov.has(r.id) || r.owner === p) continue;
    // fogged: hide projects and exact garrison of rival regions
    r.project = null;
    if (r.owner !== null) r.garrison = -1;
    r.loyalty = r.loyalty.map((x, i) => (i === p ? x : 0));
  }
  // rivals' scans reveal where they are looking (and that they paid for it)
  v.scans = v.scans.filter(sc => sc.owner === p);
  v.engagements = (v.engagements ?? []).filter(e => cov.has(e.region) || s.fleets.some(f => f.owner === p && f.region === e.region));
  // last turn's per-player stats would reveal rivals' unseen battles (captures are public anyway)
  if (v.turnStats) {
    const own = <T>(arr: T[] | undefined, zero: T) => (arr ?? []).map((x, i) => (i === p ? x : zero));
    v.turnStats = { ...v.turnStats, kills: own(v.turnStats.kills, 0), battlesWon: own(v.turnStats.battlesWon, 0), crownBattlesWon: own(v.turnStats.crownBattlesWon, 0) };
  }
  let lastSeen: Set<RegionId> | null = null;
  if (s.last) {
    const f = filterResult(s, s.last, p, cov);
    v.last = f.result;
    lastSeen = f.seen;
  }
  // battles between rivals that you didn't witness stay out of your chronicle
  v.chronicle = v.chronicle.filter(c => {
    if (c.region === undefined || c.players.includes(p) || !BATTLE_LINE.test(c.text)) return true;
    return cov.has(c.region) || (!!lastSeen && c.turn === s.last?.turn && lastSeen.has(c.region));
  });
  v.edictDeck = [];
  v.rngState = 0;   // can't predict combat rolls
  return { state: v, you: p, visible: [...cov] };
}

/** Filter any turn result for a player (null = everything). */
export function filterResultFor(s: GameState, r: TurnResult, p: PlayerId | null): TurnResult {
  if (p === null) return r;
  // current coverage is only "end of turn" coverage for the most recent turn; for older
  // turns it would leak events in regions the player only came to watch later
  const isLast = !!s.last && s.last.turn === r.turn;
  return filterResult(s, r, p, isLast ? coverage(s, p) : null).result;
}

/**
 * A player sees fleet activity in regions they covered at the start of the turn, at its end
 * (endCov, when known), or that their own fleets passed through or fought in. Nebulae hide
 * fleets unless the player was present, owned the region, or scanned it.
 */
function filterResult(s: GameState, r: TurnResult, p: PlayerId, endCov: Set<RegionId> | null): { result: TurnResult; seen: Set<RegionId> } {
  const S = s.rules.sensors;
  const startOwners = r.startOwners ?? [];
  const startState: GameState = {
    ...s, turn: r.turn, fleets: r.startFleets ?? [], scans: [],
    regions: s.regions.map((reg, i) => ({ ...reg, owner: startOwners[i] ?? reg.owner })),
  };
  const startCov = coverage(startState, p);

  const present = new Set<RegionId>();      // regions p's own ships stood in at some point this turn
  const owned = new Set<RegionId>();        // regions p owned at some point this turn
  const scanned = new Set<RegionId>();      // regions p scanned (reveals nebulae too)
  for (const f of r.startFleets ?? []) if (f.owner === p && f.ships.length) present.add(f.region);
  startOwners.forEach((o, i) => { if (o === p) owned.add(i); });
  for (const sc of s.scans) if (sc.owner === p && sc.until >= r.turn && sc.until <= r.turn + 1) scanned.add(sc.region);
  for (const e of r.events) {
    if ((e.k === 'move' || e.k === 'retreat') && e.owner === p) { present.add(e.from); present.add(e.to); }
    else if (e.k === 'battle' && e.parties.includes(p)) present.add(e.region);
    else if (e.k === 'build' && e.owner === p) present.add(e.region);
    else if (e.k === 'capture' && e.by === p) owned.add(e.region);
    else if (e.k === 'scan' && e.owner === p) scanned.add(e.region);
  }
  if (endCov) {
    for (const f of s.fleets) if (f.owner === p && f.ships.length) present.add(f.region);
    for (const reg of s.regions) if (reg.owner === p) owned.add(reg.id);
  }
  const cov = new Set<RegionId>(startCov);
  if (endCov) for (const x of endCov) cov.add(x);
  for (const rid of present) for (const x of within(s, rid, S.fleetRange)) cov.add(x);
  for (const rid of owned) for (const x of within(s, rid, S.ownedRange)) cov.add(x);
  const scanSeen = new Set<RegionId>();
  for (const rid of scanned) for (const x of within(s, rid, S.scanRange)) { cov.add(x); scanSeen.add(x); }

  const fleetsVisible = (rid: RegionId, c: Set<RegionId>, here: Set<RegionId>) => {
    const reg = s.regions[rid];
    if (!reg) return false;
    if (reg.kind === 'throne' && s.rules.throne?.holderVisible) return true;
    if (!c.has(rid)) return false;
    if (reg.feature === 'nebula' && S.nebulaHidesFleets) return here.has(rid) || owned.has(rid) || scanSeen.has(rid);
    return true;
  };
  const sees = (rid: RegionId) => fleetsVisible(rid, cov, present);
  const startPresent = new Set<RegionId>();
  for (const f of r.startFleets ?? []) if (f.owner === p && f.ships.length) startPresent.add(f.region);
  const seesAtStart = (rid: RegionId) => fleetsVisible(rid, startCov, startPresent);
  const ownFleetIds = new Set((r.startFleets ?? []).filter(f => f.owner === p).map(f => f.id));
  for (const e of r.events) if ((e.k === 'build' || e.k === 'move') && e.owner === p) ownFleetIds.add(e.fleet);

  const events = r.events.filter(e => {
    switch (e.k) {
      case 'pulse': return true;
      case 'move': return e.owner === p || sees(e.from) || sees(e.to);
      case 'retreat': return e.owner === p || sees(e.from) || sees(e.to);
      case 'clash': return sees(e.a) || sees(e.b) || e.fleets.some(id => ownFleetIds.has(id));
      case 'battle': return e.parties.includes(p) || sees(e.region);
      case 'blocked': return e.owner === p || sees(e.at);
      case 'fortify': return e.owner === p || sees(e.region);
      case 'destroyed': return e.owner === p || sees(e.region);
      case 'capture': return true; // ownership changes are public
      case 'build': return e.owner === p || sees(e.region);
      case 'project': return e.owner === p || cov.has(e.region);
      case 'influence': return e.owner === p || owned.has(e.region) || s.regions[e.region]?.owner === p;
      case 'scan': return e.owner === p;
      case 'excavate': return true;
      case 'pact': case 'betrayal': return true;
      case 'fail': return e.owner === p;
      case 'note': return e.owner === null || e.owner === p;
      default: return false;
    }
  });
  const battleIds = new Set(events.filter(e => e.k === 'battle').map(e => (e as { battle: number }).battle));
  const startFleets = structuredClone((r.startFleets ?? []).filter(f => f.owner === p || seesAtStart(f.region)));
  for (const f of startFleets) if (f.owner !== p) maskRivalFleet(f);
  const seen = new Set<RegionId>();
  for (const rid of cov) if (sees(rid)) seen.add(rid);
  for (const e of events) if (e.k === 'battle') seen.add(e.region);
  return {
    result: {
      turn: r.turn,
      events,
      battles: r.battles.filter(b => battleIds.has(b.id)),
      signals: r.signals.filter(x => x.observer === p),
      startFleets,
      startOwners: r.startOwners,
    },
    seen,
  };
}
