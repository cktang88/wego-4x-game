// Bug sweep: core resolution, movement, empire and fog (resolve.ts, live.ts, view.ts, rules.ts...).
import { describe, expect, it } from 'vitest';
import { createGame, newFleet, newShip } from '../shared/sim/setup.ts';
import { resolveTurn, emptySubmission, checkVictory } from '../shared/sim/resolve.ts';
import { makeLive, runTick, queueFree, queueOrder } from '../shared/sim/live.ts';
import { planTurn } from '../shared/sim/ai.ts';
import { viewFor } from '../shared/sim/view.ts';
import { coverage, seesFleet, postureSeenBy } from '../shared/sim/visibility.ts';
import { researchedThisTurn } from '../shared/sim/empire.ts';
import { defaultRules, upgradeRules } from '../shared/config/rules.ts';
import { soulOn } from '../shared/sim/soul.ts';
import { sigOn } from '../shared/sim/signature.ts';
import { Rng } from '../shared/sim/rng.ts';
import { findPath } from '../shared/sim/graph.ts';
import type { FreeAction, GameState, Order, Submission } from '../shared/sim/types.ts';

const game = (seed = 21) => createGame({ seed, players: [0, 1, 2].map(() => ({ kind: 'human' as const })) });
const idle = (s: GameState): Record<number, Submission> => Object.fromEntries(s.players.map(p => [p.id, emptySubmission(s)]));
const turn = (s: GameState, p: number, orders: Order[], free: FreeAction[] = []) => {
  const subs = idle(s);
  orders.forEach((o, i) => { subs[p].orders[i] = o; });
  subs[p].free = free;
  return resolveTurn(s, subs);
};
/** A waypoint on a lane between two unowned systems. */
const freeLane = (s: GameState) => s.regions.find(r => r.kind === 'lane' && r.lane!.n === 1 && s.regions[r.lane!.a].owner === null && s.regions[r.lane!.b].owner === null)!;
const fleetAt = (s: GameState, owner: number, region: number, classes: string[]) => {
  const rng = new Rng(owner * 7 + region + 1);
  const f = newFleet(s, rng, owner, region);
  for (const c of classes) f.ships.push(newShip(s, rng, c, owner));
  f.bornTurn = 0;
  return f;
};

describe('fog: a rival fleet\'s standing route is its owner\'s secret', () => {
  it('WEGO: a visible rival fleet on a multi-turn Seize route shows no route (own routes intact)', () => {
    const s = game();
    const dot = freeLane(s);
    const { a, b } = dot.lane!;
    s.regions[a].garrison = 0; s.regions[b].garrison = 0;
    const target = s.regions[b].links!.find(x => x !== dot.id && s.regions[x].kind !== 'lane' && s.regions[x].owner === null)!;
    const f = fleetAt(s, 0, a, ['dread']);   // speed 1: three turns to the target
    // player 1 watches from the lane's start
    fleetAt(s, 1, a, ['scout']);
    s.pacts.push({ a: 0, b: 1, until: 99 });
    const n = turn(s, 0, [{ type: 'seize', fleet: f.id, target, via: [dot.id, b] }]);
    expect(n.fleets.find(x => x.id === f.id)!.route?.seize).toBe(target);
    const v1 = viewFor(n, 1).state;
    const seen = v1.fleets.find(x => x.id === f.id);
    expect(seen).toBeTruthy();
    expect(seen!.route ?? null).toBeNull();
    // replays don't carry it either
    for (const x of v1.last!.startFleets) if (x.owner !== 1) expect(x.route ?? null).toBeNull();
    expect(viewFor(n, 0).state.fleets.find(x => x.id === f.id)!.route?.seize).toBe(target);
  });

  it('WEGO: movement signals name where a fleet gets to this turn, not the far end of its route', () => {
    const s = game();
    const dot = freeLane(s);
    const { a, b } = dot.lane!;
    s.regions[a].garrison = 0; s.regions[b].garrison = 0;
    const f = fleetAt(s, 0, a, ['dread']);
    fleetAt(s, 1, a, ['scout']);   // player 1 watches it leave
    s.pacts.push({ a: 0, b: 1, until: 99 });
    const n = turn(s, 0, [{ type: 'move', fleet: f.id, path: [dot.id, b] }]);
    const sigs = n.last!.signals.filter(x => x.observer === 1 && x.about === 0 && x.text.startsWith('Fleet movement') && x.text.includes(s.regions[a].name));
    expect(sigs.length).toBeGreaterThan(0);
    for (const x of sigs) { expect(x.text).not.toContain(`→ ${s.regions[b].name}`); expect(x.text).toContain('still under way'); }
  });

  it('LIVE: a rival route shows only the step it is taking (no destination, no seize)', () => {
    let s = makeLive(game(), 0, 360);
    const dot = freeLane(s);
    const { a, b } = dot.lane!;
    s.regions[a].garrison = 0; s.regions[b].garrison = 0;
    const target = s.regions[b].links!.find(x => x !== dot.id && s.regions[x].kind !== 'lane' && s.regions[x].owner === null)!;
    const f = fleetAt(s, 0, a, ['dread']);
    fleetAt(s, 1, a, ['scout']);
    s.pacts.push({ a: 0, b: 1, until: 99 });
    f.route = { path: [dot.id, b, target], seize: target, mp: 0 };
    const v = viewFor(s, 1).state.fleets.find(x => x.id === f.id)!;
    expect(v.route).toEqual({ path: [dot.id], seize: null, mp: 0 });
    s = runTick(s, () => false);
    expect(s.fleets.find(x => x.id === f.id)!.route).toBeTruthy();
  });

  it('an engagement never names a rival fleet that has slipped out of sight', () => {
    const s = game();
    const f0 = fleetAt(s, 0, s.players[0].capital, ['frigate']);
    const hidden = fleetAt(s, 1, s.players[1].capital, ['frigate']);   // far away, unseen by player 0
    expect(seesFleet(s, 0, hidden, coverage(s, 0))).toBe(false);
    s.engagements.push({ id: 1, region: f0.region, name: 'Battle', startedTurn: 1, startedPulse: 1, rounds: 1, forceAt: 9, startHp: { [f0.id]: 10, [hidden.id]: 10 },
      fleets: [f0.id, hidden.id], owners: [0, 1], hulls: { 0: 1, 1: 1 }, cmds: {}, losses: {}, lastStand: [], firstBlood: false, garrisonStart: 0, joined: { [hidden.id]: 0 } });
    const e = viewFor(s, 0).state.engagements.find(x => x.id === 1)!;
    expect(e.fleets).toEqual([f0.id]);
    expect(Object.keys(e.startHp).map(Number)).toEqual([f0.id]);
    expect(e.joined).toEqual({});
  });
});

describe('fog fuzz: views never reveal unseen rival fleets, orders or postures', () => {
  const checkViews = (s: GameState, tag: string) => {
    for (const pl of s.players) {
      const p = pl.id;
      const v = viewFor(s, p).state;
      const cov = coverage(s, p);
      const shown = new Set(v.fleets.map(f => f.id));
      for (const f of v.fleets) {
        if (f.owner === p) continue;
        const real = s.fleets.find(x => x.id === f.id)!;
        expect(seesFleet(s, p, real, cov), `${tag}: unseen fleet ${f.id} in view of ${p}`).toBe(true);
        if (f.posture) expect(postureSeenBy(s, p, real), `${tag}: posture`).toBe(true);
        expect(f.postureFx ?? null, tag).toBeNull();
        expect(f.dugIn ?? null, tag).toBeNull();
        expect(f.pendingHonour ?? null, tag).toBeNull();
        expect(f.oos ?? 0, tag).toBe(0);
        expect(!f.route || (f.route.seize === null && f.route.path.length <= 1), `${tag}: rival route`).toBe(true);
      }
      for (const e of v.engagements) for (const id of e.fleets) {
        const real = s.fleets.find(x => x.id === id);
        if (real && real.owner !== p) expect(shown.has(id), `${tag}: engagement names unseen fleet`).toBe(true);
      }
      for (const r of v.regions) if (r.owner !== p) { expect(r.wposture ?? null, tag).toBeNull(); expect(r.idleUntil ?? null, tag).toBeNull(); }
      for (const o of v.players) if (o.id !== p) expect(o.res.credits, tag).toBe(-1);
      if (v.live) expect(Object.keys(v.live.queue).map(Number).every(k => k === p), tag).toBe(true);
      for (const e of v.last?.events ?? []) if (e.k === 'fail' || e.k === 'scan') expect(e.owner, tag).toBe(p);
      for (const x of v.last?.signals ?? []) expect(x.observer, tag).toBe(p);
      for (const f of v.last?.startFleets ?? []) if (f.owner !== p) { expect(f.posture ?? null, tag).toBeNull(); expect(!f.route || (!!s.live && f.route.seize === null && f.route.path.length <= 1), `${tag}: replay route`).toBe(true); }
      expect(v.rngState, tag).toBe(0);
      expect(v.log.length, tag).toBe(0);
    }
  };
  it('WEGO, AI vs AI, several seeds', () => {
    for (const seed of [5000, 5013, 5026, 5039]) {
      let s = createGame({ seed, players: [0, 1, 2].map(i => ({ kind: 'ai' as const, aiLevel: (['expert', 'standard', 'novice'] as const)[(i + seed) % 3] })) });
      for (let t = 0; t < 22 && s.winner === null; t++) {
        const subs: Record<number, Submission> = {};
        for (const p of s.players) subs[p.id] = planTurn(s, p.id);
        s = resolveTurn(s, subs);
        checkViews(s, `seed ${seed} turn ${s.turn}`);
      }
    }
  }, 60_000);
  it('LIVE, AI vs AI', () => {
    for (const seed of [6001, 6002]) {
      let s = makeLive(createGame({ seed, players: [0, 1, 2].map(() => ({ kind: 'ai' as const, aiLevel: 'expert' as const })) }), 0, 360);
      for (let t = 0; t < 60 && s.winner === null; t++) { s = runTick(s, () => true); checkViews(s, `seed ${seed} tick ${t}`); }
    }
  }, 60_000);
});

describe('LIVE: queued free actions', () => {
  it('a refused re-issue leaves the earlier queued action in place', () => {
    const s = makeLive(game(), 0, 360);
    const dot = freeLane(s);
    const f = fleetAt(s, 0, dot.lane!.a, ['frigate']);
    f.route = { path: [dot.id, dot.lane!.b], seize: null, mp: 0 };
    expect(queueFree(s, 0, { type: 'posture', fleet: f.id, posture: 'guarded' })).toBeNull();
    // an ambush must lie still: refused while it travels...
    expect(queueFree(s, 0, { type: 'posture', fleet: f.id, posture: 'ambush' })).toMatch(/halt/);
    // ...and the Guarded posture already queued is still there
    expect(s.live!.free[0]).toEqual([{ type: 'posture', fleet: f.id, posture: 'guarded' }]);
  });

  it('a fleet merged mid-cycle brings its used orders along (no fresh orders by changing fleets)', () => {
    let s = makeLive(game(), 0, 360);
    const cap = s.players[0].capital;
    const a = fleetAt(s, 0, cap, ['frigate']), b = fleetAt(s, 0, cap, ['frigate']);
    s.live!.tick = 1;   // mid-cycle
    a.ordersThisTurn = s.rules.orders.maxPerFleet;
    expect(queueFree(s, 0, { type: 'merge', fleet: a.id, into: b.id })).toBeNull();
    s = runTick(s, () => false);
    expect(s.fleets.find(x => x.id === b.id)!.ordersThisTurn).toBe(s.rules.orders.maxPerFleet);
  });

  it('a fleet founded this cycle cannot join an assault (as in WEGO)', () => {
    let s = makeLive(game(), 0, 360);
    s.turn = 3;
    const t = s.regions.find(r => r.kind === 'colony' && r.owner === null && (r.links ?? r.neighbors).some(n => s.regions[n].kind !== 'lane'))!;
    const from = (t.links ?? t.neighbors).find(n => s.regions[n].kind !== 'lane')!;
    const f = fleetAt(s, 0, from, ['frigate', 'frigate']);
    const g = fleetAt(s, 0, from, ['frigate']);
    g.bornTurn = s.turn;
    s.live!.bank[0] = 3;
    expect(queueOrder(s, 0, { type: 'seize', fleet: f.id, target: t.id, also: [g.id] }, 0)).toBeNull();
    s = runTick(s, () => false);
    expect(s.fleets.find(x => x.id === g.id)!.route ?? null).toBeNull();
    expect(s.last!.events.some(e => e.k === 'fail' && e.text.includes('only just formed'))).toBe(true);
  });
});

describe('victory and elimination', () => {
  it('everyone eliminated on the same turn: no crash, the most VP wins', () => {
    const s = game();
    s.fleets = [];
    for (const r of s.regions) r.owner = null;
    s.players[2].vp = 5;
    const n = resolveTurn(s, idle(s));
    expect(n.players.every(p => p.eliminated)).toBe(true);
    expect(n.winner).toBe(2);
  });
  it('checkVictory on its own with nobody left does not throw', () => {
    const s = game();
    for (const p of s.players) p.eliminated = true;
    s.turn = s.rules.victory.turnLimit;
    expect(() => checkVictory(s)).not.toThrow();
  });
});

describe('old saves: rules backfill', () => {
  it('a save from before the Soul / Signature layers keeps them off; newer knobs are filled in', () => {
    const saved = defaultRules() as unknown as Record<string, unknown>;
    delete saved.soul; delete saved.signature;
    delete (saved.orders as Record<string, unknown>).maxPerFleet;
    const r = upgradeRules(saved);
    expect(r.orders.maxPerFleet).toBe(defaultRules().orders.maxPerFleet);
    const s = game();
    s.rules = r;
    expect(soulOn(s)).toBe(false);
    expect(sigOn(s)).toBe(false);
    // a current save keeps everything as it was
    const cur = upgradeRules(defaultRules());
    s.rules = cur;
    expect(soulOn(s)).toBe(true);
    expect(sigOn(s)).toBe(true);
  });
});

describe('research counter with odd tick rules', () => {
  it('a fractional ticksPerCycle reads cycles the same way live.ts does', () => {
    const s = makeLive(game(), 0, 360);
    s.rules.live.ticksPerCycle = 2.5;   // live.ts: floor -> 2 ticks per cycle
    s.players[0].researched = 1;
    s.last = { turn: 1, events: [], battles: [], signals: [], startFleets: [], startOwners: [] };
    s.live!.tick = 2;   // tick 2 opens a new cycle (2 % 2 === 0)
    expect(researchedThisTurn(s, 0)).toBe(0);
  });
});

describe('systems interplay (reported by the systems sweep)', () => {
  /** A rival (player 1) colony next to a player-0 fleet, both on real borders. */
  const rivalNextTo = (s: GameState) => {
    const x = s.regions.find(r => r.kind === 'colony' && (r.links ?? r.neighbors).some(n => s.regions[n].kind !== 'lane' && s.regions[n].kind !== 'home'))!;
    const from = (x.links ?? x.neighbors).find(n => s.regions[n].kind !== 'lane' && s.regions[n].kind !== 'home')!;
    x.owner = 1; x.garrison = 3;
    s.regions[from].owner = null; s.regions[from].garrison = 0;
    const f = fleetAt(s, 0, from, ['frigate', 'frigate']);
    return { x, f };
  };

  it('A: a Seize sent the turn the defender accepts your tribute stands down (no Oathbreaker)', () => {
    const s = game();
    const { x, f } = rivalNextTo(s);
    x.tribute = { from: 1, to: 0, since: s.turn, until: s.turn + 4 };
    const vp = s.players[0].vp;
    const n = turn(s, 0, [{ type: 'seize', fleet: f.id, target: x.id }]);
    expect(n.last!.events.some(e => e.k === 'fail' && e.owner === 0 && e.text.includes('accepted your terms'))).toBe(true);
    expect(n.players[0].oathbreaker ?? []).toEqual([]);
    expect(n.players[0].vp).toBe(vp);
    expect(n.regions[x.id].tribute).toBeTruthy();
  });

  it('D: seizing a tributary after a pact was signed also ends the tribute', () => {
    const s = game();
    const { x, f } = rivalNextTo(s);
    x.tribute = { from: 1, to: 0, since: s.turn - 1, until: s.turn + 4 };
    s.turn = 3; x.tribute.since = 1; x.tribute.until = 7;
    s.pacts.push({ a: 0, b: 1, until: 9 });
    const n = turn(s, 0, [{ type: 'seize', fleet: f.id, target: x.id }]);
    expect(n.last!.events.some(e => e.k === 'betrayal')).toBe(true);
    expect(n.regions[x.id].tribute ?? null).toBeNull();
  });

  it('B: a fogged rival system does not say who holds space there or how long it is contested', () => {
    const s = game();
    const far = s.regions[s.players[1].capital];
    expect(coverage(s, 0).has(far.id)).toBe(false);
    far.spaceWon = { p: 2, turn: 1 }; far.contested = 2;
    const v = viewFor(s, 0).state.regions[far.id];
    expect(v.spaceWon).toBeUndefined();
    expect(v.contested).toBeUndefined();
    expect(viewFor(s, 1).state.regions[far.id].contested).toBe(2);   // its owner still knows
  });

  it('C: a Warden raze never raises a 0-citizen system to 1', () => {
    const s = game();
    const r = s.regions.find(x => x.kind === 'colony')!;
    r.owner = 0; r.dev = 0; r.garrison = 0;
    const w = fleetAt(s, -1 as never, r.id, ['cruiser']);
    w.owner = -1; w.siege = r.id;
    s.wardenAwake = true;
    s.rules.wardenHunt.enabled = false;
    const n = resolveTurn(s, idle(s));
    expect(n.regions[r.id].owner).toBeNull();
    expect(n.regions[r.id].dev).toBe(0);
  });

  it('E: a limping hostile fleet does not pause growth (as for contested systems)', () => {
    const base = game();
    const cap = base.players[0].capital;
    const r = base.regions[cap];
    const grow = (withHull: boolean) => {
      const s = structuredClone(base);
      s.regions[cap].dev = 1; s.regions[cap].growth = 0; s.regions[cap].garrison = 0;   // no garrison or fleet to catch it
      s.fleets = s.fleets.filter(f => f.region !== cap);
      if (withHull) { const g = fleetAt(s, 1, cap, ['frigate']); g.limping = { since: 1, to: s.players[1].capital, by: 0 }; g.route = null; }
      return resolveTurn(s, idle(s)).regions[cap].growth ?? 0;
    };
    void r;
    expect(grow(false)).toBeGreaterThan(0);
    expect(grow(true)).toBe(grow(false));
  });

  it('E: legacy pulsed turns say when a gravity well holds a Seize short (never silently)', () => {
    const s = createGame({ seed: 21, players: [0, 1, 2].map(() => ({ kind: 'human' as const })), rules: { orders: { pulses: 3 } } });
    const real = (n: number) => s.regions[n].kind !== 'lane' && s.regions[n].homeOf === null;
    const well = s.regions.find(r => r.kind === 'colony' && (r.links ?? r.neighbors).filter(real).length >= 2)!;
    const [from, target] = (well.links ?? well.neighbors).filter(real);
    for (const id of [well.id, from, target]) { s.regions[id].owner = null; s.regions[id].garrison = 0; }
    well.star = 'blackhole';
    const f = fleetAt(s, 0, from, ['frigate']);
    const subs = idle(s);
    subs[0].orders[0] = { type: 'seize', fleet: f.id, target, via: [well.id] };
    const n = resolveTurn(s, subs);
    expect(n.fleets.find(x => x.id === f.id)!.region).toBe(well.id);
    expect(n.last!.events.some(e => e.k === 'fail' && e.owner === 0 && e.text.includes('gravity well'))).toBe(true);
  });

  it('E: the Warden\'s march stops in a gravity well', () => {
    const s = game();
    s.players[1].vp = 20;   // the clear leader
    const throne = s.regions.find(r => r.kind === 'throne')!;
    const w = fleetAt(s, 0, throne.id, ['cruiser']);
    w.owner = -1; s.wardenAwake = true;
    s.rules.wardenHunt.stepsPerTurn = 3;
    // the first step of its hunt is a black hole
    const lead = s.regions.filter(r => r.owner === 1);
    let best: number[] | null = null;
    for (const r of lead) { const p = findPath(s, throne.id, r.id); if (p && (!best || p.length < best.length)) best = p; }
    expect(best!.length).toBeGreaterThan(1);
    s.regions[best![0]].star = 'blackhole';
    const n = resolveTurn(s, idle(s));
    expect(n.fleets.find(x => x.owner === -1)!.region).toBe(best![0]);
  });
});
