// Vector glyphs for the map: shield caps, chevron tokens, crossed swords, diamonds, building pictograms.
// All functions draw in the current transform; sizes are in that transform's units (callers pass world units
// already scaled to screen-constant px).
import type { Pt } from '../../../shared/sim/types.ts';
import { drawIcon, icFor } from '../art/icons.ts';

export const TAU = Math.PI * 2;
/** Figures: Alegreya Sans (ART-BIBLE §7), humanist like Fell and Cinzel. */
export const numFont = (px: number, w = 700) => `${w >= 700 ? 800 : w} ${px}px "Alegreya Sans", "Gill Sans", system-ui, sans-serif`;
export const nameFont = (px: number) => `700 ${px}px "Alegreya Sans", "Gill Sans", system-ui, sans-serif`;
/** Labels and names in space: Cinzel caps. */
export const displayFont = (px: number) => `700 ${px}px "Cinzel", Georgia, serif`;
export const PLATE = 'rgba(14,15,19,0.88)';
export const INK = '#07080c';

export function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}

/** Mix a hex colour toward grey (lens desaturation); returns hex. */
export function desat(hex: string, k: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const l = 0.3 * r + 0.59 * g + 0.11 * b;
  const m = (c: number) => Math.round(c + (l * 0.8 - c) * k);
  return `#${((1 << 24) | (m(r) << 16) | (m(g) << 8) | m(b)).toString(16).slice(1)}`;
}

/** Relative luminance-ish: pick dark or light ink on a fill. */
export function inkOn(hex: string): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  const l = (0.3 * ((n >> 16) & 255) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255)) / 255;
  return l > 0.45 ? INK : '#ffffff';
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Heater shield centred on (x, y): flat top, point at the bottom. */
export function shieldPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const l = x - w / 2, r = x + w / 2, t = y - h / 2, b = y + h / 2;
  const c = w * 0.12;
  ctx.beginPath();
  ctx.moveTo(l + c, t);
  ctx.lineTo(r - c, t);
  ctx.quadraticCurveTo(r, t, r, t + c);
  ctx.lineTo(r, y + h * 0.05);
  ctx.quadraticCurveTo(r, y + h * 0.36, x, b);
  ctx.quadraticCurveTo(l, y + h * 0.36, l, y + h * 0.05);
  ctx.lineTo(l, t + c);
  ctx.quadraticCurveTo(l, t, l + c, t);
  ctx.closePath();
}

export function diamondPath(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry = rx) {
  ctx.beginPath();
  ctx.moveTo(x, y - ry); ctx.lineTo(x + rx, y); ctx.lineTo(x, y + ry); ctx.lineTo(x - rx, y); ctx.closePath();
}

/** Chevron pointing up (−y), centred on the origin, R = half height. */
export function chevronPath(ctx: CanvasRenderingContext2D, R: number) {
  ctx.beginPath();
  ctx.moveTo(0, -R); ctx.lineTo(R * 0.92, R * 0.78); ctx.lineTo(0, R * 0.32); ctx.lineTo(-R * 0.92, R * 0.78); ctx.closePath();
}

/** Crossed swords centred on (x, y), s = half size. */
export function swords(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string, lw: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineCap = 'round'; ctx.lineWidth = lw;
  for (const sg of [1, -1]) {
    ctx.save();
    ctx.rotate(sg * Math.PI / 4);
    // blade
    ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(0, s * 0.55); ctx.stroke();
    // guard
    ctx.beginPath(); ctx.moveTo(-s * 0.32, s * 0.5); ctx.lineTo(s * 0.32, s * 0.5); ctx.stroke();
    // pommel
    ctx.beginPath(); ctx.arc(0, s * 0.82, lw * 0.75, 0, TAU); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

/** Crown pictogram (gold). */
export function crownGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string | CanvasGradient) {
  ctx.fillStyle = color; ctx.beginPath();
  ctx.moveTo(x - r, y + r * 0.6); ctx.lineTo(x - r, y - r * 0.35); ctx.lineTo(x - r * 0.5, y + r * 0.08);
  ctx.lineTo(x, y - r * 0.8); ctx.lineTo(x + r * 0.5, y + r * 0.08); ctx.lineTo(x + r, y - r * 0.35); ctx.lineTo(x + r, y + r * 0.6);
  ctx.closePath(); ctx.fill();
}

export function starGlyph(ctx: CanvasRenderingContext2D, p: Pt, r: number, n: number, c: string) {
  ctx.fillStyle = c; ctx.beginPath();
  for (let i = 0; i < n * 2; i++) { const a = (i / (n * 2)) * TAU - Math.PI / 2; const rr = i % 2 ? r * 0.45 : r; ctx.lineTo(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr); }
  ctx.closePath(); ctx.fill();
}

export function planet(ctx: CanvasRenderingContext2D, p: Pt, r: number, c: string) {
  const g = ctx.createRadialGradient(p.x - r * 0.4, p.y - r * 0.4, r * 0.1, p.x, p.y, r);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, c); g.addColorStop(1, 'rgba(10,5,25,1)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
}

/** Text with a dark halo so it reads over any fill. */
export function haloText(ctx: CanvasRenderingContext2D, t: string, x: number, y: number, fill: string, halo: string, hw: number) {
  ctx.lineJoin = 'round';
  ctx.strokeStyle = halo; ctx.lineWidth = hw; ctx.strokeText(t, x, y);
  ctx.fillStyle = fill; ctx.fillText(t, x, y);
}

export function letterSpaced(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, sp: number, stroke = false) {
  const w = ctx.measureText(text).width + sp * (text.length - 1);
  let cx = x - w / 2;
  const prev = ctx.textAlign;
  ctx.textAlign = 'left';
  for (const ch of text) { if (stroke) ctx.strokeText(ch, cx, y); ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + sp; }
  ctx.textAlign = prev;
}

/** Fixed building order for the detail-tier tray. */
export const TRAY_ORDER = ['shipyard', 'fortress', 'battery', 'pshield', 'gate', 'depot', 'mine', 'tradehub', 'extractor', 'academy', 'sensor'] as const;

/** Small building pictogram centred at (x, y) in a box of half-size s. */
export function buildingIcon(ctx: CanvasRenderingContext2D, key: string, x: number, y: number, s: number, color: string, lw: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = lw; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  switch (key) {
    case 'shipyard': {
      // a hull on a slipway
      ctx.beginPath(); ctx.moveTo(-s, s * 0.15); ctx.lineTo(s, s * 0.15); ctx.lineTo(s * 0.55, s * 0.65); ctx.lineTo(-s * 0.55, s * 0.65); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-s * 0.2, s * 0.15); ctx.lineTo(-s * 0.2, -s * 0.85); ctx.lineTo(s * 0.55, -s * 0.85); ctx.stroke();
      break;
    }
    case 'fortress': {
      // crenellated tower
      ctx.beginPath();
      ctx.moveTo(-s * 0.75, s * 0.85); ctx.lineTo(-s * 0.75, -s * 0.85); ctx.lineTo(-s * 0.4, -s * 0.85); ctx.lineTo(-s * 0.4, -s * 0.5); ctx.lineTo(-s * 0.15, -s * 0.5);
      ctx.lineTo(-s * 0.15, -s * 0.85); ctx.lineTo(s * 0.15, -s * 0.85); ctx.lineTo(s * 0.15, -s * 0.5); ctx.lineTo(s * 0.4, -s * 0.5); ctx.lineTo(s * 0.4, -s * 0.85);
      ctx.lineTo(s * 0.75, -s * 0.85); ctx.lineTo(s * 0.75, s * 0.85); ctx.closePath(); ctx.fill();
      break;
    }
    case 'battery': {
      ctx.beginPath(); ctx.arc(0, s * 0.35, s * 0.55, Math.PI, 0); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, s * 0.1); ctx.lineTo(s * 0.8, -s * 0.75); ctx.lineWidth = lw * 1.6; ctx.stroke();
      break;
    }
    case 'pshield': {
      ctx.beginPath(); ctx.arc(0, s * 0.55, s * 0.95, Math.PI, 0); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, s * 0.55, s * 0.55, Math.PI, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-s, s * 0.6); ctx.lineTo(s, s * 0.6); ctx.stroke();
      break;
    }
    case 'gate': {
      ctx.beginPath(); ctx.ellipse(0, 0, s * 0.6, s * 0.9, 0, 0, TAU); ctx.lineWidth = lw * 1.5; ctx.stroke();
      ctx.globalAlpha *= 0.45; ctx.beginPath(); ctx.ellipse(0, 0, s * 0.28, s * 0.55, 0, 0, TAU); ctx.fill();
      break;
    }
    case 'depot': {
      ctx.strokeRect(-s * 0.75, -s * 0.6, s * 1.5, s * 1.3);
      ctx.beginPath(); ctx.moveTo(-s * 0.75, -s * 0.05); ctx.lineTo(s * 0.75, -s * 0.05); ctx.moveTo(0, -s * 0.6); ctx.lineTo(0, s * 0.7); ctx.stroke();
      break;
    }
    default: {
      drawIcon(ctx, icFor('structure', key), 0, s * 0.05, s * 2.1, ctx.fillStyle as string);
    }
  }
  ctx.restore();
}

/** Diagonal hatch tile (screen-constant via pattern transform). */
export function hatchTile(color: string, gap = 7, lw = 1.6): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = gap; c.height = gap;
  const x = c.getContext('2d')!;
  x.strokeStyle = color; x.lineWidth = lw;
  x.beginPath();
  x.moveTo(-1, gap + 1); x.lineTo(gap + 1, -1);
  x.moveTo(-1, 1); x.lineTo(1, -1);
  x.moveTo(gap - 1, gap + 1); x.lineTo(gap + 1, gap - 1);
  x.stroke();
  return c;
}
