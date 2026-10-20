// Three Crowns server: REST lobby + WebSocket game channel, serving the built client.
//   npm run server             (API + WS on :8787; use `npm run dev` for the client with hot reload)
//   npm run build && npm start (everything on one port)
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { Store, type StoredGame } from './store.ts';
import type { ClientMsg, CreateGameReq, ServerMsg } from '../shared/protocol.ts';
import { filterHistoryFor } from './history.ts';

const PORT = Number(process.env.PORT ?? 8787);
const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const store = new Store(process.env.DATA_DIR ?? join(ROOT, 'data', 'games'));

// ------------------------------------------------------------------ sockets
interface Conn { ws: WebSocket; game: string; seat: number | null }
const conns = new Set<Conn>();
const onlineSeats = (id: string) => new Set([...conns].filter(c => c.game === id && c.seat !== null).map(c => c.seat!));

function send(c: Conn, m: ServerMsg) { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(m)); }

function pushView(g: StoredGame, only?: Conn) {
  const meta = store.meta(g, onlineSeats(g.id));
  for (const c of conns) {
    if (c.game !== g.id || (only && c !== only)) continue;
    send(c, {
      type: 'view', meta, view: store.view(g, c.seat),
      mySubmission: c.seat !== null ? g.pending[c.seat] ?? null : null,
      chat: g.chat.filter(m => m.to === null || m.to === c.seat || m.seat === c.seat).slice(-200),
    });
  }
}
function pushMeta(g: StoredGame) {
  const meta = store.meta(g, onlineSeats(g.id));
  for (const c of conns) if (c.game === g.id) send(c, { type: 'meta', meta });
}

// ------------------------------------------------------------------ http
async function body(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) { size += c.length; if (size > 1_000_000) throw new Error('body too large'); chunks.push(c as Buffer); }
  const t = Buffer.concat(chunks).toString('utf8');
  return t ? JSON.parse(t) : {};
}
function json(res: ServerResponse, code: number, data: unknown) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://x');
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'api') {
      // GET /api/games
      if (req.method === 'GET' && parts[1] === 'games' && parts.length === 2) return json(res, 200, store.list(onlineSeats));
      // POST /api/games
      if (req.method === 'POST' && parts[1] === 'games' && parts.length === 2) {
        const b = (await body(req)) as CreateGameReq;
        const g = store.create(b);
        return json(res, 200, { id: g.id, meta: store.meta(g, new Set()) });
      }
      const g = parts[1] === 'games' && parts[2] ? store.games.get(parts[2]) : undefined;
      if (!g) return json(res, 404, { error: 'no such game' });
      // GET /api/games/:id
      if (req.method === 'GET' && parts.length === 3) return json(res, 200, store.meta(g, onlineSeats(g.id)));
      // POST /api/games/:id/join {seat, name}
      if (req.method === 'POST' && parts[3] === 'join') {
        const b = await body(req);
        try {
          const token = store.join(g, Number(b.seat), b.name);
          pushMeta(g);
          return json(res, 200, { token, seat: Number(b.seat) });
        } catch (e: any) { return json(res, 409, { error: e.message }); }
      }
      // GET /api/games/:id/view?token=  (REST fallback / bots)
      if (req.method === 'GET' && parts[3] === 'view') {
        const seat = store.seatFor(g, url.searchParams.get('token'));
        return json(res, 200, { meta: store.meta(g, onlineSeats(g.id)), view: store.view(g, seat), mySubmission: seat !== null ? g.pending[seat] ?? null : null });
      }
      // POST /api/games/:id/orders {token, submission}  (REST fallback / bots)
      if (req.method === 'POST' && parts[3] === 'orders') {
        const b = await body(req);
        const seat = store.seatFor(g, b.token);
        if (seat === null) return json(res, 403, { error: 'bad token' });
        const resolved = store.submit(g, seat, b.submission);
        if (resolved) pushView(g); else pushMeta(g);
        return json(res, 200, { ok: true, resolved, turn: g.state.turn });
      }
      return json(res, 404, { error: 'not found' });
    }
    // static files (production build)
    let p = normalize(join(DIST, url.pathname));
    if (!p.startsWith(DIST)) { res.writeHead(403); return res.end(); }
    if (!existsSync(p) || statSync(p).isDirectory()) p = join(DIST, 'index.html');
    if (!existsSync(p)) { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('Three Crowns server is running. Build the client with `npm run build`, or use `npm run dev` for development.'); }
    res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e: any) {
    console.error(e);
    json(res, 500, { error: String(e?.message ?? e) });
  }
});

// ------------------------------------------------------------------ websocket
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws, req) => {
  const url = new URL(req.url ?? '/', 'http://x');
  const g = store.games.get(url.searchParams.get('game') ?? '');
  if (!g) { ws.send(JSON.stringify({ type: 'error', error: 'no such game' })); ws.close(); return; }
  const c: Conn = { ws, game: g.id, seat: store.seatFor(g, url.searchParams.get('token')) };
  conns.add(c);
  pushView(g, c);
  pushMeta(g);
  ws.on('message', raw => {
    let m: ClientMsg;
    try { m = JSON.parse(String(raw)); } catch { return; }
    const game = store.games.get(c.game);
    if (!game) return;
    try {
      switch (m.type) {
        case 'submit': {
          if (c.seat === null) return send(c, { type: 'error', error: 'spectators cannot submit' });
          const resolved = store.submit(game, c.seat, m.submission);
          if (resolved) pushView(game); else { pushMeta(game); pushView(game, c); }
          break;
        }
        case 'unsubmit':
          if (c.seat === null) return;
          store.unsubmit(game, c.seat);
          pushMeta(game); pushView(game, c);
          break;
        case 'chat': {
          const text = String(m.text ?? '').slice(0, 500).trim();
          if (!text) return;
          const msg = { at: Date.now(), seat: c.seat, to: m.to === null || m.to === undefined ? null : Number(m.to), text };
          game.chat.push(msg);
          if (game.chat.length > 1000) game.chat.splice(0, game.chat.length - 1000);
          store.save(game);
          for (const o of conns) if (o.game === game.id && (msg.to === null || o.seat === msg.to || o.seat === msg.seat)) send(o, { type: 'chat', msg });
          break;
        }
        case 'history': {
          const r = game.history.find(h => h.turn === m.turn) ?? null;
          send(c, { type: 'history', turn: m.turn, result: r ? filterHistoryFor(game, r, c.seat) : null });
          break;
        }
        case 'ping': break;
      }
    } catch (e: any) { send(c, { type: 'error', error: String(e?.message ?? e) }); }
  });
  ws.on('close', () => { conns.delete(c); const game = store.games.get(c.game); if (game) pushMeta(game); });
});

setInterval(() => {
  for (const id of store.tick()) { const g = store.games.get(id); if (g) pushView(g); }
}, 15_000);

server.listen(PORT, () => console.log(`[three-crowns] listening on http://localhost:${PORT}`));
