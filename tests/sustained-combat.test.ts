import { describe, it, expect } from 'vitest';
import { createGame, resolveTurn, emptySubmission, newShip } from '../shared/index.ts';
import { Rng } from '../shared/sim/rng.ts';
import type { GameState, Fleet } from '../shared/index.ts';

const g = (seed: number) => createGame({ seed, players: [0, 1, 2].map(() => ({ kind: 'ai' as const, aiLevel: 'standard' as const })) });
const idle = (s: GameState) => ({ 0: emptySubmission(s), 1: emptySubmission(s), 2: emptySubmission(s) });
const stack = (s: GameState, f: Fleet, n: number, cls = 'frigate') => { const rng = new Rng(1); f.ships = []; for (let i = 0; i < n; i++) f.ships.push(newShip(s, rng, cls)); };
const neutralSpot = (s: GameState) => s.regions.find(r => r.owner === null && r.kind === 'colony' && r.neighbors.every(n => s.regions[n].owner === null))!;

describe('sustained combat', () => {
  it('a big fleet battle lasts longer than a small one and can span turns', () => {
    const rounds = (n: number) => {
      const s = g(31);
      const x = neutralSpot(s);
      const a = s.fleets.find(f => f.owner === 0)!, b = s.fleets.find(f => f.owner === 1)!;
      stack(s, a, n); stack(s, b, n);
      a.region = x.id; b.region = x.id;
      a.doctrine = { ...a.doctrine, stance: 'aggressive', retreatAt: 0 }; b.doctrine = { ...b.doctrine, stance: 'aggressive', retreatAt: 0 };
      let t = s; let turns = 0;
      do { t = resolveTurn(t, idle(t)); turns++; } while (t.engagements.some(e => e.region === x.id) && turns < 10);
      const total = t.last!.battles.find(bb => bb.region === x.id)?.totalRounds ?? 0;
      return { total, turns };
    };
    const small = rounds(2), big = rounds(8);
    expect(big.total).toBeGreaterThan(small.total);
    expect(big.turns).toBeGreaterThan(1);
  });

  it('reinforcements arriving later join the same engagement', () => {
    const s = g(32);
    const x = neutralSpot(s);
    const [a, a2] = s.fleets.filter(f => f.owner === 0);
    const b = s.fleets.find(f => f.owner === 1)!;
    stack(s, a, 4); stack(s, b, 6); stack(s, a2, 3);
    a.region = x.id; b.region = x.id; a2.region = x.neighbors[0];
    for (const f of [a, b]) f.doctrine = { ...f.doctrine, stance: 'aggressive', retreatAt: 0 };
    let t = resolveTurn(s, idle(s));
    const eng = t.engagements.find(e => e.region === x.id);
    expect(eng).toBeTruthy();
    const sub = emptySubmission(t);
    sub.orders[0] = { type: 'move', fleet: a2.id, path: [x.id] };
    t = resolveTurn(t, { 0: sub, 1: emptySubmission(t), 2: emptySubmission(t) });
    const eng2 = t.engagements.find(e => e.region === x.id) ?? null;
    const rep = t.last!.battles.find(bb => bb.region === x.id)!;
    expect(rep.highlights.some(h => h.includes('Reinforcements'))).toBe(true);
    if (eng2) expect(eng2.id).toBe(eng!.id);
    expect(rep.engagement).toBe(eng!.id);
  });

  it('a siege carries on over turns without new orders and then captures', () => {
    const s = g(33);
    const x = neutralSpot(s);
    x.garrison = x.baseGarrison = 90;   // fortress-sized: 3 bombards need more than one turn
    const a = s.fleets.find(f => f.owner === 0)!;
    stack(s, a, 3, 'bombard');
    a.region = x.links![0];
    a.doctrine = { ...a.doctrine, retreatAt: 0 };
    const sub = emptySubmission(s);
    sub.orders[0] = { type: 'seize', fleet: a.id, target: x.id };
    let t = resolveTurn(s, { 0: sub, 1: emptySubmission(s), 2: emptySubmission(s) });
    let turns = 1;
    while (t.regions[x.id].owner !== 0 && turns < 8) { t = resolveTurn(t, idle(t)); turns++; }
    expect(t.regions[x.id].owner).toBe(0);
    expect(turns).toBeGreaterThan(1);
  });
});
