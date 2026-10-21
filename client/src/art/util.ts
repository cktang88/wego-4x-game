// Shared helpers for the procedural art painters: colour maths, value noise, seeded randoms, a small LRU sprite
// cache and the one light every painter agrees on (a warm lamp above the table, slightly to the upper left).

export const TAU = Math.PI * 2;

/** Direction *toward* the lamp in screen space (unit). Facets whose outward normal points here are lit. */
export const LIGHT = (() => { const x = -0.52, y = -0.85, l = Math.hypot(x, y); return { x: x / l, y: y / l }; })();
/** 3D light for sphere shading: from the upper left and toward the viewer. */
export const LIGHT3 = (() => { const v = [-0.5, -0.62, 0.6], l = Math.hypot(...v); return v.map(c => c / l) as [number, number, number]; })();

export type RGB = [number, number, number];

export function rgb(hex: string): RGB {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [128, 128, 128];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const css = (c: RGB, a = 1) => (a >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0, Math.min(1, a)).toFixed(3)})`);
export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const shade = (c: RGB, k: number): RGB => (k >= 0 ? mix(c, [255, 255, 255], k) : mix(c, [0, 0, 0], -k));
/** Warm the highlights a little (the lamp is tungsten-ish), cool the shadows (bounce off the blue cloth). */
export function lit(c: RGB, k: number): RGB {
  if (k >= 0) return mix(c, [255, 244, 222], Math.min(1, k));
  return mix(c, [8, 10, 26], Math.min(1, -k));
}
export const hexCss = (hex: string, a = 1) => css(rgb(hex), a);
export const lum = (c: RGB) => (0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]) / 255;
export function saturate(c: RGB, k: number): RGB { const l = lum(c) * 255; return [l + (c[0] - l) * k, l + (c[1] - l) * k, l + (c[2] - l) * k].map(v => Math.max(0, Math.min(255, v))) as RGB; }

// ------------------------------------------------------------------ seeded randoms + noise
export function hash32(n: number): number {
  n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
  n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
  return (n ^ (n >>> 16)) >>> 0;
}
export function strHash(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
export function rand(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Deterministic 0..1 from integer coordinates. */
export function h2(x: number, y: number, s = 0): number { return hash32(Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2147483647)) / 4294967296; }
export function h3(x: number, y: number, z: number, s = 0): number { return hash32(Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177) ^ Math.imul(s | 0, 2246822519)) / 4294967296; }
const fade = (t: number) => t * t * (3 - 2 * t);
export function noise2(x: number, y: number, s = 0): number {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = fade(xf), v = fade(yf);
  const a = h2(xi, yi, s), b = h2(xi + 1, yi, s), c = h2(xi, yi + 1, s), d = h2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function noise3(x: number, y: number, z: number, s = 0): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const u = fade(x - xi), v = fade(y - yi), w = fade(z - zi);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => h3(xi + dx, yi + dy, zi + dz, s);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v), l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
export function fbm2(x: number, y: number, oct = 4, s = 0): number { let a = 0, f = 1, w = 0.5, n = 0; for (let i = 0; i < oct; i++) { a += noise2(x * f, y * f, s + i * 17) * w; n += w; f *= 2.03; w *= 0.5; } return a / n; }
export function fbm3(x: number, y: number, z: number, oct = 4, s = 0): number { let a = 0, f = 1, w = 0.5, n = 0; for (let i = 0; i < oct; i++) { a += noise3(x * f, y * f, z * f, s + i * 17) * w; n += w; f *= 2.03; w *= 0.5; } return a / n; }

// ------------------------------------------------------------------ canvases + cache
export function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
  return c;
}
/** Tiny LRU for sprites: Map keeps insertion order; a hit re-inserts. */
export class SpriteCache<V> {
  private m = new Map<string, V>();
  constructor(private max = 400) {}
  get(k: string, make: () => V): V {
    let v = this.m.get(k);
    if (v !== undefined) { this.m.delete(k); this.m.set(k, v); return v; }
    v = make();
    this.m.set(k, v);
    if (this.m.size > this.max) this.m.delete(this.m.keys().next().value!);
    return v;
  }
  has(k: string) { return this.m.has(k); }
  get size() { return this.m.size; }
  clear() { this.m.clear(); }
}

/** Geometric size buckets (4 per octave): sprites are baked at the bucket and drawn scaled by < 10%. */
export function sizeBucket(px: number): number { return Math.pow(2, Math.max(2, Math.round(Math.log2(Math.max(1, px)) * 4) / 4)); }

const reducedMQ = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
export const reduced = () => !!reducedMQ?.matches;
