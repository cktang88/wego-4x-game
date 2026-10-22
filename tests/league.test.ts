// The League ledger (docs/LOOPS.md §3.1): summaries of finished games, derived tables, the Herald's memory of them,
// and the server API (implicit creation, rematch, membership by seat token, idempotent updates, no token leaks).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGame, resolveTurn, planTurn, viewFor } from '../shared/index.ts';
import type { GameState, Submission, TurnResult } from '../shared/index.ts';
import { emptyLeague, leagueMemory, leagueTable, memberKey, recordGame, summarizeGame, type League } from '../shared/league.ts';
import { startServer, type RunningServer } from '../server/index.ts';

const FAST = { victory: { turnLimit: 7 } };
const SEATS = ['p:sam', 'p:kith', 'ai:gilded throneholders'];

function aiGame(seed: number, turns = 7, league?: ReturnType<typeof leagueMemory>): { s: GameState; history: TurnResult[] } {
  let s = createGame({ seed, rngSeed: seed * 7 + 1, rules: { victory: { turnLimit: turns } }, players: [{ kind: 'ai', name: 'Sam' }, { kind: 'ai', name: 'Kith' }, { kind: 'ai' }], league });
  const history: TurnResult[] = [];
  while (s.winner === null) {
    const subs: Record<number, Submission> = {};
    for (const p of s.players) subs[p.id] = planTurn(s, p.id);
    s = resolveTurn(s, subs);
    if (s.last) history.push(s.last);
  }
  return { s, history };
}
const sum = (g: { s: GameState; history: TurnResult[] }, id: string, at: number) =>
  summarizeGame(g.s, { game: id, name: `Game ${id}`, createdAt: at, members: SEATS, kinds: ['human', 'human', 'ai'], history: g.history });

const G1 = aiGame(4101), G2 = aiGame(4102), G3 = aiGame(4103, 9);

describe('league: summaries and tables (pure)', () => {
  it('a summary is deterministic: the same game gives the same summary', () => {
    expect(JSON.stringify(sum(G1, 'aa0001', 1))).toBe(JSON.stringify(sum(G1, 'aa0001', 1)));
    const again = aiGame(4101);
    expect(JSON.stringify(sum(again, 'aa0001', 1))).toBe(JSON.stringify(sum(G1, 'aa0001', 1)));
  });

  it('a summary records places, the winner, kills and captures that add up', () => {
    const x = sum(G3, 'aa0003', 3);
    expect(x.winner).toBe(G3.s.winner);
    expect(x.seats[x.winner!].place).toBe(1);
    expect(x.seats.map(s => s.place).sort()).toEqual([1, 2, 3]);
    for (let i = 0; i < 3; i++) {
      expect(x.kills[i][i]).toBe(0);
      expect(x.seats[i].shipsKilled).toBe(x.kills[i].reduce((a, b) => a + b, 0));
    }
    expect(x.seats.map(s => s.member)).toEqual(SEATS);
  });

  it('recording is idempotent, and every table derives from the summaries', () => {
    const l: League = emptyLeague('cafe01', 'The Test League', 0);
    l.pending = ['aa0001', 'aa0002'];
    expect(recordGame(l, sum(G1, 'aa0001', 1))).toBe(true);
    expect(recordGame(l, sum(G2, 'aa0002', 2))).toBe(true);
    const before = JSON.stringify(l);
    expect(recordGame(l, sum(G2, 'aa0002', 2))).toBe(false);      // again: nothing changes
    expect(recordGame(l, sum(G1, 'aa0001', 1))).toBe(false);
    expect(JSON.stringify(l)).toBe(before);
    expect(l.pending).toEqual([]);
    expect(l.games.map(g => g.game)).toEqual(['aa0001', 'aa0002']);
    const t = leagueTable(l);
    expect(t.played).toBe(2);
    expect(t.members.map(m => m.key).sort()).toEqual([...SEATS].sort());
    expect(t.members.reduce((a, m) => a + m.games, 0)).toBe(6);
    expect(t.hall.length).toBe(2);
    for (const h of t.hall) { expect(h.house).toBeTruthy(); expect(Array.isArray(h.banners)).toBe(true); }
    // the Ugly Trophy: last place of the latest game, carried until the next one
    const last = l.games[1].seats.find(s => s.place === 3)!;
    expect(t.ugly?.member).toBe(last.member);
    expect(t.members.filter(m => m.ugly).map(m => m.key)).toEqual([last.member]);
    // head-to-head: three pairs, each with two games
    expect(t.headToHead.length).toBe(3);
    for (const h of t.headToHead) { expect(h.games).toBe(2); expect(h.ahead[0] + h.ahead[1]).toBe(2); }
    // tables are a pure function of the League
    expect(JSON.stringify(leagueTable(l))).toBe(JSON.stringify(t));
  });

  it('nemesis marks name who took the most; feuds need it both ways; oaths are recorded with their words', () => {
    const l = emptyLeague('cafe02', 'Feuds', 0);
    const base = sum(G1, 'bb0001', 1);
    const z = () => [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    // constructed: Kith took four worlds from Sam, Sam two from Kith, and Kith broke an oath to Sam
    const g = { ...structuredClone(base), kills: z(), captures: z(), battles: z(), betrayals: z(), debts: z(), oaths: [{ by: 1, victim: 0, words: 'I will not cross the Veil', turn: 4 }] };
    g.captures[1][0] = 4; g.captures[0][1] = 2; g.betrayals[1][0] = 1;
    for (const sd of g.seats) { sd.oathsBroken = 0; sd.vowsBroken = 0; }
    g.seats[1].oathsBroken = 1;
    recordGame(l, g);
    recordGame(l, { ...structuredClone(g), game: 'bb0002', createdAt: 2 });
    const t = leagueTable(l);
    expect(t.nemesis.find(n => n.member === 'p:sam')?.nemesis).toBe('p:kith');
    expect(t.nemesis.find(n => n.member === 'p:kith')?.nemesis).toBe('p:sam');
    expect(t.nemesis.find(n => n.member === 'p:sam')!.harm).toBeGreaterThan(t.nemesis.find(n => n.member === 'p:kith')!.harm);
    const f = t.feuds.find(x => [x.a, x.b].sort().join() === 'p:kith,p:sam');
    expect(f).toBeTruthy();
    expect(f!.level).toBe('blood feud');
    expect(t.feuds.some(x => x.a.startsWith('ai:') || x.b.startsWith('ai:'))).toBe(false);
    expect(t.oaths.map(o => o.words)).toEqual(['I will not cross the Veil', 'I will not cross the Veil']);
    expect(t.members.find(m => m.key === 'p:kith')?.title).toBe('the Oathbreaker');
  });

  it('member keys ignore case, spacing and accents', () => {
    expect(memberKey('human', '  Sám  the Bold! ')).toBe(memberKey('human', 'sam THE bold'));
    expect(memberKey('ai', 'Sam')).not.toBe(memberKey('human', 'Sam'));
  });
});

describe('league: the Herald recalls the feud (pure)', () => {
  const l = emptyLeague('cafe03', 'The League of Sam, Kith and Gilded Throneholders', 0);
  recordGame(l, sum(G1, 'cc0001', 1));
  recordGame(l, sum(G2, 'cc0002', 2));
  const mem = leagueMemory(l, [{ member: 'p:sam', name: 'Sam' }, { member: 'p:kith', name: 'Kith' }, { member: 'ai:gilded throneholders', name: 'Gilded Throneholders' }]);

  it('memory is built for the new seats: the third meeting, with the last winner and the Ugly Trophy', () => {
    expect(mem.meeting).toBe(3);
    expect(mem.feuds.length).toBe(3);
    for (const f of mem.feuds) expect(f.games).toBe(2);
    expect(mem.houses.filter(h => h.ugly).length).toBe(1);
    expect(JSON.stringify(mem)).not.toMatch(/token|h:[0-9a-f]{8}/);
  });

  it('the first edition of the new game opens with the feud, for every reader', () => {
    let s = createGame({ seed: 4110, players: [{ kind: 'ai', name: 'Sam' }, { kind: 'ai', name: 'Kith' }, { kind: 'ai' }], league: mem });
    expect(s.league?.meeting).toBe(3);
    const subs: Record<number, Submission> = {};
    for (const p of s.players) subs[p.id] = planTurn(s, p.id);
    s = resolveTurn(s, subs);
    const ed = s.soul!.herald.at(-1)!;
    expect(ed.feud).toBe(true);
    const lead = ed.headlines[0];
    expect(lead.kind).toBe('feud');
    expect(lead.public).toBe(true);
    expect(lead.text).toMatch(/: THE THIRD MEETING$/);
    expect(lead.body).toBeTruthy();
    expect(lead.byline).toMatch(/^By /);
    expect(lead.body!.split('\n\n').length).toBeGreaterThanOrEqual(2);
    for (const p of [0, 1, 2]) expect(viewFor(s, p).state.soul!.herald.at(-1)!.headlines[0].kind).toBe('feud');
    // only once: the next edition is an ordinary one
    const subs2: Record<number, Submission> = {};
    for (const p of s.players) subs2[p.id] = planTurn(s, p.id);
    s = resolveTurn(s, subs2);
    expect(s.soul!.herald.at(-1)!.headlines.some(h => h.kind === 'feud')).toBe(false);
  });

  it('a first meeting (or a game outside any League) prints no feud', () => {
    const fresh = leagueMemory(emptyLeague('cafe04', 'New', 0), [{ member: 'p:a', name: 'A' }, { member: 'p:b', name: 'B' }, { member: 'p:c', name: 'C' }]);
    for (const league of [fresh, undefined]) {
      let s = createGame({ seed: 4111, players: [{ kind: 'ai' }, { kind: 'ai' }, { kind: 'ai' }], league });
      const subs: Record<number, Submission> = {};
      for (const p of s.players) subs[p.id] = planTurn(s, p.id);
      s = resolveTurn(s, subs);
      expect(s.soul!.herald.at(-1)!.headlines.some(h => h.kind === 'feud')).toBe(false);
    }
  });
});

// ============================================================================ server
describe('league: server API', () => {
  let srv: RunningServer, base: string, dataDir: string;
  const sent: { endpoint: string; payload: unknown }[] = [];
  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'tc-league-'));
    const log = console.log; console.log = () => {};
    try {
      srv = await startServer({ port: 0, host: '127.0.0.1', dataDir, distDir: join(dataDir, 'nodist'), tickMs: 3_600_000, createPerWindow: 1000,
        pushAnyHost: true, pushSender: async (sub, payload) => { sent.push({ endpoint: sub.endpoint, payload }); return 201; } });
    } finally { console.log = log; }
    base = `http://127.0.0.1:${srv.port}`;
  });
  afterAll(async () => { await srv?.close(); rmSync(dataDir, { recursive: true, force: true }); });

  const post = async (path: string, body: unknown) => {
    const r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, json: await r.json() as any, text: '' };
  };
  const get = async (path: string) => { const r = await fetch(`${base}${path}`); return { status: r.status, text: await r.text() }; };
  /** Seat 0 is human (named), the rest AI; the human seals empty orders until the turn limit ends it. */
  async function play(id: string, token: string) {
    for (let i = 0; i < 40; i++) {
      const meta = JSON.parse((await get(`/api/games/${id}`)).text);
      if (meta.winner !== null) return meta;
      const r = await post(`/api/games/${id}/orders`, { token, submission: { orders: [], free: [] }, turn: meta.turn });
      expect(r.status).toBe(200);
    }
    throw new Error('game did not end');
  }

  let g1 = '', t1 = '', leagueId = '';
  it('a new online game starts a League implicitly; it is recorded when the game ends', async () => {
    const c = await post('/api/games', { name: 'First', seats: [{ kind: 'human' }, { kind: 'ai' }, { kind: 'ai' }], rules: FAST });
    expect(c.status).toBe(200);
    g1 = c.json.id;
    leagueId = c.json.meta.league;
    expect(leagueId).toMatch(/^[0-9a-f]{10}$/);
    const j = await post(`/api/games/${g1}/join`, { seat: 0, name: 'Sam' });
    t1 = j.json.token;
    let lv = JSON.parse((await get(`/api/league/${leagueId}`)).text);
    expect(lv.played).toBe(0);
    expect(lv.running).toEqual([g1]);
    await play(g1, t1);
    lv = JSON.parse((await get(`/api/league/${leagueId}`)).text);
    expect(lv.played).toBe(1);
    expect(lv.running).toEqual([]);
    expect(lv.hall.length).toBe(1);
    expect(lv.members.some((m: any) => m.name === 'Sam' && m.kind === 'human')).toBe(true);
  });

  it('a rematch needs a seat token of the game; it keeps the seats, the galaxy and the League', async () => {
    expect((await post('/api/games', { league: { rematchOf: g1 } })).status).toBe(403);
    expect((await post('/api/games', { league: { rematchOf: g1, token: 'nope' } })).status).toBe(403);
    expect((await post('/api/games', { league: { rematchOf: 'ffffffffff', token: t1 } })).status).toBe(404);
    const c = await post('/api/games', { league: { rematchOf: g1, token: t1 } });
    expect(c.status).toBe(200);
    expect(c.json.meta.league).toBe(leagueId);
    const g2 = c.json.id;
    const st1 = srv.store.games.get(g1)!, st2 = srv.store.games.get(g2)!;
    expect(st2.state.seed).toBe(st1.state.seed);
    expect(st2.seats.map(s => s.kind)).toEqual(st1.seats.map(s => s.kind));
    expect(st2.state.players.map(p => p.name)).toEqual(st1.state.players.map(p => p.name));
    expect(st2.league!.members).toEqual(st1.league!.members);
    expect(st2.state.league?.meeting).toBe(2);
    const t2 = (await post(`/api/games/${g2}/join`, { seat: 0, name: 'Sam' })).json.token;
    await play(g2, t2);
    // the first edition opened with the feud
    expect(srv.store.games.get(g2)!.state.soul!.herald.find(e => e.turn === 1)?.feud).toBe(true);
    const lv = JSON.parse((await get(`/api/league/${leagueId}`)).text);
    expect(lv.played).toBe(2);
    expect(lv.hall.length).toBe(2);
    expect(lv.members.length).toBe(3);
    expect(lv.headToHead.every((h: any) => h.games === 2)).toBe(true);
    expect(lv.ugly).toBeTruthy();
    // adding a game by League id needs membership too
    expect((await post('/api/games', { league: { id: leagueId, game: g2, token: 'nope' } })).status).toBe(403);
    const c3 = await post('/api/games', { league: { id: leagueId, game: g2, token: t2 }, seats: [{ kind: 'human' }, { kind: 'ai' }, { kind: 'ai' }] });
    expect(c3.json.meta.league).toBe(leagueId);
  });

  it('updates are idempotent: recording an ended game again changes nothing on disk', async () => {
    const file = join(dataDir, '_leagues', `${leagueId}.json`);
    const before = readFileSync(file, 'utf8');
    for (const g of srv.store.games.values()) srv.store.recordLeague(g);
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('the League API and files never carry seat tokens, token hashes or emails', async () => {
    const lv = (await get(`/api/league/${leagueId}`)).text;
    const disk = readFileSync(join(dataDir, '_leagues', `${leagueId}.json`), 'utf8');
    const hashes = [...srv.store.games.values()].flatMap(g => g.seats.map(s => s.token)).filter((t): t is string => !!t);
    expect(hashes.length).toBeGreaterThan(0);
    for (const text of [lv, disk]) {
      expect(text).not.toContain(t1);
      for (const h of hashes) { expect(text).not.toContain(h); expect(text).not.toContain(h.slice(2)); }
      expect(text).not.toMatch(/"token"|@[a-z0-9-]+\./i);
    }
  });

  it('a browser finds its Leagues from the seat tokens it holds (and only those)', async () => {
    const mine = await post('/api/leagues/mine', { tokens: [{ game: g1, token: t1 }] });
    expect(mine.json.leagues.map((l: any) => l.id)).toEqual([leagueId]);
    expect(JSON.stringify(mine.json)).not.toContain(t1);
    expect((await post('/api/leagues/mine', { tokens: [{ game: g1, token: 'forged' }] })).json.leagues).toEqual([]);
    expect((await post('/api/leagues/mine', { tokens: 'x' })).json.leagues).toEqual([]);
    expect((await get('/api/league/zzzz')).status).toBe(404);
  });

  it('games outside any League stay outside', async () => {
    const c = await post('/api/games', { league: 'none', seats: [{ kind: 'human' }] });
    expect(c.json.meta.league).toBeUndefined();
    expect(srv.store.games.get(c.json.id)!.league).toBeUndefined();
  });
});
