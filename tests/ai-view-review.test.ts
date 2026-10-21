import { describe, it, expect, vi, afterEach } from 'vitest';
import { createGame, resolveTurn, planTurn, viewFor, filterResultFor, coverage, findPath, emptySubmission } from '../shared/index.ts';
import type { GameState, Submission, TurnResult } from '../shared/index.ts';

const ai3 = (seed: number, rules?: unknown) => createGame({ seed, rules, players: [0, 1, 2].map(() => ({ kind: 'ai' as const, aiLevel: 'expert' as const })) });
function play(s: GameState, turns: number) {
  for (let t = 0; t < turns && s.winner === null; t++) {
    const subs: Record<number, Submission> = {};
    for (const p of s.players) subs[p.id] = planTurn(s, p.id);
    s = resolveTurn(s, subs);
  }
  return s;
}
/** A region player 0 covers but doesn't own, with no p0 fleet in it, that isn't the Throne. */
function watchedRegion(s: GameState, exclude: number[] = []) {
  const cov = coverage(s, 0);
  return s.regions.find(r => cov.has(r.id) && r.owner !== 0 && r.kind !== 'throne' && !exclude.includes(r.id) &&
    !s.fleets.some(f => f.owner === 0 && f.region === r.id))!;
}
function farRegion(s: GameState) {
  const cov = coverage(s, 0);
  return s.regions.find(r => !cov.has(r.id) && r.kind !== 'throne' && r.owner === null)!;
}
const rivalFleet = (s: GameState) => s.fleets.find(f => f.owner === 1)!;
function emptyResult(s: GameState, turn: number): TurnResult {
  return { turn, events: [], battles: [], signals: [], startFleets: structuredClone(s.fleets), startOwners: s.regions.map(r => r.owner) };
}

afterEach(() => vi.restoreAllMocks());

describe('fog of war: viewFor', () => {
  it("hides rivals' scans, doctrine, stockpiles, reserve commanders and the RNG", () => {
    const s = ai3(11);
    const rf = rivalFleet(s);
    const w = watchedRegion(s);
    rf.region = w.id;
    rf.doctrine = { stance: 'aggressive', retreatAt: 0.9, target: 'garrison', guard: true };
    s.scans.push({ owner: 1, region: s.players[2].capital, until: s.turn + 1 }, { owner: 0, region: w.id, until: s.turn + 1 });
    s.players[1].reserveCommanders = [structuredClone(rf.commander)];
    s.players[1].pactOffers = [2];
    const v = viewFor(s, 0).state;
    expect(v.scans.every(sc => sc.owner === 0)).toBe(true);
    expect(v.scans.length).toBe(1);
    const seen = v.fleets.find(f => f.id === rf.id)!;
    expect(seen).toBeTruthy();                       // visible fleet...
    expect(seen.doctrine.guard).toBe(false);         // ...but its standing orders are not
    expect(seen.doctrine.retreatAt).not.toBe(0.9);
    expect(v.players[1].res.credits).toBe(-1);
    expect(v.players[1].reserveCommanders).toEqual([]);
    expect(v.players[1].pactOffers).toEqual([]);
    expect(v.rngState).toBe(0);
    expect(v.edictDeck).toEqual([]);
    expect(v.log).toEqual([]);
    // own doctrine untouched
    const mine = s.fleets.find(f => f.owner === 0)!;
    mine.doctrine.guard = true;
    expect(viewFor(s, 0).state.fleets.find(f => f.id === mine.id)!.doctrine.guard).toBe(true);
  });

  it("zeroes rivals' battle stats and anonymises their battle-honor VP lines", () => {
    const s = ai3(12);
    s.turnStats = { kills: [1, 5, 2], battlesWon: [0, 2, 1], crownBattlesWon: [0, 1, 0], captures: [0, 1, 0] };
    s.players[1].vpLog.push({ turn: 1, amount: 1, why: 'Battle honors: The Battle of Somewhere Secret' });
    const v = viewFor(s, 0).state;
    expect(v.turnStats.kills).toEqual([1, 0, 0]);
    expect(v.turnStats.battlesWon).toEqual([0, 0, 0]);
    expect(v.players[1].vpLog.at(-1)!.why).toBe('Battle honors');
    expect(v.players[1].vp).toBe(s.players[1].vp);
  });

  it('keeps unseen rival battles out of the chronicle, but not seen or public lines', () => {
    const s = ai3(13);
    const far = farRegion(s), near = watchedRegion(s);
    s.chronicle.push(
      { turn: 1, region: far.id, players: [1, 2], text: 'The Battle of Hidden: 3 ships destroyed. B held the field.' },
      { turn: 1, region: near.id, players: [1, 2], text: 'The Battle of Seen: 3 ships destroyed. B held the field.' },
      { turn: 1, region: far.id, players: [1], text: `${s.players[1].name} claims ${far.name}.` },
    );
    const texts = viewFor(s, 0).state.chronicle.map(c => c.text);
    expect(texts.some(t => t.includes('Hidden'))).toBe(false);
    expect(texts.some(t => t.includes('Seen'))).toBe(true);
    expect(texts.some(t => t.includes('claims'))).toBe(true);
    expect(viewFor(s, 1).state.chronicle.some(c => c.text.includes('Hidden'))).toBe(true); // a party sees it
  });
});

describe('fog of war: turn results', () => {
  it('does not reveal rival fleets that sat in a nebula in startFleets or nebula-to-nebula moves', () => {
    const s = ai3(21);
    const n1 = watchedRegion(s);
    const n2 = watchedRegion(s, [n1.id]);
    n1.feature = 'nebula'; n2.feature = 'nebula';
    const rf = rivalFleet(s);
    rf.region = n1.id;
    const r = emptyResult(s, s.turn);
    r.events.push({ k: 'move', pulse: 1, step: 1, fleet: rf.id, owner: 1, from: n1.id, to: n2.id, ships: rf.ships.length });
    rf.region = n2.id;
    s.last = r;
    const v = viewFor(s, 0).state;
    expect(v.last!.startFleets.some(f => f.id === rf.id)).toBe(false);
    expect(v.last!.events.some(e => e.k === 'move' && e.fleet === rf.id)).toBe(false);
    expect(v.fleets.some(f => f.id === rf.id)).toBe(false);
    // without the nebula the same fleet is visible, with doctrine masked
    n1.feature = 'none'; n2.feature = 'none';
    rf.doctrine.guard = true;
    s.last.startFleets.find(f => f.id === rf.id)!.doctrine.guard = true;
    const v2 = viewFor(s, 0).state;
    const sf = v2.last!.startFleets.find(f => f.id === rf.id)!;
    expect(sf).toBeTruthy();
    expect(sf.doctrine.guard).toBe(false);
    expect(v2.last!.events.some(e => e.k === 'move' && e.fleet === rf.id)).toBe(true);
  });

  it('old turns from history are not filtered with *current* coverage', () => {
    const s = ai3(22);
    const far = farRegion(s);
    const old: TurnResult = { ...emptyResult(s, 1), battles: [{ id: 99, name: 'Old Battle', turn: 1, pulse: 1, region: far.id, sides: [], rounds: [], winner: 1, losses: {}, highlights: [] }] };
    old.events.push({ k: 'battle', pulse: 1, region: far.id, battle: 99, name: 'Old Battle', parties: [1, 2] });
    // player 0 now has a fleet next to `far` (current coverage), but didn't on turn 1
    const mine = s.fleets.find(f => f.owner === 0)!;
    mine.region = far.id;
    s.turn = 5;
    s.last = { ...emptyResult(s, 4) };
    expect(filterResultFor(s, old, 0).battles.length).toBe(0);
    expect(filterResultFor(s, old, 0).events.some(e => e.k === 'battle')).toBe(false);
    // the most recent turn still uses end-of-turn coverage
    s.last = { ...old, turn: 4 };
    expect(filterResultFor(s, s.last, 0).battles.length).toBe(1);
  });

  it('a real game: no view ever contains rival fleets outside sensors, or rivals signals/fails', () => {
    let s = ai3(23);
    for (let t = 0; t < 14 && s.winner === null; t++) {
      s = play(s, 1);
      for (const p of [0, 1, 2]) {
        const v = viewFor(s, p).state;
        const cov = coverage(s, p);
        for (const f of v.fleets) if (f.owner !== p) {
          const reg = s.regions[f.region];
          expect(cov.has(f.region) || (reg.kind === 'throne' && s.rules.throne.holderVisible)).toBe(true);
        }
        for (const sg of v.last!.signals) expect(sg.observer).toBe(p);
        for (const e of v.last!.events) if (e.k === 'fail' || e.k === 'scan') expect(e.owner).toBe(p);
        expect(v.scans.every(sc => sc.owner === p)).toBe(true);
        expect(v.log.length).toBe(0);
      }
    }
  });
});

describe('setup: combat RNG is not derivable from the public seed', () => {
  it('rngSeed decouples rngState / edict deck from the map seed', () => {
    const a = createGame({ seed: 5, rngSeed: 1, players: [] });
    const b = createGame({ seed: 5, rngSeed: 2, players: [] });
    expect(JSON.stringify(a.regions)).toBe(JSON.stringify(b.regions));
    expect(a.rngState).not.toBe(b.rngState);
    expect(a.edictDeck.join()).not.toBe(b.edictDeck.join());
  });
  it('without an explicit seed, rngState is independent of the (public) seed', () => {
    const a = createGame({ players: [] });
    expect(a.rngState).not.toBe(createGame({ seed: a.seed, players: [] }).rngState);
  });
  it('an explicit seed alone stays reproducible', () => {
    expect(JSON.stringify(createGame({ seed: 9, players: [] }))).toBe(JSON.stringify(createGame({ seed: 9, players: [] })));
  });
  it('tolerates odd setup inputs', () => {
    for (const setup of [{ players: [] }, { players: [{ kind: 'human' as const }] }, { players: undefined as any }, { seed: NaN, players: [], homeRotation: NaN },
      { seed: -7, players: [{ kind: 'bogus' as any, aiLevel: 'godlike' as any }] }]) {
      const s = createGame(setup);
      expect(s.players.length).toBe(3);
      expect(new Set(s.players.map(p => p.capital)).size).toBe(3);
      for (const p of s.players) { expect(['human', 'ai']).toContain(p.kind); expect(['novice', 'standard', 'expert']).toContain(p.aiLevel); }
    }
  });
});

describe('mapgen robustness', () => {
  it('seeds that used to exhaust 50 attempts now generate (default rules)', () => {
    expect(() => createGame({ seed: 490, players: [] })).not.toThrow();
  });
  it('small / sparse maps generate, symmetric and connected', () => {
    for (const map of [{ regionsPerWedge: 3 }, { regionsPerWedge: 4 }, { regionsPerWedge: 5, minSiteDist: 300 }, { regionsPerWedge: 12, minSiteDist: 300, borderWobble: 0 }]) {
      for (let seed = 1; seed <= 4; seed++) {
        const s = createGame({ seed: seed * 101, rules: { map }, players: [] });
        expect((s.regions.filter(r => r.kind !== 'lane').length - 1) % 3).toBe(0);
        expect(s.regions.filter(r => r.kind === 'lane').length % 3).toBe(0);
        const throne = s.regions.find(r => r.kind === 'throne')!.id;
        const d = s.players.map(p => findPath(s, p.capital, throne)?.length);
        expect(new Set(d).size).toBe(1);
        expect(d[0]).toBeGreaterThan(0);
        for (const r of s.regions) {
          if (r.kind === 'lane') continue;   // hyperlane waypoints have no territory
          expect(r.poly.length).toBeGreaterThanOrEqual(3);
          for (const n of r.neighbors) expect(s.regions[n].neighbors).toContain(r.id);
        }
      }
    }
  });
  it('existing default maps are unchanged by the longer retry loop', () => {
    // first-attempt maps keep their exact geometry (saved-game/sim reproducibility)
    const s = createGame({ seed: 42, players: [] });
    expect(s.regions.filter(r => r.kind !== 'lane').length).toBe(1 + 3 * 8);
  });
});

describe('AI robustness', () => {
  it('never throws on odd states and returns well-formed submissions', () => {
    const s0 = ai3(31);
    const check = (st: GameState, pid: number) => {
      const sub = planTurn(st, pid);
      expect(sub.orders.length).toBe(st.rules.orders.perTurn);
      for (const o of sub.orders) if (o?.type === 'move') expect(o.path.length).toBeGreaterThan(0);
    };
    check(s0, 7 as any);                                                          // no such player
    const noFleets = structuredClone(s0); noFleets.fleets = noFleets.fleets.filter(f => f.owner !== 0); check(noFleets, 0);
    const nothing = structuredClone(noFleets); for (const r of nothing.regions) if (r.owner === 0) r.owner = null; check(nothing, 0);
    const elim = structuredClone(s0); elim.players[1].eliminated = true; check(elim, 0); check(elim, 1);
    for (const p of [0, 1, 2]) check(viewFor(s0, p).state, p);                    // fogged inputs (garrison -1, masked rivals)
    const old: any = structuredClone(s0); delete old.crownHold; delete old.capitalsTaken; delete old.rules.wardenHunt;
    for (const pl of old.players) delete pl.pactOffers; for (const r of old.regions) delete r.baseGarrison; check(old, 0);
  });

  it('is deterministic and uses no ambient randomness or clock', () => {
    const s = play(ai3(32), 4);
    const a = JSON.stringify(planTurn(s, 0));
    vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Math.random in AI'); });
    vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('Date.now in AI'); });
    expect(JSON.stringify(planTurn(s, 0))).toBe(a);
  });

  it('plans fast (< 50 ms per call, averaged)', () => {
    let s = ai3(33);
    let ms = 0, n = 0;
    for (let t = 0; t < 10 && s.winner === null; t++) {
      const subs: Record<number, Submission> = {};
      for (const p of s.players) { const t0 = performance.now(); subs[p.id] = planTurn(s, p.id); ms += performance.now() - t0; n++; }
      s = resolveTurn(s, subs);
    }
    expect(ms / n).toBeLessThan(50);
  });

  it('planning on a fogged view does not mutate it (garrison -1 is estimated on a private copy)', () => {
    const v = viewFor(ai3(34), 0).state;
    const before = JSON.stringify(v);
    planTurn(v, 0);
    expect(JSON.stringify(v)).toBe(before);
    expect(v.regions.some(r => r.garrison === -1)).toBe(true);
  });
});

