// Bug sweep: star systems and contested systems (docs/SYSTEMS.md). Each test reproduces a bug found in the sweep.
import { describe, expect, it } from 'vitest';
import { createGame, newFleet, newShip } from '../shared/sim/setup.ts';
import { resolveTurn, emptySubmission } from '../shared/sim/resolve.ts';
import { Rng } from '../shared/sim/rng.ts';
import { ensureSoul } from '../shared/sim/soul.ts';
import { tributeBlock, acceptBlock, contestEndTurn, systemShares, systemStatus } from '../shared/sim/contest.ts';
import { systemsBlock, citizenCap } from '../shared/sim/systems.ts';
import { hostile } from '../shared/sim/combat.ts';
import type { Fleet, GameState, Submission } from '../shared/sim/types.ts';

const game = (seed = 31, rules?: unknown) => createGame({ seed, rules, players: [0, 1, 2].map(() => ({ kind: 'human' as const })) });
const idle = (s: GameState): Record<number, Submission> => Object.fromEntries(s.players.map(p => [p.id, emptySubmission(s)]));
const real = (s: GameState) => s.regions.filter(r => r.kind !== 'lane');
const rng = new Rng(5);
const fleetAt = (s: GameState, owner: number, region: number, classes: string[]): Fleet => {
  const f = newFleet(s, rng, owner, region);
  for (const c of classes) f.ships.push(newShip(s, rng, c, owner));
  f.bornTurn = 0;
  f.banner = { sigil: 'sun', boons: [], banes: [], home: s.players[owner].capital, foundedTurn: 1 };
  f.doctrine = { stance: 'aggressive', retreatAt: 0, target: 'weakest', guard: false };
  for (const sh of f.ships) sh.traits = [];
  return f;
};
function scene(seed = 31, rules?: unknown) {
  const s = game(seed, rules);
  ensureSoul(s);
  s.fleets = s.fleets.filter(f => f.owner < 0);
  const cap = s.regions[s.players[1].capital];
  const r = real(s).find(x => x.kind === 'colony' && x.owner === null && !x.vein && cap.neighbors.includes(x.id))!;
  r.trait = null;
  r.star = 'yellow';
  r.bodies = [{ kind: 'habitable', q: 'fair', name: 'Vel II', adj: 'ocean' }, { kind: 'gas', name: 'Tyr' }, { kind: 'belt', name: 'the Ashen Belt' }];
  r.owner = 1; r.dev = 3; r.heldSince = 1; r.garrison = 40; r.project = null; r.buildings = { mine: 1 };
  if (r.story) { r.story.owners = [{ p: 1, turn: 1, how: 'start' }]; r.story.tenureFrom = 1; }
  return { s, r };
}
const sub = (s: GameState, p: number, free: Submission['free'] = [], orders: Submission['orders'] = []) => {
  const x = idle(s);
  x[p].free = free;
  orders.forEach((o, i) => { x[p].orders[i] = o; });
  return x;
};


/** House 0 besieges house 1's system with a fleet that can't break the garrison; terms offered and accepted. */
function tributeScene() {
  const { s, r } = scene();
  r.garrison = 60;
  const f = fleetAt(s, 0, r.id, ['cruiser', 'cruiser', 'cruiser', 'cruiser']);
  f.siege = r.id;
  let t = resolveTurn(s, sub(s, 0, [{ type: 'tribute', region: r.id }]));
  t = resolveTurn(t, sub(t, 1, [{ type: 'tribute', region: r.id, accept: true }]));
  expect(t.regions[r.id].tribute).toBeTruthy();
  return { t, r: t.regions[r.id], f: t.fleets.find(x => x.id === f.id)! };
}

describe('sweep: Tribute', () => {
  it('a Tribute to an eliminated house ends: it no longer blocks new terms, covers nobody, or pays anyone', () => {
    const { t, r } = tributeScene();
    // house 0 is wiped out mid-tribute (its fleets gone, its systems lost)
    t.fleets = t.fleets.filter(f => f.owner !== 0);
    for (const x of t.regions) if (x.owner === 0) x.owner = 2;
    t.players[0].eliminated = true;
    expect(systemShares(t, r)).toBeNull();
    // a third house besieging the system can offer its own terms
    fleetAt(t, 2, r.id, ['cruiser', 'cruiser']);
    expect(tributeBlock(t, 2, r.id)).toBeNull();
    // the stale record is cleared at the end of the turn, quietly (nobody was paid in full)
    const ev: { k: string; text?: string }[] = [];
    contestEndTurn(t, 1, e => ev.push(e as never));
    expect(r.tribute ?? null).toBeNull();
    expect(ev.some(e => e.k === 'note' && /paid .*in full/.test(e.text ?? ''))).toBe(false);
  });

  it('accepting terms lifts every Seize the offerer had on the system: a fleet still on its way does not break them', () => {
    const { s, r } = scene();
    r.garrison = 60;
    const f = fleetAt(s, 0, r.id, ['cruiser', 'cruiser', 'cruiser', 'cruiser']);
    f.siege = r.id;
    // a second fleet two jumps out, on a standing Seize route to the system
    const links = (id: number) => s.regions[id].links ?? s.regions[id].neighbors;
    const near = links(r.id).find(n => s.regions[n].owner === null && s.regions[n].kind !== 'lane')!;
    const far = links(near).find(n => n !== r.id && !links(r.id).includes(n) && s.regions[n].owner === null)!;
    for (const id of [near, far]) { s.regions[id].garrison = 0; s.regions[id].baseGarrison = 0; s.regions[id].star = 'yellow'; }
    const g = fleetAt(s, 0, far, ['cruiser']);
    let t = resolveTurn(s, sub(s, 0, [{ type: 'tribute', region: r.id }]));
    t.fleets.find(x => x.id === g.id)!.region = far;
    t.fleets.find(x => x.id === g.id)!.route = { path: [near, r.id], seize: r.id, mp: 0 };
    t = resolveTurn(t, sub(t, 1, [{ type: 'tribute', region: r.id, accept: true }]));
    expect(t.regions[r.id].tribute).toBeTruthy();
    expect(t.fleets.find(x => x.id === g.id)!.route?.seize ?? null).toBeNull();
    const vp = t.players[0].vp;
    for (let i = 0; i < 2; i++) t = resolveTurn(t, idle(t));
    expect(t.regions[r.id].tribute).toBeTruthy();
    expect(t.players[0].oathbreaker ?? []).toEqual([]);
    expect(t.players[0].vp).toBeGreaterThanOrEqual(vp);
  });

  it('a Tribute covers only the house that pays it: once the system changes hands it covers nobody', () => {
    const { t, r } = tributeScene();
    expect(hostile(t, 0, 1, r.id)).toBe(false);
    r.owner = 2;   // taken by a third house (onCaptureContest also clears it; here the record is left behind)
    expect(hostile(t, 0, 2, r.id)).toBe(true);
    expect(systemShares(t, r)?.tribute ?? null).toBeNull();
  });
});

describe('sweep: contested systems', () => {
  it('a battle winner who has left a neutral system does not keep holding its space', () => {
    const { s } = scene();
    const n = real(s).find(x => x.owner === null && x.kind === 'colony')!;
    n.spaceWon = { p: 0, turn: s.turn };
    contestEndTurn(s, 1, () => {});
    expect(n.spaceWon ?? null).toBeNull();
  });

  it('refugees switched off (refugeeTurns 0): the status shows no countdown, not NaN', () => {
    const { s, r } = scene(31, { systems: { refugeeTurns: 0 } });
    fleetAt(s, 0, r.id, ['cruiser', 'cruiser']);
    expect(systemStatus(s, r).contested).toBe(true);
    expect(systemStatus(s, r).refugeesIn).toBeNull();
  });
});

describe('sweep: citizens cap', () => {
  it('at the hard cap the Develop block does not suggest a Station (it would not raise it)', () => {
    const { s, r } = scene(31, { world: { enabled: false } });   // Stations: old rules
    r.bodies = [{ kind: 'habitable', q: 'rich', name: 'Vel II' }, { kind: 'moon', name: 'Nyx' }];
    r.star = 'yellow';
    expect(citizenCap(s, r)).toBe(s.rules.systems.maxCitizens);
    r.dev = citizenCap(s, r)!;
    expect(systemsBlock(s, 'develop', r)).not.toMatch(/Station/);
    r.bodies = [{ kind: 'habitable', q: 'fair', name: 'Vel II' }];
    r.dev = citizenCap(s, r)!;
    expect(systemsBlock(s, 'develop', r)).toMatch(/Station raises it/);
  });
});
