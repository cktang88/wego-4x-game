// Star systems, steps 3-4 (docs/SYSTEMS.md): Contested / Occupied / Tribute output sharing, refugees, Scorched Earth
// precedence, the body-tagged ledger, battle names, body tags and Calling gates; determinism and old-rules compatibility.
import { describe, expect, it } from 'vitest';
import { createGame, newFleet, newShip } from '../shared/sim/setup.ts';
import { resolveTurn, emptySubmission, incomeDetail, regionYield } from '../shared/sim/resolve.ts';
import { connected } from '../shared/sim/empire.ts';
import { viewFor } from '../shared/sim/view.ts';
import { planTurn } from '../shared/sim/ai.ts';
import { Rng } from '../shared/sim/rng.ts';
import { ensureSoul, callingOffer, callingOptions } from '../shared/sim/soul.ts';
import { contestOf, contestOn, systemShares, systemStatus, contestEndTurn, onCaptureContest, tributeBlock, acceptBlock } from '../shared/sim/contest.ts';
import { battleBody, battleName, bodyTag, callingGate, ledgerAdd, taggedBodyName, BODY_STATION } from '../shared/sim/systems.ts';
import type { Fleet, GameState, Region, Submission } from '../shared/sim/types.ts';

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

/** A quiet scene: no starting fleets; a Core (fair world + gas giant + belt with a Mine) owned by house 1. */
function scene(seed = 31, rules?: unknown) {
  const s = game(seed, rules);
  ensureSoul(s);
  s.fleets = s.fleets.filter(f => f.owner < 0);
  // a colony bordering house 1's capital (so it is connected: no cut-off halving muddles the numbers)
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

describe('contested systems: space control (step 3)', () => {
  it('an enemy warship makes a system contested; the larger force holds space; ties go to the owner', () => {
    const { s, r } = scene();
    expect(contestOf(s, r)).toBeNull();
    expect(systemShares(s, r)).toBeNull();   // Held: the owner gets everything
    const a = fleetAt(s, 0, r.id, ['cruiser', 'cruiser']);
    let c = contestOf(s, r)!;
    expect(c.besiegers).toEqual([0]);
    expect(c.holder).toBe(0);                // the owner has no ships here
    const d = fleetAt(s, 1, r.id, ['cruiser', 'cruiser', 'cruiser']);
    expect(contestOf(s, r)!.holder).toBe(1); // the larger force
    d.ships = d.ships.slice(0, 2);
    a.ships = a.ships.slice(0, 2);
    expect(contestOf(s, r)!.holder).toBe(1); // equal: the owner
    // a lone scout or a limping fleet doesn't contest anything
    s.fleets = s.fleets.filter(f => f.owner < 0);
    fleetAt(s, 0, r.id, ['scout']);
    expect(contestOf(s, r)).toBeNull();
    c = null as never; void c;
  });

  it('the winner of the last battle holds space while it is still there, even when smaller', () => {
    const { s, r } = scene();
    fleetAt(s, 0, r.id, ['cruiser', 'cruiser', 'cruiser']);
    const d = fleetAt(s, 1, r.id, ['frigate']);
    expect(contestOf(s, r)!.holder).toBe(0);
    r.spaceWon = { p: 1, turn: s.turn };
    expect(contestOf(s, r)!.holder).toBe(1);
    d.ships = [];                            // it left (or died): the bigger fleet takes space
    s.fleets = s.fleets.filter(f => f.ships.length);
    expect(contestOf(s, r)!.holder).toBe(0);
  });

  it('two hostile besiegers: nobody holds space; allied besiegers split the plunder', () => {
    const { s, r } = scene();
    fleetAt(s, 0, r.id, ['cruiser', 'cruiser']);
    fleetAt(s, 2, r.id, ['cruiser']);
    let c = contestOf(s, r)!;
    expect(c.holder).toBeNull();
    expect(c.plunderers).toEqual([]);
    let sh = systemShares(s, r)!;
    expect(sh.get.get(1)!.o.i).toBe(0);
    expect(sh.get.has(0)).toBe(false);
    s.pacts.push({ a: 0, b: 2, until: s.turn + 5 });
    c = contestOf(s, r)!;
    expect(c.holder).toBe(0);
    expect(c.plunderers).toEqual([0, 2]);
    sh = systemShares(s, r)!;
    const k = s.rules.systems.plunderShare / 2;
    expect(sh.get.get(0)!.o).toEqual({ i: k, c: k, f: k });
    expect(sh.get.get(2)!.o).toEqual({ i: k, c: k, f: k });
  });
});

describe('contested systems: output (step 3)', () => {
  it('orbital output goes to the attacker as 50% plunder; the surface is blockaded (industry/credits 50%, influence 0)', () => {
    const { s, r } = scene();
    const y = regionYield(s, 1, r, connected(s, 1), undefined, true)!;
    expect(y.orbital.c).toBeGreaterThan(0);  // the gas giant
    expect(y.orbital.i).toBeGreaterThan(0);  // the Mine on the belt
    expect(y.industry - y.orbital.i).toBeGreaterThan(0);   // the citizens on Vel II
    const before0 = incomeDetail(s, 0).total, before1 = incomeDetail(s, 1).total;
    fleetAt(s, 0, r.id, ['cruiser', 'cruiser']);
    const sh = systemShares(s, r)!;
    expect(sh.blockaded).toBe(true);
    const Y = s.rules.systems;
    expect(sh.get.get(1)!.o).toEqual({ i: 0, c: 0, f: 0 });
    expect(sh.get.get(1)!.s).toEqual({ i: Y.blockadeIndustry, c: Y.blockadeCredits, f: Y.blockadeInfluence });
    const after0 = incomeDetail(s, 0).total, after1 = incomeDetail(s, 1);
    expect(Math.abs((after0.credits - before0.credits) - y.orbital.c * Y.plunderShare)).toBeLessThanOrEqual(1);
    expect(Math.abs((after0.industry - before0.industry) - y.orbital.i * Y.plunderShare)).toBeLessThanOrEqual(1);
    // the owner keeps half its surface industry and credits, none of its orbital output, no influence from here
    const keepI = (y.industry - y.orbital.i) * Y.blockadeIndustry, keepC = (y.credits - y.orbital.c) * Y.blockadeCredits;
    expect(Math.abs((before1.industry - after1.total.industry) - (y.industry - keepI))).toBeLessThanOrEqual(1);
    expect(Math.abs((before1.credits - after1.total.credits) - (y.credits - keepC))).toBeLessThanOrEqual(1);
    expect(after1.why.some(w => w.includes('blockaded'))).toBe(true);
    expect(incomeDetail(s, 0).why.some(w => w.includes('plunder'))).toBe(true);
  });

  it('the owner holding space: no blockade, no plunder (only growth pauses)', () => {
    const { s, r } = scene();
    fleetAt(s, 0, r.id, ['frigate']);
    fleetAt(s, 1, r.id, ['cruiser', 'cruiser']);
    const sh = systemShares(s, r)!;
    expect(sh.blockaded).toBe(false);
    expect(sh.get.get(1)).toEqual({ o: { i: 1, c: 1, f: 1 }, s: { i: 1, c: 1, f: 1 } });
    expect(sh.get.has(0)).toBe(false);
  });

  it('Scorched Earth still wins over plunder; Levies still idle the whole system', () => {
    const { s, r } = scene();
    fleetAt(s, 0, r.id, ['cruiser', 'cruiser']);
    r.wposture = { kind: 'scorch', turn: s.turn, by: 1 };
    const sh = systemShares(s, r)!;
    expect(sh.scorched).toBe(true);
    expect(sh.get.has(0)).toBe(false);
    r.wposture = null;
    const with0 = incomeDetail(s, 0).total.credits;
    r.idleUntil = s.turn;                     // levies called in vain: nobody gets anything from it
    expect(incomeDetail(s, 0).total.credits).toBeLessThan(with0);
  });
});

describe('refugees, capture and Occupied (step 3)', () => {
  it('every 3 contested turns a citizen flees to the owner\'s nearest system with room (both ledgers record it)', () => {
    const { s, r } = scene();
    const haven = real(s).find(x => x.id !== r.id && x.owner === 1 && x.kind === 'home')!;
    haven.dev = 1;
    fleetAt(s, 0, r.id, ['cruiser', 'cruiser']);
    const ev: unknown[] = [];
    contestEndTurn(s, 1, e => ev.push(e));
    contestEndTurn(s, 1, e => ev.push(e));
    expect(r.contested).toBe(2);
    expect(systemStatus(s, r).refugeesIn).toBe(1);
    expect(r.dev).toBe(3);
    contestEndTurn(s, 1, e => ev.push(e));
    expect(r.dev).toBe(2);
    expect(haven.dev).toBe(2);
    expect(r.story!.ledger!.some(e => e.kind === 'refugees' && e.body === 0)).toBe(true);
    expect(haven.story!.ledger!.some(e => e.kind === 'refuge' && e.text.includes(r.name))).toBe(true);
    expect(s.chronicle.some(c => c.text.startsWith(`Refugees from ${r.name}`))).toBe(true);
    // the enemy leaves: the count resets
    s.fleets = s.fleets.filter(f => f.owner !== 0);
    contestEndTurn(s, 1, () => {});
    expect(r.contested).toBeUndefined();
  });

  it('a capture: the war-scar citizen becomes refugees, the system is Occupied (50% for 3 turns); a scorched one pays nothing', () => {
    const { s, r } = scene();
    r.garrison = 1;
    const haven = real(s).find(x => x.id !== r.id && x.owner === 1 && x.kind === 'home')!;
    haven.dev = 1;
    const f = fleetAt(s, 0, r.id === s.players[0].capital ? r.id : (r.links ?? r.neighbors).find(n => s.regions[n].kind !== 'lane')!, ['cruiser', 'cruiser', 'cruiser']);
    s.regions[f.region].owner = 0; s.regions[f.region].garrison = 10;
    const t = resolveTurn(s, sub(s, 0, [], [{ type: 'seize', fleet: f.id, target: r.id }]));
    const r2 = t.regions[r.id];
    expect(r2.owner).toBe(0);
    expect(r2.dev).toBe(2);
    expect(t.regions[haven.id].dev).toBe(2);
    expect(r2.occupied).toEqual({ by: 0, until: s.turn + t.rules.systems.occupiedTurns });
    expect(r2.story!.ledger!.some(e => e.kind === 'capture')).toBe(true);
    const sh = systemShares(t, r2)!;
    expect(sh.get.get(0)!.o.i).toBe(t.rules.systems.occupiedShare);
    expect(systemStatus(t, r2).occupiedLeft).toBe(t.rules.systems.occupiedTurns - 1);
    // it runs out with the Calling's dormancy
    let u = t;
    for (let i = 0; i < 3; i++) u = resolveTurn(u, idle(u));
    expect(u.regions[r.id].occupied ?? null).toBeNull();
    // Liberation and influence captures are never occupied; a scorched capture pays nothing
    const x = structuredClone(t.regions[r.id]);
    onCaptureContest(t, x, 0, 1, 'force', false, true, false, 1, () => {});
    expect(x.occupied).toBeNull();
    onCaptureContest(t, x, 0, 1, 'influence', false, false, false, 1, () => {});
    expect(x.occupied).toBeNull();
    onCaptureContest(t, x, 0, 1, 'force', false, false, true, 1, () => {});
    expect(x.occupied!.scorched).toBe(true);
    t.regions[r.id] = x;
    expect(systemShares(t, x)!.get.get(0)!.s.i).toBe(0);
  });
});

describe('Tribute (step 3)', () => {
  /** House 0 besieges house 1's system with a fleet that can't break the garrison. */
  function siege() {
    const { s, r } = scene();
    r.garrison = 60;
    const f = fleetAt(s, 0, r.id, ['cruiser', 'cruiser', 'cruiser', 'cruiser']);
    f.siege = r.id;
    return { s, r, f };
  }
  it('offer, then accept the next turn: the siege lifts, they stop fighting there, the attacker takes a third', () => {
    const { s, r, f } = siege();
    expect(tributeBlock(s, 2, r.id)).toMatch(/warships/);
    expect(tributeBlock(s, 1, r.id)).toMatch(/rival/);
    expect(tributeBlock(s, 0, r.id)).toBeNull();
    let t = resolveTurn(s, sub(s, 0, [{ type: 'tribute', region: r.id }]));
    expect(t.players[0].tributeOffers).toEqual([r.id]);
    expect(t.last!.events.some(e => e.k === 'note' && e.owner === 1 && e.text.includes('offers terms'))).toBe(true);
    // only the besieged owner sees the terms
    expect(viewFor(t, 1).state.players[0].tributeOffers).toEqual([r.id]);
    expect(viewFor(t, 2).state.players[0].tributeOffers).toEqual([]);
    expect(t.fleets.some(x => x.id === f.id)).toBe(true);
    // it can't be accepted the same turn it is offered (WEGO), only the next
    expect(acceptBlock(s, 1, r.id)).toMatch(/no terms/);
    const same = resolveTurn(s, { ...sub(s, 0, [{ type: 'tribute', region: r.id }]), 1: { orders: emptySubmission(s).orders, free: [{ type: 'tribute', region: r.id, accept: true }] } });
    expect(same.regions[r.id].tribute ?? null).toBeNull();
    expect(same.last!.events.some(e => e.k === 'fail' && e.owner === 1 && /no terms/.test(e.text))).toBe(true);
    expect(acceptBlock(t, 1, r.id)).toBeNull();
    t = resolveTurn(t, sub(t, 1, [{ type: 'tribute', region: r.id, accept: true }]));
    const r2 = t.regions[r.id];
    expect(r2.tribute).toEqual({ from: 1, to: 0, since: t.turn - 1, until: t.turn - 1 + t.rules.systems.tributeTurns });
    expect(t.fleets.find(x => x.id === f.id)!.siege ?? null).toBeNull();
    expect(t.last!.battles.filter(b => b.region === r.id && b.rounds.length).length).toBe(0);
    expect(r2.story!.ledger!.some(e => e.kind === 'tribute' && e.text === `${r.name} paid tribute to ${t.players[0].name}.`)).toBe(true);
    expect(t.chronicle.some(c => c.text.includes('paid tribute to'))).toBe(true);
    expect(contestOf(t, r2)).toBeNull();
    const sh = systemShares(t, r2)!;
    const k = t.rules.systems.tributeShare;
    expect(sh.get.get(0)!.s.i).toBeCloseTo(k);
    expect(sh.get.get(1)!.s.i).toBeCloseTo(1 - k);
    expect(incomeDetail(t, 0).why.some(w => w.includes('tribute from'))).toBe(true);
    // the Herald prints it (public)
    expect(t.soul!.herald.at(-1)!.headlines.some(h => h.kind === 'tribute')).toBe(true);
    // a quiet turn: still no fighting there
    const u = resolveTurn(t, idle(t));
    expect(u.last!.battles.filter(b => b.region === r.id && b.rounds.length).length).toBe(0);
    expect(u.fleets.find(x => x.id === f.id)!.ships.length).toBe(4);
  });

  it('breaking it (a Seize) counts as breaking a pact: VP, Oathbreaker, betrayal', () => {
    const { s, r, f } = siege();
    let t = resolveTurn(s, sub(s, 0, [{ type: 'tribute', region: r.id }]));
    t = resolveTurn(t, sub(t, 1, [{ type: 'tribute', region: r.id, accept: true }]));
    expect(t.regions[r.id].tribute).toBeTruthy();
    const vp = t.players[0].vp;
    const u = resolveTurn(t, sub(t, 0, [], [{ type: 'seize', fleet: f.id, target: r.id }]));
    expect(u.regions[r.id].tribute ?? null).toBeNull();
    expect(u.players[0].vp).toBe(vp - u.rules.influence.pactBreakVp);
    expect(u.players[0].oathbreaker!.at(-1)!.words).toBe(`${r.name} paid tribute to ${u.players[0].name}`);
    expect(u.last!.events.some(e => e.k === 'betrayal' && e.by === 0 && e.victim === 1)).toBe(true);
    expect(u.last!.battles.some(b => b.region === r.id && b.rounds.length)).toBe(true);
  });

  it('the AI offers terms when it holds space but cannot win, and accepts them when it would otherwise lose', () => {
    const { s, r } = siege();
    s.players[0].kind = 'ai'; s.players[1].kind = 'ai';
    r.garrison = 200; r.buildings.fortress = 2;   // a wall it can't break
    const a = planTurn(s, 0, 'expert');
    expect(a.free.some(x => x.type === 'tribute' && x.region === r.id && !x.accept)).toBe(true);
    // a hopeless defence: a huge besieger, a broken garrison, no relief in reach
    r.garrison = 60; r.buildings.fortress = 0;
    const t = resolveTurn(s, sub(s, 0, [{ type: 'tribute', region: r.id }]));
    t.regions[r.id].garrison = 2; t.regions[r.id].buildings.fortress = 0;
    const d = planTurn(t, 1, 'expert');
    expect(d.free.some(x => x.type === 'tribute' && x.region === r.id && x.accept)).toBe(true);
  });
});

describe('the body-tagged ledger (step 4)', () => {
  it('a siege is fought over the habitable world, an interception at the belt: "Battle of the Ashen Belt (Vel)"', () => {
    const { s, r } = scene();
    expect(battleBody(s, r, true)).toBe(0);
    expect(battleBody(s, r, false)).toBe(2);
    expect(battleName(r, 2, 'Battle', '')).toBe(`Battle of the Ashen Belt (${r.name})`);
    // no habitable world, no Station: a deterministic body
    const x = structuredClone(r);
    x.bodies = [{ kind: 'gas', name: 'Tyr' }, { kind: 'moon', name: 'Nyx' }];
    const b1 = battleBody(s, x, true);
    expect(b1).toBe(battleBody(s, x, true));
    expect([0, 1]).toContain(b1);
    x.buildings.station = 1;
    expect(battleBody(s, x, true)).toBe(BODY_STATION);
    // a real fight between fleets: an interception at the belt, named after it, on the ledger and in the chronicle
    fleetAt(s, 0, r.id, ['cruiser', 'cruiser', 'cruiser']);
    fleetAt(s, 2, r.id, ['frigate']);
    r.garrison = 0;
    const t = resolveTurn(s, idle(s));
    const rep = t.last!.battles.find(b => b.region === r.id)!;
    expect(rep.name).toMatch(new RegExp(`(Battle|Siege) of (the Ashen Belt|Vel II) \\(${r.name}\\)`));
  });

  it('a body earns one tag after 2 events there: "Vel II, the Burned World"', () => {
    const { s, r } = scene();
    ledgerAdd(s, r, { turn: 1, kind: 'battle', text: 'x', body: 0 });
    expect(bodyTag(s, r, 0)).toBeNull();
    ledgerAdd(s, r, { turn: 2, kind: 'battle', text: 'y', body: 0 });
    expect(bodyTag(s, r, 0)).toBe('the Burned World');
    expect(taggedBodyName(s, r, 0)).toBe('Vel II, the Burned World');
    ledgerAdd(s, r, { turn: 3, kind: 'siege', text: 'z', body: 2 });
    ledgerAdd(s, r, { turn: 3, kind: 'siege', text: 'z', body: 2 });
    expect(bodyTag(s, r, 2)).toBe('the Siege Belt');
    expect(bodyTag(s, r, 1)).toBeNull();
    // the ledger is capped
    for (let i = 0; i < 30; i++) ledgerAdd(s, r, { turn: i, kind: 'refuge', text: 'r' });
    expect(r.story!.ledger!.length).toBe(s.rules.systems.ledgerKeep);
  });
});

describe('Calling gates (step 4)', () => {
  it('Granary needs a habitable world; Refinery a belt, gas giant or vein; Oracle a ruin or pulsar; Arsenal a shipyard; Cenotaph 2+ battles', () => {
    const { s, r } = scene();
    expect(callingGate(s, r, 'granary')).toBeNull();
    expect(callingGate(s, r, 'refinery')).toBeNull();
    expect(callingGate(s, r, 'oracle')).toMatch(/ruin or a pulsar/);
    expect(callingGate(s, r, 'arsenal')).toMatch(/shipyard/);
    expect(callingGate(s, r, 'cenotaph')).toMatch(/battles/);
    expect(callingGate(s, r, 'bastion')).toBeNull();
    r.buildings.shipyard = 1; r.battles = 2; r.star = 'pulsar';
    for (const id of ['arsenal', 'cenotaph', 'oracle']) expect(callingGate(s, r, id)).toBeNull();
    r.bodies = [{ kind: 'moon', name: 'Nyx' }];
    expect(callingGate(s, r, 'granary')).toMatch(/habitable/);
    expect(callingGate(s, r, 'refinery')).toMatch(/belt, gas giant or vein/);
  });

  it('the offer always has two valid callings; gated ones are listed with why; the AI picks a valid one', () => {
    const { s, r } = scene();
    r.bodies = [{ kind: 'moon', name: 'Nyx' }];          // no habitable world: no Granary (the colony's trait calling)
    r.battles = 0;
    const off = callingOffer(s, r);
    expect(off.options.length).toBe(2);
    for (const id of off.options) expect(callingGate(s, r, id)).toBeNull();
    expect(off.gated.some(g => g.id === 'granary' && /habitable/.test(g.why))).toBe(true);
    // across real maps: every offer is valid
    for (const seed of [3, 31, 77]) {
      const t = game(seed);
      ensureSoul(t);
      for (const x of real(t)) {
        if (x.kind === 'void') continue;
        x.owner = 0; x.battles = seed % 3;
        const o = callingOffer(t, x);
        expect(o.options.length).toBeGreaterThanOrEqual(1);
        for (const id of o.options) expect(callingGate(t, x, id)).toBeNull();
      }
    }
    // the AI only ever picks one of the offered (valid) options
    let g = createGame({ seed: 12, players: [0, 1, 2].map(() => ({ kind: 'ai' as const, aiLevel: 'expert' as const })) });
    let picked = 0;
    for (let i = 0; i < 12 && g.winner === null; i++) {
      const subs: Record<number, Submission> = {};
      for (const p of g.players) subs[p.id] = planTurn(g, p.id);
      for (const p of g.players) for (const fa of subs[p.id].free) if (fa.type === 'calling') {
        picked++;
        expect(callingGate(g, g.regions[fa.region], String(fa.pick))).toBeNull();
      }
      g = resolveTurn(g, subs);
    }
    expect(picked).toBeGreaterThan(0);
  });
});

describe('determinism and old rules', () => {
  it('a contested siege resolves identically twice', () => {
    const run = () => {
      const { s, r } = scene(44);
      r.garrison = 30;
      const f = fleetAt(s, 0, r.id, ['cruiser', 'cruiser', 'frigate']);
      f.siege = r.id;
      let t = resolveTurn(s, sub(s, 0, [{ type: 'tribute', region: r.id }]));
      for (let i = 0; i < 3; i++) t = resolveTurn(t, idle(t));
      return JSON.stringify([t.regions.map(x => [x.owner, x.dev, x.contested, x.occupied, x.tribute, x.spaceWon, x.story?.ledger]), t.players.map(p => [p.res, p.vp])]);
    };
    expect(run()).toBe(run());
  });

  it('AI games with step 3-4 are deterministic', () => {
    const play = () => {
      let s = createGame({ seed: 8, players: [0, 1, 2].map(() => ({ kind: 'ai' as const, aiLevel: 'expert' as const })) });
      for (let i = 0; i < 10 && s.winner === null; i++) { const subs: Record<number, Submission> = {}; for (const p of s.players) subs[p.id] = planTurn(s, p.id); s = resolveTurn(s, subs); }
      return JSON.stringify({ r: s.regions.map(r => [r.owner, r.dev, r.contested, r.occupied, r.tribute]), p: s.players.map(p => [p.vp, p.res]), c: s.chronicle.length });
    };
    expect(play()).toBe(play());
  });

  it('old maps, rules without systems and contested:false keep the old behaviour', () => {
    // contested switched off: a besieged system pays its owner as before (no plunder, no Occupied)
    const { s, r } = scene(31, { systems: { contested: false } });
    expect(contestOn(s)).toBe(false);
    fleetAt(s, 0, r.id, ['cruiser', 'cruiser']);
    expect(contestOf(s, r)).toBeNull();
    expect(systemShares(s, r)).toBeNull();
    // a map without stars: off, battles named the old way, callings ungated
    const t = game(31);
    ensureSoul(t);
    for (const x of t.regions) { delete x.star; delete x.bodies; }
    const x = real(t).find(y => y.kind === 'colony')!;
    x.owner = 1;
    expect(contestOn(t)).toBe(false);
    expect(battleBody(t, x, true)).toBeUndefined();
    expect(callingGate(t, x, 'oracle')).toBeNull();
    expect(callingOffer(t, x).options).toEqual(callingOptions(t, x));
    expect(callingOffer(t, x).gated).toEqual([]);
    // no systems group at all
    const u = game(31);
    delete (u.rules as { systems?: unknown }).systems;
    expect(contestOn(u)).toBe(false);
  });

  it('an old save from before step 3 (no new fields) loads and plays', () => {
    let s = createGame({ seed: 5, players: [0, 1, 2].map(() => ({ kind: 'ai' as const, aiLevel: 'standard' as const })) });
    for (const p of s.players) { delete p.tributeOffers; delete p.prevTributeOffers; }
    for (let i = 0; i < 4; i++) { const subs: Record<number, Submission> = {}; for (const p of s.players) subs[p.id] = planTurn(s, p.id); s = resolveTurn(s, subs); }
    expect(s.turn).toBe(5);
  });
});

// keep the Region import used (type-only helpers above)
export type _R = Region;
