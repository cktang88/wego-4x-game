// First-run coach: a handful of contextual coach marks anchored to real UI (or to a spot on the
// map) that advance when the player actually does the thing. Separate copy for WEGO and LIVE.
// Only the bubble takes pointer events, so the map and panels stay fully usable underneath.
import type { GameScreen } from '../game.ts';
import { esc } from './dom.ts';
import { orderMs } from '../../../shared/sim/live.ts';

function fmtDurShort(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000)), m = Math.floor(s / 60), h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${String(m % 60).padStart(2, '0')}m` : m > 0 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

type Anchor = { el: HTMLElement } | { pt: { x: number; y: number }; r: number } | null;
interface Step { id: string; title: string; text: string; anchor: Anchor; next?: string; finish?: string }

const key = (live: boolean) => `tc.tutorial.${live ? 'live' : 'wego'}`;
export function tutorialDone(live: boolean): boolean {
  try { return localStorage.getItem(key(live)) === 'done'; } catch { return false; }
}
function setDone(live: boolean, done: boolean) {
  try { if (done) localStorage.setItem(key(live), 'done'); else localStorage.removeItem(key(live)); } catch { /* */ }
}

const WEGO = ['fleet', 'action', 'target', 'slots', 'capital', 'build', 'seal', 'end'];
const LIVE = ['fleet', 'action', 'target', 'bank', 'capital', 'build', 'end'];

export class Coach {
  box: HTMLElement;
  ring: HTMLElement;
  active: boolean;
  private raf = 0;
  private shown = '';
  private lastEval = 0;
  private acked = new Set<string>();
  private did = { fleet: false, build: false, seal: false };
  private startTurn: number;
  private cur: Step | null = null;

  constructor(private g: GameScreen) {
    this.box = document.createElement('div');
    this.box.className = 'coach hidden';
    this.box.setAttribute('role', 'dialog');
    this.box.setAttribute('aria-live', 'polite');
    this.ring = document.createElement('div');
    this.ring.className = 'coach-ring hidden';
    document.body.append(this.ring, this.box);
    this.startTurn = g.st.turn;
    this.active = this.eligible() && !tutorialDone(g.live);
    this.box.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-coach]');
      if (!b) return;
      const a = b.dataset.coach;
      if (a === 'skip' || a === 'finish') this.finish();
      else if (a === 'next' && this.cur) { this.acked.add(this.cur.id); this.update(); }
    });
    const loop = () => { this.raf = requestAnimationFrame(loop); this.tick(); };
    this.raf = requestAnimationFrame(loop);
  }

  eligible() { return this.g.you !== null && this.g.st.winner === null && !this.g.st.players[this.g.you]?.eliminated; }

  restart() {
    setDone(this.g.live, false);
    this.acked.clear();
    this.did = { fleet: false, build: false, seal: false };
    this.startTurn = this.g.st.turn;
    this.active = this.eligible();
    this.shown = '';
    this.update();
  }
  finish() {
    setDone(this.g.live, true);
    this.active = false;
    this.hide();
  }
  destroy() { cancelAnimationFrame(this.raf); this.box.remove(); this.ring.remove(); }
  hide() { this.box.classList.add('hidden'); this.ring.classList.add('hidden'); this.cur = null; this.shown = ''; }

  /** Re-evaluate which step applies (called after renders, and a few times a second). */
  update() {
    if (!this.active || !this.eligible()) { this.hide(); return; }
    const s = this.step();
    this.cur = s;
    if (!s) { this.hide(); return; }
    const seq = this.g.live ? LIVE : WEGO;
    const sig = `${s.id}|${s.text}`;
    if (sig !== this.shown) {
      this.shown = sig;
      const n = seq.indexOf(s.id) + 1;
      this.box.innerHTML = `<div class="ct">Quick tour<span>${n} / ${seq.length}</span></div><h4>${esc(s.title)}</h4><p>${s.text}</p>
        <div class="cb">${s.finish ? '' : '<button class="skip" data-coach="skip">Skip tutorial</button>'}${s.next ? `<button class="small primary" data-coach="next">${esc(s.next)}</button>` : ''}${s.finish ? `<button class="small primary" data-coach="finish">${esc(s.finish)}</button>` : ''}</div>`;
    }
    this.box.classList.remove('hidden');
    this.place();
  }

  private tick() {
    if (!this.active) return;
    const now = performance.now();
    if (now - this.lastEval > 200) { this.lastEval = now; this.update(); }
    else if (this.cur) this.place();
  }

  private step(): Step | null {
    const g = this.g, st = g.st, you = g.you!;
    if (g.replay || g.curtain || document.querySelector('.overlay, .bv-overlay')) return null;
    const live = g.live, ph = g.phone, tap = ph ? 'Tap' : 'Click';
    const fleetOrder = (o: { type: string } | null) => !!o && ['move', 'seize', 'fortify', 'excavate'].includes(o.type);
    const buildOrder = (o: { type: string } | null) => !!o && (o.type === 'build' || o.type === 'develop');
    if (live) {
      if (g.queue.some(fleetOrder) || st.fleets.some(f => f.owner === you && f.route)) this.did.fleet = true;
      if (g.queue.some(buildOrder)) this.did.build = true;
    } else {
      if (g.plan.orders.some(fleetOrder)) this.did.fleet = true;
      if (g.plan.orders.some(buildOrder)) this.did.build = true;
      if (g.submitted || st.turn > this.startTurn) this.did.seal = true;
    }
    if (!g.canPlan) return null;
    const own = st.fleets.filter(f => f.owner === you && f.ships.length);
    const selF = g.sel?.kind === 'fleet' ? g.fleet(g.sel.id) : undefined;
    const selOwnFleet = selF && selF.owner === you ? selF : undefined;
    const q = (sel: string) => {
      const e = g.root.querySelector<HTMLElement>(sel) ?? document.querySelector<HTMLElement>(sel);
      return e && e.offsetParent !== null && e.getBoundingClientRect().width > 0 ? { el: e } : null;
    };
    const mapPt = (p: { x: number; y: number }, r: number): Anchor => {
      const s = g.map.toScreen(p), c = g.el.canvas.getBoundingClientRect();
      const x = s.x + c.left, y = s.y + c.top;
      return x < c.left || x > c.right || y < c.top || y > c.bottom ? null : { pt: { x, y }, r };
    };
    const pending = live ? g.bank < 1 : g.nextSlot() === null;
    const waitTxt = live ? `Your bank is empty: the next order arrives in <b>${fmtDurShort((st.live?.nextOrderAt[you] ?? 0) - Date.now())}</b>.` : 'All order slots are full: remove one in the Orders list first.';

    if (!this.did.fleet) {
      if (g.mode && (g.mode.type === 'move' || g.mode.type === 'seize')) {
        const m = g.mode;
        const f = g.fleet(m.fleet);
        const from = f ? g.projected(g.nextSlot() ?? 0).get(f.id) ?? f.region : null;
        let tgt: number | undefined;
        if (from !== null) {
          const nb = st.regions[from].neighbors.filter(n => st.regions[n].owner !== you);
          tgt = nb.find(n => st.regions[n].owner === null && st.regions[n].kind === 'colony') ?? nb.find(n => st.regions[n].owner === null) ?? nb[0] ?? st.regions[from].neighbors[0];
        }
        return {
          id: 'target', title: m.type === 'seize' ? 'Pick a target' : 'Pick a destination',
          text: m.type === 'seize'
            ? `${tap} a <b style="color:var(--bad)">red-highlighted</b> region next to the fleet.${ph ? '' : ' Hover one first to see your odds.'}`
            : live ? `${tap} any region. The fleet sets off at the next tick and travels in real time.` : `${tap} a <b style="color:var(--good)">green</b> region within range.`,
          anchor: tgt !== undefined ? mapPt(st.regions[tgt].site, 26) : null,
        };
      }
      if (selOwnFleet) {
        if (pending) return { id: 'action', title: 'Give it an order', text: waitTxt, anchor: q('.acts1') };
        return {
          id: 'action', title: 'Give it an order',
          text: live ? `<b>Move</b> goes any distance; <b>Seize</b> attacks a neighbouring region. Each spends one banked order.`
            : `<b>Seize</b> attacks a neighbouring region. <b>Move</b> repositions. Each order fills one of your ${st.rules.orders.perTurn} slots.`,
          anchor: q('[data-a=seize]:not(:disabled)') ?? q('[data-a=move]') ?? q('.acts1'),
        };
      }
      const big = own.slice().sort((a, b) => b.ships.length - a.ships.length)[0];
      const draw = big ? g.currentFleetDraws().find(d => d.id === big.id) : undefined;
      return {
        id: 'fleet', title: 'Command a fleet',
        text: `Your fleets that still have nothing to do <b>glow</b>. ${tap} one to see what it can do.`,
        anchor: draw ? mapPt(draw.pos, 22) : null,
      };
    }
    if (!live && !this.acked.has('slots')) {
      return {
        id: 'slots', title: `${st.rules.orders.perTurn} orders per turn`,
        text: `Each order fills a pulse slot. Slot <b>I</b> happens first, for every player at once. Reorder with ▲▼, remove with ✕.`,
        anchor: ph ? q('.dock .pills') : q('.tabbody .slots') ?? q('[data-tab=orders]'), next: 'Got it',
      };
    }
    if (live && !this.acked.has('bank')) {
      return {
        id: 'bank', title: 'Your order bank',
        text: `You earn an order every <b>${fmtDurShort(orderMs(st))}</b>, up to ${st.rules.live.bankCap}. Spent orders act at the next tick; until then ✕ takes one back.`,
        anchor: ph ? q('.dock .livebank') : q('.tabbody .bank') ?? q('[data-tab=orders]'), next: 'Got it',
      };
    }
    if (!this.did.build) {
      const capId = st.players[you].capital;
      const selR = g.sel?.kind === 'region' ? st.regions[g.sel.id] : undefined;
      if (selR && selR.owner === you) {
        if (pending) return { id: 'build', title: 'Build here', text: waitTxt, anchor: q('.buildlist') };
        return {
          id: 'build', title: 'Build a ship',
          text: `Pick a hull. New ships join a fleet here, or form a new squadron. Costs show next to each.`,
          anchor: q('[data-a=build]:not(:disabled)') ?? q('.buildlist') ?? q('[data-a=develop]'),
        };
      }
      const cap = st.regions[capId];
      return {
        id: 'capital', title: 'Grow your fleet',
        text: `${tap} your capital, <b>${esc(cap?.name ?? 'home')}</b>, to build ships and start projects.`,
        anchor: cap ? mapPt(cap.site, 30) : null,
      };
    }
    if (!live && !this.did.seal) {
      const used = g.plan.orders.filter(Boolean).length;
      return {
        id: 'seal', title: 'Seal your orders',
        text: `${used < g.plan.orders.length ? `You've used ${used} of ${g.plan.orders.length}. Add more, or` : 'All set:'} <b>Seal</b>. When everyone has sealed, the turn plays out as a replay.`,
        anchor: ph ? q('[data-d=seal]') : q('[data-submit]'),
      };
    }
    return {
      id: 'end', title: live ? 'The world keeps ticking' : "That's the loop",
      text: live
        ? `No turns to seal. Spend orders as they arrive, and don't let the bank overflow. <b>?</b> has the full rules${ph ? ' (under ☰)' : ''}.`
        : `Plan, seal, watch. <b>👁 Preview</b> tests a plan against idle rivals. <b>?</b> has the full rules${ph ? ' (under ☰)' : ''}.`,
      anchor: ph ? null : q('[data-act=help]'), finish: 'Finish',
    };
  }

  /** Position the ring on the anchor and the bubble next to it, inside the viewport. */
  private place() {
    const s = this.cur;
    if (!s) return;
    const vw = window.innerWidth, vh = window.innerHeight, ph = this.g.phone;
    this.box.classList.toggle('ph', ph);
    const bw = this.box.offsetWidth, bh = this.box.offsetHeight;
    let rect: { l: number; t: number; w: number; h: number } | null = null;
    const a = s.anchor;
    if (a && 'el' in a) {
      if (!a.el.isConnected) { this.lastEval = 0; return; }
      const r = a.el.getBoundingClientRect();
      rect = { l: r.left - 4, t: r.top - 4, w: r.width + 8, h: r.height + 8 };
      this.ring.classList.remove('dot');
    } else if (a && 'pt' in a) {
      rect = { l: a.pt.x - a.r, t: a.pt.y - a.r, w: a.r * 2, h: a.r * 2 };
      this.ring.classList.add('dot');
    }
    let x: number, y: number;
    if (rect) {
      Object.assign(this.ring.style, { left: `${rect.l}px`, top: `${rect.t}px`, width: `${rect.w}px`, height: `${rect.h}px` });
      this.ring.classList.remove('hidden');
      // try each side of the anchor; keep the one that covers the least UI (panels, bars, the anchor itself)
      const avoid: { l: number; t: number; w: number; h: number }[] = [];
      for (const e of [...this.g.root.querySelectorAll<HTMLElement>('.panel, .topbar, .dock, .bottombar, .modehint'), ...document.querySelectorAll<HTMLElement>('body > .toast')]) {
        if (e.offsetParent === null && !e.classList.contains('toast')) continue;
        const r = e.getBoundingClientRect();
        if (r.width && r.height) avoid.push({ l: r.left, t: r.top, w: r.width, h: r.height });
      }
      const over = (a: { l: number; t: number; w: number; h: number }, b: { l: number; t: number; w: number; h: number }) =>
        Math.max(0, Math.min(a.l + a.w, b.l + b.w) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.t + a.h, b.t + b.h) - Math.max(a.t, b.t));
      const gap = 14, cx = rect.l + rect.w / 2 - bw / 2, cy = rect.t + rect.h / 2 - bh / 2;
      const cands: [number, number][] = [[rect.l + rect.w + gap, cy], [rect.l - gap - bw, cy], [cx, rect.t + rect.h + gap], [cx, rect.t - gap - bh]];
      // an anchor inside a panel: also try just outside that panel, level with the anchor
      const host = a && 'el' in a ? a.el.closest<HTMLElement>('.panel, .dock, .topbar') : null;
      if (host) {
        const h = host.getBoundingClientRect();
        cands.unshift([h.right + gap, cy], [h.left - gap - bw, cy], [cx, h.top - gap - bh]);
      }
      let best = Infinity;
      x = cands[0][0]; y = cands[0][1];
      for (const [cx0, cy0] of cands) {
        const c = { l: Math.max(8, Math.min(vw - bw - 8, cx0)), t: Math.max(8, Math.min(vh - bh - 8, cy0)), w: bw, h: bh };
        const cost = over(c, rect) * 50 + avoid.reduce((acc, r) => acc + over(c, r), 0) + (c.l !== cx0 || c.t !== cy0 ? 2000 : 0);
        if (cost < best) { best = cost; x = c.l; y = c.t; }
      }
    } else {
      this.ring.classList.add('hidden');
      x = vw / 2 - bw / 2;
      y = ph ? this.g.el.dock.getBoundingClientRect().top - bh - 12 : this.g.el.stage.getBoundingClientRect().top + 14;
    }
    x = Math.max(8, Math.min(vw - bw - 8, x));
    y = Math.max(8, Math.min(vh - bh - 8, y));
    this.box.style.left = `${Math.round(x)}px`;
    this.box.style.top = `${Math.round(y)}px`;
  }
}
