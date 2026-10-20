// Server hardening tests: spin the real server up on a random port with a temp DATA_DIR.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import WebSocket from 'ws';
import { startServer, type RunningServer } from '../server/index.ts';
import type { ServerMsg } from '../shared/protocol.ts';

let srv: RunningServer;
let base: string;
let dataDir: string;
let distDir: string;

const post = (p: string, body: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
  fetch(base + p, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

async function newGame(extra: Record<string, unknown> = {}) {
  const r = await post('/api/games', { name: 't', seats: [{ kind: 'human' }, { kind: 'human' }, { kind: 'human' }], seed: 7, ...extra });
  expect(r.status).toBe(200);
  const { id } = await r.json();
  const toks: string[] = [];
  for (let i = 0; i < 3; i++) {
    const j = await (await post(`/api/games/${id}/join`, { seat: i, name: `P${i}` })).json();
    toks.push(j.token);
  }
  return { id: id as string, toks };
}

/** Raw GET that doesn't normalise `..` like fetch/URL do. */
function rawGet(path: string): Promise<{ status: number; body: string }> {
  return new Promise((res, rej) => {
    const req = request({ host: '127.0.0.1', port: srv.port, path, method: 'GET' }, r => {
      let b = ''; r.on('data', c => (b += c)); r.on('end', () => res({ status: r.statusCode ?? 0, body: b }));
    });
    req.on('error', rej); req.end();
  });
}

class Client {
  ws: WebSocket;
  msgs: ServerMsg[] = [];
  private waiters: { pred: (m: ServerMsg) => boolean; res: (m: ServerMsg) => void }[] = [];
  constructor(id: string, token?: string) {
    this.ws = new WebSocket(`${base.replace('http', 'ws')}/ws?game=${id}${token ? `&token=${token}` : ''}`);
    this.ws.on('message', d => {
      const m = JSON.parse(String(d)) as ServerMsg;
      this.msgs.push(m);
      this.waiters = this.waiters.filter(w => (w.pred(m) ? (w.res(m), false) : true));
    });
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
  send(m: unknown) { this.ws.send(typeof m === 'string' ? m : JSON.stringify(m)); }
  close() { this.ws.close(); }
}
const empty = { orders: [null, null, null, null, null], free: [] };

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'tc-data-'));
  distDir = mkdtempSync(join(tmpdir(), 'tc-dist-'));
  writeFileSync(join(distDir, 'index.html'), '<!doctype html><title>tc</title>');
  writeFileSync(join(dataDir, 'deadbeef00.json'), '{ this is not json');
  writeFileSync(join(dataDir, 'cafebabe00.json'), JSON.stringify({ id: '../../evil', seats: [], state: {} }));
  srv = await startServer({ port: 0, host: '127.0.0.1', dataDir, distDir, tickMs: 3_600_000, createPerWindow: 1000 });
  base = `http://127.0.0.1:${srv.port}`;
});
afterAll(async () => {
  await srv?.close();
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(distDir, { recursive: true, force: true });
});

describe('persistence', () => {
  it('quarantines corrupt / invalid game files at load instead of crashing', () => {
    const files = readdirSync(dataDir);
    expect(files.some(f => f.startsWith('deadbeef00.json.corrupt'))).toBe(true);
    expect(files.some(f => f.startsWith('cafebabe00.json.corrupt'))).toBe(true);
    expect(srv.store.games.size).toBe(0);
  });
  it('never stores seat tokens in plaintext', async () => {
    const { id, toks } = await newGame();
    const disk = readFileSync(join(dataDir, `${id}.json`), 'utf8');
    for (const t of toks) expect(disk).not.toContain(t);
    const list = await (await fetch(`${base}/api/games`)).text();
    for (const t of toks) expect(list).not.toContain(t);
    expect(list).not.toContain('"token"');
  });
});

describe('REST input validation', () => {
  it('rejects non-JSON content types, malformed JSON, non-object bodies and huge bodies', async () => {
    expect((await post('/api/games', '{}', { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await post('/api/games', '{"seats":')).status).toBe(400);
    expect((await post('/api/games', '[1,2]')).status).toBe(400);
    expect((await post('/api/games', 'null')).status).toBe(400);
    expect((await post('/api/games', JSON.stringify({ name: 'x'.repeat(400_000) }))).status).toBe(413);
    expect((await post('/api/games', { seats: 5 })).status).toBe(400);
  });

  it('sanitizes rules overrides: no prototype pollution, types enforced, work-bounding knobs clamped', async () => {
    const raw = '{"seats":[{"kind":"human","aiLevel":"godlike"}],"deadlineHours":1e308,"rules":{"__proto__":{"polluted":1},' +
      '"constructor":{"prototype":{"polluted":2}},"orders":{"perTurn":1e9,"__proto__":{"x":1}},"map":{"regionsPerWedge":"abc"},' +
      '"victory":{"turnLimit":NaN}}}';
    expect((await post('/api/games', raw)).status).toBe(400);   // NaN isn't JSON
    const r = await post('/api/games', raw.replace('NaN', '99999'));
    expect(r.status).toBe(200);
    const { id } = await r.json();
    const g = srv.store.games.get(id)!;
    const rules = g.state.rules as any;
    expect(({} as any).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(rules)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(rules.orders)).toBe(Object.prototype);
    expect(rules.polluted).toBeUndefined();
    expect(rules.orders.x).toBeUndefined();
    expect(rules.orders.perTurn).toBe(10);
    expect(rules.map.regionsPerWedge).toBe(8);
    expect(rules.victory.turnLimit).toBe(200);
    expect(g.seats[0].aiLevel).toBe('standard');
    expect(g.deadlineHours).toBeLessThanOrEqual(24 * 30);
    expect(Number.isFinite(g.deadline)).toBe(true);
  });

  it('validates join seats', async () => {
    const { id } = await (await post('/api/games', { seats: [{ kind: 'human' }] })).json();
    for (const seat of [-1, 3, 1.5, 'x', '__proto__', null, NaN]) {
      const r = await post(`/api/games/${id}/join`, { seat });
      expect(r.status, String(seat)).toBe(400);
    }
    expect((await post(`/api/games/${id}/join`, { seat: 1 })).status).toBe(409);   // AI seat
    const ok = await post(`/api/games/${id}/join`, { seat: 0, name: { evil: true } });
    expect(ok.status).toBe(200);
    expect((await post(`/api/games/${id}/join`, { seat: 0 })).status).toBe(409);   // taken
    expect((await fetch(`${base}/api/games/..%2f..%2fetc`)).status).toBe(404);
  });

  it('rejects bad tokens, malformed submissions and stale turns', async () => {
    const { id, toks } = await newGame();
    expect((await post(`/api/games/${id}/orders`, { token: 'nope', submission: empty })).status).toBe(403);
    expect((await post(`/api/games/${id}/orders`, { token: { $ne: 1 }, submission: empty })).status).toBe(403);
    expect((await post(`/api/games/${id}/orders`, { token: toks[0], submission: 'xyz' })).status).toBe(400);
    expect((await post(`/api/games/${id}/orders`, { token: toks[0], submission: { orders: ['a'], free: [] } })).status).toBe(400);
    expect((await post(`/api/games/${id}/orders`, { token: toks[0], submission: { orders: new Array(50).fill(null) } })).status).toBe(400);
    expect((await post(`/api/games/${id}/orders`, { token: toks[0], submission: empty, turn: 5 })).status).toBe(409);
    const r = await (await post(`/api/games/${id}/orders`, { token: toks[0], submission: empty, turn: 1 })).json();
    expect(r).toMatchObject({ ok: true, resolved: false, turn: 1 });
  });
});

describe('fog of war & privacy', () => {
  it('spectators of a running game get no omniscient view; players only see their own submission', async () => {
    const { id, toks } = await newGame();
    const spec = await (await fetch(`${base}/api/games/${id}/view`)).json();
    expect(spec.view.you).toBeNull();
    expect(spec.view.state.fleets).toEqual([]);
    expect(spec.view.state.rngState).toBe(0);
    expect(spec.view.state.edictDeck).toEqual([]);
    expect(spec.view.state.players.every((p: any) => p.res.credits === -1)).toBe(true);
    expect(spec.mySubmission).toBeNull();

    await post(`/api/games/${id}/orders`, { token: toks[0], submission: { orders: [null, null, null, null, null], free: [{ type: 'rename', fleet: 1, name: 'secret' }] } });
    const p1 = await (await fetch(`${base}/api/games/${id}/view`, { headers: { authorization: `Bearer ${toks[1]}` } })).json();
    expect(p1.view.you).toBe(1);
    expect(p1.mySubmission).toBeNull();
    expect(JSON.stringify(p1)).not.toContain('secret');
    expect(p1.view.state.fleets.some((f: any) => f.owner === 1)).toBe(true);
    const p0 = await (await fetch(`${base}/api/games/${id}/view`, { headers: { 'x-token': toks[0] } })).json();
    expect(p0.mySubmission.free[0].name).toBe('secret');
  });

  it('routes private chat only to sender and recipient; spectators cannot whisper', async () => {
    const { id, toks } = await newGame();
    const [a, b, c, s] = [new Client(id, toks[0]), new Client(id, toks[1]), new Client(id, toks[2]), new Client(id)];
    await Promise.all([a, b, c, s].map(x => x.open()));
    await Promise.all([a, b, c, s].map(x => x.next(m => m.type === 'view')));
    a.send({ type: 'chat', text: 'psst', to: 1 });
    await a.next(m => m.type === 'chat');
    await b.next(m => m.type === 'chat' && m.msg.text === 'psst');
    s.send({ type: 'chat', text: 'spy', to: 0 });
    await s.next(m => m.type === 'error' && /publicly/.test(m.error));
    a.send({ type: 'chat', text: 'bad', to: 7 });
    await a.next(m => m.type === 'error');
    a.send({ type: 'chat', text: 'hello all', to: null });
    await c.next(m => m.type === 'chat' && m.msg.text === 'hello all');
    await s.next(m => m.type === 'chat' && m.msg.text === 'hello all');
    expect(c.msgs.some(m => m.type === 'chat' && m.msg.text === 'psst')).toBe(false);
    expect(s.msgs.some(m => m.type === 'chat' && m.msg.text === 'psst')).toBe(false);
    // a fresh spectator's view doesn't include private chat either
    const s2 = new Client(id);
    const v = await s2.next(m => m.type === 'view');
    expect(v.type === 'view' && v.chat.map(x => x.text)).toEqual(['hello all']);
    for (const x of [a, b, c, s, s2]) x.close();
  });
});

describe('websocket robustness', () => {
  it('survives garbage frames and keeps serving', async () => {
    const { id, toks } = await newGame();
    const a = new Client(id, toks[0]);
    await a.open();
    await a.next(m => m.type === 'view');
    a.send('not json');
    a.send('null');
    a.send('[1,2,3]');
    a.ws.send(Buffer.from([0, 1, 2, 3]), { binary: true });
    a.send({ type: 'history', turn: 'x' });
    a.send({ type: 'submit', submission: 42 });
    a.send({ type: 'nope' });
    a.send({ type: 'chat', text: { toString: 1 } });
    await a.next(m => m.type === 'error' && m.code === 'rejected');
    a.send({ type: 'history', turn: 1 });
    const h = await a.next(m => m.type === 'history');
    expect(h).toMatchObject({ type: 'history', turn: 1, result: null });
    const bad = new Client(id, 'forged-token');
    await bad.next(m => m.type === 'error' && m.code === 'bad_token');
    bad.send({ type: 'submit', submission: empty });
    await bad.next(m => m.type === 'error' && /spectators/.test(m.error));
    const none = new Client('ffffffffff');
    await none.next(m => m.type === 'error' && m.code === 'no_game');
    a.close(); bad.close();
  });

  it('rejects oversized frames without crashing', async () => {
    const { id, toks } = await newGame();
    const a = new Client(id, toks[0]);
    await a.open();
    const closed = new Promise<number>(r => a.ws.on('close', code => r(code)));
    a.ws.send('x'.repeat(2_000_000));
    expect(await closed).toBe(1009);
    expect((await fetch(`${base}/api/games/${id}`)).status).toBe(200);
  });
});

describe('turn flow', () => {
  it('resolves when all humans submit; spectator history is filtered; finished game is locked and revealed', async () => {
    const { id, toks } = await newGame();
    const a = new Client(id, toks[0]);
    const s = new Client(id);
    await Promise.all([a.open(), s.open()]);
    a.send({ type: 'submit', submission: empty, turn: 1 });
    await a.next(m => m.type === 'view' && !!m.mySubmission);
    await post(`/api/games/${id}/orders`, { token: toks[1], submission: empty });
    const r = await (await post(`/api/games/${id}/orders`, { token: toks[2], submission: empty })).json();
    expect(r).toMatchObject({ resolved: true, turn: 2 });
    await a.next(m => m.type === 'view' && m.meta.turn === 2);
    // late submission meant for turn 1 must not land on turn 2
    a.send({ type: 'submit', submission: empty, turn: 1 });
    await a.next(m => m.type === 'error' && /stale/.test(m.error));
    s.send({ type: 'history', turn: 1 });
    const h = await s.next(m => m.type === 'history');
    expect(h.type === 'history' && h.result!.startFleets).toEqual([]);
    expect(h.type === 'history' && h.result!.battles).toEqual([]);

    // end the game
    const g = srv.store.games.get(id)!;
    g.state.winner = 0; g.state.winReason = 'test';
    expect((await post(`/api/games/${id}/orders`, { token: toks[1], submission: empty })).status).toBe(409);
    a.send({ type: 'submit', submission: empty });
    await a.next(m => m.type === 'error' && /over/.test(m.error));
    const v = await (await fetch(`${base}/api/games/${id}/view`, { headers: { 'x-token': toks[1] } })).json();
    expect(v.view.you).toBe(1);                                  // seat identity kept
    expect(v.view.state.fleets.some((f: any) => f.owner === 0)).toBe(true);   // full reveal (intended)
    const spec = await (await fetch(`${base}/api/games/${id}/view`)).json();
    expect(spec.view.state.fleets.length).toBeGreaterThan(0);
    a.close(); s.close();
  });

  it('keeps the previous state when resolution throws, and recovers', async () => {
    const { id, toks } = await newGame();
    const g = srv.store.games.get(id)!;
    await post(`/api/games/${id}/orders`, { token: toks[0], submission: empty });
    await post(`/api/games/${id}/orders`, { token: toks[1], submission: empty });
    const fleets = g.state.fleets;
    const before = JSON.stringify(g.state);
    (g.state as any).fleets = { notAnArray: true };   // simulate a sim bug during resolveTurn
    const r = await post(`/api/games/${id}/orders`, { token: toks[2], submission: empty });
    expect(r.status).toBe(200);
    expect((await r.json()).resolved).toBe(false);
    expect(g.state.turn).toBe(1);
    expect(g.resolveFailures).toBe(1);
    expect(Object.keys(g.pending).length).toBe(3);     // sealed orders are kept
    g.state.fleets = fleets;
    expect(JSON.stringify(g.state)).toBe(before);       // nothing half-applied
    const ok = await (await post(`/api/games/${id}/orders`, { token: toks[2], submission: empty })).json();
    expect(ok).toMatchObject({ resolved: true, turn: 2 });
  });

  it('deadline tick: steward plays for absent humans, counts missed turns, never ticks finished games', async () => {
    const { id, toks } = await newGame({ deadlineHours: 1 });
    await post(`/api/games/${id}/orders`, { token: toks[0], submission: empty });
    const g = srv.store.games.get(id)!;
    g.deadline = Date.now() - 1;
    expect(srv.store.tick()).toContain(id);
    expect(g.state.turn).toBe(2);
    expect(g.state.players.map(p => p.missedTurns)).toEqual([0, 1, 1]);
    expect(g.deadline! > Date.now()).toBe(true);
    g.state.winner = 1;
    g.deadline = Date.now() - 1;
    expect(srv.store.tick()).not.toContain(id);
    expect(g.state.turn).toBe(2);
  });
});

describe('static files & limits', () => {
  it('does not serve files outside dist', async () => {
    for (const p of ['/../package.json', '/%2e%2e/package.json', '/..%2fpackage.json', '/%2e%2e%2f%2e%2e%2fetc%2fpasswd', '/%00', '/%E0%A4%A']) {
      const r = await rawGet(p);
      expect(r.body, p).not.toContain('"name": "three-crowns"');
      expect(r.body, p).not.toContain('root:');
    }
    const idx = await fetch(`${base}/some/route`);
    expect(await idx.text()).toContain('<title>tc</title>');
    expect(idx.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('rate-limits game creation per client', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tc-data-'));
    const s2 = await startServer({ port: 0, host: '127.0.0.1', dataDir: dir, distDir, createPerWindow: 2 });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 4; i++) codes.push((await fetch(`http://127.0.0.1:${s2.port}/api/games`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status);
      expect(codes).toEqual([200, 200, 429, 429]);
    } finally { await s2.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
