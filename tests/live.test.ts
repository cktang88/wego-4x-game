// LIVE mode: banked orders on a timer, real-time travel, tick/cycle resolution.
import { describe, expect, it } from 'vitest';
import { createGame } from '../shared/sim/setup.ts';
import { makeLive, accrue, queueOrder, cancelQueued, advanceTo, orderMs, tickMs, etaTicks, runTick } from '../shared/sim/live.ts';
import { viewFor } from '../shared/sim/view.ts';
import type { GameState } from '../shared/sim/types.ts';

const T0 = 1_700_000_000_000;
function liveGame(seed = 3, kinds: ('human' | 'ai')[] = ['human', 'ai', 'ai']): GameState {
  const s = createGame({ seed, players: kinds.map(kind => ({ kind, aiLevel: 'standard' as const })) });
  return makeLive(s, T0, 1);
}
/** A region `k` hops from `from` (BFS), not owned by `pid`. */
function hopsAway(s: GameState, from: number, k: number, pid: number) {
  const d = new Map([[from, 0]]); const q = [from];
  while (q.length) { const r = q.shift()!; for (const n of s.regions[r].neighbors) if (!d.has(n)) { d.set(n, d.get(r)! + 1); q.push(n); } }
  return [...d].find(([r, h]) => h === k && s.regions[r].owner !== pid && s.regions[r].kind !== 'crown' && s.regions[r].kind !== 'throne')![0];
}
const pathTo = (s: GameState, from: number, to: number) => {
  const prev = new Map<number, number>([[from, -1]]); const q = [from];
  while (q.length) { const r = q.shift()!; for (const n of s.regions[r].neighbors) if (!prev.has(n)) { prev.set(n, r); q.push(n); } }
  const p: number[] = []; for (let r = to; r !== from; r = prev.get(r)!) p.unshift(r);
  return p;
};

describe('live mode', () => {
  it('accrues one order per interval and caps the bank', () => {
    const s = liveGame();
    const start = s.live!.bank[0];
    accrue(s, T0 + orderMs(s) * 2 + 1);
    expect(s.live!.bank[0]).toBe(start + 2);
    accrue(s, T0 + orderMs(s) * 100);
    expect(s.live!.bank[0]).toBe(s.rules.live.bankCap);
  });

  it('spends and refunds orders; rejects when the bank is empty', () => {
    const s = liveGame();
    const cap = s.players[0].capital;
    const n = s.live!.bank[0];
    const build = { type: 'build' as const, region: cap, cls: 'corvette', fleet: null };
    expect(queueOrder(s, 0, build, T0)).toBeNull();
    expect(s.live!.bank[0]).toBe(n - 1);
    expect(cancelQueued(s, 0, 0)).toBe(true);
    expect(s.live!.bank[0]).toBe(n);
    s.live!.bank[0] = 0;
    expect(queueOrder(s, 0, build, T0)).toMatch(/no orders/);
  });

  it('moves fleets across several regions over several ticks', () => {
    let s = liveGame();
    const f = s.fleets.find(x => x.owner === 0)!;
    const dest = hopsAway(s, f.region, 3, 0);
    const path = pathTo(s, f.region, dest);
    expect(queueOrder(s, 0, { type: 'move', fleet: f.id, path }, T0)).toBeNull();
    const eta = 1 + (etaTicks(runTick(structuredClone(s), () => false), f.id) ?? 0);
    const seen = new Set<number>();
    for (let i = 0; i < 20 && s.fleets.find(x => x.id === f.id)?.route !== null; i++) {
      s = runTick(s, () => false);
      const g = s.fleets.find(x => x.id === f.id);
      if (!g) break;
      seen.add(g.region);
    }
    const g = s.fleets.find(x => x.id === f.id);
    if (g) {
      expect(g.region).toBe(dest);
      expect(seen.size).toBeGreaterThanOrEqual(2);   // it really travelled hop by hop
      expect(s.live!.tick).toBeGreaterThan(1);
      expect(s.live!.tick).toBeLessThanOrEqual(eta + 1);
    }
  });

  it('ends a cycle (income, turn++) every ticksPerCycle ticks', () => {
    let s = liveGame();
    const per = s.rules.live.ticksPerCycle;
    for (let i = 0; i < per; i++) s = runTick(s, () => true);
    expect(s.turn).toBe(2);
    expect(s.live!.tick).toBe(per);
  });

  it('advanceTo is deterministic and catches up on missed ticks', () => {
    const a = advanceTo(liveGame(5, ['ai', 'ai', 'ai']), T0 + tickMs(liveGame()) * 40 + 5, () => true);
    const b = advanceTo(liveGame(5, ['ai', 'ai', 'ai']), T0 + tickMs(liveGame()) * 40 + 5, () => true);
    expect(a.results.length).toBe(40);
    expect(a.state.live!.tick).toBe(40);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
  });

  it("hides rivals' banks and queued orders", () => {
    const s = liveGame(3, ['human', 'human', 'human']);
    queueOrder(s, 1, { type: 'build', region: s.players[1].capital, cls: 'corvette', fleet: null }, T0);
    const v = viewFor(s, 0).state;
    expect(v.live!.bank[1]).toBe(-1);
    expect(v.live!.queue[1]).toBeUndefined();
    expect(v.live!.bank[0]).toBe(s.live!.bank[0]);
  });
});
