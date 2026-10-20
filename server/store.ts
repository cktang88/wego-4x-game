// Game store: holds authoritative game states, seats, pending orders.
// Persists every game to data/games/<id>.json so async games survive restarts.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { createGame, resolveTurn, planTurn, viewFor, emptySubmission, defaultRules, isObj, mergeRules } from '../shared/index.ts';
import type { GameState, Submission, TurnResult, PlayerView } from '../shared/index.ts';
import type { ChatMsg, CreateGameReq, GameMeta, SeatInfo } from '../shared/protocol.ts';
import { spectatorView } from './history.ts';

export interface Seat {
  name: string;
  kind: 'human' | 'ai';
  aiLevel: 'novice' | 'standard' | 'expert';
  /** Hash ('h:' + sha256 hex) of the secret held by the human who claimed it. Never sent to clients. */
  token: string | null;
}

export interface StoredGame {
  id: string;
  name: string;
  createdAt: number;
  seats: Seat[];
  state: GameState;
  pending: Record<number, Submission>;
  deadlineHours: number;
  deadline: number | null;
  chat: ChatMsg[];
  history: TurnResult[];     // full (unfiltered) results of resolved turns (capped at MAX_HISTORY)
  resolveFailures?: number;  // consecutive failed resolutions (sim bug); used for backoff
}

export const ID_RE = /^[0-9a-f]{6,32}$/;
export const AI_LEVELS = ['novice', 'standard', 'expert'] as const;
export const MAX_CHAT = 500;
export const MAX_HISTORY = 250;
export const MAX_DEADLINE_HOURS = 24 * 30;
export const MIN_DEADLINE_HOURS = 1 / 60;   // one minute
const MAX_RULES_JSON = 64 * 1024;
const FAIL_BACKOFF_MS = 10 * 60_000;

/** A client-facing error (bad input / state conflict), as opposed to a server bug. */
export class UserError extends Error {
  constructor(msg: string, public code = 400) { super(msg); }
}

const hashToken = (t: string) => 'h:' + createHash('sha256').update(t).digest('hex');

/** Strip control characters and clamp length of a user-supplied display string. */
export function cleanText(x: unknown, max: number): string {
  if (typeof x !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return x.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').trim().slice(0, max);
}

// Hard bounds on knobs that control the amount of work/memory per game.
const RULE_CLAMPS: Record<string, [number, number]> = {
  'orders.perTurn': [1, 10],
  'orders.pulses': [1, 10],
  'orders.maxPerFleet': [1, 10],
  'map.regionsPerWedge': [2, 30],
  'map.relicsPerWedge': [0, 10],
  'map.radius': [100, 10000],
  'map.minSiteDist': [1, 5000],
  'victory.turnLimit': [1, 200],
  maxFleets: [1, 20],
};
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Validate a rules override against the default rules: only keys that exist in
 * the defaults survive, primitives must keep their type, numbers must be finite
 * (and some are clamped), and prototype-polluting keys are dropped. Arrays are
 * accepted as-is (after the JSON size check) since the sim replaces them wholesale.
 */
export function sanitizeRules(over: unknown): Record<string, unknown> {
  if (!isObj(over)) return {};
  let size = 0;
  try { size = JSON.stringify(over).length; } catch { throw new UserError('rules must be plain JSON'); }
  if (size > MAX_RULES_JSON) throw new UserError('rules override too large');
  const walk = (o: Record<string, unknown>, base: Record<string, unknown>, path: string): Record<string, unknown> => {
    const out: Record<string, unknown> = Object.create(null);
    for (const k of Object.keys(o)) {
      if (BAD_KEYS.has(k) || !Object.prototype.hasOwnProperty.call(base, k)) continue;
      const v = o[k], d = base[k], p = path ? `${path}.${k}` : k;
      if (typeof d === 'number') {
        if (typeof v !== 'number' || !Number.isFinite(v)) continue;
        const [lo, hi] = RULE_CLAMPS[p] ?? [-1e6, 1e6];
        out[k] = Math.max(lo, Math.min(hi, Number.isInteger(d) && RULE_CLAMPS[p] ? Math.round(v) : v));
      } else if (typeof d === 'boolean') { if (typeof v === 'boolean') out[k] = v; }
      else if (typeof d === 'string') { if (typeof v === 'string' && v.length <= 200) out[k] = v; }
      else if (Array.isArray(d)) { if (Array.isArray(v)) out[k] = JSON.parse(JSON.stringify(v), (key, val) => (BAD_KEYS.has(key) ? undefined : val)); }
      else if (isObj(d)) { if (isObj(v)) out[k] = walk(v, d, p); }
    }
    // return a normal object (mergeRules uses Object.entries; null-proto is fine but keep it plain)
    return { ...out };
  };
  return walk(over, defaultRules() as unknown as Record<string, unknown>, '');
}

/** Structural check of a submission coming off the wire. The sim does the semantic validation. */
export function validateSubmission(sub: unknown, perTurn: number): Submission {
  if (!isObj(sub)) throw new UserError('submission must be an object');
  const { orders, free } = sub as { orders?: unknown; free?: unknown };
  if (!Array.isArray(orders) || orders.length > perTurn) throw new UserError(`orders must be an array of at most ${perTurn} slots`);
  for (const o of orders) if (o !== null && !(isObj(o) && typeof o.type === 'string')) throw new UserError('each order must be null or an object with a type');
  if (free !== undefined && (!Array.isArray(free) || free.length > 64)) throw new UserError('free must be an array of at most 64 actions');
  const fr = (free ?? []) as unknown[];
  for (const f of fr) if (!(isObj(f) && typeof f.type === 'string')) throw new UserError('each free action must be an object with a type');
  if (JSON.stringify(sub).length > 64 * 1024) throw new UserError('submission too large');
  // deep copy so later client-side mutation / shared references can't touch stored state
  const clean = JSON.parse(JSON.stringify({ orders: [...orders, ...new Array(perTurn - orders.length).fill(null)], free: fr }),
    (k, v) => (BAD_KEYS.has(k) ? undefined : v));
  return clean as Submission;
}

function looksLikeGame(g: any, file: string): g is StoredGame {
  return isObj(g) && typeof g.id === 'string' && ID_RE.test(g.id) && `${g.id}.json` === file
    && Array.isArray(g.seats) && g.seats.length === 3 && isObj(g.state) && Array.isArray((g.state as any).players);
}

export class Store {
  games = new Map<string, StoredGame>();
  /** Called with (game, error) when a resolution throws; previous state is kept. */
  onResolveError: (g: StoredGame, e: unknown) => void = (g, e) => console.error(`[store] resolve failed for ${g.id}`, e);

  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true });
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const g = JSON.parse(readFileSync(join(dir, f), 'utf8'));
        if (!looksLikeGame(g, f)) throw new Error('not a valid game file');
        g.chat ??= []; g.history ??= []; g.pending ??= {};
        // games saved before newer rule groups existed: fill missing knobs from defaults
        g.state.rules = mergeRules(defaultRules(), g.state.rules);
        // migrate plaintext tokens from older saves to hashes
        for (const s of g.seats) if (s.token && !s.token.startsWith('h:')) s.token = hashToken(s.token);
        this.games.set(g.id, g);
      } catch (e) {
        console.error('[store] failed to load', f, (e as Error)?.message ?? e);
        // move it aside so it is neither retried nor silently overwritten
        try { renameSync(join(dir, f), join(dir, `${f}.corrupt-${Date.now()}`)); } catch { /* ignore */ }
      }
    }
    console.log(`[store] loaded ${this.games.size} games from ${dir}`);
  }

  /** Atomic write: temp file + fsync + rename, so a crash mid-write never leaves a truncated game. */
  save(g: StoredGame) {
    const p = join(this.dir, `${g.id}.json`);
    const tmp = `${p}.${process.pid}.tmp`;
    const fd = openSync(tmp, 'w');
    try { writeSync(fd, JSON.stringify(g)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp, p);
  }

  create(req: CreateGameReq): StoredGame {
    if (!isObj(req)) throw new UserError('body must be an object');
    let id: string;
    do { id = randomBytes(5).toString('hex'); } while (this.games.has(id) || existsSync(join(this.dir, `${id}.json`)));
    if (req.seats !== undefined && !Array.isArray(req.seats)) throw new UserError('seats must be an array');
    const seatsReq = (req.seats ?? []).slice(0, 3).map(s => {
      const o = isObj(s) ? s : {};
      return {
        kind: o.kind === 'human' ? 'human' as const : 'ai' as const,
        name: cleanText(o.name, 40) || undefined,
        aiLevel: (AI_LEVELS as readonly unknown[]).includes(o.aiLevel) ? o.aiLevel as Seat['aiLevel'] : 'standard' as const,
      };
    });
    while (seatsReq.length < 3) seatsReq.push({ kind: 'ai', name: undefined, aiLevel: 'standard' });
    const seed = typeof req.seed === 'number' && Number.isFinite(req.seed) ? req.seed : undefined;
    const rules = sanitizeRules(req.rules);
    let state: GameState;
    try {
      state = createGame({ id, seed, rngSeed: randomBytes(4).readUInt32LE(0), rules, players: seatsReq.map(s => ({ kind: s.kind, name: s.name, aiLevel: s.aiLevel })) });
    } catch (e) { throw new UserError(`could not create game with these rules: ${(e as Error)?.message ?? e}`); }
    let dh = Number(req.deadlineHours ?? state.rules.async.defaultDeadlineHours);
    if (!Number.isFinite(dh) || dh <= 0) dh = 0;
    else dh = Math.max(MIN_DEADLINE_HOURS, Math.min(MAX_DEADLINE_HOURS, dh));
    const g: StoredGame = {
      id, name: cleanText(req.name, 60) || `Game ${id}`, createdAt: Date.now(),
      seats: seatsReq.map((s, i) => ({ name: state.players[i].name, kind: s.kind, aiLevel: s.aiLevel, token: null })),
      state, pending: {}, deadlineHours: dh, deadline: null, chat: [], history: [],
    };
    this.armDeadline(g);
    this.save(g);
    this.games.set(id, g);
    return g;
  }

  join(g: StoredGame, seat: number, name?: unknown): string {
    if (!Number.isInteger(seat) || seat < 0 || seat >= g.seats.length) throw new UserError('bad seat', 400);
    const s = g.seats[seat];
    if (s.kind !== 'human') throw new UserError('that seat is not open to humans', 409);
    if (s.token) throw new UserError('seat already taken', 409);
    if (g.state.winner !== null) throw new UserError('game is over', 409);
    const token = randomBytes(24).toString('base64url');
    const prev = { name: s.name, pname: g.state.players[seat].name };
    s.token = hashToken(token);
    const nm = cleanText(name, 40);
    if (nm) { s.name = nm; g.state.players[seat].name = nm; }
    try { this.save(g); } catch (e) {
      s.token = null; s.name = prev.name; g.state.players[seat].name = prev.pname;
      throw e;
    }
    return token;
  }

  seatFor(g: StoredGame, token: unknown): number | null {
    if (typeof token !== 'string' || !token || token.length > 200) return null;
    const h = Buffer.from(hashToken(token));
    for (let i = 0; i < g.seats.length; i++) {
      const t = g.seats[i].token;
      if (t && t.length === h.length && timingSafeEqual(Buffer.from(t), h)) return i;
    }
    return null;
  }

  meta(g: StoredGame, online: Set<number>): GameMeta {
    const seats: SeatInfo[] = g.seats.map((s, i) => ({
      seat: i, name: g.state.players[i].name, kind: s.kind, aiLevel: s.aiLevel, claimed: !!s.token,
      submitted: s.kind === 'ai' || !!g.pending[i], online: s.kind === 'ai' || online.has(i),
      missedTurns: g.state.players[i].missedTurns,
    }));
    return { id: g.id, name: g.name, createdAt: g.createdAt, turn: g.state.turn, seats, deadline: g.deadline,
      deadlineHours: g.deadlineHours, winner: g.state.winner, winReason: g.state.winReason };
  }

  view(g: StoredGame, seat: number | null): PlayerView {
    // finished games are fully revealed to everyone (intended: post-game debrief), but keep `you`
    if (g.state.winner !== null) return { ...viewFor(g.state, null), you: seat };
    // spectators of a running game get only public information, never the omniscient view
    // (otherwise any player could open a token-less tab and see through the fog)
    if (seat === null) return spectatorView(g.state);
    return viewFor(g.state, seat);
  }

  /** Returns true if the turn resolved. Throws UserError on bad input / finished game. */
  submit(g: StoredGame, seat: number, raw: unknown, turn?: unknown): boolean {
    if (g.state.winner !== null) throw new UserError('game is over', 409);
    if (!Number.isInteger(seat) || !g.seats[seat] || g.seats[seat].kind !== 'human') throw new UserError('bad seat', 403);
    if (g.state.players[seat].eliminated) throw new UserError('you have been eliminated', 409);
    if (turn !== undefined && turn !== null && turn !== g.state.turn) throw new UserError(`stale submission for turn ${turn}; it is now turn ${g.state.turn}`, 409);
    const sub = validateSubmission(raw, g.state.rules.orders.perTurn);
    g.pending[seat] = sub;
    g.state.players[seat].missedTurns = 0;
    const resolved = this.tryResolve(g, false);
    this.save(g);
    return resolved;
  }

  unsubmit(g: StoredGame, seat: number) {
    if (g.state.winner !== null || !(seat in g.pending)) return;
    delete g.pending[seat];
    this.save(g);
  }

  /**
   * Resolve if every human seat has submitted (or `force` at the deadline).
   * If the simulation throws, the previous state is kept untouched (resolveTurn works on a clone),
   * pending orders are kept, and the deadline is pushed back so a deterministic bug can't spin.
   */
  tryResolve(g: StoredGame, force: boolean): boolean {
    if (g.state.winner !== null) return false;
    const humans = g.seats.map((s, i) => ({ s, i })).filter(x => x.s.kind === 'human' && !g.state.players[x.i].eliminated);
    const ready = humans.every(x => g.pending[x.i]);
    if (!ready && !force) return false;
    const missed: number[] = [];
    let next: GameState;
    try {
      const subs: Record<number, Submission> = {};
      for (let i = 0; i < 3; i++) {
        const s = g.seats[i];
        const p = g.state.players[i];
        if (g.pending[i]) subs[i] = g.pending[i];
        else if (p.eliminated) subs[i] = emptySubmission(g.state);
        else if (s.kind === 'ai') subs[i] = planTurn(g.state, i);
        else {
          // missed the deadline: steward takes over
          missed.push(i);
          subs[i] = g.state.rules.steward.mode === 'ai' ? planTurn(g.state, i, 'standard') : emptySubmission(g.state);
        }
      }
      next = resolveTurn(g.state, subs);
    } catch (e) {
      g.resolveFailures = (g.resolveFailures ?? 0) + 1;
      if (g.deadline !== null || force) g.deadline = Date.now() + FAIL_BACKOFF_MS * Math.min(g.resolveFailures, 12);
      this.onResolveError(g, e);
      return false;
    }
    // missedTurns lives in the state; bump it on the new state so a failed resolve doesn't count
    for (const i of missed) next.players[i].missedTurns = g.state.players[i].missedTurns + 1;
    g.state = next;
    g.resolveFailures = 0;
    if (g.state.last) g.history.push(g.state.last);
    if (g.history.length > MAX_HISTORY) g.history.splice(0, g.history.length - MAX_HISTORY);
    g.pending = {};
    this.armDeadline(g);
    return true;
  }

  armDeadline(g: StoredGame) {
    g.deadline = g.deadlineHours > 0 && g.state.winner === null ? Date.now() + g.deadlineHours * 3600_000 : null;
  }

  /** Called periodically: resolve any game whose deadline has passed. Returns ids that changed. Never throws. */
  tick(now = Date.now()): string[] {
    const changed: string[] = [];
    for (const g of this.games.values()) {
      if (g.deadline && now >= g.deadline && g.state.winner === null) {
        try {
          const before = g.state.turn;
          this.tryResolve(g, true);
          this.save(g);
          if (g.state.turn !== before) changed.push(g.id);
        } catch (e) { console.error(`[store] tick failed for ${g.id}`, e); }
      }
    }
    return changed;
  }

  list(online: (id: string) => Set<number>): GameMeta[] {
    return [...this.games.values()].sort((a, b) => b.createdAt - a.createdAt).map(g => this.meta(g, online(g.id)));
  }
}
