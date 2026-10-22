// The replay director (docs/LOOPS.md §1.3): turns one TurnResult into the paced beats of the WEGO reveal, in five acts.
//
//   I   Unsealing   the three wax seals crack, in the order the players sealed          (a 'seals' beat)
//   II  The flop    every visible order arrow draws at once, before anything moves     (a 'flop' beat)
//   III Movement    fleets move step by step; Fate and bets; blocks and border clashes
//   IV  Battles     one group per battle, in ascending stakes; the biggest is introduced last ("…and at Vel.")
//   V   Aftermath   captures, launches, research, deeds: the quiet things batched and fast
//
// Truth: nothing is invented and nothing is hidden; only presentation order changes, and only between events the sim
// treats as independent. Movement stays in step order; everything a battle causes (retreats, routs, wrecks, the
// capture of the world it was fought over, a bet it settled) plays inside that battle's group, after it; anything
// that happened after the first battle and is not caused by one (the Warden's end-of-turn march) moves to the
// aftermath, never before the battles. With the default one-step turns the sim already orders movement → combat →
// aftermath, so the acts are the sim's own order with the battles sorted by stakes.
//
// Tempo: every beat has a drama weight 0–3. Weight 0 (launches, research, notes) is batched and plays at 3× speed;
// weight 3 (a Crown or the Throne changing hands, a capital falling, the main-event battle, a ★ technology) at 0.75×.
// "You first": within the aftermath and among simultaneous bets, your own events lead. Battles keep strict ascending
// stakes (your involvement raises a battle's stakes: your fight is your main event). Spectators get the neutral order.
import type { GameEvent, GameState, PlayerId, TurnResult } from '../../../shared/sim/types.ts';
import { TECH } from '../../../shared/config/empire.ts';
import { battleStakes, decisiveVolley, type Decisive } from './battlefacts.ts';

export type Act = 1 | 2 | 3 | 4 | 5;
export type BeatKind = 'seals' | 'flop' | 'hold' | 'title';
export interface Beat {
  dur: number;
  events: GameEvent[];
  act?: Act;
  /** drama weight 0..3 (see the header) */
  weight?: number;
  /** a staged beat with no sim events of its own */
  kind?: BeatKind;
  /** battle id this beat belongs to (hold, the battle itself, its consequences) */
  battle?: number;
  /** the battle group with the highest stakes (when there are two or more) */
  main?: boolean;
  /** the volley that really decided this battle (on the battle's own beat), if any */
  decisive?: Decisive | null;
  /** a 'title' beat's text */
  label?: string;
}

export interface DirectorOpts {
  you: PlayerId | null;
  /** a LIVE tick: the lighter version (no seals, no flop, no hold, no title card) */
  live?: boolean;
  /** your plan previewed against idle rivals */
  preview?: boolean;
  /** play Act I (the seals): a fresh WEGO turn, not a re-watch */
  seals?: boolean;
}

/** Soul-layer story beats worth a stamp in the replay: [stamp text, ink, banner (big moments)]. */
export const SOUL_STAMP: Record<string, [string, string, string?]> = {
  broken: ['BROKEN', '#ff7a6a'], debt: ['BLOOD-DEBT', '#ff4f5e'], vengeance: ['VENGEANCE', '#ffb84d'], vow_kept: ['VOW KEPT', '#ffd86b'],
  vow_broken: ['OATHBREAKER', '#ff4f5e'], liberated: ['LIBERATED', '#9de8ff'], razed: ['RAZED', '#ff8a3c'], coronation: ['CROWNED', '#ffd86b', '♛ A NEW REIGN'],
  retired: ['RETIRED', '#e8d6a0'],
};

/** Base beat length in ms at weight 1 (the replay's historical timings). */
function baseDur(e: GameEvent): number {
  switch (e.k) {
    case 'move': return 750;
    case 'battle': case 'clash': return 1100;
    case 'retreat': return 600;
    case 'capture': case 'excavate': case 'destroyed': return 650;
    case 'build': case 'project': case 'betrayal': case 'pact': case 'refit': return 450;
    case 'tech': return TECH[e.tech]?.tier === 4 ? 1100 : 600;
    case 'law': return 600;
    case 'rout': return 800;
    case 'posture': return 950;
    case 'fate': return 900;
    case 'soul': return SOUL_STAMP[e.kind]?.[2] ? 1000 : 750;
    case 'fail': return 500;
    default: return 350;
  }
}

/** Does this event get a beat at all (the old replay skipped the same ones)? */
export function shown(e: GameEvent, you: PlayerId | null): boolean {
  switch (e.k) {
    case 'pulse': return false;
    case 'posture': return e.outcome !== 'none';
    case 'soul': return !!SOUL_STAMP[e.kind] && e.region !== undefined;
    case 'fail': return you !== null && e.owner === you;   // a rival's failed order prints nothing
    case 'move': case 'blocked': case 'clash': case 'battle': case 'retreat': case 'destroyed': case 'capture': case 'build': case 'project':
    case 'excavate': case 'betrayal': case 'pact': case 'refit': case 'tech': case 'law': case 'rout': case 'fate':
    case 'note': case 'influence': case 'fortify': case 'scan':
      return true;
    default: return false;
  }
}

/** Drama weight of one event (0 quiet .. 3 the moment of the turn). */
export function weightOf(e: GameEvent, st: GameState): number {
  const r = (id: number | undefined) => (id === undefined ? undefined : st.regions[id]);
  const capital = (id: number) => st.players.some(p => p.capital === id);
  switch (e.k) {
    case 'capture': { const k = r(e.region)?.kind; return k === 'crown' || k === 'throne' || (e.from !== null && capital(e.region)) ? 3 : k === 'home' || k === 'relic' ? 2 : 1; }
    case 'tech': return TECH[e.tech]?.tier === 4 ? 3 : 0;
    case 'soul': return SOUL_STAMP[e.kind]?.[2] ? 3 : 2;
    case 'posture': case 'fate': case 'rout': case 'betrayal': case 'destroyed': case 'excavate': return 2;
    case 'battle': case 'clash': case 'move': case 'blocked': case 'retreat': return 1;
    default: return 0;
  }
}

/** Duration multiplier for a weight: 0 → 3× speed, 1 → as is, 2 → a touch slower, 3 → 0.75× speed. */
const TEMPO = [1 / 3, 1, 1.1, 1 / 0.75];
const beatOf = (events: GameEvent[], act: Act, weight: number, extra: Partial<Beat> = {}): Beat => {
  const base = Math.max(...events.map(baseDur));
  return { dur: Math.max(weight === 0 ? 220 : 300, Math.round(base * TEMPO[weight])), events, act, weight, ...extra };
};

const involves = (e: GameEvent, p: PlayerId): boolean => {
  switch (e.k) {
    case 'capture': return e.by === p || e.from === p;
    case 'battle': return e.parties.includes(p);
    case 'pact': return e.a === p || e.b === p;
    case 'betrayal': return e.by === p || e.victim === p;
    case 'soul': return e.owner === p || !!e.players?.includes(p);
    case 'pulse': case 'clash': return false;
    default: return 'owner' in e && e.owner === p;
  }
};
const regionOf = (e: GameEvent): number | undefined => {
  switch (e.k) {
    case 'retreat': case 'rout': return e.from;
    case 'destroyed': case 'capture': case 'posture': case 'battle': return e.region;
    case 'soul': return e.region;
    default: return undefined;
  }
};

/** The beats of one replay. */
export function direct(result: TurnResult, st: GameState, o: DirectorOpts): Beat[] {
  const you = o.you;
  const live = !!o.live, preview = !!o.preview;
  const evs = result.events.filter(e => shown(e, you));
  const beats: Beat[] = [];
  // ---- Act I and II (a fresh WEGO turn only)
  if (o.seals && !live && !preview) beats.push({ dur: 950, events: [], act: 1, weight: 1, kind: 'seals' });
  if (!live && !preview && evs.some(e => e.k === 'move' && e.owner >= 0)) beats.push({ dur: 1500, events: [], act: 2, weight: 1, kind: 'flop' });

  // ---- sort every event into an act (see the header for the rules)
  const battleAt = new Map<number, number[]>();   // region -> battle ids, in sim order
  for (const e of evs) if (e.k === 'battle') { const l = battleAt.get(e.region) ?? []; l.push(e.battle); battleAt.set(e.region, l); }
  const firstBattle = evs.findIndex(e => e.k === 'battle');
  interface Group { id: number; region: number; pre: GameEvent[]; battle: GameEvent; post: GameEvent[]; order: number }
  const groups = new Map<number, Group>();
  const act3: GameEvent[] = [], act5: GameEvent[] = [];
  const seenBattle = new Set<number>();
  evs.forEach((e, i) => {
    if (e.k === 'battle') {
      seenBattle.add(e.battle);
      const g = groups.get(e.battle);
      if (g) g.battle = e; else groups.set(e.battle, { id: e.battle, region: e.region, pre: [], battle: e, post: [], order: i });
      return;
    }
    const rid = regionOf(e);
    const ids = rid !== undefined ? battleAt.get(rid) : undefined;
    if (ids && (e.k === 'retreat' || e.k === 'rout' || e.k === 'destroyed' || e.k === 'capture' || e.k === 'posture' || e.k === 'soul')) {
      // caused by (or settled in) the battle at that world: the latest one fought there so far, or the first one
      // still to come (a bet called as the attackers arrive is decided by the battle that follows)
      const done = ids.filter(id => seenBattle.has(id));
      const id = done.length ? done[done.length - 1] : ids[0];
      let g = groups.get(id);
      if (!g) { g = { id, region: rid!, pre: [], battle: null as unknown as GameEvent, post: [], order: i }; groups.set(id, g); }
      (seenBattle.has(id) ? g.post : g.pre).push(e);
      return;
    }
    const beforeBattles = firstBattle < 0 || i < firstBattle;
    if (e.k === 'move' || e.k === 'retreat' || e.k === 'rout' || e.k === 'destroyed') (beforeBattles ? act3 : act5).push(e);
    else if (e.k === 'blocked' || e.k === 'clash' || e.k === 'fate' || e.k === 'betrayal') (beforeBattles ? act3 : act5).push(e);
    else act5.push(e);
  });

  // ---- Act III: movement in step order (the sim's), bets first with yours leading
  const fates = act3.filter(e => e.k === 'fate');
  const rest3 = act3.filter(e => e.k !== 'fate');
  for (const e of youFirst(fates, you)) beats.push(beatOf([e], 3, weightOf(e, st)));
  for (const e of rest3) {
    const prev = beats[beats.length - 1];
    const f0 = prev?.act === 3 ? prev.events[0] : undefined;
    if (e.k === 'move' && f0 && f0.k === 'move' && f0.pulse === e.pulse && f0.step === e.step && !!f0.guard === !!e.guard) { prev.events.push(e); continue; }
    beats.push(beatOf([e], 3, weightOf(e, st)));
  }

  // ---- Act IV: battles in ascending stakes; the biggest last, introduced by name
  const gl = [...groups.values()].filter(g => g.battle);
  const rep = (id: number) => result.battles.find(b => b.id === id);
  const stake = new Map(gl.map(g => { const r = rep(g.id); return [g.id, r ? battleStakes(r, st, you) : 0]; }));
  gl.sort((a, b) => stake.get(a.id)! - stake.get(b.id)! || a.order - b.order);
  gl.forEach((g, gi) => {
    const main = gl.length >= 2 && gi === gl.length - 1;
    const r = rep(g.id);
    if (main && !live) beats.push({ dur: 1100, events: [], act: 4, weight: 3, kind: 'title', battle: g.id, main, label: st.regions[g.region]?.name ?? '' });
    if (!live) beats.push({ dur: 420, events: [], act: 4, weight: 1, kind: 'hold', battle: g.id, main });
    for (const e of g.pre) beats.push(beatOf([e], 4, weightOf(e, st), { battle: g.id }));
    beats.push(beatOf([g.battle], 4, main ? 3 : Math.max(1, weightOf(g.battle, st)), { battle: g.id, main, decisive: r ? decisiveVolley(r) : null }));
    // consequences: posture stamps and routs one by one; retreats together; wrecks together; then the capture
    const post = g.post;
    for (const e of post.filter(x => x.k === 'posture' || x.k === 'rout' || x.k === 'soul')) beats.push(beatOf([e], 4, weightOf(e, st), { battle: g.id }));
    const rets = post.filter(x => x.k === 'retreat'); if (rets.length) beats.push(beatOf(rets, 4, 1, { battle: g.id }));
    const wrecks = post.filter(x => x.k === 'destroyed'); if (wrecks.length) beats.push(beatOf(wrecks, 4, 2, { battle: g.id }));
    for (const e of post.filter(x => x.k === 'capture')) beats.push(beatOf([e], 4, weightOf(e, st), { battle: g.id }));
  });

  // ---- Act V: the aftermath. Captures and deeds first (yours leading), then the quiet things, batched
  const loud = youFirst(act5.filter(e => weightOf(e, st) >= 1), you);
  for (const e of loud) {
    const prev = beats[beats.length - 1];
    const f0 = prev?.act === 5 ? prev.events[0] : undefined;
    if (e.k === 'move' && f0 && f0.k === 'move' && f0.step === e.step) { prev.events.push(e); continue; }
    beats.push(beatOf([e], 5, weightOf(e, st)));
  }
  const quiet = youFirst(act5.filter(e => weightOf(e, st) === 0), you);
  // one beat per kind of quiet thing (all launches together, all research together...), at most 4 events a beat
  const kinds = [...new Set(quiet.map(e => e.k))];
  for (const k of kinds) {
    const list = quiet.filter(e => e.k === k);
    for (let i = 0; i < list.length; i += 4) beats.push(beatOf(list.slice(i, i + 4), 5, 0));
  }

  // ---- fit the whole reveal into ~45 s (WEGO): squeeze the quiet and ordinary beats, never the big ones
  if (!live) {
    const cap = 45000;
    const total = beats.reduce((a, b) => a + b.dur, 0);
    if (total > cap) {
      const soft = beats.filter(b => (b.weight ?? 1) <= 1 && !b.kind);
      const softT = soft.reduce((a, b) => a + b.dur, 0);
      const k = Math.max(0.4, 1 - (total - cap) / Math.max(1, softT));
      for (const b of soft) b.dur = Math.max(200, Math.round(b.dur * k));
    }
  }
  return beats;
}

/** Stable: your events first, then everyone else's, each in their original order. Spectators: unchanged. */
export function youFirst(list: GameEvent[], you: PlayerId | null): GameEvent[] {
  if (you === null) return list.slice();
  return [...list.filter(e => involves(e, you)), ...list.filter(e => !involves(e, you))];
}

/** Arrows for the flop: every visible move of the turn, one segment per jump, by owner (no inference beyond events). */
export function flopArrows(result: TurnResult): { owner: PlayerId; from: number; to: number; fleet: number }[] {
  const out: { owner: PlayerId; from: number; to: number; fleet: number }[] = [];
  const seen = new Set<string>();
  for (const e of result.events) {
    if (e.k !== 'move' || e.owner < 0) continue;
    const key = `${e.fleet}:${e.from}>${e.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ owner: e.owner, from: e.from, to: e.to, fleet: e.fleet });
  }
  return out;
}
