// One haptic vocabulary for the whole game (DELIGHT #84, LOOPS §5): every buzz in the game comes from this table, so
// the phone speaks one language. navigator.vibrate where it exists (Android Chrome and friends); where it does not
// (iOS Safari has no vibration API), a moment that has no sound of its own gets the engine's quiet tick instead, and a
// moment that already rings (the seal's bell, the CALLED IT sting) needs nothing more.
// Never buzzes in a hidden tab, behind the hotseat curtain, or when the player turned haptics off.
import { audio } from '../audio/audio.ts';

export type Haptic = 'lift' | 'slot' | 'posture' | 'seal' | 'called' | 'caught' | 'capture' | 'crown' | 'victory' | 'defeat' | 'coin' | 'card';

interface Def { pattern: number | number[]; /** the moment already has its own sound (iOS needs no stand-in) */ sounds: boolean; tick?: number }
/** The table. Durations in ms; arrays alternate buzz / pause. */
export const HAPTICS: Record<Haptic, Def> = {
  lift:    { pattern: 10, sounds: false, tick: 0.5 },           // a fleet picked up off the table
  slot:    { pattern: 10, sounds: true },                       // an order dropped into a socket (chip clack)
  posture: { pattern: 15, sounds: false, tick: 0.7 },           // a posture token placed face-down
  seal:    { pattern: 40, sounds: true },                       // the signet presses the wax (bell)
  called:  { pattern: [20, 40, 20, 40, 20], sounds: true },     // CALLED IT (sting)
  caught:  { pattern: 80, sounds: true },                       // CAUGHT OUT (sting)
  capture: { pattern: [20, 30, 20], sounds: true },             // one of your captures in the reveal
  crown:   { pattern: [30, 40, 30, 40, 30], sounds: true },     // a Crown changes hands to you
  victory: { pattern: 200, sounds: true },                      // the crowning, your win
  defeat:  { pattern: [60, 80, 60], sounds: true },             // the crowning, someone else's
  coin:    { pattern: 6, sounds: true },                        // a VP coin lands on your crest
  card:    { pattern: 8, sounds: true },                        // an award card dealt to you
};

const KEY = 'tc.haptics';
let enabled = (() => { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } })();
/** Turn haptics on/off (remembered in this browser). */
export function setHaptics(on: boolean) { enabled = on; try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* */ } }
export function hapticsOn() { return enabled; }

/** Does this device have a vibration motor API? */
export const canVibrate = (): boolean => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

/** Test hook: when a page sets `window.__tcHaptics = []`, every haptic request is appended to it. */
function log(k: Haptic, how: string) {
  try { const l = (window as unknown as { __tcHaptics?: string[] }).__tcHaptics; if (Array.isArray(l)) l.push(`${k}:${how}`); } catch { /* */ }
}

/** Play one haptic from the table (or its stand-in). Safe anywhere; never throws. */
export function haptic(k: Haptic): void {
  const d = HAPTICS[k];
  if (!d || !enabled || typeof document === 'undefined' || document.hidden) return;
  if (document.querySelector('.overlay.curtain')) return;
  if (canVibrate()) {
    try { navigator.vibrate(d.pattern); log(k, 'vibrate'); } catch { /* blocked before the first gesture */ }
    return;
  }
  // the stand-in is for touch devices only (a desktop without the API just has no haptics)
  const touch = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
  if (!d.sounds && touch) { audio.tick({ strength: d.tick ?? 1 }); log(k, 'tick'); }
  else log(k, 'sound');
}
