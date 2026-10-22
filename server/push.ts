// Web Push: "your turn" notifications that arrive with the tab closed (docs/LOOPS.md §4).
// VAPID keys are generated on first start and kept in data/push/vapid.json; subscriptions in data/push/subs.json.
// A subscription is bound to (game, seat) pairs proven with seat tokens at subscribe time; tokens are never stored.
// Payloads are written in the Herald's voice from the seat's own fogged view (or public facts), never more.
import { createHash } from 'node:crypto';
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import webpush from 'web-push';
import { etaTicks, nextTickAt, tickMs, type GameState, type PlayerView } from '../shared/index.ts';

export interface PushPayload {
  title: string;
  body: string;
  /** Notifications with the same tag replace each other (one per game and kind). */
  tag: string;
  /** Where a click goes: the game's page. */
  url: string;
  game: string;
  kind: 'turn' | 'reminder' | 'arrival' | 'over' | 'test';
  turn?: number;
}
export interface PushKeys { p256dh: string; auth: string }
export interface QuietHours { from: number; to: number; /** Date#getTimezoneOffset() of the subscriber, minutes. */ tz: number }
export interface PushSub {
  id: string;
  endpoint: string;
  keys: PushKeys;
  seats: { game: string; seat: number }[];
  quiet: QuietHours | null;
  /** LIVE alerts (fleet arrivals). */
  live: boolean;
  createdAt: number;
  /** Held during quiet hours, sent when they end (latest per tag). */
  held: PushPayload[];
}
/** Sends one push; resolves to the push service's HTTP status. Tests inject a fake. */
export type PushSender = (sub: { endpoint: string; keys: PushKeys }, payload: PushPayload, vapid: Vapid) => Promise<number>;
export interface Vapid { publicKey: string; privateKey: string; subject: string }

/** Push services browsers use. The server POSTs to a subscription's endpoint, so endpoints elsewhere are refused (SSRF). */
const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];
const B64URL = /^[A-Za-z0-9_-]+=*$/;
const MAX_SUBS = 5000;
const MAX_SEATS_PER_SUB = 64;

const clip = (t: string, n: number) => (t.length <= n ? t : `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…`);
const strip = (t: string) => t.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[.!?…:;,]+$/, '');
const T = (s: GameState) => (s.mode === 'live' ? 'Cycle' : 'Turn');
const gameUrl = (id: string) => `/#/g/${encodeURIComponent(id)}`;

// ------------------------------------------------------------------ payloads (pure)
/**
 * "Your turn": the latest Herald headline this seat may read (its view is already fogged), preferring one about its
 * own house, then "Your seal is awaited." Nothing else from the state.
 */
export function turnPayload(view: PlayerView, game: { id: string; name: string }): PushPayload {
  const s = view.state, me = view.you;
  const ed = s.soul?.herald?.[s.soul.herald.length - 1];
  const hs = (ed && ed.turn === s.turn - 1 ? ed.headlines : []).filter(h => h.kind !== 'quiet');
  const pickH = hs.find(h => me !== null && h.players.includes(me)) ?? hs[0];
  const line = pickH ? strip(pickH.text) : '';
  const special = ed?.special && ed.turn === s.turn - 1 ? ed.special.title : '';
  const body = line ? `${T(s)} ${s.turn}: ${clip(line, 110)}. Your seal is awaited.` : `${T(s)} ${s.turn} is in. The table waits for your seal.`;
  return { title: special ? `The Herald, special edition: ${special}` : `The Herald · ${clip(game.name, 40)}`, body, tag: `turn:${game.id}`, url: gameUrl(game.id), game: game.id, kind: 'turn', turn: s.turn };
}

/** The last seat to seal: who has sealed is public (every crest shows it). */
export function reminderPayload(s: GameState, sealed: number[], game: { id: string; name: string }): PushPayload {
  const names = sealed.map(i => s.players[i]?.name).filter(Boolean) as string[];
  const who = names.length === 1 ? `${names[0]} has` : names.length ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} have` : 'The others have';
  return { title: `The Herald · ${clip(game.name, 40)}`, body: `${who} sealed. The table waits.`, tag: `turn:${game.id}`, url: gameUrl(game.id), game: game.id, kind: 'reminder', turn: s.turn };
}

/** The war is over (public). */
export function overPayload(s: GameState, game: { id: string; name: string }): PushPayload {
  const w = s.winner !== null ? s.players[s.winner]?.name : null;
  return { title: `The Herald · ${clip(game.name, 40)}`, body: w ? `The war is over: ${w} takes the Crown. The Saga is written.` : 'The war is over. The Saga is written.', tag: `turn:${game.id}`, url: gameUrl(game.id), game: game.id, kind: 'over', turn: s.turn };
}

/** LIVE: one of your own fleets is about to arrive (your own route: you know it). */
export function arrivalPayload(fleet: string, dest: string, minutes: number, game: { id: string; name: string }): PushPayload {
  const m = Math.max(1, Math.round(minutes));
  return { title: `The Herald · ${clip(game.name, 40)}`, body: `${clip(strip(fleet), 50)} reaches ${clip(strip(dest), 40)} in ${m} min.`, tag: `arrive:${game.id}:${clip(fleet, 40)}`, url: gameUrl(game.id), game: game.id, kind: 'arrival' };
}

/** Own fleets of `seat` arriving within `withinMs` (LIVE). Keys identify an arrival so it is announced once. */
export function arrivals(s: GameState, seat: number, now: number, withinMs: number): { key: string; fleet: string; dest: string; ms: number }[] {
  if (!s.live || s.winner !== null) return [];
  const out: { key: string; fleet: string; dest: string; ms: number }[] = [];
  const next = nextTickAt(s), step = tickMs(s);
  for (const f of s.fleets) {
    if (f.owner !== seat || !f.route?.path.length || !f.ships.length) continue;
    const eta = etaTicks(s, f.id);
    if (eta === null) continue;
    const at = next + (eta - 1) * step;
    const ms = at - now;
    const destId = f.route.path[f.route.path.length - 1];
    if (ms > 0 && ms <= withinMs) out.push({ key: `${f.id}:${destId}`, fleet: f.name, dest: s.regions[destId]?.name ?? 'its destination', ms });
  }
  return out;
}

/** Is it quiet time for this subscriber? */
export function inQuiet(q: QuietHours | null, now: number): boolean {
  if (!q || q.from === q.to) return false;
  const utcMin = Math.floor(now / 60000) % 1440;
  const local = ((utcMin - q.tz) % 1440 + 1440) % 1440;
  const h = local / 60;
  return q.from < q.to ? h >= q.from && h < q.to : h >= q.from || h < q.to;
}

export function cleanQuiet(x: unknown): QuietHours | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const hr = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 23 ? v : null);
  const from = hr(o.from), to = hr(o.to);
  const tz = typeof o.tz === 'number' && Number.isFinite(o.tz) && Math.abs(o.tz) <= 14 * 60 ? Math.round(o.tz) : 0;
  return from === null || to === null || from === to ? null : { from, to, tz };
}

/** A browser PushSubscription (toJSON()) as sent by the client, validated. */
export function cleanSubscription(x: unknown, anyHost = false): { endpoint: string; keys: PushKeys } | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof o.endpoint !== 'string' || o.endpoint.length > 1024) return null;
  let u: URL;
  try { u = new URL(o.endpoint); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  if (!anyHost && !PUSH_HOSTS.some(h => u.hostname === h || u.hostname.endsWith(`.${h}`))) return null;
  const k = o.keys;
  const key = (v: unknown, max: number) => (typeof v === 'string' && v.length >= 8 && v.length <= max && B64URL.test(v) ? v : null);
  const p256dh = key(k?.p256dh, 200), auth = key(k?.auth, 60);
  if (!p256dh || !auth) return null;
  return { endpoint: o.endpoint, keys: { p256dh, auth } };
}

// ------------------------------------------------------------------ the service
const defaultSender: PushSender = async (sub, payload, vapid) => {
  try {
    const r = await webpush.sendNotification(sub, JSON.stringify(payload), {
      vapidDetails: vapid, TTL: 12 * 3600, urgency: payload.kind === 'arrival' ? 'high' : 'normal',
      // one pending notification per game and kind at the push service (a newer turn replaces an older one)
      topic: createHash('sha256').update(payload.tag).digest('base64url').slice(0, 32),
    });
    return r.statusCode;
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    if (typeof code === 'number') return code;
    throw e;
  }
};

export interface PushOptions { sender?: PushSender; subject?: string; anyHost?: boolean }

export class PushService {
  subs = new Map<string, PushSub>();
  vapid: Vapid;
  private sender: PushSender;
  private anyHost: boolean;
  /** LIVE arrivals already announced, per game. */
  private alerted = new Map<string, Set<string>>();

  constructor(private dir: string, opts: PushOptions = {}) {
    mkdirSync(dir, { recursive: true });
    this.sender = opts.sender ?? defaultSender;
    this.anyHost = !!opts.anyHost;
    const subject = opts.subject ?? process.env.VAPID_SUBJECT ?? 'https://three-crowns.invalid';
    const vf = join(dir, 'vapid.json');
    let v: Vapid | null = null;
    try {
      if (existsSync(vf)) {
        const raw = JSON.parse(readFileSync(vf, 'utf8'));
        if (typeof raw.publicKey === 'string' && typeof raw.privateKey === 'string') v = { publicKey: raw.publicKey, privateKey: raw.privateKey, subject };
      }
    } catch (e) { console.error('[push] could not read VAPID keys; generating new ones', (e as Error).message); }
    if (!v) {
      const k = webpush.generateVAPIDKeys();
      v = { publicKey: k.publicKey, privateKey: k.privateKey, subject };
      this.write(vf, JSON.stringify({ publicKey: v.publicKey, privateKey: v.privateKey, createdAt: new Date().toISOString() }));
      try { chmodSync(vf, 0o600); } catch { /* best effort */ }
    }
    this.vapid = v;
    try {
      const sf = join(dir, 'subs.json');
      if (existsSync(sf)) for (const s of JSON.parse(readFileSync(sf, 'utf8')) as PushSub[]) if (s?.id && s.endpoint && s.keys) this.subs.set(s.id, { ...s, held: s.held ?? [], seats: s.seats ?? [] });
    } catch (e) { console.error('[push] could not read subscriptions', (e as Error).message); }
  }

  private write(p: string, data: string) {
    const tmp = `${p}.${process.pid}.tmp`;
    const fd = openSync(tmp, 'w', 0o600);
    try { writeSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp, p);
  }
  save() { this.write(join(this.dir, 'subs.json'), JSON.stringify([...this.subs.values()])); }

  static idOf(endpoint: string) { return createHash('sha256').update(endpoint).digest('hex').slice(0, 24); }
  get publicKey() { return this.vapid.publicKey; }

  /** Create or update a subscription; `seats` replaces its bindings. Returns null for a bad subscription. */
  subscribe(raw: unknown, seats: { game: string; seat: number }[], settings: { quiet?: unknown; live?: unknown }): PushSub | null {
    const sub = cleanSubscription(raw, this.anyHost);
    if (!sub) return null;
    const id = PushService.idOf(sub.endpoint);
    if (!this.subs.has(id) && this.subs.size >= MAX_SUBS) return null;
    const old = this.subs.get(id);
    const uniq = [...new Map(seats.map(x => [`${x.game}:${x.seat}`, x])).values()].slice(-MAX_SEATS_PER_SUB);
    const s: PushSub = { id, endpoint: sub.endpoint, keys: sub.keys, seats: uniq, quiet: settings.quiet !== undefined ? cleanQuiet(settings.quiet) : old?.quiet ?? null,
      live: settings.live !== undefined ? settings.live !== false : old?.live ?? true, createdAt: old?.createdAt ?? Date.now(), held: old?.held ?? [] };
    this.subs.set(id, s);
    this.save();
    return s;
  }
  settings(endpoint: unknown, settings: { quiet?: unknown; live?: unknown }): boolean {
    const s = typeof endpoint === 'string' ? this.subs.get(PushService.idOf(endpoint)) : undefined;
    if (!s) return false;
    if (settings.quiet !== undefined) s.quiet = cleanQuiet(settings.quiet);
    if (settings.live !== undefined) s.live = settings.live !== false;
    this.save();
    return true;
  }
  unsubscribe(endpoint: unknown): boolean {
    const id = typeof endpoint === 'string' ? PushService.idOf(endpoint) : '';
    const had = this.subs.delete(id);
    if (had) this.save();
    return had;
  }
  forSeat(game: string, seat: number): PushSub[] {
    return [...this.subs.values()].filter(s => s.seats.some(x => x.game === game && x.seat === seat));
  }
  hasGame(game: string): boolean {
    for (const s of this.subs.values()) if (s.seats.some(x => x.game === game)) return true;
    return false;
  }

  /** Send (or hold for quiet hours) to every subscription of a seat. Never throws. Resolves to the number sent. */
  async notifySeat(game: string, seat: number, payload: PushPayload, now = Date.now(), filter?: (s: PushSub) => boolean): Promise<number> {
    let n = 0;
    for (const s of this.forSeat(game, seat)) {
      if (filter && !filter(s)) continue;
      if (inQuiet(s.quiet, now)) {
        s.held = [...s.held.filter(h => h.tag !== payload.tag), payload].slice(-10);
        this.save();
        continue;
      }
      if (await this.deliver(s, payload)) n++;
    }
    return n;
  }
  /** Send what quiet hours held back, once they are over. */
  async flush(now = Date.now()): Promise<number> {
    let n = 0;
    for (const s of [...this.subs.values()]) {
      if (!s.held.length || inQuiet(s.quiet, now)) continue;
      const held = s.held;
      s.held = [];
      this.save();
      for (const p of held) if (await this.deliver(s, p)) n++;
    }
    return n;
  }
  private async deliver(s: PushSub, payload: PushPayload): Promise<boolean> {
    try {
      const code = await this.sender({ endpoint: s.endpoint, keys: s.keys }, payload, this.vapid);
      if (code === 404 || code === 410) { this.subs.delete(s.id); this.save(); return false; }   // gone: the browser unsubscribed
      return code >= 200 && code < 300;
    } catch (e) {
      console.error('[push] send failed', (e as Error)?.message ?? e);
      return false;
    }
  }

  /** LIVE: announce each subscribed seat's own arrivals once, within 10 min (or one tick, if ticks are longer). */
  async liveAlerts(gameId: string, name: string, s: GameState, now = Date.now()): Promise<number> {
    if (!s.live || !this.hasGame(gameId)) return 0;
    const seen = this.alerted.get(gameId) ?? new Set<string>();
    this.alerted.set(gameId, seen);
    const within = Math.max(10 * 60_000, tickMs(s));
    let n = 0;
    const current = new Set<string>();
    for (const p of s.players) {
      if (!this.forSeat(gameId, p.id).some(x => x.live)) continue;
      for (const a of arrivals(s, p.id, now, within)) {
        const key = `${p.id}:${a.key}`;
        current.add(key);
        if (seen.has(key)) continue;
        seen.add(key);
        n += await this.notifySeat(gameId, p.id, arrivalPayload(a.fleet, a.dest, a.ms / 60000, { id: gameId, name }), now, x => x.live);
      }
    }
    for (const k of seen) if (!current.has(k)) seen.delete(k);   // arrived (or turned back): may be announced again later
    return n;
  }
}
