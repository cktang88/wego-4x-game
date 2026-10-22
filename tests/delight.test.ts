// The reward moments' logic (client/src/fx): the replay director, the decisive volley, the VP coins, the near-miss
// line and the end-of-game awards. Every check here is a truth check: nothing shown may misstate the game.
import { describe, expect, it } from 'vitest';
import { createGame } from '../shared/sim/setup.ts';
import { resolveTurn } from '../shared/sim/resolve.ts';
import { planTurn } from '../shared/sim/ai.ts';
import { filterResultFor } from '../shared/index.ts';
import type { GameState, TurnResult } from '../shared/sim/types.ts';
import { direct, shown, flopArrows } from '../client/src/fx/director.ts';
import { decisiveVolley, battleStakes, battlePower } from '../client/src/fx/battlefacts.ts';
import { vpChanges, turnEntries, coinsFor } from '../client/src/fx/vp.ts';
import { nearMissLine, nearMisses } from '../client/src/fx/nearmiss.ts';
import { dealAwards, earnedAwards, gameStats, historyComplete } from '../client/src/fx/awards.ts';

/** An all-AI game, kept with every turn's result (and the state right after it). */
function play(seed: number, turns: number) {
  let s: GameState = createGame({ seed, players: [0, 1, 2].map(() => ({ kind: 'ai' as const, aiLevel: 'standard' as const })) });
  const log: { st: GameState; res: TurnResult }[] = [];
  for (let t = 0; t < turns && s.winner === null; t++) {
    const subs = Object.fromEntries(s.players.map(p => [p.id, planTurn(s, p.id)]));
    s = resolveTurn(s, subs);
    if (s.last) log.push({ st: s, res: s.last });
  }
  return { s, log };
}

const G1 = play(7, 40);
const G2 = play(1234, 40);
const games = [G1, G2];

describe('replay director', () => {
  it('shows every shown event exactly once, in five acts, movement in step order', () => {
    for (const { log } of games) for (const { st, res } of log) for (const you of [null, 0, 1]) {
      const r = you === null ? res : filterResultFor(st, res, you);
      const beats = direct(r, st, { you, seals: true });
      const want = r.events.filter(e => shown(e, you));
      const got = beats.flatMap(b => b.events);
      expect(got.length).toBe(want.length);
      for (const e of want) expect(got.filter(x => x === e).length).toBe(1);
      // acts never go backwards
      const acts = beats.map(b => b.act ?? 0);
      for (let i = 1; i < acts.length; i++) expect(acts[i]).toBeGreaterThanOrEqual(acts[i - 1]);
      // movement keeps the sim's step order
      const steps = beats.filter(b => b.act === 3).flatMap(b => b.events).filter(e => e.k === 'move').map(e => (e.k === 'move' ? e.pulse * 100 + e.step : 0));
      for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThanOrEqual(steps[i - 1]);
    }
  });
  it('plays battles in ascending stakes, each followed by what it caused', () => {
    let multi = 0;
    for (const { log } of games) for (const { st, res } of log) {
      const beats = direct(res, st, { you: 0, seals: true });
      const order = beats.filter(b => b.events[0]?.k === 'battle').map(b => b.battle!);
      const stakes = order.map(id => battleStakes(res.battles.find(x => x.id === id)!, st, 0));
      for (let i = 1; i < stakes.length; i++) expect(stakes[i]).toBeGreaterThanOrEqual(stakes[i - 1]);
      if (order.length >= 2) { multi++; expect(beats.some(b => b.kind === 'title' && b.battle === order[order.length - 1])).toBe(true); }
      // a battle's consequences come after its battle beat
      for (const id of order) {
        const at = beats.findIndex(b => b.events[0]?.k === 'battle' && b.battle === id);
        const bi = res.events.findIndex(e => e.k === 'battle' && e.battle === id);
        beats.forEach((b, i) => { if (b.battle === id && b.events.some(e => res.events.indexOf(e) > bi)) expect(i).toBeGreaterThanOrEqual(at); });
      }
    }
    expect(multi).toBeGreaterThan(0);
  });
  it('LIVE and Preview are lighter: no seals, no flop, no title card', () => {
    const { st, res } = G1.log[Math.min(8, G1.log.length - 1)];
    for (const o of [{ live: true }, { preview: true }]) {
      const beats = direct(res, st, { you: 0, seals: true, ...o });
      expect(beats.some(b => b.kind === 'seals' || b.kind === 'flop' || (o.live && (b.kind === 'title' || b.kind === 'hold')))).toBe(false);
    }
  });
  it('the flop draws only moves that happened', () => {
    for (const { res } of G1.log) for (const a of flopArrows(res)) expect(res.events.some(e => e.k === 'move' && e.fleet === a.fleet && e.from === a.from && e.to === a.to)).toBe(true);
  });
  it('fits a busy turn into about 45 s', () => {
    for (const { log } of games) for (const { st, res } of log) {
      const beats = direct(res, st, { you: 0, seals: true });
      const big = beats.filter(b => (b.weight ?? 1) > 1 || b.kind).reduce((a, b) => a + b.dur, 0);
      expect(beats.reduce((a, b) => a + b.dur, 0)).toBeLessThanOrEqual(Math.max(45500, big + 20000));
    }
  });
});

describe('decisive volley', () => {
  it('only for battles that ended with a winner, on a real hit against the losing side', () => {
    let n = 0, none = 0;
    for (const { log } of games) for (const { res } of log) for (const b of res.battles) {
      const d = decisiveVolley(b);
      if (!d) { none++; continue; }
      n++;
      expect(b.ongoing).toBeFalsy();
      expect(b.winner).not.toBeNull();
      expect(d.round).toBe(b.rounds.length - 1);
      const shot = b.rounds[d.round].shots[d.shot];
      expect(shot.dmg).toBeGreaterThan(0);
      const victim = b.sides.find(s => s.ships.some(x => x.id === shot.to) || s.garrison?.id === shot.to);
      expect(victim && victim.owner !== b.winner).toBe(true);
      if (d.kind === 'last-ship' && !victim!.garrison) expect(shot.kill).toBe(true);
    }
    expect(n).toBeGreaterThan(0);
    expect(none).toBeGreaterThan(0);
  });
  it('power numbers are the sides as reported', () => {
    for (const { res } of G1.log) for (const b of res.battles) {
      const p = battlePower(b);
      expect(p.reduce((a, x) => a + x.ships, 0)).toBe(b.sides.reduce((a, s) => a + s.ships.length, 0));
      expect(p.reduce((a, x) => a + x.garrison, 0)).toBe(b.sides.reduce((a, s) => a + Math.max(0, s.garrison?.hp ?? 0), 0));
    }
  });
});

describe('VP count-up', () => {
  it('coins add up to exactly the change, and the change is the log', () => {
    let any = 0;
    for (const { log } of games) for (const { st, res } of log) {
      const ch = vpChanges(st, turnEntries(st, res.turn), res);
      for (const c of ch) {
        any++;
        const p = st.players[c.player];
        const logged = p.vpLog.filter(v => v.turn === res.turn).reduce((a, v) => a + v.amount, 0);
        expect(c.after).toBe(p.vp);
        expect(c.after - c.before).toBe(logged);
        expect(c.sources.reduce((a, s) => a + s.amount, 0)).toBe(logged);
        const coins = c.sources.flatMap(s => coinsFor(s.amount));
        expect(coins.reduce((a, x) => a + x, 0)).toBe(logged);
        for (const s of c.sources) expect(s.region === null || !!st.regions[s.region]).toBe(true);
      }
    }
    expect(any).toBeGreaterThan(0);
  });
  it('splits into at most six whole coins of one sign', () => {
    for (const n of [1, 2, 5, 6, 7, 13, -1, -4, 0]) {
      const c = coinsFor(n);
      expect(c.reduce((a, x) => a + x, 0)).toBe(n);
      expect(c.length).toBeLessThanOrEqual(6);
      for (const x of c) expect(Math.sign(x)).toBe(Math.sign(n));
    }
  });
});

describe('near-miss line', () => {
  it('always says something true and plain', () => {
    for (const { log } of games) for (const { st, res } of log) {
      const line = nearMissLine(st, res, 0);
      expect(line.length).toBeGreaterThan(5);
      expect(line).not.toMatch(/undefined|NaN|\?/);
      for (const m of nearMisses(st, res, 0)) {
        if (m.kind === 'race') { const top = st.players.filter(p => !p.eliminated).sort((a, b) => b.vp - a.vp)[0]; expect(st.rules.victory.vpTarget - top.vp).toBeLessThanOrEqual(3); }
        if (m.kind === 'last-ship') expect(res.battles.some(b => b.region === m.region && b.winner !== null)).toBe(true);
      }
    }
  });
});

describe('awards', () => {
  it('everyone gets a card, every card is true', () => {
    for (const { s, log } of games) {
      const results = log.map(x => x.res);
      expect(historyComplete(s, results)).toBe(true);
      const dealt = dealAwards(s, results);
      for (const p of s.players) expect(dealt.some(a => a.player === p.id)).toBe(true);
      expect(dealt.length).toBeGreaterThanOrEqual(3);
      expect(dealt.length).toBeLessThanOrEqual(6);
      for (const p of s.players) expect(dealt.filter(a => a.player === p.id).length).toBeLessThanOrEqual(2);
      const S = gameStats(s, results);
      for (const a of dealt) {
        const x = S.get(a.player)!;
        if (a.id === 'butcher') for (const p of s.players) if (p.id !== a.player) expect(S.get(p.id)!.sunk).toBeLessThan(x.sunk);
        if (a.id === 'unbroken') { expect(x.battlesLost).toBe(0); expect(x.battles).toBeGreaterThanOrEqual(2); }
        if (a.id === 'survivor') expect(x.homeLost).toBe(0);
        if (a.id === 'called') for (const p of s.players) if (p.id !== a.player) expect(S.get(p.id)!.called).toBeLessThan(x.called);
        expect(a.text).not.toMatch(/undefined|NaN/);
      }
      // the earned list never claims a "most" with a tie
      for (const a of earnedAwards(s, results)) if (a.id === 'butcher') expect(new Set(s.players.map(p => S.get(p.id)!.sunk)).size).toBeGreaterThan(1);
    }
  });
  it('no all-game award from an incomplete history', () => {
    const { s, log } = G1;
    const part = log.slice(3).map(x => x.res);
    expect(historyComplete(s, part)).toBe(false);
    expect(earnedAwards(s, part).some(a => ['unbroken', 'survivor', 'butcher', 'conqueror', 'kingmaker'].includes(a.id))).toBe(false);
    for (const p of s.players) expect(dealAwards(s, part).some(a => a.player === p.id)).toBe(true);
  });
});
