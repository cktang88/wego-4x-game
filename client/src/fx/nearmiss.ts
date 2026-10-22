// The near-miss line that closes the Reckoning (docs/LOOPS.md §1.3 "Near-misses are content"), in the Herald's voice.
// Computed only from what the viewer's own result and view show (fog is respected: a filtered result carries only
// what you could see), and only from facts: kill flags, ship counts, moves, bets, the VP table. When no near miss
// happened, it says where the race stands instead, which is always true.
import type { GameState, PlayerId, TurnResult } from '../../../shared/sim/types.ts';
import { POSTURES } from '../../../shared/config/content.ts';

export interface NearMiss { text: string; score: number; region?: number; kind: string }

const NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const num = (n: number) => NUM[n] ?? String(n);
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** Every near miss of the turn, best first (empty if none). */
export function nearMisses(st: GameState, result: TurnResult, you: PlayerId | null): NearMiss[] {
  const out: NearMiss[] = [];
  const pn = (o: PlayerId | -1 | null) => (o === null ? 'the defenders' : o < 0 ? 'the Warden' : st.players[o]?.name ?? '?');
  const rn = (id: number) => st.regions[id]?.name ?? '?';
  const mine = (o: PlayerId | -1 | null | undefined) => you !== null && o === you;

  // 1. an assault that failed with the defenders down to their last ship
  for (const b of result.battles) {
    if (b.ongoing || b.winner === null) continue;
    const owner = new Map<number, PlayerId | -1>();
    for (const s of b.sides) for (const sh of s.ships) owner.set(sh.id, s.owner);
    const killed = new Set<number>();
    for (const r of b.rounds) for (const s of r.shots) if (s.kill) killed.add(s.to);
    const wSide = b.sides.filter(s => s.owner === b.winner);
    const wShips = wSide.flatMap(s => s.ships);
    const left = wShips.filter(s => !killed.has(s.id)).length;
    const garrison = wSide.some(s => s.garrison && s.garrison.hp > 0);
    const losers = b.sides.filter(s => s.owner !== b.winner && s.owner >= 0 && s.ships.length);
    if (!losers.length || wShips.length < 2 || left !== 1 || garrison) continue;
    const a = losers[0].owner;
    out.push({ kind: 'last-ship', region: b.region, score: 6 + (mine(a) || mine(b.winner) ? 2 : 0),
      text: `${cap(pn(b.winner))} won at ${rn(b.region)} with a single ship left. ${cap(pn(a))} came within one hull.` });
  }

  // 2. an ambush that waited in vain while a rival passed one jump away
  for (const e of result.events) {
    if (e.k !== 'posture' || e.posture !== 'ambush' || e.outcome !== 'caught') continue;
    const r = st.regions[e.region];
    if (!r) continue;
    const by = result.events.find(m => m.k === 'move' && m.owner >= 0 && m.owner !== e.owner && r.neighbors.includes(m.to));
    if (!by || by.k !== 'move') continue;
    out.push({ kind: 'ambush', region: e.region, score: 5 + (mine(e.owner) || mine(by.owner) ? 2 : 0),
      text: `${pn(e.owner)}'s ambush waited at ${rn(e.region)}. ${pn(by.owner)} passed at ${rn(by.to)}, one jump away.` });
  }

  // 3. a bet that would have paid: a Guarded fleet whose attackers stopped one jump short
  for (const e of result.events) {
    if (e.k !== 'posture' || e.posture !== 'guarded' || e.outcome !== 'caught' || !mine(e.owner)) continue;
    const r = st.regions[e.region];
    const near = result.events.find(m => m.k === 'blocked' && m.owner !== e.owner && r?.neighbors.includes(m.at));
    if (!near || near.k !== 'blocked') continue;
    out.push({ kind: 'guarded', region: e.region, score: 5,
      text: `Your ${POSTURES.guarded.name.toLowerCase()} line at ${rn(e.region)} waited for ${pn(near.owner)}, who was stopped at ${rn(near.at)}.` });
  }

  // 4. the race: a house within reach of the VP goal, or the top two neck and neck
  const target = st.rules.victory.vpTarget;
  const live = st.players.filter(p => !p.eliminated).sort((a, b) => b.vp - a.vp);
  if (live.length) {
    const top = live[0], gap = target - top.vp;
    if (gap > 0 && gap <= 3) out.push({ kind: 'race', score: 4 + (3 - gap), text: `${top.name} stands ${num(gap)} VP from the crown.` });
    if (live.length > 1 && live[1].vp > 0 && top.vp - live[1].vp <= 1) {
      out.push({ kind: 'neck', score: 3, text: top.vp === live[1].vp ? `${top.name} and ${live[1].name} are level at ${top.vp} VP.` : `One VP between ${top.name} and ${live[1].name}.` });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/** The line for the ribbon: the best near miss, or the standings (always true). */
export function nearMissLine(st: GameState, result: TurnResult, you: PlayerId | null): string {
  const best = nearMisses(st, result, you)[0];
  if (best) return best.text;
  const live = st.players.filter(p => !p.eliminated).sort((a, b) => b.vp - a.vp);
  const top = live[0];
  if (!top) return '';
  const target = st.rules.victory.vpTarget;
  if (live.length > 1 && top.vp === live[1].vp) return `No house leads: ${top.vp} of ${target} VP apiece at the top.`;
  return `${top.name} leads with ${top.vp} of ${target} VP.`;
}
