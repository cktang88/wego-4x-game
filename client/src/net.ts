// Game sources: a LOCAL game (whole sim runs in the browser — solo vs AI or
// hotseat) and a REMOTE game (authoritative server over WebSocket).
import { createGame, resolveTurn, planTurn, viewFor, filterResultFor } from '../../shared/index.ts';
import type { GameState, PlayerView, Submission, TurnResult } from '../../shared/index.ts';
import type { ChatMsg, GameMeta, ServerMsg } from '../../shared/protocol.ts';

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

  constructor(public save: LocalSave) { this.refresh(); }

  static create(name: string, seats: LocalSave['seats'], names: (string | undefined)[], seed: number | undefined, rules: unknown): LocalSource {
    const state = createGame({ seed, rules, players: seats.map((s, i) => ({ kind: s.kind, aiLevel: s.aiLevel, name: names[i] })) });
    const first = Math.max(0, seats.findIndex(s => s.kind === 'human'));
    return new LocalSource({ v: 1, name, state, seats, pending: {}, current: first, history: [], reveal: seats.every(s => s.kind === 'ai') });
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
    try { localStorage.setItem('tc.local.autosave', JSON.stringify(this.save)); } catch { /* quota */ }
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
export class RemoteSource implements GameSource {
  kind = 'remote' as const;
  meta!: GameMeta;
  view!: PlayerView;
  mySubmission: Submission | null = null;
  chat: ChatMsg[] = [];
  lastError = '';
  onChange: (k: ChangeKind) => void = () => {};
  private ws!: WebSocket;
  private closed = false;
  private pendingHistory = new Map<number, (r: TurnResult | null) => void>();
  private ready: Promise<void>;
  private resolveReady!: () => void;
  private retry = 500;
  private pinger: number | undefined;

  constructor(public gameId: string, public token: string | null) {
    this.ready = new Promise(r => (this.resolveReady = r));
    this.connect();
  }
  waitReady() { return this.ready; }

  private connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws?game=${encodeURIComponent(this.gameId)}${this.token ? `&token=${this.token}` : ''}`;
    this.ws = new WebSocket(url);
    this.ws.onopen = () => { this.retry = 500; };
    this.ws.onmessage = ev => {
      const m = JSON.parse(ev.data) as ServerMsg;
      switch (m.type) {
        case 'view':
          this.meta = m.meta; this.view = m.view; this.mySubmission = m.mySubmission; this.chat = m.chat;
          this.resolveReady(); this.onChange('view'); break;
        case 'meta': this.meta = m.meta; this.onChange('meta'); break;
        case 'chat': this.chat.push(m.msg); this.onChange('chat'); break;
        case 'history': this.pendingHistory.get(m.turn)?.(m.result); this.pendingHistory.delete(m.turn); break;
        case 'error': this.lastError = m.error; this.onChange('error'); break;
      }
    };
    this.ws.onclose = () => {
      if (this.closed) return;
      setTimeout(() => this.connect(), this.retry);
      this.retry = Math.min(8000, this.retry * 2);
    };
    clearInterval(this.pinger);
    this.pinger = window.setInterval(() => this.send({ type: 'ping' }), 25000);
  }
  private send(m: unknown) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  submit(sub: Submission) { this.send({ type: 'submit', submission: sub }); }
  unsubmit() { this.send({ type: 'unsubmit' }); }
  sendChat(text: string, to: number | null) { this.send({ type: 'chat', text, to }); }
  history(turn: number): Promise<TurnResult | null> {
    return new Promise(res => { this.pendingHistory.set(turn, res); this.send({ type: 'history', turn }); setTimeout(() => res(null), 5000); });
  }
  close() { this.closed = true; clearInterval(this.pinger); this.ws.close(); }
}

// ============================================================ lobby REST
export const api = {
  async list(): Promise<GameMeta[]> { return (await fetch('/api/games')).json(); },
  async create(body: unknown): Promise<{ id: string; meta: GameMeta }> {
    const r = await fetch('/api/games', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error((await r.json()).error);
    return r.json();
  },
  async join(id: string, seat: number, name: string): Promise<{ token: string; seat: number }> {
    const r = await fetch(`/api/games/${id}/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seat, name }) });
    if (!r.ok) throw new Error((await r.json()).error);
    return r.json();
  },
};

export const tokens = {
  get(id: string): { token: string; seat: number } | null {
    try { return JSON.parse(localStorage.getItem(`tc.token.${id}`) ?? 'null'); } catch { return null; }
  },
  set(id: string, v: { token: string; seat: number }) { localStorage.setItem(`tc.token.${id}`, JSON.stringify(v)); },
};
