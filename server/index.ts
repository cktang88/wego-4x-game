// Three Crowns server: REST lobby + WebSocket game channel, serving the built client.
//   npm run server             (API + WS on :8787; use `npm run dev` for the client with hot reload)
//   npm run build && npm start (everything on one port)
// Tests import `startServer` and run it on a random port with a temp DATA_DIR.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { Store, UserError, ID_RE, cleanText, MAX_CHAT, type StoredGame } from './store.ts';
import type { ClientMsg, ServerMsg } from '../shared/protocol.ts';
import { filterHistoryFor } from './history.ts';
import { isObj } from '../shared/index.ts';

const ROOT = resolve(import.meta.dirname, '..');

export interface ServerOptions {
  port?: number;               // 0 = random
  host?: string;
  dataDir?: string;
  distDir?: string;
  tickMs?: number;             // deadline check interval
  heartbeatMs?: number;        // WS liveness check interval
  maxGames?: number;           // refuse new games beyond this many stored games
  createPerWindow?: number;    // game creations allowed per IP per window
  createWindowMs?: number;
  trustProxy?: boolean;        // use X-Forwarded-For for rate limiting (only behind a trusted proxy)
}

export interface RunningServer {
  port: number;
  store: Store;
  http: Server;
  close(): Promise<void>;
}

const MAX_BODY = 256 * 1024;
const MAX_WS_PAYLOAD = 256 * 1024;
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webp': 'image/webp', '.txt': 'text/plain' };
const SEC_HEADERS = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY' };

/** Fixed-window counter keyed by e.g. IP. */
class RateLimiter {
  private hits = new Map<string, { n: number; reset: number }>();
  constructor(private max: number, private windowMs: number) {}
  take(key: string, now = Date.now()): boolean {
    let h = this.hits.get(key);
    if (!h || now >= h.reset) { h = { n: 0, reset: now + this.windowMs }; this.hits.set(key, h); }
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (now >= v.reset) this.hits.delete(k);
    return ++h.n <= this.max;
  }
}

/** Token bucket for per-connection message rates. */
class Bucket {
  private tokens: number; private last = Date.now();
  constructor(private cap: number, private perSec: number) { this.tokens = cap; }
  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.cap, this.tokens + ((now - this.last) / 1000) * this.perSec);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

class HttpError extends Error { constructor(public code: number, msg: string) { super(msg); } }

export function startServer(opts: ServerOptions = {}): Promise<RunningServer> {
  const DIST = resolve(opts.distDir ?? join(ROOT, 'dist'));
  const store = new Store(opts.dataDir ?? join(ROOT, 'data', 'games'));
  const maxGames = opts.maxGames ?? 2000;
  const createLimiter = new RateLimiter(opts.createPerWindow ?? 20, opts.createWindowMs ?? 10 * 60_000);
  const joinLimiter = new RateLimiter(60, 60_000);

  // ---------------------------------------------------------------- sockets
  interface Conn { ws: WebSocket; game: string; seat: number | null; alive: boolean; msgs: Bucket; chats: Bucket; drops: number }
  const conns = new Set<Conn>();
  const onlineSeats = (id: string) => {
    const out = new Set<number>();
    for (const c of conns) if (c.game === id && c.seat !== null) out.add(c.seat);
    return out;
  };

  function send(c: Conn, m: ServerMsg) {
    if (c.ws.readyState !== 1) return;
    try { c.ws.send(JSON.stringify(m)); } catch (e) { console.error('[ws] send failed', e); }
  }
  const chatFor = (g: StoredGame, seat: number | null) =>
    g.chat.filter(m => m.to === null || (seat !== null && (m.to === seat || m.seat === seat))).slice(-200);

  function pushView(g: StoredGame, only?: Conn) {
    const meta = store.meta(g, onlineSeats(g.id));
    // views are per seat, so compute each once
    const views = new Map<number | null, ReturnType<Store['view']>>();
    for (const c of conns) {
      if (c.game !== g.id || (only && c !== only)) continue;
      if (!views.has(c.seat)) views.set(c.seat, store.view(g, c.seat));
      send(c, {
        type: 'view', meta, view: views.get(c.seat)!,
        mySubmission: c.seat !== null ? g.pending[c.seat] ?? null : null,
        chat: chatFor(g, c.seat),
      });
    }
  }
  function pushMeta(g: StoredGame) {
    const meta = store.meta(g, onlineSeats(g.id));
    for (const c of conns) if (c.game === g.id) send(c, { type: 'meta', meta });
  }
  store.onResolveError = (g, e) => {
    console.error(`[store] resolve failed for ${g.id} (turn ${g.state.turn}); previous state kept`, e);
    for (const c of conns) if (c.game === g.id) send(c, { type: 'error', error: 'The server failed to resolve this turn; the previous state was kept. Orders are still sealed — try again or unseal and resubmit.', code: 'resolve_failed' });
  };

  // ---------------------------------------------------------------- http
  async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
    const ct = String(req.headers['content-type'] ?? '');
    // requiring JSON forces a CORS preflight for cross-site requests (blocks drive-by CSRF POSTs)
    if (!/^application\/json\b/i.test(ct)) throw new HttpError(415, 'content-type must be application/json');
    const declared = Number(req.headers['content-length']);
    if (declared > MAX_BODY) throw new HttpError(413, 'body too large');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > MAX_BODY) { req.destroy(); throw new HttpError(413, 'body too large'); }
      chunks.push(c as Buffer);
    }
    const t = Buffer.concat(chunks).toString('utf8');
    if (!t) return {};
    let v: unknown;
    try { v = JSON.parse(t); } catch { throw new HttpError(400, 'malformed JSON'); }
    if (!isObj(v)) throw new HttpError(400, 'body must be a JSON object');
    return v;
  }
  function json(res: ServerResponse, code: number, data: unknown) {
    if (res.headersSent) return;
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', ...SEC_HEADERS });
    res.end(JSON.stringify(data));
  }
  const clientIp = (req: IncomingMessage) =>
    (opts.trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '') || req.socket.remoteAddress || '?';
  const tokenFrom = (req: IncomingMessage, url: URL): string | null => {
    const auth = String(req.headers.authorization ?? '');
    if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
    const h = req.headers['x-token'];
    if (typeof h === 'string' && h) return h;
    return url.searchParams.get('token');   // legacy: avoid, query strings end up in proxy logs
  };

  function serveStatic(url: URL, res: ServerResponse): void {
    let rel: string;
    try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400, SEC_HEADERS); res.end(); return; }
    if (rel.includes('\0')) { res.writeHead(400, SEC_HEADERS); res.end(); return; }
    let p = normalize(join(DIST, rel));
    if (p !== DIST && !p.startsWith(DIST + sep)) { res.writeHead(403, SEC_HEADERS); res.end(); return; }
    if (!existsSync(p) || statSync(p).isDirectory()) p = join(DIST, 'index.html');
    if (!existsSync(p)) {
      res.writeHead(200, { 'content-type': 'text/plain', ...SEC_HEADERS });
      res.end('Three Crowns server is running. Build the client with `npm run build`, or use `npm run dev` for development.');
      return;
    }
    const immutable = p.includes(`${sep}assets${sep}`);
    res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream', 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache', ...SEC_HEADERS });
    res.end(readFileSync(p));
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://x');
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'api') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' });
      return serveStatic(url, res);
    }
    if (parts[1] !== 'games') return json(res, 404, { error: 'not found' });
    // GET /api/games
    if (parts.length === 2 && req.method === 'GET') return json(res, 200, store.list(onlineSeats));
    // POST /api/games
    if (parts.length === 2 && req.method === 'POST') {
      if (!createLimiter.take(clientIp(req))) return json(res, 429, { error: 'too many games created; try again later' });
      if (store.games.size >= maxGames) return json(res, 503, { error: 'server is full' });
      const b = await body(req);
      const g = store.create(b as never);
      return json(res, 200, { id: g.id, meta: store.meta(g, new Set()) });
    }
    const id = parts[2] ?? '';
    const g = ID_RE.test(id) ? store.games.get(id) : undefined;
    if (!g) return json(res, 404, { error: 'no such game' });
    // GET /api/games/:id
    if (req.method === 'GET' && parts.length === 3) return json(res, 200, store.meta(g, onlineSeats(g.id)));
    // POST /api/games/:id/join {seat, name}
    if (req.method === 'POST' && parts[3] === 'join' && parts.length === 4) {
      if (!joinLimiter.take(clientIp(req))) return json(res, 429, { error: 'slow down' });
      const b = await body(req);
      const seat = typeof b.seat === 'number' ? b.seat : typeof b.seat === 'string' && /^\d$/.test(b.seat) ? Number(b.seat) : NaN;
      const token = store.join(g, seat, b.name);
      pushView(g);
      return json(res, 200, { token, seat });
    }
    // GET /api/games/:id/view  (REST fallback / bots; token via Authorization: Bearer, X-Token, or ?token=)
    if (req.method === 'GET' && parts[3] === 'view' && parts.length === 4) {
      const seat = store.seatFor(g, tokenFrom(req, url));
      return json(res, 200, { meta: store.meta(g, onlineSeats(g.id)), view: store.view(g, seat), mySubmission: seat !== null ? g.pending[seat] ?? null : null });
    }
    // POST /api/games/:id/orders {token, submission, turn?}  (REST fallback / bots)
    if (req.method === 'POST' && parts[3] === 'orders' && parts.length === 4) {
      const b = await body(req);
      const seat = store.seatFor(g, b.token ?? tokenFrom(req, url));
      if (seat === null) return json(res, 403, { error: 'bad token' });
      const resolved = store.submit(g, seat, b.submission, b.turn);
      if (resolved) pushView(g); else pushMeta(g);
      return json(res, 200, { ok: true, resolved, turn: g.state.turn });
    }
    return json(res, 404, { error: 'not found' });
  }

  const http = createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      if (e instanceof HttpError) return json(res, e.code, { error: e.message });
      if (e instanceof UserError) return json(res, e.code, { error: e.message });
      console.error('[http]', e);
      json(res, 500, { error: 'internal error' });
    });
  });
  http.on('clientError', (_e, socket) => { try { socket.destroy(); } catch { /* ignore */ } });

  // ---------------------------------------------------------------- websocket
  const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: MAX_WS_PAYLOAD });
  wss.on('error', e => console.error('[wss]', e));
  wss.on('connection', (ws, req) => {
    ws.on('error', e => console.error('[ws]', e.message));   // without a listener, a bad frame would crash the process
    const url = new URL(req.url ?? '/', 'http://x');
    const gid = url.searchParams.get('game') ?? '';
    const g = ID_RE.test(gid) ? store.games.get(gid) : undefined;
    if (!g) { ws.send(JSON.stringify({ type: 'error', error: 'no such game', code: 'no_game' } satisfies ServerMsg)); ws.close(4404, 'no such game'); return; }
    const token = url.searchParams.get('token');
    const c: Conn = { ws, game: g.id, seat: store.seatFor(g, token), alive: true, msgs: new Bucket(40, 4), chats: new Bucket(5, 0.5), drops: 0 };
    conns.add(c);
    ws.on('pong', () => { c.alive = true; });
    ws.on('close', () => {
      conns.delete(c);
      const game = store.games.get(c.game);
      if (game) pushMeta(game);
    });
    if (token && c.seat === null) send(c, { type: 'error', error: 'invalid seat token; you are spectating', code: 'bad_token' });
    pushView(g, c);
    pushMeta(g);

    ws.on('message', (raw, isBinary) => {
      c.alive = true;
      if (!c.msgs.take()) {
        if (++c.drops > 200) ws.close(4429, 'rate limited');
        else if (c.drops % 20 === 1) send(c, { type: 'error', error: 'too many messages; slow down', code: 'rate_limited' });
        return;
      }
      if (isBinary) return;
      let m: ClientMsg;
      try { m = JSON.parse(String(raw)); } catch { return send(c, { type: 'error', error: 'malformed message', code: 'bad_message' }); }
      if (!isObj(m) || typeof m.type !== 'string') return send(c, { type: 'error', error: 'malformed message', code: 'bad_message' });
      const game = store.games.get(c.game);
      if (!game) return;
      try {
        switch (m.type) {
          case 'submit': {
            if (c.seat === null) return send(c, { type: 'error', error: 'spectators cannot submit', code: 'forbidden' });
            const resolved = store.submit(game, c.seat, m.submission, m.turn);
            if (resolved) pushView(game); else { pushMeta(game); pushView(game, c); }
            break;
          }
          case 'unsubmit':
            if (c.seat === null) return;
            store.unsubmit(game, c.seat);
            pushMeta(game); pushView(game, c);
            break;
          case 'chat': {
            if (!c.chats.take()) return send(c, { type: 'error', error: 'you are chatting too fast', code: 'rate_limited' });
            const text = cleanText(m.text, 500);
            if (!text) return;
            let to: number | null = null;
            if (m.to !== null && m.to !== undefined) {
              if (!Number.isInteger(m.to) || m.to < 0 || m.to > 2) return send(c, { type: 'error', error: 'bad chat recipient', code: 'bad_message' });
              if (c.seat === null) return send(c, { type: 'error', error: 'spectators can only chat publicly', code: 'forbidden' });
              to = m.to;
            }
            const msg = { at: Date.now(), seat: c.seat, to, text };
            game.chat.push(msg);
            if (game.chat.length > MAX_CHAT) game.chat.splice(0, game.chat.length - MAX_CHAT);
            store.save(game);
            for (const o of conns) {
              if (o.game !== game.id) continue;
              if (msg.to === null || (o.seat !== null && (o.seat === msg.to || o.seat === msg.seat))) send(o, { type: 'chat', msg });
            }
            break;
          }
          case 'history': {
            if (!Number.isInteger(m.turn)) return send(c, { type: 'error', error: 'bad turn', code: 'bad_message' });
            const r = game.history.find(h => h.turn === m.turn) ?? null;
            send(c, { type: 'history', turn: m.turn, result: r ? filterHistoryFor(game, r, c.seat) : null });
            break;
          }
          case 'liveOrder': case 'liveCancel': case 'liveFree': case 'liveHalt': {
            if (c.seat === null) return send(c, { type: 'error', error: 'spectators cannot give orders', code: 'forbidden' });
            store.advanceLive(game, Date.now());   // catch up first so the order lands on the right tick
            if (m.type === 'liveOrder') store.liveOrder(game, c.seat, m.order);
            else if (m.type === 'liveCancel') store.liveCancel(game, c.seat, m.index);
            else if (m.type === 'liveFree') store.liveFree(game, c.seat, m.action);
            else store.liveHalt(game, c.seat, m.fleet);
            pushView(game, c);
            break;
          }
          case 'ping': break;
          default: send(c, { type: 'error', error: 'unknown message type', code: 'bad_message' });
        }
      } catch (e) {
        if (e instanceof UserError) return send(c, { type: 'error', error: e.message, code: 'rejected' });
        console.error('[ws] handler error', e);
        send(c, { type: 'error', error: 'internal error', code: 'internal' });
      }
    });
  });

  // ---------------------------------------------------------------- timers
  const ticker = setInterval(() => {
    try {
      for (const id of store.tick()) { const g = store.games.get(id); if (g) pushView(g); }
    } catch (e) { console.error('[tick]', e); }
  }, opts.tickMs ?? 2_000);   // cheap: only due deadlines / live ticks do work
  // terminate half-open sockets so `conns` doesn't leak and "online" stays honest
  const heartbeat = setInterval(() => {
    for (const c of conns) {
      if (!c.alive) { c.ws.terminate(); conns.delete(c); continue; }
      c.alive = false;
      try { c.ws.ping(); } catch { /* ignore */ }
    }
  }, opts.heartbeatMs ?? 30_000);

  return new Promise((resolveP, rejectP) => {
    http.once('error', rejectP);
    http.listen(opts.port ?? 8787, opts.host, () => {
      http.off('error', rejectP);
      const addr = http.address();
      const port = typeof addr === 'object' && addr ? addr.port : opts.port ?? 0;
      resolveP({
        port, store, http,
        close: () => new Promise<void>(done => {
          clearInterval(ticker); clearInterval(heartbeat);
          for (const c of conns) c.ws.terminate();
          conns.clear();
          wss.close();
          http.close(() => done());
          http.closeAllConnections?.();
        }),
      });
    });
  });
}

// ------------------------------------------------------------------ CLI entry
const isMain = !!process.argv[1] && resolve(process.argv[1]) === import.meta.filename;
if (isMain) {
  process.on('uncaughtException', e => console.error('[fatal?] uncaught exception', e));
  process.on('unhandledRejection', e => console.error('[fatal?] unhandled rejection', e));
  const port = Number(process.env.PORT ?? 8787);
  startServer({ port: Number.isInteger(port) ? port : 8787, dataDir: process.env.DATA_DIR, trustProxy: process.env.TRUST_PROXY === '1' })
    .then(s => console.log(`[three-crowns] listening on http://localhost:${s.port}`))
    .catch(e => { console.error(e); process.exit(1); });
}
