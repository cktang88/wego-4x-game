// Cast-metal figurines (the orrery's miniatures, docs/ART-BIBLE.md §13): the game's own painted sculpts (ships.ts)
// gradient-mapped to the house metal (Azure silver, Crimson red-gold, Gilded gold, the Warden violet-silver), with the
// strongly painted lacquer kept as enamel. They stand on black-enamel plinths with a gold rim and a band of house
// enamel, lit by the one lamp and casting their shadows down and to the right. The silhouettes are the sculpts'.
import { shipSprite, drawPlumes, type ShipDrawOpts } from './ships.ts';
import { canvas, SpriteCache, type RGB } from './util.ts';
import { HI, ENAMEL, FIELD, GROOVE, AMBER, gold, groove, houseOf, mixHex } from './orrery.ts';
import type { HouseKey } from './bible.ts';

const TAU = Math.PI * 2;
const METAL: Record<HouseKey, [RGB, RGB, RGB]> = {
  azure: [[34, 40, 54], [150, 160, 178], [246, 248, 252]],
  crimson: [[46, 18, 10], [186, 104, 66], [255, 222, 196]],
  gilded: [[60, 36, 6], [214, 162, 66], [255, 244, 200]],
  warden: [[40, 32, 58], [150, 136, 176], [240, 232, 252]],
  neutral: [[34, 34, 40], [140, 140, 150], [236, 236, 240]],
};
const hex3 = (h: string): RGB => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** The metal treatment of one painted sprite: luminance (normalised to the sprite's own p4..p96 range, so a dark
 *  Crimson hull and a pale Gilded one band the same way) through the house metal's ramp; saturated paint keeps the
 *  house enamel. The alpha edge is kept. */
function metallise(src: HTMLCanvasElement, h: HouseKey): HTMLCanvasElement {
  const w = src.width, ht = src.height;
  const c = canvas(w, ht);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(src, 0, 0);
  const img = g.getImageData(0, 0, w, ht), D = img.data;
  const ls: number[] = [];
  for (let i = 0; i < D.length; i += 4 * 3) if (D[i + 3] > 128) ls.push((0.3 * D[i] + 0.59 * D[i + 1] + 0.11 * D[i + 2]) / 255);
  ls.sort((a, b) => a - b);
  const lo = ls[Math.floor(ls.length * 0.04)] ?? 0, hi = ls[Math.floor(ls.length * 0.96)] ?? 1, span = Math.max(0.05, hi - lo);
  const [m0, m1, m2] = METAL[h], E = hex3(ENAMEL[h]);
  for (let i = 0; i < D.length; i += 4) {
    if (D[i + 3] < 8) continue;
    const r = D[i], gg = D[i + 1], b = D[i + 2];
    const L = Math.max(0, Math.min(1, ((0.3 * r + 0.59 * gg + 0.11 * b) / 255 - lo) / span));
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), sat = mx > 0 ? (mx - mn) / mx : 0;
    let o = L < 0.5 ? mix(m0, m1, L / 0.5) : mix(m1, m2, (L - 0.5) / 0.5);
    if (sat > 0.42 && L > 0.15) o = mix(E, [255, 255, 255], Math.max(0, L - 0.55) * 0.8);
    D[i] = o[0]; D[i + 1] = o[1]; D[i + 2] = o[2];
  }
  g.putImageData(img, 0, 0);
  return c;
}

const cache = new SpriteCache<HTMLCanvasElement>(420);
/** The last metal bake per class × owner × heading, whatever its size: drawn scaled while a new size waits its turn. */
const anySize = new Map<string, HTMLCanvasElement>();
let budget = 0, budgetFrame = -1;
/** Metal bakes allowed per frame (a zoom that changes every size bucket at once is spread over a few frames). */
export function figurineFrame(frame: number, perFrame: number) { if (frame !== budgetFrame) { budgetFrame = frame; budget = perFrame; } }

/** Draw a cast-metal figurine, nose along `angle` (0 = up), centred at (x, y); `len` ctx units, `lenDev` device px. */
export function drawFigurine(g: CanvasRenderingContext2D, x: number, y: number, len: number, lenDev: number, cls: string, owner: number, team: string, angle: number, o: ShipDrawOpts = {}) {
  const { spr, rot } = shipSprite(cls, owner, team, lenDev, angle);
  const h = owner < 0 ? 'warden' : houseOf(team);
  const step = TAU / 32, ab = ((Math.round(angle / step) % 32) + 32) % 32;
  const kAny = `${cls}|${owner}|${h}|${ab}`, k = `${kAny}|${spr.L}`;
  let img: HTMLCanvasElement | null = null, L = spr.L, size = spr.size;
  if (cache.has(k) || budget > 0 || !anySize.has(kAny)) {
    if (!cache.has(k)) budget--;
    img = cache.get(k, () => metallise(spr.img, h));
    anySize.set(kAny, img);
  } else {
    // bake it on a later frame; meanwhile the nearest size we have, scaled (same silhouette, same lighting)
    img = anySize.get(kAny)!;
    L = img.width / (spr.size / spr.L); size = img.width;
  }
  const s = len / L * size;
  const a0 = g.globalAlpha, alpha = o.alpha ?? 1;
  if (alpha <= 0.01) return;
  if (o.shadow) {
    g.globalAlpha = a0 * alpha * (o.shadow.alpha ?? 0.5);
    const ss = len / spr.L * spr.size;
    g.save(); g.translate(x + o.shadow.dx, y + o.shadow.dy); g.rotate(rot); g.drawImage(spr.shadow, -ss / 2, -ss / 2, ss, ss); g.restore();
  }
  if (o.engine && o.engine > 0.02) drawPlumes(g, x, y, len, cls, owner, team, angle, o.engine, alpha * a0);
  g.globalAlpha = a0 * alpha;
  g.save(); g.translate(x, y); g.rotate(rot);
  if (o.bank) { g.rotate(angle - rot); g.scale(1 - Math.min(0.45, Math.abs(o.bank) * 0.4), 1); g.rotate(-(angle - rot)); }
  g.drawImage(img, -s / 2, -s / 2, s, s);
  if (o.flash && o.flash > 0) { g.globalAlpha = a0 * alpha * Math.min(1, o.flash); g.globalCompositeOperation = 'lighter'; g.drawImage(img, -s / 2, -s / 2, s, s); }
  g.restore();
  g.globalAlpha = a0;
}

export const PLINTH_SQUASH = 0.44;
/** The plinth: black enamel with a polished gold rim over a band of house enamel, a cast shadow down-right. `sel`
 *  adds a pale gold ring, `oos` dashes the rim amber. rx in ctx units; u = one design px. */
export function drawPlinth(g: CanvasRenderingContext2D, x: number, y: number, rx: number, team: string, u: number, o: { sel?: boolean; oos?: boolean; soft?: boolean } = {}) {
  const k = houseOf(team), ry = rx * PLINTH_SQUASH, t = Math.max(2.4 * u, rx * 0.16);
  // the shadow: soft on High, a plain offset disc on Low
  if (o.soft) {
    const sg = g.createRadialGradient(x + rx * 0.22, y + t + ry * 0.5, rx * 0.2, x + rx * 0.22, y + t + ry * 0.5, rx * 1.2);
    sg.addColorStop(0, 'rgba(0,0,0,0.62)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = sg; g.beginPath(); g.ellipse(x + rx * 0.22, y + t + ry * 0.5, rx * 1.2, ry * 1.5, 0, 0, TAU); g.fill();
  } else { g.fillStyle = 'rgba(0,0,0,0.6)'; g.beginPath(); g.ellipse(x + rx * 0.2, y + t + ry * 0.35, rx * 1.05, ry * 1.05, 0, 0, TAU); g.fill(); }
  // the side: house enamel, lit toward the lamp
  const side = g.createLinearGradient(x - rx, 0, x + rx, 0);
  side.addColorStop(0, HI[k]); side.addColorStop(0.35, ENAMEL[k]); side.addColorStop(1, FIELD[k]);
  g.fillStyle = side;
  g.beginPath(); g.ellipse(x, y + t, rx, ry, 0, 0, Math.PI); g.lineTo(x - rx, y); g.ellipse(x, y, rx, ry, 0, Math.PI, 0, true); g.closePath(); g.fill();
  g.lineWidth = 0.8 * u; g.strokeStyle = 'rgba(0,0,0,0.6)'; g.beginPath(); g.ellipse(x, y + t, rx, ry, 0, 0, Math.PI); g.stroke();
  // the top: black enamel with the lamp's reflection
  const top = g.createLinearGradient(x - rx, y - ry, x + rx * 0.4, y + ry);
  top.addColorStop(0, '#20222c'); top.addColorStop(0.45, '#0c0d12'); top.addColorStop(1, '#07080b');
  g.fillStyle = top; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.fill();
  // the gold rim
  const rw = Math.max(1.6 * u, rx * 0.1);
  g.beginPath(); g.ellipse(x, y, rx - rw / 2, ry - rw / 2 * PLINTH_SQUASH, 0, 0, TAU);
  if (o.oos) { g.lineWidth = rw; g.strokeStyle = GROOVE; g.stroke(); g.setLineDash([rw * 1.6, rw]); g.strokeStyle = AMBER; g.stroke(); g.setLineDash([]); }
  else { g.lineWidth = rw; g.strokeStyle = gold(g, x - rx, y - ry, x + rx, y + ry); g.stroke(); }
  // an inner engraved ring in the house's lifted enamel
  g.beginPath(); g.ellipse(x, y, rx * 0.62, ry * 0.62, 0, 0, TAU); g.lineWidth = Math.max(0.7 * u, rx * 0.03); g.strokeStyle = mixHex(HI[k], '#000000', 0.35); g.stroke();
  if (o.sel) {
    g.beginPath(); g.ellipse(x, y + t * 0.3, rx * 1.18, ry * 1.18 + t * 0.3, 0, 0, TAU); groove(g, 4.6 * u); g.stroke();
    g.lineWidth = 2.2 * u; g.strokeStyle = '#fff0bd'; g.stroke();
  }
}
/** The stand: a polished gold pin from the plinth up to the figurine. */
export function drawPin(g: CanvasRenderingContext2D, x: number, y0: number, y1: number, w: number) {
  if (y0 - y1 < w) return;
  g.fillStyle = GROOVE; g.fillRect(x - w * 0.9, y1, w * 1.8, y0 - y1);
  g.fillStyle = gold(g, x - w, 0, x + w, 0); g.fillRect(x - w / 2, y1, w, y0 - y1);
}
