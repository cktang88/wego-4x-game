// The Graphics setting. The board is drawn by the 2D renderer only (the WebGL nebula, bloom and corona stage is
// retired, docs/ART-BIBLE.md §13), so the setting is a quality tier for the parts that cost:
//   high : figurines baked at full device resolution, soft cast shadows, the lamp's reflection on the glaze, the
//          board's enamel baked at full resolution
//   low  : lighter figurines and plain shadows, no glaze reflection, the enamel baked at up to 1.5x (older phones)
//   auto : high, stepping down to low by itself if the board keeps missing its frame budget
// Persisted in localStorage (never throws). The old values ('medium', 'off') read as high and low.
export type GfxSetting = 'auto' | 'high' | 'low';
export type Quality = 'high' | 'low';
export const GFX_OPTIONS: { v: GfxSetting; label: string; note: string }[] = [
  { v: 'auto', label: 'Auto', note: 'High detail, easing to Low by itself if this device struggles' },
  { v: 'high', label: 'High', note: 'Full-detail figurines, soft shadows, the lamp on the glaze' },
  { v: 'low', label: 'Low', note: 'Lighter figurines and plain shadows, for older phones' },
];
const KEY = 'tc.gfx';
const read = (v: string | null): GfxSetting | null => v === 'auto' || v === 'high' || v === 'low' ? v : v === 'medium' ? 'high' : v === 'off' ? 'low' : null;

let setting: GfxSetting = (() => {
  try { const v = read(localStorage.getItem(KEY)); if (v) return v; } catch { /* storage blocked */ }
  // ?gl=0 (older test links) and ?gfx=low force the light tier
  try { const q = new URLSearchParams(location.search); if (q.get('gl') === '0' || q.get('gfx') === 'low') return 'low'; } catch { /* */ }
  return 'auto';
})();
let stepped = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(f => { try { f(); } catch { /* */ } });

export function gfxSetting(): GfxSetting { return setting; }
/** The tier being drawn now. */
export function gfxQuality(): Quality { return setting === 'low' || (setting === 'auto' && stepped) ? 'low' : 'high'; }
/** What the board is drawing now, for the settings readout. */
export function gfxStatus(): string { return setting === 'auto' ? `Auto · ${gfxQuality() === 'high' ? 'High' : 'Low (stepped down)'}` : setting === 'high' ? 'High' : 'Low'; }
export function setGfxSetting(v: GfxSetting) {
  const r = read(v);
  if (!r) return;
  setting = r; stepped = false;
  try { localStorage.setItem(KEY, r); } catch { /* blocked: the choice lasts this session */ }
  notify();
}
export function onGfxChange(f: () => void): () => void { listeners.add(f); return () => listeners.delete(f); }

/** The Auto governor: fed the board's own draw time each frame; after ~2 s of frames over 22 ms it steps to Low. */
let over = 0, seen = 0;
export function gfxFrame(ms: number) {
  if (setting !== 'auto' || stepped) return;
  seen++;
  over = ms > 22 ? over + 1 : Math.max(0, over - 2);
  if (seen > 120 && over > 90) { stepped = true; notify(); }
}
