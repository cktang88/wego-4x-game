// Regression tests for the multiplayer server: LIVE games, spectators, old saves, rule clamps, sockets.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { startServer, type RunningServer } from '../server/index.ts';
import { Store, sanitizeRules } from '../server/store.ts';
import { createGame, makeLive, tickMs } from '../shared/index.ts';
import type { ServerMsg } from '../shared/protocol.ts';

let srv: RunningServer;
let base: string;
const dirs: string[] = [];
const tmp = (p: string) => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d; };
const quiet = <T>(fn: () => T): T => { const l = console.log, e = console.error; console.log = () => {}; console.error = () => {}; try { return fn(); } finally { console.log = l; console.error = e; } };

const post = (p: string, body: unknown) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function newLiveGame() {
  const r = await post('/api/games', { name: 't', seats: [{ kind: 'human' }, { kind: 'human' }, { kind: 'human' }], seed: 7, mode: 'live', liveSpeed: 'blitz' });
  const { id } = await r.json();
  const toks: string[] = [];
  for (let i = 0; i < 3; i++) toks.push((await (await post(`/api/games/${id}/join`, { seat: i, name: `P${i}` })).json()).token);
  return { id: id as string, toks };
}
class Client {
  ws: WebSocket; msgs: ServerMsg[] = []; closed: number | null = null;
  private waiters: { pred: (m: ServerMsg) => boolean; res: (m: ServerMsg) => void }[] = [];
  constructor(id: string, token?: string) {
    this.ws = new WebSocket(`${base.replace('http', 'ws')}/ws?game=${id}${token ? `&token=${token}` : ''}`);
    this.ws.on('message', d => { const m = JSON.parse(String(d)) as ServerMsg; this.msgs.push(m); this.waiters = this.waiters.filter(w => (w.pred(m) ? (w.res(m), false) : true)); });
    this.ws.on('close', code => { this.closed = code; });
    this.ws.on('error', () => {});
  }
  open() { return new Promise<void>(r => (this.ws.readyState === 1 ? r() : this.ws.once('open', () => r()))); }
  next(pred: (m: ServerMsg) => boolean, ms = 3000): Promise<ServerMsg> {
    const hit = this.msgs.find(pred);
    if (hit) { this.msgs.splice(this.msgs.indexOf(hit), 1); return Promise.resolve(hit); }
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('timeout waiting for message')), ms);
      this.waiters.push({ pred, res: m => { clearTimeout(t); this.msgs.splice(this.msgs.indexOf(m), 1); res(m); } });
    });
  }
  send(m: unknown) { this.ws.send(JSON.stringify(m)); }
  close() { this.ws.close(); }
}
type ViewMsg = Extract<ServerMsg, { type: 'view' }>;

beforeAll(async () => {
  const distDir = tmp('tc-dist-');
  writeFileSync(join(distDir, 'index.html'), '<!doctype html><title>tc</title>');
  srv = await quiet(() => startServer({ port: 0, host: '127.0.0.1', dataDir: tmp('tc-data-'), distDir, tickMs: 3_600_000, createPerWindow: 1000 }));
  base = `http://127.0.0.1:${srv.port}`;
});
afterAll(async () => {
  await srv?.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('rules overrides', () => {
  it('clamps the LIVE clock knobs (a zero/negative tick would spin the server forever)', () => {
    const r = sanitizeRules({ live: { tickMinutes: -5, ticksPerCycle: 0, orderEveryHours: 0.5, bankCap: 1e9, stepCost: 0 } }) as { live: Record<string, number> };
    expect(r.live.tickMinutes).toBe(1);
    expect(r.live.ticksPerCycle).toBe(1);
    expect(r.live.orderEveryHours).toBe(0.5);   // fractional on purpose: not rounded
    expect(r.live.bankCap).toBe(50);
    expect(r.live.stepCost).toBe(1);
  });
});

describe('spectators of a running LIVE game', () => {
  it("see nobody's bank, queue or earning timer, nor battles in progress or rivals' influence targets", () => {
    const store = quiet(() => new Store(tmp('tc-store-')));
    const g = store.create({ seats: [{ kind: 'human' }, { kind: 'human' }, { kind: 'ai' }], seed: 3, mode: 'live' });
    store.join(g, 0, 'A');
    store.liveOrder(g, 0, { type: 'fortify', fleet: g.state.fleets.find(f => f.owner === 0)!.id });
    g.state.engagements = [{ id: 1, region: 3, name: 'Battle', startedTurn: 1, startedPulse: 1, rounds: 1, forceAt: 9, startHp: {}, fleets: [], owners: [0, 1], hulls: {}, cmds: {}, losses: {}, lastStand: [], firstBlood: false, garrisonStart: 0 }];
    g.state.turnStats.influenced = ['0:4'];
    g.state.turnStats.kills = [3, 0, 0];
    g.state.chronicle.push({ turn: 1, region: 3, players: [0, 1], text: 'The Battle of X ends: 4 ships destroyed. P held the field.' });
    const v = store.view(g, null).state;
    expect(v.live!.bank.every(b => b === -1)).toBe(true);
    expect(v.live!.queue).toEqual({});
    expect(v.live!.nextOrderAt.every(t => t === 0)).toBe(true);
    expect(v.engagements).toEqual([]);
    expect(v.turnStats.influenced).toEqual([]);
    expect(v.turnStats.kills).toEqual([0, 0, 0]);
    expect(v.chronicle.some(c => c.text.includes('ships destroyed'))).toBe(false);
  });
});

describe('LIVE games on the server', () => {
  it('backs off after a failing tick instead of retrying (and alerting everyone) on every timer call', () => {
    const store = quiet(() => new Store(tmp('tc-store-')));
    const g = store.create({ seats: [{ kind: 'human' }, { kind: 'human' }, { kind: 'human' }], seed: 3, mode: 'live' });
    let errors = 0;
    store.onResolveError = () => { errors++; };
    const good = g.state;
    g.state = { ...good, fleets: null as never };   // a sim bug: the resolver throws
    const due = good.live!.startedAt + tickMs(good) * 3 + 1;
    expect(store.advanceLive(g, due)).toBe(false);
    expect(store.advanceLive(g, due + 2000)).toBe(false);
    expect(errors).toBe(1);
    g.state = good;                                   // fixed: after the backoff it catches up
    expect(store.advanceLive(g, due + 10 * 60_000)).toBe(true);
    expect(g.state.live!.tick).toBeGreaterThan(0);
  });

  it('loads LIVE saves that predate newer fields (free actions, engagements) and plays on', () => {
    const dir = tmp('tc-old-');
    const s = makeLive(createGame({ seed: 4, players: [{ kind: 'human' }, { kind: 'human' }, { kind: 'human' }] }), Date.now(), 1);
    const raw = JSON.parse(JSON.stringify(s));
    delete raw.live.free; delete raw.live.nextOrderAt; delete raw.engagements;
    const id = 'abcdef0123';
    writeFileSync(join(dir, `${id}.json`), JSON.stringify({ id, name: 'old', createdAt: 0, seats: [0, 1, 2].map(() => ({ name: 'x', kind: 'human', aiLevel: 'standard', token: null })), state: raw, pending: {}, deadlineHours: 0, deadline: null }));
    const store = quiet(() => new Store(dir));
    const g = store.games.get(id)!;
    expect(g).toBeTruthy();
    store.liveFree(g, 0, { type: 'rename', fleet: g.state.fleets.find(f => f.owner === 0)!.id, name: 'Old Guard' });
    expect(g.state.live!.free[0]).toHaveLength(1);
    expect(g.state.live!.nextOrderAt.every(Number.isFinite)).toBe(true);
    expect(store.advanceLive(g, g.state.live!.startedAt + tickMs(g.state) * 2 + 1)).toBe(true);
    expect(g.state.fleets.some(f => f.name === 'Old Guard')).toBe(true);
  });

  it('a free action that would fail is refused with a reason', async () => {
    const { id, toks } = await newLiveGame();
    const a = new Client(id, toks[0]);
    await a.open();
    await a.next(m => m.type === 'view');
    a.send({ type: 'liveFree', action: { type: 'research', tech: 'batteries' } });   // tier II without tier I
    const e = await a.next(m => m.type === 'error') as Extract<ServerMsg, { type: 'error' }>;
    expect(e.error).toMatch(/needs a tier I/);
    a.close();
  });

  it('when an order triggers catch-up ticks, every player gets the new world (not only the sender)', async () => {
    const { id, toks } = await newLiveGame();
    const a = new Client(id, toks[0]); const b = new Client(id, toks[1]);
    await Promise.all([a.open(), b.open()]);
    const v0 = await a.next(m => m.type === 'view') as ViewMsg;
    await b.next(m => m.type === 'view');
    const g = srv.store.games.get(id)!;
    g.state.live!.startedAt -= tickMs(g.state) * 3;   // three ticks are now overdue (the timer runs hourly in tests)
    a.send({ type: 'liveOrder', order: { type: 'fortify', fleet: v0.view.state.fleets.find(f => f.owner === 0)!.id } });
    const vb = await b.next(m => m.type === 'view' && m.view.state.live!.tick >= 3) as ViewMsg;
    expect(vb.view.state.live!.bank[0]).toBe(-1);
    // and a second tab of the sender's seat sees the queued order too
    const a2 = new Client(id, toks[0]);
    await a2.open();
    await a2.next(m => m.type === 'view');
    a.send({ type: 'liveCancel', index: 0 });
    const va2 = await a2.next(m => m.type === 'view' && (m.view.state.live!.queue[0] ?? []).length === 0) as ViewMsg;
    expect(va2.view.you).toBe(0);
    // history can address a single tick of a cycle
    a.send({ type: 'history', turn: 1, tick: 2 });
    const h = await a.next(m => m.type === 'history') as Extract<ServerMsg, { type: 'history' }>;
    expect(h.result?.tick).toBe(2);
    a.close(); b.close(); a2.close();
  });

  it('caps open game sockets per client address', async () => {
    const { id } = await newLiveGame();
    const cs = Array.from({ length: 65 }, () => new Client(id));
    for (let i = 0; i < 100 && !cs.some(c => c.closed === 4429); i++) await new Promise(r => setTimeout(r, 50));
    expect(cs.filter(c => c.closed === 4429).length).toBeGreaterThanOrEqual(1);
    for (const c of cs) c.close();
  });
});
