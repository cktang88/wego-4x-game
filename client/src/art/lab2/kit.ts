// Style lab shared kit: the View (camera → screen), colour and contrast maths (WCAG relative luminance), the
// readability probe measurement, a few shared paths, and the sprite stylizer that re-expresses the game's painted
// ship miniatures in a direction's material (engraved print, cast gold) without new sculpts.
import { drawShip } from '../ships.ts';
import type { House, Pt } from './board.ts';

export const TAU = Math.PI * 2;
export type RGB = [number, number, number];

export interface ZW { s: number; o: number; d: number }
export interface View {
  w: number; h: number; dpr: number;
  cx: number; cy: number; z: number;     // camera centre (world) and zoom (screen css px per world unit)
  zr: number;                            // on-screen median region radius (css px): the tier picker
  W: ZW; coarse: boolean; t: number;      // tier weights, touch device, time (s)
  sx(x: number): number; sy(y: number): number;
}
export const sstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** Same crossfade as the game (render/mapmodel.ts zoomW), so tiers line up with the live map. */
export function zoomW(zr: number, coarse: boolean): ZW {
  const [a, b] = coarse ? [84, 178] : [74, 160];
  const s = 1 - sstep(a * 0.8, a * 1.15, zr);
  const d = sstep(b * 0.82, b * 1.18, zr);
  return { s, o: Math.max(0, 1 - s - d), d };
}
export function makeView(w: number, h: number, dpr: number, cx: number, cy: number, z: number, medianR: number, coarse: boolean, t: number): View {
  const zr = medianR * z;
  return { w, h, dpr, cx, cy, z, zr, W: zoomW(zr, coarse), coarse, t, sx: x => (x - cx) * z + w / 2, sy: y => (y - cy) * z + h / 2 };
}

// ------------------------------------------------------------------ colour
export function rgb(hex: string): RGB {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const css = (c: RGB, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
export const hexA = (hex: string, a: number) => css(rgb(hex), a);
export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const mixHex = (a: string, b: string, t: number) => { const c = mix(rgb(a), rgb(b), t); return `#${((1 << 24) | ((c[0] | 0) << 16) | ((c[1] | 0) << 8) | (c[2] | 0)).toString(16).slice(1)}`; };
const lin = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
/** WCAG relative luminance (0..1). */
export const relLum = (c: RGB) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
export const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
export const contrastHex = (a: string, b: string) => ratio(relLum(rgb(a)), relLum(rgb(b)));

// ------------------------------------------------------------------ noise
export function hash(n: number) { n = Math.imul(n ^ (n >>> 16), 0x7feb352d); n = Math.imul(n ^ (n >>> 15), 0x846ca68b); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; }
export const h2 = (x: number, y: number, s = 0) => hash(Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2147483647));
const fade = (t: number) => t * t * (3 - 2 * t);
export function noise(x: number, y: number, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), u = fade(x - xi), v = fade(y - yi);
  const a = h2(xi, yi, s), b = h2(xi + 1, yi, s), c = h2(xi, yi + 1, s), d = h2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x: number, y: number, oct = 4, s = 0) { let a = 0, f = 1, w = 0.5, n = 0; for (let i = 0; i < oct; i++) { a += noise(x * f, y * f, s + i * 17) * w; n += w; f *= 2.03; w *= 0.5; } return a / n; }
export function rng(seed: number) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function cv(w: number, h: number) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }
export function ctx2(c: HTMLCanvasElement) { return c.getContext('2d', { willReadFrequently: false })!; }

// ------------------------------------------------------------------ shared paths
/** A fleet chevron pointing along +x, centred, `r` the half-length. */
export function chevron(g: CanvasRenderingContext2D, r: number) {
  g.beginPath();
  g.moveTo(r, 0); g.lineTo(-r * 0.8, -r * 0.82); g.lineTo(-r * 0.38, 0); g.lineTo(-r * 0.8, r * 0.82); g.closePath();
}
export function polyPath(g: CanvasRenderingContext2D | Path2D, pts: Pt[], v: View) {
  pts.forEach((p, i) => (i ? g.lineTo(v.sx(p.x), v.sy(p.y)) : g.moveTo(v.sx(p.x), v.sy(p.y))));
  g.closePath();
}
export function loopsPath(loops: Pt[][], v: View): Path2D { const p = new Path2D(); for (const l of loops) polyPath(p, l, v); return p; }
export function spaced(g: CanvasRenderingContext2D, text: string, x: number, y: number, track: number, mode: 'fill' | 'stroke' | 'both' = 'fill', align: 'center' | 'left' = 'center') {
  const c = g as CanvasRenderingContext2D & { letterSpacing?: string };
  const prevAlign = g.textAlign;
  if (typeof c.letterSpacing === 'string') {
    c.letterSpacing = `${track.toFixed(2)}px`;
    // letter-spacing adds trailing space after the last glyph: compensate when centring
    const w = g.measureText(text).width;
    g.textAlign = 'left';
    const x0 = align === 'center' ? x - (w - track) / 2 : x;
    if (mode !== 'fill') g.strokeText(text, x0, y);
    if (mode !== 'stroke') g.fillText(text, x0, y);
    c.letterSpacing = '0px';
  } else {
    if (mode !== 'fill') g.strokeText(text, x, y);
    if (mode !== 'stroke') g.fillText(text, x, y);
  }
  g.textAlign = prevAlign;
}
export function textW(g: CanvasRenderingContext2D, text: string, track: number) {
  const c = g as CanvasRenderingContext2D & { letterSpacing?: string };
  if (typeof c.letterSpacing === 'string') { c.letterSpacing = `${track.toFixed(2)}px`; const w = g.measureText(text).width - track; c.letterSpacing = '0px'; return w; }
  return g.measureText(text).width;
}

/** The lamp: upper left. Unit vector toward it. */
export const LAMP = (() => { const x = -0.52, y = -0.85, l = Math.hypot(x, y); return { x: x / l, y: y / l }; })();

export const SEAT: Record<House, number> = { azure: 0, crimson: 1, gilded: 2, warden: -1 };
/** Enamel bases the game's ship painter derives hull lacquer from (art/bible.ts FACTION.*.base). */
export const TEAM: Record<House, string> = { azure: '#2f6ea6', crimson: '#a3303a', gilded: '#c79a2c', warden: '#6e58a0' };

// ------------------------------------------------------------------ the sprite stylizer
type PixFn = (r: number, g: number, b: number, a: number, x: number, y: number, L: number) => [number, number, number, number];
const styCache = new Map<string, HTMLCanvasElement>();
/** A ship miniature (art/ships.ts drawShip, the game's own sculpts) baked at `lenDev` device px and passed through a
 *  per-pixel material function, with an optional outline of `outline` colour (dilated alpha). Cached per key. */
export function stylizedShip(key: string, cls: string, house: House, lenDev: number, angle: number, fn: PixFn | null, outline: RGB | null, outlineW = 1): HTMLCanvasElement {
  const L = Math.max(8, Math.round(lenDev / 4) * 4);
  const ab = Math.round(angle / (TAU / 32)) & 31;
  const k = `${key}|${cls}|${house}|${L}|${ab}`;
  let c = styCache.get(k);
  if (c) return c;
  const size = Math.ceil(L * 1.7) + 6;
  c = cv(size, size);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  drawShip(g, size / 2, size / 2, L, L, cls, SEAT[house], TEAM[house], ab * (TAU / 32));
  if (fn || outline) {
    const img = g.getImageData(0, 0, size, size), D = img.data;
    const A = new Uint8Array(size * size);
    for (let i = 0; i < size * size; i++) A[i] = D[i * 4 + 3];
    // luminance normalised to the sprite's own range (p4..p96 of its opaque pixels), so the material bands fall
    // the same way on a dark Crimson hull and a pale Gilded one
    const ls: number[] = [];
    for (let i = 0; i < size * size; i++) if (D[i * 4 + 3] > 128) ls.push((0.3 * D[i * 4] + 0.59 * D[i * 4 + 1] + 0.11 * D[i * 4 + 2]) / 255);
    ls.sort((a, b) => a - b);
    const lo = ls[Math.floor(ls.length * 0.04)] ?? 0, hi = ls[Math.floor(ls.length * 0.96)] ?? 1;
    if (fn) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (D[i + 3] < 8) continue;
      const Lm = Math.max(0, Math.min(1, ((0.3 * D[i] + 0.59 * D[i + 1] + 0.11 * D[i + 2]) / 255 - lo) / Math.max(0.05, hi - lo)));
      const o = fn(D[i], D[i + 1], D[i + 2], D[i + 3], x, y, Lm);
      D[i] = o[0]; D[i + 1] = o[1]; D[i + 2] = o[2]; D[i + 3] = o[3];
    }
    if (outline) {
      const R = outlineW;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const i = y * size + x;
        if (A[i] > 100) continue;
        let m = 0;
        for (let dy = -R; dy <= R && !m; dy++) for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
          if (A[yy * size + xx] > 140) { m = 1; break; }
        }
        if (m) { const j = i * 4; D[j] = outline[0]; D[j + 1] = outline[1]; D[j + 2] = outline[2]; D[j + 3] = 255; }
      }
    }
    g.putImageData(img, 0, 0);
  }
  styCache.set(k, c);
  return c;
}
/** Draw a stylized ship sprite centred at (x, y) with on-screen length `len` (css px). */
export function blitShip(g: CanvasRenderingContext2D, spr: HTMLCanvasElement, x: number, y: number, len: number, lenDev: number) {
  const L = Math.max(8, Math.round(lenDev / 4) * 4);
  const s = (spr.width / L) * len;
  g.drawImage(spr, x - s / 2, y - s / 2, s, s);
}

// ------------------------------------------------------------------ readability probes
export interface Probe { kind: string; x: number; y: number; w: number; h: number; bg: 0 | 1 | 2 }
export interface ProbeResult { kind: string; x: number; y: number; contrast: number; light: number; dark: number; bgHi: number; bgLo: number; n: number }
const pct = (a: number[], p: number) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))]; };
/** Effective contrast of each probed mark (ART direction rule: >= 4.5:1). Mark pixels are where the composite frame
 *  differs from the background-only frame inside the probe box; the local background is the background-only frame
 *  (ground, territory, lanes: whatever the mark sits on, glows included) in a ring just outside the box. The mark reads if EITHER its light tone (p95 of its pixels) beats the brightest
 *  nearby background (p85 of the ring: hairlines in the ring do not count), OR its dark tone (p5) beats the darkest
 *  (p15); or, for a two-tone keyline on a mixed ground, each tone beats the opposite side of it. A keyline counts,
 *  a glow does not. */
export function measure(comp: ImageData, bgs: ImageData[], probes: Probe[], dpr: number): ProbeResult[] {
  const W = comp.width, H = comp.height;
  const lumAt = (D: Uint8ClampedArray, i: number) => relLum([D[i], D[i + 1], D[i + 2]]);
  const out: ProbeResult[] = [];
  for (const p of probes) {
    const bg = bgs[p.bg].data, C = comp.data;
    const x0 = Math.round((p.x - p.w / 2) * dpr), y0 = Math.round((p.y - p.h / 2) * dpr), x1 = Math.round((p.x + p.w / 2) * dpr), y1 = Math.round((p.y + p.h / 2) * dpr);
    const pad = Math.round(Math.max(4, Math.min(p.w, p.h) * 0.35) * dpr);
    const mk: number[] = [], ring: number[] = [];
    const step = dpr >= 2 ? 2 : 1;
    for (let y = Math.max(0, y0 - pad); y < Math.min(H, y1 + pad); y += step) for (let x = Math.max(0, x0 - pad); x < Math.min(W, x1 + pad); x += step) {
      const i = (y * W + x) * 4;
      const inside = x >= x0 && x < x1 && y >= y0 && y < y1;
      if (inside) {
        const d = Math.abs(C[i] - bg[i]) + Math.abs(C[i + 1] - bg[i + 1]) + Math.abs(C[i + 2] - bg[i + 2]);
        if (d > 36) mk.push(lumAt(C, i));
      } else ring.push(lumAt(bg, i));
    }
    if (mk.length < 4 || !ring.length) { out.push({ kind: p.kind, x: p.x, y: p.y, contrast: 0, light: 0, dark: 0, bgHi: 0, bgLo: 0, n: mk.length }); continue; }
    const light = pct(mk, 0.95), dark = pct(mk, 0.05), bgHi = pct(ring, 0.85), bgLo = pct(ring, 0.15);
    const c1 = light > bgHi ? ratio(light, bgHi) : 1, c2 = dark < bgLo ? ratio(dark, bgLo) : 1;
    // a two-tone keyline (light body, dark edge) on a mixed ground: the light tone must beat the dark side of the
    // ground AND the dark tone the light side
    const c3 = light > bgLo && dark < bgHi ? Math.min(ratio(light, bgLo), ratio(dark, bgHi)) : 1;
    out.push({ kind: p.kind, x: Math.round(p.x), y: Math.round(p.y), contrast: Math.max(c1, c2, c3), light, dark, bgHi, bgLo, n: mk.length });
  }
  return out;
}
/** p5..p95 relative luminance of a frame (the background's value range). */
export function valueRange(img: ImageData): [number, number, number] {
  const a: number[] = [];
  const D = img.data;
  for (let i = 0; i < D.length; i += 4 * 37) a.push(relLum([D[i], D[i + 1], D[i + 2]]));
  return [pct(a, 0.05), pct(a, 0.5), pct(a, 0.95)];
}

// ------------------------------------------------------------------ hatching
let hatchBuf: HTMLCanvasElement | null = null;
const hatchTiles = new Map<string, HTMLCanvasElement>();
/** One period of the hatch as a pattern tile (a vertical line, dashed along its length), rotated at fill time:
 *  far cheaper than stroking hundreds of viewport-long (dashed) lines. */
function hatchTile(color: string, lw: number, gap: number, dash: number[], dpr: number): HTMLCanvasElement {
  const k = `${color}|${lw}|${gap}|${dash.join(',')}|${dpr}`;
  let t = hatchTiles.get(k);
  if (t) return t;
  const H = dash.length ? dash.reduce((x, y) => x + y, 0) : gap;
  t = cv(Math.max(1, Math.round(gap * dpr)), Math.max(1, Math.round(H * dpr)));
  const g = t.getContext('2d')!;
  g.scale(t.width / gap, t.height / H);
  g.strokeStyle = color; g.lineWidth = lw;
  if (dash.length) g.setLineDash(dash);
  g.beginPath(); g.moveTo(gap / 2, 0); g.lineTo(gap / 2, H); g.stroke();
  hatchTiles.set(k, t);
  return t;
}
/** Hatching (the colour-blind owner cue) inside `path`, limited to a band `band` px wide along its edge (band <= 0:
 *  the whole interior). Lines at angle `a` (radians), `gap` px apart, screen-constant so the cue reads at every
 *  tier; `cross` adds the perpendicular set. Drawn through a viewport-sized buffer (one per frame per house). */
export function bandHatch(g: CanvasRenderingContext2D, v: View, path: Path2D, band: number, a: number, cross: boolean, color: string, lw: number, gap: number, dash: number[] = []) {
  const W = Math.ceil(v.w * v.dpr), H = Math.ceil(v.h * v.dpr);
  if (!hatchBuf || hatchBuf.width !== W || hatchBuf.height !== H) hatchBuf = cv(W, H);
  const b = hatchBuf.getContext('2d')!;
  b.setTransform(1, 0, 0, 1, 0, 0);
  b.globalCompositeOperation = 'source-over';
  b.clearRect(0, 0, W, H);
  b.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
  // the band's bounding box limits the fill
  const tile = hatchTile(color, lw, gap, dash, v.dpr);
  for (const ang of cross ? [a, a + Math.PI / 2] : [a]) {
    const p = b.createPattern(tile, 'repeat')!;
    // the tile's line runs along y; rotate so it runs along `ang`
    p.setTransform(new DOMMatrix().rotateSelf(0, 0, (ang - Math.PI / 2) * 180 / Math.PI).scaleSelf(1 / v.dpr, 1 / v.dpr));
    b.fillStyle = p;
    b.fill(path);
  }
  if (band > 0) { b.globalCompositeOperation = 'destination-in'; b.lineWidth = band * 2; b.lineJoin = 'round'; b.strokeStyle = '#000'; b.stroke(path); }
  b.globalCompositeOperation = 'source-over';
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(hatchBuf, 0, 0); g.restore();
}
/** House hatch angles (art/bible.ts HATCH): azure -45°, crimson +45°, gilded crossed, warden vertical. */
export const HATCH: Record<House, { a: number; cross: boolean }> = {
  azure: { a: -Math.PI / 4, cross: false }, crimson: { a: Math.PI / 4, cross: false }, gilded: { a: 0, cross: true }, warden: { a: Math.PI / 2, cross: false },
};

/** Textures from client/public/tex (loaded once). */
const tex = new Map<string, HTMLImageElement>();
export function loadTex(names: string[]): Promise<void> {
  return Promise.all(names.map(n => new Promise<void>(res => {
    if (tex.has(n)) return res();
    const im = new Image(); im.onload = () => { tex.set(n, im); res(); }; im.onerror = () => res(); im.src = `/tex/${n}`;
  }))).then(() => undefined);
}
export const texImg = (n: string) => tex.get(n) ?? null;
const pats = new Map<string, CanvasPattern>();
export function texPattern(g: CanvasRenderingContext2D, n: string): CanvasPattern | null {
  const k = n;
  let p = pats.get(k);
  if (p) return p;
  const im = tex.get(n);
  if (!im) return null;
  p = g.createPattern(im, 'repeat')!;
  pats.set(k, p);
  return p;
}

// ------------------------------------------------------------------ mip-mapped blits of the baked grounds
const mips = new WeakMap<HTMLCanvasElement, HTMLCanvasElement[]>();
/** drawImage of a large baked texture through a halving chain, so a zoomed-out view never resamples the full bake
 *  (the browser's high-quality downscale is the most expensive call in a 2D frame on a phone). */
export function blitMip(g: CanvasRenderingContext2D, img: HTMLCanvasElement, dx: number, dy: number, dw: number, dh: number, dpr: number) {
  let chain = mips.get(img);
  if (!chain) {
    chain = [img];
    let c = img;
    while (c.width > 256) { const n = cv(c.width / 2, c.height / 2); const ng = n.getContext('2d')!; ng.imageSmoothingQuality = 'high'; ng.drawImage(c, 0, 0, n.width, n.height); chain.push(n); c = n; }
    mips.set(img, chain);
  }
  const want = dw * dpr;
  let pick = chain[0];
  for (const c of chain) if (c.width >= want * 0.9) pick = c;
  g.imageSmoothingQuality = 'medium';
  g.drawImage(pick, dx, dy, dw, dh);
}
