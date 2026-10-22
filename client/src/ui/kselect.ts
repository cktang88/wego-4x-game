// The kit's select (ART-BIBLE §5): the closed control is the native <select> restyled as an engraved steel plate
// (theme.css), so forms, labels, tests and screen readers keep working; opening it shows the list as a vellum slip
// instead of the browser's native popup. Keyboard: Enter / Space / Alt+Down open it; arrows, Home / End, letters
// move; Enter picks; Esc or a click elsewhere closes. The pick sets the value and fires `input` + `change`.
import { esc } from './dom.ts';

let open: { sel: HTMLSelectElement; list: HTMLElement; off: () => void } | null = null;

function close(focus = true) {
  if (!open) return;
  const { sel, list, off } = open;
  open = null;
  off();
  list.remove();
  sel.setAttribute('aria-expanded', 'false');
  if (focus) sel.focus({ preventScroll: true });
}

function pick(sel: HTMLSelectElement, i: number) {
  if (i < 0 || i >= sel.options.length || sel.options[i].disabled) return;
  const changed = sel.selectedIndex !== i;
  sel.selectedIndex = i;
  if (changed) {
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function show(sel: HTMLSelectElement) {
  close(false);
  const list = document.createElement('div');
  list.className = 'k-slip ksel-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', sel.getAttribute('aria-label') || sel.labels?.[0]?.textContent || 'Choose');
  list.innerHTML = [...sel.options].map((o, i) =>
    `<button type="button" role="option" class="ksel-opt" data-i="${i}" aria-selected="${o.selected}"${o.disabled ? ' disabled' : ''}>${esc(o.text)}</button>`).join('');
  document.body.appendChild(list);
  // place it under the plate (above it when there is no room), never off screen
  const r = sel.getBoundingClientRect();
  const vw = innerWidth, vh = innerHeight;
  const w = Math.min(Math.max(r.width, 12 * 16), vw - 16);
  list.style.width = `${w}px`;
  list.style.left = `${Math.max(8, Math.min(r.left, vw - w - 8))}px`;
  const h = list.offsetHeight;
  const below = vh - r.bottom - 8, above = r.top - 8;
  if (h <= below || below >= above) { list.style.top = `${r.bottom + 4}px`; list.style.maxHeight = `${Math.max(120, below - 4)}px`; }
  else { list.style.top = `${Math.max(8, r.top - 4 - Math.min(h, above))}px`; list.style.maxHeight = `${above - 4}px`; }
  sel.setAttribute('aria-expanded', 'true');
  const opts = () => [...list.querySelectorAll<HTMLButtonElement>('.ksel-opt:not([disabled])')];
  (list.querySelector<HTMLButtonElement>('[aria-selected=true]') ?? opts()[0])?.focus({ preventScroll: true });
  list.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' });
  list.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.ksel-opt');
    if (!b || b.disabled) return;
    pick(sel, Number(b.dataset.i));
    close();
  });
  list.addEventListener('keydown', e => {
    const all = opts(), cur = all.indexOf(document.activeElement as HTMLButtonElement);
    const go = (k: number) => { e.preventDefault(); all[Math.max(0, Math.min(all.length - 1, k))]?.focus(); };
    if (e.key === 'ArrowDown') go(cur + 1);
    else if (e.key === 'ArrowUp') go(cur - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(all.length - 1);
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') close();
    else if (e.key.length === 1 && /\S/.test(e.key)) {
      const k = all.findIndex((b, i) => i > cur && b.textContent!.toLowerCase().startsWith(e.key.toLowerCase()));
      const k0 = k >= 0 ? k : all.findIndex(b => b.textContent!.toLowerCase().startsWith(e.key.toLowerCase()));
      if (k0 >= 0) go(k0);
    }
  });
  const outside = (e: Event) => { if (!list.contains(e.target as Node) && e.target !== sel) close(false); };
  const away = (e?: Event) => { if (e?.type === 'scroll' && list.contains(e.target as Node)) return; close(false); };
  setTimeout(() => document.addEventListener('pointerdown', outside, true));
  window.addEventListener('resize', away);
  window.addEventListener('scroll', away, true);
  open = { sel, list, off: () => { document.removeEventListener('pointerdown', outside, true); window.removeEventListener('resize', away); window.removeEventListener('scroll', away, true); } };
}

/** Give every <select> under `root` the vellum list. Idempotent. */
export function enhanceSelects(root: ParentNode) {
  root.querySelectorAll<HTMLSelectElement>('select:not([data-ksel])').forEach(sel => {
    if (sel.multiple || sel.size > 1) return;
    sel.dataset.ksel = '1';
    sel.setAttribute('aria-haspopup', 'listbox');
    sel.setAttribute('aria-expanded', 'false');
    sel.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      sel.focus({ preventScroll: true });
      if (open?.sel === sel) close(); else show(sel);
    });
    // touch: the tap's mousedown is synthesised after touchend; claim the tap first so the native picker never opens.
    // A swipe that merely starts on the plate scrolls the page: it must not open the list.
    let t0: { x: number; y: number } | null = null;
    sel.addEventListener('touchstart', e => { const t = e.touches[0]; t0 = e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY } : null; }, { passive: true });
    sel.addEventListener('touchmove', e => { const t = e.touches[0]; if (t0 && t && Math.hypot(t.clientX - t0.x, t.clientY - t0.y) > 10) t0 = null; }, { passive: true });
    sel.addEventListener('touchend', e => {
      const tap = t0 !== null && e.cancelable;
      t0 = null;
      if (!tap) return;
      e.preventDefault(); sel.focus({ preventScroll: true }); if (open?.sel === sel) close(); else show(sel);
    }, { passive: false });
    sel.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ' || (e.altKey && e.key === 'ArrowDown') || e.key === 'F4') { e.preventDefault(); show(sel); }
    });
  });
}
