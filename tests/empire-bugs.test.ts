// Regression tests for Empire-layer bugs (research, laws, modules, cost modifiers, order validation).
import { describe, expect, it } from 'vitest';
import { createGame } from '../shared/sim/setup.ts';
import { resolveTurn, emptySubmission } from '../shared/sim/resolve.ts';
import {
  researchBlock, researchedThisTurn, researchable, techCost, lawBlock, lawCost, lawSlots, opposite, shipStats, baseHp,
  blueprintFor, classBlock, projectBlock, shipCostMod, lookup,
} from '../shared/sim/empire.ts';
import { describeOrder, orderCost, validateOrder } from '../shared/sim/orders.ts';
import { TECH } from '../shared/config/empire.ts';
import type { GameState, Submission } from '../shared/sim/types.ts';

const game = (seed = 11, rules?: unknown) =>
  createGame({ seed, players: [0, 1, 2].map(() => ({ kind: 'human' as const })), ...(rules ? { rules } : {}) } as any);
const subs = (s: GameState, me: Partial<Submission> = {}): Record<number, Submission> => {
  const out: Record<number, Submission> = {};
  for (const p of s.players) out[p.id] = emptySubmission(s);
  out[0] = { ...out[0], ...me };
  return out;
};
const rich = (s: GameState) => { for (const p of s.players) p.res = { industry: 500, credits: 500, influence: 100 }; };
const PROTO_KEYS = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'];

describe('empire bugs: prototype keys are never real ids', () => {
  it('lookup only sees own properties', () => {
    for (const k of PROTO_KEYS) expect(lookup(TECH, k)).toBeUndefined();
    expect(lookup(TECH, 'railguns')?.id).toBe('railguns');
    expect(lookup(TECH, 7)).toBeUndefined();
  });

  it('researchBlock / techCost reject prototype keys (used to return null and a NaN price)', () => {
    const s = game();
    for (const k of PROTO_KEYS) {
      expect(researchBlock(s, 0, k)).toBe('unknown technology');
      expect(techCost(s, 0, k)).toEqual({});
    }
    expect(researchable(s, 0).every(t => Object.hasOwn(TECH, t.id))).toBe(true);
  });

  it('lawBlock / validateOrder / orderCost / opposite reject prototype keys as laws', () => {
    const s = game(); rich(s);
    for (const k of PROTO_KEYS) {
      expect(lawBlock(s, 0, k)).toBe('unknown law');
      expect(validateOrder(s, 0, { type: 'law', law: k })).toBe('unknown law');
      expect(orderCost(s, { type: 'law', law: k }, 0)).toEqual({ influence: 0 });
      expect(opposite(k)).toBeNull();
    }
    expect(describeOrder(s, { type: 'law', law: 'constructor' })).toBe('Enact constructor');
    expect(opposite('bastion')).toBe('vanguard');
    expect(lawCost(s, 0, 'bastion')).toBe(s.rules.empire.lawCost);
  });

  it('ship / project helpers treat prototype keys as unknown', () => {
    const s = game();
    const sh = s.fleets.find(f => f.owner === 0)!.ships[0];
    const fr = s.rules.ships.frigate;
    const st = shipStats(s, { ...sh, cls: 'constructor', mod: null }, -1);
    expect(st.attack).toBe(fr.attack);           // falls back to frigate, not Object()
    expect(Number.isFinite(st.speed)).toBe(true);
    expect(baseHp(s, 'constructor', null)).toBe(10);
    expect(classBlock(s, 0, 'constructor')).toBeNull();
    expect(projectBlock(s, 0, 'constructor', s.players[0].capital)).toBeNull();
    expect(validateOrder(s, 0, { type: 'develop', region: s.players[0].capital, project: 'constructor' })).toBe('unknown project');
    expect(validateOrder(s, 0, { type: 'build', region: s.players[0].capital, cls: '__proto__', fleet: null })).toBe('unknown ship class');
    // a blueprint table can't make prototype keys resolve to a module
    s.players[0].blueprint = {};
    expect(blueprintFor(s, 0, 'constructor')).toBe('armor');
    expect(blueprintFor(s, 0, 'toString')).toBe('armor');
  });
});

describe('empire bugs: research per-turn limit', () => {
  it('a turn after researching, planning sees the limit as fresh (it used to block every other turn)', () => {
    let s = game(); rich(s);
    s = resolveTurn(s, subs(s, { free: [{ type: 'research', tech: 'railguns' }] }));
    expect(s.players[0].techs).toEqual(['railguns']);
    expect(s.players[0].researched).toBe(0);            // reset when the turn ends
    expect(researchedThisTurn(s, 0)).toBe(0);
    expect(researchBlock(s, 0, 'cruisers')).toBeNull();
    rich(s);
    s = resolveTurn(s, subs(s, { free: [{ type: 'research', tech: 'cruisers' }, { type: 'research', tech: 'deflectors' }] }));
    expect(s.players[0].techs).toEqual(['railguns', 'cruisers']);  // still one per turn while resolving
    expect(s.last!.events.some(e => e.k === 'fail' && /one technology per turn/.test((e as any).text))).toBe(true);
  });

  it('LIVE: the counter holds mid-cycle and resets once the next tick opens a cycle', () => {
    const s = game();
    s.players[0].researched = 1;
    s.last = {} as any;   // between ticks
    const per = s.rules.live.ticksPerCycle;
    s.live = { tick: 3 } as any;
    expect(researchedThisTurn(s, 0)).toBe(1);
    expect(researchBlock(s, 0, 'railguns')).toBe('one technology per cycle');
    s.live = { tick: per } as any;
    expect(researchedThisTurn(s, 0)).toBe(0);
    expect(researchBlock(s, 0, 'railguns')).toBeNull();
    s.last = null;        // resolving a tick: the counter is authoritative
    expect(researchedThisTurn(s, 0)).toBe(1);
  });
});

describe('empire bugs: costs', () => {
  it('techCost never goes negative under tweaked rules', () => {
    const s = game(11, { empire: { academyMaxDiscount: 3, academyDiscount: 2, techCreditShare: 1.5 } });
    s.regions[s.players[0].capital].buildings.academy = 2;
    for (const t of Object.keys(TECH)) {
      const c = techCost(s, 0, t);
      expect(c.industry).toBeGreaterThanOrEqual(0);
      expect(c.credits).toBeGreaterThanOrEqual(0);
    }
    const s2 = game(11, { empire: { techCreditShare: 1.5 } });
    const c2 = techCost(s2, 0, 'railguns');
    expect(c2.industry).toBe(0);
    expect(c2.credits).toBeGreaterThan(0);
  });

  it('shipCostMod does not write through to the cost it is given', () => {
    const s = game();
    s.players[0].laws = ['industrial'];
    s.players[0].techs = ['railguns', 'cruisers', 'siege'];
    const rulesCost = s.rules.ships.bombard.cost;
    const before = { ...rulesCost };
    const c = shipCostMod(s, 0, 'bombard', rulesCost);
    expect(rulesCost).toEqual(before);
    expect(c.industry).toBeLessThan(before.industry!);
    expect(c.credits).toBe(before.credits);   // Siege Doctrine: industry only (as its description now says)
    expect(TECH.siege.desc).toMatch(/25% less industry/);
  });

  it('dreadnought prerequisites are described on both techs that unlock them', () => {
    const s = game();
    for (const t of s.rules.ships.dread.tech!) expect(TECH[t].desc).toMatch(/Dreadnought/);
  });

  it('lawSlots tolerates a malformed lawSlotTurns override', () => {
    const s = game(11, { empire: { lawSlotTurns: 10 } });
    expect(lawSlots(s, 0)).toBe(s.rules.empire.lawSlotsStart);
  });
});

describe('empire bugs: refit', () => {
  it('ships from saves without a module field are not "outdated" when the empire layer is off', () => {
    const s = game(11, { empire: { enabled: false } });
    const f = s.fleets.find(x => x.owner === 0)!;
    for (const sh of f.ships) delete (sh as any).mod;
    s.regions[f.region].owner = 0;
    s.regions[f.region].buildings.shipyard = 1;
    expect(orderCost(s, { type: 'refit', fleet: f.id }, 0)).toEqual({});
    expect(validateOrder(s, 0, { type: 'refit', fleet: f.id })).toMatch(/already up to date/);
  });

  it('with the empire layer on, an old ship without a module still needs a refit', () => {
    const s = game();
    const f = s.fleets.find(x => x.owner === 0)!;
    for (const sh of f.ships) delete (sh as any).mod;
    s.regions[f.region].owner = 0;
    s.regions[f.region].buildings.shipyard = 1;
    expect(orderCost(s, { type: 'refit', fleet: f.id }, 0).industry).toBe(f.ships.length * s.rules.empire.refitIndustryPerShip);
    expect(validateOrder(s, 0, { type: 'refit', fleet: f.id })).toBeNull();
  });
});

describe('order validation: combined assaults', () => {
  it('more joiners than the resolver accepts is an error, not a silent drop', () => {
    const s = game();
    const mine = s.fleets.filter(f => f.owner === 0);
    const cap = s.players[0].capital;
    const target = s.regions[cap].links!.find(n => s.regions[n].owner !== 0 && s.regions[n].kind !== 'lane')!;
    const extra = [0, 1, 2].map(i => ({ ...structuredClone(mine[0]), id: 9000 + i, region: cap }));
    s.fleets.push(...extra);
    for (const f of [...mine, ...extra]) { f.region = cap; f.bornTurn = 0; }
    const lead = mine[0].id;
    const three = [mine[1].id, mine[2].id, extra[0].id];
    expect(validateOrder(s, 0, { type: 'seize', fleet: lead, target, also: three })).toBeNull();
    expect(validateOrder(s, 0, { type: 'seize', fleet: lead, target, also: [...three, three[0], lead] })).toBeNull(); // dupes / self don't count
    expect(validateOrder(s, 0, { type: 'seize', fleet: lead, target, also: [...three, extra[1].id] })).toMatch(/at most 3 fleets/);
  });
});

describe('empire bugs: revoke-then-enact', () => {
  it('revoking the other side earlier in the turn still makes the switch cost double', () => {
    const s = game();
    s.players[0].laws = [];
    s.players[0].revokedThisTurn = ['mercantile'];
    expect(lawCost(s, 0, 'industrial')).toBe(s.rules.empire.lawCost * 2);
    expect(lawCost(s, 0, 'bastion')).toBe(s.rules.empire.lawCost);
  });
});
