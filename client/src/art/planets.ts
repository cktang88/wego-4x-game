// Painted planets and stars. Planets are shaded per pixel once (terminator, surface by world type, clouds, city
// lights on the night side for developed worlds, emissive lava, atmosphere rim, rings) and cached per size bucket.
// The API is body-based so a star system can later be drawn as one star plus 1–3 bodies (docs/SYSTEMS.md).
import { type RGB, LIGHT3, TAU, css, mix, canvas, SpriteCache, fbm3, noise3, h2, rgb, strHash } from './util.ts';

export type WorldType = 'terran' | 'garden' | 'ocean' | 'desert' | 'ice' | 'lava' | 'barren' | 'gas' | 'toxic' | 'ash' | 'crystal' | 'thorn';
export type StarType = 'yellow' | 'red' | 'blue' | 'white' | 'binary' | 'pulsar' | 'blackhole' | 'throne';
export interface Body { type: WorldType; seed: number; /** 0–5: city lights on the night side */ dev?: number; ring?: boolean; /** gas giant band hue */ hue?: number }

interface WorldStyle { ramp: [number, RGB][]; atm: RGB | null; atmA: number; clouds: number; ocean?: number; freq: number; spec?: number }
const STY: Record<WorldType, WorldStyle> = {
  terran: { ramp: [[0, [18, 44, 96]], [0.47, [34, 82, 140]], [0.5, [196, 180, 128]], [0.54, [70, 120, 60]], [0.7, [96, 110, 66]], [0.82, [120, 104, 84]], [0.93, [236, 236, 240]]], atm: [120, 180, 255], atmA: 0.7, clouds: 0.55, ocean: 0.5, freq: 1.6, spec: 0.6 },
  garden: { ramp: [[0, [22, 64, 110]], [0.4, [40, 110, 150]], [0.43, [200, 196, 140]], [0.47, [62, 140, 70]], [0.7, [44, 110, 52]], [0.85, [88, 130, 60]], [1, [210, 220, 190]]], atm: [140, 210, 255], atmA: 0.75, clouds: 0.5, ocean: 0.43, freq: 1.5, spec: 0.5 },
  ocean: { ramp: [[0, [10, 34, 84]], [0.6, [24, 84, 150]], [0.66, [60, 150, 180]], [0.7, [210, 200, 150]], [0.76, [70, 130, 80]], [1, [230, 240, 245]]], atm: [110, 190, 255], atmA: 0.75, clouds: 0.6, ocean: 0.66, freq: 1.7, spec: 0.8 },
  desert: { ramp: [[0, [120, 70, 40]], [0.35, [176, 112, 60]], [0.55, [214, 162, 98]], [0.75, [190, 130, 76]], [1, [236, 210, 160]]], atm: [255, 196, 140], atmA: 0.45, clouds: 0.12, freq: 2.2 },
  ice: { ramp: [[0, [90, 120, 160]], [0.4, [160, 196, 220]], [0.6, [214, 232, 244]], [1, [250, 252, 255]]], atm: [190, 230, 255], atmA: 0.5, clouds: 0.25, freq: 2.4, spec: 0.4 },
  lava: { ramp: [[0, [24, 14, 14]], [0.4, [52, 30, 26]], [0.7, [80, 50, 40]], [1, [120, 86, 70]]], atm: [255, 120, 60], atmA: 0.35, clouds: 0, freq: 2.0 },
  barren: { ramp: [[0, [70, 66, 70]], [0.4, [110, 104, 104]], [0.7, [146, 140, 136]], [1, [190, 184, 176]]], atm: null, atmA: 0, clouds: 0, freq: 2.6 },
  gas: { ramp: [[0, [140, 90, 60]], [0.3, [200, 150, 100]], [0.5, [236, 210, 170]], [0.7, [176, 120, 80]], [1, [230, 196, 150]]], atm: [255, 220, 170], atmA: 0.45, clouds: 0, freq: 1 },
  toxic: { ramp: [[0, [60, 70, 20]], [0.4, [120, 140, 40]], [0.6, [180, 190, 70]], [1, [220, 230, 140]]], atm: [200, 255, 120], atmA: 0.55, clouds: 0.35, freq: 1.8 },
  ash: { ramp: [[0, [30, 28, 30]], [0.4, [70, 64, 62]], [0.7, [120, 112, 106]], [1, [180, 172, 160]]], atm: [255, 150, 90], atmA: 0.35, clouds: 0.2, freq: 2.2 },
  crystal: { ramp: [[0, [40, 90, 130]], [0.4, [110, 190, 220]], [0.7, [190, 240, 250]], [1, [255, 255, 255]]], atm: [160, 240, 255], atmA: 0.6, clouds: 0, freq: 3.2, spec: 1 },
  thorn: { ramp: [[0, [40, 10, 18]], [0.4, [100, 24, 36]], [0.7, [150, 50, 50]], [1, [200, 130, 110]]], atm: [255, 90, 110], atmA: 0.45, clouds: 0.15, freq: 2.6 },
};

function ramp(r: [number, RGB][], t: number): RGB {
  if (t <= r[0][0]) return r[0][1];
  for (let i = 1; i < r.length; i++) if (t <= r[i][0]) { const a = r[i - 1], b = r[i]; return mix(a[1], b[1], (t - a[0]) / (b[0] - a[0])); }
  return r[r.length - 1][1];
}
const sstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const GAS_HUES: [number, RGB][][] = [
  GAS_RAMP([140, 90, 60], [236, 210, 170]),
  GAS_RAMP([60, 90, 140], [200, 220, 240]),
  GAS_RAMP([110, 70, 120], [230, 200, 220]),
  GAS_RAMP([120, 110, 70], [240, 230, 190]),
];
function GAS_RAMP(a: RGB, b: RGB): [number, RGB][] { return [[0, a], [0.3, mix(a, b, 0.55)], [0.5, b], [0.7, mix(a, b, 0.3)], [1, mix(b, [255, 255, 255], 0.2)]]; }

/** Paint a sphere of radius R (device px) into a fresh canvas; centre at (cx, cy) = canvas centre. */
function paintSphere(b: Body, R: number, pad: number): HTMLCanvasElement {
  const size = Math.ceil(R * 2 + pad * 2);
  const cv = canvas(size, size);
  const g = cv.getContext('2d')!;
  const st = STY[b.type];
  const img = g.createImageData(size, size);
  const D = img.data;
  const cx = size / 2, cy = size / 2;
  const s = b.seed;
  // a random tilt so worlds of one type don't look stamped
  const ta = (h2(s, 1) - 0.5) * 1.2, ca = Math.cos(ta), sa = Math.sin(ta);
  const gasR = b.type === 'gas' ? GAS_HUES[(b.hue ?? s) % GAS_HUES.length] : null;
  const dev = b.dev ?? 0;
  const [lx, ly, lz] = LIGHT3;
  const craters: [number, number, number, number][] = [];
  if (b.type === 'barren' || b.type === 'ash' || b.type === 'ice') for (let i = 0; i < 14; i++) {
    const u = h2(s, i * 3 + 7) * 2 - 1, th = h2(s, i * 3 + 8) * TAU, rr = Math.sqrt(1 - u * u);
    craters.push([rr * Math.cos(th), rr * Math.sin(th), u, 0.06 + h2(s, i * 3 + 9) * 0.16]);
  }
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const x = (px + 0.5 - cx) / R, y = (py + 0.5 - cy) / R;
    const r2 = x * x + y * y;
    if (r2 > 1.0 + 2 / R) continue;
    const z = Math.sqrt(Math.max(0, 1 - r2));
    // texture coordinates on the tilted sphere
    const X = x * ca - y * sa, Y = x * sa + y * ca, Z = z;
    const f = st.freq;
    let col: RGB;
    let emit: RGB | null = null;
    let spec = 0;
    let landMask = 1;
    if (gasR) {
      const warp = fbm3(X * 2, Y * 2, Z * 2, 3, s) - 0.5;
      const band = 0.5 + 0.5 * Math.sin(Y * 9 + warp * 3.4 + h2(s, 3) * 6);
      const fine = fbm3(X * 1.5, Y * 14, Z * 1.5, 2, s + 9);
      col = ramp(gasR, band * 0.75 + fine * 0.25);
      // a great storm
      const sxp = 0.35 - X, syp = 0.3 - Y;
      const sd = (sxp * sxp) / 0.03 + (syp * syp) / 0.008;
      if (sd < 1 && Z > 0) col = mix(col, mix(gasR[0][1], [255, 230, 210], 0.3), (1 - sd) * 0.8);
    } else {
      let n = fbm3(X * f + 7, Y * f + 3, Z * f, 5, s);
      if (b.type === 'crystal') n = Math.floor(n * 7) / 7 + fbm3(X * 6, Y * 6, Z * 6, 1, s) * 0.08;
      col = ramp(st.ramp, n);
      if (st.ocean !== undefined) { landMask = sstep(st.ocean - 0.005, st.ocean + 0.01, n); spec = (1 - landMask) * (st.spec ?? 0); }
      else spec = (st.spec ?? 0) * 0.3;
      // polar caps on temperate worlds
      if (b.type === 'terran' || b.type === 'garden' || b.type === 'ocean') { const pc = sstep(0.8, 0.9, Math.abs(Y) + (n - 0.5) * 0.25); if (pc > 0) { col = mix(col, [236, 242, 248], pc * 0.9); landMask *= 1 - pc; } }
      if (b.type === 'lava') {
        const c = Math.abs(fbm3(X * 3 + 11, Y * 3, Z * 3, 4, s + 5) - 0.5);
        if (c < 0.05) emit = mix([255, 220, 120], [255, 70, 20], c / 0.05);
      }
      if (b.type === 'thorn') { const c = Math.abs(fbm3(X * 4, Y * 4, Z * 4, 3, s + 5) - 0.5); if (c < 0.03) col = mix(col, [30, 4, 8], 0.8); }
      if (b.type === 'ice') { const c = Math.abs(fbm3(X * 5, Y * 5, Z * 5, 3, s + 5) - 0.5); if (c < 0.02) col = mix(col, [70, 110, 150], 0.6); }
      for (const [qx, qy, qz, qr] of craters) {
        const d = Math.hypot(X - qx, Y - qy, Z - qz);
        if (d < qr) { const k = d / qr; col = mix(col, k > 0.8 ? mix(col, [230, 226, 220], 0.4) : mix(col, [20, 18, 22], 0.35), k > 0.8 ? (k - 0.8) * 4 : 0.6); }
      }
      if (st.clouds > 0) {
        const cl = fbm3(X * 2.4 + 20, Y * 4 + 5, Z * 2.4, 4, s + 31);
        const ca2 = sstep(1 - st.clouds * 0.62, 1 - st.clouds * 0.62 + 0.18, cl) * 0.85;
        col = mix(col, [246, 248, 252], ca2);
        spec *= 1 - ca2; landMask = Math.max(0, landMask - ca2);
      }
    }
    // lamp lighting with a soft painted terminator, cool bounce on the dark side
    const d = x * lx + y * ly + z * lz;
    const day = sstep(-0.18, 0.42, d);
    const lamb = Math.max(0, d);
    let r = col[0] * (0.1 + 0.95 * lamb * 1.08) * day + col[0] * 0.08 * (1 - day) + 10 * (1 - day);
    let gg = col[1] * (0.1 + 0.95 * lamb * 1.02) * day + col[1] * 0.08 * (1 - day) + 14 * (1 - day);
    let bb = col[2] * (0.1 + 0.95 * lamb * 0.95) * day + col[2] * 0.1 * (1 - day) + 30 * (1 - day);
    // ocean glint
    if (spec > 0) {
      const hz = lz + 1, hl = Math.hypot(lx, ly, hz);
      const nh = (x * lx + y * ly + z * hz) / hl;
      const sp = Math.pow(Math.max(0, nh), 40) * spec * 255;
      r += sp; gg += sp * 0.95; bb += sp * 0.85;
    }
    // city lights on the night side of developed worlds
    if (dev > 0 && landMask > 0.5 && day < 0.6) {
      const cn = noise3(X * 46, Y * 46, Z * 46, s + 77) * 0.6 + noise3(X * 9, Y * 9, Z * 9, s + 78) * 0.4;
      const thr = 0.8 - dev * 0.035;
      if (cn > thr) { const k = Math.min(1, (cn - thr) * 7) * (1 - day / 0.6) * landMask * 0.85; r += 255 * k; gg += 176 * k; bb += 84 * k; }
    }
    if (emit) { const k = 0.65 + 0.35 * (1 - day); r += emit[0] * k; gg += emit[1] * k; bb += emit[2] * k; }
    // atmosphere rim (fresnel), brighter on the lit limb
    if (st.atm) {
      const fr = Math.pow(1 - z, 2.4) * st.atmA * (0.25 + 0.9 * sstep(-0.3, 0.5, d));
      r += (st.atm[0] - r) * fr; gg += (st.atm[1] - gg) * fr; bb += (st.atm[2] - bb) * fr;
    }
    const i = (py * size + px) * 4;
    const edge = Math.max(0, Math.min(1, (1 - Math.sqrt(r2)) * R + 0.5));
    D[i] = Math.min(255, r); D[i + 1] = Math.min(255, gg); D[i + 2] = Math.min(255, bb); D[i + 3] = 255 * edge;
  }
  g.putImageData(img, 0, 0);
  // outer atmosphere haze
  if (st.atm) {
    const ag = g.createRadialGradient(cx, cy, R * 0.95, cx, cy, R * 1.22);
    ag.addColorStop(0, css(st.atm, 0.32 * st.atmA)); ag.addColorStop(1, css(st.atm, 0));
    g.globalCompositeOperation = 'destination-over';
    g.fillStyle = ag; g.beginPath(); g.arc(cx, cy, R * 1.22, 0, TAU); g.fill();
    g.globalCompositeOperation = 'source-over';
  }
  return cv;
}

const cache = new SpriteCache<{ img: HTMLCanvasElement; R: number; size: number }>(260);
function pBucket(px: number) { return Math.max(3, Math.round(Math.pow(2, Math.round(Math.log2(Math.max(3, px)) * 2) / 2))); }

// ---- lazy baking: a sprite that isn't ready is stood in for by the nearest size already baked (or a small quick
// bake), and the real one is painted in idle time; listeners (the map) are told so they can refresh.
const MAX_R = 96;
const pending = new Map<string, { job: () => void; gen: number; R: number }>();
const listeners = new Set<() => void>();
let pumping = false;
let gen = 0;
/** Called after lazily-baked art becomes available (redraw cached layers). Returns an unsubscribe. */
export function onArtReady(cb: () => void): () => void { listeners.add(cb); return () => listeners.delete(cb); }
/** A new static redraw starts: bake requests not renewed by it are dropped (the camera moved on). */
export function artGeneration() { gen++; }
function pump() {
  if (pumping) return;
  pumping = true;
  const step = () => {
    const t0 = performance.now();
    let n = 0;
    for (const [k, p] of pending) {
      if (p.gen < gen - 1) { pending.delete(k); continue; }
      if (n && (performance.now() - t0 > 5 || p.R > 56)) break;
      pending.delete(k); p.job(); n++;
    }
    if (n) for (const l of listeners) l();
    if (pending.size) setTimeout(step, 24); else pumping = false;
  };
  setTimeout(step, 40);
}
const sizesOf = new Map<string, Set<number>>();

/** A planet sprite of radius ~Rdev device px (bucketed). Rings are baked in for ringed bodies. With `lazy`, a
 *  missing size is substituted (nearest baked size, else a quick small bake) and painted later. */
export function planetSprite(b: Body, Rdev: number, lazy = false) {
  const R = Math.min(MAX_R, pBucket(Rdev));
  const base = `${b.type}|${b.seed}|${b.dev ?? 0}|${b.ring ? 1 : 0}|${b.hue ?? 0}`;
  const key = `${base}|${R}`;
  const have = sizesOf.get(base);
  if (lazy && R > 32 && !(have?.has(R) && cache.has(key))) {
    const p = pending.get(key);
    if (p) p.gen = gen; else { pending.set(key, { job: () => { bakePlanet(b, R, base, key); }, gen, R }); pump(); }
    let best = -1;
    if (have) for (const r of have) if (cache.has(`${base}|${r}`) && Math.abs(Math.log(r / R)) < Math.abs(Math.log(best / R) || 99)) best = r;
    if (best > 0) return cache.get(`${base}|${best}`, () => { throw new Error('gone'); });
    return bakePlanet(b, Math.min(R, 20), base, `${base}|${Math.min(R, 20)}`);
  }
  return bakePlanet(b, R, base, key);
}
function bakePlanet(b: Body, R: number, base: string, key: string) {
  let set = sizesOf.get(base);
  if (!set) { set = new Set(); sizesOf.set(base, set); }
  set.add(R);
  return cache.get(key, () => {
    const ringK = b.ring ? 2.25 : 1.3;
    const pad = R * (ringK - 1) + 2;
    const sph = paintSphere(b, R, R * 0.3 + 2);
    const size = Math.ceil(R * 2 + pad * 2);
    const cv = canvas(size, size);
    const g = cv.getContext('2d')!;
    const c = size / 2;
    const tilt = -0.32 + (h2(b.seed, 5) - 0.5) * 0.3;
    const drawRing = (front: boolean) => {
      g.save(); g.translate(c, c); g.rotate(tilt);
      g.beginPath();
      if (front) { g.rect(-size, 0, size * 2, size); } else { g.rect(-size, -size, size * 2, size); }
      g.clip();
      for (let i = 0; i < 9; i++) {
        const rr = R * (1.35 + i * 0.09);
        const a = [0.55, 0.3, 0.7, 0.2, 0.5, 0.65, 0.12, 0.4, 0.25][i];
        g.strokeStyle = `rgba(${226 - i * 6},${206 - i * 8},${170 - i * 6},${a})`;
        g.lineWidth = Math.max(0.6, R * 0.08);
        g.beginPath(); g.ellipse(0, 0, rr, rr * 0.28, 0, 0, TAU); g.stroke();
      }
      g.restore();
    };
    if (b.ring) drawRing(false);
    g.drawImage(sph, c - sph.width / 2, c - sph.height / 2);
    if (b.ring) drawRing(true);
    return { img: cv, R, size };
  });
}

/** Draw a body centred at (x, y) with radius r (ctx units), rDev = r in device px. */
export function drawPlanet(g: CanvasRenderingContext2D, x: number, y: number, r: number, rDev: number, b: Body, lazy = false) {
  const s = planetSprite(b, rDev, lazy);
  const k = r / s.R;
  g.drawImage(s.img, x - (s.size * k) / 2, y - (s.size * k) / 2, s.size * k, s.size * k);
}

/** The cast shadow of a floating body on the mat (soft ellipse, offset away from the lamp). */
export function drawBodyShadow(g: CanvasRenderingContext2D, x: number, y: number, r: number, alpha = 0.45) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, `rgba(0,0,6,${alpha})`); gr.addColorStop(1, 'rgba(0,0,6,0)');
  g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, r, r * 0.55, 0, 0, TAU); g.fill();
}

// ------------------------------------------------------------------ stars
const starCache = new SpriteCache<{ img: HTMLCanvasElement; R: number; size: number }>(60);
const STAR: Record<StarType, { core: RGB; glow: RGB; rays: number }> = {
  yellow: { core: [255, 240, 200], glow: [255, 196, 90], rays: 4 },
  red: { core: [255, 190, 150], glow: [255, 90, 50], rays: 0 },
  blue: { core: [220, 236, 255], glow: [110, 160, 255], rays: 6 },
  white: { core: [255, 255, 255], glow: [200, 220, 255], rays: 4 },
  binary: { core: [255, 236, 200], glow: [255, 170, 110], rays: 4 },
  pulsar: { core: [230, 250, 255], glow: [120, 220, 255], rays: 2 },
  blackhole: { core: [0, 0, 0], glow: [255, 170, 90], rays: 0 },
  throne: { core: [255, 248, 220], glow: [255, 200, 90], rays: 8 },
};
/** A star (glow, corona, rays) of core radius ~Rdev device px; black holes get an accretion disk. */
export function starSprite(type: StarType, Rdev: number) {
  const R = pBucket(Rdev);
  return starCache.get(`${type}|${R}`, () => {
    const S = STAR[type];
    const size = Math.ceil(R * 9);
    const cv = canvas(size, size);
    const g = cv.getContext('2d')!;
    const c = size / 2;
    if (type === 'blackhole') {
      // lensed glow + tilted accretion disk around a black core
      const halo = g.createRadialGradient(c, c, R * 0.8, c, c, R * 4);
      halo.addColorStop(0, 'rgba(255,170,90,0.35)'); halo.addColorStop(1, 'rgba(120,40,160,0)');
      g.fillStyle = halo; g.fillRect(0, 0, size, size);
      const disk = (front: boolean) => {
        g.save(); g.translate(c, c); g.rotate(-0.35);
        g.beginPath(); if (front) g.rect(-size, 0, size * 2, size); else g.rect(-size, -size, size * 2, size); g.clip();
        for (let i = 0; i < 14; i++) {
          const rr = R * (1.25 + i * 0.16);
          g.strokeStyle = `rgba(255,${Math.round(220 - i * 10)},${Math.round(160 - i * 9)},${0.75 - i * 0.045})`;
          g.lineWidth = Math.max(0.6, R * 0.14);
          g.beginPath(); g.ellipse(0, 0, rr, rr * 0.26, 0, 0, TAU); g.stroke();
        }
        g.restore();
      };
      disk(false);
      g.fillStyle = '#000'; g.beginPath(); g.arc(c, c, R, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(255,230,190,0.95)'; g.lineWidth = Math.max(0.8, R * 0.1); g.beginPath(); g.arc(c, c, R * 1.06, 0, TAU); g.stroke();
      disk(true);
      return { img: cv, R, size };
    }
    const glow = g.createRadialGradient(c, c, 0, c, c, size / 2);
    glow.addColorStop(0, css(S.glow, 0.85)); glow.addColorStop(0.12, css(S.glow, 0.45)); glow.addColorStop(0.4, css(S.glow, 0.1)); glow.addColorStop(1, css(S.glow, 0));
    g.fillStyle = glow; g.fillRect(0, 0, size, size);
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < S.rays; i++) {
      const a = (i / S.rays) * Math.PI + 0.3, len = size * (i % 2 ? 0.3 : 0.46);
      g.save(); g.translate(c, c); g.rotate(a);
      const rg = g.createLinearGradient(-len, 0, len, 0);
      rg.addColorStop(0, css(S.glow, 0)); rg.addColorStop(0.5, css(S.core, 0.75)); rg.addColorStop(1, css(S.glow, 0));
      g.fillStyle = rg; g.fillRect(-len, -Math.max(0.5, R * 0.06), len * 2, Math.max(1, R * 0.12));
      g.restore();
    }
    const core = g.createRadialGradient(c - R * 0.25, c - R * 0.25, 0, c, c, R);
    core.addColorStop(0, '#ffffff'); core.addColorStop(0.6, css(S.core)); core.addColorStop(1, css(S.glow, 0.9));
    g.fillStyle = core; g.beginPath(); g.arc(c, c, R, 0, TAU); g.fill();
    if (type === 'binary') { g.fillStyle = core; g.beginPath(); g.arc(c + R * 1.9, c + R * 0.8, R * 0.55, 0, TAU); g.fill(); }
    return { img: cv, R, size };
  });
}
export function drawStar(g: CanvasRenderingContext2D, x: number, y: number, r: number, rDev: number, type: StarType) {
  const s = starSprite(type, rDev);
  const k = r / s.R;
  g.drawImage(s.img, x - (s.size * k) / 2, y - (s.size * k) / 2, s.size * k, s.size * k);
}

// ------------------------------------------------------------------ region → body
export interface BodyLike { kind: string; q?: string; adj?: string; name?: string }
export interface RegionLike { id: number; kind: string; name: string; trait?: string | null; dev: number; feature?: string; star?: string; bodies?: BodyLike[] }
const HAB_ART: Record<string, WorldType> = {
  garden: 'garden', jungle: 'garden', temperate: 'terran', ocean: 'ocean', archipelago: 'ocean', steppe: 'terran', savanna: 'desert',
  desert: 'desert', tundra: 'ice', arid: 'desert', ice: 'ice', toxic: 'toxic', dust: 'barren', cinder: 'ash',
};
/** The world type a system body is painted as (null: not a sphere, e.g. a belt or a ruin). */
export function bodyWorldType(b: BodyLike, regionKind = '', regionName = ''): WorldType | null {
  switch (b.kind) {
    case 'habitable':
      if (regionKind === 'crown') return /ash/i.test(regionName) ? 'ash' : /glass/i.test(regionName) ? 'crystal' : /thorn/i.test(regionName) ? 'thorn' : 'garden';
      if (regionKind === 'home') return 'terran';
      return HAB_ART[b.adj ?? ''] ?? 'terran';
    case 'barren': return b.q === 'rich' ? 'lava' : 'barren';
    case 'gas': return 'gas';
    case 'moon': return 'ice';
    default: return null;
  }
}
/** What to paint for a region: its star (Throne, relic sites, systems with no world) or its primary world and a moon. Deterministic. */
export function regionArt(r: RegionLike, seed = 0): { star?: StarType; body?: Body; moon?: Body } {
  const s = (strHash(r.name) ^ (r.id * 2654435761) ^ seed) >>> 0;
  if (r.kind === 'lane') return {};
  if (r.kind === 'throne') return { star: 'throne' };
  if (r.bodies && r.star) {
    // star systems: the first paintable body (habitable first) is the primary; a second sphere is its moon
    const order = r.bodies.slice().sort((a, b) => (a.kind === 'habitable' ? 0 : 1) - (b.kind === 'habitable' ? 0 : 1));
    const prim = r.kind === 'relic' ? undefined : order.find(b => bodyWorldType(b, r.kind, r.name));
    if (!prim) return r.kind === 'void' && !r.bodies.length ? {} : { star: (r.star === 'yellow' ? 'yellow' : r.star) as StarType };
    const type = bodyWorldType(prim, r.kind, r.name)!;
    const body: Body = { type, seed: s % 100000, dev: Math.max(0, Math.min(5, r.dev)), ring: type === 'gas' || (type === 'ice' && s % 5 === 0), hue: s % 4 };
    const m = order.find(b => b !== prim && bodyWorldType(b, r.kind, r.name));
    const moon: Body | undefined = m ? { type: bodyWorldType(m, r.kind, r.name)!, seed: (s >> 3) % 100000, hue: (s >> 5) % 4 } : undefined;
    return { body, moon };
  }
  if (r.kind === 'void') return {};
  if (r.kind === 'relic') return { star: s % 2 ? 'blackhole' : 'pulsar', body: { type: 'barren', seed: s, dev: 0 } };
  let type: WorldType;
  if (r.kind === 'crown') type = /ash/i.test(r.name) ? 'ash' : /glass/i.test(r.name) ? 'crystal' : /thorn/i.test(r.name) ? 'thorn' : 'garden';
  else if (r.trait === 'forge') type = 'lava';
  else if (r.trait === 'garden') type = 'garden';
  else if (r.trait === 'bulwark') type = 'barren';
  else if (r.trait === 'gas') type = 'gas';
  else if (r.kind === 'home') type = 'terran';
  else type = (['terran', 'ocean', 'desert', 'desert', 'ice', 'barren', 'toxic', 'ocean'] as WorldType[])[s % 8];
  const body: Body = { type, seed: s % 100000, dev: Math.max(0, Math.min(5, r.dev)), ring: type === 'gas' || (type === 'ice' && s % 5 === 0), hue: s % 4 };
  const moon: Body | undefined = r.trait === 'bulwark' || type === 'gas' || s % 3 === 0 ? { type: r.trait === 'bulwark' ? 'ice' : 'barren', seed: (s >> 3) % 100000 } : undefined;
  return { body, moon };
}

export const planetCacheSize = () => cache.size;
export const _rgb = rgb;
