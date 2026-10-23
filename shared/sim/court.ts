// ============================================================================
//  THE COURT (docs/SOUL.md phase C): Ransom, the Coronation (Kneel or Defy)
//  and Exile. Every number lives in rules.court; old saves without that group
//  play exactly as before (OPT_IN_LAYERS). Needs the Soul layer (blood-debts,
//  the Herald). Deterministic: no rng draws at all.
//
//  The contract (one decision each, all free actions):
//  - RANSOM. A commander whose fleet is wiped out by a house that still has
//    ships in the system, or whose limping fleet is caught by a fleet, is taken
//    captive instead of escaping (a commander who falls still falls). The captor
//    chooses, once a turn: RANSOM (names credits or influence; the price is
//    fixed by rank), EXECUTE (a grievance: a blood-debt that never clears, plus
//    a public headline), or TURN (pays influence; the commander serves the
//    captor with its memories and scars). The owner may pay named terms from the
//    next turn on. After court.releaseTurns turns the captive goes home free.
//  - CORONATION. A new Throne holder starts a public countdown: each living
//    rival answers KNEEL (influence now; striking the holder later costs VP) or
//    DEFY (free, printed). No answer by the deadline = Defy.
//  - EXILE. An eliminated house stays: it WHISPERS to the Warden (which then
//    hunts that house, if it is within court.whisperGap VP of the leader), casts
//    a GHOST VOTE (that house gains a little influence a turn and wins exact VP
//    ties), and earns EXILE POINTS from the losses of the house it marks. Only
//    points against the eventual winner count (the Saga and the League).
// ============================================================================
import { COURT_DEFAULTS } from '../config/rules.ts';
import { SCARS } from '../config/content.ts';
import { soulOn, beat, headline, ensureSoul } from './soul.ts';
import type { BattleReport, Captive, CaptiveAct, CourtState, DecreeAnswer, ExileState, Fleet, GameEvent, GameState, Order, PlayerId, RansomRes, RegionId, Submission } from './types.ts';

export type CourtRules = typeof COURT_DEFAULTS.court;
type Emit = (e: GameEvent) => void;

const cache = new WeakMap<object, CourtRules>();
/** Is the Court on? It needs the Soul layer; a save without a `court` rule group has it off (upgradeRules). */
export const courtOn = (s: GameState): boolean => soulOn(s) && !!s.rules.court && s.rules.court.enabled !== false;
/** The court knobs with defaults for anything missing. */
export function CR(s: GameState): CourtRules {
  const r = s.rules.court as CourtRules | undefined;
  if (!r) return COURT_DEFAULTS.court;
  let c = cache.get(r);
  if (!c) { c = { ...COURT_DEFAULTS.court, ...r }; cache.set(r, c); }
  return c;
}
export const ransomOn = (s: GameState) => courtOn(s) && CR(s).ransom !== false;
export const coronationOn = (s: GameState) => courtOn(s) && CR(s).coronation !== false;
export const exileOn = (s: GameState) => courtOn(s) && CR(s).exile !== false;

export function emptyCourt(): CourtState {
  return { nextId: 1, captives: [], records: [], coronation: null, kneels: [], decrees: [], paid: [], exiles: [] };
}
/** Create any missing Court state. Returns null when the Court is off. */
export function ensureCourt(s: GameState): CourtState | null {
  if (!courtOn(s)) return null;
  const c = (s.court ??= emptyCourt());
  c.nextId ??= 1; c.captives ??= []; c.records ??= []; c.coronation ??= null; c.kneels ??= []; c.decrees ??= []; c.paid ??= []; c.exiles ??= [];
  return c;
}

const pname = (s: GameState, p: PlayerId | -1 | null | undefined) => (p === -1 ? 'the Warden' : p === null || p === undefined ? 'no one' : s.players[p]?.name ?? '?');
const alive = (s: GameState, p: PlayerId | null | undefined): p is PlayerId => p !== null && p !== undefined && p >= 0 && !!s.players[p] && !s.players[p].eliminated;
function addVp(s: GameState, p: PlayerId, n: number, why: string) {
  if (!n) return;
  s.players[p].vp += n;
  s.players[p].vpLog.push({ turn: s.turn, amount: n, why });
}
/** A Court story beat for the two houses involved: one private event each (the 'soul' event's owner is its reader). */
function tell(emit: Emit, pulse: number, kind: string, players: PlayerId[], text: string, region?: RegionId) {
  for (const p of [...new Set(players)]) emit({ k: 'soul', pulse, kind, owner: p, text, ...(region !== undefined ? { region } : {}), players });
}
function shout(emit: Emit, pulse: number, kind: string, players: PlayerId[], text: string) {
  emit({ k: 'soul', pulse, kind, owner: null, text, players });
}

// ============================================================================ RANSOM
/** Can this commander be taken by `captor`? (A flag captain is a ship's officer, not a commander.) */
export function capturable(s: GameState, f: Fleet, captor: PlayerId | -1 | null | undefined): captor is PlayerId {
  return ransomOn(s) && captor !== null && captor !== undefined && captor >= 0 && captor !== f.owner && f.owner >= 0
    && f.commander.alive && !f.commander.name.endsWith('flag captain') && alive(s, captor);
}

/**
 * Take `f`'s commander captive (its fleet is gone). If the commander already escaped to its house's reserve
 * (combat rolled it), it is pulled back out. Returns the captive, or null if it can't be taken.
 */
export function captureCommander(s: GameState, f: Fleet, captor: PlayerId, at: RegionId, pulse: number, emit: Emit): Captive | null {
  if (!capturable(s, f, captor)) return null;
  const ct = ensureCourt(s)!;
  const cmd = f.commander;
  const res = s.players[f.owner].reserveCommanders;
  if (res) { const i = res.indexOf(cmd); if (i >= 0) res.splice(i, 1); }
  const c: Captive = {
    id: ct.nextId++, cmd, owner: f.owner, captor, fleet: f.name, region: at, turn: s.turn, until: s.turn + CR(s).releaseTurns,
    ...(f.scars?.length ? { scars: f.scars.map(x => ({ ...x })) } : {}), offer: null, refused: null,
  };
  ct.captives.push(c);
  ct.records.push({ turn: s.turn, kind: 'captured', cmd: cmd.name, owner: f.owner, captor, public: false });
  const r = s.regions[at];
  tell(emit, pulse, 'captured', [f.owner, captor], `${cmd.name} of ${f.name} is taken captive by ${pname(s, captor)} at ${r?.name ?? '?'}.`, at);
  // only the two houses read it (a witness saw a wreck, not who was pulled from it); the chronicle is public, so it stays out
  beat(s, { kind: 'captured', text: headline(s, 'captured', { c: cmd.name, a: pname(s, captor), b: pname(s, f.owner) }), region: at, players: [captor, f.owner], seenBy: [captor, f.owner], drama: 5 + Math.min(3, cmd.rank - 1), public: false });
  return c;
}

/** The fixed price of a captive's terms in a currency: base + perRank x rank. */
export function ransomPrice(s: GameState, c: Pick<Captive, 'cmd'>, res: RansomRes): number {
  const K = CR(s);
  const rank = Math.max(1, c.cmd.rank);
  return res === 'credits' ? K.ransomCredits + K.ransomCreditsPerRank * rank : K.ransomInfluence + K.ransomInfluencePerRank * rank;
}
/** What turning a captive costs its captor (influence). */
export function turnPrice(s: GameState, c: Pick<Captive, 'cmd'>): number {
  const K = CR(s);
  return K.turnInfluence + K.turnInfluencePerRank * Math.max(1, c.cmd.rank);
}

/** Why the captor can't act on this captive now (or null). */
export function captiveBlock(s: GameState, p: PlayerId, id: unknown, act: unknown, res?: unknown): string | null {
  if (!ransomOn(s)) return 'ransom is off in these rules';
  const c = s.court?.captives.find(x => x.id === id);
  if (!c) return 'no such captive';
  if (c.captor !== p) return 'not your captive';
  if (c.acted === s.turn) return 'you already decided on this captive this turn';
  if (act !== 'ransom' && act !== 'execute' && act !== 'turn') return 'ransom, execute or turn';
  if (act === 'ransom') {
    if (res !== 'credits' && res !== 'influence') return 'name the terms: credits or influence';
    if (!alive(s, c.owner)) return 'its house is gone: nobody can pay';
    if (c.offer && c.offer.res === res) return 'those terms are already on the table';
  }
  if (act === 'turn' && s.players[p].res.influence < turnPrice(s, c)) return `turning ${c.cmd.name} costs ${turnPrice(s, c)} influence`;
  return null;
}

/** The captor's decision. Call captiveBlock first. */
export function captiveAct(s: GameState, p: PlayerId, id: number, act: CaptiveAct, res: RansomRes | undefined, pulse: number, emit: Emit) {
  const ct = ensureCourt(s)!;
  const c = ct.captives.find(x => x.id === id)!;
  c.acted = s.turn;
  const cn = c.cmd.name;
  if (act === 'ransom') {
    const amount = ransomPrice(s, c, res!);
    c.offer = { res: res!, amount, turn: s.turn };
    c.refused = null;
    tell(emit, pulse, 'ransom_offer', [c.owner, p], `${pname(s, p)} names its terms for ${cn}: ${amount} ${res === 'credits' ? '¢' : 'influence'}.`);
    beat(s, { kind: 'ransom_offer', text: headline(s, 'ransom_offer', { a: pname(s, p), b: pname(s, c.owner), c: cn }), players: [p, c.owner], seenBy: [p, c.owner], drama: 3, public: false });
    return;
  }
  ct.captives = ct.captives.filter(x => x !== c);
  if (act === 'execute') {
    c.cmd.alive = false;
    const r = s.regions[c.region];
    r?.memorials.push(`${cn} (rank ${c.cmd.rank}), commander of ${c.fleet}, executed by ${pname(s, p)}, turn ${s.turn}.`);
    // the grievance: a blood-debt that never clears
    const st = ensureSoul(s);
    if (st) st.debts.push({ id: st.debts.length + 1, turn: s.turn, debtor: p, creditor: c.owner, killer: pname(s, p), victim: cn, fleet: c.fleet, region: c.region, cleared: null, grievance: true });
    ct.records.push({ turn: s.turn, kind: 'executed', cmd: cn, owner: c.owner, captor: p, public: true });
    shout(emit, pulse, 'executed', [p, c.owner], `${pname(s, p)} executes ${cn} of ${pname(s, c.owner)}. A grievance that will never be paid.`);
    beat(s, { kind: 'executed', text: headline(s, 'executed', { a: pname(s, p), b: pname(s, c.owner), c: cn }), players: [p, c.owner], drama: 8 + Math.min(2, c.cmd.rank - 1), public: true });
    s.chronicle.push({ turn: s.turn, players: [p, c.owner], major: true, text: `${pname(s, p)} executes ${cn}, once of ${pname(s, c.owner)}. ${pname(s, c.owner)} will not forget.` });
    return;
  }
  // turn: it serves the captor, keeping its memories (rivals, deeds, rank) and its fleet's scars
  s.players[p].res.influence -= turnPrice(s, c);
  c.cmd.turned = { from: c.owner, turn: s.turn };
  if (c.scars?.length) c.cmd.scars = c.scars.map(x => ({ ...x }));
  (s.players[p].reserveCommanders ??= []).push(c.cmd);
  ct.records.push({ turn: s.turn, kind: 'turned', cmd: cn, owner: c.owner, captor: p, public: true });
  shout(emit, pulse, 'turned', [p, c.owner], `${cn}, once of ${pname(s, c.owner)}, now serves ${pname(s, p)}.`);
  beat(s, { kind: 'turned', text: headline(s, 'turned', { c: cn, a: pname(s, p), b: pname(s, c.owner) }), players: [p, c.owner], drama: 6 + Math.min(2, c.cmd.rank - 1), public: true });
  s.chronicle.push({ turn: s.turn, players: [p, c.owner], major: c.cmd.rank >= 3, text: `${cn} turns their coat: once of ${pname(s, c.owner)}, now ${pname(s, p)}'s to command.` });
}

/** Why the owner can't answer terms now (or null). */
export function ransomBlock(s: GameState, p: PlayerId, id: unknown, pay: unknown): string | null {
  if (!ransomOn(s)) return 'ransom is off in these rules';
  const c = s.court?.captives.find(x => x.id === id);
  if (!c) return 'no such captive';
  if (c.owner !== p) return 'not your commander';
  if (!c.offer || c.offer.turn >= s.turn) return 'no terms have been named yet';
  if (pay === true && s.players[p].res[c.offer.res] < c.offer.amount) return `the terms are ${c.offer.amount} ${c.offer.res === 'credits' ? '¢' : 'influence'}`;
  return null;
}

/** The owner pays (the commander comes home now) or refuses (the captor decides again). */
export function answerRansom(s: GameState, p: PlayerId, id: number, pay: boolean, pulse: number, emit: Emit) {
  const ct = ensureCourt(s)!;
  const c = ct.captives.find(x => x.id === id)!;
  const o = c.offer!;
  if (!pay) {
    c.offer = null; c.refused = s.turn;
    tell(emit, pulse, 'ransom_refused', [p, c.captor], `${pname(s, p)} refuses to pay for ${c.cmd.name}.`);
    return;
  }
  s.players[p].res[o.res] -= o.amount;
  s.players[c.captor].res[o.res] += o.amount;
  ct.captives = ct.captives.filter(x => x !== c);
  (s.players[p].reserveCommanders ??= []).push(c.cmd);
  ct.records.push({ turn: s.turn, kind: 'ransomed', cmd: c.cmd.name, owner: p, captor: c.captor, res: o.res, amount: o.amount, public: false });
  tell(emit, pulse, 'ransomed', [p, c.captor], `${pname(s, p)} pays ${o.amount} ${o.res === 'credits' ? '¢' : 'influence'} and ${c.cmd.name} comes home.`);
  beat(s, { kind: 'ransomed', text: headline(s, 'ransomed', { b: pname(s, p), c: c.cmd.name, a: pname(s, c.captor) }), players: [c.captor, p], seenBy: [c.captor, p], drama: 4, public: false });
}

/** End of turn: captives whose clock has run out go home free (or, if their house is gone, simply go). */
function releaseCaptives(s: GameState, ct: CourtState, pulse: number, emit: Emit) {
  for (const c of ct.captives.slice()) {
    if (s.turn < c.until && alive(s, c.captor)) continue;
    ct.captives = ct.captives.filter(x => x !== c);
    const home = alive(s, c.owner);
    if (home) (s.players[c.owner].reserveCommanders ??= []).push(c.cmd);
    ct.records.push({ turn: s.turn, kind: 'released', cmd: c.cmd.name, owner: c.owner, captor: c.captor, public: false });
    tell(emit, pulse, 'released', [c.owner, c.captor], home ? `${c.cmd.name} is released by ${pname(s, c.captor)} and comes home.` : `${c.cmd.name} is released, with no house to return to.`);
    beat(s, { kind: 'released', text: headline(s, 'released', { a: pname(s, c.captor), c: c.cmd.name, b: pname(s, c.owner) }), players: [c.captor, c.owner], seenBy: [c.captor, c.owner], drama: 2, public: false });
  }
}

// ============================================================================ CORONATION
/** After the Throne's reigns are settled (soulReigns): a new reign opens a public countdown; old knees are released. */
export function courtReigns(s: GameState, pulse: number, emit: Emit) {
  const ct = ensureCourt(s);
  if (!ct) return;
  const holder = s.throne.owner;
  ct.kneels = ct.kneels.filter(k => k.holder === holder);
  if (ct.coronation && ct.coronation.holder !== holder) ct.coronation = null;   // the reign ended before every answer came
  if (holder === null || !coronationOn(s) || ct.coronation) return;
  const open = s.soul?.reigns.find(x => x.to === null);
  if (!open || open.p !== holder || open.from !== s.turn) return;
  const rivals = s.players.filter(p => p.id !== holder && !p.eliminated);
  if (!rivals.length) return;
  const K = CR(s);
  ct.coronation = { holder, since: s.turn, until: s.turn + K.decreeTurns, answers: {} };
  shout(emit, pulse, 'decree_open', [holder, ...rivals.map(p => p.id)], `The Coronation of ${pname(s, holder)}: every house must Kneel or Defy by the end of turn ${s.turn + K.decreeTurns}.`);
}

/** Why `p` can't answer the Coronation now (or null). */
export function decreeBlock(s: GameState, p: PlayerId, answer: unknown): string | null {
  if (!coronationOn(s)) return 'the Coronation is off in these rules';
  const cr = s.court?.coronation;
  if (!cr) return 'no coronation is waiting for an answer';
  if (answer !== 'kneel' && answer !== 'defy') return 'kneel or defy';
  if (p === cr.holder) return 'the holder does not kneel to itself';
  if (!alive(s, p)) return 'your house has fallen';
  if (cr.answers[p]) return 'you have already answered';
  return null;
}

/** A public answer. Kneel pays influence at once (once per house and holder per game); Defy is free and printed. */
export function answerDecree(s: GameState, p: PlayerId, answer: DecreeAnswer, pulse: number, emit: Emit, auto = false) {
  const ct = ensureCourt(s)!;
  const cr = ct.coronation!;
  cr.answers[p] = answer;
  ct.decrees.push({ turn: s.turn, p, holder: cr.holder, answer, ...(auto ? { auto: true } : {}) });
  const h = cr.holder;
  if (answer === 'kneel') {
    const key = `${p}:${h}`;
    let gain = 0;
    if (!ct.paid.includes(key)) { gain = CR(s).kneelInfluence; s.players[p].res.influence += gain; ct.paid.push(key); }
    ct.kneels = ct.kneels.filter(k => k.p !== p);
    ct.kneels.push({ p, holder: h, turn: s.turn });
    shout(emit, pulse, 'kneel', [p, h], `${pname(s, p)} kneels to ${pname(s, h)}${gain ? ` (+${gain} influence)` : ''}. Striking the Throne's holder now costs ${CR(s).kneelBreakVp} VP.`);
    beat(s, { kind: 'kneel', text: headline(s, 'kneel', { a: pname(s, p), b: pname(s, h) }), players: [p, h], drama: 4, public: true });
  } else {
    shout(emit, pulse, 'defy', [p, h], `${pname(s, p)} ${auto ? 'gives no answer, and so defies' : 'defies'} ${pname(s, h)}.`);
    beat(s, { kind: 'defy', text: headline(s, auto ? 'defy_silent' : 'defy', { a: pname(s, p), b: pname(s, h) }), players: [p, h], drama: auto ? 3 : 4, public: true });
  }
}

/** Does this order strike `holder`? (Seize one of its worlds or a system where its fleets stand; Influence one of its worlds.) */
export function strikesHolder(s: GameState, o: Order | null | undefined, holder: PlayerId): boolean {
  if (!o) return false;
  if (o.type === 'influence') return s.regions[o.target]?.owner === holder;
  if (o.type === 'seize') return s.regions[o.target]?.owner === holder || s.fleets.some(f => f.owner === holder && f.region === o.target && f.ships.length);
  return false;
}
/** Start of a step: a house that knelt and now strikes the holder breaks its knee and loses VP (public). */
export function checkKneels(s: GameState, subs: Record<number, Submission>, pulse: number, emit: Emit) {
  const ct = s.court;
  if (!ct || !coronationOn(s) || !ct.kneels.length) return;
  for (const k of ct.kneels.slice()) {
    if (!alive(s, k.p) || !(subs[k.p]?.orders ?? []).some(o => strikesHolder(s, o, k.holder))) continue;
    const n = CR(s).kneelBreakVp;
    addVp(s, k.p, -n, `Broke the knee to ${pname(s, k.holder)}`);
    ct.kneels = ct.kneels.filter(x => x !== k);
    ct.decrees.push({ turn: s.turn, p: k.p, holder: k.holder, answer: 'broke' });
    shout(emit, pulse, 'knee_broken', [k.p, k.holder], `${pname(s, k.p)} knelt to ${pname(s, k.holder)}, and now strikes it: −${n} VP.`);
    beat(s, { kind: 'knee_broken', text: headline(s, 'knee_broken', { a: pname(s, k.p), b: pname(s, k.holder) }), players: [k.p, k.holder], drama: 6, public: true });
    s.chronicle.push({ turn: s.turn, players: [k.p, k.holder], major: true, text: `${pname(s, k.p)} rises from its knee and strikes ${pname(s, k.holder)}. It costs ${n} VP.` });
  }
}

// ============================================================================ EXILE
/** Why an exile can't whisper / vote this way (or null). */
export function exileBlock(s: GameState, p: PlayerId, whisper: unknown, vote: unknown): string | null {
  if (!exileOn(s)) return 'exile is off in these rules';
  if (!s.court?.exiles.some(e => e.p === p)) return 'only an exiled house whispers to the Warden';
  if (whisper === undefined && vote === undefined) return 'whisper or vote';
  for (const x of [whisper, vote]) if (x !== undefined && (typeof x !== 'number' || !alive(s, x) || x === p)) return 'only a living house';
  return null;
}
export function setExile(s: GameState, p: PlayerId, whisper: PlayerId | undefined, vote: PlayerId | undefined, pulse: number, emit: Emit) {
  const e = s.court!.exiles.find(x => x.p === p)!;
  if (whisper !== undefined) e.whisper = whisper;
  if (vote !== undefined && vote !== e.vote) {
    e.vote = vote;
    shout(emit, pulse, 'ghost_vote', [p, vote], `The exiled ${pname(s, p)} casts its ghost vote for ${pname(s, vote)}.`);
    beat(s, { kind: 'ghost_vote', text: headline(s, 'ghost_vote', { a: pname(s, p), b: pname(s, vote) }), players: [p, vote], drama: 3, public: true });
  }
}
/** Ghost votes for `p` (for the VP tiebreak). */
export const ghostVotes = (s: GameState, p: PlayerId): number => (courtOn(s) ? (s.court?.exiles ?? []).filter(e => e.vote === p && alive(s, p)).length : 0);

/**
 * The house the Warden hunts on an exile's whisper, or null (then it hunts the VP leader as before). A whisper only
 * counts against a house within court.whisperGap VP of the leader: an exile can't turn it on the weakest. With
 * several exiles, the most-whispered house (ties: the one with more VP, then the lower seat).
 */
export function wardenTarget(s: GameState): PlayerId | null {
  if (!exileOn(s) || !s.court?.exiles.length) return null;
  const live = s.players.filter(p => !p.eliminated);
  if (live.length < 2) return null;
  const top = Math.max(...live.map(p => p.vp));
  const n = new Map<PlayerId, number>();
  for (const e of s.court.exiles) if (alive(s, e.whisper) && s.players[e.whisper].vp >= top - CR(s).whisperGap) n.set(e.whisper, (n.get(e.whisper) ?? 0) + 1);
  const best = [...n.entries()].sort((a, b) => b[1] - a[1] || s.players[b[0]].vp - s.players[a[0]].vp || a[0] - b[0])[0];
  return best ? best[0] : null;
}

/**
 * After every step (WEGO turn / LIVE tick): each exile's marked house pays for what it lost this step. Ships lost in
 * battle (the Warden's battles count double) and worlds lost (razed by the Warden: double).
 */
export function courtTally(s: GameState, battles: BattleReport[], events: GameEvent[], startOwners: (PlayerId | null)[]) {
  const ct = s.court;
  if (!ct || !exileOn(s) || !ct.exiles.length || s.winner !== null && ct.exiles.every(e => e.points !== undefined)) return;
  const K = CR(s);
  for (const e of ct.exiles) {
    const m = e.whisper;
    if (!alive(s, m)) continue;
    let pts = 0;
    for (const b of battles) {
      const lost = b.losses[String(m)] ?? 0;
      if (lost) pts += lost * K.exileShipPts * (b.sides.some(x => x.owner === -1) ? K.exileWardenMult : 1);
    }
    for (const r of s.regions) {
      if (startOwners[r.id] !== m || r.owner === m) continue;
      const warden = events.some(x => x.k === 'note' && x.region === r.id && x.text.startsWith('The Warden razes'));
      pts += K.exileWorldPts * (warden ? K.exileWardenMult : 1);
    }
    if (pts) { while (e.tally.length < s.players.length) e.tally.push(0); e.tally[m] += pts; }
  }
}

// ============================================================================ end of turn
/** End of a WEGO turn / LIVE cycle (after elimination and the reigns): exiles, ghost influence, the release clock, the deadline. */
export function courtEndTurn(s: GameState, pulse: number, emit: Emit) {
  const ct = ensureCourt(s);
  if (!ct) return;
  const K = CR(s);
  // a house that has just fallen goes into exile
  if (exileOn(s)) for (const p of s.players) if (p.eliminated && !ct.exiles.some(e => e.p === p.id)) {
    ct.exiles.push({ p: p.id, since: s.turn, whisper: null, vote: null, tally: s.players.map(() => 0) });
    shout(emit, pulse, 'exiled', [p.id], `${p.name} goes into exile. It will whisper to the Warden and keep a ghost vote at the Throne.`);
    beat(s, { kind: 'exiled', text: headline(s, 'exiled', { a: p.name }), players: [p.id], drama: 5, public: true });
  }
  for (const e of ct.exiles) {
    if (e.whisper !== null && !alive(s, e.whisper)) e.whisper = null;
    if (e.vote !== null && !alive(s, e.vote)) e.vote = null;
    if (e.vote !== null && K.ghostInfluence) s.players[e.vote].res.influence += K.ghostInfluence;
  }
  releaseCaptives(s, ct, pulse, emit);
  // the Coronation's deadline: silence is defiance
  const cr = ct.coronation;
  if (cr && s.turn >= cr.until) {
    for (const p of s.players) if (p.id !== cr.holder && !p.eliminated && !cr.answers[p.id]) answerDecree(s, p.id, 'defy', pulse, emit, true);
    ct.coronation = null;
  }
}

/** When the game is decided: each exile's points are what it cost the winner. */
export function courtFinal(s: GameState) {
  const ct = s.court;
  if (!ct || s.winner === null) return;
  for (const e of ct.exiles) if (e.points === undefined) e.points = e.tally[s.winner] ?? 0;
}

// ============================================================================ fog
/** The Court as `p` may see it: captives and terms for the two houses only, an exile's whisper and tally for itself. */
export function courtViewFor(ct: CourtState, p: PlayerId): CourtState {
  return {
    ...ct,
    captives: ct.captives.filter(c => c.owner === p || c.captor === p),
    records: ct.records.filter(r => r.public || r.owner === p || r.captor === p),
    exiles: ct.exiles.map(e => (e.p === p ? e : { ...e, whisper: null, tally: [] })),
  };
}

/** A scar line for UI and stories ("Burned Hull"). */
export const scarName = (id: string) => SCARS[id]?.name ?? id;
/** The exile record of `p`, if it is in exile. */
export const exileOf = (s: GameState, p: PlayerId): ExileState | undefined => s.court?.exiles.find(e => e.p === p);
