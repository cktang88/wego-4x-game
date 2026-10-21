// Full-screen modals over the (dimmed, still visible) board: Empire (research / laws / ships),
// Score (players, diplomacy, edicts, intel, chat), Chronicle and Help. docs/UX-V2.md §5–§6.
//
// API for the shell (game.ts):
//   openModal(screen, 'empire' | 'score' | 'chronicle' | 'help', tab?)   open, or switch to, a modal
//   closeModal()       close it (animated)
//   isModalOpen()      whether one is open
//   refreshModal()     re-render from the current game state (call from onSourceChange / after renders)
// While open the modal owns the keyboard: Esc closes, E / Q / C / ? switch modals (the open one's key
// closes it), 1–5 pick a tab. Phones get a full-screen sheet that closes on a swipe down.
import '../modals.css';
import type { GameScreen } from '../game.ts';
import { battleViewerOpen } from '../render/battle.ts';
import { type Ctx, type Host, type ModalName, ui, esc } from './modal-util.ts';
import { EMPIRE_TABS, empireHead, empireBody, empireAfter, empireAct } from './modal-empire.ts';
import { scoreHead, scoreBody, scoreAct, sendChat } from './modal-score.ts';
import { CHRON_FILTERS, chronicleHead, chronicleBody, chronicleAct } from './modal-chronicle.ts';
import { HELP_TABS, helpBody, helpAct } from './modal-help.ts';
import { iconizeHtml, ic } from '../art/icons.ts';

export type { ModalName } from './modal-util.ts';

const META: Record<ModalName, { icon: string; title: string; key: string; tabs: [string, string, string][] }> = {
  empire: { icon: '✺', title: 'Empire', key: 'E', tabs: EMPIRE_TABS },
  score: { icon: '♛', title: 'Score', key: 'Q', tabs: [] },
  chronicle: { icon: ic('chronicle'), title: 'Chronicle', key: 'C', tabs: [] },
  help: { icon: ic('help'), title: 'Help', key: '?', tabs: HELP_TABS },
};
const ORDER: ModalName[] = ['empire', 'score', 'chronicle', 'help'];

interface Open {
  g: Host;
  name: ModalName;
  root: HTMLElement;
  panel: HTMLElement;
  head: HTMLElement;
  body: HTMLElement;
  html: { head: string; body: string };
}
let cur: Open | null = null;

const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const tabOf = (name: ModalName) => {
  const tabs = META[name].tabs;
  const t = ui.tabs[name];
  return tabs.length ? (tabs.some(x => x[0] === t) ? t : tabs[0][0]) : '';
};

function ctx(o: Open): Ctx {
  return {
    g: o.g, name: o.name, tab: tabOf(o.name),
    rerender: () => render(),
    close: () => closeModal(),
    acted: () => { try { o.g.renderAll(); } catch (e) { console.error(e); } render(); },
  };
}

// ====================================================================== public API
export function openModal(screen: GameScreen, name: ModalName, tab?: string): void {
  const g = screen as unknown as Host;
  if (!META[name]) return;
  if (tab && META[name].tabs.some(x => x[0] === tab)) ui.tabs[name] = tab;
  if (cur && cur.g !== g) { teardown(cur, true); cur = null; }
  if (cur) {
    if (cur.name !== name) { cur.name = name; cur.body.scrollTop = 0; }
    render(true);
    return;
  }
  build(g, name);
}

export function closeModal(): void {
  const o = cur;
  if (!o) return;
  cur = null;
  teardown(o, reduced());
  try { o.g.renderAll(); } catch { /* the shell may be gone */ }
}

export function isModalOpen(): boolean { return cur !== null; }

export function refreshModal(): void {
  if (!cur) return;
  const root = (cur.g as unknown as { root?: HTMLElement }).root;
  if (root && !root.isConnected) { closeModal(); return; }
  render();
}

// ====================================================================== frame
function build(g: Host, name: ModalName) {
  const root = document.createElement('div');
  root.className = 'mdl-root';
  root.innerHTML = `<div class="mdl-back" data-a="close"></div><section class="mdl" role="dialog" aria-modal="true"><div class="mdl-grip" aria-hidden="true"><i></i></div><header class="mdl-head"></header><div class="mdl-body"></div></section>`;
  document.body.appendChild(root);
  const o: Open = { g, name, root, panel: root.querySelector('.mdl')!, head: root.querySelector('.mdl-head')!, body: root.querySelector('.mdl-body')!, html: { head: '', body: '' } };
  cur = o;
  root.addEventListener('click', onClick);
  root.addEventListener('submit', e => { e.preventDefault(); if (cur) sendChat(ctx(cur)); });
  root.addEventListener('input', e => {
    const t = e.target as HTMLInputElement;
    if (t.matches('[data-chat-msg]')) ui.chatDraft = t.value;
    if (t.matches('[data-pact-words]')) ui.pactWords[Number(t.dataset.pactWords)] = t.value;
  });
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);
  bindSwipe(o);
  render(true);
  if (reduced()) root.classList.add('show');
  else requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('show')));
  setTimeout(() => o.panel.querySelector<HTMLElement>('.mdl-x')?.focus({ preventScroll: true }), 30);
}

function teardown(o: Open, instant: boolean) {
  window.removeEventListener('keydown', onKey, true);
  window.removeEventListener('resize', onResize);
  if (instant) { o.root.remove(); return; }
  o.root.classList.remove('show');
  o.root.classList.add('hide');
  o.root.style.pointerEvents = 'none';
  setTimeout(() => o.root.remove(), 240);
}

function headHtml(o: Open, c: Ctx): string {
  const m = META[o.name];
  const tabs = m.tabs.length ? `<nav class="mh-tabs" role="tablist">${m.tabs.map(([id, ic, n], i) => `<button class="mt ${c.tab === id ? 'on' : ''}" data-a="tab" data-id="${id}" role="tab" aria-selected="${c.tab === id}"><i>${ic}</i><span>${n}</span><kbd>${i + 1}</kbd></button>`).join('')}</nav>` : '';
  const extra = o.name === 'empire' ? empireHead(c) : o.name === 'score' ? scoreHead(c) : o.name === 'chronicle' ? chronicleHead(c) : '';
  const sw = `<nav class="mh-sw" aria-label="Screens">${ORDER.map(n => `<button class="sw ${n === o.name ? 'on' : ''}" data-a="modal" data-id="${n}" title="${META[n].title} (${META[n].key})" aria-label="${META[n].title}">${META[n].icon}</button>`).join('')}</nav>`;
  // without tabs the extras (chat button, filters) sit in the title row; phones wrap them under it
  if (!tabs) return `<div class="mh-top"><h1 class="mh-title"><i>${m.icon}</i>${esc(m.title)}</h1>${extra ? `<div class="mh-extra in-top">${extra}</div>` : ''}${sw}<button class="mx mdl-x" data-a="close" aria-label="Close (Esc)">×</button></div>`;
  return `<div class="mh-top"><h1 class="mh-title"><i>${m.icon}</i>${esc(m.title)}</h1>${sw}<button class="mx mdl-x" data-a="close" aria-label="Close (Esc)">×</button></div>
    <div class="mh-bar">${tabs}<div class="mh-extra">${extra}</div></div>`;
}

function bodyHtml(o: Open, c: Ctx): string {
  switch (o.name) {
    case 'empire': return empireBody(c);
    case 'score': return scoreBody(c);
    case 'chronicle': return chronicleBody(c);
    case 'help': return helpBody(c);
  }
}

/** Re-render head and body (only what changed), keeping scroll, focus and the caret. */
function render(force = false) {
  const o = cur;
  if (!o) return;
  const c = ctx(o);
  o.root.dataset.modal = o.name;
  o.root.dataset.tab = c.tab;
  let head = '', body = '';
  try { head = headHtml(o, c); body = bodyHtml(o, c); } catch (e) { console.error(e); body = `<div class="m-empty">Could not show this screen</div>`; }
  const act = document.activeElement as HTMLElement | null;
  const keep = act && o.root.contains(act) ? act.dataset.keep ?? null : null;
  const sel = keep && act instanceof HTMLInputElement ? [act.selectionStart, act.selectionEnd] : null;
  const scrolls = new Map<string, { top: number; left: number; bottom: boolean }>();
  o.root.querySelectorAll<HTMLElement>('[data-keep],.rx-tree,.sx,.chron').forEach(el => {
    const k = el.dataset.keep ?? el.className.split(' ')[0];
    scrolls.set(k, { top: el.scrollTop, left: el.scrollLeft, bottom: el.scrollTop + el.clientHeight >= el.scrollHeight - 4 });
  });
  if (force || head !== o.html.head) { o.head.innerHTML = iconizeHtml(head); o.html.head = head; }
  const changed = force || body !== o.html.body;
  if (changed) {
    o.panel.querySelectorAll(':scope > .chat').forEach(x => x.remove());
    o.body.innerHTML = iconizeHtml(body); o.html.body = body;
    // the chat drawer belongs to the panel (beside the scrolling body, under the header)
    const chat = o.body.querySelector<HTMLElement>('.chat');
    if (chat) o.panel.appendChild(chat);
  }
  o.panel.style.setProperty('--chat-top', `${o.head.offsetTop + o.head.offsetHeight}px`);
  if (changed || force) {
    o.root.querySelectorAll<HTMLElement>('[data-keep],.rx-tree,.sx,.chron').forEach(el => {
      const k = el.dataset.keep ?? el.className.split(' ')[0];
      const s = scrolls.get(k);
      if (k === 'chat-log') { el.scrollTop = !s || s.bottom ? el.scrollHeight : s.top; return; }
      if (s) { el.scrollTop = s.top; el.scrollLeft = s.left; }
    });
    if (keep) {
      const el = o.root.querySelector<HTMLElement>(`[data-keep="${keep}"]`);
      if (el && document.activeElement !== el) {
        el.focus({ preventScroll: true });
        if (sel && el instanceof HTMLInputElement) try { el.setSelectionRange(sel[0], sel[1]); } catch { /* */ }
      }
    }
    after(o, c);
  }
}

function after(o: Open, c: Ctx) {
  if (o.name === 'empire') empireAfter(c, o.body);
}
function onResize() { if (cur) after(cur, ctx(cur)); }

// ====================================================================== input
function onClick(e: MouseEvent) {
  const o = cur;
  if (!o) return;
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
  if (!el || !o.root.contains(el) || (el as HTMLButtonElement).disabled) return;
  const a = el.dataset.a!, id = el.dataset.id ?? '';
  const c = ctx(o);
  switch (a) {
    case 'close': closeModal(); return;
    case 'modal': if (id === o.name) closeModal(); else { o.name = id as ModalName; o.body.scrollTop = 0; render(true); } return;
    case 'tab': ui.tabs[o.name] = id; ui.tech = null; o.body.scrollTop = 0; render(true); return;
    case 'region': {
      const r = o.g.st.regions[Number(id)];
      if (!r) return;
      closeModal();
      o.g.select?.({ kind: 'region', id: r.id });
      o.g.focus?.(r.site);
      try { o.g.renderAll(); } catch { /* */ }
      return;
    }
  }
  if (o.name === 'empire' && empireAct(c, a, el)) return;
  if (o.name === 'score' && scoreAct(c, a, el)) return;
  if (o.name === 'chronicle' && chronicleAct(c, a, el)) return;
  if (o.name === 'help' && helpAct(c, a)) return;
}

const KEY_MODAL: Record<string, ModalName> = { e: 'empire', q: 'score', c: 'chronicle', '?': 'help', '/': 'help', h: 'help' };

function onKey(e: KeyboardEvent) {
  const o = cur;
  if (!o) return;
  // something on top of the modal (battle viewer, a confirm dialog) owns the keyboard
  if (battleViewerOpen() || document.querySelector('.overlay:not(.overlay-ghost)')) return;
  const t = e.target as HTMLElement | null;
  const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  if (e.key === 'Escape') {
    e.stopPropagation(); e.preventDefault();
    if (o.name === 'empire' && ui.tech) { ui.tech = null; render(); return; }
    if (typing && ui.chatOpen) { ui.chatOpen = false; render(); return; }
    closeModal();
    return;
  }
  e.stopPropagation();            // the board underneath must not react to keys while a modal is up
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const m = KEY_MODAL[k];
  if (m) {
    e.preventDefault();
    if (m === o.name) closeModal(); else { o.name = m; o.body.scrollTop = 0; render(true); }
    return;
  }
  if (/^[1-9]$/.test(k)) {
    const i = Number(k) - 1;
    if (o.name === 'chronicle') { const f = CHRON_FILTERS[i]; if (f) { ui.chronFilter = f[0] as typeof ui.chronFilter; render(); } return; }
    const tabs = META[o.name].tabs;
    if (tabs[i]) { e.preventDefault(); ui.tabs[o.name] = tabs[i][0]; ui.tech = null; o.body.scrollTop = 0; render(true); }
  }
}

/** Phones: drag the sheet down by its grip / header to close it. */
function bindSwipe(o: Open) {
  let y0 = 0, t0 = 0, dy = 0, active = false, id = -1;
  const start = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' || !window.matchMedia('(max-width: 700px)').matches) return;
    if ((e.target as HTMLElement).closest('button, input, select')) return;
    active = true; id = e.pointerId; y0 = e.clientY; t0 = performance.now(); dy = 0;
    o.panel.style.transition = 'none';
  };
  const move = (e: PointerEvent) => {
    if (!active || e.pointerId !== id) return;
    dy = Math.max(0, e.clientY - y0);
    o.panel.style.transform = `translateY(${dy}px)`;
  };
  const end = (e: PointerEvent) => {
    if (!active || e.pointerId !== id) return;
    active = false;
    o.panel.style.transition = '';
    const v = dy / Math.max(1, performance.now() - t0);
    if (dy > 110 || (dy > 40 && v > 0.6)) { o.panel.style.transform = `translateY(${dy}px)`; requestAnimationFrame(() => { o.panel.style.transform = ''; closeModal(); }); }
    else o.panel.style.transform = '';
  };
  o.root.querySelector<HTMLElement>('.mdl-grip')!.addEventListener('pointerdown', start);
  // the header's title row (not its scrollable tab / filter bar) is a drag handle too
  o.head.addEventListener('pointerdown', e => { if ((e.target as HTMLElement).closest('.mh-top')) start(e); });
  window.addEventListener('pointermove', move, { passive: true });
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  // listeners go when the modal goes
  const mo = new MutationObserver(() => {
    if (!o.root.isConnected) { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); mo.disconnect(); }
  });
  mo.observe(document.body, { childList: true });
}
