// Star systems (docs/SYSTEMS.md, steps 1-2): stars and bodies, the citizens cap and growth, gates, slots,
// the waystation discount, the black hole's gravity well, and old-rules compatibility.
import { describe, expect, it } from 'vitest';
import { createGame, newFleet, newShip } from '../shared/sim/setup.ts';
import { resolveTurn, emptySubmission, incomeDetail } from '../shared/sim/resolve.ts';
import { validateOrder, orderCost } from '../shared/sim/orders.ts';
import { viewFor } from '../shared/sim/view.ts';
import { maxDevAt, projectBlock } from '../shared/sim/empire.ts';
import { maxGarrison } from '../shared/sim/setup.ts';
import { coverage } from '../shared/sim/visibility.ts';
import { planTurn } from '../shared/sim/ai.ts';
import { hashString, Rng } from '../shared/sim/rng.ts';
import { growSystem, citizenCap, slotsOf, sysOn, roleOf, worldFx, isChokepoint, systemsBlock, systemCostMult } from '../shared/sim/systems.ts';
import type { Fleet, GameState, Order, Region, Submission } from '../shared/sim/types.ts';

const game = (seed = 31, rules?: unknown) => createGame({ seed, rules, players: [0, 1, 2].map(() => ({ kind: 'human' as const })) });
const idle = (s: GameState): Record<number, Submission> => Object.fromEntries(s.players.map(p => [p.id, emptySubmission(s)]));
const withOrders = (s: GameState, p: number, orders: Order[]) => { const sub = idle(s); orders.forEach((o, i) => { sub[p].orders[i] = o; }); return sub; };
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
/** Give player p a region (a quiet one: no garrison fights, no project). */
const own = (s: GameState, r: Region, p = 0, dev = r.dev) => { r.owner = p; r.dev = dev; r.heldSince = 1; r.garrison = 10; r.project = null; };
const geoHash = (s: GameState) => hashString(JSON.stringify(s.regions.map(r => ({ id: r.id, name: r.name, kind: r.kind, feature: r.feature, site: r.site, poly: r.poly, neighbors: r.neighbors, links: r.links, trait: r.trait, vein: r.vein, garrison: r.garrison, dev: r.dev, owner: r.owner }))));

describe('stars and bodies (step 1)', () => {
  it('map geometry and every old field are unchanged (hashes taken before systems existed)', () => {
    const before: Record<number, number> = { 1: 498903204, 7: 65112565, 31: 2869370321, 1000: 2602384851, 2024: 2254571163, 99991: 1360304886 };
    for (const [seed, h] of Object.entries(before)) expect(geoHash(game(Number(seed)))).toBe(h);
  });

  it('is deterministic and 3-fold symmetric', () => {
    const a = game(77), b = game(77);
    expect(a.regions.map(r => [r.star, r.bodies])).toEqual(b.regions.map(r => [r.star, r.bodies]));
    // ids 1,2,3 / 4,5,6 ... are the same template site in the three wedges
    const n = real(a).length;
    for (let i = 1; i + 2 < n; i += 3) {
      const kinds = [0, 1, 2].map(k => JSON.stringify([a.regions[i + k].star, a.regions[i + k].bodies!.map(x => [x.kind, x.q ?? null, x.vein ?? null])]));
      expect(new Set(kinds).size).toBe(1);
    }
  });

  it('every system has a star and at most 3 named bodies; lane waypoints have none', () => {
    for (const seed of [3, 31, 500]) {
      const s = game(seed);
      for (const r of s.regions) {
        if (r.kind === 'lane') { expect(r.star).toBeUndefined(); expect(r.bodies).toBeUndefined(); continue; }
        expect(r.star).toBeTruthy();
        expect(r.bodies!.length).toBeLessThanOrEqual(3);
        for (const b of r.bodies!) expect(b.name.length).toBeGreaterThan(2);
        if (r.star === 'pulsar' || r.star === 'blackhole') expect(r.bodies!.some(b => b.kind === 'habitable')).toBe(false);
      }
      expect(s.regions[0].bodies!.map(b => b.name)).toContain('the Ring');
    }
  });

  it('old fields map onto bodies: traits, asteroids, veins', () => {
    let seen = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const s = game(seed);
      for (const r of real(s)) {
        const B = r.bodies!;
        if (r.trait === 'forge') { expect(B.some(b => b.kind === 'barren' && b.q === 'rich')).toBe(true); seen++; }
        if (r.trait === 'garden') expect(B.some(b => b.kind === 'habitable' && b.q === 'rich')).toBe(true);
        if (r.trait === 'bulwark') { expect(B.some(b => b.kind === 'moon')).toBe(true); expect(B.some(b => b.kind === 'habitable')).toBe(false); }
        if (r.trait === 'gas') expect(B.some(b => b.kind === 'gas')).toBe(true);
        if (r.feature === 'asteroids') expect(B.some(b => b.kind === 'belt')).toBe(true);
        if (r.vein) expect(B.some(b => b.vein === r.vein)).toBe(true);
        // trait effects come from bodies, and match the old traits exactly
        const fx = worldFx(s, r);
        expect(fx.forge).toBe(r.trait === 'forge');
        expect(fx.gas).toBe(r.trait === 'gas' || r.vein === 'antimatter');
        expect(fx.bulwark).toBe(r.trait === 'bulwark');
        expect(fx.garden).toBe(r.trait === 'garden');
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('roles are derived: homes and crowns are Cores', () => {
    const s = game();
    for (const p of s.players) expect(roleOf(s.regions[p.capital])).toBe('core');
    for (const r of real(s)) if (r.kind === 'crown') expect(roleOf(r)).toBe('core');
  });

  it('a binary star adds garrison; a pulsar adds sensor range and cheapens a Warp Gate', () => {
    const s = game();
    const cap = s.regions[s.players[0].capital];
    const before = maxGarrison(s, cap.id);
    cap.star = 'binary';
    expect(maxGarrison(s, cap.id)).toBe(before + s.rules.systems.binaryGarrison);
    s.fleets = s.fleets.filter(f => f.owner !== 0);   // the home fleets' own sensors would cover the same ground
    const covBefore = coverage(s, 0).size;
    cap.star = 'pulsar';
    expect(coverage(s, 0).size).toBeGreaterThan(covBefore);
    cap.dev = 3;
    expect(systemCostMult(s, cap, 'gate')).toBeCloseTo(0.7);
  });

  it('a black hole stops fleets entering it; the route carries on next turn', () => {
    const s = game(); s.fleets = s.fleets.filter(f => f.owner < 0);
    // a straight 3-step path whose middle system becomes a black hole
    const start = s.players[0].capital;
    const links = (id: number) => s.regions[id].links ?? s.regions[id].neighbors;
    const mid = links(start).find(n => s.regions[n].kind !== 'lane' && s.regions[n].owner === null)!;
    const end = links(mid).find(n => n !== start && s.regions[n].kind !== 'lane' && s.regions[n].owner === null && !links(start).includes(n))!;
    for (const id of [mid, end]) { s.regions[id].garrison = 0; s.regions[id].baseGarrison = 0; }
    for (const r of s.regions) if (r.star === 'blackhole') r.star = 'pulsar';
    s.regions[mid].star = 'blackhole';
    const f = fleetAt(s, 0, start, ['corvette']);   // speed 3: it would reach `end` this turn
    const t = resolveTurn(s, withOrders(s, 0, [{ type: 'move', fleet: f.id, path: [mid, end] }]));
    const g = t.fleets.find(x => x.id === f.id)!;
    expect(g.region).toBe(mid);
    expect(t.last!.events.some(e => e.k === 'blocked' && e.reason === 'gravity well')).toBe(true);
    expect(g.route?.path).toEqual([end]);
    const t2 = resolveTurn(t, idle(t));
    expect(t2.fleets.find(x => x.id === f.id)!.region).toBe(end);
    // a fleet leaving a black hole is not held
    expect(t2.last!.events.some(e => e.k === 'blocked' && e.fleet === f.id)).toBe(false);
  });

  it('fogged views carry stars and bodies for every system (public map knowledge)', () => {
    const s = game();
    const v = viewFor(s, 0).state;
    const cov = coverage(s, 0);
    const far = v.regions.find(r => !cov.has(r.id) && r.kind !== 'lane')!;
    expect(far.star).toBe(s.regions[far.id].star);
    expect(far.bodies).toEqual(s.regions[far.id].bodies);
  });
});

describe('citizens, slots, gates, discount (step 2)', () => {
  it('the cap comes from the bodies plus the star; a Station adds one', () => {
    const s = game();
    expect(sysOn(s)).toBe(true);
    const home = s.regions[s.players[0].capital];
    expect(citizenCap(s, home)).toBe(5);
    expect(maxDevAt(s, home.id)).toBe(5);
    const r = real(s).find(x => x.kind === 'colony')!;
    r.star = 'red'; r.bodies = [{ kind: 'habitable', q: 'fair', name: 'X I' }, { kind: 'moon', name: 'Y' }];
    expect(citizenCap(s, r)).toBe(3);   // fair 3, red -1, moon +1
    r.star = 'blue'; r.bodies = [{ kind: 'habitable', q: 'rich', name: 'X I' }];
    expect(citizenCap(s, r)).toBe(2);   // blue giant: habitable cap <= 2
    r.bodies = [{ kind: 'gas', name: 'Tyr' }];
    expect(citizenCap(s, r)).toBe(0);
    r.buildings.station = 1;
    expect(citizenCap(s, r)).toBe(1);
  });

  it('Develop stops at the cap; a system above its cap keeps its citizens (grandfathered)', () => {
    const s = game();
    const r = real(s).find(x => x.kind === 'colony' && !x.vein)!;
    own(s, r, 0, 1);
    r.star = 'red'; r.bodies = [{ kind: 'gas', name: 'Tyr' }, { kind: 'belt', name: 'the Iron Belt' }];
    s.players[0].res = { industry: 999, credits: 999, influence: 99 };
    expect(validateOrder(s, 0, { type: 'develop', region: r.id, project: 'develop' })).toMatch(/citizens at the cap/);
    r.dev = 3;   // an old save's development above the cap
    const t = resolveTurn(s, idle(s));
    expect(t.regions[r.id].dev).toBe(3);
  });

  it('an uncontested Core grows +1 every 3 turns below its cap (not while contested)', () => {
    const s = game();
    const r = real(s).find(x => x.kind === 'colony' && x.owner === null)!;
    own(s, r, 0, 1);
    r.star = 'yellow'; r.bodies = [{ kind: 'habitable', q: 'fair', name: 'X I' }];
    let t = s;
    for (let i = 0; i < 3; i++) t = resolveTurn(t, idle(t));
    expect(t.regions[r.id].dev).toBe(2);
    // contested turns neither grow nor reset the count
    const c = game();
    const r2 = c.regions[r.id];
    own(c, r2, 0, 1);
    r2.star = 'yellow'; r2.bodies = [{ kind: 'habitable', q: 'fair', name: 'X I' }];
    for (let i = 0; i < 5; i++) growSystem(c, r2, true, 1, () => {});
    expect(r2.dev).toBe(1);
    growSystem(c, r2, false, 1, () => {}); growSystem(c, r2, false, 1, () => {});
    expect(r2.dev).toBe(1);
    growSystem(c, r2, false, 1, () => {});
    expect(r2.dev).toBe(2);
  });

  it('a Garden (rich habitable colony) grows every 2 turns', () => {
    const s = game();
    const r = real(s).find(x => x.kind === 'colony' && x.owner === null)!;
    own(s, r, 0, 1);
    r.star = 'yellow'; r.bodies = [{ kind: 'habitable', q: 'rich', name: 'X I' }];
    let t = s;
    for (let i = 0; i < 2; i++) t = resolveTurn(t, idle(t));
    expect(t.regions[r.id].dev).toBe(2);
  });

  it('gates: a Shipyard needs 2 citizens or a Station; an Academy needs 3; old yards are grandfathered', () => {
    const s = game();
    const r = real(s).find(x => x.kind === 'colony' && x.owner === null)!;
    own(s, r, 0, 1);
    r.star = 'yellow'; r.bodies = [{ kind: 'habitable', q: 'fair', name: 'X I' }, { kind: 'belt', name: 'B' }];
    s.players[0].res = { industry: 999, credits: 999, influence: 99 };
    expect(validateOrder(s, 0, { type: 'develop', region: r.id, project: 'shipyard' })).toMatch(/needs 2 citizens or a Station/);
    r.buildings.station = 1;
    expect(validateOrder(s, 0, { type: 'develop', region: r.id, project: 'shipyard' })).toBeNull();
    delete r.buildings.station;
    r.dev = 2;
    expect(validateOrder(s, 0, { type: 'develop', region: r.id, project: 'shipyard' })).toBeNull();
    expect(validateOrder(s, 0, { type: 'develop', region: r.id, project: 'academy' })).toMatch(/Academy needs 3 citizens/);
    r.dev = 3;
    expect(validateOrder(s, 0, { type: 'develop', region: r.id, project: 'academy' })).toBeNull();
    // an existing yard at a 1-citizen system still builds ships
    r.dev = 1; r.buildings.shipyard = 1;
    expect(validateOrder(s, 0, { type: 'build', region: r.id, cls: 'scout', fleet: null })).toBeNull();
  });

  it('civil slots come from bodies (+1 Station); sites gate Mines and Trade Hubs', () => {
    const s = game();
    const r = real(s).find(x => x.kind === 'colony' && x.owner === null && !x.vein)!;
    own(s, r, 0, 3);
    r.star = 'yellow'; r.bodies = [{ kind: 'habitable', q: 'fair', name: 'X I' }];
    s.players[0].res = { industry: 999, credits: 999, influence: 99 };
    expect(validateOrder(s, 0, { type: 'develop', region: r.id, project: 'mine' })).toMatch(/no belt, barren world or vein/);
    expect(validateOrder(s, 0, { type: 'develop', region: r.id, project: 'tradehub' })).toBeNull();
    r.buildings.tradehub = 1;   // 1 body = 1 civil slot, now used
    expect(slotsOf(s, r)).toMatchObject({ civil: 1, civilUsed: 1 });
    expect(validateOrder(s, 0, { type: 'develop', region: r.id, project: 'academy' })).toMatch(/no free civil slot \(1\/1\)/);
    expect(validateOrder(s, 0, { type: 'develop', region: r.id, project: 'tradehub' })).toBeNull();   // a level-up keeps its slot
    expect(validateOrder(s, 0, { type: 'develop', region: r.id, project: 'station' })).toBeNull();
    r.buildings.station = 1;
    expect(validateOrder(s, 0, { type: 'develop', region: r.id, project: 'station' })).toMatch(/max level|already has a Station/);
    expect(validateOrder(s, 0, { type: 'develop', region: r.id, project: 'academy' })).toBeNull();
    r.bodies = [{ kind: 'gas', name: 'Tyr' }];
    expect(projectBlock(s, 0, 'mine', r.id)).toMatch(/gas giants have no surface/);
  });

  it('military slots: 2 everywhere, +1 at chokepoints', () => {
    const s = game();
    const r = real(s).find(x => x.kind === 'colony' && x.owner === null && !isChokepoint(s, x.id))!;
    own(s, r, 0, 3);
    r.buildings.fortress = 1; r.buildings.sensor = 1;
    s.players[0].res = { industry: 999, credits: 999, influence: 99 };
    s.players[0].techs = ['depots'];
    expect(validateOrder(s, 0, { type: 'develop', region: r.id, project: 'depot' })).toMatch(/no free military slot \(2\/2\)/);
    expect(validateOrder(s, 0, { type: 'develop', region: r.id, project: 'fortress' })).toBeNull();
    const choke = real(s).find(x => isChokepoint(s, x.id))!;
    expect(slotsOf(s, choke)!.mil).toBe(3);
  });

  it('waystation discount: military/logistics builds cost 30% less where citizens <= 1', () => {
    const s = game();
    const r = real(s).find(x => x.kind === 'colony' && x.owner === null)!;
    own(s, r, 0, 1);
    const base = s.rules.projects.fortress.cost;
    const c1 = orderCost(s, { type: 'develop', region: r.id, project: 'fortress' }, 0);
    expect(c1.industry).toBe(Math.round(base.industry! * 0.7));
    expect(c1.credits).toBe(Math.round(base.credits! * 0.7));
    r.dev = 2;
    expect(orderCost(s, { type: 'develop', region: r.id, project: 'fortress' }, 0).industry).toBe(base.industry);
    r.dev = 1;
    expect(orderCost(s, { type: 'develop', region: r.id, project: 'mine' }, 0).industry).toBe(s.rules.projects.mine.cost.industry);   // civil: no discount
  });

  it('trait effects are unchanged: a gas giant pays its credits, a forge its industry', () => {
    let checked = 0;
    for (let seed = 1; seed <= 12 && checked < 2; seed++) {
      const s = game(seed);
      for (const r of real(s).filter(x => x.trait === 'gas' || x.trait === 'forge').slice(0, 1)) {
        own(s, r, 0, 2);
        const on = incomeDetail(s, 0).total;
        s.rules.systems.enabled = false;
        expect(incomeDetail(s, 0).total).toEqual(on);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('the AI never plans an order the systems rules reject', () => {
    let s = createGame({ seed: 12, players: [0, 1, 2].map(() => ({ kind: 'ai' as const, aiLevel: 'expert' as const })) });
    let fails = 0, stations = 0;
    for (let i = 0; i < 14 && s.winner === null; i++) {
      const subs: Record<number, Submission> = {};
      for (const p of s.players) subs[p.id] = planTurn(s, p.id);
      for (const p of s.players) for (const o of subs[p.id].orders) if (o?.type === 'develop' && o.project === 'station') stations++;
      s = resolveTurn(s, subs);
      fails += s.last!.events.filter(e => e.k === 'fail' && e.owner >= 0 && /slot|citizens|Station|cap|mine|Trade Hub/.test(e.text)).length;
    }
    expect(fails).toBe(0);
    expect(stations).toBeGreaterThanOrEqual(0);
  });
});

describe('old rules and old maps keep their old behaviour', () => {
  it('rules without a systems group: no cap, no growth, no slots, no gravity well', () => {
    const s = game(31);
    delete (s.rules as { systems?: unknown }).systems;
    expect(sysOn(s)).toBe(false);
    const r = real(s).find(x => x.kind === 'colony' && x.owner === null && x.trait !== 'garden')!;
    own(s, r, 0, 1);
    r.bodies = [{ kind: 'gas', name: 'Tyr' }];
    expect(maxDevAt(s, r.id)).toBe(s.rules.economy.maxDev);
    expect(citizenCap(s, r)).toBeNull();
    expect(slotsOf(s, r)).toBeNull();
    expect(systemsBlock(s, 'academy', r)).toBeNull();
    expect(systemsBlock(s, 'station', r)).toMatch(/not in these rules/);
    expect(orderCost(s, { type: 'develop', region: r.id, project: 'fortress' }, 0).industry).toBe(s.rules.projects.fortress.cost.industry);
    let t = s;
    for (let i = 0; i < 3; i++) t = resolveTurn(t, idle(t));
    expect(t.regions[r.id].dev).toBe(1);
    // trait effects come from the trait field again
    r.trait = 'bulwark';
    expect(worldFx(s, r).bulwark).toBe(true);
  });

  it('systems disabled plays exactly like an old game (same seed, same AI: same result)', () => {
    const run = (rules: unknown, strip: boolean) => {
      let s = createGame({ seed: 4, rngSeed: 9, rules, players: [0, 1, 2].map(() => ({ kind: 'ai' as const })) });
      if (strip) for (const r of s.regions) { delete r.star; delete r.bodies; }
      for (let i = 0; i < 6; i++) { const subs: Record<number, Submission> = {}; for (const p of s.players) subs[p.id] = planTurn(s, p.id); s = resolveTurn(s, subs); }
      return JSON.stringify({ p: s.players.map(p => [p.vp, p.res]), r: s.regions.map(r => [r.owner, r.dev, r.buildings, r.garrison]), f: s.fleets.map(f => [f.id, f.region, f.ships.length]) });
    };
    // an old map (no stars) under the new rules == the same map with systems switched off
    expect(run({ systems: { enabled: false } }, false)).toBe(run(undefined, true));
  });

  it('a map without stars (an old save) is off even with the systems group present', () => {
    const s = game();
    for (const r of s.regions) { delete r.star; delete r.bodies; }
    expect(sysOn(s)).toBe(false);
    const home = s.regions[s.players[0].capital];
    expect(maxDevAt(s, home.id)).toBe(s.rules.economy.maxDev);
  });
});
