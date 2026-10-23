// Graphics settings: the board's quality tier (art/gfx.ts) at auto / high / low. A small brass-and-steel dialog beside
// Sound (lobby, Help) and a row in Tweaks; the choice is saved in this browser.
import { esc, overlay } from './dom.ts';
import { ic } from '../art/icons.ts';
import { GFX_OPTIONS, gfxSetting, gfxStatus, setGfxSetting, onGfxChange, type GfxSetting } from '../art/gfx.ts';

/** The segmented control on its own (Tweaks embeds it). */
export function graphicsPanel(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'gfx-panel';
  const draw = () => {
    const cur = gfxSetting();
    const note = GFX_OPTIONS.find(o => o.v === cur)?.note ?? '';
    el.innerHTML = `<div class="k-seg gfx-seg" role="radiogroup" aria-label="Graphics quality">${GFX_OPTIONS.map(o =>
      `<button type="button" role="radio" data-gfx="${o.v}" aria-pressed="${o.v === cur}" aria-checked="${o.v === cur}">${esc(o.label)}</button>`).join('')}</div>
      <p class="gfx-note k-prose">${esc(note)}</p>
      <p class="gfx-status"><span class="k-engraved">Now drawing</span> <span class="k-num" data-gfx-status>${esc(gfxStatus())}</span></p>`;
  };
  draw();
  el.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-gfx]');
    if (!b) return;
    setGfxSetting(b.dataset.gfx as GfxSetting);
    draw();
    el.querySelector<HTMLButtonElement>(`[data-gfx="${b.dataset.gfx}"]`)?.focus();
  });
  // the governor may step the tier down while the dialog is open
  const off = onGfxChange(() => { const s = el.querySelector('[data-gfx-status]'); if (s) s.textContent = gfxStatus(); else off(); });
  return el;
}

export function openGraphicsSettings(): HTMLElement {
  document.querySelector('.overlay .gfx-dlg')?.closest('.overlay')?.remove();
  const o = overlay(`<div class="dialog gfx-dlg" role="dialog" aria-label="Graphics"><h2><i>${ic('star')}</i>Graphics</h2>
    <p class="k-prose gfx-lede">How finely the figurines are cast, their shadows, and the lamp on the glaze. Lower it if the board stutters.</p>
    <div data-gfx-host></div><p class="snd-foot">Saved in this browser.</p></div>`);
  o.querySelector('[data-gfx-host]')!.appendChild(graphicsPanel());
  return o;
}
