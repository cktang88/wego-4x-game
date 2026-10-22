// Second sweep: bugs found by long seeded soaks (shared/sim) and the server store. Each test reproduces one.
import { describe, expect, it } from 'vitest';
import { createGame, newFleet, newShip } from '../shared/sim/setup.ts';
import { resolveTurn, emptySubmission } from '../shared/sim/resolve.ts';
import { moveNeighbors } from '../shared/sim/empire.ts';
import { viewFor, filterResultFor } from '../shared/sim/view.ts';
import { bannerLimit, ensureSoul, raze } from '../shared/sim/soul.ts';
import { Rng } from '../shared/sim/rng.ts';
import { spectatorView } from '../server/history.ts';
import { planTurn } from '../shared/sim/ai.ts';
import { makeLive } from '../shared/sim/live.ts';
import type { Engagement, Fleet, GameState, Order, Region, Submission } from '../shared/sim/types.ts';

const game = (seed = 31) => createGame({ seed, rules: { map: { laneDots: [] } }, players: [0, 1, 2].map(() => ({ kind: 'human' as const })) });
const idle = (s: GameState): Record<number, Submission> => Object.fromEntries(s.players.map(p => [p.id, emptySubmission(s)]));
const withOrders = (s: GameState, p: number, orders: Order[]) => { const x = idle(s); orders.forEach((o, i) => { x[p].orders[i] = o; }); return x; };
const links = (s: GameState, id: number) => s.regions[id].links ?? s.regions[id].neighbors;
const rng = new Rng(3);
const fleetAt = (s: GameState, owner: number, region: number, classes: string[]): Fleet => {
  const f = newFleet(s, rng, owner, region);
  for (const c of classes) f.ships.push(newShip(s, rng, c, owner));
  f.bornTurn = 0;
  f.banner = { sigil: 'sun', boons: [], banes: [], home: s.players[owner].capital, foundedTurn: 1 };
  f.doctrine = { stance: 'aggressive', retreatAt: 0, target: 'weakest', guard: false };
  for (const sh of f.ships) sh.traits = [];
  return f;
};
const bfs = (s: GameState, from: number) => {
  const d = new Map([[from, 0]]); const q = [from];
  while (q.length) { const r = q.shift()!; for (const n of links(s, r)) if (!d.has(n)) { d.set(n, d.get(r)! + 1); q.push(n); } }
  return d;
};
const engagement = (s: GameState, region: number, fleets: Fleet[]): Engagement => {
  const e: Engagement = { id: s.nextId++, region, name: 'Battle of Test', startedTurn: s.turn, startedPulse: 1, rounds: 1, forceAt: 99,
    startHp: Object.fromEntries(fleets.map(f => [f.id, f.ships.reduce((a, x) => a + x.maxHp, 0)])), fleets: fleets.map(f => f.id),
    owners: [...new Set(fleets.map(f => f.owner))], hulls: {}, cmds: Object.fromEntries(fleets.map(f => [f.commander.name, f.owner])),
    losses: {}, lastStand: [], firstBlood: true, garrisonStart: 0 };
  s.engagements.push(e);
  return e;
};

describe('sweep2: a fleet routed while breaking off from a battle', () => {
  it('keeps its whole route home (it was cut by one step and then dropped: a wasted turn of limping)', () => {
    let routs = 0;
    for (let k = 0; k < 60 && routs < 3; k++) {
      const s = game(); ensureSoul(s); s.fleets = [];
      const cap = s.players[0].capital;
      const d = bfs(s, cap);
      // X three or more steps from home, and Y one step further: the limp home is at least two steps
      const x = s.regions.find(r => r.owner === null && r.kind !== 'lane' && (d.get(r.id) ?? 0) >= 3 && links(s, r.id).some(n => (d.get(n) ?? 0) >= 3 && s.regions[n].owner === null))!;
      const y = links(s, x.id).find(n => (d.get(n) ?? 0) >= 3 && s.regions[n].owner === null)!;
      for (const r of [x, s.regions[y]] as Region[]) { r.garrison = 0; r.baseGarrison = 0; }
      const a = fleetAt(s, 0, x.id, ['frigate']);
      a.ships[0].hp = 2;
      const b = fleetAt(s, 1, x.id, ['frigate', 'frigate', 'frigate', 'frigate', 'frigate', 'frigate']);
      engagement(s, x.id, [a, b]);
      s.rngState = 1000 + k * 7919;
      const t = resolveTurn(s, withOrders(s, 0, [{ type: 'move', fleet: a.id, path: [y] }]));
      const fa = t.fleets.find(f => f.id === a.id);
      if (!fa?.limping || fa.limping.since !== s.turn) continue;
      routs++;
      expect(fa.region).toBe(y);
      expect(fa.route).toBeTruthy();
      expect(moveNeighbors(t, 0, fa.region)).toContain(fa.route!.path[0]);
      expect(fa.route!.path[fa.route!.path.length - 1]).toBe(fa.limping.to);
    }
    expect(routs).toBeGreaterThan(0);
  });
});

describe('sweep2: engine-less hulls left behind by a retreat', () => {
  it('fly no banner of their own (the Remnant cloned its parent\'s banner: 5 banners with a limit of 4)', () => {
    let remnants = 0;
    for (let k = 0; k < 40 && remnants < 3; k++) {
      const s = game(); ensureSoul(s); s.fleets = [];
      const cap = s.players[0].capital;
      const x = s.regions.find(r => r.owner === null && r.kind === 'colony' && (bfs(s, cap).get(r.id) ?? 0) >= 2)!;
      x.garrison = 0; x.baseGarrison = 0;
      for (let i = 0; i < 2; i++) fleetAt(s, 0, cap, ['frigate']);
      const a = fleetAt(s, 0, x.id, ['frigate', 'frigate', 'frigate']);
      a.ships[2].sys.engines = false;
      a.doctrine.stance = 'evasive';   // wants out at once
      a.vow = { kind: 'throne', since: 1 };
      fleetAt(s, 1, x.id, ['frigate', 'frigate']);
      expect(s.fleets.filter(f => f.owner === 0 && f.banner).length).toBe(bannerLimit(s, 0));
      s.rngState = 77 + k * 104729;
      const t = resolveTurn(s, idle(s));
      const rem = t.fleets.find(f => f.owner === 0 && f.name.startsWith('Remnant of'));
      if (!rem) continue;
      remnants++;
      expect(rem.banner ?? null).toBe(null);
      expect(rem.vow ?? null).toBe(null);
      expect(t.fleets.filter(f => f.owner === 0 && f.banner && f.ships.length).length).toBeLessThanOrEqual(bannerLimit(t, 0));
    }
    expect(remnants).toBeGreaterThan(0);
  });
});

describe('sweep2: fog', () => {
  it('a battle in view never names the commander of a fleet you cannot see', () => {
    const s = game(); ensureSoul(s); s.fleets = [];
    const cap = s.players[2].capital;
    const x = links(s, cap).find(n => s.regions[n].owner === null && s.regions[n].feature !== 'nebula')!;
    const a = fleetAt(s, 0, x, ['frigate']);
    const b = fleetAt(s, 1, x, ['frigate']);
    b.banner!.boons = ['ghosts'];   // seen only by a fleet in or next to it (or the system's owner, or a scan)
    engagement(s, x, [a, b]);
    const v = viewFor(s, 2).state;
    expect(v.fleets.some(f => f.id === a.id)).toBe(true);
    expect(v.fleets.some(f => f.id === b.id)).toBe(false);
    const e = v.engagements.find(z => z.region === x)!;
    expect(e).toBeDefined();
    expect(e.fleets).not.toContain(b.id);
    expect(Object.keys(e.cmds)).not.toContain(b.commander.name);
    expect(Object.keys(e.cmds)).toContain(a.commander.name);
  });

  it('a spectator of a running LIVE game does not get the fleets that fought this cycle', () => {
    const s = makeLive(game(), 0, 360);
    s.cycleFought = [5, 6];
    expect(spectatorView(s).state.cycleFought).toBeUndefined();
  });
  it('replaying an old turn under a scan made today does not unmask that turn\'s ambusher', () => {
    const s = game(); ensureSoul(s); s.fleets = [];
    const cap = s.players[0].capital;
    const y = links(s, cap).find(n => s.regions[n].owner === null && s.regions[n].kind !== 'throne')!;
    const x = links(s, y).find(n => n !== cap && s.regions[n].owner === null && s.regions[n].feature !== 'nebula' && s.regions[n].kind !== 'throne')!;
    const mine = fleetAt(s, 0, y, ['frigate']);          // watched X from next door
    const amb = fleetAt(s, 1, x, ['frigate']);
    amb.posture = 'ambush';
    const old = { turn: 3, events: [], battles: [], signals: [], startFleets: structuredClone([mine, amb]), startOwners: s.regions.map(r => r.owner) };
    s.turn = 10;
    s.fleets = [];   // all gone since
    s.scans.push({ owner: 0, region: x, until: 11 });   // scanning X now
    expect(filterResultFor(s, old, 0).startFleets.some(f => f.id === amb.id)).toBe(false);
    // ...while a scan that covered turn 3 did unmask it then
    s.scans = [{ owner: 0, region: x, until: 4 }];
    expect(filterResultFor(s, old, 0).startFleets.some(f => f.id === amb.id)).toBe(true);
  });
});

describe('sweep2: degenerate rules', () => {
  it('a Warden with no valid ship classes never takes the field as an empty fleet', () => {
    const s = createGame({ seed: 2, rules: { warden: { ships: ['nope'], wakeAtLore: 0 } }, players: [0, 1, 2].map(() => ({ kind: 'human' as const })) });
    const t = resolveTurn(s, idle(s));
    expect(t.wardenAwake).toBe(true);
    expect(t.fleets.every(f => f.ships.length > 0)).toBe(true);
  });
  it('razing a world with no citizens (a void) does not give it one', () => {
    const s = game(); ensureSoul(s);
    const r = s.regions.find(x => x.kind === 'void') ?? s.regions.find(x => x.kind === 'colony')!;
    r.owner = 0; r.dev = 0;
    r.story!.captured = { by: 0, from: 1, turn: s.turn };
    raze(s, 0, r, 1, () => {});
    expect(r.dev).toBe(0);
  });
});

describe('sweep2: AI', () => {
  it('never merges a limping fleet, nor merges warships into an unbannered Remnant', () => {
    const s = createGame({ seed: 31, rules: { map: { laneDots: [] } }, players: [0, 1, 2].map(() => ({ kind: 'ai' as const, aiLevel: 'expert' as const })) });
    ensureSoul(s); s.fleets = [];
    const cap = s.players[0].capital;
    const limp = fleetAt(s, 0, cap, ['frigate']);
    limp.limping = { since: s.turn, to: cap, by: 1 };
    const rem = fleetAt(s, 0, cap, ['frigate', 'frigate']);
    rem.banner = null; rem.name = 'Remnant of Test';
    const small = fleetAt(s, 0, cap, ['corvette']);
    const merges = planTurn(s, 0).free.filter((f): f is Extract<typeof f, { type: 'merge' }> => f.type === 'merge');
    for (const m of merges) {
      expect([m.fleet, m.into]).not.toContain(limp.id);
      expect(m.into).not.toBe(rem.id);
    }
    expect(merges.some(m => m.into === small.id)).toBe(true);
    const t = resolveTurn(s, Object.fromEntries(s.players.map(p => [p.id, p.id === 0 ? planTurn(s, 0) : emptySubmission(s)])));
    expect(t.last!.events.some(e => e.k === 'fail' && e.owner === 0 && /merge failed/.test(e.text))).toBe(false);
  });
  it('does not plan an overdrive for a fleet that a tired fleet is merged into this turn', () => {
    let checked = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const s = createGame({ seed, rules: { map: { laneDots: [] } }, players: [0, 1, 2].map(() => ({ kind: 'ai' as const, aiLevel: 'expert' as const })) });
      ensureSoul(s); s.fleets = s.fleets.filter(f => f.owner !== 0);
      const cap = s.players[0].capital;
      const host = fleetAt(s, 0, cap, ['frigate', 'frigate']);
      const tired = fleetAt(s, 0, cap, ['corvette']);
      tired.fatigued = true;
      const sub = planTurn(s, 0);
      const merged = sub.free.some(f => f.type === 'merge' && ((f.fleet === tired.id && f.into === host.id) || (f.fleet === host.id && f.into === tired.id)));
      if (!merged) continue;
      checked++;
      for (const o of sub.orders) if (o?.type === 'move') expect(o.overdrive && [host.id, tired.id].includes(o.fleet)).toBeFalsy();
      const t = resolveTurn(s, Object.fromEntries(s.players.map(p => [p.id, p.id === 0 ? sub : emptySubmission(s)])));
      expect(t.last!.events.some(e => e.k === 'fail' && e.owner === 0 && /fatigued/.test(e.text))).toBe(false);
    }
    expect(checked).toBeGreaterThan(0);
  });
});
