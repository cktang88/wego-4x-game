// Regression tests for turn-resolution / combat / scoring bugs (resolve.ts, combat.ts).
import { describe, expect, it } from 'vitest';
import { createGame } from '../shared/sim/setup.ts';
import { resolveTurn, emptySubmission } from '../shared/sim/resolve.ts';
import { makeLive, runTick } from '../shared/sim/live.ts';
import { planTurn } from '../shared/sim/ai.ts';
import { newFleet, newShip } from '../shared/sim/setup.ts';
import { Rng } from '../shared/sim/rng.ts';
import type { Engagement, FreeAction, GameState, Submission } from '../shared/sim/types.ts';

const game = (seed = 11) => createGame({ seed, players: [0, 1, 2].map(() => ({ kind: 'human' as const })) });
const idle = (s: GameState): Record<number, Submission> => {
  const out: Record<number, Submission> = {};
  for (const p of s.players) out[p.id] = emptySubmission(s);
  return out;
};
const withFree = (s: GameState, free: Record<number, FreeAction[]>) => {
  const out = idle(s);
  for (const [p, f] of Object.entries(free)) out[Number(p)].free = f;
  return out;
};
const rich = (s: GameState) => { for (const p of s.players) p.res = { industry: 900, credits: 900, influence: 100 }; };
const bfs = (s: GameState, from: number) => {
  const d = new Map([[from, 0]]); const q = [from];
  while (q.length) { const r = q.shift()!; for (const n of s.regions[r].neighbors) if (!d.has(n)) { d.set(n, d.get(r)! + 1); q.push(n); } }
  return d;
};
/** A plain unowned colony at least `k` hops from every capital (or from `pid`'s capital only). */
const farColony = (s: GameState, k: number, pid?: number) => {
  const ds = s.players.filter(p => pid === undefined || p.id === pid).map(p => bfs(s, p.capital));
  return s.regions.find(r => r.kind === 'colony' && r.owner === null && ds.every(d => (d.get(r.id) ?? 99) >= k))!;
};
const fleetAt = (s: GameState, owner: number, region: number, classes: string[]) => {
  const rng = new Rng(owner * 7 + region + 1);
  const f = newFleet(s, rng, owner, region);
  for (const c of classes) f.ships.push(newShip(s, rng, c, owner));
  f.bornTurn = 0;
  return f;
};

describe('resolve: seat fairness & eliminated players', () => {
  it('a simultaneous race for a ★ technology does not always go to seat 0', () => {
    const s = game(); rich(s);
    for (const p of [0, 1]) s.players[p].techs = ['trade', 'bureaucracy', 'markets'];
    // turn 1: seat rotation starts with seat 1
    const n = resolveTurn(s, withFree(s, { 0: [{ type: 'research', tech: 'mandate' }], 1: [{ type: 'research', tech: 'mandate' }] }));
    const owners = n.players.filter(p => p.techs?.includes('mandate')).map(p => p.id);
    expect(owners).toEqual([1]);
  });

  it('an eliminated player cannot take actions (e.g. grab a ★ technology)', () => {
    const s = game(); rich(s);
    s.players[2].eliminated = true;
    s.players[2].techs = ['trade', 'bureaucracy', 'markets'];
    const n = resolveTurn(s, withFree(s, { 2: [{ type: 'research', tech: 'mandate' }] }));
    expect(n.players[2].techs).not.toContain('mandate');
  });
});

describe('resolve: free actions during a battle', () => {
  it('splitting a fleet mid-battle does not trick the original into retreating', () => {
    const s = game();
    s.rules.combat.forceDecision = false;
    const rid = farColony(s, 2).id;
    s.regions[rid].garrison = 0; s.regions[rid].baseGarrison = 0;
    const mine = fleetAt(s, 0, rid, ['frigate', 'frigate', 'frigate', 'frigate', 'frigate']);
    mine.doctrine = { stance: 'aggressive', retreatAt: 0.35, target: 'weakest', guard: false };
    const foe = fleetAt(s, 1, rid, ['frigate', 'frigate']);
    foe.doctrine = { stance: 'aggressive', retreatAt: 0, target: 'weakest', guard: false };
    for (const f of [mine, foe]) for (const sh of f.ships) sh.sys.weapons = false;   // a stalemate: nobody gets hurt
    const hp = mine.ships.reduce((a, x) => a + x.hp, 0);
    const eng: Engagement = { id: 9999, region: rid, name: 'Test', startedTurn: 1, startedPulse: 1, rounds: 3, forceAt: 999,
      startHp: { [mine.id]: hp, [foe.id]: 20 }, fleets: [mine.id, foe.id], owners: [0, 1], hulls: { 0: 5, 1: 2 }, cmds: {}, losses: {}, lastStand: [], firstBlood: false, garrisonStart: 0 };
    s.engagements.push(eng);
    const split = mine.ships.slice(0, 4).map(x => x.id);    // 80% of the hull leaves into a new fleet
    const n = resolveTurn(s, withFree(s, { 0: [{ type: 'split', fleet: mine.id, ships: split }] }));
    const retreats = n.last!.events.filter(e => e.k === 'retreat' && e.owner === 0);
    expect(retreats).toEqual([]);
    expect(n.fleets.find(f => f.id === mine.id)!.region).toBe(rid);
    const E = n.engagements.find(e => e.region === rid)!;
    const nf = n.fleets.find(f => f.owner === 0 && f.region === rid && f.id !== mine.id)!;
    expect(E.startHp[mine.id] + E.startHp[nf.id]).toBe(hp);
    expect(E.hulls[0]).toBe(5);                             // not counted twice as a "reinforcement"
  });

  it('split keeps the out-of-supply counter (no reset exploit)', () => {
    const s = game();
    const rid = farColony(s, 2, 0).id;
    const f = fleetAt(s, 0, rid, ['frigate', 'frigate']);
    f.oos = 3;
    const n = resolveTurn(s, withFree(s, { 0: [{ type: 'split', fleet: f.id, ships: [f.ships[0].id] }] }));
    const mine = n.fleets.filter(x => x.owner === 0 && x.region === rid);
    expect(mine.length).toBe(2);
    for (const x of mine) expect(x.oos).toBe(4);
  });
});

describe('resolve: Warden', () => {
  it('whoever kills the Warden gets the VP even if the battle rages on between players', () => {
    const s = game();
    s.rules.combat.forceDecision = false;
    const rid = farColony(s, 2).id;
    s.regions[rid].garrison = 0; s.regions[rid].baseGarrison = 0;
    s.wardenAwake = true;
    const w = fleetAt(s, 0, rid, ['frigate']);
    w.owner = -1; w.ships[0].hp = 1; w.name = 'The Warden';
    for (const p of [0, 1]) {
      const f = fleetAt(s, p, rid, ['frigate', 'frigate', 'frigate']);
      f.doctrine = { stance: 'aggressive', retreatAt: 0, target: 'weakest', guard: false };
      for (const sh of f.ships) { sh.hp = sh.maxHp = 5000; }
    }
    const n = resolveTurn(s, idle(s));
    expect(n.wardenDefeated).toBe(true);
    expect(n.engagements.some(e => e.region === rid)).toBe(true);   // the players are still fighting
    const got = n.players.filter(p => p.vpLog.some(x => x.why === 'Destroyed the Warden'));
    expect(got.length).toBe(1);
  });
});

describe('resolve: sieges, pacts, supply', () => {
  it('a lingering siege never captures a pact partner\'s region without a betrayal', () => {
    const s = game();
    const r = s.regions.find(x => x.kind === 'colony' && x.owner === null)!;
    r.owner = 0; r.garrison = 0; r.baseGarrison = 0;
    const f = fleetAt(s, 1, r.id, ['frigate']);
    f.siege = r.id;
    s.pacts.push({ a: 0, b: 1, until: 99 });
    const n = resolveTurn(s, idle(s));
    expect(n.regions[r.id].owner).toBe(0);
    expect(n.players[1].vpLog.some(x => /pact/i.test(x.why))).toBe(false);
  });

  it('fleets out of supply do not repair, even in a region they own', () => {
    const s = game();
    const r = farColony(s, 2, 0);
    r.owner = 0; r.garrison = 3;
    const f = fleetAt(s, 0, r.id, ['frigate']);
    f.ships[0].hp = 2;
    const n = resolveTurn(s, idle(s));
    expect(n.fleets.find(x => x.id === f.id)!.ships[0].hp).toBe(2);
    // ...while one at home repairs as usual
    const s2 = game();
    const g = s2.fleets.find(x => x.owner === 0)!;
    g.ships[0].hp = 2;
    const n2 = resolveTurn(s2, idle(s2));
    expect(n2.fleets.find(x => x.id === g.id)!.ships[0].hp).toBeGreaterThan(2);
  });

  it('capturing an Academy from a save with an unknown technology id does not crash', () => {
    const s = game();
    const r = s.regions.find(x => x.kind === 'colony' && x.owner === null)!;
    r.owner = 1; r.garrison = 0; r.baseGarrison = 0; r.buildings.academy = 1;
    s.players[1].techs = ['retired_tech', 'railguns'];
    const f = fleetAt(s, 0, r.id, ['frigate']);
    f.siege = r.id;
    const n = resolveTurn(s, idle(s));
    expect(n.regions[r.id].owner).toBe(0);
    expect(n.players[0].techs).toContain('railguns');
  });

  it('a project with an unknown key (old save) is dropped instead of crashing', () => {
    const s = game();
    const cap = s.regions[s.players[0].capital];
    cap.project = { key: 'retired_project', progress: 0, owner: 0 };
    const n = resolveTurn(s, idle(s));
    expect(n.regions[cap.id].project).toBeNull();
  });
});

describe('resolve: orders under fire', () => {
  it('Refit (a free full heal) fails with enemies in the region', () => {
    const s = game();
    const cap = s.players[0].capital;
    const f = s.fleets.find(x => x.owner === 0 && x.region === cap)!;
    f.ships[0].hp = 1;
    fleetAt(s, 1, cap, ['frigate']);
    const sub = idle(s);
    sub[0].orders[0] = { type: 'refit', fleet: f.id };
    const n = resolveTurn(s, sub);
    expect(n.last!.events.some(e => e.k === 'refit')).toBe(false);
    expect(n.last!.events.some(e => e.k === 'fail' && e.owner === 0 && /enemies present/.test(e.text))).toBe(true);
  });

  it('a guard fleet locked in a siege battle does not slip away to answer a call', () => {
    const s = game();
    const cap = s.players[0].capital;
    const ns = s.regions[cap].neighbors.filter(n => s.regions[n].owner === null && s.regions[n].kind !== 'void');
    const [nId, xId] = ns;
    const N = s.regions[nId];
    N.garrison = 500; N.baseGarrison = 500;
    const g = fleetAt(s, 0, nId, ['frigate', 'frigate']);
    g.siege = nId; g.doctrine = { stance: 'aggressive', retreatAt: 0, target: 'weakest', guard: true };
    for (const sh of g.ships) sh.hp = sh.maxHp = 5000;
    s.engagements.push({ id: 9998, region: nId, name: 'Siege', startedTurn: 1, startedPulse: 1, rounds: 1, forceAt: 999,
      startHp: { [g.id]: 10000 }, fleets: [g.id], owners: [0], hulls: { 0: 2 }, cmds: {}, losses: {}, lastStand: [], firstBlood: false, garrisonStart: 500 });
    const e = fleetAt(s, 1, xId, ['frigate']);
    const sub = idle(s);
    sub[1].orders[0] = { type: 'move', fleet: e.id, path: [cap] };
    const n = resolveTurn(s, sub);
    expect(n.last!.events.some(ev => ev.k === 'move' && ev.fleet === g.id)).toBe(false);
    expect(n.fleets.find(x => x.id === g.id)!.region).toBe(nId);
  });
});

describe('resolve: per-turn bookkeeping', () => {
  it('the research counter is back to 0 once the turn is over (planning reads the real state)', () => {
    const s = game(); rich(s);
    const n = resolveTurn(s, withFree(s, { 0: [{ type: 'research', tech: 'railguns' }] }));
    expect(n.players[0].techs).toContain('railguns');
    expect(n.players[0].researched).toBe(0);
  });

  it('revoking a law is remembered for the turn/cycle (revokedThisTurn) and forgotten when it ends', () => {
    // LIVE: a mid-cycle tick shows the in-turn state
    let s = makeLive(game(5), 1_700_000_000_000, 1); rich(s);
    s.players[0].laws = ['bastion'];
    s.live!.free[0] = [{ type: 'revoke', law: 'bastion' }];
    s = runTick(s, () => false);
    expect(s.players[0].laws).toEqual([]);
    expect(s.players[0].revokedThisTurn).toEqual(['bastion']);
    for (let i = 1; i < s.rules.live.ticksPerCycle; i++) s = runTick(s, () => false);
    expect(s.players[0].revokedThisTurn).toEqual([]);
    // WEGO: cleared once the turn is over
    const w = game(); rich(w);
    w.players[0].laws = ['bastion'];
    const n = resolveTurn(w, withFree(w, { 0: [{ type: 'revoke', law: 'bastion' }] }));
    expect(n.players[0].laws).toEqual([]);
    expect(n.players[0].revokedThisTurn).toEqual([]);
  });

  it('a Seize that lists its own leading fleet among the joiners still takes MAX_JOINERS other fleets', () => {
    const s = game();
    const cap = s.players[0].capital;
    const t = s.regions.find(r => s.regions[cap].neighbors.includes(r.id) && r.owner === null && r.kind !== 'void')!;
    t.garrison = 900; t.baseGarrison = 900;
    for (const f of s.fleets.filter(x => x.owner === 0)) f.region = -1 as any;   // park the starting fleets out of the way
    s.fleets = s.fleets.filter(x => x.owner !== 0);
    const fs = [0, 1, 2, 3].map(() => fleetAt(s, 0, cap, ['frigate']));
    for (const f of fs) for (const sh of f.ships) sh.hp = sh.maxHp = 5000;
    const sub = idle(s);
    sub[0].orders[0] = { type: 'seize', fleet: fs[0].id, target: t.id, also: [fs[0].id, fs[1].id, fs[2].id, fs[3].id] };
    const n = resolveTurn(s, sub);
    for (const f of fs) expect(n.fleets.find(x => x.id === f.id)!.region).toBe(t.id);
  });

  it('out-of-supply attrition spares fleets defending a region their owner holds', () => {
    const s = game();
    const r = farColony(s, 2, 0);
    r.owner = 0; r.garrison = 3;
    const home = fleetAt(s, 0, r.id, ['frigate']);
    home.oos = 5; home.ships[0].hp = 6;
    const away = farColony(s, 2, 0);
    away.garrison = 0; away.baseGarrison = 0;
    const lost = fleetAt(s, 0, away.id, ['frigate']);
    lost.oos = 5; lost.ships[0].hp = 6;
    const n = resolveTurn(s, idle(s));
    expect(n.fleets.find(x => x.id === home.id)!.ships[0].hp).toBe(6);
    expect(n.fleets.find(x => x.id === lost.id)!.ships[0].hp).toBeLessThan(6);
  });
});

describe('resolve: crowns', () => {
  it('the all-crowns warning counts down correctly', () => {
    const s = game();
    for (const r of s.regions.filter(x => x.kind === 'crown')) { r.owner = 0; r.garrison = 30; }
    const n = resolveTurn(s, idle(s));
    expect(n.crownHold).toEqual({ owner: 0, turns: 1 });
    const msg = n.chronicle.find(c => /ALL THREE CROWNS/.test(c.text))!.text;
    expect(msg).not.toMatch(/end of next turn/);
    expect(msg).toMatch(/2 more turns/);
    expect(n.winner).toBeNull();
  });
});

describe('resolve: LIVE mode', () => {
  const T0 = 1_700_000_000_000;
  const liveGame = () => makeLive(game(5), T0, 1);

  it('the turn limit ends the game at the end of the last cycle, not on its first tick', () => {
    let s = liveGame();
    s.rules.victory.turnLimit = 1;
    const ticks = s.rules.live.ticksPerCycle;
    for (let i = 0; i < ticks - 1; i++) {
      s = runTick(s, () => false);
      expect(s.winner).toBeNull();
    }
    s = runTick(s, () => false);
    expect(s.winner).not.toBeNull();
  });

  it('a travelling fleet that was displaced (retreat / guard) never jumps to a non-adjacent region', () => {
    const s = liveGame();
    const f = s.fleets.find(x => x.owner === 0)!;
    const d = bfs(s, f.region);
    const far = [...d].find(([, h]) => h === 3)![0];
    f.route = { path: [far], seize: null, mp: 999 };
    const n = runTick(s, () => false);
    const g = n.fleets.find(x => x.id === f.id)!;
    expect(g.region).toBe(f.region);
    expect(g.route).toBeNull();
  });

  it('a seize route is finished once the fleet arrives (no second siege step next tick)', () => {
    let s = liveGame();
    const f = s.fleets.find(x => x.owner === 0)!;
    const t = s.regions.find(r => s.regions[f.region].neighbors.includes(r.id) && r.owner === null)!;
    f.route = { path: [t.id], seize: t.id, mp: 999 };
    s = runTick(s, () => false);
    const g = s.fleets.find(x => x.id === f.id)!;
    expect(g.region).toBe(t.id);
    expect(g.route ?? null).toBeNull();
  });
});

describe('resolve: purity', () => {
  it('resolveTurn never mutates the previous state (WEGO turns and LIVE ticks, with battles)', () => {
    let s = game(21);
    for (let t = 0; t < 14 && s.winner === null; t++) {
      const sub: Record<number, Submission> = {};
      for (const p of s.players) sub[p.id] = planTurn(s, p.id);
      const before = JSON.stringify(s);
      const n = resolveTurn(s, sub);
      expect(JSON.stringify(s)).toBe(before);
      s = n;
    }
    let l = makeLive(game(22), 1_700_000_000_000, 360);
    for (let t = 0; t < 20; t++) {
      const before = JSON.stringify({ ...l, live: undefined });
      const n = resolveTurn(l, idle(l), { pulse: 1, newCycle: t % 8 === 0, endCycle: t % 8 === 7 });
      expect(JSON.stringify({ ...l, live: undefined })).toBe(before);
      l = n;
    }
  });
});

describe('resolve bugs: pact answers', () => {
  it('answering last turn\'s pact offer forms the pact; both offering in one turn still works', async () => {
    const { createGame } = await import('../shared/sim/setup.ts');
    const { resolveTurn, emptySubmission } = await import('../shared/sim/resolve.ts');
    let s = createGame({ seed: 3, players: [0, 1, 2].map(() => ({ kind: 'human' as const })) });
    const sub = (orders: any[]) => ({ orders: [...orders, null, null, null, null].slice(0, 5), free: [] });
    s = resolveTurn(s, { 0: sub([{ type: 'pact', with: 1 }]), 1: emptySubmission(s), 2: emptySubmission(s) });
    expect(s.pacts.length).toBe(0);
    s = resolveTurn(s, { 0: emptySubmission(s), 1: sub([{ type: 'pact', with: 0 }]), 2: emptySubmission(s) });
    expect(s.pacts.some(p => p.a === 0 && p.b === 1)).toBe(true);
    // an answer two turns late does not
    let t = createGame({ seed: 3, players: [0, 1, 2].map(() => ({ kind: 'human' as const })) });
    t = resolveTurn(t, { 0: sub([{ type: 'pact', with: 2 }]), 1: emptySubmission(t), 2: emptySubmission(t) });
    t = resolveTurn(t, { 0: emptySubmission(t), 1: emptySubmission(t), 2: emptySubmission(t) });
    t = resolveTurn(t, { 0: emptySubmission(t), 1: emptySubmission(t), 2: sub([{ type: 'pact', with: 0 }]) });
    expect(t.pacts.length).toBe(0);
  });
});
