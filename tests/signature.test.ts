// Signature mechanics (docs/SIGNATURE.md): fleet postures (Steady / Guarded / Running / Charge / Ambush),
// world postures (Call the Levies / Scorched Earth / Open the Gates) and Fate tokens.
import { describe, expect, it } from 'vitest';
import { createGame, newFleet, newShip } from '../shared/sim/setup.ts';
import { resolveTurn, emptySubmission, incomeDetail, cleanFree } from '../shared/sim/resolve.ts';
import { planTurn } from '../shared/sim/ai.ts';
import { makeLive, runTick, queueFree } from '../shared/sim/live.ts';
import { viewFor, filterResultFor } from '../shared/sim/view.ts';
import { fleetSpeed } from '../shared/sim/graph.ts';
import { Rng } from '../shared/sim/rng.ts';
import { postureBlock, fateBlock, wpostureBlock, fateLeft, effStance, SG } from '../shared/sim/signature.ts';
import type { Fleet, FreeAction, GameEvent, GameState, Order, Submission } from '../shared/sim/types.ts';

const game = (seed = 31, rules?: unknown) => createGame({ seed, rules, players: [0, 1, 2].map(() => ({ kind: 'human' as const })) });
const idle = (s: GameState): Record<number, Submission> => Object.fromEntries(s.players.map(p => [p.id, emptySubmission(s)]));
/** Submissions for several players: {pid: [orders, free]} */
const subs = (s: GameState, by: Record<number, [Order[], FreeAction[]]>) => {
  const out = idle(s);
  for (const [k, [orders, free]] of Object.entries(by)) { orders.forEach((o, i) => { out[Number(k)].orders[i] = o; }); out[Number(k)].free = free; }
  return out;
};
const links = (s: GameState, id: number) => s.regions[id].links ?? s.regions[id].neighbors;
const bfs = (s: GameState, from: number) => {
  const d = new Map([[from, 0]]); const q = [from];
  while (q.length) { const r = q.shift()!; for (const n of links(s, r)) if (!d.has(n)) { d.set(n, d.get(r)! + 1); q.push(n); } }
  return d;
};
const farColony = (s: GameState, k = 2) => {
  const ds = s.players.map(p => bfs(s, p.capital));
  return s.regions.find(r => r.owner === null && r.kind === 'colony' && ds.every(d => (d.get(r.id) ?? 99) >= k) && links(s, r.id).some(n => s.regions[n].kind === 'colony' && s.regions[n].owner === null))!;
};
/** A colony next to x (direct link, no waypoint between). */
const nextTo = (s: GameState, x: number) => s.regions[links(s, x).find(n => s.regions[n].kind === 'colony' && s.regions[n].owner === null)!];
const rng = new Rng(7);
const fleetAt = (s: GameState, owner: number, region: number, classes: string[]): Fleet => {
  const f = newFleet(s, rng, owner, region);
  for (const c of classes) f.ships.push(newShip(s, rng, c, owner));
  f.bornTurn = 0;
  f.banner = { sigil: 'sun', boons: [], banes: [], home: s.players[owner].capital, foundedTurn: 1 };
  f.tally = { sieges: 0, defences: 0, interceptions: 0, wins: 0, routs: 0 };
  f.doctrine = { stance: 'aggressive', retreatAt: 0, target: 'weakest', guard: false };
  for (const sh of f.ships) sh.traits = [];
  return f;
};
const clearMap = (s: GameState) => { s.fleets = s.fleets.filter(f => f.owner < 0); };
/** Star systems: black holes stop entering fleets (docs/SYSTEMS.md); movement-range tests take them off the map. */
const noWells = (s: GameState) => { for (const r of s.regions) if (r.star === 'blackhole') r.star = 'pulsar'; };
const pev = (t: GameState, fleet?: number) => (t.last?.events ?? []).filter((e): e is Extract<GameEvent, { k: 'posture' }> => e.k === 'posture' && (fleet === undefined || e.fleet === fleet));
const fails = (t: GameState, p: number) => (t.last?.events ?? []).filter(e => e.k === 'fail' && e.owner === p).map(e => (e as { text: string }).text);
const shipsOf = (f: Fleet) => new Set(f.ships.map(x => x.id));
/** Battle at region rid this turn: its first round's shots. */
const firstRound = (t: GameState, rid: number) => t.last!.battles.find(b => b.region === rid)!.rounds[0].shots;
/** A neutral colony x with its neighbour y, both empty of garrison: a clean fleet-vs-fleet stage. */
const stage = (seed = 31, rules?: unknown) => {
  const s = game(seed, rules); clearMap(s);
  const x = farColony(s, 2), y = nextTo(s, x.id);
  for (const r of [x, y]) { r.garrison = 0; r.baseGarrison = 0; }
  return { s, x, y };
};

// ============================================================================ fleet postures
describe('postures: Guarded', () => {
  it('called: attacked where it holds, it counts as fortified and fires first', () => {
    const { s, x, y } = stage();
    x.owner = 0;
    const a = fleetAt(s, 0, x.id, ['frigate', 'frigate']);
    const b = fleetAt(s, 1, y.id, ['frigate', 'frigate']);
    const t = resolveTurn(s, subs(s, { 0: [[], [{ type: 'posture', fleet: a.id, posture: 'guarded' }]], 1: [[{ type: 'seize', fleet: b.id, target: x.id }], []] }));
    const ev = pev(t, a.id)[0];
    expect(ev?.outcome).toBe('called');
    expect(ev.posture).toBe('guarded');
    expect(ev.with).toEqual([1]);
    const shots = firstRound(t, x.id);
    const mine = shipsOf(a);
    const firstIdx = shots.findIndex(z => !mine.has(z.from));
    // every first-strike shot is A's, and A's shots all come before B's in round 1
    expect(shots.filter(z => z.first).every(z => mine.has(z.from))).toBe(true);
    expect(shots.slice(firstIdx).some(z => mine.has(z.from))).toBe(false);
    // the posture clears at the end of the turn
    expect(t.fleets.find(f => f.id === a.id)!.posture ?? null).toBeNull();
    // the rival sees CALLED IT in its replay; the third house (no sight of x) does not
    expect(filterResultFor(t, t.last!, 1).events.some(e => e.k === 'posture' && e.fleet === a.id)).toBe(true);
  });

  it('caught: nobody comes, it is dug in and cannot move next turn; it can never attack', () => {
    const { s, x, y } = stage();
    x.owner = 0;
    const a = fleetAt(s, 0, x.id, ['frigate']);
    let t = resolveTurn(s, subs(s, { 0: [[{ type: 'seize', fleet: a.id, target: y.id }], [{ type: 'posture', fleet: a.id, posture: 'guarded' }]] }));
    expect(fails(t, 0).some(f => /Guarded/.test(f))).toBe(true);
    expect(t.regions[y.id].owner).toBeNull();
    const ev = pev(t, a.id)[0];
    expect(ev.outcome).toBe('caught');
    expect(ev.private).toBe(true);
    expect(filterResultFor(t, t.last!, 1).events.some(e => e.k === 'posture')).toBe(false);
    const ta = t.fleets.find(f => f.id === a.id)!;
    expect(ta.dugIn).toBe(t.turn);
    // dug in: secret, and it can't move this turn
    expect(viewFor(t, 1).state.fleets.find(f => f.id === a.id)?.dugIn).toBeUndefined();
    t = resolveTurn(t, subs(t, { 0: [[{ type: 'move', fleet: a.id, path: [y.id] }], []] }));
    expect(fails(t, 0).some(f => /dug in/.test(f))).toBe(true);
    expect(t.fleets.find(f => f.id === a.id)!.region).toBe(x.id);
    expect(t.fleets.find(f => f.id === a.id)!.dugIn ?? null).toBeNull();
  });

  it('Guarded moves one step slower', () => {
    const s = game(); clearMap(s);
    noWells(s);
    const cap = s.players[0].capital;
    const d = bfs(s, cap);
    const far = s.regions.find(r => (d.get(r.id) ?? 0) === 4)!;
    const path: number[] = [];
    for (let cur = far.id; cur !== cap;) { path.unshift(cur); cur = links(s, cur).find(n => d.get(n) === d.get(cur)! - 1)!; }
    const a = fleetAt(s, 0, cap, ['frigate']);
    const b = fleetAt(s, 0, cap, ['frigate']);
    const t = resolveTurn(s, subs(s, { 0: [[{ type: 'move', fleet: a.id, path }, { type: 'move', fleet: b.id, path }], [{ type: 'posture', fleet: a.id, posture: 'guarded' }]] }));
    expect(t.fleets.find(f => f.id === b.id)!.region).toBe(path[fleetSpeed(s, b) - 1]);
    expect(t.fleets.find(f => f.id === a.id)!.region).toBe(path[fleetSpeed(s, a) - 2]);
  });
});

describe('postures: Running', () => {
  const route = () => {
    const s = game(); clearMap(s);
    const cap = s.players[0].capital;
    const d = bfs(s, cap);
    const far = s.regions.find(r => (d.get(r.id) ?? 0) === 5)!;
    const path: number[] = [];
    for (let cur = far.id; cur !== cap;) { path.unshift(cur); cur = links(s, cur).find(n => d.get(n) === d.get(cur)! - 1)!; }
    for (const r of s.regions) if (path.includes(r.id)) { r.owner = null; r.garrison = 0; }
    return { s, cap, path };
  };
  it('called: +2 speed on a clear road (a private CALLED IT)', () => {
    const { s, cap, path } = route();
    const a = fleetAt(s, 0, cap, ['frigate']);
    const t = resolveTurn(s, subs(s, { 0: [[{ type: 'move', fleet: a.id, path }], [{ type: 'posture', fleet: a.id, posture: 'running' }]] }));
    expect(t.fleets.find(f => f.id === a.id)!.region).toBe(path[fleetSpeed(s, a) + 2 - 1]);
    const ev = pev(t, a.id)[0];
    expect(ev.outcome).toBe('called');
    expect(ev.private).toBe(true);
  });
  it('caught: engaged on the way, it cannot fire its first round and takes +50% damage', () => {
    const { s, cap, path } = route();
    const a = fleetAt(s, 0, cap, ['frigate', 'frigate']);
    const b = fleetAt(s, 1, path[1], ['frigate', 'frigate']);
    const t = resolveTurn(s, subs(s, { 0: [[{ type: 'move', fleet: a.id, path }], [{ type: 'posture', fleet: a.id, posture: 'running' }]] }));
    expect(t.fleets.find(f => f.id === a.id)?.region ?? path[1]).toBe(path[1]);
    expect(pev(t, a.id)[0].outcome).toBe('caught');
    const shots = firstRound(t, path[1]);
    const mine = shipsOf(a);
    expect(shots.some(z => mine.has(z.from))).toBe(false);
    // every hit on A is ceil(x * 1.5) of what B's frigates do (3 attack - 1 shield = 2 → 3)
    for (const z of shots.filter(z => mine.has(z.to) && z.dmg > 0)) expect(z.dmg).toBe(3);
    void b;
  });
});

describe('postures: Charge', () => {
  const siege = (brace: number) => {
    const { s, x, y } = stage(31, { signature: { neutralBraceChance: brace } });
    x.garrison = 30; x.baseGarrison = 30;
    const a = fleetAt(s, 0, y.id, ['frigate', 'frigate', 'frigate']);
    const t = resolveTurn(s, subs(s, { 0: [[{ type: 'seize', fleet: a.id, target: x.id }], [{ type: 'posture', fleet: a.id, posture: 'charge' }]] }));
    return { s, t, a, x };
  };
  it('called (the defender is not braced): first strike and extra damage in the opening rounds', () => {
    const { t, a, x } = siege(0);
    expect(pev(t, a.id)[0].outcome).toBe('called');
    const shots = firstRound(t, x.id);
    const mine = shipsOf(a);
    expect(shots.filter(z => z.first).length).toBeGreaterThan(0);
    expect(shots.filter(z => z.first).every(z => mine.has(z.from))).toBe(true);
  });
  it('caught (a neutral garrison braced): the charge breaks, the garrison fires first and A loses its first round', () => {
    const { t, a, x } = siege(1);
    const ev = pev(t, a.id)[0];
    expect(ev.outcome).toBe('caught');
    const shots = firstRound(t, x.id);
    expect(shots.some(z => shipsOf(a).has(z.from))).toBe(false);
    expect(shots.filter(z => z.first).every(z => z.from === -x.id - 1)).toBe(true);
  });
  it('Guarded beats Charge: the guarded defender calls it, the charger is caught out', () => {
    const { s, x, y } = stage();
    x.owner = 1;
    const a = fleetAt(s, 0, y.id, ['frigate', 'frigate']);
    const b = fleetAt(s, 1, x.id, ['frigate', 'frigate']);
    const t = resolveTurn(s, subs(s, {
      0: [[{ type: 'seize', fleet: a.id, target: x.id }], [{ type: 'posture', fleet: a.id, posture: 'charge' }]],
      1: [[], [{ type: 'posture', fleet: b.id, posture: 'guarded' }]],
    }));
    expect(pev(t, a.id)[0].outcome).toBe('caught');
    expect(pev(t, b.id)[0].outcome).toBe('called');
    const shots = firstRound(t, x.id);
    expect(shots.some(z => shipsOf(a).has(z.from) && z.first)).toBe(false);
  });
  it('Charge beats Steady: against an unbraced fleet it strikes first', () => {
    const { s, x, y } = stage();
    x.owner = 1;
    const a = fleetAt(s, 0, y.id, ['frigate', 'frigate']);
    const b = fleetAt(s, 1, x.id, ['frigate', 'frigate']);
    const t = resolveTurn(s, subs(s, { 0: [[{ type: 'seize', fleet: a.id, target: x.id }], [{ type: 'posture', fleet: a.id, posture: 'charge' }]] }));
    expect(pev(t, a.id)[0].outcome).toBe('called');
    const shots = firstRound(t, x.id);
    expect(shots.filter(z => z.first).every(z => shipsOf(a).has(z.from))).toBe(true);
    void b;
  });
  it('Call the Levies braces a garrison: a charge on it breaks', () => {
    const { s, x, y } = stage(31, { signature: { neutralBraceChance: 0 } });
    x.owner = 1; x.garrison = 20;
    const a = fleetAt(s, 0, y.id, ['frigate', 'frigate', 'frigate']);
    const t = resolveTurn(s, subs(s, {
      0: [[{ type: 'seize', fleet: a.id, target: x.id }], [{ type: 'posture', fleet: a.id, posture: 'charge' }]],
      1: [[], [{ type: 'wposture', region: x.id, posture: 'levies' }]],
    }));
    expect(pev(t, a.id)[0].outcome).toBe('caught');
    expect(pev(t).find(e => e.posture === 'levies')!.outcome).toBe('called');
    const shots = firstRound(t, x.id);
    expect(shots.some(z => shipsOf(a).has(z.from))).toBe(false);
    expect(shots.filter(z => z.first).every(z => z.from === -x.id - 1)).toBe(true);
  });
  it('a Charge without a Seize falls back to Steady', () => {
    const { s, x } = stage();
    const a = fleetAt(s, 0, x.id, ['frigate']);
    const t = resolveTurn(s, subs(s, { 0: [[], [{ type: 'posture', fleet: a.id, posture: 'charge' }]] }));
    expect(fails(t, 0).some(f => /Charge needs a Seize/.test(f))).toBe(true);
    expect(pev(t, a.id).length).toBe(0);
  });
});

describe('postures: Ambush', () => {
  /** p1 lies in wait at a lane waypoint (or a colony) on p0's road. */
  const road = () => {
    const s = game(); clearMap(s);
    const lane = s.regions.find(r => r.kind === 'lane' && s.regions[r.lane!.a].kind === 'colony' && s.regions[r.lane!.b].kind === 'colony')!;
    const path = lane.lane!.n === 1 ? [lane.id, lane.lane!.b] : null;
    expect(path).toBeTruthy();
    for (const id of [lane.lane!.a, lane.lane!.b]) { s.regions[id].owner = null; s.regions[id].garrison = 0; s.regions[id].baseGarrison = 0; }
    return { s, lane, from: lane.lane!.a, path: path! };
  };
  it('called: a hostile fleet coming through is stopped at the waypoint, and the ambusher strikes first', () => {
    const { s, lane, from, path } = road();
    const a = fleetAt(s, 0, from, ['frigate', 'frigate']);
    const b = fleetAt(s, 1, lane.id, ['frigate', 'frigate']);
    // the ambusher is hidden from p0 even right next door (p0's fleet is adjacent), unless scanned
    b.posture = 'ambush';
    expect(viewFor(s, 0).state.fleets.some(f => f.id === b.id)).toBe(false);
    s.scans.push({ owner: 0, region: lane.id, until: s.turn + 1 });
    expect(viewFor(s, 0).state.fleets.find(f => f.id === b.id)?.posture).toBe('ambush');
    s.scans = [];
    b.posture = null;
    const t = resolveTurn(s, subs(s, {
      0: [[{ type: 'move', fleet: a.id, path }], [{ type: 'posture', fleet: a.id, posture: 'running' }]],
      1: [[], [{ type: 'posture', fleet: b.id, posture: 'ambush' }]],
    }));
    // Ambush beats Running
    expect(pev(t, b.id)[0].outcome).toBe('called');
    expect(pev(t, a.id)[0].outcome).toBe('caught');
    const ta = t.fleets.find(f => f.id === a.id);
    if (ta) expect(ta.region).not.toBe(path[1]);
    const shots = firstRound(t, lane.id);
    expect(shots.filter(z => z.first).length).toBeGreaterThan(0);
    expect(shots.filter(z => z.first).every(z => shipsOf(b).has(z.from))).toBe(true);
    expect(shots.some(z => shipsOf(a).has(z.from))).toBe(false);   // Running caught: no first-round fire
    expect(t.soul!.herald.at(-1)!.headlines.some(h => h.kind === 'p_ambush') || t.soul!.moments.some(h => h.kind === 'p_ambush')).toBe(true);
  });
  it('caught (not coming beats Ambush): exposed to every house and fatigued next turn', () => {
    const { s, lane } = road();
    const b = fleetAt(s, 1, lane.id, ['frigate', 'frigate']);
    const t = resolveTurn(s, subs(s, { 1: [[], [{ type: 'posture', fleet: b.id, posture: 'ambush' }]] }));
    const ev = pev(t, b.id)[0];
    expect(ev.outcome).toBe('caught');
    expect(ev.public).toBe(true);
    const tb = t.fleets.find(f => f.id === b.id)!;
    expect(tb.exposed).toBe(t.turn);
    // seen by every house (even with no sensors near) this turn
    for (const p of [0, 2]) expect(viewFor(t, p).state.fleets.some(f => f.id === b.id)).toBe(true);
    expect(filterResultFor(t, t.last!, 2).events.some(e => e.k === 'posture' && e.fleet === b.id)).toBe(true);
    const t2 = resolveTurn(t, idle(t));
    expect(t2.fleets.find(f => f.id === b.id)!.exposed ?? null).toBeNull();
  });
  it('an Ambush must lie still: with a move order it falls back to Steady', () => {
    const { s, lane, path } = road();
    const b = fleetAt(s, 1, lane.id, ['frigate']);
    const t = resolveTurn(s, subs(s, { 1: [[{ type: 'move', fleet: b.id, path: [path[1]] }], [{ type: 'posture', fleet: b.id, posture: 'ambush' }]] }));
    expect(fails(t, 1).some(f => /Ambush must lie still/.test(f))).toBe(true);
  });
  it('the ambusher stops even a Hyperjump (which slips through ordinary blockades)', () => {
    const { s, lane, from, path } = road();
    s.players[0].fate = 3;
    const a = fleetAt(s, 0, from, ['frigate']);
    const b = fleetAt(s, 1, lane.id, ['frigate', 'frigate']);
    const t = resolveTurn(s, subs(s, {
      0: [[{ type: 'move', fleet: a.id, path }], [{ type: 'fate', use: 'hyperjump', fleet: a.id }]],
      1: [[], [{ type: 'posture', fleet: b.id, posture: 'ambush' }]],
    }));
    expect(pev(t, b.id)[0].outcome).toBe('called');
    expect(t.fleets.find(f => f.id === a.id)?.region).not.toBe(path[1]);
  });
});

describe('postures: rules, limits and fog', () => {
  it('one posture per fleet per turn; limping fleets only Steady/Running; postures off in old rules', () => {
    const { s, x } = stage();
    const a = fleetAt(s, 0, x.id, ['frigate']);
    const t = resolveTurn(s, subs(s, { 0: [[], [{ type: 'posture', fleet: a.id, posture: 'guarded' }, { type: 'posture', fleet: a.id, posture: 'running' }]] }));
    expect(fails(t, 0).some(f => /already took a posture/.test(f))).toBe(true);
    a.limping = { since: 1, to: s.players[0].capital, by: 1 };
    expect(postureBlock(s, 0, a, 'guarded')).toMatch(/limping/);
    expect(postureBlock(s, 0, a, 'running')).toBeNull();
    expect(postureBlock(s, 1, a, 'running')).toMatch(/no such fleet/);
    const old = game(31, { signature: { enabled: false } });
    expect(postureBlock(old, 0, old.fleets[0], 'guarded')).toMatch(/off/);
    expect(fateBlock(old, 0, 'surge', undefined, old.players[0].capital)).toMatch(/off/);
  });
  it('rival postures are secret unless a fleet shares the system or a scan covers it', () => {
    const { s, x, y } = stage();
    const a = fleetAt(s, 0, x.id, ['frigate']);
    a.posture = 'guarded'; a.postureFx = { turn: s.turn, set: true }; a.dugIn = s.turn;
    const watcher = fleetAt(s, 1, y.id, ['scout']);
    let v = viewFor(s, 1).state.fleets.find(f => f.id === a.id)!;
    expect(v).toBeTruthy();
    expect(v.posture).toBeUndefined();
    expect(v.postureFx).toBeUndefined();
    expect(v.dugIn).toBeUndefined();
    watcher.region = x.id;
    s.pacts.push({ a: 0, b: 1, until: 99 });
    v = viewFor(s, 1).state.fleets.find(f => f.id === a.id)!;
    expect(v.posture).toBe('guarded');
    // the owner always sees its own
    expect(viewFor(s, 0).state.fleets.find(f => f.id === a.id)!.posture).toBe('guarded');
  });
  it('posture beats doctrine stance: a Guarded/Charging/Ambushing fleet never acts Evasive', () => {
    const { s, x } = stage();
    const a = fleetAt(s, 0, x.id, ['frigate']);
    a.doctrine.stance = 'evasive';
    expect(effStance(s, a)).toBe('evasive');
    a.posture = 'guarded'; expect(effStance(s, a)).toBe('defensive');
    a.posture = 'ambush'; expect(effStance(s, a)).toBe('aggressive');
    a.posture = 'running'; expect(effStance(s, a)).toBe('evasive');
  });
  it('cleanFree keeps only well-formed signature actions', () => {
    expect(cleanFree({ type: 'posture', fleet: 3, posture: 'ambush', junk: 1 })).toEqual({ type: 'posture', fleet: 3, posture: 'ambush' });
    expect(cleanFree({ type: 'posture', fleet: 3, posture: 'yolo' })).toBeNull();
    expect(cleanFree({ type: 'posture', fleet: -1, posture: 'steady' })).toBeNull();
    expect(cleanFree({ type: 'wposture', region: 2, posture: 'scorch' })).toEqual({ type: 'wposture', region: 2, posture: 'scorch' });
    expect(cleanFree({ type: 'wposture', region: 'x', posture: 'scorch' })).toBeNull();
    expect(cleanFree({ type: 'fate', use: 'surge', region: 4 })).toEqual({ type: 'fate', use: 'surge', region: 4 });
    expect(cleanFree({ type: 'fate', use: 'laststand', fleet: 9, region: 'no' })).toBeNull();
    expect(cleanFree({ type: 'fate', use: '__proto__' })).toBeNull();
  });
  it('LIVE: a posture lasts the whole cycle and clears when it ends', () => {
    let s = makeLive(game(), 0, 360);
    const f = s.fleets.find(x => x.owner === 0 && x.banner)!;
    expect(queueFree(s, 0, { type: 'posture', fleet: f.id, posture: 'guarded' })).toBeNull();
    s = runTick(s, () => false);
    expect(s.fleets.find(x => x.id === f.id)!.posture).toBe('guarded');
    expect(queueFree(s, 0, { type: 'posture', fleet: f.id, posture: 'running' })).toMatch(/already/);
    const per = s.rules.live.ticksPerCycle;
    for (let i = 1; i < per - 1; i++) { s = runTick(s, () => false); expect(s.fleets.find(x => x.id === f.id)!.posture).toBe('guarded'); }
    s = runTick(s, () => false);
    expect(s.fleets.find(x => x.id === f.id)!.posture ?? null).toBeNull();
    expect(s.fleets.find(x => x.id === f.id)!.dugIn).toBe(s.turn);
  });
});

// ============================================================================ world postures
describe('world postures', () => {
  it('Call the Levies, called: the garrison rises ×1.5 the moment the assault lands', () => {
    const { s, x, y } = stage();
    x.owner = 1; x.garrison = 20;
    const a = fleetAt(s, 0, y.id, ['frigate', 'frigate']);
    const t = resolveTurn(s, subs(s, { 0: [[{ type: 'seize', fleet: a.id, target: x.id }], []], 1: [[], [{ type: 'wposture', region: x.id, posture: 'levies' }]] }));
    const ev = pev(t).find(e => e.posture === 'levies')!;
    expect(ev.outcome).toBe('called');
    const side = t.last!.battles.find(b => b.region === x.id)!.sides.find(z => z.garrison)!;
    expect(side.garrison!.maxHp).toBe(30);
    expect(t.regions[x.id].idleUntil ?? null).toBeNull();
  });
  it('Call the Levies, caught: no assault, the system yields nothing this turn and next (secret)', () => {
    const s = game(); clearMap(s);
    const cap = s.players[0].capital;
    const before = incomeDetail(s, 0).total.industry;
    const t = resolveTurn(s, subs(s, { 0: [[], [{ type: 'wposture', region: cap, posture: 'levies' }]] }));
    expect(pev(t).find(e => e.posture === 'levies')!.outcome).toBe('caught');
    expect(t.regions[cap].idleUntil).toBe(t.turn);
    expect(incomeDetail(t, 0).total.industry).toBeLessThan(before);
    expect(viewFor(t, 1).state.regions[cap].idleUntil).toBeUndefined();
    const t2 = resolveTurn(t, idle(t));
    expect(t2.regions[cap].idleUntil ?? null).toBeNull();
    expect(incomeDetail(t2, 0).total.industry).toBe(before);
  });
  it('Scorched Earth, called: the conqueror takes nothing (no loot, nothing to raze, the calling is gone)', () => {
    const { s, x, y } = stage();
    x.owner = 1; x.garrison = 0; x.dev = 3;
    x.story!.calling = { id: 'granary', since: 1 };
    const a = fleetAt(s, 0, y.id, ['frigate', 'frigate']);
    a.banner!.boons = ['raiders'];
    const t = resolveTurn(s, subs(s, { 0: [[{ type: 'seize', fleet: a.id, target: x.id }], []], 1: [[], [{ type: 'wposture', region: x.id, posture: 'scorch' }]] }));
    expect(t.regions[x.id].owner).toBe(0);
    const ev = pev(t).find(e => e.posture === 'scorch')!;
    expect(ev.outcome).toBe('called');
    expect(ev.public).toBe(true);
    expect(t.regions[x.id].story!.calling).toBeNull();
    expect(t.regions[x.id].story!.captured ?? null).toBeNull();
    // raiders' capture loot: none
    expect((t.fleets.find(f => f.id === a.id)!.saga ?? []).some(b => b.kind === 'loot')).toBe(false);
    expect(t.last!.events.some(e => e.k === 'soul' && /razes/.test(e.text))).toBe(false);
  });
  it('Scorched Earth, caught: held anyway, development −1 for nothing', () => {
    const s = game(); clearMap(s);
    const cap = s.players[0].capital;
    const dev = s.regions[cap].dev;
    const t = resolveTurn(s, subs(s, { 0: [[], [{ type: 'wposture', region: cap, posture: 'scorch' }]] }));
    expect(pev(t).find(e => e.posture === 'scorch')!.outcome).toBe('caught');
    expect(t.regions[cap].dev).toBe(dev - 1);
  });
  it('Open the Gates: a pact ally repairs as at its own yard; a non-ally arriving finds the garrison holding fire', () => {
    const { s, x, y } = stage();
    x.owner = 1; x.garrison = 20;
    s.pacts.push({ a: 1, b: 2, until: 99 });
    const ally = fleetAt(s, 2, x.id, ['frigate']);
    ally.ships[0].hp = 2;
    let t = resolveTurn(s, subs(s, { 1: [[], [{ type: 'wposture', region: x.id, posture: 'gates' }]] }));
    expect(pev(t).find(e => e.posture === 'gates')!.outcome).toBe('called');
    expect(t.fleets.find(f => f.id === ally.id)!.ships[0].hp).toBe(Math.min(t.fleets.find(f => f.id === ally.id)!.ships[0].maxHp, 2 + s.rules.economy.shipRepairPerTurn + s.rules.economy.shipyardRepairBonus));
    t.fleets = t.fleets.filter(f => f.owner !== 2);
    const a = fleetAt(t, 0, y.id, ['frigate', 'frigate']);
    const t2 = resolveTurn(t, subs(t, { 0: [[{ type: 'seize', fleet: a.id, target: x.id }], []], 1: [[], [{ type: 'wposture', region: x.id, posture: 'gates' }]] }));
    expect(pev(t2).find(e => e.posture === 'gates')!.outcome).toBe('caught');
    expect(firstRound(t2, x.id).some(z => z.from === -x.id - 1)).toBe(false);
  });
  it('world postures: own systems only, one per system per turn', () => {
    const s = game();
    const cap = s.players[0].capital;
    expect(wpostureBlock(s, 1, cap, 'levies')).toMatch(/not your/);
    expect(wpostureBlock(s, 0, cap, 'nope')).toMatch(/unknown/);
    const t = resolveTurn(s, subs(s, { 0: [[], [{ type: 'wposture', region: cap, posture: 'levies' }, { type: 'wposture', region: cap, posture: 'gates' }]] }));
    expect(fails(t, 0).some(f => /already took a posture/.test(f))).toBe(true);
  });
});

// ============================================================================ Fate
describe('Fate', () => {
  it('three tokens; spending one is public (event + Herald); limits per turn, per battle, and none left', () => {
    const s = game();
    expect(fateLeft(s, 0)).toBe(3);
    const cap = s.players[0].capital;
    const t = resolveTurn(s, subs(s, { 0: [[], [{ type: 'fate', use: 'surge', region: cap }, { type: 'fate', use: 'surge', region: s.regions.find(r => r.owner === 0 && r.id !== cap)?.id ?? cap }]] }));
    expect(t.players[0].fate).toBe(2);
    expect(fails(t, 0).some(f => /Fate per turn|already surges/.test(f))).toBe(true);
    for (const p of [1, 2]) expect(filterResultFor(t, t.last!, p).events.some(e => e.k === 'fate' && e.owner === 0)).toBe(true);
    expect(t.soul!.herald.at(-1)!.headlines.some(h => h.kind === 'fate')).toBe(true);
    t.players[0].fate = 0;
    expect(fateBlock(t, 0, 'surge', undefined, cap)).toMatch(/no Fate left/);
  });
  it('Surge: double output this turn and the project leaps a turn ahead', () => {
    const s = game(); clearMap(s);
    const cap = s.players[0].capital;
    s.regions[cap].project = { key: 'mine', progress: 0, owner: 0 };
    const base = incomeDetail(s, 0).total.industry;
    const capInd = (() => { const t0 = structuredClone(s); for (const r of t0.regions) if (r.id !== cap && r.owner === 0) r.owner = null; return incomeDetail(t0, 0).total.industry; })();
    const ind0 = s.players[0].res.industry;
    const t = resolveTurn(s, subs(s, { 0: [[], [{ type: 'fate', use: 'surge', region: cap }]] }));
    expect(t.players[0].res.industry - ind0).toBe(base + capInd);
    expect(t.regions[cap].buildings.mine).toBe(1);   // 1-turn project: leapt ahead and finished
    expect(t.regions[cap].surge ?? null).toBeNull();
  });
  it('Hyperjump: +3 steps, and it slips through a blockade', () => {
    const s = game(); clearMap(s);
    noWells(s);
    const cap = s.players[0].capital;
    const d = bfs(s, cap);
    const far = s.regions.find(r => (d.get(r.id) ?? 0) === 6)!;
    const path: number[] = [];
    for (let cur = far.id; cur !== cap;) { path.unshift(cur); cur = links(s, cur).find(n => d.get(n) === d.get(cur)! - 1)!; }
    for (const r of s.regions) if (path.includes(r.id)) { r.owner = null; r.garrison = 0; }
    const a = fleetAt(s, 0, cap, ['frigate']);
    fleetAt(s, 1, path[0], ['corvette']);   // a blockade one step out
    const t = resolveTurn(s, subs(s, { 0: [[{ type: 'move', fleet: a.id, path }], [{ type: 'fate', use: 'hyperjump', fleet: a.id }]] }));
    expect(t.fleets.find(f => f.id === a.id)!.region).toBe(path[fleetSpeed(s, a) + 3 - 1]);
  });
  it('Last Stand: it never leaves the battle (not even forced) and dies rather than rout', () => {
    const { s, x } = stage();
    const a = fleetAt(s, 0, x.id, ['frigate', 'frigate']);
    const b = fleetAt(s, 1, x.id, ['frigate', 'frigate', 'frigate', 'frigate', 'frigate']);
    for (const sh of a.ships) sh.sys.weapons = false;
    a.doctrine.retreatAt = 0.9;
    s.engagements.push({ id: 999, region: x.id, name: 'Test', startedTurn: 0, startedPulse: 1, rounds: 20, forceAt: 1, startHp: { [a.id]: 28, [b.id]: 70 }, fleets: [a.id, b.id], owners: [0, 1], hulls: { 0: 2, 1: 5 }, cmds: {}, losses: {}, lastStand: [], firstBlood: true, garrisonStart: 0 });
    const t = resolveTurn(s, subs(s, { 0: [[], [{ type: 'fate', use: 'laststand', fleet: a.id }]] }));
    expect(t.last!.events.some(e => (e.k === 'retreat' || e.k === 'rout') && e.fleet === a.id)).toBe(false);
    const ta = t.fleets.find(f => f.id === a.id);
    if (ta) expect(ta.region).toBe(x.id);
    expect(t.engagements.find(e => e.region === x.id)?.fate ?? [0]).toContain(0);
    // one battle Fate per side per engagement
    if (ta && t.engagements.some(e => e.region === x.id)) expect(fateBlock(t, 0, 'twist', a.id)).toMatch(/one Fate per battle/);
  });
  it('Twist of Fate: the worst enemy volley in its first exchange misses', () => {
    const { s, x } = stage();
    const a = fleetAt(s, 0, x.id, ['frigate', 'frigate']);
    fleetAt(s, 1, x.id, ['frigate', 'frigate', 'frigate']);
    const t = resolveTurn(s, subs(s, { 0: [[], [{ type: 'fate', use: 'twist', fleet: a.id }]] }));
    const shots = t.last!.battles.find(b => b.region === x.id)!.rounds.flatMap(r => r.shots);
    const tw = shots.filter(z => z.twist);
    expect(tw.length).toBeGreaterThan(0);
    expect(tw.every(z => z.dmg === 0 && shipsOf(a).has(z.to))).toBe(true);
    expect(new Set(tw.map(z => z.from)).size).toBe(1);
  });
  it('Rally: a Limping fleet repairs to 60% where it stands and stops limping', () => {
    const { s, x } = stage();
    const a = fleetAt(s, 0, x.id, ['frigate', 'frigate']);
    a.limping = { since: 1, to: s.players[0].capital, by: 1 };
    for (const sh of a.ships) sh.hp = 2;
    expect(fateBlock(s, 0, 'rally', fleetAt(s, 0, x.id, ['frigate']).id)).toMatch(/Limping/);
    const t = resolveTurn(s, subs(s, { 0: [[], [{ type: 'fate', use: 'rally', fleet: a.id }]] }));
    const ta = t.fleets.find(f => f.id === a.id)!;
    expect(ta.limping ?? null).toBeNull();
    for (const sh of ta.ships) expect(sh.hp).toBeGreaterThanOrEqual(Math.ceil(sh.maxHp * 0.6));
    expect(ta.region).toBe(x.id);
  });
  it('a house 10+ VP behind the leader gets a 4th token, once', () => {
    const s = game();
    s.players[1].vp = 12;
    let t = resolveTurn(s, idle(s));
    expect(t.players[0].fate).toBe(4);
    expect(t.players[2].fate).toBe(4);
    expect(t.players[1].fate).toBe(3);
    expect(t.last!.events.some(e => e.k === 'fate' && e.use === 'bonus')).toBe(true);
    t = resolveTurn(t, idle(t));
    expect(t.players[0].fate).toBe(4);
  });
  it('old saves: no fate field, no signature rules — loads and resolves', () => {
    const s = game();
    for (const p of s.players) delete p.fate;
    const t = resolveTurn(s, idle(s));
    expect(t.players[0].fate).toBe(SG(t).fateStart);
    const old = game(31, {});
    delete (old.rules as { signature?: unknown }).signature;
    for (const p of old.players) delete p.fate;
    const t2 = resolveTurn(old, idle(old));
    expect(t2.players[0].fate).toBeUndefined();
    expect(fateLeft(t2, 0)).toBe(0);
  });
});

// ============================================================================ determinism & AI
describe('signature: determinism and the AI', () => {
  const play = (levels: ('novice' | 'standard' | 'expert')[], turns: number, seed = 77) => {
    let s = createGame({ seed, players: levels.map(l => ({ kind: 'ai' as const, aiLevel: l })) });
    const evs: GameEvent[] = [];
    for (let i = 0; i < turns && s.winner === null; i++) {
      const sb: Record<number, Submission> = {};
      for (const p of s.players) sb[p.id] = planTurn(s, p.id);
      s = resolveTurn(s, sb);
      evs.push(...s.last!.events);
    }
    return { s, evs };
  };
  it('AI-vs-AI games with postures and Fate are deterministic', () => {
    const a = play(['expert', 'standard', 'novice'], 10);
    const b = play(['expert', 'standard', 'novice'], 10);
    expect(JSON.stringify(a.s)).toBe(JSON.stringify(b.s));
  });
  it('the AI only takes legal postures, world postures and Fates (no failures), and uses them', () => {
    const { s, evs } = play(['expert', 'standard', 'novice'], 18, 91);
    const bad = evs.filter(e => e.k === 'fail' && /Posture|posture|Fate|wposture|fate/.test(e.text));
    expect(bad.map(e => (e as { text: string }).text)).toEqual([]);
    const free = s.log.flatMap(l => Object.values(l.submissions).flatMap(x => x.free));
    expect(free.some(f => f.type === 'posture')).toBe(true);
    for (const f of free) if (f.type === 'posture') expect(['steady', 'guarded', 'running', 'charge', 'ambush']).toContain(f.posture);
  });
});
