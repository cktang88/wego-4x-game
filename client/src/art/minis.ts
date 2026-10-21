// Miniature bases and flight stands. The base disc's enamel rim is the ownership signal (and the token's hit area);
// the clear acrylic stand lifts the model off the mat; the cast shadow sits on the cloth.
import { TAU, rgb, css, lit, shade, mix, canvas, SpriteCache, sizeBucket } from './util.ts';

export const BASE_SQUASH = 0.46;
interface BaseSpr { img: HTMLCanvasElement; rx: number; w: number; h: number; cy: number }
const cache = new SpriteCache<BaseSpr>(160);

/** Bake a base: rx in device px. */
function bakeBase(team: string, rx: number, sel: boolean, oos: boolean, big: boolean): BaseSpr {
  const T = rgb(team);
  const ry = rx * BASE_SQUASH, t = rx * (big ? 0.12 : 0.16);
  const pad = Math.ceil(rx * 0.35 + 6);
  const w = Math.ceil(rx * 2 + pad * 2), h = Math.ceil(ry * 2 + t + pad * 2);
  const c = canvas(w, h);
  const g = c.getContext('2d')!;
  const cx = w / 2, cy = pad + ry;
  // contact shadow on the cloth
  g.save();
  g.shadowColor = 'rgba(0,0,6,0.85)'; g.shadowBlur = rx * 0.25; g.shadowOffsetY = t * 0.8;
  g.fillStyle = 'rgba(0,0,6,0.6)'; g.beginPath(); g.ellipse(cx, cy + t, rx, ry, 0, 0, TAU); g.fill();
  g.restore();
  // the base's edge (side band), team enamel in shadow
  const side = g.createLinearGradient(cx - rx, 0, cx + rx, 0);
  side.addColorStop(0, css(lit(T, -0.25))); side.addColorStop(0.35, css(lit(T, -0.05))); side.addColorStop(1, css(lit(T, -0.65)));
  g.fillStyle = side;
  g.beginPath(); g.ellipse(cx, cy + t, rx, ry, 0, 0, Math.PI); g.lineTo(cx - rx, cy); g.ellipse(cx, cy, rx, ry, 0, Math.PI, 0, true); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(0,0,6,0.6)'; g.lineWidth = 1; g.beginPath(); g.ellipse(cx, cy + t, rx, ry, 0, 0, Math.PI); g.stroke();
  // top face: smoked acrylic with a faint printed hex
  const top = g.createRadialGradient(cx - rx * 0.3, cy - ry * 0.4, 0, cx, cy, rx);
  top.addColorStop(0, 'rgba(46,52,74,0.96)'); top.addColorStop(1, 'rgba(10,12,22,0.96)');
  g.fillStyle = top; g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, TAU); g.fill();
  // enamel rim in the owner colour, lit from the lamp side
  const rw = Math.max(1.6, rx * (big ? 0.11 : 0.2));
  const rim = g.createLinearGradient(cx - rx * 0.6, cy - ry, cx + rx * 0.6, cy + ry);
  rim.addColorStop(0, css(lit(T, 0.45))); rim.addColorStop(0.45, css(T)); rim.addColorStop(1, css(lit(T, -0.35)));
  g.strokeStyle = oos ? css(mix(T, [40, 40, 50], 0.55)) : rim;
  g.lineWidth = rw;
  if (oos) g.setLineDash([rw * 1.4, rw * 0.9]);
  g.beginPath(); g.ellipse(cx, cy, rx - rw / 2, ry - rw / 2 * BASE_SQUASH, 0, 0, TAU); g.stroke();
  g.setLineDash([]);
  // bevel highlight along the lit edge, dark lip inside
  g.strokeStyle = 'rgba(255,248,230,0.75)'; g.lineWidth = Math.max(0.8, rw * 0.22);
  g.beginPath(); g.ellipse(cx, cy, rx - rw * 0.15, ry - rw * 0.15 * BASE_SQUASH, 0, Math.PI * 1.05, Math.PI * 1.6); g.stroke();
  g.strokeStyle = 'rgba(0,0,8,0.55)'; g.lineWidth = Math.max(0.6, rw * 0.25);
  g.beginPath(); g.ellipse(cx, cy, rx - rw, ry - rw * BASE_SQUASH, 0, 0, TAU); g.stroke();
  if (sel) {
    g.strokeStyle = '#ffffff'; g.lineWidth = Math.max(2, rx * 0.09);
    g.shadowColor = 'rgba(255,255,255,0.8)'; g.shadowBlur = rx * 0.25;
    g.beginPath(); g.ellipse(cx, cy, rx + g.lineWidth * 0.4, ry + g.lineWidth * 0.4 * BASE_SQUASH + t * 0.3, 0, 0, TAU); g.stroke();
    g.shadowBlur = 0;
  }
  return { img: c, rx, w, h, cy };
}

/** Draw a base centred (top face) at (x, y); rx in ctx units, rxDev in device px. */
export function drawBase(g: CanvasRenderingContext2D, x: number, y: number, rx: number, rxDev: number, team: string, o: { sel?: boolean; oos?: boolean; big?: boolean } = {}) {
  const R = sizeBucket(rxDev);
  const s = cache.get(`${team}|${R}|${o.sel ? 1 : 0}|${o.oos ? 1 : 0}|${o.big ? 1 : 0}`, () => bakeBase(team, R, !!o.sel, !!o.oos, !!o.big));
  const k = rx / s.rx;
  g.drawImage(s.img, x - (s.w / 2) * k, y - s.cy * k, s.w * k, s.h * k);
}

/** Clear acrylic flight stand from the base (x, y0) up to the model (x, y1). w = rod width (ctx units). */
export function drawStand(g: CanvasRenderingContext2D, x: number, y0: number, y1: number, w: number) {
  if (y0 - y1 < w) return;
  const gr = g.createLinearGradient(x - w, 0, x + w, 0);
  gr.addColorStop(0, 'rgba(200,220,255,0.18)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.6, 'rgba(180,200,240,0.22)'); gr.addColorStop(1, 'rgba(120,140,190,0.3)');
  g.fillStyle = gr;
  g.fillRect(x - w / 2, y1, w, y0 - y1);
  // the socket peg in the base
  g.fillStyle = 'rgba(10,12,22,0.9)'; g.beginPath(); g.ellipse(x, y0, w * 1.3, w * 0.6, 0, 0, TAU); g.fill();
  g.fillStyle = 'rgba(230,240,255,0.5)'; g.beginPath(); g.ellipse(x - w * 0.3, y0 - w * 0.15, w * 0.5, w * 0.22, 0, 0, TAU); g.fill();
}

/** Formation slots for n minis on one base, in units of the lead ship's length: lead in front, wings behind. */
export function formation(n: number): { x: number; y: number; s: number }[] {
  const out = [{ x: 0, y: 0, s: 1 }];
  // a wedge: wingmen to the flanks and astern, wide rather than deep (the base is seen at an angle)
  const ring = [[-0.55, 0.42], [0.55, 0.42], [-1.08, 0.8], [1.08, 0.8], [0, 0.9], [-0.55, 1.25], [0.55, 1.25], [-1.6, 1.2], [1.6, 1.2], [0, 1.6], [-1.1, 1.6], [1.1, 1.6]];
  for (let i = 1; i < n; i++) { const r = ring[(i - 1) % ring.length]; out.push({ x: r[0], y: r[1], s: i > 2 ? 0.7 : 0.78 }); }
  return out;
}

export { shade };
