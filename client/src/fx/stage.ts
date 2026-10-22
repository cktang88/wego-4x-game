// The replay's staged moments over the board (DOM, in one non-interactive layer above the HUD):
//   seals   Act I: the houses' wax seals in a row; each cracks open in the order its house sealed
//   hold    Act IV: before a battle resolves, a brass plate over the world with both sides' ships and a balance
//           needle on the hull each side brought (the reel still spinning), 400 ms
//   title   the main event's card: "…and at Vel."
//   thump   a small table thump (≤ 4 px) for a stamp landing; never under reduced motion
// Everything here is cosmetic over true numbers, skippable (the replay's Skip clears the layer), and frozen into
// cross-fades under reduced motion.
import { esc } from '../ui/dom.ts';
import { sigilSvg } from '../art/sigils.ts';
import { enamel } from '../art/bible.ts';
import { ic } from '../art/icons.ts';
import type { BattleReport, Pt } from '../../../shared/sim/types.ts';
import { battlePower } from './battlefacts.ts';
import { reduced } from './motion.ts';
import { audio } from '../audio/audio.ts';
import './delight.css';

/** Each house's signet: the charge pressed into its wax (seat order: Azure, Crimson, Gilded). */
export const SIGNET = ['star', 'wolf', 'sun'];
export const signetOf = (seat: number) => SIGNET[seat] ?? 'crown';

export interface SealHouse { seat: number; name: string; color: string }

/** The wax seal of a house (a disc of house-coloured wax with its signet pressed in). */
export function waxSealHtml(h: { seat: number; color: string }, size = 64, cls = ''): string {
  const e = enamel(h.color);
  return `<span class="dl-wax ${cls}" style="--wx:${e.base};--wh:${e.hi};--wl:${e.lo};--sz:${size}px"><span class="dl-wax-face">${sigilSvg(signetOf(h.seat), Math.round(size * 0.5), 'rgba(0,0,0,0.38)', 'dl-wax-sig')}</span></span>`;
}

export class Stage {
  layer: HTMLElement;
  private seals: HTMLElement | null = null;
  private plate: { el: HTMLElement; at: Pt; t0: number; share: number } | null = null;
  private titleEl: HTMLElement | null = null;
  private timers: number[] = [];
  constructor(parent: HTMLElement) {
    this.layer = document.createElement('div');
    this.layer.className = 'dl-layer';
    this.layer.setAttribute('aria-hidden', 'true');
    parent.appendChild(this.layer);
  }
  private later(fn: () => void, ms: number) { this.timers.push(window.setTimeout(fn, ms)); }
  /** Remove every staged element at once (Skip, replay end). */
  clear() {
    this.timers.forEach(t => clearTimeout(t)); this.timers = [];
    this.seals?.remove(); this.seals = null;
    this.plate?.el.remove(); this.plate = null;
    this.titleEl?.remove(); this.titleEl = null;
  }
  destroy() { this.clear(); this.layer.remove(); }

  // ---------------------------------------------------------------- Act I
  /** The seals crack in `order` (seats, first sealed first), over ~`dur` ms. Voices the cracks. */
  sealsAct(houses: SealHouse[], order: number[], dur = 950, quiet = false) {
    this.seals?.remove();
    const el = document.createElement('div');
    el.className = 'dl-seals';
    const seats = houses.map(h => h.seat);
    el.innerHTML = houses.map(h => `<div class="dl-sealslot" data-seat="${h.seat}"><span class="dl-split" style="--sz:64px">${waxSealHtml(h, 64, 'l')}${waxSealHtml(h, 64, 'r')}</span><b style="--pc:${enamel(h.color).hi}">${esc(h.name.split(' ')[0])}</b></div>`).join('');
    this.layer.appendChild(el);
    this.seals = el;
    const rm = reduced();
    const seq = order.filter(s => seats.includes(s)).concat(seats.filter(s => !order.includes(s)));
    const step = Math.min(240, (dur - 380) / Math.max(1, seq.length));
    seq.forEach((seat, i) => {
      this.later(() => {
        el.querySelector(`[data-seat="${seat}"] .dl-split`)?.classList.add('cracked');
        if (!quiet) audio.waxCrack(i);
      }, 140 + i * step);
    });
    this.later(() => el.classList.add('out'), rm ? dur - 200 : dur - 260);
    this.later(() => { if (this.seals === el) { el.remove(); this.seals = null; } }, dur + 200);
  }

  // ---------------------------------------------------------------- Act IV
  /** The 400 ms hold before a battle: both sides' ships, a balance needle on the hull each brought. */
  hold(rep: BattleReport, at: Pt, color: (o: number) => string, name: (o: number) => string, dur = 420) {
    this.plate?.el.remove();
    const pw = battlePower(rep).sort((a, b) => (a.owner === -1 ? 1 : 0) - (b.owner === -1 ? 1 : 0));
    if (pw.length < 2) return;
    // ships as a number, a world's garrison as its hull behind a bastion mark (it is not a ship)
    const side = (p: { owner: number; ships: number; garrison: number }) => `<span class="dl-side" style="--pc:${enamel(color(p.owner)).base};--ph:${enamel(color(p.owner)).hi}"><i class="dl-pip"></i>${p.ships ? `<b>${p.ships}</b>` : ''}${p.garrison ? `<span class="dl-gar">${ic('garrison')}<b>${p.garrison}</b></span>` : ''}<em>${esc(name(p.owner).split(' ')[0])}</em></span>`;
    const el = document.createElement('div');
    el.className = 'dl-hold';
    // two sides: a balance needle on the hull each brought; three or more: just the sides (no balance to read)
    const a = pw[0], b = pw[1];
    const share = pw.length === 2 && a.hp + b.hp > 0 ? a.hp / (a.hp + b.hp) : 0.5;
    const dial = `<span class="dl-dial"><svg viewBox="0 0 60 34" aria-hidden="true"><path d="M5 31a25 25 0 0 1 50 0" fill="none" stroke="url(#tc-gold)" stroke-width="2.2"/><path d="M30 6v4M9.6 17.8l3 2M50.4 17.8l-3 2" stroke="#e8d29a" stroke-width="1.4"/><g class="dl-needle"><path d="M30 31L30 9" stroke="#fbedc8" stroke-width="2" stroke-linecap="round"/><circle cx="30" cy="31" r="3.2" fill="#c8964a" stroke="#3a2810"/></g></svg><i class="dl-swords">${ic('battle')}</i></span>`;
    el.innerHTML = pw.length === 2 ? `${side(a)}${dial}${side(b)}` : pw.map(side).join(`<i class="dl-swords solo">${ic('battle')}</i>`);
    this.layer.appendChild(el);
    this.plate = { el, at, t0: performance.now(), share };
    this.later(() => el.classList.add('out'), dur + 500);
    this.later(() => { if (this.plate?.el === el) { el.remove(); this.plate = null; } }, dur + 900);
  }
  /** The main event's title: "…and at Vel." */
  title(text: string, dur = 1100) {
    this.titleEl?.remove();
    const el = document.createElement('div');
    el.className = 'dl-title';
    el.innerHTML = `<span>${esc(text)}</span>`;
    this.layer.appendChild(el);
    this.titleEl = el;
    this.later(() => el.classList.add('out'), dur - 280);
    this.later(() => { if (this.titleEl === el) { el.remove(); this.titleEl = null; } }, dur + 100);
  }
  /** Per frame: keep the hold plate over its world (the camera may move), and swing its needle. */
  frame(toScreen: (p: Pt) => Pt, now = performance.now()) {
    const P = this.plate;
    if (!P) return;
    const s = toScreen(P.at);
    P.el.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px) translate(-50%, calc(-100% - 2.5rem))`;
    // the needle hunts round the true balance, then settles on it (angle −60°..+60°, a on the left)
    const t = Math.min(1, (now - P.t0) / 420);
    const truth = (0.5 - P.share) * 120;
    const hunt = reduced() ? 0 : Math.sin(now / 38) * 22 * (1 - t) * (1 - t);
    const n = P.el.querySelector<SVGGElement>('.dl-needle');
    if (n) n.style.transform = `rotate(${(truth * (reduced() ? 1 : Math.min(1, t * 1.4)) + hunt).toFixed(1)}deg)`;
  }

  /** A small thump of the table (a stamp landing): ≤ 4 px, 160 ms; nothing under reduced motion. */
  thump(target: HTMLElement, px = 3) {
    if (reduced() || !target.animate) return;
    target.animate([{ transform: 'translate(0,0)' }, { transform: `translate(${px * 0.6}px, ${px}px)` }, { transform: `translate(${-px * 0.4}px, ${-px * 0.3}px)` }, { transform: 'translate(0,0)' }], { duration: 160, easing: 'cubic-bezier(0.3, 1.35, 0.45, 1)' });
  }
}
