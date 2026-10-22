// The simplified world (docs/SIMPLIFY.md §5): the opt-in `rules.world` group. B1 cuts Open the Gates, B3 replaces
// civil / military slots with per-track caps and stops new Stations, B4 cuts Engrave; old saves keep today's rules.
// Plus the Improve-track picker (nextInTrack) the world card and stage C share, and stage C itself: a develop order
// may name a track.
import { describe, expect, it } from 'vitest';
import { createGame, newFleet, newShip } from '../shared/sim/setup.ts';
import { resolveTurn, emptySubmission } from '../shared/sim/resolve.ts';
import { validateOrder, orderCost, describeOrder } from '../shared/sim/orders.ts';
import { defaultRules, upgradeRules, OPT_IN_LAYERS } from '../shared/config/rules.ts';
import { wpostureBlock } from '../shared/sim/signature.ts';
import { planTurn } from '../shared/sim/ai.ts';
import { Rng } from '../shared/sim/rng.ts';
import { worldOn, slotsCut, stationCut, stationUnblocks, trackCap, trackUsed, productiveBodies, isChokepoint, slotsOf } from '../shared/sim/systems.ts';
import { nextInTrack, trackSteps, trackMembers, isTrack } from '../shared/sim/tracks.ts';
import type { FreeAction, GameState, Order, Region, Submission } from '../shared/sim/types.ts';

const OLD = { world: { enabled: false } };
const game = (seed = 31, rules?: unknown) => createGame({ seed, rules, players: [0, 1, 2].map(() => ({ kind: 'human' as const })) });
const idle = (s: GameState): Record<number, Submission> => Object.fromEntries(s.players.map(p => [p.id, emptySubmission(s)]));
const real = (s: GameState) => s.regions.filter(r => r.kind !== 'lane');
const own = (s: GameState, r: Region, p = 0, dev = r.dev) => { r.owner = p; r.dev = dev; r.heldSince = 1; r.garrison = 10; r.project = null; };
const rich = (s: GameState) => { for (const p of s.players) p.res = { industry: 999, credits: 999, influence: 99 }; };
const dev = (r: Region, project: string): Order => ({ type: 'develop', region: r.id, project });
/** A quiet colony of player 0 with the given bodies. */
function colony(s: GameState, bodies: Region['bodies'], citizens = 3, vein: Region['vein'] = null): Region {
  const r = real(s).find(x => x.kind === 'colony' && x.owner === null && !isChokepoint(s, x.id))!;
  own(s, r, 0, citizens);
  r.star = 'yellow'; r.bodies = bodies; r.vein = vein; r.buildings = {};
  rich(s);
  return r;
}

describe('rules.world: the opt-in layer', () => {
  it('new games get it on; every knob defaults to the cut', () => {
    const s = game();
    expect(worldOn(s)).toBe(true);
    expect(s.rules.world).toMatchObject({ enabled: true, gatesPosture: false, slots: false, station: false, engrave: false });
    expect(slotsCut(s) && stationCut(s)).toBe(true);
    expect(OPT_IN_LAYERS).toContain('world');
  });
  it('a save from before the layer keeps today\'s rules (upgradeRules switches the group off); a save with it keeps it', () => {
    const saved = structuredClone(defaultRules()) as Record<string, unknown>;
    delete saved.world;
    const up = upgradeRules(saved);
    expect(up.world.enabled).toBe(false);
    const s = game(31, up);
    expect(worldOn(s) || slotsCut(s) || stationCut(s)).toBe(false);
    expect(upgradeRules(defaultRules()).world.enabled).toBe(true);
    // a save that tuned one knob keeps it, with the rest filled in
    const tuned = upgradeRules({ ...saved, world: { enabled: true, wallsCap: 2 } });
    expect(tuned.world).toMatchObject({ enabled: true, wallsCap: 2, outpostCap: 3, engrave: false });
  });
});

describe('B1: Open the Gates is cut', () => {
  it('the validator refuses it in the new rules, and keeps it in the old', () => {
    const s = game(), o = game(31, OLD);
    const cap = s.players[0].capital;
    expect(wpostureBlock(s, 0, cap, 'gates')).toMatch(/not in these rules/);
    expect(wpostureBlock(s, 0, cap, 'levies')).toBeNull();
    expect(wpostureBlock(s, 0, cap, 'scorch')).toBeNull();
    expect(wpostureBlock(o, 0, o.players[0].capital, 'gates')).toBeNull();
  });
  it('a Gates free action submitted anyway fails at resolve, and nothing is set', () => {
    const s = game();
    const cap = s.players[0].capital;
    const subs = idle(s);
    subs[0].free.push({ type: 'wposture', region: cap, posture: 'gates' } as FreeAction);
    const t = resolveTurn(s, subs);
    expect(t.regions[cap].wposture?.kind).not.toBe('gates');
  });
});

describe('B3: track caps instead of slots; no new Stations', () => {
  it('Works: one kind per productive body (at most worksCap); a level-up never needs room', () => {
    const s = game();
    const r = colony(s, [{ kind: 'habitable', q: 'fair', name: 'X I' }]);
    expect(productiveBodies(r)).toBe(1);
    expect(trackCap(s, r, 'works')).toBe(1);
    expect(validateOrder(s, 0, dev(r, 'tradehub'))).toBeNull();
    r.buildings.tradehub = 1;
    expect(trackUsed(r, 'works')).toBe(1);
    expect(validateOrder(s, 0, dev(r, 'academy'))).toMatch(/no Works site left \(1\/1\)/);
    expect(validateOrder(s, 0, dev(r, 'tradehub'))).toBeNull();
    // a moon is no Works site, a gas giant and a belt are; never more than worksCap
    r.bodies = [{ kind: 'habitable', q: 'fair', name: 'X I' }, { kind: 'moon', name: 'M' }, { kind: 'gas', name: 'G' }, { kind: 'belt', name: 'B' }];
    expect(productiveBodies(r)).toBe(3);
    expect(trackCap(s, r, 'works')).toBe(3);
    r.buildings.mine = 1; r.buildings.extractor = 1;   // 3 kinds now
    expect(validateOrder(s, 0, dev(r, 'academy'))).toMatch(/no Works site left \(3\/3\)/);
  });
  it('the Yard is its own track: a Shipyard no longer takes a Works site', () => {
    const s = game(), o = game(31, OLD);
    for (const g of [s, o]) {
      const r = colony(g, [{ kind: 'habitable', q: 'fair', name: 'X I' }]);
      r.buildings.tradehub = 1;
      const why = validateOrder(g, 0, dev(r, 'shipyard'));
      if (g === s) expect(why).toBeNull();
      else expect(why).toMatch(/no free civil slot/);
    }
  });
  it('Walls and Outpost: their own caps (the old shared military slots bound at 2)', () => {
    const s = game(), o = game(31, OLD);
    for (const g of [s, o]) {
      const r = colony(g, [{ kind: 'habitable', q: 'fair', name: 'X I' }]);
      g.players[0].techs = ['depots', 'batteries'];
      r.buildings.fortress = 1; r.buildings.sensor = 1;
      if (g === s) {
        expect(validateOrder(g, 0, dev(r, 'depot'))).toBeNull();
        expect(validateOrder(g, 0, dev(r, 'battery'))).toBeNull();
      } else {
        expect(slotsOf(g, r)!.mil).toBe(2);
        expect(validateOrder(g, 0, dev(r, 'depot'))).toMatch(/no free military slot \(2\/2\)/);
      }
    }
    // a tighter Walls cap binds, and a chokepoint raises it
    const t = game(31, { world: { wallsCap: 1 } });
    const r = colony(t, [{ kind: 'habitable', q: 'fair', name: 'X I' }]);
    t.players[0].techs = ['batteries'];
    r.buildings.fortress = 1;
    expect(validateOrder(t, 0, dev(r, 'battery'))).toMatch(/Walls track full \(1\/1\)/);
    const choke = real(t).find(x => isChokepoint(t, x.id))!;
    expect(trackCap(t, choke, 'walls')).toBe(2);
  });
  it('no new Stations; the AI\'s Station path is closed; built Stations keep their cap', () => {
    const s = game(), o = game(31, OLD);
    const r = colony(s, [{ kind: 'habitable', q: 'fair', name: 'X I' }], 1);
    expect(validateOrder(s, 0, dev(r, 'station'))).toMatch(/no new Stations/);
    expect(stationUnblocks(s, 'shipyard', r)).toBe(false);
    // the gate's reason no longer offers a Station
    expect(validateOrder(s, 0, dev(r, 'shipyard'))).toMatch(/needs 2 citizens \(1 now\)/);
    expect(validateOrder(s, 0, dev(r, 'shipyard'))).not.toMatch(/Station/);
    const q = colony(o, [{ kind: 'habitable', q: 'fair', name: 'X I' }], 1);
    expect(validateOrder(o, 0, dev(q, 'station'))).toBeNull();
    expect(stationUnblocks(o, 'shipyard', q)).toBe(true);
    // an old Station still lets a 1-citizen system raise a yard
    r.buildings.station = 1;
    expect(validateOrder(s, 0, dev(r, 'shipyard'))).toBeNull();
  });
});

describe('B4: Engrave is cut', () => {
  it('the order is refused in the new rules, and still works in the old', () => {
    for (const [g, ok] of [[game(11), false], [game(11, OLD), true]] as const) {
      const r = g.regions[g.players[0].capital];
      r.story!.deeds = [{ id: 'unbroken', turn: 1, name: 'Unbroken' }];
      rich(g);
      const why = validateOrder(g, 0, { type: 'engrave', region: r.id, deed: 'unbroken' });
      if (ok) expect(why).toBeNull(); else expect(why).toMatch(/Engrave is not in these rules/);
    }
  });
});

describe('the Improve tracks: nextInTrack', () => {
  it('Works: Extractor on a vein first, then +1 citizen on a world that does not grow, Mine before Trade Hub, Academy last', () => {
    const s = game();
    const r = colony(s, [{ kind: 'barren', name: 'R' }, { kind: 'barren', name: 'Q' }, { kind: 'gas', name: 'G', vein: 'antimatter' }], 1, 'antimatter');   // cap 2: a Harbor
    expect(trackSteps(s, r, 'works').map(x => x.key)).toEqual(['extractor', 'develop', 'mine', 'tradehub', 'mine', 'tradehub', 'mine', 'tradehub']);
    expect(nextInTrack(s, 0, r, 'works').key).toBe('extractor');
    r.buildings.extractor = 1;
    expect(nextInTrack(s, 0, r, 'works').key).toBe('develop');
    r.dev = 2;   // at the cap (two barren worlds): the picker moves on to the Mine
    expect(nextInTrack(s, 0, r, 'works')).toMatchObject({ key: 'mine', to: 1, why: null });
    r.buildings.mine = 1;
    expect(nextInTrack(s, 0, r, 'works').key).toBe('tradehub');
    // a Core grows by itself: no +1 citizen in its Works; the Academy is its last member
    const c = s.regions[s.players[0].capital];
    expect(trackSteps(s, c, 'works').some(x => x.key === 'develop')).toBe(false);
    expect(trackSteps(s, c, 'works').at(-1)!.key).toBe('academy');
    expect(trackMembers(s, c, 'works').map(m => m.key)).toContain('develop');   // still reachable from the member list
    expect(trackMembers(s, c, 'works').map(m => m.key)).not.toContain('station');
  });
  it('Outpost waits for its Depot (the track says why), except at a Waystation; Walls skips what is not researched', () => {
    const s = game();
    const r = colony(s, [{ kind: 'habitable', q: 'fair', name: 'X I' }, { kind: 'belt', name: 'B' }], 3);
    s.players[0].techs = [];
    expect(nextInTrack(s, 0, r, 'outpost')).toMatchObject({ key: 'depot', why: expect.stringMatching(/needs Supply Depots/) });
    r.dev = 1;   // a Waystation may start with the Sensor
    expect(nextInTrack(s, 0, r, 'outpost')).toMatchObject({ key: 'sensor', why: null });
    s.players[0].techs = ['depots'];
    expect(nextInTrack(s, 0, r, 'outpost').key).toBe('depot');
    expect(nextInTrack(s, 0, r, 'walls').key).toBe('fortress');
    r.buildings.fortress = 1;
    expect(nextInTrack(s, 0, r, 'walls')).toMatchObject({ key: 'fortress', to: 2 });   // no Batteries researched
    s.players[0].techs = ['batteries'];
    expect(nextInTrack(s, 0, r, 'walls')).toMatchObject({ key: 'battery', to: 1 });
  });
  it('a project underway, the citizens gate and a maxed track give one reason for the whole track', () => {
    const s = game();
    const r = colony(s, [{ kind: 'habitable', q: 'fair', name: 'X I' }], 1);
    expect(nextInTrack(s, 0, r, 'yard')).toMatchObject({ key: 'shipyard', order: null, why: expect.stringMatching(/needs 2 citizens/) });
    r.project = { key: 'mine', progress: 0, owner: 0 };
    expect(nextInTrack(s, 0, r, 'walls').why).toMatch(/already underway/);
    r.project = null; r.dev = 3; r.buildings.shipyard = 3;
    expect(nextInTrack(s, 0, r, 'yard')).toMatchObject({ key: null, why: 'max' });
  });
});

describe('stage C: a develop order may name a track', () => {
  it('validates, costs and reads as the building the track picks', () => {
    const s = game();
    const r = colony(s, [{ kind: 'habitable', q: 'fair', name: 'X I' }, { kind: 'belt', name: 'B' }], 3);
    expect(isTrack('walls') && !isTrack('fortress')).toBe(true);
    const o: Order = { type: 'develop', region: r.id, project: 'walls' };
    expect(validateOrder(s, 0, o)).toBeNull();
    expect(orderCost(s, o, 0)).toEqual(orderCost(s, dev(r, 'fortress'), 0));
    expect(describeOrder(s, o)).toMatch(/^Walls at /);
    expect(validateOrder(s, 1, o)).toMatch(/not your region/);
  });
  it('resolves to the concrete project and builds it; a stuck track fails with its reason', () => {
    const s = game();
    const r = colony(s, [{ kind: 'habitable', q: 'fair', name: 'X I' }, { kind: 'belt', name: 'B' }], 3);
    const subs = idle(s);
    subs[0].orders[0] = { type: 'develop', region: r.id, project: 'works' };
    const t = resolveTurn(s, subs);
    expect(t.regions[r.id].project?.key ?? (t.regions[r.id].buildings.mine ? 'mine' : null)).toBe('mine');
    const u = game();
    const q = colony(u, [{ kind: 'habitable', q: 'fair', name: 'X I' }], 1);
    const s2 = idle(u);
    s2[0].orders[0] = { type: 'develop', region: q.id, project: 'yard' };
    const t2 = resolveTurn(u, s2);
    expect((t2.last?.events ?? []).some(e => e.k === 'fail' && e.owner === 0 && /needs 2 citizens/.test((e as { text: string }).text))).toBe(true);
  });
});

describe('the AI adapts through the validators', () => {
  it('expert AIs play new-rules turns without proposing cut options or wasting orders on them', () => {
    let s = createGame({ seed: 7, players: [0, 1, 2].map(() => ({ kind: 'ai' as const, aiLevel: 'expert' as const })) });
    const rng = new Rng(3);
    // a battered ally beside a world: the old AI would Open the Gates for it
    const f = newFleet(s, rng, 1, s.players[0].capital);
    f.ships.push(newShip(s, rng, 'frigate', 1));
    f.ships[0].hp = 1;
    s.pacts.push({ a: 0, b: 1, until: 99 });
    let bad = 0, fails = 0;
    for (let i = 0; i < 8; i++) {
      const subs: Record<number, Submission> = {};
      for (const p of s.players) {
        subs[p.id] = planTurn(s, p.id);
        bad += subs[p.id].orders.filter(o => !!o && (o.type === 'engrave' || (o.type === 'develop' && o.project === 'station'))).length;
        bad += subs[p.id].free.filter(x => x.type === 'wposture' && x.posture === 'gates').length;
      }
      s = resolveTurn(s, subs);
      fails += (s.last?.events ?? []).filter(e => e.k === 'fail' && /Station|Engrave|Gates/.test((e as { text: string }).text)).length;
    }
    expect(bad).toBe(0);
    expect(fails).toBe(0);
  });
});
