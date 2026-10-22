// The crowning (LOOPS §2.3, DELIGHT #76 #77): instead of a victory box, a ceremony at the table. The room dims, the
// lamp swings on its cord to the winner's seat; the winner's banner drops and the crown settles on its rail; the
// other banners lower slowly (on a loser's screen, theirs too). Then award cards are dealt, at least one to every
// house, each a true line from the game's record, and the way leads on into the Saga.
// Skippable at any point (click, Space, Enter, Esc: straight to the finished table; Esc again looks around).
// Reduced motion: the lamp already hangs over the winner, the banners already rest, the cards fade in.
import type { GameState, PlayerId, TurnResult } from '../../../shared/sim/types.ts';
import { esc, overlay } from '../ui/dom.ts';
import { ic } from '../art/icons.ts';
import { sigilSvg } from '../art/sigils.ts';
import { enamel } from '../art/bible.ts';
import { audio } from '../audio/audio.ts';
import { dealAwards, type Award } from './awards.ts';
import { signetOf } from './stage.ts';
import { haptic } from './haptics.ts';
import { reduced } from './motion.ts';
import './delight.css';

export interface CrowningOpts {
  st: GameState;
  /** the seat this screen played (null: spectator) */
  me: PlayerId | null;
  /** every turn's result, as complete as the source has it (awards that need the whole game wait for it) */
  results: () => Promise<TurnResult[]>;
  onLook: () => void;
  onSaga: (() => void) | null;
  onLobby: () => void;
}

export function crowning(o: CrowningOpts): HTMLElement {
  const { st, me } = o;
  const w = st.players[st.winner!];
  const rm = reduced();
  const won = me === null || me === w.id;
  // the last turn's VP arrive on the banners (each banner counts up from where its house stood)
  const lastTurn = st.last?.turn ?? st.turn;
  const before = (p: { vp: number; vpLog: { turn: number; amount: number }[] }) => p.vp - (p.vpLog ?? []).filter(v => v.turn === lastTurn).reduce((a, v) => a + v.amount, 0);
  const seats = st.players.map(p => {
    const e = enamel(p.color);
    const cls = `${p.id === w.id ? 'win' : 'lose'}${p.id === me ? ' you' : ''}${p.eliminated ? ' out' : ''}${e.house === 'gilded' ? ' light' : ''}`;
    return `<div class="cr-seat ${cls}" data-seat="${p.id}" style="--pc:${e.base};--ph:${e.hi};--pl:${e.lo}">
      <div class="cr-banner"><i class="cr-pole"></i><div class="cr-cloth"><span class="cr-sig">${sigilSvg(signetOf(p.id), 46, 'gold')}</span>
        <b class="cr-name"><span class="cr-full">${esc(p.name)}</span><span class="cr-short">${esc(p.name.split(' ')[0])}</span></b><b class="cr-vp"><span data-cvp="${p.id}" data-from="${before(p)}">${before(p)}</span> <small>VP</small></b>${p.id === me ? '<i class="cr-you">You</i>' : ''}</div></div>
      ${p.id === w.id ? `<span class="cr-crown">${ic('crown')}</span>` : ''}
      <div class="cr-cards" data-cards="${p.id}"></div></div>`;
  }).join('');
  const html = `<div class="cr-room" aria-hidden="true"></div>
    <div class="cr-lamp" aria-hidden="true"><i class="cr-cord"></i><i class="cr-cone"></i><i class="cr-pool"></i><i class="cr-shade"></i></div>
    <div class="dialog cr-stage" data-victory role="dialog" aria-label="${esc(w.name)} is crowned">
      <div class="cr-head"><h1 class="cr-title" style="--pc:${enamel(w.color).hi}">${esc(w.name)}</h1><h2 class="cr-sub">${w.id === me ? 'Victory' : 'is crowned'}</h2><p class="cr-why">${esc(st.winReason)}</p></div>
      <div class="cr-rail" aria-hidden="true"></div>
      <div class="cr-seats">${seats}</div>
      <div class="cr-deck" aria-hidden="true"></div>
      <div class="row cr-btns"><button data-x>Look around</button>${o.onSaga ? `<button class="primary" data-saga>${ic('saga')} The Saga</button>` : ''}<button ${o.onSaga ? '' : 'class="primary" '}data-l>Lobby</button></div>
    </div>`;
  const ov = overlay(html, false);
  ov.classList.add('crowning');
  ov.style.setProperty('--win', enamel(w.color).base);
  if (rm) ov.classList.add('rm');
  const anims: Animation[] = [];
  const timers: number[] = [];
  const at = (fn: () => void, ms: number) => timers.push(window.setTimeout(() => { if (ov.isConnected) fn(); }, rm ? Math.min(ms, 60) : ms));
  let finished = false;

  // ---- the lamp: points at the winner's banner, swinging there with one overshoot
  const lamp = ov.querySelector<HTMLElement>('.cr-lamp')!;
  const aim = () => {
    const b = ov.querySelector<HTMLElement>(`.cr-seat[data-seat="${w.id}"] .cr-cloth`);
    const r = b?.getBoundingClientRect(), L = lamp.getBoundingClientRect();
    if (!r || !r.width) return { ang: 0, len: 300 };
    const px = L.left + L.width / 2, py = L.top;
    const dx = r.left + r.width / 2 - px, dy = r.top + r.height * 0.45 - py;
    return { ang: -Math.atan2(dx, dy) * 180 / Math.PI, len: Math.hypot(dx, dy) };
  };
  requestAnimationFrame(() => {
    if (!ov.isConnected) return;
    const { ang, len } = aim();
    lamp.style.setProperty('--len', `${Math.round(len)}px`);
    if (rm || !lamp.animate) { lamp.style.transform = `rotate(${ang}deg)`; return; }
    const a = lamp.animate([
      { transform: 'rotate(0deg)', offset: 0 },
      { transform: `rotate(${ang * 1.14}deg)`, offset: 0.55 },
      { transform: `rotate(${ang * 0.95}deg)`, offset: 0.8 },
      { transform: `rotate(${ang}deg)`, offset: 1 },
    ], { duration: 1500, delay: 350, easing: 'cubic-bezier(0.45, 0, 0.3, 1)', fill: 'both' });
    anims.push(a);
  });
  // the sting opens the ceremony as the room darkens; the music turns to the theme under the swing
  audio.gameOver(won);
  at(() => { ov.classList.add('lit'); haptic(won ? 'victory' : 'defeat'); }, 1500);
  // ---- banners: the winner's drops, the others lower; the numbers arrive
  at(() => {
    ov.classList.add('banners');
    audio.sfx('ui_banner');
    for (const el of ov.querySelectorAll<HTMLElement>('[data-cvp]')) countUp(el, st.players[Number(el.dataset.cvp)].vp);
  }, 1650);
  at(() => ov.classList.add('titled'), 2100);

  // ---- the awards, dealt from the deck one by one
  let dealt = false;
  const deal = (list: Award[], instant: boolean) => {
    if (dealt) return;
    dealt = true;
    const deck = ov.querySelector<HTMLElement>('.cr-deck')!;
    list.forEach((a, i) => {
      const box = ov.querySelector<HTMLElement>(`[data-cards="${a.player}"]`);
      if (!box) return;
      const c = document.createElement('div');
      c.className = 'cr-card';
      c.style.setProperty('--pc', enamel(st.players[a.player].color).base);
      c.innerHTML = `<i class="cr-cic">${ic(a.icon)}</i><b>${esc(a.title)}</b><span>${esc(a.text)}</span>`;
      c.setAttribute('aria-label', `${a.title}: ${a.text}`);
      const go = () => {
        if (!ov.isConnected) return;
        box.appendChild(c);
        if (!instant && !rm && c.animate) {
          const d = deck.getBoundingClientRect(), r = c.getBoundingClientRect();
          const dx = d.left + d.width / 2 - (r.left + r.width / 2), dy = d.top + d.height / 2 - (r.top + r.height / 2);
          anims.push(c.animate([
            { transform: `translate(${dx}px, ${dy}px) rotateY(180deg) rotate(${(i % 2 ? 8 : -8)}deg) scale(0.7)`, opacity: 1 },
            { transform: `translate(${dx * 0.35}px, ${dy * 0.35 - 30}px) rotateY(110deg) rotate(${(i % 2 ? 4 : -4)}deg) scale(0.95)`, opacity: 1, offset: 0.55 },
            { transform: 'translate(0, 0) rotateY(0deg) rotate(0deg) scale(1)', opacity: 1 },
          ], { duration: 520, easing: 'cubic-bezier(0.22, 0.9, 0.25, 1)' }));
          audio.deal(i);
          if (a.player === me) haptic('card');
        } else c.classList.add('fade');
      };
      if (instant) go(); else timers.push(window.setTimeout(go, i * 300));
    });
    const after = instant ? 0 : list.length * 300 + 500;
    timers.push(window.setTimeout(() => ov.classList.add('dealt'), after));
  };
  const awards = o.results().then(r => dealAwards(st, r)).catch(() => dealAwards(st, []));
  at(() => { void awards.then(list => { if (!finished) deal(list, false); }); }, 2500);

  // ---- skip: everything to its final place
  const finish = () => {
    if (finished) return;
    finished = true;
    for (const a of anims) { try { a.finish(); } catch { /* */ } }
    timers.forEach(t => clearTimeout(t));
    ov.classList.add('lit', 'banners', 'titled', 'skip');
    const { ang, len } = aim();
    lamp.getAnimations?.().forEach(a => a.cancel());
    lamp.style.setProperty('--len', `${Math.round(len)}px`);
    lamp.style.transform = `rotate(${ang}deg)`;
    for (const el of ov.querySelectorAll<HTMLElement>('[data-cvp]')) el.textContent = String(st.players[Number(el.dataset.cvp)].vp);
    void awards.then(list => { deal(list, true); ov.classList.add('dealt'); });
  };
  ov.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('button');
    if (b) return;
    finish();
  });
  const key = (e: KeyboardEvent) => {
    if (!ov.isConnected) { window.removeEventListener('keydown', key, true); return; }
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'Escape') {
      const t = e.target as HTMLElement | null;
      if (t?.tagName === 'BUTTON' && e.key !== 'Escape') return;
      e.preventDefault(); e.stopPropagation();
      if (!ov.classList.contains('dealt') && !finished) finish();
      else if (e.key === 'Escape') { ov.remove(); o.onLook(); }
    }
  };
  window.addEventListener('keydown', key, true);
  ov.addEventListener('fx-removed', () => { window.removeEventListener('keydown', key, true); timers.forEach(t => clearTimeout(t)); });
  ov.querySelector('[data-x]')!.addEventListener('click', () => { ov.remove(); o.onLook(); });
  ov.querySelector('[data-saga]')?.addEventListener('click', () => { ov.remove(); o.onSaga?.(); });
  ov.querySelector('[data-l]')!.addEventListener('click', () => { ov.remove(); o.onLobby(); });
  return ov;
}

/** Count a banner's VP up to its final value (the true number throughout: before → after). */
function countUp(el: HTMLElement, to: number) {
  const from = Number(el.dataset.from ?? to);
  if (from === to || reduced()) { el.textContent = String(to); return; }
  const t0 = performance.now(), dur = Math.min(1400, 300 + Math.abs(to - from) * 120);
  let last = from;
  const step = () => {
    if (!el.isConnected) return;
    const t = Math.min(1, (performance.now() - t0) / dur);
    const v = Math.round(from + (to - from) * (1 - (1 - t) ** 3));
    if (v !== last) { last = v; el.textContent = String(v); audio.coin(Math.abs(v - from), { vol: 0.5 }); }
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
