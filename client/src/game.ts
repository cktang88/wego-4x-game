// The in-game screen: map, planning UI (5 order slots), replays, intel,
// chronicle, scoreboard, chat. Works with either a local or remote GameSource.
import { describeOrder, orderCost, validateOrder, costText, canAfford, ORDER_INFO } from '../../shared/sim/orders.ts';
import { findPath, fleetSpeed, fleetPower } from '../../shared/sim/graph.ts';
import { incomeDetail, creditRate, currentLeader, resolveTurn, emptySubmission, flipThreshold } from '../../shared/sim/resolve.ts';
import { TRAITS, RELICS, NEUTRAL_COLOR } from '../../shared/config/content.ts';
import { EDICTS } from '../../shared/sim/edicts.ts';
import type { Doctrine, Fleet, GameEvent, GameState, Order, Player, Pt, Region, Submission, TurnResult } from '../../shared/sim/types.ts';
import { predictAssault } from '../../shared/sim/ai.ts';
import { maxGarrison } from '../../shared/sim/setup.ts';
import { defaultRules, mergeRules } from '../../shared/config/rules.ts';
import type { GameSource } from './net.ts';
import { LocalSource } from './net.ts';
import { MapRenderer, regionLayout, reducedMotion, type FleetDraw, type Fx } from './render/map.ts';
import { openBattleViewer } from './render/battle.ts';
import { h, esc, toast, overlay, roman } from './ui/dom.ts';
import { helpHtml } from './ui/help.ts';
import { Coach, tutorialDone } from './ui/tutorial.ts';
import { nextTickAt, tickMs, orderMs, etaTicks, tickInCycle } from '../../shared/sim/live.ts';
import type { FreeAction } from '../../shared/sim/types.ts';
import { TECH, LAW, MODULE, BRANCHES, TRAITS as WORLD_TRAITS, VEINS } from '../../shared/config/empire.ts';
import { connected, supplied, blueprintFor, classBlock, maxDevAt, techCost, hasTech, hasLaw, researchBlock, opposite } from '../../shared/sim/empire.ts';
import { empireHtml, bindEmpire, empireFreeText, pendingResearch, type EmpFocus } from './ui/empire.ts';

/** "2h 05m", "4m 10s", "12s" */
export function fmtDur(ms: number): string {
  ms = Math.max(0, ms);
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${s}s`;
}

type Mode = null | { type: 'move'; fleet: number; overdrive: boolean } | { type: 'seize'; fleet: number } | { type: 'target'; order: 'influence' | 'scan' | 'feint' };
type Tab = 'orders' | 'empire' | 'intel' | 'chronicle' | 'score' | 'chat';

interface ReplayFleet { id: number; owner: number; ships: number; region: number; alpha: number; name: string }
interface Beat { dur: number; events: GameEvent[] }
interface Replay {
  result: TurnResult;
  beats: Beat[];
  i: number;
  /** progress through the current beat, 0..1 (advanced per frame, so pause/speed changes never jump) */
  prog: number;
  last: number;
  playing: boolean;
  speed: number;
  fleets: Map<number, ReplayFleet>;
  owners: (number | null)[];
  startLayout: Map<number, Pt>;
  endLayout: Map<number, Pt>;
  moving: Set<number>;
  pulse: number;
  preview: boolean;
}

export class GameScreen {
  root: HTMLElement;
  map: MapRenderer;
  plan: Submission;
  sel: { kind: 'region' | 'fleet'; id: number } | null = null;
  mode: Mode = null;
  targetSlot: number | null = null;
  hoverRegion: number | null = null;
  tab: Tab = 'orders';
  showSignals = true;
  replay: Replay | null = null;
  fx: Fx[] = [];
  /** where each fleet token was drawn last frame (continuity between beats, ticks and replays) */
  lastFleetPos = new Map<number, Pt>();
  /** decaying visual offsets that smooth out jumps in fleet positions (state updates, layout reshuffles) */
  fleetOff = new Map<number, { x: number; y: number }>();
  lastFrameAt = 0;
  /** the running replay continues from the on-screen positions (a live tick) instead of cutting to the turn start */
  replayCont = false;
  lastSeenTurn = 0;
  unreadChat = 0;
  raf = 0;
  drag: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
  pinch: { d: number; z: number } | null = null;
  pointers = new Map<number, { x: number; y: number }>();
  el: Record<string, HTMLElement> = {};
  destroyed = false;
  previewing = false;
  autoPlay = false;
  flashOrder = 0;
  lastClock = 0;
  odSticky = false;
  planVersion = 0;
  /** replay speed chosen by the user, kept across turns (Auto play) */
  replaySpeed = 1;
  victoryShown = false;
  curtain: HTMLElement | null = null;
  /** first-run coach marks (null for spectators until a seat exists) */
  coach: Coach | null = null;
  /** which collapsible panel sections are open (kept for the session, per section name) */
  openSecs = new Set<string>();
  tipEl: HTMLElement | null = null;
  /** Empire tab: the selected tech / law card, and (spectators) whose empire is shown */
  empFocus: EmpFocus = null;
  empPid: number | null = null;
  private ro: ResizeObserver | null = null;
  private timers = new Set<number>();
  private memo: { supSrc?: GameState; cut?: Set<number> | null; unsup?: Set<number>; visSrc?: number[]; vis?: Set<number>; laySrc?: Fleet[]; layPx?: number; lay?: Map<number, Pt>; hlKey?: string; hl?: Map<number, string> } = {};

  constructor(parent: HTMLElement, public src: GameSource, public onExit: () => void) {
    this.root = h('div', { class: 'game' });
    parent.appendChild(this.root);
    this.root.innerHTML = `
      <div class="topbar">
        <div class="logo">THREE CROWNS</div>
        <div class="turninfo"><b data-el="turn"></b><span data-el="phase"></span></div>
        <div class="res" data-el="res"></div>
        <div class="players" data-el="players"></div>
        <div class="toolbtns">
          <button class="small" data-act="panel" title="Show/hide the side panel (P)">▤</button>
          <button class="small" data-act="replay" title="Replay the last turn (R)">⟲ Replay</button>
          <button class="small" data-act="signals" title="Toggle intel signals on the map (I)">◎ Intel</button>
          <button class="small" data-act="help" title="How to play (H)">?</button>
          <button class="small" data-act="menu">☰</button>
        </div>
      </div>
      <div class="stage" data-el="stage">
        <canvas data-el="canvas"></canvas>
        <div class="panel left scroll hidden" data-el="left"></div>
        <div class="panel right" data-el="right">
          <div class="tabs" data-el="tabs"></div>
          <div class="tabbody scroll" data-el="tabbody"></div>
        </div>
        <div class="banner" data-el="banner"></div>
        <div class="modehint hidden" data-el="modehint"></div>
      </div>
      <div class="bottombar" data-el="bottombar">
        <div class="pulsebar" data-el="pulsebar"></div>
        <div class="ticker" data-el="ticker"></div>
        <div class="row" data-el="rcontrols"></div>
      </div>
      <div class="dock" data-el="dock"></div>
      <div class="tooltip hidden" data-el="tooltip"></div>`;
    this.root.querySelectorAll<HTMLElement>('[data-el]').forEach(e => (this.el[e.dataset.el!] = e));
    this.map = new MapRenderer(this.el.canvas as HTMLCanvasElement);
    this.plan = this.freshPlan();
    this.bindInput();
    this.root.querySelectorAll<HTMLButtonElement>('[data-act]').forEach(b => b.addEventListener('click', () => this.toolbar(b.dataset.act!)));
    src.onChange = k => this.onSourceChange(k);
    if (src instanceof LocalSource) src.onHandoff = seat => this.handoff(seat);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    // the stage can change size without a window resize (top bar wrapping, mobile URL bar)
    if ('ResizeObserver' in window) { this.ro = new ResizeObserver(() => this.onResize()); this.ro.observe(this.el.stage); }
    this.onResize();
    this.lastSeenTurn = this.readSeenTurn();
    this.prunePlans();
    this.onSourceChange('view');
    this.bindTips();
    this.coach = new Coach(this);
    this.coach.update();
    const loop = () => { if (this.destroyed) return; this.frame(); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.autoPlay = false;
    cancelAnimationFrame(this.raf);
    this.timers.forEach(t => clearTimeout(t));
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisible);
    this.ro?.disconnect();
    this.src.onChange = () => {};
    if (this.src instanceof LocalSource) this.src.onHandoff = () => {};
    this.src.close();
    this.curtain?.remove();
    this.coach?.destroy();
    this.tipEl?.remove();
    this.root.remove();
  }
  /** Info popovers for any [data-tip] element: hover with a mouse, tap on touch screens. */
  bindTips() {
    const t = this.tipEl = h('div', { class: 'uxtip hidden', role: 'tooltip' });
    document.body.appendChild(t);
    let shownFor: HTMLElement | null = null;
    const show = (el: HTMLElement) => {
      shownFor = el;
      t.textContent = el.dataset.tip ?? '';
      t.classList.remove('hidden');
      const r = el.getBoundingClientRect(), w = t.offsetWidth, hh = t.offsetHeight;
      let y = r.bottom + 6;
      if (y + hh > window.innerHeight - 8) y = r.top - hh - 6;
      t.style.left = `${Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)))}px`;
      t.style.top = `${Math.round(Math.max(8, y))}px`;
    };
    const hide = () => { shownFor = null; t.classList.add('hidden'); };
    this.root.addEventListener('pointerover', e => {
      // touch screens get the tip on tap instead (emulated mouse events after a tap must not pop it up)
      if (e.pointerType !== 'mouse' || window.matchMedia('(pointer: coarse)').matches) return;
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
      if (el) { if (el !== shownFor) show(el); } else if (shownFor) hide();
    });
    this.root.addEventListener('pointerleave', hide);
    // remember which collapsible sections are open across re-renders ('toggle' doesn't bubble: capture it)
    this.root.addEventListener('toggle', e => {
      const d = e.target as HTMLDetailsElement;
      const id = d.dataset?.sec;
      if (!id) return;
      if (d.open) this.openSecs.add(id); else this.openSecs.delete(id);
    }, true);
    // touch: tapping a number / ⓘ shows its breakdown (buttons keep their normal action)
    this.root.addEventListener('click', e => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
      const touch = this.phone || window.matchMedia('(pointer: coarse)').matches;
      if (el && touch && !el.closest('button, select, input')) { if (shownFor === el) hide(); else show(el); }
      else if (touch) hide();
    });
  }
  /** setTimeout that is cancelled when the screen is destroyed. */
  later(fn: () => void, ms: number) {
    const t = window.setTimeout(() => { this.timers.delete(t); if (!this.destroyed) fn(); }, ms);
    this.timers.add(t);
  }
  readSeenTurn(): number {
    let n = 0;
    try { n = Number(localStorage.getItem(this.seenTurnKey()) ?? 0) || 0; } catch { /* */ }
    // a value from the future belongs to an older game that reused this key
    return n >= this.st.turn ? 0 : n;
  }
  onVisible = () => { if (!document.hidden) { document.title = 'Three Crowns'; document.removeEventListener('visibilitychange', this.onVisible); } };

  // ================================================================== data helpers
  get st(): GameState { return this.src.view.state; }
  get you(): number | null { return this.src.view.you; }
  get submitted(): boolean { return !!this.src.mySubmission; }
  get canPlan(): boolean { return this.you !== null && (this.live || !this.submitted) && this.st.winner === null && !this.st.players[this.you].eliminated; }
  /** LIVE mode (real time, banked orders) instead of WEGO turns. */
  get live(): boolean { return !!this.st.live; }
  get bank(): number { return this.you !== null ? Math.max(0, this.st.live?.bank[this.you] ?? 0) : 0; }
  get queue(): Order[] { return this.you !== null ? this.st.live?.queue[this.you] ?? [] : []; }
  /** Free actions go into the plan (WEGO) or straight to the server (LIVE). */
  pushFree(fa: FreeAction) {
    if (this.live) { this.src.liveFree?.(fa); return; }
    this.plan.free.push(fa);
    this.savePlan();
  }
  /** Identity of this game for localStorage keys. Local games all share meta.id 'local', so add the save slot + seed. */
  gameKey() {
    if (this.src instanceof LocalSource) return `${this.src.storageKey}:${this.st.seed}`;
    return this.src.meta?.id ?? 'x';
  }
  seenTurnKey() { return `tc.seen.${this.gameKey()}.${this.you ?? 's'}`; }
  freshPlan(): Submission { return { orders: new Array(this.st.rules.orders.perTurn).fill(null), free: [] }; }
  planKey() { return `tc.plan.${this.gameKey()}.${this.you ?? 's'}.${this.st.turn}`; }
  savePlan() { this.planVersion++; try { localStorage.setItem(this.planKey(), JSON.stringify(this.plan)); } catch { /* */ } }
  /** Coerce a stored/submitted plan into the shape the UI expects (old saves, rule changes). */
  normalizePlan(p: unknown): Submission | null {
    if (!p || typeof p !== 'object' || !Array.isArray((p as Submission).orders)) return null;
    const n = this.st.rules.orders.perTurn;
    const orders = (p as Submission).orders.slice(0, n).map(o => (o && typeof o === 'object' && typeof (o as Order).type === 'string' && (o as Order).type in ORDER_INFO ? o : null));
    while (orders.length < n) orders.push(null);
    const free = Array.isArray((p as Submission).free) ? (p as Submission).free.filter(x => x && typeof x === 'object') : [];
    return { orders, free };
  }
  loadPlan() {
    this.planVersion++;
    try {
      const p = this.normalizePlan(JSON.parse(localStorage.getItem(this.planKey()) ?? 'null'));
      if (p) { this.plan = p; return; }
    } catch { /* */ }
    this.plan = this.freshPlan();
  }
  /** Drop stored plans of earlier turns of this game (they would otherwise pile up forever). */
  prunePlans() {
    try {
      const pre = `tc.plan.${this.gameKey()}.`;
      const drop: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith(pre) && Number(k.slice(k.lastIndexOf('.') + 1)) < this.st.turn) drop.push(k);
      }
      drop.forEach(k => localStorage.removeItem(k));
    } catch { /* */ }
  }
  color(o: number | null | undefined) { return o === null || o === undefined || o < 0 ? (o === -1 ? '#e7b6ff' : NEUTRAL_COLOR) : this.st.players[o]?.color ?? NEUTRAL_COLOR; }
  pname(o: number | null | undefined) { return o === null || o === undefined ? 'Neutral' : o < 0 ? (this.st.wardenAwake && !this.st.wardenDefeated ? 'Neutral / Warden' : 'Neutral') : this.st.players[o]?.name ?? '?'; }
  fleet(id: number) { return this.st.fleets.find(f => f.id === id); }
  doctrineOf(f: Fleet): Doctrine {
    const fa = [...this.plan.free].reverse().find(x => x.type === 'doctrine' && x.fleet === f.id);
    return fa && fa.type === 'doctrine' ? fa.doctrine : f.doctrine;
  }

  /** Fleet positions after orders in slots < k (assumes moves/seizes succeed; joining fleets move in too). */
  projected(k: number): Map<number, number> {
    const pos = new Map(this.st.fleets.map(f => [f.id, f.region]));
    for (let i = 0; i < Math.min(k, this.plan.orders.length); i++) {
      const o = this.plan.orders[i];
      if (!o) continue;
      if (o.type === 'move' && o.path.length) pos.set(o.fleet, o.path[o.path.length - 1]);
      if (o.type === 'seize') {
        pos.set(o.fleet, o.target);
        for (const id of o.also ?? []) if (pos.has(id)) pos.set(id, o.target);
      }
    }
    return pos;
  }
  /** Players with your pending free actions applied (research, revokes, blueprints): they happen before pulse I. */
  pendingPlayers(): Player[] {
    const you = this.you;
    if (you === null) return this.st.players;
    const free = this.live ? this.st.live?.free[you] ?? [] : this.plan.free;
    if (!free.some(x => x.type === 'research' || x.type === 'revoke' || x.type === 'blueprint')) return this.st.players;
    return this.st.players.map(p => {
      if (p.id !== you) return p;
      const q: Player = { ...p, techs: [...(p.techs ?? [])], laws: [...(p.laws ?? [])], blueprint: { ...(p.blueprint ?? {}) } };
      for (const fa of free) {
        if (fa.type === 'research' && !q.techs!.includes(fa.tech)) q.techs!.push(fa.tech);
        if (fa.type === 'revoke') q.laws = q.laws!.filter(x => x !== fa.law);
        if (fa.type === 'blueprint') q.blueprint![fa.cls] = fa.mod;
      }
      return q;
    });
  }
  projectedState(k: number): GameState {
    const s: GameState = { ...this.st, fleets: this.st.fleets.map(f => ({ ...f })), regions: this.st.regions, players: this.pendingPlayers() };
    const pos = this.projected(k);
    const uses = new Map<number, number>();
    for (let i = 0; i <= k && i < this.plan.orders.length; i++) {
      const o = this.plan.orders[i];
      if (!o || !('fleet' in o) || o.type === 'build') continue;
      for (const id of [o.fleet, ...(o.type === 'seize' && i < k ? o.also ?? [] : [])]) uses.set(id, (uses.get(id) ?? 0) + 1);
    }
    for (const f of s.fleets) { f.region = pos.get(f.id) ?? f.region; f.ordersThisTurn = uses.get(f.id) ?? 0; }
    return s;
  }
  validateAt(o: Order, k: number): string | null {
    if (this.you === null) return 'spectating';
    const s = this.projectedState(k);
    if ('fleet' in o && o.type !== 'build') { const f = s.fleets.find(x => x.id === o.fleet); if (f) f.ordersThisTurn = (f.ordersThisTurn || 0) + (this.plan.orders[k] === o ? 0 : 1); }
    return validateOrder(s, this.you, o);
  }
  plannedSpend() {
    const tot = { industry: 0, credits: 0, influence: 0 };
    if (this.you === null) return tot;
    const uses = new Map<number, number>();
    // research is bought before pulse I, so it comes out of the same purse first
    const pr = pendingResearch(this);
    if (pr && !this.live) { const c = techCost(this.st, this.you, pr); tot.industry += c.industry ?? 0; tot.credits += c.credits ?? 0; }
    for (const o of this.plan.orders) {
      if (!o) continue;
      const c = orderCost(this.st, o, this.you);
      tot.industry += c.industry ?? 0; tot.credits += c.credits ?? 0; tot.influence += c.influence ?? 0;
      const fl = 'fleet' in o && o.type !== 'build' ? [o.fleet, ...(o.type === 'seize' ? o.also ?? [] : [])] : [];
      for (const id of fl) {
        const u = uses.get(id) ?? 0;
        if (u > 0) tot.credits += this.st.rules.orders.repeatFleetCredits;
        uses.set(id, u + 1);
      }
    }
    return tot;
  }
  nextSlot(): number | null {
    if (this.targetSlot !== null) return this.targetSlot;
    const i = this.plan.orders.findIndex(o => !o);
    return i >= 0 ? i : null;
  }

  /** Why the player can't plan at all right now (null if they can). */
  planBlock(): string | null {
    if (this.you === null) return 'You are spectating.';
    if (this.st.winner !== null) return 'The game is over.';
    if (this.st.players[this.you]?.eliminated) return 'You have been eliminated.';
    if (!this.live && this.submitted) return 'Your orders are sealed. Unseal them to make changes.';
    return null;
  }
  /** Why this fleet can't take a new order right now (null if it can). */
  fleetBlock(f: Fleet): string | null {
    const b = this.planBlock();
    if (b) return b;
    if (f.owner !== this.you) return 'Not your fleet.';
    const o: Order = { type: 'fortify', fleet: f.id };
    if (this.live) {
      if (this.bank < 1) return `No orders banked. The next one arrives in ${fmtDur((this.st.live!.nextOrderAt[this.you!] ?? 0) - Date.now())}.`;
      const s2: GameState = { ...this.st, fleets: this.st.fleets.map(x => ({ ...x })), players: this.pendingPlayers() };
      for (const q of [...this.queue, o]) if ('fleet' in q && q.type !== 'build') { const x = s2.fleets.find(y => y.id === q.fleet); if (x) x.ordersThisTurn++; }
      return capFirst(validateOrder(s2, this.you!, o));
    }
    const k = this.nextSlot();
    if (k === null) return `All ${this.plan.orders.length} orders are used. Remove one in the Orders list first.`;
    return capFirst(this.validateAt(o, k));
  }

  /** Why this (non-fleet) order can't be given right now, or null: plan lock, slots/bank, then the rules. */
  orderWhy(o: Order): string | null {
    const b = this.orderBlock();
    if (b) return b;
    if (this.live) {
      const s2: GameState = { ...this.st, fleets: this.st.fleets.map(x => ({ ...x })), players: this.pendingPlayers() };
      for (const q of [...this.queue, o]) if ('fleet' in q && q.type !== 'build') { const x = s2.fleets.find(y => y.id === q.fleet); if (x) x.ordersThisTurn++; }
      return capFirst(validateOrder(s2, this.you!, o));
    }
    return capFirst(this.validateAt(o, this.nextSlot() ?? 0));
  }

  addOrder(o: Order) {
    if (!this.canPlan) return;
    if (this.live) {
      if (this.bank < 1) { toast(`No orders banked. The next one arrives in ${fmtDur((this.st.live!.nextOrderAt[this.you!] ?? 0) - Date.now())}.`); return; }
      const s2: GameState = { ...this.st, fleets: this.st.fleets.map(f => ({ ...f })), players: this.pendingPlayers() };
      for (const q of [...this.queue, o]) if ('fleet' in q && q.type !== 'build') { const f = s2.fleets.find(x => x.id === q.fleet); if (f) f.ordersThisTurn++; }
      const err = validateOrder(s2, this.you!, o);
      if (err) { toast(`Can't: ${err}`); return; }
      this.src.liveOrder?.(o);
      this.mode = null;
      if (this.phone) this.sel = null;
      this.flashOrder = performance.now();
      toast(`${ORDER_INFO[o.type].icon} ${describeOrder(this.st, o)}: happens at the next tick (in ${fmtDur(nextTickAt(this.st) - Date.now())}).`);
      this.renderAll();
      return;
    }
    const k = this.nextSlot();
    if (k === null) { toast(`All ${this.plan.orders.length} orders are used. Remove one first (that's the point!).`); return; }
    const err = this.validateAt(o, k);
    if (err) { toast(`Can't: ${err}`); return; }
    const spend = this.plannedSpend();
    const c = orderCost(this.st, o, this.you!);
    const res = this.st.players[this.you!].res;
    const after = { industry: res.industry - spend.industry, credits: res.credits - spend.credits, influence: res.influence - spend.influence };
    if (!canAfford(after, c, this.st.rules)) toast(`Warning: you can't afford that with your other orders (${costText(c)}). It will fail unless you free up resources.`);
    this.plan.orders[k] = o;
    this.targetSlot = null;
    this.mode = null;
    this.savePlan();
    if (this.phone) { this.sel = null; toast(`Pulse ${roman(k + 1)}: ${describeOrder(this.st, o)}`); }
    this.renderAll();
  }

  // ================================================================== source updates
  onSourceChange(k: string) {
    if (k === 'chat') { if (this.tab !== 'chat') this.unreadChat++; this.renderTabs(); if (this.tab === 'chat') this.renderTab(); return; }
    if (k === 'error') { toast(this.src.lastError); return; }
    if (k === 'meta') { this.renderTop(); if (this.tab === 'orders') this.renderTab(); return; }
    // full view
    backfillRules(this.st);
    if (!this.map.fitted && this.map.w > 0) {
      const cap = this.you !== null ? this.st.regions[this.st.players[this.you]?.capital]?.site : undefined;
      this.map.fit(this.st, cap);
    }
    // the seat may have changed (hotseat) or a new turn begun: re-read the seen marker and the plan
    const seenKey = this.seenTurnKey();
    if (seenKey !== this.lastSeenKey) { this.lastSeenKey = seenKey; this.lastSeenTurn = this.readSeenTurn(); }
    if (this.src.mySubmission) {
      // sealed: the submission is the truth (it may come from another device); keep it so unsealing restores it
      this.plan = this.normalizePlan(structuredClone(this.src.mySubmission)) ?? this.freshPlan();
      this.savePlan();
    } else this.loadPlan();
    if (this.sel?.kind === 'fleet' && !this.fleet(this.sel.id)) this.sel = null;
    if (this.sel?.kind === 'region' && !this.st.regions[this.sel.id]) this.sel = null;
    if (this.targetSlot !== null && this.targetSlot >= this.plan.orders.length) this.targetSlot = null;
    if (this.mode && (!this.canPlan || ('fleet' in this.mode && !this.fleet(this.mode.fleet)))) this.mode = null;
    const last = this.st.last;
    const news = this.empireNews();
    if (last && last.turn > this.lastSeenTurn && this.st.turn > 1 && this.src.kind === 'remote' && document.hidden) {
      document.title = `(!) Turn ${this.st.turn} · Three Crowns`;
      try { if ('Notification' in window && Notification.permission === 'granted') new Notification('Three Crowns', { body: `Turn ${last.turn} resolved. Your move, commander.` }); } catch { /* */ }
      document.removeEventListener('visibilitychange', this.onVisible);
      document.addEventListener('visibilitychange', this.onVisible);
    }
    if (this.live) {
      // LIVE: play each new tick as a quick, skippable animation (only if something visible happened)
      if (last && (last.tick ?? 0) > this.lastSeenTick) {
        const first = this.lastSeenTick === -1;
        this.lastSeenTick = last.tick ?? 0;
        const interesting = last.events.some(e => e.k === 'move' || e.k === 'battle' || e.k === 'capture' || e.k === 'destroyed' || e.k === 'build' || e.k === 'clash');
        if (!first && news.length && !document.hidden) {
          // live: research and laws land between ticks; announce them (yours as confirmation, rivals' as intel)
          for (const e of news.slice(0, 3)) { toast(eventText(this.st, e, this.you).replace(/<[^>]+>/g, '')); this.empireFx(e); }
        }
        if (!first && interesting && !this.replay && !document.hidden) { this.startReplay(last); const r = this.replay as { speed: number } | null; if (r) r.speed = Math.max(this.replaySpeed, 3); this.pulseFx(true); }
        else if (!this.replay) this.pulseFx();
      }
    } else if (last && last.turn > this.lastSeenTurn && this.st.turn > 1) {
      this.lastSeenTurn = last.turn;
      try { localStorage.setItem(seenKey, String(last.turn)); } catch { /* */ }
      // empire news (bought before pulse I) opens the replay; spectators already get the real events
      const known = new Set(last.events.filter(e => e.k === 'tech' || e.k === 'law').map(e => JSON.stringify([e.k, (e as { owner: number }).owner, e.k === 'tech' ? e.tech : e.law])));
      const extra = news.filter(e => !known.has(JSON.stringify([e.k, e.owner, e.k === 'tech' ? e.tech : e.law])));
      this.startReplay(extra.length ? { ...last, events: [...extra, ...last.events] } : last);
      // hotseat: don't play the replay behind the curtain
      if (this.replay && this.curtain) this.replay.playing = false;
    }
    this.renderAll();
    this.maybeShowVictory();
  }
  lastSeenKey = '';
  lastSeenTick = -1;
  /** LIVE tick: a soft ripple sweeps across the map from your capital (or the centre), and battles pulse, so the world feels alive. */
  pulseFx(rippleOnly = false) {
    const now = performance.now();
    if (!rippleOnly) for (const e of this.st.engagements ?? []) this.fx.push({ kind: 'battle', pos: this.st.regions[e.region].site, color: '#ffb36b', t0: now, dur: 900 });
    if (reducedMotion() || document.hidden) return;
    const st = this.st;
    const cap = this.you !== null ? st.regions[st.players[this.you]?.capital]?.site : undefined;
    let o = cap;
    if (!o) { let x = 0, y = 0; for (const r of st.regions) { x += r.site.x; y += r.site.y; } o = { x: x / Math.max(1, st.regions.length), y: y / Math.max(1, st.regions.length) }; }
    let far = 1;
    for (const r of st.regions) far = Math.max(far, Math.hypot(r.site.x - o.x, r.site.y - o.y));
    const vis = this.visibleSet();
    for (const r of st.regions) {
      if (r.kind === 'void' || (this.you !== null && !vis.has(r.id))) continue;
      const d = Math.hypot(r.site.x - o.x, r.site.y - o.y) / far;
      this.fx.push({ kind: 'ripple', pos: r.site, color: r.owner !== null ? this.color(r.owner) : '#b9a6ff', t0: now + d * 900, dur: 900, size: r.owner === this.you && this.you !== null ? 34 : 24 });
    }
  }

  maybeShowVictory() {
    if (this.st.winner === null || this.victoryShown || this.replay || this.curtain) return;
    this.victoryShown = true;
    this.later(() => this.showVictory(), 300);
  }

  handoff(seat: number) {
    const name = this.st.players[seat]?.name ?? '?';
    // the previous player is still looking: hide everything until the next player confirms
    this.sel = null; this.mode = null; this.targetSlot = null; this.hoverRegion = null;
    this.el.tooltip.classList.add('hidden');
    document.querySelectorAll('.overlay:not(.curtain)').forEach(x => x.remove());
    this.curtain?.remove();
    const o = overlay(`<div class="dialog" style="text-align:center"><h1 style="color:${this.color(seat)}">${esc(name)}</h1>
      <p>Hotseat: pass the device to <b>${esc(name)}</b>. Other players look away!</p><button class="primary" data-x>I am ${esc(name)}</button></div>`, false);
    o.classList.add('curtain');
    this.curtain = o;
    o.querySelector('[data-x]')!.addEventListener('click', () => {
      o.remove();
      if (this.curtain === o) this.curtain = null;
      if (this.replay) { this.replay.playing = true; this.replay.last = performance.now(); }
      this.renderAll();
      this.maybeShowVictory();
    });
  }

  // ================================================================== rendering
  renderAll() { this.renderTop(); this.renderTabs(); this.renderTab(); this.renderLeft(); this.renderBottom(); this.renderDock(); this.coach?.update(); }

  /** Phone layout: a full-screen map, one bottom sheet at a time, and a dock with the pulse slots + Seal. */
  get phone(): boolean { return window.matchMedia('(max-width: 700px)').matches; }
  sheetOpen = false;
  openSheet(tab?: Tab) {
    if (tab) this.tab = tab;
    if (this.tab === 'chat') this.unreadChat = 0;
    this.sheetOpen = true;
    if (this.phone) { this.sel = null; this.mode = null; }
    this.renderAll();
  }
  closeSheet() { this.sheetOpen = false; this.renderAll(); }

  renderDock() {
    const d = this.el.dock;
    this.root.classList.toggle('sheet-open', this.sheetOpen);
    this.root.classList.toggle('sel-open', !!this.sel);
    if (!this.phone) { d.innerHTML = ''; return; }
    if (this.live && this.you !== null && this.st.winner === null) {
      const cap = this.st.rules.live.bankCap;
      d.innerHTML = `<div class="pills livebank ${this.bank > 0 ? 'has' : ''}" data-d="sheet" role="button" aria-label="${this.bank} orders banked. Open the Orders panel">${Array.from({ length: cap }, (_, i) => `<span class="pip ${i < this.bank ? 'on' : ''}"></span>`).join('')}<small>${this.bank >= cap ? 'bank full' : `+1 in <b data-countdown="${this.st.live!.nextOrderAt[this.you] ?? 0}">${fmtDur((this.st.live!.nextOrderAt[this.you] ?? 0) - Date.now())}</b>`}</small></div>
        <button class="dockbtn" data-d="sheet" aria-label="Open panel">${this.sheetOpen ? '▾' : '▴'}</button>`;
    } else if (this.replay || this.you === null || this.st.winner !== null) {
      d.innerHTML = `<button class="dockbtn grow" data-d="sheet">${this.sheetOpen ? 'Hide panel ▾' : 'Intel · Chronicle · Score ▴'}</button>`;
    } else {
      const pills = this.plan.orders.map((o, i) => `<button class="pill ${o ? 'filled' : ''} ${this.nextSlot() === i && this.canPlan ? 'target' : ''}" data-pill="${i}"${o ? ` data-pop="dock:${i}:${o.type}:${'fleet' in o ? o.fleet : ''}"` : ''} aria-label="Pulse ${roman(i + 1)}${o ? ': ' + esc(describeOrder(this.st, o)) : ' (empty): tap a fleet or region to fill it'}"><small>${roman(i + 1)}</small>${o ? ORDER_INFO[o.type].icon : ''}</button>`).join('');
      const used = this.plan.orders.filter(Boolean).length;
      const seal = this.submitted
        ? `<button class="dockbtn" data-d="unseal" title="Your orders are sealed. Tap to change them.">✎ Sealed</button>`
        : `<button class="dockbtn primary ${this.canPlan && used === this.plan.orders.length ? 'ready' : ''}" data-d="seal" ${this.canPlan ? '' : `disabled title="${esc(this.planBlock() ?? '')}"`}>Seal${used < this.plan.orders.length ? ` <small>${used}/${this.plan.orders.length}</small>` : ''}</button>`;
      d.innerHTML = `<div class="pills">${pills}</div>${seal}<button class="dockbtn" data-d="sheet" aria-label="Open panel">${this.sheetOpen ? '▾' : '▴'}</button>`;
    }
    d.querySelectorAll<HTMLElement>('[data-pill]').forEach(b => b.addEventListener('click', () => {
      const i = Number(b.dataset.pill);
      if (this.plan.orders[i]) { this.targetSlot = null; this.openSheet('orders'); }
      else { this.targetSlot = this.targetSlot === i ? null : i; this.renderDock(); toast(`Next order goes into pulse ${roman(i + 1)}. Tap a fleet or region.`); }
    }));
    d.querySelector('[data-d="seal"]')?.addEventListener('click', () => this.submit());
    d.querySelector('[data-d="unseal"]')?.addEventListener('click', () => this.src.unsubmit());
    d.querySelectorAll('[data-d="sheet"]').forEach(x => x.addEventListener('click', () => (this.sheetOpen ? this.closeSheet() : this.openSheet('orders'))));
    this.tickClocks();
  }

  renderTop() {
    const st = this.st, meta = this.src.meta;
    this.el.turn.textContent = this.live ? (this.phone ? `● CYCLE ${st.turn}/${st.rules.victory.turnLimit}` : `● LIVE · CYCLE ${st.turn} / ${st.rules.victory.turnLimit}`) : `TURN ${st.turn} / ${st.rules.victory.turnLimit}`;
    this.el.turn.classList.toggle('livebadge', this.live);
    let phase = '';
    if (st.winner !== null) phase = `${this.pname(st.winner)} wins`;
    else if (this.live) phase = '';
    else if (this.replay) phase = this.replay.preview ? 'PREVIEW: rivals assumed idle' : `Replaying turn ${this.replay.result.turn}`;
    else if (this.you === null) phase = 'Spectating';
    else if (this.submitted) {
      const waiting = meta.seats.filter(s => !s.submitted).map(s => s.name);
      phase = waiting.length ? `Orders sealed. Waiting for ${waiting.join(', ')}` : 'Resolving…';
    } else {
      const used = this.plan.orders.filter(Boolean).length;
      phase = `Planning: ${used}/${this.plan.orders.length} orders`;
    }
    if (meta.deadline) {
      const ms = meta.deadline - Date.now();
      phase += ms > 0 ? ` · ${Math.floor(ms / 3600000)}h${String(Math.floor(ms / 60000) % 60).padStart(2, '0')} left` : ' · deadline passed';
    }
    if (this.live && st.winner === null) this.el.phase.innerHTML = `Next tick in <b data-countdown="${nextTickAt(st)}">${fmtDur(nextTickAt(st) - Date.now())}</b>${this.you !== null ? ` · <span class="bankmini"><span data-num="bank">${this.bank}</span> order${this.bank === 1 ? '' : 's'}</span>` : ''}`;
    else this.el.phase.textContent = phase;
    if (this.you !== null) {
      const p = st.players[this.you];
      const owned = st.regions.filter(r => r.owner === this.you);
      const det = incomeDetail(st, this.you), inc = det.total;
      // empire modifiers that bend the totals (laws, techs, traits, veins, supply): listed under each breakdown
      const E = st.rules.empire, on = E?.enabled !== false, me = this.you;
      const mods = { industry: [] as string[], credits: [] as string[], influence: [] as string[] };
      if (on) {
        const forge = owned.filter(r => r.trait === 'forge').length, gas = owned.filter(r => r.trait === 'gas').length;
        const conn = connected(st, me);
        const ext = owned.filter(r => r.vein && (r.buildings.extractor ?? 0) > 0 && conn.has(r.id)).length;
        if (forge) mods.industry.push(`${WORLD_TRAITS.forge.icon} ${forge} Forge World${forge > 1 ? 's' : ''}: +${E.forgePerDev} per development`);
        if (gas) mods.credits.push(`${WORLD_TRAITS.gas.icon} ${gas} Gas Giant${gas > 1 ? 's' : ''}: +${gas * E.gasCredits}`);
        if (ext) mods.credits.push(`${ext} Extractor${ext > 1 ? 's' : ''}: +${ext * E.extractorCredits}`);
        if (hasLaw(st, me, 'central')) for (const k of ['industry', 'credits', 'influence'] as const) mods[k].push(`${LAW.central.icon} Centralism: capital ×${E.centralMult}`);
        if (hasLaw(st, me, 'mercantile')) mods.credits.push(`${LAW.mercantile.icon} Mercantile: ×${E.mercantileMult}`);
        if (hasLaw(st, me, 'industrial')) { mods.industry.push(`${LAW.industrial.icon} Industrial: ×${E.industrialMult}`); mods.credits.push(`${LAW.industrial.icon} Industrial: ×${E.industrialCreditMult}`); }
        if (hasTech(st, me, 'markets')) mods.credits.push(`${TECH.markets.icon} Free Markets: ×${E.marketsCreditsMult}`);
        if (hasLaw(st, me, 'federal')) mods.influence.push(`${LAW.federal.icon} Federation: +1 per colony at development 3+`);
        if (hasLaw(st, me, 'open')) mods.influence.push(`${LAW.open.icon} Open Society: +${E.openInfluence}`);
        if (hasLaw(st, me, 'martial')) mods.influence.push(`${LAW.martial.icon} Martial Law: ${E.martialInfluence}`);
        if (hasTech(st, me, 'bureaucracy')) mods.influence.push(`${TECH.bureaucracy.icon} Bureaucracy: +2`);
        for (const w of det.why) for (const k of ['industry', 'credits', 'influence'] as const) if (k === 'credits' || !w.includes('¢')) mods[k].push(w);
      }
      const modTxt = (k: 'industry' | 'credits' | 'influence') => (mods[k].length ? `\n${mods[k].join('\n')}` : '');
      const upkeep = st.fleets.filter(f => f.owner === this.you).reduce((a, f) => a + f.ships.reduce((b, s) => b + (st.rules.ships[s.cls]?.upkeep ?? 0), 0), 0);
      const sp = this.plannedSpend();
      const per = this.live ? 'cycle' : 'turn';
      const mines = owned.reduce((a, r) => a + (r.buildings.mine ?? 0) * st.rules.economy.mineBonus, 0);
      const hubs = owned.reduce((a, r) => a + (r.buildings.tradehub ?? 0) * st.rules.economy.tradeHubBonus, 0);
      const cell = (icon: string, v: number, spend: number, inc: number, why: string) => {
        const key = icon === '⚙' ? 'industry' : icon === '¢' ? 'credits' : 'influence';
        const t = `${why}\nNow: ${v}${spend ? `, planned spend −${spend} → ${v - spend} left` : ''}${v - spend < 0 ? ' (SHORT: some orders will fail)' : ''}\nNet ${plus(inc)} per ${per}`;
        return `<div class="r"${tip(t)}><span>${icon} <span class="${v - spend < 0 ? 'bad' : ''}" data-num="res-${key}">${v - spend}</span>${spend ? `<small style="display:inline"> /${v}</small>` : ''}</span><small>${plus(inc)}/${per}</small></div>`;
      };
      this.el.res.innerHTML = cell('⚙', p.res.industry, sp.industry, inc.industry, `Industry ⚙: builds ships, projects and research.\nIncome: +${inc.industry} from ${owned.length} region${owned.length === 1 ? '' : 's'} (more with Develop)${mines ? `, incl. +${mines} from mines` : ''}.${modTxt('industry')}`) +
        cell('¢', p.res.credits, sp.credits, inc.credits - upkeep, `Credits ¢: upkeep, projects, and a fleet's 2nd order (+${st.rules.orders.repeatFleetCredits}¢). Spare credits cover an industry shortfall at ${hasTech(st, me, 'markets') ? 1 : st.rules.economy.creditsPerIndustry}¢ per ⚙.\nIncome: +${inc.credits}${hubs ? ` (incl. +${hubs} from trade hubs)` : ''}, −${upkeep} ship upkeep.${modTxt('credits')}`) +
        cell('✦', p.res.influence, sp.influence, inc.influence, `Influence ✦: Influence, Scan, Feint, Conceal, Pact and law orders.\nIncome: +${inc.influence} from your regions (capital gives most).${modTxt('influence')}`);
    } else this.el.res.innerHTML = '';
    const leader = currentLeader(st);
    this.el.players.innerHTML = st.players.map(p => {
      const s = meta.seats[p.id];
      // while replaying the last turn, show VP as it was before that turn
      const rt = this.replay && !this.replay.preview && this.replay.result.turn === st.turn - 1 ? this.replay.result.turn : null;
      const shownVp = rt !== null ? p.vp - p.vpLog.filter(v => v.turn === rt).reduce((a, v) => a + v.amount, 0) : p.vp;
      const lastVp = p.vpLog.filter(v => v.turn === st.turn - 1);
      const t = `${p.name}${s?.kind === 'ai' ? ` (AI ${s.aiLevel})` : ''}${p.id === this.you ? ' (you)' : ''}${p.eliminated ? ' (eliminated)' : ''}\n${p.vp} of ${st.rules.victory.vpTarget} VP to win${leader === p.id ? '\n♛ VP leader: taking their regions pays a bounty' : ''}${lastVp.length ? `\nLast ${this.live ? 'cycle' : 'turn'}: ${lastVp.map(v => `${plus(v.amount)} ${v.why}`).join(', ')}` : ''}${this.live ? '' : s?.submitted ? '\n✓ orders sealed' : '\n… still planning'}\nFull breakdown: Score tab`;
      return `<div class="pchip ${p.id === this.you ? 'you' : ''}" style="border-color:${esc(p.color)};color:${esc(p.color)}"${tip(t)}>
        <span class="dot ${s?.online ? 'on' : ''}"></span>
        <span style="color:var(--text)${p.eliminated ? ';text-decoration:line-through' : ''}">${esc(p.name)}</span>
        <span class="vp" data-num="vp-${p.id}">${shownVp}${leader === p.id && !this.replay ? ' ♛' : ''}</span>
        ${this.live ? '' : s?.submitted ? '<span>✓</span>' : '<span class="faint">…</span>'}
      </div>`;
    }).join('');
  }

  renderTabs() {
    const emp = this.st.rules.empire?.enabled !== false;
    const tabs: [Tab, string][] = [['orders', 'Orders'], ...(emp ? [['empire', 'Empire'] as [Tab, string]] : []), ['intel', 'Intel'], ['chronicle', 'Chronicle'], ['score', 'Score'], ['chat', 'Chat']];
    const canBuy = emp && this.canResearchNow();
    this.el.tabs.innerHTML = tabs.map(([k, n]) => `<button class="${this.tab === k ? 'on' : ''}" data-tab="${k}"${k === 'empire' && canBuy ? ' title="You can research a technology this turn"' : ''}>${n}${k === 'chat' && this.unreadChat ? `<span class="badge">${this.unreadChat}</span>` : ''}${k === 'intel' && this.st.last?.signals.length ? `<span class="badge" style="background:var(--accent)">${this.st.last.signals.length}</span>` : ''}${k === 'empire' && canBuy ? '<span class="dotbadge" aria-label="research available"></span>' : ''}</button>`).join('');
    if (this.phone) this.el.tabs.insertAdjacentHTML('beforeend', '<button class="sheetx" data-sheetx aria-label="Close">✕</button>');
    this.el.tabs.querySelector('[data-sheetx]')?.addEventListener('click', () => this.closeSheet());
    this.el.tabs.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b => b.addEventListener('click', () => {
      if (!this.phone && this.el.right.classList.contains('min')) this.el.right.classList.remove('min');
      this.tab = b.dataset.tab as Tab; if (this.tab === 'chat') this.unreadChat = 0; this.renderTabs(); this.renderTab();
    }));
  }

  renderTab() {
    const b = this.el.tabbody;
    switch (this.tab) {
      case 'orders': if (this.live) { b.innerHTML = this.liveHtml(); this.bindLive(); } else { b.innerHTML = this.ordersHtml(); this.bindOrders(); } break;
      case 'empire': b.innerHTML = empireHtml(this); bindEmpire(this); break;
      case 'intel': b.innerHTML = this.intelHtml(); break;
      case 'chronicle': b.innerHTML = this.chronicleHtml(); break;
      case 'score': b.innerHTML = this.scoreHtml(); b.querySelectorAll<HTMLElement>('[data-pact]').forEach(e => e.addEventListener('click', () => this.addOrder({ type: 'pact', with: Number(e.dataset.pact) }))); break;
      case 'chat': b.innerHTML = this.chatHtml(); this.bindChat(); break;
    }
    b.querySelectorAll<HTMLElement>('[data-battle]').forEach(e => e.addEventListener('click', ev => { ev.preventDefault(); this.openBattle(Number(e.dataset.battle)); }));
    b.querySelectorAll<HTMLElement>('[data-gotab]').forEach(e => e.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); this.tab = e.dataset.gotab as Tab; this.renderTabs(); this.renderTab(); }));
    b.querySelectorAll<HTMLElement>('[data-region]').forEach(e => e.addEventListener('click', () => { this.select({ kind: 'region', id: Number(e.dataset.region) }); this.focus(this.st.regions[Number(e.dataset.region)].site); }));
  }

  /** You could buy a technology right now (nothing queued yet, one affordable): the Empire tab shows a dot. */
  canResearchNow(): boolean {
    if (this.you === null || !this.canPlan || pendingResearch(this)) return false;
    const st = this.st, me = this.you, p = st.players[me];
    if ((p.researched ?? 0) >= st.rules.empire.researchPerTurn) return false;
    const sp = this.live ? { industry: 0, credits: 0, influence: 0 } : this.plannedSpend();
    const left = { industry: p.res.industry - sp.industry, credits: p.res.credits - sp.credits, influence: p.res.influence - sp.influence };
    return Object.keys(TECH).some(id => !researchBlock(st, me, id) && canAfford(left, techCost(st, me, id), creditRate(st, me)));
  }

  /** A collapsible secondary section; its open state is remembered for the session. */
  sec(id: string, title: string, body: string, sum = ''): string {
    return `<details class="sec" data-sec="${id}"${this.openSecs.has(id) ? ' open' : ''}><summary>${title}${sum ? `<span class="sum">${sum}</span>` : ''}</summary><div class="sb">${body}</div></details>`;
  }

  ordersHtml(): string {
    const st = this.st;
    if (this.you === null) return `<p class="dim">You are spectating this game.</p>`;
    const sp = this.plannedSpend();
    const verb = this.phone ? 'Tap' : 'Click';
    const n = this.plan.orders.length, used = this.plan.orders.filter(Boolean).length;
    const slots = this.plan.orders.map((o, i) => {
      const err = o && this.canPlan ? this.validateAt(o, i) : null;
      const c: Partial<Record<'industry' | 'credits' | 'influence', number>> = o ? { ...orderCost(st, o, this.you!) } : {};
      let repeat = false;
      if (o && 'fleet' in o && o.type !== 'build' && this.plan.orders.slice(0, i).some(x => x && 'fleet' in x && x.type !== 'build' && x.fleet === o.fleet)) { c.credits = (c.credits ?? 0) + st.rules.orders.repeatFleetCredits; repeat = true; }
      if (o && o.type === 'seize') for (const id of o.also ?? []) if (this.plan.orders.slice(0, i).some(x => x && 'fleet' in x && x.type !== 'build' && x.fleet === id)) { c.credits = (c.credits ?? 0) + st.rules.orders.repeatFleetCredits; repeat = true; }
      const target = this.nextSlot() === i && this.canPlan;
      const costTip = `${ORDER_INFO[o?.type ?? 'move'].help}${repeat ? `\nIncludes +${st.rules.orders.repeatFleetCredits}¢: this fleet already has an earlier order this turn.` : ''}`;
      return `<div class="slot ${o ? 'filled' : 'empty'} ${target ? 'target' : ''} ${err ? 'invalid' : ''}" data-slot="${i}"${o ? ` data-pop="slots:${i}:${esc(JSON.stringify(o))}"` : ''} title="${o ? '' : target ? 'The next order goes into this pulse' : 'Click to put the next order into this pulse'}">
        <div class="num">${roman(i + 1)}</div>
        <div class="desc">${o ? `${ORDER_INFO[o.type].icon} ${esc(describeOrder(st, o))}<small><span${tip(costTip)}>${costText(c) || 'free'}</span>${err ? ` · <span class="bad">${esc(err)}</span>` : ''}</small>${o.type === 'seize' && this.canPlan ? this.oddsHtml(o, i) + this.joinChips(o, i) : ''}` : target ? `${verb} a fleet or region to give an order` : 'empty'}</div>
        <div class="acts">${o && this.canPlan ? `<button data-up="${i}" title="Move to an earlier pulse" ${i === 0 ? 'disabled' : ''}>▲</button><button data-down="${i}" title="Move to a later pulse" ${i === n - 1 ? 'disabled' : ''}>▼</button><button data-del="${i}" title="Remove this order">✕</button>` : ''}</div>
      </div>`;
    }).join('');
    const free = this.plan.free.length ? this.sec('free', 'Free changes', `<div class="feed">${this.plan.free.map((x, i) => `<div class="entry row" style="font-size:12px"><span class="grow">${esc(this.freeText(x))}${x.type === 'research' && this.you !== null ? ` <span class="faint">· ${costText(techCost(st, this.you, x.tech))}</span>` : ''}</span>${this.canPlan ? `<button class="small" data-delfree="${i}" title="Remove">✕</button>` : ''}</div>`).join('')}</div>`, `${this.plan.free.length} · no order needed`) : '';
    const seats = this.src.meta.seats.map(s => `<span style="color:${this.color(s.seat)}">${esc(s.name)} ${s.submitted ? '✓' : '…'}</span>`).join(' · ');
    const res = st.players[this.you].res;
    const shortOf = (k: 'industry' | 'credits' | 'influence') => sp[k] > res[k] ? 'bad' : '';
    const costs = used ? `<div class="costs"${tip(`Planned spend vs. what you have now:\n⚙ ${sp.industry} of ${res.industry} · ¢ ${sp.credits} of ${res.credits} · ✦ ${sp.influence} of ${res.influence}\nA fleet's 2nd order adds ${st.rules.orders.repeatFleetCredits}¢. An order you can't pay for when its pulse comes fails.`)}>Spend <span class="${shortOf('industry')}">${sp.industry}⚙</span><span class="${shortOf('credits')}">${sp.credits}¢</span><span class="${shortOf('influence')}">${sp.influence}✦</span><i class="ip">i</i></div>` : '';
    const block = this.planBlock();
    const seal = this.submitted
      ? `<button data-unsubmit class="grow" title="Take your orders back to change them">✎ Unseal orders</button>`
      : `<button class="primary ${this.canPlan && used === n ? 'ready' : ''}" data-submit ${this.canPlan ? '' : `disabled title="${esc(block ?? '')}"`}>Seal orders${used < n ? ` · ${used}/${n}` : ''}<span class="kbd kh">Ctrl+⏎</span></button>`;
    const row = `<div class="sealrow">${seal}</div><div class="subacts">
        <button data-preview ${this.canPlan && used ? '' : 'disabled'} title="${this.canPlan && !used ? 'Add an order first, then Preview it' : "Preview: simulate your plan as if rivals hold still (they won't!)"}" aria-label="Preview">👁${this.phone ? '' : ' Preview'}</button>
        <button data-conceal ${this.canPlan ? '' : 'disabled'} title="${esc(ORDER_INFO.conceal.help)} (${costText(orderCost(st, { type: 'conceal' }, this.you!))})" aria-label="Conceal">☾</button>
        <button data-clear ${this.canPlan && (used || this.plan.free.length) ? '' : 'disabled'} title="Clear all orders">Clear</button></div>
      ${this.submitted ? `<span class="note">Sealed. You can unseal until everyone else has sealed.</span>` : block ? `<span class="why">${esc(block)}</span>` : ''}`;
    const how = this.sec('howorders', 'How orders work', `<div class="orderhelp">You get <b>${st.rules.orders.perTurn} orders</b> per turn for your whole empire. The order in slot <b>${roman(1)}</b> resolves in pulse ${roman(1)} for everyone at once, and so on. Fleets and regions you don't order still defend themselves.</div>
      <div class="orderhelp">Max <b>${st.rules.orders.maxPerFleet}</b> orders per fleet; a fleet's second order costs ${st.rules.orders.repeatFleetCredits}¢.</div>
      <div class="orderhelp">${verb} one of <b>your fleets</b> for Move / Seize / Fortify / Excavate and its doctrine. ${verb} a <b>region</b> for Build / Develop, or Influence / Scan / Feint. ${verb} a slot to put the next order into that pulse${this.phone ? '' : ' (or press <span class="kbd">1</span>–<span class="kbd">5</span>). <span class="kbd">Esc</span> cancels'}.</div>`);
    const tips = this.canPlan ? this.advisorHtml() : '';
    const head = `<div class="ohead"><h2>Turn ${st.turn}</h2><span class="n"><b>${used}</b>/${n} orders</span></div>`;
    if (this.phone) return `${head}<div class="slots" style="margin-top:8px">${slots}</div>${costs}${row}${tips}${free}<div class="seats">${seats}</div>${how}`;
    return `${head}${tips}<div class="slots" style="margin-top:8px">${slots}</div>${costs}${row}${free}<div class="seats">${seats}</div>${how}`;
  }

  /** LIVE mode Orders tab: the bank, what's queued for the next tick, fleets on the move. */
  liveHtml(): string {
    const st = this.st, L = st.live!;
    if (this.you === null) return `<p class="dim">You are spectating this live game.</p>`;
    const cap = st.rules.live.bankCap;
    const verb = this.phone ? 'Tap' : 'Click';
    const pips = Array.from({ length: cap }, (_, i) => `<span class="pip ${i < this.bank ? 'on' : ''}"></span>`).join('');
    const nextOrder = L.nextOrderAt[this.you] ?? 0;
    const queue = this.queue.map((o, i) => `<div class="slot filled live-q" data-pop="liveq:${i}:${esc(JSON.stringify(o))}"><div class="num">⏳</div><div class="desc">${ORDER_INFO[o.type].icon} ${esc(describeOrder(st, o))}<small>at the next tick · ${costText(orderCost(st, o, this.you!)) || 'no resource cost'}</small></div>
      <div class="acts"><button data-cancel="${i}" title="Take it back (refunds the order)">✕</button></div></div>`).join('');
    const moving = st.fleets.filter(f => f.owner === this.you && f.route).map(f => {
      const eta = etaTicks(st, f.id);
      const dest = f.route!.path.length ? f.route!.path[f.route!.path.length - 1] : f.region;
      return `<div class="entry row click" data-fleet="${f.id}"><span class="grow">➤ <b>${esc(f.name)}</b> → ${esc(st.regions[dest]?.name ?? '?')}${f.route!.seize !== null ? ' <span class="gold">(to seize)</span>' : ''}<br><span class="faint"${tip(`${eta ?? 0} tick${eta === 1 ? '' : 's'} to go at speed ${fleetSpeed(st, f)} (one tick every ${fmtDur(tickMs(st))}). Halting is free.`)}>arrives in ~${eta !== null ? fmtDur(eta * tickMs(st) - (Date.now() - (nextTickAt(st) - tickMs(st)))) : 'now'}</span></span><button class="small" data-halt="${f.id}" title="Stop where it is (free)">Halt</button></div>`;
    }).join('');
    const block = this.planBlock();
    return `<div class="bank ${this.bank >= cap ? 'full' : ''} ${this.bank > 0 && this.canPlan ? 'has' : ''}">
        <div class="row"><b class="grow">Orders banked${ip(`You earn one order every ${fmtDur(orderMs(st))}, up to ${cap}. Spending one queues it for the next tick; ✕ takes it back (refunded). A full bank wastes new orders.`)}</b><span class="bankn">${this.bank}<small>/${cap}</small></span></div>
        <div class="pips">${pips}</div>
        <div class="faint" style="font-size:12px">${this.bank >= cap ? '<span class="gold">Bank full: spend an order or the next one is wasted.</span>' : `+1 order in <b data-countdown="${nextOrder}">${fmtDur((nextOrder) - Date.now())}</b>`}</div>
        ${block ? `<span class="why">${esc(block)}</span>` : this.bank > 0 ? `<span class="note" style="color:var(--gold)">${verb} a glowing fleet or a region to spend one.</span>` : ''}
      </div>
      <div class="tick row"><span class="grow">Next tick in <b data-countdown="${nextTickAt(st)}">${fmtDur((nextTickAt(st)) - Date.now())}</b>${ip(`Each tick is one pulse: fleets advance, battles fight, builds finish. Every ${st.rules.live.ticksPerCycle} ticks a cycle ends: income, upkeep, scoring and edicts (like a WEGO turn).`)}</span><span class="faint">tick ${tickInCycle(st) + 1}/${st.rules.live.ticksPerCycle} · cycle ${st.turn}</span></div>
      ${this.advisorHtml()}
      ${queue ? `<h3>Happening at the next tick</h3><div class="slots">${queue}</div>` : ''}
      ${moving ? `<h3>Fleets on the move</h3><div class="feed">${moving}</div>` : ''}
      ${this.sec('howlive', 'How live mode works', `<div class="orderhelp">${verb} one of <b>your fleets</b> or a <b>region</b> to spend an order. Orders happen at the next tick, then fleets travel in real time. Moves can go any distance; Halt is free. Doctrine, splits, merges and renames cost nothing.</div>`)}`;
  }
  bindLive() {
    const b = this.el.tabbody;
    b.querySelectorAll<HTMLElement>('[data-cancel]').forEach(e => e.addEventListener('click', () => this.src.liveCancel?.(Number(e.dataset.cancel))));
    b.querySelectorAll<HTMLElement>('[data-halt]').forEach(e => e.addEventListener('click', ev => { ev.stopPropagation(); this.src.liveHalt?.(Number(e.dataset.halt)); }));
    b.querySelectorAll<HTMLElement>('[data-fleet]').forEach(e => e.addEventListener('click', () => this.select({ kind: 'fleet', id: Number(e.dataset.fleet) })));
  }
  /** An own fleet that could act right now and hasn't been given anything to do: it glows. */
  isIdle(f: Fleet): boolean {
    if (f.owner !== this.you || !this.canPlan || this.replay) return false;
    if (this.live) return this.bank > 0 && !f.route && !this.queue.some(o => 'fleet' in o && o.type !== 'build' && o.fleet === f.id) && f.siege !== f.region;
    return this.plan.orders.some(o => !o) && !this.plan.orders.some(o => o && 'fleet' in o && o.type !== 'build' && (o.fleet === f.id || (o.type === 'seize' && o.also?.includes(f.id)))) && f.siege !== f.region;
  }
  /** Refresh every [data-countdown] in the UI (cheap; called ~once a second). */
  tickClocks() {
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-countdown]')) el.textContent = fmtDur(Number(el.dataset.countdown) - Date.now());
  }

  freeText(x: Submission['free'][number]): string {
    const fn = (id: number) => this.fleet(id)?.name ?? `fleet #${id}`;
    switch (x.type) {
      case 'doctrine': return `${fn(x.fleet)}: doctrine ${x.doctrine.stance}, retreat ${Math.round(x.doctrine.retreatAt * 100)}%${x.doctrine.guard ? ', guard' : ''}`;
      case 'rename': return `Rename ${fn(x.fleet)} to “${x.name}”`;
      case 'merge': return `Merge ${fn(x.fleet)} into ${fn(x.into)}`;
      case 'split': return `Split ${x.ships.length} ship(s) off ${fn(x.fleet)}`;
      default: return empireFreeText(x, cls => this.st.rules.ships[cls]?.name ?? cls) ?? (x as { type: string }).type;
    }
  }

  /** Estimated odds of a seize, from the same predictor the AI uses. */
  odds(fleetIds: number[], target: number, slot: number): { p: number; note: string } | null {
    if (this.you === null) return null;
    try {
      const ps = this.projectedState(slot);
      const r = predictAssault(ps, this.you, fleetIds, target);
      return { p: r.p, note: r.note };
    } catch { return null; }
  }
  oddsHtml(o: Extract<Order, { type: 'seize' }>, slot: number): string {
    const r = this.odds([o.fleet, ...(o.also ?? [])], o.target, slot);
    if (!r) return '';
    const pct = Math.round(r.p * 100);
    return `<small>Odds ≈ <span class="odds ${pct >= 65 ? 'hi' : pct >= 40 ? 'mid' : 'lo'}">${pct}%</span>${r.note ? ` · ${esc(r.note)}` : ''} <span class="faint">(vs. what you can see)</span></small>`;
  }

  /** Toggle chips for fleets that can join a seize (combined assault). */
  joinChips(o: Extract<Order, { type: 'seize' }>, slot: number): string {
    const pos = this.projected(slot);
    const t = this.st.regions[o.target];
    const near = (f: Fleet) => pos.get(f.id) === o.target || t.neighbors.includes(pos.get(f.id) ?? -1);
    // always list fleets already joined (even if a reorder made them ineligible) so they can be removed
    const ok = this.st.fleets.filter(f => f.owner === this.you && f.id !== o.fleet && f.ships.length && (near(f) || o.also?.includes(f.id)));
    const gone = (o.also ?? []).filter(id => !this.fleet(id));
    if (!ok.length && !gone.length) return '';
    return `<small>Join assault: ${ok.map(f => `<button class="small ${o.also?.includes(f.id) ? 'active' : ''}" data-join="${slot}:${f.id}" title="${f.ships.length} ships, power ${fleetPower(this.st, f)}. Uses one of this fleet's ${this.st.rules.orders.maxPerFleet} actions${near(f) ? '' : '. NOT adjacent at this pulse: it will not join'}">${(o.also?.includes(f.id) ? '✓ ' : '+ ') + esc(f.name)}${near(f) ? '' : ' ⚠'}</button>`).join(' ')}${gone.map(id => `<button class="small active" data-join="${slot}:${id}" title="This fleet no longer exists">✓ fleet #${id} ⚠</button>`).join(' ')}</small>`;
  }

  /** Short "this turn" hints, most urgent first: the top 3 show, the rest fold away. */
  advisorHtml(): string {
    const st = this.st, you = this.you!;
    const tips: { p: number; t: string; r?: number }[] = [];
    for (const e of st.engagements ?? []) {
      const r = st.regions[e.region];
      const mine = st.fleets.some(f => f.owner === you && f.region === r.id) || r.owner === you;
      if (mine) tips.push({ p: 1, r: r.id, t: `⚔ <b>${esc(e.name)}</b> rages on (round ${e.rounds}). Ships you send there join the fight.` });
    }
    for (const r of st.regions.filter(x => x.owner === you && (x.kind === 'home' || x.kind === 'crown' || x.kind === 'throne'))) {
      const threat = st.fleets.filter(f => f.owner !== you && f.ships.length && (f.region === r.id || r.neighbors.includes(f.region)) && !st.pacts.some(p => p.until >= st.turn && [p.a, p.b].includes(f.owner) && [p.a, p.b].includes(you)));
      if (threat.length) tips.push({ p: 0, r: r.id, t: `⚠ ${threat.reduce((a, f) => a + f.ships.length, 0)} hostile ship(s) near <b>${esc(r.name)}</b>. Fortify, guard, or reinforce?` });
    }
    for (const f of st.fleets.filter(x => x.owner === you)) {
      const r = st.regions[f.region];
      if (r.relic === 'unclaimed' && r.owner === you) tips.push({ p: 2, r: r.id, t: `✧ <b>${esc(f.name)}</b> can <b>Excavate</b> the relic at ${esc(r.name)} (+${st.rules.victory.vpPerRelic} VP and a bonus).` });
    }
    const relicNear = st.regions.filter(r => r.relic === 'unclaimed' && r.owner === null && r.neighbors.some(n => st.regions[n].owner === you));
    if (relicNear.length) tips.push({ p: 4, r: relicNear[0].id, t: `✧ Unclaimed relic next door at <b>${esc(relicNear[0].name)}</b>. Seize it, then Excavate.` });
    const w = st.fleets.find(f => f.owner === -1);
    if (w) tips.push({ p: 3, r: w.region, t: `☠ The Warden is at <b>${esc(st.regions[w.region].name)}</b> and hunts the VP leader.` });
    const pending = this.live ? this.queue : this.plan.orders;
    const yard = st.regions.find(r => r.owner === you && (r.buildings.shipyard ?? 0) > 0);
    if (yard && !pending.some(o => o?.type === 'build') && st.players[you].res.industry >= 20) tips.push({ p: 5, r: yard.id, t: `⚙ Your shipyard at <b>${esc(yard.name)}</b> is idle${this.live ? '' : ' this turn'}.` });
    if (st.rules.empire?.enabled !== false) {
      const conn = connected(st, you), sup = supplied(st, you, conn);
      const cut = st.regions.filter(r => r.owner === you && !conn.has(r.id));
      if (cut.length) tips.push({ p: 1, r: cut[0].id, t: `✂ <b>${esc(cut[0].name)}</b>${cut.length > 1 ? ` and ${cut.length - 1} more` : ''} cut off from your capital: half yield until you link it back.` });
      const oos = st.fleets.filter(f => f.owner === you && f.ships.length && !sup.has(f.region));
      if (oos.length) tips.push({ p: 2, r: oos[0].region, t: `⛽ <b>${esc(oos[0].name)}</b>${oos.length > 1 ? ` and ${oos.length - 1} more` : ''} out of supply: no repairs, then wear.` });
      if (this.canResearchNow()) tips.push({ p: 5, t: `⚗ You can research a technology this ${this.live ? 'cycle' : 'turn'} (no order needed). <a href="#" data-gotab="empire">Open Empire</a>` });
    }
    for (const e of st.edicts) tips.push({ p: 6, t: `📜 Edict <b>${esc(e.name)}</b>: ${esc(e.desc)} (${e.vp} VP, judged end of ${this.live ? 'cycle' : 'turn'} ${e.scoresTurn})` });
    if (st.turn === 1 && (this.coach ? !this.coach.active : tutorialDone(this.live))) tips.push({ p: 7, t: this.live
      ? '👋 Spend banked orders any time: Seize a neighbouring colony, or Build a ship. They act at the next tick.'
      : '👋 First turn: Seize a neighbouring colony, Move a scout outward, Build a ship. Then Seal.' });
    if (!tips.length) return '';
    tips.sort((a, b) => a.p - b.p);
    const row = (x: { t: string; r?: number }) => `<div class="entry${x.r !== undefined ? ' click' : ''}"${x.r !== undefined ? ` data-region="${x.r}" title="Show on the map"` : ''}>${x.t}</div>`;
    const rest = tips.slice(3);
    return `<div class="feed tips">${tips.slice(0, 3).map(row).join('')}</div>${rest.length ? this.sec('moretips', `${rest.length} more tip${rest.length > 1 ? 's' : ''}`, `<div class="feed tips">${rest.map(row).join('')}</div>`) : ''}`;
  }

  bindOrders() {
    const b = this.el.tabbody;
    b.querySelectorAll<HTMLElement>('[data-join]').forEach(e => e.addEventListener('click', ev => {
      ev.stopPropagation();
      const [slot, fid] = e.dataset.join!.split(':').map(Number);
      const o = this.plan.orders[slot];
      if (!o || o.type !== 'seize') return;
      if (!this.canPlan) return;
      const set = new Set(o.also ?? []);
      if (set.has(fid)) set.delete(fid); else set.add(fid);
      o.also = [...set];
      if (!o.also.length) delete o.also;
      this.savePlan(); this.renderAll();
    }));
    b.querySelectorAll<HTMLElement>('[data-slot]').forEach(e => e.addEventListener('click', ev => {
      if ((ev.target as HTMLElement).closest('button')) return;
      const i = Number(e.dataset.slot);
      this.targetSlot = this.targetSlot === i ? null : i;
      this.renderTab();
    }));
    const swap = (i: number, j: number) => {
      if (!this.canPlan || j < 0 || j >= this.plan.orders.length) return;
      [this.plan.orders[i], this.plan.orders[j]] = [this.plan.orders[j], this.plan.orders[i]];
      this.savePlan(); this.renderAll();
    };
    b.querySelectorAll<HTMLElement>('[data-up]').forEach(e => e.addEventListener('click', () => swap(Number(e.dataset.up), Number(e.dataset.up) - 1)));
    b.querySelectorAll<HTMLElement>('[data-down]').forEach(e => e.addEventListener('click', () => swap(Number(e.dataset.down), Number(e.dataset.down) + 1)));
    b.querySelectorAll<HTMLElement>('[data-del]').forEach(e => e.addEventListener('click', () => { this.plan.orders[Number(e.dataset.del)] = null; this.savePlan(); this.renderAll(); }));
    b.querySelectorAll<HTMLElement>('[data-delfree]').forEach(e => e.addEventListener('click', () => { this.plan.free.splice(Number(e.dataset.delfree), 1); this.savePlan(); this.renderAll(); }));
    b.querySelector('[data-submit]')?.addEventListener('click', () => this.submit());
    b.querySelector('[data-unsubmit]')?.addEventListener('click', () => this.src.unsubmit());
    b.querySelector('[data-clear]')?.addEventListener('click', () => { if (!this.plan.orders.some(Boolean) && !this.plan.free.length) return; if (!confirm('Clear all planned orders and free changes?')) return; this.plan = this.freshPlan(); this.savePlan(); this.renderAll(); });
    b.querySelector('[data-preview]')?.addEventListener('click', () => this.preview());
    b.querySelector('[data-conceal]')?.addEventListener('click', () => this.addOrder({ type: 'conceal' }));
  }

  /** Ghost planner: run the real resolver on your fogged view, rivals giving no orders. */
  preview() {
    if (this.you === null || !this.canPlan) return;
    try {
      const st = structuredClone(this.st);
      if (!st.rngState) st.rngState = (st.seed ^ st.turn) >>> 0;
      // fogged values are -1 in a player's view: give the resolver plausible numbers instead
      for (const r of st.regions) if (r.garrison < 0) r.garrison = maxGarrison(st, r.id);
      for (const p of st.players) if (p.id !== this.you) for (const k of ['industry', 'credits', 'influence'] as const) if (p.res[k] < 0) p.res[k] = 999;
      const subs: Record<number, Submission> = {};
      for (const p of st.players) subs[p.id] = p.id === this.you ? structuredClone(this.plan) : emptySubmission(st);
      const res = resolveTurn(st, subs).last;
      if (!res) return;
      this.startReplay(res, true);
      if (!this.replay) { toast('Preview: nothing visible happens with this plan.'); return; }
      this.banner('PREVIEW');
      toast('Preview: rivals are assumed to sit still. Dice may differ. Nothing is submitted.');
    } catch (e) { toast(`Preview failed: ${e}`); }
  }

  submit() {
    if (!this.canPlan) return;
    const used = this.plan.orders.filter(Boolean).length;
    const go = () => {
      this.mode = null;
      this.src.submit(structuredClone(this.plan));
      if (this.src.kind === 'remote' && 'Notification' in window && Notification.permission === 'default') void Notification.requestPermission();
    };
    if (used < this.plan.orders.length) {
      const o = overlay(`<div class="dialog"><h2>Seal with ${used}/${this.plan.orders.length} orders?</h2><p class="dim">Unused orders are wasted. Your fleets will still follow their doctrines.</p>
        <div class="row"><button class="primary" data-y>Seal anyway</button><button data-n>Keep planning</button></div></div>`);
      o.querySelector('[data-y]')!.addEventListener('click', () => { o.remove(); go(); });
      o.querySelector('[data-n]')!.addEventListener('click', () => o.remove());
    } else go();
  }

  intelHtml(): string {
    const last = this.st.last;
    const sig = last?.signals ?? [];
    const scans = this.st.scans.filter(s => s.owner === this.you);
    const fails = (last?.events ?? []).filter(e => e.k === 'fail' && e.owner === this.you) as Extract<GameEvent, { k: 'fail' }>[];
    return `<h2>Intel: Turn ${last?.turn ?? '-'}</h2>
      ${this.sec('aboutintel', 'About signals', `<div class="orderhelp">Every order leaves traces. Within your sensor range you see where rival fleets moved, when they arrived and roughly how big they were (small/medium/large). <i>Inferred</i> signals may be feints. Toggle${this.phone ? ' them in ☰ Menu' : ' <span class="kbd">I</span>'} to draw them on the map.</div>`)}
      ${scans.length ? `<div class="dim" style="font-size:13px">Active scans: ${scans.map(s => esc(this.st.regions[s.region].name)).join(', ')}</div>` : ''}
      <div class="feed">${sig.length ? sig.map(s => `<div class="entry signal ${esc(s.confidence)} click" data-region="${Number(s.region)}" style="border-left-color:${esc(this.color(s.about))}">
        <div class="t">PULSE ${roman(s.pulse)} · ${s.about === null ? 'UNKNOWN ORIGIN' : esc(this.pname(s.about).toUpperCase())} · ${esc(String(s.confidence).toUpperCase())}</div>${esc(s.text)}</div>`).join('') : '<div class="faint">No signals detected last turn.</div>'}</div>
      ${fails.length ? `<h3>Your failed orders</h3><div class="feed">${fails.map(f => `<div class="entry" style="border-left-color:var(--bad)"><div class="t">PULSE ${roman(f.pulse)}</div>${esc(f.text)}</div>`).join('')}</div>` : ''}`;
  }

  chronicleHtml(): string {
    const ch = this.st.chronicle.slice().reverse();
    const battles = this.st.last?.battles ?? [];
    const mem = this.st.regions.flatMap(r => r.memorials.map(m => ({ r, m })));
    return `${battles.length ? `<h2>Battles last turn</h2><div class="feed">${battles.map(b => `<div class="entry click major" data-battle="${b.id}"><div class="t">PULSE ${roman(b.pulse)} · ${b.sides.map(s => esc(this.pname(s.owner))).join(' vs ')}</div>▶ ${esc(b.name)}<br><span class="dim">${Object.entries(b.losses).map(([o, n]) => `${esc(this.pname(Number(o)))} lost ${n}`).join(', ') || 'no ships lost'}${b.winner !== null ? ` · winner: ${esc(this.pname(b.winner))}` : ''}</span></div>`).join('')}</div>` : ''}
      <h2 style="margin-top:10px">Chronicle</h2>
      <div class="feed">${ch.map(c => `<div class="entry ${c.major ? 'major' : ''} ${c.region !== undefined ? 'click' : ''}" ${c.region !== undefined ? `data-region="${c.region}"` : ''}><div class="t">TURN ${c.turn}</div>${esc(c.text)}</div>`).join('')}</div>
      ${mem.length ? `<h3>Memorials</h3><div class="feed">${mem.map(x => `<div class="entry click" data-region="${x.r.id}"><div class="t">${esc(x.r.name.toUpperCase())}</div>✝ ${esc(x.m)}</div>`).join('')}</div>` : ''}`;
  }

  scoreHtml(): string {
    const st = this.st, V = st.rules.victory;
    const max = Math.max(V.vpTarget, ...st.players.map(p => p.vp));
    const rows = st.players.map(p => {
      const crowns = st.regions.filter(r => r.kind === 'crown' && r.owner === p.id).length;
      const regions = st.regions.filter(r => r.owner === p.id).length;
      const ships = st.fleets.filter(f => f.owner === p.id).reduce((a, f) => a + f.ships.length, 0);
      const last = p.vpLog.filter(v => v.turn === st.turn - 1);
      return `<div style="margin:8px 0"><div class="row"><b style="color:${p.color}">${esc(p.name)}</b><span class="grow"></span><b>${p.vp} VP</b></div>
        <div class="vpbar"><i style="width:${(p.vp / max) * 100}%;background:${p.color}"></i></div>
        <div class="dim" style="font-size:12px">${crowns} crown${crowns === 1 ? '' : 's'} · ${regions} regions · ${ships >= 0 ? ships + ' ships seen' : ''} · relics: ${p.relics.map(r => RELICS.find(x => x.id === r)?.name ?? r).join(', ') || 'none'}</div>
        ${last.length ? `<div class="faint" style="font-size:12px">last turn: ${last.map(v => `${v.amount > 0 ? '+' : ''}${v.amount} ${esc(v.why)}`).join('; ')}</div>` : ''}</div>`;
    }).join('');
    const pacts = st.pacts.map(p => `<div class="entry">${esc(this.pname(p.a))} ⚭ ${esc(this.pname(p.b))} until turn ${p.until}</div>`).join('');
    return `<h2>Victory</h2>
      ${this.sec('howvp', 'How to win & score VP', `<div class="orderhelp">First to <b>${V.vpTarget} VP</b> wins, or most VP after turn ${V.turnLimit}${V.holdAllCrownsWins ? `, or hold <b>all three Crowns</b> at the end of ${st.rules.crowns.holdTurnsToWin} consecutive turns` : ''}. Crowns and the Throne only pay if you held them when the turn began. VP comes from Crowns (${V.vpPerCrownPerTurn}/turn each, +${V.crownMajorityVp} for holding 2+), the Throne (1, 2, 3… VP for each consecutive turn held, max ${st.rules.throne.streakMaxVp}), relics (${V.vpPerRelic}), capturing capitals (${V.vpCapitalCapture}), battle honors, bounties for hitting the leader (+${st.rules.bounty.vpTakeFromLeader}), and Edicts.</div>`)}
      ${rows}
      ${st.crownHold?.owner != null ? `<div class="edict"><b>${esc(this.pname(st.crownHold.owner))} holds all three Crowns</b> (${st.crownHold.turns}/${st.rules.crowns.holdTurnsToWin} turns). Break the hold or lose!</div>` : ''}
      <h3>The Hollow Throne</h3><div class="dim" style="font-size:13px">${st.throne.owner !== null ? `Held by <b style="color:${this.color(st.throne.owner)}">${esc(this.pname(st.throne.owner))}</b>, streak ${st.throne.streak}` : 'Unclaimed'}${st.wardenAwake ? (st.wardenDefeated ? ' · the Warden is destroyed' : ' · <b class="bad">THE WARDEN IS AWAKE</b>') : ` · Warden sleeps (${st.loreFound}/${st.rules.warden.wakeAtLore} fragments found)`}</div>
      <h3>Edicts</h3>${st.edicts.length ? st.edicts.map(e => `<div class="edict"><b>${esc(e.name)}</b> · ${e.vp} VP<br>${esc(e.desc)}<br><span class="faint">Judged at the end of turn ${e.scoresTurn}</span></div>`).join('') : `<div class="faint" style="font-size:13px">No edict active. The first is proclaimed after turn ${st.rules.edicts.firstReveal}.</div>`}
      <h3>Diplomacy${ip(`A pact forms when both sides spend a Pact order on the same turn (${st.rules.influence.pactCost}✦ each). It lasts ${st.rules.influence.pactTurns} turns: no fighting, no subversion. Seizing a partner's region breaks it and costs ${st.rules.influence.pactBreakVp} VP.`)}</h3>
      <div class="orderhelp">Both sides must offer on the same turn. Agree on it in Chat first.</div>
      ${this.canPlan ? `<div class="actions">${st.players.filter(p => p.id !== this.you && !p.eliminated).map(p => `<button data-pact="${p.id}" style="border-color:${p.color}">⚭ Offer pact to ${esc(p.name)}</button>`).join('')}</div>` : ''}
      ${pacts ? `<div class="feed">${pacts}</div>` : ''}`;
  }

  chatHtml(): string {
    const msgs = this.src.chat;
    const opts = this.st.players.filter(p => p.id !== this.you).map(p => `<option value="${p.id}">to ${esc(p.name)} (private)</option>`).join('');
    return `<h2>Diplomacy</h2><div class="orderhelp">Talk is free and non-binding. Formal pacts need the Pact order from both sides on the same turn.</div>
      <div class="chatlog">${msgs.map(m => `<div><span class="faint">${new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span> <b style="color:${this.color(m.seat)}">${esc(m.seat === null ? 'Spectator' : this.pname(m.seat))}</b>${m.to !== null ? ` <span class="faint">→ ${esc(this.pname(m.to))}</span>` : ''}: ${esc(m.text)}</div>`).join('') || '<div class="faint">No messages yet.</div>'}</div>
      <div class="col" style="margin-top:10px"><select data-to><option value="">to everyone</option>${opts}</select>
      <div class="row"><input class="grow" data-msg placeholder="Propose, threaten, bluff…" maxlength="500"><button data-send>Send</button></div></div>`;
  }
  bindChat() {
    const b = this.el.tabbody;
    const send = () => {
      const i = b.querySelector<HTMLInputElement>('[data-msg]')!;
      const to = b.querySelector<HTMLSelectElement>('[data-to]')!.value;
      if (!i.value.trim()) return;
      this.src.sendChat(i.value.trim(), to === '' ? null : Number(to));
      i.value = '';
    };
    b.querySelector('[data-send]')?.addEventListener('click', send);
    b.querySelector<HTMLInputElement>('[data-msg]')?.addEventListener('keydown', e => { if (e.key === 'Enter') send(); e.stopPropagation(); });
  }

  // ------------------------------------------------------------------ left panel
  renderLeft() {
    const L = this.el.left;
    if (!this.sel) { L.classList.add('hidden'); return; }
    L.classList.remove('hidden');
    if (this.sel.kind === 'region') L.innerHTML = this.regionHtml(this.st.regions[this.sel.id]);
    else {
      const f = this.fleet(this.sel.id);
      if (!f) { this.sel = null; L.classList.add('hidden'); return; }
      L.innerHTML = this.fleetHtml(f);
    }
    L.querySelectorAll<HTMLElement>('[data-a]').forEach(e => e.addEventListener('click', () => this.action(e.dataset.a!, e.dataset)));
    L.querySelectorAll<HTMLElement>('[data-fleet]').forEach(e => e.addEventListener('click', () => this.select({ kind: 'fleet', id: Number(e.dataset.fleet) })));
    L.querySelectorAll<HTMLElement>('[data-goto]').forEach(e => e.addEventListener('click', () => this.select({ kind: 'region', id: Number(e.dataset.goto) })));
    L.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-doc]').forEach(e => e.addEventListener('change', () => this.doctrineChanged()));
    L.querySelector<HTMLInputElement>('[data-rename]')?.addEventListener('change', e => {
      const v = (e.target as HTMLInputElement).value.trim();
      if (!this.canPlan || this.sel?.kind !== 'fleet' || !v) return;
      const id = this.sel.id;
      if (this.live) { this.src.liveFree?.({ type: 'rename', fleet: id, name: v.slice(0, 40) }); toast('Renamed at the next tick.'); return; }
      this.plan.free = this.plan.free.filter(x => !(x.type === 'rename' && x.fleet === id));
      if (v !== this.fleet(id)?.name) this.plan.free.push({ type: 'rename', fleet: id, name: v.slice(0, 40) });
      this.savePlan(); this.renderTab(); toast('Renamed (applies when the turn resolves)');
    });
    L.querySelector('[data-close]')?.addEventListener('click', () => { this.sel = null; this.mode = null; this.renderLeft(); });
    L.querySelector('[data-halt]')?.addEventListener('click', () => { if (this.sel?.kind === 'fleet') this.src.liveHalt?.(this.sel.id); });
  }

  /** Why no new order can be given right now: the plan is locked, the slots are full or the bank is empty. */
  orderBlock(): string | null {
    const b = this.planBlock();
    if (b) return b;
    if (this.live) return this.bank < 1 ? `No orders banked. The next one arrives in ${fmtDur((this.st.live!.nextOrderAt[this.you!] ?? 0) - Date.now())}.` : null;
    return this.nextSlot() === null ? `All ${this.plan.orders.length} orders are used. Remove one in the Orders list first.` : null;
  }

  regionHtml(r: Region): string {
    const st = this.st, you = this.you, R = st.rules;
    const kindName = { home: 'Capital world', colony: 'Colony', crown: 'Crown', throne: 'The Throne', relic: 'Relic site', void: 'Deep void' }[r.kind];
    const per = this.live ? 'cycle' : 'turn';
    const y = R.economy.yields[r.kind];
    const fleets = st.fleets.filter(f => f.region === r.id);
    const owned = r.owner === you && you !== null;
    const block = this.canPlan ? this.orderBlock() : null;
    const dis = (why: string | null) => why ? `disabled title="${esc(why)}"` : '';
    // ---- status numbers, each with its breakdown one hover/tap away
    const E = R.empire, emp = E?.enabled !== false;
    const mult = Math.max(1, r.dev), mine = (r.buildings.mine ?? 0) * R.economy.mineBonus, hub = (r.buildings.tradehub ?? 0) * R.economy.tradeHubBonus;
    // world trait, vein & supply (the same terms as incomeDetail; empire-wide law/tech multipliers are in the top bar)
    const conn = emp && r.owner !== null ? connected(st, r.owner) : null;
    const cutOff = !!conn && !conn.has(r.id);
    const forge = emp && r.trait === 'forge' ? E.forgePerDev * mult : 0, gas = emp && r.trait === 'gas' ? E.gasCredits : 0;
    const extOn = emp && !!r.vein && (r.buildings.extractor ?? 0) > 0, extCr = extOn && !cutOff ? E.extractorCredits : 0;
    const half = cutOff ? E.cutOffYield : 1;
    const yi = y ? Math.round((y.industry * mult + mine + forge) * half) : 0, yc = y ? Math.round((y.credits * mult + hub + gas + extCr) * half) : 0, yf = y ? Math.round(((r.kind === 'void' ? 0 : y.influence) + (r.kind === 'home' ? Math.floor(r.dev / 2) : 0)) * half) : 0;
    const yieldTip = y ? `Produces per ${per} for its owner:\n⚙ ${y.industry} × development ${mult}${mine ? ` + ${mine} from mines` : ''}${forge ? ` + ${forge} Forge World` : ''}${cutOff ? ' × ½' : ''} = ${yi}\n¢ ${y.credits} × development ${mult}${hub ? ` + ${hub} from trade hubs` : ''}${gas ? ` + ${gas} Gas Giant` : ''}${extCr ? ` + ${extCr} Extractor` : ''}${cutOff ? ' × ½' : ''} = ${yc}\n✦ ${yf}${r.kind === 'home' ? ' (capitals: +1 per 2 development)' : ''}${cutOff ? '\nCut off from the capital: half yield.' : ''}\nEmpire-wide laws and technologies apply on top (see the top bar).` : 'Produces nothing.';
    const T = emp && r.trait ? WORLD_TRAITS[r.trait] : null, V = emp && r.vein ? VEINS[r.vein] : null;
    const traitSpan = T ? `<span class="nt"${tip(`${T.name}: ${T.desc}`)}>${T.icon} ${T.name}</span>` : '';
    const veinTip = V ? `${V.name} vein: ${V.desc}\nExtractor: ${extOn ? 'yes' : 'no'}${extOn ? `\nConnected to ${r.owner === you ? 'your' : 'its owner\'s'} capital: ${cutOff ? 'NO (dark until reconnected)' : 'yes'}` : ''}${r.owner === you && you !== null && !extOn ? '\nDevelop an Extractor here: +' + E.extractorCredits + '¢ a ' + per + ' and access to ' + V.name + '.' : ''}` : '';
    const veinSpan = V ? `<span class="nt"${tip(veinTip)}><span style="color:${V.color}">${V.icon}</span> ${V.name}${extOn ? (cutOff ? ' <span class="bad">· dark</span>' : ' <span class="good">· mined</span>') : ' <span class="faint">· no extractor</span>'}</span>` : '';
    const armor = R.garrison.armor + (r.buildings.fortress ?? 0) * R.garrison.armorPerFortress;
    const gmax = r.owner !== null && r.garrison >= 0 ? maxGarrison(st, r.id) : null;
    const garTip = r.garrison < 0 ? 'Unknown: outside your sensors. Scan it, or bring a fleet closer.'
      : `Defenders: ${r.garrison}${gmax !== null ? ` (max ${gmax})` : ''}. They fire on hostile fleets here; a Seize must defeat them.\nArmor ${armor}: absorbs ${armor} damage per hit (siege damage ignores it; bring bombards).${r.owner !== null ? `\nRegrows each ${per} toward the max (${R.garrison.ownedBase} + ${R.garrison.perDev}/development + ${R.garrison.perFortress}/fortress${R.garrison.kindBonus[r.kind] ? ` + ${R.garrison.kindBonus[r.kind]} ${r.kind}` : ''}).` : ''}`;
    const stat = `<div class="stat"><span class="nt"${tip(garTip)}>Garrison <b>${r.garrison < 0 ? '?' : r.garrison}</b>${r.buildings.fortress ? ` · fort ${r.buildings.fortress}` : ''}</span>${y && r.kind !== 'void' ? `<span class="nt"${tip(yieldTip)}>Yield <b>${yi}⚙ ${yc}¢ ${yf}✦</b></span>` : ''}${r.kind !== 'void' ? `<span>Dev <b>${r.dev}</b></span>` : ''}${traitSpan}${veinSpan}</div>`;
    const statuses: string[] = [];
    if (cutOff && r.owner === you) statuses.push(`<div class="status cut">✂ Cut off from your capital: half yield${extOn ? ', Extractor dark' : ''}.${ip('Your regions must link back to your capital through your own territory, with no hostile warships sitting in them. Retake or clear the regions in between.')}</div>`);
    else if (cutOff && r.owner !== null) statuses.push(`<div class="status cut">✂ Cut off from ${esc(this.pname(r.owner))}'s capital: half yield.</div>`);
    if (owned && V && !extOn && !(r.project?.key === 'extractor')) statuses.push(`<div class="status vein" style="border-left-color:${V.color}"><span style="color:${V.color}">${V.icon}</span> ${V.name} vein: build an <b>Extractor</b> (Develop) for +${E.extractorCredits}¢ and access to ${V.name}.</div>`);
    if (r.project) statuses.push(`<div class="status">▲ ${esc(R.projects[r.project.key]?.name ?? r.project.key)} under way: ${r.project.progress}/${R.projects[r.project.key]?.turns} ${per}s</div>`);
    if (r.relic === 'unclaimed') statuses.push(`<div class="status" style="border-left-color:#7ff7ff">✧ Unexcavated relic: ${owned ? 'a fleet of yours here can Excavate it' : 'own the region, then Excavate with a fleet'} (+${R.victory.vpPerRelic} VP).</div>`);
    const agents = you !== null && owned ? st.players.filter(p => p.id !== you && (r.loyalty[p.id] ?? 0) > 0) : [];
    if (agents.length) statuses.push(`<div class="status war">Rival agents: ${agents.map(p => `<span style="color:${p.color}">${esc(p.name)} ${r.loyalty[p.id]}/${flipThreshold(st, r.id)}</span>`).join(' · ')}${ip('At the threshold the region defects to them. Purge with an Influence order on your own region.')}</div>`);
    // ---- the 1-3 things you can do here
    let actions = '';
    if (this.canPlan && you !== null) {
      if (owned) {
        const yard = r.buildings.shipyard ?? 0;
        const left = this.live ? st.players[you].res : (() => { const sp = this.plannedSpend(), p = st.players[you].res; return { industry: p.industry - sp.industry, credits: p.credits - sp.credits, influence: p.influence - sp.influence }; })();
        const ps = this.projectedState(this.nextSlot() ?? 0);
        const builds = Object.entries(R.ships).map(([k, d]) => {
          const cb = classBlock(ps, you, k);
          const why = block ?? (cb ? capFirst(cb) : null) ?? (yard < d.needsShipyard ? `Needs shipyard level ${d.needsShipyard} (this one: ${yard}).` : null);
          const cost = orderCost(st, { type: 'build', region: r.id, cls: k, fleet: null }, you);
          const short = !canAfford(left, cost, creditRate(st, you));
          const m = emp ? MODULE[blueprintFor(ps, you, k) ?? 'armor'] : null;
          return `<span class="lbl"${tip(`${d.name}: ${d.role}\nHP ${d.hp} · attack ${d.attack}×${d.shots} · shields ${d.shields} · speed ${d.speed}${d.siege ? ` · siege +${d.siege}` : ''} · upkeep ${d.upkeep}¢/${per}${m ? `\nModule: ${m.icon} ${m.name} (${m.desc}). Change it under Empire → Ship designs.` : ''}${cb ? `\n${capFirst(cb)}` : ''}${short ? '\nYou can\'t afford it with your other orders: it will fail unless you free up resources.' : ''}`)}>${esc(d.name)}${m ? ` <span class="faint">${m.icon}</span>` : ''} <span class="${short || cb ? 'short' : 'faint'}">${cb ? esc(cb.replace(/ \(.*\)$/, '')) : yard < d.needsShipyard ? `yard ${d.needsShipyard}` : costText(cost)}</span></span>
            <button data-a="build" data-cls="${k}" ${dis(why)}>Build</button>`;
        }).join('');
        // projects a technology would unlock fold into one line (they say which research opens them)
        const lockedP = Object.entries(R.projects).filter(([, p]) => !!p.tech && !hasTech(ps, you, p.tech));
        const projects = Object.entries(R.projects).filter(([k, p]) => !(p.vein && !r.vein) && !lockedP.some(([x]) => x === k)).map(([k, p]) => {
          const lvl = k === 'develop' ? r.dev : (r.buildings[k] ?? 0);
          const max = k === 'develop' ? maxDevAt(st, r.id) : p.max;
          const o: Order = { type: 'develop', region: r.id, project: k };
          const err = block ?? capFirst(validateOrder(ps, you, o));
          const cost = orderCost(st, o, you);
          return `<span class="lbl"${tip(`${p.desc}\nTakes ${p.turns} ${per}${p.turns > 1 ? 's' : ''}. Max level ${max}.${err && !block ? `\n${err}` : ''}`)}>${esc(p.name)} ${lvl ? `<span class="faint">(lvl ${lvl}/${max})</span>` : ''} <span class="faint">${costText(cost)}</span></span>
            <button data-a="develop" data-proj="${k}" ${dis(err)}>Start</button>`;
        }).join('') + (lockedP.length ? `<span class="note" style="grid-column:1/-1;margin:3px 0 0">Research unlocks: ${lockedP.map(([, p]) => `<span class="nt"${tip(`${p.name}: ${p.desc}\nNeeds ${TECH[p.tech!]?.name ?? p.tech} (Empire tab).`)}>${esc(p.name)}</span>`).join(', ')}.</span>` : '');
        const purge = agents.length ? `<div class="acts1"><button data-a="influence" ${dis(block)} title="Purge rival agents (−${R.influenceLimits.purgeAmount} loyalty each)">✦ Purge agents · ${costText(orderCost(st, { type: 'influence', target: r.id }, you))}</button></div>` : '';
        const yardErr = !yard && R.projects.shipyard ? block ?? capFirst(validateOrder(st, you, { type: 'develop', region: r.id, project: 'shipyard' })) : null;
        actions = `${purge}${yard ? `<h3>Build a ship</h3><div class="buildlist">${builds}</div>`
          : `<div class="note">No shipyard here, so no ships.</div>${R.projects.shipyard ? `<div class="acts1"><button data-a="develop" data-proj="shipyard" ${dis(yardErr)}>▲ Start a Shipyard · ${costText(orderCost(st, { type: 'develop', region: r.id, project: 'shipyard' }, you))}</button></div>` : ''}`}
          ${V && !extOn && R.projects.extractor ? (() => { const eo: Order = { type: 'develop', region: r.id, project: 'extractor' }; const ee = block ?? capFirst(validateOrder(ps, you, eo)); return `<div class="acts1"><button data-a="develop" data-proj="extractor" ${dis(ee)} title="${esc(R.projects.extractor.desc)}"><span style="color:${V.color}">${V.icon}</span> Build an Extractor · ${costText(orderCost(st, eo, you))}</button></div>`; })() : ''}
          ${block ? `<span class="why">${esc(block)}</span>` : ''}
          ${this.sec('develop', 'Develop', `<div class="buildlist">${projects}</div>`, r.project ? 'busy' : 'projects & upgrades')}`;
      } else {
        const pos = this.projected(this.nextSlot() ?? 0);
        const near = st.fleets.filter(f => f.owner === you && f.ships.length && (pos.get(f.id) === r.id || r.neighbors.includes(pos.get(f.id) ?? -1))).slice(0, 2);
        const seize = r.kind !== 'void' || r.owner !== null ? near.map(f => {
          const od = this.odds([f.id], r.id, this.nextSlot() ?? 0);
          const why = block ?? this.fleetBlock(f);
          return `<button class="go" data-a="seizewith" data-with="${f.id}" ${dis(why)} title="${esc(od ? `Odds ≈ ${Math.round(od.p * 100)}% vs. what you can see: ${od.note}` : ORDER_INFO.seize.help)}">⚔ Seize with ${esc(f.name)}${od ? ` · <span class="odds ${od.p >= 0.65 ? 'hi' : od.p >= 0.4 ? 'mid' : 'lo'}">${Math.round(od.p * 100)}%</span>` : ''}</button>`;
        }).join('') : '';
        const inf = block ?? capFirst(validateOrder(st, you, { type: 'influence', target: r.id }));
        const cost = (o: Order) => costText(orderCost(st, o, you));
        actions = `${seize ? `<div class="acts1">${seize}</div>` : `<div class="note">To take it by force, bring a fleet next to it, then Seize.</div>`}
          <div class="actions">
            <button data-a="influence" ${dis(inf)} title="${esc(ORDER_INFO.influence.help)}">✦ Influence <small class="faint">${cost({ type: 'influence', target: r.id })}</small></button>
            <button data-a="scan" ${dis(block)} title="${esc(ORDER_INFO.scan.help)}">◎ Scan <small class="faint">${cost({ type: 'scan', target: r.id })}</small></button>
            <button data-a="feint" ${dis(block)} title="${esc(ORDER_INFO.feint.help)}">☍ Feint <small class="faint">${cost({ type: 'feint', target: r.id })}</small></button></div>
          ${block ? `<span class="why">${esc(block)}</span>` : inf && r.kind !== 'void' ? `<span class="note">Influence: ${esc(inf)}</span>` : ''}`;
      }
    }
    // ---- secondary details, folded away
    const loyal = r.owner !== you && you !== null && r.kind !== 'void' ? `<span>Loyalty</span><span${tip(`Influence pushes loyalty toward a player. At ${flipThreshold(st, r.id)} the region defects to them.`)}>${st.players.map(p => `<span style="color:${p.color}">${r.loyalty[p.id] ?? 0}</span>`).join(' / ')} <span class="faint">(defects at ${flipThreshold(st, r.id)})</span></span>` : '';
    const blds = Object.entries(r.buildings).filter(([, v]) => v);
    const details = `<div class="kv">
        <span>Owner</span><span style="color:${this.color(r.owner)}">${esc(this.pname(r.owner))}${r.owner !== null && st.players[r.owner]?.capital === r.id ? ' (capital)' : ''}</span>
        ${r.feature !== 'none' ? `<span>Terrain</span><span>${r.feature === 'nebula' ? 'Nebula: hides fleets, harder to hit' : 'Asteroids: defenders evade more'}</span>` : ''}
        ${blds.length ? `<span>Buildings</span><span>${blds.map(([k, v]) => `${esc(R.projects[k]?.name ?? k)} ${v}`).join(', ')}</span>` : ''}
        ${r.relic && r.relic !== 'unclaimed' ? `<span>Relic</span><span>${esc(RELICS.find(x => x.id === r.relic)?.name ?? 'emptied')}</span>` : ''}
        ${loyal}
        ${r.battles ? `<span>History</span><span>${r.battles} battle${r.battles > 1 ? 's' : ''}, ${r.wreckage} wrecks</span>` : ''}
      </div>${r.memorials.length ? `<div class="history">${r.memorials.map(m => `✝ ${esc(m)}`).join('<br>')}</div>` : ''}`;
    const fl = fleets.length ? `<h3>Fleets here</h3>${fleets.map(f => `<div class="entry click" data-fleet="${f.id}" style="border-left-color:${this.color(f.owner)}" title="Select this fleet">${esc(f.name)} <span class="faint">${f.ships.length} ship${f.ships.length === 1 ? '' : 's'}${f.owner === you ? '' : ` · ${esc(this.pname(f.owner))}`}</span></div>`).join('')}` : '';
    return `<div class="sel"><div class="head"><h2 style="color:${this.color(r.owner)}">${esc(r.name)}</h2><button class="small" data-close title="Close (Esc)" aria-label="Close">✕</button></div>
      <div class="sub">${kindName} · <span style="color:${this.color(r.owner)}">${esc(this.pname(r.owner))}</span>${r.owner === you && you !== null ? ' (yours)' : ''}</div>
      ${stat}${this.battleHtml(r)}${statuses.join('')}
      ${actions}${fl}
      ${this.sec('rdetails', 'Details', details, [r.feature !== 'none' ? r.feature : '', blds.length ? `${blds.length} building${blds.length > 1 ? 's' : ''}` : '', r.memorials.length ? '✝' : ''].filter(Boolean).join(' · '))}</div>`;
  }

  /** Ongoing battle / siege status for a region panel. */
  battleHtml(r: Region): string {
    const st = this.st;
    const e = (st.engagements ?? []).find(x => x.region === r.id);
    const besiegers = st.fleets.filter(f => f.siege === r.id && f.region === r.id && f.ships.length);
    if (!e && !besiegers.length) return '';
    const sideHp = (o: number) => st.fleets.filter(f => f.region === r.id && f.owner === o).reduce((a, f) => a + f.ships.reduce((b, x) => b + x.hp, 0), 0);
    const owners = [...new Set(st.fleets.filter(f => f.region === r.id && f.ships.length).map(f => f.owner))];
    const lines = owners.map(o => `<span style="color:${this.color(o)}">${esc(this.pname(o))}: ${st.fleets.filter(f => f.region === r.id && f.owner === o).reduce((a, f) => a + f.ships.length, 0)} ships, ${sideHp(o)} hp</span>`);
    if (r.garrison > 0 && (besiegers.length || r.owner !== null)) lines.push(`<span>Garrison ${r.garrison}</span>`);
    const how = `Battles go on pulse after pulse (${st.rules.combat.roundsPerPulse} round${st.rules.combat.roundsPerPulse > 1 ? 's' : ''} each) until one side is gone. Reinforcements that arrive join in. Leaving costs a parting volley.`;
    return `<div class="status war"><b style="color:#ffb37a">⚔ ${e ? esc(e.name) : 'Siege'}</b>${e ? ` · round ${e.rounds}, since ${this.live ? 'cycle' : 'turn'} ${e.startedTurn}` : ' in progress'}${ip(how)}<br>${lines.join(' · ')}</div>`;
  }

  fleetHtml(f: Fleet): string {
    const st = this.st, R = st.rules;
    const mine = f.owner === this.you;
    const c = f.commander;
    const d = this.doctrineOf(f);
    const k = this.nextSlot() ?? 0;
    const pos = this.projected(k).get(f.id) ?? f.region;
    const per = this.live ? 'cycle' : 'turn';
    const speed = fleetSpeed(st, f), power = fleetPower(st, f);
    const emp = R.empire?.enabled !== false;
    const ps = mine ? this.projectedState(k) : st;
    const ships = f.ships.map(s => {
      const def = R.ships[s.cls];
      const m = emp && s.mod ? MODULE[s.mod] : null;
      const bp = emp && f.owner >= 0 ? blueprintFor(ps, f.owner, s.cls) : null;
      const outdated = mine && bp && bp !== s.mod ? MODULE[bp] : null;
      const modTag = m ? `<span class="modt ${outdated ? 'old' : ''}"${tip(`Module: ${m.name}: ${m.desc}${outdated ? `\nYour ${def?.name ?? s.cls} design now uses ${outdated.name}: Refit at a shipyard to upgrade.` : ''}`)}>${m.icon}${outdated ? `→${outdated.icon}` : ''}</span>` : '';
      return `<div class="ship"><span title="${esc(def?.role ?? '')}">${glyph(s.cls)}</span>
        <div><b>${esc(s.name)}</b>${modTag}${s.title ? ` <span class="gold">${esc(s.title)}</span>` : ''} <span class="faint">${esc(def?.name ?? s.cls)}${s.kills ? ` · ${s.kills} kills` : ''}${s.battles ? ` · ${s.battles} battles` : ''}</span>
          <div class="bar" title="Hull ${s.hp}/${s.maxHp}"><i style="width:${(s.hp / s.maxHp) * 100}%;background:${s.hp / s.maxHp < 0.4 ? 'var(--bad)' : 'var(--good)'}"></i></div></div>
        <div class="sys"><i class="${s.sys.engines ? '' : 'off'}" title="Engines${s.sys.engines ? '' : ' knocked out: speed 1, can\'t retreat'}">E</i><i class="${s.sys.weapons ? '' : 'off'}" title="Weapons${s.sys.weapons ? '' : ' knocked out: can\'t fire'}">W</i><i class="${s.sys.shields ? '' : 'off'}" title="Shields${s.sys.shields ? '' : ' knocked out'}">S</i>${mine ? `<input type="checkbox" data-split="${s.id}" title="Select for Split" aria-label="Select ${esc(s.name)} for split">` : ''}</div></div>`;
    }).join('');
    const counts = new Map<string, number>();
    for (const s of f.ships) counts.set(R.ships[s.cls]?.name ?? s.cls, (counts.get(R.ships[s.cls]?.name ?? s.cls) ?? 0) + 1);
    const damaged = f.ships.filter(s => s.hp < s.maxHp || !s.sys.engines || !s.sys.weapons || !s.sys.shields).length;
    const upkeep = f.ships.reduce((a, s) => a + (R.ships[s.cls]?.upkeep ?? 0), 0);
    const rivals = Object.entries(c.rivals).filter(([, r]) => r.met > 0).map(([n, r]) => `${esc(n)} ×${r.met}${r.lastWinner ? (r.lastWinner === c.name ? ' (won last)' : ' (lost last: vengeance!)') : ''}`).join(', ');
    const speedTip = `The slowest ship sets the pace${f.ships.some(s => !s.sys.engines) ? '; ships with knocked-out engines move 1' : ''}.\n${this.live ? `Live: moves go any distance; each jump takes about ${Math.ceil(R.live.stepCost / Math.max(1, speed))} tick${Math.ceil(R.live.stepCost / Math.max(1, speed)) > 1 ? 's' : ''} (${fmtDur(Math.ceil(R.live.stepCost / Math.max(1, speed)) * tickMs(st))}).` : `A Move goes up to ${speed} region${speed > 1 ? 's' : ''}. Overdrive: +${R.overdrive.speedBonus}, but the fleet is fatigued next turn.`}`;
    const powerTip = `Rough fighting strength: (hull + shields×4) ÷ 2 + attack × shots × 2, summed over ships with working weapons.\nFor a real estimate, pick Seize and hover a target to see the odds.`;
    const stat = `<div class="stat"><span><b>${f.ships.length}</b> ship${f.ships.length === 1 ? '' : 's'}</span><span class="nt"${tip(powerTip)}>Power <b>${power}</b></span><span class="nt"${tip(speedTip)}>Speed <b>${speed}</b></span>${mine ? `<span class="nt"${tip(`Upkeep: ${upkeep}¢ per ${per} for these ships, paid from credits.`)}>Upkeep <b>${upkeep}¢</b></span>` : ''}</div>`;
    const statuses: string[] = [];
    const war = (st.engagements ?? []).find(e => e.region === f.region);
    if (war && f.siege !== f.region) statuses.push(`<div class="status war">⚔ In battle: ${esc(war.name)}${ip('The fight continues every pulse until one side is gone. Leaving costs a parting volley.')}</div>`);
    if (f.siege === f.region) statuses.push(`<div class="status war">⚔ Besieging ${esc(st.regions[f.region].name)}${war ? ` · round ${war.rounds}` : ''}${ip('A siege keeps fighting the garrison every pulse, across turns, with no new orders, until it falls or this fleet leaves.')}</div>`);
    if (f.fatigued) statuses.push(`<div class="status war">Fatigued${ip('After an Overdrive: weaker attacks and no Overdrive this turn.')}</div>`);
    if (f.fortified) statuses.push(`<div class="status">⛨ Fortified: hits harder and is harder to hit until it moves.</div>`);
    if (emp && f.owner >= 0 && f.ships.length && (mine || this.you === null)) {
      const sup = supplied(st, f.owner);
      const E = R.empire;
      if ((f.oos ?? 0) > 0 || !sup.has(f.region)) {
        const n = f.oos ?? 0, wearing = n > E.oosGraceTurns;
        statuses.push(`<div class="status cut">⛽ Out of supply${n ? ` (${n} ${per}${n > 1 ? 's' : ''})` : ''}: no repairs${wearing ? `, wearing down (−${E.oosAttrition} hp per ship each ${per})` : `; after ${E.oosGraceTurns} ${per}${E.oosGraceTurns > 1 ? 's' : ''} it wears down`}.${ip(`Fleets are in supply in or next to territory connected to their capital (${E.depotRange} away from a Depot). Move back, or build a Depot.`)}</div>`);
      }
    }
    if (this.live && f.route) statuses.push(`<div class="status">➤ To <b>${esc(st.regions[f.route.path[f.route.path.length - 1] ?? f.region]?.name ?? '?')}</b>${f.route.seize !== null ? ' to seize it' : ''} · arrives in ~${fmtDur((etaTicks(st, f.id) ?? 0) * tickMs(st))}${mine ? ' <button class="small" data-halt title="Stop where it is. Free.">Halt</button>' : ''}</div>`);
    let actions = '';
    if (mine && this.you !== null && this.st.winner === null) {
      const here = st.regions[pos];
      const block = this.fleetBlock(f);
      const canSeize = [pos, ...here.neighbors].some(n => st.regions[n].owner !== this.you);
      const relic = here.relic === 'unclaimed';
      const dis = (why: string | null) => why ? `disabled title="${esc(why)}"` : '';
      const used = this.live ? this.queue.filter(o => 'fleet' in o && o.type !== 'build' && o.fleet === f.id).length
        : this.plan.orders.filter(o => o && 'fleet' in o && o.type !== 'build' && (o.fleet === f.id || (o.type === 'seize' && o.also?.includes(f.id)))).length;
      // Refit: only offered where it can happen (one of your shipyards)
      let refitBtn = '';
      if (emp && here.owner === this.you && (here.buildings.shipyard ?? 0) > 0 && f.ships.some(s => s.mod !== blueprintFor(ps, this.you!, s.cls) || s.hp < s.maxHp)) {
        const ro: Order = { type: 'refit', fleet: f.id };
        const rc = orderCost(ps, ro, this.you);
        const n = f.ships.filter(s => s.mod !== blueprintFor(ps, this.you!, s.cls)).length;
        const rwhy = block ?? (this.live ? null : capFirst(this.validateAt(ro, k)));
        refitBtn = `<button data-a="refit" ${dis(rwhy)} title="${esc(`${ORDER_INFO.refit.help}${n ? `\n${n} ship${n > 1 ? 's' : ''} get the current design (${costText(rc)}).` : '\nModules are up to date: repairs only (free).'}`)}">⚒ Refit${n ? ` <small class="faint">${costText(rc)}</small>` : ''}</button>`;
      }
      actions = `<div class="acts1">
        <button class="go" data-a="move" ${dis(block)} title="${esc(ORDER_INFO.move.help)}">➤ Move<span class="kbd kh">M</span></button>
        <button class="go" data-a="seize" ${dis(block ?? (canSeize ? null : 'Nothing to seize: every region next to it is already yours.'))} title="${esc(ORDER_INFO.seize.help)}">⚔ Seize<span class="kbd kh">S</span></button>
        <button data-a="fortify" ${dis(block)} title="${esc(ORDER_INFO.fortify.help)}">⛨ Fortify<span class="kbd kh">F</span></button>
        ${relic ? `<button data-a="excavate" ${dis(block ?? (here.owner === this.you ? null : 'You must own the region first: Seize it.'))} title="${esc(ORDER_INFO.excavate.help)}">✧ Excavate</button>` : ''}
        ${refitBtn}
      </div>
      ${block ? `<span class="why">${esc(block)}</span>` : used ? `<span class="note">Already has ${used} order${used > 1 ? 's' : ''} this ${per}. Max ${R.orders.maxPerFleet}${this.live ? '' : `; the next costs +${R.orders.repeatFleetCredits}¢`}.</span>` : ''}`;
    }
    const canEdit = mine && this.canPlan;
    const mates = canEdit ? st.fleets.filter(x => x.owner === f.owner && x.id !== f.id && x.region === f.region) : [];
    const doctrine = canEdit ? this.sec('doctrine', 'Doctrine', `<div class="doctrine">
        <span>Stance</span><select data-doc="stance">${(['aggressive', 'defensive', 'evasive'] as const).map(x => `<option ${d.stance === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
        <span>Retreat at</span><span class="row"><input type="range" min="0" max="0.9" step="0.05" value="${d.retreatAt}" data-doc="retreatAt" class="grow" aria-label="Retreat at hull %"><span>${Math.round(d.retreatAt * 100)}%</span></span>
        <span>Target</span><select data-doc="target">${(['weakest', 'strongest', 'cheapest', 'garrison'] as const).map(x => `<option ${d.target === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
        <span>Guard</span><label class="row"><input type="checkbox" data-doc="guard" ${d.guard ? 'checked' : ''}> reinforce adjacent regions you own when invaded</label>
      </div>
      <div class="faint" style="font-size:12px">Standing orders, free to change. Aggressive: attacks anything hostile it meets. Defensive: fights when attacked or at home. Evasive: avoids fights and slips away (taking a parting volley).</div>
      <h3>Fleet admin (free)</h3>
      <input data-rename value="${esc(this.pendingName(f))}" maxlength="40" style="width:100%" title="Rename (free)" aria-label="Fleet name">
      ${mates.length ? `<div class="actions"><select data-mergeinto aria-label="Merge into">${mates.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select><button data-a="merge" title="Merge this fleet into the chosen one (free)">Merge into</button></div>` : ''}`,
      `${d.stance} · retreat ${Math.round(d.retreatAt * 100)}%${d.guard ? ' · guard' : ''}`) : '';
    const shipsSec = this.sec('ships', `Ships (${f.ships.length})`, `${ships}${canEdit && f.ships.length > 1 ? `<div class="actions"><button data-a="split" title="Split the checked ships into a new fleet (free)">Split checked</button></div>` : ''}`,
      `${[...counts].map(([n, x]) => `${x} ${n}`).join(', ')}${damaged ? ` · ${damaged} damaged` : ''}`);
    const cmd = this.sec('commander', 'Commander', `<div><b>${esc(c.name)}</b> <span class="faint">rank ${c.rank} · ${c.xp} xp · ${c.deeds.wins}W/${c.deeds.losses}L · ${c.deeds.kills} kills</span></div>
      <div>${c.traits.map(t => `<span class="trait" title="${esc(TRAITS[t]?.desc ?? '')}">${esc(TRAITS[t]?.name ?? t)}</span>`).join('') || '<span class="faint" style="font-size:12px">No reputation yet. Traits are earned through deeds.</span>'}</div>
      ${rivals ? `<div style="font-size:12px;margin-top:3px"><span class="faint">Rivals:</span> ${rivals}</div>` : ''}`, `${esc(c.name)}${c.traits.length ? ` · ${c.traits.length} trait${c.traits.length > 1 ? 's' : ''}` : ''}`);
    const rec = f.history.length ? this.sec('record', 'Record', `<div class="history scroll">${f.history.slice().reverse().map(x => esc(x)).join('<br>')}</div>`, `${f.history.length}`) : '';
    return `<div class="sel"><div class="head"><h2 style="color:${this.color(f.owner)}">${esc(f.name)}</h2><button class="small" data-close title="Close (Esc)" aria-label="Close">✕</button></div>
      <div class="sub">${mine ? 'Your fleet' : esc(this.pname(f.owner))} · at <span class="click" data-goto="${f.region}">${esc(st.regions[f.region].name)}</span>${pos !== f.region ? ` → <b>${esc(st.regions[pos].name)}</b> <span class="faint">(planned)</span>` : ''}</div>
      ${stat}${statuses.join('')}${actions}
      ${shipsSec}${doctrine}${cmd}${rec}</div>`;
  }

  pendingName(f: Fleet): string {
    const r = [...this.plan.free].reverse().find(x => x.type === 'rename' && x.fleet === f.id);
    return r && r.type === 'rename' ? r.name : f.name;
  }

  doctrineChanged() {
    if (!this.canPlan) return;
    if (this.sel?.kind !== 'fleet') return;
    const L = this.el.left;
    const v = (k: string) => L.querySelector<HTMLInputElement>(`[data-doc="${k}"]`)!;
    const d: Doctrine = { stance: v('stance').value as Doctrine['stance'], retreatAt: Number(v('retreatAt').value), target: v('target').value as Doctrine['target'], guard: v('guard').checked };
    const id = this.sel.id;
    if (this.live) { this.src.liveFree?.({ type: 'doctrine', fleet: id, doctrine: d }); toast('Doctrine changes at the next tick.'); return; }
    this.plan.free = this.plan.free.filter(x => !(x.type === 'doctrine' && x.fleet === id));
    this.plan.free.push({ type: 'doctrine', fleet: id, doctrine: d });
    this.savePlan();
    this.renderLeft();
    this.renderTab();
  }

  action(a: string, data: DOMStringMap) {
    const sel = this.sel;
    if (!sel || !this.canPlan) return;
    if (sel.kind === 'fleet') {
      const f = this.fleet(sel.id);
      if (!f || f.owner !== this.you) return;
      switch (a) {
        case 'move': this.odSticky = false; this.mode = { type: 'move', fleet: f.id, overdrive: false }; break;
        case 'seize': this.mode = { type: 'seize', fleet: f.id }; break;
        case 'fortify': this.addOrder({ type: 'fortify', fleet: f.id }); break;
        case 'excavate': this.addOrder({ type: 'excavate', fleet: f.id }); break;
        case 'refit': this.addOrder({ type: 'refit', fleet: f.id }); break;
        case 'merge': {
          const into = Number(this.el.left.querySelector<HTMLSelectElement>('[data-mergeinto]')?.value);
          if (!this.fleet(into)) return;
          if (this.live) { this.src.liveFree?.({ type: 'merge', fleet: f.id, into }); toast('Merging at the next tick.'); break; }
          this.plan.free = this.plan.free.filter(x => !(x.type === 'merge' && x.fleet === f.id));
          this.plan.free.push({ type: 'merge', fleet: f.id, into }); this.savePlan(); toast('Merge queued (applies at the start of resolution, before pulse I). Order the merged fleet, not this one.'); break;
        }
        case 'split': {
          const ids = [...this.el.left.querySelectorAll<HTMLInputElement>('[data-split]:checked')].map(x => Number(x.dataset.split));
          if (!ids.length || ids.length === f.ships.length) { toast('Check some (not all) ships first.'); return; }
          if (this.live) { this.src.liveFree?.({ type: 'split', fleet: f.id, ships: ids }); toast('Splitting at the next tick.'); break; }
          this.plan.free.push({ type: 'split', fleet: f.id, ships: ids }); this.savePlan(); toast('Split queued: the new squadron appears when the turn resolves and can be ordered next turn.'); break;
        }
      }
    } else {
      const r = this.st.regions[sel.id];
      switch (a) {
        case 'build': {
          const cls = data.cls!;
          const pos = this.projected(this.nextSlot() ?? 0);
          const join = this.st.fleets.find(x => x.owner === this.you && pos.get(x.id) === r.id && x.ships.length < this.st.rules.maxShipsPerFleet && x.bornTurn !== this.st.turn);
          this.addOrder({ type: 'build', region: r.id, cls, fleet: join ? join.id : null });
          break;
        }
        case 'develop': this.addOrder({ type: 'develop', region: r.id, project: data.proj! }); break;
        case 'influence': this.addOrder({ type: 'influence', target: r.id }); break;
        case 'seizewith': this.addOrder({ type: 'seize', fleet: Number(data.with), target: r.id }); break;
        case 'scan': this.addOrder({ type: 'scan', target: r.id }); break;
        case 'feint': this.addOrder({ type: 'feint', target: r.id }); break;
      }
    }
    this.renderAll();
  }

  renderBottom() {
    const P = this.st.rules.orders.pulses;
    const cur = this.replay ? this.replay.pulse : 0;
    this.el.pulsebar.innerHTML = Array.from({ length: P }, (_, i) => `<span class="${cur === i + 1 ? 'on' : cur > i + 1 ? 'done' : ''}" title="pulse ${roman(i + 1)}"></span>`).join('');
    const local0 = this.src instanceof LocalSource ? this.src : null;
    this.el.bottombar.classList.toggle('quiet', !this.replay && !(local0 && local0.humans.length === 0 && this.st.winner === null && !this.live));
    if (this.replay) {
      const R = this.replay;
      this.el.rcontrols.innerHTML = `<button class="small" data-r="pause">${R.playing ? '❚❚' : '▶'}</button><button class="small" data-r="speed">${R.speed}×</button><button class="small" data-r="skip">Skip ⏭</button>`;
      this.el.rcontrols.querySelectorAll<HTMLElement>('[data-r]').forEach(b => b.addEventListener('click', () => {
        if (!this.replay) return;
        if (b.dataset.r === 'pause') this.togglePause();
        if (b.dataset.r === 'speed') this.replaySpeed = this.replay.speed = this.replay.speed >= 4 ? 1 : this.replay.speed * 2;
        if (b.dataset.r === 'skip') this.endReplay();
        this.renderBottom();
      }));
    } else {
      const local = this.src instanceof LocalSource ? this.src : null;
      const watching = !!local && local.humans.length === 0 && this.st.winner === null && !this.live;
      this.el.rcontrols.innerHTML = (watching ? `<button class="small primary" data-x="next" title="Resolve the next turn">Next turn ▶</button><button class="small ${this.autoPlay ? 'active' : ''}" data-x="auto" title="Keep playing turns automatically">Auto ⏵⏵</button>` : '')
        + (local ? `<button class="small" data-x="save" title="Download a save file">💾</button>` : '');
      this.el.rcontrols.querySelector('[data-x="save"]')?.addEventListener('click', () => this.exportSave());
      this.el.rcontrols.querySelector('[data-x="next"]')?.addEventListener('click', () => { if (!this.replay) local!.advance(); });
      this.el.rcontrols.querySelector('[data-x="auto"]')?.addEventListener('click', () => { this.autoPlay = !this.autoPlay; if (this.autoPlay && !this.replay) local!.advance(); this.renderBottom(); });
      if (watching && !this.el.ticker.innerHTML.trim()) this.el.ticker.innerHTML = '<span class="faint">Watching three AIs. Press Next turn, or Auto.</span>';
      if (!this.el.ticker.innerHTML) this.el.ticker.innerHTML = (this.live ? `<span class="faint">Live game: spend banked orders any time. They act at the next tick, and the world keeps moving in between.</span>` : `<span class="faint">Plan your ${this.st.rules.orders.perTurn} orders, then seal them. Everyone's orders resolve together.</span>`);
    }
  }

  // ================================================================== replay
  togglePause() {
    const R = this.replay;
    if (!R) return;
    R.playing = !R.playing;
    R.last = performance.now();
    this.renderBottom();
  }

  startReplay(result: TurnResult, preview = false) {
    const st = this.st;
    const fleets = new Map<number, ReplayFleet>();
    for (const f of result.startFleets) fleets.set(f.id, { id: f.id, owner: f.owner, ships: f.ships.length, region: f.region, alpha: 1, name: f.name });
    const beats: Beat[] = [];
    const push = (dur: number, e: GameEvent) => { beats.push({ dur, events: [e] }); };
    for (const e of result.events) {
      if (e.k === 'move') {
        const c = beats[beats.length - 1] as Beat | undefined;
        const f0 = c?.events[0];
        if (c && f0 && f0.k === 'move' && f0.pulse === e.pulse && f0.step === e.step && !!f0.guard === !!e.guard) c.events.push(e);
        else push(750, e);
      } else if (e.k === 'pulse') { if (!(this.live && !preview)) push(700, e); } // a live tick is one pulse: no banner beat, fleets keep gliding
      else if (e.k === 'battle' || e.k === 'clash') push(1100, e);
      else if (e.k === 'retreat') push(600, e);
      else if (e.k === 'capture' || e.k === 'excavate' || e.k === 'destroyed') push(650, e);
      else if (e.k === 'build' || e.k === 'project' || e.k === 'betrayal' || e.k === 'pact' || e.k === 'refit') push(450, e);
      else if (e.k === 'tech' || e.k === 'law') push(e.k === 'tech' && TECH[e.tech]?.tier === 4 ? 1100 : 600, e);
      else if (e.k === 'fail' || e.k === 'note' || e.k === 'blocked' || e.k === 'influence' || e.k === 'fortify' || e.k === 'scan') push(e.k === 'fail' ? 500 : 350, e);
    }
    if (!beats.length) return;
    // starting a replay while another runs (or a preview) replaces it cleanly
    const speed = this.replaySpeed;
    this.fx = [];
    this.previewing = preview;
    const owners = result.startOwners.length ? result.startOwners.slice() : st.regions.map(r => r.owner);
    // a live tick continues from what is on screen; a WEGO replay rewinds to the start of the turn (a cut, not an animation)
    this.replayCont = this.live && !preview && !this.replay;
    if (!this.replayCont) { this.map.resetAnim(); this.fleetOff.clear(); this.lastFleetPos.clear(); }
    this.replay = { result, beats, i: -1, prog: 0, last: performance.now(), playing: true, speed, fleets, owners, startLayout: new Map(), endLayout: new Map(), moving: new Set(), pulse: 0, preview };
    this.sel = null; this.mode = null; this.targetSlot = null;
    this.el.tooltip.classList.add('hidden');
    this.nextBeat();
    this.renderAll();
  }

  nextBeat() {
    const R = this.replay!;
    R.i++;
    if (R.i >= R.beats.length) { this.endReplay(); return; }
    const beat = R.beats[R.i];
    R.prog = 0;
    R.last = performance.now();
    R.moving.clear();
    const st = this.st;
    const live = () => [...R.fleets.values()].filter(f => f.alpha > 0);
    R.startLayout = regionLayout(st, live().map(f => ({ id: f.id, region: f.region })), this.map.px(1));
    // start every token from where it is on screen, so beats (and live ticks) flow into each other without jumps
    for (const [id, p] of this.lastFleetPos) if (R.startLayout.has(id)) R.startLayout.set(id, p);
    const now = performance.now();
    const text: string[] = [];
    let focus: Pt | null = null;
    for (const e of beat.events) {
      text.push(eventText(st, e, this.you));
      switch (e.k) {
        case 'pulse': R.pulse = e.pulse; this.banner(`PULSE ${roman(e.pulse)}`); break;
        case 'move': {
          let f = R.fleets.get(e.fleet);
          if (!f) { f = { id: e.fleet, owner: e.owner, ships: e.ships, region: e.from, alpha: 1, name: this.fleet(e.fleet)?.name ?? 'fleet' }; R.fleets.set(e.fleet, f); if (st.regions[e.from]) R.startLayout.set(f.id, st.regions[e.from].site); }
          f.region = e.to; R.moving.add(e.fleet);
          break;
        }
        case 'retreat': { const f = R.fleets.get(e.fleet); if (f) { f.region = e.to; f.alpha = 1; R.moving.add(e.fleet); } break; }
        case 'battle': this.fx.push({ kind: 'battle', pos: st.regions[e.region].site, color: '#ffb36b', t0: now, dur: 1100 * 1.3, text: e.name }); focus ??= st.regions[e.region].site; break;
        case 'clash': {
          const a = st.regions[e.a].site, b = st.regions[e.b].site;
          this.fx.push({ kind: 'clash', pos: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, color: '#ff6b6b', t0: now, dur: 1200, text: 'CLASH!' });
          focus ??= { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          break;
        }
        case 'destroyed': {
          const f = R.fleets.get(e.fleet);
          // the token bursts where it was drawn
          const at = this.lastFleetPos.get(e.fleet) ?? R.startLayout.get(e.fleet) ?? st.regions[e.region].site;
          if (f && f.alpha > 0) this.fx.push({ kind: 'explode', pos: { ...at }, color: this.color(f.owner), t0: now, dur: 900, size: Math.min(2, 0.8 + f.ships * 0.12) });
          if (f) f.alpha = 0;
          this.fx.push({ kind: 'text', pos: st.regions[e.region].site, color: '#ff5d7a', t0: now, dur: 1400, text: `${e.name} destroyed` });
          break;
        }
        case 'capture': R.owners[e.region] = e.by; this.fx.push({ kind: 'capture', pos: st.regions[e.region].site, color: this.color(e.by), t0: now, dur: 1000, text: e.how === 'influence' ? 'DEFECTS' : 'CAPTURED' }); focus ??= st.regions[e.region].site; break;
        case 'build': {
          const f = R.fleets.get(e.fleet);
          if (f) f.ships++; else R.fleets.set(e.fleet, { id: e.fleet, owner: e.owner, ships: 1, region: e.region, alpha: 1, name: this.fleet(e.fleet)?.name ?? 'new squadron' });
          this.fx.push({ kind: 'build', pos: st.regions[e.region].site, color: this.color(e.owner), t0: now, dur: 700 });
          break;
        }
        case 'excavate': this.fx.push({ kind: 'excavate', pos: st.regions[e.region].site, color: '#7ff7ff', t0: now, dur: 1200, text: 'RELIC FOUND' }); break;
        case 'betrayal': this.banner('BETRAYAL'); break;
        case 'tech': case 'law': this.empireFx(e, now); break;
        case 'refit': if (st.regions[e.region]) this.fx.push({ kind: 'build', pos: st.regions[e.region].site, color: this.color(e.owner), t0: now, dur: 700 }); break;
        case 'blocked': this.fx.push({ kind: 'text', pos: st.regions[e.at].site, color: '#ffd86b', t0: now, dur: 900, text: 'blocked' }); break;
      }
    }
    // battles inside this turn: sync ship counts from the battle report for fleets involved
    for (const e of beat.events) if (e.k === 'battle') {
      const rep = R.result.battles.find(b => b.id === e.battle);
      if (rep) for (const side of rep.sides) for (const fl of side.fleets) {
        const f = R.fleets.get(fl.id);
        const lost = rep.rounds.flatMap(r => r.shots).filter(s => s.kill && side.ships.some(x => x.id === s.to && x.fleet === fl.id)).length;
        if (f) f.ships = Math.max(0, f.ships - lost);
      }
    }
    R.endLayout = regionLayout(st, live().map(f => ({ id: f.id, region: f.region })), this.map.px(1));
    // WEGO replays: when the action happens off-screen, glide the camera over (never fights the user's own panning)
    if (focus && !this.live && R.playing && !this.drag && !this.pinch && !this.curtain && !this.map.onScreen(focus, this.phone ? 70 : 110)) this.map.flyTo(focus, undefined, 750);
    this.el.ticker.innerHTML = text.filter(Boolean).slice(0, 3).join(' · ') || this.el.ticker.innerHTML;
    // these are <a href="#">: without preventDefault the hash change would route back to the lobby
    this.el.ticker.querySelectorAll<HTMLElement>('[data-battle]').forEach(x => x.addEventListener('click', ev => { ev.preventDefault(); this.openBattle(Number(x.dataset.battle)); }));
    this.renderBottom();
  }

  endReplay() {
    if (!this.replay) return;
    const res = this.replay.result;
    const wasPreview = this.replay.preview;
    this.replay = null;
    this.fx = [];
    this.previewing = false;
    if (wasPreview) this.map.resetAnim(); // owners/fleets snap back to the plan: not a capture
    if (wasPreview) { this.el.ticker.innerHTML = '<span class="faint">Preview finished. Your plan is unchanged.</span>'; this.renderAll(); return; }
    const n = res.battles.length;
    this.el.ticker.innerHTML = `<b>Turn ${res.turn} resolved.</b> ${n ? `${n} battle${n > 1 ? 's' : ''}. <a href="#" data-tabch>See the Chronicle</a> to watch them.` : 'No battles.'} ${res.signals.length ? `${res.signals.length} intel signals.` : ''}`;
    this.el.ticker.querySelector('[data-tabch]')?.addEventListener('click', e => { e.preventDefault(); this.tab = 'chronicle'; this.renderTabs(); this.renderTab(); });
    this.renderAll();
    this.maybeShowVictory();
    if (this.autoPlay && this.src instanceof LocalSource && this.st.winner === null) this.later(() => { if (this.autoPlay && !this.replay) (this.src as LocalSource).advance(); }, 900);
  }

  /** A technology bought or a law enacted: its name rises over the owner's capital; a ★ gets the big banner. */
  empireFx(e: Extract<GameEvent, { k: 'tech' | 'law' }>, now = performance.now()) {
    const st = this.st;
    const cap = st.regions[st.players[e.owner]?.capital];
    if (e.k === 'tech') {
      const t = TECH[e.tech];
      if (!t) return;
      if (cap) this.fx.push({ kind: 'text', pos: cap.site, color: BRANCHES[t.branch].color, t0: now, dur: 1800, text: `${t.icon} ${t.name}` });
      if (t.tier === 4) this.banner(`★ ${t.name.toUpperCase()}`);
    } else {
      const l = LAW[e.law];
      if (l && cap) this.fx.push({ kind: 'text', pos: cap.site, color: e.revoked ? '#a59ccc' : '#ffd86b', t0: now, dur: 1600, text: `${l.icon} ${e.revoked ? 'repeals' : ''} ${l.name}`.replace('  ', ' ') });
    }
  }
  /** Public empire changes since the last view (techs bought, laws enacted/revoked). The per-player view filters these
   *  events out of turn results, so they are rebuilt here by comparing what everyone owned before and after. */
  empSnap: { techs: string[][]; laws: string[][] } | null = null;
  empireNews(): Extract<GameEvent, { k: 'tech' | 'law' }>[] {
    const st = this.st;
    const cur = { techs: st.players.map(p => [...(p.techs ?? [])]), laws: st.players.map(p => [...(p.laws ?? [])]) };
    const prev = this.empSnap;
    this.empSnap = cur;
    if (!prev || prev.techs.length !== cur.techs.length) return [];
    const out: Extract<GameEvent, { k: 'tech' | 'law' }>[] = [];
    st.players.forEach((p, i) => {
      for (const t of cur.techs[i]) if (!prev.techs[i].includes(t)) out.push({ k: 'tech', pulse: 0, owner: i, tech: t });
      for (const l of cur.laws[i]) if (!prev.laws[i].includes(l)) out.push({ k: 'law', pulse: 0, owner: i, law: l });
      for (const l of prev.laws[i]) if (!cur.laws[i].includes(l) && !cur.laws[i].includes(opposite(l) ?? '')) out.push({ k: 'law', pulse: 0, owner: i, law: l, revoked: true });
    });
    return out;
  }

  banner(t: string) {
    const b = this.el.banner;
    b.textContent = t;
    b.dataset.text = t; // the light sweep (fx.css) reads it
    // restart the sweep animation even if the previous banner is still up
    b.classList.remove('show', 'hide'); void b.offsetWidth; b.classList.add('show');
    clearTimeout((b as any)._t);
    (b as any)._t = setTimeout(() => b.classList.replace('show', 'hide'), 760);
  }

  openBattle(id: number) {
    // the replay being shown (preview, or an older turn from the menu) owns its battle reports
    const rep = this.replay?.result.battles.find(b => b.id === id) ?? (this.replay?.preview ? undefined : this.st.last?.battles.find(b => b.id === id));
    if (!rep) { toast('Battle report not available.'); return; }
    if (this.replay?.playing) this.togglePause();
    openBattleViewer(rep, {
      rules: this.st.rules, you: this.you,
      playerName: o => o === -1 ? (rep.sides.some(x => x.owner === -1 && x.fleets.length) ? 'The Warden' : 'Neutral garrison') : this.pname(o), playerColor: o => this.color(o), regionName: id => this.st.regions[id]?.name ?? '?',
    });
  }

  async replayTurn(turn: number) {
    const r = turn === this.st.last?.turn ? this.st.last : await this.src.history(turn);
    if (!r) { toast('No replay available for that turn.'); return; }
    this.startReplay(r);
  }

  // ================================================================== frame
  frame() {
    const now = performance.now();
    const st = this.st;
    let owners = st.regions.map(r => r.owner);
    let fleets: FleetDraw[] = [];
    const local0 = this.src instanceof LocalSource ? this.src : null;
    this.el.bottombar.classList.toggle('quiet', !this.replay && !(local0 && local0.humans.length === 0 && this.st.winner === null));
    if (this.replay) {
      const R = this.replay;
      const beat = R.beats[R.i];
      // clamp dt so a backgrounded tab doesn't skip a whole beat on return
      const dt = Math.min(250, Math.max(0, now - R.last));
      R.last = now;
      if (R.playing && beat) {
        R.prog += dt * R.speed / beat.dur;
        if (R.prog >= 1) this.nextBeat();
      }
      if (this.replay) {
        const t = Math.min(1, this.replay.prog);
        const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        owners = this.replay.owners;
        const byId = this.live ? new Map(st.fleets.map(f => [f.id, f])) : null;
        for (const f of this.replay.fleets.values()) {
          if (f.alpha <= 0 && !this.replay.moving.has(f.id)) continue;
          const a = this.replay.startLayout.get(f.id) ?? st.regions[f.region].site;
          const b = this.replay.endLayout.get(f.id) ?? st.regions[f.region].site;
          const moving = this.replay.moving.has(f.id);
          // everyone eases from where they were to their new slot (movers travel, the rest shuffle smoothly)
          let pos = { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e };
          // LIVE: fleets still in transit keep gliding along their route during the tick's replay
          const sf = !moving ? byId?.get(f.id) : undefined;
          if (sf && sf.region === f.region && sf.route?.path.length) pos = this.liveGlide(sf, pos);
          fleets.push({ id: f.id, owner: f.owner, ships: f.ships, pos, alpha: f.alpha, name: f.name });
        }
      }
    } else {
      const lay = this.fleetLayout();
      // LIVE: fleets in transit glide toward their next region as the tick approaches
      fleets = st.fleets.map(f => {
        let pos = lay.get(f.id) ?? st.regions[f.region].site;
        if (this.live) pos = this.liveGlide(f, pos);
        return { id: f.id, owner: f.owner, ships: f.ships.length, pos, alpha: 1, name: f.name, fortified: f.fortified, selected: this.sel?.kind === 'fleet' && this.sel.id === f.id, idle: this.isIdle(f) };
      });
    }
    // smooth out discontinuities (a new state arriving, replay end, layout reshuffles): the token eases from where it was
    {
      const fdt = this.lastFrameAt ? Math.min(100, now - this.lastFrameAt) : 16;
      this.lastFrameAt = now;
      const decay = Math.exp(-fdt / 150);
      const jump = this.map.px(14);
      const seen = new Set<number>();
      for (const f of fleets) {
        seen.add(f.id);
        const prev = this.lastFleetPos.get(f.id);
        let off = this.fleetOff.get(f.id);
        if (prev && !this.replay) {
          const px = prev.x - (off?.x ?? 0), py = prev.y - (off?.y ?? 0); // last frame's target
          if (Math.hypot(f.pos.x - px, f.pos.y - py) > jump) { off = { x: prev.x - f.pos.x, y: prev.y - f.pos.y }; this.fleetOff.set(f.id, off); }
        }
        if (off) {
          off.x *= decay; off.y *= decay;
          if (Math.abs(off.x) + Math.abs(off.y) < this.map.px(0.3)) this.fleetOff.delete(f.id);
          else f.pos = { x: f.pos.x + off.x, y: f.pos.y + off.y };
        }
        const lp = this.lastFleetPos.get(f.id);
        if (lp) { lp.x = f.pos.x; lp.y = f.pos.y; } else this.lastFleetPos.set(f.id, { x: f.pos.x, y: f.pos.y });
      }
      for (const id of this.lastFleetPos.keys()) if (!seen.has(id)) { this.lastFleetPos.delete(id); this.fleetOff.delete(id); }
    }
    if (this.live && now - this.lastClock > 500) { this.lastClock = now; this.tickClocks(); }
    // highlights for modes (memoized: path searches over every region are too costly to redo each frame)
    let highlight = new Map<number, string>();
    let pathPreview: { pts: Pt[]; ok: boolean } | null = null;
    if (this.mode && !this.replay && this.you !== null) {
      const k = this.nextSlot() ?? 0;
      const hk = `${this.objKey(st)}|${this.planVersion}|${k}|${JSON.stringify(this.mode)}`;
      if (this.memo.hlKey !== hk) {
        const hl = new Map<number, string>();
        if (this.mode.type === 'move' || this.mode.type === 'seize') {
          const f = this.fleet(this.mode.fleet);
          if (f) {
            const from = this.projected(k).get(f.id) ?? f.region;
            if (this.mode.type === 'seize') {
              for (const n of [from, ...st.regions[from].neighbors]) if (st.regions[n].owner !== this.you) hl.set(n, '#ff5d7a');
            } else {
              const sp = this.live ? 99 : fleetSpeed(st, f) + (this.mode.overdrive ? st.rules.overdrive.speedBonus : 0);
              for (const [rid, d] of hops(st, from, sp)) if (d > 0) hl.set(rid, '#6dffb0');
            }
          }
        } else if (this.mode.type === 'target') {
          for (const r of st.regions) if (!validateOrder(st, this.you, { type: this.mode.order, target: r.id } as Order)) hl.set(r.id, '#b78bff');
        }
        this.memo.hlKey = hk; this.memo.hl = hl;
      }
      highlight = this.memo.hl!;
      if (this.mode.type === 'move' && this.hoverRegion !== null) {
        const f = this.fleet(this.mode.fleet);
        const from = f ? this.projected(k).get(f.id) ?? f.region : null;
        if (f && from !== null && this.hoverRegion !== from) {
          const sp = this.live ? 99 : fleetSpeed(st, f) + (this.mode.overdrive ? st.rules.overdrive.speedBonus : 0);
          const p = this.safePath(from, this.hoverRegion);
          if (p && p.length) { const stop = this.blockedAt(p); pathPreview = { pts: [from, ...p].map(x => st.regions[x].site), ok: p.length <= sp && (stop === null || stop === p[p.length - 1]) }; }
        }
      }
    }
    // planned order arrows
    const plannedArrows: { from: Pt; to: Pt; label: string; color: string; dashed?: boolean; kind: Order['type'] }[] = [];
    if (this.live && !this.replay) {
      // routes of fleets in transit (yours, and visible rivals': like reading their carriers' flight plans)
      for (const f of st.fleets) {
        const rt = f.route;
        if (!rt || !rt.path.length) continue;
        let from = f.region;
        const eta = etaTicks(st, f.id);
        rt.path.forEach((r, i) => {
          if (!st.regions[r] || !st.regions[from]) return;
          const lastLeg = i === rt.path.length - 1;
          plannedArrows.push({ from: st.regions[from].site, to: st.regions[r].site, label: lastLeg && eta !== null ? fmtDur(eta * tickMs(st)).replace(/ .*/, '') : '', color: rt.seize !== null && lastLeg ? '#ff5d7a' : this.color(f.owner), dashed: true, kind: 'move' });
          from = r;
        });
      }
    }
    if (!this.replay && this.you !== null && !this.live) {
      this.plan.orders.forEach((o, i) => {
        if (!o) return;
        const pos = this.projected(i);
        const col = this.color(this.you);
        if (o.type === 'move') {
          let from = pos.get(o.fleet);
          if (from === undefined) return;
          for (const r of o.path) { if (!st.regions[r] || !st.regions[from]) break; plannedArrows.push({ from: st.regions[from].site, to: st.regions[r].site, label: r === o.path[o.path.length - 1] ? roman(i + 1) : '', color: col, kind: 'move' }); from = r; }
        } else if (o.type === 'seize') {
          const from = pos.get(o.fleet);
          if (from === undefined) return;
          if (from !== o.target && st.regions[o.target]) plannedArrows.push({ from: st.regions[from].site, to: st.regions[o.target].site, label: roman(i + 1), color: '#ff5d7a', kind: 'seize' });
        }
      });
    }
    this.map.draw({
      state: st, you: this.you, visible: this.visibleSet(), owners, fleets,
      selectedRegion: this.sel?.kind === 'region' ? this.sel.id : null, hoverRegion: this.hoverRegion,
      highlight, plannedArrows, pathPreview,
      signals: this.replay ? [] : this.st.last?.signals ?? [], showSignals: this.showSignals,
      fx: this.fx, now,
      ...this.supplyOverlay(),
    });
    this.fx = this.fx.filter(f => now - f.t0 < f.dur);
    // mode hint
    const hint = this.el.modehint;
    this.root.classList.toggle('targeting', !!this.mode);
    const key = this.mode ? `${this.mode.type}|${this.mode.type === 'move' ? this.mode.overdrive : ''}|${this.nextSlot()}` : '';
    if (this.mode && hint.dataset.key !== key) {
      hint.dataset.key = key;
      hint.classList.remove('hidden');
      const txt = this.mode.type === 'move' ? (this.live ? 'Tap a destination: any distance. The fleet travels in real time.' : `Tap a destination (pulse ${roman((this.nextSlot() ?? 0) + 1)}).`)
        : this.mode.type === 'seize' ? `Tap a region to seize (adjacent or current).`
        : `Tap a target region for ${this.mode.order}.`;
      hint.innerHTML = `<span>${txt}</span>${this.mode.type === 'move' ? `<button data-od class="${this.mode.overdrive ? 'active' : ''}" title="+1 range; fleet is fatigued next turn (Shift)">Overdrive ${this.mode.overdrive ? 'ON' : 'off'}</button>` : ''}<button data-cancel>Cancel</button>`;
      hint.querySelector('[data-od]')?.addEventListener('click', () => { if (this.mode?.type === 'move') { this.mode.overdrive = !this.mode.overdrive; this.odSticky = this.mode.overdrive; } });
      hint.querySelector('[data-cancel]')?.addEventListener('click', () => { this.mode = null; this.renderAll(); });
    } else if (!this.mode) { hint.classList.add('hidden'); hint.dataset.key = ''; }
  }

  /** Map overlays for your supply network (memoized per state): cut-off regions, and where a selected fleet would starve. */
  supplyOverlay(): { cutOff: Set<number> | null; unsupplied: Set<number> | null } {
    const st = this.st, you = this.you;
    if (you === null || st.rules.empire?.enabled === false || this.replay) return { cutOff: null, unsupplied: null };
    const m = this.memo;
    if (m.supSrc !== st) {
      m.supSrc = st;
      const conn = connected(st, you), sup = supplied(st, you, conn);
      const cut = new Set(st.regions.filter(r => r.owner === you && !conn.has(r.id)).map(r => r.id));
      m.cut = cut.size ? cut : null;
      m.unsup = new Set(st.regions.filter(r => !sup.has(r.id)).map(r => r.id));
    }
    const f = this.sel?.kind === 'fleet' ? this.fleet(this.sel.id) : this.mode && 'fleet' in this.mode ? this.fleet(this.mode.fleet) : undefined;
    return { cutOff: m.cut ?? null, unsupplied: f && f.owner === you ? m.unsup ?? null : null };
  }
  objKey(o: object): number { let v = objIds.get(o); if (v === undefined) { v = nextObjId++; objIds.set(o, v); } return v; }
  visibleSet(): Set<number> {
    const v = this.src.view.visible;
    if (this.memo.visSrc !== v) { this.memo.visSrc = v; this.memo.vis = new Set(v); }
    return this.memo.vis!;
  }
  /** LIVE: where a fleet in transit is drawn between ticks (eased toward its next region; never quite arrives before the tick). */
  liveGlide(f: Fleet, base: Pt): Pt {
    const st = this.st;
    const rt = f.route;
    if (!rt || !rt.path.length || !st.regions[rt.path[0]]) return base;
    const frac = Math.min(1, Math.max(0, 1 - (nextTickAt(st) - Date.now()) / tickMs(st)));
    const sp = Math.max(1, fleetSpeed(st, f)) + (rt.overdrive ? st.rules.overdrive.speedBonus : 0);
    const prog = Math.min(0.92, Math.max(0, (rt.mp + sp * frac) / st.rules.live.stepCost));
    const to = st.regions[rt.path[0]].site;
    const e = prog * prog * (3 - 2 * prog);
    return { x: base.x + (to.x - base.x) * e * 0.85, y: base.y + (to.y - base.y) * e * 0.85 };
  }
  /** Token positions of the current fleets (memoized per state and zoom). */
  fleetLayout(): Map<number, Pt> {
    const px = this.map.px(1);
    if (this.memo.laySrc !== this.st.fleets || this.memo.layPx !== px) {
      this.memo.laySrc = this.st.fleets; this.memo.layPx = px;
      this.memo.lay = regionLayout(this.st, this.st.fleets, px);
    }
    return this.memo.lay!;
  }

  // ================================================================== input
  onResize = () => {
    if (this.destroyed) return;
    const was = this.root.classList.contains('phone');
    this.root.classList.toggle('phone', this.phone);
    if (was !== this.phone) this.renderAll();
    this.map.resize();
    if (!this.map.fitted && this.map.w > 0) this.map.fit(this.st, this.you !== null ? this.st.regions[this.st.players[this.you]?.capital]?.site : undefined);
  };
  onKey = (e: KeyboardEvent) => {
    if (this.destroyed || e.defaultPrevented) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (this.curtain || document.querySelector('.bv-overlay, .overlay')) return;
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.submit(); return; }
    // leave browser shortcuts (Ctrl+R, Ctrl+F, Cmd+P…) alone
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Shift') { if (this.mode?.type === 'move') this.mode.overdrive = true; return; }
    // a focused button activates on Space/Enter: don't double-handle
    if ((e.key === ' ' || e.key === 'Enter') && t?.tagName === 'BUTTON') return;
    if (e.key === 'Escape') { if (this.mode) this.mode = null; else if (this.targetSlot !== null) this.targetSlot = null; else this.sel = null; this.renderAll(); return; }
    if (e.key === ' ' && this.replay) { this.togglePause(); e.preventDefault(); return; }
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (/^[1-9]$/.test(k) && this.canPlan && !this.replay) { const i = Number(k) - 1; if (i < this.plan.orders.length) { this.targetSlot = this.targetSlot === i ? null : i; this.renderTab(); } return; }
    if (this.sel?.kind === 'fleet' && this.fleet(this.sel.id)?.owner === this.you && !this.replay) {
      if (k === 'm') { this.action('move', {}); return; }
      if (k === 's') { this.action('seize', {}); return; }
      if (k === 'f') { this.action('fortify', {}); return; }
    }
    if (k === 'i') this.toolbar('signals');
    else if (k === 'p') this.toolbar('panel');
    else if (k === 'h' || e.key === '?') this.toolbar('help');
    else if (k === 'r') this.toolbar('replay');
  };
  onKeyUp = (e: KeyboardEvent) => { if (e.key === 'Shift' && this.mode?.type === 'move') this.mode.overdrive = this.odSticky; };
  onBlur = () => { this.pointers.clear(); this.drag = null; this.pinch = null; };

  bindInput() {
    const c = this.el.canvas;
    c.addEventListener('pointerdown', e => {
      // only the primary mouse button pans/clicks (right-click cancels via contextmenu)
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      try { c.setPointerCapture(e.pointerId); } catch { /* */ }
      this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.map.cam.z };
        this.drag = null;
      } else this.drag = { x: e.offsetX, y: e.offsetY, cx: this.map.cam.x, cy: this.map.cam.y, moved: false };
    });
    c.addEventListener('pointermove', e => {
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (this.pinch && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        // zoom about the midpoint of the two fingers
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const before = this.map.toWorld(mx, my);
        this.map.cam.z = clampZ(this.pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, this.pinch.d));
        const after = this.map.toWorld(mx, my);
        this.map.cam.x += before.x - after.x; this.map.cam.y += before.y - after.y;
        return;
      }
      if (this.drag) {
        const dx = e.offsetX - this.drag.x, dy = e.offsetY - this.drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) this.drag.moved = true;
        if (this.drag.moved) { this.map.cam.x = this.drag.cx - dx / this.map.cam.z; this.map.cam.y = this.drag.cy - dy / this.map.cam.z; }
      }
      if (e.pointerType === 'touch') return; // no hover on touch
      this.hoverRegion = this.map.regionAt(this.st, e.offsetX, e.offsetY);
      if (this.mode?.type === 'move') this.mode.overdrive = e.shiftKey || this.odSticky;
      this.tooltip(e);
    });
    const up = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      const d = this.drag;
      this.drag = null;
      if (d && !d.moved && e.type === 'pointerup' && this.pointers.size === 0) this.click(e.offsetX, e.offsetY, e.shiftKey);
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', () => { this.el.tooltip.classList.add('hidden'); if (!this.drag) this.hoverRegion = null; });
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const before = this.map.toWorld(e.offsetX, e.offsetY);
      this.map.cam.z = clampZ(this.map.cam.z * Math.exp(-e.deltaY * 0.0015));
      const after = this.map.toWorld(e.offsetX, e.offsetY);
      this.map.cam.x += before.x - after.x; this.map.cam.y += before.y - after.y;
    }, { passive: false });
    c.addEventListener('contextmenu', e => { e.preventDefault(); this.mode = null; this.renderAll(); });
  }

  currentFleetDraws(): FleetDraw[] {
    const lay = this.fleetLayout();
    return this.st.fleets.map(f => ({ id: f.id, owner: f.owner, ships: f.ships.length, pos: lay.get(f.id) ?? this.st.regions[f.region].site, alpha: 1, name: f.name }));
  }

  click(x: number, y: number, shift: boolean) {
    if (this.replay && this.live && !this.replay.preview) this.endReplay();
    if (this.replay) return;
    const rid = this.map.regionAt(this.st, x, y);
    if (this.mode && rid !== null) {
      const m = this.mode;
      if (m.type === 'move') {
        const f = this.fleet(m.fleet)!;
        const from = this.projected(this.nextSlot() ?? 0).get(f.id) ?? f.region;
        const path = this.safePath(from, rid);
        if (!path || !path.length) { toast('No route.'); return; }
        const stop = this.blockedAt(path);
        if (stop !== null && stop !== path[path.length - 1]) toast(`Warning: this route is stopped at ${this.st.regions[stop].name} (hostile garrison or fleet).`);
        const sp = fleetSpeed(this.st, f);
        if (this.live) { this.addOrder({ type: 'move', fleet: f.id, path, overdrive: m.overdrive || shift || undefined }); return; }
        const od = shift || m.overdrive || path.length > sp;
        this.addOrder({ type: 'move', fleet: f.id, path, overdrive: od && path.length > sp ? true : undefined });
      } else if (m.type === 'seize') this.addOrder({ type: 'seize', fleet: m.fleet, target: rid });
      else this.addOrder({ type: m.order, target: rid } as Order);
      return;
    }
    const f = this.map.fleetAt(this.currentFleetDraws(), x, y);
    if (f) { this.select({ kind: 'fleet', id: f.id }); return; }
    if (rid !== null) this.select({ kind: 'region', id: rid });
    else { this.sel = null; this.renderLeft(); }
  }

  /** Is region r a place your fleet would be stopped at (rival garrison / visible hostile fleet)? */
  stopsAt(r: number): boolean {
    const reg = this.st.regions[r];
    const you = this.you!;
    const pact = (o: number) => this.st.pacts.some(x => x.until >= this.st.turn && ((x.a === you && x.b === o) || (x.b === you && x.a === o)));
    if (reg.owner !== null && reg.owner !== you && !pact(reg.owner) && reg.garrison !== 0) return true;
    return this.st.fleets.some(f => f.region === r && f.owner !== you && f.ships.length && (f.owner === -1 || !pact(f.owner)));
  }
  blockedAt(path: number[]): number | null { for (const r of path) if (this.stopsAt(r)) return r; return null; }
  /** Shortest path whose intermediate regions don't stop you; falls back to the plain shortest path. */
  safePath(from: number, to: number): number[] | null {
    const st = this.st;
    const prev = new Map<number, number>([[from, -1]]);
    const q = [from];
    while (q.length) {
      const c = q.shift()!;
      if (c === to) break;
      if (c !== from && this.stopsAt(c)) continue;
      for (const n of st.regions[c].neighbors) if (!prev.has(n)) { prev.set(n, c); q.push(n); }
    }
    if (!prev.has(to)) return findPath(st, from, to);
    const out: number[] = [];
    for (let c = to; c !== from; c = prev.get(c)!) out.unshift(c);
    return out;
  }

  select(s: { kind: 'region' | 'fleet'; id: number }) {
    if (this.phone) this.sheetOpen = false; this.sel = s; this.mode = null; this.renderLeft(); }
  focus(p: Pt) { this.map.flyTo(p); }

  tooltip(e: PointerEvent) {
    const t = this.el.tooltip;
    const f = this.map.fleetAt(this.currentFleetDraws(), e.offsetX, e.offsetY);
    let html = '';
    if (f) {
      const fl = this.fleet(f.id);
      if (fl) html = `<b style="color:${this.color(fl.owner)}">${esc(fl.name)}</b><br>${esc(this.pname(fl.owner))} · ${fl.ships.length} ship${fl.ships.length === 1 ? '' : 's'} · power ${fleetPower(this.st, fl)}<br><span class="dim">${esc(fl.commander.name)}${fl.commander.traits.length ? ' · ' + esc(fl.commander.traits.map(x => TRAITS[x]?.name ?? x).join(', ')) : ''}</span>`;
    } else if (this.hoverRegion !== null) {
      const r = this.st.regions[this.hoverRegion];
      html = `<b style="color:${this.color(r.owner)}">${esc(r.name)}</b> <span class="dim">${esc(r.kind)}${r.feature !== 'none' ? ' · ' + esc(r.feature) : ''}</span><br>${esc(this.pname(r.owner))} · garrison ${r.garrison < 0 ? '?' : r.garrison}`;
      if (this.mode?.type === 'seize') {
        const k = this.nextSlot() ?? 0;
        const fl = this.fleet(this.mode.fleet);
        const from = fl ? this.projected(k).get(fl.id) ?? fl.region : -1;
        if (fl && (from === r.id || this.st.regions[from]?.neighbors.includes(r.id)) && r.owner !== this.you) {
          const od = this.odds([fl.id], r.id, k);
          if (od) html += `<br>Seize odds ≈ <span class="odds ${od.p >= 0.65 ? 'hi' : od.p >= 0.4 ? 'mid' : 'lo'}">${Math.round(od.p * 100)}%</span>${od.note ? `<br><span class="dim">${esc(od.note)}</span>` : ''}`;
        }
      }
      if (this.mode?.type === 'move') {
        const fl = this.fleet(this.mode.fleet);
        if (fl) {
          const from = this.projected(this.nextSlot() ?? 0).get(fl.id) ?? fl.region;
          const p = findPath(this.st, from, r.id);
          if (p && this.live) html += `<br>${p.length} jump${p.length === 1 ? '' : 's'} · arrives in ~${fmtDur(Math.ceil((p.length * this.st.rules.live.stepCost) / Math.max(1, fleetSpeed(this.st, fl))) * tickMs(this.st))}`;
          else if (p) html += `<br>${p.length} jump${p.length === 1 ? '' : 's'} (speed ${fleetSpeed(this.st, fl)})${p.length > fleetSpeed(this.st, fl) ? ' <span class="gold">OVERDRIVE</span>' : ''}`;
        }
      }
    }
    if (!html || this.drag?.moved) { t.classList.add('hidden'); return; }
    t.innerHTML = html;
    t.classList.remove('hidden');
    t.style.left = `${Math.min(window.innerWidth - 290, e.clientX + 14)}px`;
    t.style.top = `${e.clientY + 14}px`;
  }

  toolbar(a: string) {
    switch (a) {
      case 'replay': if (this.st.last) this.startReplay(this.st.last); else toast('Nothing to replay yet.'); break;
      case 'panel': this.el.right.classList.toggle('min'); break;
      case 'signals': this.showSignals = !this.showSignals; toast(`Intel signals ${this.showSignals ? 'shown' : 'hidden'} on map`); break;
      case 'help': {
        const o = overlay(`<div class="dialog wide scroll help">${helpHtml(this.st)}<div class="row" style="margin-top:12px"><button class="primary" data-x>Got it</button>${this.you !== null ? '<button data-tour>↻ Replay the quick tour</button>' : ''}</div></div>`);
        o.querySelector('[data-x]')!.addEventListener('click', () => o.remove());
        o.querySelector('[data-tour]')?.addEventListener('click', () => { o.remove(); this.restartTour(); });
        break;
      }
      case 'menu': this.menu(); break;
    }
  }

  /** Start the first-run coach again (menu / help). */
  restartTour() {
    if (this.you === null) return;
    if (this.replay) this.endReplay();
    this.sel = null; this.mode = null;
    if (this.phone) this.sheetOpen = false;
    if (!this.coach) this.coach = new Coach(this);
    this.coach.restart();
    this.renderAll();
    if (!this.coach.active) toast('The tour is only available while you can give orders.');
  }

  menu() {
    const local = this.src instanceof LocalSource ? this.src : null;
    const link = this.src.kind === 'remote' && this.you !== null ? `${location.origin}${location.pathname}#/g/${this.src.meta.id}/${(this.src as any).token}` : '';
    const o = overlay(`<div class="dialog"><h2>Menu</h2><div class="col">
      ${link ? `<div class="dim" style="font-size:13px">Your private seat link (open it on another device to keep playing; don't share it):</div><input value="${esc(link)}" readonly onclick="this.select()">
      <div class="dim" style="font-size:13px">Invite link for others: <input value="${esc(location.origin + location.pathname + '#/g/' + this.src.meta.id)}" readonly onclick="this.select()"></div>` : ''}
      <div class="row"><button data-x="replaylast">⟲ Replay last turn</button><button data-x="intel">◎ Intel on map: ${this.showSignals ? 'on' : 'off'}</button><button data-x="help">? How to play</button>${this.you !== null ? '<button data-x="tour">↻ Quick tour</button>' : ''}</div>
      <div class="row"><span class="dim">Replay turn</span><input type="number" min="1" max="${this.st.turn - 1}" value="${Math.max(1, this.st.turn - 1)}" data-rt style="width:80px"><button data-x="replayturn">▶</button></div>
      ${local ? `<button data-x="save">💾 Download save file</button><label class="row"><input type="checkbox" data-x="reveal" ${local.save.reveal ? 'checked' : ''}> Reveal the whole map (dev / spectate)</label>` : ''}
      <button data-x="exit">⏏ Back to lobby</button><button data-x="close">Close</button></div></div>`);
    o.querySelectorAll<HTMLElement>('[data-x]').forEach(b => b.addEventListener(b.tagName === 'INPUT' ? 'change' : 'click', () => {
      const x = b.dataset.x;
      if (x === 'exit') { o.remove(); this.onExit(); }
      if (x === 'close') o.remove();
      if (x === 'replaylast') { o.remove(); this.toolbar('replay'); }
      if (x === 'intel') { this.showSignals = !this.showSignals; (b as HTMLElement).textContent = `◎ Intel on map: ${this.showSignals ? 'on' : 'off'}`; }
      if (x === 'help') { o.remove(); this.toolbar('help'); }
      if (x === 'tour') { o.remove(); this.restartTour(); }
      if (x === 'save') this.exportSave();
      if (x === 'reveal' && local) { local.setReveal((b as HTMLInputElement).checked); }
      if (x === 'replayturn') { o.remove(); void this.replayTurn(Number(o.querySelector<HTMLInputElement>('[data-rt]')!.value)); }
    }));
  }

  exportSave() {
    if (!(this.src instanceof LocalSource)) return;
    const blob = new Blob([JSON.stringify(this.src.save)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `three-crowns-turn${this.st.turn}.json`;
    a.click();
  }

  showVictory() {
    if (document.querySelector('[data-victory]')) return;
    const st = this.st;
    const w = st.players[st.winner!];
    const ranks = st.players.slice().sort((a, b) => b.vp - a.vp);
    // flourish (fx.css): light rays and embers in the winner's colour behind the card, a crown that drops in, ranks that rise in turn
    const sparks = reducedMotion() ? '' : Array.from({ length: 18 }, (_, i) => `<i style="--x:${(i * 37) % 100}%;--d:${(i * 0.23) % 2.4}s;--s:${0.6 + ((i * 7) % 5) / 5}"></i>`).join('');
    const o = overlay(`<div class="vic-rays" aria-hidden="true"></div><div class="vic-sparks" aria-hidden="true">${sparks}</div><div class="dialog vic-card" data-victory style="text-align:center"><div class="vic-crown" aria-hidden="true">♛</div><h1 class="vic-name" style="color:${w.color};font-size:30px">${esc(w.name)}</h1><h2>${w.id === this.you ? 'Victory' : 'has won'}</h2>
      <p class="dim">${esc(st.winReason)}</p>${ranks.map((p, i) => `<div class="vic-rank" style="color:${p.color};--i:${i}">${esc(p.name)}: ${p.vp} VP</div>`).join('')}
      <p class="dim" style="margin-top:12px">The whole map is now revealed. Browse the Chronicle to relive it.</p><div class="row" style="justify-content:center"><button data-x>Look around</button><button class="primary" data-l>Lobby</button></div></div>`);
    o.classList.add('victory');
    o.style.setProperty('--win', w.color);
    // the winner's banner goes up over every region they hold, rippling out from their capital
    const now = performance.now();
    const cap = st.regions[w.capital]?.site ?? st.regions[0].site;
    for (const r of st.regions) if (r.owner === w.id) this.fx.push({ kind: 'capture', pos: r.site, color: w.color, t0: now + Math.hypot(r.site.x - cap.x, r.site.y - cap.y) * 0.6, dur: 1100 });
    o.querySelector('[data-x]')!.addEventListener('click', () => o.remove());
    o.querySelector('[data-l]')!.addEventListener('click', () => { o.remove(); this.onExit(); });
  }
}

// ---------------------------------------------------------------- helpers
/** Games created by an older version lack newer rule groups: fill them in from the defaults so the UI (and a local sim) can't crash. */
export function backfillRules(st: GameState) {
  if (!st?.rules || (st.rules as { __filled?: boolean }).__filled) return;
  const merged = mergeRules(defaultRules(), st.rules);
  Object.defineProperty(merged, '__filled', { value: true, enumerable: false });
  st.rules = merged;
}

const objIds = new WeakMap<object, number>();
let nextObjId = 1;

/** BFS hop counts from `from`, up to `max` jumps. */
function hops(st: GameState, from: number, max: number): Map<number, number> {
  const d = new Map<number, number>([[from, 0]]);
  let frontier = [from];
  for (let k = 1; k <= max && frontier.length; k++) {
    const next: number[] = [];
    for (const c of frontier) for (const n of st.regions[c]?.neighbors ?? []) if (!d.has(n)) { d.set(n, k); next.push(n); }
    frontier = next;
  }
  return d;
}

/** Attribute for an info popover (text only; newlines become line breaks). */
function tip(text: string): string { return ` data-tip="${esc(text)}"`; }
const ip = (text: string) => `<i class="ip"${tip(text)}>i</i>`;
const plus = (n: number) => `${n >= 0 ? '+' : ''}${n}`;

function capFirst(t: string | null): string | null { return t ? t[0].toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? '' : '.') : null; }

function clampZ(z: number) { return Math.max(0.12, Math.min(3, z)); }

function glyph(cls: string): string {
  return ({ scout: '›', corvette: '➤', frigate: '◆', bombard: '■', cruiser: '▰', dread: '⬢' } as Record<string, string>)[cls] ?? '•';
}

export function eventText(st: GameState, e: GameEvent, you: number | null): string {
  const rn = (id: number) => `<b>${esc(st.regions[id]?.name ?? '?')}</b>`;
  const pn = (o: number | null) => o === null ? 'neutrals' : o < 0 ? 'the Warden' : `<span style="color:${st.players[o]?.color}">${esc(st.players[o]?.name ?? '?')}</span>`;
  const fn = (id: number) => esc(st.fleets.find(f => f.id === id)?.name ?? 'a fleet');
  switch (e.k) {
    case 'pulse': return `<b>Pulse ${roman(e.pulse)}</b>`;
    case 'move': return e.guard ? `${pn(e.owner)} guard ${fn(e.fleet)} rushes to ${rn(e.to)}` : `${pn(e.owner)} ${fn(e.fleet)} → ${rn(e.to)}`;
    case 'blocked': return `${pn(e.owner)} ${fn(e.fleet)} stopped at ${rn(e.at)} (${esc(e.reason)})`;
    case 'clash': return `Fleets clash on the ${rn(e.a)}–${rn(e.b)} border!`;
    case 'battle': return `<a href="#" data-battle="${e.battle}">⚔ ${esc(e.name)}</a>`;
    case 'retreat': return `${pn(e.owner)} ${fn(e.fleet)} retreats to ${rn(e.to)}`;
    case 'destroyed': return `<span class="bad">${esc(e.name)} destroyed</span> at ${rn(e.region)}`;
    case 'capture': return `${pn(e.by)} ${e.how === 'influence' ? 'wins over' : 'captures'} ${rn(e.region)}${e.from !== null ? ` from ${pn(e.from)}` : ''}`;
    case 'build': return `${pn(e.owner)} launches ${esc(e.name)} (${esc(st.rules.ships[e.cls]?.name ?? e.cls)}) at ${rn(e.region)}`;
    case 'project': return e.done ? `${pn(e.owner)} completes ${esc(st.rules.projects[e.key]?.name ?? e.key)} at ${rn(e.region)}` : `${pn(e.owner)} begins ${esc(st.rules.projects[e.key]?.name ?? e.key)} at ${rn(e.region)}`;
    case 'influence': return `${pn(e.owner)} agents in ${rn(e.region)} (${e.loyalty})`;
    case 'fortify': return `${pn(e.owner)} ${fn(e.fleet)} digs in at ${rn(e.region)}`;
    case 'scan': return `Scan of ${rn(e.region)}`;
    case 'excavate': return `${pn(e.owner)} excavates a relic at ${rn(e.region)}!`;
    case 'pact': return `${pn(e.a)} and ${pn(e.b)} sign a pact`;
    case 'betrayal': return `<span class="bad">BETRAYAL:</span> ${pn(e.by)} attacks ${pn(e.victim)} at ${rn(e.region)}`;
    case 'fail': return e.owner === you ? `<span class="bad">${esc(e.text)}</span>` : '';
    case 'note': return esc(e.text);
    case 'tech': { const t = TECH[e.tech]; return e.stolen ? `${pn(e.owner)} steals <b>${esc(t?.name ?? e.tech)}</b> from a captured Academy` : `${pn(e.owner)} researched ${t?.icon ?? ''} <b>${esc(t?.name ?? e.tech)}</b>${t?.tier === 4 ? ' <span class="gold">★</span>' : ''}`; }
    case 'law': { const l = LAW[e.law]; return `${pn(e.owner)} ${e.revoked ? 'revokes' : 'enacts'} ${l?.icon ?? ''} <b>${esc(l?.name ?? e.law)}</b>`; }
    case 'refit': return `${pn(e.owner)} ${fn(e.fleet)} refits at ${rn(e.region)}`;
  }
}

export { EDICTS };
