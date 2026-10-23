// The board's material vocabulary: the enamel and gold orrery (docs/ART-BIBLE.md §13, docs/STYLE-EXPLORE.md C).
// The galaxy is a black-enamel dial; stars are cabochon gems in gold collets (the stone tells the kind); objectives,
// lit lanes and pieces own the polished gold; territory walls are antique bronze; names and routes are flat ink and
// gilt cut into the glaze; only the pieces (counters, figurines, the battle coin) stand on the dial, lit by the one
// lamp (upper left) and casting shadows down and to the right.
//
// Every painter here draws in the caller's coordinates. Sizes (radii, lengths) are in ctx units; `u` is one design
// px in ctx units (the map passes `px(1)`), so line widths and fixed offsets stay screen-constant at any zoom.
//
// Value rule (the readability budget): the dial lives between Y 0.002 and 0.08; gold's darkest stop is Y ~0.33 and
// every light mark sits in a dark groove (GROOVE), so a mark beats both the dial and a gold wire or bezel beside it.
import { enamel as enamelOf, type HouseKey } from './bible.ts';
import { drawIcon } from './icons.ts';
import { rgb, css, mix, type RGB } from './util.ts';
import type { StarKind } from './stars.ts';

type G = CanvasRenderingContext2D;
export const TAU = Math.PI * 2;
export const IVORY = '#f3e8cc';
export const PALE = '#f3e2b0';
export const GROOVE = 'rgba(2,2,4,0.95)';
/** Fogged names: uncoloured, never faded (fog removes colour, not contrast). */
export const FOG_INK = '#d8d6d0';
/** House marks on the dark dial: the enamel lifted (names, pips, routes, rims). */
export const HI: Record<HouseKey, string> = { azure: '#8fc0ea', crimson: '#f08a7c', gilded: '#f5d47c', warden: '#bea8ec', neutral: '#c8c8cc' };
/** The house enamel (counters, plinth bands, flags). */
/** House colour for lettering and fine lines cut in the glaze: the lifted enamel brought toward ivory, so even the
 *  darkest house holds 4.5:1 over a hatched field or a wire beside it. */
export const INK: Record<HouseKey, string> = { azure: '#acd4f4', crimson: '#ffb6a8', gilded: '#f8dc90', warden: '#d2c2f4', neutral: '#d8d8dc' };
export const inkOf = (color: string | null | undefined) => INK[houseOf(color)];
export const ENAMEL: Record<HouseKey, string> = { azure: '#2f6ea6', crimson: '#a3303a', gilded: '#c79a2c', warden: '#6e58a0', neutral: '#6d6f78' };
/** Champlevé field: the territory's own enamel, deep enough that the dial's value band holds. */
export const FIELD: Record<HouseKey, string> = { azure: '#1d4a7a', crimson: '#6e1a26', gilded: '#6e5214', warden: '#3e2f6a', neutral: '#3a3b42' };
/** Antique bronze: territory walls and cloisons (never the bright gold, which is rationed). */
export const BRONZE = '#d4b47a';
export const AMBER = '#f2b04a';
export const CINNABAR = '#ff7a64';

/** The house of an owner colour (anything else is neutral). */
export const houseOf = (color: string | null | undefined): HouseKey => enamelOf(color).house ?? 'neutral';
export const hiOf = (color: string | null | undefined) => HI[houseOf(color)];
export const enamelBase = (color: string | null | undefined) => ENAMEL[houseOf(color)];

// ------------------------------------------------------------------ gold
/** Polished gold, lit from the lamp (upper left), as a gradient across a box. The darkest stop holds Y ~0.33, so gold
 *  reads at 4.5:1 on the dial wherever it bends away from the light. Fogged: dull silver. */
export function gold(g: G, x0: number, y0: number, x1: number, y1: number, fog = false): CanvasGradient {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  if (fog) { gr.addColorStop(0, '#f8f8fb'); gr.addColorStop(0.5, '#dedee4'); gr.addColorStop(1, '#cacad2'); return gr; }
  gr.addColorStop(0, '#fff6da'); gr.addColorStop(0.35, '#f6d68c'); gr.addColorStop(0.7, '#ecc070'); gr.addColorStop(1, '#e0b262');
  return gr;
}
export const goldBox = (g: G, x: number, y: number, r: number, fog = false) => gold(g, x - r, y - r, x + r, y + r, fog);
/** A dark cut under a mark (the groove every inlay sits in). */
export function groove(g: G, w: number) { g.lineJoin = 'round'; g.lineCap = 'round'; g.lineWidth = w; g.strokeStyle = GROOVE; }
export function beads(g: G, x: number, y: number, r: number, n: number, br: number, fill: string | CanvasGradient, phase = 0) {
  g.fillStyle = fill;
  g.beginPath();
  for (let i = 0; i < n; i++) { const a = (i / n) * TAU + phase; const bx = x + Math.cos(a) * r, by = y + Math.sin(a) * r; g.moveTo(bx + br, by); g.arc(bx, by, br, 0, TAU); }
  g.fill();
}

// ------------------------------------------------------------------ gems
export type Stone = [string, string, string];
export const STONE: Record<string, Stone> = {
  citrine: ['#fff2b8', '#e8a420', '#5a2e00'],
  garnet: ['#ffc0b0', '#c42a34', '#3a0408'],
  sapphire: ['#e4eeff', '#3a6ad0', '#0a1a48'],
  moonstone: ['#ffffff', '#e2e6f0', '#8a94aa'],
  starSapphire: ['#e6eaf8', '#6a78b0', '#1a2048'],
  onyx: ['#5a5a66', '#0c0c10', '#000000'],
  pewter: ['#f2f2f6', '#8e8e96', '#3a3a40'],
  rock: ['#e8dcc0', '#8a7a5a', '#2a2014'],
  gas: ['#ffe2b0', '#b07a3a', '#3a2008'],
  ice: ['#f0fbff', '#8ab8d0', '#1a3444'],
  lava: ['#ffb08a', '#c03a20', '#3a0804'],
  ocean: ['#d8f0ff', '#3a7ab0', '#0a2440'],
  garden: ['#e0f4c0', '#5a9a4a', '#14300c'],
};

/** A cabochon in a gold collet: the stone's dome lit from the lamp, light transmitted to its lower right, a specular
 *  dab; the collet is polished gold (silver when fogged) with a cut groove round it, so the setting reads on a gold
 *  wire or the bezel as well as on the dial. `dim` (0..1) clouds the stone (a blockaded world). */
export function cabochon(g: G, x: number, y: number, r: number, s: Stone, u: number, fog = false, collet = true, dim = 0) {
  r = Math.max(2.4 * u, r);
  if (collet) {
    g.beginPath(); g.arc(x + r * 0.1, y + r * 0.16, r * 1.22, 0, TAU); g.fillStyle = 'rgba(0,0,0,0.55)'; g.fill();
    g.beginPath(); g.arc(x, y, r * 1.18 + 1.2 * u, 0, TAU); g.fillStyle = goldBox(g, x, y, r, fog); g.fill();
    g.lineWidth = 0.8 * u; g.strokeStyle = 'rgba(40,24,4,0.8)'; g.stroke();
    g.beginPath(); g.arc(x, y, r * 1.18 + 2.2 * u, 0, TAU); g.lineWidth = 1.6 * u; g.strokeStyle = GROOVE; g.stroke();
  }
  const sg = g.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.05, x, y, r);
  sg.addColorStop(0, s[0]); sg.addColorStop(0.55, s[1]); sg.addColorStop(1, s[2]);
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.fillStyle = sg; g.fill();
  // transmitted light, lower right
  const tg = g.createRadialGradient(x + r * 0.35, y + r * 0.42, 0, x + r * 0.35, y + r * 0.42, r * 0.7);
  tg.addColorStop(0, css(rgb(s[0]), 0.5)); tg.addColorStop(1, css(rgb(s[0]), 0));
  g.fillStyle = tg; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  if (dim > 0.01) { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fillStyle = `rgba(10,10,14,${(0.75 * dim).toFixed(3)})`; g.fill(); }
  // the specular dab: never under a pixel, so even a small stone shows the lamp
  g.beginPath(); g.ellipse(x - r * 0.34, y - r * 0.42, Math.max(r * 0.28, 1.1 * u), Math.max(r * 0.15, 0.75 * u), -0.6, 0, TAU); g.fillStyle = 'rgba(255,255,255,0.9)'; g.fill();
}

/** A star as its gem (the stone tells the kind): citrine yellow, garnet red (larger), sapphire blue (small),
 *  moonstone white, two stones on one gold bar for a binary, a star sapphire with gold beam pins for a pulsar, onyx
 *  inside a gold orbit ring that crosses in front for a black hole, a repoussé gold sun boss for the Throne. Fogged:
 *  an unpolished pewter stone in a silver collet. `t` turns the animated parts (asterism, the black hole's bead). */
export function gem(g: G, kind: StarKind, x: number, y: number, R: number, u: number, o: { fog?: boolean; dim?: number; t?: number; holder?: string | null } = {}) {
  const fog = !!o.fog, dim = o.dim ?? 0, t = o.t ?? 0;
  if (fog && kind !== 'throne') { cabochon(g, x, y, R * 0.56, STONE.pewter, u, true); return; }
  switch (kind) {
    case 'yellow': cabochon(g, x, y, R * 0.62, STONE.citrine, u, false, true, dim); break;
    case 'red': cabochon(g, x, y, R * 0.74, STONE.garnet, u, false, true, dim); break;
    case 'blue': cabochon(g, x, y, R * 0.52, STONE.sapphire, u, false, true, dim); break;
    case 'white': cabochon(g, x, y, R * 0.56, STONE.moonstone, u, false, true, dim); break;
    case 'binary': {
      // two settings on a polished bar, each large enough to read at the strategic tier (a small pair under a name
      // or beside a wall read at 4.3:1)
      g.beginPath(); g.moveTo(x - R * 0.32, y + R * 0.18); g.lineTo(x + R * 0.4, y - R * 0.22);
      groove(g, Math.max(R * 0.42, 3.4 * u) + 2 * u); g.stroke();
      g.lineWidth = Math.max(R * 0.42, 3.4 * u); g.strokeStyle = '#fdf0c8'; g.stroke();
      cabochon(g, x - R * 0.32, y + R * 0.18, Math.max(R * 0.5, 3.2 * u), STONE.citrine, u, false, true, dim);
      cabochon(g, x + R * 0.42, y - R * 0.24, Math.max(R * 0.34, 2.8 * u), STONE.sapphire, u, false, true, dim);
      break;
    }
    case 'pulsar': {
      for (const s of [-1, 1]) {
        g.beginPath(); g.moveTo(x + s * R * 0.43, y - s * R * 0.43); g.lineTo(x + s * R * 0.84, y - s * R * 0.84);
        groove(g, 3.4 * u); g.stroke(); g.lineWidth = 1.6 * u; g.strokeStyle = goldBox(g, x, y, R); g.stroke();
      }
      cabochon(g, x, y, R * 0.5, STONE.starSapphire, u, false, true, dim);
      // a star sapphire: the asterism is the pulsar's mark (it turns slowly with the pulse)
      g.save(); g.lineCap = 'round'; g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = Math.max(0.9 * u, R * 0.07);
      g.beginPath();
      for (let i = 0; i < 3; i++) { const a = i * Math.PI / 3 + 0.3 + t * 0.35; g.moveTo(x - Math.cos(a) * R * 0.44, y - Math.sin(a) * R * 0.44); g.lineTo(x + Math.cos(a) * R * 0.44, y + Math.sin(a) * R * 0.44); }
      g.stroke(); g.restore();
      break;
    }
    case 'blackhole': {
      const ring = (a0: number, a1: number) => {
        g.beginPath(); g.ellipse(x, y, R * 1.02, R * 0.38, -0.3, a0, a1); groove(g, R * 0.24 + 1.6 * u); g.stroke();
        g.lineWidth = R * 0.13; g.strokeStyle = goldBox(g, x, y, R); g.stroke();
      };
      ring(Math.PI, TAU);
      cabochon(g, x, y, R * 0.48, STONE.onyx, u, false, true, dim);
      ring(0, Math.PI);
      // a gold bead riding the orbit ring (in front half only, so it never crosses the stone)
      const a = (t * 0.6) % TAU, ca = Math.cos(-0.3), sa = Math.sin(-0.3);
      const ex = Math.cos(a) * R * 1.02, ey = Math.sin(a) * R * 0.38;
      if (Math.sin(a) > -0.15) { const bx = x + ex * ca - ey * sa, by = y + ex * sa + ey * ca; g.beginPath(); g.arc(bx, by, Math.max(1.4 * u, R * 0.09), 0, TAU); g.fillStyle = '#fff4d0'; g.fill(); }
      break;
    }
    case 'throne': throneBoss(g, x, y, R, u, o.holder ?? null, fog); break;
  }
}

/** The Throne: a repoussé gold sun boss with the crown struck in it. Held, its centre is fired in the holder's enamel
 *  (the Throne burns in its holder's colour, DELIGHT #32). */
export function throneBoss(g: G, x: number, y: number, R: number, u: number, holder: string | null, fog = false) {
  g.beginPath(); g.arc(x + R * 0.08, y + R * 0.14, R * 0.86, 0, TAU); g.fillStyle = 'rgba(0,0,0,0.6)'; g.fill();
  g.beginPath();
  for (let i = 0; i < 32; i++) { const a = (i / 32) * TAU, rr = i % 2 ? R * 0.68 : R * 0.86; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  g.closePath(); g.fillStyle = goldBox(g, x, y, R, fog); g.fill(); g.lineWidth = 0.9 * u; g.strokeStyle = 'rgba(60,36,6,0.9)'; g.stroke();
  const h = holder ? houseOf(holder) : null;
  const bg = g.createRadialGradient(x - R * 0.2, y - R * 0.25, R * 0.05, x, y, R * 0.58);
  if (h && !fog) { bg.addColorStop(0, mixHex(HI[h], '#ffffff', 0.35)); bg.addColorStop(0.55, ENAMEL[h]); bg.addColorStop(1, FIELD[h]); }
  else if (fog) { bg.addColorStop(0, '#f4f4f6'); bg.addColorStop(0.6, '#b4b4bc'); bg.addColorStop(1, '#7a7a82'); }
  else { bg.addColorStop(0, '#fff8de'); bg.addColorStop(0.6, '#e6b45a'); bg.addColorStop(1, '#a87a35'); }
  g.beginPath(); g.arc(x, y, R * 0.56, 0, TAU); g.fillStyle = bg; g.fill(); g.lineWidth = 0.9 * u; g.strokeStyle = 'rgba(60,36,6,0.9)'; g.stroke();
  if (h && !fog) { g.beginPath(); g.ellipse(x - R * 0.2, y - R * 0.26, R * 0.2, R * 0.1, -0.5, 0, TAU); g.fillStyle = 'rgba(255,250,235,0.4)'; g.fill(); }
  drawIcon(g, 'crown', x, y, R * 0.6, h && !fog ? goldBox(g, x, y, R * 0.3) : 'rgba(70,40,4,0.92)', h && !fog ? { halo: 'rgba(20,10,2,0.8)', haloWidth: 1.4 * u } : {});
}

/** Objective ring radius for a star of radius R (ctx units). */
export const objR = (R: number, throne: boolean, u: number) => Math.max(R * (throne ? 1.5 : 1.36), (throne ? 10 : 7.5) * u) + 2 * u;
/** The contested ring's radius. */
export const contestR = (R: number, kingly: boolean, u: number) => (kingly ? objR(R, false, u) + 8 * u : R * 1.5 + 4 * u);

/** A Crown's setting: a polished gold ring with pearl milgrain and a gold crown on top; the Throne's grand bezel:
 *  a double ring, the inner one inlaid with the holder's enamel, and a glint that walks round it. */
export function objective(g: G, x: number, y: number, R: number, u: number, throne: boolean, fog: boolean, holder: string | null, t = 0) {
  const rr = objR(R, throne, u);
  const ring = (r: number, w: number) => {
    g.beginPath(); g.arc(x, y, r, 0, TAU); groove(g, w + 3 * u); g.stroke();
    g.lineWidth = w; g.strokeStyle = goldBox(g, x, y, r, fog); g.stroke();
  };
  ring(rr, (throne ? 2.6 : 2.3) * u);
  beads(g, x, y, rr + 3.2 * u, Math.max(12, Math.round((rr / u) * 1.1)), 1.25 * u, fog ? '#c8c8d0' : '#fbf3e0');
  if (throne) {
    ring(rr + 6.4 * u, 1.6 * u);
    const h = holder && !fog ? houseOf(holder) : null;
    if (h) { g.beginPath(); g.arc(x, y, rr - 2.2 * u, 0, TAU); g.lineWidth = 1.6 * u; g.strokeStyle = HI[h]; g.stroke(); }
    if (!fog) {
      // the lamp's glint walking slowly round the grand bezel
      const a = -2.1 + Math.sin(t * 0.25) * 0.5;
      g.beginPath(); g.arc(x, y, rr, a - 0.28, a + 0.28); g.lineWidth = 1.6 * u; g.strokeStyle = 'rgba(255,252,236,0.9)'; g.lineCap = 'round'; g.stroke();
    }
  }
  const cs = Math.max(9 * u, R * (throne ? 0.8 : 0.66));
  const cy = y - rr - (throne ? 7.5 : 3.5) * u;
  drawIcon(g, 'crown', x, cy, cs, gold(g, x - cs, cy - cs, x + cs, cy + cs, fog), { halo: GROOVE, haloWidth: 2.2 * u });
}

/** Tenure (DELIGHT #26): one thin enamel ring in the holder's colour per tier, set just outside the collet. */
export function tenure(g: G, x: number, y: number, r0: number, n: number, color: string, u: number) {
  const c = hiOf(color);
  for (let i = 0; i < n; i++) {
    const rad = r0 + (2.6 + i * 2.8) * u;
    g.beginPath(); g.arc(x, y, rad, 0, TAU); g.lineWidth = 2.6 * u; g.strokeStyle = GROOVE; g.stroke();
    g.lineWidth = 1.2 * u; g.strokeStyle = c; g.stroke();
  }
}

/** A contested system: a ring of twelve segments, gold and the space-holder's enamel (pewter: nobody). */
export function contested(g: G, x: number, y: number, rc: number, holder: string | null, u: number) {
  g.beginPath(); g.arc(x, y, rc, 0, TAU); groove(g, 6.2 * u); g.stroke();
  const n = 12, hc = holder ? inkOf(holder) : '#dcdce2', gd = goldBox(g, x, y, rc);
  g.lineCap = 'butt'; g.lineWidth = 3.6 * u;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * TAU, a1 = a0 + TAU / n - 0.08;
    g.beginPath(); g.arc(x, y, rc, a0, a1); g.strokeStyle = i % 2 ? hc : gd; g.stroke();
  }
}
export const markSz = (R: number, u: number) => Math.max(10 * u, R * 0.95);
/** Occupied: a small gold pennant staff with the occupier's enamel flag, lower right of the star. */
export function occupied(g: G, x: number, y: number, R: number, by: string, u: number) {
  const s = markSz(R, u), px = x + R * 1.25, py = y + R * 0.95;
  const gd = gold(g, px - s, py - s, px + s, py + s);
  g.beginPath(); g.moveTo(px - s * 0.35, py + s * 0.5); g.lineTo(px - s * 0.35, py - s * 0.55); groove(g, 3.4 * u); g.stroke(); g.lineWidth = 1.6 * u; g.strokeStyle = gd; g.stroke();
  g.beginPath(); g.moveTo(px - s * 0.35, py - s * 0.55); g.lineTo(px + s * 0.55, py - s * 0.3); g.lineTo(px - s * 0.35, py - s * 0.04); g.closePath();
  groove(g, 2.8 * u); g.stroke(); g.fillStyle = hiOf(by); g.fill(); g.lineWidth = 1 * u; g.strokeStyle = gd; g.stroke();
  g.beginPath(); g.arc(px - s * 0.35, py + s * 0.5, 2 * u, 0, TAU); g.fillStyle = gd; g.fill();
}
/** Tribute: a gold coin struck with the scales, rimmed in the receiver's enamel, lower left of the star. */
export function tribute(g: G, x: number, y: number, R: number, to: string, u: number) {
  const s = markSz(R, u), px = x - R * 1.25, py = y + R * 0.95;
  g.beginPath(); g.arc(px + 1 * u, py + 1.5 * u, s * 0.6, 0, TAU); g.fillStyle = 'rgba(0,0,0,0.6)'; g.fill();
  g.beginPath(); g.arc(px, py, s * 0.58, 0, TAU); g.fillStyle = goldBox(g, px, py, s); g.fill();
  g.lineWidth = 1.6 * u; g.strokeStyle = enamelBase(to); g.stroke();
  drawIcon(g, 'scales', px, py, s * 0.74, 'rgba(60,34,4,0.95)');
}

// ------------------------------------------------------------------ inlaid lines: lanes, routes, reticles
/** A lit hyperlane: gold wire in a groove (brighter gold where it is a route). `lit` 0..1. */
export function litLane(g: G, x0: number, y0: number, x1: number, y1: number, lit: number, u: number, strat: boolean) {
  const k = strat ? 0.92 : 1;
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1);
  groove(g, (6.4 + lit * 1.6) * k * u); g.stroke();
  g.lineWidth = (2 + lit * 1.2) * k * u; g.strokeStyle = lit >= 0.75 ? '#fff6dc' : '#ffeab8'; g.stroke();
}
/** A waypoint bead on a lit lane. */
export function waypoint(g: G, x: number, y: number, u: number, r = 2.1) {
  g.beginPath(); g.arc(x, y, (r + 1.1) * u, 0, TAU); g.fillStyle = GROOVE; g.fill();
  g.beginPath(); g.arc(x, y, r * u, 0, TAU); g.fillStyle = gold(g, x - r * u, y - r * u, x + r * u, y + r * u); g.fill();
}
/** A route or planned order: the house's enamel dashes inlaid in a groove (flat: printed, no shadow). */
export function routeStroke(g: G, trace: () => void, color: string, u: number, dashOffset = 0, alpha = 1) {
  trace(); groove(g, 8.2 * u); g.stroke();
  // a rival's route: shorter dashes (never fainter: a faded line loses to the field under it)
  const rival = alpha < 1;
  g.setLineDash(rival ? [5 * u, 5 * u] : [9 * u, 5 * u]); g.lineDashOffset = dashOffset; g.lineCap = 'butt'; g.lineWidth = 3.2 * u; g.strokeStyle = inkOf(color); trace(); g.stroke();
  g.setLineDash([]); g.lineDashOffset = 0;
}
/** A route's head: an enamel arrowhead with a gold keyline (hollow for a join). */
export function routeHead(g: G, x: number, y: number, ang: number, color: string, u: number, hollow = false) {
  g.save(); g.translate(x, y); g.rotate(ang);
  g.beginPath(); g.moveTo(3 * u, 0); g.lineTo(-9 * u, -6.5 * u); g.lineTo(-6.5 * u, 0); g.lineTo(-9 * u, 6.5 * u); g.closePath();
  groove(g, 3 * u); g.stroke();
  g.fillStyle = hollow ? GROOVE : inkOf(color); g.fill();
  g.lineWidth = 1 * u; g.strokeStyle = gold(g, -9 * u, -6 * u, 3 * u, 6 * u); g.stroke();
  g.restore();
}
/** Seize target: a gold reticle (ring and four ticks) with the attacker's enamel ring inside. */
export function reticle(g: G, x: number, y: number, R: number, color: string, u: number) {
  const draw = () => { g.beginPath(); g.arc(x, y, R, 0, TAU); for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; g.moveTo(x + Math.cos(a) * (R - 5 * u), y + Math.sin(a) * (R - 5 * u)); g.lineTo(x + Math.cos(a) * (R + 4 * u), y + Math.sin(a) * (R + 4 * u)); } };
  draw(); groove(g, 5.4 * u); g.stroke(); draw(); g.lineWidth = 2.2 * u; g.strokeStyle = goldBox(g, x, y, R); g.stroke();
  g.beginPath(); g.arc(x, y, R - 2.6 * u, 0, TAU); g.lineWidth = 1.4 * u; g.strokeStyle = inkOf(color); g.stroke();
}
/** The tether from a star to its piece: a fine gold wire in a groove. */
export function tether(g: G, x0: number, y0: number, x1: number, y1: number, u: number) {
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); groove(g, 3 * u); g.stroke(); g.lineWidth = 1.2 * u; g.strokeStyle = 'rgba(232,190,110,0.9)'; g.stroke();
}

// ------------------------------------------------------------------ pieces (lit, with shadows)
function chevron(g: G, r: number) {
  g.beginPath(); g.moveTo(r, 0); g.lineTo(-r * 0.8, -r * 0.82); g.lineTo(-r * 0.38, 0); g.lineTo(-r * 0.8, r * 0.82); g.closePath();
}
/** Strategic pip: a house-enamel chevron in a gold keyline, heading along `ang` (0 = +x). */
export function pip(g: G, x: number, y: number, ang: number, r: number, color: string, sel: boolean, u: number) {
  const h = hiOf(color);
  g.save(); g.translate(x, y); g.rotate(ang);
  chevron(g, r * 1.32);
  g.lineJoin = 'round'; g.lineWidth = (sel ? 5.4 : 4.6) * u; g.strokeStyle = '#020204'; g.stroke();
  // the keyline is the bright end of the gold (a pip often stands on a bronze wall, and must outshine it)
  g.lineWidth = (sel ? 2.6 : 2) * u; g.strokeStyle = sel ? '#fff0bd' : '#f8e4b0'; g.stroke();
  // the lit face runs ivory → the house ink → the lifted enamel, so a pip holds 4.5:1 even beside a bronze wall
  const eg = g.createLinearGradient(-r, -r, r, r); eg.addColorStop(0, '#fffaf0'); eg.addColorStop(0.5, inkOf(color)); eg.addColorStop(1, h);
  g.fillStyle = eg; g.fill();
  g.restore();
}
/** Operational counter: a struck gold token, the domed house enamel inside it, the heading as an ivory chevron. */
export function counter(g: G, x: number, y: number, ang: number, r: number, color: string, sel: boolean, u: number) {
  const k = houseOf(color);
  g.save(); g.translate(x, y);
  g.beginPath(); g.arc(1.6 * u, 2.6 * u, r + 1.6 * u, 0, TAU); g.fillStyle = 'rgba(0,0,0,0.6)'; g.fill();
  g.beginPath(); g.arc(0, 0, r + 1.6 * u, 0, TAU); g.fillStyle = goldBox(g, 0, 0, r); g.fill(); g.lineWidth = 0.9 * u; g.strokeStyle = 'rgba(50,30,4,0.9)'; g.stroke();
  const eg = g.createRadialGradient(-r * 0.3, -r * 0.4, r * 0.08, 0, 0, r);
  eg.addColorStop(0, HI[k]); eg.addColorStop(0.55, ENAMEL[k]); eg.addColorStop(1, FIELD[k]);
  g.beginPath(); g.arc(0, 0, r - 0.8 * u, 0, TAU); g.fillStyle = eg; g.fill();
  g.beginPath(); g.ellipse(-r * 0.32, -r * 0.42, r * 0.32, r * 0.16, -0.5, 0, TAU); g.fillStyle = 'rgba(255,250,235,0.32)'; g.fill();
  g.save(); g.rotate(ang); chevron(g, r * 0.56); g.lineJoin = 'round'; g.lineWidth = 1.4 * u; g.strokeStyle = 'rgba(6,5,4,0.6)'; g.stroke(); g.fillStyle = IVORY; g.fill(); g.restore();
  if (sel) { g.beginPath(); g.arc(0, 0, r + 4.6 * u, 0, TAU); groove(g, 4.6 * u); g.stroke(); g.lineWidth = 2.2 * u; g.strokeStyle = '#fff0bd'; g.stroke(); beads(g, 0, 0, r + 7.2 * u, 16, 0.9 * u, '#f0c873'); }
  g.restore();
}
/** A stack of 2+ fleets: a black-enamel stud with a gold rim and the count, lower right of the piece. */
export function stack(g: G, n: number, x: number, y: number, u: number, fs = 12.5) {
  g.beginPath(); g.arc(x, y, 9.4 * u, 0, TAU); g.fillStyle = GROOVE; g.fill();
  g.beginPath(); g.arc(x, y, 8.2 * u, 0, TAU); g.fillStyle = '#0c0d12'; g.fill(); g.lineWidth = 1.6 * u; g.strokeStyle = goldBox(g, x, y, 7 * u); g.stroke();
  g.font = `800 ${fs * u}px "Alegreya Sans", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = IVORY; g.fillText(String(n), x, y + 0.5 * u);
}
/** Idle (yours, while you plan): a slowly turning milgrain ring, the instrument's escapement ticking. */
export function idle(g: G, x: number, y: number, rx: number, ry: number, phase: number, u: number) {
  g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); groove(g, 6.4 * u); g.stroke();
  g.fillStyle = '#fff2d2';
  const n = Math.max(16, Math.round((rx + ry) / u * 0.55));
  g.beginPath();
  for (let i = 0; i < n; i++) { const a = (i / n) * TAU + phase; const bx = x + Math.cos(a) * rx, by = y + Math.sin(a) * ry; g.moveTo(bx + 2 * u, by); g.arc(bx, by, 2 * u, 0, TAU); }
  g.fill();
}
/** A status rim on a piece (out of supply: amber dashes; exposed: cinnabar; lurking: pale dashes), in a groove. */
export function rim(g: G, x: number, y: number, rx: number, ry: number, col: string, dash: number[], w: number, u: number) {
  g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); groove(g, (w + 2.6) * u); g.stroke();
  g.setLineDash(dash.map(d => d * u)); g.lineCap = 'butt'; g.lineWidth = w * u; g.strokeStyle = col; g.stroke(); g.setLineDash([]);
}
/** Strength of the selected piece: a gold sword and an ivory number, cut in the glaze. */
export function strength(g: G, n: number, x: number, y: number, u: number) {
  const t = String(n);
  g.font = `800 ${13 * u}px "Alegreya Sans", sans-serif`; g.textAlign = 'left'; g.textBaseline = 'middle';
  const w = 15 * u + g.measureText(t).width, x0 = x - w / 2;
  g.lineJoin = 'round'; g.lineWidth = 4.4 * u; g.strokeStyle = GROOVE; g.strokeText(t, x0 + 15 * u, y + 0.5 * u);
  drawIcon(g, 'attack', x0 + 6 * u, y, 13 * u, gold(g, x0, y - 7 * u, x0 + 13 * u, y + 7 * u), { halo: GROOVE, haloWidth: 2 * u });
  g.fillStyle = IVORY; g.fillText(t, x0 + 15 * u, y + 0.5 * u);
}
/** A battle: a gold coin with cinnabar enamel and gold crossed swords, standing on the dial (shadow). `beat` 0..1
 *  lifts the enamel a little on the battle's pulse (no glow). */
export function battleCoin(g: G, x: number, y: number, D: number, u: number, beat = 0) {
  g.beginPath(); g.arc(x + 1.6 * u, y + 2.6 * u, D * 1.2, 0, TAU); g.fillStyle = 'rgba(0,0,0,0.6)'; g.fill();
  g.beginPath(); g.arc(x, y, D * 1.16 + 1.4 * u, 0, TAU); g.fillStyle = GROOVE; g.fill();
  g.beginPath(); g.arc(x, y, D * 1.16, 0, TAU); g.fillStyle = goldBox(g, x, y, D); g.fill();
  const eg = g.createRadialGradient(x - D * 0.3, y - D * 0.4, D * 0.1, x, y, D);
  eg.addColorStop(0, beat > 0.01 ? css(mix([232, 112, 90], [255, 170, 140], beat)) : '#e8705a'); eg.addColorStop(0.6, '#9a2a24'); eg.addColorStop(1, '#4a0c0c');
  g.beginPath(); g.arc(x, y, D * 0.98, 0, TAU); g.fillStyle = eg; g.fill();
  crossedSwords(g, x, y, D * 0.62, Math.max(1.3 * u, D * 0.17) + 1.6 * u, 'rgba(40,4,4,0.95)');
  crossedSwords(g, x, y, D * 0.62, Math.max(1.3 * u, D * 0.17), goldBox(g, x, y, D));
}
/** Two crossed swords (blade, guard, pommel) in one stroke style. */
export function crossedSwords(g: G, x: number, y: number, s: number, lw: number, style: string | CanvasGradient) {
  g.save(); g.translate(x, y);
  g.strokeStyle = style; g.fillStyle = style; g.lineCap = 'round'; g.lineWidth = lw;
  for (const sg of [1, -1]) {
    g.save(); g.rotate(sg * Math.PI / 4);
    g.beginPath(); g.moveTo(0, -s); g.lineTo(0, s * 0.55); g.moveTo(-s * 0.34, s * 0.5); g.lineTo(s * 0.34, s * 0.5); g.stroke();
    g.beginPath(); g.arc(0, s * 0.84, lw * 0.8, 0, TAU); g.fill();
    g.restore();
  }
  g.restore();
}
/** One discharge between pieces up close: an enamel bolt in a groove with an ivory head, gold beads on impact. */
export function shot(g: G, ax: number, ay: number, bx: number, by: number, color: string, k: number, u: number) {
  const px = ax + (bx - ax) * k, py = ay + (by - ay) * k;
  const k0 = Math.max(0, k - 0.3), tx = ax + (bx - ax) * k0, ty = ay + (by - ay) * k0;
  g.beginPath(); g.moveTo(tx, ty); g.lineTo(px, py); groove(g, 3.4 * u); g.stroke(); g.lineWidth = 1.6 * u; g.strokeStyle = hiOf(color); g.stroke();
  g.beginPath(); g.arc(px, py, 2.2 * u, 0, TAU); g.fillStyle = '#fff4d6'; g.fill();
}
export function impact(g: G, x: number, y: number, k: number, u: number) {
  if (k <= 0 || k >= 1) return;
  const a0 = g.globalAlpha; g.globalAlpha = a0 * (1 - k);
  beads(g, x, y, (3 + 6 * k) * u, 8, 1.1 * u, '#ffd890');
  g.globalAlpha = a0;
}

// ------------------------------------------------------------------ names, cut in the glaze
/** An engraved name: a dark cut under the letters, then the polished face. Fogged: uncoloured ink at full value. */
export function nameFill(g: G, kind: 'kingly' | 'owned' | 'plain', owner: string | null, fog: boolean, x: number, y: number, fs: number): string | CanvasGradient {
  if (fog) return FOG_INK;
  if (kind === 'kingly') return gold(g, x, y - fs / 2, x, y + fs / 2);
  if (owner) return inkOf(owner);
  return PALE;
}

// ------------------------------------------------------------------ small helpers
export function mixHex(a: string, b: string, t: number) { const c = mix(rgb(a), rgb(b), t); return `#${((1 << 24) | ((c[0] | 0) << 16) | ((c[1] | 0) << 8) | (c[2] | 0)).toString(16).slice(1)}`; }
export type { RGB };
