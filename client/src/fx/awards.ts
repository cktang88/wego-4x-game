// End-of-game awards (docs/LOOPS.md §2.3, DELIGHT #77): superlatives dealt as cards, at least one per player, every
// one computed from the game's real record: the turn results (battles, bets, captures, launches, Fate) and the
// final state (pacts broken, research, the Herald's headlines). The party-game trick: everyone leaves with a story
// about themselves. Truth: a "most" award needs a strict, nonzero lead; an "all game" award ("never lost a battle",
// "held its capital") needs the complete history; when the record is incomplete those awards are simply not dealt.
import type { GameState, PlayerId, TurnResult } from '../../../shared/sim/types.ts';
import { shipsSunkBy } from './battlefacts.ts';

export interface Award { id: string; title: string; icon: string; player: PlayerId; text: string }
export interface PlayerStats {
  sunk: number; sunkOf: Map<PlayerId, number>; battles: number; battlesLost: number;
  called: number; captures: number; capturesFrom: Map<PlayerId, number>; fate: number; built: number; homeLost: number;
  headlines: number; techs: number; oaths: { victim: PlayerId }[];
}

/** Is the history complete (every resolved turn from the first one present)? */
export function historyComplete(st: GameState, results: TurnResult[]): boolean {
  const last = st.winner !== null ? st.turn : st.turn - 1;
  const turns = new Set(results.map(r => r.turn));
  for (let t = 1; t <= Math.max(0, last - 1); t++) if (!turns.has(t)) return false;
  return turns.size > 0 || last <= 1;
}

export function gameStats(st: GameState, results: TurnResult[]): Map<PlayerId, PlayerStats> {
  const m = new Map<PlayerId, PlayerStats>(st.players.map(p => [p.id, {
    sunk: 0, sunkOf: new Map(), battles: 0, battlesLost: 0, called: 0, captures: 0, capturesFrom: new Map(), fate: 0, built: 0, homeLost: 0,
    headlines: 0, techs: (p.techs ?? []).length, oaths: (p.oathbreaker ?? []).map(o => ({ victim: o.victim })),
  }]));
  const homes = new Set(st.regions.filter(r => r.kind === 'home').map(r => r.id));
  const seenB = new Set<number>();
  const fought = new Map<PlayerId, Set<number>>();
  const lostEng = new Map<PlayerId, Set<number>>();
  for (const res of results) {
    for (const b of res.battles) {
      if (seenB.has(b.id)) continue;
      seenB.add(b.id);
      const eng = b.engagement ?? -b.id;
      // ships each house sank, and whose
      const owner = new Map<number, PlayerId | -1>();
      for (const s of b.sides) for (const sh of s.ships) owner.set(sh.id, s.owner);
      for (const r of b.rounds) for (const sh of r.shots) {
        if (!sh.kill) continue;
        const v = owner.get(sh.to);
        const k = owner.get(sh.from);
        if (k === undefined || v === undefined || k === v || k < 0) continue;
        const ps = m.get(k)!;
        if (v >= 0) ps.sunkOf.set(v, (ps.sunkOf.get(v) ?? 0) + 1);
      }
      for (const [k, n] of shipsSunkBy(b)) if (k >= 0 && m.has(k)) m.get(k)!.sunk += n;
      for (const s of b.sides) {
        if (s.owner < 0 || !m.has(s.owner)) continue;
        (fought.get(s.owner) ?? fought.set(s.owner, new Set()).get(s.owner)!).add(eng);
        if (!b.ongoing && b.winner !== null && b.winner !== s.owner) (lostEng.get(s.owner) ?? lostEng.set(s.owner, new Set()).get(s.owner)!).add(eng);
      }
    }
    for (const e of res.events) {
      if (e.k === 'posture' && e.outcome === 'called' && m.has(e.owner)) m.get(e.owner)!.called++;
      else if (e.k === 'capture' && e.how === 'force' && m.has(e.by)) {
        const ps = m.get(e.by)!; ps.captures++;
        if (e.from !== null && e.from >= 0) ps.capturesFrom.set(e.from, (ps.capturesFrom.get(e.from) ?? 0) + 1);
      }
      if (e.k === 'capture' && e.from !== null && e.from >= 0 && homes.has(e.region) && m.has(e.from)) m.get(e.from)!.homeLost++;
      else if (e.k === 'fate' && e.use !== 'bonus' && m.has(e.owner)) m.get(e.owner)!.fate++;
      else if (e.k === 'build' && m.has(e.owner)) m.get(e.owner)!.built++;
    }
  }
  for (const [p, s] of fought) m.get(p)!.battles = s.size;
  for (const [p, s] of lostEng) m.get(p)!.battlesLost = s.size;
  for (const ed of st.soul?.herald ?? []) for (const h of ed.headlines) for (const p of new Set(h.players)) if (m.has(p)) m.get(p)!.headlines++;
  return m;
}

/** The single house with a strictly greater value than everyone else, if it reaches `min`. */
function top(st: GameState, val: (p: PlayerId) => number, min: number): { p: PlayerId; v: number } | null {
  const vals = st.players.map(p => ({ p: p.id, v: val(p.id) })).sort((a, b) => b.v - a.v);
  if (!vals.length || vals[0].v < min || (vals[1] && vals[1].v === vals[0].v)) return null;
  return vals[0];
}
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** Every award earned, in order of prestige (a house may appear more than once; flag awards may be shared). */
export function earnedAwards(st: GameState, results: TurnResult[]): Award[] {
  const S = gameStats(st, results);
  const full = historyComplete(st, results) && results.length > 0;
  const name = (p: PlayerId) => st.players[p]?.name ?? '?';
  const out: Award[] = [];
  const add = (id: string, title: string, icon: string, player: PlayerId, text: string) => out.push({ id, title, icon, player, text });
  const s = (p: PlayerId) => S.get(p)!;
  if (full) for (const p of st.players) {
    const x = s(p.id);
    if (x.battles >= 2 && x.battlesLost === 0) add('unbroken', 'The Unbroken', 'garrison', p.id, `${plural(x.battles, 'battle')}, never beaten`);
  }
  if (full) { const t = top(st, p => s(p).sunk, 2); if (t) add('butcher', 'The Butcher', 'battle', t.p, `Sank ${plural(t.v, 'enemy ship')}`); }
  { const t = top(st, p => s(p).called, 1); if (full && t) add('called', 'Called It', 'eye', t.p, `${plural(t.v, 'read')} paid off`); }
  for (const p of st.players) { const o = s(p.id).oaths; if (o.length) add('oathbreaker', 'Oathbreaker', 'broken', p.id, `Broke its word to ${name(o[0].victim)}${o.length > 1 ? ` and ${o.length - 1} more` : ''}`); }
  if (full) { const t = top(st, p => s(p).captures, 2); if (t) add('conqueror', 'The Conqueror', 'seize', t.p, `Took ${plural(t.v, 'world')} by force`); }
  if (full && st.winner !== null) {
    const ranked = st.players.slice().sort((a, b) => (b.id === st.winner ? 1 : 0) - (a.id === st.winner ? 1 : 0) || b.vp - a.vp);
    const second = ranked[1];
    if (second) {
      const hurt = (p: PlayerId) => p === st.winner || p === second.id ? -1 : (s(p).capturesFrom.get(second.id) ?? 0) + (s(p).sunkOf.get(second.id) ?? 0);
      const t = top(st, hurt, 2);
      if (t) { const a = s(t.p).capturesFrom.get(second.id) ?? 0, b = s(t.p).sunkOf.get(second.id) ?? 0;
        add('kingmaker', 'Kingmaker', 'crown', t.p, [a ? `took ${plural(a, 'world')}` : '', b ? `sank ${plural(b, 'ship')}` : ''].filter(Boolean).join(' and ').replace(/^./, c => c.toUpperCase()) + ` of ${second.name}`); }
    }
  }
  if (full) for (const p of st.players) if (!p.eliminated && s(p.id).homeLost === 0) add('survivor', 'Survivor', 'home', p.id, 'Never lost a home world');
  { const t = top(st, p => s(p).fate, 2); if (full && t) add('fate', "Fate's Hand", 'fate', t.p, `Spent ${plural(t.v, 'Fate token')}`); }
  { const t = top(st, p => s(p).headlines, 3); if (t) add('darling', "The Herald's Darling", 'herald', t.p, `Named in ${plural(t.v, 'headline')}`); }
  { const t = top(st, p => s(p).techs, 3); if (t) add('scholar', 'The Scholar', 'research', t.p, `${plural(t.v, 'technology', 'technologies')} mastered`); }
  { const t = top(st, p => s(p).built, 4); if (full && t) add('shipwright', 'The Shipwright', 'ships', t.p, `Launched ${plural(t.v, 'ship')}`); }
  return out;
}

/** A true card for a house that earned no superlative (no "most" claimed). */
function consolation(st: GameState, p: PlayerId): Award {
  const pl = st.players[p];
  if (pl.eliminated) {
    const t = st.chronicle.find(c => c.text === `${pl.name} is no more.`)?.turn;
    return { id: 'laststand', title: 'The Last Stand', icon: 'battle', player: p, text: t ? `Fought on until turn ${t}` : 'Fought to the end' };
  }
  const worlds = st.regions.filter(r => r.owner === p).length;
  return { id: 'standing', title: 'Still Standing', icon: 'home', player: p, text: `${plural(worlds, 'world')} and ${pl.vp} VP at the end` };
}

/** The awards to deal: 3–6 cards, at least one per house, at most two per house; the trailing houses pick first. */
export function dealAwards(st: GameState, results: TurnResult[]): Award[] {
  const earned = earnedAwards(st, results);
  const order = st.players.slice().sort((a, b) => (a.id === st.winner ? 1 : 0) - (b.id === st.winner ? 1 : 0) || a.vp - b.vp).map(p => p.id);
  const dealt: Award[] = [];
  const count = (p: PlayerId) => dealt.filter(a => a.player === p).length;
  const taken = (a: Award) => dealt.some(d => d.id === a.id && d.player === a.player);
  for (const p of order) { const a = earned.find(x => x.player === p && !taken(x)); if (a) dealt.push(a); }
  for (const a of earned) if (dealt.length < 6 && !taken(a) && count(a.player) < 2) dealt.push(a);
  for (const p of order) if (!count(p)) dealt.push(consolation(st, p));
  // dealt in seat order, each house's cards in prestige order
  return st.players.flatMap(p => dealt.filter(a => a.player === p.id));
}
