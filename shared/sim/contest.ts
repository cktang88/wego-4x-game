// ============================================================================
//  CONTESTED, OCCUPIED AND TRIBUTE (docs/SYSTEMS.md step 3): who gets a star
//  system's output while it is fought over, just taken, or bought off.
//
//  - Contested: a hostile warship is in a system its owner still holds. Space
//    goes to whoever won the last battle there and still has ships there, else
//    to the larger fleet force (ties: the owner). Two mutually hostile
//    besiegers with no clear holder: nobody holds space.
//      Orbital output (gas giant, belt, Station) goes to the space holder: the
//      owner keeps it all; an attacker takes plunderShare (allied besiegers
//      split it) and the rest is lost; nobody holding space: all lost.
//      Surface output stays with the owner, but while it doesn't hold space
//      it is BLOCKADED: industry and credits at 50%, influence 0.
//      No citizen growth; every refugeeTurns contested turns, -1 citizen:
//      refugees resettle the owner's nearest system with room.
//  - Occupied: a system just taken from a house pays its new owner
//    occupiedShare for occupiedTurns turns (the same turns its Calling sleeps).
//  - Tribute: a besieger offers terms (free action); the owner accepts the next
//    turn; the siege lifts, the two don't fight there, and the besieger takes
//    tributeShare of the output for tributeTurns turns. A Seize there breaks it
//    (Oathbreaker).
//  Everything is off (old behaviour) unless sysOn and rules.systems.contested.
// ============================================================================
import { hostile } from './combat.ts';
import { fleetPower } from './graph.ts';
import { soulOn, beat, headline } from './soul.ts';
import { wpostureOf } from './signature.ts';
import { SY, sysOn, sysAt, citizenBody, citizenCap, ledgerAdd, bodyName, tributeCovers } from './systems.ts';
import type { Fleet, GameEvent, GameState, PlayerId, Region, RegionId } from './types.ts';

type Emit = (e: GameEvent) => void;
type Owner = PlayerId | -1;

/** Is step 3 on? Star systems on, and rules.systems.contested not switched off. */
export const contestOn = (s: GameState): boolean => sysOn(s) && SY(s).contested !== false;

const pname = (s: GameState, p: Owner | null | undefined) => (p === -1 ? 'the Warden' : p === null || p === undefined ? 'no one' : s.players[p]?.name ?? '?');
/** A warship (as for supply lines: armed and not a lone scout) that can hold or contest space. */
const warship = (f: Fleet) => f.ships.length > 0 && !f.limping && f.ships.some(sh => sh.sys.weapons && sh.cls !== 'scout');

export interface Contest {
  /** Who holds space: the owner, a besieger, or nobody (null). */
  holder: Owner | null;
  /** Houses (and the Warden, -1) with warships here hostile to the owner. */
  besiegers: Owner[];
  /** Houses taking plunder (the space holder and its allied besiegers); empty if the owner or nobody holds space. */
  plunderers: PlayerId[];
  /** Fleet strength by side present here. */
  force: Map<number, number>;
}

/** The contest over an owned system right now, or null if it is not contested (or step 3 is off). */
export function contestOf(s: GameState, r: Region): Contest | null {
  if (!contestOn(s) || r.owner === null || !sysAt(s, r)) return null;
  const owner = r.owner;
  const here = s.fleets.filter(f => f.region === r.id && f.ships.length && !f.limping);
  const foes = here.filter(f => warship(f) && hostile(s, f.owner, owner, r.id));
  if (!foes.length) return null;
  const force = new Map<number, number>();
  for (const f of here) force.set(f.owner, (force.get(f.owner) ?? 0) + fleetPower(s, f));
  const besiegers = [...new Set(foes.map(f => f.owner))].sort((a, b) => a - b);
  let holder: Owner | null;
  const w = r.spaceWon;
  if (w && (force.get(w.p) ?? 0) > 0 && (w.p === owner || besiegers.includes(w.p))) holder = w.p;
  else {
    const own = force.get(owner) ?? 0;
    let best: Owner = besiegers[0], bf = -1;
    for (const b of besiegers) { const v = force.get(b) ?? 0; if (v > bf) { bf = v; best = b; } }
    if (own > 0 && own >= bf) holder = owner;
    else holder = besiegers.some(a => besiegers.some(b => a < b && hostile(s, a, b, r.id))) ? null : best;
  }
  const plunderers = holder !== null && holder !== owner && holder !== -1
    ? besiegers.filter((b): b is PlayerId => b >= 0 && (b === holder || !hostile(s, b, holder, r.id))) : [];
  return { holder, besiegers, plunderers, force };
}

/** Per-resource fractions: industry, credits, influence. */
export interface Frac { i: number; c: number; f: number }
/** One receiver's cut of a system's output: of its orbital part (o) and of its surface part (s). */
export interface Share { o: Frac; s: Frac }
export interface Shares {
  /** Every house that receives something (the owner always appears, possibly with zeros). */
  get: Map<PlayerId, Share>;
  contest: Contest | null;
  occupied: Region['occupied'] | null;
  tribute: Region['tribute'] | null;
  /** The owner bet Scorched Earth this turn: no plunder. */
  scorched: boolean;
  /** The surface is blockaded (the owner doesn't hold space). */
  blockaded: boolean;
}
const frac = (i: number, c = i, f = i): Frac => ({ i, c, f });
const scale = (x: Frac, k: number): Frac => ({ i: x.i * k, c: x.c * k, f: x.f * k });

/**
 * Who gets what of an owned system's output this turn. null = Held: the owner gets everything (also when step 3 is
 * off, on old maps and for unowned systems), so incomes are exactly as before.
 */
export function systemShares(s: GameState, r: Region): Shares | null {
  if (!contestOn(s) || r.owner === null || !sysAt(s, r)) return null;
  const c = contestOf(s, r);
  const occ = r.occupied && r.occupied.by === r.owner && s.turn < r.occupied.until ? r.occupied : null;
  const trib = r.tribute && r.tribute.from === r.owner && s.turn < r.tribute.until && s.players[r.tribute.to] && !s.players[r.tribute.to].eliminated ? r.tribute : null;
  if (!c && !occ && !trib) return null;
  const Y = SY(s);
  const own: Share = { o: frac(1), s: frac(1) };
  const get = new Map<PlayerId, Share>([[r.owner, own]]);
  const add = (p: PlayerId, x: Share) => {
    const g = get.get(p) ?? { o: frac(0), s: frac(0) };
    get.set(p, { o: { i: g.o.i + x.o.i, c: g.o.c + x.o.c, f: g.o.f + x.o.f }, s: { i: g.s.i + x.s.i, c: g.s.c + x.s.c, f: g.s.f + x.s.f } });
  };
  const scorched = wpostureOf(s, r) === 'scorch';
  let blockaded = false;
  if (c && c.holder !== r.owner) {
    blockaded = true;
    own.o = frac(0);
    own.s = frac(Y.blockadeIndustry, Y.blockadeCredits, Y.blockadeInfluence);
    // Scorched Earth beats plunder: the owner burns what the besiegers would have carried off
    if (c.plunderers.length && !scorched) {
      const k = Y.plunderShare / c.plunderers.length;
      for (const p of c.plunderers) add(p, { o: frac(k), s: frac(0) });
    }
  }
  if (occ) { const k = occ.scorched ? 0 : Y.occupiedShare; own.o = scale(own.o, k); own.s = scale(own.s, k); }
  if (trib) {
    const k = Math.max(0, Math.min(1, Y.tributeShare));
    const cut: Share = { o: scale(own.o, k), s: scale(own.s, k) };
    own.o = scale(own.o, 1 - k); own.s = scale(own.s, 1 - k);
    add(trib.to, cut);
  }
  return { get, contest: c, occupied: occ, tribute: trib, scorched, blockaded };
}

/** A system's status for the UI and the AI: Held, Contested, Occupied or Tribute (several can apply). */
export function systemStatus(s: GameState, r: Region) {
  const sh = systemShares(s, r);
  const Y = SY(s);
  const turns = r.contested ?? 0;
  return {
    held: !sh,
    contested: !!sh?.contest,
    blockaded: !!sh?.blockaded,
    holder: sh?.contest?.holder ?? (r.owner ?? null),
    plunderers: sh?.contest?.plunderers ?? [],
    besiegers: sh?.contest?.besiegers ?? [],
    contestedTurns: turns,
    /** Contested turns until the next refugees leave (null: not contested, or too few citizens to lose). */
    refugeesIn: sh?.contest && r.dev > Y.refugeeMinCitizens ? Y.refugeeTurns - (turns % Y.refugeeTurns) : null,
    occupiedLeft: sh?.occupied ? sh.occupied.until - s.turn : 0,
    occupiedScorched: !!sh?.occupied?.scorched,
    tribute: sh?.tribute ?? null,
    tributeLeft: sh?.tribute ? sh.tribute.until - s.turn : 0,
    shares: sh,
  };
}

// ------------------------------------------------------------------ battles & captures
/** An engagement here ended: its winner (if still here with ships) holds space. */
export function noteBattleWon(s: GameState, r: Region, winner: Owner | null) {
  if (!contestOn(s) || winner === null || r.kind === 'lane') return;
  r.spaceWon = { p: winner, turn: s.turn };
}

/**
 * A capture (resolve.ts capture, after the war-scar citizen is taken): that citizen becomes refugees for the old
 * owner, the system is Occupied for the new owner (not on a Liberation, nor a neutral or influence capture; a
 * scorched capture pays nothing), any Tribute ends and the taker holds space.
 */
export function onCaptureContest(s: GameState, r: Region, by: PlayerId, from: PlayerId | null, how: 'force' | 'influence', lostCitizen: boolean, liberated: boolean, scorched: boolean, pulse: number, emit: Emit) {
  if (!contestOn(s)) return;
  const Y = SY(s);
  r.tribute = null;
  delete r.contested;
  r.spaceWon = how === 'force' ? { p: by, turn: s.turn } : null;
  r.occupied = how === 'force' && from !== null && !liberated && Y.occupiedTurns > 0
    ? { by, until: s.turn + Y.occupiedTurns, ...(scorched ? { scorched: true } : {}) } : null;
  for (const p of s.players) dropOffers(p, r.id);
  if (from !== null) {
    ledgerAdd(s, r, { turn: s.turn, kind: 'capture', text: `Taken by ${pname(s, by)} from ${pname(s, from)}.`, body: citizenBody(r), players: [by, from] });
    if (lostCitizen) resettle(s, r, from, [by], pulse, emit);
  }
}

// ------------------------------------------------------------------ refugees
/** The old owner's nearest system with room (citizens below the cap), not contested; ties by id. */
export function refugeeHaven(s: GameState, src: Region, p: PlayerId): Region | null {
  const seen = new Set<RegionId>([src.id]);
  let frontier = [src.id];
  while (frontier.length) {
    const next: RegionId[] = [];
    const hits: Region[] = [];
    for (const rid of frontier) {
      const reg = s.regions[rid];
      for (const n of [...(reg.links ?? reg.neighbors)].sort((a, b) => a - b)) {
        if (seen.has(n)) continue;
        seen.add(n); next.push(n);
        const r = s.regions[n];
        if (r.owner !== p || !sysAt(s, r) || r.kind === 'void') continue;
        if (r.dev >= (citizenCap(s, r) ?? 0) || contestOf(s, r)) continue;
        hits.push(r);
      }
    }
    if (hits.length) return hits.sort((a, b) => a.id - b.id)[0];
    frontier = next;
  }
  return null;
}
/** One citizen of `src` flees: it resettles `p`'s nearest system with room (logged on both ledgers), or is lost. */
export function resettle(s: GameState, src: Region, p: PlayerId, cause: Owner[], pulse: number, emit: Emit): Region | null {
  if (!s.players[p] || s.players[p].eliminated) return null;
  const dest = refugeeHaven(s, src, p);
  const players = [p, ...cause.filter((x): x is PlayerId => x >= 0 && x !== p)];
  if (dest) {
    dest.dev++;
    const db = citizenBody(dest);
    ledgerAdd(s, src, { turn: s.turn, kind: 'refugees', text: `Refugees flee for ${dest.name}.`, body: citizenBody(src), players });
    ledgerAdd(s, dest, { turn: s.turn, kind: 'refuge', text: `Refugees from ${src.name} settle here.`, body: db, players: [p] });
    s.chronicle.push({ turn: s.turn, region: dest.id, players, text: `Refugees from ${src.name} resettle at ${bodyName(dest, db) ?? dest.name}${bodyName(dest, db) ? ` (${dest.name})` : ''}.`, ...(db !== undefined ? { body: db } : {}) });
    emit({ k: 'note', pulse, owner: p, text: `Refugees from ${src.name} resettle at ${dest.name} (citizens ${dest.dev}).`, region: dest.id });
    beat(s, { kind: 'refugees', text: headline(s, 'refugees', { r: src.name, x: dest.name }), region: src.id, players, drama: 3, public: false });
  } else {
    ledgerAdd(s, src, { turn: s.turn, kind: 'refugees', text: 'Refugees flee into the dark: no world of theirs has room.', body: citizenBody(src), players });
    s.chronicle.push({ turn: s.turn, region: src.id, players, text: `Refugees flee ${src.name}, but no world of ${pname(s, p)} has room for them.` });
    emit({ k: 'note', pulse, owner: p, text: `Refugees flee ${src.name}: none of your systems has room.`, region: src.id });
    beat(s, { kind: 'refugees', text: headline(s, 'refugees_lost', { r: src.name }), region: src.id, players, drama: 3, public: false });
  }
  return dest;
}

// ------------------------------------------------------------------ tribute
const dropOffers = (p: GameState['players'][number], rid: RegionId) => {
  if (p.tributeOffers?.includes(rid)) p.tributeOffers = p.tributeOffers.filter(x => x !== rid);
  if (p.prevTributeOffers?.includes(rid)) p.prevTributeOffers = p.prevTributeOffers.filter(x => x !== rid);
};

/**
 * Offers live in two lists, like pact offers: `tributeOffers` (made this turn) and `prevTributeOffers` (last
 * turn's, still answerable). While planning (the state after a resolution) last turn's offers are in
 * `tributeOffers`; during the next resolution they have moved to `prevTributeOffers`. LIVE: either list.
 */
export type OfferPhase = 'plan' | 'resolve';
const offered = (s: GameState, p: GameState['players'][number], rid: RegionId, phase: OfferPhase) =>
  (phase === 'resolve' || s.live ? (p.prevTributeOffers ?? []).includes(rid) : false) || (phase === 'plan' || s.live ? (p.tributeOffers ?? []).includes(rid) : false);

/** Why `p` can't offer terms over this system now, or null. */
export function tributeBlock(s: GameState, p: PlayerId, rid: unknown, phase: OfferPhase = 'plan'): string | null {
  if (!contestOn(s)) return 'tribute is off in these rules';
  const r = Number.isInteger(rid) ? s.regions[rid as number] : undefined;
  if (!r || !sysAt(s, r)) return 'not a star system';
  if (r.owner === null || r.owner === p) return 'only a rival house’s system can pay tribute';
  if (r.tribute && s.turn < r.tribute.until) return r.tribute.to === p ? 'it already pays you tribute' : 'it already pays tribute';
  if (!hostile(s, p, r.owner, r.id)) return 'you are at peace with them';
  const c = contestOf(s, r);
  if (!c || !c.besiegers.includes(p)) return 'you need warships in the system';
  if ((phase === 'resolve' || s.live) && (s.players[p].tributeOffers ?? []).includes(r.id)) return 'terms already offered this turn';
  return null;
}
/** The house whose terms over this system can be accepted now (offered last turn; LIVE: also this cycle), or null. */
export function tributeOfferer(s: GameState, rid: RegionId, phase: OfferPhase = 'plan'): PlayerId | null {
  const r = s.regions[rid];
  if (!r || r.owner === null) return null;
  const c = contestOf(s, r);
  let best: PlayerId | null = null, bf = -1;
  for (const p of s.players) {
    if (p.id === r.owner || p.eliminated) continue;
    if (!offered(s, p, rid, phase)) continue;
    if (!c || !c.besiegers.includes(p.id)) continue;   // its warships have gone: the offer lapsed
    const f = c.force.get(p.id) ?? 0;
    if (f > bf) { bf = f; best = p.id; }
  }
  return best;
}
/** Why `q` can't accept terms over this system now, or null. */
export function acceptBlock(s: GameState, q: PlayerId, rid: unknown, phase: OfferPhase = 'plan'): string | null {
  if (!contestOn(s)) return 'tribute is off in these rules';
  const r = Number.isInteger(rid) ? s.regions[rid as number] : undefined;
  if (!r) return 'no such system';
  if (r.owner !== q) return 'not your system';
  if (r.tribute && s.turn < r.tribute.until) return 'it already pays tribute';
  if (tributeOfferer(s, r.id, phase) === null) return `no terms are on the table for ${r.name}`;
  return null;
}

/** Offer terms (free action): the system's owner may accept them during its next turn. */
export function offerTribute(s: GameState, p: PlayerId, rid: RegionId, pulse: number, emit: Emit) {
  const r = s.regions[rid];
  const q = r.owner!;
  (s.players[p].tributeOffers ??= []).push(rid);
  const Y = SY(s);
  const terms = `${Math.round(Y.tributeShare * 100)}% of its output for ${Y.tributeTurns} turns`;
  emit({ k: 'note', pulse, owner: p, text: `You offer ${s.players[q].name} terms over ${r.name}: ${terms}, and your siege lifts.`, region: rid });
  emit({ k: 'note', pulse, owner: q, text: `${s.players[p].name} offers terms over ${r.name}: pay ${terms} and the siege lifts. Answer next turn.`, region: rid });
  beat(s, { kind: 'tribute_offer', text: headline(s, 'tribute_offer', { a: s.players[p].name, b: s.players[q].name, r: r.name }), region: rid, players: [p, q], drama: 2, public: false });
}

/** Accept terms (free action by the owner): the siege lifts and the Tribute runs for tributeTurns turns. */
export function acceptTribute(s: GameState, q: PlayerId, rid: RegionId, pulse: number, emit: Emit) {
  const r = s.regions[rid];
  const a = tributeOfferer(s, rid, 'resolve')!;
  const Y = SY(s);
  r.tribute = { from: q, to: a, since: s.turn, until: s.turn + Math.max(1, Y.tributeTurns) };
  for (const f of s.fleets) {
    if (f.owner !== a || f.region !== rid) continue;
    if (f.siege === rid) f.siege = null;
    if (f.route?.seize === rid) f.route = null;
  }
  for (const p of s.players) dropOffers(p, rid);
  delete r.contested;
  const text = `${r.name} paid tribute to ${s.players[a].name}.`;
  const body = citizenBody(r);
  ledgerAdd(s, r, { turn: s.turn, kind: 'tribute', text, body, players: [q, a] });
  s.chronicle.push({ turn: s.turn, region: rid, players: [q, a], major: true, ...(body !== undefined ? { body } : {}),
    text: `${s.players[q].name} buys peace: ${text.slice(0, -1)}, a third of its output until turn ${r.tribute.until - 1}. The siege lifts.` });
  emit(soulOn(s) ? { k: 'soul', pulse, kind: 'tribute', owner: null, text: `${text} The siege lifts.`, region: rid, players: [q, a] }
    : { k: 'note', pulse, owner: null, text: `${text} The siege lifts.`, region: rid });
  beat(s, { kind: 'tribute', text: headline(s, 'tribute', { a: s.players[a].name, b: s.players[q].name, r: r.name }), region: rid, players: [q, a], drama: 5, public: true });
}

/** `p` seized a system that pays it tribute: the terms are broken. Like a pact: VP and the Oathbreaker brand. */
export function breakTribute(s: GameState, p: PlayerId, rid: RegionId, pulse: number, emit: Emit) {
  const r = s.regions[rid];
  const t = r.tribute;
  if (!t) return;
  const victim = t.from === p ? t.to : t.from;
  r.tribute = null;
  const words = `${r.name} paid tribute to ${s.players[t.to].name}`;
  const vp = s.rules.influence.pactBreakVp;
  if (vp) { s.players[p].vp -= vp; s.players[p].vpLog.push({ turn: s.turn, amount: -vp, why: `Broke the tribute of ${r.name}` }); }
  if (soulOn(s)) {
    (s.players[p].oathbreaker ??= []).push({ turn: s.turn, victim, words });
    emit({ k: 'soul', pulse, kind: 'oath', owner: null, text: `${s.players[p].name} breaks the tribute of ${r.name}: "${words}"`, region: rid, players: [p, victim] });
    beat(s, { kind: 'oath', text: headline(s, 'tribute_broken', { a: s.players[p].name, b: s.players[victim].name, r: r.name }), region: rid, players: [p, victim], drama: 8, public: true });
  }
  emit({ k: 'betrayal', pulse, by: p, victim, region: rid });
  ledgerAdd(s, r, { turn: s.turn, kind: 'betrayal', text: `${s.players[p].name} broke the tribute and attacked.`, body: citizenBody(r), players: [p, victim] });
  s.chronicle.push({ turn: s.turn, region: rid, players: [p, victim], major: true, text: `${s.players[p].name} breaks the tribute and falls on ${r.name}. ${s.players[victim].name} will remember.` });
}

// ------------------------------------------------------------------ end of turn
/**
 * End of a WEGO turn / LIVE cycle, after income and growth: count contested turns (refugees every refugeeTurns),
 * let finished occupations and tributes lapse, forget a battle winner who has left.
 */
export function contestEndTurn(s: GameState, pulse: number, emit: Emit) {
  if (!contestOn(s)) return;
  const Y = SY(s);
  for (const r of s.regions) {
    if (r.kind === 'lane' || !r.bodies) continue;
    if (r.owner === null) { if (r.contested) delete r.contested; if (r.occupied) r.occupied = null; if (r.tribute) r.tribute = null; continue; }
    const c = contestOf(s, r);
    if (c) {
      r.contested = (r.contested ?? 0) + 1;
      if (Y.refugeeTurns > 0 && r.contested % Y.refugeeTurns === 0 && r.dev > Y.refugeeMinCitizens) {
        r.dev--;
        resettle(s, r, r.owner, c.besiegers, pulse, emit);
      }
    } else if (r.contested) delete r.contested;
    if (r.occupied && (r.occupied.by !== r.owner || s.turn + 1 >= r.occupied.until)) r.occupied = null;
    if (r.tribute && (r.tribute.from !== r.owner || s.turn + 1 >= r.tribute.until)) {
      const t = r.tribute;
      r.tribute = null;
      if (t.from === r.owner && s.players[t.to]) {
        ledgerAdd(s, r, { turn: s.turn, kind: 'paid', text: `The tribute to ${s.players[t.to].name} is paid in full.`, players: [t.from, t.to] });
        emit({ k: 'note', pulse, owner: t.from, text: `${r.name} has paid its tribute to ${s.players[t.to].name} in full.`, region: r.id });
        emit({ k: 'note', pulse, owner: t.to, text: `${r.name}'s tribute is paid in full: the terms end.`, region: r.id });
      }
    }
    if (r.spaceWon && !s.fleets.some(f => f.region === r.id && f.owner === r.spaceWon!.p && f.ships.length && !f.limping)) r.spaceWon = null;
  }
}

/** Expose for the resolver: the tribute between `p` and the system's owner covers this system. */
export const coveredByTribute = (s: GameState, p: PlayerId, rid: RegionId) => {
  const r = s.regions[rid];
  return r?.owner !== null && r?.owner !== undefined && tributeCovers(s, p, r.owner, rid);
};
