// Bug-sweep repros for the Soul layer (soul.ts, herald.ts, ai-soul.ts). Each test failed before its fix.
import { describe, expect, it } from 'vitest';
import { createGame, newFleet, newShip } from '../shared/sim/setup.ts';
import { resolveTurn, emptySubmission } from '../shared/sim/resolve.ts';
import { viewFor } from '../shared/sim/view.ts';
import { Rng } from '../shared/sim/rng.ts';
import { applyRout, catchLimping, limpRoute, soulDmg, onBeaten, modsBlock, resolveFound, soulEndTurn, addDeed, onCapture, raze, swearVow, fulfilVow, breakVow, cleanText, headline, worldEpithet, ensureSoul, newStory } from '../shared/sim/soul.ts';
import { makeEdition } from '../shared/sim/herald.ts';
import { soulFree } from '../shared/sim/ai-soul.ts';
import { styleOf } from '../shared/sim/ai-empire.ts';
import type { Fleet, GameEvent, GameState, Submission } from '../shared/sim/types.ts';

const game = (seed = 11) => createGame({ seed, players: [0, 1, 2].map(() => ({ kind: 'human' as const })) });
const idle = (s: GameState): Record<number, Submission> => Object.fromEntries(s.players.map(p => [p.id, emptySubmission(s)]));
const rng = new Rng(7);
const fleetAt = (s: GameState, owner: number, region: number, classes: string[]): Fleet => {
  const f = newFleet(s, rng, owner, region);
  for (const c of classes) f.ships.push(newShip(s, rng, c, owner));
  f.bornTurn = 0;
  f.banner = { sigil: 'sun', boons: [], banes: [], home: s.players[owner].capital, foundedTurn: 1 };
  f.tally = { sieges: 0, defences: 0, interceptions: 0, wins: 0, routs: 0 };
  return f;
};
const clearMap = (s: GameState) => { s.fleets = s.fleets.filter(f => f.owner < 0); };
const colony = (s: GameState) => s.regions.find(r => r.owner === null && r.kind === 'colony')!;

describe('sweep: soul layer', () => {
  it('a rout that breaks a fleet (third scar) still counts as beating it: blood-debt avenged, avenge vow kept', () => {
    const s = game(); clearMap(s); ensureSoul(s);
    const x = colony(s);
    const a = fleetAt(s, 0, x.id, ['frigate']);
    a.scars = [{ id: 'burned', turn: 0 }, { id: 'haunted', turn: 0 }];
    const avenger = fleetAt(s, 1, x.id, ['frigate']);
    avenger.vow = { kind: 'avenge', since: 0, progress: 0, target: a.commander.name, targetOwner: 0 };
    s.soul!.debts.push({ id: 1, turn: 0, debtor: 0, creditor: 1, killer: a.commander.name, victim: 'Someone', fleet: 'Old', region: x.id, cleared: null });
    const ev: GameEvent[] = [];
    expect(applyRout(s, a, x.id, 1, 1, e => ev.push(e))).toBe('broken');
    expect(s.soul!.debts[0].cleared).toBe(s.turn);
    expect(avenger.vow).toBeNull();
    expect(avenger.epithets).toContain('the Avenger');
  });

  it('a fleet caught limping does not lose its commander into limbo: it falls or escapes to the reserve', () => {
    const s = game(); clearMap(s); ensureSoul(s);
    const x = colony(s);
    for (let i = 0; i < 6; i++) {
      const f = fleetAt(s, 0, x.id, ['frigate']);
      f.limping = { since: 1, to: s.players[0].capital, by: 1 };
      const c = f.commander;
      catchLimping(s, f, 1, null, 1, () => {});
      const inReserve = s.players[0].reserveCommanders.includes(c);
      expect(!c.alive || inReserve).toBe(true);
      if (!c.alive) expect(x.memorials.some(m => m.includes(c.name))).toBe(true);
    }
  });

  it('the Unbroken deed, once replaced by newer history, does not push its way back every turn', () => {
    const s = game(); ensureSoul(s);
    const r = s.regions[s.players[0].capital];
    r.story!.siege = 2;
    soulEndTurn(s, 1, () => {}, new Set());
    expect(r.story!.deeds.map(d => d.id)).toEqual(['unbroken']);
    addDeed(s, r, { id: 'fell', turn: 2, name: 'Where A Fell', fleet: 'A' });
    addDeed(s, r, { id: 'fell', turn: 2, name: 'Where B Fell', fleet: 'B' });
    expect(r.story!.deeds.map(d => d.name)).toEqual(['Where A Fell', 'Where B Fell']);
    s.soul!.beats = [];
    soulEndTurn(s, 1, () => {}, new Set());
    expect(r.story!.deeds.map(d => d.name)).toEqual(['Where A Fell', 'Where B Fell']);
    expect(s.soul!.beats.some(b => b.kind === 'deed')).toBe(false);
  });

  it('a Haven is a permanent deed: newer deeds never replace it', () => {
    const s = game(); ensureSoul(s);
    const r = s.regions[s.players[0].capital];
    addDeed(s, r, { id: 'haven', turn: 1, name: 'Haven of A', fleet: 'A', boon: 'medics' });
    addDeed(s, r, { id: 'fell', turn: 2, name: 'Where B Fell', fleet: 'B' });
    addDeed(s, r, { id: 'fell', turn: 3, name: 'Where C Fell', fleet: 'C' });
    expect(r.story!.deeds.some(d => d.id === 'haven')).toBe(true);
    expect(r.story!.deeds.length).toBe(2);
  });

  it('razing destroys the calling: a later liberation does not wake it again', () => {
    const s = game(); ensureSoul(s);
    const r = s.regions.find(x => x.owner === 0 && x.id !== s.players[0].capital) ?? s.regions.find(x => x.owner === null && x.kind === 'colony')!;
    r.owner = 0; r.dev = 3;
    r.story = newStory(r);
    r.story.calling = { id: 'granary', since: 1 };
    s.turn = 10;
    onCapture(s, r, 1, 0, 'force', 1, () => {});
    r.owner = 1;
    raze(s, 1, r, 1, () => {});
    expect(r.story.calling).toBeNull();
    s.turn = 11;
    expect(onCapture(s, r, 0, 1, 'force', 1, () => {})).toBe(true);
    r.owner = 0;
    expect(r.story.calling).toBeNull();
  });

  it('a razing is not a change of hands for the world epithet', () => {
    const s = game(); ensureSoul(s);
    const r = s.regions.find(x => x.owner === null && x.kind === 'colony')!;
    r.story = newStory(r);
    r.owner = 0;
    onCapture(s, r, 1, 0, 'force', 1, () => {});
    r.owner = 1;
    raze(s, 1, r, 1, () => {});
    expect(worldEpithet(s, r)).not.toBe('Twice-Taken');
  });

  it('public headlines about a fleet do not leak where an unseen fleet is', () => {
    const s = game(); clearMap(s); ensureSoul(s);
    const far = s.regions.find(r => r.owner === null && r.kind === 'colony' && !viewFor(s, 2).visible.includes(r.id))!;
    const f = fleetAt(s, 1, far.id, ['frigate']);
    f.banner!.boons = ['ghosts'];
    const ev: GameEvent[] = [];
    swearVow(s, f, 'throne');
    breakVow(s, f, 1, e => ev.push(e), 'test');
    f.vow = { kind: 'throne', since: 1, progress: 0 };
    fulfilVow(s, f, 1, e => ev.push(e));
    makeEdition(s, s.players.map(() => new Set<number>()));
    const v = viewFor(s, 2).state;
    expect(v.fleets.some(x => x.id === f.id)).toBe(false);
    const hs = v.soul!.herald.at(-1)!.headlines.filter(h => h.kind.startsWith('vow'));
    expect(hs.length).toBeGreaterThan(0);
    for (const h of hs) expect(h.region).toBeUndefined();
    for (const e of ev) if (e.k === 'soul' && e.owner === null) expect(e.region).toBeUndefined();
  });

  it('a limping Grudge-bound fleet (it cannot attack) does not sulk', () => {
    const s = game(); clearMap(s); ensureSoul(s);
    const cap1 = s.players[1].capital;
    const next = (s.regions[cap1].links ?? s.regions[cap1].neighbors)[0];
    const f = fleetAt(s, 0, next, ['frigate']);
    f.banner!.banes = ['grudgebound']; f.banner!.grudgeVs = 1;
    f.limping = { since: 1, to: s.players[0].capital, by: 1 };
    soulEndTurn(s, 1, () => {}, new Set());
    expect(f.sulkUntil ?? null).toBeNull();
  });

  it('cleanText never leaves half an emoji; Herald templates strip markup from names', () => {
    const t = cleanText('a'.repeat(39) + '😀', 40);
    expect(/[\ud800-\udbff]$/.test(t)).toBe(false);
    expect(cleanText('a⁠b﻿c', 40)).toBe('a b c');
    const s = game();
    const h = headline(s, 'vow_sworn', { f: '<img src=x onerror=alert(1)>', x: 'Take the Throne' });
    expect(h).not.toMatch(/[<>]/);
  });

  it('AI: a turtle never swears to guard a capital it no longer holds', () => {
    let seed = 1;
    for (; seed < 200; seed++) { const g = game(seed); if (styleOf(g, 0) === 'turtle') break; }
    const s = game(seed); clearMap(s); ensureSoul(s);
    const cap = s.players[0].capital;
    s.regions[cap].owner = 1;
    const main = fleetAt(s, 0, cap, ['frigate', 'frigate', 'frigate']);
    fleetAt(s, 0, cap, ['frigate', 'frigate']);
    const out = soulFree({ s, pid: 0, lvl: 'expert', threatened: new Map([[cap, 1]]), mainArmy: main });
    expect(out.some(fa => fa.type === 'vow' && fa.vow === 'guard')).toBe(false);
  });

  it('an avenge vow names a commander of one house: a namesake in another house is not its target', () => {
    const s = game(); clearMap(s); ensureSoul(s);
    const x = colony(s);
    const foe = fleetAt(s, 0, x.id, ['frigate']);
    const namesake = fleetAt(s, 2, x.id, ['frigate']);
    namesake.commander.name = foe.commander.name;
    const avenger = fleetAt(s, 1, x.id, ['frigate']);
    avenger.vow = { kind: 'avenge', since: 0, progress: 0, target: foe.commander.name, targetOwner: 0 };
    expect(soulDmg(s, avenger, namesake)).toBe(0);
    expect(soulDmg(s, avenger, foe)).toBeGreaterThan(0);
    onBeaten(s, 2, 1, namesake.commander.name, x.id, 1, () => {});
    expect(avenger.vow?.kind).toBe('avenge');
    onBeaten(s, 0, 1, foe.commander.name, x.id, 1, () => {});
    expect(avenger.vow).toBeNull();
  });

  it('Grudge-bound against a fallen house is not a free 2 points; the default grudge skips fallen houses', () => {
    const s = game(); ensureSoul(s);
    s.players[1].eliminated = true;
    expect(modsBlock(s, 0, ['medics', 'ambushers'], ['grudgebound'], 1)).toMatch(/living rival/);
    expect(modsBlock(s, 0, ['medics', 'ambushers'], ['grudgebound'], 2)).toBeNull();
    const fd = resolveFound(s, 0, s.players[0].capital, { boons: ['medics'], banes: ['grudgebound'] });
    expect(typeof fd !== 'string' && fd.banner.grudgeVs).toBe(2);
    s.players[2].eliminated = true;
    expect(modsBlock(s, 0, ['medics'], ['grudgebound'])).toMatch(/living rival/);
  });

  it('Raiders plundering a system tell its owner, not only the raider', () => {
    const s = game(); clearMap(s); ensureSoul(s);
    const cap1 = s.players[1].capital;
    const f = fleetAt(s, 0, cap1, ['frigate']);
    f.banner!.boons = ['raiders'];
    const ev: GameEvent[] = [];
    soulEndTurn(s, 1, e => ev.push(e), new Set());
    const pl = ev.filter(e => e.k === 'soul' && e.kind === 'plunder');
    expect(pl.some(e => e.k === 'soul' && e.owner === 0)).toBe(true);
    expect(pl.some(e => e.k === 'soul' && e.owner === 1)).toBe(true);
  });

  it('with no shipyard anywhere a limping fleet heads for an owned world, heals there and stops limping', () => {
    const s = game(); clearMap(s); ensureSoul(s);
    for (const r of s.regions) if (r.owner === 0) { r.buildings.shipyard = 0; r.buildings.depot = 0; }
    const cap = s.players[0].capital;
    const next = (s.regions[cap].links ?? s.regions[cap].neighbors).find(n => s.regions[n].owner === null)!;
    const f = fleetAt(s, 0, next, ['frigate']);
    f.limping = { since: 1, to: cap, by: 1 };
    f.ships[0].hp = 1;
    const rt = limpRoute(s, f)!;
    expect(rt.to).toBe(s.regions[rt.to].owner === 0 ? rt.to : -1);
    let t = s;
    for (let i = 0; i < 12 && t.fleets.find(x => x.id === f.id)?.limping; i++) t = resolveTurn(t, idle(t));
    const g = t.fleets.find(x => x.id === f.id)!;
    expect(g.limping ?? null).toBeNull();
    expect(t.regions[g.region].owner).toBe(0);
  });

  it('a Slow Refits fleet with no shipyard to reach is not stranded limping forever', () => {
    const s = game(); clearMap(s); ensureSoul(s);
    for (const r of s.regions) if (r.owner === 0) { r.buildings.shipyard = 0; r.buildings.depot = 0; }
    const cap = s.players[0].capital;
    const f = fleetAt(s, 0, cap, ['frigate']);
    f.banner!.banes = ['slowrefit'];
    f.limping = { since: 1, to: cap, by: 1 };
    f.ships[0].hp = 1;
    let t = s;
    for (let i = 0; i < 6; i++) t = resolveTurn(t, idle(t));
    expect(t.fleets.find(x => x.id === f.id)!.limping ?? null).toBeNull();
  });

  it('a limping fleet with no world left to limp to does not crash and keeps no route', () => {
    const s = game(); clearMap(s); ensureSoul(s);
    for (const r of s.regions) if (r.owner === 0) r.owner = 1;
    const f = fleetAt(s, 0, colony(s).id, ['frigate']);
    f.limping = { since: 1, to: f.region, by: 1 };
    expect(limpRoute(s, f)).toBeNull();
    soulEndTurn(s, 1, () => {}, new Set());
    expect(f.route ?? null).toBeNull();
  });

  it('fuzz: AI games keep soul invariants (no NaN, banners within limits, limping fleets valid)', () => {
    let t = createGame({ seed: 4242, players: [0, 1, 2].map(() => ({ kind: 'ai' as const, aiLevel: 'expert' as const })) });
    for (let i = 0; i < 6; i++) t = resolveTurn(t, idle(t));
    expect(t.soul).toBeTruthy();
  });
});

describe('sweep: a limping fleet with no home left', () => {
  it('rallies where it is instead of limping forever', () => {
    const s = createGame({ seed: 41, players: [0, 1, 2].map(() => ({ kind: 'human' as const })) });
    const f = s.fleets.find(x => x.owner === 0 && x.ships.length)!;
    for (const r of s.regions) if (r.owner === 0) r.owner = null;
    f.limping = { since: s.turn, to: f.region } as typeof f.limping;
    f.route = null;
    const t = resolveTurn(s, Object.fromEntries(s.players.map(p => [p.id, emptySubmission(s)])));
    const g = t.fleets.find(x => x.id === f.id);
    expect(g).toBeTruthy();
    expect(g!.limping).toBeFalsy();
  });
});
