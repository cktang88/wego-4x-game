// The seal ritual (DELIGHT #21, LOOPS §1.2 "Seal"): sealing your orders drips wax onto the strip, the house signet
// presses it (with the bell), and the fresh seal flies up to your crest, where it stays for everyone to see. About
// 700 ms, never blocking: the orders are already sealed when it starts (a hotseat hand-off waits for it, since the
// next player's curtain would hide it).
import { waxSealHtml, signetOf } from './stage.ts';
import { sigilSvg } from '../art/sigils.ts';
import { reduced } from './motion.ts';
import { audio } from '../audio/audio.ts';
import { haptic } from './haptics.ts';
import './delight.css';

/** How long the ritual takes (ms); the reveal's first act waits for it. */
export const SEAL_MS = 720;

/**
 * Play the ritual over `from` (the primary button) and fly the seal to `to` (your crest), in `layer`.
 * Returns the time (performance.now) it will be done.
 */
export function sealRitual(layer: HTMLElement, house: { seat: number; color: string }, from: DOMRect | null, to: DOMRect | null): number {
  const rm = reduced();
  const done = performance.now() + (rm ? 260 : SEAL_MS);
  // sound and touch first: the bell on the press, wax drips before it
  audio.drip(0); audio.drip(1, { delay: 0.09 });
  audio.sfx('ui_seal', { delay: rm ? 0 : 0.22 });
  setTimeout(() => haptic('seal'), rm ? 0 : 220);
  if (!from) return done;
  const el = document.createElement('div');
  el.className = `dl-ritual${rm ? ' rm' : ''}`;
  const x = from.left + from.width / 2, y = from.top + from.height / 2;
  el.style.left = `${Math.round(x)}px`; el.style.top = `${Math.round(y)}px`;
  el.innerHTML = `<i class="dl-drop d1"></i><i class="dl-drop d2"></i><i class="dl-drop d3"></i>${waxSealHtml(house, 56, 'dl-pool')}<span class="dl-signet">${sigilSvg(signetOf(house.seat), 26, 'gold')}</span>`;
  layer.appendChild(el);
  const wax = el.querySelector<HTMLElement>('.dl-pool');
  // the seal flies to your crest and shrinks into its mark there
  if (to && wax && !rm && wax.animate) {
    const dx = to.left + to.width / 2 - x, dy = to.top + to.height * 0.3 - y;
    wax.animate([
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: 0 },
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.55 },
      { transform: `translate(calc(-50% + ${dx * 0.55}px), calc(-50% + ${dy * 0.55 - 30}px)) scale(0.6)`, opacity: 1, offset: 0.8 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.22)`, opacity: 0.2, offset: 1 },
    ], { duration: SEAL_MS + 380, easing: 'cubic-bezier(0.45, 0, 0.55, 1)', fill: 'forwards' });
  }
  setTimeout(() => el.remove(), (rm ? 520 : SEAL_MS + 420));
  return done;
}
