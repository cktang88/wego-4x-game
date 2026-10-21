// ============================================================================
//  SIGNATURE MECHANICS (docs/SIGNATURE.md): Postures and Fate.
//
//  Postures are "call it" by committing forces. Each fleet may take one secret
//  posture a turn (LIVE: a cycle) with a FreeAction {type:'posture'}; each owned
//  system one secret world posture {type:'wposture'}. A posture pays off when
//  the read was right (CALLED IT) and costs something when it was wrong
//  (CAUGHT OUT). Fate tokens {type:'fate'} are public luck you spend.
//  Every number lives in rules.signature; old saves whose rules lack that group
//  play without any of it (sigOn = false).
//
//  Contract (also see types.ts):
//  - Fleet.posture (secret), Fleet.postureFx (secret bookkeeping), Fleet.dugIn
//    (secret), Fleet.exposed (public), Fleet.fate (public: this turn's Fate).
//  - Region.wposture (secret to its owner), Region.idleUntil (secret), Region.surge (public).
//  - Player.fate (public tokens left), Player.fateBonus, Player.postureLog (revealed postures).
//  - Events: {k:'posture', ...outcome 'called'|'caught'|'none'} and {k:'fate', ...}.
//
//  Posture vs doctrine: doctrine keeps its retreat threshold, target priority and
//  guard flag; where the stance conflicts, the posture wins (effStance): a fleet
//  that is Guarded, Charging or lying in Ambush never acts Evasive this turn.
//  Fortify stacks with Guarded (Guarded counts as fortified, and its own bonus
//  comes on top). Ambushers (boon) doubles its first volley as usual; Clean Break
//  still breaks off cleanly. Limping fleets may only be Steady or Running.
// ============================================================================
import { SIGNATURE_DEFAULTS } from '../config/rules.ts';
import { POSTURES, WORLD_POSTURES, FATE_USES } from '../config/content.ts';
import { beat, headline } from './soul.ts';
import type { Rng } from './rng.ts';
import type { Engagement, FateUse, Fleet, GameEvent, GameState, PlayerId, Posture, PostureFx, PostureOutcome, Region, RegionId, Stance, Submission, WorldPosture } from './types.ts';

export type SigRules = typeof SIGNATURE_DEFAULTS.signature;
type Emit = (e: GameEvent) => void;
type Owner = PlayerId | -1;

export const POSTURE_IDS: Posture[] = ['steady', 'guarded', 'running', 'charge', 'ambush'];
export const WORLD_POSTURE_IDS: WorldPosture[] = ['levies', 'scorch', 'gates'];
export const FATE_IDS: FateUse[] = ['laststand', 'surge', 'hyperjump', 'twist', 'rally'];

const cache = new WeakMap<object, SigRules>();
/** Are the signature mechanics on in these rules? (Old saves without a `signature` rule group: off.) */
export const sigOn = (s: GameState): boolean => !!s.rules.signature && s.rules.signature.enabled !== false;
/** The signature knobs with defaults for anything missing. */
export function SG(s: GameState): SigRules {
  const r = s.rules.signature as SigRules | undefined;
  if (!r) return SIGNATURE_DEFAULTS.signature;
  let c = cache.get(r);
  if (!c) { c = { ...SIGNATURE_DEFAULTS.signature, ...r }; cache.set(r, c); }
  return c;
}
export const posturesOn = (s: GameState) => sigOn(s) && SG(s).postures !== false;
export const worldPosturesOn = (s: GameState) => sigOn(s) && SG(s).worldPostures !== false;
export const fateOn = (s: GameState) => sigOn(s) && SG(s).fate !== false;

const hostileP = (s: GameState, a: Owner, b: Owner) => {
  if (a === b) return false;
  if (a === -1 || b === -1) return true;
  return !s.pacts.some(x => x.until >= s.turn && ((x.a === a && x.b === b) || (x.a === b && x.b === a)));
};
const pname = (s: GameState, p: Owner | null) => (p === -1 ? 'the Warden' : p === null ? 'no one' : s.players[p]?.name ?? '?');
export const postureName = (k: string) => POSTURES[k]?.name ?? WORLD_POSTURES[k]?.name ?? k;
export const fateName = (k: string) => FATE_USES[k]?.name ?? k;

/** Fill in missing signature state (new games and old saves): Fate tokens. */
export function ensureSig(s: GameState) {
  if (!fateOn(s)) return;
  for (const p of s.players) if (p.fate === undefined) p.fate = SG(s).fateStart;
}

// ------------------------------------------------------------------ per-turn bookkeeping
/** This turn's posture bookkeeping for a fleet (created on demand; stale entries from an earlier turn are replaced). */
export function fx(s: GameState, f: Fleet): PostureFx {
  if (!f.postureFx || f.postureFx.turn !== s.turn) f.postureFx = { turn: s.turn };
  return f.postureFx;
}
const fxNow = (s: GameState, f: Fleet): PostureFx | null => (f.postureFx && f.postureFx.turn === s.turn ? f.postureFx : null);
/** The fleet's posture this turn (Steady when none, or when postures are off). */
export function postureOf(s: GameState, f: Fleet): Posture {
  return posturesOn(s) && f.posture ? f.posture : 'steady';
}
/** The stance it actually fights with: a Guarded, Charging or Ambushing fleet never acts Evasive (the posture wins). */
export function effStance(s: GameState, f: Fleet): Stance {
  const st = f.doctrine.stance;
  if (st !== 'evasive') return st;
  const p = postureOf(s, f);
  return p === 'guarded' ? 'defensive' : p === 'charge' || p === 'ambush' ? 'aggressive' : st;
}
/** Movement change from the posture this turn (Guarded −1, Running +2). Applied by the mover, not fleetSpeed. */
export function postureSpeed(s: GameState, f: Fleet): number {
  const p = postureOf(s, f);
  return p === 'guarded' ? SG(s).guardedSpeed : p === 'running' ? SG(s).runningSpeed : 0;
}
export const isDugIn = (s: GameState, f: Fleet) => posturesOn(s) && f.dugIn !== undefined && f.dugIn !== null && f.dugIn >= s.turn;
export const isExposed = (s: GameState, f: Fleet) => posturesOn(s) && f.exposed !== undefined && f.exposed !== null && f.exposed >= s.turn;
/** A Fate spent on this fleet this turn (or null). */
export const fateOf = (s: GameState, f: Fleet | null | undefined): FateUse | null => (f && sigOn(s) && f.fate && f.fate.turn === s.turn ? f.fate.use : null);
export const hasHyperjump = (s: GameState, f: Fleet) => fateOf(s, f) === 'hyperjump';
/** Last Stand this turn: never retreats, routs or is forced out (it dies instead), and hits harder. */
export const fateStand = (s: GameState, f: Fleet | null | undefined) => fateOf(s, f) === 'laststand';

// ------------------------------------------------------------------ fleet postures: choosing
/** Why `p` can't give fleet `f` this posture now, or null. */
export function postureBlock(s: GameState, p: PlayerId, f: Fleet | undefined, posture: unknown): string | null {
  if (!posturesOn(s)) return 'postures are off in these rules';
  if (!f || f.owner !== p || !f.ships.length) return 'no such fleet of yours';
  if (typeof posture !== 'string' || !POSTURE_IDS.includes(posture as Posture)) return 'unknown posture';
  if (fxNow(s, f)?.set) return 'it already took a posture this turn';
  if (f.limping && posture !== 'steady' && posture !== 'running') return 'a limping fleet can only be Steady or Running';
  if (posture === 'running' && isDugIn(s, f)) return 'it is dug in and cannot move this turn';
  if (posture === 'ambush' && f.route && f.route.path.length) return 'an ambush lies still: halt its journey first';
  return null;
}
export function setPosture(s: GameState, f: Fleet, posture: Posture) {
  fx(s, f).set = true;
  f.posture = posture === 'steady' ? null : posture;
}

/**
 * After all free actions, before orders (WEGO) / each tick (LIVE): postures that contradict the fleet's
 * orders fall back to Steady. Charge needs a Seize (or a siege it is pressing); Ambush must lie still.
 * (Guarded fleets keep their posture: their seizes fail instead, see resolve.ts.)
 */
export function checkPostures(s: GameState, subs: Record<number, Submission>, emit: Emit) {
  if (!posturesOn(s)) return;
  for (const f of s.fleets) {
    const P = f.posture;
    const x = fxNow(s, f);
    if (!P || P === 'steady' || f.owner < 0 || !x?.set || x.checked) continue;
    x.checked = true;   // once, on the step it was chosen (LIVE: a later tick finds the fleet mid-assault)
    const orders = (subs[f.owner]?.orders ?? []).filter(o => !!o);
    const seizes = orders.some(o => o!.type === 'seize' && (o!.fleet === f.id || (o!.also ?? []).includes(f.id)));
    const moves = orders.some(o => o!.type === 'move' && o!.fleet === f.id);
    let why: string | null = null;
    if (P === 'charge' && !seizes && !(f.route && f.route.seize !== null) && !(f.siege !== null && f.siege !== undefined && f.siege === f.region)) why = 'a Charge needs a Seize';
    if (P === 'ambush' && (seizes || moves || (f.route && f.route.path.length))) why = 'an Ambush must lie still';
    if (why) {
      f.posture = null;
      emit({ k: 'fail', pulse: 0, owner: f.owner, text: `Posture (${postureName(P)}) failed: ${why}. ${f.name} stays Steady.` });
    }
  }
}

// ------------------------------------------------------------------ world postures
export function wpostureBlock(s: GameState, p: PlayerId, rid: unknown, kind: unknown): string | null {
  if (!worldPosturesOn(s)) return 'world postures are off in these rules';
  const r = Number.isInteger(rid) ? s.regions[rid as number] : undefined;
  if (!r) return 'no such region';
  if (r.owner !== p) return 'not your system';
  if (r.kind === 'lane' || r.kind === 'void') return 'nobody lives there';
  if (typeof kind !== 'string' || !WORLD_POSTURE_IDS.includes(kind as WorldPosture)) return 'unknown world posture';
  if (r.wposture && r.wposture.turn === s.turn) return 'that system already took a posture this turn';
  return null;
}
export function setWorldPosture(s: GameState, p: PlayerId, r: Region, kind: WorldPosture) {
  r.wposture = { kind, turn: s.turn, by: p };
}
/** The world posture in force at r this turn, if any. */
export function wpostureOf(s: GameState, r: Region): WorldPosture | null {
  return worldPosturesOn(s) && r.wposture && r.wposture.turn === s.turn && r.owner === r.wposture.by ? r.wposture.kind : null;
}
/** Does r yield nothing this turn (Call the Levies, wrong)? */
export const regionIdle = (s: GameState, r: Region) => worldPosturesOn(s) && r.idleUntil !== undefined && r.idleUntil !== null && r.idleUntil >= s.turn;
/** Output multiplier for r this turn (Surge). */
export const regionSurge = (s: GameState, r: Region) => (fateOn(s) && r.surge === s.turn ? SG(s).surgeMult : 1);

// ------------------------------------------------------------------ Fate
export const fateLeft = (s: GameState, p: PlayerId) => (fateOn(s) ? s.players[p]?.fate ?? SG(s).fateStart : 0);

/** Why `p` can't spend this Fate now, or null. */
export function fateBlock(s: GameState, p: PlayerId, use: unknown, fleet?: unknown, region?: unknown): string | null {
  if (!fateOn(s)) return 'Fate is off in these rules';
  if (typeof use !== 'string' || !FATE_IDS.includes(use as FateUse)) return 'unknown Fate';
  if (fateLeft(s, p) <= 0) return 'no Fate left';
  const pl = s.players[p];
  if (pl.fateSpent && pl.fateSpent.turn === s.turn && pl.fateSpent.n >= SG(s).fatePerTurn) return `at most ${SG(s).fatePerTurn} Fate per turn`;
  if (use === 'surge') {
    const r = Number.isInteger(region) ? s.regions[region as number] : undefined;
    if (!r || r.owner !== p) return 'Surge needs a system of yours';
    if (r.kind === 'lane') return 'nobody lives there';
    if (r.surge === s.turn) return 'that system already surges this turn';
    return null;
  }
  const f = s.fleets.find(x => x.id === fleet && x.owner === p && x.ships.length);
  if (!f) return 'no such fleet of yours';
  if (fateOf(s, f)) return 'this fleet already has a Fate this turn';
  if (use === 'rally' && !f.limping) return 'only a Limping fleet can rally';
  if (use === 'hyperjump' && isDugIn(s, f)) return 'it is dug in and cannot move this turn';
  if (use === 'laststand' || use === 'twist') {
    const E = (s.engagements ?? []).find(e => e.region === f.region);
    if (E?.fate?.includes(p)) return 'one Fate per battle per side';
    if (s.fleets.some(x => x !== f && x.owner === p && x.region === f.region && (fateOf(s, x) === 'laststand' || fateOf(s, x) === 'twist'))) return 'one Fate per battle per side';
  }
  return null;
}

/** Spend a Fate (already validated): its effect, a public event, a Herald headline. */
export function spendFate(s: GameState, p: PlayerId, use: FateUse, target: { fleet?: number; region?: number }, pulse: number, emit: Emit) {
  const S = SG(s);
  const pl = s.players[p];
  pl.fate = fateLeft(s, p) - 1;
  pl.fateSpent = pl.fateSpent && pl.fateSpent.turn === s.turn ? { turn: s.turn, n: pl.fateSpent.n + 1 } : { turn: s.turn, n: 1 };
  let text: string;
  let rid: RegionId | undefined;
  let fid: number | undefined;
  if (use === 'surge') {
    const r = s.regions[target.region!];
    r.surge = s.turn;
    rid = r.id;
    let extra = '';
    if (r.project && r.project.owner === p) { r.project.progress += S.surgeProgress; extra = ` and its ${s.rules.projects[r.project.key]?.name ?? r.project.key} leaps ahead`; }
    text = `${pl.name} spends Fate: ${r.name} surges (double output this turn${extra}).`;
  } else {
    const f = s.fleets.find(x => x.id === target.fleet)!;
    f.fate = { use, turn: s.turn };
    fid = f.id; rid = f.region;
    if (use === 'rally') {
      for (const sh of f.ships) sh.hp = Math.max(sh.hp, Math.min(sh.maxHp, Math.ceil(sh.maxHp * S.rallyHull)));
      f.limping = null;
      f.route = null;
      text = `${pl.name} spends Fate: ${f.name} RALLIES at ${s.regions[f.region].name} and turns to fight again.`;
    } else if (use === 'laststand') text = `${pl.name} spends Fate: ${f.name} makes its LAST STAND at ${s.regions[f.region].name}.`;
    else if (use === 'twist') text = `${pl.name} spends Fate: a Twist of Fate shields ${f.name} at ${s.regions[f.region].name}.`;
    else text = `${pl.name} spends Fate: ${f.name} HYPERJUMPS from ${s.regions[f.region].name}.`;
  }
  emit({ k: 'fate', pulse, owner: p, use, ...(fid !== undefined ? { fleet: fid } : {}), ...(rid !== undefined ? { region: rid } : {}), text, left: pl.fate });
  beat(s, { kind: 'fate', text: headline(s, 'fate', { a: pl.name, x: text.replace(/^.*?spends Fate: /, '').replace(/\.$/, '') }), region: rid, players: [p], drama: use === 'laststand' || use === 'rally' ? 6 : 4, public: true });
  s.chronicle.push({ turn: s.turn, players: [p], region: rid, text });
}

// ------------------------------------------------------------------ reveals
/** Record a decided posture: the replay event, a Herald beat for the big ones, the house's public posture history. */
export function revealPosture(s: GameState, f: Fleet, outcome: PostureOutcome, pulse: number, emit: Emit, o: { with?: PlayerId[]; public?: boolean; private?: boolean; text?: string; beat?: string; drama?: number; b?: string } = {}) {
  const P = f.posture;
  if (!P || f.owner < 0) return;
  const x = fx(s, f);
  x.outcome = outcome;
  const r = s.regions[f.region];
  const name = postureName(P);
  const text = o.text ?? `${f.name} (${name}) at ${r.name}: ${outcome === 'called' ? 'CALLED IT' : outcome === 'caught' ? 'CAUGHT OUT' : 'no read'}.`;
  const withP = [...new Set((o.with ?? []).filter(q => q >= 0 && q !== f.owner))];
  emit({ k: 'posture', pulse, fleet: f.id, owner: f.owner, posture: P, outcome, region: r.id, text, ...(withP.length ? { with: withP } : {}), ...(o.public ? { public: true } : {}), ...(o.private ? { private: true } : {}) });
  if (!o.private && outcome !== 'none') {
    const log = (s.players[f.owner].postureLog ??= {});
    log[P] = (log[P] ?? 0) + 1;
  }
  if (o.beat) beat(s, { kind: o.beat, text: headline(s, o.beat, { f: f.name, r: r.name, x: name, a: pname(s, f.owner), b: o.b ?? 'the enemy' }), region: r.id, players: [f.owner, ...withP], drama: o.drama ?? 3, public: !!o.public });
}
function revealWorld(s: GameState, r: Region, outcome: PostureOutcome, pulse: number, emit: Emit, o: { with?: PlayerId[]; public?: boolean; private?: boolean; text: string; beat?: string; drama?: number; b?: string }) {
  const w = r.wposture;
  if (!w) return;
  w.outcome = outcome;
  const withP = [...new Set((o.with ?? []).filter(q => q >= 0 && q !== w.by))];
  emit({ k: 'posture', pulse, owner: w.by, posture: w.kind, outcome, region: r.id, text: o.text, ...(withP.length ? { with: withP } : {}), ...(o.public ? { public: true } : {}), ...(o.private ? { private: true } : {}) });
  if (!o.private && outcome !== 'none') {
    const log = (s.players[w.by].postureLog ??= {});
    log[w.kind] = (log[w.kind] ?? 0) + 1;
  }
  if (o.beat) beat(s, { kind: o.beat, text: headline(s, o.beat, { r: r.name, a: pname(s, w.by), b: o.b ?? 'the enemy', x: postureName(w.kind), f: r.name }), region: r.id, players: [w.by, ...withP], drama: o.drama ?? 3, public: !!o.public });
}

// ------------------------------------------------------------------ movement
/** Mark that hostile fleets came into postured fleets' systems (called at the combat step, with this step's arrivals). */
export function noteArrivals(s: GameState, cameFrom: Map<number, RegionId>) {
  if (!posturesOn(s) || !cameFrom.size) return;
  for (const f of s.fleets) {
    const P = f.posture;
    if ((P !== 'guarded' && P !== 'ambush') || !f.ships.length) continue;
    if (s.fleets.some(x => x !== f && x.region === f.region && x.ships.length && cameFrom.has(x.id) && hostileP(s, x.owner, f.owner))) fx(s, f).contact = true;
  }
}
/** A hostile fleet lies in Ambush here (it stops movers, even a Hyperjump). */
export function ambushAt(s: GameState, rid: RegionId, mover: Owner): Fleet | undefined {
  if (!posturesOn(s)) return undefined;
  return s.fleets.find(x => x.region === rid && x.ships.length && x.posture === 'ambush' && hostileP(s, x.owner, mover));
}

// ------------------------------------------------------------------ combat
/**
 * At the start of each round of a fight: decide postures whose bet just met reality (once each), raise the
 * Levies, mark battle Fates on the engagement. `entered` = fleets that arrived this step.
 */
export function sigRound(s: GameState, rng: Rng, region: Region, E: Engagement | undefined, active: Fleet[], entered: (f: Fleet) => boolean, pulse: number, emit: Emit, hl: (t: string) => void) {
  if (!sigOn(s)) return;
  const S = SG(s);
  const foesOf = (f: Fleet) => active.filter(x => x !== f && hostileP(s, x.owner, f.owner));
  // battle Fates: one per side per engagement
  if (E) for (const f of active) {
    const u = fateOf(s, f);
    if ((u === 'laststand' || u === 'twist') && f.owner >= 0 && !(E.fate ??= []).includes(f.owner)) E.fate.push(f.owner);
  }
  // world postures of the system's owner
  const w = region.owner !== null ? wpostureOf(s, region) : null;
  if (w && region.wposture && !region.wposture.outcome) {
    const owner = region.owner!;
    const attackers = active.filter(x => hostileP(s, x.owner, owner));
    if (w === 'levies' && attackers.length && region.garrison > 0 && !region.wposture.boosted) {
      region.wposture.boosted = true;
      const before = region.garrison;
      region.garrison = Math.round(region.garrison * S.leviesMult);
      if (E && E.rounds === 0) E.garrisonStart = Math.max(E.garrisonStart, region.garrison);
      hl(`${region.name} CALLS THE LEVIES: the garrison swells from ${before} to ${region.garrison}.`);
      revealWorld(s, region, 'called', pulse, emit, { with: attackers.map(x => x.owner).filter((x): x is number => x >= 0), text: `${region.name} called the levies in time: garrison ${before} → ${region.garrison}.`, beat: 'p_levies', drama: 3 });
    }
    if (w === 'gates' && attackers.some(entered)) {
      hl(`${region.name} opened its gates — to the wrong guests. The garrison holds its fire.`);
      revealWorld(s, region, 'caught', pulse, emit, { with: attackers.map(x => x.owner).filter((x): x is number => x >= 0), text: `${region.name} had opened its gates: the garrison held its first volley.` });
    }
  }
  for (const f of active) {
    const P = postureOf(s, f);
    if (P === 'steady' || f.owner < 0) continue;
    const x = fx(s, f);
    if (x.outcome) continue;
    const foes = foesOf(f);
    const garFoe = region.garrison > 0 && (region.owner === null ? f.siege === region.id : hostileP(s, region.owner, f.owner));
    if (!foes.length && !garFoe) continue;
    const withP = [...foes.map(y => y.owner), ...(region.owner !== null && hostileP(s, region.owner, f.owner) ? [region.owner] : [])].filter((q): q is number => q >= 0);
    if (P === 'running') {
      revealPosture(s, f, 'caught', pulse, emit, { with: withP, text: `${f.name} was caught Running at ${region.name}: strung out, it can't fire its first round and takes heavier damage.`, beat: 'p_caught', drama: 3 });
      hl(`${f.name} is caught strung out on the run.`);
    } else if (P === 'guarded') {
      x.contact = true;
      if (!x.moved && foes.some(entered)) {
        revealPosture(s, f, 'called', pulse, emit, { with: withP, text: `${f.name} was Guarded at ${region.name} and the attack came: fortified, it fires first.`, beat: 'p_called', drama: 4, b: 'the attack' });
        hl(`${f.name} was waiting, guns run out: it fires first.`);
      } else revealPosture(s, f, 'none', pulse, emit, { private: true });
    } else if (P === 'ambush') {
      x.contact = true;
      if (foes.some(entered)) {
        revealPosture(s, f, 'called', pulse, emit, { with: withP, text: `${f.name} sprang an AMBUSH at ${region.name}.`, beat: 'p_ambush', drama: 5 });
        hl(`AMBUSH: ${f.name} strikes from hiding.`);
      } else revealPosture(s, f, 'none', pulse, emit, { private: true });
    } else if (P === 'charge') {
      if (f.siege !== region.id) continue;   // only the assault itself decides a charge
      const braced = foes.some(y => postureOf(s, y) === 'guarded' && !fxNow(s, y)?.moved)
        || (w === 'levies' && region.owner !== null && hostileP(s, region.owner, f.owner) && region.garrison > 0)
        || ((region.owner === null && region.garrison > 0) || foes.some(y => y.owner === -1)) && rng.chance(S.neutralBraceChance);
      if (braced) {
        x.broken = true;
        revealPosture(s, f, 'caught', pulse, emit, { with: withP, text: `${f.name}'s CHARGE broke on braced defences at ${region.name}: the defenders fire first and it loses its first round.`, beat: 'p_broken', drama: 5 });
        hl(`BROKEN CHARGE: ${f.name} runs onto braced guns.`);
      } else {
        revealPosture(s, f, 'called', pulse, emit, { with: withP, text: `${f.name} CHARGED ${region.name} and caught the defenders unbraced: first strike.`, beat: 'p_called', drama: 3, b: 'the defence' });
        hl(`${f.name} charges home before the defenders are ready.`);
      }
    }
  }
}
const roundsOf = (s: GameState, f: Fleet) => fxNow(s, f)?.rounds ?? 0;
const brokenChargeNow = (s: GameState, f: Fleet) => postureOf(s, f) === 'charge' && !!fxNow(s, f)?.broken && roundsOf(s, f) === 0;
/** Can this unit (fleet ship, or the garrison when f is null) fire this round? */
export function sigCanFire(s: GameState, f: Fleet | null, region: Region): boolean {
  if (!sigOn(s)) return true;
  if (!f) {
    const w = region.wposture;
    return !(w && w.turn === s.turn && w.kind === 'gates' && w.outcome === 'caught' && !(w.rounds ?? 0));
  }
  if (roundsOf(s, f) > 0) return true;
  const P = postureOf(s, f), x = fxNow(s, f);
  if (P === 'running' && x?.outcome === 'caught') return false;
  if (P === 'charge' && x?.broken) return false;
  return true;
}
/** Does this unit fire before everyone else this round (first strike)? owner = the unit's side. */
export function sigFirst(s: GameState, f: Fleet | null, owner: Owner, active: Fleet[]): boolean {
  if (!sigOn(s)) return false;
  // the defenders of a broken charge get a free first volley
  if (active.some(c => hostileP(s, c.owner, owner) && brokenChargeNow(s, c))) return true;
  if (!f || roundsOf(s, f) > 0) return false;
  const P = postureOf(s, f), x = fxNow(s, f);
  if (x?.outcome !== 'called') return false;
  return P === 'guarded' || P === 'ambush' || (P === 'charge' && !x.broken);
}
/** Is this fleet holding Guarded (called) this turn: it counts as fortified with extra defence. */
export const guardedHolds = (s: GameState, f: Fleet | null) => !!f && postureOf(s, f) === 'guarded' && fxNow(s, f)?.outcome === 'called';
/** Hit-chance change for a shot from fleet `f` (null = garrison) at fleet `tf` (null = garrison). */
export function sigHit(s: GameState, f: Fleet | null, tf: Fleet | null, fortifyHit: number, fortifyEva: number): number {
  if (!sigOn(s)) return 0;
  const S = SG(s);
  let h = 0;
  if (f) {
    if (guardedHolds(s, f)) h += (f.fortified ? 0 : fortifyHit) + S.guardedHit;
    if (fateStand(s, f)) h += S.lastStandHit;
  }
  if (tf && guardedHolds(s, tf)) h -= (tf.fortified ? 0 : fortifyEva) + S.guardedEvasion;
  return h;
}
/** Extra damage per hit from fleet f (Charge in its opening rounds). */
export function sigDmg(s: GameState, f: Fleet | null): number {
  if (!f || !sigOn(s) || postureOf(s, f) !== 'charge') return 0;
  const x = fxNow(s, f);
  return x?.outcome === 'called' && (x.rounds ?? 0) < SG(s).chargeRounds ? SG(s).chargeDamage : 0;
}
/** Damage taken multiplier for ships of fleet tf (Running, caught). */
export function sigTaken(s: GameState, tf: Fleet | null): number {
  return tf && sigOn(s) && postureOf(s, tf) === 'running' && fxNow(s, tf)?.outcome === 'caught' ? SG(s).runningDamageTaken : 1;
}
/** Attack multiplier for fleet f (an exposed ambush is fatigued). */
export const sigAtk = (s: GameState, f: Fleet | null) => (f && isExposed(s, f) ? SG(s).ambushFatigueMult : 1);
/** After a round: count it for every fleet (and the garrison) that was in it. */
export function sigAfterRound(s: GameState, fleets: Fleet[], region: Region, garrisonFought: boolean) {
  if (!sigOn(s)) return;
  for (const f of fleets) { const x = fx(s, f); x.rounds = (x.rounds ?? 0) + 1; x.fought = true; }
  const w = region.wposture;
  if (garrisonFought && w && w.turn === s.turn) w.rounds = (w.rounds ?? 0) + 1;
}

// ------------------------------------------------------------------ capture
/**
 * A world changes hands: Scorched Earth (if its owner bet on losing it) leaves the conqueror nothing.
 * Call BEFORE the capture's loot (resolve.ts capture). Returns true when it was scorched.
 */
export function scorchedOnCapture(s: GameState, r: Region, by: PlayerId, pulse: number, emit: Emit): boolean {
  if (wpostureOf(s, r) !== 'scorch' || r.wposture!.outcome) return false;
  const from = r.wposture!.by;
  revealWorld(s, r, 'called', pulse, emit, { with: [by], public: true, text: `SCORCHED EARTH: ${pname(s, from)} burned ${r.name} before it fell. ${pname(s, by)} takes nothing.`, beat: 'p_scorched', drama: 6, b: pname(s, by) });
  s.chronicle.push({ turn: s.turn, region: r.id, players: [from, by], major: true, text: `${pname(s, from)} puts ${r.name} to the torch as it falls. ${pname(s, by)} inherits ashes.` });
  return true;
}
/** After onCapture: the calling is razed by the old owner; nothing is left to raze or loot. */
export function scorchAftermath(r: Region) {
  r.project = null;
  if (r.story) {
    r.story.calling = null;
    r.story.pendingCalling = null;
    r.story.captured = null;
    if (r.story.lost) r.story.lost.calling = null;
  }
  r.wposture = null;
}

// ------------------------------------------------------------------ end of turn
/** Gates: an ally's fleet repaired here (resolve.ts repair loop). */
export function gatesHost(s: GameState, r: Region, f: Fleet, pulse: number, emit: Emit) {
  if (wpostureOf(s, r) !== 'gates' || !r.wposture || r.wposture.outcome) return;
  revealWorld(s, r, 'called', pulse, emit, { with: [f.owner], text: `${r.name} opened its gates: ${f.name} (${pname(s, f.owner)}) repairs there as at home.` });
}
/** Is r an Open-Gates refuge for fleet f this turn (pact ally of the owner)? */
export function gatesOpenFor(s: GameState, r: Region, f: Fleet): boolean {
  return wpostureOf(s, r) === 'gates' && r.owner !== null && r.owner !== f.owner && f.owner >= 0 && !hostileP(s, r.owner, f.owner);
}

/**
 * End of a WEGO turn / LIVE cycle (after income, repairs and scoring): undecided bets resolve (dug in,
 * exposed, levies idle, scorched for nothing), postures and this turn's Fates clear, and a house far
 * behind gets its comeback Fate.
 */
export function sigEndTurn(s: GameState, pulse: number, emit: Emit) {
  if (!sigOn(s)) return;
  const S = SG(s);
  for (const f of s.fleets) {
    const P = f.posture;
    const x = fxNow(s, f);
    if (P && f.ships.length && f.owner >= 0 && !x?.outcome && posturesOn(s)) {
      const r = s.regions[f.region];
      if (P === 'guarded') {
        if (!x?.contact) {
          f.dugIn = s.turn + S.dugInTurns;
          revealPosture(s, f, 'caught', pulse, emit, { private: true, text: `${f.name} stood Guarded at ${r.name} and nobody came: dug in, it cannot move next turn.` });
        } else revealPosture(s, f, 'none', pulse, emit, { private: true });
      } else if (P === 'ambush') {
        if (!x?.contact) {
          f.exposed = s.turn + 1;
          revealPosture(s, f, 'caught', pulse, emit, { public: true, text: `${f.name} lay in Ambush at ${r.name} and nobody came: exposed and weary.`, beat: 'p_exposed', drama: 2 });
        } else revealPosture(s, f, 'none', pulse, emit, { private: true });
      } else if (P === 'running') {
        revealPosture(s, f, x?.moved ? 'called' : 'none', pulse, emit, { private: true, text: x?.moved ? `${f.name} ran a clear road.` : undefined });
      } else revealPosture(s, f, 'none', pulse, emit, { private: true });
    }
    if (f.posture !== undefined) f.posture = null;
    if (f.postureFx !== undefined) f.postureFx = null;
    if (f.fate && f.fate.turn <= s.turn) f.fate = null;
    if (f.dugIn !== undefined && f.dugIn !== null && f.dugIn <= s.turn) f.dugIn = null;
    if (f.exposed !== undefined && f.exposed !== null && f.exposed <= s.turn) f.exposed = null;
  }
  for (const r of s.regions) {
    const w = r.wposture;
    if (w && w.turn === s.turn && !w.outcome && r.owner === w.by) {
      if (w.kind === 'levies') {
        r.idleUntil = s.turn + Math.max(1, S.leviesIdleTurns) - 1;
        revealWorld(s, r, 'caught', pulse, emit, { private: true, text: `${r.name} called the levies and no assault came: its output is lost this turn and next.` });
      } else if (w.kind === 'scorch') {
        const before = r.dev;
        r.dev = Math.max(1, r.dev - S.scorchDevLoss);
        revealWorld(s, r, 'caught', pulse, emit, { private: true, text: `${r.name} was readied for the torch and held: development ${before} → ${r.dev} for nothing.` });
      } else revealWorld(s, r, 'none', pulse, emit, { private: true, text: `${r.name} opened its gates; nobody came.` });
    }
    if (w !== undefined && w !== null) r.wposture = null;
    if (r.idleUntil !== undefined && r.idleUntil !== null && r.idleUntil <= s.turn) r.idleUntil = null;
    if (r.surge !== undefined && r.surge !== null && r.surge <= s.turn) r.surge = null;
  }
  // a house far behind the leader is touched by Fate, once
  if (fateOn(s)) {
    ensureSig(s);
    const live = s.players.filter(p => !p.eliminated);
    const top = Math.max(0, ...live.map(p => p.vp));
    for (const p of live) {
      if (p.fateBonus || top - p.vp < S.fateComebackGap) continue;
      p.fateBonus = true;
      p.fate = fateLeft(s, p.id) + S.fateComebackBonus;
      emit({ k: 'fate', pulse, owner: p.id, use: 'bonus', text: `${p.name}, ${top - p.vp} VP behind, is touched by Fate: +${S.fateComebackBonus} token.`, left: p.fate });
      beat(s, { kind: 'fate_bonus', text: headline(s, 'fate_bonus', { a: p.name }), players: [p.id], drama: 3, public: true });
    }
  }
}
