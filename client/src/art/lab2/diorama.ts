// Direction B, "Painted diorama": the whole table is hand-painted like a miniature-wargame space board, by the
// same hand as the minis (the game's own painted sculpts, unchanged). A stylised nebula of visible brush strokes in a
// LIMITED VALUE RANGE (all of it between Y 0.006 and 0.05); stars as painted spheres with one rim light from the
// lamp and a short painted halo, never bloom, lens crosses or flares; tokens as painted wooden pieces.
// Readability comes from value: the ground is uniformly deep, every mark is a light ivory/gold/enamel shape on a dark
// painted underlay (the way a painter "knocks back" what is behind a focal point).
import { OUTLINE, type House, type StarKind } from './board.ts';
import { type View, TAU, cv, fbm, rng, blitMip, chevron, spaced, textW, bandHatch, HATCH, texPattern, polyPath, stylizedShip, blitShip, rgb, mix, css, type RGB } from './kit.ts';
import { type Style, objR, contestR, markSz, orbitOf } from './render.ts';
import { drawIcon } from '../icons.ts';

type G = CanvasRenderingContext2D;
const IVORY = '#efe5cf', GOLD = '#f1d488', GOLD_D = '#a87a35', UNDER = 'rgba(8,6,4,0.82)';
const HI: Record<House, string> = { azure: '#8dbfe6', crimson: '#ec8378', gilded: '#f3d27a', warden: '#b9a3e6' };
/** The house colour for MARKS on the dark (pieces, routes, flags): `hi` lifted toward ivory so all four hold 4.5:1. */
const MK: Record<House, string> = { azure: '#a6cdec', crimson: '#f4a294', gilded: '#f6dc92', warden: '#cbb9ee' };
const BASE: Record<House, string> = { azure: '#2f6ea6', crimson: '#a3303a', gilded: '#c79a2c', warden: '#6e58a0' };
const LO: Record<House, string> = { azure: '#163556', crimson: '#4f1117', gilded: '#5e4410', warden: '#2b2046' };
const B = { x0: -3800, y0: -2500, x1: 3800, y1: 2500 };

// ------------------------------------------------------------------ the painted sky (baked once)
const BK = 0.3;
let bake: HTMLCanvasElement | null = null;
/** A field of directional brush strokes. Colour from a few pigments by nebula density, direction from a flow field,
 *  all of it inside a narrow dark value band so nothing in the sky competes with a piece or a name. */
function skyBake(): HTMLCanvasElement {
  if (bake) return bake;
  const W = Math.ceil((B.x1 - B.x0) * BK), H = Math.ceil((B.y1 - B.y0) * BK);
  const c = cv(W, H), g = c.getContext('2d')!;
  g.fillStyle = '#0d1119'; g.fillRect(0, 0, W, H);
  const P: RGB[] = [[13, 18, 29], [22, 46, 50], [52, 34, 28], [54, 22, 32], [30, 28, 52], [66, 48, 34], [84, 62, 40]];
  const r = rng(1234);
  // one bristled stroke stamp per size, tinted at draw time through a small palette cache
  const stamp = (len: number, wid: number) => {
    const s = cv(len + 4, wid + 4), sg = s.getContext('2d')!;
    for (let k = 0; k < 7; k++) {
      const off = (k / 6 - 0.5) * wid * 0.8, a = 0.25 + r() * 0.5;
      sg.strokeStyle = `rgba(255,255,255,${a})`; sg.lineWidth = wid * (0.18 + r() * 0.2); sg.lineCap = 'round';
      sg.beginPath(); sg.moveTo(2 + r() * len * 0.1, wid / 2 + 2 + off); sg.quadraticCurveTo(len / 2, wid / 2 + 2 + off + (r() - 0.5) * wid * 0.4, len + 2 - r() * len * 0.15, wid / 2 + 2 + off * 0.6); sg.stroke();
    }
    return s;
  };
  const stamps = [stamp(60, 20), stamp(38, 13), stamp(22, 8)];
  const tint = cv(72, 72), tg = tint.getContext('2d')!;
  const N = 52000;
  for (let i = 0; i < N; i++) {
    const layer = i < N * 0.45 ? 0 : i < N * 0.8 ? 1 : 2;
    const x = r() * W, y = r() * H;
    const wx = B.x0 + x / BK, wy = B.y0 + y / BK;
    const d = fbm(wx * 0.0009 + 3, wy * 0.0009 - 2, 4, 21);
    const d2 = fbm(wx * 0.0021, wy * 0.0021, 3, 5);
    const ang = fbm(wx * 0.0006 + 9, wy * 0.0006, 3, 77) * TAU * 2.2;
    // pigment by density: deep blue-black in the voids, verdigris and oxblood in the gas, warm umber at the cores
    let col: RGB;
    if (d < 0.46) col = mix(P[0], P[4], d2 * 0.6);
    else if (d < 0.56) col = mix(d2 > 0.5 ? P[1] : P[3], P[0], 0.3);
    else col = mix(d2 > 0.52 ? P[2] : P[3], P[5], Math.min(1, (d - 0.56) * 4));
    if (layer === 2 && d > 0.6 && d2 > 0.55) col = mix(col, P[6], 0.6);
    // the middle of the table stays the quietest (nebula gathers to the rim, as in the game)
    const rim = Math.min(1, Math.hypot(wx / 1500, wy / 1000));
    col = mix(P[0], col, 0.45 + 0.55 * rim);
    const s = stamps[layer];
    tg.clearRect(0, 0, 72, 72); tg.globalCompositeOperation = 'source-over'; tg.drawImage(s, 0, 0);
    tg.globalCompositeOperation = 'source-in'; tg.fillStyle = css(col); tg.fillRect(0, 0, 72, 72);
    g.save(); g.translate(x, y); g.rotate(ang); g.globalAlpha = layer === 0 ? 0.55 : layer === 1 ? 0.6 : 0.62;
    g.drawImage(tint, 0, 0, s.width, s.height, -s.width / 2, -s.height / 2, s.width, s.height);
    g.restore();
  }
  // distant stars: small painted dabs, muted, few
  for (let i = 0; i < 1400; i++) {
    const x = r() * W, y = r() * H, m = r() ** 3;
    g.fillStyle = m > 0.5 ? 'rgba(230,214,180,0.55)' : 'rgba(170,170,190,0.35)';
    g.beginPath(); g.ellipse(x, y, 0.5 + m * 1.2, 0.4 + m * 0.9, r() * 3, 0, TAU); g.fill();
  }
  bake = c;
  return c;
}

function under(g: G, w: number) { g.lineJoin = 'round'; g.lineCap = 'round'; g.lineWidth = w; g.strokeStyle = UNDER; }
/** A painted sphere lit by the lamp (upper left): body gradient, a soft rim of bounce light lower right, a dab of
 *  specular. `halo` is a short painted aura (alpha, radius multiple) — not bloom. */
function sphere(g: G, x: number, y: number, r: number, hi: string, mid: string, lo: string, halo: [string, number, number] | null, rimCol = 'rgba(255,220,180,0.35)') {
  if (halo) {
    const hg = g.createRadialGradient(x, y, r * 0.8, x, y, r * halo[2]);
    hg.addColorStop(0, halo[0].replace('A', String(halo[1]))); hg.addColorStop(1, halo[0].replace('A', '0'));
    g.fillStyle = hg; g.beginPath(); g.arc(x, y, r * halo[2], 0, TAU); g.fill();
  }
  g.beginPath(); g.arc(x + r * 0.12, y + r * 0.2, r * 1.04, 0, TAU); g.fillStyle = 'rgba(0,0,0,0.45)'; g.fill();
  const sg = g.createRadialGradient(x - r * 0.38, y - r * 0.42, r * 0.05, x, y, r);
  sg.addColorStop(0, hi); sg.addColorStop(0.5, mid); sg.addColorStop(1, lo);
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.fillStyle = sg; g.fill();
  g.save(); g.clip();
  g.beginPath(); g.arc(x - r * 0.25, y - r * 0.3, r * 1.05, 0, TAU); g.lineWidth = r * 0.22; g.strokeStyle = rimCol; g.stroke();
  g.restore();
  g.beginPath(); g.ellipse(x - r * 0.36, y - r * 0.42, r * 0.22, r * 0.13, -0.6, 0, TAU); g.fillStyle = 'rgba(255,250,235,0.55)'; g.fill();
}
/** A tapered painted stroke from a to b (for beams, petals, glints). */
function taper(g: G, x0: number, y0: number, x1: number, y1: number, w: number, col: string) {
  const a = Math.atan2(y1 - y0, x1 - x0), L = Math.hypot(x1 - x0, y1 - y0);
  g.save(); g.translate(x0, y0); g.rotate(a);
  g.beginPath(); g.moveTo(0, -w / 2); g.quadraticCurveTo(L * 0.5, -w * 0.4, L, 0); g.quadraticCurveTo(L * 0.5, w * 0.4, 0, w / 2); g.closePath();
  g.fillStyle = col; g.fill(); g.restore();
}

export const diorama: Style = {
  id: 'B', name: 'Painted diorama', tagline: 'a hand-painted miniature-wargame space board, one brush for sky, stars and pieces',

  ground(g, v) {
    g.fillStyle = '#0b0e15'; g.fillRect(0, 0, v.w, v.h);
    blitMip(g, skyBake(), v.sx(B.x0), v.sy(B.y0), (B.x1 - B.x0) * v.z, (B.y1 - B.y0) * v.z, v.dpr);
    // canvas tooth at screen scale: the board is a painted panel
    const felt = texPattern(g, 'felt.webp');
    if (felt) { g.save(); g.globalAlpha = 0.16; g.globalCompositeOperation = 'soft-light'; g.fillStyle = felt; g.translate(v.sx(0) % 512, v.sy(0) % 512); g.fillRect(-512, -512, v.w + 1024, v.h + 1024); g.restore(); }
    // the board's painted edge: beyond the outline the paint thins to the dark table
    g.save();
    const ob = new Path2D(); ob.rect(0, 0, v.w, v.h); polyPath(ob, OUTLINE, v);
    g.clip(ob, 'evenodd');
    g.fillStyle = 'rgba(5,6,10,0.55)'; g.fillRect(0, 0, v.w, v.h);
    g.restore();
    g.beginPath(); polyPath(g, OUTLINE, v); g.lineWidth = 1.2; g.strokeStyle = 'rgba(200,170,120,0.22)'; g.stroke();
  },

  territory(g, v, h, path) {
    // a translucent glaze in the house colour, a dry-brushed band along the border whose stroke DIRECTION is the
    // colour-blind cue (the hatch angle), and a confidently painted border with a lamp-side highlight
    g.save(); g.clip(path);
    g.globalAlpha = 0.2; g.fillStyle = BASE[h]; g.fill(path);
    const band = Math.max(8, Math.min(24, 75 * v.z));
    g.globalAlpha = 0.22; g.lineWidth = band * 2; g.lineJoin = 'round'; g.strokeStyle = BASE[h]; g.stroke(path);
    g.restore();
    const H = HATCH[h];
    bandHatch(g, v, path, band * 1.2, H.a, H.cross, HI[h] + (H.cross ? '22' : '30'), 2.2, H.cross ? 9 : 7, [10, 4, 6, 5, 14, 4]);
    g.save(); g.clip(path);
    g.lineJoin = 'round';
    g.lineWidth = 5; g.strokeStyle = 'rgba(6,5,4,0.6)'; g.stroke(path);
    // the border painted in two loaded strokes of uneven pressure, so it reads as brushwork, not a vector line
    g.lineWidth = 2.4; g.strokeStyle = HI[h]; g.globalAlpha = 0.9; g.stroke(path);
    g.setLineDash([46, 7, 28, 5, 60, 9]); g.lineWidth = 4; g.globalAlpha = 0.45; g.stroke(path);
    g.setLineDash([18, 30, 9, 22]); g.lineDashOffset = 13; g.lineWidth = 1.2; g.strokeStyle = '#fff3dc'; g.globalAlpha = 0.5; g.stroke(path);
    g.setLineDash([]); g.lineDashOffset = 0;
    g.restore();
  },

  lane(g, v, a, b, lit, fog) {
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineCap = 'round';
    if (fog) g.setLineDash([3, 4]);
    if (lit > 0) { const k = 1 - 0.35 * v.W.s; under(g, 5.6 * k); g.stroke(); g.lineWidth = (2.3 + lit * 1.0) * k; g.strokeStyle = lit >= 1 ? GOLD : '#e6d6b4'; g.stroke(); }
    else { g.lineWidth = 1; g.strokeStyle = 'rgba(214,190,150,0.26)'; g.stroke(); }
    g.setLineDash([]);
  },
  waypoint(g, _v, x, y, lit) {
    g.save(); g.globalAlpha *= Math.min(1, lit * 1.6);
    g.beginPath(); g.arc(x, y, 3, 0, TAU); g.fillStyle = UNDER; g.fill();
    g.beginPath(); g.arc(x, y, 1.8, 0, TAU); g.fillStyle = IVORY; g.fill();
    g.restore();
  },

  bodies(g, _v, s, x, y, R, alpha) {
    g.save(); g.globalAlpha *= alpha;
    s.bodies.forEach((b, i) => {
      const o = orbitOf(i, R, s.id);
      g.beginPath(); g.ellipse(x, y, o.rx, o.ry, 0, 0, TAU); g.lineWidth = 1; g.strokeStyle = 'rgba(220,200,160,0.22)'; g.stroke();
      if (b === 'belt') {
        const r = rng(s.id * 7 + i);
        for (let k = 0; k < 60; k++) { const a = r() * TAU, j = 1 + (r() - 0.5) * 0.14; g.fillStyle = r() > 0.5 ? '#8a7a66' : '#5d5246'; g.beginPath(); g.arc(x + Math.cos(a) * o.rx * j, y + Math.sin(a) * o.ry * j, 0.7 + r() * 1.1, 0, TAU); g.fill(); }
        return;
      }
      const px = x + Math.cos(o.a) * o.rx, py = y + Math.sin(o.a) * o.ry;
      const pr = Math.max(2.5, R * (b === 'gas' ? 0.42 : b === 'station' ? 0.24 : 0.3));
      if (b === 'station') { g.save(); g.translate(px, py); g.rotate(0.5); g.fillStyle = '#8a8f99'; g.fillRect(-pr, -pr * 0.5, pr * 2, pr); g.fillStyle = '#c8b27a'; g.fillRect(-pr * 0.3, -pr, pr * 0.6, pr * 2); g.restore(); return; }
      const C: Record<string, [string, string, string]> = { gas: ['#f0d6a0', '#b98a52', '#3a2614'], ice: ['#e8f2f6', '#8fb0c4', '#1f3240'], lava: ['#ffb070', '#a8402a', '#2a0c08'], rock: ['#d6c6a8', '#8a7a62', '#2a221a'] };
      const c = C[b] ?? C.rock;
      sphere(g, px, py, pr, c[0], c[1], c[2], null);
      if (b === 'gas') { g.beginPath(); g.ellipse(px, py, pr * 1.7, pr * 0.42, -0.3, 0, TAU); g.lineWidth = 1.4; g.strokeStyle = 'rgba(240,220,180,0.6)'; g.stroke(); }
    });
    g.restore();
  },

  star(g, _v, kind, x, y, R, fog, seed) {
    if (fog) { sphere(g, x, y, R * 0.6, '#c9c6c0', '#7d7a76', '#2a2a2e', null, 'rgba(200,200,210,0.2)'); return; }
    const halo = (c: string, a: number, k: number): [string, number, number] => [c, a, k];
    switch (kind) {
      case 'yellow': sphere(g, x, y, R * 0.68, '#fff4c8', '#f2b54a', '#8a4a12', halo('rgba(255,190,90,A)', 0.28, 1.75)); break;
      case 'red': sphere(g, x, y, R * 0.8, '#ffd8bc', '#f07a52', '#8a2a18', halo('rgba(230,80,50,A)', 0.22, 1.55));
        for (let i = 0; i < 5; i++) { const a = seed + i * 1.3; taper(g, x + Math.cos(a) * R * 0.2, y + Math.sin(a) * R * 0.2, x + Math.cos(a) * R * 0.6, y + Math.sin(a) * R * 0.5, R * 0.18, 'rgba(110,20,14,0.35)'); }
        break;
      case 'blue': sphere(g, x, y, R * 0.52, '#ffffff', '#a8c8ff', '#2a4c9a', halo('rgba(140,180,255,A)', 0.3, 1.9));
        for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.3; taper(g, x + Math.cos(a) * R * 0.5, y + Math.sin(a) * R * 0.5, x + Math.cos(a) * R * 1.05, y + Math.sin(a) * R * 1.05, R * 0.14, 'rgba(220,235,255,0.55)'); }
        break;
      case 'white': sphere(g, x, y, R * 0.58, '#ffffff', '#e2e4ea', '#5a6070', halo('rgba(230,230,240,A)', 0.22, 1.7)); break;
      case 'binary': {
        g.beginPath(); g.ellipse(x, y, R * 0.95, R * 0.45, -0.5, 0, TAU); g.lineWidth = R * 0.12; g.strokeStyle = 'rgba(255,200,130,0.25)'; g.stroke();
        sphere(g, x - R * 0.3, y + R * 0.16, R * 0.46, '#fff2c0', '#f0a848', '#7a3e10', halo('rgba(255,180,90,A)', 0.22, 1.7));
        sphere(g, x + R * 0.38, y - R * 0.22, R * 0.3, '#ffffff', '#b2ccff', '#2e4c90', null); break;
      }
      case 'pulsar': {
        for (const s of [-1, 1]) taper(g, x + s * R * 0.2, y - s * R * 0.2, x + s * R * 1.2, y - s * R * 1.2, R * 0.3, 'rgba(200,215,255,0.5)');
        g.beginPath(); g.arc(x, y, R * 0.75, 0, TAU); g.lineWidth = R * 0.08; g.strokeStyle = 'rgba(180,170,255,0.35)'; g.stroke();
        sphere(g, x, y, R * 0.34, '#ffffff', '#d8e4ff', '#5a6aa8', halo('rgba(190,180,255,A)', 0.3, 2.2)); break;
      }
      case 'blackhole': {
        const ring = (a0: number, a1: number) => { g.beginPath(); g.ellipse(x, y, R * 1.05, R * 0.36, -0.3, a0, a1); g.lineWidth = R * 0.24; g.strokeStyle = '#e07a34'; g.stroke(); g.lineWidth = R * 0.08; g.strokeStyle = '#ffd59a'; g.stroke(); };
        ring(Math.PI, TAU);
        sphere(g, x, y, R * 0.5, '#3a3036', '#0c0a0e', '#000000', null, 'rgba(255,160,90,0.55)');
        ring(0, Math.PI);
        break;
      }
      case 'throne': {
        for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; taper(g, x + Math.cos(a) * R * 0.55, y + Math.sin(a) * R * 0.55, x + Math.cos(a) * R * (i % 2 ? 0.95 : 1.15), y + Math.sin(a) * R * (i % 2 ? 0.95 : 1.15), R * 0.22, 'rgba(255,214,130,0.7)'); }
        sphere(g, x, y, R * 0.7, '#fff6d0', '#f0c050', '#8a5a14', halo('rgba(255,200,100,A)', 0.25, 1.6));
        drawIcon(g, 'crown', x, y + R * 0.02, R * 0.62, 'rgba(90,50,8,0.9)'); break;
      }
    }
  },

  objective(g, _v, x, y, R, throne, fog) {
    const rr = objR(R, throne);
    const ring = (r: number, w: number) => {
      g.beginPath(); g.arc(x, y, r, 0, TAU); under(g, w + 3); g.stroke();
      const gr = g.createLinearGradient(x - r, y - r, x + r, y + r); gr.addColorStop(0, fog ? '#c8c4bc' : '#fbe2a0'); gr.addColorStop(0.5, fog ? '#a8a49c' : '#e2b452'); gr.addColorStop(1, fog ? '#9a968e' : '#ddb058');
      g.lineWidth = w; g.strokeStyle = gr; g.stroke();
    };
    ring(rr, throne ? 2.8 : 2.5);
    if (throne) ring(rr + 4.5, 1.5);
    const cs = Math.max(9, R * (throne ? 0.8 : 0.65));
    drawIcon(g, 'crown', x, y - rr - (throne ? 4.5 : 0) - 1, cs, fog ? '#b8b4ac' : GOLD, { halo: UNDER, haloWidth: 2.2 });
  },
  contested(g, _v, x, y, R, holder, kingly) {
    const rc = contestR(R, kingly);
    g.beginPath(); g.arc(x, y, rc, 0, TAU); g.setLineDash([5, 3.5]); under(g, 4.4); g.lineCap = 'butt'; g.stroke();
    g.lineWidth = 2.4; g.strokeStyle = holder ? MK[holder] : '#d8d8dc'; g.stroke(); g.setLineDash([]);
  },
  occupied(g, _v, x, y, R, by) {
    const s = markSz(R), px = x + R * 1.25, py = y + R * 0.95;
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.beginPath(); g.ellipse(px - s * 0.25, py + s * 0.55, s * 0.35, s * 0.12, 0, 0, TAU); g.fill();
    g.beginPath(); g.moveTo(px - s * 0.35, py + s * 0.5); g.lineTo(px - s * 0.35, py - s * 0.55); under(g, 3); g.stroke(); g.lineWidth = 1.4; g.strokeStyle = '#d8c08a'; g.stroke();
    g.beginPath(); g.moveTo(px - s * 0.35, py - s * 0.55); g.quadraticCurveTo(px + s * 0.1, py - s * 0.45, px + s * 0.55, py - s * 0.3); g.lineTo(px - s * 0.35, py - s * 0.02); g.closePath();
    under(g, 2.6); g.stroke(); g.fillStyle = MK[by]; g.fill();
  },
  tribute(g, _v, x, y, R, to) {
    const s = markSz(R), px = x - R * 1.25, py = y + R * 0.95;
    sphere(g, px, py, s * 0.55, '#f6e2a8', '#b8862e', '#4a3008', null);
    drawIcon(g, 'scales', px, py, s * 0.72, '#2a1a06');
    g.beginPath(); g.arc(px, py, s * 0.55 + 1.4, 0, TAU); g.lineWidth = 1.6; g.strokeStyle = HI[to]; g.stroke();
  },

  label(g, _v, text, x, y, fs, kind, owner, fog) {
    const kingly = kind === 'throne' || kind === 'crown';
    g.font = `700 ${fs}px Cinzel, serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    const tr = fs * 0.11;
    // a soft painted dark underlay (the painter knocking back the sky behind the lettering), then a crisp edge
    g.save(); g.shadowColor = 'rgba(4,3,2,0.95)'; g.shadowBlur = fs * 0.7; g.fillStyle = 'rgba(4,3,2,0.9)'; spaced(g, text, x, y, tr); g.restore();
    under(g, 3); spaced(g, text, x, y, tr, 'stroke');
    g.fillStyle = fog ? '#b9b5ac' : kingly ? GOLD : owner ? mixHi(HI[owner]) : IVORY;
    spaced(g, text, x, y, tr);
    return textW(g, text, tr);
  },
  empireName(g, _v, text, x, y, fs, h) {
    g.font = `700 ${fs}px Cinzel, serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.save(); g.shadowColor = 'rgba(4,3,2,0.9)'; g.shadowBlur = fs * 0.5; g.fillStyle = 'rgba(4,3,2,0.8)'; spaced(g, text, x, y, fs * 0.35); g.restore();
    g.fillStyle = HI[h]; spaced(g, text, x, y, fs * 0.35);
  },
  garrison(g, _v, n, x, y, fs) {
    const t = String(n);
    g.font = `800 ${fs}px "Alegreya Sans", sans-serif`; g.textAlign = 'left'; g.textBaseline = 'middle';
    const w = g.measureText(t).width + fs * 0.85, x0 = x - w / 2;
    under(g, 3); g.strokeText(t, x0 + fs * 0.85, y);
    drawIcon(g, 'garrison', x0 + fs * 0.35, y, fs * 0.85, '#d8c8a8', { halo: UNDER, haloWidth: 1.6 });
    g.fillStyle = IVORY; g.fillText(t, x0 + fs * 0.85, y + 0.5);
    return w;
  },

  route(g, _v, pts, h, seize) {
    const path = () => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); };
    path(); under(g, 5.6); g.stroke();
    path(); g.setLineDash([8, 5]); g.lineCap = 'round'; g.lineWidth = 2.8; g.strokeStyle = MK[h]; g.stroke(); g.setLineDash([]);
    const a = pts[pts.length - 2], b = pts[pts.length - 1], ang = Math.atan2(b.y - a.y, b.x - a.x);
    g.save(); g.translate(b.x, b.y); g.rotate(ang);
    g.beginPath(); g.moveTo(3, 0); g.lineTo(-9, -6.5); g.lineTo(seize ? -5.5 : -6.5, 0); g.lineTo(-9, 6.5); g.closePath();
    under(g, 3); g.stroke(); g.fillStyle = MK[h]; g.fill();
    g.restore();
  },
  reticle(g, _v, x, y, R, h) {
    const draw = () => { g.beginPath(); g.arc(x, y, R, 0, TAU); for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; g.moveTo(x + Math.cos(a) * (R - 5), y + Math.sin(a) * (R - 5)); g.lineTo(x + Math.cos(a) * (R + 3), y + Math.sin(a) * (R + 3)); } };
    draw(); under(g, 5.4); g.stroke(); draw(); g.lineWidth = 2.4; g.strokeStyle = MK[h]; g.stroke();
  },
  tether(g, _v, x0, y0, x1, y1, h) {
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); under(g, 3); g.stroke(); g.lineWidth = 1.3; g.strokeStyle = HI[h]; g.stroke();
  },

  pip(g, _v, x, y, ang, r, h, sel) {
    g.save(); g.translate(x, y); g.rotate(ang);
    chevron(g, r * 1.3);
    g.lineJoin = 'round'; g.lineWidth = sel ? 4.2 : 3.8; g.strokeStyle = sel ? GOLD : UNDER; g.stroke();
    const eg = g.createLinearGradient(-r, -r, r, r); eg.addColorStop(0, '#fbf3e2'); eg.addColorStop(0.35, MK[h]); eg.addColorStop(1, MK[h]);
    g.fillStyle = eg; g.fill();
    g.lineWidth = 1; g.strokeStyle = 'rgba(255,245,225,0.55)'; g.beginPath(); g.moveTo(r * 1.3, 0); g.lineTo(-r * 0.8 * 1.3, -r * 0.82 * 1.3); g.stroke();
    g.restore();
  },
  counter(g, _v, x, y, ang, r, h, sel) {
    // a painted wooden disc: a thickness, a lit top face, a painted chevron, a cast shadow down-right
    const R = r, t = Math.max(2, r * 0.22);
    g.save(); g.translate(x, y);
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.beginPath(); g.ellipse(2.4, t + 2.6, R + 1, R * 0.96, 0, 0, TAU); g.fill();
    g.beginPath(); g.arc(0, t, R, 0, TAU); g.fillStyle = css(mix(rgb(LO[h]), [0, 0, 0], 0.3)); g.fill();
    g.fillRect(-R, 0, R * 2, t);
    const fg = g.createRadialGradient(-R * 0.35, -R * 0.4, R * 0.1, 0, 0, R * 1.05);
    fg.addColorStop(0, HI[h]); fg.addColorStop(0.55, BASE[h]); fg.addColorStop(1, LO[h]);
    g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fillStyle = fg; g.fill();
    g.lineWidth = 1.6; g.strokeStyle = 'rgba(6,5,4,0.85)'; g.stroke();
    g.beginPath(); g.arc(0, 0, R - 1.2, Math.PI * 1.05, Math.PI * 1.65); g.lineWidth = 1.2; g.strokeStyle = 'rgba(255,245,225,0.6)'; g.stroke();
    g.save(); g.rotate(ang); chevron(g, R * 0.58); g.lineWidth = 2; g.strokeStyle = 'rgba(6,5,4,0.6)'; g.stroke(); g.fillStyle = IVORY; g.fill(); g.restore();
    if (sel) { g.beginPath(); g.arc(0, 0, R + 3.6, 0, TAU); under(g, 4.4); g.stroke(); g.lineWidth = 2.2; g.strokeStyle = GOLD; g.stroke(); }
    g.restore();
  },
  mini(g, v, x, y, ang, r, h, ships, sel) {
    // the game's painted sculpts, unchanged, on a painted base: dark slate top, house-colour rim, cast shadow
    const by = y + r * 0.35;
    g.save();
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.beginPath(); g.ellipse(x + 5, by + 6, r * 1.05, r * 0.46, 0, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(x, by + 3, r, r * 0.44, 0, 0, TAU); g.fillStyle = LO[h]; g.fill();
    g.beginPath(); g.ellipse(x, by, r, r * 0.44, 0, 0, TAU);
    const bg = g.createLinearGradient(x - r, by - r * 0.4, x + r, by + r * 0.4); bg.addColorStop(0, '#4a4e58'); bg.addColorStop(1, '#16181e');
    g.fillStyle = bg; g.fill();
    g.lineWidth = Math.max(2, r * 0.13); g.strokeStyle = BASE[h]; g.stroke();
    g.beginPath(); g.ellipse(x, by, r, r * 0.44, 0, Math.PI * 1.05, Math.PI * 1.6); g.lineWidth = 1.3; g.strokeStyle = HI[h]; g.stroke();
    if (sel) { g.beginPath(); g.ellipse(x, by, r * 1.2, r * 0.56, 0, 0, TAU); under(g, 4.4); g.stroke(); g.lineWidth = 2.2; g.strokeStyle = GOLD; g.stroke(); }
    const n = Math.min(3, ships.length), len = r * 1.45;
    for (let i = n - 1; i >= 0; i--) {
      const ox = (i === 0 ? 0 : i === 1 ? -0.6 : 0.6) * r, oy = (i === 0 ? -0.12 : 0.18) * r;
      const L = i === 0 ? len : len * 0.72;
      // the clear stand
      g.fillStyle = 'rgba(200,215,240,0.28)'; g.fillRect(x + ox - 0.8, by - r * 0.62 + oy, 1.6, r * 0.62 - oy);
      // the painter's edge highlight: a fine light line round the silhouette, as on a real mini
      const spr = stylizedShip('B', ships[i], h, L * v.dpr, ang + Math.PI / 2, null, rgb(MK[h]), Math.max(1, Math.round(v.dpr * 0.6)));
      blitShip(g, spr, x + ox, by - r * 0.68 + oy, L, L * v.dpr);
    }
    g.restore();
  },
  stack(g, _v, n, x, y, r, _h) {
    const cx = x + r * 0.95, cy = y + r * 0.95;
    g.beginPath(); g.arc(cx, cy, 7, 0, TAU); g.fillStyle = '#17120d'; g.fill(); g.lineWidth = 1.4; g.strokeStyle = GOLD_D; g.stroke();
    g.font = `800 11px "Alegreya Sans", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = IVORY; g.fillText(String(n), cx, cy + 0.5);
  },
  idle(g, _v, x, y, r, phase) {
    g.save();
    g.beginPath(); g.arc(x, y, r * 1.42, 0, TAU); under(g, 4); g.stroke();
    g.lineWidth = 2.1; g.strokeStyle = '#f4ead4'; g.setLineDash([3.4, 2.8]); g.lineDashOffset = phase * 12; g.stroke(); g.setLineDash([]);
    g.restore();
  },
  oos(g, _v, x, y, r) {
    g.beginPath(); g.arc(x, y, r * 1.3, 0, TAU); g.setLineDash([4, 3]); under(g, 4.4); g.lineCap = 'butt'; g.stroke();
    g.lineWidth = 2.2; g.strokeStyle = '#f0b450'; g.stroke(); g.setLineDash([]);
  },
  strength(g, _v, n, x, y) {
    const t = String(n);
    g.font = `800 13px "Alegreya Sans", sans-serif`; g.textAlign = 'left'; g.textBaseline = 'middle';
    const w = 15 + g.measureText(t).width, x0 = x - w / 2;
    under(g, 3.2); g.strokeText(t, x0 + 15, y + 0.5);
    drawIcon(g, 'attack', x0 + 6, y, 13, GOLD, { halo: UNDER, haloWidth: 1.8 });
    g.fillStyle = IVORY; g.fillText(t, x0 + 15, y + 0.5);
  },
  battle(g, _v, x, y, D) {
    // a painted round shield: oxblood field, a gold rim lit from the lamp, crossed swords in ivory
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.beginPath(); g.arc(x + 2, y + 3, D * 1.1, 0, TAU); g.fill();
    sphere(g, x, y, D, '#d0604a', '#7a1e1c', '#2a0606', null, 'rgba(255,170,120,0.3)');
    g.beginPath(); g.arc(x, y, D, 0, TAU); g.lineWidth = Math.max(1.8, D * 0.18);
    const gr = g.createLinearGradient(x - D, y - D, x + D, y + D); gr.addColorStop(0, '#fff0b8'); gr.addColorStop(0.5, '#d9a442'); gr.addColorStop(1, '#6a4010');
    g.strokeStyle = gr; g.stroke();
    drawIcon(g, 'battle', x, y, D * 1.2, IVORY, { shadow: 'rgba(20,0,0,0.9)' });
  },
  shot(g, _v, a, b, h, k) {
    const px = a.x + (b.x - a.x) * k, py = a.y + (b.y - a.y) * k;
    const tx = a.x + (b.x - a.x) * Math.max(0, k - 0.25), ty = a.y + (b.y - a.y) * Math.max(0, k - 0.25);
    taper(g, px, py, tx, ty, 4, css(rgb(HI[h]), 0.85));
    g.beginPath(); g.arc(px, py, 2.4, 0, TAU); g.fillStyle = '#fff6dc'; g.fill();
    if (k > 0.6) { g.beginPath(); g.arc(b.x, b.y, 5, 0, TAU); g.fillStyle = 'rgba(255,190,110,0.55)'; g.fill(); g.beginPath(); g.arc(b.x, b.y, 2.4, 0, TAU); g.fillStyle = '#fff2c8'; g.fill(); }
  },

  light(g, v) {
    const lx = v.w * 0.42, ly = v.h * 0.32, R = Math.hypot(v.w, v.h);
    const gr = g.createRadialGradient(lx, ly, R * 0.04, lx, ly, R * 0.8);
    gr.addColorStop(0, 'rgba(255,214,150,0.07)'); gr.addColorStop(0.45, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(3,2,1,0.5)');
    g.fillStyle = gr; g.fillRect(0, 0, v.w, v.h);
  },
};
/** Owner names on the dark: the house `hi`, lifted toward ivory so even Crimson holds 4.5:1. */
function mixHi(hex: string) { const c = mix(rgb(hex), [243, 234, 214], 0.3); return css(c); }
void (null as unknown as StarKind);
