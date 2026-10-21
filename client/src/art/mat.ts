// The tabletop: a deep-space cloth mat with printed nebulae, a fine weave, the warm pool of the lamp above the
// table and a vignette toward the dark edges of the room.
import { type RGB, TAU, canvas, fbm2, noise2, rand, css, mix } from './util.ts';

/** Screen-space cloth: base colour under the lamp, lamp pool, vignette (low-res: it's all smooth gradients). */
export function matBackdrop(w: number, h: number): HTMLCanvasElement {
  const c = canvas(Math.max(1, w / 2), Math.max(1, h / 2));
  const g = c.getContext('2d')!;
  g.scale(0.5, 0.5);
  const R = Math.hypot(w, h) * 0.62;
  const bg = g.createRadialGradient(w * 0.5, h * 0.4, 0, w * 0.5, h * 0.45, R);
  bg.addColorStop(0, '#121a33'); bg.addColorStop(0.45, '#0b1024'); bg.addColorStop(0.8, '#060814'); bg.addColorStop(1, '#030308');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  return c;
}

/** The lamp: a warm pool of light from above and a vignette, laid over the board (static layer, screen space). */
export function lampOverlay(w: number, h: number): HTMLCanvasElement {
  const c = canvas(Math.max(1, w / 2), Math.max(1, h / 2));
  const g = c.getContext('2d')!;
  g.scale(0.5, 0.5);
  const R = Math.hypot(w, h) * 0.6;
  const lamp = g.createRadialGradient(w * 0.48, h * 0.36, 0, w * 0.48, h * 0.36, R * 0.75);
  lamp.addColorStop(0, 'rgba(255,214,160,0.075)'); lamp.addColorStop(0.5, 'rgba(255,190,130,0.03)'); lamp.addColorStop(1, 'rgba(255,180,120,0)');
  g.fillStyle = lamp; g.fillRect(0, 0, w, h);
  const vg = g.createRadialGradient(w * 0.5, h * 0.45, Math.min(w, h) * 0.38, w * 0.5, h * 0.48, R);
  vg.addColorStop(0, 'rgba(0,0,6,0)'); vg.addColorStop(0.7, 'rgba(0,0,6,0.28)'); vg.addColorStop(1, 'rgba(0,0,6,0.62)');
  g.fillStyle = vg; g.fillRect(0, 0, w, h);
  return c;
}

/** A small tile of cloth weave + fibre noise, used as a repeating pattern at low alpha. */
export function weaveTile(): HTMLCanvasElement {
  const n = 96;
  const c = canvas(n, n);
  const g = c.getContext('2d')!;
  const img = g.createImageData(n, n);
  const r = rand(4711);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const weave = ((x >> 1) + (y >> 1)) % 2 ? 1 : -1;
    const fib = noise2(x * 0.7, y * 0.12, 3) - 0.5;
    const v = 128 + weave * 10 + fib * 40 + (r() - 0.5) * 30;
    const i = (y * n + x) * 4;
    img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v + 6; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** World-space printed nebula: a few soft clouds of colour with dark dust lanes and a scatter of printed stars,
 *  baked once at low resolution over the map's bounds. */
export function nebulaPrint(minX: number, minY: number, maxX: number, maxY: number, seed: number): { c: HTMLCanvasElement; x: number; y: number; w: number; h: number } {
  const pad = 700;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const S = 10;
  const W = Math.ceil((maxX - minX) / S), H = Math.ceil((maxY - minY) / S);
  const c = canvas(W, H);
  const g = c.getContext('2d')!;
  const img = g.createImageData(W, H);
  const D = img.data;
  const pal: RGB[] = [[70, 40, 150], [24, 90, 150], [150, 40, 110], [30, 120, 130], [160, 80, 50]];
  const r = rand(seed ^ 0x51ed);
  const A = pal[Math.floor(r() * pal.length)], B = pal[Math.floor(r() * pal.length)], C2 = pal[Math.floor(r() * pal.length)];
  const sc = 1 / 900;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, rad = Math.max(maxX - minX, maxY - minY) / 2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const wx = minX + x * S, wy = minY + y * S;
    const n1 = fbm2(wx * sc, wy * sc, 4, seed);
    const n2 = fbm2(wx * sc * 1.7 + 40, wy * sc * 1.7, 3, seed + 3);
    const dust = fbm2(wx * sc * 3 + 9, wy * sc * 3, 3, seed + 7);
    const d = Math.hypot(wx - cx, wy - cy) / rad;
    const fall = Math.max(0, 1 - d * d * 0.8);
    let a = Math.max(0, n1 - 0.45) * 2.2 * fall;
    let col = mix(A, B, Math.max(0, Math.min(1, (n2 - 0.35) * 2.5)));
    const hot = Math.max(0, n2 - 0.62) * 3;
    col = mix(col, C2, hot);
    a *= 1 - Math.max(0, dust - 0.55) * 2.4;
    a = Math.max(0, Math.min(0.7, a * 1.35));
    const i = (y * W + x) * 4;
    D[i] = col[0]; D[i + 1] = col[1]; D[i + 2] = col[2]; D[i + 3] = a * 255;
  }
  g.putImageData(img, 0, 0);
  // printed stars and a few star clusters (the cloth's printed galaxy)
  for (let i = 0; i < (W * H) / 90; i++) {
    const x = r() * W, y = r() * H, m = r();
    g.fillStyle = css(mix([200, 210, 255], [255, 230, 200], r()), 0.25 + m * 0.5);
    g.fillRect(x, y, m > 0.95 ? 1.4 : 0.8, m > 0.95 ? 1.4 : 0.8);
  }
  return { c, x: minX, y: minY, w: W * S, h: H * S };
}

/** Screen starfield behind/around the mat (the parallax layer). */
export function starfield(w: number, h: number, seed: number): HTMLCanvasElement {
  const c = canvas(w, h);
  const x = c.getContext('2d')!;
  const r = rand(seed ^ 0xabcdef);
  for (let i = 0; i < (w * h) / 1100; i++) {
    const a = r();
    x.fillStyle = `rgba(${200 + Math.floor(r() * 55)},${205 + Math.floor(r() * 50)},255,${0.1 + a * 0.45})`;
    const s = a > 0.975 ? 1.6 : 1;
    x.fillRect(r() * w, r() * h, s, s);
  }
  return c;
}

export { TAU };
