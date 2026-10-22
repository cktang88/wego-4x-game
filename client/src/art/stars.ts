// Painted stars: on the map every system IS its star (docs/SYSTEMS.md). One cached sprite per kind × size bucket
// × fog, painted once: a soft glow with brushed corona strokes, a limb-darkened granulated core, diffraction spikes
// on giants, two touching suns for a binary, a remnant shell for a pulsar, a lensed accretion disk round a black
// hole. The cheap per-frame parts (twinkle, pulsar beams, accretion shimmer, orbiting body specks at detail zoom)
// are separate helpers the map draws over the cached layer.
import { type RGB, TAU, css, mix, canvas, SpriteCache, fbm2, h2, strHash } from './util.ts';
import { bakeLater, drawPlanet, bodyWorldType, type Body as PlanetBody } from './planets.ts';
import { drawGlow } from './fx.ts';

export type StarKind = 'yellow' | 'red' | 'blue' | 'white' | 'binary' | 'pulsar' | 'blackhole' | 'throne';

interface Look { hot: RGB; mid: RGB; limb: RGB; glow: RGB; spikes: number; ext: number; strokes: number }
const LOOK: Record<StarKind, Look> = {
  yellow:    { hot: [255, 236, 168], mid: [255, 196, 78], limb: [214, 112, 22], glow: [255, 180, 76], spikes: 0, ext: 3.6, strokes: 22 },
  red:       { hot: [255, 150, 104], mid: [206, 56, 32], limb: [104, 12, 16], glow: [240, 50, 34], spikes: 0, ext: 3.3, strokes: 16 },
  blue:      { hot: [255, 255, 255], mid: [206, 228, 255], limb: [98, 140, 255], glow: [118, 166, 255], spikes: 4, ext: 4.6, strokes: 26 },
  white:     { hot: [255, 255, 255], mid: [238, 242, 255], limb: [168, 186, 240], glow: [196, 210, 255], spikes: 4, ext: 3.8, strokes: 20 },
  binary:    { hot: [255, 246, 214], mid: [255, 190, 100], limb: [220, 104, 36], glow: [255, 164, 92], spikes: 0, ext: 3.8, strokes: 22 },
  pulsar:    { hot: [255, 255, 255], mid: [228, 242, 255], limb: [160, 196, 255], glow: [176, 160, 255], spikes: 0, ext: 4.2, strokes: 0 },
  blackhole: { hot: [255, 240, 210], mid: [255, 170, 80], limb: [200, 70, 30], glow: [255, 140, 64], spikes: 0, ext: 3.4, strokes: 0 },
  throne:    { hot: [255, 255, 244], mid: [255, 228, 146], limb: [226, 146, 36], glow: [255, 196, 92], spikes: 8, ext: 5, strokes: 32 },
};
const COMPANION: Look = { hot: [255, 255, 255], mid: [216, 232, 255], limb: [120, 160, 255], glow: [150, 190, 255], spikes: 0, ext: 3, strokes: 0 };

/** Node footprint radius (css px at operational zoom: cap and label spacing) and the painted core as a fraction of it. */
export const STAR_NODE: Record<StarKind, { foot: number; core: number }> = {
  red: { foot: 10, core: 0.72 }, yellow: { foot: 12.5, core: 0.8 }, white: { foot: 12, core: 0.78 }, blue: { foot: 15, core: 0.86 },
  binary: { foot: 13.5, core: 0.66 }, pulsar: { foot: 11.5, core: 0.44 }, blackhole: { foot: 14, core: 0.54 }, throne: { foot: 18, core: 0.8 },
};
/** The glow colour of a kind (for owner-agnostic tints, hover, the twinkle). */
export const starGlow = (k: StarKind): RGB => LOOK[k].glow;

const sstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------ which star a region shows
export interface StarRegionLike { id: number; kind: string; name: string; star?: string | null }
/** The star painted for a region: its real star; the Throne's crown star; on old maps (no stars) a stable pick. */
export function starKindOf(r: StarRegionLike): StarKind {
  if (r.kind === 'throne') return 'throne';
  if (r.star && r.star in LOOK) return r.star as StarKind;
  const s = (strHash(r.name) ^ Math.imul(r.id, 2654435761)) >>> 0;
  if (r.kind === 'relic') return s % 2 ? 'blackhole' : 'pulsar';
  if (r.kind === 'crown' || r.kind === 'home') return 'yellow';
  return (['yellow', 'red', 'yellow', 'white', 'red', 'blue', 'binary', 'yellow'] as StarKind[])[s % 8];
}

// ------------------------------------------------------------------ painting
/** A limb-darkened, granulated sphere of light of radius R at (cx, cy), painted into its own canvas (alpha edge). */
function paintCore(R: number, L: Look, seed: number): HTMLCanvasElement {
  const size = Math.ceil(R * 2 + 4);
  const cv = canvas(size, size);
  const g = cv.getContext('2d')!;
  const img = g.createImageData(size, size);
  const D = img.data;
  const c = size / 2;
  const fine = R > 6;
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const x = (px + 0.5 - c) / R, y = (py + 0.5 - c) / R;
    const r2 = x * x + y * y;
    if (r2 > 1 + 2 / R) continue;
    const mu = Math.sqrt(Math.max(0, 1 - r2));
    const t = Math.pow(mu, 0.6);
    let col = t < 0.5 ? mix(L.limb, L.mid, t / 0.5) : mix(L.mid, L.hot, (t - 0.5) / 0.5);
    if (fine) {
      // painted granulation: broad mottling plus a fine cell texture, strongest at the centre of the disc
      const n = fbm2(x * 2.2 + 3, y * 2.2 - 5, 3, seed) - 0.5;
      const cell = fbm2(x * 7 + 11, y * 7 + 2, 2, seed + 7) - 0.5;
      const k = 1 + (n * 0.32 + cell * 0.22) * (0.35 + 0.65 * mu);
      col = [col[0] * k, col[1] * k, col[2] * k];
      // the table lamp catches the upper left like on every other miniature
      const hl = Math.max(0, 1 - Math.hypot(x + 0.38, y + 0.42) / 0.55);
      col = mix(col, [255, 255, 255], hl * hl * 0.5);
    }
    const i = (py * size + px) * 4;
    const edge = Math.max(0, Math.min(1, (1 - Math.sqrt(r2)) * R + 0.5));
    D[i] = Math.min(255, col[0]); D[i + 1] = Math.min(255, col[1]); D[i + 2] = Math.min(255, col[2]); D[i + 3] = 255 * edge;
  }
  g.putImageData(img, 0, 0);
  return cv;
}

/** Glow + brushed corona strokes around (x, y) for a core of radius R. */
function paintGlow(g: CanvasRenderingContext2D, x: number, y: number, R: number, L: Look, ext: number, seed: number, strokes: number) {
  const outer = R * ext;
  const gr = g.createRadialGradient(x, y, 0, x, y, outer);
  const k1 = 1 / ext;   // the core's edge, as a gradient stop
  gr.addColorStop(0, css(L.glow, 0.95)); gr.addColorStop(k1 * 1.05, css(L.glow, 0.62)); gr.addColorStop(k1 * 1.5, css(L.glow, 0.3));
  gr.addColorStop(Math.min(0.85, k1 * 2.3), css(L.glow, 0.1)); gr.addColorStop(1, css(L.glow, 0));
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, outer, 0, TAU); g.fill();
  const pc = g.globalCompositeOperation;
  g.globalCompositeOperation = 'lighter';
  // corona: soft tapered brush strokes, slightly curved, of uneven length (painterly, not a clean gradient)
  for (let i = 0; i < strokes; i++) {
    const a = h2(seed, i * 5 + 1) * TAU;
    const len = R * (1.35 + h2(seed, i * 5 + 2) * Math.min(1.5, ext - 1.9));
    const w = R * (0.14 + h2(seed, i * 5 + 3) * 0.2);
    const bend = (h2(seed, i * 5 + 4) - 0.5) * 0.5;
    g.save(); g.translate(x, y); g.rotate(a);
    const lg = g.createLinearGradient(R * 0.7, 0, len, 0);
    lg.addColorStop(0, css(mix(L.mid, L.glow, 0.4), 0.3)); lg.addColorStop(1, css(L.glow, 0));
    g.fillStyle = lg;
    g.beginPath(); g.moveTo(R * 0.7, -w); g.quadraticCurveTo((R + len) * 0.5, -w * 0.4 + len * bend * 0.3, len, len * bend * 0.25); g.quadraticCurveTo((R + len) * 0.5, w * 0.4 + len * bend * 0.3, R * 0.7, w); g.closePath(); g.fill();
    g.restore();
  }
  g.globalCompositeOperation = pc;
}

/** Diffraction spikes: n main (long) plus n short diagonals, tapered, hot at the root. */
function paintSpikes(g: CanvasRenderingContext2D, x: number, y: number, R: number, L: Look, n: number, len: number, rot: number) {
  const pc = g.globalCompositeOperation;
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n * 2; i++) {
    const main = i % 2 === 0;
    const a = rot + (i / (n * 2)) * TAU;
    const l = R * len * (main ? 1 : 0.5), w = R * (main ? 0.13 : 0.08);
    g.save(); g.translate(x, y); g.rotate(a);
    const lg = g.createLinearGradient(0, 0, l, 0);
    lg.addColorStop(0, css(L.hot, main ? 0.85 : 0.55)); lg.addColorStop(0.35, css(L.mid, main ? 0.4 : 0.25)); lg.addColorStop(1, css(L.glow, 0));
    g.fillStyle = lg;
    g.beginPath(); g.moveTo(0, -w); g.lineTo(l, 0); g.lineTo(0, w); g.closePath(); g.fill();
    g.restore();
  }
  g.globalCompositeOperation = pc;
}

/** Black hole: a shadow disc, a tilted accretion disk (Doppler-bright on one side, streaked), the far side of the
 *  disk lensed over the top of the shadow and a thin photon ring; a dim warm halo outside. Per pixel, once. */
function paintBlackHole(R: number, seed: number, ext: number): HTMLCanvasElement {
  const size = Math.ceil(R * 2 * ext);
  const cv = canvas(size, size);
  const g = cv.getContext('2d')!;
  const c = size / 2;
  const halo = g.createRadialGradient(c, c, R, c, c, size / 2);
  halo.addColorStop(0, 'rgba(255,150,70,0.32)'); halo.addColorStop(0.35, 'rgba(190,80,120,0.1)'); halo.addColorStop(1, 'rgba(90,40,140,0)');
  g.fillStyle = halo; g.fillRect(0, 0, size, size);
  const lay = canvas(size, size);
  const lg = lay.getContext('2d')!;
  const img = lg.createImageData(size, size);
  const D = img.data;
  const tilt = -0.3, ct = Math.cos(tilt), st = Math.sin(tilt), flat = 0.27;
  const HOT: RGB = [255, 244, 214], WARM: RGB = [255, 168, 72], DEEP: RGB = [176, 52, 30];
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const x = (px + 0.5 - c) / R, y = (py + 0.5 - c) / R;
    const d = Math.hypot(x, y);
    if (d > ext) continue;
    const u = x * ct + y * st, v = (-x * st + y * ct) / flat;
    const rho = Math.hypot(u, v);
    let er = 0, eg = 0, eb = 0;
    let front = 0;
    if (rho > 1.3 && rho < 3.1) {
      const f = sstep(1.3, 1.6, rho) * (1 - sstep(2.1, 3.1, rho));
      const phi = Math.atan2(v, u);
      const dop = 1 + 0.55 * Math.cos(phi + Math.PI);          // the approaching (left) side is brighter
      const streak = 0.55 + 0.8 * fbm2(rho * 5.5, phi * 2.2 + 9, 3, seed);
      const k = f * dop * streak;
      const tt = Math.min(1, (rho - 1.3) / 1.6);
      const col = tt < 0.35 ? mix(HOT, WARM, tt / 0.35) : mix(WARM, DEEP, (tt - 0.35) / 0.65);
      er = col[0] * k; eg = col[1] * k; eb = col[2] * k;
      front = v > 0 ? 1 : 0;
    }
    // the far disk, lensed up over the shadow (bright on top, a faint thin image underneath) + photon ring
    if (d > 0.9 && d < 2) {
      const up = -y / Math.max(d, 1e-3);
      const lens = Math.exp(-(((d - 1.3) / 0.17) ** 2)) * (0.18 + 0.82 * sstep(-0.35, 0.85, up)) * (0.75 + 0.5 * fbm2(Math.atan2(y, x) * 3, d * 4, 2, seed + 3));
      const ring = Math.exp(-(((d - 1.06) / 0.05) ** 2)) * 0.95;
      er += 255 * (lens * 0.95 + ring); eg += 200 * lens * 0.9 + 236 * ring; eb += 120 * lens * 0.8 + 200 * ring;
    }
    const i = (py * size + px) * 4;
    const inside = Math.max(0, Math.min(1, (1 - d) * R + 0.5));
    if (inside > 0 && !front) { er *= 1 - inside; eg *= 1 - inside; eb *= 1 - inside; }
    const a = Math.min(1, Math.max(er, eg, eb) / 255);
    // the shadow: near-black with the faintest cold rim, opaque over the halo
    const sa = inside;
    const outA = Math.min(1, a + sa * (1 - a));
    if (outA <= 0) continue;
    const sr = 6, sg = 4, sb = 10;
    D[i] = Math.min(255, (er + sr * sa * (1 - a)) / outA);
    D[i + 1] = Math.min(255, (eg + sg * sa * (1 - a)) / outA);
    D[i + 2] = Math.min(255, (eb + sb * sa * (1 - a)) / outA);
    D[i + 3] = 255 * outA;
  }
  lg.putImageData(img, 0, 0);
  g.drawImage(lay, 0, 0);
  return cv;
}

/** A pulsar's remnant: a faint patchy shell of violet and teal brush arcs. */
function paintRemnant(g: CanvasRenderingContext2D, x: number, y: number, R: number, seed: number) {
  const pc = g.globalCompositeOperation;
  g.globalCompositeOperation = 'lighter';
  g.lineCap = 'round';
  for (let i = 0; i < 48; i++) {
    const a0 = h2(seed, i * 3 + 1) * TAU, span = 0.5 + h2(seed, i * 3 + 2) * 1.1;
    const rr = R * (2.3 + h2(seed, i * 3 + 3) * 1.1);
    const tint: RGB = i % 3 === 0 ? [110, 220, 230] : [170, 130, 255];
    g.strokeStyle = css(tint, 0.025 + h2(seed, i * 7) * 0.04);
    g.lineWidth = R * (0.5 + h2(seed, i * 11) * 0.9);
    g.beginPath(); g.arc(x, y, rr, a0, a0 + span); g.stroke();
  }
  g.globalCompositeOperation = pc;
}

/** Fogged: half desaturated, darker, a little transparent; the type still reads (baked once per sprite). */
function fogify(cv: HTMLCanvasElement) {
  const g = cv.getContext('2d')!;
  const img = g.getImageData(0, 0, cv.width, cv.height);
  const D = img.data;
  for (let i = 0; i < D.length; i += 4) {
    if (!D[i + 3]) continue;
    const l = 0.3 * D[i] + 0.59 * D[i + 1] + 0.11 * D[i + 2];
    D[i] = (l + (D[i] - l) * 0.6) * 0.74; D[i + 1] = (l + (D[i + 1] - l) * 0.6) * 0.76; D[i + 2] = (l + (D[i + 2] - l) * 0.6) * 0.84 + 6;
    D[i + 3] *= 0.86;
  }
  g.putImageData(img, 0, 0);
}

interface Sprite { img: HTMLCanvasElement; R: number; size: number }
const cache = new SpriteCache<Sprite>(320);   // kinds x fog x size buckets a continuous zoom passes through
const MAX_R = 84;
function bucket(px: number) { return Math.max(2, Math.round(Math.pow(2, Math.round(Math.log2(Math.max(2, px)) * 3) / 3))); }

function bake(kind: StarKind, R: number, fog: boolean): Sprite {
  return cache.get(`${kind}|${R}|${fog ? 1 : 0}`, () => {
    const L = LOOK[kind];
    const seed = strHash(kind) % 9973;
    let cv: HTMLCanvasElement;
    if (kind === 'blackhole') cv = paintBlackHole(R, seed, L.ext);
    else {
      const size = Math.ceil(R * 2 * L.ext);
      cv = canvas(size, size);
      const g = cv.getContext('2d')!;
      const c = size / 2;
      if (kind === 'binary') {
        // two touching suns: a gold primary and a smaller blue-white companion, a bright bridge where they meet
        const r2 = R * 0.64, ax = c - R * 0.58, ay = c + R * 0.2, bx = ax + (R + r2 - R * 0.06) * Math.cos(-0.36), by = ay + (R + r2 - R * 0.06) * Math.sin(-0.36);
        paintGlow(g, ax, ay, R, L, L.ext * 0.9, seed, L.strokes);
        paintGlow(g, bx, by, r2, COMPANION, 3.2, seed + 5, 12);
        const core = paintCore(R, L, seed), comp = paintCore(r2, COMPANION, seed + 9);
        g.drawImage(core, ax - core.width / 2, ay - core.height / 2);
        g.drawImage(comp, bx - comp.width / 2, by - comp.height / 2);
        const mx = ax + (bx - ax) * (R / (R + r2)), my = ay + (by - ay) * (R / (R + r2));
        g.globalCompositeOperation = 'lighter';
        const br = g.createRadialGradient(mx, my, 0, mx, my, R * 0.7);
        br.addColorStop(0, 'rgba(255,250,235,0.75)'); br.addColorStop(1, 'rgba(255,220,160,0)');
        g.fillStyle = br; g.beginPath(); g.arc(mx, my, R * 0.7, 0, TAU); g.fill();
        g.globalCompositeOperation = 'source-over';
      } else {
        if (kind === 'pulsar') paintRemnant(g, c, c, R, seed);
        paintGlow(g, c, c, R, L, kind === 'pulsar' ? 2.6 : L.ext * 0.82, seed, L.strokes);
        if (L.spikes) paintSpikes(g, c, c, R, L, L.spikes, L.ext * 0.98, kind === 'throne' ? -Math.PI / 2 : 0.18);
        const core = paintCore(R, L, seed);
        g.drawImage(core, c - core.width / 2, c - core.height / 2);
        if (kind === 'pulsar') {
          // a hard white-hot point at the heart
          g.globalCompositeOperation = 'lighter';
          const hp = g.createRadialGradient(c, c, 0, c, c, R * 1.4);
          hp.addColorStop(0, 'rgba(255,255,255,0.9)'); hp.addColorStop(1, 'rgba(200,220,255,0)');
          g.fillStyle = hp; g.beginPath(); g.arc(c, c, R * 1.4, 0, TAU); g.fill();
          g.globalCompositeOperation = 'source-over';
        }
      }
    }
    if (fog) fogify(cv);
    return { img: cv, R, size: cv.width };
  });
}

const have = new Map<string, Set<number>>();
/** The star sprite for a core of ~Rdev device px (bucketed). Big sizes not baked yet are stood in for by the
 *  nearest baked size and painted in idle time (planets.ts onArtReady tells the map). */
export function starSprite(kind: StarKind, Rdev: number, fog = false, lazy = true): Sprite {
  const R = Math.min(MAX_R, bucket(Rdev));
  const base = `${kind}|${fog ? 1 : 0}`;
  let set = have.get(base);
  if (!set) { set = new Set(); have.set(base, set); }
  const key = `${kind}|${R}|${fog ? 1 : 0}`;
  // any size not baked yet is stood in for by the nearest baked one (a smooth zoom crosses many buckets: baking
  // them all synchronously stalled the frame); the exact size lands in idle time
  if (lazy && R > 5 && !(set.has(R) && cache.has(key))) {
    bakeLater(`star:${key}`, R, () => { bake(kind, R, fog); set!.add(R); });
    let best = -1;
    for (const r of set) if (cache.has(`${kind}|${r}|${fog ? 1 : 0}`) && (best < 0 || Math.abs(Math.log(r / R)) < Math.abs(Math.log(best / R)))) best = r;
    if (best > 0) return bake(kind, best, fog);
    const q = Math.min(R, 20);
    set.add(q);
    return bake(kind, q, fog);
  }
  set.add(R);
  return bake(kind, R, fog);
}

/** Draw the star of kind `kind` centred at (x, y) with core radius r (ctx units); rDev = r in device px. */
export function drawStarNode(g: CanvasRenderingContext2D, x: number, y: number, r: number, rDev: number, kind: StarKind, fog = false) {
  const s = starSprite(kind, rDev, fog);
  const k = r / s.R;
  g.drawImage(s.img, x - (s.size * k) / 2, y - (s.size * k) / 2, s.size * k, s.size * k);
}

// ------------------------------------------------------------------ per-frame animation (cheap: a few drawImages)
/** Twinkle: the glow breathes and flickers a little (alpha-modulated glow sprite, additive). */
export function drawTwinkle(g: CanvasRenderingContext2D, x: number, y: number, r: number, kind: StarKind, t: number, seed: number) {
  if (kind === 'blackhole') return;
  const ph = (seed % 997) * 0.37;
  const a = 0.13 + 0.09 * Math.sin(t * 1.3 + ph) + 0.05 * Math.sin(t * 4.1 + ph * 2.3) * Math.sin(t * 2.7 + ph);
  drawGlow(g, x, y, r * (kind === 'pulsar' ? 3.2 : 2.6), LOOK[kind].glow, Math.max(0, a));
}

let beamSprite: HTMLCanvasElement | null = null;
function beamImg(): HTMLCanvasElement {
  if (beamSprite) return beamSprite;
  const W = 256, H = 48, cv = canvas(W, H), g = cv.getContext('2d')!;
  // a cone from the centre outward both ways: hot and narrow at the root, wide and faint at the tip
  for (const dir of [-1, 1]) {
    const lg = g.createLinearGradient(W / 2, 0, W / 2 + dir * W / 2, 0);
    lg.addColorStop(0, 'rgba(240,248,255,0.95)'); lg.addColorStop(0.25, 'rgba(190,200,255,0.5)'); lg.addColorStop(1, 'rgba(160,140,255,0)');
    g.fillStyle = lg;
    g.beginPath(); g.moveTo(W / 2, H / 2 - 2); g.lineTo(W / 2 + dir * W / 2, 0); g.lineTo(W / 2 + dir * W / 2, H); g.lineTo(W / 2, H / 2 + 2); g.closePath(); g.fill();
  }
  const soft = canvas(W, H), sg = soft.getContext('2d')!;
  sg.filter = 'blur(2px)';   // softened where supported; a crisp cone elsewhere is fine
  sg.drawImage(cv, 0, 0);
  beamSprite = soft;
  return beamSprite;
}
/** Pulsar beams: a lighthouse pair sweeping round, precessing (length breathes as it tips toward us). */
export function drawPulsarBeams(g: CanvasRenderingContext2D, x: number, y: number, r: number, t: number, seed: number, alpha = 1) {
  const ang = t * 0.9 + (seed % 360) * 0.0174;
  const L = r * (6.5 + 2.2 * Math.sin(t * 1.8 + seed));
  const W = r * 1.5;
  const pc = g.globalCompositeOperation, pa = g.globalAlpha;
  g.globalCompositeOperation = 'lighter'; g.globalAlpha = pa * alpha * 0.8;
  g.save(); g.translate(x, y); g.rotate(ang);
  g.drawImage(beamImg(), -L, -W / 2, L * 2, W);
  g.restore();
  g.globalAlpha = pa; g.globalCompositeOperation = pc;
  // the core flashes as a beam sweeps past the line of sight
  const flash = Math.pow(Math.abs(Math.cos(ang * 2)), 16);
  if (flash > 0.05) drawGlow(g, x, y, r * 2.4, [220, 230, 255], flash * 0.5 * alpha);
}

/** Black-hole shimmer: hot clumps riding the accretion disk (hidden behind the shadow on the far side). */
export function drawAccretionShimmer(g: CanvasRenderingContext2D, x: number, y: number, r: number, t: number, seed: number, alpha = 1) {
  const tilt = -0.3, ct = Math.cos(tilt), st = Math.sin(tilt);
  for (let j = 0; j < 4; j++) {
    const phi = t * (0.9 - j * 0.12) + j * 1.7 + (seed % 7);
    const rho = r * (1.6 + j * 0.28);
    const u = rho * Math.cos(phi), v = rho * 0.27 * Math.sin(phi);
    const px = u * ct - v * st, py = u * st + v * ct;
    if (v < 0 && Math.hypot(px, py) < r * 1.15) continue;
    const dop = 0.6 + 0.4 * -Math.cos(phi);
    drawGlow(g, x + px, y + py, r * (0.55 - j * 0.06), [255, 214, 150], 0.4 * dop * alpha);
  }
}

// ------------------------------------------------------------------ bodies as orbiting specks (detail zoom only)
export interface SpeckBody { kind: string; q?: string; adj?: string; name?: string }
/** Orbit radii as multiples of the node footprint, and how flat the orbits are (a tilted tabletop plane). */
export const ORBIT_K = [1.5, 1.92, 2.34];
export const ORBIT_FLAT = 0.36;

/** Faint orbit lines (static layer). */
export function drawOrbitLines(g: CanvasRenderingContext2D, x: number, y: number, foot: number, n: number, lw: number, fog = false) {
  g.save();
  g.lineWidth = lw;
  for (let i = 0; i < n; i++) {
    const R = foot * ORBIT_K[i];
    g.strokeStyle = fog ? 'rgba(170,170,190,0.1)' : 'rgba(214,200,170,0.16)';
    g.beginPath(); g.ellipse(x, y, R, R * ORBIT_FLAT, 0, 0, TAU); g.stroke();
  }
  g.restore();
}

/** The system's bodies as tiny specks riding their orbits: a painted world speck for a habitable, gas or rocky body
 *  (banded and ringed for a giant), a dotted arc for a belt, a gold glint for ruins, a hex for a Station. `u` = one
 *  design px in ctx units (scaled for detail zoom); devPerUnit = device px per ctx unit. */
export function drawSpecks(g: CanvasRenderingContext2D, x: number, y: number, foot: number, bodies: SpeckBody[], t: number, seed: number,
  u: number, devPerUnit: number, regionKind: string, regionName: string, fog = false) {
  const pa = g.globalAlpha;
  if (fog) g.globalAlpha = pa * 0.5;
  bodies.slice(0, 4).forEach((b, i) => {
    const oi = Math.min(i, ORBIT_K.length - 1);
    const R = foot * ORBIT_K[oi] + (i > 2 ? 3 * u : 0);
    const w = 0.32 / (1 + oi * 0.55);
    const phi = t * w + h2(seed, i + 3) * TAU;
    const px = x + Math.cos(phi) * R, py = y + Math.sin(phi) * R * ORBIT_FLAT;
    if (b.kind === 'belt') {
      // a belt reads as rubble strewn along its orbit: a faint band under the rocks
      g.save(); g.strokeStyle = fog ? 'rgba(142,138,144,0.25)' : 'rgba(205,191,164,0.28)'; g.lineWidth = 2.6 * u; g.lineCap = 'round';
      g.beginPath(); g.ellipse(x, y, R, R * ORBIT_FLAT, 0, phi - 1.05, phi + 1.05); g.stroke(); g.restore();
      g.fillStyle = fog ? '#8e8a90' : '#cdbfa4';
      for (let k = 0; k < 13; k++) {
        const a = phi - 0.9 + k * 0.15 + (h2(seed, k + 40) - 0.5) * 0.08;
        const rr = R + (h2(seed, k + 60) - 0.5) * 2.4 * u;
        const s = (0.8 + h2(seed, k + 80) * 0.9) * u;
        g.beginPath(); g.arc(x + Math.cos(a) * rr, y + Math.sin(a) * rr * ORBIT_FLAT, s, 0, TAU); g.fill();
      }
      return;
    }
    if (b.kind === 'ruin') {
      const s = 3.4 * u;
      g.beginPath(); g.moveTo(px, py - s * 1.25); g.lineTo(px + s, py); g.lineTo(px, py + s * 1.25); g.lineTo(px - s, py); g.closePath();
      g.fillStyle = '#e8c45e'; g.fill(); g.lineWidth = 0.7 * u; g.strokeStyle = 'rgba(40,24,4,0.9)'; g.stroke();
      if (!fog) drawGlow(g, px, py, s * 2.6, [255, 220, 140], 0.35);
      return;
    }
    if (b.kind === 'station') {
      const s = 3.6 * u;
      g.beginPath();
      for (let j = 0; j < 6; j++) { const a = (j / 6) * TAU + t * 0.4; const qx = px + Math.cos(a) * s, qy = py + Math.sin(a) * s; if (j) g.lineTo(qx, qy); else g.moveTo(qx, qy); }
      g.closePath(); g.fillStyle = '#dfe4f2'; g.fill(); g.lineWidth = 0.7 * u; g.strokeStyle = 'rgba(5,3,12,0.9)'; g.stroke();
      return;
    }
    const type = bodyWorldType(b, regionKind, regionName) ?? 'barren';
    const r = (b.kind === 'gas' ? 5.4 : b.kind === 'habitable' ? 4.8 : b.kind === 'moon' ? 3 : 3.6) * u;
    const body: PlanetBody = { type, seed: (seed * 31 + i * 977) % 100000, hue: (seed + i) % 4, ring: b.kind === 'gas', dev: 0 };
    // a soft dark halo so a speck reads over the star's glow
    g.fillStyle = 'rgba(4,2,10,0.45)'; g.beginPath(); g.arc(px, py, r * 1.25, 0, TAU); g.fill();
    drawPlanet(g, px, py, r, r * devPerUnit, body);
  });
  g.globalAlpha = pa;
}
