// Web Push (docs/LOOPS.md §4): payloads in the Herald's voice that never say more than the seat may know,
// quiet hours, subscription validation (no SSRF), and the server sending "your turn" when a turn resolves.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGame, makeLive, viewFor } from '../shared/index.ts';
import { ensureSoul } from '../shared/sim/soul.ts';
import type { GameState } from '../shared/index.ts';
import { arrivalPayload, arrivals, cleanQuiet, cleanSubscription, inQuiet, overPayload, reminderPayload, turnPayload, type PushPayload } from '../server/push.ts';
import { startServer, type RunningServer } from '../server/index.ts';

const KEYS = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };
const game = { id: 'abc123def0', name: 'Friday War' };

/** A game at turn 10 whose last edition has a public headline and a private one seen only by houses 0 and 1. */
function withEdition(): GameState {
  const s = createGame({ seed: 51, players: [0, 1, 2].map(() => ({ kind: 'human' as const })) });
  const st = ensureSoul(s)!;
  s.turn = 10;
  st.herald.push({ turn: 9, dispatches: [], headlines: [
    { kind: 'battle', text: 'Battle of Secret Hollow: 6 ships lost', region: 5, players: [0, 1], drama: 9, public: false, seenBy: [0, 1] },
    { kind: 'capture', text: `${s.players[2].name} takes Vel from ${s.players[0].name}`, region: 6, players: [2, 0], drama: 5, public: true },
  ] });
  return s;
}

describe('push: payloads', () => {
  it('"your turn" uses only headlines the seat may read, preferring its own house, in the Herald\'s voice', () => {
    const s = withEdition();
    const p0 = turnPayload(viewFor(s, 0), game);
    expect(p0.body).toBe('Turn 10: Battle of Secret Hollow: 6 ships lost. Your seal is awaited.');
    const p2 = turnPayload(viewFor(s, 2), game);
    expect(p2.body).not.toContain('Secret Hollow');
    expect(p2.body).toMatch(/takes Vel/);
    expect(p2.kind).toBe('turn');
    expect(p2.url).toBe('/#/g/abc123def0');
    expect(p2.tag).toBe('turn:abc123def0');
    // nothing printed (or a stale edition): generic
    const quiet = createGame({ seed: 52, players: [0, 1, 2].map(() => ({ kind: 'human' as const })) });
    quiet.turn = 4;
    expect(turnPayload(viewFor(quiet, 1), game).body).toBe('Turn 4 is in. The table waits for your seal.');
  });

  it('a payload carries only its fields: no token, no state', () => {
    const s = withEdition();
    const all: PushPayload[] = [turnPayload(viewFor(s, 1), game), reminderPayload(s, [0, 2], game), overPayload({ ...s, winner: 2 }, game), arrivalPayload('Dawn Patrol', 'Vel', 9.6, game)];
    for (const p of all) {
      expect(Object.keys(p).sort()).toEqual(Object.keys(p).filter(k => ['title', 'body', 'tag', 'url', 'game', 'kind', 'turn'].includes(k)).sort());
      expect(JSON.stringify(p).length).toBeLessThan(600);
      expect(JSON.stringify(p)).not.toMatch(/token|h:[0-9a-f]{16}/);
    }
    expect(all[1].body).toBe(`${s.players[0].name} and ${s.players[2].name} have sealed. The table waits.`);
    expect(all[2].body).toBe(`The war is over: ${s.players[2].name} takes the Crown. The Saga is written.`);
    expect(all[3].body).toBe('Dawn Patrol reaches Vel in 10 min.');
  });

  it('LIVE arrivals: only the seat\'s own fleets, within the window', () => {
    const s = makeLive(createGame({ seed: 53, players: [0, 1, 2].map(() => ({ kind: 'human' as const })) }), 0, 60);
    const mine = s.fleets.find(f => f.owner === 0)!;
    const theirs = s.fleets.find(f => f.owner === 1)!;
    const dest = s.regions[mine.region].neighbors[0];
    mine.route = { path: [dest], seize: null, mp: 0 };
    theirs.route = { path: [s.regions[theirs.region].neighbors[0]], seize: null, mp: 0 };
    const a0 = arrivals(s, 0, 0, 3_600_000);
    expect(a0.map(a => a.fleet)).toEqual([mine.name]);
    expect(a0[0].dest).toBe(s.regions[dest].name);
    expect(arrivals(s, 2, 0, 3_600_000)).toEqual([]);
    expect(arrivals(s, 0, 0, 1)).toEqual([]);
  });

  it('quiet hours follow the subscriber\'s clock, across midnight', () => {
    const q = cleanQuiet({ from: 22, to: 8, tz: -120 })!;          // UTC+2
    const at = (h: number) => Date.UTC(2026, 9, 22, h, 30);       // UTC hours
    expect(inQuiet(q, at(21))).toBe(true);    // 23:30 local
    expect(inQuiet(q, at(5))).toBe(true);     // 07:30 local
    expect(inQuiet(q, at(6))).toBe(false);    // 08:30 local
    expect(inQuiet(q, at(12))).toBe(false);
    expect(inQuiet(null, at(3))).toBe(false);
    expect(cleanQuiet({ from: 5, to: 5 })).toBeNull();
    expect(cleanQuiet({ from: 25, to: 5 })).toBeNull();
  });

  it('subscriptions must point at a real push service over https (the server POSTs to them)', () => {
    expect(cleanSubscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: KEYS })).toBeTruthy();
    expect(cleanSubscription({ endpoint: 'https://web.push.apple.com/QGx', keys: KEYS })).toBeTruthy();
    expect(cleanSubscription({ endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/x', keys: KEYS })).toBeTruthy();
    for (const endpoint of ['http://fcm.googleapis.com/x', 'https://169.254.169.254/latest', 'https://localhost:8787/api', 'https://evil.example/fcm.googleapis.com', 'https://user:pw@fcm.googleapis.com/x'])
      expect(cleanSubscription({ endpoint, keys: KEYS }), endpoint).toBeNull();
    expect(cleanSubscription({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'not base64!', auth: 'x' } })).toBeNull();
  });
});

describe('push: server', () => {
  let srv: RunningServer, base: string, dataDir: string;
  const sent: { endpoint: string; payload: PushPayload }[] = [];
  let status = 201;
  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'tc-push-'));
    const log = console.log; console.log = () => {};
    try {
      srv = await startServer({ port: 0, host: '127.0.0.1', dataDir, distDir: join(dataDir, 'nodist'), tickMs: 3_600_000, createPerWindow: 1000,
        pushAnyHost: true, pushSender: async (sub, payload) => { sent.push({ endpoint: sub.endpoint, payload }); return status; } });
    } finally { console.log = log; }
    base = `http://127.0.0.1:${srv.port}`;
  });
  afterAll(async () => { await srv?.close(); rmSync(dataDir, { recursive: true, force: true }); });
  const post = async (path: string, body: unknown) => {
    const r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, json: await r.json() as any };
  };
  const settle = () => new Promise(r => setTimeout(r, 30));

  it('VAPID keys are generated once and kept private on disk', async () => {
    const r = await fetch(`${base}/api/push/key`);
    const { publicKey } = await r.json() as { publicKey: string };
    expect(publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    const f = join(dataDir, '_push', 'vapid.json');
    expect(existsSync(f)).toBe(true);
    expect(JSON.parse(readFileSync(f, 'utf8')).publicKey).toBe(publicKey);
    expect(statSync(f).mode & 0o077).toBe(0);
  });

  it('sends "your turn" to subscribed seats when a turn resolves; the last to seal gets one reminder', async () => {
    const c = await post('/api/games', { name: 'Friday War', seats: [{ kind: 'human' }, { kind: 'human' }, { kind: 'ai' }] });
    const id = c.json.id;
    const t0 = (await post(`/api/games/${id}/join`, { seat: 0, name: 'Sam' })).json.token;
    const t1 = (await post(`/api/games/${id}/join`, { seat: 1, name: 'Kith' })).json.token;
    const s0 = { endpoint: 'https://push.example/sam', keys: KEYS }, s1 = { endpoint: 'https://push.example/kith', keys: KEYS };
    // a forged token binds nothing
    const bad = await post('/api/push/subscribe', { subscription: s0, games: [{ game: id, token: 'forged' }] });
    expect(bad.json.games).toEqual([]);
    expect((await post('/api/push/subscribe', { subscription: s0, games: [{ game: id, token: t0 }] })).json.games).toEqual([id]);
    expect((await post('/api/push/subscribe', { subscription: s1, games: [{ game: id, token: t1 }], live: false })).json.games).toEqual([id]);
    const subsFile = readFileSync(join(dataDir, '_push', 'subs.json'), 'utf8');
    expect(subsFile).not.toContain(t0);
    expect(subsFile).not.toContain(t1);
    sent.length = 0;
    await post(`/api/games/${id}/orders`, { token: t0, submission: { orders: [], free: [] }, turn: 1 });
    await settle();
    expect(sent.map(x => [x.endpoint, x.payload.kind])).toEqual([['https://push.example/kith', 'reminder']]);
    expect(sent[0].payload.body).toBe('Sam has sealed. The table waits.');
    // unsealing and sealing again does not nag twice
    await post(`/api/games/${id}/orders`, { token: t0, submission: { orders: [], free: [] }, turn: 1 });
    await settle();
    expect(sent.length).toBe(1);
    sent.length = 0;
    await post(`/api/games/${id}/orders`, { token: t1, submission: { orders: [], free: [] }, turn: 1 });
    await settle();
    expect(sent.map(x => x.endpoint).sort()).toEqual(['https://push.example/kith', 'https://push.example/sam']);
    for (const x of sent) {
      expect(x.payload.kind).toBe('turn');
      expect(x.payload.body).toMatch(/^Turn 2(:| is in)/);
      expect(x.payload.body).toMatch(/Your seal is awaited\.$|The table waits for your seal\.$/);
      expect(JSON.stringify(x.payload)).not.toContain(t0);
    }
    // each seat's notification says only what its own view of the Herald says
    const g = srv.store.games.get(id)!;
    for (const x of sent) {
      const seat = x.endpoint.endsWith('sam') ? 0 : 1;
      expect(x.payload).toEqual(turnPayload(srv.store.view(g, seat), g));
    }
  });

  it('quiet hours hold a notification until they end; a gone subscription is dropped', async () => {
    const c = await post('/api/games', { seats: [{ kind: 'human' }, { kind: 'ai' }, { kind: 'ai' }] });
    const id = c.json.id;
    const tk = (await post(`/api/games/${id}/join`, { seat: 0, name: 'Wren' })).json.token;
    const sub = { endpoint: 'https://push.example/wren', keys: KEYS };
    const nowH = new Date().getUTCHours();
    // quiet all day except the next two hours after this one (UTC)
    await post('/api/push/subscribe', { subscription: sub, games: [{ game: id, token: tk }], quiet: { from: (nowH + 3) % 24, to: (nowH + 1) % 24, tz: 0 } });
    sent.length = 0;
    await post(`/api/games/${id}/orders`, { token: tk, submission: { orders: [], free: [] }, turn: 1 });
    await settle();
    expect(sent).toEqual([]);
    const ps = srv.push!.subs.get(Object.keys(Object.fromEntries(srv.push!.subs)).find(k => srv.push!.subs.get(k)!.endpoint === sub.endpoint)!)!;
    expect(ps.held.map(h => h.kind)).toEqual(['turn']);
    expect(await srv.push!.flush(Date.now())).toBe(0);                     // still quiet
    expect(await srv.push!.flush(Date.now() + 3600_000 * 1.5)).toBe(1);    // the free hour
    expect(sent.map(x => x.endpoint)).toEqual([sub.endpoint]);
    // the push service says the subscription is gone: forget it
    status = 410;
    await srv.push!.notifySeat(id, 0, overPayload(srv.store.games.get(id)!.state, { id, name: 'x' }), Date.now() + 3600_000 * 1.5);
    status = 201;
    expect([...srv.push!.subs.values()].some(s => s.endpoint === sub.endpoint)).toBe(false);
  });

  it('settings and unsubscribe; bad subscriptions are refused', async () => {
    const sub = { endpoint: 'https://push.example/settings', keys: KEYS };
    await post('/api/push/subscribe', { subscription: sub, games: [] });
    expect((await post('/api/push/settings', { endpoint: sub.endpoint, quiet: { from: 23, to: 7, tz: 60 }, live: false })).status).toBe(200);
    const s = [...srv.push!.subs.values()].find(x => x.endpoint === sub.endpoint)!;
    expect(s.quiet).toEqual({ from: 23, to: 7, tz: 60 });
    expect(s.live).toBe(false);
    expect((await post('/api/push/unsubscribe', { endpoint: sub.endpoint })).status).toBe(200);
    expect((await post('/api/push/settings', { endpoint: sub.endpoint, live: true })).status).toBe(404);
    expect((await post('/api/push/subscribe', { subscription: { endpoint: 'http://push.example/x', keys: KEYS }, games: [] })).status).toBe(400);
  });
});
