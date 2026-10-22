// A self-contained modal tray for the League and push modules, behaving like the game's other modals
// (QUALITY.md §6): Esc, ×, backdrop and swipe-down close it; focus is trapped inside and restored after.
import './league.css';

export interface Tray { root: HTMLElement; panel: HTMLElement; body: HTMLElement; close(): void }

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Map a house colour (whatever hex the game used) to the art bible's enamel family. */
export function enamel(color: string): 'azure' | 'crimson' | 'gilded' | 'warden' {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color.trim());
  if (!m) return 'warden';
  const [r, g, b] = m.slice(1).map(x => parseInt(x, 16) / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx - mn < 0.08) return 'warden';
  let h = mx === r ? ((g - b) / (mx - mn)) % 6 : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4;
  h = (h * 60 + 360) % 360;
  return h < 20 || h >= 330 ? 'crimson' : h < 75 ? 'gilded' : h < 260 ? 'azure' : 'warden';
}

/** Open a tray. `cls` is added to the panel for module styling; `label` names the dialog for screen readers. */
export function tray(cls: string, label: string, onClose?: () => void): Tray {
  const before = document.activeElement as HTMLElement | null;
  const root = document.createElement('div');
  root.className = 'tcl-ov';
  root.innerHTML = `<div class="k-sheet tcl-sheet ${esc(cls)}" role="dialog" aria-modal="true" aria-label="${esc(label)}">
    <div class="tcl-handle" aria-hidden="true"></div>
    <button class="k-btn ghost tcl-x" data-tcl="close" aria-label="Close">×</button>
    <div class="tcl-body"></div></div>`;
  document.body.appendChild(root);
  const panel = root.querySelector<HTMLElement>('.tcl-sheet')!;
  const body = root.querySelector<HTMLElement>('.tcl-body')!;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    window.removeEventListener('keydown', onKey, true);
    root.classList.add('out');
    setTimeout(() => root.remove(), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200);
    try { before?.focus?.(); } catch { /* gone */ }
    onClose?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (!root.isConnected) { window.removeEventListener('keydown', onKey, true); return; }
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    const f = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(x => x.offsetParent !== null);
    if (!f.length) return;
    const i = f.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
  };
  window.addEventListener('keydown', onKey, true);
  root.addEventListener('click', e => {
    if (e.target === root || (e.target as HTMLElement).closest('[data-tcl="close"]')) close();
  });
  // phone: a swipe down on the handle closes the sheet
  let y0: number | null = null;
  panel.querySelector('.tcl-handle')!.addEventListener('touchstart', e => { y0 = (e as TouchEvent).touches[0].clientY; }, { passive: true });
  panel.addEventListener('touchmove', e => {
    if (y0 === null) return;
    const dy = (e as TouchEvent).touches[0].clientY - y0;
    if (dy > 80) { y0 = null; close(); }
  }, { passive: true });
  panel.addEventListener('touchend', () => { y0 = null; });
  requestAnimationFrame(() => { root.classList.add('in'); (panel.querySelector<HTMLElement>('[data-autofocus]') ?? panel.querySelector<HTMLElement>('.tcl-x'))?.focus(); });
  return { root, panel, body, close };
}
