import { describe, it, expect } from 'vitest';
import { createGame, resolveTurn, planTurn, viewFor, validateOrder, emptySubmission, findPath } from '../shared/index.ts';
import type { GameState, Submission } from '../shared/index.ts';

const ai3 = (seed: number, rules?: unknown) => createGame({ seed, rules, players: [0, 1, 2].map(() => ({ kind: 'ai' as const, aiLevel: 'expert' as const })) });
function play(s: GameState, turns: number) {
  for (let t = 0; t < turns && s.winner === null; t++) {
    const subs: Record<number, Submission> = {};
    for (const p of s.players) subs[p.id] = planTurn(s, p.id);
    s = resolveTurn(s, subs);
  }
  return s;
}

describe('map', () => {
  it('is connected, symmetric and fair for many seeds', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const s = ai3(seed);
      const homes = s.players.map(p => p.capital);
      const crowns = s.regions.filter(r => r.kind === 'crown').map(r => r.id);
      const throne = s.regions.find(r => r.kind === 'throne')!.id;
      expect(crowns.length).toBe(3);
      for (const a of s.regions) for (const b of a.neighbors) expect(s.regions[b].neighbors).toContain(a.id);
      const dT = homes.map(h => findPath(s, h, throne)!.length);
      expect(new Set(dT).size).toBe(1); // every capital is equally far from the Throne
      for (const h of homes) for (const c of crowns) expect(findPath(s, h, c)!.length).toBeGreaterThanOrEqual(2);
      const deg = homes.map(h => s.regions[h].neighbors.length);
      expect(new Set(deg).size).toBe(1);
    }
  });
});

describe('determinism', () => {
  it('same seed + same orders => identical game', () => {
    const a = play(ai3(42), 12), b = play(ai3(42), 12);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it('replaying the logged submissions reproduces the state (what online clients rely on)', () => {
    const a = play(ai3(7), 10);
    let b = ai3(7);
    for (const entry of a.log) b = resolveTurn(b, entry.submissions);
    expect(JSON.stringify({ ...b, last: null })).toBe(JSON.stringify({ ...a, last: null }));
  });
});

describe('full games', () => {
  it('AI games finish without errors and produce conflict', () => {
    let battles = 0;
    for (let seed = 100; seed < 106; seed++) {
      let s = ai3(seed);
      while (s.winner === null && s.turn < 80) { s = play(s, 1); battles += s.last!.battles.length; }
      expect(s.winner).not.toBeNull();
      for (const f of s.fleets) expect(f.ships.length).toBeGreaterThan(0);
      for (const f of s.fleets) for (const sh of f.ships) { expect(sh.hp).toBeGreaterThan(0); expect(sh.hp).toBeLessThanOrEqual(sh.maxHp); }
    }
    expect(battles).toBeGreaterThan(20);
  });
});

describe('rules', () => {
  it('limits orders per fleet and validates adjacency', () => {
    const s = ai3(3);
    const f = s.fleets.find(x => x.owner === 0)!;
    const far = s.regions.find(r => r.kind === 'throne')!.id;
    expect(validateOrder(s, 0, { type: 'seize', fleet: f.id, target: far })).toMatch(/adjacent/);
    expect(validateOrder(s, 1, { type: 'fortify', fleet: f.id })).toMatch(/not your fleet/);
    const sub = emptySubmission(s);
    sub.orders = [{ type: 'fortify', fleet: f.id }, { type: 'fortify', fleet: f.id }, { type: 'fortify', fleet: f.id }, null, null];
    const n = resolveTurn(s, { 0: sub, 1: emptySubmission(s), 2: emptySubmission(s) });
    expect(n.last!.events.filter(e => e.k === 'fail' && e.owner === 0).length).toBe(1);
  });
  it('fog of war hides rival fleets & stockpiles outside sensor range', () => {
    const s = ai3(5);
    const v = viewFor(s, 0);
    expect(v.state.fleets.every(f => f.owner === 0)).toBe(true);
    expect(v.state.players[1].res.industry).toBe(-1);
    expect(v.state.players[0].res.industry).toBe(s.players[0].res.industry);
  });
  it('head-on moves clash instead of bouncing', () => {
    const s = ai3(11);
    // put fleets of 0 and 1 on two adjacent regions and swap them
    const a = s.fleets.find(f => f.owner === 0)!, b = s.fleets.find(f => f.owner === 1)!;
    const r1 = s.regions.find(r => r.kind === 'colony' && r.neighbors.some(n => s.regions[n].kind === 'colony'))!;
    const r2 = r1.neighbors.find(n => s.regions[n].kind === 'colony')!;
    a.region = r1.id; b.region = r2;
    const sa = emptySubmission(s), sb = emptySubmission(s);
    sa.orders[0] = { type: 'move', fleet: a.id, path: [r2] };
    sb.orders[0] = { type: 'move', fleet: b.id, path: [r1.id] };
    const n = resolveTurn(s, { 0: sa, 1: sb, 2: emptySubmission(s) });
    expect(n.last!.events.some(e => e.k === 'clash')).toBe(true);
    expect(n.last!.battles.length).toBeGreaterThan(0);
  });
});

describe('intel', () => {
  it('never reports a player its own actions, and no duplicate signals', () => {
    let s = ai3(33);
    for (let t = 0; t < 12; t++) {
      s = play(s, 1);
      const sig = s.last!.signals;
      for (const g of sig) expect(g.about === g.observer).toBe(false);
      const keys = sig.map(g => `${g.observer}|${g.pulse}|${g.text}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe('playtest fixes', () => {
  it('one influence per target per turn; loyalty capped; crowns need a 2-turn hold', () => {
    const s = ai3(9);
    const me = 0;
    const target = s.regions.find(r => r.owner === null && r.kind !== 'void' && r.neighbors.includes(s.players[me].capital))!;
    s.players[me].res.influence = 200;
    const sub = emptySubmission(s);
    sub.orders = [0, 1, 2, 3, 4].map(() => ({ type: 'influence' as const, target: target.id }));
    const n = resolveTurn(s, { 0: sub, 1: emptySubmission(s), 2: emptySubmission(s) });
    expect(n.last!.events.filter(e => e.k === 'influence').length).toBe(1);
    // crowns
    const t = ai3(9);
    for (const r of t.regions) if (r.kind === 'crown') r.owner = 1;
    let x = resolveTurn(t, { 0: emptySubmission(t), 1: emptySubmission(t), 2: emptySubmission(t) });
    expect(x.winner).toBeNull();
    x = resolveTurn(x, { 0: emptySubmission(x), 1: emptySubmission(x), 2: emptySubmission(x) });
    expect(x.winner).toBe(1);
  });
});
