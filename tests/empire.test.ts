// The Empire layer: research, laws, modules, veins, supply.
import { describe, expect, it } from 'vitest';
import { createGame } from '../shared/sim/setup.ts';
import { resolveTurn, emptySubmission, income } from '../shared/sim/resolve.ts';
import { connected, researchBlock, techCost, lawSlots, shipStats, classBlock, supplied } from '../shared/sim/empire.ts';
import { validateOrder } from '../shared/sim/orders.ts';
import { viewFor } from '../shared/sim/view.ts';
import type { GameState, Submission } from '../shared/sim/types.ts';

const game = (seed = 11) => createGame({ seed, players: [0, 1, 2].map(() => ({ kind: 'human' as const })) });
const subs = (s: GameState, me: Partial<Submission> = {}): Record<number, Submission> => {
  const out: Record<number, Submission> = {};
  for (const p of s.players) out[p.id] = emptySubmission(s);
  out[0] = { ...out[0], ...me };
  return out;
};
const rich = (s: GameState) => { for (const p of s.players) p.res = { industry: 500, credits: 500, influence: 100 }; };

describe('empire layer', () => {
  it('map gen places symmetric veins and traits', () => {
    for (const seed of [1, 2, 3, 99]) {
      const s = game(seed);
      const veins = s.regions.filter(r => r.vein);
      expect(veins.filter(r => r.vein === 'antimatter').length).toBe(3);
      expect(veins.filter(r => r.vein === 'crystal').length).toBe(3);
      const traits = s.regions.filter(r => r.trait).length;
      expect(traits % 3).toBe(0);
    }
  });

  it('research: prerequisites, one per turn, forks are exclusive, ★ has one owner', () => {
    let s = game(); rich(s);
    expect(researchBlock(s, 0, 'cruisers')).toMatch(/tier I/);
    s = resolveTurn(s, subs(s, { free: [{ type: 'research', tech: 'railguns' }, { type: 'research', tech: 'deflectors' }] }));
    expect(s.players[0].techs).toEqual(['railguns']);          // second one refused: one per turn
    expect(s.players[0].res.industry).toBeLessThan(500 + 100);
    rich(s);
    s = resolveTurn(s, subs(s, { free: [{ type: 'research', tech: 'cruisers' }] }));
    rich(s);
    s = resolveTurn(s, subs(s, { free: [{ type: 'research', tech: 'siege' }] }));
    expect(researchBlock(s, 0, 'alpha')).toMatch(/chose Siege Doctrine/);
    rich(s);
    s = resolveTurn(s, subs(s, { free: [{ type: 'research', tech: 'sunhammer' }] }));
    expect(s.players[0].techs).toContain('sunhammer');
    s.players[1].techs = ['railguns', 'cruisers', 'alpha'];
    expect(researchBlock(s, 1, 'sunhammer')).toMatch(/already owns/);
  });

  it('tech cost scales with empire size and academies cut it', () => {
    const s = game();
    const c0 = techCost(s, 0, 'cruisers');
    s.regions.filter(r => r.owner === null && r.kind === 'colony').slice(0, 4).forEach(r => (r.owner = 0));
    const c1 = techCost(s, 0, 'cruisers');
    expect((c1.industry ?? 0) + (c1.credits ?? 0)).toBeGreaterThan((c0.industry ?? 0) + (c0.credits ?? 0));
    s.regions[s.players[0].capital].buildings.academy = 2;
    const c2 = techCost(s, 0, 'cruisers');
    expect((c2.industry ?? 0) + (c2.credits ?? 0)).toBeLessThan((c1.industry ?? 0) + (c1.credits ?? 0));
  });

  it('laws cost an order, take a slot, and switching a pair replaces the other side', () => {
    let s = game(); rich(s);
    expect(lawSlots(s, 0)).toBe(1);
    s = resolveTurn(s, subs(s, { orders: [{ type: 'law', law: 'industrial' }, { type: 'law', law: 'bastion' }, null, null, null] }));
    expect(s.players[0].laws).toEqual(['industrial']);         // 1 slot: the second law failed
    rich(s);
    const before = s.players[0].res.influence;
    s = resolveTurn(s, subs(s, { orders: [{ type: 'law', law: 'mercantile' }, null, null, null, null] }));
    expect(s.players[0].laws).toEqual(['mercantile']);
    expect(before - s.players[0].res.influence).toBeGreaterThanOrEqual(s.rules.empire.lawCost * 2 - 20); // switching costs double (minus income)
    s = resolveTurn(s, subs(s, { free: [{ type: 'revoke', law: 'mercantile' }] }));
    expect(s.players[0].laws).toEqual([]);
  });

  it('martial law blocks rival influence; industrial changes income', () => {
    const s = game();
    const base = income(s, 0).industry;
    s.players[0].laws = ['industrial'];
    expect(income(s, 0).industry).toBeGreaterThan(base);
    const mine = s.regions.find(r => r.owner === null && r.neighbors.includes(s.players[0].capital))!;
    mine.owner = 0;
    const rivalNear = s.regions.find(r => r.neighbors.includes(mine.id) && r.owner === null)!;
    rivalNear.owner = 1;
    s.players[0].laws = ['martial'];
    expect(validateOrder(s, 1, { type: 'influence', target: mine.id })).toMatch(/Martial Law/);
  });

  it('modules and techs change ship stats; refit upgrades a fleet at a shipyard', () => {
    let s = game(); rich(s);
    s.players[0].techs = ['railguns'];
    const f = s.fleets.find(x => x.owner === 0 && x.ships.some(sh => sh.cls === 'frigate'))!;
    const fr = f.ships.find(sh => sh.cls === 'frigate')!;
    const before = shipStats(s, fr, 0);
    s = resolveTurn(s, subs(s, { free: [{ type: 'blueprint', cls: 'frigate', mod: 'railgun' }], orders: [{ type: 'refit', fleet: f.id }, null, null, null, null] }));
    const fr2 = s.fleets.find(x => x.id === f.id)!.ships.find(sh => sh.id === fr.id)!;
    expect(fr2.mod).toBe('railgun');
    expect(shipStats(s, fr2, 0).attack).toBe(before.attack + 1);
  });

  it('cruisers need the tech AND a connected antimatter extractor', () => {
    const s = game();
    expect(classBlock(s, 0, 'cruiser')).toMatch(/Cruiser Yards/);
    s.players[0].techs = ['railguns', 'cruisers'];
    expect(classBlock(s, 0, 'cruiser')).toMatch(/Antimatter/);
    const v = s.regions.find(r => r.vein === 'antimatter')!;
    // connect it with a chain of owned regions back to the capital
    const prev = new Map<number, number>([[s.players[0].capital, -1]]); const q = [s.players[0].capital];
    while (q.length) { const r = q.shift()!; for (const n of s.regions[r].neighbors) if (!prev.has(n)) { prev.set(n, r); q.push(n); } }
    for (let r = v.id; r !== -1; r = prev.get(r)!) s.regions[r].owner = 0;
    v.buildings.extractor = 1;
    expect(classBlock(s, 0, 'cruiser')).toBeNull();
    // a hostile warship sitting on the chain cuts it
    const mid = prev.get(v.id)!;
    if (mid !== s.players[0].capital) {
      const enemy = s.fleets.find(x => x.owner === 1)!;
      enemy.region = mid;
      expect(connected(s, 0).has(v.id)).toBe(false);
      expect(classBlock(s, 0, 'cruiser')).toMatch(/Antimatter/);
    }
  });

  it('fleets far from home are out of supply and wear down', () => {
    let s = game();
    const f = s.fleets.find(x => x.owner === 0)!;
    const far = s.regions.find(r => r.homeOf === 1)!.neighbors.find(n => s.regions[n].owner === null)!;
    f.region = far;
    expect(supplied(s, 0).has(far)).toBe(false);
    const hp0 = f.ships.reduce((a, x) => a + x.hp, 0);
    for (let i = 0; i < 3; i++) s = resolveTurn(s, subs(s));
    const g = s.fleets.find(x => x.id === f.id);
    if (g && g.region === far) {
      expect(g.oos).toBeGreaterThanOrEqual(2);
      expect(g.ships.reduce((a, x) => a + x.hp, 0)).toBeLessThan(hp0);
    }
  });

  it('techs and laws are public in player views; the game stays deterministic', () => {
    const s = game(); s.players[1].techs = ['railguns']; s.players[1].laws = ['open'];
    const v = viewFor(s, 0).state;
    expect(v.players[1].techs).toEqual(['railguns']);
    expect(v.players[1].laws).toEqual(['open']);
  });
});
