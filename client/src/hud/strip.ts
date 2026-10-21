// The plan strip and the primary button (docs/UX-V2.md §3 "Plan strip", §4 "Turn flow").
// WEGO: five order chips (icon + 2-word target; an empty slot is a dashed outline), undo, preview, free
// changes as a small chip. All of a turn's orders resolve together, so order in the strip doesn't matter.
// LIVE: bank pips, "+1 in 3m", and the orders queued for the next tick. During a replay: a replay bar.
import type { GameScreen } from '../game.ts';
import type { Order } from '../../../shared/sim/types.ts';
import { LocalSource } from '../net.ts';
import { LAW } from '../../../shared/config/empire.ts';
import { nextTickAt } from '../../../shared/sim/live.ts';
import { esc } from '../ui/dom.ts';
import { ORDER_ICON, shortName, tip, romanN, fmtClock } from './util.ts';
import { ic, icFor } from '../art/icons.ts';

/** Two words for an order chip: what it targets. */
export function orderTarget(g: GameScreen, o: Order): string {
  const st = g.st;
  const rn = (id: number) => shortName(st.regions[id]?.name ?? '?', 2);
  const fn = (id: number) => shortName(g.fleet(id)?.name ?? 'fleet', 2);
  switch (o.type) {
    case 'move': return rn(o.path[o.path.length - 1]);
    case 'seize': return rn(o.target);
    case 'build': return st.rules.ships[o.cls]?.name ?? o.cls;
    case 'develop': return shortName(st.rules.projects[o.project]?.name ?? o.project, 2);
    case 'fortify': case 'excavate': case 'refit': return fn(o.fleet);
    case 'influence': case 'scan': case 'feint': return rn(o.target);
    case 'conceal': return 'Conceal';
    case 'pact': return shortName(g.pname(o.with), 1);
    case 'law': return shortName(LAW[o.law]?.name ?? o.law, 2);
  }
  const any = o as { type: string; region?: number; fleet?: number };
  if (typeof any.region === 'number') return rn(any.region);
  if (typeof any.fleet === 'number') return fn(any.fleet);
  return ORDER_INFO_NAME(any.type);
}
const ORDER_INFO_NAME = (t: string) => t[0].toUpperCase() + t.slice(1);
const freeIcon = (t: string) => ic(icFor('free', t));
const X = ic('close');

export function renderStrip(g: GameScreen, el: HTMLElement) {
  const st = g.st;
  let html = '';
  if (g.blockingReplay && g.replay) {
    const R = g.replay;
    const pct = R.beats.length ? Math.round(((R.i + Math.min(1, R.prog)) / R.beats.length) * 100) : 0;
    html = `<div class="replaybar"><span class="lbl">${R.preview ? `${ic('eye')} Preview` : g.live ? `${ic('replay')} Tick` : `${ic('replay')} Turn ${R.result.turn}`}</span><div class="prog"><i style="width:${pct}%"></i></div>
      <button data-r="pause" aria-label="${R.playing ? 'Pause' : 'Play'}">${R.playing ? ic('pause') : ic('play')}</button><button data-r="speed" aria-label="Speed">${R.speed}×</button><button data-r="skip"${tip('Skip · Space')} aria-label="Skip">${ic('skip')}</button></div>`;
  } else if (g.you === null || !g.canPlan) {
    html = '';
  } else if (g.live) {
    const cap = st.rules.live.bankCap;
    const next = st.live!.nextOrderAt[g.you] ?? 0;
    const pips = Array.from({ length: cap }, (_, i) => `<i class="pip ${i < g.bank ? 'on' : ''}"></i>`).join('');
    const q = g.queue.map((o, i) => `<div class="chip filled live" data-live="${i}" data-pop="liveq:${i}:${o.type}:${'fleet' in o ? o.fleet : ''}"><i class="oic">${ORDER_ICON[o.type]}</i><span class="t">${esc(orderTarget(g, o))}</span><button class="x" data-x="${i}" aria-label="Take back">${X}</button></div>`).join('');
    html = `<div class="bank ${g.bank >= cap ? 'full' : ''} ${g.bank > 0 ? 'has' : ''}"${tip(g.bank >= cap ? 'Bank full: spend one' : 'Orders banked')}><span class="pips">${pips}</span><small>${g.bank >= cap ? 'full' : `+1 <b data-countdown="${next}"></b>`}</small></div>
      ${q ? `<div class="slots">${q}</div>` : ''}${g.queue.length ? `<button class="sbtn" data-act="undo"${tip('Take back last · Ctrl+Z')} aria-label="Undo">${ic('undo')}</button>` : ''}`;
  } else {
    const n = g.plan.orders.length;
    const rep = g.replacing;
    const chips = g.plan.orders.map((o, i) => {
      if (!o) return `<div class="chip empty ${g.targetSlot === i ? 'target' : ''}" data-slot="${i}" aria-label="Empty slot"><small>${romanN(i + 1)}</small></div>`;
      const err = g.validateAt(o, i);
      const hot = g.hoverSlot === i;
      return `<div class="chip filled k-${o.type} ${err ? 'bad' : ''} ${rep ? 'replace' : ''} ${hot ? 'hot' : ''}" data-slot="${i}" data-pop="slots:${i}:${o.type}:${'fleet' in o ? o.fleet : ''}"${err ? tip(`⊘ ${err}`) : ''}><i class="oic">${ORDER_ICON[o.type]}</i><span class="t">${esc(orderTarget(g, o))}</span>${o.type === 'seize' && o.also?.length ? `<sup>+${o.also.length}</sup>` : ''}<button class="x" data-x="${i}" aria-label="Remove">${X}</button></div>`;
    }).join('');
    const free = g.plan.free;
    const freeChip = free.length ? `<button class="chip freec" data-act="free"${tip('Free changes')}>${[...new Set(free.map(f => f.type))].slice(0, 3).map(freeIcon).join('')}<small>${free.length}</small></button>` : '';
    const used = g.plan.orders.filter(Boolean).length;
    html = `${rep ? `<div class="replace-hint">Replace which?<button data-act="cancelrep" aria-label="Cancel">${X}</button></div>` : ''}<div class="slots" style="--n:${n}">${chips}</div>${freeChip}
      <div class="sbtns"><button class="sbtn" data-act="undo" ${g.undoStack.length ? '' : 'disabled'}${tip('Undo · Ctrl+Z')} aria-label="Undo">${ic('undo')}</button><button class="sbtn" data-preview ${used ? '' : 'disabled'}${tip('Preview vs idle rivals')} aria-label="Preview">${ic('eye')}</button></div>`;
  }
  g.root.classList.toggle('no-strip', !html);
  if (!g.setHtml(el, html)) g.tickClocks();
  // the open free-changes list follows the plan
  const list = el.querySelector('.freelist');
  if (list && !g.plan.free.length) list.remove();
}

export function renderPrimary(g: GameScreen, el: HTMLElement) {
  const st = g.st;
  let html = '';
  const btn = (cls: string, attrs: string, inner: string) => `<button class="pbtn ${cls}" ${attrs}>${inner}</button>`;
  if (g.blockingReplay) html = '';
  else if (st.winner !== null) html = btn('gold', 'data-p="results"', `${ic('crown')} Results`);
  else if (g.watching) {
    html = btn('', 'data-x="next"', `Next ${ic('play')}`) + `<button class="pmini ${g.autoPlay ? 'on' : ''}" data-x="auto"${tip('Auto play')} aria-label="Auto">${ic('fast')}</button>`;
  } else if (g.you === null || st.players[g.you]?.eliminated) html = '';
  else if (g.live) {
    const idle = g.idleFleets();
    if (idle.length) html = btn('idle', 'data-p="idle"', `${ic('dormant')} Idle ×${idle.length}`);
    else if (g.canResearchNow()) html = btn('research', 'data-p="research"', `${ic('research')} Research`);
    else html = btn('clock', 'data-p="tick" disabled', `${ic('time')} <b data-countdown="${nextTickAt(st)}">${fmtClock(nextTickAt(st) - Date.now())}</b>`);
  } else if (g.submitted) {
    const seats = g.src.meta.seats;
    const pips = st.players.map(p => `<i class="sp ${seats[p.id]?.submitted ? 'on' : ''}" style="--pc:${esc(p.color)}"></i>`).join('');
    html = btn('waiting', 'data-p="waiting" disabled', `Waiting <span class="sps">${pips}</span>`) + `<button class="pmini" data-unsubmit${tip('Unseal')} aria-label="Unseal">${ic('undo')}</button>`;
  } else {
    const n = g.plan.orders.length, used = g.plan.orders.filter(Boolean).length;
    const idle = g.idleFleets();
    const full = used === n;
    if (idle.length && !full) html = btn('idle', 'data-p="idle"', `${ic('dormant')} Idle ×${idle.length}`) + `<button class="pmini seal" data-submit${tip('Seal now · Enter')} aria-label="Seal">${ic('check')}</button>`;
    else if (g.canResearchNow()) html = btn('research', 'data-p="research"', `${ic('research')} Research`) + `<button class="pmini seal" data-submit${tip('Seal now · Enter')} aria-label="Seal">${ic('check')}</button>`;
    else html = btn(`seal ${full || !idle.length ? 'ready' : ''}`, 'data-submit', `SEAL ${ic('check')}<small>${used}/${n}</small>`);
  }
  g.root.classList.toggle('no-prim', !html);
  g.setHtml(el, html);
}

export function bindStrip(g: GameScreen, strip: HTMLElement, prim: HTMLElement) {
  // ---- primary
  prim.addEventListener('click', e => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!t) return;
    const local = g.src instanceof LocalSource ? g.src : null;
    if (t.hasAttribute('data-submit')) { g.submit(e.shiftKey); return; }
    if (t.hasAttribute('data-unsubmit')) { g.src.unsubmit(); return; }
    if (e.shiftKey && !g.live && !g.submitted && g.canPlan) { g.submit(true); return; }
    switch (t.dataset.p ?? t.dataset.x) {
      case 'idle': g.nextIdle(); break;
      case 'research': g.openModal('empire', 'research'); break;
      case 'results': g.victoryShown = false; g.showVictory(); break;
      case 'next': if (!g.replay && local) local.advance(); break;
      case 'auto': g.autoPlay = !g.autoPlay; if (g.autoPlay && !g.replay && local) local.advance(); g.renderAll(); break;
    }
  });
  // ---- strip: clicks
  strip.addEventListener('click', e => {
    const t = e.target as HTMLElement;
    const r = t.closest<HTMLElement>('[data-r]');
    if (r && g.replay) {
      const R = g.replay;
      if (r.dataset.r === 'pause') g.togglePause();
      if (r.dataset.r === 'speed') { g.replaySpeed = R.speed = R.speed >= 4 ? 1 : R.speed * 2; g.renderAll(); }
      if (r.dataset.r === 'skip') g.endReplay();
      return;
    }
    if (t.closest('[data-preview]')) { g.preview(); return; }
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'undo') { g.undo(); return; }
    if (act === 'cancelrep') { g.replacing = null; g.renderAll(); return; }
    if (act === 'free') { toggleFreeList(g, strip); return; }
    const df = t.closest<HTMLElement>('[data-delfree]');
    if (df) { g.removeFree(Number(df.dataset.delfree)); return; }
    const x = t.closest<HTMLElement>('[data-x]');
    if (x) { e.stopPropagation(); g.removeOrder(Number(x.dataset.x)); return; }
    const chip = t.closest<HTMLElement>('[data-slot]');
    if (chip) {
      const i = Number(chip.dataset.slot);
      if (g.replacing) { g.replaceWith(i); return; }
      const o = g.plan.orders[i];
      if (!o) { g.nextIdle(); return; }
      focusOrder(g, o);
      return;
    }
    const lq = t.closest<HTMLElement>('[data-live]');
    if (lq) { const o = g.queue[Number(lq.dataset.live)]; if (o) focusOrder(g, o); }
  });
  strip.addEventListener('contextmenu', e => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>('[data-slot], [data-live]');
    if (!chip) return;
    e.preventDefault();
    g.removeOrder(Number(chip.dataset.slot ?? chip.dataset.live));
  });
  // ---- hover: light the order's arrow
  strip.addEventListener('pointerover', e => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>('[data-slot]');
    const i = chip && g.plan.orders[Number(chip.dataset.slot)] ? Number(chip.dataset.slot) : null;
    if (i !== g.hoverSlot) { g.hoverSlot = i; strip.querySelectorAll('.chip.hot').forEach(c => c.classList.remove('hot')); if (chip && i !== null) chip.classList.add('hot'); }
  });
  strip.addEventListener('pointerleave', () => { g.hoverSlot = null; strip.querySelectorAll('.chip.hot').forEach(c => c.classList.remove('hot')); });
  // ---- flick a chip up to remove it (window listeners only while a chip is held)
  strip.addEventListener('pointerdown', e => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>('.chip.filled');
    if (!chip || (e.target as HTMLElement).closest('button')) return;
    const f = { id: e.pointerId, y: e.clientY, el: chip, slot: Number(chip.dataset.slot ?? chip.dataset.live) };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== f.id) return;
      const dy = Math.min(0, ev.clientY - f.y);
      f.el.style.transform = dy < -4 ? `translateY(${dy}px)` : '';
      f.el.style.opacity = dy < -4 ? String(Math.max(0.2, 1 + dy / 80)) : '';
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== f.id) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      f.el.style.transform = ''; f.el.style.opacity = '';
      if (ev.clientY - f.y < -36) { g.tipHeldUntil = performance.now() + 300; g.removeOrder(f.slot); }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  });
}

/** Select what an order is about and bring it into view. */
function focusOrder(g: GameScreen, o: Order) {
  const st = g.st;
  if ('fleet' in o && o.type !== 'build') { const f = g.fleet(o.fleet); if (f) { g.select({ kind: 'fleet', id: f.id }); g.focus(st.regions[f.region].site); return; } }
  const rid = 'region' in o ? o.region : 'target' in o ? o.target : null;
  if (rid !== null && st.regions[rid]) { g.select({ kind: 'region', id: rid }); g.focus(st.regions[rid].site); return; }
  if (o.type === 'law') g.openModal('empire', 'laws');
  if (o.type === 'pact') g.openModal('score');
}

function toggleFreeList(g: GameScreen, strip: HTMLElement) {
  const old = strip.querySelector('.freelist');
  if (old) { old.remove(); return; }
  const box = document.createElement('div');
  box.className = 'freelist';
  box.innerHTML = g.plan.free.map((f, i) => `<div class="fr"><i>${freeIcon(f.type)}</i><span>${esc(g.freeText(f))}</span>${g.canPlan ? `<button data-delfree="${i}" aria-label="Remove">${X}</button>` : ''}</div>`).join('');
  strip.appendChild(box);
}
