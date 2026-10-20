export function h(tag: string, attrs: Record<string, string> = {}, html = ''): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (html) e.innerHTML = html;
  return e;
}

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function toast(msg: string) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = h('div', { class: 'toast' });
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
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
    // however the overlay goes away (button, backdrop, route change), drop the window listener with it
    const remove = o.remove.bind(o);
    o.remove = () => { window.removeEventListener('keydown', esc, true); remove(); };
  }
  document.body.appendChild(o);
  return o;
}

export function roman(n: number): string {
  return ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n] ?? String(n);
}
