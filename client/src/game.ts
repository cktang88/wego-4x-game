// The in-game screen (UX v2, docs/UX-V2.md): a full-screen board with a thin HUD over it. GameScreen owns the
// game data (plan, projected state, validation, replays, the map frame); the HUD chrome lives in client/src/hud/*:
//   hud.ts (layout, top bar, buttons, menu, modal bridge) · strip.ts (plan strip + primary button) · card.ts
//   (selection card, ship fan) · ring.ts (context ring) · gestures.ts (pointer + drag-to-order) · verbs.ts (what a
//   drop means) · notify.ts (notification chips) · onboarding.ts (teach-by-doing callouts).
import { orderCost, validateOrder, costText, canAfford, ORDER_INFO } from '../../shared/sim/orders.ts';
import { findPath, fleetSpeed } from '../../shared/sim/graph.ts';
import { creditRate, resolveTurn, emptySubmission } from '../../shared/sim/resolve.ts';
import { NEUTRAL_COLOR } from '../../shared/config/content.ts';
import { EDICTS } from '../../shared/sim/edicts.ts';
import type { Doctrine, Fleet, GameEvent, GameState, Order, Player, Pt, Submission, TurnResult } from '../../shared/sim/types.ts';
import { predictAssault } from '../../shared/sim/ai.ts';
import { maxGarrison } from '../../shared/sim/setup.ts';
import { defaultRules, mergeRules } from '../../shared/config/rules.ts';
import type { GameSource } from './net.ts';
import { LocalSource, tokens } from './net.ts';
import { MapRenderer, regionLayout, reducedMotion, type DrawInput, type FleetDraw, type Fx } from './render/map.ts';
import { openBattleViewer } from './render/battle.ts';
import { h, esc, toast, overlay, roman, resetUiFx } from './ui/dom.ts';
import { ic, icFor, glyphHtml, iconizeHtml } from './art/icons.ts';
import { nextTickAt, tickMs, etaTicks, tickInCycle } from '../../shared/sim/live.ts';
import type { FreeAction } from '../../shared/sim/types.ts';
import { TECH, LAW, BRANCHES, MODULE } from '../../shared/config/empire.ts';
import { connected, supplied, techCost, researchBlock, opposite, researchedThisTurn, gateNeighbors } from '../../shared/sim/empire.ts';
import { empireFreeText, pendingResearch, type EmpFocus } from './ui/empire.ts';
import { Hud } from './hud/hud.ts';
import { Gestures } from './hud/gestures.ts';
import { Teach } from './hud/onboarding.ts';
import { fmtDur, shortWhy, typing, safeInsets } from './hud/util.ts';
import { intentFor, commitIntent, type Intent } from './hud/verbs.ts';
import { applyFoundingVows } from './hud/soul.ts';
import { postureMap } from './hud/signature.ts';
import { FATE_USES, POSTURES, WORLD_POSTURES } from '../../shared/config/content.ts';
import { maybeHerald, openHerald, heraldOpen, closeHerald } from './ui/herald.ts';
import { openSaga, sagaOpen, closeSaga } from './ui/saga.ts';
import { audio } from './audio/audio.ts';
import { direct, flopArrows, SOUL_STAMP, type Beat } from './fx/director.ts';
import { ReplayClock, reduced as reducedFx } from './fx/motion.ts';
import { Stage } from './fx/stage.ts';
import { sealRitual, SEAL_MS } from './fx/seal.ts';
import { Reckoning } from './fx/summary.ts';
import { vpChanges, turnEntries, type VpEntry } from './fx/vp.ts';
import { nearMissLine } from './fx/nearmiss.ts';
import { crowning } from './fx/crowning.ts';
import { haptic } from './fx/haptics.ts';
// the chrome theme and the Soul layer's styles load after every other sheet (shell.css, modals.css)
import './theme.css';
import './soul.css';

export { fmtDur };

/** M / S armed a fleet: the next click on the map only considers that verb. */
type Mode = null | { type: 'move' | 'seize'; fleet: number };
export type Lens = 'political' | 'supply' | 'economy' | 'military';
export const LENSES: Lens[] = ['political', 'supply', 'economy', 'military'];

interface ReplayFleet { id: number; owner: number; ships: number; region: number; alpha: number; name: string }
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
  /** battles shown so far in this replay (result chips) */
  seen: number[];
  /** the latest turn, freshly resolved (seals, the inhale, the Reckoning); not a Preview, a re-watch or a LIVE tick */
  fresh: boolean;
  /** the beat whose side effects (sounds, staged acts, hit-pauses) have run; they wait while paused or curtained */
  begun: number;
  /** seats in the order they sealed (Act I) */
  sealOrder: number[];
  /** Act II: every visible move of the turn, drawn as arrows; and when the flop began (replay clock) */
  flop: { owner: number; from: number; to: number }[];
  flopAt: number | null;
  /** the one battle that gets the big treatment (slow motion on its decisive volley), if any */
  big: number | null;
  /** real time before which the reveal waits (the seal ritual still playing: a local game resolves at once) */
  holdUntil: number;
}

export class GameScreen {
  root: HTMLElement;
  map: MapRenderer;
  plan: Submission;
  sel: { kind: 'region' | 'fleet'; id: number } | null = null;
  mode: Mode = null;
  targetSlot: number | null = null;
  hoverRegion: number | null = null;
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
  /** chat messages not yet read (the Score button shows a dot; the Score modal resets it) */
  unreadChat = 0;
  raf = 0;
  el: Record<string, HTMLElement> = {};
  destroyed = false;
  previewing = false;
  autoPlay = false;
  flashOrder = 0;
  lastClock = 0;
  planVersion = 0;
  /** replay speed chosen by the user, kept across turns (Auto play) */
  replaySpeed = 1;
  victoryShown = false;
  curtain: HTMLElement | null = null;
  /** which collapsible sections are open (kept for the session, per section name; used by Empire content) */
  openSecs = new Set<string>();
  tipEl: HTMLElement | null = null;
  /** Empire modal: the selected tech / law card, and (spectators) whose empire is shown */
  empFocus: EmpFocus = null;
  empPid: number | null = null;
  /** Chat (Score modal): the unsent message and its recipient survive re-renders */
  chatDraft = '';
  chatTo = '';
  // ---- UX v2 state
  hud!: Hud;
  gest!: Gestures;
  teach: Teach | null = null;
  /** map lens (keys 1-4, the ◐ button) */
  lens: Lens = 'political';
  /** hold Space: detail-tier banners everywhere */
  peek = false;
  /** a region whose stacked own fleets are fanned out on the map */
  expanded: number | null = null;
  /** ships lifted in the selected fleet's ship fan (tap to lift; drag to split) */
  lifted = new Set<number>();
  /** plan snapshots for Ctrl+Z (cleared at seal / new turn) */
  undoStack: string[] = [];
  /** a valid drop made while every slot was full: the strip asks which order to replace */
  replacing: Intent | null = null;
  /** plan chip under the pointer (its arrow lights up) */
  hoverSlot: number | null = null;
  /** onboarding: a ghost arrow to draw (region ids) */
  teachArrow: { from: number; to: number } | null = null;
  // ---- reward moments (client/src/fx)
  /** the replay's clock: hit-pauses and slow motion bend it, never backwards */
  clock = new ReplayClock();
  /** the staged acts over the board (seals, battle holds, titles) */
  stage!: Stage;
  /** the VP count-up and the Reckoning ribbon */
  reck!: Reckoning;
  /** a crest's VP during the count-up (null/absent: the real value) */
  vpShown = new Map<number, number>();
  /** LIVE: VP log entries already counted up, per house */
  private vpSeen: number[] | null = null;
  /** when each seat was seen to seal this turn (AIs first, -1); unseen seals count as last */
  private sealSeen = new Map<number, number>();
  private sealTurn = -1;
  private lastSealOrder: number[] = [];
  /** the seal ritual is playing: a hotseat hand-off waits for it; the first act waits too */
  sealingUntil = 0;
  sealDoneAt = 0;
  private lastPlanKey = '';
  private ro: ResizeObserver | null = null;
  private timers = new Set<number>();
  private memo: { supSrc?: GameState; cut?: Set<number> | null; unsup?: Set<number>; visSrc?: number[]; vis?: Set<number>; laySrc?: Fleet[]; layPx?: number; lay?: Map<number, Pt> } = {};

  constructor(parent: HTMLElement, public src: GameSource, public onExit: () => void) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    resetUiFx();
    this.root = h('div', { class: 'game shell' });
    parent.appendChild(this.root);
    this.root.innerHTML = `<div class="stage" data-el="stage"><canvas data-el="canvas"></canvas></div><div class="hud" data-el="hud"></div>`;
    this.root.querySelectorAll<HTMLElement>('[data-el]').forEach(e => (this.el[e.dataset.el!] = e));
    this.map = new MapRenderer(this.el.canvas as HTMLCanvasElement);
    this.plan = this.freshPlan();
    this.hud = new Hud(this);
    this.stage = new Stage(this.root);
    this.reck = new Reckoning({
      get st() { return self.st; }, get you() { return self.you; }, layer: this.stage.layer,
      toClient: p => { const q = self.map.toScreen(p), r = self.el.canvas.getBoundingClientRect(); return r.width ? { x: q.x + r.left, y: q.y + r.top } : null; },
      mapRect: () => self.el.canvas.getBoundingClientRect(),
      crest: p => self.hud.h.crests.querySelector<HTMLElement>(`[data-crest="${p}"]`),
      setShown: (p, v) => { if (v === null) self.vpShown.delete(p); else self.vpShown.set(p, v); },
      ribbonTop: () => { const t = self.hud.h.res.getBoundingClientRect(), c = self.hud.h.crests.getBoundingClientRect(), k = self.hud.h.turn.getBoundingClientRect(); return Math.max(t.bottom, c.bottom, k.bottom, 0) + 10; },
      get phone() { return self.phone; },
      busy: () => !!self.sel || self.covered() || !self.hud.h.card.classList.contains('hidden'),
    });
    this.gest = new Gestures(this);
    src.onChange = k => this.onSourceChange(k);
    if (src instanceof LocalSource) src.onHandoff = seat => this.handoff(seat);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    if ('ResizeObserver' in window) { this.ro = new ResizeObserver(() => this.onResize()); this.ro.observe(this.el.stage); }
    this.onResize();
    this.lastSeenTurn = this.readSeenTurn();
    this.prunePlans();
    this.onSourceChange('view');
    // the board's music and ambient bed (they wait for the first gesture if audio is still locked)
    audio.scene(this.st.winner === null ? 'board' : 'lobby');
    this.bindTips();
    this.teach = new Teach(this);
    this.renderAll();
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
    this.teach?.destroy();
    this.reck.destroy();
    this.stage.destroy();
    this.gest.destroy();
    this.hud.destroy();
    this.map.dispose();
    this.tipEl?.remove();
    this.root.remove();
    audio.me = null;
    audio.scene('lobby');
  }
  /** Info popovers for any [data-tip] element: hover with a mouse, long-press / tap on touch screens. */
  bindTips() {
    const t = this.tipEl = h('div', { class: 'uxtip hidden', role: 'tooltip' });
    document.body.appendChild(t);
    let shownFor: HTMLElement | null = null;
    const show = (el: HTMLElement) => {
      shownFor = el;
      t.innerHTML = glyphHtml(esc(el.dataset.tip ?? ''));
      t.classList.remove('hidden');
      const r = el.getBoundingClientRect(), w = t.offsetWidth, hh = t.offsetHeight;
      // keep clear of the notch / home bar (a tip above a top-bar pill went under the Dynamic Island)
      const si = safeInsets(this.root);
      let y = r.top - hh - 8;
      if (y < 8 + si.t) y = r.bottom + 8;
      t.style.left = `${Math.round(Math.max(8 + si.l, Math.min(window.innerWidth - w - 8 - si.r, r.left + r.width / 2 - w / 2)))}px`;
      t.style.top = `${Math.round(Math.max(8 + si.t, y))}px`;
    };
    const hide = () => { shownFor = null; mapTipOn = false; t.classList.add('hidden'); };
    this.hideTip = hide;
    // the map's marks have no DOM element: the map (render/map.ts, gestures) shows plain-language text at a point
    let mapTipOn = false;
    this.mapTip = (text, x = 0, y = 0) => {
      if (!text) { if (mapTipOn) hide(); return; }
      if (shownFor) return;   // a DOM tip wins
      mapTipOn = true;
      t.innerHTML = glyphHtml(esc(text));
      t.classList.remove('hidden');
      const w = t.offsetWidth, hh = t.offsetHeight, si = safeInsets(this.root);
      let ty = y - hh - 14;
      if (ty < 8 + si.t) ty = y + 18;
      t.style.left = `${Math.round(Math.max(8 + si.l, Math.min(window.innerWidth - w - 8 - si.r, x - w / 2)))}px`;
      t.style.top = `${Math.round(Math.max(8 + si.t, Math.min(window.innerHeight - hh - 8 - si.b, ty)))}px`;
    };
    this.root.addEventListener('scroll', () => { if (shownFor) hide(); }, true);
    this.tipCheck = () => { if (shownFor && !shownFor.isConnected) hide(); };
    this.root.addEventListener('pointerover', e => {
      if (e.pointerType !== 'mouse' || window.matchMedia('(pointer: coarse)').matches) return;
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
      if (el) { if (el !== shownFor) show(el); } else if (shownFor) hide();
    });
    this.root.addEventListener('pointerleave', hide);
    this.root.addEventListener('pointerdown', () => hide());
    // touch: long-press anything with a tip (buttons included) to read it
    let lp = 0, held = false;
    this.root.addEventListener('pointerdown', e => {
      held = false;
      if (e.pointerType === 'mouse') return;
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
      clearTimeout(lp);
      if (el) lp = window.setTimeout(() => { show(el); held = true; this.tipHeldUntil = performance.now() + 400; }, 420);
    });
    const clear = () => clearTimeout(lp);
    // the click comes with the release, however long the finger stayed down: swallow it from there
    this.root.addEventListener('pointerup', () => { clear(); if (held) { held = false; this.tipHeldUntil = performance.now() + 400; } });
    this.root.addEventListener('pointercancel', clear);
    this.root.addEventListener('pointermove', e => { if (e.pointerType !== 'mouse' && Math.abs(e.movementX) + Math.abs(e.movementY) > 6) clear(); });
    // a long-press that showed a tip must not also click
    this.root.addEventListener('click', e => { if (performance.now() < this.tipHeldUntil) { e.stopPropagation(); e.preventDefault(); } }, true);
  }
  tipHeldUntil = 0;
  private shownHtml = new WeakMap<HTMLElement, string>();
  /** Set innerHTML only if it differs from what this element last got; returns whether it was rebuilt. */
  setHtml(el: HTMLElement, html: string): boolean {
    if (this.shownHtml.get(el) === html && (el.childElementCount || !html)) return false;
    this.shownHtml.set(el, html);
    el.innerHTML = iconizeHtml(html);
    return true;
  }
  /** Hide the info popover (set up by bindTips). */
  hideTip: () => void = () => {};
  /**
   * Show plain-language text for a map mark at client point (x, y), or hide it with null. For hover / long-press on
   * the canvas (the map has no DOM elements for [data-tip]); a DOM tip that is already up takes precedence.
   */
  mapTip: (text: string | null, x?: number, y?: number) => void = () => {};
  /** Hide the info popover if the element it belongs to was re-rendered away. */
  tipCheck: () => void = () => {};
  /** setTimeout that is cancelled when the screen is destroyed. */
  later(fn: () => void, ms: number) {
    const t = window.setTimeout(() => { this.timers.delete(t); if (!this.destroyed) fn(); }, ms);
    this.timers.add(t);
  }
  readSeenTurn(): number {
    let n = 0;
    try { n = Number(localStorage.getItem(this.seenTurnKey()) ?? 0) || 0; } catch { /* */ }
    return n >= this.st.turn ? 0 : n;
  }
  onVisible = () => { if (!document.hidden) { document.title = 'Three Crowns'; document.removeEventListener('visibilitychange', this.onVisible); } };

  // ================================================================== data helpers
  get st(): GameState { return this.src.view.state; }
  get you(): number | null { return this.src.view.you; }
  get submitted(): boolean { return !!this.src.mySubmission; }
  get canPlan(): boolean { return this.you !== null && (this.live || !this.submitted) && this.st.winner === null && !this.st.players[this.you].eliminated && performance.now() >= this.sealingUntil; }
  /** LIVE mode (real time, banked orders) instead of WEGO turns. */
  get live(): boolean { return !!this.st.live; }
  /** A replay that takes over the map (WEGO turn, Preview); a LIVE tick's short animation doesn't. */
  get blockingReplay(): boolean { return !!this.replay && !(this.live && !this.replay.preview); }
  get bank(): number { return this.you !== null ? Math.max(0, this.st.live?.bank[this.you] ?? 0) : 0; }
  get queue(): Order[] { return this.you !== null ? this.st.live?.queue[this.you] ?? [] : []; }
  /** Local game with no human seat (Watch AIs). */
  get watching(): boolean { return this.src instanceof LocalSource && this.src.humans.length === 0 && this.st.winner === null && !this.live; }
  /** Free actions go into the plan (WEGO, undoable) or straight to the server (LIVE). */
  pushFree(fa: FreeAction, noSnap = false) {
    if (this.live) { this.src.liveFree?.(fa); return; }
    if (!noSnap) this.snapshot();
    if (fa.type === 'merge' || fa.type === 'doctrine' || fa.type === 'rename' || fa.type === 'halt') this.plan.free = this.plan.free.filter(x => !(x.type === fa.type && x.fleet === fa.fleet));
    this.plan.free.push(fa);
    if (fa.type === 'posture' || fa.type === 'wposture') haptic('posture');
    this.savePlan();
  }
  /** Remember the plan for Ctrl+Z (WEGO). */
  snapshot() {
    if (this.live) return;
    this.undoStack.push(JSON.stringify(this.plan));
    if (this.undoStack.length > 200) this.undoStack.shift();
  }
  /** Ctrl+Z / ↶: WEGO restores the plan before the last change; LIVE takes back the last queued order. */
  undo() {
    if (!this.canPlan) return;
    if (this.live) { if (this.queue.length) this.src.liveCancel?.(this.queue.length - 1); return; }
    const prev = this.undoStack.pop();
    if (!prev) return;
    const p = this.normalizePlan(JSON.parse(prev));
    if (!p) return;
    this.plan = p;
    this.replacing = null;
    this.savePlan();
    this.renderAll();
  }

  gameKey() {
    if (this.src instanceof LocalSource) return `${this.src.storageKey}:${this.st.seed}`;
    return this.src.meta?.id ?? 'x';
  }
  seenTurnKey() { return `tc.seen.${this.gameKey()}.${this.you ?? 's'}`; }
  freshPlan(): Submission { return { orders: new Array(this.st.rules.orders.perTurn).fill(null), free: [] }; }
  planKey() { return `tc.plan.${this.gameKey()}.${this.you ?? 's'}.${this.st.turn}`; }
  /** Plans by key, in memory too: with storage blocked or full (private mode, quota) unsealing must still give the orders back. */
  private planMem = new Map<string, string>();
  savePlan() {
    this.planVersion++;
    const k = this.planKey(), v = JSON.stringify(this.plan);
    this.planMem.set(k, v);
    try { localStorage.setItem(k, v); } catch { /* */ }
  }
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
      let raw: string | null = null;
      try { raw = localStorage.getItem(this.planKey()); } catch { /* storage blocked */ }
      const p = this.normalizePlan(JSON.parse(raw ?? this.planMem.get(this.planKey()) ?? 'null'));
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
  color(o: number | null | undefined) { return o === null || o === undefined || o < 0 ? (o === -1 ? '#ab95d8' : NEUTRAL_COLOR) : this.st.players[o]?.color ?? NEUTRAL_COLOR; }
  pname(o: number | null | undefined) { return o === null || o === undefined ? 'Neutral' : o < 0 ? (this.st.wardenAwake && !this.st.wardenDefeated ? 'Neutral / Warden' : 'Neutral') : this.st.players[o]?.name ?? '?'; }
  fleet(id: number) { return this.st.fleets.find(f => f.id === id); }
  /** Your pending free actions: the WEGO plan's, or (LIVE) the ones queued for the next tick. */
  myFree(): FreeAction[] { return this.live ? (this.you !== null ? this.st.live?.free[this.you] ?? [] : []) : this.plan.free; }
  doctrineOf(f: Fleet): Doctrine {
    // LIVE: a doctrine change waits for the next tick; showing the old one made the controls snap back
    const fa = [...this.myFree()].reverse().find(x => x.type === 'doctrine' && x.fleet === f.id);
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
  /** The state orders are priced against: your pending free actions (research, revokes, designs) applied. */
  costState(): GameState {
    const players = this.pendingPlayers();
    return players === this.st.players ? this.st : { ...this.st, players };
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
  /** Fleets an order spends an action of (a seize's joiners too). */
  orderFleets(o: Order | null): number[] {
    if (!o || !('fleet' in o) || o.type === 'build') return [];
    return [o.fleet, ...(o.type === 'seize' ? (o.also ?? []).filter(id => id !== o.fleet) : [])];
  }
  /** How many orders in the plan use this fleet (optionally only slots before `before`). */
  fleetUses(id: number, before = Infinity): number {
    let n = 0;
    this.plan.orders.forEach((o, i) => { if (i < before && this.orderFleets(o).includes(id)) n++; });
    return n;
  }
  validateAt(o: Order, k: number): string | null {
    if (this.you === null) return 'spectating';
    // the per-fleet cap counts the whole turn: an order put into an earlier slot (slot targeting) used to
    // slip past it when the fleet's other orders sat in later slots, and the last of them then failed
    if (this.plan.orders[k] !== o && 'fleet' in o && o.type !== 'build' && this.fleetUses(o.fleet) >= this.st.rules.orders.maxPerFleet) {
      const name = this.fleet(o.fleet)?.name ?? 'this fleet';
      return `${name} already has ${this.st.rules.orders.maxPerFleet} orders this turn (max ${this.st.rules.orders.maxPerFleet})`;
    }
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
    // laws are priced after your free actions (a revoke before pulse I makes switching its pair cost single)
    const cs = this.costState();
    for (const o of this.plan.orders) {
      if (!o) continue;
      const c = orderCost(cs, o, this.you);
      tot.industry += c.industry ?? 0; tot.credits += c.credits ?? 0; tot.influence += c.influence ?? 0;
      for (const id of this.orderFleets(o)) {
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

  /** Add an order: WEGO into the next free slot (or the targeted one), LIVE spends a banked order. Returns success. */
  addOrder(o: Order, noSnap = false): boolean {
    if (!this.canPlan) return false;
    if (this.live) {
      if (this.bank < 1) { toast(`⏱ No orders banked`); return false; }
      const err = this.orderWhy(o);
      if (err) { toast(`⊘ ${shortWhy(err)}`); return false; }
      this.src.liveOrder?.(o);
      audio.ui('order');
      haptic('slot');
      this.flashOrder = performance.now();
      this.afterAction();
      return true;
    }
    const k = this.nextSlot();
    if (k === null) { toast('No slot free'); return false; }
    const err = this.validateAt(o, k);
    if (err) { toast(`⊘ ${shortWhy(err)}`); return false; }
    if (!noSnap) this.snapshot();
    const spend = this.plannedSpend();
    const c = { ...orderCost(this.costState(), o, this.you!) };
    for (const id of this.orderFleets(o)) if (this.fleetUses(id) > 0) c.credits = (c.credits ?? 0) + this.st.rules.orders.repeatFleetCredits;
    const res = this.st.players[this.you!].res;
    const after = { industry: res.industry - spend.industry, credits: res.credits - spend.credits, influence: res.influence - spend.influence };
    if (!canAfford(after, c, creditRate(this.st, this.you!))) toast(`⚠ Short: ${costText(c)}`);
    this.plan.orders[k] = o;
    this.targetSlot = null;
    this.replacing = null;
    this.savePlan();
    audio.ui('order');
    haptic('slot');
    this.afterAction();
    return true;
  }
  /** After an order or free action: disarm, and on a phone get the card out of the way of the strip. */
  afterAction() {
    this.mode = null;
    this.lifted.clear();
    if (this.phone) this.sel = null;
    this.renderAll();
  }
  /** Remove the order in a slot (WEGO) or take back a queued one (LIVE: refunds it). */
  removeOrder(slot: number) {
    if (!this.canPlan) return;
    if (this.live) { this.src.liveCancel?.(slot); return; }
    if (!this.plan.orders[slot]) return;
    this.snapshot();
    this.plan.orders[slot] = null;
    if (this.targetSlot === slot) this.targetSlot = null;
    this.savePlan();
    this.renderAll();
  }
  /** Remove a pending free action (WEGO). */
  removeFree(i: number) {
    if (!this.canPlan || this.live || !this.plan.free[i]) return;
    this.snapshot();
    const [gone] = this.plan.free.splice(i, 1);
    // a ship design whose module needed the research just taken out would fail at resolution: it goes too
    if (gone.type === 'research' && this.you !== null) {
      const techs = this.st.players[this.you].techs ?? [], pend = pendingResearch(this);
      this.plan.free = this.plan.free.filter(x => !(x.type === 'blueprint' && !!MODULE[x.mod]?.tech && !techs.includes(MODULE[x.mod].tech!) && MODULE[x.mod].tech !== pend));
    }
    this.savePlan();
    this.renderAll();
  }
  /** Every slot full: a valid drop waits for the player to pick the order it replaces. */
  askReplace(it: Intent) { this.replacing = it; this.renderAll(); }
  /** Replace the order in `slot` with the waiting intent (strip click while replacing). */
  replaceWith(slot: number): boolean {
    const it = this.replacing;
    this.replacing = null;
    if (!it?.order || this.live || !this.canPlan) { this.renderAll(); return false; }
    this.snapshot();
    const old = this.plan.orders[slot];
    this.plan.orders[slot] = null;
    const err = this.validateAt(it.order, slot);
    if (err) { this.plan.orders[slot] = old; this.undoStack.pop(); toast(`⊘ ${shortWhy(err)}`); this.renderAll(); return false; }
    for (const fa of it.free ?? []) this.pushFree(fa, true);
    this.plan.orders[slot] = it.order;
    this.savePlan();
    audio.ui('order');
    this.afterAction();
    return true;
  }
  flashSlot(_k: number) { this.flashOrder = performance.now(); }
  /** Own fleets that could act and have nothing to do (the primary button / Tab cycle through them). */
  idleFleets(): Fleet[] {
    if (this.you === null) return [];
    return this.st.fleets.filter(f => f.owner === this.you && f.ships.length && this.isIdle(f));
  }
  /** Select and centre the next idle fleet. */
  nextIdle() {
    const idle = this.idleFleets();
    if (!idle.length) return;
    const cur = this.sel?.kind === 'fleet' ? idle.findIndex(f => f.id === this.sel!.id) : -1;
    const f = idle[(cur + 1) % idle.length];
    this.select({ kind: 'fleet', id: f.id });
    this.focus(this.st.regions[f.region].site);
  }
  /** What dropping a fleet (or some of its ships) on a region would do (see hud/verbs.ts). For scripts / modals. */
  intent(src: { fleet: number; ships?: number[] }, rid: number | null, over: number | null = null, force: 'move' | 'seize' | null = null): Intent | null { return intentFor(this, src, rid, over, force); }
  /** Carry out an intent from intent(). */
  commit(it: Intent): boolean { return commitIntent(this, it); }
  /** Open one of the full-screen modals (client/src/ui/modals.ts). */
  openModal(name: 'empire' | 'score' | 'chronicle' | 'help', tab?: string) { this.hud.modal(name, tab); }
  /** The open modal (if any) re-renders from the current state; Empire content calls this after a change. */
  renderTab() { this.renderAll(); }
  /** Map tokens under a screen point: the renderer's stacked tokens when it has them, else single fleets. */
  tokenHit(x: number, y: number): { region: number; owner: number; fleetIds: number[] } | null {
    const t = this.map.tokenAt(x, y);
    return t && t.fleetIds.length ? t : null;
  }

  // ================================================================== source updates
  onSourceChange(k: string) {
    if (k === 'chat') { if (!this.hud.chatVisible()) this.unreadChat++; this.renderAll(); return; }
    if (k === 'error') { toast(this.src.lastError); return; }
    if (k === 'meta') { this.trackSeals(); this.renderAll(); return; }
    // full view
    backfillRules(this.st);
    this.trackSeals();
    if (this.you !== null) this.lastYou = this.you;
    audio.me = this.you ?? this.mySeat();
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
    if (this.planKey() !== this.lastPlanKey) { this.lastPlanKey = this.planKey(); this.undoStack = []; this.replacing = null; this.lifted.clear(); }
    if (this.canPlan) applyFoundingVows(this);
    if (this.sel?.kind === 'fleet' && !this.fleet(this.sel.id)) this.sel = null;
    if (this.sel?.kind === 'region' && !this.st.regions[this.sel.id]) this.sel = null;
    if (this.targetSlot !== null && this.targetSlot >= this.plan.orders.length) this.targetSlot = null;
    if (this.mode && (!this.canPlan || ('fleet' in this.mode && !this.fleet(this.mode.fleet)))) this.mode = null;
    const last = this.st.last;
    const news = this.empireNews();
    // once per turn / cycle: a LIVE game never advances lastSeenTurn, so a hidden tab notified again on every tick
    // (keyed on the current turn: a cycle's last tick and the next cycle's ticks carry different result turns)
    if (last && last.turn > this.lastSeenTurn && this.st.turn > Math.max(1, this.notifiedTurn) && this.src.kind === 'remote' && document.hidden) {
      this.notifiedTurn = this.st.turn;
      document.title = `(!) ${this.live ? 'Cycle' : 'Turn'} ${this.st.turn} · Three Crowns`;
      try { if ('Notification' in window && Notification.permission === 'granted') new Notification('Three Crowns', { body: this.live ? `Cycle ${this.st.turn - 1} ended.` : `Turn ${last.turn} resolved. Your move, commander.` }); } catch { /* */ }
      document.removeEventListener('visibilitychange', this.onVisible);
      document.addEventListener('visibilitychange', this.onVisible);
    }
    if (this.live) {
      // LIVE: play each new tick as a quick, skippable animation (only if something visible happened)
      // the world clock says which tick `last` is: a player's filtered result may not carry its `tick`
      // (then every tick looked like tick 0 and live ticks never animated)
      const tick = this.st.live?.tick ?? last?.tick ?? 0;
      if (last && tick > this.lastSeenTick) {
        const first = this.lastSeenTick === -1;
        this.lastSeenTick = tick;
        const interesting = last.events.some(e => e.k === 'move' || e.k === 'battle' || e.k === 'capture' || e.k === 'destroyed' || e.k === 'build' || e.k === 'clash');
        // one short phrase per tick (at most one sound per kind of event), never a burst; ticks in a hidden tab stay silent
        if (!first && !document.hidden) audio.onTick(last.events);
        if (!first && news.length && !document.hidden) {
          // live: research and laws land between ticks; announce them (yours as confirmation, rivals' as intel)
          for (const e of news.slice(0, 3)) { toast(eventText(this.st, e, this.you).replace(/<[^>]+>/g, '')); this.empireFx(e); }
        }
        if (!first && interesting && !this.replay && !document.hidden) { this.startReplay(last); const r = this.replay as { speed: number } | null; if (r) r.speed = Math.max(this.replaySpeed, 3); this.pulseFx(true); }
        else if (!this.replay) this.pulseFx();
      }
      // LIVE: victory points land at a cycle's end: the coins fly (no ribbon; the minute loop stays light)
      this.liveCoins(last ?? null);
    } else if (last && last.turn > this.lastSeenTurn && this.st.turn > 1) {
      this.lastSeenTurn = last.turn;
      try { localStorage.setItem(seenKey, String(last.turn)); } catch { /* */ }
      // a beat after the seal (a local game resolves at once)
      audio.turnResolved({ delay: 0.25 });
      // empire news (bought before pulse I) opens the replay; spectators already get the real events
      const known = new Set(last.events.filter(e => e.k === 'tech' || e.k === 'law').map(e => JSON.stringify([e.k, (e as { owner: number }).owner, e.k === 'tech' ? e.tech : e.law])));
      const extra = news.filter(e => !known.has(JSON.stringify([e.k, e.owner, e.k === 'tech' ? e.tech : e.law])));
      this.startReplay(extra.length ? { ...last, events: [...extra, ...last.events] } : last, false, true);
      // hotseat: don't play the replay behind the curtain
      if (this.replay && this.curtain) this.replay.playing = false;
    }
    this.renderAll();
    this.maybeShowVictory();
    if (this.st.winner === null) this.later(() => this.heraldCheck(), 60);
  }
  lastSeenKey = '';
  /** the turn / cycle a background notification was last shown in */
  notifiedTurn = 0;
  /** Your seat even once the game is over (its view is then the revealed, seatless one). */
  mySeat(): number | null {
    if (this.you !== null) return this.you;
    if (this.lastYou !== null) return this.lastYou;
    if (this.src instanceof LocalSource) { const h = this.src.save.seats.flatMap((x, i) => (x.kind === 'human' ? [i] : [])); return h.length === 1 ? h[0] : null; }
    const t = tokens.get(this.src.meta.id);
    return t && t.seat >= 0 ? t.seat : null;
  }
  /** The seat this screen last played (a finished game's view is the revealed spectator one). */
  lastYou: number | null = null;
  /**
   * Who sealed when (Act I cracks the seals in that order). Seen from the seats' "submitted" flags as they change:
   * AI seats seal at once; a seal the screen never saw (the one that made the turn resolve) counts as the last.
   */
  trackSeals() {
    const seats = this.src.meta?.seats ?? [];
    const turn = this.st.turn;
    if (turn !== this.sealTurn) {
      if (this.sealTurn >= 0) {
        const known = [...this.sealSeen.entries()].sort((a, b) => a[1] - b[1] || a[0] - b[0]).map(x => x[0]);
        const rest = this.st.players.map(p => p.id).filter(id => !known.includes(id));
        this.lastSealOrder = [...known, ...rest];
      }
      this.sealTurn = turn;
      this.sealSeen.clear();
    }
    const now = performance.now();
    seats.forEach((x, i) => {
      if (x.submitted && !this.sealSeen.has(i)) this.sealSeen.set(i, x.kind === 'ai' ? -1 : now + i * 1e-3);
      else if (!x.submitted) this.sealSeen.delete(i);
    });
  }
  /** LIVE: new VP log entries since the last look fly in as coins. */
  liveCoins(result: TurnResult | null) {
    const logs = this.st.players.map(p => p.vpLog ?? []);
    const seen = this.vpSeen;
    this.vpSeen = logs.map(l => l.length);
    if (!seen || seen.length !== logs.length || document.hidden || this.st.winner !== null) return;
    const entries = new Map<number, VpEntry[]>(this.st.players.map((p, i) => [p.id, logs[i].slice(Math.min(seen[i], logs[i].length))]));
    if (![...entries.values()].some(l => l.length)) return;
    this.reck.start(vpChanges(this.st, entries, result), null, { ribbon: false });
  }
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
    audio.me = seat;
    // the previous player is still looking: hide everything until the next player confirms
    this.sel = null; this.mode = null; this.targetSlot = null; this.hoverRegion = null; this.empFocus = null;
    this.gest.cancel();
    this.hideTip();
    this.lifted.clear(); this.replacing = null; this.expanded = null;
    // the previous player's Preview (their plan, animated) must not resume for the next player
    if (this.replay?.preview) { this.replay = null; this.fx = []; this.previewing = false; this.map.resetAnim(); }
    // numbers that count between values would flash the previous player's resources
    resetUiFx();
    // nor may the previous player's count-up, ribbon or staged acts linger for the next one
    this.reck.finish(true); this.reck.dismiss(); this.stage.clear(); this.vpShown.clear();
    // (and the Charge? offer floating over the region the previous player just chose to seize)
    document.querySelectorAll('.overlay:not(.curtain), .bv-overlay, .chargeoffer').forEach(x => x.remove());
    closeHerald(); closeSaga();
    this.curtain?.remove();
    const o = overlay(`<div class="dialog" style="text-align:center"><h1 style="color:${this.color(seat)}">${esc(name)}</h1>
      <p>Hotseat: pass the device to <b>${esc(name)}</b>. Other players look away!</p><button class="primary" data-x>I am ${esc(name)}</button></div>`, false);
    o.classList.add('curtain');
    this.curtain = o;
    o.querySelector('[data-x]')!.addEventListener('click', () => {
      o.remove();
      if (this.curtain === o) this.curtain = null;
      if (this.replay) {
        // the beat that started behind the curtain was kept quiet: frame() begins it (sounds, staged acts) now
        this.replay.playing = true; this.replay.last = this.clock.now;
      }
      this.renderAll();
      this.maybeShowVictory();
      this.heraldCheck();
    });
  }

  canResearchNow(): boolean {
    if (this.you === null || !this.canPlan || pendingResearch(this)) return false;
    const st = this.st, me = this.you, p = st.players[me];
    if (researchedThisTurn(st, me) >= st.rules.empire.researchPerTurn) return false;
    const sp = this.live ? { industry: 0, credits: 0, influence: 0 } : this.plannedSpend();
    const left = { industry: p.res.industry - sp.industry, credits: p.res.credits - sp.credits, influence: p.res.influence - sp.influence };
    return Object.keys(TECH).some(id => !researchBlock(st, me, id) && canAfford(left, techCost(st, me, id), creditRate(st, me)));
  }

  /** A collapsible secondary section; its open state is remembered for the session. */
  sec(id: string, title: string, body: string, sum = ''): string {
    return `<details class="sec" data-sec="${id}"${this.openSecs.has(id) ? ' open' : ''}><summary>${title}${sum ? `<span class="sum">${sum}</span>` : ''}</summary><div class="sb">${body}</div></details>`;
  }

  /** An own fleet that could act right now and hasn't been given anything to do: it glows. */
  isIdle(f: Fleet): boolean {
    if (f.owner !== this.you || !this.canPlan || this.blockingReplay) return false;
    if (this.live) return this.bank > 0 && !f.route && !this.queue.some(o => 'fleet' in o && o.type !== 'build' && o.fleet === f.id) && f.siege !== f.region;
    if (f.route && (f.route.path.length || f.route.seize !== null) && !this.plan.free.some(x => x.type === 'halt' && x.fleet === f.id)) return false;
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
      case 'halt': return `Halt ${fn(x.fleet)}`;
      case 'posture': return `${fn(x.fleet)}: ${POSTURES[x.posture]?.name ?? x.posture}`;
      case 'wposture': return `${this.st.regions[x.region]?.name ?? '?'}: ${WORLD_POSTURES[x.posture]?.name ?? x.posture}`;
      case 'fate': return `Fate: ${FATE_USES[x.use]?.name ?? x.use}${x.fleet !== undefined ? ` (${fn(x.fleet)})` : x.region !== undefined ? ` (${this.st.regions[x.region]?.name ?? '?'})` : ''}`;
      case 'vow': return `${fn(x.fleet)} swears a vow`;
      case 'honour': return `${fn(x.fleet)}: honour`;
      case 'calling': return `${this.st.regions[x.region]?.name ?? '?'}: calling`;
      case 'raze': return `Raze ${this.st.regions[x.region]?.name ?? '?'}`;
      case 'dispatch': return `Dispatch: “${x.text.slice(0, 40)}”`;
      case 'tribute': return `${x.accept ? 'Accept terms over' : 'Offer terms over'} ${this.st.regions[x.region]?.name ?? '?'}`;
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

  /** Seal the WEGO plan. A part-empty plan asks once (a small game dialog); `now` (Enter, Shift+click) skips that. */
  submit(now = false) {
    // LIVE has no turns to seal
    if (!this.canPlan || this.live) return;
    const used = this.plan.orders.filter(Boolean).length;
    const go = () => {
      if (!this.canPlan) return;
      this.mode = null;
      this.replacing = null;
      this.undoStack = [];
      // a running Preview shows this plan: never let it play on (hotseat: behind the next player's curtain)
      if (this.replay?.preview) this.endReplay();
      // the seal ritual: wax drips, the signet presses (the bell), the seal flies to your crest
      const seat = this.you!;
      const crest = this.hud.h.crests.querySelector<HTMLElement>(`[data-crest="${seat}"]`);
      const btn = this.hud.h.primary.querySelector<HTMLElement>('[data-submit]') ?? this.hud.h.primary;
      const r = btn.getBoundingClientRect();
      this.sealDoneAt = sealRitual(this.stage.layer, { seat, color: this.color(seat) }, r.width ? r : null, crest?.getBoundingClientRect() ?? null);
      const plan = structuredClone(this.plan);
      // hotseat: the next player's curtain would hide the ritual (and the board must not change under it): the
      // hand-off waits for it; the orders can't change meanwhile (canPlan)
      if (this.src instanceof LocalSource && this.src.humans.length > 1 && !reducedFx()) {
        this.sealingUntil = performance.now() + SEAL_MS;
        this.renderAll();
        this.later(() => { this.sealingUntil = 0; if (!this.src.mySubmission) this.src.submit(plan); }, SEAL_MS - 60);
      } else this.src.submit(plan);
      // the one-time offer of turn notifications (push/push.ts), after the seal ritual has landed; never on load
      if (this.src.kind === 'remote') void import('./push/push.ts').then(m => { if (m.shouldOfferPush()) this.later(() => m.mountPushPrompt(), 1200); });
    };
    if (used < this.plan.orders.length && !now) {
      const o = overlay(`<div class="dialog seal-ask"><div class="big">${used}<small>/${this.plan.orders.length}</small></div><h2>Seal anyway?</h2>
        <div class="row"><button class="primary" data-y>Seal ${ic('check')}</button><button data-n>Back</button></div></div>`);
      o.querySelector('[data-y]')!.addEventListener('click', () => { o.remove(); go(); });
      o.querySelector('[data-n]')!.addEventListener('click', () => o.remove());
    } else go();
  }

  /** Why no new order can be given right now: the plan is locked, the slots are full or the bank is empty. */
  orderBlock(): string | null {
    const b = this.planBlock();
    if (b) return b;
    if (this.live) return this.bank < 1 ? `No orders banked. The next one arrives in ${fmtDur((this.st.live!.nextOrderAt[this.you!] ?? 0) - Date.now())}.` : null;
    return this.nextSlot() === null ? `All ${this.plan.orders.length} orders are used. Remove one in the Orders list first.` : null;
  }

  pendingName(f: Fleet): string {
    const r = [...this.myFree()].reverse().find(x => x.type === 'rename' && x.fleet === f.id);
    return r && r.type === 'rename' ? r.name : f.name;
  }

  // ================================================================== replay
  togglePause() {
    const R = this.replay;
    if (!R) return;
    R.playing = !R.playing;
    R.last = performance.now();
    this.renderAll();
  }

  /**
   * Play a turn's result on the map. The replay director (fx/director.ts) paces it in five acts; `fresh` marks the
   * turn that just resolved (Act I's seals, the room's inhale, the Reckoning at the end), not a re-watch.
   */
  startReplay(result: TurnResult, preview = false, fresh = false) {
    const st = this.st;
    const fleets = new Map<number, ReplayFleet>();
    for (const f of result.startFleets) fleets.set(f.id, { id: f.id, owner: f.owner, ships: f.ships.length, region: f.region, alpha: 1, name: f.name });
    const liveTick = this.live && !preview;
    fresh = fresh && !preview && !this.live;
    const beats: Beat[] = direct(result, st, { you: this.you, live: liveTick, preview, seals: fresh && st.players.filter(p => !p.eliminated).length > 1 });
    // nothing visible happened: no replay (a fresh turn still gets its Reckoning)
    if (!beats.some(b => b.events.length)) { if (fresh) this.reckon(result); return; }
    // the big treatment (slow motion on the decisive volley) goes to one battle at most: the main event if it was
    // truly decided, else the highest-stakes battle that was
    const decided = beats.filter(b => b.decisive && b.events[0]?.k === 'battle');
    const big = liveTick || preview ? null : (decided.find(b => b.main) ?? decided[decided.length - 1])?.battle ?? null;
    // starting a replay while another runs (or a preview) replaces it cleanly
    const speed = this.replaySpeed;
    this.fx = [];
    this.stage.clear();
    this.clock.reset();
    this.previewing = preview;
    const owners = result.startOwners.length ? result.startOwners.slice() : st.regions.map(r => r.owner);
    // a live tick continues from what is on screen; a WEGO replay rewinds to the start of the turn (a cut, not an animation)
    this.replayCont = this.live && !preview && !this.replay;
    if (!this.replayCont) { this.map.resetAnim(); this.fleetOff.clear(); this.lastFleetPos.clear(); }
    // a new reveal: the last one's ribbon gives way
    this.reck.finish(true); this.reck.dismiss();
    this.replay = {
      result, beats, i: -1, prog: 0, last: this.clock.now, playing: true, speed, fleets, owners, startLayout: new Map(), endLayout: new Map(), moving: new Set(), pulse: 0, preview, seen: [],
      fresh, begun: -1, sealOrder: this.lastSealOrder.slice(), flop: liveTick || preview ? [] : flopArrows(result), flopAt: null, big,
      holdUntil: fresh ? Math.min(this.sealDoneAt, performance.now() + 900) : 0,
    };
    // a LIVE tick plays under whatever you're doing (every few seconds in blitz): keep your selection and
    // targeting; a click ends the tick's animation and goes through
    if (!liveTick) { this.sel = null; this.mode = null; this.targetSlot = null; this.hideTip(); this.gest.cancel(); }
    this.nextBeat();
    this.renderAll();
  }

  nextBeat() {
    const R = this.replay!;
    R.i++;
    if (R.i >= R.beats.length) { this.endReplay(); return; }
    const beat = R.beats[R.i];
    R.prog = 0;
    R.last = this.clock.now;
    R.moving.clear();
    const st = this.st;
    const live = () => [...R.fleets.values()].filter(f => f.alpha > 0);
    R.startLayout = regionLayout(st, live().map(f => ({ id: f.id, region: f.region })), this.map.px(1));
    // start every token from where it is on screen, so beats (and live ticks) flow into each other without jumps
    for (const [id, p] of this.lastFleetPos) if (R.startLayout.has(id)) R.startLayout.set(id, p);
    const now = this.clock.now;
    const text: string[] = [];
    let focus: Pt | null = null;
    for (const e of beat.events) {
      text.push(eventText(st, e, this.you));
      switch (e.k) {
        case 'pulse': R.pulse = e.pulse; break;
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
        case 'posture': {
          const r = st.regions[e.region];
          if (r && e.outcome !== 'none') {
            this.fx.push({ kind: 'stamp', pos: r.site, color: e.outcome === 'called' ? '#ffd86b' : '#ff5d5d', t0: now, dur: 1700, text: e.outcome === 'called' ? 'CALLED IT' : 'CAUGHT OUT' });
            focus ??= r.site;
          }
          break;
        }
        case 'fate': {
          const fl = e.fleet !== undefined ? this.fleet(e.fleet) ?? R.result.startFleets.find(x => x.id === e.fleet) : undefined;
          const r = e.region !== undefined ? st.regions[e.region] : fl ? st.regions[fl.region] : undefined;
          if (r) this.fx.push({ kind: 'stamp', pos: r.site, color: '#d6b4ff', t0: now, dur: 1600, text: 'FATE' });
          this.banner(e.use === 'bonus' ? '✪ FORTUNE' : `✪ ${(FATE_USES[e.use]?.name ?? e.use).toUpperCase()}`);
          if (r) focus ??= r.site;
          break;
        }
        case 'rout': {
          const f = R.fleets.get(e.fleet);
          if (f) { f.region = e.to; R.moving.add(e.fleet); }
          if (st.regions[e.from]) this.fx.push({ kind: 'stamp', pos: st.regions[e.from].site, color: '#ff9a62', t0: now, dur: 1500, text: 'ROUTED' });
          focus ??= st.regions[e.from]?.site ?? null;
          break;
        }
        case 'soul': {
          const k = SOUL_STAMP[e.kind];
          const r = e.region !== undefined ? st.regions[e.region] : undefined;
          if (k && r) { this.fx.push({ kind: 'stamp', pos: r.site, color: k[1], t0: now, dur: 1600, text: k[0] }); focus ??= r.site; }
          if (k?.[2]) this.banner(k[2]);
          break;
        }
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
    if (focus && !this.live && R.playing && !this.gest.busy && !this.curtain && !this.map.onScreen(focus, this.phone ? 70 : 110)) this.map.flyTo(focus, undefined, 750);
    void text;
    for (const e of beat.events) if (e.k === 'battle' && !R.seen.includes(e.battle)) R.seen.push(e.battle);
    // a staged beat over a battle off-screen: bring it into view first
    if (beat.kind === 'hold' && beat.battle !== undefined && !this.live && R.playing && !this.gest.busy && !this.curtain) {
      const b = R.result.battles.find(x => x.id === beat.battle);
      const site = b ? st.regions[b.region]?.site : undefined;
      if (site && !this.map.onScreen(site, this.phone ? 90 : 140)) this.map.flyTo(site, undefined, 500);
    }
    // its side effects (sounds, staged acts, pauses) run once it actually plays: not while paused, not behind the curtain
    if (R.playing && !this.curtain && performance.now() >= R.holdUntil) this.beginBeat();
    this.renderAll();
  }

  /**
   * The moment a beat starts playing: its sounds (not for a Preview, where nothing happened, nor LIVE ticks, which
   * onSourceChange voices once), the staged acts (seals, the flop, a battle's hold and title), the decisive volley's
   * slow motion and push-in, CALLED IT's hit-pause, and your haptics.
   */
  beginBeat() {
    const R = this.replay;
    if (!R || R.begun === R.i) return;
    R.begun = R.i;
    const beat = R.beats[R.i];
    if (!beat) return;
    const st = this.st;
    const k = 1 / Math.max(0.25, R.speed);
    if (!R.preview && !this.live) audio.onGameEvents(beat.events, { stagger: 0.04, delay: R.i === 0 && !beat.kind ? 0.45 : 0 });
    if (beat.kind === 'seals') {
      const houses = st.players.filter(p => !p.eliminated).map(p => ({ seat: p.id, name: p.name, color: this.color(p.id) }));
      this.stage.sealsAct(houses, R.sealOrder, beat.dur * k);
      // the last seal: the room inhales before the reveal
      if (R.fresh) audio.inhale();
    } else if (beat.kind === 'flop') {
      R.flopAt = this.clock.now;
      audio.sfx('ui_page', { vol: 0.45, rate: 0.85 });
    } else if (beat.kind === 'hold' && beat.battle !== undefined) {
      const rep = R.result.battles.find(b => b.id === beat.battle);
      const site = rep ? st.regions[rep.region]?.site : undefined;
      if (rep && site) this.stage.hold(rep, site, o => this.color(o), o => this.pname(o), beat.dur * k);
    } else if (beat.kind === 'title' && beat.label) {
      this.stage.title(`…and at ${beat.label}.`, beat.dur * k);
      audio.sfx('ui_banner', { vol: 0.55, rate: 0.9 });
    }
    // the decisive volley of the turn's big battle: slow motion (0.35× for 600 ms), the wreck pitched down, and the
    // camera leaning in on the world, then back. Only on a volley that really decided it (fx/battlefacts.ts).
    if (beat.decisive && beat.battle === R.big && beat.events[0]?.k === 'battle' && !reducedFx() && !this.live && !R.preview) {
      const rep = R.result.battles.find(b => b.id === beat.battle);
      const site = rep ? st.regions[rep.region]?.site : undefined;
      const at = beat.dur * 0.42 * k;
      this.clock.slow(0.35, 600, at);
      audio.slowMo({ delay: at / 1000 });
      if (site && !this.gest.busy && !this.curtain) {
        const prev = { ...this.map.cam };
        const z = Math.min(3, prev.z * (this.phone ? 1.35 : 1.6));
        this.map.flyTo(site, z, Math.max(300, at + 80));
        this.later(() => {
          // back to where the camera was, unless the player took it meanwhile
          if (this.replay === R && Math.abs(this.map.cam.z - z) < 1e-3 * z && !this.gest.busy) this.map.flyTo({ x: prev.x, y: prev.y }, prev.z, 700);
        }, at + 600 + 220);
      }
    }
    for (const e of beat.events) {
      if (e.k === 'posture' && e.outcome !== 'none') {
        // CALLED IT lands (the stamp's slam ends 12% into its 1.7 s) with a 120 ms hit-pause and a small thump
        if (e.outcome === 'called') {
          this.clock.hitPause(120, 204 * k);
          this.later(() => { if (this.replay === R) this.stage.thump(this.el.stage, 3); }, 204 * k + 120);
        }
        if (this.you !== null && e.owner === this.you && !R.preview) haptic(e.outcome === 'called' ? 'called' : 'caught');
        else if (this.you !== null && e.outcome === 'called' && e.with?.includes(this.you) && !R.preview) haptic('caught');
      }
      if (e.k === 'capture' && this.you !== null && e.by === this.you && !R.preview) haptic(st.regions[e.region]?.kind === 'crown' || st.regions[e.region]?.kind === 'throne' ? 'crown' : 'capture');
    }
  }

  endReplay() {
    if (!this.replay) return;
    const R = this.replay;
    const res = R.result;
    const wasPreview = R.preview;
    this.replay = null;
    this.fx = [];
    this.previewing = false;
    this.stage.clear();
    this.clock.reset();
    if (wasPreview) this.map.resetAnim(); // owners/fleets snap back to the plan: not a capture
    // the Reckoning: coins to the crests, the ribbon (a skip lands here too: nothing is lost by skipping)
    if (R.fresh && !wasPreview) this.reckon(res);
    this.renderAll();
    this.maybeShowVictory();
    if (!wasPreview && this.st.winner === null) this.heraldCheck();
    if (this.autoPlay && this.src instanceof LocalSource && this.st.winner === null) this.later(() => { if (this.autoPlay && !this.replay) (this.src as LocalSource).advance(); }, 900);
  }

  /** The end of a fresh turn's reveal: VP coins fly to the crests and the ribbon sums the turn up. */
  reckon(result: TurnResult) {
    // the final turn's count happens on the banners of the crowning instead
    if (this.st.winner !== null || this.live) return;
    const changes = vpChanges(this.st, turnEntries(this.st, result.turn), result);
    this.reck.start(changes, result, { ribbon: true, line: nearMissLine(this.st, result, this.you) });
    this.renderAll();
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
    b.innerHTML = glyphHtml(esc(t));
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
      rules: this.st.rules, you: this.you, live: this.live,
      playerName: o => o === -1 ? (rep.sides.some(x => x.owner === -1 && x.fleets.length) ? 'The Warden' : 'Neutral garrison') : this.pname(o), playerColor: o => this.color(o), regionName: id => this.st.regions[id]?.name ?? '?',
    });
  }

  /** Replay an earlier WEGO turn, or (LIVE: pass the tick) one tick: every tick of a cycle shares its turn number. */
  async replayTurn(turn: number, tick?: number) {
    const L = this.st.live;
    const isLast = !!this.st.last && this.st.last.turn === turn && (L ? tick === undefined || tick === L.tick : true);
    const r = isLast ? this.st.last : await this.src.history(turn, L ? tick : undefined);
    if (this.destroyed) return;
    if (!r) { toast(`No replay available for that ${L ? 'tick' : 'turn'}.`); return; }
    this.startReplay(r);
    if (!this.replay) toast(`Nothing you could see happened in that ${L ? 'tick' : 'turn'}.`);
  }
  /** LIVE: the cycle (turn number) tick `t` (1-based, as results count them) belonged to. */
  turnOfTick(t: number): number {
    const L = this.st.live!, per = Math.max(1, this.st.rules.live.ticksPerCycle);
    return this.st.turn - Math.floor(L.tick / per) + Math.floor((t - 1) / per);
  }

  // ================================================================== frame
  frame() {
    const now = performance.now();
    // the replay runs on its own clock (hit-pauses, slow motion); everything else on real time
    const vnow = this.replay ? this.clock.step(now) : now;
    const st = this.st;
    let owners = st.regions.map(r => r.owner);
    let fleets: FleetDraw[] = [];
    if (this.replay) {
      const R = this.replay;
      // a beat that began paused or behind the curtain gets its moment once it plays
      const waiting = now < R.holdUntil;
      if (R.playing && R.begun !== R.i && !this.curtain && !waiting) this.beginBeat();
      const beat = R.beats[R.i];
      // clamp dt so a backgrounded tab doesn't skip a whole beat on return
      const dt = Math.min(250, Math.max(0, vnow - R.last));
      R.last = vnow;
      if (R.playing && beat && !waiting) {
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
          let pos = { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e };
          const sf = !moving ? byId?.get(f.id) : undefined;
          if (sf && sf.region === f.region && sf.route?.path.length) pos = this.liveGlide(sf, pos);
          fleets.push({ id: f.id, owner: f.owner, ships: f.ships, pos, alpha: f.alpha, name: f.name, region: f.region } as FleetDraw);
        }
      }
    } else {
      const lay = this.fleetLayout();
      const dragging = this.gest.dragFleet();
      fleets = st.fleets.map(f => {
        let pos = lay.get(f.id) ?? st.regions[f.region].site;
        if (this.live) pos = this.liveGlide(f, pos);
        return { id: f.id, owner: f.owner, ships: f.ships.length, pos, alpha: dragging === f.id ? 0.45 : 1, name: f.name, fortified: f.fortified, selected: this.sel?.kind === 'fleet' && this.sel.id === f.id, idle: this.isIdle(f), region: f.region, cls: f.ships.map(s => s.cls) } as FleetDraw;
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
          const px = prev.x - (off?.x ?? 0), py = prev.y - (off?.y ?? 0);
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
    if (now - this.lastClock > 500) { this.lastClock = now; this.tickClocks(); this.hud.tick(); }
    this.gest.step(now);
    // targets light up while a fleet is picked up (or selected and you can order it); invalid ones never do
    const highlight = this.blockingReplay ? new Map<number, string>() : this.gest.targets();
    const ring = this.gest.ringHighlight();
    if (ring !== null) highlight.set(ring, '#ffd86b');
    // planned order arrows
    type Arrow = DrawInput['plannedArrows'][number];
    const plannedArrows: Arrow[] = [];
    if (this.live && !this.replay) {
      for (const f of st.fleets) {
        const rt = f.route;
        if (!rt || !rt.path.length) continue;
        let from = f.region;
        const eta = etaTicks(st, f.id);
        rt.path.forEach((r, i) => {
          if (!st.regions[r] || !st.regions[from]) return;
          const lastLeg = i === rt.path.length - 1;
          plannedArrows.push({ from: i === 0 ? this.lastFleetPos.get(f.id) ?? st.regions[from].site : st.regions[from].site, to: st.regions[r].site, label: lastLeg && eta !== null ? fmtDur(eta * tickMs(st)).replace(/ .*/, '') : '', color: rt.seize !== null && lastLeg ? '#ff5d7a' : this.color(f.owner), dashed: true, kind: 'move' });
          from = r;
        });
      }
      // queued (next tick) movement of your fleets
      for (const o of this.queue) this.orderArrows(o, -1, plannedArrows, false);
    }
    if (!this.replay && this.you !== null && !this.live) this.plan.orders.forEach((o, i) => { if (o) this.orderArrows(o, i, plannedArrows, this.hoverSlot === i); });
    // the reveal's flop (Act II): every visible order arrow of every house, drawn at once, house by house in the
    // order they sealed, held while the fleets move along them (Act III)
    const R = this.replay;
    if (R && R.flopAt !== null && R.flop.length && (R.beats[R.i]?.act ?? 9) <= 3) {
      const order = R.sealOrder.length ? R.sealOrder : st.players.map(p => p.id);
      for (const a of R.flop) {
        const k = Math.max(0, order.indexOf(a.owner));
        if (vnow - R.flopAt < k * (reducedFx() ? 0 : 170) || !st.regions[a.from] || !st.regions[a.to]) continue;
        plannedArrows.push({ from: st.regions[a.from].site, to: st.regions[a.to].site, label: '', color: this.color(a.owner), kind: 'move' });
      }
    }
    // seize joiners: dashed tethers from your fleets that could still join a planned seize you are looking at
    if (!this.replay && this.canPlan && !this.live) for (const t of this.gest.tethers()) plannedArrows.push({ from: t.from, to: t.to, label: '+', color: '#ff9db0', dashed: true, kind: 'seize' });
    // onboarding ghost arrow
    if (this.teachArrow && !this.replay && st.regions[this.teachArrow.from] && st.regions[this.teachArrow.to]) {
      const a = Math.sin(now / 260) > -0.2;
      if (a) plannedArrows.push({ from: st.regions[this.teachArrow.from].site, to: st.regions[this.teachArrow.to].site, label: '', color: '#ffd86b', dashed: true, kind: 'seize' });
    }
    const input: DrawInput = {
      state: st, you: this.you, visible: this.visibleSet(), owners, fleets,
      selectedRegion: this.sel?.kind === 'region' ? this.sel.id : null, hoverRegion: this.hoverRegion,
      highlight, plannedArrows, pathPreview: null,
      signals: this.replay ? [] : this.st.last?.signals ?? [], showSignals: this.showSignals,
      fx: this.fx, now: vnow,
      ...this.supplyOverlay(),
    };
    // UX v2 renderer inputs (docs/UX-V2.md §8): the drag arrow, the lens, a fanned stack, Space-peek
    Object.assign(input, { drag: this.blockingReplay ? null : this.gest.drawDrag(now), lens: this.lens, expanded: this.expanded, peek: this.peek, postures: this.replay ? null : postureMap(this) });
    this.map.draw(input);
    this.fx = this.fx.filter(f => vnow - f.t0 < f.dur);
    this.stage.frame(p => this.map.toScreen(p));
    this.gest.afterDraw();
    this.teach?.frame();
    this.root.classList.toggle('targeting', !!this.mode || this.gest.isDragging());
  }
  /** Map arrows for one order (WEGO slot `i`, or -1 for a LIVE queued order). */
  orderArrows(o: Order, i: number, out: DrawInput['plannedArrows'], hot: boolean) {
    const st = this.st;
    const col = hot ? '#ffffff' : this.color(this.you);
    const label = i >= 0 ? roman(i + 1) : '⏱';
    const fleetAt = (id: number) => this.fleet(id)?.region;
    // the first leg starts at the fleet's token, not the planet (it would cross the banner)
    const site = (r: number, fid: number, first: boolean) => (first ? this.lastFleetPos.get(fid) : undefined) ?? st.regions[r].site;
    if (o.type === 'move') {
      let from = fleetAt(o.fleet);
      if (from === undefined) return;
      let first = true;
      for (const r of o.path) { if (!st.regions[r] || !st.regions[from]) break; out.push({ from: site(from, o.fleet, first), to: st.regions[r].site, label: r === o.path[o.path.length - 1] ? label : '', color: o.overdrive ? '#ffb84d' : col, kind: 'move' }); from = r; first = false; }
    } else if (o.type === 'seize') {
      const via = ((o as { via?: number[] }).via ?? []).filter(r => st.regions[r]);
      let from = fleetAt(o.fleet);
      if (from === undefined || !st.regions[o.target]) return;
      let first = true;
      for (const r of via) { out.push({ from: site(from, o.fleet, first), to: st.regions[r].site, label: '', color: hot ? '#ffffff' : '#ff5d7a', kind: 'move' }); from = r; first = false; }
      if (from !== o.target) out.push({ from: site(from, o.fleet, first), to: st.regions[o.target].site, label, color: hot ? '#ffffff' : '#ff5d7a', kind: 'seize' });
      for (const id of o.also ?? []) {
        const a = fleetAt(id);
        if (a !== undefined && a !== o.target && st.regions[a]) out.push({ from: site(a, id, true), to: st.regions[o.target].site, label: '', color: '#ff9db0', dashed: true, kind: 'seize' });
      }
    }
  }

  // ================================================================== rendering
  renderAll() {
    if (this.sel?.kind === 'fleet' && !this.fleet(this.sel.id)) this.sel = null;
    // the Reckoning ribbon never sits over a card's or a modal's controls
    if (this.sel || this.hud.modalOpen()) this.reck.dismiss();
    this.hud.render();
    this.teach?.update();
    this.tipCheck();
    this.hud.refreshModal();
  }

  /**
   * Re-render a panel without losing what the player is typing: the focused field (found again by its data-*
   * attribute) gets its text, caret and focus back.
   */
  keepInputs(box: HTMLElement, render: () => void) {
    const a = document.activeElement as HTMLInputElement | HTMLSelectElement | null;
    let saved: { sel: string; value: string; start: number | null; end: number | null } | null = null;
    if (a && box.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT')) {
      const attr = [...a.attributes].find(x => x.name.startsWith('data-'));
      if (attr) {
        let start: number | null = null, end: number | null = null;
        try { start = (a as HTMLInputElement).selectionStart; end = (a as HTMLInputElement).selectionEnd; } catch { /* not a text field */ }
        saved = { sel: `[${attr.name}${attr.value ? `="${CSS.escape(attr.value)}"` : ''}]`, value: a.value, start, end };
      }
    }
    render();
    if (!saved) return;
    const n = box.querySelector<HTMLInputElement>(saved.sel);
    if (!n || n.type === 'checkbox' || n.type === 'range') return;
    n.value = saved.value;
    n.focus({ preventScroll: true });
    try { if (saved.start !== null) n.setSelectionRange(saved.start, saved.end); } catch { /* */ }
  }

  /** Phone layout: compact top row, bottom-sheet card, modal buttons folded into the menu. */
  get phone(): boolean { return window.matchMedia('(max-width: 700px), (max-height: 500px) and (max-width: 1000px)').matches; }

  select(s: { kind: 'region' | 'fleet'; id: number }) {
    // the player moved on: the Reckoning ribbon gets out of the way of the card
    this.reck.dismiss();
    const same = this.sel?.kind === s.kind && this.sel.id === s.id;
    this.sel = s;
    this.mode = null;
    this.replacing = null;
    if (!same) this.lifted.clear();
    if (s.kind === 'fleet') {
      const f = this.fleet(s.id);
      const stack = f ? this.st.fleets.filter(x => x.owner === f.owner && x.region === f.region && x.ships.length).length : 0;
      this.expanded = f && stack > 1 ? f.region : null;
    } else this.expanded = null;
    this.gest.closeRing();
    this.renderAll();
    // phone: the card is a bottom sheet; keep the selection (and its neighbours) clear of it
    if (this.phone && !same) {
      const site = s.kind === 'region' ? this.st.regions[s.id]?.site : this.lastFleetPos.get(s.id) ?? this.st.regions[this.fleet(s.id)?.region ?? -1]?.site;
      if (site) { const p = this.map.toScreen(site); if (p.y > this.map.h * 0.38 || p.y < 70) this.focus(site); }
    }
  }
  deselect() {
    this.sel = null; this.mode = null; this.lifted.clear(); this.expanded = null; this.replacing = null;
    this.gest.closeRing();
    this.renderAll();
  }
  focus(p: Pt) {
    // keep the point clear of the card and strip: aim a little above centre
    const off = this.phone ? (this.map.h * 0.18) / this.map.cam.z : this.map.px(60);
    this.map.flyTo({ x: p.x, y: p.y + off });
  }
  setLens(l: Lens) { this.lens = l; this.renderAll(); }

  // ================================================================== input
  onResize = () => {
    if (this.destroyed) return;
    const was = this.root.className;
    this.root.classList.toggle('phone', this.phone);
    this.layoutClasses();
    if (was !== this.root.className) this.renderAll(); else this.hud?.fitTop();
    this.map.resize();
    if (!this.map.fitted && this.map.w > 0) this.map.fit(this.st, this.you !== null ? this.st.regions[this.st.players[this.you]?.capital]?.site : undefined);
  };
  /**
   * Layout classes for the HUD (shell.css). The UI scales with the root font-size, so widths are measured in rem:
   *  lay-narrow  < 70rem wide (portrait tablets, narrow windows): the tool buttons stand in a column at the right,
   *              the strip spans the bottom, notices sit above it;
   *  lay-mid     < 104rem: the strip is centred in the space left of the tool row, notices above it;
   *  landscape   a phone on its side (the card becomes a side sheet);
   *  touch       a coarse pointer: 44px targets, no hover-only affordances.
   */
  layoutClasses() {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const w = window.innerWidth / rem;
    const phone = this.phone;
    const cl = this.root.classList;
    cl.toggle('lay-narrow', !phone && w < 70);
    cl.toggle('lay-mid', !phone && w >= 70 && w < 104);
    cl.toggle('landscape', phone && window.innerWidth > window.innerHeight);
    const touch = window.matchMedia('(pointer: coarse)').matches;
    cl.toggle('touch', touch);
    // the founding / record sheets are overlays on <body>, outside the shell
    document.documentElement.classList.toggle('touch', touch);
  }
  /** A modal, dialog, battle viewer or curtain is up: the board's shortcuts stay quiet. */
  covered(): boolean { return !!this.curtain || !!document.querySelector('.bv-overlay, .overlay') || this.hud.modalOpen() || heraldOpen() || sagaOpen(); }
  /** The Herald's front page (newest edition, or turn `turn`'s). */
  openHerald(turn?: number) { openHerald(this, turn); }
  /** The end-of-game Saga page (works mid-game too: the story so far). */
  openSaga() { openSaga(this); }
  /** Open the Herald if a new edition is waiting and nothing else is on screen (start of a turn / cycle). */
  heraldCheck() {
    if (this.destroyed || this.curtain || this.blockingReplay || this.hud.modalOpen() || document.querySelector('.overlay, .bv-overlay')) return;
    maybeHerald(this);
  }
  onKey = (e: KeyboardEvent) => {
    if (this.destroyed || e.defaultPrevented) return;
    if (typing(e.target)) return;
    if (this.covered()) return;
    const t = e.target as HTMLElement | null;
    if (e.key === 'Enter' && !e.shiftKey && t?.tagName !== 'BUTTON') { e.preventDefault(); if (!this.live) this.submit(true); return; }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'z') { e.preventDefault(); this.undo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') {
      if (this.gest.cancel()) { /* drag / ring / hover */ }
      else if (this.hud.closePopovers()) { /* menu, lens, notes */ }
      else if (this.replacing) this.replacing = null;
      else if (this.mode) this.mode = null;
      else if (this.targetSlot !== null) this.targetSlot = null;
      else if (this.sel) { this.deselect(); return; }
      this.hideTip(); this.renderAll(); return;
    }
    if (e.key === ' ') {
      if ((t?.tagName === 'BUTTON')) return;
      e.preventDefault();
      // Space skips the reveal straight to the Reckoning; a second Space lands every coin at once
      if (this.replay && this.blockingReplay) { this.endReplay(); return; }
      if (this.reck.counting && !e.repeat) { this.reck.finish(); this.renderAll(); return; }
      if (!this.peek) { this.peek = true; }
      return;
    }
    if (e.repeat) return;
    if (e.key === 'Tab') { e.preventDefault(); this.nextIdle(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.canPlan) {
      const i = this.hoverSlot ?? this.targetSlot;
      if (i !== null) { this.removeOrder(i); this.hoverSlot = null; }
      return;
    }
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit) {
      const n = Number(digit[1]);
      if (e.shiftKey) { if (this.canPlan && !this.live && n <= this.plan.orders.length) { this.targetSlot = this.targetSlot === n - 1 ? null : n - 1; this.renderAll(); } }
      else if (n <= LENSES.length) this.setLens(LENSES[n - 1]);
      return;
    }
    const k = e.key.toLowerCase();
    const f = this.sel?.kind === 'fleet' ? this.fleet(this.sel.id) : undefined;
    if (f && f.owner === this.you && this.canPlan && !this.blockingReplay) {
      if (k === 'm' || k === 's') { this.mode = { type: k === 'm' ? 'move' : 'seize', fleet: f.id }; this.renderAll(); return; }
      if (k === 'f') { this.addOrder({ type: 'fortify', fleet: f.id }); return; }
    }
    if (k === 'e' && this.st.rules.empire?.enabled !== false) this.openModal('empire');
    else if (k === 'q') this.openModal('score');
    else if (k === 'c') this.openModal('chronicle');
    else if (k === 'h' || e.key === '?') this.openModal('help');
    else if (k === 'i') this.toolbar('signals');
    else if (k === 'r') this.toolbar('replay');
  };
  onKeyUp = (e: KeyboardEvent) => { if (e.key === ' ') this.peek = false; };
  onBlur = () => { this.peek = false; this.gest.cancel(); };

  /** Older entry points (menu items, scripts): replay / signals / help / menu. */
  toolbar(a: string) {
    switch (a) {
      case 'replay': if (this.st.last) { this.startReplay(this.st.last); if (!this.replay) toast('Nothing to replay'); } else toast('Nothing to replay'); break;
      case 'signals': this.showSignals = !this.showSignals; toast(`◎ Signals ${this.showSignals ? 'on' : 'off'}`); this.renderAll(); break;
      case 'help': this.openModal('help'); break;
      case 'menu': this.hud.openMenu(); break;
    }
  }
  /** Start the teach-by-doing callouts again (Menu / Help). */
  restartTeach() { this.teach?.restart(); this.renderAll(); }
  /** @deprecated v1 name */
  restartTour() { this.restartTeach(); }
  menu() { this.hud.openMenu(); }

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

  currentFleetDraws(): FleetDraw[] {
    const lay = this.fleetLayout();
    // hit-testing must use where frame() last drew each token (LIVE glide, easing after a state change), not its parked slot
    return this.st.fleets.map(f => ({ id: f.id, owner: f.owner, ships: f.ships.length, pos: this.lastFleetPos.get(f.id) ?? lay.get(f.id) ?? this.st.regions[f.region].site, alpha: 1, name: f.name }));
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
    // the ribbon, any count-up and a lingering banner give way to the ceremony
    this.reck.finish(true); this.reck.dismiss();
    this.el.banner?.classList.remove('show');
    // the winner's banner goes up over every region they hold, rippling out from their capital (behind the ceremony)
    const now = performance.now();
    const cap = st.regions[w.capital]?.site ?? st.regions[0].site;
    for (const r of st.regions) if (r.owner === w.id) this.fx.push({ kind: 'capture', pos: r.site, color: w.color, t0: now + Math.hypot(r.site.x - cap.x, r.site.y - cap.y) * 0.6, dur: 1100 });
    // the crowning (fx/crowning.ts): the lamp swings to the winner's seat, the banners, the awards, then the Saga
    const ov = crowning({
      st, me: this.mySeat(), results: () => this.allResults(),
      onLook: () => {}, onSaga: st.soul ? () => this.openSaga() : null, onLobby: () => this.onExit(),
    });
    // an online game that counted for a League: the ledger's entry, the plaque, the Ugly Trophy and "Again?"
    if (this.src.kind === 'remote') {
      const id = this.src.meta.id;
      void import('./league/panel.ts').then(m => {
        if (!ov.isConnected) return;
        m.mountLeagueResult(ov.querySelector<HTMLElement>('.cr-stage') ?? ov, id, next => { ov.remove(); location.hash = `#/g/${encodeURIComponent(next)}`; });
      });
    }
  }
  /** Every turn's result this source can give (the awards read the whole game; incomplete is allowed, see awards.ts). */
  allResults(): Promise<TurnResult[]> {
    const src = this.src;
    if (src instanceof LocalSource) {
      // a LIVE game's tick history is capped: once it has been trimmed it no longer covers the whole game
      const h = src.save.history;
      return Promise.resolve(this.live && h.length >= 120 ? [] : h.slice());
    }
    if (this.live) return Promise.resolve([]);
    const last = this.st.last?.turn ?? this.st.turn;
    const turns = Array.from({ length: Math.max(0, last) }, (_, i) => i + 1);
    const timeout = new Promise<null>(res => setTimeout(() => res(null), 6000));
    return Promise.all(turns.map(t => Promise.race([src.history(t).catch(() => null), timeout]))).then(rs => rs.filter((r): r is TurnResult => !!r));
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



function capFirst(t: string | null): string | null { return t ? t[0].toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? '' : '.') : null; }

function clampZ(z: number) { return Math.max(0.12, Math.min(3, z)); }


export function eventText(st: GameState, e: GameEvent, you: number | null): string {
  const rn = (id: number) => `<b>${esc(st.regions[id]?.name ?? '?')}</b>`;
  const pn = (o: number | null) => o === null ? 'neutrals' : o < 0 ? 'the Warden' : `<span style="color:${st.players[o]?.color}">${esc(st.players[o]?.name ?? '?')}</span>`;
  const fn = (id: number) => esc(st.fleets.find(f => f.id === id)?.name ?? 'a fleet');
  switch (e.k) {
    case 'pulse': return '';
    case 'move': return e.guard ? `${pn(e.owner)} guard ${fn(e.fleet)} rushes to ${rn(e.to)}` : `${pn(e.owner)} ${fn(e.fleet)} → ${rn(e.to)}`;
    case 'blocked': return `${pn(e.owner)} ${fn(e.fleet)} stopped at ${rn(e.at)} (${esc(e.reason)})`;
    case 'clash': return `Fleets clash on the ${rn(e.a)}–${rn(e.b)} border!`;
    case 'battle': return `<a href="#" data-battle="${e.battle}">${ic('battle')} ${esc(e.name)}</a>`;
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
    case 'tech': { const t = TECH[e.tech]; return e.stolen ? `${pn(e.owner)} steals <b>${esc(t?.name ?? e.tech)}</b> from a captured Academy` : `${pn(e.owner)} researched ${ic(icFor('tech', e.tech, t?.icon))} <b>${esc(t?.name ?? e.tech)}</b>${t?.tier === 4 ? ' <span class="gold">★</span>' : ''}`; }
    case 'law': { const l = LAW[e.law]; return `${pn(e.owner)} ${e.revoked ? 'revokes' : 'enacts'} ${ic(icFor('law', e.law, l?.icon))} <b>${esc(l?.name ?? e.law)}</b>`; }
    case 'refit': return `${pn(e.owner)} ${fn(e.fleet)} refits at ${rn(e.region)}`;
    case 'rout': return `${pn(e.owner)} ${fn(e.fleet)} routs from ${rn(e.from)}, limping home`;
    case 'soul': return esc(e.text);
    case 'posture': return esc(e.text);
    case 'fate': return `${ic('fate')} ${esc(e.text)}`;
    default: return '';
  }
}

export { EDICTS };


