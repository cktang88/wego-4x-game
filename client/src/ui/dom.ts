export function h(tag: string, attrs: Record<string, string> = {}, html = ''): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (html) e.innerHTML = html;
  return e;
}

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Leave a non-interactive copy of `el` behind that plays an exit animation (fx.css), so removals fade instead of popping.
 * The original is removed at once, so code that checks for it (keyboard guards, tests) sees it gone immediately. */
function ghostOut(el: HTMLElement, cls: string, ms: number) {
  if (reduced() || !el.isConnected) return;
  const g = el.cloneNode(true) as HTMLElement;
  g.className = `${cls} ${el.className.split(/\s+/).filter(c => c && c !== 'overlay').map(c => `was-${c}`).join(' ')}`;
  g.setAttribute('aria-hidden', 'true');
  g.querySelectorAll('[id]').forEach(x => x.removeAttribute('id'));
  g.querySelectorAll('[data-victory]').forEach(x => x.removeAttribute('data-victory'));
  el.after(g);
  setTimeout(() => g.remove(), ms);
}

export function toast(msg: string) {
  // a newer toast replaces the old one at once (it slides in on top); an expiring one fades up and away
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = h('div', { class: 'toast' });
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => {
    if (!t.isConnected) return;
    if (!reduced()) { t.classList.add('toast-out'); setTimeout(() => t.remove(), 260); } else t.remove();
  }, 3200);
}

/** Modal overlay. Click on the backdrop closes it unless `closable` is false. */
export function overlay(html: string, closable = true): HTMLElement {
  const o = h('div', { class: 'overlay' }, html);
  if (closable) {
    o.addEventListener('click', e => { if (e.target === o) o.remove(); });
    const x = h('button', { class: 'small closex', title: 'Close (Esc)' }, '✕');
    x.addEventListener('click', () => o.remove());
    o.querySelector('.dialog')?.prepend(x);
    const esc = (e: KeyboardEvent) => {
      if (!o.isConnected) { window.removeEventListener('keydown', esc, true); return; }
      // only the topmost overlay handles Esc
      const all = document.querySelectorAll('.overlay');
      if (e.key === 'Escape' && all[all.length - 1] === o) { e.stopPropagation(); o.remove(); }
    };
    window.addEventListener('keydown', esc, true);
    o.addEventListener('fx-removed', () => window.removeEventListener('keydown', esc, true));
  }
  // however the overlay goes away (button, backdrop, route change), drop listeners and fade a ghost out.
  // The hotseat curtain is excluded: it must vanish instantly and never linger over the next player's view.
  const remove = o.remove.bind(o);
  o.remove = () => {
    if (o.isConnected && !o.classList.contains('curtain')) ghostOut(o, 'overlay-ghost', 200);
    o.dispatchEvent(new Event('fx-removed'));
    remove();
  };
  document.body.appendChild(o);
  return o;
}

export function roman(n: number): string {
  return ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n] ?? String(n);
}

// =====================================================================================
// Ambient UI motion. Panel code only has to mark elements; re-rendering with innerHTML is fine.
//
//   data-num="<stable key>"   on an element whose text contains a number (e.g. <b data-num="vp-0">12 VP</b>).
//                             When it is re-rendered with a different number under the same key, the number
//                             counts up/down to the new value and the element flashes .num-up (green) / .num-down (red).
//   data-pop="<group>:<key>"  on list items (order slots, queue entries, dock pills). When an item whose key was not
//                             there before appears in a group that was already on screen, it gets a one-shot .fx-pop.
//   .tabs + .tabbody          a click on a tab button cross-fades the tab body (automatic, no marking needed).
// =====================================================================================
interface NumState { value: number; from: number; to: number; t0: number; el: HTMLElement | null; raf: number }
const nums = new Map<string, NumState>();
let popKeys = new Set<string>();
let popGroups = new Set<string>();
let scheduled = false;

function parseNum(text: string): { n: number; pre: string; post: string; dec: number } | null {
  const m = /(-?\d[\d,]*(?:\.\d+)?)/.exec(text);
  if (!m) return null;
  const raw = m[1].replace(/,/g, '');
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return { n, pre: text.slice(0, m.index), post: text.slice(m.index + m[1].length), dec: (raw.split('.')[1] ?? '').length };
}

function scanNums() {
  const els = document.querySelectorAll<HTMLElement>('[data-num]');
  const now = performance.now();
  for (const el of els) {
    if ((el as any)._numSeen) continue;
    (el as any)._numSeen = true;
    const key = el.dataset.num!;
    const p = parseNum(el.textContent ?? '');
    if (!p) continue;
    const st = nums.get(key);
    if (!st) { nums.set(key, { value: p.n, from: p.n, to: p.n, t0: now, el, raf: 0 }); continue; }
    if (st.to === p.n) {
      // re-rendered with the same target: keep a running tween going on the new element
      st.el = el;
      if (st.raf) el.textContent = p.pre + st.value.toFixed(p.dec) + p.post;
      continue;
    }
    if (reduced() || el.closest('.hidden')) { nums.set(key, { value: p.n, from: p.n, to: p.n, t0: now, el, raf: 0 }); continue; }
    const up = p.n > st.to;
    st.from = st.value; st.to = p.n; st.t0 = now; st.el = el;
    el.classList.remove('num-up', 'num-down'); void el.offsetWidth; el.classList.add(up ? 'num-up' : 'num-down');
    const dur = Math.min(900, 380 + Math.abs(p.n - st.from) * 25);
    cancelAnimationFrame(st.raf);
    const step = () => {
      const t = Math.min(1, (performance.now() - st.t0) / dur);
      const e = 1 - (1 - t) ** 3;
      st.value = st.from + (st.to - st.from) * e;
      const cur = st.el && st.el.isConnected ? st.el : null;
      if (cur) {
        const q = parseNum(cur.textContent ?? '');
        if (q) cur.textContent = q.pre + (t >= 1 ? st.to.toFixed(q.dec) : st.value.toFixed(q.dec)) + q.post;
      }
      if (t < 1) st.raf = requestAnimationFrame(step); else { st.raf = 0; st.value = st.to; }
    };
    // show the old value on the fresh element straight away, then count
    el.textContent = p.pre + st.from.toFixed(p.dec) + p.post;
    st.raf = requestAnimationFrame(step);
  }
}

function scanPops() {
  const els = document.querySelectorAll<HTMLElement>('[data-pop]');
  const keys = new Set<string>();
  const groups = new Set<string>();
  for (const el of els) {
    const k = el.dataset.pop!;
    const g = k.split(':')[0];
    keys.add(k); groups.add(g);
    if ((el as any)._popSeen) continue;
    (el as any)._popSeen = true;
    if (!popKeys.has(k) && popGroups.has(g) && !reduced()) {
      el.classList.remove('fx-pop'); void el.offsetWidth; el.classList.add('fx-pop');
      el.addEventListener('animationend', () => el.classList.remove('fx-pop'), { once: true });
    }
  }
  popKeys = keys; popGroups = groups;
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  // run after the DOM write that triggered it, before paint
  queueMicrotask(() => { scheduled = false; scanNums(); scanPops(); });
}

/**
 * Forget every remembered number and list item: a new game (or the next hotseat player) starts from what it shows,
 * instead of counting from the previous game's VP / the previous player's resources.
 */
export function resetUiFx() {
  for (const st of nums.values()) cancelAnimationFrame(st.raf);
  nums.clear();
  popKeys = new Set();
  popGroups = new Set();
}

/** Re-scan [data-num] / [data-pop] right now (normally automatic via a MutationObserver). */
export function animateNumbers() { scanNums(); scanPops(); }

function installUiFx() {
  if (typeof document === 'undefined' || (window as any).__tcUiFx) return;
  (window as any).__tcUiFx = true;
  const mo = new MutationObserver(muts => {
    for (const m of muts) if (m.addedNodes.length) { schedule(); return; }
  });
  const start = () => mo.observe(document.body, { childList: true, subtree: true });
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
  // tab switches cross-fade the tab body
  document.addEventListener('click', e => {
    const b = (e.target as HTMLElement | null)?.closest?.('.tabs button');
    if (!b || reduced()) return;
    const body = b.closest('.panel')?.querySelector<HTMLElement>('.tabbody');
    if (!body) return;
    // after the tab's own handler re-rendered the body
    requestAnimationFrame(() => { body.classList.remove('fx-tabswap'); void body.offsetWidth; body.classList.add('fx-tabswap'); });
  }, true);
}
installUiFx();
