// Truthful facts about one battle report, for the replay director (stakes, the decisive volley) and for the battle
// viewer (render/battle.ts can call `decisiveVolley` to know which volley deserves its slow motion).
//
// The rule (docs/LOOPS.md §1.3, "Truth rules"): slow motion and the camera push-in are only for a volley that really
// decided the battle: the battle ended this turn with a winner, and in its last round the losing side lost its last
// ship, or broke and left after taking fire in that very round. Anything else (a draw, an engagement that goes on, a
// side that slipped away untouched) gets no decisive volley at all.
import type { BattleReport, GameState, PlayerId } from '../../../shared/sim/types.ts';

export interface Decisive {
  /** index into rep.rounds */
  round: number;
  /** index into rep.rounds[round].shots: the killing blow, or the last hit on the losing side in that round */
  shot: number;
  /** last-ship: the losing side's last ship (or the garrison) died in that volley; broke: it took fire, then left */
  kind: 'last-ship' | 'broke';
  /** the owner(s) who lost */
  losers: (PlayerId | -1)[];
  winner: PlayerId | -1;
}

/** The volley that decided the battle, or null if none truly did (see the header). */
export function decisiveVolley(rep: BattleReport): Decisive | null {
  if (rep.ongoing || rep.winner === null || !rep.rounds.length) return null;
  const winner = rep.winner;
  const owner = new Map<number, PlayerId | -1>();
  for (const side of rep.sides) {
    for (const sh of side.ships) owner.set(sh.id, side.owner);
    if (side.garrison) owner.set(side.garrison.id, side.owner);
  }
  const losers = [...new Set(rep.sides.filter(s => s.owner !== winner && (s.ships.length || s.garrison)).map(s => s.owner))];
  if (!losers.length) return null;
  const ri = rep.rounds.length - 1;
  const shots = rep.rounds[ri].shots;
  let kill = -1, hit = -1;
  shots.forEach((s, i) => {
    const o = owner.get(s.to);
    if (o === undefined || !losers.includes(o) || s.miss || s.twist || !(s.dmg > 0)) return;
    hit = i;
    if (s.kill) kill = i;
  });
  // a garrison's fall has no kill flag (only ships carry one): the last hit on it in the final round is the blow
  const garrisonFell = rep.sides.some(s => losers.includes(s.owner) && s.garrison && shots.some(x => x.to === s.garrison!.id && x.dmg > 0));
  if (kill >= 0) return { round: ri, shot: kill, kind: 'last-ship', losers, winner };
  if (hit >= 0) return { round: ri, shot: hit, kind: garrisonFell ? 'last-ship' : 'broke', losers, winner };
  return null;
}

/** Ships each side brought, its garrison's hull (a world's defences are not ships), and its starting hull in all:
 *  the "power numbers" of the 400 ms hold. */
export function battlePower(rep: BattleReport): { owner: PlayerId | -1; ships: number; garrison: number; hp: number }[] {
  const by = new Map<PlayerId | -1, { owner: PlayerId | -1; ships: number; garrison: number; hp: number }>();
  for (const s of rep.sides) {
    const e = by.get(s.owner) ?? { owner: s.owner, ships: 0, garrison: 0, hp: 0 };
    e.ships += s.ships.length;
    e.garrison += s.garrison ? Math.max(0, s.garrison.hp) : 0;
    e.hp += s.ships.reduce((a, x) => a + Math.max(0, x.hp), 0) + (s.garrison ? Math.max(0, s.garrison.hp) : 0);
    by.set(s.owner, e);
  }
  return [...by.values()].filter(e => e.ships > 0 || e.garrison > 0);
}

/** Ships destroyed in this report, per owner of the destroyed ship (kill flags are the sim's own record). */
export function shipsLost(rep: BattleReport): Map<PlayerId | -1, number> {
  const owner = new Map<number, PlayerId | -1>();
  for (const side of rep.sides) for (const sh of side.ships) owner.set(sh.id, side.owner);
  const out = new Map<PlayerId | -1, number>();
  for (const r of rep.rounds) for (const s of r.shots) if (s.kill) { const o = owner.get(s.to); if (o !== undefined) out.set(o, (out.get(o) ?? 0) + 1); }
  return out;
}

/** Ships destroyed per shooter owner (who sank whom), for awards. */
export function shipsSunkBy(rep: BattleReport): Map<PlayerId | -1, number> {
  const owner = new Map<number, PlayerId | -1>();
  for (const side of rep.sides) { for (const sh of side.ships) owner.set(sh.id, side.owner); if (side.garrison) owner.set(side.garrison.id, side.owner); }
  const out = new Map<PlayerId | -1, number>();
  for (const r of rep.rounds) for (const s of r.shots) {
    if (!s.kill) continue;
    // a garrison shoots as -region-1 (its own id); anything unknown is skipped rather than guessed
    const o = owner.get(s.from);
    const victim = owner.get(s.to);
    if (o === undefined || victim === undefined || o === victim) continue;
    out.set(o, (out.get(o) ?? 0) + 1);
  }
  return out;
}

/**
 * How much a battle matters, for ascending-stakes ordering: hulls on the field and ships lost, plus what the
 * world is (a Crown, the Throne, a capital), plus a little when it is your fight (your battle is your news).
 */
export function battleStakes(rep: BattleReport, st: GameState, you: PlayerId | null): number {
  const pw = battlePower(rep);
  const ships = pw.reduce((a, p) => a + p.ships + (p.garrison > 0 ? 1 : 0), 0);
  const lost = Object.values(rep.losses ?? {}).reduce((a, n) => a + n, 0);
  const r = st.regions[rep.region];
  const isCapital = !!r && st.players.some(p => p.capital === r.id);
  const kind = r?.kind === 'throne' ? 8 : r?.kind === 'crown' ? 6 : isCapital ? 5 : r?.kind === 'relic' ? 2 : 0;
  const mine = you !== null && rep.sides.some(s => s.owner === you) ? 3 : 0;
  return ships + lost * 1.5 + kind + mine + (rep.winner !== null && !rep.ongoing ? 1 : 0);
}

/** BY A THREAD (DELIGHT #57): ships that came out of this report alive at 5% hull or less. Their final hull is their
 *  hull when they first fought this turn minus every hit that landed on them (misses and Twists of Fate excluded). */
export function byAThread(rep: BattleReport): { name: string; owner: number; hp: number; maxHp: number }[] {
  const dmg = new Map<number, number>(), killed = new Set<number>();
  for (const r of rep.rounds) for (const s of r.shots) {
    if (s.miss || s.twist) continue;
    dmg.set(s.to, (dmg.get(s.to) ?? 0) + Math.max(0, s.dmg));
    if (s.kill) killed.add(s.to);
  }
  const out: { name: string; owner: number; hp: number; maxHp: number }[] = [];
  for (const side of rep.sides) for (const sh of side.ships) {
    if (killed.has(sh.id) || !dmg.has(sh.id)) continue;
    const hp = sh.hp - (dmg.get(sh.id) ?? 0);
    if (hp > 0 && sh.maxHp > 0 && hp / sh.maxHp <= 0.05) out.push({ name: sh.name, owner: side.owner, hp, maxHp: sh.maxHp });
  }
  return out;
}
