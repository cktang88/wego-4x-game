// Per-player views: what the server sends to each client (fog of war applied).
import { withinArea } from './graph.ts';
import { coverage, seesFleetsIn, seesFleet, postureSeenBy } from './visibility.ts';
import { headlineVisible } from './herald.ts';
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
export const BATTLE_LINE = /^The .+: \d+ ships destroyed\./;

function maskRivalFleet(f: Fleet) {
  // doctrine (stance, retreat threshold, guard) is a secret standing order
  f.doctrine = { ...HIDDEN_DOCTRINE };
  // so are its supply situation (how long it has been cut off) and how many orders it used this turn
  delete f.oos;
  f.ordersThisTurn = 0;
  f.guardUsed = false;
  // Soul layer: banners, vows, scars, honours, epithets and brands are public; a pending choice is not
  delete f.pendingHonour;
  delete f.sulkUntil;
  // Signature: a posture is secret (viewFor reveals it to a fleet beside it or a scan); so is being dug in.
  // Exposure and a Fate spent on it are public.
  delete f.posture;
  delete f.postureFx;
  delete f.dugIn;
}

export function viewFor(s: GameState, p: PlayerId | null): PlayerView {
  if (p === null) return { state: s, you: null, visible: s.regions.map(r => r.id) };
  const cov = coverage(s, p);
  const v: GameState = structuredClone({ ...s, last: null, log: [] });
  v.fleets = v.fleets.filter(f => f.owner === p || seesFleet(s, p, f, cov));
  for (const f of v.fleets) if (f.owner !== p) {
    const seen = s.fleets.find(x => x.id === f.id);
    const posture = seen && seen.posture && postureSeenBy(s, p, seen) ? seen.posture : null;
    maskRivalFleet(f);
    if (posture) f.posture = posture;
  }
  for (const pl of v.players) {
    if (pl.id === p) continue;
    // rivals' stockpiles are secret; VP is public
    pl.res = { industry: -1, credits: -1, influence: -1 };
    pl.pactOffers = (pl.pactOffers ?? []).filter(x => x === p);
    pl.prevPactOffers = (pl.prevPactOffers ?? []).filter(x => x === p);
    pl.reserveCommanders = [];
    // sworn words on a pact offer are for its addressee only
    if (pl.pactWords) pl.pactWords = Object.fromEntries(Object.entries(pl.pactWords).filter(([k]) => Number(k) === p));
    // VP amounts are public, but an honors line names a battle you may not have seen
    pl.vpLog = (pl.vpLog ?? []).map(e => e.why.startsWith('Battle honors') ? { ...e, why: 'Battle honors' } : e);
  }
  for (const r of v.regions) {
    // Soul layer: a world's ledger, epithet, calling and deeds are public; a pending calling is its owner's
    if (r.story && r.owner !== p) r.story.pendingCalling = null;
    // Signature: a world posture (and its idle aftermath) is its owner's secret
    if (r.owner !== p) { delete r.wposture; delete r.idleUntil; }
    if (cov.has(r.id) || r.owner === p) continue;
    // fogged: hide projects and exact garrison of rival regions
    r.project = null;
    if (r.owner !== null) r.garrison = -1;
    r.loyalty = r.loyalty.map((x, i) => (i === p ? x : 0));
  }
  // rivals' scans reveal where they are looking (and that they paid for it)
  v.scans = v.scans.filter(sc => sc.owner === p);
  // a battle in progress is only visible where you can see fleets (nebulae hide it), or where you fight
  v.engagements = (v.engagements ?? []).filter(e => seesFleetsIn(s, p, e.region, cov) || s.fleets.some(f => f.owner === p && f.region === e.region));
  // last turn's per-player stats would reveal rivals' unseen battles (captures are public anyway)
  if (v.turnStats) {
    const own = <T>(arr: T[] | undefined, zero: T) => (arr ?? []).map((x, i) => (i === p ? x : zero));
    v.turnStats = { ...v.turnStats, kills: own(v.turnStats.kills, 0), battlesWon: own(v.turnStats.battlesWon, 0), crownBattlesWon: own(v.turnStats.crownBattlesWon, 0),
      // "<player>:<region>" keys: rivals' influence targets this turn are secret
      influenced: (v.turnStats.influenced ?? []).filter(k => k.startsWith(`${p}:`)) };
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
  if (v.soul) {
    // the Herald respects fog: public headlines, ones about you, and ones your sensors covered; dispatches are public once printed
    v.soul.beats = [];
    v.soul.dispatches = v.soul.dispatches.filter(d => d.p === p);
    v.soul.herald = v.soul.herald.map(ed => ({ ...ed, headlines: ed.headlines.filter(h => headlineVisible(h, p)) }));
    v.soul.moments = v.soul.moments.filter(h => headlineVisible(h, p));
    v.soul.fallen = v.soul.fallen.filter(r => r.owner === p || r.public || !!r.seenBy?.includes(p));
  }
  if (v.live) {
    // your own queue and bank only; rivals' banks and plans are secret
    v.live.queue = { [p]: v.live.queue[p] ?? [] };
    v.live.free = { [p]: v.live.free[p] ?? [] };
    v.live.bank = v.live.bank.map((b, i) => (i === p ? b : -1));
    v.live.nextOrderAt = v.live.nextOrderAt.map((t, i) => (i === p ? t : 0));
  }
  v.rngState = 0;   // can't predict combat rolls
  return { state: v, you: p, visible: [...cov] };
}

/** Filter any turn result for a player (null = everything). */
export function filterResultFor(s: GameState, r: TurnResult, p: PlayerId | null): TurnResult {
  if (p === null) return r;
  // current coverage is only "end of turn" coverage for the most recent turn; for older
  // turns it would leak events in regions the player only came to watch later
  // (LIVE: every tick of a cycle has the same turn number, so the tick must match too)
  const isLast = !!s.last && s.last.turn === r.turn && s.last.tick === r.tick;
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
  for (const rid of present) for (const x of withinArea(s, rid, S.fleetRange)) cov.add(x);
  for (const rid of owned) for (const x of withinArea(s, rid, S.ownedRange)) cov.add(x);
  const scanSeen = new Set<RegionId>();
  for (const rid of scanned) for (const x of withinArea(s, rid, S.scanRange)) { cov.add(x); scanSeen.add(x); }

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
      case 'tech': case 'law': return true;   // research and laws are public
      case 'refit': return e.owner === p || sees(e.region);
      case 'fail': return e.owner === p;
      case 'note': return e.owner === null || e.owner === p;
      case 'rout': return e.owner === p || e.by === p || sees(e.from) || sees(e.to);
      case 'soul': return e.owner === null || e.owner === p;
      // Signature: a decided posture is revealed to whoever it mattered to; Fate is public
      case 'posture': return e.owner === p || !!e.public || (!e.private && (!!e.with?.includes(p) || sees(e.region)));
      case 'fate': return true;
      default: return false;
    }
  });
  const battleIds = new Set(events.filter(e => e.k === 'battle').map(e => (e as { battle: number }).battle));
  // Ghosts stay hidden in replays too (Conspicuous and limping fleets are seen anyway)
  const ghostOk = (f: Fleet) => !f.banner?.boons.includes('ghosts') || seesFleet(startState, p, f);
  const startFleets = structuredClone((r.startFleets ?? []).filter(f => f.owner === p || (seesAtStart(f.region) && ghostOk(f))));
  for (const f of startFleets) if (f.owner !== p) maskRivalFleet(f);
  const seen = new Set<RegionId>();
  for (const rid of cov) if (sees(rid)) seen.add(rid);
  for (const e of events) if (e.k === 'battle') seen.add(e.region);
  return {
    result: {
      turn: r.turn,
      ...(r.tick !== undefined ? { tick: r.tick } : {}),   // LIVE: which tick of the cycle
      events,
      battles: r.battles.filter(b => battleIds.has(b.id)),
      signals: r.signals.filter(x => x.observer === p),
      startFleets,
      startOwners: r.startOwners,
    },
    seen,
  };
}
