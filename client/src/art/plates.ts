// Engraved metal and enamel plates for the map's information: the shield cap (owner enamel, metal rim, the garrison
// number stays bold and high-contrast), name plates (dark gunmetal with an engraved rule) and number plates on bases.
import { rgb, css, lit, mix } from './util.ts';
import { enamel as enamelOf, houseOf } from './bible.ts';

export type Rim = 'iron' | 'silver' | 'gold';
const RIMS: Record<Rim, [string, string, string]> = {
  iron: ['#9aa0b4', '#4a4e60', '#1c1e28'],
  silver: ['#ffffff', '#b8c0d0', '#5a6070'],
  gold: ['#fff2b8', '#e0aa3c', '#7a5014'],
};

/** Fill + rim the current path as an enamel plate in `color` (top-lit), y0..y1 its vertical extent. */
export function enamel(g: CanvasRenderingContext2D, color: string, y0: number, y1: number, rim: Rim, lw: number) {
  // a house colour is fired as its enamel base (the lit tone comes from the gradient)
  const c = rgb(houseOf(color) ? enamelOf(color).base : color);
  const gr = g.createLinearGradient(0, y0, 0, y1);
  gr.addColorStop(0, css(lit(c, 0.32))); gr.addColorStop(0.45, css(c)); gr.addColorStop(1, css(lit(c, -0.32)));
  g.fillStyle = gr; g.fill();
  const R = RIMS[rim];
  const rg = g.createLinearGradient(0, y0, 0, y1);
  rg.addColorStop(0, R[0]); rg.addColorStop(0.5, R[1]); rg.addColorStop(1, R[2]);
  g.strokeStyle = rg; g.lineWidth = lw; g.stroke();
}

/** Gunmetal plate (name plates, number plates): call after building the path. */
export function gunmetal(g: CanvasRenderingContext2D, y0: number, y1: number, edge: string | null, lw: number, alpha = 1) {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  gr.addColorStop(0, `rgba(48,52,66,${0.97 * alpha})`); gr.addColorStop(0.5, `rgba(22,24,34,${0.96 * alpha})`); gr.addColorStop(1, `rgba(10,11,18,${0.97 * alpha})`);
  g.fillStyle = gr; g.fill();
  g.strokeStyle = edge ?? 'rgba(150,156,180,0.55)'; g.lineWidth = lw; g.stroke();
}

/** A thin bright line along the plate's top edge (the lamp catching the bevel). */
export function topGlint(g: CanvasRenderingContext2D, x0: number, x1: number, y: number, lw: number, alpha = 0.45) {
  g.strokeStyle = `rgba(255,246,226,${alpha})`; g.lineWidth = lw;
  g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
}

/** Stamped number: bold fill with a hairline dark shadow under it (reads as engraved/raised, stays crisp). */
export function stampedText(g: CanvasRenderingContext2D, t: string, x: number, y: number, fill: string, s: number) {
  const dark = fill === '#ffffff' || fill.startsWith('rgba(2') || fill.startsWith('#f') || fill.startsWith('#e');
  g.fillStyle = dark ? 'rgba(0,0,8,0.7)' : 'rgba(255,255,255,0.35)';
  g.fillText(t, x, y + s * 0.9);
  g.fillStyle = fill; g.fillText(t, x, y);
}

/** Darker/lighter owner colour helpers for plates. */
export const deep = (hex: string, k: number) => css(lit(rgb(hex), k));
export const tint = (hex: string, with_: string, k: number) => css(mix(rgb(hex), rgb(with_), k));
