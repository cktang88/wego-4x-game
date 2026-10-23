// The orrery as a backdrop (the battle viewer's stage, the lobby's table): the same black-enamel dial as the board
// (render/dial.ts), seen closer: velvet round it, the dial in a polished gold bezel with its degree scale and pearl
// milgrain, cloisonné fields of deep enamel in fine bronze wire, the guilloché under the glaze, pin-head brilliants,
// and the lamp's one reflection and falloff. 2D, baked once per size (no frames needed), never a nebula.
import { cloisonne, paintFields, guillocheRuns, pick } from '../render/dial.ts';
import { fbm2, noise2, rand, canvas } from './util.ts';
import { gold, GROOVE, FIELD, type RGB } from './orrery.ts';
import type { HouseKey } from './bible.ts';

const TAU = Math.PI * 2;
let felt: HTMLImageElement | null = null;
if (typeof Image !== 'undefined') { const im = new Image(); im.onload = () => { felt = im; }; im.src = '/tex/felt.webp'; }

export interface BackdropOpts {
  /** the dial's centre and radius (css px) */
  cx: number; cy: number; R: number;
  /** champlevé arcs of house enamel round the inside of the bezel (the battle's sides) */
  houses?: HouseKey[];
  /** the lamp's reflection across the glaze */
  sheen?: boolean;
  /** how dark the room falls off at the edges (0..1) */
  falloff?: number;
}

/** Paint the backdrop at W × H css px (device px = × dpr). */
export function orreryBackdrop(W: number, H: number, dpr: number, seed: number, o: BackdropOpts): HTMLCanvasElement {
  const c = canvas(W * dpr, H * dpr);
  const g = c.getContext('2d')!;
  g.scale(dpr, dpr);
  const u = 1;
  // velvet
  g.fillStyle = '#060608'; g.fillRect(0, 0, W, H);
  if (felt) { const p = g.createPattern(felt, 'repeat'); if (p) { p.setTransform(new DOMMatrix().scaleSelf(0.6)); g.save(); g.globalCompositeOperation = 'soft-light'; g.globalAlpha = 0.16; g.fillStyle = p; g.fillRect(0, 0, W, H); g.restore(); } }
  const { cx, cy, R } = o;
  const dial = new Path2D(); dial.arc(cx, cy, R, 0, TAU);
  // the instrument's cast shadow, then the black enamel
  g.save(); g.shadowColor = 'rgba(0,0,0,0.85)'; g.shadowBlur = 28 * dpr; g.shadowOffsetX = 7 * dpr; g.shadowOffsetY = 12 * dpr; g.fillStyle = '#0a0b10'; g.fill(dial); g.restore();
  g.save(); g.clip(dial);
  // cloisonné over the visible part of the dial
  const cs = 12, pad = 40;
  const x0 = Math.max(cx - R, -pad), y0 = Math.max(cy - R, -pad), x1 = Math.min(cx + R, W + pad), y1 = Math.min(cy + R, H + pad);
  const nx = Math.max(3, Math.ceil((x1 - x0) / cs) + 3), ny = Math.max(3, Math.ceil((y1 - y0) / cs) + 3);
  const ox = x0 - cs, oy = y0 - cs;
  const fd = new Float32Array(nx * ny), fk = new Float32Array(nx * ny);
  const s = (seed % 997) + 3, sc = 1100 / Math.max(600, R);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const wx = (ox + i * cs) * sc, wy = (oy + j * cs) * sc;
    let d = fbm2(wx * 0.0017 + 7, wy * 0.0017 - 3, 4, s) + (fbm2(wx * 0.0055, wy * 0.0055, 2, s + 9) - 0.5) * 0.06;
    const rim = Math.min(1, Math.hypot(ox + i * cs - cx, oy + j * cs - cy) / R);
    d -= (1 - rim) * 0.09;
    fd[j * nx + i] = d;
    fk[j * nx + i] = noise2(wx * 0.0022 + 40, wy * 0.0022, s + 3);
  }
  const F = cloisonne(fd, fk, nx, ny, ox, oy, cs);
  paintFields(g, F, u, null, true, () => { g.lineWidth = 0.9; g.strokeStyle = 'rgba(112,94,64,0.15)'; g.stroke(pick(guillocheRuns(cx, cy, R * 1.5, 0.11 * 1100 / Math.max(600, R) * 0.9), null)); });
  // pin-head brilliants
  const rr = rand(seed ^ 0x5eed);
  for (let i = 0; i < (W * H) / 2600; i++) {
    const m = rr() ** 3, x = rr() * W, y = rr() * H;
    g.fillStyle = m > 0.6 ? 'rgba(255,236,190,0.62)' : 'rgba(190,200,230,0.36)';
    g.beginPath(); g.arc(x, y, 0.5 + m * 0.9, 0, TAU); g.fill();
  }
  // champlevé arcs of the sides' enamel just inside the bezel (their hatch engraved under the glaze)
  if (o.houses?.length) {
    const n = o.houses.length;
    o.houses.forEach((h, i) => {
      const a0 = -Math.PI / 2 + (i / n) * TAU + 0.12, a1 = -Math.PI / 2 + ((i + 1) / n) * TAU - 0.12;
      g.beginPath(); g.arc(cx, cy, R - 4, a0, a1); g.arc(cx, cy, R - 26, a1, a0, true); g.closePath();
      g.fillStyle = FIELD[h]; g.globalAlpha = 0.7; g.fill(); g.globalAlpha = 1;
      g.lineWidth = 1.6; g.strokeStyle = '#b8955a'; g.stroke();
    });
  }
  g.restore();
  // the bezel, its pearl milgrain and its degree scale
  g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.lineWidth = 16; g.strokeStyle = '#1a1206'; g.stroke();
  g.lineWidth = 12; g.strokeStyle = gold(g, cx - R, cy - R, cx + R, cy + R); g.stroke();
  g.lineWidth = 0.9; g.strokeStyle = 'rgba(60,36,6,0.9)'; g.stroke();
  g.beginPath(); g.arc(cx, cy, R - 7.5, 0, TAU); g.lineWidth = 2.4; g.strokeStyle = GROOVE; g.stroke();
  g.fillStyle = '#fbf3e0';
  const nb = Math.round((TAU * (R - 10)) / 7);
  g.beginPath();
  for (let i = 0; i < nb; i++) { const a = (i / nb) * TAU, bx = cx + Math.cos(a) * (R - 11), by = cy + Math.sin(a) * (R - 11); g.moveTo(bx + 1.1, by); g.arc(bx, by, 1.1, 0, TAU); }
  g.fill();
  g.strokeStyle = 'rgba(232,190,110,0.78)';
  const nt = Math.round((TAU * R) / 18);
  for (let i = 0; i < nt; i++) {
    const a = (i / nt) * TAU, long = i % 5 === 0, r0 = R + 9, r1 = r0 + (long ? 8 : 3.5);
    g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    g.lineWidth = long ? 1.4 : 0.8; g.stroke();
  }
  // the lamp: one broad reflection, and the room's falloff
  if (o.sheen !== false) {
    const sh = g.createLinearGradient(W * 0.15, 0, W * 0.55, H * 0.6);
    sh.addColorStop(0, 'rgba(255,240,210,0)'); sh.addColorStop(0.5, 'rgba(255,240,210,0.04)'); sh.addColorStop(1, 'rgba(255,240,210,0)');
    g.fillStyle = sh; g.fillRect(0, 0, W, H);
  }
  const D = Math.hypot(W, H);
  const gr = g.createRadialGradient(W * 0.42, H * 0.32, D * 0.05, W * 0.42, H * 0.32, D * 0.8);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(0,0,0,0)'); gr.addColorStop(1, `rgba(0,0,0,${o.falloff ?? 0.5})`);
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  return c;
}
export type { RGB };
