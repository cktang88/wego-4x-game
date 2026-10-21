// WEGO resolves a whole turn in one step: all orders land together.
import { describe, expect, it } from 'vitest';
import { createGame } from '../shared/sim/setup.ts';
import { resolveTurn, emptySubmission } from '../shared/sim/resolve.ts';
import { validateOrder } from '../shared/sim/orders.ts';
import { fleetSpeed } from '../shared/sim/graph.ts';
import type { GameState, Order, Submission } from '../shared/sim/types.ts';

const game = (seed = 21) => createGame({ seed, players: [0, 1, 2].map(() => ({ kind: 'human' as const })) });
const sub = (s: GameState, orders: (Order | null)[]): Submission => ({ ...emptySubmission(s), orders: [...orders, null, null, null, null, null].slice(0, 5) });
const turn = (s: GameState, mine: (Order | null)[]) => resolveTurn(s, { 0: sub(s, mine), 1: emptySubmission(s), 2: emptySubmission(s) });

describe('one-step WEGO turns', () => {
  it('is the default: one pulse per turn', () => {
    const s = game();
    expect(s.rules.orders.pulses).toBe(1);
    const n = turn(s, []);
    expect(n.last!.events.filter(e => e.k === 'pulse').length).toBe(1);
  });

  it('a fleet gets one move or seize per turn', () => {
    const s = game();
    const f = s.fleets.find(x => x.owner === 0 && x.ships.length >= 2)!;
    const [a, b] = s.regions[f.region].neighbors.filter(n => s.regions[n].owner === null);
    const n = turn(s, [{ type: 'move', fleet: f.id, path: [a] }, { type: 'move', fleet: f.id, path: [b] }]);
    expect(n.fleets.find(x => x.id === f.id)!.region).toBe(a);
    expect(n.last!.events.some(e => e.k === 'fail' && e.text.includes('already has a move or seize'))).toBe(true);
  });

  it('seize can march through clear space first (via), within speed', () => {
    const s = game();
    const f = s.fleets.find(x => x.owner === 0 && fleetSpeed(s, x) >= 2)!;
    // find a neighbour (mid) with a further region (target) not adjacent to the fleet
    let mid = -1, target = -1;
    for (const m of s.regions[f.region].neighbors) {
      const t = s.regions[m].neighbors.find(n => n !== f.region && !s.regions[f.region].neighbors.includes(n) && s.regions[n].homeOf === null);
      if (t !== undefined && s.regions[m].homeOf === null) { mid = m; target = t; break; }
    }
    expect(mid).toBeGreaterThanOrEqual(0);
    s.regions[mid].owner = null; s.regions[target].owner = null;
    s.regions[mid].garrison = 0;   // clear space to march through
    expect(validateOrder(s, 0, { type: 'seize', fleet: f.id, target })).toMatch(/adjacent/);
    expect(validateOrder(s, 0, { type: 'seize', fleet: f.id, target, via: [mid] })).toBeNull();
    const n = turn(s, [{ type: 'seize', fleet: f.id, target, via: [mid] }]);
    const g = n.fleets.find(x => x.id === f.id);
    expect(g && (g.region === target || g.region === mid)).toBe(true);
    // too far for its speed
    const far = Array.from({ length: fleetSpeed(s, f) + 1 }, () => mid);
    expect(validateOrder(s, 0, { type: 'seize', fleet: f.id, target, via: far })).toMatch(/too far|connected/);
  });

  it('a ship built into a fleet sails with it when that fleet moves the same turn', () => {
    const s = game();
    s.players[0].res = { industry: 500, credits: 500, influence: 50 };
    const cap = s.players[0].capital;
    const f = s.fleets.find(x => x.owner === 0 && x.region === cap && x.ships.length < 8 && x.ships.every(sh => sh.cls !== 'scout'))!;
    const dest = s.regions[cap].neighbors.find(n => s.regions[n].owner === null && s.regions[n].garrison === 0) ?? s.regions[cap].neighbors[0];
    s.regions[dest].garrison = 0;
    const before = f.ships.length;
    const n = turn(s, [{ type: 'build', region: cap, cls: 'frigate', fleet: f.id }, { type: 'move', fleet: f.id, path: [dest] }]);
    const g = n.fleets.find(x => x.id === f.id)!;
    expect(g.ships.length).toBe(before + 1);
    expect(n.last!.events.some(e => e.k === 'fail' && e.owner === 0)).toBe(false);
  });

  it('battles fight roundsPerTurn rounds in the one step', () => {
    const s = game();
    const f = s.fleets.find(x => x.owner === 0 && x.ships.length >= 2)!;
    const t = s.regions[f.region].neighbors.find(n => s.regions[n].owner === null && s.regions[n].garrison > 0)!;
    s.regions[t].garrison = 200;   // a long siege
    const n = turn(s, [{ type: 'seize', fleet: f.id, target: t }]);
    const eng = n.engagements.find(e => e.region === t);
    if (eng) expect(eng.rounds).toBe(s.rules.combat.roundsPerTurn);
  });

  it('legacy saves with 5 pulses still resolve pulse by pulse', () => {
    const s = createGame({ seed: 21, players: [0, 1, 2].map(() => ({ kind: 'human' as const })), rules: { orders: { pulses: 5 } } });
    const n = turn(s, []);
    expect(n.last!.events.filter(e => e.k === 'pulse').length).toBe(5);
  });
});
