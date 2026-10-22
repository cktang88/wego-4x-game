// A ship class shown as a painted miniature on its display base: the same sprite, base and flight stand the map uses,
// baked once per class × house × size and copied into small canvases (Empire modal ship cards, Empire tab rows).
import { drawShip, drawPlumes } from '../art/ships.ts';
import { drawBase, drawStand } from '../art/minis.ts';
import { classLen } from '../art/palette.ts';
import { canvas } from '../art/util.ts';

const cache = new Map<string, HTMLCanvasElement>();
const LONGEST = classLen('dread');

/** Bake the miniature into a w×h (device px) transparent canvas. `bare`: no base or stand (tiny thumbnails). */
export function bakeMini(cls: string, owner: number, team: string, w: number, h: number, bare = false): HTMLCanvasElement {
  w = Math.max(16, Math.round(w)); h = Math.max(8, Math.round(h));
  const key = `${cls}|${owner}|${team}|${w}|${h}|${bare ? 1 : 0}`;
  let c = cache.get(key);
  if (c) return c;
  c = canvas(w, h);
  const g = c.getContext('2d')!;
  // hull length: the dreadnought fills ~70% of the width, smaller classes in proportion (but never tiny)
  const k = 0.45 + 0.55 * (classLen(cls) / LONGEST);
  const L = bare ? Math.min(w * 0.9 * k, h * 1.6 * k) : Math.min(w * 0.54 * k, h * 0.9 * k);
  const ang = Math.PI / 2 - 0.22;                     // nose right, a touch raised
  if (bare) {
    drawShip(g, w / 2, h / 2, L, L, cls, owner, team, ang, { shadow: { dx: L * 0.04, dy: L * 0.08, alpha: 0.5 } });
  } else {
    const bx = w / 2, by = h * 0.74, rx = Math.min(w * 0.16, h * 0.34);
    const sy = h * 0.4;
    drawBase(g, bx, by, rx, rx, team, { big: true });
    drawStand(g, bx, by, sy + L * 0.04, Math.max(1.5, L * 0.035));
    drawPlumes(g, w / 2, sy, L, cls, owner, team, ang, 0.45);
    drawShip(g, w / 2, sy, L, L, cls, owner, team, ang, { shadow: { dx: L * 0.05, dy: (by - sy) * 0.92, alpha: 0.42 } });
  }
  if (cache.size > 80) cache.delete(cache.keys().next().value!);
  cache.set(key, c);
  return c;
}

/** Paint every `canvas[data-mini]` under `root` (data-cls, data-owner, data-team; data-bare for no base). */
export function paintMinis(root: ParentNode) {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  for (const cv of root.querySelectorAll<HTMLCanvasElement>('canvas[data-mini]')) {
    const cw = cv.clientWidth, ch = cv.clientHeight;
    if (!cw || !ch) continue;
    // size buckets of 16 device px keep the cache small while the layout breathes
    const w = Math.ceil((cw * dpr) / 16) * 16, h = Math.ceil((ch * dpr) / 16) * 16;
    const sig = `${w}x${h}`;
    if (cv.dataset.painted === sig) continue;
    const art = bakeMini(cv.dataset.cls ?? 'frigate', Number(cv.dataset.owner ?? 0), cv.dataset.team ?? '#888', w, h, cv.dataset.bare !== undefined);
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d')!;
    g.clearRect(0, 0, w, h);
    g.drawImage(art, 0, 0);
    cv.dataset.painted = sig;
  }
}

/** A small painted thumbnail as a data URL (for HTML strings without an after-render hook). */
const urls = new Map<string, string>();
export function miniUrl(cls: string, owner: number, team: string, cssW: number, cssH: number): string {
  const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  const key = `${cls}|${owner}|${team}|${cssW}|${cssH}|${dpr}`;
  let u = urls.get(key);
  if (!u) { u = bakeMini(cls, owner, team, cssW * dpr, cssH * dpr, true).toDataURL(); urls.set(key, u); }
  return u;
}
