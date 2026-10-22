// Where this turn's victory points came from, for the coins of the VP count-up (docs/LOOPS.md §1.2 "Reckon").
// The amounts are the sim's own vpLog entries, never re-derived: the coins of a house add up to exactly its change.
// Each entry is placed on the map where it was earned (the Crowns held, the Throne, the battle, the captured
// capital, the dig); what has no place (a law, an edict, a broken pact) is placed at the house's capital.
// Only what the viewer may know is used: a rival's "Battle honors" whose battle you did not see comes from its capital.
import type { GameState, PlayerId, TurnResult } from '../../../shared/sim/types.ts';

export interface VpSource { amount: number; why: string; region: number | null }
export interface VpChange { player: PlayerId; before: number; after: number; sources: VpSource[] }
export type VpEntry = { turn: number; amount: number; why: string };

/** The VP log entries a result added (WEGO: the resolved turn's). */
export function turnEntries(st: GameState, turn: number): Map<PlayerId, VpEntry[]> {
  return new Map(st.players.map(p => [p.id, (p.vpLog ?? []).filter(v => v.turn === turn)]));
}

/** Changes per house from the given new log entries (sources placed on the map). Houses with no entries are left out. */
export function vpChanges(st: GameState, entries: Map<PlayerId, VpEntry[]>, result: TurnResult | null): VpChange[] {
  const out: VpChange[] = [];
  for (const p of st.players) {
    const list = entries.get(p.id) ?? [];
    if (!list.length) continue;
    const delta = list.reduce((a, v) => a + v.amount, 0);
    const sources: VpSource[] = [];
    for (const v of list) for (const s of placeEntry(st, p.id, v, result)) sources.push(s);
    out.push({ player: p.id, before: p.vp - delta, after: p.vp, sources });
  }
  return out;
}

const byName = (st: GameState, name: string) => st.regions.find(r => r.name === name)?.id ?? null;

/** One log entry → one or more placed sources whose amounts sum to the entry's. */
export function placeEntry(st: GameState, p: PlayerId, v: VpEntry, result: TurnResult | null): VpSource[] {
  const cap = st.players[p]?.capital ?? null;
  const one = (region: number | null): VpSource[] => [{ amount: v.amount, why: v.why, region: region ?? cap }];
  const why = v.why;
  const evs = result?.events ?? [];
  if (/^Holding \d+ Crowns?/.test(why)) {
    // the Crowns that paid: held now and (when known) already held when the turn began
    const held = st.regions.filter(r => r.kind === 'crown' && r.owner === p).map(r => r.id);
    const paid = result?.startOwners?.length ? held.filter(id => result.startOwners[id] === p) : held;
    const crowns = paid.length ? paid : held;
    if (!crowns.length) return one(cap);
    // the amount spread over the Crowns that paid it (integer shares, the remainder on the first)
    const n = crowns.length, base = Math.trunc(v.amount / n), rem = v.amount - base * n;
    return crowns.map((id, i) => ({ amount: base + (i < Math.abs(rem) ? Math.sign(rem) : 0), why, region: id })).filter(s => s.amount !== 0);
  }
  if (/^Holding the Throne/.test(why)) return one(st.regions.find(r => r.kind === 'throne')?.id ?? cap);
  if (/^Battle honors/.test(why)) {
    const name = /^Battle honors: (.+?)(?: \(against the leader\))?$/.exec(why)?.[1];
    const b = result?.battles.find(x => name && x.name === name) ?? result?.battles.filter(x => x.winner === p && !x.ongoing).sort((a, c) => c.rounds.length - a.rounds.length)[0];
    return one(b ? b.region : cap);
  }
  if (/^Captured .*capital/.test(why)) {
    const e = evs.find(x => x.k === 'capture' && x.by === p && x.from !== null && st.regions[x.region]?.kind === 'home');
    return one(e && e.k === 'capture' ? e.region : cap);
  }
  { const m = /^Bounty: took (.+) from the leader$/.exec(why); if (m) return one(byName(st, m[1])); }
  { const m = /^Broke the tribute of (.+)$/.exec(why); if (m) return one(byName(st, m[1])); }
  if (/^Excavated/.test(why)) {
    const e = evs.find(x => x.k === 'excavate' && x.owner === p);
    return one(e && e.k === 'excavate' ? e.region : cap);
  }
  if (/^Destroyed the Warden/.test(why)) {
    const b = result?.battles.find(x => x.sides.some(s => s.owner === -1) && x.winner === p);
    return one(b ? b.region : st.regions.find(r => r.kind === 'throne')?.id ?? cap);
  }
  return one(cap);
}

/** Split a source's amount into at most `max` coins (each a whole number of VP, all the same sign). */
export function coinsFor(amount: number, max = 6): number[] {
  const n = Math.min(Math.abs(amount), max);
  if (!n) return [];
  const sign = Math.sign(amount), base = Math.floor(Math.abs(amount) / n), rem = Math.abs(amount) - base * n;
  return Array.from({ length: n }, (_, i) => sign * (base + (i < rem ? 1 : 0)));
}
