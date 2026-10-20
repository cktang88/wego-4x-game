// The in-game screen: map, planning UI (5 order slots), replays, intel,
// chronicle, scoreboard, chat. Works with either a local or remote GameSource.
import { describeOrder, orderCost, validateOrder, costText, canAfford, ORDER_INFO } from '../../shared/sim/orders.ts';
import { findPath, fleetSpeed, fleetPower } from '../../shared/sim/graph.ts';
import { income, currentLeader, resolveTurn, emptySubmission } from '../../shared/sim/resolve.ts';
import { TRAITS, RELICS, NEUTRAL_COLOR } from '../../shared/config/content.ts';
import { EDICTS } from '../../shared/sim/edicts.ts';
import type { Doctrine, Fleet, GameEvent, GameState, Order, Pt, Region, Submission, TurnResult } from '../../shared/sim/types.ts';
import type { GameSource } from './net.ts';
import { LocalSource } from './net.ts';
import { MapRenderer, regionLayout, type FleetDraw, type Fx } from './render/map.ts';
import { openBattleViewer } from './render/battle.ts';
import { h, esc, toast, overlay, roman } from './ui/dom.ts';
import { helpHtml } from './ui/help.ts';

type Mode = null | { type: 'move'; fleet: number; overdrive: boolean } | { type: 'seize'; fleet: number } | { type: 'target'; order: 'influence' | 'scan' | 'feint' };
type Tab = 'orders' | 'intel' | 'chronicle' | 'score' | 'chat';

interface ReplayFleet { id: number; owner: number; ships: number; region: number; alpha: number; name: string }
interface Beat { dur: number; events: GameEvent[] }
interface Replay {
  result: TurnResult;
  beats: Beat[];
  i: number;
  t0: number;
  playing: boolean;
  speed: number;
  fleets: Map<number, ReplayFleet>;
  owners: (number | null)[];
  startLayout: Map<number, Pt>;
  endLayout: Map<number, Pt>;
  moving: Set<number>;
  pulse: number;
  applied: boolean;
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
  lastSeenTurn = 0;
  unreadChat = 0;
  raf = 0;
  drag: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
  pinch: { d: number; z: number } | null = null;
  pointers = new Map<number, { x: number; y: number }>();
  el: Record<string, HTMLElement> = {};
  destroyed = false;
  previewing = false;

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
      <div class="bottombar">
        <div class="pulsebar" data-el="pulsebar"></div>
        <div class="ticker" data-el="ticker"></div>
        <div class="row" data-el="rcontrols"></div>
      </div>
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
    if (window.innerWidth <= 700) this.el.right.classList.add('min');
    this.onResize();
    this.lastSeenTurn = this.seenTurnKey() ? Number(localStorage.getItem(this.seenTurnKey()) ?? 0) : 0;
    this.onSourceChange('view');
    const loop = () => { if (this.destroyed) return; this.frame(); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKey);
    this.src.close();
    this.root.remove();
  }

  // ================================================================== data helpers
  get st(): GameState { return this.src.view.state; }
  get you(): number | null { return this.src.view.you; }
  get submitted(): boolean { return !!this.src.mySubmission; }
  get canPlan(): boolean { return this.you !== null && !this.submitted && this.st.winner === null && !this.st.players[this.you].eliminated; }
  seenTurnKey() { return `tc.seen.${this.src.meta?.id ?? 'x'}.${this.you ?? 's'}`; }
  freshPlan(): Submission { return { orders: new Array(this.st.rules.orders.perTurn).fill(null), free: [] }; }
  planKey() { return `tc.plan.${this.src.meta.id}.${this.you}.${this.st.turn}`; }
  savePlan() { try { localStorage.setItem(this.planKey(), JSON.stringify(this.plan)); } catch { /* */ } }
  loadPlan() {
    try {
      const p = JSON.parse(localStorage.getItem(this.planKey()) ?? 'null');
      if (p && Array.isArray(p.orders)) { this.plan = p; return; }
    } catch { /* */ }
    this.plan = this.freshPlan();
  }
  color(o: number | null | undefined) { return o === null || o === undefined || o < 0 ? (o === -1 ? '#e7b6ff' : NEUTRAL_COLOR) : this.st.players[o]?.color ?? NEUTRAL_COLOR; }
  pname(o: number | null | undefined) { return o === null || o === undefined ? 'Neutral' : o < 0 ? (this.st.wardenAwake && !this.st.wardenDefeated ? 'Neutral / Warden' : 'Neutral') : this.st.players[o]?.name ?? '?'; }
  fleet(id: number) { return this.st.fleets.find(f => f.id === id); }
  doctrineOf(f: Fleet): Doctrine {
    const fa = [...this.plan.free].reverse().find(x => x.type === 'doctrine' && x.fleet === f.id);
    return fa && fa.type === 'doctrine' ? fa.doctrine : f.doctrine;
  }

  /** Fleet positions after orders in slots < k (assumes moves/seizes succeed). */
  projected(k: number): Map<number, number> {
    const pos = new Map(this.st.fleets.map(f => [f.id, f.region]));
    for (let i = 0; i < Math.min(k, this.plan.orders.length); i++) {
      const o = this.plan.orders[i];
      if (!o) continue;
      if (o.type === 'move') pos.set(o.fleet, o.path[o.path.length - 1]);
      if (o.type === 'seize') pos.set(o.fleet, o.target);
    }
    return pos;
  }
  projectedState(k: number): GameState {
    const s: GameState = { ...this.st, fleets: this.st.fleets.map(f => ({ ...f })), regions: this.st.regions };
    const pos = this.projected(k);
    const uses = new Map<number, number>();
    for (let i = 0; i <= k && i < this.plan.orders.length; i++) {
      const o = this.plan.orders[i];
      if (o && 'fleet' in o && o.type !== 'build') uses.set(o.fleet, (uses.get(o.fleet) ?? 0) + 1);
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
    for (const o of this.plan.orders) {
      if (!o) continue;
      const c = orderCost(this.st, o, this.you);
      tot.industry += c.industry ?? 0; tot.credits += c.credits ?? 0; tot.influence += c.influence ?? 0;
      if ('fleet' in o && o.type !== 'build') {
        const u = uses.get(o.fleet) ?? 0;
        if (u > 0) tot.credits += this.st.rules.orders.repeatFleetCredits;
        uses.set(o.fleet, u + 1);
      }
    }
    return tot;
  }
  nextSlot(): number | null {
    if (this.targetSlot !== null) return this.targetSlot;
    const i = this.plan.orders.findIndex(o => !o);
    return i >= 0 ? i : null;
  }

  addOrder(o: Order) {
    if (!this.canPlan) return;
    const k = this.nextSlot();
    if (k === null) { toast(`All ${this.plan.orders.length} orders are used. Remove one first (that's the point!).`); return; }
    const err = this.validateAt(o, k);
    if (err) { toast(`Can't: ${err}`); return; }
    const spend = this.plannedSpend();
    const c = orderCost(this.st, o, this.you!);
    const res = this.st.players[this.you!].res;
    const after = { industry: res.industry - spend.industry, credits: res.credits - spend.credits, influence: res.influence - spend.influence };
    if (!canAfford(after, c)) toast(`Warning: you can't afford that with your other orders (${costText(c)}). It will fail unless you free up resources.`);
    this.plan.orders[k] = o;
    this.targetSlot = null;
    this.mode = null;
    this.savePlan();
    this.renderAll();
  }

  // ================================================================== source updates
  onSourceChange(k: string) {
    if (k === 'chat') { if (this.tab !== 'chat') this.unreadChat++; this.renderTabs(); if (this.tab === 'chat') this.renderTab(); return; }
    if (k === 'error') { toast(this.src.lastError); return; }
    if (k === 'meta') { this.renderTop(); if (this.tab === 'orders') this.renderTab(); return; }
    // full view
    if (!this.map.fitted && this.map.w > 0) {
      const cap = this.you !== null ? this.st.regions[this.st.players[this.you].capital].site : undefined;
      this.map.fit(this.st, cap);
    }
    this.loadPlan();
    if (this.src.mySubmission) this.plan = structuredClone(this.src.mySubmission);
    if (this.sel?.kind === 'fleet' && !this.fleet(this.sel.id)) this.sel = null;
    const last = this.st.last;
    if (last && last.turn > this.lastSeenTurn && this.st.turn > 1 && this.src.kind === 'remote' && document.hidden) {
      document.title = `(!) Turn ${this.st.turn} · Three Crowns`;
      try { if ('Notification' in window && Notification.permission === 'granted') new Notification('Three Crowns', { body: `Turn ${last.turn} resolved. Your move, commander.` }); } catch { /* */ }
      const back = () => { document.title = 'Three Crowns'; document.removeEventListener('visibilitychange', back); };
      document.addEventListener('visibilitychange', back);
    }
    if (last && last.turn > this.lastSeenTurn && this.st.turn > 1) {
      this.lastSeenTurn = last.turn;
      try { localStorage.setItem(this.seenTurnKey(), String(last.turn)); } catch { /* */ }
      this.startReplay(last);
    }
    if (this.st.winner !== null) setTimeout(() => this.showVictory(), this.replay ? 500 : 0);
    this.renderAll();
  }

  handoff(seat: number) {
    const name = this.st.players[seat]?.name ?? '?';
    const o = overlay(`<div class="dialog" style="text-align:center"><h1 style="color:${this.color(seat)}">${esc(name)}</h1>
      <p>Hotseat: pass the device to <b>${esc(name)}</b>. Other players look away!</p><button class="primary" data-x>I am ${esc(name)}</button></div>`, false);
    o.querySelector('[data-x]')!.addEventListener('click', () => o.remove());
  }

  // ================================================================== rendering
  renderAll() { this.renderTop(); this.renderTabs(); this.renderTab(); this.renderLeft(); this.renderBottom(); }

  renderTop() {
    const st = this.st, meta = this.src.meta;
    this.el.turn.textContent = `TURN ${st.turn} / ${st.rules.victory.turnLimit}`;
    let phase = '';
    if (st.winner !== null) phase = `${this.pname(st.winner)} wins`;
    else if (this.replay) phase = this.previewing ? 'PREVIEW: rivals assumed idle' : `Replaying turn ${this.replay.result.turn}`;
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
    this.el.phase.textContent = phase;
    if (this.you !== null) {
      const p = st.players[this.you];
      const inc = income(st, this.you);
      const upkeep = st.fleets.filter(f => f.owner === this.you).reduce((a, f) => a + f.ships.reduce((b, s) => b + (st.rules.ships[s.cls]?.upkeep ?? 0), 0), 0);
      const sp = this.plannedSpend();
      const cell = (icon: string, v: number, spend: number, inc: number, title: string) =>
        `<div class="r" title="${title}"><span>${icon} <span class="${v - spend < 0 ? 'bad' : ''}">${v - spend}</span>${spend ? `<small style="display:inline"> /${v}</small>` : ''}</span><small>${inc >= 0 ? '+' : ''}${inc}/turn</small></div>`;
      this.el.res.innerHTML = cell('⚙', p.res.industry, sp.industry, inc.industry, 'Industry: builds ships and projects') +
        cell('¢', p.res.credits, sp.credits, inc.credits - upkeep, `Credits: ship upkeep (${upkeep}/turn), projects, extra fleet orders`) +
        cell('✦', p.res.influence, sp.influence, inc.influence, 'Influence: subversion, scans, feints, pacts');
    } else this.el.res.innerHTML = '';
    const leader = currentLeader(st);
    this.el.players.innerHTML = st.players.map(p => {
      const s = meta.seats[p.id];
      return `<div class="pchip ${p.id === this.you ? 'you' : ''}" style="border-color:${p.color};color:${p.color}" title="${esc(p.name)}${s?.kind === 'ai' ? ` (AI ${s.aiLevel})` : ''}${p.eliminated ? ' (eliminated)' : ''}">
        <span class="dot ${s?.online ? 'on' : ''}"></span>
        <span style="color:var(--text)${p.eliminated ? ';text-decoration:line-through' : ''}">${esc(p.name)}</span>
        <span class="vp">${p.vp}${leader === p.id ? ' ♛' : ''}</span>
        ${s?.submitted ? '<span title="orders sealed">✓</span>' : '<span class="faint" title="still planning">…</span>'}
      </div>`;
    }).join('');
  }

  renderTabs() {
    const tabs: [Tab, string][] = [['orders', 'Orders'], ['intel', 'Intel'], ['chronicle', 'Chronicle'], ['score', 'Score'], ['chat', 'Chat']];
    this.el.tabs.innerHTML = tabs.map(([k, n]) => `<button class="${this.tab === k ? 'on' : ''}" data-tab="${k}">${n}${k === 'chat' && this.unreadChat ? `<span class="badge">${this.unreadChat}</span>` : ''}${k === 'intel' && this.st.last?.signals.length ? `<span class="badge" style="background:var(--accent)">${this.st.last.signals.length}</span>` : ''}</button>`).join('');
    this.el.tabs.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b => b.addEventListener('click', () => {
      if (this.el.right.classList.contains('min')) this.el.right.classList.remove('min');
      else if (this.tab === b.dataset.tab && window.innerWidth <= 700) this.el.right.classList.add('min');
      this.tab = b.dataset.tab as Tab; if (this.tab === 'chat') this.unreadChat = 0; this.renderTabs(); this.renderTab();
    }));
  }

  renderTab() {
    const b = this.el.tabbody;
    switch (this.tab) {
      case 'orders': b.innerHTML = this.ordersHtml(); this.bindOrders(); break;
      case 'intel': b.innerHTML = this.intelHtml(); break;
      case 'chronicle': b.innerHTML = this.chronicleHtml(); break;
      case 'score': b.innerHTML = this.scoreHtml(); break;
      case 'chat': b.innerHTML = this.chatHtml(); this.bindChat(); break;
    }
    b.querySelectorAll<HTMLElement>('[data-battle]').forEach(e => e.addEventListener('click', () => this.openBattle(Number(e.dataset.battle))));
    b.querySelectorAll<HTMLElement>('[data-region]').forEach(e => e.addEventListener('click', () => { this.select({ kind: 'region', id: Number(e.dataset.region) }); this.focus(this.st.regions[Number(e.dataset.region)].site); }));
  }

  ordersHtml(): string {
    const st = this.st;
    if (this.you === null) return `<p class="dim">You are spectating this game.</p>`;
    const sp = this.plannedSpend();
    const slots = this.plan.orders.map((o, i) => {
      const err = o && this.canPlan ? this.validateAt(o, i) : null;
      const c = o ? orderCost(st, o, this.you!) : {};
      return `<div class="slot ${o ? 'filled' : ''} ${this.nextSlot() === i && this.canPlan ? 'target' : ''} ${err ? 'invalid' : ''}" data-slot="${i}">
        <div class="num">${roman(i + 1)}</div>
        <div class="desc">${o ? `${ORDER_INFO[o.type].icon} ${esc(describeOrder(st, o))}<small>${costText(c) || 'free'}${err ? ` · <span class="bad">${esc(err)}</span>` : ''}</small>` : `<span class="faint">— pulse ${roman(i + 1)}: empty —</span>`}</div>
        <div class="acts">${o && this.canPlan ? `<button data-up="${i}" title="earlier">▲</button><button data-down="${i}" title="later">▼</button><button data-del="${i}" title="remove">✕</button>` : ''}</div>
      </div>`;
    }).join('');
    const free = this.plan.free.length ? `<div class="faint" style="font-size:12px;margin-top:6px">+ ${this.plan.free.length} free change(s): doctrine/merge/split/rename</div>` : '';
    const seats = this.src.meta.seats.map(s => `<span style="color:${this.color(s.seat)}">${esc(s.name)} ${s.submitted ? '✓' : '…'}</span>`).join(' · ');
    return `<h2>Orders: Turn ${st.turn}</h2>
      <div class="orderhelp">You get <b>${st.rules.orders.perTurn} orders</b> for your whole empire. The order in slot <b>${roman(1)}</b> resolves in pulse ${roman(1)} for everyone at once, and so on. Fleets and cities you don't order still defend themselves. Max <b>${st.rules.orders.maxPerFleet}</b> orders per fleet; a fleet's second order costs ${st.rules.orders.repeatFleetCredits}¢.</div>
      <div class="slots">${slots}</div>${free}
      <div class="costs">Planned spend: <span>${sp.industry}⚙</span><span>${sp.credits}¢</span><span>${sp.influence}✦</span></div>
      <div class="row" style="margin-top:8px">
        ${this.submitted ? `<button data-unsubmit class="grow">✎ Unseal orders</button>` :
          `<button class="primary grow" data-submit ${this.canPlan ? '' : 'disabled'}>Seal orders & end turn ⏎</button>`}
        <button data-preview ${this.canPlan ? '' : 'disabled'} title="Simulate your plan as if rivals hold still (they won't!)">👁 Preview</button>
        <button data-clear ${this.canPlan ? '' : 'disabled'} title="Clear all orders">Clear</button>
      </div>
      <div style="margin-top:10px;font-size:13px" class="dim">${seats}</div>
      <h3>How to give orders</h3>
      <div class="orderhelp">Click one of <b>your fleets</b> (chevrons) for Move / Seize / Fortify / Excavate and its doctrine. Click a <b>region</b> for Build / Develop, or Influence / Scan / Feint. Click a slot to place the next order into that pulse. <span class="kbd">Esc</span> cancels.</div>`;
  }

  bindOrders() {
    const b = this.el.tabbody;
    b.querySelectorAll<HTMLElement>('[data-slot]').forEach(e => e.addEventListener('click', ev => {
      if ((ev.target as HTMLElement).closest('button')) return;
      const i = Number(e.dataset.slot);
      this.targetSlot = this.targetSlot === i ? null : i;
      this.renderTab();
    }));
    const swap = (i: number, j: number) => {
      if (j < 0 || j >= this.plan.orders.length) return;
      [this.plan.orders[i], this.plan.orders[j]] = [this.plan.orders[j], this.plan.orders[i]];
      this.savePlan(); this.renderAll();
    };
    b.querySelectorAll<HTMLElement>('[data-up]').forEach(e => e.addEventListener('click', () => swap(Number(e.dataset.up), Number(e.dataset.up) - 1)));
    b.querySelectorAll<HTMLElement>('[data-down]').forEach(e => e.addEventListener('click', () => swap(Number(e.dataset.down), Number(e.dataset.down) + 1)));
    b.querySelectorAll<HTMLElement>('[data-del]').forEach(e => e.addEventListener('click', () => { this.plan.orders[Number(e.dataset.del)] = null; this.savePlan(); this.renderAll(); }));
    b.querySelector('[data-submit]')?.addEventListener('click', () => this.submit());
    b.querySelector('[data-unsubmit]')?.addEventListener('click', () => this.src.unsubmit());
    b.querySelector('[data-clear]')?.addEventListener('click', () => { this.plan = this.freshPlan(); this.savePlan(); this.renderAll(); });
    b.querySelector('[data-preview]')?.addEventListener('click', () => this.preview());
  }

  /** Ghost planner: run the real resolver on your fogged view, rivals giving no orders. */
  preview() {
    if (this.you === null) return;
    try {
      const st = structuredClone(this.st);
      if (!st.rngState) st.rngState = (st.seed ^ st.turn) >>> 0;
      const subs: Record<number, Submission> = {};
      for (const p of st.players) subs[p.id] = p.id === this.you ? structuredClone(this.plan) : emptySubmission(st);
      const res = resolveTurn(st, subs).last;
      if (!res) return;
      this.previewing = true;
      this.startReplay(res);
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
      <div class="orderhelp">Every order leaves traces. Within your sensor range you see where rival fleets moved, when they arrived and roughly how big they were (small/medium/large). <i>Inferred</i> signals may be feints. Toggle <span class="kbd">I</span> to draw them on the map.</div>
      ${scans.length ? `<div class="dim" style="font-size:13px">Active scans: ${scans.map(s => esc(this.st.regions[s.region].name)).join(', ')}</div>` : ''}
      <div class="feed">${sig.length ? sig.map(s => `<div class="entry signal ${s.confidence} click" data-region="${s.region}" style="border-left-color:${this.color(s.about)}">
        <div class="t">PULSE ${roman(s.pulse)} · ${s.about === null ? 'UNKNOWN ORIGIN' : esc(this.pname(s.about)).toUpperCase()} · ${s.confidence.toUpperCase()}</div>${esc(s.text)}</div>`).join('') : '<div class="faint">No signals detected last turn.</div>'}</div>
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
      <div class="orderhelp">First to <b>${V.vpTarget} VP</b> wins, or most VP after turn ${V.turnLimit}${V.holdAllCrownsWins ? ', or hold <b>all three Crowns</b> at the end of a turn' : ''}. VP comes from Crowns (${V.vpPerCrownPerTurn}/turn each, +${V.crownMajorityVp} for holding 2+), the Throne (1, 2, 3… VP for each consecutive turn held, max ${st.rules.throne.streakMaxVp}), relics (${V.vpPerRelic}), capturing capitals (${V.vpCapitalCapture}), battle honors, bounties for hitting the leader (+${st.rules.bounty.vpTakeFromLeader}), and Edicts.</div>
      ${rows}
      <h3>The Hollow Throne</h3><div class="dim" style="font-size:13px">${st.throne.owner !== null ? `Held by <b style="color:${this.color(st.throne.owner)}">${esc(this.pname(st.throne.owner))}</b>, streak ${st.throne.streak}` : 'Unclaimed'}${st.wardenAwake ? (st.wardenDefeated ? ' · the Warden is destroyed' : ' · <b class="bad">THE WARDEN IS AWAKE</b>') : ` · Warden sleeps (${st.loreFound}/${st.rules.warden.wakeAtLore} fragments found)`}</div>
      <h3>Edicts</h3>${st.edicts.length ? st.edicts.map(e => `<div class="edict"><b>${esc(e.name)}</b> · ${e.vp} VP<br>${esc(e.desc)}<br><span class="faint">Judged at the end of turn ${e.scoresTurn}</span></div>`).join('') : `<div class="faint" style="font-size:13px">No edict active. The first is proclaimed after turn ${st.rules.edicts.firstReveal}.</div>`}
      ${pacts ? `<h3>Pacts</h3><div class="feed">${pacts}</div>` : ''}`;
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
    L.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-doc]').forEach(e => e.addEventListener('change', () => this.doctrineChanged()));
    L.querySelector<HTMLInputElement>('[data-rename]')?.addEventListener('change', e => {
      const v = (e.target as HTMLInputElement).value.trim();
      if (this.sel?.kind === 'fleet' && v) { this.plan.free.push({ type: 'rename', fleet: this.sel.id, name: v }); this.savePlan(); toast('Renamed (applies when the turn resolves)'); }
    });
    L.querySelector('[data-close]')?.addEventListener('click', () => { this.sel = null; this.mode = null; this.renderLeft(); });
  }

  regionHtml(r: Region): string {
    const st = this.st, you = this.you;
    const kindName = { home: 'Capital world', colony: 'Colony', crown: 'CROWN', throne: 'THE THRONE', relic: 'Relic site', void: 'Deep void' }[r.kind];
    const y = st.rules.economy.yields[r.kind];
    const fleets = st.fleets.filter(f => f.region === r.id);
    const owned = r.owner === you && you !== null;
    let actions = '';
    if (this.canPlan) {
      if (owned) {
        const yard = r.buildings.shipyard ?? 0;
        const builds = Object.entries(st.rules.ships).map(([k, d]) => {
          const ok = yard >= d.needsShipyard;
          return `<span title="${esc(d.role)} HP ${d.hp}, ATK ${d.attack}×${d.shots}, shields ${d.shields}, speed ${d.speed}${d.siege ? `, siege +${d.siege}` : ''}">${esc(d.name)} <span class="faint">${costText(orderCost(st, { type: 'build', region: r.id, cls: k, fleet: null }, you!))}</span></span>
            <button data-a="build" data-cls="${k}" ${ok ? '' : 'disabled title="needs shipyard ' + d.needsShipyard + '"'}>Build</button>`;
        }).join('');
        const projects = Object.entries(st.rules.projects).map(([k, p]) => {
          const lvl = k === 'develop' ? r.dev : (r.buildings[k] ?? 0);
          const err = validateOrder(st, you!, { type: 'develop', region: r.id, project: k });
          return `<span title="${esc(p.desc)}">${esc(p.name)} ${lvl ? `<span class="faint">(lvl ${lvl})</span>` : ''} <span class="faint">${costText(p.cost)} · ${p.turns}t</span></span>
            <button data-a="develop" data-proj="${k}" ${err ? `disabled title="${esc(err)}"` : ''}>Start</button>`;
        }).join('');
        actions = `<h3>Build ship ${yard ? '' : '(needs a shipyard)'}</h3><div class="buildlist">${builds}</div><h3>Develop</h3><div class="buildlist">${projects}</div>`;
      } else {
        const inf = validateOrder(st, you!, { type: 'influence', target: r.id });
        actions = `<div class="actions">
          <button data-a="influence" ${inf ? `disabled title="${esc(inf)}"` : ''} title="${esc(ORDER_INFO.influence.help)}">✦ Influence (${costText(orderCost(st, { type: 'influence', target: r.id }, you!))})</button>
          <button data-a="scan" title="${esc(ORDER_INFO.scan.help)}">◎ Scan</button>
          <button data-a="feint" title="${esc(ORDER_INFO.feint.help)}">☍ Feint</button></div>`;
      }
    }
    const loyal = r.owner === null && you !== null ? `<span>Loyalty</span><span>${st.players.map(p => `<span style="color:${p.color}">${r.loyalty[p.id] ?? 0}</span>`).join(' / ')} <span class="faint">(defects at ${st.rules.influence.flipThreshold})</span></span>` : '';
    return `<div class="sel"><div class="row"><h2 class="grow" style="color:${this.color(r.owner)}">${esc(r.name)}</h2><button class="small" data-close>✕</button></div>
      <div class="dim" style="font-size:13px">${kindName}${r.feature !== 'none' ? ` · ${r.feature === 'nebula' ? 'Nebula (hides fleets, −hit)' : 'Asteroids (defender evasion)'}` : ''}</div>
      <div class="kv">
        <span>Owner</span><span style="color:${this.color(r.owner)}">${esc(this.pname(r.owner))}${r.owner !== null && st.players[r.owner]?.capital === r.id ? ' (capital)' : ''}</span>
        <span>Garrison</span><span>${r.garrison < 0 ? 'unknown' : r.garrison}${r.buildings.fortress ? ` · fortress ${r.buildings.fortress}` : ''}</span>
        ${r.kind !== 'void' ? `<span>Development</span><span>${r.dev}</span>` : ''}
        <span>Yield/turn</span><span>${y ? `${y.industry * Math.max(1, r.dev) + (r.buildings.mine ?? 0) * st.rules.economy.mineBonus}⚙ ${y.credits * Math.max(1, r.dev) + (r.buildings.tradehub ?? 0) * st.rules.economy.tradeHubBonus}¢ ${y.influence}✦` : '-'}</span>
        ${Object.keys(r.buildings).length ? `<span>Buildings</span><span>${Object.entries(r.buildings).filter(([, v]) => v).map(([k, v]) => `${esc(st.rules.projects[k]?.name ?? k)} ${v}`).join(', ')}</span>` : ''}
        ${r.project ? `<span>Project</span><span>${esc(st.rules.projects[r.project.key]?.name ?? r.project.key)} (${r.project.progress}/${st.rules.projects[r.project.key]?.turns})</span>` : ''}
        ${r.relic ? `<span>Relic</span><span>${r.relic === 'unclaimed' ? '<b style="color:#7ff7ff">Unexcavated</b>' : esc(RELICS.find(x => x.id === r.relic)?.name ?? 'emptied')}</span>` : ''}
        ${loyal}
        ${r.battles ? `<span>History</span><span>${r.battles} battle${r.battles > 1 ? 's' : ''}, ${r.wreckage} wrecks</span>` : ''}
      </div>
      ${r.memorials.length ? `<div class="history">${r.memorials.map(m => `✝ ${esc(m)}`).join('<br>')}</div>` : ''}
      ${fleets.length ? `<h3>Fleets here</h3>${fleets.map(f => `<div class="entry click" data-fleet="${f.id}" style="border-left-color:${this.color(f.owner)}">${esc(f.name)} <span class="faint">${f.ships.length} ships · ${esc(f.commander.name)}</span></div>`).join('')}` : ''}
      ${actions}</div>`;
  }

  fleetHtml(f: Fleet): string {
    const st = this.st;
    const mine = f.owner === this.you;
    const c = f.commander;
    const d = this.doctrineOf(f);
    const k = this.nextSlot() ?? 0;
    const pos = this.projected(k).get(f.id) ?? f.region;
    const ships = f.ships.map(s => {
      const def = st.rules.ships[s.cls];
      return `<div class="ship"><span title="${esc(def?.role ?? '')}">${glyph(s.cls)}</span>
        <div><b>${esc(s.name)}</b>${s.title ? ` <span class="gold">${esc(s.title)}</span>` : ''} <span class="faint">${esc(def?.name ?? s.cls)}${s.kills ? ` · ${s.kills} kills` : ''}${s.battles ? ` · ${s.battles} battles` : ''}</span>
          <div class="bar"><i style="width:${(s.hp / s.maxHp) * 100}%;background:${s.hp / s.maxHp < 0.4 ? 'var(--bad)' : 'var(--good)'}"></i></div></div>
        <div class="sys"><i class="${s.sys.engines ? '' : 'off'}" title="engines">E</i><i class="${s.sys.weapons ? '' : 'off'}" title="weapons">W</i><i class="${s.sys.shields ? '' : 'off'}" title="shields">S</i>${mine ? `<input type="checkbox" data-split="${s.id}" title="select for split">` : ''}</div></div>`;
    }).join('');
    const rivals = Object.entries(c.rivals).filter(([, r]) => r.met > 0).map(([n, r]) => `${esc(n)} ×${r.met}${r.lastWinner ? (r.lastWinner === c.name ? ' (won last)' : ' (lost last: vengeance!)') : ''}`).join(', ');
    let actions = '';
    if (mine && this.canPlan) {
      const here = st.regions[pos];
      const relic = here.relic === 'unclaimed';
      const mates = st.fleets.filter(x => x.owner === f.owner && x.id !== f.id && x.region === f.region);
      actions = `<div class="actions">
        <button data-a="move" title="${esc(ORDER_INFO.move.help)}">➤ Move <span class="kbd">M</span></button>
        <button data-a="seize" title="${esc(ORDER_INFO.seize.help)}">⚔ Seize <span class="kbd">S</span></button>
        <button data-a="fortify" title="${esc(ORDER_INFO.fortify.help)}">⛨ Fortify <span class="kbd">F</span></button>
        ${relic ? `<button data-a="excavate" title="${esc(ORDER_INFO.excavate.help)}">✧ Excavate</button>` : ''}
      </div>
      <h3>Doctrine (free, standing orders)</h3>
      <div class="doctrine">
        <span>Stance</span><select data-doc="stance">${(['aggressive', 'defensive', 'evasive'] as const).map(x => `<option ${d.stance === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
        <span>Retreat at</span><span class="row"><input type="range" min="0" max="0.9" step="0.05" value="${d.retreatAt}" data-doc="retreatAt" class="grow"><span>${Math.round(d.retreatAt * 100)}%</span></span>
        <span>Target</span><select data-doc="target">${(['weakest', 'strongest', 'cheapest', 'garrison'] as const).map(x => `<option ${d.target === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
        <span>Guard</span><label class="row"><input type="checkbox" data-doc="guard" ${d.guard ? 'checked' : ''}> reinforce adjacent regions you own when invaded</label>
      </div>
      <div class="faint" style="font-size:12px">Aggressive: attacks anything hostile it meets. Defensive: fights when attacked or at home. Evasive: avoids fights and slips away (taking a parting volley).</div>
      <div class="actions">${mates.length ? `<select data-mergeinto>${mates.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select><button data-a="merge">Merge into</button>` : ''}
        ${f.ships.length > 1 ? `<button data-a="split" title="Split the checked ships into a new fleet (free)">Split checked</button>` : ''}</div>`;
    }
    return `<div class="sel"><div class="row"><h2 class="grow" style="color:${this.color(f.owner)}">${esc(f.name)}</h2><button class="small" data-close>✕</button></div>
      <div class="dim" style="font-size:13px">${esc(this.pname(f.owner))} · at ${esc(st.regions[f.region].name)}${pos !== f.region ? ` → <b>${esc(st.regions[pos].name)}</b> (planned)` : ''} · speed ${fleetSpeed(st, f)} · power ${fleetPower(st, f)}${f.fortified ? ' · fortified' : ''}${f.fatigued ? ' · <span class="bad">fatigued</span>' : ''}</div>
      ${mine ? `<input data-rename value="${esc(f.name)}" style="width:100%;margin-top:6px" title="Rename (free)">` : ''}
      <h3>Commander</h3>
      <div><b>${esc(c.name)}</b> <span class="faint">rank ${c.rank} · ${c.xp} xp · ${c.deeds.wins}W/${c.deeds.losses}L · ${c.deeds.kills} kills</span></div>
      <div>${c.traits.map(t => `<span class="trait" title="${esc(TRAITS[t]?.desc ?? '')}">${esc(TRAITS[t]?.name ?? t)}</span>`).join('') || '<span class="faint" style="font-size:12px">No reputation yet. Traits are earned through deeds.</span>'}</div>
      ${rivals ? `<div style="font-size:12px;margin-top:3px"><span class="faint">Rivals:</span> ${rivals}</div>` : ''}
      <h3>Ships (${f.ships.length})</h3>${ships}
      ${actions}
      ${f.history.length ? `<h3>Record</h3><div class="history scroll">${f.history.slice().reverse().map(x => esc(x)).join('<br>')}</div>` : ''}</div>`;
  }

  doctrineChanged() {
    if (this.sel?.kind !== 'fleet') return;
    const L = this.el.left;
    const v = (k: string) => L.querySelector<HTMLInputElement>(`[data-doc="${k}"]`)!;
    const d: Doctrine = { stance: v('stance').value as Doctrine['stance'], retreatAt: Number(v('retreatAt').value), target: v('target').value as Doctrine['target'], guard: v('guard').checked };
    const id = this.sel.id;
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
      const f = this.fleet(sel.id)!;
      switch (a) {
        case 'move': this.mode = { type: 'move', fleet: f.id, overdrive: false }; break;
        case 'seize': this.mode = { type: 'seize', fleet: f.id }; break;
        case 'fortify': this.addOrder({ type: 'fortify', fleet: f.id }); break;
        case 'excavate': this.addOrder({ type: 'excavate', fleet: f.id }); break;
        case 'merge': {
          const into = Number(this.el.left.querySelector<HTMLSelectElement>('[data-mergeinto]')!.value);
          this.plan.free.push({ type: 'merge', fleet: f.id, into }); this.savePlan(); toast('Merge queued (applies at the start of resolution, before pulse I). Order the merged fleet, not this one.'); break;
        }
        case 'split': {
          const ids = [...this.el.left.querySelectorAll<HTMLInputElement>('[data-split]:checked')].map(x => Number(x.dataset.split));
          if (!ids.length || ids.length === f.ships.length) { toast('Check some (not all) ships first.'); return; }
          this.plan.free.push({ type: 'split', fleet: f.id, ships: ids }); this.savePlan(); toast('Split queued: the new squadron appears when the turn resolves and can be ordered next turn.'); break;
        }
      }
    } else {
      const r = this.st.regions[sel.id];
      switch (a) {
        case 'build': {
          const cls = data.cls!;
          const join = this.st.fleets.find(x => x.owner === this.you && x.region === r.id && x.ships.length < this.st.rules.maxShipsPerFleet && x.owner >= 0);
          this.addOrder({ type: 'build', region: r.id, cls, fleet: join ? join.id : null });
          break;
        }
        case 'develop': this.addOrder({ type: 'develop', region: r.id, project: data.proj! }); break;
        case 'influence': this.addOrder({ type: 'influence', target: r.id }); break;
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
    if (this.replay) {
      const R = this.replay;
      this.el.rcontrols.innerHTML = `<button class="small" data-r="pause">${R.playing ? '❚❚' : '▶'}</button><button class="small" data-r="speed">${R.speed}×</button><button class="small" data-r="skip">Skip ⏭</button>`;
      this.el.rcontrols.querySelectorAll<HTMLElement>('[data-r]').forEach(b => b.addEventListener('click', () => {
        if (!this.replay) return;
        if (b.dataset.r === 'pause') { this.replay.playing = !this.replay.playing; this.replay.t0 = performance.now() - (this.replay.applied ? 0 : 0); }
        if (b.dataset.r === 'speed') this.replay.speed = this.replay.speed >= 4 ? 1 : this.replay.speed * 2;
        if (b.dataset.r === 'skip') this.endReplay();
        this.renderBottom();
      }));
    } else {
      this.el.rcontrols.innerHTML = this.src instanceof LocalSource ? `<button class="small" data-x="save" title="Download a save file">💾</button>` : '';
      this.el.rcontrols.querySelector('[data-x="save"]')?.addEventListener('click', () => this.exportSave());
      if (!this.el.ticker.innerHTML) this.el.ticker.innerHTML = `<span class="faint">Plan your ${this.st.rules.orders.perTurn} orders, then seal them. Everyone's orders resolve together.</span>`;
    }
  }

  // ================================================================== replay
  startReplay(result: TurnResult) {
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
      } else if (e.k === 'pulse') push(700, e);
      else if (e.k === 'battle' || e.k === 'clash') push(1100, e);
      else if (e.k === 'retreat') push(600, e);
      else if (e.k === 'capture' || e.k === 'excavate' || e.k === 'destroyed') push(650, e);
      else if (e.k === 'build' || e.k === 'project' || e.k === 'betrayal' || e.k === 'pact') push(450, e);
      else if (e.k === 'fail' || e.k === 'note' || e.k === 'blocked' || e.k === 'influence' || e.k === 'fortify' || e.k === 'scan') push(e.k === 'fail' ? 500 : 350, e);
    }
    if (!beats.length) return;
    const owners = result.startOwners.slice();
    this.replay = { result, beats, i: -1, t0: 0, playing: true, speed: 1, fleets, owners, startLayout: new Map(), endLayout: new Map(), moving: new Set(), pulse: 0, applied: true };
    this.sel = null; this.mode = null;
    this.nextBeat();
    this.renderAll();
    void st;
  }

  nextBeat() {
    const R = this.replay!;
    R.i++;
    if (R.i >= R.beats.length) { this.endReplay(); return; }
    const beat = R.beats[R.i];
    R.t0 = performance.now();
    R.applied = false;
    R.moving.clear();
    const st = this.st;
    const live = () => [...R.fleets.values()].filter(f => f.alpha > 0);
    R.startLayout = regionLayout(st, live().map(f => ({ id: f.id, region: f.region })), this.map.px(1));
    const now = performance.now();
    const text: string[] = [];
    for (const e of beat.events) {
      text.push(eventText(st, e, this.you));
      switch (e.k) {
        case 'pulse': R.pulse = e.pulse; this.banner(`PULSE ${roman(e.pulse)}`); break;
        case 'move': {
          let f = R.fleets.get(e.fleet);
          if (!f) { f = { id: e.fleet, owner: e.owner, ships: e.ships, region: e.from, alpha: 1, name: this.fleet(e.fleet)?.name ?? 'fleet' }; R.fleets.set(e.fleet, f); R.startLayout.set(f.id, st.regions[e.from].site); }
          f.region = e.to; R.moving.add(e.fleet);
          break;
        }
        case 'retreat': { const f = R.fleets.get(e.fleet); if (f) { f.region = e.to; R.moving.add(e.fleet); } break; }
        case 'battle': this.fx.push({ kind: 'battle', pos: st.regions[e.region].site, color: '#ffb36b', t0: now, dur: 1100 * 1.3, text: e.name }); break;
        case 'clash': {
          const a = st.regions[e.a].site, b = st.regions[e.b].site;
          this.fx.push({ kind: 'clash', pos: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, color: '#ff6b6b', t0: now, dur: 1200, text: 'CLASH!' });
          break;
        }
        case 'destroyed': { const f = R.fleets.get(e.fleet); if (f) f.alpha = 0; this.fx.push({ kind: 'text', pos: st.regions[e.region].site, color: '#ff5d7a', t0: now, dur: 1400, text: `${e.name} destroyed` }); break; }
        case 'capture': R.owners[e.region] = e.by; this.fx.push({ kind: 'capture', pos: st.regions[e.region].site, color: this.color(e.by), t0: now, dur: 1000, text: e.how === 'influence' ? 'DEFECTS' : 'CAPTURED' }); break;
        case 'build': {
          const f = R.fleets.get(e.fleet);
          if (f) f.ships++; else R.fleets.set(e.fleet, { id: e.fleet, owner: e.owner, ships: 1, region: e.region, alpha: 1, name: this.fleet(e.fleet)?.name ?? 'new squadron' });
          this.fx.push({ kind: 'build', pos: st.regions[e.region].site, color: this.color(e.owner), t0: now, dur: 700 });
          break;
        }
        case 'excavate': this.fx.push({ kind: 'excavate', pos: st.regions[e.region].site, color: '#7ff7ff', t0: now, dur: 1200, text: 'RELIC FOUND' }); break;
        case 'betrayal': this.banner('BETRAYAL'); break;
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
    this.el.ticker.innerHTML = text.filter(Boolean).slice(0, 3).join(' · ') || this.el.ticker.innerHTML;
    this.el.ticker.querySelectorAll<HTMLElement>('[data-battle]').forEach(x => x.addEventListener('click', () => this.openBattle(Number(x.dataset.battle))));
    this.renderBottom();
  }

  endReplay() {
    if (!this.replay) return;
    const res = this.replay.result;
    this.replay = null;
    this.fx = [];
    if (this.previewing) { this.previewing = false; this.el.ticker.innerHTML = '<span class="faint">Preview finished. Your plan is unchanged.</span>'; this.renderAll(); return; }
    const n = res.battles.length;
    this.el.ticker.innerHTML = `<b>Turn ${res.turn} resolved.</b> ${n ? `${n} battle${n > 1 ? 's' : ''}. <a href="#" data-tabch>See the Chronicle</a> to watch them.` : 'No battles.'} ${res.signals.length ? `${res.signals.length} intel signals.` : ''}`;
    this.el.ticker.querySelector('[data-tabch]')?.addEventListener('click', e => { e.preventDefault(); this.tab = 'chronicle'; this.renderTabs(); this.renderTab(); });
    if (n && this.tab === 'orders') { this.tab = 'chronicle'; }
    this.renderAll();
  }

  banner(t: string) {
    const b = this.el.banner;
    b.textContent = t; b.classList.add('show');
    clearTimeout((b as any)._t);
    (b as any)._t = setTimeout(() => b.classList.remove('show'), 650);
  }

  openBattle(id: number) {
    const rep = (this.previewing ? undefined : this.st.last?.battles.find(b => b.id === id)) ?? this.replay?.result.battles.find(b => b.id === id);
    if (!rep) { toast('Battle report not available.'); return; }
    if (this.replay) this.replay.playing = false;
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
    if (this.replay) {
      const R = this.replay;
      const beat = R.beats[R.i];
      if (R.playing && beat) {
        const t = (now - R.t0) * R.speed / beat.dur;
        if (t >= 1) this.nextBeat();
      } else if (!R.playing) R.t0 = now - ((now - R.t0) % 1e9) * 0; // frozen
      if (this.replay) {
        const beat2 = this.replay.beats[this.replay.i];
        const t = Math.min(1, ((now - this.replay.t0) * this.replay.speed) / (beat2?.dur ?? 1));
        const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        owners = this.replay.owners;
        for (const f of this.replay.fleets.values()) {
          if (f.alpha <= 0 && !this.replay.moving.has(f.id)) continue;
          const a = this.replay.startLayout.get(f.id) ?? st.regions[f.region].site;
          const b = this.replay.endLayout.get(f.id) ?? st.regions[f.region].site;
          const moving = this.replay.moving.has(f.id);
          const pos = moving ? { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e } : b;
          fleets.push({ id: f.id, owner: f.owner, ships: f.ships, pos, alpha: f.alpha, name: f.name });
        }
      }
    } else {
      const lay = regionLayout(st, st.fleets, this.map.px(1));
      fleets = st.fleets.map(f => ({ id: f.id, owner: f.owner, ships: f.ships.length, pos: lay.get(f.id)!, alpha: 1, name: f.name, fortified: f.fortified, selected: this.sel?.kind === 'fleet' && this.sel.id === f.id }));
    }
    // highlights for modes
    const highlight = new Map<number, string>();
    let pathPreview: { pts: Pt[]; ok: boolean } | null = null;
    if (this.mode && !this.replay && this.you !== null) {
      const k = this.nextSlot() ?? 0;
      if (this.mode.type === 'move' || this.mode.type === 'seize') {
        const f = this.fleet(this.mode.fleet);
        if (f) {
          const from = this.projected(k).get(f.id) ?? f.region;
          if (this.mode.type === 'seize') {
            for (const n of [from, ...st.regions[from].neighbors]) if (st.regions[n].owner !== this.you) highlight.set(n, '#ff5d7a');
          } else {
            const sp = fleetSpeed(st, f) + (this.mode.overdrive ? st.rules.overdrive.speedBonus : 0);
            for (const r of st.regions) { const p = findPath(st, from, r.id); if (p && p.length && p.length <= sp) highlight.set(r.id, '#6dffb0'); }
            if (this.hoverRegion !== null && this.hoverRegion !== from) {
              const p = findPath(st, from, this.hoverRegion);
              if (p) pathPreview = { pts: [from, ...p].map(x => st.regions[x].site), ok: p.length <= sp };
            }
          }
        }
      } else if (this.mode.type === 'target') {
        for (const r of st.regions) if (!validateOrder(st, this.you, { type: this.mode.order, target: r.id } as Order)) highlight.set(r.id, '#b78bff');
      }
    }
    // planned order arrows
    const plannedArrows: { from: Pt; to: Pt; label: string; color: string; dashed?: boolean; kind: Order['type'] }[] = [];
    if (!this.replay && this.you !== null) {
      this.plan.orders.forEach((o, i) => {
        if (!o) return;
        const pos = this.projected(i);
        const col = this.color(this.you);
        if (o.type === 'move') {
          let from = pos.get(o.fleet);
          if (from === undefined) return;
          for (const r of o.path) { plannedArrows.push({ from: st.regions[from].site, to: st.regions[r].site, label: r === o.path[o.path.length - 1] ? roman(i + 1) : '', color: col, kind: 'move' }); from = r; }
        } else if (o.type === 'seize') {
          const from = pos.get(o.fleet);
          if (from === undefined) return;
          if (from !== o.target) plannedArrows.push({ from: st.regions[from].site, to: st.regions[o.target].site, label: roman(i + 1), color: '#ff5d7a', kind: 'seize' });
        }
      });
    }
    this.map.draw({
      state: st, you: this.you, visible: new Set(this.src.view.visible), owners, fleets,
      selectedRegion: this.sel?.kind === 'region' ? this.sel.id : null, hoverRegion: this.hoverRegion,
      highlight, plannedArrows, pathPreview,
      signals: this.replay ? [] : this.st.last?.signals ?? [], showSignals: this.showSignals,
      fx: this.fx, now,
    });
    this.fx = this.fx.filter(f => now - f.t0 < f.dur);
    // mode hint
    const hint = this.el.modehint;
    if (this.mode) {
      hint.classList.remove('hidden');
      hint.textContent = this.mode.type === 'move' ? `Click a destination for pulse ${roman((this.nextSlot() ?? 0) + 1)}. Hold Shift for Overdrive (+1 range, fatigue). Esc to cancel.`
        : this.mode.type === 'seize' ? `Click a region to seize (adjacent or current). Esc to cancel.`
        : `Click a target region for ${this.mode.order}. Esc to cancel.`;
    } else hint.classList.add('hidden');
  }

  // ================================================================== input
  onResize = () => { this.map.resize(); };
  onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
    if (document.querySelector('.bv-overlay, .overlay')) return;
    if (e.key === 'Escape') { if (this.mode) this.mode = null; else if (this.targetSlot !== null) this.targetSlot = null; else this.sel = null; this.renderAll(); }
    if (e.key === ' ' && this.replay) { this.replay.playing = !this.replay.playing; this.renderBottom(); e.preventDefault(); }
    if (e.key === 'Enter' && e.ctrlKey) this.submit();
    if (/^[1-9]$/.test(e.key)) { const i = Number(e.key) - 1; if (i < this.plan.orders.length) { this.targetSlot = this.targetSlot === i ? null : i; this.renderTab(); } }
    if (this.sel?.kind === 'fleet' && this.fleet(this.sel.id)?.owner === this.you) {
      if (e.key === 'm') this.action('move', {});
      if (e.key === 's') this.action('seize', {});
      if (e.key === 'f') this.action('fortify', {});
    }
    if (e.key === 'i') { this.showSignals = !this.showSignals; }
    if (e.key === 'p') this.toolbar('panel');
    if (e.key === 'h' || e.key === '?') this.toolbar('help');
    if (e.key === 'r') this.toolbar('replay');
    if (e.key === 'Shift' && this.mode?.type === 'move') this.mode.overdrive = true;
  };

  bindInput() {
    const c = this.el.canvas;
    window.addEventListener('keyup', e => { if (e.key === 'Shift' && this.mode?.type === 'move') this.mode.overdrive = false; });
    c.addEventListener('pointerdown', e => {
      c.setPointerCapture(e.pointerId);
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
        this.map.cam.z = clampZ(this.pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / this.pinch.d);
        return;
      }
      if (this.drag) {
        const dx = e.offsetX - this.drag.x, dy = e.offsetY - this.drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) this.drag.moved = true;
        if (this.drag.moved) { this.map.cam.x = this.drag.cx - dx / this.map.cam.z; this.map.cam.y = this.drag.cy - dy / this.map.cam.z; }
      }
      this.hoverRegion = this.map.regionAt(this.st, e.offsetX, e.offsetY);
      if (this.mode?.type === 'move') this.mode.overdrive = e.shiftKey;
      this.tooltip(e);
    });
    const up = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      const d = this.drag;
      this.drag = null;
      if (d && !d.moved && e.type === 'pointerup') this.click(e.offsetX, e.offsetY, e.shiftKey);
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', () => { this.el.tooltip.classList.add('hidden'); });
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
    const lay = regionLayout(this.st, this.st.fleets, this.map.px(1));
    return this.st.fleets.map(f => ({ id: f.id, owner: f.owner, ships: f.ships.length, pos: lay.get(f.id)!, alpha: 1, name: f.name }));
  }

  click(x: number, y: number, shift: boolean) {
    if (this.replay) return;
    const rid = this.map.regionAt(this.st, x, y);
    if (this.mode && rid !== null) {
      const m = this.mode;
      if (m.type === 'move') {
        const f = this.fleet(m.fleet)!;
        const from = this.projected(this.nextSlot() ?? 0).get(f.id) ?? f.region;
        const path = findPath(this.st, from, rid);
        if (!path || !path.length) { toast('No route.'); return; }
        const sp = fleetSpeed(this.st, f);
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

  select(s: { kind: 'region' | 'fleet'; id: number }) { this.sel = s; this.mode = null; this.renderLeft(); }
  focus(p: Pt) { this.map.cam.x = p.x; this.map.cam.y = p.y; }

  tooltip(e: PointerEvent) {
    const t = this.el.tooltip;
    const f = this.map.fleetAt(this.currentFleetDraws(), e.offsetX, e.offsetY);
    let html = '';
    if (f) {
      const fl = this.fleet(f.id);
      if (fl) html = `<b style="color:${this.color(fl.owner)}">${esc(fl.name)}</b><br>${esc(this.pname(fl.owner))} · ${fl.ships.length} ships · power ${fleetPower(this.st, fl)}<br><span class="dim">${esc(fl.commander.name)}${fl.commander.traits.length ? ' · ' + fl.commander.traits.map(x => TRAITS[x]?.name ?? x).join(', ') : ''}</span>`;
    } else if (this.hoverRegion !== null) {
      const r = this.st.regions[this.hoverRegion];
      html = `<b style="color:${this.color(r.owner)}">${esc(r.name)}</b> <span class="dim">${r.kind}${r.feature !== 'none' ? ' · ' + r.feature : ''}</span><br>${esc(this.pname(r.owner))} · garrison ${r.garrison < 0 ? '?' : r.garrison}`;
      if (this.mode?.type === 'move') {
        const fl = this.fleet(this.mode.fleet);
        if (fl) {
          const from = this.projected(this.nextSlot() ?? 0).get(fl.id) ?? fl.region;
          const p = findPath(this.st, from, r.id);
          if (p) html += `<br>${p.length} jump${p.length === 1 ? '' : 's'} (speed ${fleetSpeed(this.st, fl)})${p.length > fleetSpeed(this.st, fl) ? ' <span class="gold">OVERDRIVE</span>' : ''}`;
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
      case 'help': { const o = overlay(`<div class="dialog wide scroll help">${helpHtml(this.st)}<div class="row" style="margin-top:12px"><button class="primary" data-x>Got it</button></div></div>`); o.querySelector('[data-x]')!.addEventListener('click', () => o.remove()); break; }
      case 'menu': this.menu(); break;
    }
  }

  menu() {
    const local = this.src instanceof LocalSource ? this.src : null;
    const link = this.src.kind === 'remote' && this.you !== null ? `${location.origin}${location.pathname}#/g/${this.src.meta.id}/${(this.src as any).token}` : '';
    const o = overlay(`<div class="dialog"><h2>Menu</h2><div class="col">
      ${link ? `<div class="dim" style="font-size:13px">Your private seat link (open it on another device to keep playing; don't share it):</div><input value="${esc(link)}" readonly onclick="this.select()">
      <div class="dim" style="font-size:13px">Invite link for others: <input value="${esc(location.origin + location.pathname + '#/g/' + this.src.meta.id)}" readonly onclick="this.select()"></div>` : ''}
      <div class="row"><span class="dim">Replay turn</span><input type="number" min="1" max="${this.st.turn - 1}" value="${Math.max(1, this.st.turn - 1)}" data-rt style="width:80px"><button data-x="replayturn">▶</button></div>
      ${local ? `<button data-x="save">💾 Download save file</button><label class="row"><input type="checkbox" data-x="reveal" ${local.save.reveal ? 'checked' : ''}> Reveal the whole map (dev / spectate)</label>` : ''}
      <button data-x="exit">⏏ Back to lobby</button><button data-x="close">Close</button></div></div>`);
    o.querySelectorAll<HTMLElement>('[data-x]').forEach(b => b.addEventListener(b.tagName === 'INPUT' ? 'change' : 'click', () => {
      const x = b.dataset.x;
      if (x === 'exit') { o.remove(); this.onExit(); }
      if (x === 'close') o.remove();
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
    const o = overlay(`<div class="dialog" data-victory style="text-align:center"><h1 style="color:${w.color};font-size:30px">${esc(w.name)}</h1><h2>${w.id === this.you ? 'Victory' : 'has won'}</h2>
      <p class="dim">${esc(st.winReason)}</p>${ranks.map(p => `<div style="color:${p.color}">${esc(p.name)}: ${p.vp} VP</div>`).join('')}
      <p class="dim" style="margin-top:12px">The whole map is now revealed. Browse the Chronicle to relive it.</p><div class="row" style="justify-content:center"><button data-x>Look around</button><button class="primary" data-l>Lobby</button></div></div>`);
    o.querySelector('[data-x]')!.addEventListener('click', () => o.remove());
    o.querySelector('[data-l]')!.addEventListener('click', () => { o.remove(); this.onExit(); });
  }
}

// ---------------------------------------------------------------- helpers
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
    case 'blocked': return `${pn(e.owner)} ${fn(e.fleet)} stopped at ${rn(e.at)} (${e.reason})`;
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
  }
}

export { EDICTS };
