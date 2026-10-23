// Commander portraits (docs/DELIGHT.md #37 #38, LOOPS §6 item 12): a painted miniature in an oval brass bezel, the
// kind an admiralty hangs in a locket. Deterministic from the commander's name (face, hair, eyes, beard) and house
// (the coat's enamel, the ground behind). History paints over it, and every mark is true:
//   Burned Hull     a burn across the cheek            Haunted        a white streak in the hair, shadowed eyes
//   Grudge          one eye narrowed, the brow knit    Skeleton Crew  a hollow face
//   two routs       an eyepatch or a brass ocular (by name: one commander, one choice, for the whole game)
//   Legend rank     a gold laurel                      15+ turns      grey at the temples
//   fallen          a black mourning sash across the frame
// Lit like everything on the table: one warm lamp, upper left; the terminator falls down and right.
// Baked once per (look, size) into a data URL and cached: a card re-render costs a Map lookup.
import { canvas, strHash, rand, rgb, css, mix, shade, type RGB } from './util.ts';
import { enamel, MATERIAL } from './bible.ts';

export type PortraitScar = 'burned' | 'haunted' | 'grudge' | 'skeleton';
/** An AI house's ruler (ui/houses.ts): a stock face and age for the persona. */
export type PortraitPersona = 'heir' | 'steward' | 'admiral';
export interface PortraitSpec {
  /** The commander's full name: the seed of the face. */
  name: string;
  /** The owner colour (any form the state carries; mapped to the house enamel). */
  color: string;
  scars?: string[];
  /** Routed twice or more: the eye is gone (patch or ocular, by name). */
  maimed?: boolean;
  /** Legend rank: the laurel. */
  legend?: boolean;
  /** Rank 1..5: brass on the coat (one pip per rank past the first). */
  rank?: number;
  /** Served 15+ turns: grey at the temples. */
  grey?: boolean;
  /** Fallen: the mourning sash. */
  dead?: boolean;
  persona?: PortraitPersona;
}

/** Logical canvas units: everything below is drawn on a 100 x 125 card. */
const UW = 100, UH = 125, CX = 50, CY = 62.5, RX = 45.5, RY = 58;

const SKIN: RGB[] = ['#efcfae', '#e3b893', '#cf9c74', '#b47f58', '#93623f', '#6e472e'].map(rgb);
const HAIR: RGB[] = ['#1b1410', '#33221a', '#4f3322', '#6e3f22', '#8f6c45', '#24242a', '#5a4a3c'].map(rgb);
const IRIS: RGB[] = ['#3b2614', '#4b3a24', '#3d4a3a', '#3f5466', '#55524a'].map(rgb);
const GREY: RGB = rgb('#a19c92'), WHITE: RGB = rgb('#ddd6c8');

interface Look {
  skin: RGB; hair: RGB; iris: RGB;
  faceW: number; jaw: number; chin: number; style: number; beard: number; brow: number; mouthW: number; noseL: number;
  eyeY: number; age: 0 | 1 | 2; specs: boolean; patchKind: 'patch' | 'ocular'; tilt: number;
}

function lookOf(spec: PortraitSpec): Look {
  const h = strHash(`face:${spec.name}`);
  const r = rand(h);
  const pick = <T>(a: T[]) => a[Math.floor(r() * a.length) % a.length];
  const L: Look = {
    skin: pick(SKIN), hair: pick(HAIR), iris: pick(IRIS),
    faceW: 14.2 + r() * 2.6, jaw: 0.55 + r() * 0.4, chin: 0.4 + r() * 0.6,
    style: Math.floor(r() * 6), beard: r() < 0.38 ? 1 + Math.floor(r() * 3) : 0, brow: 1 + r() * 0.9,
    mouthW: 6.2 + r() * 2.6, noseL: 7.4 + r() * 2.4, eyeY: 50.5 + r() * 1.5,
    age: r() < 0.25 ? 2 : r() < 0.55 ? 1 : 0, specs: false, patchKind: r() < 0.5 ? 'patch' : 'ocular', tilt: (r() - 0.5) * 0.06,
  };
  // the houses' rulers: a stock face by temperament, the house still in the coat and ground
  if (spec.persona === 'heir') { L.age = 0; L.beard = 0; L.style = 2; L.faceW = 14.4; L.jaw = 0.5; }
  if (spec.persona === 'steward') { L.age = 1; L.beard = 0; L.style = 0; L.specs = true; L.jaw = 0.75; }
  if (spec.persona === 'admiral') { L.age = 2; L.beard = 3; L.style = 3; L.brow = 1.8; L.jaw = 0.9; }
  return L;
}

// ------------------------------------------------------------------ painting helpers
type C = CanvasRenderingContext2D;
const ell = (c: C, x: number, y: number, rx: number, ry: number, rot = 0) => { c.beginPath(); c.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, Math.PI * 2); };
/** A soft round dab of paint (radial falloff), the brush the whole portrait is laid in with. */
function dab(c: C, x: number, y: number, r: number, col: RGB, a: number, sy = 1) {
  c.save(); c.translate(x, y); c.scale(1, sy);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, r);
  g.addColorStop(0, css(col, a)); g.addColorStop(1, css(col, 0));
  c.fillStyle = g; c.fillRect(-r, -r, r * 2, r * 2);
  c.restore();
}

/** The head's outline (the face, cheeks, jaw and chin), used to fill and to clip skin marks. */
function headPath(c: C, L: Look) {
  const w = L.faceW, top = 31.5, chinY = 74 + L.chin * 1.6, jawX = w * (0.62 + L.jaw * 0.12);
  c.beginPath();
  c.moveTo(CX, top);
  c.bezierCurveTo(CX + w * 0.95, top, CX + w * 1.04, 42, CX + w, 51);
  c.bezierCurveTo(CX + w * 0.98, 60, CX + jawX + 1.5, 66, CX + jawX * 0.62, 71);
  c.bezierCurveTo(CX + 4, chinY, CX - 4, chinY, CX - jawX * 0.62, 71);
  c.bezierCurveTo(CX - jawX - 1.5, 66, CX - w * 0.98, 60, CX - w, 51);
  c.bezierCurveTo(CX - w * 1.04, 42, CX - w * 0.95, top, CX, top);
  c.closePath();
}

function ground(c: C, spec: PortraitSpec, seed: number) {
  const e = enamel(spec.color);
  const lo = rgb(e.lo), umber = rgb('#2a1c12'), ink = rgb(MATERIAL.ink);
  const g = c.createRadialGradient(CX - 18, 30, 4, CX, CY, 70);
  g.addColorStop(0, css(mix(mix(umber, lo, 0.45), rgb('#8a6a42'), 0.35)));
  g.addColorStop(0.55, css(mix(umber, lo, 0.55)));
  g.addColorStop(1, css(mix(ink, lo, 0.25)));
  c.fillStyle = g; c.fillRect(0, 0, UW, UH);
  // loose brushwork in the ground
  const r = rand(seed ^ 0x9e37);
  for (let i = 0; i < 26; i++) dab(c, r() * UW, r() * UH * 0.8, 8 + r() * 16, r() < 0.5 ? mix(lo, umber, 0.4) : shade(mix(umber, lo, 0.3), 0.18), 0.22 + r() * 0.2, 0.6 + r() * 0.6);
}

function coat(c: C, spec: PortraitSpec, L: Look) {
  const e = enamel(spec.color);
  const base = rgb(e.base), lo = rgb(e.lo);
  c.save(); c.translate(CX, 0); c.scale(1.06, 1); c.translate(-CX, -4.5);
  // shoulders: a dark coat in the house enamel, lit from the upper left
  c.beginPath();
  c.moveTo(-2, UH + 2);
  c.bezierCurveTo(0, 104, 10, 94, 30, 89);
  c.quadraticCurveTo(CX, 84, 70, 89);
  c.bezierCurveTo(90, 94, 100, 104, 102, UH + 2);
  c.closePath();
  const g = c.createLinearGradient(8, 86, 92, 125);
  g.addColorStop(0, css(shade(base, 0.12))); g.addColorStop(0.45, css(mix(base, lo, 0.35))); g.addColorStop(1, css(shade(lo, -0.45)));
  c.fillStyle = g; c.fill();
  // the lapels fold in to a dark V; a white stock at the throat
  c.beginPath(); c.moveTo(38, 88); c.lineTo(CX, 112); c.lineTo(62, 88); c.quadraticCurveTo(CX, 92, 38, 88); c.closePath();
  c.fillStyle = css(shade(lo, -0.35)); c.fill();
  c.beginPath(); c.moveTo(42.5, 87); c.quadraticCurveTo(CX, 99, 57.5, 87); c.lineTo(CX + 3, 97); c.lineTo(CX, 103); c.lineTo(CX - 3, 97); c.closePath();
  const sg = c.createLinearGradient(42, 87, 58, 103); sg.addColorStop(0, '#efe4cc'); sg.addColorStop(1, '#9b8c72');
  c.fillStyle = sg; c.fill();
  // brass piping on the lapel edges
  c.strokeStyle = 'rgba(232,196,120,0.75)'; c.lineWidth = 0.7;
  c.beginPath(); c.moveTo(38, 88); c.lineTo(CX, 112); c.lineTo(62, 88); c.stroke();
  // epaulettes: brass boards, fringed from Veteran up
  const rank = spec.rank ?? 1;
  for (const s of [-1, 1]) {
    const x = CX + s * 30, y = 93.5;
    c.save(); c.translate(x, y); c.rotate(s * 0.32);
    const bg = c.createLinearGradient(-8, -3, 6, 4); bg.addColorStop(0, '#f7e2a6'); bg.addColorStop(0.4, '#c8964a'); bg.addColorStop(1, '#6b4a1c');
    ell(c, 0, 0, 8.5, 3.2); c.fillStyle = bg; c.fill();
    c.strokeStyle = 'rgba(40,24,8,0.7)'; c.lineWidth = 0.5; c.stroke();
    if (rank >= 3) {
      c.strokeStyle = 'rgba(214,170,90,0.85)'; c.lineWidth = 0.8;
      for (let i = -6; i <= 6; i += 1.6) { c.beginPath(); c.moveTo(i, 2.4); c.lineTo(i * 1.08, 6.4); c.stroke(); }
    }
    c.restore();
  }
  // rank: a brass pip on the breast for each rank past the first
  for (let i = 0; i < Math.min(4, rank - 1); i++) {
    const x = 33 + i * 4.4, y = 107 + i * 1.1;
    const pg = c.createRadialGradient(x - 0.6, y - 0.7, 0.2, x, y, 1.8); pg.addColorStop(0, '#fbedc8'); pg.addColorStop(0.6, '#c8964a'); pg.addColorStop(1, '#5a3c14');
    ell(c, x, y, 1.6, 1.6); c.fillStyle = pg; c.fill();
  }
  c.restore();
}

function hairBack(c: C, L: Look, col: RGB) {
  // what falls behind the head: long hair, a queue, a bun
  c.fillStyle = css(shade(col, -0.25));
  if (L.style === 2) {
    c.beginPath(); c.moveTo(CX - L.faceW - 3, 44); c.bezierCurveTo(CX - L.faceW - 7, 70, CX - L.faceW - 4, 86, CX - 11, 90);
    c.lineTo(CX + 11, 90); c.bezierCurveTo(CX + L.faceW + 4, 86, CX + L.faceW + 7, 70, CX + L.faceW + 3, 44); c.closePath(); c.fill();
  } else if (L.style === 4) {
    ell(c, CX + L.faceW * 0.85, 38, 6.5, 6); c.fill();
  } else if (L.style === 5) {
    c.beginPath(); c.moveTo(CX + L.faceW - 2, 50); c.quadraticCurveTo(CX + L.faceW + 6, 66, CX + L.faceW + 2, 84); c.lineWidth = 4; c.strokeStyle = css(shade(col, -0.2)); c.stroke();
  }
}

function hairTop(c: C, L: Look, col: RGB, spec: PortraitSpec) {
  const w = L.faceW, hi = shade(col, 0.28), dk = shade(col, -0.3);
  const g = c.createLinearGradient(CX - w, 24, CX + w, 46);
  g.addColorStop(0, css(hi)); g.addColorStop(0.5, css(col)); g.addColorStop(1, css(dk));
  c.fillStyle = g;
  c.beginPath();
  switch (L.style) {
    case 3: // bald crown, hair kept at the sides
      c.moveTo(CX - w - 0.8, 53); c.quadraticCurveTo(CX - w - 2, 40, CX - w + 3.5, 37); c.quadraticCurveTo(CX - w + 2, 46, CX - w + 2.2, 53); c.closePath();
      c.moveTo(CX + w + 0.8, 53); c.quadraticCurveTo(CX + w + 2, 40, CX + w - 3.5, 37); c.quadraticCurveTo(CX + w - 2, 46, CX + w - 2.2, 53); c.closePath();
      break;
    case 1: // swept back, with volume
      c.moveTo(CX - w - 1.2, 50); c.bezierCurveTo(CX - w - 4, 30, CX - 4, 21, CX + 6, 23.5); c.bezierCurveTo(CX + w + 6, 26, CX + w + 3, 40, CX + w + 1, 50);
      c.quadraticCurveTo(CX + w - 2, 39, CX + 4, 35.5); c.quadraticCurveTo(CX - w + 4, 36, CX - w + 1, 50); c.closePath();
      break;
    case 2: // long, parted
      c.moveTo(CX - w - 2.5, 60); c.bezierCurveTo(CX - w - 4, 34, CX - 6, 23, CX + 1, 25); c.bezierCurveTo(CX + w + 5, 25, CX + w + 4.5, 40, CX + w + 2.5, 60);
      c.quadraticCurveTo(CX + w - 1, 42, CX + 2, 33); c.quadraticCurveTo(CX - w + 1, 38, CX - w + 0.6, 60); c.closePath();
      break;
    default: // a close crop (0), the bun's top (4), the queue's top (5)
      c.moveTo(CX - w - 0.6, 49); c.bezierCurveTo(CX - w - 2, 30, CX - 5, 25, CX + 2, 26); c.bezierCurveTo(CX + w + 3, 27, CX + w + 2, 38, CX + w + 0.6, 49);
      c.quadraticCurveTo(CX + w - 2, 37, CX + 1, 34.5); c.quadraticCurveTo(CX - w + 3, 35, CX - w + 0.8, 49); c.closePath();
  }
  c.fill();
  // strands: a few lit strokes the way a brush lays hair
  const r = rand(strHash(`hair:${spec.name}`));
  c.strokeStyle = css(shade(hi, 0.1), 0.35); c.lineWidth = 0.45;
  if (L.style !== 3) for (let i = 0; i < 9; i++) {
    const x0 = CX - w + r() * w * 1.2, y0 = 27 + r() * 6;
    c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo(x0 + 4 + r() * 4, y0 + 2, x0 + 6 + r() * 6, y0 + 8 + r() * 4); c.stroke();
  }
  // grey at the temples (long service, or age)
  if (spec.grey && L.age < 2) for (const s of [-1, 1]) dab(c, CX + s * (w - 0.5), 46, 4.4, GREY, 0.75, 1.6);
}

function face(c: C, L: Look, spec: PortraitSpec) {
  const skin = L.skin, lit = shade(skin, 0.16), dark = shade(skin, -0.38);
  const w = L.faceW;
  // neck, in shadow under the jaw
  c.beginPath(); c.moveTo(CX - 8.5, 64); c.lineTo(CX - 10, 88); c.quadraticCurveTo(CX, 92, CX + 10, 88); c.lineTo(CX + 8.5, 64); c.closePath();
  const ng = c.createLinearGradient(CX - 8, 70, CX + 8, 90); ng.addColorStop(0, css(shade(skin, -0.12))); ng.addColorStop(1, css(shade(skin, -0.5)));
  c.fillStyle = ng; c.fill();
  // ears
  for (const s of [-1, 1]) {
    ell(c, CX + s * (w + 0.4), 53.5, 2.4, 4.4, s * 0.15);
    c.fillStyle = css(s < 0 ? shade(skin, -0.05) : dark); c.fill();
  }
  headPath(c, L);
  const g = c.createRadialGradient(CX - 6, 44, 2, CX - 1, 52, w * 1.75);
  g.addColorStop(0, css(lit)); g.addColorStop(0.55, css(skin)); g.addColorStop(1, css(dark));
  c.fillStyle = g; c.fill();
  c.save();
  headPath(c, L); c.clip();
  // the terminator: the side away from the lamp falls into shadow
  const tg = c.createLinearGradient(CX - 4, 0, CX + w + 2, 0);
  tg.addColorStop(0, 'rgba(40,18,8,0)'); tg.addColorStop(1, 'rgba(40,18,8,0.42)');
  c.fillStyle = tg; c.fillRect(CX - w - 4, 25, w * 2 + 8, 60);
  // jaw shadow, cheek warmth, forehead light
  dab(c, CX, 73, 11, shade(skin, -0.5), 0.35, 0.45);
  for (const s of [-1, 1]) dab(c, CX + s * 8, 60, 5, rgb('#b85a44'), 0.14);
  dab(c, CX - 4, 39, 7, shade(lit, 0.2), 0.3, 0.7);
  // eye sockets
  for (const s of [-1, 1]) dab(c, CX + s * 6.6, L.eyeY - 0.5, 4.6, shade(skin, -0.45), 0.32, 0.7);
  // age lines
  if (L.age >= 1) { c.strokeStyle = css(shade(skin, -0.42), 0.35); c.lineWidth = 0.4; for (const s of [-1, 1]) { c.beginPath(); c.moveTo(CX + s * 4.5, 61); c.quadraticCurveTo(CX + s * 7.5, 64, CX + s * 7, 67.5); c.stroke(); } }
  if (L.age >= 2) { c.strokeStyle = css(shade(skin, -0.4), 0.3); c.lineWidth = 0.35; for (let i = 0; i < 2; i++) { c.beginPath(); c.moveTo(CX - 6, 39 + i * 2); c.quadraticCurveTo(CX, 38 + i * 2, CX + 6, 39 + i * 2); c.stroke(); } }
  c.restore();
}

function features(c: C, L: Look, spec: PortraitSpec, scars: Set<string>) {
  const skin = L.skin, ink = shade(skin, -0.72), y = L.eyeY;
  const grudge = scars.has('grudge');
  const lostEye = !!spec.maimed;
  // eyes (the viewer's right eye is the commander's left; a lost eye is always the right one, under the patch)
  for (const s of [-1, 1]) {
    const x = CX + s * 6.6;
    const narrow = grudge && s === 1 ? 0.45 : 1;
    // the white, muted to the skin
    c.save();
    c.beginPath(); c.moveTo(x - 3, y); c.quadraticCurveTo(x, y - 2.1 * narrow, x + 3, y); c.quadraticCurveTo(x, y + 1.5 * narrow, x - 3, y); c.closePath();
    c.fillStyle = css(mix(rgb('#e8dcc6'), skin, 0.35)); c.fill();
    c.clip();
    ell(c, x + 0.2, y - 0.1, 1.45, 1.45); c.fillStyle = css(L.iris); c.fill();
    ell(c, x + 0.2, y - 0.1, 0.62, 0.62); c.fillStyle = '#120b06'; c.fill();
    ell(c, x - 0.35, y - 0.6, 0.35, 0.35); c.fillStyle = 'rgba(255,240,215,0.85)'; c.fill();
    c.restore();
    // the upper lid, heavy; a lighter lower lid
    c.strokeStyle = css(ink, 0.9); c.lineWidth = 0.75; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x - 3.1, y + 0.1); c.quadraticCurveTo(x, y - 2.4 * narrow, x + 3.1, y - 0.1); c.stroke();
    c.strokeStyle = css(ink, 0.3); c.lineWidth = 0.4;
    c.beginPath(); c.moveTo(x - 2.4, y + 0.9); c.quadraticCurveTo(x, y + 1.8 * narrow, x + 2.6, y + 0.6); c.stroke();
    // brows (a grudge knits them down at the inner end)
    const knit = grudge ? 1.6 : 0;
    c.strokeStyle = css(shade(L.hair, L.age === 2 ? 0.45 : 0.05), 0.95); c.lineWidth = L.brow;
    c.beginPath(); c.moveTo(x - s * 3.6, y - 3.6 + knit);
    c.quadraticCurveTo(x, y - 5.2, x + s * 3.6, y - 4);
    c.stroke();
  }
  if (scars.has('haunted') || scars.has('skeleton')) for (const s of [-1, 1]) dab(c, CX + s * 6.6, y + 2.6, 3.4, rgb('#2b1a26'), 0.3, 0.5);
  // nose: a lit bridge, a shadow plane on the far side, the nostrils
  const nl = L.noseL;
  c.strokeStyle = css(shade(skin, 0.3), 0.55); c.lineWidth = 0.9;
  c.beginPath(); c.moveTo(CX - 0.8, y + 0.5); c.lineTo(CX - 1, y + nl - 1); c.stroke();
  c.fillStyle = css(shade(skin, -0.42), 0.55);
  c.beginPath(); c.moveTo(CX + 1.2, y + 1); c.quadraticCurveTo(CX + 3.4, y + nl * 0.7, CX + 2.6, y + nl + 0.4); c.lineTo(CX + 0.6, y + nl); c.closePath(); c.fill();
  c.fillStyle = css(ink, 0.65);
  ell(c, CX - 1.7, y + nl + 0.6, 0.85, 0.5, 0.3); c.fill();
  ell(c, CX + 1.9, y + nl + 0.6, 0.85, 0.5, -0.3); c.fill();
  dab(c, CX - 0.6, y + nl - 0.8, 1.5, shade(skin, 0.35), 0.5);
  // mouth: the dark line between the lips, a lit lower lip
  const my = y + nl + 5.2, mw = L.mouthW / 2;
  c.fillStyle = css(mix(rgb('#9c4a3a'), skin, 0.45));
  c.beginPath(); c.moveTo(CX - mw, my); c.quadraticCurveTo(CX, my + 2.6, CX + mw, my); c.quadraticCurveTo(CX, my + 0.6, CX - mw, my); c.fill();
  c.strokeStyle = css(ink, 0.8); c.lineWidth = 0.6;
  c.beginPath(); c.moveTo(CX - mw, my); c.quadraticCurveTo(CX, my - 0.9 + (L.age === 2 ? 0.8 : 0), CX + mw, my); c.stroke();
  dab(c, CX - 1, my + 1.6, 1.6, shade(skin, 0.3), 0.35, 0.6);
  // facial hair: 1 moustache, 2 moustache + chin, 3 full beard
  if (L.beard) {
    const bc = L.age === 2 ? mix(L.hair, WHITE, 0.7) : L.hair;
    c.fillStyle = css(bc, 0.95);
    c.beginPath(); c.moveTo(CX - mw - 1.5, my + 0.3); c.quadraticCurveTo(CX - 2, my - 3.4, CX, my - 1.6); c.quadraticCurveTo(CX + 2, my - 3.4, CX + mw + 1.5, my + 0.3); c.quadraticCurveTo(CX, my - 1, CX - mw - 1.5, my + 0.3); c.fill();
    if (L.beard >= 2) { c.beginPath(); c.moveTo(CX - 3, my + 3); c.quadraticCurveTo(CX, my + 11, CX + 3, my + 3); c.quadraticCurveTo(CX, my + 4.5, CX - 3, my + 3); c.fill(); }
    if (L.beard >= 3) {
      const w = L.faceW;
      c.beginPath(); c.moveTo(CX - w + 0.5, 54); c.bezierCurveTo(CX - w + 1, 70, CX - 6, 79, CX, 80); c.bezierCurveTo(CX + 6, 79, CX + w - 1, 70, CX + w - 0.5, 54);
      c.quadraticCurveTo(CX + w - 4, 68, CX + mw + 1, my + 2.5); c.quadraticCurveTo(CX, my + 5, CX - mw - 1, my + 2.5); c.quadraticCurveTo(CX - w + 4, 68, CX - w + 0.5, 54); c.fill();
      c.strokeStyle = css(shade(bc, 0.3), 0.3); c.lineWidth = 0.4;
      for (let i = -3; i <= 3; i++) { c.beginPath(); c.moveTo(CX + i * 2.4, my + 4); c.lineTo(CX + i * 2.8, my + 10); c.stroke(); }
    }
  }
}

function marks(c: C, L: Look, spec: PortraitSpec, scars: Set<string>, seed: number) {
  const skin = L.skin, w = L.faceW, y = L.eyeY;
  c.save();
  headPath(c, L); c.clip();
  if (scars.has('skeleton')) {
    // a hollow face: the cheeks sink under lit cheekbones
    for (const s of [-1, 1]) { dab(c, CX + s * (w - 4.2), 63, 5, shade(skin, -0.6), 0.5, 1.5); dab(c, CX + s * (w - 4.5), 56, 3.4, shade(skin, 0.35), 0.35, 0.6); }
    dab(c, CX - 4, 44, 6, shade(skin, 0.25), 0.25);
  }
  if (scars.has('burned')) {
    // a burn across the lit cheek: mottled, glossy where it healed
    const r = rand(seed ^ 0xb0b);
    for (let i = 0; i < 9; i++) dab(c, CX - 9 + r() * 7, 57 + r() * 9, 2.4 + r() * 2.6, rgb(r() < 0.5 ? '#8e3a2a' : '#b6644a'), 0.45);
    for (let i = 0; i < 4; i++) dab(c, CX - 8 + r() * 6, 57 + r() * 8, 1 + r(), rgb('#f2c6a6'), 0.5);
    c.strokeStyle = 'rgba(90,30,20,0.45)'; c.lineWidth = 0.45;
    c.beginPath(); c.moveTo(CX - 12, 55); c.quadraticCurveTo(CX - 7, 62, CX - 3, 68); c.stroke();
  }
  c.restore();
  if (scars.has('haunted')) {
    // a white streak from the brow up through the hair
    c.save();
    c.strokeStyle = css(WHITE, 0.9); c.lineWidth = 2.1; c.lineCap = 'round';
    c.beginPath(); c.moveTo(CX - 5, 35.5); c.quadraticCurveTo(CX - 7, 30, CX - 4, 26.5); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.4)'; c.lineWidth = 0.6;
    c.beginPath(); c.moveTo(CX - 5.4, 35); c.quadraticCurveTo(CX - 7.4, 30, CX - 4.6, 27); c.stroke();
    c.restore();
  }
  if (spec.maimed) {
    const x = CX + 6.6;
    if (L.patchKind === 'patch') {
      // a black leather patch on a cord over the brow and round the head
      c.strokeStyle = '#120c08'; c.lineWidth = 0.9;
      c.beginPath(); c.moveTo(x - 3, y - 2.6); c.quadraticCurveTo(CX - 4, 38, CX - w - 0.5, 44); c.stroke();
      c.beginPath(); c.moveTo(x + 3.4, y); c.lineTo(CX + w + 0.5, y - 1.2); c.stroke();
      ell(c, x + 0.2, y + 0.2, 4, 3.4, 0.1);
      const pg = c.createRadialGradient(x - 1.2, y - 1.2, 0.2, x, y, 4.5); pg.addColorStop(0, '#4a3a2e'); pg.addColorStop(0.5, '#1e1510'); pg.addColorStop(1, '#0a0705');
      c.fillStyle = pg; c.fill();
      c.strokeStyle = 'rgba(120,96,70,0.6)'; c.lineWidth = 0.35; c.stroke();
    } else {
      // a brass ocular riveted over the lost eye, its lens a warm amber
      ell(c, x + 0.2, y, 4.2, 4.2);
      const rg = c.createLinearGradient(x - 4, y - 4, x + 4, y + 4); rg.addColorStop(0, '#f7e2a6'); rg.addColorStop(0.45, '#b8863a'); rg.addColorStop(1, '#4a3010');
      c.fillStyle = rg; c.fill();
      ell(c, x + 0.2, y, 2.6, 2.6);
      const lg = c.createRadialGradient(x - 0.6, y - 0.8, 0.2, x + 0.2, y, 2.8); lg.addColorStop(0, '#ffe7a8'); lg.addColorStop(0.45, '#e09a3a'); lg.addColorStop(1, '#5a2a08');
      c.fillStyle = lg; c.fill();
      c.fillStyle = 'rgba(30,18,6,0.8)';
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.6; ell(c, x + 0.2 + Math.cos(a) * 3.5, y + Math.sin(a) * 3.5, 0.35, 0.35); c.fill(); }
      c.strokeStyle = 'rgba(40,24,10,0.55)'; c.lineWidth = 0.4;
      c.beginPath(); c.moveTo(x + 4.2, y + 0.6); c.lineTo(CX + w, y + 3); c.stroke();
    }
  }
  if (L.specs) {
    c.strokeStyle = 'rgba(214,176,100,0.9)'; c.lineWidth = 0.5;
    for (const s of [-1, 1]) { ell(c, CX + s * 6.6, y, 3.4, 2.8); c.stroke(); }
    c.beginPath(); c.moveTo(CX - 3.2, y - 0.4); c.quadraticCurveTo(CX, y - 1.6, CX + 3.2, y - 0.4); c.stroke();
  }
}

function laurel(c: C) {
  // a gold laurel round the brow, open at the front
  const leaf = (x: number, y: number, a: number, k: number) => {
    c.save(); c.translate(x, y); c.rotate(a);
    ell(c, 0, 0, 2.6 * k, 1.05 * k);
    const g = c.createLinearGradient(-2, -1, 2, 1); g.addColorStop(0, '#fbedc8'); g.addColorStop(0.5, '#d9a84a'); g.addColorStop(1, '#6b4a1c');
    c.fillStyle = g; c.fill();
    c.strokeStyle = 'rgba(60,36,8,0.55)'; c.lineWidth = 0.3; c.stroke();
    c.restore();
  };
  for (const s of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const t = i / 6, a = Math.PI * (0.94 - t * 0.5);
      const x = CX + s * Math.cos(a) * -18.5, y = 44 - Math.sin(a) * 15.5;
      const tang = s * (a - Math.PI / 2);
      leaf(x, y, tang + s * 0.55, 1 - t * 0.25);
      leaf(x + s * 1.2, y + 1.6, tang - s * 0.5, 0.9 - t * 0.25);
    }
  }
}

function varnish(c: C, seed: number) {
  // the lamp's glaze from the upper left, the room's dark at the lower right, and the canvas tooth
  const g = c.createLinearGradient(0, 0, UW, UH);
  g.addColorStop(0, 'rgba(255,217,160,0.14)'); g.addColorStop(0.5, 'rgba(255,217,160,0)'); g.addColorStop(1, 'rgba(10,6,3,0.42)');
  c.fillStyle = g; c.fillRect(0, 0, UW, UH);
  const v = c.createRadialGradient(CX - 6, CY - 8, RY * 0.55, CX, CY, RY * 1.05);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(8,5,3,0.55)');
  c.fillStyle = v; c.fillRect(0, 0, UW, UH);
  const r = rand(seed ^ 0x5eed);
  for (let i = 0; i < 260; i++) { c.fillStyle = r() < 0.5 ? 'rgba(255,240,210,0.05)' : 'rgba(20,10,4,0.07)'; c.fillRect(r() * UW, r() * UH, 0.6 + r() * 0.8, 0.5); }
}

function bezel(c: C, dead: boolean) {
  // the brass oval: a bright lip toward the lamp, a dark one away from it
  const ring = c.createLinearGradient(8, 4, 92, 121);
  ring.addColorStop(0, '#fbedc8'); ring.addColorStop(0.25, '#dcb46c'); ring.addColorStop(0.6, '#a87a35'); ring.addColorStop(1, '#3a2810');
  ell(c, CX, CY, RX + 1.6, RY + 1.6); c.strokeStyle = 'rgba(7,5,3,0.9)'; c.lineWidth = 4.6; c.stroke();
  ell(c, CX, CY, RX + 1.2, RY + 1.2); c.strokeStyle = ring; c.lineWidth = 3; c.stroke();
  ell(c, CX, CY, RX - 0.6, RY - 0.6); c.strokeStyle = 'rgba(20,12,4,0.75)'; c.lineWidth = 0.8; c.stroke();
  ell(c, CX, CY, RX + 2.4, RY + 2.4); c.strokeStyle = 'rgba(255,240,200,0.25)'; c.lineWidth = 0.4; c.stroke();
  if (dead) {
    // a black mourning sash across the lower right of the frame
    c.save();
    c.beginPath(); c.moveTo(58, UH + 2); c.lineTo(UW + 2, 76); c.lineTo(UW + 2, 90); c.lineTo(72, UH + 2); c.closePath();
    const sg = c.createLinearGradient(60, 90, 90, 120); sg.addColorStop(0, '#2a2622'); sg.addColorStop(0.5, '#0d0b0a'); sg.addColorStop(1, '#1c1916');
    c.fillStyle = sg; c.fill();
    c.strokeStyle = 'rgba(160,140,110,0.35)'; c.lineWidth = 0.5; c.stroke();
    c.restore();
  }
}

/** Paint a portrait into a box of a context (the share card and the Saga image draw it straight in). */
export function drawPortrait(c: C, spec: PortraitSpec, x: number, y: number, w: number, h: number) {
  const L = lookOf(spec);
  const seed = strHash(`${spec.name}|${spec.color}`);
  const scars = new Set((spec.scars ?? []).filter(s => s === 'burned' || s === 'haunted' || s === 'grudge' || s === 'skeleton'));
  c.save();
  c.translate(x, y);
  c.scale(w / UW, h / UH);
  c.save();
  ell(c, CX, CY, RX, RY); c.clip();
  ground(c, spec, seed);
  // the sitter fills the oval: head and shoulders, cropped at the breast
  c.save(); c.translate(CX, 66); c.rotate(L.tilt); c.scale(1.2, 1.2); c.translate(-CX, -62);
  const hairCol = L.age === 2 ? mix(L.hair, WHITE, 0.72) : L.hair;
  hairBack(c, L, hairCol);
  coat(c, spec, L);
  face(c, L, spec);
  features(c, L, spec, scars);
  hairTop(c, L, hairCol, spec);
  marks(c, L, spec, scars, seed);
  if (spec.legend) laurel(c);
  c.restore();
  varnish(c, seed);
  c.restore();
  bezel(c, !!spec.dead);
  c.restore();
}

// ------------------------------------------------------------------ baked and cached
const cache = new Map<string, string>();
const keyOf = (s: PortraitSpec) => [s.name, s.color, [...(s.scars ?? [])].sort().join('+'), s.maimed ? 1 : 0, s.legend ? 1 : 0, s.rank ?? 1, s.grey ? 1 : 0, s.dead ? 1 : 0, s.persona ?? ''].join('|');

/** The portrait as a data URL at a CSS size (baked at up to 2x for the screen's density). */
export function portraitUrl(spec: PortraitSpec, cssW: number): string {
  const dpr = Math.min(2, Math.max(1, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1));
  const w = Math.round(cssW * dpr), h = Math.round(w * UH / UW);
  const k = `${keyOf(spec)}@${w}`;
  let u = cache.get(k);
  if (u) return u;
  const cv = canvas(w, h);
  const c = cv.getContext('2d');
  if (!c) return '';
  drawPortrait(c, spec, 0, 0, w, h);
  try { u = cv.toDataURL('image/png'); } catch { u = ''; }
  if (cache.size > 160) cache.delete(cache.keys().next().value!);
  cache.set(k, u);
  return u;
}

/** What the portrait shows, in words (its alt text and tooltip): every mark says where it came from. */
export function portraitCaption(spec: PortraitSpec, scarNames: Record<string, { name: string }> = {}): string {
  const bits: string[] = [];
  for (const s of spec.scars ?? []) bits.push(scarNames[s]?.name ?? s);
  if (spec.maimed) bits.push('lost an eye after two routs');
  if (spec.legend) bits.push('the Legend’s laurel');
  if (spec.grey) bits.push('grey in long service');
  if (spec.dead) bits.push('fallen');
  return `${spec.name}${bits.length ? `: ${bits.join(', ')}` : ''}`;
}

/** An <img> of the portrait (decorative alt when a caption sits beside it). */
export function portraitImg(spec: PortraitSpec, cssW: number, cls = 'portrait', alt?: string): string {
  const u = portraitUrl(spec, cssW);
  const h = Math.round(cssW * UH / UW);
  const a = (alt ?? portraitCaption(spec)).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return u ? `<img class="${cls}" src="${u}" width="${cssW}" height="${h}" alt="${a}" draggable="false">` : '';
}
export const PORTRAIT_ASPECT = UH / UW;
