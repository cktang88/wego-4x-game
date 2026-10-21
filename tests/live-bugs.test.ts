// Regression tests for LIVE-mode engine, fog-filtered views and the network layer's shared pieces.
import { describe, expect, it } from 'vitest';
import { createGame } from '../shared/sim/setup.ts';
import { makeLive, accrue, queueOrder, queueFree, cancelQueued, advanceTo, orderMs, tickMs, runTick, ticksPerCycle } from '../shared/sim/live.ts';
import { viewFor, filterResultFor } from '../shared/sim/view.ts';
import { coverage } from '../shared/sim/visibility.ts';
import type { GameState, TurnResult } from '../shared/sim/types.ts';

const T0 = 1_700_000_000_000;
function liveGame(seed = 3, kinds: ('human' | 'ai')[] = ['human', 'ai', 'ai']): GameState {
  const s = createGame({ seed, players: kinds.map(kind => ({ kind, aiLevel: 'standard' as const })) });
  return makeLive(s, T0, 1);
}
const rich = (s: GameState, p: number) => { s.players[p].res = { industry: 500, credits: 500, influence: 500 }; };
const myFleet = (s: GameState, p: number) => s.fleets.find(f => f.owner === p && f.ships.length)!;

describe('LIVE: order bank', () => {
  it('a long absence does not leave the earning timer behind (no burst of back-pay orders afterwards)', () => {
    const s = liveGame();
    const now = T0 + orderMs(s) * 5000;   // far more intervals than the old 1000-step guard
    accrue(s, now);
    expect(s.live!.bank[0]).toBe(s.rules.live.bankCap);
    expect(s.live!.nextOrderAt[0]).toBeGreaterThan(now);
    s.live!.bank[0] = 0;                   // spend everything...
    accrue(s, now + 1);                    // ...a moment later nothing new has been earned
    expect(s.live!.bank[0]).toBe(0);
  });

  it('rejects an order it can already tell will fail for lack of resources, without spending the order', () => {
    const s = liveGame();
    s.players[0].res = { industry: 0, credits: 0, influence: 0 };
    const bank = s.live!.bank[0];
    expect(queueOrder(s, 0, { type: 'build', region: s.players[0].capital, cls: 'corvette', fleet: null }, T0)).toMatch(/not enough/);
    expect(s.live!.bank[0]).toBe(bank);
  });

  it('counts the cost of orders already queued this tick', () => {
    const s = liveGame();
    const cap = s.players[0].capital;
    const cost = s.rules.ships.corvette.cost;
    s.players[0].res = { industry: cost.industry ?? 0, credits: cost.credits ?? 0, influence: 0 };
    s.rules.economy.creditsPerIndustry = 0;   // no credit top-up: exactly one corvette is affordable
    s.rules.soul.bannersBase = 9;             // Soul layer: each fleet:null build founds a banner; leave room for two
    expect(queueOrder(s, 0, { type: 'build', region: cap, cls: 'corvette', fleet: null }, T0)).toBeNull();
    expect(queueOrder(s, 0, { type: 'build', region: cap, cls: 'corvette', fleet: null }, T0)).toMatch(/not enough/);
  });

  it('cannot queue the same law, project, conceal or pact twice in one tick', () => {
    const s = liveGame(3, ['human', 'human', 'human']);
    rich(s, 0);
    s.live!.bank[0] = 6;
    expect(queueOrder(s, 0, { type: 'law', law: 'mercantile' }, T0)).toBeNull();
    expect(queueOrder(s, 0, { type: 'law', law: 'mercantile' }, T0)).toMatch(/already enacted/);
    const cap = s.players[0].capital;
    expect(queueOrder(s, 0, { type: 'develop', region: cap, project: 'develop' }, T0)).toBeNull();
    expect(queueOrder(s, 0, { type: 'develop', region: cap, project: 'develop' }, T0)).toMatch(/already underway/);
    expect(queueOrder(s, 0, { type: 'conceal' }, T0)).toBeNull();
    expect(queueOrder(s, 0, { type: 'conceal' }, T0)).toMatch(/already concealed/);
    expect(queueOrder(s, 0, { type: 'pact', with: 1 }, T0)).toBeNull();
    expect(queueOrder(s, 0, { type: 'pact', with: 1 }, T0)).toMatch(/already offered/);
    expect(s.live!.bank[0]).toBe(2);
  });

  it('validates against queued free actions: a queued revoke frees the law slot for a new law', () => {
    const s = liveGame();
    rich(s, 0);
    s.players[0].laws = ['bastion'];     // the only slot at the start is full
    expect(queueOrder(s, 0, { type: 'law', law: 'mercantile' }, T0)).toMatch(/no free law slot/);
    expect(queueFree(s, 0, { type: 'revoke', law: 'bastion' })).toBeNull();
    expect(queueOrder(s, 0, { type: 'law', law: 'mercantile' }, T0)).toBeNull();
    const next = runTick(s, () => false);
    expect(next.players[0].laws).toEqual(['mercantile']);
  });

  it('validates against a queued blueprint change: Refit becomes possible', () => {
    const s = liveGame();
    rich(s, 0);
    s.players[0].techs = ['railguns'];
    const f = myFleet(s, 0);
    f.region = s.players[0].capital;
    for (const sh of f.ships) sh.mod = 'armor';
    expect(queueOrder(s, 0, { type: 'refit', fleet: f.id }, T0)).toMatch(/up to date/);
    expect(queueFree(s, 0, { type: 'blueprint', cls: f.ships[0].cls, mod: 'railgun' })).toBeNull();
    expect(queueOrder(s, 0, { type: 'refit', fleet: f.id }, T0)).toBeNull();
    expect(queueOrder(s, 0, { type: 'refit', fleet: f.id }, T0)).toMatch(/up to date/);   // once is enough
  });

  it('per-fleet limits reset at a cycle boundary: a fleet that was exhausted last cycle may act at the next tick', () => {
    const s = liveGame();
    const f = myFleet(s, 0);
    f.ordersThisTurn = s.rules.orders.maxPerFleet;
    s.live!.tick = 3;                       // mid-cycle: still exhausted
    expect(queueOrder(s, 0, { type: 'fortify', fleet: f.id }, T0)).toMatch(/at most/);
    s.live!.tick = ticksPerCycle(s);        // the next tick opens a new cycle (resets the counter first)
    expect(queueOrder(s, 0, { type: 'fortify', fleet: f.id }, T0)).toBeNull();
  });

  it('cancel refunds and refuses bad indices', () => {
    const s = liveGame();
    const n = s.live!.bank[0];
    expect(queueOrder(s, 0, { type: 'fortify', fleet: myFleet(s, 0).id }, T0)).toBeNull();
    expect(cancelQueued(s, 0, 0.5)).toBe(false);
    expect(cancelQueued(s, 0, 0)).toBe(true);
    expect(s.live!.bank[0]).toBe(n);
  });
});

describe('LIVE: free actions', () => {
  it('dedupes research and refuses what would fail anyway (one per cycle, prerequisites, money)', () => {
    const s = liveGame();
    rich(s, 0);
    expect(queueFree(s, 0, { type: 'research', tech: 'railguns' })).toBeNull();
    expect(queueFree(s, 0, { type: 'research', tech: 'railguns' })).toMatch(/already queued/);
    expect(queueFree(s, 0, { type: 'research', tech: 'deflectors' })).toMatch(/one technology/);
    expect(queueFree(s, 0, { type: 'research', tech: 'batteries' })).toMatch(/needs a tier I/);
    expect(s.live!.free[0]).toHaveLength(1);
    const t = liveGame();
    t.players[0].res = { industry: 0, credits: 0, influence: 0 };
    expect(queueFree(t, 0, { type: 'research', tech: 'railguns' })).toMatch(/not enough/);
    expect(t.live!.free[0] ?? []).toHaveLength(0);
  });

  it('a re-issued blueprint replaces the earlier one', () => {
    const s = liveGame();
    queueFree(s, 0, { type: 'blueprint', cls: 'corvette', mod: 'armor' });
    queueFree(s, 0, { type: 'blueprint', cls: 'corvette', mod: 'armor' });
    queueFree(s, 0, { type: 'blueprint', cls: 'frigate', mod: 'armor' });
    expect(s.live!.free[0]).toHaveLength(2);
  });

  it('refuses to merge away a fleet that has orders waiting', () => {
    const s = liveGame();
    const f = myFleet(s, 0);
    expect(queueOrder(s, 0, { type: 'fortify', fleet: f.id }, T0)).toBeNull();
    expect(queueFree(s, 0, { type: 'merge', fleet: f.id, into: f.id + 999 })).toMatch(/orders waiting/);
  });

  it('refuses free actions once the game is over or the player is out', () => {
    const s = liveGame();
    s.players[0].eliminated = true;
    expect(queueFree(s, 0, { type: 'research', tech: 'railguns' })).toMatch(/eliminated/);
    s.winner = 1;
    expect(queueFree(s, 1, { type: 'research', tech: 'railguns' })).toMatch(/over/);
  });
});

describe('LIVE: ticks', () => {
  it('runTick never mutates the state it is given (a failed tick must not leave AI orders queued)', () => {
    const s = liveGame(5, ['human', 'ai', 'ai']);
    queueOrder(s, 0, { type: 'fortify', fleet: myFleet(s, 0).id }, T0);
    const before = JSON.stringify(s);
    runTick(s, () => true);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('a capped catch-up in several calls gives exactly the same game as one uninterrupted catch-up', () => {
    const now = T0 + tickMs(liveGame()) * 30 + 5;
    const one = advanceTo(liveGame(5, ['ai', 'ai', 'ai']), now, () => true).state;
    let st = liveGame(5, ['ai', 'ai', 'ai']);
    for (let i = 0; i < 20 && st.live!.tick < 30; i++) st = advanceTo(st, now, () => true, 4).state;
    expect(st.live!.tick).toBe(30);
    expect(JSON.stringify(st)).toBe(JSON.stringify(one));
  });

  it('keeps the ticks that resolved when a later one throws, and reports the error', () => {
    const s = liveGame(5, ['ai', 'ai', 'ai']);
    let calls = 0;
    const isAI = () => { if (++calls > 6) throw new Error('boom'); return true; };   // 3 seats per tick: tick 3 throws
    const r = advanceTo(s, T0 + tickMs(s) * 10 + 1, isAI);
    expect(r.error).toBeInstanceOf(Error);
    expect(r.results).toHaveLength(2);
    expect(r.state.live!.tick).toBe(2);
    expect(s.live!.tick).toBe(0);   // the input is untouched
  });

  it('a fleet knocked off its route (retreat, guard move) stops instead of jumping to a non-adjacent region', () => {
    const s = liveGame(3, ['human', 'human', 'human']);
    const f = myFleet(s, 0);
    const next = s.regions[f.region].neighbors[0];
    // somewhere not adjacent to `next` (and not `next` itself), where it might have retreated to
    const away = s.regions.find(r => r.id !== next && !s.regions[next].neighbors.includes(r.id) && r.kind !== 'void')!.id;
    f.route = { path: [next], seize: null, mp: s.rules.live.stepCost * 5 };
    f.region = away;
    const t = runTick(s, () => false);
    const g = t.fleets.find(x => x.id === f.id)!;
    expect(g.region).toBe(away);
    expect(g.route ?? null).toBeNull();
  });

  it('degenerate clock rules cannot stall the clock or stop cycles from ending', () => {
    const s = liveGame(3, ['ai', 'ai', 'ai']);
    s.rules.live.tickMinutes = 0;
    s.rules.live.ticksPerCycle = 0;
    expect(tickMs(s)).toBeGreaterThan(0);
    const t = runTick(s, () => true);
    expect(t.turn).toBe(2);           // every tick is a whole cycle
    expect(Number.isFinite(t.last!.events.find(e => e.k === 'pulse')!.pulse)).toBe(true);
  });

  it('AI seats keep spending orders when their preferred order is impossible', () => {
    const s = liveGame(5, ['ai', 'ai', 'ai']);
    for (const p of s.players) p.res = { industry: 0, credits: 0, influence: 0 };   // nothing costly is affordable
    s.rules.economy.creditsPerIndustry = 0;
    const bank = s.live!.bank.slice();
    const t = runTick(s, () => true);
    // movement/fortify cost nothing, so every AI with a free fleet still acts
    expect(t.live!.bank.some((b, i) => b < bank[i])).toBe(true);
  });
});

describe('LIVE: fog', () => {
  it("an older tick of the current cycle is filtered with that tick's coverage, not today's", () => {
    let s = liveGame(3, ['human', 'human', 'human']);
    for (let i = 0; i < 3; i++) s = runTick(s, () => false);
    expect(s.last!.turn).toBe(s.turn);
    const cov = coverage(s, 0);
    const watched = [...cov].find(r => s.regions[r].owner !== 0)!;
    // an earlier tick, before player 0 could see that region (no fleets, owned nothing then)
    const older: TurnResult = {
      turn: s.turn, tick: 1, battles: [], signals: [], startFleets: [], startOwners: s.regions.map(r => (r.owner === 0 ? 1 : r.owner)),
      events: [{ k: 'build', pulse: 1, region: watched, owner: 1, cls: 'corvette', fleet: 999, name: 'X' }],
    };
    expect(filterResultFor(s, older, 0).events.some(e => e.k === 'build')).toBe(false);
    // the most recent tick itself still uses end-of-tick coverage
    const last = { ...older, tick: s.last!.tick };
    expect(filterResultFor({ ...s, last }, last, 0).events.some(e => e.k === 'build')).toBe(true);
    // filtered results keep their tick number (the client tells ticks of a cycle apart by it)
    expect(viewFor(s, 0).state.last!.tick).toBe(s.last!.tick);
    expect(filterResultFor(s, older, 0).tick).toBe(1);
  });

  it("hides rivals' supply state, order counts and influence targets", () => {
    const s = liveGame(3, ['human', 'human', 'human']);
    const rival = myFleet(s, 1);
    rival.region = s.players[0].capital;   // right in front of player 0's sensors
    rival.oos = 2;
    rival.ordersThisTurn = 2;
    s.turnStats.influenced = ['1:5', '0:7', '2:9'];
    const v = viewFor(s, 0).state;
    const seen = v.fleets.find(f => f.id === rival.id)!;
    expect(seen).toBeTruthy();
    expect(seen.oos).toBeUndefined();
    expect(seen.ordersThisTurn).toBe(0);
    expect(v.turnStats.influenced).toEqual(['0:7']);
    expect(viewFor(s, 1).state.fleets.find(f => f.id === rival.id)!.oos).toBe(2);   // the owner still sees it
  });

  it('a battle raging inside a nebula is not visible from outside it', () => {
    for (let seed = 1; seed < 40; seed++) {
      const s = liveGame(seed, ['human', 'human', 'human']);
      const cov = coverage(s, 0);
      const neb = s.regions.find(r => r.feature === 'nebula' && cov.has(r.id) && r.owner !== 0 && !s.fleets.some(f => f.owner === 0 && f.region === r.id));
      if (!neb || !s.rules.sensors.nebulaHidesFleets) continue;
      s.engagements = [{ id: 1, region: neb.id, name: 'Battle', startedTurn: 1, startedPulse: 1, rounds: 1, forceAt: 9, startHp: {}, fleets: [], owners: [1, 2], hulls: {}, cmds: {}, losses: {}, lastStand: [], firstBlood: false, garrisonStart: 0 }];
      expect(viewFor(s, 0).state.engagements).toHaveLength(0);
      return;
    }
  });
});
