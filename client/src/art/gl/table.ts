// The war table's light: one shared ArtStage (art/gl/stage.ts) for the whole app, moved under whichever board is on
// screen (the map, or the battle viewer while it is open). One stage means three WebGL contexts at most, however
// often the player goes from the lobby to a game and back (browsers drop the oldest context past ~16).
//
// The Graphics setting (auto, high, medium, low, off) lives here, persisted in localStorage (never throws):
//   auto  : hardware WebGL2 only (a software rasteriser gets the 2D table); high on desktops and medium on touch
//           devices, and the governor may step it down
//   high / medium / low : fixed tier (no governor)
//   off   : no WebGL at all; the 2D painters (art/mat.ts) draw the table as before
import { ArtStage, type CoronaStar, type Quality } from './stage.ts';
import { setHardwareOnly, softwareGL } from './core.ts';

export type GfxSetting = 'auto' | Quality | 'off';
export const GFX_OPTIONS: { v: GfxSetting; label: string; note: string }[] = [
  { v: 'auto', label: 'Auto', note: 'Best this device can hold at 60 fps' },
  { v: 'high', label: 'High', note: 'Living sky, lamp beam, bloom' },
  { v: 'medium', label: 'Medium', note: 'No bloom; the sky redraws less often' },
  { v: 'low', label: 'Low', note: 'Quarter-size sky, no dust motes' },
  { v: 'off', label: 'Off', note: 'The painted 2D table only' },
];
const KEY = 'tc.gfx';
const VALID = new Set<GfxSetting>(['auto', 'high', 'medium', 'low', 'off']);

let setting: GfxSetting = (() => {
  try {
    const v = localStorage.getItem(KEY) as GfxSetting | null;
    if (v && VALID.has(v)) return v;
  } catch { /* storage blocked */ }
  // ?gl=0 in the URL forces the 2D table (tests and comparisons)
  try { if (new URLSearchParams(location.search).get('gl') === '0') return 'off'; } catch { /* */ }
  return 'auto';
})();

let stage: ArtStage | null = null;
let failed = false;
let owner: HTMLElement | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(f => { try { f(); } catch { /* */ } });

export function gfxSetting(): GfxSetting { return setting; }

/** What the table is drawing now, for the settings readout. */
export function gfxStatus(): string {
  if (setting === 'off') return '2D table';
  if (failed) return setting === 'auto' ? 'No graphics hardware: 2D table' : 'WebGL2 unavailable: 2D table';
  if (!stage) return 'WebGL2';
  if (stage.lost) return 'Graphics context lost: 2D table';
  return `WebGL2 · ${stage.quality}`;
}

export function setGfxSetting(v: GfxSetting) {
  if (!VALID.has(v)) return;
  setting = v;
  try { localStorage.setItem(KEY, v); } catch { /* blocked: the choice lasts this session */ }
  if (v !== 'auto') failed = false;
  if (v === 'off') { stage?.dispose(); stage = null; owner = null; }
  else if (stage) {
    stage.setFixed(v !== 'auto');
    stage.setQuality(v === 'auto' ? ArtStage.defaultQuality() : v);
  }
  notify();
}

/** Called when the stage appears, disappears, changes tier or loses its context: the 2D painters re-check. */
export function onTableChange(f: () => void): () => void { listeners.add(f); return () => listeners.delete(f); }

/** The shared stage, mounted around `canvas` (moved there if it was under another board), or null: the caller
 *  paints the 2D table itself. */
export function tableFor(canvas: HTMLCanvasElement, seed: number): ArtStage | null {
  if (setting === 'off' || failed) return null;
  if (!stage) {
    // auto: hardware GL only (a software rasteriser gets the 2D table); a tier the player picked forces GL
    if (setting === 'auto' && softwareGL()) { failed = true; notify(); return null; }
    setHardwareOnly(setting === 'auto');
    stage = ArtStage.create({
      seed, quality: setting === 'auto' ? undefined : setting, fixedQuality: setting !== 'auto',
      onChange: () => notify(),
    });
    if (!stage) { failed = true; notify(); return null; }
  }
  stage.setSeed(seed);
  if (owner !== canvas || stage.under.nextSibling !== canvas) { stage.mount(canvas); owner = canvas; }
  return stage.lost ? null : stage;
}

/** Hand the table back: if `canvas` holds it, take the layers off the page (the next board to draw mounts them). */
export function releaseTable(canvas: HTMLCanvasElement) {
  if (stage && owner === canvas) { stage.unmount(); owner = null; }
}

/** The table's frame pacing: on a still board (no camera move, no animation asking for frames) the light only needs
 *  ~30 fps on desktops and ~20 on touch devices; nothing it animates (haze, motes, coronas ±8%) is fast. */
export class Pacer {
  private n = 0;
  private coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  /** true when this frame should be drawn */
  tick(busy: boolean): boolean {
    this.n++;
    if (busy) { this.n = 0; return true; }
    return this.n % (this.coarse ? 3 : 2) === 0;
  }
}

export type { CoronaStar, Quality };
