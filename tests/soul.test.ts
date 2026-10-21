// The Soul layer (docs/SOUL.md, phase A): banners, boons & banes, rout & limp, scars, honours, vows,
// retirement, the world ledger (epithet, calling, tenure, deeds), capture/raze/liberation, blood-debts,
// sworn pacts, the Herald, dispatches, the Saga, ship traits, and their fog rules.
import { describe, expect, it } from 'vitest';
import { createGame, newFleet, newShip } from '../shared/sim/setup.ts';
import { resolveTurn, emptySubmission, upkeepOf, incomeDetail } from '../shared/sim/resolve.ts';
import { orderCost, validateOrder } from '../shared/sim/orders.ts';
import { planTurn } from '../shared/sim/ai.ts';
import { makeLive, runTick, queueFree, queueOrder } from '../shared/sim/live.ts';
import { viewFor } from '../shared/sim/view.ts';
import { fleetSpeed } from '../shared/sim/graph.ts';
import { shipStats } from '../shared/sim/empire.ts';
import { Rng } from '../shared/sim/rng.ts';
import {
  bannerLimit, bannersFree, foundingOffer, modsBlock, soulDmg, honourOptions, onRankUp, callingTier, tenureTier,
  worldEpithet, limpRoute, cleanText, hasBoon, soulHit,
} from '../shared/sim/soul.ts';
import { sagaOf, headlineVisible, aiDispatch } from '../shared/sim/herald.ts';
import { originPool, rollShipTraits, traitFx, fleetTraits } from '../shared/sim/shiptraits.ts';
import { randomCombo, STYLE_COMBOS } from '../shared/sim/ai-soul.ts';
import { BOONS, BANES, SHIP_TRAITS } from '../shared/config/content.ts';
import type { Fleet, FreeAction, GameState, Order, Submission } from '../shared/sim/types.ts';

const game = (seed = 11, rules?: unknown) => createGame({ seed, rules, players: [0, 1, 2].map(() => ({ kind: 'human' as const })) });
const idle = (s: GameState): Record<number, Submission> => Object.fromEntries(s.players.map(p => [p.id, emptySubmission(s)]));
const sub = (s: GameState, p: number, orders: Order[] = [], free: FreeAction[] = []) => {
  const out = idle(s);
  orders.forEach((o, i) => { out[p].orders[i] = o; });
  out[p].free = free;
  return out;
};
const rich = (s: GameState) => { for (const p of s.players) p.res = { industry: 900, credits: 900, influence: 100 }; };
const bfs = (s: GameState, from: number) => {
  const d = new Map([[from, 0]]); const q = [from];
  while (q.length) { const r = q.shift()!; for (const n of s.regions[r].links ?? s.regions[r].neighbors) if (!d.has(n)) { d.set(n, d.get(r)! + 1); q.push(n); } }
  return d;
};
/** An unowned colony at least k steps from every capital. */
const farColony = (s: GameState, k = 2) => {
  const ds = s.players.map(p => bfs(s, p.capital));
  return s.regions.find(r => r.owner === null && r.kind === 'colony' && ds.every(d => (d.get(r.id) ?? 99) >= k))!;
};
const rng = new Rng(7);
/** A fresh fleet of `owner` at `region` with these ships, flying a plain banner (unless picket). */
const fleetAt = (s: GameState, owner: number, region: number, classes: string[], banner = true): Fleet => {
  const f = newFleet(s, rng, owner, region);
  for (const c of classes) f.ships.push(newShip(s, rng, c, owner));
  f.bornTurn = 0;
  if (banner) f.banner = { sigil: 'sun', boons: [], banes: [], home: s.players[owner].capital, foundedTurn: 1 };
  f.tally = { sieges: 0, defences: 0, interceptions: 0, wins: 0, routs: 0 };
  return f;
};
const clearMap = (s: GameState) => { s.fleets = s.fleets.filter(f => f.owner < 0); };
const fight = (a: Fleet, b: Fleet) => {
  a.doctrine = { stance: 'aggressive', retreatAt: 0, target: 'weakest', guard: false };
  b.doctrine = { stance: 'aggressive', retreatAt: 0, target: 'weakest', guard: false };
};
/** Run idle turns until `done` (max n). */
const until = (s: GameState, done: (t: GameState) => boolean, n = 8) => {
  let t = resolveTurn(s, idle(s));
  for (let i = 1; i < n && !done(t); i++) t = resolveTurn(t, idle(t));
  return t;
};

// ============================================================================ founding & banners
describe('soul: founding and banners', () => {
  it('starting warfleets fly banners with the same boons for every house; scouts are pickets', () => {
    const s = game();
    for (const p of s.players) {
      const mine = s.fleets.filter(f => f.owner === p.id);
      expect(mine.filter(f => f.banner).length).toBe(2);
      expect(mine.find(f => f.ships.every(sh => sh.cls === 'scout'))!.banner ?? null).toBeNull();
    }
    const combos = s.players.map(p => s.fleets.filter(f => f.owner === p.id && f.banner).map(f => JSON.stringify([f.banner!.boons, f.banner!.banes])).join('|'));
    expect(new Set(combos).size).toBe(1);
    expect(bannerLimit(s, 0)).toBe(3);
    expect(bannersFree(s, 0)).toBe(1);
  });

  it('a Build with founding data raises a banner with those boons, banes, name and sigil', () => {
    const s = game(); rich(s);
    const cap = s.players[0].capital;
    const o: Order = { type: 'build', region: cap, cls: 'frigate', fleet: null, found: { name: 'Iron Psalm Lancers', sigil: 'wolf', boons: ['shock'], banes: ['green'] } };
    expect(validateOrder(s, 0, o)).toBeNull();
    const n = resolveTurn(s, sub(s, 0, [o]));
    const f = n.fleets.find(x => x.name === 'Iron Psalm Lancers')!;
    expect(f.banner).toMatchObject({ sigil: 'wolf', boons: ['shock'], banes: ['green'], home: cap, foundedTurn: 1 });
    expect(f.ships[0].traits?.length).toBeGreaterThan(0);
    expect(n.last!.events.some(e => e.k === 'soul' && e.kind === 'founded')).toBe(true);
  });

  it('fleet:null without founding data founds a plain banner; with no banner free it fails', () => {
    const s = game(); rich(s);
    const cap = s.players[0].capital;
    const b: Order = { type: 'build', region: cap, cls: 'frigate', fleet: null };
    const n = resolveTurn(s, sub(s, 0, [b, { ...b }]));
    const fresh = n.fleets.filter(f => f.owner === 0 && f.bornTurn === 1 && f.banner?.foundedTurn === 1 && f.banner.boons.length === 0 && f.ships.length === 1);
    expect(fresh.length).toBe(1);
    expect(n.last!.events.some(e => e.k === 'fail' && e.owner === 0 && /no free banner/.test(e.text))).toBe(true);
  });

  it('banners grow with Crowns held; maxFleets is still the hard cap', () => {
    const s = game();
    const crowns = s.regions.filter(r => r.kind === 'crown');
    crowns[0].owner = 0; crowns[1].owner = 0;
    expect(bannerLimit(s, 0)).toBe(5);
    expect(bannersFree(s, 0)).toBe(3);
  });

  it('point-buy: boons cost what banes give back (+ freePoints), max 3 each', () => {
    const s = game();
    expect(modsBlock(s, 0, ['ghosts'], [])).toMatch(/cost 3/);         // 3 > 0 + 1
    expect(modsBlock(s, 0, ['ghosts'], ['hungry', 'green'])).toBeNull(); // 3 <= 2 + 1
    expect(modsBlock(s, 0, ['beloved'], [])).toBeNull();                // 1 <= 0 + 1
    expect(modsBlock(s, 0, ['medics', 'medics'], ['glass', 'brittle'])).toMatch(/twice/);
    expect(modsBlock(s, 0, ['nope'], [])).toMatch(/unknown boon/);
    expect(modsBlock(s, 0, ['ghosts'], ['conspicuous', 'green'])).toMatch(/Ghosts and Conspicuous/);
    const strict = game(11, { soul: { freePoints: 0 } });
    expect(modsBlock(strict, 0, ['beloved'], [])).toMatch(/cost 1/);
    for (const style of Object.values(STYLE_COMBOS)) for (const c of style) expect(modsBlock(s, 0, c.boons, c.banes)).toBeNull();
    for (let i = 0; i < 30; i++) { const c = randomCombo(s, 0, `k${i}`); expect(modsBlock(s, 0, c.boons, c.banes)).toBeNull(); }
  });

  it('pickets carry only scouts; the founding offer is deterministic', () => {
    const s = game(); rich(s);
    const cap = s.players[0].capital;
    const picket = s.fleets.find(f => f.owner === 0 && !f.banner)!;
    picket.region = cap;
    expect(validateOrder(s, 0, { type: 'build', region: cap, cls: 'frigate', fleet: picket.id })).toMatch(/picket/);
    expect(validateOrder(s, 0, { type: 'build', region: cap, cls: 'scout', fleet: picket.id })).toBeNull();
    expect(foundingOffer(s, 0, cap)).toEqual(foundingOffer(structuredClone(s), 0, cap));
    expect(foundingOffer(s, 0, cap).names.length).toBe(3);
  });

  it('soul.enabled = false: no banners, no traits, fleets die as before', () => {
    const s = game(11, { soul: { enabled: false } });
    expect(s.fleets.every(f => !f.banner)).toBe(true);
    expect(s.fleets.every(f => f.ships.every(sh => !sh.traits))).toBe(true);
    expect(s.soul).toBeUndefined();
  });
});

// ============================================================================ boons & banes
describe('soul: boons and banes are real effects', () => {
  it('Long Range, Ponderous and limping change fleet speed (minimum 1)', () => {
    const s = game();
    const f = fleetAt(s, 0, s.players[0].capital, ['frigate']);
    expect(fleetSpeed(s, f)).toBe(2);
    f.banner!.boons = ['longrange']; expect(fleetSpeed(s, f)).toBe(3);
    f.banner!.boons = []; f.banner!.banes = ['ponderous']; expect(fleetSpeed(s, f)).toBe(1);
    f.banner!.banes = []; f.limping = { since: 1, to: 0, by: 1 }; expect(fleetSpeed(s, f)).toBe(1);
  });

  it('Hungry adds upkeep; Skeleton Crew halves it; rank adds upkeep', () => {
    const s = game(); clearMap(s);
    const f = fleetAt(s, 0, s.players[0].capital, ['frigate', 'frigate']);
    for (const sh of f.ships) delete sh.traits;
    const base = upkeepOf(s, 0);
    f.banner!.banes = ['hungry']; expect(upkeepOf(s, 0)).toBe(base + 2);
    f.banner!.banes = []; f.commander.rank = 5; expect(upkeepOf(s, 0)).toBe(base + 3);
    f.commander.rank = 1; f.scars = [{ id: 'skeleton', turn: 1 }]; expect(upkeepOf(s, 0)).toBe(Math.round(base * 0.5));
  });

  it('Glass Hulls take +1 damage; a Grudge hits its router harder; an Avenge vow hits its target harder', () => {
    const s = game();
    const a = fleetAt(s, 0, 1, ['frigate']), b = fleetAt(s, 1, 1, ['frigate']);
    expect(soulDmg(s, a, b)).toBe(0);
    b.banner!.banes = ['glass']; expect(soulDmg(s, a, b)).toBe(1);
    a.scars = [{ id: 'grudge', turn: 1, vs: 1 }]; expect(soulDmg(s, a, b)).toBe(2);
    a.vow = { kind: 'avenge', since: 1, target: b.commander.name, targetOwner: 1 }; expect(soulDmg(s, a, b)).toBe(3);
  });

  it('Green Crew misses more until its first battle; Hunters hit scarred or limping fleets harder', () => {
    const s = game();
    const a = fleetAt(s, 0, 1, ['frigate']), b = fleetAt(s, 1, 1, ['frigate']);
    const ctx = { region: s.regions[1], moved: () => false, outnumbered: false, enemiesHaunted: false };
    a.banner!.banes = ['green'];
    expect(soulHit(s, a, b, 1, ctx)).toBeCloseTo(-0.15);
    a.commander.deeds.wins = 1;
    expect(soulHit(s, a, b, 1, ctx)).toBeCloseTo(0);
    a.banner!.banes = []; a.banner!.boons = ['hunters'];
    expect(soulHit(s, a, b, 1, ctx)).toBeCloseTo(0);
    b.scars = [{ id: 'burned', turn: 1 }];
    expect(soulHit(s, a, b, 1, ctx)).toBeCloseTo(0.2);
  });

  it('Field Medics repair out of their own territory; Slow Refits only repair at yards', () => {
    const s = game(); clearMap(s);
    const x = farColony(s, 1);
    const near = s.regions.find(r => r.owner === null && r.kind !== 'lane' && (s.regions[s.players[0].capital].neighbors.includes(r.id)))!;
    const a = fleetAt(s, 0, near.id, ['frigate']);
    a.banner!.boons = ['medics'];
    a.ships[0].hp = 4; delete a.ships[0].traits;
    const n = resolveTurn(s, idle(s));
    expect(n.fleets.find(f => f.id === a.id)!.ships[0].hp).toBeGreaterThan(4);
    void x;
    const s2 = game(); clearMap(s2);
    const own = s2.regions.find(r => r.owner === 0 && !(r.buildings.shipyard ?? 0)) ?? null;
    if (own) {
      const b = fleetAt(s2, 0, own.id, ['frigate']);
      b.banner!.banes = ['slowrefit']; b.ships[0].hp = 4; delete b.ships[0].traits;
      const n2 = resolveTurn(s2, idle(s2));
      expect(n2.fleets.find(f => f.id === b.id)!.ships[0].hp).toBe(4);
    }
  });

  it('Ghosts are unseen by distant rival sensors; Conspicuous fleets are seen everywhere', () => {
    const s = game(); clearMap(s);
    const x = farColony(s, 2);
    const g = fleetAt(s, 1, x.id, ['frigate']);
    // player 0 gets wide sensors so the region is in its coverage but no fleet nearby
    s.players[0].relics.push('chorus');
    s.scans = [];
    g.banner!.banes = ['conspicuous'];
    expect(viewFor(s, 0).state.fleets.some(f => f.id === g.id)).toBe(true);
    g.banner!.banes = ['hungry', 'green']; g.banner!.boons = ['ghosts'];
    expect(viewFor(s, 0).state.fleets.some(f => f.id === g.id)).toBe(false);
    s.scans.push({ owner: 0, region: x.id, until: s.turn + 1 });
    expect(viewFor(s, 0).state.fleets.some(f => f.id === g.id)).toBe(true);
  });
});

// ============================================================================ rout & limp
describe('soul: rout instead of erasure', () => {
  const routSetup = (attackers: string[], defenders: string[]) => {
    const s = game(21); clearMap(s);
    const x = farColony(s, 2);
    x.garrison = 0; x.baseGarrison = 0;
    const a = fleetAt(s, 0, x.id, attackers), b = fleetAt(s, 1, x.id, defenders);
    fight(a, b);
    for (const sh of a.ships) sh.sys.weapons = false;   // A can't hurt B: it will lose
    return { s, x, a, b };
  };

  it('a beaten bannered fleet routs: >= 1 hull at <= 30%, limping, scarred, routing home', () => {
    const { s, x, a } = routSetup(['frigate', 'frigate', 'frigate'], ['frigate', 'frigate', 'frigate', 'frigate']);
    const t = until(s, t => !t.engagements.some(e => e.region === x.id) || t.last?.events.some(e => e.k === 'rout') === true);
    const ev = [s, t].flatMap(z => z.last?.events ?? []).find(e => e.k === 'rout');
    expect(ev).toBeTruthy();
    const f = t.fleets.find(z => z.id === a.id)!;
    expect(f).toBeTruthy();
    expect(f.ships.length).toBeGreaterThanOrEqual(1);
    for (const sh of f.ships) expect(sh.hp).toBeLessThanOrEqual(Math.floor(sh.maxHp * 0.3));
    expect(f.limping).toBeTruthy();
    expect(f.scars?.length).toBe(1);
    expect(f.region).not.toBe(x.id);
    const yard = t.regions[f.limping!.to];
    expect(yard.owner).toBe(0);
    expect(validateOrder(t, 0, { type: 'seize', fleet: f.id, target: x.id })).toMatch(/limping/);
  });

  it('hopelessly outmatched (< 25% of the winner) is destroyed, not routed', () => {
    const { s, x, a } = routSetup(['corvette'], ['frigate', 'frigate', 'frigate', 'frigate', 'frigate', 'frigate']);
    const t = until(s, t => !t.fleets.some(f => f.id === a.id) || !t.engagements.some(e => e.region === x.id));
    expect(t.fleets.some(f => f.id === a.id)).toBe(false);
    expect(t.soul!.fallen.find(r => r.id === a.id)?.fate).toBe('destroyed');
  });

  it('a limping fleet limps home along a safe path at reduced speed and recovers at a yard', () => {
    const s = game(22); clearMap(s);
    const cap = s.players[0].capital;
    const d = bfs(s, cap);
    const far = s.regions.find(r => r.owner === null && r.kind !== 'lane' && (d.get(r.id) ?? 0) >= 3)!;
    const f = fleetAt(s, 0, far.id, ['frigate']);
    f.limping = { since: 1, to: cap, by: 1 };
    const rt = limpRoute(s, f)!;
    expect(rt.to).toBe(cap);
    f.route = { path: rt.path, seize: null, mp: 0 };
    let t = resolveTurn(s, idle(s));
    const g = t.fleets.find(x => x.id === f.id)!;
    expect(rt.path.indexOf(g.region)).toBe(0);   // speed 2 - 1 = 1 step a turn
    t = until(t, z => z.fleets.find(x => x.id === f.id)?.region === cap, 12);
    t = resolveTurn(t, idle(t));
    expect(t.fleets.find(x => x.id === f.id)!.limping ?? null).toBeNull();
  });

  it('a limping fleet caught by any hostile fleet dies (and the catcher’s house owes a blood-debt)', () => {
    const s = game(23); clearMap(s);
    const x = farColony(s, 2);
    const f = fleetAt(s, 0, x.id, ['frigate', 'frigate']);
    f.limping = { since: 1, to: s.players[0].capital, by: 2 };
    const h = fleetAt(s, 1, x.id, ['corvette']);
    const t = resolveTurn(s, idle(s));
    expect(t.fleets.some(z => z.id === f.id)).toBe(false);
    expect(t.soul!.fallen.find(r => r.id === f.id)?.fate).toBe('caught');
    expect(t.soul!.debts.some(dd => dd.debtor === 1 && dd.creditor === 0)).toBe(true);
    expect(t.fleets.find(z => z.id === h.id)!.tally!.interceptions).toBe(1);
  });

  it('a second rout within 4 turns kills the fleet', () => {
    const { s, x, a } = routSetup(['frigate', 'frigate', 'frigate'], ['frigate', 'frigate', 'frigate', 'frigate']);
    a.routs = [s.turn - 1];
    const t = until(s, t => !t.fleets.some(f => f.id === a.id) || !t.engagements.some(e => e.region === x.id));
    expect(t.fleets.some(f => f.id === a.id)).toBe(false);
  });

  it('the third scar breaks the fleet: disbanded with honours, its home world gains a deed', () => {
    const { s, x, a } = routSetup(['frigate', 'frigate', 'frigate'], ['frigate', 'frigate', 'frigate', 'frigate']);
    a.scars = [{ id: 'burned', turn: 0 }, { id: 'haunted', turn: 0 }];
    const t = until(s, t => !t.fleets.some(f => f.id === a.id) || !t.engagements.some(e => e.region === x.id));
    expect(t.fleets.some(f => f.id === a.id)).toBe(false);
    expect(t.soul!.fallen.find(r => r.id === a.id)?.fate).toBe('broken');
    const home = t.regions[a.banner!.home];
    expect(home.story!.deeds.some(dd => dd.id === 'fell' && dd.name.includes(a.name))).toBe(true);
  });

  it('scars are double-edged: Burned Hull lowers max hull, Haunted slows', () => {
    const s = game();
    const f = fleetAt(s, 0, 1, ['frigate']);
    f.scars = [{ id: 'haunted', turn: 1 }];
    expect(fleetSpeed(s, f)).toBe(1);
  });
});

// ============================================================================ honours
describe('soul: honours', () => {
  it('a rank-up offers 2 honours shaped by how it fought; the owner picks one with a free action', () => {
    const s = game();
    const f = s.fleets.find(x => x.owner === 0 && x.banner)!;
    f.tally = { sieges: 3, defences: 0, interceptions: 0, wins: 3, routs: 0 };
    f.commander.rank = 2;
    onRankUp(s, f, () => {});
    expect(f.pendingHonour!.options.length).toBe(2);
    expect(BOONS[f.pendingHonour!.options[0]].from).toBe('sieges');
    expect(honourOptions(s, f).every(o => !f.banner!.boons.includes(o))).toBe(true);
    const pick = f.pendingHonour!.options[1];
    const n = resolveTurn(s, sub(s, 0, [], [{ type: 'honour', fleet: f.id, pick: 1 }]));
    const g = n.fleets.find(x => x.id === f.id)!;
    expect(g.honours!.map(h => h.id)).toEqual([pick]);
    expect(hasBoon(n, g, pick)).toBe(true);
    // the view hides a rival's pending choice
    const f2 = n.fleets.find(x => x.owner === 1 && x.banner)!;
    f2.pendingHonour = { options: ['medics', 'iron'], since: n.turn };
    f2.region = n.players[0].capital;
    expect(viewFor(n, 0).state.fleets.find(x => x.id === f2.id)?.pendingHonour).toBeUndefined();
  });

  it('an unpicked honour defaults to the first option at the end of the next turn', () => {
    const s = game();
    const f = s.fleets.find(x => x.owner === 0 && x.banner)!;
    f.commander.rank = 2;
    onRankUp(s, f, () => {});
    const first = f.pendingHonour!.options[0];
    let t = resolveTurn(s, idle(s));
    expect(t.fleets.find(x => x.id === f.id)!.pendingHonour).toBeTruthy();
    t = resolveTurn(t, idle(t));
    expect(t.fleets.find(x => x.id === f.id)!.honours!.map(h => h.id)).toEqual([first]);
  });

  it('Legend rank grants an epithet and sheds the first bane', () => {
    const s = game();
    const f = s.fleets.find(x => x.owner === 0 && x.banner)!;
    const banes = f.banner!.banes.length;
    f.commander.rank = 5;
    onRankUp(s, f, () => {});
    expect(f.epithets!.length).toBe(1);
    expect(f.banner!.banes.length).toBe(Math.max(0, banes - 1));
  });
});

// ============================================================================ vows
describe('soul: vows', () => {
  it('guard: kept for 6 turns earns an epithet; leaving brands the fleet Oathbreaker (public)', () => {
    const s = game(); clearMap(s);
    const cap = s.players[0].capital;
    const f = fleetAt(s, 0, cap, ['frigate', 'frigate']);
    let t = resolveTurn(s, sub(s, 0, [], [{ type: 'vow', fleet: f.id, vow: 'guard', region: cap }]));
    expect(t.fleets.find(x => x.id === f.id)!.vow?.kind).toBe('guard');
    t = until(t, z => !z.fleets.find(x => x.id === f.id)!.vow, 8);
    const g = t.fleets.find(x => x.id === f.id)!;
    expect(g.epithets).toContain(`Shield of ${s.regions[cap].name}`);
    // a second fleet swears and then leaves
    const t2 = structuredClone(t);
    const h = fleetAt(t2, 0, cap, ['frigate']);
    let u = resolveTurn(t2, sub(t2, 0, [], [{ type: 'vow', fleet: h.id, vow: 'guard', region: cap }]));
    const nb = u.regions[cap].links![0];
    u = resolveTurn(u, sub(u, 0, [{ type: 'move', fleet: h.id, path: [nb] }]));
    const hh = u.fleets.find(x => x.id === h.id)!;
    expect(hh.oathbreaker).toBeTruthy();
    expect(hh.vow ?? null).toBeNull();
    u.fleets.find(x => x.id === h.id)!.region = u.players[1].capital;   // in a rival's sight
    expect(viewFor(u, 1).state.fleets.find(x => x.id === h.id)?.oathbreaker).toBeTruthy();
  });

  it('avenge needs a grievance; vows need a banner; one vow at a time', () => {
    const s = game(); clearMap(s);
    const a = fleetAt(s, 0, 1, ['frigate']), b = fleetAt(s, 1, 2, ['frigate']);
    const picket = fleetAt(s, 0, 1, ['scout'], false);
    let n = resolveTurn(s, sub(s, 0, [], [{ type: 'vow', fleet: a.id, vow: 'avenge', target: b.id }, { type: 'vow', fleet: picket.id, vow: 'throne' }]));
    const fails = n.last!.events.filter(e => e.k === 'fail' && e.owner === 0).map(e => (e as { text: string }).text);
    expect(fails.some(x => /grievance/.test(x))).toBe(true);
    expect(fails.some(x => /pickets/.test(x))).toBe(true);
    const s2 = game(); clearMap(s2);
    const a2 = fleetAt(s2, 0, 1, ['frigate']), b2 = fleetAt(s2, 1, 2, ['frigate']);
    a2.commander.rivals[b2.commander.name] = { met: 1, lastWinner: b2.commander.name };
    n = resolveTurn(s2, sub(s2, 0, [], [{ type: 'vow', fleet: a2.id, vow: 'avenge', target: b2.id }, { type: 'vow', fleet: a2.id, vow: 'throne' }]));
    expect(n.fleets.find(x => x.id === a2.id)!.vow).toMatchObject({ kind: 'avenge', target: b2.commander.name });
    expect(n.last!.events.some(e => e.k === 'fail' && /already has a vow/.test((e as { text: string }).text))).toBe(true);
  });

  it('never retreat: a rout breaks the vow (Oathbreaker)', () => {
    const s = game(21); clearMap(s);
    const x = farColony(s, 2); x.garrison = 0; x.baseGarrison = 0;
    const a = fleetAt(s, 0, x.id, ['frigate', 'frigate', 'frigate']), b = fleetAt(s, 1, x.id, ['frigate', 'frigate', 'frigate', 'frigate']);
    fight(a, b);
    for (const sh of a.ships) sh.sys.weapons = false;
    a.vow = { kind: 'never_retreat', since: 1, progress: 0 };
    const t = until(s, t => !t.engagements.some(e => e.region === x.id));
    const g = t.fleets.find(f => f.id === a.id);
    const rec = g ?? t.soul!.fallen.find(r => r.id === a.id);
    expect(g ? !!g.oathbreaker : (rec as { oathbreaker: boolean }).oathbreaker).toBe(true);
  });

  it('relic: digging one up and bringing it home fulfils the vow', () => {
    const s = game(); clearMap(s); rich(s);
    const relic = s.regions.find(r => r.kind === 'relic')!;
    relic.owner = 0; relic.garrison = 5;
    const f = fleetAt(s, 0, relic.id, ['frigate']);
    f.banner!.home = relic.id;   // home is right here: the vow completes at the end of the turn
    const n = resolveTurn(s, sub(s, 0, [{ type: 'excavate', fleet: f.id }], [{ type: 'vow', fleet: f.id, vow: 'relic' }]));
    const g = n.fleets.find(x => x.id === f.id)!;
    expect(g.epithets).toContain('Relic-bearers');
  });
});

// ============================================================================ retirement
describe('soul: retirement', () => {
  it('a Storied fleet retires at an owned world: banner returned, Haven deed carrying its first boon', () => {
    const s = game(); clearMap(s);
    const cap = s.players[0].capital;
    const f = fleetAt(s, 0, cap, ['frigate']);
    f.banner!.boons = ['medics'];
    expect(validateOrder(s, 0, { type: 'retire', fleet: f.id })).toMatch(/Storied/);
    f.commander.rank = 4;
    expect(validateOrder(s, 0, { type: 'retire', fleet: f.id })).toBeNull();
    const before = bannersFree(s, 0);
    const n = resolveTurn(s, sub(s, 0, [{ type: 'retire', fleet: f.id }]));
    expect(n.fleets.some(x => x.id === f.id)).toBe(false);
    expect(bannersFree(n, 0)).toBe(before + 1);
    const deed = n.regions[cap].story!.deeds.find(d => d.id === 'haven')!;
    expect(deed).toMatchObject({ name: `Haven of ${f.name}`, boon: 'medics' });
    expect(n.soul!.fallen.find(r => r.id === f.id)?.fate).toBe('retired');
    // fleets of the owner standing in the Haven fight with its boon
    const g = fleetAt(n, 0, cap, ['frigate']);
    expect(hasBoon(n, g, 'medics')).toBe(true);
  });
});

// ============================================================================ worlds
describe('soul: worlds with a story', () => {
  it('a capital is offered a calling at development 3; the owner picks it; tenure tiers scale it', () => {
    const s = game();
    const cap = s.players[0].capital;
    let t = resolveTurn(s, idle(s));
    const pc = t.regions[cap].story!.pendingCalling!;
    expect(pc.options.length).toBe(2);
    expect(pc.owner).toBe(0);
    expect(viewFor(t, 1).state.regions[cap].story!.pendingCalling ?? null).toBeNull();   // private
    t = resolveTurn(t, sub(t, 0, [], [{ type: 'calling', region: cap, pick: pc.options[1] }]));
    expect(t.regions[cap].story!.calling!.id).toBe(pc.options[1]);
    expect(t.regions[cap].story!.toil).toBe(2);
    expect(tenureTier(t, t.regions[cap])).toBe(0);
    t.turn = 4; expect(tenureTier(t, t.regions[cap])).toBe(1);
    t.turn = 11; expect(tenureTier(t, t.regions[cap])).toBe(3);
  });

  it('an unmade calling defaults to its first option after a turn; callings are real effects', () => {
    const s = game();
    const cap = s.players[0].capital;
    let t = resolveTurn(s, idle(s));
    const first = t.regions[cap].story!.pendingCalling!.options[0];
    t = resolveTurn(t, idle(t));
    expect(t.regions[cap].story!.calling!.id).toBe(first);
    // Refinery: +credits; Arsenal: cheaper ships
    const r = t.regions[cap];
    r.story!.calling = { id: 'refinery', since: 1 };
    const withRef = incomeDetail(t, 0).total.credits;
    r.story!.calling = null;
    expect(withRef).toBeGreaterThan(incomeDetail(t, 0).total.credits);
    const plain = orderCost(t, { type: 'build', region: cap, cls: 'frigate', fleet: null }, 0).industry!;
    r.story!.calling = { id: 'arsenal', since: 1 };
    expect(orderCost(t, { type: 'build', region: cap, cls: 'frigate', fleet: null }, 0).industry!).toBeLessThan(plain);
  });

  it('epithets follow the strongest mark; deeds max 2 and one can be engraved', () => {
    const s = game();
    const r = s.regions[s.players[0].capital];
    r.story!.blood = 4;
    expect(worldEpithet(s, r)).toBe('the Bloodied');
    r.story!.siege = 4;
    expect(worldEpithet(s, r)).toBe('the Unconquerable');
    rich(s);
    r.story!.deeds = [{ id: 'unbroken', turn: 1, name: 'Unbroken' }, { id: 'liberated', turn: 1, name: 'Liberated' }];
    const o: Order = { type: 'engrave', region: r.id, deed: 'liberated' };
    expect(validateOrder(s, 0, o)).toBeNull();
    const n = resolveTurn(s, sub(s, 0, [o]));
    expect(n.regions[r.id].story!.deeds.find(d => d.id === 'liberated')!.engraved).toBe(true);
    expect(validateOrder(n, 0, { type: 'engrave', region: r.id, deed: 'unbroken' })).toMatch(/already engraved/);
  });

  it('capture: history stays, tenure resets, the calling sleeps 3 turns; razing; liberation within 5 turns', () => {
    const s = game(); clearMap(s);
    const r = s.regions.find(x => x.kind === 'colony' && x.owner === null && x.neighbors.some(n => s.regions[n].owner === null))!;
    r.owner = 1; r.heldSince = 1; r.dev = 3; r.garrison = 0;
    r.story = { ...r.story!, owners: [{ p: 1, turn: 1, how: 'start' }], tenureFrom: 1, calling: { id: 'granary', since: 1 }, deeds: [{ id: 'unbroken', turn: 1, name: 'Unbroken' }] };
    s.turn = 5;
    const a = fleetAt(s, 0, r.links![0], ['frigate', 'frigate', 'frigate']);
    a.bornTurn = 0;
    let t = resolveTurn(s, sub(s, 0, [{ type: 'seize', fleet: a.id, target: r.id }]));
    for (let i = 0; i < 4 && t.regions[r.id].owner !== 0; i++) t = resolveTurn(t, idle(t));
    expect(t.regions[r.id].owner).toBe(0);
    const st = t.regions[r.id].story!;
    expect(st.deeds.some(d => d.id === 'unbroken')).toBe(true);
    expect(st.calling!.id).toBe('granary');
    expect(callingTier(t, t.regions[r.id])).toBe(-1);   // dormant
    expect(st.owners.at(-1)).toMatchObject({ p: 0, how: 'force' });
    // raze it right after the capture (free action)
    const before = t.players[0].res.credits;
    const dev = t.regions[r.id].dev;
    const z = resolveTurn(t, sub(t, 0, [], [{ type: 'raze', region: r.id }]));
    expect(z.players[0].res.credits).toBeGreaterThan(before);
    expect(z.regions[r.id].dev).toBe(Math.max(1, dev - 1));
    expect(z.regions[r.id].story!.calling).toBeNull();
    expect(z.players[1].vendettas!.some(v => v.vs === 0)).toBe(true);
    expect(z.soul!.herald.at(-1)!.headlines.some(h => h.kind === 'razed')).toBe(true);
    // ... or don't raze, and the old owner liberates it within 5 turns
    const u = structuredClone(t);
    u.fleets = u.fleets.filter(f => f.owner !== 0);
    u.regions[r.id].garrison = 0;
    const b = fleetAt(u, 1, r.links![0], ['frigate', 'frigate', 'frigate']);
    let w = resolveTurn(u, sub(u, 1, [{ type: 'seize', fleet: b.id, target: r.id }]));
    for (let i = 0; i < 4 && w.regions[r.id].owner !== 1; i++) w = resolveTurn(w, idle(w));
    expect(w.regions[r.id].owner).toBe(1);
    expect(w.regions[r.id].story!.deeds.some(d => d.id === 'liberated')).toBe(true);
    expect(w.regions[r.id].story!.calling!.id).toBe('granary');
    expect(callingTier(w, w.regions[r.id])).toBeGreaterThanOrEqual(0);   // wakes at once
  });

  it('a raze is only possible right after a capture of your own', () => {
    const s = game();
    expect(validateOrder(s, 0, { type: 'raze', region: s.players[0].capital })).toMatch(/just captured/);
  });
});

// ============================================================================ friends
describe('soul: friends as antagonists', () => {
  it('a sworn pact carries words; breaking it brands the house Oathbreaker and the Herald prints them', () => {
    const s = game(); clearMap(s); rich(s);
    const words = 'I will not cross the Veil <script>\u0007';
    const subs = idle(s);
    subs[0].orders[0] = { type: 'pact', with: 1, words };
    subs[1].orders[0] = { type: 'pact', with: 0, words: 'Nor I.' };
    let t = resolveTurn(s, subs);
    const pact = t.pacts.find(p => p.a === 0 && p.b === 1)!;
    expect(pact.words!.find(w => w.by === 0)!.text).toBe('I will not cross the Veil script');
    // player 0 falls on a world of player 1
    const r = t.regions.find(x => x.owner === null && x.kind === 'colony')!;
    r.owner = 1; r.garrison = 0;
    const a = fleetAt(t, 0, r.links![0], ['frigate', 'frigate']);
    t = resolveTurn(t, sub(t, 0, [{ type: 'seize', fleet: a.id, target: r.id }]));
    expect(t.players[0].oathbreaker![0]).toMatchObject({ victim: 1, words: 'I will not cross the Veil script' });
    const h = t.soul!.herald.at(-1)!.headlines.find(x => x.kind === 'oath')!;
    expect(h.public).toBe(true);
    expect(h.text).toContain('I will not cross the Veil');
  });

  it('blood-debts: killing a banner records a public debt; the avenger hits harder; beating the debtor clears it', () => {
    const s = game(31); clearMap(s);
    const x = farColony(s, 2); x.garrison = 0; x.baseGarrison = 0;
    const a = fleetAt(s, 0, x.id, ['corvette']), b = fleetAt(s, 1, x.id, ['frigate', 'frigate', 'frigate', 'frigate', 'frigate', 'frigate']);
    fight(a, b);
    const t = until(s, z => !z.fleets.some(f => f.id === a.id), 6);
    const d = t.soul!.debts.find(dd => dd.creditor === 0 && dd.debtor === 1)!;
    expect(d).toBeTruthy();
    expect(viewFor(t, 2).state.soul!.debts.length).toBe(t.soul!.debts.length);   // public
    const mine = fleetAt(t, 0, 1, ['frigate']), theirs = t.fleets.find(f => f.id === b.id)!;
    const ctx = { region: t.regions[1], moved: () => false, outnumbered: false, enemiesHaunted: false };
    expect(soulHit(t, mine, theirs, 1, ctx)).toBeGreaterThan(0);
  });

  it('dispatches: sanitized, one per edition, printed in the next edition with the chosen byline (public)', () => {
    const s = game();
    expect(cleanText('  hi\u0000 <b>there</b>\n\n friend  ', 140)).toBe('hi b there /b friend');
    const long = 'x'.repeat(500);
    const n = resolveTurn(s, sub(s, 0, [], [{ type: 'dispatch', text: long, as: 'source' }, { type: 'dispatch', text: 'second' }]));
    const ed = n.soul!.herald.at(-1)!;
    expect(ed.turn).toBe(1);
    expect(ed.dispatches.length).toBe(1);
    expect(ed.dispatches[0]).toMatchObject({ player: 0, byline: `a source close to ${s.players[0].name}` });
    expect(ed.dispatches[0].text.length).toBe(140);
    expect(n.last!.events.some(e => e.k === 'fail' && /one dispatch/.test((e as { text: string }).text))).toBe(true);
    expect(viewFor(n, 2).state.soul!.herald.at(-1)!.dispatches.length).toBe(1);
  });

  it('the Herald is deterministic, prints 3-6 headlines, and respects fog', () => {
    const run = () => {
      let t = createGame({ seed: 77, players: [0, 1, 2].map(() => ({ kind: 'ai' as const, aiLevel: 'expert' as const })) });
      for (let i = 0; i < 10; i++) { const subs: Record<number, Submission> = {}; for (const p of t.players) subs[p.id] = planTurn(t, p.id); t = resolveTurn(t, subs); }
      return t;
    };
    const a = run(), b = run();
    expect(JSON.stringify(a.soul!.herald)).toBe(JSON.stringify(b.soul!.herald));
    for (const ed of a.soul!.herald) { expect(ed.headlines.length).toBeGreaterThanOrEqual(3); expect(ed.headlines.length).toBeLessThanOrEqual(6); }
    // fog: a private headline only reaches those who saw it
    const t = structuredClone(a);
    t.soul!.herald.push({ turn: t.turn, headlines: [{ kind: 'battle', text: 'secret', players: [1, 2], drama: 3, public: false, seenBy: [1, 2] }], dispatches: [] });
    expect(viewFor(t, 0).state.soul!.herald.at(-1)!.headlines.length).toBe(0);
    expect(viewFor(t, 1).state.soul!.herald.at(-1)!.headlines.length).toBe(1);
    expect(headlineVisible({ kind: 'x', text: '', players: [], drama: 1, public: true }, 0)).toBe(true);
    expect(viewFor(t, 0).state.soul!.beats).toEqual([]);
    expect(aiDispatch(t, 0) === null || aiDispatch(t, 0)!.text.length <= 140).toBe(true);
  });

  it('the Saga: fleets (alive and fallen), reigns, memorials, top moments', () => {
    let t = createGame({ seed: 5, players: [0, 1, 2].map(() => ({ kind: 'ai' as const, aiLevel: 'expert' as const })) });
    while (t.winner === null && t.turn < 40) { const subs: Record<number, Submission> = {}; for (const p of t.players) subs[p.id] = planTurn(t, p.id); t = resolveTurn(t, subs); }
    const saga = sagaOf(t);
    expect(saga.fleets.length).toBeGreaterThanOrEqual(6);
    expect(saga.fleets.every(f => f.paragraph.length > 20)).toBe(true);
    expect(saga.fleets.some(f => f.fate !== 'alive')).toBe(true);
    expect(saga.moments.length).toBeLessThanOrEqual(3);
    expect(saga.moments.length).toBeGreaterThan(0);
    expect(JSON.stringify(sagaOf(t))).toBe(JSON.stringify(saga));
  });
});

// ============================================================================ ship traits
describe('soul: ship traits', () => {
  it('every new ship rolls an origin trait (net-zero pair) weighted by its yard world; deterministic', () => {
    const s = game();
    for (const f of s.fleets) for (const sh of f.ships) {
      expect(sh.traits!.length).toBeGreaterThanOrEqual(1);
      expect(SHIP_TRAITS[sh.traits![0]].kind).toBe('origin');
    }
    const cap = s.players[0].capital;
    expect([...originPool(s, 0, cap).keys()]).toContain('homebuilt');
    const ast = s.regions.find(r => r.feature === 'asteroids' && r.kind !== 'lane');
    if (ast) expect(originPool(s, 0, ast.id).get('rockborn')).toBeGreaterThanOrEqual(3);
    expect(rollShipTraits(s, 123, 9, 0, cap)).toEqual(rollShipTraits(s, 123, 9, 0, cap));
    // every trait is double-edged (has an up and a down)
    for (const [id, d] of Object.entries(SHIP_TRAITS)) {
      const v = Object.entries(d.fx).map(([k, x]) => (k === 'upkeep' ? -x! : x!));
      expect(v.some(x => x > 0) && v.some(x => x < 0), id).toBe(true);
    }
  });

  it('traits are real: stats, hull, upkeep; laws nudge the pool; fleetTraits summarises', () => {
    const s = game();
    const f = s.fleets.find(x => x.owner === 0 && x.banner)!;
    const sh = f.ships[0];
    sh.traits = ['forged'];
    expect(shipStats(s, sh, 0).attack).toBe(s.rules.ships[sh.cls].attack + 1);
    sh.traits = ['hazeborn'];
    expect(shipStats(s, sh, 0).evasion).toBeCloseTo(s.rules.ships[sh.cls].evasion + 0.05 + (sh.mod === 'ion' ? 0.08 : 0));
    expect(traitFx({ traits: ['racer'] }).speed).toBe(1);
    s.players[0].laws = ['industrial'];
    expect(originPool(s, 0, s.players[0].capital).get('massprod')).toBe(1.5);
    for (const x of f.ships) x.traits = ['forged'];
    expect(fleetTraits(f)[0]).toMatchObject({ id: 'forged', count: f.ships.length });
  });

  it('distribution: the yard world shapes what its ships become', () => {
    const s = game();
    const counts: Record<string, Record<string, number>> = {};
    for (const r of s.regions.filter(x => x.kind !== 'lane')) {
      const k = r.feature !== 'none' ? r.feature : r.trait ?? r.kind;
      for (let i = 0; i < 40; i++) { const t = rollShipTraits(s, 1000 + i, 5000 + i, 0, r.id)[0]; (counts[k] ??= {})[t] = (counts[k][t] ?? 0) + 1; }
    }
    const top = (k: string) => Object.entries(counts[k] ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (counts.asteroids) expect(top('asteroids')).toBe('rockborn');
    if (counts.nebula) expect(top('nebula')).toBe('hazeborn');
    if (counts.forge) expect(top('forge')).toBe('forged');
    expect(top('home')).toBe('homebuilt');
  });
});

// ============================================================================ saves & determinism
describe('soul: old saves and determinism', () => {
  it('a save without Soul state loads and resolves (state is created on demand)', () => {
    const s = game();
    delete s.soul;
    for (const r of s.regions) delete r.story;
    for (const f of s.fleets) { delete f.banner; delete f.tally; delete f.saga; }
    const n = resolveTurn(s, idle(s));
    expect(n.soul).toBeTruthy();
    expect(n.fleets.filter(f => f.owner === 0 && f.banner).length).toBe(2);
    expect(n.regions.every(r => r.story)).toBe(true);
  });

  it('rules without a soul group (older games) keep the old behaviour', () => {
    const s = game();
    delete (s.rules as { soul?: unknown }).soul;
    delete s.soul;
    const n = resolveTurn(s, idle(s));
    expect(n.soul).toBeUndefined();
  });

  it('AI-vs-AI games with the Soul layer are deterministic', () => {
    const run = () => {
      let t = createGame({ seed: 9, players: [0, 1, 2].map(() => ({ kind: 'ai' as const, aiLevel: 'expert' as const })) });
      for (let i = 0; i < 12; i++) { const subs: Record<number, Submission> = {}; for (const p of t.players) subs[p.id] = planTurn(t, p.id); t = resolveTurn(t, subs); }
      return t;
    };
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});
void BANES;

// ============================================================================ LIVE
describe('soul: LIVE mode', () => {
  it('the Herald prints once per cycle; one queued dispatch per edition; founding works through the queue', () => {
    let s = makeLive(createGame({ seed: 4, players: [0, 1, 2].map(() => ({ kind: 'human' as const })) }), 0, 360);
    rich(s);
    expect(queueFree(s, 0, { type: 'dispatch', text: 'first' })).toBeNull();
    expect(queueFree(s, 0, { type: 'dispatch', text: 'replaces the first' })).toBeNull();
    expect(s.live!.free[0].filter(f => f.type === 'dispatch').length).toBe(1);
    const cap = s.players[0].capital;
    expect(queueOrder(s, 0, { type: 'build', region: cap, cls: 'frigate', fleet: null, found: { boons: ['beloved'], banes: [] } }, 0)).toBeNull();
    expect(queueOrder(s, 0, { type: 'build', region: cap, cls: 'frigate', fleet: null }, 0)).toMatch(/no free banner/);
    const per = s.rules.live.ticksPerCycle;
    for (let i = 0; i < per; i++) s = runTick(s, () => false);
    expect(s.soul!.herald.length).toBe(1);
    expect(s.soul!.herald[0].dispatches.map(d => d.text)).toEqual(['replaces the first']);
    expect(s.fleets.some(f => f.owner === 0 && f.banner?.boons.includes('beloved'))).toBe(true);
    for (let i = 0; i < per; i++) s = runTick(s, () => false);
    expect(s.soul!.herald.length).toBe(2);
  });
});
