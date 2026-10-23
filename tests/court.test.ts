// The Court (docs/SOUL.md phase C; shared/sim/court.ts): Ransom of captured commanders, the Coronation (Kneel or
// Defy) and Exile. Each mechanic, its AI, its fog, determinism, and old saves (no `court` rule group = off).
import { describe, expect, it } from 'vitest';
import { createGame, newFleet, newShip } from '../shared/sim/setup.ts';
import { resolveTurn, emptySubmission, checkVictory, cleanFree } from '../shared/sim/resolve.ts';
import { planTurn } from '../shared/sim/ai.ts';
import { viewFor, filterResultFor } from '../shared/sim/view.ts';
import { makeLive, runTick, queueFree } from '../shared/sim/live.ts';
import { Rng } from '../shared/sim/rng.ts';
import { debtHit, ensureSoul, onBeaten, catchLimping, SR } from '../shared/sim/soul.ts';
import { sagaOf, makeEdition } from '../shared/sim/herald.ts';
import { summarizeGame, leagueTable } from '../shared/league.ts';
import { defaultRules, upgradeRules, OPT_IN_LAYERS } from '../shared/config/rules.ts';
import {
  courtOn, ensureCourt, captureCommander, ransomPrice, turnPrice, captiveBlock, ransomBlock, decreeBlock, exileBlock,
  wardenTarget, ghostVotes, courtTally, courtFinal, strikesHolder, CR,
} from '../shared/sim/court.ts';
import { courtFree, captorChoice, kneelOrDefy, exileChoice, kneelPenalty } from '../shared/sim/ai-court.ts';
import type { Fleet, FreeAction, GameState, Order, Submission } from '../shared/sim/types.ts';
import { Store } from '../server/store.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const game = (seed = 11, rules?: unknown) => createGame({ seed, rules, players: [0, 1, 2].map(() => ({ kind: 'human' as const })) });
const idle = (s: GameState): Record<number, Submission> => Object.fromEntries(s.players.map(p => [p.id, emptySubmission(s)]));
const act = (s: GameState, by: Record<number, { orders?: Order[]; free?: FreeAction[] }>) => {
  const out = idle(s);
  for (const [p, x] of Object.entries(by)) { (x.orders ?? []).forEach((o, i) => { out[Number(p)].orders[i] = o; }); out[Number(p)].free = x.free ?? []; }
  return resolveTurn(s, out);
};
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
const bfs = (s: GameState, from: number) => {
  const d = new Map([[from, 0]]); const q = [from];
  while (q.length) { const r = q.shift()!; for (const n of s.regions[r].links ?? s.regions[r].neighbors) if (!d.has(n)) { d.set(n, d.get(r)! + 1); q.push(n); } }
  return d;
};
const farColony = (s: GameState, k = 2) => {
  const ds = s.players.map(p => bfs(s, p.capital));
  return s.regions.find(r => r.owner === null && r.kind === 'colony' && ds.every(d => (d.get(r.id) ?? 99) >= k))!;
};
const rich = (s: GameState) => { for (const p of s.players) p.res = { industry: 300, credits: 300, influence: 60 }; };

/** Player 1 catches player 0's limping fleet at a far colony: its commander is taken captive at the end of the turn. */
function captiveSetup(seed = 23, rank = 3) {
  const s = game(seed); clearMap(s); rich(s);
  const x = farColony(s, 2);
  const f = fleetAt(s, 0, x.id, ['frigate', 'frigate']);
  f.limping = { since: 1, to: s.players[0].capital, by: 1 };
  f.scars = [{ id: 'burned', turn: 1 }];
  f.commander.rank = rank;
  const h = fleetAt(s, 1, x.id, ['corvette']);
  const t = resolveTurn(s, idle(s));
  return { t, x, f, h, cmd: f.commander.name };
}

// ============================================================================ the rules group
describe('court: rules and old saves', () => {
  it('is an opt-in layer, on for new games and off for a save that predates it', () => {
    expect(OPT_IN_LAYERS).toContain('court');
    expect(defaultRules().court.enabled).toBe(true);
    const saved = defaultRules() as unknown as Record<string, unknown>;
    delete saved.court;
    expect(upgradeRules(saved).court.enabled).toBe(false);
    expect(upgradeRules(defaultRules()).court.enabled).toBe(true);
    // tuned knobs survive, missing knobs fill in
    const tuned = upgradeRules({ ...saved, court: { enabled: true, releaseTurns: 2 } });
    expect(tuned.court.releaseTurns).toBe(2);
    expect(tuned.court.kneelInfluence).toBe(defaultRules().court.kneelInfluence);
  });

  it('an old save (no court group) plays on exactly as before: no captives, no coronation, no court state', () => {
    const saved = structuredClone(createGame({ seed: 41, players: ['expert', 'standard', 'novice'].map(l => ({ kind: 'ai' as const, aiLevel: l as 'expert' })) }));
    delete (saved.rules as unknown as Record<string, unknown>).court;
    let s: GameState = { ...saved, rules: upgradeRules(saved.rules) };
    expect(courtOn(s)).toBe(false);
    for (let i = 0; i < 14 && s.winner === null; i++) {
      const subs: Record<number, Submission> = {};
      for (const p of s.players) subs[p.id] = planTurn(s, p.id);
      for (const p of s.players) expect(subs[p.id].free.some(fa => ['captive', 'ransom', 'decree', 'exile'].includes(fa.type))).toBe(false);
      s = resolveTurn(s, subs);
    }
    expect(s.court).toBeUndefined();
  });

  it('court off plays the same game as a save without the group (the layer adds nothing when off)', () => {
    const run = (rules: unknown, strip: boolean) => {
      const g = createGame({ seed: 77, rules, players: ['expert', 'standard', 'novice'].map(l => ({ kind: 'ai' as const, aiLevel: l as 'expert' })) });
      if (strip) { delete (g.rules as unknown as Record<string, unknown>).court; g.rules = upgradeRules(g.rules); }
      let s = g;
      for (let i = 0; i < 10; i++) { const subs: Record<number, Submission> = {}; for (const p of s.players) subs[p.id] = planTurn(s, p.id); s = resolveTurn(s, subs); }
      return JSON.stringify({ ...s, rules: null });
    };
    expect(run({ court: { enabled: false } }, false)).toBe(run(undefined, true));
  });

  it('is deterministic: the same seed and orders give the same court', () => {
    const run = () => {
      let s = createGame({ seed: 5003, players: ['expert', 'standard', 'novice'].map(l => ({ kind: 'ai' as const, aiLevel: l as 'expert' })) });
      for (let i = 0; i < 22 && s.winner === null; i++) { const subs: Record<number, Submission> = {}; for (const p of s.players) subs[p.id] = planTurn(s, p.id); s = resolveTurn(s, subs); }
      return JSON.stringify(s);
    };
    const a = run();
    expect(a).toBe(run());
    expect(JSON.parse(a).court).toBeTruthy();
  });

  it('cleanFree keeps only well-formed court actions', () => {
    expect(cleanFree({ type: 'captive', id: 3, act: 'turn' })).toEqual({ type: 'captive', id: 3, act: 'turn' });
    expect(cleanFree({ type: 'captive', id: 3, act: 'ransom', res: 'credits' })).toEqual({ type: 'captive', id: 3, act: 'ransom', res: 'credits' });
    expect(cleanFree({ type: 'captive', id: -1, act: 'turn' })).toBeNull();
    expect(cleanFree({ type: 'captive', id: 3, act: 'boil' })).toBeNull();
    expect(cleanFree({ type: 'ransom', id: 3, pay: 'yes' })).toBeNull();
    expect(cleanFree({ type: 'ransom', id: 3, pay: true })).toEqual({ type: 'ransom', id: 3, pay: true });
    expect(cleanFree({ type: 'decree', answer: 'grovel' })).toBeNull();
    expect(cleanFree({ type: 'decree', answer: 'kneel' })).toEqual({ type: 'decree', answer: 'kneel' });
    expect(cleanFree({ type: 'exile' })).toBeNull();
    expect(cleanFree({ type: 'exile', whisper: 1.5 })).toBeNull();
    expect(cleanFree({ type: 'exile', whisper: 1, vote: 2, x: 9 })).toEqual({ type: 'exile', whisper: 1, vote: 2 });
  });
});

// ============================================================================ ransom
describe('court: ransom', () => {
  it('a fleet that catches a limping fleet takes its commander captive (no roll), with its scars', () => {
    const { t, cmd, x } = captiveSetup();
    const c = t.court!.captives[0];
    expect(c.cmd.name).toBe(cmd);
    expect(c.owner).toBe(0); expect(c.captor).toBe(1); expect(c.region).toBe(x.id);
    expect(c.until).toBe(c.turn + CR(t).releaseTurns);
    expect(c.scars?.map(z => z.id)).toEqual(['burned']);
    expect(t.players[0].reserveCommanders.some(z => z.name === cmd)).toBe(false);
    expect(c.cmd.alive).toBe(true);
  });

  it('a commander that escapes a wreck is taken by the house whose ships hold the system', () => {
    const s = game(31, { commanderFate: { dieChance: 0 } }); clearMap(s); rich(s);
    const x = farColony(s, 2);
    const a = fleetAt(s, 0, x.id, ['corvette']);
    fleetAt(s, 1, x.id, ['frigate', 'frigate', 'frigate', 'frigate', 'frigate', 'frigate']);
    let t = resolveTurn(s, idle(s));
    for (let i = 0; i < 4 && t.fleets.some(f => f.id === a.id); i++) t = resolveTurn(t, idle(t));
    expect(t.fleets.some(f => f.id === a.id)).toBe(false);
    expect(t.court!.captives.map(c => c.cmd.name)).toContain(a.commander.name);
    // witnesses of the battle read only that the commander survived
    const hl = t.log.length ? (t.last?.battles ?? []).flatMap(b => b.highlights) : [];
    expect(hl.some(h => /escapes the wreck/.test(h) && h.includes(a.commander.name))).toBe(false);
  });

  it('the Warden and a garrison never take captives; without ships there is nobody to hold one', () => {
    const s = game(23); clearMap(s); ensureSoul(s);
    const x = farColony(s, 2);
    const f = fleetAt(s, 0, x.id, ['frigate']);
    f.limping = { since: 1, to: s.players[0].capital, by: 1 };
    expect(captureCommander(s, f, -1 as unknown as number, x.id, 1, () => {})).toBeNull();
    catchLimping(s, f, 1, null, 1, () => {});   // a garrison catch: the old roll (falls or escapes)
    expect(s.court?.captives.length ?? 0).toBe(0);
  });

  it('ransom: the captor names the currency, the owner pays the next turn and the commander comes home', () => {
    const { t, cmd } = captiveSetup();
    const c = t.court!.captives[0];
    const price = ransomPrice(t, c, 'credits');
    expect(price).toBe(CR(t).ransomCredits + CR(t).ransomCreditsPerRank * 3);
    // the owner cannot pay before terms exist
    expect(ransomBlock(t, 0, c.id, true)).toMatch(/no terms/);
    const t2 = act(t, { 1: { free: [{ type: 'captive', id: c.id, act: 'ransom', res: 'credits' }] } });
    expect(t2.court!.captives[0].offer).toEqual({ res: 'credits', amount: price, turn: t.turn });
    // a second act on the same captive in the same turn is refused (one decision a turn)
    expect(captiveBlock(t2, 1, c.id, 'execute')).toBeNull();
    const c0 = t2.players[0].res.credits, c1 = t2.players[1].res.credits;
    const t3 = act(t2, { 0: { free: [{ type: 'ransom', id: c.id, pay: true }] } });
    expect(t3.court!.captives.length).toBe(0);
    expect(t3.players[0].reserveCommanders.some(z => z.name === cmd)).toBe(true);
    expect(t3.court!.records.some(r => r.kind === 'ransomed' && r.amount === price)).toBe(true);
    // income comes in at the end of the turn too: compare the transfer through the ledger
    const paid = t3.court!.records.find(r => r.kind === 'ransomed')!;
    expect(paid.res).toBe('credits');
    expect(t3.players[1].res.credits - c1).toBeGreaterThan(t3.players[0].res.credits - c0 - 0);
  });

  it('refused terms clear; the captor decides again', () => {
    const { t } = captiveSetup();
    const c = t.court!.captives[0];
    const t2 = act(t, { 1: { free: [{ type: 'captive', id: c.id, act: 'ransom', res: 'influence' }] } });
    const t3 = act(t2, { 0: { free: [{ type: 'ransom', id: c.id, pay: false }] } });
    expect(t3.court!.captives[0].offer).toBeNull();
    expect(t3.court!.captives[0].refused).toBe(t2.turn);
    expect(captiveBlock(t3, 1, c.id, 'execute')).toBeNull();
  });

  it('execute: the commander dies; a grievance that never clears and hits harder; a public headline', () => {
    const { t, cmd } = captiveSetup();
    const c = t.court!.captives[0];
    const t2 = act(t, { 1: { free: [{ type: 'captive', id: c.id, act: 'execute' }] } });
    expect(t2.court!.captives.length).toBe(0);
    const d = t2.soul!.debts.find(z => z.grievance)!;
    expect(d).toBeTruthy();
    expect(d.debtor).toBe(1); expect(d.creditor).toBe(0); expect(d.victim).toBe(cmd);
    expect(debtHit(t2, 0, 1)).toBeCloseTo(SR(t2).debtHit + CR(t2).executeHit, 6);
    onBeaten(t2, 1, 0, 'Someone', 0, 1, () => {});
    expect(d.cleared ?? null).toBeNull();
    // every house reads it
    for (const p of [0, 1, 2]) expect(viewFor(t2, p).state.soul!.herald.at(-1)!.headlines.some(h => h.kind === 'executed')).toBe(true);
    expect(t2.regions.some(r => r.memorials.some(m => m.includes(cmd) && m.includes('executed')))).toBe(true);
  });

  it('turn: the captor pays influence; the commander serves it with its memories and scars', () => {
    const { t, cmd } = captiveSetup();
    const c = t.court!.captives[0];
    const rivals = structuredClone(c.cmd.rivals);
    const price = turnPrice(t, c);
    const t2 = act(t, { 1: { free: [{ type: 'captive', id: c.id, act: 'turn' }] } });
    const turned = t2.players[1].reserveCommanders.find(z => z.name === cmd)!;
    expect(turned.turned).toEqual({ from: 0, turn: t.turn });
    expect(turned.rank).toBe(3);
    expect(turned.rivals).toEqual(rivals);
    expect(turned.scars?.map(z => z.id)).toEqual(['burned']);
    expect(t2.court!.records.some(r => r.kind === 'turned' && r.public)).toBe(true);
    expect(t.players[1].res.influence - price).toBeLessThanOrEqual(t2.players[1].res.influence);
    // its next fleet bears the scars
    const nf = newFleet(t2, rng, 1, t2.players[1].capital);
    expect(nf.commander.name).toBe(cmd);
    expect(nf.scars?.map(z => z.id)).toEqual(['burned']);
    // too poor to turn: refused
    const poor = structuredClone(t); poor.players[1].res.influence = 0;
    expect(captiveBlock(poor, 1, c.id, 'turn')).toMatch(/influence/);
  });

  it('the clock: an undecided captive goes home free; no game stalls', () => {
    let { t, cmd } = captiveSetup();
    const until = t.court!.captives[0].until;
    while (t.turn <= until) t = resolveTurn(t, idle(t));
    expect(t.court!.captives.length).toBe(0);
    expect(t.players[0].reserveCommanders.some(z => z.name === cmd)).toBe(true);
    expect(t.court!.records.some(r => r.kind === 'released')).toBe(true);
  });

  it('only the captor acts, only the owner pays; garbage ids fail softly', () => {
    const { t } = captiveSetup();
    const c = t.court!.captives[0];
    expect(captiveBlock(t, 0, c.id, 'execute')).toMatch(/not your captive/);
    expect(captiveBlock(t, 2, c.id, 'execute')).toMatch(/not your captive/);
    expect(captiveBlock(t, 1, 999, 'execute')).toMatch(/no such captive/);
    expect(captiveBlock(t, 1, c.id, 'ransom')).toMatch(/credits or influence/);
    const t2 = act(t, { 2: { free: [{ type: 'captive', id: c.id, act: 'execute' }] } });
    expect(t2.court!.captives.length).toBe(1);
    expect(t2.last!.events.some(e => e.k === 'fail' && e.owner === 2 && /captive failed/.test(e.text))).toBe(true);
  });
});

// ============================================================================ fog
describe('court: fog', () => {
  it('a captive and its terms are visible to its owner and captor only; a third house learns nothing', () => {
    const { t, cmd } = captiveSetup();
    const c = t.court!.captives[0];
    const t2 = act(t, { 1: { free: [{ type: 'captive', id: c.id, act: 'ransom', res: 'credits' }] } });
    for (const p of [0, 1]) {
      const v = viewFor(t2, p).state;
      expect(v.court!.captives.length).toBe(1);
      expect(v.court!.captives[0].offer?.res).toBe('credits');
    }
    const v2 = viewFor(t2, 2).state;
    expect(v2.court!.captives).toEqual([]);
    expect(v2.court!.records).toEqual([]);
    // (a lost banner's blood-debt names its commander in public, as before: the capture itself is what stays private)
    const json = JSON.stringify({ ...v2, regions: null, soul: null });
    expect(json.includes(cmd)).toBe(false);
    // nor in its turn results or Herald
    for (const st of [t, t2]) {
      const r = filterResultFor(st, st.last!, 2);
      expect(r.events.some(e => e.k === 'soul' && /captive|terms/.test(e.text))).toBe(false);
      expect(viewFor(st, 2).state.soul!.herald.flatMap(ed => ed.headlines).some(h => ['captured', 'ransom_offer', 'ransomed', 'released'].includes(h.kind))).toBe(false);
      expect(viewFor(st, 0).state.soul!.herald.flatMap(ed => ed.headlines).some(h => h.kind === 'captured')).toBe(true);
    }
    // the parties read the capture and the terms
    expect(filterResultFor(t, t.last!, 0).events.some(e => e.k === 'soul' && e.kind === 'captured')).toBe(true);
    expect(filterResultFor(t2, t2.last!, 0).events.some(e => e.k === 'soul' && e.kind === 'ransom_offer')).toBe(true);
  });

  it("an exile's whisper and tally are its own secret; its ghost vote is public; decrees are public", () => {
    const s = game(51); ensureSoul(s);
    const ct = ensureCourt(s)!;
    s.players[2].eliminated = true;
    ct.exiles.push({ p: 2, since: 1, whisper: 0, vote: 1, tally: [3, 0, 0] });
    ct.decrees.push({ turn: 1, p: 1, holder: 0, answer: 'kneel' });
    ct.coronation = { holder: 0, since: 1, until: 3, answers: { 1: 'kneel' } };
    for (const p of [0, 1]) {
      const v = viewFor(s, p).state.court!;
      expect(v.exiles[0].whisper).toBeNull();
      expect(v.exiles[0].tally).toEqual([]);
      expect(v.exiles[0].vote).toBe(1);
      expect(v.decrees.length).toBe(1);
      expect(v.coronation?.answers[1]).toBe('kneel');
    }
    expect(viewFor(s, 2).state.court!.exiles[0].whisper).toBe(0);
    expect(viewFor(s, 2).state.court!.exiles[0].tally).toEqual([3, 0, 0]);
  });
});

// ============================================================================ coronation
/** Player 0 sits the Throne; the reign opens this turn. */
function crowned(seed = 61) {
  const s = game(seed); rich(s);
  const throne = s.regions.find(r => r.kind === 'throne')!;
  throne.owner = 0; throne.garrison = 30;
  const t = resolveTurn(s, idle(s));   // held through the turn: the reign (and its countdown) opens at its end
  return { t, throne };
}

describe('court: the Coronation', () => {
  it('a new reign opens a public countdown for every living rival', () => {
    const { t } = crowned();
    expect(t.throne.owner).toBe(0);
    const cr = t.court!.coronation!;
    expect(cr.holder).toBe(0);
    expect(cr.until).toBe(cr.since + CR(t).decreeTurns);
    for (const p of [0, 1, 2]) expect(viewFor(t, p).state.court!.coronation?.holder).toBe(0);
    expect(decreeBlock(t, 0, 'kneel')).toMatch(/itself/);
    expect(decreeBlock(t, 1, 'bow')).toMatch(/kneel or defy/);
  });

  it('Kneel pays influence once and binds; Defy is free and public; silence is Defy at the deadline', () => {
    const { t } = crowned();
    const inf = t.players[1].res.influence;
    const t2 = act(t, { 1: { free: [{ type: 'decree', answer: 'kneel' }] } });
    expect(t2.court!.kneels).toEqual([{ p: 1, holder: 0, turn: t.turn }]);
    expect(t2.court!.paid).toContain('1:0');
    expect(t2.players[1].res.influence).toBeGreaterThanOrEqual(inf + CR(t).kneelInfluence);
    expect(decreeBlock(t2, 1, 'defy')).toMatch(/already answered/);
    for (const p of [0, 1, 2]) expect(viewFor(t2, p).state.soul!.herald.at(-1)!.headlines.some(h => h.kind === 'kneel')).toBe(true);
    // seat 2 never answers: by the deadline it has defied
    let t3 = t2;
    while (t3.court!.coronation) t3 = resolveTurn(t3, idle(t3));
    expect(t3.court!.decrees.find(d => d.p === 2)).toMatchObject({ answer: 'defy', auto: true });
    expect(t3.court!.decrees.find(d => d.p === 1)!.answer).toBe('kneel');
  });

  it('a house that knelt and then strikes the holder breaks its knee and loses VP, in public', () => {
    const { t, throne } = crowned();
    const t2 = act(t, { 1: { free: [{ type: 'decree', answer: 'kneel' }] } });
    const holderWorld = t2.regions.find(r => r.owner === 0 && r.id !== throne.id)!;
    const o: Order = { type: 'influence', target: holderWorld.id };
    expect(strikesHolder(t2, o, 0)).toBe(true);
    const vp = t2.players[1].vp;
    const t3 = act(t2, { 1: { orders: [o] } });
    expect(t3.court!.kneels.length).toBe(0);
    expect(t3.players[1].vpLog.some(e => e.amount === -CR(t).kneelBreakVp && /knee/i.test(e.why))).toBe(true);
    expect(t3.players[1].vp).toBeLessThanOrEqual(vp - CR(t).kneelBreakVp + 3);
    expect(t3.court!.decrees.some(d => d.p === 1 && d.answer === 'broke')).toBe(true);
    expect(viewFor(t3, 2).state.soul!.herald.at(-1)!.headlines.some(h => h.kind === 'knee_broken')).toBe(true);
  });

  it('losing the Throne releases the knees and ends an open coronation', () => {
    const { t, throne } = crowned();
    const t2 = act(t, { 1: { free: [{ type: 'decree', answer: 'kneel' }] } });
    t2.regions[throne.id].owner = 2;
    let t3 = resolveTurn(t2, idle(t2));
    t3 = resolveTurn(t3, idle(t3));
    expect(t3.court!.kneels.some(k => k.holder === 0)).toBe(false);
    expect(t3.court!.coronation?.holder ?? 2).toBe(2);
  });

  it('AI: kneels only when it trails, has no border and the holder is not about to win; defies otherwise; penalises striking', () => {
    const { t } = crowned();
    t.players[0].vp = 12; t.players[1].vp = 2; t.players[2].vp = 11;
    const a1 = kneelOrDefy(t, 1, 'expert'), a2 = kneelOrDefy(t, 2, 'expert');
    expect(a2).toBe('defy');   // only one VP behind
    expect(['kneel', 'defy']).toContain(a1);
    t.players[0].vp = 30;
    expect(kneelOrDefy(t, 1, 'expert')).toBe('defy');   // the holder is close to winning
    const sub = planTurn(t, 1);
    expect(sub.free.filter(fa => fa.type === 'decree').length).toBe(1);
    t.court!.kneels.push({ p: 1, holder: 0, turn: t.turn });
    const w = t.regions.find(r => r.owner === 0)!;
    expect(kneelPenalty(t, 1, { type: 'influence', target: w.id })).toBeGreaterThan(0);
    expect(kneelPenalty(t, 2, { type: 'influence', target: w.id })).toBe(0);
  });
});

// ============================================================================ exile
/** Seat 2 has fallen and is in exile. */
function exiled(seed = 71) {
  const s = game(seed); rich(s);
  for (const r of s.regions) if (r.owner === 2) r.owner = 0;
  s.fleets = s.fleets.filter(f => f.owner !== 2);
  const t = resolveTurn(s, idle(s));
  return { t };
}

describe('court: exile', () => {
  it('an eliminated house goes into exile and stays at the table', () => {
    const { t } = exiled();
    expect(t.players[2].eliminated).toBe(true);
    const e = t.court!.exiles.find(x => x.p === 2)!;
    expect(e).toMatchObject({ whisper: null, vote: null });
    expect(t.soul!.herald.at(-1)!.headlines.some(h => h.kind === 'exiled')).toBe(true);
  });

  it('it whispers and votes (free actions only: its orders are ignored); the ghost vote pays a little influence', () => {
    const { t } = exiled();
    expect(exileBlock(t, 2, 2, undefined)).toMatch(/living/);
    expect(exileBlock(t, 0, 1, undefined)).toMatch(/exiled/);
    const inf = t.players[1].res.influence;
    const t2 = act(t, { 2: { free: [{ type: 'exile', whisper: 0, vote: 1 }], orders: [{ type: 'scan', target: 0 }] } });
    const e = t2.court!.exiles.find(x => x.p === 2)!;
    expect(e.whisper).toBe(0); expect(e.vote).toBe(1);
    expect(t2.scans.some(x => x.owner === 2)).toBe(false);
    expect(ghostVotes(t2, 1)).toBe(1);
    expect(ghostVotes(t2, 0)).toBe(0);
    const t3 = resolveTurn(t2, idle(t2));
    expect(t3.court!.exiles[0].vote).toBe(1);
    expect(t2.players[1].res.influence).toBeGreaterThanOrEqual(inf + CR(t).ghostInfluence);
    void t3;
  });

  it('the ghost vote breaks an exact VP tie, and nothing else', () => {
    const { t } = exiled();
    const s = structuredClone(t);
    s.court!.exiles[0].vote = 1;
    s.players[0].vp = 20; s.players[1].vp = 20; s.turn = s.rules.victory.turnLimit; s.winner = null;
    s.throne.owner = null;
    checkVictory(s, true);
    expect(s.winner).toBe(1);
    const u = structuredClone(t);
    u.court!.exiles[0].vote = 1;
    u.players[0].vp = 21; u.players[1].vp = 20; u.turn = u.rules.victory.turnLimit; u.winner = null;
    checkVictory(u, true);
    expect(u.winner).toBe(0);
  });

  it('the Warden obeys a whisper only against a house near the lead (an exile cannot turn it on the weakest)', () => {
    const { t } = exiled();
    const e = t.court!.exiles[0];
    t.players[0].vp = 20; t.players[1].vp = 18;
    e.whisper = 1;
    expect(wardenTarget(t)).toBe(1);
    t.players[1].vp = 20 - CR(t).whisperGap - 1;
    expect(wardenTarget(t)).toBeNull();
  });

  it('Exile points: what the marked house lost; only points against the winner count (Saga and League)', () => {
    const { t } = exiled();
    const e = t.court!.exiles[0];
    e.whisper = 0;
    const own = t.regions.find(r => r.owner === 0)!;
    const startOwners = t.regions.map(r => r.owner);
    own.owner = 1;
    courtTally(t, [{ id: 1, name: 'B', turn: t.turn, pulse: 1, region: own.id, sides: [{ owner: 0, fleets: [], ships: [] }, { owner: -1, fleets: [], ships: [] }], rounds: [], winner: -1, losses: { 0: 2 }, highlights: [] }],
      [], startOwners);
    const K = CR(t);
    expect(e.tally[0]).toBe(2 * K.exileShipPts * K.exileWardenMult + K.exileWorldPts);
    t.winner = 1; courtFinal(t);
    expect(e.points).toBe(0);
    e.points = undefined; t.winner = 0; courtFinal(t);
    expect(e.points).toBe(e.tally[0]);
    const saga = sagaOf(t);
    expect(saga.exiles.find(x => x.player === 2)?.points).toBe(e.points);
    const sum = summarizeGame(t, { game: 'g1', name: 'G', createdAt: 1, members: ['a', 'b', 'c'], kinds: ['human', 'human', 'human'] });
    expect(sum.seats[2].exilePoints).toBe(e.points);
    const tbl = leagueTable({ v: 1, id: 'L', name: 'L', createdAt: 1, games: [sum], pending: [] });
    expect(tbl.members.find(m => m.key === 'c')!.exilePoints).toBe(e.points);
  });

  it('AI: an exile marks the leader and backs the trailing house; it re-sends nothing when nothing changes', () => {
    const { t } = exiled();
    t.players[0].vp = 15; t.players[1].vp = 9;
    const fa = exileChoice(t, 2);
    expect(fa).toEqual({ type: 'exile', whisper: 0, vote: 1 });
    expect(planTurn(t, 2).free).toEqual([]);              // a human exile's whisper is never chosen for it
    t.players[2].kind = 'ai';
    expect(planTurn(t, 2).free).toEqual([fa]);
    const t2 = act(t, { 2: { free: [fa!] } });
    expect(exileChoice(t2, 2)).toBeNull();
  });

  it('LIVE: an exile can still queue its whisper (and nothing else)', () => {
    const { t } = exiled();
    const L = makeLive(t, 0, 360);
    expect(queueFree(L, 2, { type: 'exile', whisper: 0 })).toBeNull();
    expect(queueFree(L, 2, { type: 'dispatch', text: 'boo' })).toMatch(/eliminated/);
    const n = runTick(L, () => true);
    expect(n.court!.exiles[0].whisper).toBe(0);
  });
});

// ============================================================================ the AI
describe('court: the AI', () => {
  it('captor: ransoms first, executes a commander that owes it blood, turns a veteran it can afford', () => {
    const { t } = captiveSetup(23, 1);
    const c = t.court!.captives[0];
    expect(captorChoice(t, 1, c, 'expert')).toMatchObject({ type: 'captive', act: 'ransom' });
    c.cmd.rank = 3;
    expect(captorChoice(t, 1, c, 'expert')).toMatchObject({ act: 'turn' });
    t.players[1].res.influence = 0;
    expect(captorChoice(t, 1, c, 'standard')).toMatchObject({ act: 'ransom' });
    t.soul!.debts.push({ id: 99, turn: 1, debtor: 0, creditor: 1, killer: c.cmd.name, victim: 'X', fleet: 'Y', region: 0, cleared: null });
    expect(captorChoice(t, 1, c, 'standard')).toMatchObject({ act: 'execute' });
    // terms out and not yet answerable: it waits
    t.soul!.debts.pop();
    c.offer = { res: 'credits', amount: 20, turn: t.turn - 1 };
    expect(captorChoice(t, 1, c, 'expert')).toBeNull();
  });

  it('owner: pays for a veteran it can afford, refuses dear terms for a rookie', () => {
    const { t } = captiveSetup(23, 3);
    const c = t.court!.captives[0];
    c.offer = { res: 'credits', amount: 20, turn: t.turn - 1 };
    expect(courtFree(t, 0)).toContainEqual({ type: 'ransom', id: c.id, pay: true });
    c.cmd.rank = 1; t.players[0].res.credits = 25;
    expect(courtFree(t, 0)).toContainEqual({ type: 'ransom', id: c.id, pay: false });
  });

  it('AI games: every court decision it sends is legal (no wasted actions), from the fogged view too', () => {
    let fails = 0, sent = 0;
    for (const seed of [5001, 5002, 5004]) {
      let s = createGame({ seed, players: ['expert', 'standard', 'novice'].map(l => ({ kind: 'ai' as const, aiLevel: l as 'expert' })) });
      while (s.winner === null && s.turn < 40) {
        const subs: Record<number, Submission> = {};
        for (const p of s.players) subs[p.id] = planTurn(viewFor(s, p.id).state, p.id);
        sent += Object.values(subs).reduce((a, x) => a + x.free.filter(fa => ['captive', 'ransom', 'decree', 'exile'].includes(fa.type)).length, 0);
        s = resolveTurn(s, subs);
        fails += s.last!.events.filter(e => e.k === 'fail' && /^(captive|ransom|decree|exile) failed/.test(e.text)).length;
        // invariants: a commander is in exactly one place
        const names = s.court!.captives.map(c => c.cmd.name);
        for (const p of s.players) for (const c of p.reserveCommanders) expect(names.includes(c.name) && s.court!.captives.find(x => x.cmd.name === c.name)!.cmd === c).toBe(false);
      }
    }
    expect(sent).toBeGreaterThan(0);
    expect(fails).toBe(0);
  });

  it('the Herald prints court stories without errors (and the edition stays small)', () => {
    const { t } = captiveSetup();
    const c = t.court!.captives[0];
    const t2 = act(t, { 1: { free: [{ type: 'captive', id: c.id, act: 'execute' }] } });
    const ed = t2.soul!.herald.at(-1)!;
    const h = ed.headlines.find(x => x.kind === 'executed')!;
    expect(h.body && h.body.length).toBeTruthy();
    expect(h.body!.includes(c.cmd.name)).toBe(true);
    void makeEdition;
  });
});

// ============================================================================ the server

describe('court: the server', () => {
  it('an exiled seat may still send its whisper; it never holds up the turn; an AI exile whispers by itself', () => {
    const log = console.log; console.log = () => {};
    try {
      const store = new Store(mkdtempSync(join(tmpdir(), 'tc-court-')));
      const g = store.create({ seats: [{ kind: 'human' }, { kind: 'human' }, { kind: 'human' }], seed: 71 });
      // seat 2 falls (as in exiled())
      const s = g.state;
      for (const r of s.regions) if (r.owner === 2) r.owner = 0;
      s.fleets = s.fleets.filter(f => f.owner !== 2);
      store.submit(g, 0, emptySubmission(s), s.turn);
      store.submit(g, 1, emptySubmission(s), s.turn);
      store.submit(g, 2, emptySubmission(s), s.turn);
      expect(g.state.players[2].eliminated).toBe(true);
      expect(g.state.court!.exiles.some(e => e.p === 2)).toBe(true);
      // the exile sends a whisper: accepted, and the turn does not wait for it (nor it for them)
      expect(store.submit(g, 2, { orders: [], free: [{ type: 'exile', whisper: 0, vote: 1 }] }, g.state.turn)).toBe(false);
      store.submit(g, 0, emptySubmission(g.state), g.state.turn);
      expect(store.submit(g, 1, emptySubmission(g.state), g.state.turn)).toBe(true);
      expect(g.state.court!.exiles.find(e => e.p === 2)).toMatchObject({ whisper: 0, vote: 1 });
      // a fallen seat with no exile record (court off) is still refused
      const g2 = store.create({ seats: [{ kind: 'human' }, { kind: 'human' }, { kind: 'human' }], seed: 72, rules: { court: { enabled: false } } });
      g2.state.players[2].eliminated = true;
      expect(() => store.submit(g2, 2, emptySubmission(g2.state), g2.state.turn)).toThrow(/eliminated/);
    } finally { console.log = log; }
  });
});
