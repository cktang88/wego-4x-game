// Second sweep: rules picked from the "As built" sections of docs/*.md, each checked against the sim.
import { describe, expect, it } from 'vitest';
import { createGame, newFleet, newShip } from '../shared/sim/setup.ts';
import { resolveTurn, emptySubmission, incomeDetail, upkeepOf } from '../shared/sim/resolve.ts';
import { validateOrder } from '../shared/sim/orders.ts';
import { viewFor } from '../shared/sim/view.ts';
import { seesFleet } from '../shared/sim/visibility.ts';
import { Rng } from '../shared/sim/rng.ts';
import { ensureSoul } from '../shared/sim/soul.ts';
import { citizenCap } from '../shared/sim/systems.ts';
import { lawSlots } from '../shared/sim/empire.ts';
import type { Fleet, FreeAction, GameEvent, GameState, Order, Region, Submission } from '../shared/sim/types.ts';

// no deep-space lane waypoints: neighbouring colonies are directly linked
const game = (seed = 31, rules: unknown = { map: { laneDots: [] } }) => createGame({ seed, rules, players: [0, 1, 2].map(() => ({ kind: 'human' as const })) });
const idle = (s: GameState): Record<number, Submission> => Object.fromEntries(s.players.map(p => [p.id, emptySubmission(s)]));
const subs = (s: GameState, by: Record<number, [Order[], FreeAction[]]>) => {
  const out = idle(s);
  for (const [k, [orders, free]] of Object.entries(by)) { orders.forEach((o, i) => { out[Number(k)].orders[i] = o; }); out[Number(k)].free = free; }
  return out;
};
const links = (s: GameState, id: number) => s.regions[id].links ?? s.regions[id].neighbors;
const rng = new Rng(9);
const fleetAt = (s: GameState, owner: number, region: number, classes: string[]): Fleet => {
  const f = newFleet(s, rng, owner, region);
  for (const c of classes) f.ships.push(newShip(s, rng, c, owner));
  f.bornTurn = 0;
  if (s.rules.soul.enabled) f.banner = { sigil: 'sun', boons: [], banes: [], home: s.players[Math.max(0, owner)].capital, foundedTurn: 1 };
  f.doctrine = { stance: 'aggressive', retreatAt: 0, target: 'weakest', guard: false };
  for (const sh of f.ships) sh.traits = [];
  return f;
};
const clear = (s: GameState) => { ensureSoul(s); s.fleets = []; };
const fails = (s: GameState, p: number) => (s.last?.events ?? []).filter((e): e is Extract<GameEvent, { k: 'fail' }> => e.k === 'fail' && e.owner === p).map(e => e.text);
const bfs = (s: GameState, from: number) => {
  const d = new Map([[from, 0]]); const q = [from];
  while (q.length) { const r = q.shift()!; for (const n of links(s, r)) if (!d.has(n)) { d.set(n, d.get(r)! + 1); q.push(n); } }
  return d;
};
/** A neutral colony far (>= 2) from every capital, with a colony neighbour. */
const farPair = (s: GameState) => {
  const ds = s.players.map(p => bfs(s, p.capital));
  const ok = (r: Region) => r.owner === null && r.kind === 'colony' && ds.every(d => (d.get(r.id) ?? 99) >= 2);
  const x = s.regions.find(r => ok(r) && links(s, r.id).some(n => ok(s.regions[n])))!;
  return { x, y: s.regions[links(s, x.id).find(n => ok(s.regions[n]))!] };
};
const core = (r: Region, owner: number, dev: number) => {
  r.trait = null; r.star = 'yellow';
  r.bodies = [{ kind: 'habitable', q: 'fair', name: 'Vel II', adj: 'ocean' }, { kind: 'gas', name: 'Tyr' }, { kind: 'belt', name: 'the Ashen Belt' }];
  r.owner = owner; r.dev = dev; r.heldSince = 1; r.garrison = 40; r.project = null; r.buildings = {}; r.vein = null;
};

describe('sweep2 docs: SIGNATURE.md "As built"', () => {
  it('Charge with no Seize falls back to Steady (a fail event)', () => {
    const s = game(); clear(s);
    const f = fleetAt(s, 0, s.players[0].capital, ['frigate']);
    const t = resolveTurn(s, subs(s, { 0: [[], [{ type: 'posture', fleet: f.id, posture: 'charge' }]] }));
    expect(fails(t, 0).some(x => /Charge.*needs a Seize/.test(x))).toBe(true);
  });

  it('Ambush with a move falls back to Steady (a fail event)', () => {
    const s = game(); clear(s);
    const cap = s.players[0].capital;
    const f = fleetAt(s, 0, cap, ['frigate']);
    const t = resolveTurn(s, subs(s, { 0: [[{ type: 'move', fleet: f.id, path: [links(s, cap)[0]] }], [{ type: 'posture', fleet: f.id, posture: 'ambush' }]] }));
    expect(fails(t, 0).some(x => /Ambush.*must lie still/.test(x))).toBe(true);
    expect(t.fleets.find(x => x.id === f.id)!.region).toBe(links(s, cap)[0]);
  });

  it('a Guarded fleet\'s Seize fails', () => {
    const s = game(); clear(s);
    const { x, y } = farPair(s);
    x.owner = 0; y.garrison = 1;
    const f = fleetAt(s, 0, x.id, ['frigate', 'frigate']);
    const t = resolveTurn(s, subs(s, { 0: [[{ type: 'seize', fleet: f.id, target: y.id }], [{ type: 'posture', fleet: f.id, posture: 'guarded' }]] }));
    expect(fails(t, 0).some(m => /Guarded/.test(m))).toBe(true);
    expect(t.fleets.find(z => z.id === f.id)!.region).toBe(x.id);
    expect(t.regions[y.id].owner).toBe(null);
  });

  it('Guarded with no arrival is dug in: it cannot move next turn', () => {
    const s = game(); clear(s);
    const cap = s.players[0].capital;
    const f = fleetAt(s, 0, cap, ['frigate']);
    const t = resolveTurn(s, subs(s, { 0: [[], [{ type: 'posture', fleet: f.id, posture: 'guarded' }]] }));
    const to = links(t, cap)[0];
    const t2 = resolveTurn(t, subs(t, { 0: [[{ type: 'move', fleet: f.id, path: [to] }], []] }));
    expect(t2.fleets.find(z => z.id === f.id)!.region).toBe(cap);
    expect(fails(t2, 0).some(m => /dug in/.test(m))).toBe(true);
  });

  it('Ambush with no arrival is exposed: seen by every house next turn', () => {
    const s = game(); clear(s);
    const { x } = farPair(s);
    const f = fleetAt(s, 0, x.id, ['frigate']);
    const t = resolveTurn(s, subs(s, { 0: [[], [{ type: 'posture', fleet: f.id, posture: 'ambush' }]] }));
    const tf = t.fleets.find(z => z.id === f.id)!;
    expect(tf.exposed).toBe(t.turn);
    expect(seesFleet(t, 1, tf)).toBe(true);
    expect(viewFor(t, 2).state.fleets.some(z => z.id === f.id)).toBe(true);
  });

  it('Fate: at most fatePerTurn (1) per house per turn', () => {
    const s = game(); clear(s);
    const cap = s.players[0].capital;
    const t = resolveTurn(s, subs(s, { 0: [[], [{ type: 'fate', use: 'surge', region: cap }, { type: 'fate', use: 'surge', region: cap }]] }));
    expect(t.players[0].fate).toBe(s.rules.signature.fateStart - 1);
    expect(fails(t, 0).some(m => /Fate per turn|already surges/.test(m))).toBe(true);
  });

  it('rivals see a posture only with a fleet in the same system or a scan over it', () => {
    const s = game(); clear(s);
    const { x, y } = farPair(s);
    x.feature = 'none'; y.feature = 'none';
    const f = fleetAt(s, 0, x.id, ['frigate']);
    f.posture = 'guarded';
    fleetAt(s, 1, x.id, ['frigate']);   // same system
    fleetAt(s, 2, y.id, ['frigate']);   // next door: sees the fleet, not its posture
    expect(viewFor(s, 1).state.fleets.find(z => z.id === f.id)?.posture).toBe('guarded');
    const v2 = viewFor(s, 2).state.fleets.find(z => z.id === f.id);
    expect(v2).toBeDefined();
    expect(v2!.posture ?? null).toBe(null);
    s.scans.push({ owner: 2, region: x.id, until: s.turn + 1 });
    expect(viewFor(s, 2).state.fleets.find(z => z.id === f.id)?.posture).toBe('guarded');
  });
});

describe('sweep2 docs: SYSTEMS.md "As built"', () => {
  it('citizens cap: habitable 1/3/4, yellow +1, red -1, blue <= 2, +1 per moon beside a habitable world, +1 barren, +1 Station, clamped to 5', () => {
    const s = game();
    const r = s.regions.find(x => x.kind === 'colony' && x.bodies)!;
    const cap = (star: Region['star'], bodies: Region['bodies'], station = 0) => { r.star = star; r.bodies = bodies; r.buildings = { station }; return citizenCap(s, r); };
    expect(cap('binary', [{ kind: 'habitable', q: 'poor', name: 'a' }])).toBe(1);
    expect(cap('binary', [{ kind: 'habitable', q: 'fair', name: 'a' }])).toBe(3);
    expect(cap('binary', [{ kind: 'habitable', q: 'rich', name: 'a' }])).toBe(4);
    expect(cap('yellow', [{ kind: 'habitable', q: 'fair', name: 'a' }])).toBe(4);
    expect(cap('red', [{ kind: 'habitable', q: 'fair', name: 'a' }])).toBe(2);
    expect(cap('blue', [{ kind: 'habitable', q: 'rich', name: 'a' }])).toBe(2);
    expect(cap('binary', [{ kind: 'habitable', q: 'fair', name: 'a' }, { kind: 'moon', name: 'm' }])).toBe(4);
    expect(cap('binary', [{ kind: 'moon', name: 'm' }])).toBe(0);                    // a lone moon: no citizens
    expect(cap('binary', [{ kind: 'barren', name: 'b' }], 1)).toBe(2);
    expect(cap('yellow', [{ kind: 'habitable', q: 'rich', name: 'a' }, { kind: 'moon', name: 'm' }, { kind: 'barren', name: 'b' }], 1)).toBe(5);
  });

  it('growth: an owned Core below its cap gains 1 citizen every 3 turns', () => {
    let s = game(); clear(s);
    const { x } = farPair(s);
    core(x, 0, 1);
    x.growth = 0;
    for (let i = 0; i < 2; i++) s = resolveTurn(s, idle(s));
    expect(s.regions[x.id].dev).toBe(1);
    s = resolveTurn(s, idle(s));
    expect(s.regions[x.id].dev).toBe(2);
  });

  it('a Shipyard needs 2 citizens (or a Station)', () => {
    const s = game(); clear(s);
    const { x } = farPair(s);
    core(x, 0, 1);
    const o: Order = { type: 'develop', region: x.id, project: 'shipyard' };
    expect(validateOrder(s, 0, o)).toMatch(/citizen/);
    x.dev = 2;
    expect(validateOrder(s, 0, o)).toBe(null);
    x.dev = 1; x.buildings = { station: 1 };
    expect(validateOrder(s, 0, o)).toBe(null);
  });

  it('a black hole stops a fleet entering it for the turn; its route carries on next turn', () => {
    let s = game(); clear(s);
    const cap = s.players[0].capital;
    const d = bfs(s, cap);
    // a path cap -> a -> b with a two steps from anyone else
    const a = links(s, cap).find(n => s.regions[n].owner === null && links(s, n).some(m => m !== cap && d.get(m) === 2 && s.regions[m].owner === null))!;
    const b = links(s, a).find(m => m !== cap && d.get(m) === 2 && s.regions[m].owner === null)!;
    s.regions[a].star = 'blackhole'; s.regions[a].garrison = 0; s.regions[b].garrison = 0;
    const f = fleetAt(s, 0, cap, ['corvette']);
    s = resolveTurn(s, subs(s, { 0: [[{ type: 'move', fleet: f.id, path: [a, b] }], []] }));
    const f1 = s.fleets.find(z => z.id === f.id)!;
    expect(f1.region).toBe(a);
    expect(s.last!.events.some(e => e.k === 'blocked' && e.reason === 'gravity well')).toBe(true);
    expect(f1.route?.path).toEqual([b]);
    s = resolveTurn(s, idle(s));
    expect(s.fleets.find(z => z.id === f.id)!.region).toBe(b);
  });

  it('Occupied: a system captured from a house pays its new owner 50% for 3 turns; a neutral capture is not occupied', () => {
    const s = game(); clear(s);
    const { x, y } = farPair(s);
    core(x, 1, 3); x.garrison = 0;
    core(y, 0, 2);
    const f = fleetAt(s, 0, y.id, ['frigate', 'frigate']);
    let t = resolveTurn(s, subs(s, { 0: [[{ type: 'seize', fleet: f.id, target: x.id }], []] }));
    expect(t.regions[x.id].owner).toBe(0);
    expect(t.regions[x.id].occupied).toMatchObject({ by: 0, until: s.turn + 3 });
    // while occupied it pays half
    const full = (st: GameState) => { const c = structuredClone(st); c.regions[x.id].occupied = null; return incomeDetail(c, 0).total.credits - incomeDetail(Object.assign(structuredClone(c), { regions: c.regions.map(r => (r.id === x.id ? { ...r, owner: null } : r)) }), 0).total.credits; };
    const occ = (st: GameState) => incomeDetail(st, 0).total.credits - incomeDetail(Object.assign(structuredClone(st), { regions: st.regions.map(r => (r.id === x.id ? { ...r, owner: null } : r)) }), 0).total.credits;
    expect(occ(t)).toBeCloseTo(full(t) / 2, 0);
    for (let i = 0; i < 2; i++) t = resolveTurn(t, idle(t));
    expect(t.regions[x.id].occupied ?? null).toBe(null);   // paid for turns T, T+1, T+2
    // neutral capture: no occupation
    const s2 = game(); clear(s2);
    const p2 = farPair(s2);
    p2.x.garrison = 0; p2.y.owner = 0;
    const g = fleetAt(s2, 0, p2.y.id, ['frigate', 'frigate']);
    const t2 = resolveTurn(s2, subs(s2, { 0: [[{ type: 'seize', fleet: g.id, target: p2.x.id }], []] }));
    expect(t2.regions[p2.x.id].owner).toBe(0);
    expect(t2.regions[p2.x.id].occupied ?? null).toBe(null);
  });

  it('refugees: every 3 contested turns a citizen flees (never below 1)', () => {
    // (no garrison: the besieger just sits there, contesting it, without a fight)
    let s = game(31, { map: { laneDots: [] }, garrison: { regenPerTurn: 0 } }); clear(s);
    const { x } = farPair(s);
    core(x, 1, 2); x.garrison = 0;
    fleetAt(s, 0, x.id, ['frigate']);
    for (let i = 0; i < 2; i++) s = resolveTurn(s, idle(s));
    expect(s.regions[x.id].dev).toBe(2);
    s = resolveTurn(s, idle(s));
    expect(s.regions[x.id].dev).toBe(1);
    for (let i = 0; i < 3; i++) s = resolveTurn(s, idle(s));
    expect(s.regions[x.id].dev).toBe(1);
  });
});

describe('sweep2 docs: SOUL.md and EMPIRE.md', () => {
  it('banners are scarce: 3, plus 1 per Crown held', () => {
    const s = game(); clear(s);
    const cap = s.players[0].capital;
    for (let i = 0; i < 3; i++) fleetAt(s, 0, cap, ['frigate']);
    const o: Order = { type: 'build', region: cap, cls: 'frigate', fleet: null };
    expect(validateOrder(s, 0, o)).toMatch(/no free banner/);
    s.regions.find(r => r.kind === 'crown')!.owner = 0;
    expect(validateOrder(s, 0, o)).toBe(null);
  });

  it('capture: tenure resets and the Calling goes dormant for 3 turns', () => {
    const s = game(); clear(s);
    const { x, y } = farPair(s);
    core(x, 1, 3); x.garrison = 0;
    x.story!.calling = { id: 'granary', since: 1 }; x.story!.tenureFrom = 1;
    y.owner = 0;
    const f = fleetAt(s, 0, y.id, ['frigate', 'frigate']);
    const t = resolveTurn(s, subs(s, { 0: [[{ type: 'seize', fleet: f.id, target: x.id }], []] }));
    expect(t.regions[x.id].owner).toBe(0);
    expect(t.regions[x.id].story!.tenureFrom).toBe(s.turn);
    expect(t.regions[x.id].story!.calling?.dormantUntil).toBe(s.turn + 3);
  });

  it('law slots: 1 at the start, +1 at turn 10, +1 with Bureaucracy', () => {
    const s = game();
    expect(lawSlots(s, 0)).toBe(1);
    s.turn = 10;
    expect(lawSlots(s, 0)).toBe(2);
    s.players[0].techs = ['bureaucracy'];
    expect(lawSlots(s, 0)).toBe(3);
  });

  it('Supply Depots cut ship upkeep by the tech\'s stated share (40%, as the tech card says)', () => {
    const s = game(); clear(s);
    for (let i = 0; i < 5; i++) fleetAt(s, 0, s.players[0].capital, ['frigate', 'frigate']);
    const raw = upkeepOf(s, 0);
    s.players[0].techs = ['depots'];
    expect(upkeepOf(s, 0)).toBe(Math.round(raw * 0.6));
  });
});
