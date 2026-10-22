// Effect sprites and strokes shared by the map and the battle viewer: additive glows, beams and tracers, muzzle
// flashes, fireballs, smoke, shield shimmer and the CALLED IT / CAUGHT OUT rubber stamp. Everything is either a
// cached sprite or a couple of strokes, so a busy frame stays cheap.
import { type RGB, TAU, css, rgb, mix, canvas, rand } from './util.ts';

const glowCache = new Map<string, HTMLCanvasElement>();
/** Soft round glow (128px), white core fading through the colour. */
export function glow(col: RGB | string, core = 0.85): HTMLCanvasElement {
  const c = typeof col === 'string' ? rgb(col) : col;
  const key = `${c.join(',')}|${core}`;
  let s = glowCache.get(key);
  if (!s) {
    s = canvas(128, 128);
    const g = s.getContext('2d')!;
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, `rgba(255,255,255,${core})`); gr.addColorStop(0.12, css(mix(c, [255, 255, 255], 0.4), 0.9)); gr.addColorStop(0.35, css(c, 0.4)); gr.addColorStop(0.7, css(c, 0.08)); gr.addColorStop(1, css(c, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    glowCache.set(key, s);
  }
  return s;
}
export function drawGlow(g: CanvasRenderingContext2D, x: number, y: number, r: number, col: RGB | string, alpha = 1, core = 0.85) {
  if (alpha <= 0.01 || r <= 0) return;
  const pa = g.globalAlpha, pc = g.globalCompositeOperation;
  g.globalCompositeOperation = 'lighter'; g.globalAlpha = pa * Math.min(1, alpha);
  g.drawImage(glow(col, core), x - r, y - r, r * 2, r * 2);
  g.globalAlpha = pa; g.globalCompositeOperation = pc;
}

/** A lance beam: wide coloured glow + a hot core. w = core width (ctx units). */
export function beam(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, col: RGB | string, w: number, alpha = 1) {
  if (alpha <= 0.01) return;
  const c = typeof col === 'string' ? rgb(col) : col;
  const pa = g.globalAlpha, pc = g.globalCompositeOperation;
  g.globalCompositeOperation = 'lighter';
  g.lineCap = 'round';
  g.globalAlpha = pa * alpha * 0.35; g.strokeStyle = css(c); g.lineWidth = w * 4; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  g.globalAlpha = pa * alpha * 0.8; g.lineWidth = w * 1.8; g.stroke();
  g.globalAlpha = pa * alpha; g.strokeStyle = css(mix(c, [255, 255, 255], 0.75)); g.lineWidth = w * 0.7; g.stroke();
  g.globalAlpha = pa; g.globalCompositeOperation = pc;
}

/** A macro-cannon shell / plasma bolt in flight: a short bright streak from (tail) to (head). */
export function tracer(g: CanvasRenderingContext2D, tx: number, ty: number, hx: number, hy: number, col: RGB | string, w: number, alpha = 1) {
  if (alpha <= 0.01) return;
  const c = typeof col === 'string' ? rgb(col) : col;
  const pa = g.globalAlpha, pc = g.globalCompositeOperation;
  g.globalCompositeOperation = 'lighter';
  const gr = g.createLinearGradient(tx, ty, hx, hy);
  gr.addColorStop(0, css(c, 0)); gr.addColorStop(0.7, css(c, 0.8)); gr.addColorStop(1, css(mix(c, [255, 255, 255], 0.8), 1));
  g.strokeStyle = gr; g.lineCap = 'round'; g.lineWidth = w; g.globalAlpha = pa * alpha;
  g.beginPath(); g.moveTo(tx, ty); g.lineTo(hx, hy); g.stroke();
  g.globalAlpha = pa; g.globalCompositeOperation = pc;
  drawGlow(g, hx, hy, w * 2.6, c, alpha * 0.9);
}

// ------------------------------------------------------------------ fireball + smoke sprites
let fireSpr: HTMLCanvasElement[] | null = null;
/** 6 fireball frames (billowy, noisy edges), 96px each. */
function fireFrames(): HTMLCanvasElement[] {
  if (fireSpr) return fireSpr;
  fireSpr = [];
  for (let f = 0; f < 6; f++) {
    const c = canvas(96, 96), g = c.getContext('2d')!;
    const r = rand(900 + f);
    const k = f / 5;
    for (let i = 0; i < 16; i++) {
      const a = r() * TAU, d = r() * 22 * (0.4 + k), rr = 10 + r() * 18 * (1 - k * 0.3);
      const x = 48 + Math.cos(a) * d, y = 48 + Math.sin(a) * d;
      const gr = g.createRadialGradient(x, y, 0, x, y, rr);
      const hot = 1 - k;
      gr.addColorStop(0, `rgba(255,${Math.round(230 * hot + 120 * k)},${Math.round(170 * hot + 60 * k)},${0.9 - k * 0.4})`);
      gr.addColorStop(0.5, `rgba(255,${Math.round(120 * hot + 60 * k)},${Math.round(40)},${0.6 - k * 0.3})`);
      gr.addColorStop(1, 'rgba(120,20,10,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, rr, 0, TAU); g.fill();
    }
    fireSpr.push(c);
  }
  return fireSpr;
}
/** Fireball at progress t (0..1), radius r. Additive. */
export function fireball(g: CanvasRenderingContext2D, x: number, y: number, r: number, t: number, alpha = 1) {
  if (t < 0 || t > 1) return;
  const fr = fireFrames();
  const i = Math.min(fr.length - 1, Math.floor(t * fr.length));
  const s = r * (0.6 + 0.8 * Math.sqrt(t)) * 2;
  const pa = g.globalAlpha, pc = g.globalCompositeOperation;
  g.globalCompositeOperation = 'lighter'; g.globalAlpha = pa * alpha * (1 - t * t);
  g.drawImage(fr[i], x - s / 2, y - s / 2, s, s);
  g.globalAlpha = pa; g.globalCompositeOperation = pc;
  if (t < 0.25) drawGlow(g, x, y, r * (1.6 + t * 4), [255, 230, 190], alpha * (1 - t / 0.25));
}

let smokeSpr: HTMLCanvasElement | null = null;
export function smoke(g: CanvasRenderingContext2D, x: number, y: number, r: number, alpha: number) {
  if (alpha <= 0.01) return;
  if (!smokeSpr) {
    smokeSpr = canvas(64, 64);
    const s = smokeSpr.getContext('2d')!;
    const rr = rand(31);
    for (let i = 0; i < 9; i++) {
      const x0 = 32 + (rr() - 0.5) * 22, y0 = 32 + (rr() - 0.5) * 22, R = 10 + rr() * 12;
      const gr = s.createRadialGradient(x0, y0, 0, x0, y0, R);
      gr.addColorStop(0, 'rgba(70,66,72,0.5)'); gr.addColorStop(1, 'rgba(40,38,46,0)');
      s.fillStyle = gr; s.beginPath(); s.arc(x0, y0, R, 0, TAU); s.fill();
    }
  }
  const pa = g.globalAlpha;
  g.globalAlpha = pa * alpha;
  g.drawImage(smokeSpr, x - r, y - r, r * 2, r * 2);
  g.globalAlpha = pa;
}

// ------------------------------------------------------------------ shields
/** Shield shimmer: a warm glass bubble arc centred toward `ang` (the incoming shot), brightness a. */
export function shieldHit(g: CanvasRenderingContext2D, x: number, y: number, r: number, ang: number, col: RGB | string, a: number) {
  if (a <= 0.01) return;
  const c = typeof col === 'string' ? rgb(col) : col;
  g.save();
  g.globalCompositeOperation = 'lighter';
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.clip();
  const gr = g.createRadialGradient(x + Math.cos(ang) * r, y + Math.sin(ang) * r, 0, x + Math.cos(ang) * r, y + Math.sin(ang) * r, r * 1.6);
  gr.addColorStop(0, css(c, 0.55 * a)); gr.addColorStop(1, css(c, 0));
  g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  // warm glass, not a hex grid (ART-BIBLE §8): two faint ripples running out from the impact
  g.globalAlpha = 0.45 * a;
  g.strokeStyle = css(mix(c, [255, 245, 225], 0.4), 1);
  for (const k of [0.45, 0.8]) {
    g.lineWidth = Math.max(0.8, r * 0.035);
    g.beginPath(); g.arc(x + Math.cos(ang) * r, y + Math.sin(ang) * r, r * k * (1.4 - a * 0.4), 0, TAU); g.stroke();
  }
  g.restore();
  g.save(); g.globalCompositeOperation = 'lighter';
  g.strokeStyle = css(mix(c, [255, 255, 255], 0.5), 0.9 * a); g.lineWidth = Math.max(1, r * 0.06);
  g.beginPath(); g.arc(x, y, r, ang - 0.8, ang + 0.8); g.stroke();
  g.restore();
}

// ------------------------------------------------------------------ the rubber stamp (CALLED IT / CAUGHT OUT)
/** A stamp slamming onto the table: t 0..1 over its life. */
export function stamp(g: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, col: string, t: number) {
  if (t < 0 || t > 1) return;
  const slam = t < 0.12 ? 1 + (1 - t / 0.12) * 1.6 : 1;
  const a = t < 0.12 ? t / 0.12 : t > 0.8 ? 1 - (t - 0.8) / 0.2 : 1;
  g.save();
  g.translate(x, y); g.rotate(-0.12); g.scale(slam, slam);
  g.globalAlpha *= a;
  g.font = `900 ${px}px "Cinzel",Georgia,serif`;
  const w = g.measureText(text).width + px * 1.1, h = px * 1.7;
  g.strokeStyle = col; g.lineWidth = px * 0.14;
  g.strokeRect(-w / 2, -h / 2, w, h);
  g.lineWidth = px * 0.05; g.strokeRect(-w / 2 + px * 0.2, -h / 2 + px * 0.2, w - px * 0.4, h - px * 0.4);
  g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 0, px * 0.06);
  // ink wear: knock some specks out of the stamp
  g.globalCompositeOperation = 'destination-out';
  const r = rand(text.length * 97);
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(0,0,0,${0.3 + r() * 0.5})`; g.fillRect((r() - 0.5) * w, (r() - 0.5) * h, 1 + r() * px * 0.12, 1 + r() * px * 0.06); }
  g.restore();
}
