// App-wide audio wiring that is not tied to one screen: the hover tick, the Shift+M mute shortcut, and the
// Sound settings dialog (menu, Help, lobby). Per-screen hooks live where the action happens (game.ts, hud/*,
// ui/*, render/battle.ts); see docs/ASSETS.md "Phase 2 integration".
import { audio, audioSettingsPanel } from './audio.ts';
import { overlay, toast } from '../ui/dom.ts';
import './audio.css';

/** Buttons that tick (very quietly) when a mouse moves onto them. */
const HOVER = '.ib, .tool, .bv-btn, .tile, .fz, .mt, .sw, .pbtn, .menu button, .hb, .lobby button';

let installed = false;
/** Call once at boot, after audio.install(). */
export function installAudioHooks(): void {
  if (installed) return;
  installed = true;
  // hover: mouse only (touch and pen fire pointerover on every tap), once per button entered
  let over: Element | null = null;
  const coarse = window.matchMedia?.('(pointer: coarse)');
  document.addEventListener('pointerover', e => {
    if (e.pointerType !== 'mouse' || coarse?.matches) return;
    const el = (e.target as Element | null)?.closest?.(HOVER) ?? null;
    if (el === over) return;
    over = el;
    if (!el || (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return;
    audio.ui('hover');
  }, { passive: true });
  document.addEventListener('pointerout', e => { if (e.pointerType === 'mouse' && !e.relatedTarget) over = null; }, { passive: true });
  // Shift+M mutes (plain M is Move). Capture phase + preventDefault, so the board's handler leaves it alone.
  window.addEventListener('keydown', e => {
    if (e.code !== 'KeyM' || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    e.preventDefault();
    toggleSound();
  }, true);
}

/** Mute / unmute with a short confirmation. Returns the new muted state. */
export function toggleSound(): boolean {
  audio.unlock();
  const m = audio.toggleMute();
  if (!m) audio.ui('click');
  toast(m ? 'Sound off (Shift+M)' : 'Sound on (Shift+M)');
  return m;
}

/** A small speaker icon (on / muted) in the icon set's style: currentColor, sized by icons.css (.ic). */
export function soundIcon(muted = audio.getSettings().muted): string {
  const waves = muted
    ? '<path d="M16 9.2l5 5.6M21 9.2l-5 5.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
    : '<path d="M15.6 8.6a4.6 4.6 0 0 1 0 6.8M18.4 6a8.4 8.4 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
  return `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 9.2h3.8L12 5v14l-5.2-4.2H3z" fill="currentColor"/>${waves}</svg>`;
}

/** The Sound settings dialog: mute and four volume sliders, live and saved as you drag. */
export function openSoundSettings(): HTMLElement {
  document.querySelector('.overlay .snd-dlg')?.closest('.overlay')?.remove();
  const o = overlay(`<div class="dialog snd-dlg" role="dialog" aria-label="Sound"><h2><i>${soundIcon(false)}</i>Sound</h2><div data-snd></div>
    <p class="snd-foot"><span class="k-hint"><kbd>Shift</kbd>+<kbd>M</kbd> mutes anywhere. </span>Saved in this browser.</p></div>`);
  o.querySelector('[data-snd]')!.appendChild(audioSettingsPanel());
  return o;
}
