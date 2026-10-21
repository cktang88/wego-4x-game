// Bug sweep: signature mechanics (postures, world postures, Fate) and combat edge cases.
import { describe, expect, it } from 'vitest';
import { createGame, newFleet, newShip } from '../shared/sim/setup.ts';
import { resolveTurn, emptySubmission } from '../shared/sim/resolve.ts';
import { Rng } from '../shared/sim/rng.ts';
import { makeLive, runTick, queueFree, queueOrder } from '../shared/sim/live.ts';
import { sigFree } from '../shared/sim/ai-signature.ts';
import type { Fleet, FreeAction, GameEvent, GameState, Order, Submission } from '../shared/sim/types.ts';

const game = (seed = 31, rules?: unknown) => createGame({ seed, rules, players: [0, 1, 2].map(() => ({ kind: 'human' as const })) });
const idle = (s: GameState): Record<number, Submission> => Object.fromEntries(s.players.map(p => [p.id, emptySubmission(s)]));
const subs = (s: GameState, by: Record<number, [Order[], FreeAction[]]>) => {
  const out = idle(s);
  for (const [k, [orders, free]] of Object.entries(by)) { orders.forEach((o, i) => { out[Number(k)].orders[i] = o; }); out[Number(k)].free = free; }
  return out;
};
const links = (s: GameState, id: number) => s.regions[id].links ?? s.regions[id].neighbors;
const rng = new Rng(7);
const fleetAt = (s: GameState, owner: number, region: number, classes: string[]): Fleet => {
  const f = newFleet(s, rng, owner, region);
  for (const c of classes) f.ships.push(newShip(s, rng, c, owner));
  f.bornTurn = 0;
  f.doctrine = { stance: 'aggressive', retreatAt: 0, target: 'weakest', guard: false };
  for (const sh of f.ships) sh.traits = [];
  return f;
};
const clearMap = (s: GameState) => { s.fleets = s.fleets.filter(f => f.owner < 0); };
const pev = (t: GameState) => (t.last?.events ?? []).filter((e): e is Extract<GameEvent, { k: 'posture' }> => e.k === 'posture');
const bfs = (s: GameState, from: number) => {
  const d = new Map([[from, 0]]); const q = [from];
  while (q.length) { const r = q.shift()!; for (const n of links(s, r)) if (!d.has(n)) { d.set(n, d.get(r)! + 1); q.push(n); } }
  return d;
};
/** Two directly linked neutral colonies, at least 2 steps from every capital. */
const pair = (s: GameState) => {
  const ds = s.players.map(p => bfs(s, p.capital));
  const x = s.regions.find(r => r.owner === null && r.kind === 'colony' && ds.every(d => (d.get(r.id) ?? 99) >= 2) && links(s, r.id).some(n => s.regions[n].kind === 'colony' && s.regions[n].owner === null))!;
  if (!x) return null;
  const y = s.regions[links(s, x.id).find(n => s.regions[n].kind === 'colony' && s.regions[n].owner === null)!];
  return { x, y };
};

describe('sweep: world postures', () => {
  it('Call the Levies in vain loses this turn\'s output too (not only next turn\'s)', () => {
    const s = game(); clearMap(s);
    const cap = s.players[0].capital;
    const ind0 = s.players[0].res.industry;
    const plain = resolveTurn(structuredClone(s), idle(s));
    const lev = resolveTurn(structuredClone(s), subs(s, { 0: [[], [{ type: 'wposture', region: cap, posture: 'levies' }]] }));
    expect(pev(lev).find(e => e.posture === 'levies')!.outcome).toBe('caught');
    expect(lev.players[0].res.industry - ind0).toBeLessThan(plain.players[0].res.industry - ind0);
  });

  it('a border clash is not the assault the Levies were called for (nor the wrong guests at open Gates)', () => {
    for (const kind of ['levies', 'gates'] as const) {
      const s = game(); clearMap(s);
      const { x, y } = pair(s)!;
      x.owner = 1; x.garrison = 20; y.garrison = 0;
      const a = fleetAt(s, 0, y.id, ['frigate']);
      const b = fleetAt(s, 1, x.id, ['frigate']);
      // head-on: A heads for x, B for y; they clash on the border and both stop
      const t = resolveTurn(s, subs(s, { 0: [[{ type: 'move', fleet: a.id, path: [x.id] }], []], 1: [[{ type: 'move', fleet: b.id, path: [y.id] }], [{ type: 'wposture', region: x.id, posture: kind }]] }));
      expect(t.last!.events.some(e => e.k === 'clash')).toBe(true);
      expect(t.fleets.find(f => f.id === a.id)?.region ?? y.id).toBe(y.id);
      const ev = pev(t).find(e => e.posture === kind)!;
      expect(ev.outcome).not.toBe(kind === 'levies' ? 'called' : 'caught');
      if (kind === 'levies') expect(t.regions[x.id].garrison).toBeLessThanOrEqual(20);
    }
  });
});

describe('sweep: Twist of Fate', () => {
  it('a ship that dies anyway still has its killing shot recorded (kill credit is not lost or misassigned)', () => {
    let checked = 0;
    for (let seed = 1; seed <= 40; seed++) {
      // every shot fires and nearly every shot hits: several hits land on A's lone ship in one exchange
      const s = game(seed, { combat: { lethality: 1, baseHit: 0.95 } }); clearMap(s);
      const pr = pair(s);
      if (!pr) continue;
      const { x } = pr;
      x.garrison = 0;
      const a = fleetAt(s, 0, x.id, ['frigate']);
      a.ships[0].hp = 1;
      const b1 = fleetAt(s, 1, x.id, ['frigate', 'frigate', 'frigate']);
      const b2 = fleetAt(s, 1, x.id, ['frigate', 'frigate', 'frigate']);
      for (const f of [b1, b2]) for (const sh of f.ships) sh.sys.shields = false;
      const t = resolveTurn(s, subs(s, { 0: [[], [{ type: 'fate', use: 'twist', fleet: a.id }]] }));
      const shots = t.last!.battles.find(b => b.region === x.id)?.rounds.flatMap(r => r.shots) ?? [];
      if (!shots.some(z => z.twist)) continue;
      const dead = !t.fleets.some(f => f.id === a.id);
      if (!dead) continue;
      checked++;
      const sid = a.ships[0].id;
      const kills = shots.filter(z => z.to === sid && z.kill);
      expect(kills.length, `seed ${seed}`).toBe(1);
      expect(kills[0].twist, `seed ${seed}`).toBeFalsy();
      expect(kills[0].dmg, `seed ${seed}`).toBeGreaterThan(0);
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('sweep: first strike in a three-way battle', () => {
  it('only the defenders who braced get the free first volley of a broken Charge, not a third house', () => {
    let tested = 0;
    for (let seed = 31; seed < 60 && tested < 3; seed++) {
      const s = game(seed); clearMap(s);
      const pr = pair(s);
      if (!pr) continue;
      const { x, y } = pr;
      const z = links(s, x.id).map(n => s.regions[n]).find(r => r.id !== y.id && r.kind !== 'lane' && r.owner === null);
      if (!z) continue;
      for (const r of [x, y, z]) { r.garrison = 0; r.baseGarrison = 0; }
      x.owner = 1;
      const b = fleetAt(s, 1, x.id, ['frigate', 'frigate']);
      const a = fleetAt(s, 0, y.id, ['frigate', 'frigate']);
      const c = fleetAt(s, 2, z.id, ['frigate', 'frigate']);
      const t = resolveTurn(s, subs(s, {
        0: [[{ type: 'seize', fleet: a.id, target: x.id }], [{ type: 'posture', fleet: a.id, posture: 'charge' }]],
        1: [[], [{ type: 'posture', fleet: b.id, posture: 'guarded' }]],
        2: [[{ type: 'move', fleet: c.id, path: [x.id] }], []],
      }));
      const ev = pev(t).find(e => e.fleet === a.id);
      if (ev?.outcome !== 'caught') continue;
      tested++;
      const shots = t.last!.battles.find(bt => bt.region === x.id)!.rounds[0].shots;
      const cs = new Set(c.ships.map(sh => sh.id)), bs = new Set(b.ships.map(sh => sh.id));
      expect(shots.some(q => q.first && bs.has(q.from))).toBe(true);
      expect(shots.some(q => q.first && cs.has(q.from))).toBe(false);
    }
    expect(tested).toBeGreaterThan(0);
  });
});

describe('sweep: Hyperjump vs a black hole and an Ambush (WEGO and LIVE)', () => {
  const road = (s: GameState, len: number) => {
    for (const r of s.regions) if (r.star === 'blackhole') r.star = 'pulsar';
    const cap = s.players[0].capital;
    const d = bfs(s, cap);
    const far = s.regions.find(r => (d.get(r.id) ?? 0) === len)!;
    const path: number[] = [];
    for (let cur = far.id; cur !== cap;) { path.unshift(cur); cur = links(s, cur).find(n => d.get(n) === d.get(cur)! - 1)!; }
    for (const r of s.regions) if (path.includes(r.id)) { r.owner = null; r.garrison = 0; }
    return { cap, path };
  };
  it('WEGO: a black hole on the road holds even a Hyperjump', () => {
    const s = game(); clearMap(s);
    const { cap, path } = road(s, 6);
    s.regions[path[1]].star = 'blackhole';
    const a = fleetAt(s, 0, cap, ['frigate']);
    const t = resolveTurn(s, subs(s, { 0: [[{ type: 'move', fleet: a.id, path }], [{ type: 'fate', use: 'hyperjump', fleet: a.id }]] }));
    expect(t.fleets.find(f => f.id === a.id)!.region).toBe(path[1]);
  });
  it('LIVE: a Hyperjump stops at a black hole and at an Ambush', () => {
    for (const stop of ['well', 'ambush'] as const) {
      const s0 = game(); clearMap(s0);
      const { cap, path } = road(s0, 6);
      const a = fleetAt(s0, 0, cap, ['frigate']);
      let amb: Fleet | null = null;
      if (stop === 'well') s0.regions[path[1]].star = 'blackhole';
      else amb = fleetAt(s0, 1, path[1], ['frigate', 'frigate']);
      let s = makeLive(s0, 0, 360);
      if (amb) expect(queueFree(s, 1, { type: 'posture', fleet: amb.id, posture: 'ambush' })).toBeNull();
      expect(queueOrder(s, 0, { type: 'move', fleet: a.id, path }, 0)).toBeNull();
      expect(queueFree(s, 0, { type: 'fate', use: 'hyperjump', fleet: a.id })).toBeNull();
      for (let i = 0; i < 2; i++) s = runTick(s, () => false);
      const ta = s.fleets.find(f => f.id === a.id);
      if (ta) expect(path.indexOf(ta.region), stop).toBeLessThanOrEqual(1);
    }
  });
});

describe('sweep: combat edge cases', () => {
  it('3-way battle with every posture and Fate, garrison-only sieges, all-limping and empty fleets: no NaN, no crash', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const s = game(seed); clearMap(s);
      const pr = pair(s);
      if (!pr) continue;
      const { x, y } = pr;
      x.owner = 1; x.garrison = 15;
      y.garrison = 8;
      const b = fleetAt(s, 1, x.id, ['frigate', 'corvette']);
      const a = fleetAt(s, 0, y.id, ['frigate', 'frigate']);
      const a2 = fleetAt(s, 0, y.id, ['corvette']);
      const c = fleetAt(s, 2, x.id, ['frigate']);
      const lim = fleetAt(s, 2, y.id, ['corvette']);
      lim.limping = { since: 0, to: s.players[2].capital, by: 0 };
      const empty = fleetAt(s, 1, y.id, []);
      void empty;
      const free: Record<number, FreeAction[]> = {
        0: [{ type: 'posture', fleet: a.id, posture: 'charge' }, { type: 'posture', fleet: a2.id, posture: 'running' }, { type: 'fate', use: 'twist', fleet: a.id }],
        1: [{ type: 'posture', fleet: b.id, posture: 'guarded' }, { type: 'wposture', region: x.id, posture: seed % 2 ? 'levies' : 'gates' }, { type: 'fate', use: 'laststand', fleet: b.id }],
        2: [{ type: 'posture', fleet: c.id, posture: 'ambush' }],
      };
      let t = resolveTurn(s, subs(s, { 0: [[{ type: 'seize', fleet: a.id, target: x.id, also: [a2.id] }], free[0]], 1: [[], free[1]], 2: [[], free[2]] }));
      for (let k = 0; k < 3; k++) t = resolveTurn(t, idle(t));
      for (const r of t.regions) expect(Number.isFinite(r.garrison)).toBe(true);
      for (const f of t.fleets) for (const sh of f.ships) expect(Number.isFinite(sh.hp) && sh.hp > 0).toBe(true);
      for (const p of t.players) for (const v of Object.values(p.res)) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('sweep: a remnant left behind does not inherit the Fate', () => {
  it('ships without engines left behind on a retreat form a remnant with no Fate of its own', () => {
    let seen = 0;
    for (let seed = 1; seed <= 80; seed++) {
      const s = game(seed); clearMap(s);
      const pr = pair(s);
      if (!pr) continue;
      const { x } = pr;
      x.garrison = 0;
      const a = fleetAt(s, 0, x.id, ['frigate', 'frigate', 'frigate']);
      a.doctrine = { stance: 'evasive', retreatAt: 0, target: 'weakest', guard: false };
      a.ships[0].sys.engines = false;
      fleetAt(s, 1, x.id, ['frigate', 'frigate']);
      const t = resolveTurn(s, subs(s, { 0: [[], [{ type: 'fate', use: 'twist', fleet: a.id }]] }));
      const rem = t.fleets.find(f => f.owner === 0 && f.name.startsWith('Remnant of'));
      if (!rem) continue;
      seen++;
      // the fleet's one Twist of Fate is not handed to its remnant for the rest of the battle
      const rounds = t.last!.battles.find(b => b.region === x.id)!.rounds;
      const k = rounds.findIndex(r => r.retreats.some(q => q.fleet === a.id));
      const twistedBefore = rounds.slice(0, k + 1).some(r => r.shots.some(q => q.twist));
      const remIds = new Set(rem.ships.map(sh => sh.id));
      const after = rounds.slice(k + 1).flatMap(r => r.shots).filter(q => q.twist && remIds.has(q.to));
      expect(twistedBefore && after.length ? 'twice' : 'once', `seed ${seed}`).toBe('once');
      expect(!twistedBefore && after.length ? 'inherited' : 'ok', `seed ${seed}`).toBe('ok');
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('sweep: an ambush that is driven off is over', () => {
  it('LIVE: an Ambushing fleet that retreats from a fight no longer lies in Ambush (hidden) where it fled to', () => {
    let seen = 0;
    for (let seed = 1; seed <= 30 && seen < 2; seed++) {
      const s0 = game(seed); clearMap(s0);
      const pr = pair(s0);
      if (!pr) continue;
      const { x } = pr;
      x.garrison = 0;
      const a = fleetAt(s0, 0, x.id, ['frigate']);
      a.doctrine.retreatAt = 0.99;
      fleetAt(s0, 1, x.id, ['frigate', 'frigate', 'frigate']);
      let s = makeLive(s0, 0, 360);
      expect(queueFree(s, 0, { type: 'posture', fleet: a.id, posture: 'ambush' })).toBeNull();
      for (let i = 0; i < 3; i++) {
        s = runTick(s, () => false);
        const ta = s.fleets.find(f => f.id === a.id);
        if (!ta || ta.region === x.id) continue;
        seen++;
        expect(ta.posture ?? null).not.toBe('ambush');
        break;
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('sweep: the AI does not bet on a posture with no time left to pay off', () => {
  it('LIVE: Guarded / Levies are not taken on the last tick of a cycle (they would be judged at once and backfire)', () => {
    const s0 = game(); clearMap(s0);
    const cap = s0.players[0].capital;
    const mine = fleetAt(s0, 0, cap, ['frigate', 'frigate']);
    const next = links(s0, cap)[0];
    s0.regions[next].owner = null;
    fleetAt(s0, 1, next, ['frigate', 'frigate', 'frigate']);
    const ctx = (s: GameState) => ({ s, pid: 0, lvl: 'expert' as const, orders: [], threatened: new Map([[cap, 0.9]]), odds: () => 0.6, duel: () => 0.6, close: () => false });
    // WEGO: the read is good, it braces
    expect(sigFree(ctx(s0)).some(fa => fa.type === 'posture' && fa.fleet === mine.id && fa.posture === 'guarded')).toBe(true);
    const per = s0.rules.live.ticksPerCycle;
    const early = makeLive(structuredClone(s0), 0, 360);
    expect(sigFree(ctx(early)).some(fa => fa.type === 'posture' && fa.posture === 'guarded')).toBe(true);
    const late = makeLive(structuredClone(s0), 0, 360);
    late.live!.tick = per - 1;
    const free = sigFree(ctx(late));
    expect(free.some(fa => fa.type === 'posture' && (fa.posture === 'guarded' || fa.posture === 'ambush'))).toBe(false);
    expect(free.some(fa => fa.type === 'wposture' && fa.posture !== 'gates')).toBe(false);
  });
});

describe('sweep: Fate is public, an unseen fleet\'s whereabouts are not', () => {
  it('a Hyperjump / Rally / Last Stand / Twist names no system in the event, the Herald or the chronicle (Surge may)', () => {
    for (const use of ['hyperjump', 'rally', 'laststand', 'twist'] as const) {
      const s = game(); clearMap(s);
      const pr = pair(s)!;
      const a = fleetAt(s, 0, pr.x.id, ['frigate']);
      if (use === 'rally') { a.limping = { since: 1, to: s.players[0].capital, by: 1 }; a.ships[0].hp = 2; }
      const t = resolveTurn(s, subs(s, { 0: [[], [{ type: 'fate', use, fleet: a.id }]] }));
      const ev = t.last!.events.find(e => e.k === 'fate' && e.owner === 0) as Extract<GameEvent, { k: 'fate' }>;
      expect(ev, use).toBeTruthy();
      expect(ev.region, use).toBeUndefined();
      const name = t.regions[pr.x.id].name;
      expect(ev.text.includes(name), use).toBe(false);
      const heads = t.soul!.herald.flatMap(ed => ed.headlines).filter(h => h.kind === 'fate');
      expect(heads.length, use).toBeGreaterThan(0);
      for (const h of heads) { expect(h.region, use).toBeUndefined(); expect(h.text.includes(name), use).toBe(false); }
      for (const c of t.chronicle.filter(c => /spends Fate/.test(c.text))) { expect(c.region, use).toBeUndefined(); expect(c.text.includes(name), use).toBe(false); }
    }
    const s = game();
    const cap = s.players[0].capital;
    const t = resolveTurn(s, subs(s, { 0: [[], [{ type: 'fate', use: 'surge', region: cap }]] }));
    expect((t.last!.events.find(e => e.k === 'fate') as { region?: number }).region).toBe(cap);
  });
});

describe('sweep: Guarded vs a standing Seize route', () => {
  it('WEGO: a Guarded fleet on an earlier Seize route halts short of its target and does not assault', () => {
    const s = game(31); clearMap(s);
    const pr = pair(s)!;
    const f = fleetAt(s, 0, pr.x.id, ['frigate', 'frigate']);
    f.route = { path: [pr.y.id], seize: pr.y.id, mp: 0 };   // a standing seize from an earlier turn
    const t = resolveTurn(s, subs(s, { 0: [[], [{ type: 'posture', fleet: f.id, posture: 'guarded' }]] }));
    const g = t.fleets.find(x => x.id === f.id)!;
    expect(g.region).toBe(pr.x.id);
    expect(t.regions[pr.y.id].owner).toBeNull();
    expect(g.route?.seize).toBe(pr.y.id);   // the order stands for next turn
  });
});
