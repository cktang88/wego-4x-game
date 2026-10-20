// Regression tests from the engine bug-review pass (resolve/combat/orders/edicts).
import { describe, it, expect } from 'vitest';
import { createGame, resolveTurn, emptySubmission, validateOrder, planTurn } from '../shared/index.ts';
import type { GameState, Submission } from '../shared/index.ts';
import { EDICTS } from '../shared/sim/edicts.ts';

const game = (seed: number) => createGame({ seed, players: [0, 1, 2].map(() => ({ kind: 'ai' as const, aiLevel: 'expert' as const })) });
const idle = (s: GameState): Record<number, Submission> => ({ 0: emptySubmission(s), 1: emptySubmission(s), 2: emptySubmission(s) });
const sane = (s: GameState) => {
  for (const f of s.fleets) {
    expect(f.ships.length).toBeGreaterThan(0);
    for (const sh of f.ships) { expect(Number.isFinite(sh.hp)).toBe(true); expect(s.rules.ships[sh.cls]).toBeDefined(); }
    expect(s.regions[f.region]).toBeDefined();
  }
  for (const p of s.players) for (const k of ['industry', 'credits', 'influence'] as const) expect(Number.isFinite(p.res[k])).toBe(true);
  for (const r of s.regions) if (r.project) expect(Object.hasOwn(s.rules.projects, r.project.key)).toBe(true);
};

describe('garbage submissions from network clients', () => {
  const junk: unknown[] = [
    'abc', 42, null, true, [], {}, { type: 'nope' },
    { type: 'move' }, { type: 'move', fleet: 1, path: 'abc' }, { type: 'move', fleet: 1, path: [NaN, -1, 1e9, '__proto__'] },
    { type: 'move', fleet: '1', path: [0] }, { type: 'move', fleet: 1, path: new Array(100000).fill(0) },
    { type: 'seize', fleet: 1, target: '__proto__' }, { type: 'seize', fleet: 1, target: 0, also: 5 }, { type: 'seize', fleet: 1, target: 0, also: { length: 1e9 } },
    { type: 'build', region: 0, cls: '__proto__', fleet: null }, { type: 'build', region: 0, cls: 'toString', fleet: null },
    { type: 'develop', region: 0, project: '__proto__' }, { type: 'develop', region: 0, project: 'constructor' },
    { type: 'influence', target: '__proto__' }, { type: 'influence', target: 'length' },
    { type: 'scan', target: 'length' }, { type: 'feint', target: 'length' }, { type: 'feint', target: -3 },
    { type: 'pact', with: '__proto__' }, { type: 'pact', with: 'length' }, { type: 'excavate' }, { type: 'fortify', fleet: { id: 1 } },
  ];
  it('resolveTurn never throws or corrupts state', () => {
    for (let i = 0; i < junk.length; i++) {
      const s = game(500 + i);
      const cap = s.players[0].capital;
      const j: any = structuredClone(junk[i]);
      if (j && typeof j === 'object' && 'region' in j) j.region = cap;
      if (j && typeof j === 'object' && j.fleet === 1) j.fleet = s.fleets.find(f => f.owner === 0)!.id;
      const sub: any = { orders: [j, j, j, j, j], free: [j] };
      const n = resolveTurn(s, { ...idle(s), 0: sub });
      sane(n);
      expect(n.players[0].pactOffers.every(x => typeof x === 'number')).toBe(true);
      // keeps going afterwards
      sane(resolveTurn(n, idle(n)));
    }
  });
  it('malformed submission envelopes and free actions are ignored', () => {
    const s = game(601);
    const f = s.fleets.find(x => x.owner === 0)!;
    const subs: any[] = [
      'x', 7, { orders: 'abcde', free: 'x' }, { orders: [], free: [null, 3, 'merge', { type: 'split', fleet: f.id, ships: 9 }, { type: 'split', fleet: f.id, ships: { length: 5 } },
        { type: 'doctrine', fleet: f.id, doctrine: null }, { type: 'doctrine', fleet: f.id }, { type: 'merge', fleet: f.id }, { type: 'rename', fleet: f.id, name: { toString: 1 } }] },
    ];
    for (const sub of subs) sane(resolveTurn(s, { ...idle(s), 0: sub }));
  });
  it('an invalid order cannot use up a rival fleet\'s per-fleet order budget', () => {
    const s = game(602);
    const victim = s.fleets.find(x => x.owner === 1)!;
    const evil = emptySubmission(s);
    evil.orders = [0, 1, 2, 3, 4].map(() => ({ type: 'fortify' as const, fleet: victim.id }));
    const vs = emptySubmission(s);
    vs.orders[3] = { type: 'fortify', fleet: victim.id };
    const credits0 = s.players[0].res.credits;
    const n = resolveTurn(s, { 0: evil, 1: vs, 2: emptySubmission(s) });
    expect(n.last!.events.some(e => e.k === 'fortify' && e.fleet === victim.id)).toBe(true);
    expect(n.last!.events.filter(e => e.k === 'fail' && e.owner === 1).length).toBe(0);
    // and the griefer wasn't charged fatigue for someone else's fleet
    expect(n.players[0].res.credits).toBeGreaterThanOrEqual(credits0 - 0);
  });
  it('validateOrder rejects prototype keys for ship classes / projects', () => {
    const s = game(603);
    const cap = s.players[0].capital;
    expect(validateOrder(s, 0, { type: 'build', region: cap, cls: '__proto__', fleet: null })).not.toBeNull();
    expect(validateOrder(s, 0, { type: 'build', region: cap, cls: 'constructor', fleet: null })).not.toBeNull();
    expect(validateOrder(s, 0, { type: 'develop', region: cap, project: '__proto__' })).not.toBeNull();
    expect(validateOrder(s, 0, { type: 'develop', region: cap, project: 'hasOwnProperty' })).not.toBeNull();
  });
  it('legit AI submissions are unchanged by sanitizing (replays stay identical)', () => {
    let s = game(604);
    for (let t = 0; t < 4; t++) {
      const subs: Record<number, Submission> = {};
      for (const p of s.players) subs[p.id] = planTurn(s, p.id);
      s = resolveTurn(s, subs);
      for (const p of s.players) {
        const logged = s.log[s.log.length - 1].submissions[p.id];
        expect(JSON.stringify(logged.orders)).toBe(JSON.stringify(subs[p.id].orders.map(o => o ?? null)));
      }
    }
  });
});

describe('seize edge cases', () => {
  it('a seize still happens if a joining fleet was destroyed earlier in the turn', () => {
    const s = game(610);
    const f = s.fleets.find(x => x.owner === 0 && x.ships.length > 1)!;
    const tgt = s.regions.find(r => r.owner === null && r.kind === 'colony' && r.neighbors.includes(f.region))!;
    tgt.garrison = 0; tgt.baseGarrison = 0;
    const sub = emptySubmission(s);
    sub.orders[0] = { type: 'seize', fleet: f.id, target: tgt.id, also: [987654] };
    const n = resolveTurn(s, { ...idle(s), 0: sub });
    expect(n.regions[tgt.id].owner).toBe(0);
  });
  it('fleets formed this turn (split) cannot join an assault', () => {
    const s = game(611);
    const f = s.fleets.find(x => x.owner === 0 && x.ships.length >= 2)!;
    s.turn = 3;
    const tgt = s.regions.find(r => r.owner === null && r.kind === 'colony' && r.neighbors.includes(f.region))!;
    tgt.garrison = 0; tgt.baseGarrison = 0;
    const lead = s.fleets.find(x => x.owner === 0 && x !== f)!;
    lead.region = f.region;
    const nextId = s.nextId;
    const sub = emptySubmission(s);
    sub.free = [{ type: 'split', fleet: f.id, ships: [f.ships[0].id] }];
    // the split-off fleet gets the next id (commander from reserve or new; the fleet id is allocated first)
    sub.orders[0] = { type: 'seize', fleet: lead.id, target: tgt.id };
    const probe = resolveTurn(structuredClone(s), { ...idle(s), 0: { ...sub, orders: emptySubmission(s).orders } });
    const newId = probe.fleets.find(x => x.owner === 0 && x.id >= nextId)!.id;
    (sub.orders[0] as any).also = [newId];
    const n = resolveTurn(s, { ...idle(s), 0: sub });
    expect(n.fleets.find(x => x.id === newId)!.region).toBe(f.region);
  });
  it('simultaneous seize of a neutral region by pact partners is not a betrayal', () => {
    const s = game(612);
    s.pacts.push({ a: 0, b: 1, until: s.turn + 3 });
    const tgt = s.regions.find(r => r.owner === null && r.kind === 'colony')!;
    tgt.garrison = 0; tgt.baseGarrison = 0;
    const n0 = tgt.neighbors[0], n1 = tgt.neighbors[1] ?? tgt.neighbors[0];
    const a = s.fleets.find(x => x.owner === 0)!, b = s.fleets.find(x => x.owner === 1)!;
    a.region = n0; b.region = n1;
    for (const r of [n0, n1]) { s.regions[r].owner = null; s.regions[r].garrison = 0; }
    const sa = emptySubmission(s), sb = emptySubmission(s);
    sa.orders[0] = { type: 'seize', fleet: a.id, target: tgt.id };
    sb.orders[0] = { type: 'seize', fleet: b.id, target: tgt.id };
    const n = resolveTurn(s, { 0: sa, 1: sb, 2: emptySubmission(s) });
    expect(n.last!.events.some(e => e.k === 'betrayal')).toBe(false);
    expect(n.pacts.some(x => x.a === 0 && x.b === 1)).toBe(true);
    expect([0, 1]).toContain(n.regions[tgt.id].owner);
  });
});

describe('clash & retreat consistency', () => {
  it('retreat events match where the fleets actually end up', () => {
    for (let seed = 620; seed < 660; seed++) {
      const s = game(seed);
      const a = s.fleets.find(f => f.owner === 0 && f.ships.length > 1)!, b = s.fleets.find(f => f.owner === 1 && f.ships.length > 1)!;
      const r1 = s.regions.find(r => r.owner === null && r.neighbors.some(n => s.regions[n].owner === null))!;
      const r2 = r1.neighbors.find(n => s.regions[n].owner === null)!;
      a.region = r1.id; b.region = r2;
      a.doctrine.retreatAt = 0.8; b.doctrine.retreatAt = 0.8;
      // site = min(r1, r2) when neither side is owned: alternate who fights "at home"
      if (seed % 2) [a.region, b.region] = [b.region, a.region];
      const sa = emptySubmission(s), sb = emptySubmission(s);
      sa.orders[0] = { type: 'move', fleet: a.id, path: [b.region] };
      sb.orders[0] = { type: 'move', fleet: b.id, path: [a.region] };
      const n = resolveTurn(s, { 0: sa, 1: sb, 2: emptySubmission(s) });
      // replay the movement-relevant events and compare with final positions
      const pos = new Map(n.last!.startFleets.map(f => [f.id, f.region]));
      for (const e of n.last!.events) {
        if (e.k === 'move') pos.set(e.fleet, e.to);
        if (e.k === 'retreat') pos.set(e.fleet, e.to);
      }
      for (const f of n.fleets) if (f.owner >= 0 && pos.has(f.id)) expect(pos.get(f.id)).toBe(f.region);
    }
  });
});

describe('edicts', () => {
  it('deep strike / open gate ignore eliminated players\' stale capitals', () => {
    const s = game(670);
    const cap = s.players[2].capital;
    s.players[2].eliminated = true;
    s.regions[cap].owner = 0;
    const f = s.fleets.find(x => x.owner === 0)!;
    f.region = cap;
    for (const r of s.regions) if (r.owner === 0 && r.id !== cap && s.regions[cap].neighbors.includes(r.id)) r.owner = null;
    expect(EDICTS.deep_strike.check(s, { startOwners: s.regions.map(r => r.owner) })).not.toContain(0);
    s.regions[s.regions[cap].neighbors[0]].owner = 0;
    const capOf1 = new Set(s.regions[s.players[1].capital].neighbors);
    if (!s.regions.some(r => r.owner === 0 && capOf1.has(r.id))) expect(EDICTS.border_raid.check(s, { startOwners: [] })).not.toContain(0);
  });
});

describe('soak', () => {
  it('long AI games keep every fleet, ship and resource sane', () => {
    for (let seed = 680; seed < 686; seed++) {
      let s = game(seed);
      for (let t = 0; t < 25 && s.winner === null; t++) {
        const subs: Record<number, Submission> = {};
        for (const p of s.players) subs[p.id] = planTurn(s, p.id);
        s = resolveTurn(s, subs);
        sane(s);
      }
    }
  });
});

describe('retreat destinations', () => {
  it('prefer a calm neighbour over one with a hostile garrison', async () => {
    const { runBattle } = await import('../shared/sim/combat.ts');
    const { Rng } = await import('../shared/sim/rng.ts');
    let retreats = 0;
    for (let seed = 700; seed < 740; seed++) {
      const s = game(seed);
      const x = s.regions.find(r => r.owner === null && r.neighbors.length >= 3 && r.neighbors.every(n => s.regions[n].owner === null))!;
      const [calm, ...rest] = x.neighbors;
      for (const n of rest) { s.regions[n].owner = 2; s.regions[n].garrison = 20; }
      const a = s.fleets.find(f => f.owner === 0 && f.ships.length > 1)!;
      const b = s.fleets.find(f => f.owner === 1 && f.ships.length > 1)!;
      a.region = x.id; b.region = x.id;
      a.doctrine = { ...a.doctrine, stance: 'evasive' };
      b.doctrine = { ...b.doctrine, retreatAt: 0 };
      const out = runBattle(s, new Rng(seed), x.id, 1, [a, b], null, new Map());
      for (const r of out.retreats) { retreats++; expect(r.to).toBe(calm); }
    }
    expect(retreats).toBeGreaterThan(10);
  });
});

describe('old saves', () => {
  it('states missing later-added fields (baseGarrison, crownHold, capitalsTaken) still resolve cleanly', () => {
    let s: any = game(750);
    for (const r of s.regions) delete r.baseGarrison;
    delete s.crownHold; delete s.capitalsTaken;
    for (let t = 0; t < 6; t++) {
      const subs: Record<number, Submission> = {};
      for (const p of s.players) subs[p.id] = planTurn(s, p.id);
      s = resolveTurn(s, subs);
      sane(s);
      for (const r of s.regions) expect(Number.isFinite(r.garrison)).toBe(true);
      expect(s.crownHold).toBeDefined();
    }
  });
});
