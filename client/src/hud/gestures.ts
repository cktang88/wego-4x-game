// Pointer input on the board (docs/UX-V2.md §3): drag a fleet token onto a region and the target picks the
// verb, with a live preview card at the arrow head; tap-then-tap and hover previews for the same orders;
// right-click / long-press opens the context ring; empty-space drags pan, two fingers pinch (and cancel a drag).
// Phone drags put a ghost 48px above the finger, show a 2x loupe and auto-pan at the screen edges.
import type { GameScreen } from '../game.ts';
import type { Order, Pt } from '../../../shared/sim/types.ts';
import { MAX_JOINERS, orderCost, costText } from '../../../shared/sim/orders.ts';
import { blueprintFor } from '../../../shared/sim/empire.ts';
import { esc } from '../ui/dom.ts';
import { intentFor, targetMap, commitIntent, isLane, VERB_COLOR, type DragSrc, type Intent } from './verbs.ts';
import { cardAction } from './card.ts';
import { offerCharge } from './signature.ts';
import { shortWhy } from './util.ts';

interface Press { id: number; x: number; y: number; touch: boolean; fleet: number | null; moved: boolean; pan: { cx: number; cy: number } | null; lp: number; longed: boolean }
interface Drag { src: DragSrc; id: number; touch: boolean; x: number; y: number; rid: number | null; over: number | null; key: string; intent: Intent | null; ship: boolean }
interface RingItem { a: string; icon: string; label: string; pos: number; region: number | null; sub: string }
interface Ring { x: number; y: number; target: { kind: 'fleet' | 'region'; id: number }; items: RingItem[]; hover: string | null; held: number | null }

const GHOST = 48;              // phone: the drop point rides this far above the finger
const LONG = 350;              // long-press → context ring
const clampZ = (z: number) => Math.max(0.12, Math.min(3, z));

export class Gestures {
  private pointers = new Map<number, { x: number; y: number }>();
  private press: Press | null = null;
  private pinch: { d: number; z: number } | null = null;
  private drag: Drag | null = null;
  private ring: Ring | null = null;
  private hover: { rid: number; key: string; intent: Intent | null } | null = null;
  private hoverXY: { x: number; y: number } | null = null;
  private memo: { key: string; map: Map<number, string> } = { key: '', map: new Map() };
  private peekHold = false;
  private c: HTMLCanvasElement;

  constructor(private g: GameScreen) {
    const c = this.c = g.el.canvas as HTMLCanvasElement;
    c.addEventListener('pointerdown', this.down);
    c.addEventListener('pointermove', this.move);
    c.addEventListener('pointerup', this.up);
    c.addEventListener('pointercancel', this.up);
    c.addEventListener('pointerleave', () => { if (!this.press && !this.drag) { this.g.hoverRegion = null; this.hover = null; this.hoverXY = null; this.g.hoverSlot = null; this.hidePreview(); } });
    c.addEventListener('wheel', this.wheel, { passive: false });
    c.addEventListener('contextmenu', this.context);
    window.addEventListener('pointermove', this.winMove);
    window.addEventListener('pointerup', this.winUp);
    window.addEventListener('pointercancel', this.winUp);
    const ring = g.hud.h.ring;
    ring.addEventListener('click', e => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-ring]'); if (b) this.ringCommit(b.dataset.ring!); else if (e.target === ring) this.closeRing(); });
    ring.addEventListener('pointerover', e => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-ring]'); this.ringHover(b?.dataset.ring ?? null); });
  }
  destroy() {
    window.removeEventListener('pointermove', this.winMove);
    window.removeEventListener('pointerup', this.winUp);
    window.removeEventListener('pointercancel', this.winUp);
  }

  // ------------------------------------------------------------------ state for the frame
  get busy(): boolean { return !!this.drag || !!this.pinch || !!this.press?.moved; }
  isDragging(): boolean { return !!this.drag; }
  /** The fleet being dragged whole (its token dims), or null. */
  dragFleet(): number | null { return this.drag && !this.drag.src.ships ? this.drag.src.fleet : null; }
  /** What the arrow currently says: the drag's intent, else the hover preview of the selected fleet. */
  active(): { intent: Intent | null; src: DragSrc; blink: boolean } | null {
    if (this.drag) return { intent: this.drag.intent, src: this.drag.src, blink: false };
    const s = this.selFleet();
    if (s !== null && this.hover) return { intent: this.hover.intent, src: { fleet: s }, blink: true };
    return null;
  }
  /** Your selected fleet, when you could order it. */
  private selFleet(): number | null {
    const g = this.g;
    if (g.sel?.kind !== 'fleet' || !g.canPlan || g.blockingReplay) return null;
    const f = g.fleet(g.sel.id);
    return f && f.owner === g.you ? f.id : null;
  }
  /** Regions to light up: valid drops for the dragged (or selected) fleet. */
  targets(): Map<number, string> {
    const g = this.g;
    const src: DragSrc | null = this.drag ? this.drag.src : this.selFleet() !== null ? { fleet: this.selFleet()!, ships: liftedOf(g) } : null;
    if (!src) return new Map();
    const force = g.mode && g.mode.fleet === src.fleet ? g.mode.type : null;
    const key = `${g.objKey(g.st)}|${g.planVersion}|${g.queue.length}|${g.bank}|${src.fleet}|${src.ships?.join(',') ?? ''}|${force}`;
    if (this.memo.key !== key) this.memo = { key, map: targetMap(g, src, force) };
    return new Map(this.memo.map);
  }
  /** Seize joiners: your fleets that could still join the seize being shown. */
  tethers(): { from: Pt; to: Pt }[] {
    const g = this.g, st = g.st;
    let target: number | null = null, slot = -1, src = -1;
    const a = this.active();
    if (a?.intent?.ok && a.intent.verb === 'seize') { target = a.intent.to; src = a.src.fleet; }
    else if (g.sel?.kind === 'fleet') {
      slot = g.plan.orders.findIndex(o => o?.type === 'seize' && (o.fleet === g.sel!.id || o.also?.includes(g.sel!.id)));
      const o = g.plan.orders[slot];
      if (o?.type === 'seize') { target = o.target; src = o.fleet; }
    }
    if (target === null || !st.regions[target]) return [];
    const o = slot >= 0 ? g.plan.orders[slot] as Extract<Order, { type: 'seize' }> : null;
    if (o && new Set(o.also ?? []).size >= MAX_JOINERS) return [];
    const T = st.regions[target];
    return st.fleets.filter(f => f.owner === g.you && f.id !== src && f.ships.length && !o?.also?.includes(f.id) && (T.neighbors.includes(f.region) || f.region === target) && g.fleetUses(f.id) < st.rules.orders.maxPerFleet && !g.plan.orders.some(x => x && (x.type === 'move' || x.type === 'seize') && x.fleet === f.id))
      .slice(0, 4).map(f => ({ from: g.lastFleetPos.get(f.id) ?? st.regions[f.region].site, to: T.site }));
  }
  ringHighlight(): number | null {
    const r = this.ring;
    if (!r?.hover) return null;
    return r.items.find(i => i.a === r.hover)?.region ?? null;
  }
  /** DrawInput.drag for the renderer (docs/UX-V2.md §8). */
  drawDrag(now: number): unknown {
    const g = this.g, st = g.st;
    const a = this.active();
    if (!a) return null;
    const f = g.fleet(a.src.fleet);
    if (!f) return null;
    const it = a.intent;
    const from = g.lastFleetPos.get(f.id) ?? st.regions[f.region].site;
    let to: Pt;
    if (it && st.regions[it.to] && (it.ok || !this.drag)) to = st.regions[it.to].site;
    else if (this.drag) to = g.map.toWorld(this.drag.x, this.drag.y);
    else return null;
    const path = it ? [from, ...it.path.filter(r => st.regions[r]).map(r => st.regions[r].site)] : [from, to];
    if (path.length < 2) path.push(to);
    const ok = !!it?.ok;
    return {
      from, to, path, ok, verb: it?.verb === 'overdrive' ? 'od' : it?.ok ? it.verb : 'invalid', color: it?.color ?? VERB_COLOR.invalid,
      blink: a.blink, dashed: !ok || a.blink, t: now, ghost: this.drag ? g.map.toWorld(this.drag.x, this.drag.y) : null,
      ships: a.src.ships?.length ?? f.ships.length, owner: f.owner, label: it ? `${it.icon} ${it.text}` : '',
    };
  }

  // ------------------------------------------------------------------ pointer events (canvas)
  private xy(e: { clientX: number; clientY: number }) { const r = this.c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  private down = (e: PointerEvent) => {
    const g = this.g;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try { this.c.setPointerCapture(e.pointerId); } catch { /* */ }
    const { x, y } = this.xy(e);
    this.pointers.set(e.pointerId, { x, y });
    if (this.ring && !this.ring.held) this.closeRing();
    if (this.pointers.size === 2) {
      // a second finger: cancel any drag (spring back) and pinch instead
      if (this.drag) this.endDrag(false);
      if (this.press) clearTimeout(this.press.lp);
      this.press = null;
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: g.map.cam.z };
      return;
    }
    if (this.pointers.size > 2) return;
    const touch = e.pointerType !== 'mouse';
    let fleet: number | null = null;
    if (g.canPlan && !g.blockingReplay) {
      const tok = g.tokenHit(x, y);
      if (tok && tok.owner === g.you) fleet = pickFleet(g, tok.fleetIds);
    }
    const p: Press = { id: e.pointerId, x, y, touch, fleet, moved: false, pan: null, lp: 0, longed: false };
    p.lp = window.setTimeout(() => this.longPress(p), LONG);
    this.press = p;
  };
  private move = (e: PointerEvent) => {
    const g = this.g;
    const { x, y } = this.xy(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x, y });
    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const before = g.map.toWorld(mx, my);
      g.map.cam.z = clampZ(this.pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, this.pinch.d));
      const after = g.map.toWorld(mx, my);
      g.map.cam.x += before.x - after.x; g.map.cam.y += before.y - after.y;
      return;
    }
    if (this.drag && !this.drag.ship && e.pointerId === this.drag.id) { this.dragTo(x, y); return; }
    const p = this.press;
    if (p && e.pointerId === p.id) {
      const th = p.touch ? 10 : 6;
      if (!p.moved && Math.hypot(x - p.x, y - p.y) > th) {
        p.moved = true;
        clearTimeout(p.lp);
        if (this.ring?.held === p.id) { this.ringPointer(e.clientX, e.clientY); return; }
        if (p.longed) return;
        if (p.fleet !== null) { this.startDrag({ fleet: p.fleet, ships: g.sel?.kind === 'fleet' && g.sel.id === p.fleet ? liftedOf(g) : undefined }, p.id, p.touch, x, y, false); this.press = null; return; }
        p.pan = { cx: g.map.cam.x, cy: g.map.cam.y };
      }
      if (this.ring?.held === p.id) { this.ringPointer(e.clientX, e.clientY); return; }
      if (p.pan) { g.map.cam.x = p.pan.cx - (x - p.x) / g.map.cam.z; g.map.cam.y = p.pan.cy - (y - p.y) / g.map.cam.z; }
      return;
    }
    if (e.pointerType !== 'mouse' || this.pointers.size) return;
    // hover: the selected fleet previews what a click here would do (blinking dashed arrow + card)
    this.hoverXY = { x, y };
    const rid = g.map.regionAt(g.st, x, y);
    g.hoverRegion = rid;
    const slot = rid === null ? -1 : g.plan.orders.findIndex(o => !!o && orderTargets(o, rid));
    if ((slot >= 0 ? slot : null) !== g.hoverSlot && !g.live) { g.hoverSlot = slot >= 0 ? slot : null; g.hud.h.strip.querySelectorAll('.chip.hot').forEach(c => c.classList.remove('hot')); if (slot >= 0) g.hud.h.strip.querySelector(`[data-slot="${slot}"]`)?.classList.add('hot'); }
    const s = this.selFleet();
    const tok = g.tokenHit(x, y);
    if (s === null || rid === null || (tok && tok.fleetIds.includes(s))) { this.hover = null; this.hidePreview(); this.c.style.cursor = tok ? 'grab' : ''; return; }
    const force = g.mode && g.mode.fleet === s ? g.mode.type : null;
    const key = `${rid}|${g.planVersion}|${force}|${liftedOf(g)?.join(',') ?? ''}`;
    if (this.hover?.key !== key) this.hover = { rid, key, intent: intentFor(g, { fleet: s, ships: liftedOf(g) }, rid, null, force) };
    this.c.style.cursor = this.hover.intent?.ok ? 'pointer' : this.hover.intent ? 'not-allowed' : '';
    if (this.hover.intent) this.showPreview(this.hover.intent, x, y); else this.hidePreview();
  };
  private up = (e: PointerEvent) => {
    const g = this.g;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.drag && !this.drag.ship && e.pointerId === this.drag.id) { this.endDrag(e.type === 'pointerup'); return; }
    const p = this.press;
    if (!p || p.id !== e.pointerId) return;
    clearTimeout(p.lp);
    this.press = null;
    if (this.peekHold) { this.peekHold = false; g.peek = false; return; }
    if (this.ring?.held === p.id) {
      this.ring.held = null;
      const hv = this.ring.hover;
      if (hv && p.moved) this.ringCommit(hv);
      return;
    }
    if (p.longed || p.moved || e.type !== 'pointerup' || this.pointers.size) return;
    this.tap(p.x, p.y);
  };
  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    const g = this.g, { x, y } = this.xy(e);
    const before = g.map.toWorld(x, y);
    g.map.cam.z = clampZ(g.map.cam.z * Math.exp(-e.deltaY * 0.0015));
    const after = g.map.toWorld(x, y);
    g.map.cam.x += before.x - after.x; g.map.cam.y += before.y - after.y;
  };
  private context = (e: MouseEvent) => {
    e.preventDefault();
    const g = this.g;
    if (this.drag) { this.endDrag(false); return; }
    const { x, y } = this.xy(e);
    // with your fleet selected, right-clicking a target commits its default verb
    const s = this.selFleet();
    const rid = g.map.regionAt(g.st, x, y);
    if (s !== null && rid !== null) {
      const force = g.mode && g.mode.fleet === s ? g.mode.type : null;
      const it = intentFor(g, { fleet: s, ships: liftedOf(g) }, rid, null, force);
      if (it?.ok) { this.hover = null; this.hidePreview(); commitIntent(g, it); return; }
    }
    this.openRingAt(x, y, null);
  };

  // ------------------------------------------------------------------ window events (ship-chip drags, ring)
  private winMove = (e: PointerEvent) => {
    if (this.drag?.ship && e.pointerId === this.drag.id) { const { x, y } = this.xy(e); this.dragTo(x, y); }
  };
  private winUp = (e: PointerEvent) => {
    if (this.drag?.ship && e.pointerId === this.drag.id) this.endDrag(e.type === 'pointerup');
  };

  // ------------------------------------------------------------------ taps
  private tap(x: number, y: number) {
    const g = this.g, st = g.st;
    if (g.replay && g.live && !g.replay.preview) g.endReplay();
    if (g.blockingReplay) return;
    if (g.replacing) { g.replacing = null; g.renderAll(); return; }
    const tok = g.tokenHit(x, y);
    const rid = g.map.regionAt(st, x, y);
    const s = this.selFleet();
    // tap-then-tap: with your fleet selected, a lit region commits (unless you tapped one of your own tokens)
    if (s !== null && rid !== null && !(tok && tok.owner === g.you)) {
      const force = g.mode && g.mode.fleet === s ? g.mode.type : null;
      const it = intentFor(g, { fleet: s, ships: liftedOf(g) }, rid, null, force);
      if (it?.ok) { this.hover = null; this.hidePreview(); commitIntent(g, it); return; }
    }
    if (tok) {
      const own = tok.owner === g.you;
      const ids = tok.fleetIds;
      let id = own ? pickFleet(g, ids) : ids[0];
      // tapping the selected stack again cycles through its fleets
      if (g.sel?.kind === 'fleet' && ids.includes(g.sel.id) && ids.length > 1) id = ids[(ids.indexOf(g.sel.id) + 1) % ids.length];
      if (id !== null && id !== undefined) { g.select({ kind: 'fleet', id }); return; }
    }
    if (rid !== null && !isLane(g, rid)) { if (g.sel?.kind === 'region' && g.sel.id === rid) g.deselect(); else g.select({ kind: 'region', id: rid }); }
    else if (g.sel) g.deselect();
  }
  private longPress(p: Press) {
    if (this.press !== p || p.moved || this.drag) return;
    p.longed = true;
    const g = this.g;
    const rid = g.map.regionAt(g.st, p.x, p.y);
    if (rid === null && !g.tokenHit(p.x, p.y)) { this.peekHold = true; g.peek = true; return; }
    this.openRingAt(p.x, p.y, p.id);
    if (navigator.vibrate) try { navigator.vibrate(10); } catch { /* */ }
  }

  // ------------------------------------------------------------------ drags
  /** Start dragging ships out of the selected fleet's card (split / split-move). */
  startShipDrag(fleet: number, ships: number[], e: PointerEvent) {
    const { x, y } = this.xy(e);
    const f = this.g.fleet(fleet);
    if (!f) return;
    const sub = ships.filter(id => f.ships.some(s => s.id === id));
    this.startDrag({ fleet, ships: sub.length && sub.length < f.ships.length ? sub : undefined }, e.pointerId, e.pointerType !== 'mouse', x, y, true);
    // on a phone the card would cover the board: tuck it away while dragging
    this.g.root.classList.add('ship-drag');
  }
  private startDrag(src: DragSrc, id: number, touch: boolean, x: number, y: number, ship: boolean) {
    const g = this.g;
    if (g.sel?.kind !== 'fleet' || g.sel.id !== src.fleet) { g.sel = { kind: 'fleet', id: src.fleet }; g.lifted.clear(); }
    this.closeRing();
    this.hover = null;
    this.drag = { src, id, touch, x, y, rid: null, over: null, key: '', intent: null, ship };
    g.root.classList.add('dragging');
    g.renderAll();
    this.dragTo(x, y);
  }
  private dragTo(x: number, y: number) {
    const d = this.drag!, g = this.g;
    d.x = x; d.y = d.touch ? y - GHOST : y;
    const rid = g.map.regionAt(g.st, d.x, d.y);
    const tok = g.tokenHit(d.x, d.y);
    const f = g.fleet(d.src.fleet);
    const over = tok && f && tok.owner === g.you && tok.region === f.region ? (tok.fleetIds.find(i => i !== f.id) ?? null) : null;
    const force = g.mode && g.mode.fleet === d.src.fleet ? g.mode.type : null;
    const key = `${rid}|${over}|${g.planVersion}|${force}`;
    if (key !== d.key) {
      d.key = key; d.rid = rid; d.over = over;
      d.intent = intentFor(g, d.src, rid, over, force);
      // dragging the arrow head back home takes the fleet's movement order back
      if (!d.intent && rid !== null && f && rid === f.region && movementSlot(g, f.id) !== null) d.intent = { verb: 'invalid', ok: true, icon: '↶', text: 'cancel order', sub: '', color: '#ffd86b', from: f.region, to: rid, path: [], free: undefined };
    }
    g.hoverRegion = rid;
    const ghost = g.hud.h.ghost;
    ghost.classList.remove('hidden');
    ghost.style.transform = `translate(${x - 18}px, ${(d.touch ? y - GHOST : y) - 18}px)`;
    ghost.style.setProperty('--pc', g.color(g.you));
    ghost.textContent = String(d.src.ships?.length ?? f?.ships.length ?? '');
    if (d.intent) this.showPreview(d.intent, d.x, d.y); else this.hidePreview();
  }
  private endDrag(commit: boolean) {
    const d = this.drag, g = this.g;
    if (!d) return;
    this.drag = null;
    g.root.classList.remove('dragging', 'ship-drag');
    g.hud.h.ghost.classList.add('hidden');
    g.hud.h.loupe.classList.add('hidden');
    this.hidePreview();
    g.hoverRegion = null;
    const it = d.intent;
    if (commit && it?.ok) {
      if (it.icon === '↶') { const k = movementSlot(g, d.src.fleet); if (k !== null) g.removeOrder(k); return; }
      if (commitIntent(g, it) && it.verb === 'seize' && !it.full) offerCharge(g, d.src.fleet, it.to);
      return;
    }
    // invalid / nothing: spring back (nothing to undo)
    g.renderAll();
  }

  /** Esc, blur, a replay starting: drop whatever gesture is in progress. Returns whether anything was. */
  cancel(): boolean {
    let any = false;
    if (this.drag) { this.endDrag(false); any = true; }
    if (this.ring) { this.closeRing(); any = true; }
    if (this.press) { clearTimeout(this.press.lp); this.press = null; }
    this.pointers.clear(); this.pinch = null;
    if (this.peekHold) { this.peekHold = false; this.g.peek = false; }
    if (this.hover) { this.hover = null; this.hidePreview(); }
    return any;
  }

  // ------------------------------------------------------------------ per frame
  step(now: number) {
    const d = this.drag, g = this.g;
    void now;
    if (!d) return;
    // edge auto-pan while dragging
    const m = d.touch ? 44 : 28, sp = 9 / g.map.cam.z;
    const W = g.map.w, H = g.map.h;
    let dx = 0, dy = 0;
    if (d.x < m) dx = -sp; else if (d.x > W - m) dx = sp;
    const yy = d.touch ? d.y + GHOST : d.y;
    if (yy < m) dy = -sp; else if (yy > H - m) dy = sp;
    if (dx || dy) { g.map.cam.x += dx; g.map.cam.y += dy; d.key = ''; this.dragTo(d.x, d.touch ? d.y + GHOST : d.y); }
  }
  afterDraw() {
    const g = this.g;
    // keep the preview card on the arrow head as the camera moves
    const a = this.active();
    if (a?.intent && !this.drag && this.hoverXY) this.placePreview(a.intent, this.hoverXY.x, this.hoverXY.y);
    if (this.drag?.intent) this.placePreview(this.drag.intent, this.drag.x, this.drag.y);
    // phone: a 2x loupe of what is under the ghost, away from the finger
    const d = this.drag;
    const L = g.hud.h.loupe;
    if (!d || !d.touch) { L.classList.add('hidden'); return; }
    L.classList.remove('hidden');
    const cv = L.querySelector('canvas')!;
    const ctx = cv.getContext('2d');
    const dpr = g.map.dpr || 1;
    const r = 60; // css px radius sampled → 120 css px shown at 2x in 240 canvas px
    if (ctx) {
      ctx.clearRect(0, 0, cv.width, cv.height);
      try { ctx.drawImage(this.c, (d.x - r) * dpr, (d.y - r) * dpr, 2 * r * dpr, 2 * r * dpr, 0, 0, cv.width, cv.height); } catch { /* */ }
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cv.width / 2 - 10, cv.height / 2); ctx.lineTo(cv.width / 2 + 10, cv.height / 2); ctx.moveTo(cv.width / 2, cv.height / 2 - 10); ctx.lineTo(cv.width / 2, cv.height / 2 + 10); ctx.stroke();
    }
    const left = d.x > g.map.w / 2;
    L.style.left = left ? '12px' : '';
    L.style.right = left ? '' : '12px';
    const name = d.rid !== null ? g.st.regions[d.rid]?.name ?? '' : '';
    const lbl = L.querySelector('.lbl')!;
    const txt = `${esc(name)}${d.intent ? ` · <b style="color:${d.intent.color}">${esc(d.intent.icon)} ${esc(d.intent.text)}</b>` : ''}`;
    if (lbl.innerHTML !== txt) lbl.innerHTML = txt;
  }

  // ------------------------------------------------------------------ preview card
  private showPreview(it: Intent, x: number, y: number) {
    const el = this.g.hud.h.preview;
    const html = `<i>${esc(it.icon)}</i><b>${esc(it.text)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}`;
    if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
    el.className = `dragcard v-${it.verb} ${it.ok ? 'ok' : 'no'}`;
    el.style.setProperty('--vc', it.color);
    this.placePreview(it, x, y);
  }
  private placePreview(it: Intent, x: number, y: number) {
    const g = this.g, el = g.hud.h.preview;
    let px = x, py = y;
    const r = g.st.regions[it.to];
    if (r && it.ok) { const s = g.map.toScreen(r.site); px = s.x; py = s.y; }
    const w = el.offsetWidth || 120, h = el.offsetHeight || 34;
    let left = px + 18, top = py - h - 22;
    if (left + w > g.map.w - 8) left = px - w - 18;
    if (top < 60) top = py + 26;
    el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }
  private hidePreview() { const el = this.g.hud.h.preview; el.className = 'dragcard hidden'; el.dataset.html = ''; }

  // ------------------------------------------------------------------ context ring
  openRingAt(x: number, y: number, held: number | null) {
    const g = this.g, st = g.st;
    if (g.blockingReplay) return;
    const tok = g.tokenHit(x, y);
    const rid = g.map.regionAt(st, x, y);
    let target: Ring['target'] | null = null;
    if (tok && tok.owner === g.you) target = { kind: 'fleet', id: pickFleet(g, tok.fleetIds) ?? tok.fleetIds[0] };
    else if (rid !== null && !isLane(g, rid)) target = { kind: 'region', id: rid };
    else if (tok) target = { kind: 'region', id: tok.region };
    if (!target) return;
    const items = this.ringItems(target);
    if (!items.length) return;
    this.ring = { x, y, target, items, hover: null, held };
    this.renderRing();
  }
  private ringItems(t: Ring['target']): RingItem[] {
    const g = this.g, st = g.st, you = g.you;
    if (you === null || !g.canPlan) return [];
    const out: RingItem[] = [];
    const ok = (o: Order) => !g.orderWhy(o);
    const cost = (o: Order) => costText(orderCost(g.costState(), o, you));
    if (t.kind === 'fleet') {
      const f = g.fleet(t.id);
      if (!f || f.owner !== you) return [];
      const r = st.regions[f.region];
      const add = (a: string, icon: string, label: string, pos: number, o: Order | null, region: number | null = f.region) => { if (!o || ok(o)) out.push({ a, icon, label, pos, region, sub: o ? cost(o) : 'free' }); };
      if (!f.fortified) add('fortify', '⛨', 'Fortify', 0, { type: 'fortify', fleet: f.id });
      add('scan', '◎', 'Scan', 1, { type: 'scan', target: f.region });
      add('feint', '☍', 'Feint', 2, { type: 'feint', target: f.region });
      add('conceal', '☾', 'Conceal', 3, { type: 'conceal' }, null);
      if (f.ships.length > 1 && g.fleetUses(f.id) === 0) add('split', '✂', 'Split', 4, null);
      if (r.owner === you && (r.buildings.shipyard ?? 0) > 0 && f.ships.some(s => s.mod !== blueprintFor(st, you, s.cls) || s.hp < s.maxHp)) add('refit', '⚒', 'Refit', 5, { type: 'refit', fleet: f.id });
      if (r.relic === 'unclaimed') add('excavate', '✧', 'Excavate', 6, { type: 'excavate', fleet: f.id });
      if (r.kind !== 'void') add('influence', '✦', 'Influence', 7, { type: 'influence', target: f.region });
    } else {
      const r = st.regions[t.id];
      if (!r) return [];
      const own = r.owner === you;
      if (own && (r.buildings.shipyard ?? 0) > 0 && !g.orderBlock()) out.push({ a: 'tray:build', icon: '⚒', label: 'Build', pos: 0, region: r.id, sub: '' });
      if (own && !r.project && !g.orderBlock()) out.push({ a: 'tray:develop', icon: '▲', label: 'Develop', pos: 1, region: r.id, sub: '' });
      const add = (a: string, icon: string, label: string, pos: number, o: Order) => { if (ok(o)) out.push({ a, icon, label, pos, region: r.id, sub: cost(o) }); };
      if (r.kind !== 'void') add('influence', '✦', own ? 'Purge' : 'Influence', 2, { type: 'influence', target: r.id });
      add('scan', '◎', 'Scan', 3, { type: 'scan', target: r.id });
      if (!own) add('feint', '☍', 'Feint', 4, { type: 'feint', target: r.id });
      if (r.owner !== null && r.owner >= 0 && !own) add('pact', '⚭', 'Pact', 5, { type: 'pact', with: r.owner });
    }
    return out;
  }
  private renderRing() {
    const R = this.ring, el = this.g.hud.h.ring;
    if (!R) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    const rad = this.g.phone ? 74 : 64;
    const cx = Math.max(rad + 30, Math.min(this.g.map.w - rad - 30, R.x)), cy = Math.max(rad + 30, Math.min(this.g.map.h - rad - 30, R.y));
    const hv = R.items.find(i => i.a === R.hover);
    el.classList.remove('hidden');
    el.style.transform = `translate(${cx}px, ${cy}px)`;
    el.innerHTML = `<div class="rc">${hv ? `<b>${esc(hv.label)}</b><small>${esc(hv.sub)}</small>` : ''}</div>` + R.items.map(i => {
      const a = (i.pos / 8) * Math.PI * 2 - Math.PI / 2;
      return `<button class="ri ${R.hover === i.a ? 'on' : ''}" data-ring="${i.a}" style="transform:translate(${(Math.cos(a) * rad).toFixed(1)}px, ${(Math.sin(a) * rad).toFixed(1)}px)" aria-label="${esc(i.label)}"><i>${i.icon}</i></button>`;
    }).join('');
  }
  private ringHover(a: string | null) { if (this.ring && this.ring.hover !== a) { this.ring.hover = a; this.renderRing(); } }
  private ringPointer(cx: number, cy: number) {
    const el = document.elementFromPoint(cx, cy) as HTMLElement | null;
    this.ringHover(el?.closest<HTMLElement>('[data-ring]')?.dataset.ring ?? null);
  }
  private ringCommit(a: string) {
    const R = this.ring, g = this.g;
    if (!R) return;
    this.closeRing();
    if (a.startsWith('tray:')) {
      g.select({ kind: 'region', id: R.target.id });
      requestAnimationFrame(() => g.hud.h.card.querySelector(`[data-tray="${a.slice(5)}"]`)?.scrollIntoView({ block: 'nearest' }));
      return;
    }
    g.sel = R.target;
    if (R.target.kind === 'fleet' && (a === 'influence')) { g.addOrder({ type: 'influence', target: g.fleet(R.target.id)!.region }); return; }
    cardAction(g, a, {});
  }
  closeRing() { if (this.ring) { this.ring = null; this.renderRing(); } }
}

/** Ships lifted in the selected fleet's fan (a subset), or undefined for the whole fleet. */
function liftedOf(g: GameScreen): number[] | undefined {
  if (g.sel?.kind !== 'fleet' || !g.lifted.size) return undefined;
  const f = g.fleet(g.sel.id);
  if (!f) return undefined;
  const ids = f.ships.filter(s => g.lifted.has(s.id)).map(s => s.id);
  return ids.length && ids.length < f.ships.length ? ids : undefined;
}
/** Which fleet of a stacked token a press means: the selected one, else an idle one, else the first. */
function pickFleet(g: GameScreen, ids: number[]): number | null {
  if (!ids.length) return null;
  if (g.sel?.kind === 'fleet' && ids.includes(g.sel.id)) return g.sel.id;
  const idle = ids.find(id => { const f = g.fleet(id); return f && g.isIdle(f); });
  return idle ?? ids[0];
}
/** The slot (WEGO) or queue index (LIVE) of a fleet's move / seize, or null. */
function movementSlot(g: GameScreen, fleet: number): number | null {
  const list: (Order | null)[] = g.live ? g.queue : g.plan.orders;
  const i = list.findIndex(o => !!o && (o.type === 'move' || o.type === 'seize') && o.fleet === fleet);
  return i >= 0 ? i : null;
}
function orderTargets(o: Order, rid: number): boolean {
  if (o.type === 'move') return o.path[o.path.length - 1] === rid;
  if (o.type === 'seize' || o.type === 'influence' || o.type === 'scan' || o.type === 'feint') return o.target === rid;
  if (o.type === 'build' || o.type === 'develop') return o.region === rid;
  return false;
}
export { shortWhy };
