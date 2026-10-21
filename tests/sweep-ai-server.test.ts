// Bug sweep (AI + server): regression tests for what the sweep found.
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.ts';
import { createGame, resolveTurn, planTurn, viewFor, makeLive, runTick } from '../shared/index.ts';
import type { GameState, Submission } from '../shared/index.ts';

type Lvl = 'novice' | 'standard' | 'expert';
const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'tc-sweep-')); dirs.push(d); return d; };
const quiet = <T>(fn: () => T): T => { const l = console.log, e = console.error; console.log = () => {}; console.error = () => {}; try { return fn(); } finally { console.log = l; console.error = e; } };
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

/** Play an all-AI WEGO game; `fog`: each seat plans from its own fogged view. Collects the AI's resolve-time failures. */
function playFails(seed: number, levels: Lvl[], turns: number, fog = false) {
  let s: GameState = createGame({ seed, players: levels.map(l => ({ kind: 'ai' as const, aiLevel: l })) });
  const fails: string[] = [];
  for (let t = 0; t < turns && s.winner === null; t++) {
    const subs: Record<number, Submission> = {};
    for (const p of s.players) subs[p.id] = planTurn(fog ? viewFor(s, p.id).state : s, p.id);
    s = resolveTurn(s, subs);
    for (const e of s.last!.events) if (e.k === 'fail' && e.owner >= 0) fails.push(`t${s.turn - 1} p${e.owner}: ${e.text}`);
  }
  return fails;
}

describe('AI: projections across slots match the resolver', () => {
  it('a second new banner in the same turn is not planned when only one is free (picket used as the template)', () => {
    // seed 2000: the expert's first fleet is a scout picket; the projected new fleet copied its missing banner,
    // so a second and third founding Build looked legal and failed with "no free banner"
    const fails = playFails(2000, ['expert', 'standard', 'novice'], 20);
    expect(fails.filter(f => /no free banner/.test(f))).toEqual([]);
  });

  it("WEGO: a law enacted this turn doesn't cheapen this turn's builds (the economy runs before laws)", () => {
    // seed 5004, fogged: the expert slotted Industrial then a Build it could only afford with the discount
    const fails = playFails(5004, ['standard', 'novice', 'expert'], 12, true);
    expect(fails.filter(f => /Build failed: not enough resources/.test(f))).toEqual([]);
  });
});

describe('server: old saves', () => {
  it('a save from before the Soul/Signature layers keeps them off (upgradeRules), and plays on', () => {
    const dir = tmp();
    const st = quiet(() => new Store(dir));
    const g = st.create({ seats: [{ kind: 'human' }, { kind: 'ai' }, { kind: 'ai' }], seed: 11 } as never);
    const file = join(dir, `${g.id}.json`);
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    delete raw.state.rules.soul; delete raw.state.rules.signature; delete raw.state.soul;
    for (const f of raw.state.fleets) delete f.banner;
    writeFileSync(file, JSON.stringify(raw));
    const st2 = quiet(() => new Store(dir));
    const g2 = st2.games.get(g.id)!;
    expect(g2.state.rules.soul.enabled).toBe(false);
    expect(g2.state.rules.signature.enabled).toBe(false);
    // a save that already had them keeps them on
    expect(st.games.get(g.id)!.state.rules.soul.enabled).not.toBe(false);
    st2.submit(g2, 0, { orders: [], free: [] });
    expect(g2.state.turn).toBe(2);
    expect(g2.state.fleets.some(f => f.banner)).toBe(false);
  });
});

describe('server: spectators never see private details', () => {
  it("strips sworn pact words, pact/tribute offers, world postures, pending callings, unprinted dispatches and private headlines", () => {
    const st = quiet(() => new Store(tmp()));
    const g = st.create({ seats: [{ kind: 'human' }, { kind: 'human' }, { kind: 'ai' }], seed: 21 } as never);
    // play a few turns so the Soul layer has material
    for (let i = 0; i < 6; i++) g.state = resolveTurn(g.state, { 0: planTurn(g.state, 0), 1: planTurn(g.state, 1), 2: planTurn(g.state, 2) });
    const s = g.state;
    s.players[0].pactWords = { 1: 'secret oath' };
    s.players[0].prevPactOffers = [1];
    s.players[0].tributeOffers = [3]; s.players[0].prevTributeOffers = [3];
    const r = s.regions.find(x => x.owner === 1)!;
    r.wposture = { posture: 'levies' } as never; r.idleUntil = s.turn + 2;
    r.story = { ...(r.story ?? {}), pendingCalling: { options: ['granary'], since: s.turn, owner: 1 } } as never;
    s.soul!.dispatches.push({ p: 0, text: 'planted lie', as: 'source', turn: s.turn });
    s.soul!.beats.push({ text: 'internal beat', kind: 'x', players: [0], drama: 1, public: false });
    s.soul!.herald.push({ turn: s.turn, headlines: [{ text: 'private headline', kind: 'x', players: [1], drama: 1, public: false }, { text: 'public headline', kind: 'x', players: [], drama: 1, public: true }], dispatches: [] });
    s.soul!.moments.push({ text: 'private moment', kind: 'x', players: [1], drama: 9, public: false });

    const v = st.view(g, null).state;
    const json = JSON.stringify(v);
    for (const leak of ['secret oath', 'planted lie', 'internal beat', 'private headline', 'private moment']) expect(json).not.toContain(leak);
    expect(json).toContain('public headline');
    expect(v.players[0].prevPactOffers ?? []).toEqual([]);
    expect(v.players[0].tributeOffers ?? []).toEqual([]);
    expect(v.regions[r.id].idleUntil).toBeUndefined();
    expect(v.regions[r.id].wposture).toBeUndefined();
    expect(v.regions[r.id].story?.pendingCalling ?? null).toBeNull();
    // the stored state is untouched
    expect(g.state.players[0].pactWords).toEqual({ 1: 'secret oath' });
    // the addressee (a seat) still sees its words
    expect(st.view(g, 1).state.players[0].pactWords).toEqual({ 1: 'secret oath' });
  });
});

describe('server: one seat cannot act for another', () => {
  it("WEGO: orders and free actions naming a rival's fleet do nothing to it", () => {
    const st = quiet(() => new Store(tmp()));
    const g = st.create({ seats: [{ kind: 'human' }, { kind: 'human' }, { kind: 'ai' }], seed: 31 } as never);
    const rival = g.state.fleets.find(f => f.owner === 1 && f.ships.length)!;
    const before = { region: rival.region, name: rival.name, doctrine: structuredClone(rival.doctrine), ships: rival.ships.length };
    const to = g.state.regions[rival.region].neighbors[0];
    st.submit(g, 0, {
      orders: [{ type: 'move', fleet: rival.id, path: [to] }, { type: 'fortify', fleet: rival.id }],
      free: [{ type: 'rename', fleet: rival.id, name: 'Hijacked' }, { type: 'doctrine', fleet: rival.id, doctrine: { stance: 'evasive', retreatAt: 0.9, target: 'cheapest', guard: false } },
        { type: 'split', fleet: rival.id, ships: [rival.ships[0].id] }],
    });
    st.submit(g, 1, { orders: [], free: [] });
    expect(g.state.turn).toBe(2);
    const after = g.state.fleets.find(f => f.id === rival.id)!;
    expect(after.region).toBe(before.region);
    expect(after.name).toBe(before.name);
    expect(after.ships.length).toBe(before.ships);
    expect(after.doctrine.stance).not.toBe('evasive');
  });

  it("LIVE: free actions and halts naming a rival's fleet are refused or do nothing", () => {
    const st = quiet(() => new Store(tmp()));
    const g = st.create({ seats: [{ kind: 'human' }, { kind: 'human' }, { kind: 'ai' }], seed: 32, mode: 'live', liveSpeed: 'blitz' } as never);
    const rival = g.state.fleets.find(f => f.owner === 1 && f.ships.length)!;
    const name = rival.name;
    expect(() => st.liveHalt(g, 0, rival.id)).toThrow(/not your fleet/);
    try { st.liveFree(g, 0, { type: 'rename', fleet: rival.id, name: 'Hijacked' }); } catch { /* refused is fine */ }
    try { st.liveFree(g, 0, { type: 'merge', fleet: rival.id, into: rival.id }); } catch { /* refused is fine */ }
    g.state = runTick(g.state, pid => g.seats[pid].kind === 'ai');
    expect(g.state.fleets.find(f => f.id === rival.id)!.name).toBe(name);
  });
});

describe('server: malformed input never breaks a game', () => {
  it('garbage numbers (NaN, Infinity, negatives, unknown ids) in orders and free actions are rejected or ignored', () => {
    const st = quiet(() => new Store(tmp()));
    let failed = 0;
    st.onResolveError = () => { failed++; };
    const g = st.create({ seats: [{ kind: 'human' }, { kind: 'ai' }, { kind: 'ai' }], seed: 41 } as never);
    const bad = [NaN, Infinity, -1, 1e12, 0.5, '3', null];
    for (let t = 0; t < 4; t++) {
      const orders = bad.slice(0, 5).map((x, i) => (
        [{ type: 'move', fleet: x, path: [x] }, { type: 'build', region: x, cls: 'frigate', fleet: x }, { type: 'influence', target: x },
          { type: 'seize', fleet: 0, target: x, also: [x, x], via: [x] }, { type: 'pact', with: x, words: 'w'.repeat(10_000) }][i]));
      const free = [{ type: 'split', fleet: 0, ships: [NaN, -1] }, { type: 'dispatch', text: 'x'.repeat(5_000), as: 'house' }, { type: 'fate', use: 'surge', region: -5 }, { type: 'research', tech: '__proto__' }];
      // JSON on the wire turns NaN/Infinity into null; feed the raw values too (bots using the store directly)
      st.submit(g, 0, { orders, free });
    }
    // an oversize payload is refused outright
    expect(() => st.submit(g, 0, { orders: [], free: [{ type: 'dispatch', text: 'x'.repeat(100_000), as: 'house' }] })).toThrow(/too large/);
    expect(failed).toBe(0);
    expect(g.state.turn).toBe(5);
    const nonFinite = JSON.stringify(g.state, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? '!!' : v)).includes('"!!"');
    expect(nonFinite).toBe(false);
    for (const p of g.state.players) for (const k of ['industry', 'credits', 'influence'] as const) expect(Number.isFinite(p.res[k])).toBe(true);
  });
});

describe('LIVE: AI seats keep a banked-order game moving', () => {
  it('runs a few hundred ticks of an all-AI LIVE game without errors or non-finite values', () => {
    let s = makeLive(createGame({ seed: 9001, players: (['expert', 'standard', 'novice'] as Lvl[]).map(l => ({ kind: 'ai' as const, aiLevel: l })) }), 0, 360);
    for (let t = 0; t < 120 && s.winner === null; t++) s = runTick(s, () => true);
    expect(s.live!.tick).toBeGreaterThan(50);
    for (const p of s.players) expect(Number.isFinite(p.res.industry + p.res.credits + p.res.influence)).toBe(true);
  });
});

describe('AI: LIVE postures', () => {
  it('never plans a Seize with a fleet that is Guarded for the rest of the cycle', () => {
    let s = makeLive(createGame({ seed: 9000, players: (['novice', 'standard', 'expert'] as Lvl[]).map(l => ({ kind: 'ai' as const, aiLevel: l })) }), 0, 360);
    let bad = 0;
    for (let t = 0; t < 60 && s.winner === null; t++) {
      s = runTick(s, () => true);
      if (s.live!.tick % s.rules.live.ticksPerCycle === 0) continue;   // a new cycle clears postures
      for (const p of s.players) {
        if (p.eliminated) continue;
        const c = structuredClone(s);
        for (const f of c.fleets) if (f.owner === p.id && f.ships.length) f.posture = 'guarded';
        for (const o of planTurn(c, p.id).orders) if (o?.type === 'seize') { if (c.fleets.find(f => f.id === o.fleet)?.posture === 'guarded') bad++; }
      }
    }
    expect(bad).toBe(0);
  });
});
