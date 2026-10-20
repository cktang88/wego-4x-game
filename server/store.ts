// Game store: holds authoritative game states, seats, pending orders.
// Persists every game to data/games/<id>.json so async games survive restarts.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGame, resolveTurn, planTurn, viewFor, emptySubmission } from '../shared/index.ts';
import type { GameState, Submission, TurnResult, PlayerView } from '../shared/index.ts';
import type { ChatMsg, CreateGameReq, GameMeta, SeatInfo } from '../shared/protocol.ts';

export interface Seat {
  name: string;
  kind: 'human' | 'ai';
  aiLevel: 'novice' | 'standard' | 'expert';
  token: string | null;     // secret held by the human who claimed it
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
  history: TurnResult[];     // full (unfiltered) results of every resolved turn
}

export class Store {
  games = new Map<string, StoredGame>();
  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true });
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const g = JSON.parse(readFileSync(join(dir, f), 'utf8')) as StoredGame;
        this.games.set(g.id, g);
      } catch (e) { console.error('failed to load', f, e); }
    }
    console.log(`[store] loaded ${this.games.size} games from ${dir}`);
  }

  save(g: StoredGame) {
    const p = join(this.dir, `${g.id}.json`);
    writeFileSync(p + '.tmp', JSON.stringify(g));
    renameSync(p + '.tmp', p);
  }

  create(req: CreateGameReq): StoredGame {
    let id: string;
    do { id = randomBytes(3).toString('hex'); } while (this.games.has(id));
    const seatsReq = (req.seats ?? []).slice(0, 3);
    while (seatsReq.length < 3) seatsReq.push({ kind: 'ai' });
    const state = createGame({
      id, seed: req.seed, rules: req.rules,
      players: seatsReq.map(s => ({ kind: s.kind === 'human' ? 'human' : 'ai', name: s.name, aiLevel: s.aiLevel })),
    });
    const deadlineHours = Math.max(0, Number(req.deadlineHours ?? state.rules.async.defaultDeadlineHours) || 0);
    const g: StoredGame = {
      id, name: (req.name || `Game ${id}`).slice(0, 60), createdAt: Date.now(),
      seats: seatsReq.map((s, i) => ({ name: state.players[i].name, kind: s.kind === 'human' ? 'human' : 'ai', aiLevel: s.aiLevel ?? 'standard', token: null })),
      state, pending: {}, deadlineHours, deadline: null, chat: [], history: [],
    };
    this.armDeadline(g);
    this.games.set(id, g);
    this.save(g);
    return g;
  }

  join(g: StoredGame, seat: number, name?: string): string {
    const s = g.seats[seat];
    if (!s || s.kind !== 'human') throw new Error('that seat is not open to humans');
    if (s.token) throw new Error('seat already taken');
    s.token = randomBytes(16).toString('hex');
    if (name) { s.name = name.slice(0, 40); g.state.players[seat].name = s.name; }
    this.save(g);
    return s.token;
  }

  seatFor(g: StoredGame, token: string | null | undefined): number | null {
    if (!token) return null;
    const i = g.seats.findIndex(s => s.token === token);
    return i >= 0 ? i : null;
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
    // finished games are fully revealed to everyone
    return viewFor(g.state, g.state.winner !== null ? null : seat);
  }

  submit(g: StoredGame, seat: number, sub: Submission): boolean {
    if (g.state.winner !== null) throw new Error('game is over');
    g.pending[seat] = sub;
    g.state.players[seat].missedTurns = 0;
    const resolved = this.tryResolve(g, false);
    this.save(g);
    return resolved;
  }

  unsubmit(g: StoredGame, seat: number) {
    delete g.pending[seat];
    this.save(g);
  }

  /** Resolve if every human seat has submitted (or `force` at the deadline). */
  tryResolve(g: StoredGame, force: boolean): boolean {
    if (g.state.winner !== null) return false;
    const humans = g.seats.map((s, i) => ({ s, i })).filter(x => x.s.kind === 'human' && !g.state.players[x.i].eliminated);
    const ready = humans.every(x => g.pending[x.i]);
    if (!ready && !force) return false;
    const subs: Record<number, Submission> = {};
    for (let i = 0; i < 3; i++) {
      const s = g.seats[i];
      if (g.pending[i]) subs[i] = g.pending[i];
      else if (s.kind === 'ai') subs[i] = planTurn(g.state, i);
      else {
        // missed the deadline: steward takes over
        g.state.players[i].missedTurns++;
        subs[i] = g.state.rules.steward.mode === 'ai' ? planTurn(g.state, i, 'standard') : emptySubmission(g.state);
      }
    }
    g.state = resolveTurn(g.state, subs);
    if (g.state.last) g.history.push(g.state.last);
    g.pending = {};
    this.armDeadline(g);
    return true;
  }

  armDeadline(g: StoredGame) {
    g.deadline = g.deadlineHours > 0 && g.state.winner === null ? Date.now() + g.deadlineHours * 3600_000 : null;
  }

  /** Called periodically: resolve any game whose deadline has passed. Returns ids that changed. */
  tick(): string[] {
    const changed: string[] = [];
    for (const g of this.games.values()) {
      if (g.deadline && Date.now() >= g.deadline && g.state.winner === null) {
        this.tryResolve(g, true);
        this.save(g);
        changed.push(g.id);
      }
    }
    return changed;
  }

  list(online: (id: string) => Set<number>): GameMeta[] {
    return [...this.games.values()].sort((a, b) => b.createdAt - a.createdAt).map(g => this.meta(g, online(g.id)));
  }

  exists(dir: string) { return existsSync(dir); }
}
