// Game sources: a LOCAL game (whole sim runs in the browser — solo vs AI or
// hotseat) and a REMOTE game (authoritative server over WebSocket).
import { createGame, resolveTurn, planTurn, viewFor, filterResultFor, makeLive, advanceTo, queueOrder, cancelQueued, queueFree, haltOrder, nextTickAt, tickMs } from '../../shared/index.ts';
import type { GameState, PlayerView, Submission, TurnResult, Order, FreeAction } from '../../shared/index.ts';
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
  /** A resolved turn's result. LIVE: `tick` picks one tick of that cycle (default: its first stored tick). */
  history(turn: number, tick?: number): Promise<TurnResult | null>;
  close(): void;
  // LIVE mode: orders are spent one at a time and execute at the next tick
  liveOrder?(o: Order): void;
  liveCancel?(index: number): void;
  liveFree?(fa: FreeAction): void;
  liveHalt?(fleet: number): void;
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

  private liveTimer: number | undefined;

  constructor(public save: LocalSave, public storageKey = 'tc.local.autosave') {
    this.refresh();
    if (save.state.live) {
      this.tickLive();   // catch up on the time spent away
      this.liveTimer = window.setInterval(() => this.tickLive(), 1000);
    }
  }

  static create(name: string, seats: LocalSave['seats'], names: (string | undefined)[], seed: number | undefined, rules: unknown, storageKey = 'tc.local.autosave', live?: { speed: number }): LocalSource {
    const state = createGame({ seed, rules, players: seats.map((s, i) => ({ kind: s.kind, aiLevel: s.aiLevel, name: names[i] })) });
    if (live) makeLive(state, Date.now(), live.speed);
    const first = Math.max(0, seats.findIndex(s => s.kind === 'human'));
    return new LocalSource({ v: 1, name, state, seats, pending: {}, current: first, history: [], reveal: seats.every(s => s.kind === 'ai') }, storageKey);
  }

  get humans() { return this.save.seats.map((s, i) => ({ s, i })).filter(x => x.s.kind === 'human' && !this.save.state.players[x.i].eliminated).map(x => x.i); }
  /** The Court: human seats in exile (eliminated, still at the table: they whisper and cast a ghost vote). */
  get exiles() {
    const st = this.save.state;
    if (st.winner !== null || !st.court) return [];
    return this.save.seats.map((s, i) => i).filter(i => this.save.seats[i].kind === 'human' && st.players[i].eliminated && st.court!.exiles.some(e => e.p === i));
  }
  /** Who takes the device in turn: the living humans, then (WEGO) the exiles, who pass it on when they have whispered. */
  private get rotation() { const h = this.humans; return h.length && !this.save.state.live ? [...h, ...this.exiles] : h; }

  refresh() {
    const st = this.save.state;
    // no living human left: watch the AIs; a human exile still sits at the table (its whisper panel needs a seat)
    const exile = this.humans.length ? null : this.exiles[0] ?? null;
    const seat = this.save.reveal || !this.humans.length ? null : this.save.current;
    this.view = viewFor(st, st.winner !== null ? null : seat);
    if (seat === null) this.view = { ...this.view, you: this.humans.length ? this.save.current : exile };
    this.mySubmission = this.save.pending[this.save.current] ?? null;
    this.meta = {
      id: 'local', name: this.save.name, createdAt: 0, turn: st.turn, deadline: null, deadlineHours: 0,
      winner: st.winner, winReason: st.winReason,
      mode: st.live ? 'live' : 'wego',
      live: st.live ? { speed: st.live.speed, tick: st.live.tick, nextTickAt: nextTickAt(st), tickMs: tickMs(st), ticksPerCycle: st.rules.live.ticksPerCycle } : undefined,
      seats: this.save.seats.map((s, i) => ({ seat: i, name: st.players[i].name, kind: s.kind, aiLevel: s.aiLevel, claimed: s.kind === 'human',
        submitted: s.kind === 'ai' || !!this.save.pending[i], online: true, missedTurns: 0 })),
    };
    this.persist();
  }
  /** Autosave. A LIVE game's replay history can outgrow the storage quota: drop the oldest replays rather than the game. */
  private persist() {
    for (let attempt = 0; attempt < 4; attempt++) {
      try { localStorage.setItem(this.storageKey, JSON.stringify(this.save)); return; } catch { /* quota (or storage blocked) */ }
      if (!this.save.history.length) return;
      this.save.history.splice(0, Math.ceil(this.save.history.length / 2));
    }
  }

  submit(sub: Submission) {
    this.save.pending[this.save.current] = sub;
    const waiting = this.rotation.filter(h => !this.save.pending[h]);
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
    const hs = this.rotation;
    this.save.current = hs.length ? hs[0] : 0;
    this.refresh();
    if (hs.length > 1) this.onHandoff(this.save.current);
    this.onChange('view');
  }
  unsubmit() { delete this.save.pending[this.save.current]; this.refresh(); this.onChange('view'); }
  /**
   * The Court: an exile's whisper / ghost vote. `humans` drops eliminated seats, so an exile is never planning: its
   * choice is stored straight into `pending[seat]` (resolve reads pending before planTurn), replacing an earlier one.
   * LIVE: queued for the next tick like any free action.
   */
  exileFree(seat: number, fa: FreeAction) {
    const st = this.save.state;
    if (st.winner !== null || !st.players[seat]?.eliminated) return;
    if (st.live) { this.liveAct(() => queueFree(this.save.state, seat, fa)); return; }
    const prev = this.save.pending[seat];
    this.save.pending[seat] = { orders: prev?.orders ?? [], free: [...(prev?.free ?? []).filter(x => x.type !== fa.type), fa] };
    this.refresh();
    this.onChange('view');
  }
  /** Hotseat: the exile holding the device is done; pass it on (its whisper, if any, is already in `pending`). */
  exilePass() {
    const seat = this.save.current;
    if (!this.exiles.includes(seat)) return;
    this.submit(this.save.pending[seat] ?? { orders: [], free: [] });
  }
  /** All-AI games (Watch AIs): resolve the next turn with AI plans for everyone. */
  advance() {
    if (this.humans.length || this.save.state.winner !== null) return;
    const subs: Record<number, Submission> = {};
    // a human exile's whisper (stored by exileFree) goes in; planTurn invents none for a human exile
    for (let i = 0; i < 3; i++) subs[i] = this.save.pending[i] ?? planTurn(this.save.state, i);
    this.save.state = resolveTurn(this.save.state, subs);
    if (this.save.state.last) this.save.history.push(this.save.state.last);
    if (this.save.history.length > 60) this.save.history.shift();
    this.save.pending = {};
    this.refresh();
    this.onChange('view');
  }
  sendChat(text: string) { this.chat.push({ at: Date.now(), seat: this.save.current, to: null, text }); this.onChange('chat'); }
  async history(turn: number, tick?: number) {
    const r = this.save.history.find(h => h.turn === turn && (tick === undefined || h.tick === tick));
    if (!r) return null;
    return this.save.reveal || this.save.state.winner !== null ? r : filterResultFor(this.save.state, r, this.save.current);
  }
  setReveal(on: boolean) { this.save.reveal = on; this.refresh(); this.onChange('view'); }
  close() { clearInterval(this.liveTimer); }

  // ---------------------------------------------------------------- LIVE
  private liveFailed = false;
  private tickLive() {
    const st = this.save.state;
    if (!st.live || st.winner !== null) return;
    const r = advanceTo(st, Date.now(), pid => this.save.seats[pid]?.kind === 'ai', 500);
    if (r.error !== undefined && !this.liveFailed) {
      // report once (this runs every second); the failed tick is retried and the game kept as it was
      this.liveFailed = true;
      console.error('[live] tick failed', r.error);
      this.lastError = 'A tick failed to resolve; the game was kept as it was and will retry.';
      this.onChange('error');
    }
    if (!r.results.length) return;
    if (r.error === undefined) this.liveFailed = false;
    this.save.state = r.state;
    this.save.history.push(...r.results);
    if (this.save.history.length > 120) this.save.history.splice(0, this.save.history.length - 120);
    this.refresh();
    this.onChange('view');
  }
  private liveAct(fn: () => string | null | boolean) {
    // a background tab's timer is throttled: run any overdue ticks first so the order lands on the right one
    this.tickLive();
    const res = fn();
    if (typeof res === 'string') { this.lastError = res; this.onChange('error'); return; }
    if (res === false) { this.lastError = 'not possible'; this.onChange('error'); return; }
    this.refresh();
    this.onChange('view');
  }
  liveOrder(o: Order) { this.liveAct(() => queueOrder(this.save.state, this.save.current, o, Date.now())); }
  liveCancel(i: number) { this.liveAct(() => cancelQueued(this.save.state, this.save.current, i)); }
  liveFree(fa: FreeAction) { this.liveAct(() => queueFree(this.save.state, this.save.current, fa)); }
  liveHalt(fleet: number) { this.liveAct(() => haltOrder(this.save.state, this.save.current, fleet)); }
}

// ============================================================ remote
const HISTORY_TIMEOUT_MS = 8000;
const histKey = (turn: number, tick?: number) => (tick === undefined ? `${turn}` : `${turn}:${tick}`);

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
  /** In-flight history requests, keyed by "turn" or "turn:tick". */
  private pendingHistory = new Map<string, Set<(r: TurnResult | null) => void>>();
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
      if (!m || typeof m !== 'object') return;
      switch (m.type) {
        case 'view':
          this.meta = m.meta; this.view = m.view; this.mySubmission = m.mySubmission; this.chat = m.chat;
          this.resolveReady(); this.onChange('view'); break;
        case 'meta': this.meta = m.meta; this.onChange('meta'); break;
        case 'chat': this.chat.push(m.msg); if (this.chat.length > 500) this.chat.splice(0, this.chat.length - 500); this.onChange('chat'); break;
        case 'history': this.settleHistory(histKey(m.turn, m.tick), m.result); break;
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
      for (const key of [...this.pendingHistory.keys()]) this.settleHistory(key, null);
      if (this.closed) return;
      const delay = this.retry * (0.75 + Math.random() * 0.5);
      this.retry = Math.min(8000, this.retry * 2);
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
    };
    clearInterval(this.pinger);
    this.pinger = window.setInterval(() => this.send({ type: 'ping' }), 25000);
  }
  private settleHistory(key: string, r: TurnResult | null) {
    const waiters = this.pendingHistory.get(key);
    if (!waiters) return;
    this.pendingHistory.delete(key);
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
  liveOrder(order: Order) { this.sendOrWarn({ type: 'liveOrder', order }); }
  liveCancel(index: number) { this.sendOrWarn({ type: 'liveCancel', index }); }
  liveFree(action: FreeAction) { this.sendOrWarn({ type: 'liveFree', action }); }
  liveHalt(fleet: number) { this.sendOrWarn({ type: 'liveHalt', fleet }); }
  history(turn: number, tick?: number): Promise<TurnResult | null> {
    const key = histKey(turn, tick);
    return new Promise(res => {
      let done = false;
      const finish = (r: TurnResult | null) => { if (done) return; done = true; clearTimeout(timer); res(r); };
      const timer = window.setTimeout(() => {
        const set = this.pendingHistory.get(key);
        set?.delete(finish);
        if (set && !set.size) this.pendingHistory.delete(key);
        finish(null);
      }, HISTORY_TIMEOUT_MS);
      const set = this.pendingHistory.get(key);
      const first = !set;
      if (set) set.add(finish); else this.pendingHistory.set(key, new Set([finish]));
      // one request per turn is enough; concurrent callers share the answer
      if (first && !this.send(tick === undefined ? { type: 'history', turn } : { type: 'history', turn, tick })) this.settleHistory(key, null);
    });
  }
  private shutdown() {
    this.closed = true;
    clearInterval(this.pinger); this.pinger = undefined;
    clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined;
    for (const key of [...this.pendingHistory.keys()]) this.settleHistory(key, null);
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
