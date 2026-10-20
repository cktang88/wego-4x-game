// Game sources: a LOCAL game (whole sim runs in the browser — solo vs AI or
// hotseat) and a REMOTE game (authoritative server over WebSocket).
import { createGame, resolveTurn, planTurn, viewFor, filterResultFor } from '../../shared/index.ts';
import type { GameState, PlayerView, Submission, TurnResult } from '../../shared/index.ts';
import type { ChatMsg, ClientMsg, GameMeta, ServerMsg } from '../../shared/protocol.ts';

export type ChangeKind = 'view' | 'meta' | 'chat' | 'error';

export interface GameSource {
  kind: 'local' | 'remote';
  meta: GameMeta;
  view: PlayerView;
  mySubmission: Submission | null;
  chat: ChatMsg[];
  lastError: string;
  onChange: (k: ChangeKind) => void;
  submit(sub: Submission): void;
  unsubmit(): void;
  sendChat(text: string, to: number | null): void;
  history(turn: number): Promise<TurnResult | null>;
  close(): void;
}

// ============================================================ local
export interface LocalSave {
  v: 1;
  name: string;
  state: GameState;
  seats: { kind: 'human' | 'ai'; aiLevel: 'novice' | 'standard' | 'expert' }[];
  pending: Record<number, Submission>;
  current: number;          // which human seat is planning now (hotseat)
  history: TurnResult[];
  reveal: boolean;          // dev: see everything
}

export class LocalSource implements GameSource {
  kind = 'local' as const;
  meta!: GameMeta;
  view!: PlayerView;
  mySubmission: Submission | null = null;
  chat: ChatMsg[] = [];
  lastError = '';
  onChange: (k: ChangeKind) => void = () => {};
  /** Hotseat: called when control should pass to another human (show a curtain). */
  onHandoff: (seat: number) => void = () => {};

  constructor(public save: LocalSave, public storageKey = 'tc.local.autosave') { this.refresh(); }

  static create(name: string, seats: LocalSave['seats'], names: (string | undefined)[], seed: number | undefined, rules: unknown, storageKey = 'tc.local.autosave'): LocalSource {
    const state = createGame({ seed, rules, players: seats.map((s, i) => ({ kind: s.kind, aiLevel: s.aiLevel, name: names[i] })) });
    const first = Math.max(0, seats.findIndex(s => s.kind === 'human'));
    return new LocalSource({ v: 1, name, state, seats, pending: {}, current: first, history: [], reveal: seats.every(s => s.kind === 'ai') }, storageKey);
  }

  get humans() { return this.save.seats.map((s, i) => ({ s, i })).filter(x => x.s.kind === 'human' && !this.save.state.players[x.i].eliminated).map(x => x.i); }

  refresh() {
    const st = this.save.state;
    const seat = this.save.reveal || !this.humans.length ? null : this.save.current;
    this.view = viewFor(st, st.winner !== null ? null : seat);
    if (seat === null) this.view = { ...this.view, you: this.humans.length ? this.save.current : null };
    this.mySubmission = this.save.pending[this.save.current] ?? null;
    this.meta = {
      id: 'local', name: this.save.name, createdAt: 0, turn: st.turn, deadline: null, deadlineHours: 0,
      winner: st.winner, winReason: st.winReason,
      seats: this.save.seats.map((s, i) => ({ seat: i, name: st.players[i].name, kind: s.kind, aiLevel: s.aiLevel, claimed: s.kind === 'human',
        submitted: s.kind === 'ai' || !!this.save.pending[i], online: true, missedTurns: 0 })),
    };
    try { localStorage.setItem(this.storageKey, JSON.stringify(this.save)); } catch { /* quota */ }
  }

  submit(sub: Submission) {
    this.save.pending[this.save.current] = sub;
    const waiting = this.humans.filter(h => !this.save.pending[h]);
    if (waiting.length) {
      this.save.current = waiting[0];
      this.refresh();
      this.onHandoff(this.save.current);
      this.onChange('view');
      return;
    }
    const subs: Record<number, Submission> = {};
    for (let i = 0; i < 3; i++) subs[i] = this.save.pending[i] ?? planTurn(this.save.state, i);
    this.save.state = resolveTurn(this.save.state, subs);
    if (this.save.state.last) this.save.history.push(this.save.state.last);
    if (this.save.history.length > 60) this.save.history.shift();
    this.save.pending = {};
    const hs = this.humans;
    this.save.current = hs.length ? hs[0] : 0;
    this.refresh();
    if (hs.length > 1) this.onHandoff(this.save.current);
    this.onChange('view');
  }
  unsubmit() { delete this.save.pending[this.save.current]; this.refresh(); this.onChange('view'); }
  /** All-AI games (Watch AIs): resolve the next turn with AI plans for everyone. */
  advance() {
    if (this.humans.length || this.save.state.winner !== null) return;
    const subs: Record<number, Submission> = {};
    for (let i = 0; i < 3; i++) subs[i] = planTurn(this.save.state, i);
    this.save.state = resolveTurn(this.save.state, subs);
    if (this.save.state.last) this.save.history.push(this.save.state.last);
    if (this.save.history.length > 60) this.save.history.shift();
    this.refresh();
    this.onChange('view');
  }
  sendChat(text: string) { this.chat.push({ at: Date.now(), seat: this.save.current, to: null, text }); this.onChange('chat'); }
  async history(turn: number) {
    const r = this.save.history.find(h => h.turn === turn);
    if (!r) return null;
    return this.save.reveal || this.save.state.winner !== null ? r : filterResultFor(this.save.state, r, this.save.current);
  }
  setReveal(on: boolean) { this.save.reveal = on; this.refresh(); this.onChange('view'); }
  close() {}
}

// ============================================================ remote
const HISTORY_TIMEOUT_MS = 8000;

export class RemoteSource implements GameSource {
  kind = 'remote' as const;
  meta!: GameMeta;
  view!: PlayerView;
  mySubmission: Submission | null = null;
  chat: ChatMsg[] = [];
  lastError = '';
  onChange: (k: ChangeKind) => void = () => {};
  private ws: WebSocket | null = null;
  private closed = false;
  private pendingHistory = new Map<number, Set<(r: TurnResult | null) => void>>();
  private ready: Promise<void>;
  private resolveReady!: () => void;
  private retry = 500;
  private pinger: number | undefined;
  private reconnectTimer: number | undefined;

  constructor(public gameId: string, public token: string | null) {
    this.ready = new Promise(r => (this.resolveReady = r));
    this.connect();
  }
  waitReady() { return this.ready; }
  get connected() { return this.ws?.readyState === 1; }

  private connect() {
    if (this.closed) return;
    this.reconnectTimer = undefined;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws?game=${encodeURIComponent(this.gameId)}${this.token ? `&token=${encodeURIComponent(this.token)}` : ''}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => { if (ws === this.ws) this.retry = 500; };
    ws.onmessage = ev => {
      if (ws !== this.ws || this.closed) return;   // ignore stragglers from a replaced socket
      let m: ServerMsg;
      try { m = JSON.parse(String(ev.data)) as ServerMsg; } catch { return; }
      switch (m.type) {
        case 'view':
          this.meta = m.meta; this.view = m.view; this.mySubmission = m.mySubmission; this.chat = m.chat;
          this.resolveReady(); this.onChange('view'); break;
        case 'meta': this.meta = m.meta; this.onChange('meta'); break;
        case 'chat': this.chat.push(m.msg); if (this.chat.length > 500) this.chat.splice(0, this.chat.length - 500); this.onChange('chat'); break;
        case 'history': this.settleHistory(m.turn, m.result); break;
        case 'error':
          this.lastError = m.error;
          if (m.code === 'no_game') this.shutdown();   // don't hammer the server for a game that doesn't exist
          this.onChange('error'); break;
      }
    };
    ws.onclose = () => {
      if (ws !== this.ws) return;
      clearInterval(this.pinger); this.pinger = undefined;
      // answers to in-flight history requests will never arrive on this socket
      for (const turn of [...this.pendingHistory.keys()]) this.settleHistory(turn, null);
      if (this.closed) return;
      const delay = this.retry * (0.75 + Math.random() * 0.5);
      this.retry = Math.min(8000, this.retry * 2);
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
    };
    clearInterval(this.pinger);
    this.pinger = window.setInterval(() => this.send({ type: 'ping' }), 25000);
  }
  private settleHistory(turn: number, r: TurnResult | null) {
    const waiters = this.pendingHistory.get(turn);
    if (!waiters) return;
    this.pendingHistory.delete(turn);
    for (const w of waiters) w(r);
  }
  private send(m: ClientMsg): boolean {
    if (!this.ws || this.ws.readyState !== 1) return false;
    this.ws.send(JSON.stringify(m));
    return true;
  }
  private sendOrWarn(m: ClientMsg) {
    if (this.send(m)) return;
    this.lastError = 'Not connected to the server; reconnecting. Please try again in a moment.';
    this.onChange('error');
  }
  submit(sub: Submission) { this.sendOrWarn({ type: 'submit', submission: sub, turn: this.meta?.turn }); }
  unsubmit() { this.sendOrWarn({ type: 'unsubmit' }); }
  sendChat(text: string, to: number | null) { this.sendOrWarn({ type: 'chat', text, to }); }
  history(turn: number): Promise<TurnResult | null> {
    return new Promise(res => {
      let done = false;
      const finish = (r: TurnResult | null) => { if (done) return; done = true; clearTimeout(timer); res(r); };
      const timer = window.setTimeout(() => {
        const set = this.pendingHistory.get(turn);
        set?.delete(finish);
        if (set && !set.size) this.pendingHistory.delete(turn);
        finish(null);
      }, HISTORY_TIMEOUT_MS);
      const set = this.pendingHistory.get(turn);
      const first = !set;
      if (set) set.add(finish); else this.pendingHistory.set(turn, new Set([finish]));
      // one request per turn is enough; concurrent callers share the answer
      if (first && !this.send({ type: 'history', turn })) this.settleHistory(turn, null);
    });
  }
  private shutdown() {
    this.closed = true;
    clearInterval(this.pinger); this.pinger = undefined;
    clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined;
    for (const turn of [...this.pendingHistory.keys()]) this.settleHistory(turn, null);
  }
  close() {
    this.shutdown();
    const ws = this.ws;
    this.ws = null;
    try { ws?.close(); } catch { /* ignore */ }
  }
}

// ============================================================ lobby REST
async function errorText(r: Response): Promise<string> {
  try { return (await r.json()).error ?? `HTTP ${r.status}`; } catch { return `HTTP ${r.status}`; }
}

export const api = {
  async list(): Promise<GameMeta[]> {
    const r = await fetch('/api/games');
    if (!r.ok) throw new Error(await errorText(r));
    return r.json();
  },
  async create(body: unknown): Promise<{ id: string; meta: GameMeta }> {
    const r = await fetch('/api/games', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(await errorText(r));
    return r.json();
  },
  async join(id: string, seat: number, name: string): Promise<{ token: string; seat: number }> {
    const r = await fetch(`/api/games/${encodeURIComponent(id)}/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seat, name }) });
    if (!r.ok) throw new Error(await errorText(r));
    return r.json();
  },
};

export const tokens = {
  get(id: string): { token: string; seat: number } | null {
    try { return JSON.parse(localStorage.getItem(`tc.token.${id}`) ?? 'null'); } catch { return null; }
  },
  set(id: string, v: { token: string; seat: number }) { try { localStorage.setItem(`tc.token.${id}`, JSON.stringify(v)); } catch { /* storage blocked */ } },
};
