// Banner sigils (Soul layer, content.ts SIGILS): one vector silhouette per sigil in a 24x24 box, drawn as an
// engraved metal charge on an enamel heater shield in the owner's colour. The same path data feeds the canvas
// (map pennants, Saga image) and inline SVG (cards, the founding sheet), so a banner looks the same everywhere.
import { SIGILS } from '../../../shared/config/content.ts';

interface SigilDef { fill?: string; stroke?: string; sw?: number; evenodd?: boolean }

const star = (n: number, ro: number, ri: number, rot = -Math.PI / 2) => {
  let d = '';
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i * Math.PI) / n, r = i % 2 ? ri : ro;
    d += `${i ? 'L' : 'M'}${(12 + Math.cos(a) * r).toFixed(2)} ${(12 + Math.sin(a) * r).toFixed(2)}`;
  }
  return d + 'Z';
};
const circ = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`;
const rays = (() => {
  let d = '';
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4, b = 0.24;
    const p = (ang: number, r: number) => `${(12 + Math.cos(ang) * r).toFixed(2)} ${(12 + Math.sin(ang) * r).toFixed(2)}`;
    d += `M${p(a - b, 6.6)}L${p(a, 11)}L${p(a + b, 6.6)}Z`;
  }
  return d;
})();

const DEFS: Record<string, SigilDef> = {
  sun: { fill: circ(12, 12, 5) + rays },
  moon: { fill: 'M15.5 2.5a9.5 9.5 0 1 0 6.5 16A8 8 0 0 1 15.5 2.5Z' },
  star: { fill: star(8, 10.5, 4.2) },
  crown: { fill: 'M3 18.2h18v2.6H3ZM3 16.6 2 6.8l5.2 4.3L12 3.6l4.8 7.5 5.2-4.3-1 9.8Z' },
  wolf: { fill: 'M3.5 2.5 8 8h8l4.5-5.5 1 9.5-3.3 3.2-2.2 6.3H8l-2.2-6.3L2.5 12ZM8.2 11.6l2.8 1.2-2.6.9ZM15.8 11.6 13 12.8l2.6.9Z', evenodd: true },
  serpent: { stroke: 'M18 4.5c-3-2.4-10-1.6-10 3.2 0 4.3 9.6 3.4 9.6 8.6 0 4.6-7.2 5.6-10.6 2.8', sw: 3.2, fill: circ(18.6, 4.8, 2.4) },
  anchor: { stroke: 'M12 7.4V20.5M7.5 10.5h9M4.6 14.2c0 4 3.3 6.3 7.4 6.3s7.4-2.3 7.4-6.3', sw: 2.4, fill: 'M12 1.8a2.8 2.8 0 1 0 .01 0ZM12 3.4a1.2 1.2 0 1 1-.01 0Z', evenodd: true },
  tower: { fill: 'M5 3.5h3v3h2.5v-3h3v3H16v-3h3v6H5ZM6.5 9.5h11V21h-11ZM10.6 21v-3.8a1.4 1.4 0 0 1 2.8 0V21Z', evenodd: true },
  blade: { fill: 'M12 1.2l2.1 3.2v11.2H9.9V4.4ZM6.2 15.4h11.6v2.2H6.2ZM10.9 17.6h2.2v3.3h-2.2Z' + circ(12, 22, 1.4) },
  eye: { fill: 'M1.5 12c4.5-6.8 16.5-6.8 21 0-4.5 6.8-16.5 6.8-21 0Z' + circ(12, 12, 4) + circ(12, 12, 1.9), evenodd: true },
  flame: { fill: 'M12.4 1.6c1 4.3 6.4 6.3 6.4 12.6a6.8 6.8 0 0 1-13.6 0c0-3.4 2.1-5.6 3.3-7.6.1 3.2 1.1 4.6 2.3 4.6.1-4.3-1.2-6.4 1.6-9.6Z' },
  raven: { fill: 'M2.5 15.5 7.8 13l3-5.6c1.9-2.2 5-2.4 6.3-.3l4.4 1-3.3 1.4v2c0 4.3-3.3 7.4-8.4 8.2L7 22.4V19l-4.1 1.1 2.4-3.2Z' },
};

export const sigilIds = SIGILS.map(s => s.id);
export const sigilName = (id: string) => SIGILS.find(s => s.id === id)?.name ?? id;

// ------------------------------------------------------------------ DOM (inline SVG)
let defsDone = false;
/** Metal gradients shared by every inline sigil (inserted once into the document). */
export function ensureSigilDefs() {
  if (defsDone || typeof document === 'undefined') return;
  defsDone = true;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  svg.innerHTML = `<defs>
    <linearGradient id="tc-gold" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#fff4c4"/><stop offset="0.45" stop-color="#e5b14a"/><stop offset="1" stop-color="#7a4c12"/></linearGradient>
    <linearGradient id="tc-silver" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="0.5" stop-color="#bfc6d4"/><stop offset="1" stop-color="#4c5262"/></linearGradient>
    <linearGradient id="tc-iron" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#c3c8d6"/><stop offset="0.5" stop-color="#6c7183"/><stop offset="1" stop-color="#262833"/></linearGradient>
    <linearGradient id="tc-shine" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.38"/><stop offset="0.45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.35"/></linearGradient>
  </defs>`;
  document.body.appendChild(svg);
}

function sigilPaths(id: string, paint: string, dark = 'rgba(0,0,0,0.55)'): string {
  const d = DEFS[id] ?? DEFS.star;
  const rule = d.evenodd ? ' fill-rule="evenodd"' : '';
  let out = '';
  // a dark offset first: the charge sits raised on the plate, lit from the upper left
  if (d.stroke) out += `<path d="${d.stroke}" fill="none" stroke="${dark}" stroke-width="${d.sw}" stroke-linecap="round" stroke-linejoin="round" transform="translate(0.6 0.8)"/>`;
  if (d.fill) out += `<path d="${d.fill}" fill="${dark}"${rule} transform="translate(0.6 0.8)"/>`;
  if (d.stroke) out += `<path d="${d.stroke}" fill="none" stroke="${paint}" stroke-width="${d.sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (d.fill) out += `<path d="${d.fill}" fill="${paint}"${rule}/>`;
  return out;
}

/** Just the charge (no shield), in a metal ('gold' | 'silver' | 'iron') or a CSS colour. */
export function sigilSvg(id: string, size = 20, metal = 'gold', cls = 'sigil'): string {
  ensureSigilDefs();
  const paint = metal === 'gold' || metal === 'silver' || metal === 'iron' ? `url(#tc-${metal})` : metal;
  return `<svg class="${cls}" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${sigilPaths(id, paint)}</svg>`;
}

const SHIELD = 'M3 2h26a1 1 0 0 1 1 1v12c0 9-7 14-14 17C9 29 2 24 2 15V3a1 1 0 0 1 1-1Z';
/** The full banner: an enamel heater shield in `color` with a metal rim and the sigil. Optional rank chevrons
 *  under the charge and an Oathbreaker crack. */
export function bannerSvg(id: string, color: string, size = 32, opts: { rim?: 'gold' | 'silver' | 'iron'; rank?: number; broken?: boolean; cls?: string } = {}): string {
  ensureSigilDefs();
  const rim = opts.rim ?? 'silver';
  const chev = opts.rank && opts.rank > 1 ? Array.from({ length: Math.min(4, opts.rank - 1) }, (_, i) => `<path d="M10.5 ${21 + i * 2.3}l5.5 2.6 5.5-2.6" fill="none" stroke="url(#tc-gold)" stroke-width="1.4" stroke-linecap="round"/>`).join('') : '';
  const crack = opts.broken ? '<path d="M18.5 2.5l-3 6 3.2 3-4.4 6.4 2.2 3.4-3.5 8" fill="none" stroke="#120808" stroke-width="2.2" stroke-linejoin="round"/><path d="M18.5 2.5l-3 6 3.2 3-4.4 6.4 2.2 3.4-3.5 8" fill="none" stroke="#ff5a4a" stroke-width="0.9" stroke-linejoin="round"/>' : '';
  const sy = chev ? 0 : 1.5;
  return `<svg class="${opts.cls ?? 'banner-svg'}" viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true">
    <path d="${SHIELD}" fill="${color}"/><path d="${SHIELD}" fill="url(#tc-shine)"/>
    <path d="${SHIELD}" fill="none" stroke="url(#tc-${rim})" stroke-width="1.8"/>
    <g transform="translate(7 ${4 + sy}) scale(0.75)">${sigilPaths(id, 'url(#tc-gold)')}</g>${chev}${crack}</svg>`;
}

// ------------------------------------------------------------------ canvas
const cache = new Map<string, { fill?: Path2D; stroke?: Path2D }>();
function paths(id: string) {
  let p = cache.get(id);
  if (!p) {
    const d = DEFS[id] ?? DEFS.star;
    p = { fill: d.fill ? new Path2D(d.fill) : undefined, stroke: d.stroke ? new Path2D(d.stroke) : undefined };
    cache.set(id, p);
  }
  return p;
}
/** Draw the charge centred on (x, y), `size` across, in `paint` (a colour or gradient), with a dark raised offset. */
export function drawSigil(g: CanvasRenderingContext2D, id: string, x: number, y: number, size: number, paint: string | CanvasGradient, shadow = true) {
  const d = DEFS[id] ?? DEFS.star;
  const P = paths(id);
  const k = size / 24;
  const draw = (fill: string | CanvasGradient, ox: number, oy: number) => {
    g.save();
    g.translate(x - 12 * k + ox, y - 12 * k + oy);
    g.scale(k, k);
    if (P.stroke) { g.strokeStyle = fill; g.lineWidth = d.sw ?? 2; g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke(P.stroke); }
    if (P.fill) { g.fillStyle = fill; g.fill(P.fill, d.evenodd ? 'evenodd' : 'nonzero'); }
    g.restore();
  };
  if (shadow) draw('rgba(0,0,0,0.6)', 0.6 * k, 0.8 * k);
  draw(paint, 0, 0);
}
/** A gold gradient spanning y0..y1 (canvas). */
export function goldPaint(g: CanvasRenderingContext2D, y0: number, y1: number): CanvasGradient {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  gr.addColorStop(0, '#fff4c4'); gr.addColorStop(0.45, '#e5b14a'); gr.addColorStop(1, '#7a4c12');
  return gr;
}
