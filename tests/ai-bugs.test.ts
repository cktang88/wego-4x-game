// Regression tests for AI bugs: input mutation, fog leaks, orders that always fail at resolve
// time (wasted slots), projection errors across slots, battle-predictor gaps, LIVE single orders.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createGame, resolveTurn, planTurn, viewFor, validateOrder, predictAssault, makeLive, runTick, emptySubmission } from '../shared/index.ts';
import type { GameState, Submission, Order } from '../shared/index.ts';

type Lvl = 'novice' | 'standard' | 'expert';
const game = (seed: number, levels: Lvl[] = ['expert', 'standard', 'novice'], rules?: unknown) =>
  createGame({ seed, rules, players: levels.map(l => ({ kind: 'ai' as const, aiLevel: l })) });
function play(s: GameState, turns: number, onTurn?: (prev: GameState, subs: Record<number, Submission>, next: GameState) => void) {
  for (let t = 0; t < turns && s.winner === null; t++) {
    const subs: Record<number, Submission> = {};
    for (const p of s.players) subs[p.id] = planTurn(s, p.id);
    const next = resolveTurn(s, subs);
    onTurn?.(s, subs, next);
    s = next;
  }
  return s;
}
const failsOf = (s: GameState) => s.last!.events.filter((e): e is Extract<typeof e, { k: 'fail' }> => e.k === 'fail' && e.owner >= 0);

afterEach(() => vi.restoreAllMocks());

describe('AI: planning never touches the caller\'s state', () => {
  it('planTurn leaves full and fogged inputs byte-identical (merges, research, builds, projections)', () => {
    let s = game(501, ['expert', 'expert', 'standard']);
    for (let t = 0; t < 12 && s.winner === null; t++) {
      const subs: Record<number, Submission> = {};
      for (const p of s.players) {
        const before = JSON.stringify(s);
        subs[p.id] = planTurn(s, p.id);
        expect(JSON.stringify(s)).toBe(before);
        const v = viewFor(s, p.id).state;
        const vb = JSON.stringify(v);
        planTurn(v, p.id);
        expect(JSON.stringify(v)).toBe(vb);
      }
      s = resolveTurn(s, subs);
    }
  });
});

describe('AI: fog of war', () => {
  it('plans exactly the same from the full state as from its own fogged view', () => {
    // perceive() used to keep rival doctrines (guard), exact rival garrisons outside sensor range,
    // rival projects and rival loyalty that viewFor() hides: ~10% of plans differed
    let s = game(300);
    for (let t = 0; t < 14 && s.winner === null; t++) {
      const subs: Record<number, Submission> = {};
      for (const p of s.players) {
        subs[p.id] = planTurn(s, p.id);
        expect(JSON.stringify(planTurn(viewFor(s, p.id).state, p.id))).toBe(JSON.stringify(subs[p.id]));
      }
      s = resolveTurn(s, subs);
    }
  });

  it('ignores secrets: rival stockpiles, doctrines and garrisons out of sight', () => {
    const s = play(game(302, ['expert', 'expert', 'expert']), 6);
    const a = JSON.stringify(planTurn(s, 0));
    const t = structuredClone(s);
    for (const p of t.players) if (p.id !== 0) p.res = { industry: 999, credits: 999, influence: 999 };
    for (const f of t.fleets) if (f.owner > 0) f.doctrine = { stance: 'evasive', retreatAt: 0.9, target: 'strongest', guard: true };
    const cov = viewFor(s, 0).visible;
    for (const r of t.regions) if (r.owner !== null && r.owner !== 0 && !cov.includes(r.id)) { r.garrison = 1; r.project = { key: 'mine', progress: 0, owner: r.owner }; }
    expect(JSON.stringify(planTurn(t, 0))).toBe(a);
  });
});

describe('AI: no wasted orders', () => {
  /** Fail reasons that only an AI planning bug can produce (not rivals, battles or bad luck). */
  // (a vein can be cut off by an enemy arriving in the same step as a build: not foreseeable, so "needs ⚛/◆" is allowed)
  const AI_BUG = /not enough|too many fleets|only just formed|exhausted|at most \d+ orders|already up to date|no free law slot|already enacted|needs (?![⚛◆])|no relic here|unknown|already researched|one technology per|at most \d+ fleets can join/;
  it('never proposes orders that fail for reasons it could see coming (3 games, all levels)', () => {
    const bad: string[] = [];
    let issued = 0, failed = 0;
    for (const seed of [2000, 2001, 2002]) {
      play(game(seed), 40, (prev, subs, next) => {
        for (const p of prev.players) issued += subs[p.id].orders.filter(Boolean).length;
        for (const e of failsOf(next)) { failed++; if (AI_BUG.test(e.text)) bad.push(`T${prev.turn} p${e.owner} ${prev.players[e.owner].aiLevel}: ${e.text}`); }
      });
    }
    expect(bad).toEqual([]);
    // the rest (fleets destroyed, displaced or blocked mid-turn, enemies arriving) stays rare
    expect(failed / issued).toBeLessThan(0.06);
  });

  it('can research on consecutive turns (the per-turn counter from last turn does not block it)', () => {
    let s = game(510, ['expert', 'expert', 'expert']);
    s.players[0].res = { industry: 2000, credits: 2000, influence: 50 };
    s = play(s, 1);
    expect(s.players[0].techs!.length).toBe(1);
    s.players[0].researched = 1;   // an engine that only resets this when the next turn resolves
    const sub = planTurn(s, 0);
    expect(sub.free.some(f => f.type === 'research')).toBe(true);
  });

  it('charges the repeat-fleet fee in its projection (orders after it stay affordable)', () => {
    let s = play(game(512, ['expert', 'expert', 'expert']), 3);
    for (const credits of [0, 2, 4, 5, 9]) {
      const t = structuredClone(s);
      t.players[0].res.credits = credits;
      const sub = planTurn(t, 0);
      const next = resolveTurn(t, { 0: sub, 1: emptySubmission(t), 2: emptySubmission(t) });
      expect(failsOf(next).filter(e => e.owner === 0 && /not enough/.test(e.text))).toEqual([]);
    }
  });

  it('a new fleet from a build counts toward the fleet limit; built hulls carry the blueprint module', () => {
    let s = play(game(514, ['expert', 'standard', 'novice']), 4);
    const t = structuredClone(s);
    t.players[1].res = { industry: 999, credits: 999, influence: 0 };
    // leave room for exactly one more fleet
    const mine = t.fleets.filter(f => f.owner === 1);
    t.rules.maxFleets = mine.length + 1;
    for (const f of mine) f.ships = f.ships.slice(0, 1);
    for (const f of mine) f.ships.forEach(sh => { sh.mod = 'armor'; });
    const sub = planTurn(t, 1);
    const next = resolveTurn(t, { 0: emptySubmission(t), 1: sub, 2: emptySubmission(t) });
    expect(failsOf(next).filter(e => e.owner === 1 && /too many fleets|already up to date/.test(e.text))).toEqual([]);
  });
});

describe('AI: battle predictor matches combat.ts', () => {
  it('counts Alpha Strike and Vanguard', () => {
    const s = game(520, ['expert', 'expert', 'expert']);
    const f = s.fleets.find(x => x.owner === 0)!;
    const target = s.regions[f.region].neighbors.find(n => s.regions[n].owner === null && s.regions[n].garrison > 0)!;
    s.regions[target].garrison = 40;   // a close siege for the starting fleet
    const base = predictAssault(s, 0, [f.id], target).p;
    const a = structuredClone(s); a.players[0].techs = ['railguns', 'cruisers', 'alpha'];
    const v = structuredClone(s); v.players[0].laws = ['vanguard'];
    expect(predictAssault(a, 0, [f.id], target).p).toBeGreaterThan(base);
    expect(predictAssault(v, 0, [f.id], target).p).toBeGreaterThan(base);
  });

  it('plans combined assaults with at most the 3 joiners the resolver accepts', () => {
    play(game(522, ['expert', 'expert', 'expert']), 25, (prev, subs) => {
      for (const p of prev.players) for (const o of subs[p.id].orders) {
        if (o?.type !== 'seize' || !o.also) continue;
        expect(o.also.length).toBeLessThanOrEqual(3);
        for (const id of o.also) expect(prev.fleets.find(f => f.id === id)!.bornTurn === prev.turn && prev.turn > 1).toBe(false);
      }
    });
  });
});

describe('AI: LIVE mode', () => {
  it('each planned order is valid on its own against the current state (runTick takes one)', () => {
    let s = makeLive(game(530), 0, 360);
    let checked = 0;
    for (let t = 0; t < 120 && s.winner === null; t++) {
      const fresh = s.live!.tick % s.rules.live.ticksPerCycle === 0;
      for (const p of s.players) {
        if (p.eliminated) continue;
        const sub = planTurn(s, p.id);
        for (const o of sub.orders.filter((x): x is Order => !!x)) {
          const proj = structuredClone(s);
          if (fresh) for (const f of proj.fleets) f.ordersThisTurn = 0;
          // the plan's free actions (e.g. researching Bureaucracy for a law slot) land before its orders
          for (const fa of sub.free) if (fa.type === 'research') (proj.players[p.id].techs ??= []).push(fa.tech);
          if ('fleet' in o && o.type !== 'build') {
            const f = proj.fleets.find(x => x.id === o.fleet)!;
            expect(f.route ?? null).toBe(null);      // travelling fleets are left alone
            f.ordersThisTurn++;
          }
          expect(validateOrder(proj, p.id, o)).toBe(null);
          checked++;
        }
      }
      s = runTick(s, () => true);
    }
    expect(checked).toBeGreaterThan(100);
  });
});

describe('AI: edge cases', () => {
  it('handles a lost capital, no fleets, elimination and old saves without Empire fields', () => {
    const s0 = play(game(540), 5);
    const check = (st: GameState, pid: number) => {
      const sub = planTurn(st, pid);
      expect(sub.orders.length).toBe(st.rules.orders.perTurn);
      for (const o of sub.orders) if (o) expect(validateOrder(st, pid, o) === null || o.type !== 'law').toBe(true);
    };
    const lost = structuredClone(s0); lost.regions[lost.players[0].capital].owner = 1; check(lost, 0);
    const none = structuredClone(s0); none.fleets = none.fleets.filter(f => f.owner !== 0); check(none, 0);
    const elim = structuredClone(s0); elim.players[2].eliminated = true; check(elim, 0);
    const old: any = structuredClone(s0);
    for (const p of old.players) { delete p.techs; delete p.laws; delete p.blueprint; delete p.researched; }
    for (const f of old.fleets) for (const sh of f.ships) delete sh.mod;
    delete old.engagements;
    for (const p of [0, 1, 2]) check(old, p);
    expect(JSON.stringify(old.players[0].techs)).toBe(undefined); // still untouched
  });

  it('is deterministic without Math.random and keeps the __tcNoResearch hook', () => {
    const s = play(game(542, ['expert', 'standard', 'novice']), 4);
    const a = JSON.stringify([0, 1, 2].map(p => planTurn(s, p)));
    vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Math.random in AI'); });
    expect(JSON.stringify([0, 1, 2].map(p => planTurn(s, p)))).toBe(a);
    const g = globalThis as any;
    const t = structuredClone(s);
    t.players[0].res = { industry: 2000, credits: 2000, influence: 50 };
    try {
      g.__tcNoResearch = [0];
      expect(planTurn(t, 0).free.some(f => f.type === 'research')).toBe(false);
    } finally { delete g.__tcNoResearch; }
    expect(planTurn(t, 0).free.some(f => f.type === 'research')).toBe(true);
  });
});
