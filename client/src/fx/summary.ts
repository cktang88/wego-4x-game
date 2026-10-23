// The Reckoning (LOOPS §1.2 "Reckon", DELIGHT #59 #60): when the reveal ends (or is skipped), gold coins fly from
// where each house earned its victory points to its crest; each landing rolls the crest's number by the coin's value
// and rings one step higher on the coin ladder. Then a vellum ribbon sums up your turn and closes with one line in
// the Herald's voice: the best near miss, or where the race stands.
// Truth: the coins of a house add up to exactly its change in the VP log; the crest only ever shows a value the
// house really passed through (before, before + coin, …, after); skipping jumps straight to the true totals.
import type { GameState, PlayerId, Pt, TurnResult } from '../../../shared/sim/types.ts';
import { esc } from '../ui/dom.ts';
import { ic } from '../art/icons.ts';
import { audio } from '../audio/audio.ts';
import { coinsFor, type VpChange } from './vp.ts';
import { shipsLost, shipsSunkBy } from './battlefacts.ts';
import { haptic } from './haptics.ts';
import { reduced } from './motion.ts';
import './delight.css';

export interface SummaryHost {
  st: GameState;
  you: PlayerId | null;
  layer: HTMLElement;
  /** world point → client px (null if the map isn't laid out) */
  toClient(p: Pt): Pt | null;
  /** the visible map rect in client px (coins from off-screen worlds enter from its edge) */
  mapRect(): DOMRect;
  /** the crest element of a house */
  crest(p: PlayerId): HTMLElement | null;
  /** the value a crest shows during the count-up (null = the real VP) */
  setShown(p: PlayerId, v: number | null): void;
  /** where the ribbon may sit (below the top bar), client px */
  ribbonTop(): number;
  phone: boolean;
  /** a card, modal or dialog is up: the ribbon must not sit over its controls, so it isn't shown */
  busy(): boolean;
}

interface Flight { el: HTMLElement; anim: Animation | null; land: () => void; landed: boolean }

export class Reckoning {
  private flights: Flight[] = [];
  private timers: number[] = [];
  private ribbon: HTMLElement | null = null;
  private unAway: () => void = () => {};
  private shown = new Map<PlayerId, number>();
  private changes: VpChange[] = [];
  active = false;
  constructor(private host: SummaryHost) {}

  /** Is the count-up still running (Space finishes it)? */
  get counting(): boolean { return this.active && this.flights.some(f => !f.landed); }

  /**
   * Run the count-up for `changes`; with `result`, also the ribbon (WEGO). `ribbon` false: coins only (LIVE).
   * Returns the total time in ms.
   */
  start(changes: VpChange[], result: TurnResult | null, o: { ribbon: boolean; line?: string }): number {
    this.finish(true);
    const H = this.host;
    this.changes = changes.filter(c => c.after !== c.before || c.sources.length);
    this.active = true;
    const you = H.you;
    // yours first, then the others in seat order
    const order = this.changes.slice().sort((a, b) => (a.player === you ? -1 : b.player === you ? 1 : a.player - b.player));
    for (const c of order) { this.shown.set(c.player, c.before); H.setShown(c.player, c.before); }
    const rm = reduced();
    const rect = H.mapRect();
    let i = 0, t = 0;
    const GAP = rm ? 70 : 95, FLY = rm ? 0 : 620;
    let ladder = 0;
    for (const c of order) {
      const crest = H.crest(c.player);
      for (const s of c.sources) {
        for (const v of coinsFor(s.amount)) {
          const delay = t;
          const step = v > 0 ? ladder++ : 0;
          const land = () => {
            const cur = (this.shown.get(c.player) ?? c.before) + v;
            this.shown.set(c.player, cur);
            H.setShown(c.player, cur);
            roll(H.crest(c.player), cur, v > 0);
            audio.coin(step, { down: v < 0, vol: c.player === you || you === null ? 1 : 0.75 });
            if (c.player === you) haptic('coin');
          };
          this.flights.push(this.fly(s.region, crest, rect, delay, FLY, v, land));
          t += GAP;
          i++;
        }
      }
      t += rm ? 0 : 140;   // a breath between houses
    }
    const total = t + FLY + 120;
    // the crests return to the real numbers when it is all over (they already show them by then)
    this.later(() => this.settle(), total);
    if (o.ribbon && result) this.later(() => this.showRibbon(result, o.line ?? ''), rm ? 0 : Math.min(500, total * 0.4));
    return total;
  }

  private later(fn: () => void, ms: number) { this.timers.push(window.setTimeout(fn, ms)); }

  /** One coin from a world (or the edge of the map toward it) to a crest. */
  private fly(region: number | null, crest: HTMLElement | null, rect: DOMRect, delay: number, dur: number, v: number, land: () => void): Flight {
    const H = this.host;
    const f: Flight = { el: document.createElement('i'), anim: null, land, landed: false };
    const done = () => { if (f.landed) return; f.landed = true; f.el.remove(); land(); };
    f.land = done;
    const site = region !== null ? H.st.regions[region]?.site : undefined;
    let from = site ? H.toClient(site) : null;
    const cr = crest?.getBoundingClientRect();
    const to = cr && cr.width ? { x: cr.left + cr.width / 2, y: cr.top + cr.height * 0.38 } : null;
    if (!to || reduced()) { this.later(done, delay + dur); return f; }
    if (!from) from = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    // a world off-screen: the coin enters from the map's edge on the line toward it
    from = { x: Math.max(rect.left + 12, Math.min(rect.right - 12, from.x)), y: Math.max(rect.top + 12, Math.min(rect.bottom - 12, from.y)) };
    const el = f.el;
    el.className = `dl-coin${v < 0 ? ' neg' : ''}${Math.abs(v) > 1 ? ' big' : ''}`;
    el.innerHTML = Math.abs(v) > 1 ? `<b>${Math.abs(v)}</b>` : '';
    // a negative coin leaves the crest and falls away
    const a = v < 0 ? to : from, b = v < 0 ? { x: to.x + 14, y: to.y + 90 } : to;
    el.style.left = `${Math.round(a.x)}px`; el.style.top = `${Math.round(a.y)}px`;
    el.style.opacity = '0';
    H.layer.appendChild(el);
    const dx = b.x - a.x, dy = b.y - a.y;
    // an arc: up and over, a little toward the lamp (upper left) at the top
    const lift = Math.min(160, 60 + Math.hypot(dx, dy) * 0.18);
    const kf: Keyframe[] = [];
    for (let k = 0; k <= 10; k++) {
      const t = k / 10, e = t * t * (3 - 2 * t);
      const x = dx * e, y = dy * e - Math.sin(Math.PI * t) * lift;
      const s = 0.7 + Math.sin(Math.PI * Math.min(1, t * 1.2)) * 0.5;
      kf.push({ transform: `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${s.toFixed(3)}) rotateY(${(t * 540).toFixed(0)}deg)`, opacity: k === 0 ? 0 : 1, offset: t });
    }
    f.anim = el.animate(kf, { duration: dur, delay, easing: 'cubic-bezier(0.5, 0, 0.75, 0.6)', fill: 'both' });
    f.anim.onfinish = done;
    return f;
  }

  /** Space / skip: land every coin now (true totals at once). `silent`: no sounds (a new count-up replaces this one). */
  finish(silent = false) {
    for (const f of this.flights) {
      if (f.landed) continue;
      f.anim?.cancel();
      f.landed = true; f.el.remove();
    }
    this.flights = [];
    if (this.active) this.settle();
    if (silent) { this.timers.forEach(t => clearTimeout(t)); this.timers = []; this.ribbon?.remove(); this.ribbon = null; this.unAway(); this.unAway = () => {}; }
  }
  /** Back to the real numbers. */
  private settle() {
    // a coin still in the air (a hidden tab or a slow device holds its animation back past the settle timer) must
    // not land afterwards: it would count again from `before` and leave the crest stuck on a stale number
    for (const f of this.flights) if (!f.landed) { f.landed = true; f.anim?.cancel(); f.el.remove(); }
    this.flights = [];
    for (const c of this.changes) this.host.setShown(c.player, null);
    for (const c of this.changes) { const el = this.host.crest(c.player)?.querySelector<HTMLElement>('[data-vp]'); if (el) el.textContent = String(c.after); }
    this.shown.clear();
    this.active = false;
  }
  /** Take the ribbon away (the player moved on). */
  dismiss() {
    const r = this.ribbon;
    // (also called on every render with a card or modal up: cheap when there is no ribbon)
    if (!r) return;
    this.ribbon = null;
    this.unAway(); this.unAway = () => {};
    if (reduced()) { r.remove(); return; }
    r.classList.add('out');
    setTimeout(() => r.remove(), 320);
  }
  destroy() { this.finish(true); this.dismiss(); }
  /** A resize or a turned phone: the ribbon keeps clear of the (re-laid-out) top bar. */
  reposition() {
    const r = this.ribbon;
    if (!r) return;
    r.style.top = `${Math.round(this.host.ribbonTop())}px`;
    r.classList.toggle('phone', this.host.phone);
  }

  // ---------------------------------------------------------------- the ribbon
  private showRibbon(result: TurnResult, line: string) {
    const H = this.host, st = H.st, you = H.you;
    const items: string[] = [];
    const rn = (id: number) => esc(st.regions[id]?.name ?? '?');
    if (you !== null) {
      const c = this.changes.find(x => x.player === you);
      const d = c ? c.after - c.before : 0;
      if (d) items.push(`<span class="dl-vp ${d < 0 ? 'neg' : ''}">${d > 0 ? '+' : '−'}${Math.abs(d)}${ic('crown')}</span>`);
      const called = result.events.filter(e => e.k === 'posture' && e.owner === you && e.outcome === 'called').length;
      const caught = result.events.filter(e => e.k === 'posture' && e.outcome === 'caught' && (e.owner === you)).length;
      if (called) items.push(`<span class="dl-stamp">${called > 1 ? `${called} ` : ''}CALLED IT</span>`);
      if (caught) items.push(`<span class="dl-stamp bad">${caught > 1 ? `${caught} ` : ''}CAUGHT OUT</span>`);
      const took = result.events.filter(e => e.k === 'capture' && e.by === you).map(e => (e.k === 'capture' ? e.region : -1));
      const lost = result.events.filter(e => e.k === 'capture' && e.from === you).map(e => (e.k === 'capture' ? e.region : -1));
      if (took.length) items.push(`<span>${rn(took[0])} taken${took.length > 1 ? ` <small>+${took.length - 1}</small>` : ''}</span>`);
      if (lost.length) items.push(`<span class="bad">${rn(lost[0])} lost${lost.length > 1 ? ` <small>+${lost.length - 1}</small>` : ''}</span>`);
      // your battles: the biggest one by name, with how it stands
      const mine = result.battles.filter(b => b.sides.some(s => s.owner === you));
      if (mine.length) {
        const b = mine.slice().sort((a, c) => c.sides.reduce((n, s) => n + s.ships.length, 0) - a.sides.reduce((n, s) => n + s.ships.length, 0))[0];
        const how = b.ongoing || b.winner === null ? 'Fighting at' : b.winner === you ? 'Won at' : 'Lost at';
        items.push(`<span${how === 'Lost at' ? ' class="bad"' : ''}>${how} ${rn(b.region)}${mine.length > 1 ? ` <small>+${mine.length - 1}</small>` : ''}</span>`);
      }
      let sunk = 0, gone = 0;
      for (const b of result.battles) { sunk += shipsSunkBy(b).get(you) ?? 0; gone += shipsLost(b).get(you) ?? 0; }
      if (sunk) items.push(`<span>${sunk} sunk</span>`);
      if (gone) items.push(`<span class="bad">${gone} ship${gone > 1 ? 's' : ''} lost</span>`);
    } else {
      for (const c of this.changes) { const d = c.after - c.before; if (d) items.push(`<span class="dl-vp ${d < 0 ? 'neg' : ''}" style="--pc:${esc(st.players[c.player].color)}"><i class="dl-pip"></i>${d > 0 ? '+' : '−'}${Math.abs(d)}${ic('crown')}</span>`); }
    }
    if ((!items.length && !line) || H.busy()) return;
    if (!items.length) items.push('<span class="quiet">A quiet turn</span>');
    const el = document.createElement('div');
    el.className = `dl-ribbon${H.phone ? ' phone' : ''}`;
    el.setAttribute('role', 'status');
    el.innerHTML = `<div class="dl-rib-row">${items.slice(0, 5).join('<i class="dl-dot"></i>')}</div>${line ? `<p class="dl-herald">${esc(line)}</p>` : ''}`;
    el.style.top = `${Math.round(H.ribbonTop())}px`;
    el.addEventListener('click', () => this.dismiss());
    H.layer.appendChild(el);
    this.ribbon = el;
    // stays while it is being read (hover), otherwise leaves after a while
    let hold = false;
    el.addEventListener('pointerenter', () => { hold = true; });
    el.addEventListener('pointerleave', () => { hold = false; });
    // the first touch anywhere else means the player has moved on
    const away = (e: Event) => { if (!el.contains(e.target as Node)) this.dismiss(); };
    document.addEventListener('pointerdown', away, true);
    // however the ribbon goes (a touch, its timer, a card opening, the game closing), the listener goes with it: a
    // ribbon that left on its timer kept it on the document, and with it the whole finished game, until a click
    this.unAway = () => document.removeEventListener('pointerdown', away, true);
    const linger = () => { if (this.ribbon !== el) return; if (hold) { this.later(linger, 1000); return; } this.dismiss(); };
    this.later(linger, 7500);
  }
}

/** Roll a crest's number to `v`: the old digits slide away, the new ones arrive (clipped by the shield). */
function roll(crest: HTMLElement | null, v: number, up: boolean) {
  if (!crest) return;
  const el = crest.querySelector<HTMLElement>('[data-vp]');
  if (el) {
    el.textContent = String(v);
    el.classList.remove('dl-roll-up', 'dl-roll-down'); void el.offsetWidth;
    el.classList.add(up ? 'dl-roll-up' : 'dl-roll-down');
  }
  crest.classList.remove('dl-hit'); void crest.offsetWidth; crest.classList.add('dl-hit');
}
