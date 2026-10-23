// Direction C, "Enamel and gold orrery": the galaxy as a jewelled instrument on the war table. A deep black-enamel
// dial, engine-turned (guilloché) under the glaze; nebulae as cloisonné fields of deep enamel separated by fine
// bronze wire; lanes as inlaid gold wire; territories as champlevé enamel with the house hatch engraved under the
// glaze (basse-taille); stars as cabochon gems in gold collets, the TYPE told by the stone; pieces as cast metal.
// Value structure: the dial stays between Y 0.004 and 0.06; gold, ivory and polished stones own everything above.
import { OUTLINE, type House, type StarKind } from './board.ts';
import { type View, TAU, cv, fbm, noise, rng, blitMip, chevron, spaced, textW, bandHatch, HATCH, texPattern, polyPath, stylizedShip, blitShip, rgb, mix, css, type RGB } from './kit.ts';
import { type Style, objR, contestR, markSz, orbitOf } from './render.ts';
import { drawIcon } from '../icons.ts';

type G = CanvasRenderingContext2D;
const IVORY = '#f3e8cc', PALE = '#f3e2b0', GROOVE = 'rgba(2,2,4,0.88)';
const HI: Record<House, string> = { azure: '#8fc0ea', crimson: '#f08a7c', gilded: '#f5d47c', warden: '#bea8ec' };
const ENAMEL: Record<House, string> = { azure: '#2f6ea6', crimson: '#a3303a', gilded: '#c79a2c', warden: '#6e58a0' };
const FIELD: Record<House, string> = { azure: '#1d4a7a', crimson: '#6e1a26', gilded: '#6e5214', warden: '#3e2f6a' };
const D = { x0: -1550, y0: -1100, x1: 1550, y1: 1100 };

/** Polished gold, lit from the lamp (upper left): a gradient for a box. Its darkest stop stays at Y ~0.33, so gold
 *  holds 4.5:1 on the dial everywhere it bends away from the light. */
function gold(g: G, x0: number, y0: number, x1: number, y1: number, fog = false) {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  if (fog) { gr.addColorStop(0, '#e0e0e4'); gr.addColorStop(0.5, '#b8b8c0'); gr.addColorStop(1, '#a4a4ac'); return gr; }
  gr.addColorStop(0, '#fff4d0'); gr.addColorStop(0.35, '#f2cc7a'); gr.addColorStop(0.7, '#e2b25c'); gr.addColorStop(1, '#d9aa56');
  return gr;
}

// ------------------------------------------------------------------ the dial (baked once)
const BK = 0.8;
let bake: HTMLCanvasElement | null = null;
function dialBake(): HTMLCanvasElement {
  if (bake) return bake;
  const W = Math.ceil((D.x1 - D.x0) * BK), H = Math.ceil((D.y1 - D.y0) * BK);
  const c = cv(W, H), g = c.getContext('2d')!;
  const img = g.createImageData(W, H), Dd = img.data;
  const lvl = new Uint8Array(W * H);
  const COL: RGB[] = [[10, 11, 16], [16, 20, 44], [13, 36, 40], [40, 14, 22], [44, 30, 16]];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const wx = D.x0 + x / BK, wy = D.y0 + y / BK;
    const d = fbm(wx * 0.0012 + 7, wy * 0.0012 - 3, 4, 31) + (fbm(wx * 0.004, wy * 0.004, 2, 9) - 0.5) * 0.06;
    const rim = Math.min(1, Math.hypot(wx / 1350, wy / 900));
    const dd = d - (1 - rim) * 0.08;
    const k = noise(wx * 0.0016 + 40, wy * 0.0016, 3);
    lvl[y * W + x] = dd < 0.47 ? 0 : dd < 0.53 ? 1 : dd < 0.6 ? (k > 0.5 ? 2 : 3) : (k > 0.45 ? 4 : 3);
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, L = lvl[i];
    let col = COL[L];
    const wx = D.x0 + x / BK, wy = D.y0 + y / BK;
    // the guilloché: an engine-turned wave of fine rings round the Throne, faint under the glaze
    const r = Math.hypot(wx, wy * 1.45), a = Math.atan2(wy * 1.45, wx);
    const wave = Math.sin(r * 0.11 + Math.sin(a * 12) * 2.2);
    if (wave > 0.86) col = mix(col, [70, 58, 40], 0.18);
    // cloisons: a fine bronze wire wherever two enamels meet
    const edge = (x > 0 && lvl[i - 1] !== L) || (y > 0 && lvl[i - W] !== L);
    if (edge) col = mix(col, [120, 92, 46], 0.5);
    const j = i * 4;
    Dd[j] = col[0]; Dd[j + 1] = col[1]; Dd[j + 2] = col[2]; Dd[j + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // tiny set stones: the background stars as pin-head brilliants
  const rr = rng(5);
  for (let i = 0; i < 600; i++) {
    const x = rr() * W, y = rr() * H, m = rr() ** 3;
    g.fillStyle = m > 0.6 ? 'rgba(255,236,190,0.7)' : 'rgba(190,200,230,0.4)';
    g.beginPath(); g.arc(x, y, 0.4 + m * 0.9, 0, TAU); g.fill();
  }
  bake = c;
  return c;
}

/** A cabochon in a gold collet: the stone's dome lit from the lamp, light transmitted to its lower right, a
 *  specular dab; the collet ring is gold (or dark silver when fogged). */
function cabochon(g: G, x: number, y: number, r: number, top: string, mid: string, deep: string, fog = false, collet = true) {
  r = Math.max(2.6, r);
  if (collet) {
    g.beginPath(); g.arc(x + r * 0.1, y + r * 0.16, r * 1.22, 0, TAU); g.fillStyle = 'rgba(0,0,0,0.55)'; g.fill();
    g.beginPath(); g.arc(x, y, r * 1.18 + 1.2, 0, TAU); g.fillStyle = gold(g, x - r, y - r, x + r, y + r, fog); g.fill();
    g.lineWidth = 0.8; g.strokeStyle = 'rgba(40,24,4,0.8)'; g.stroke();
    // a cut groove round the collet: the setting reads against a gold wire or the bezel as well as the dial
    g.beginPath(); g.arc(x, y, r * 1.18 + 2.2, 0, TAU); g.lineWidth = 1.6; g.strokeStyle = GROOVE; g.stroke();
  }
  const sg = g.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.05, x, y, r);
  sg.addColorStop(0, top); sg.addColorStop(0.55, mid); sg.addColorStop(1, deep);
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.fillStyle = sg; g.fill();
  const tg = g.createRadialGradient(x + r * 0.35, y + r * 0.42, 0, x + r * 0.35, y + r * 0.42, r * 0.7);
  tg.addColorStop(0, css(rgb(top), 0.55)); tg.addColorStop(1, css(rgb(top), 0));
  g.save(); g.clip(); g.fillStyle = tg; g.fillRect(x - r, y - r, r * 2, r * 2); g.restore();
  g.beginPath(); g.ellipse(x - r * 0.34, y - r * 0.42, r * 0.28, r * 0.15, -0.6, 0, TAU); g.fillStyle = 'rgba(255,255,255,0.8)'; g.fill();
  g.beginPath(); g.arc(x - r * 0.12, y - r * 0.55, r * 0.06, 0, TAU); g.fill();
}
function groove(g: G, w: number) { g.lineJoin = 'round'; g.lineCap = 'round'; g.lineWidth = w; g.strokeStyle = GROOVE; }
function beads(g: G, x: number, y: number, r: number, n: number, br: number, fill: string | CanvasGradient) {
  g.fillStyle = fill;
  for (let i = 0; i < n; i++) { const a = (i / n) * TAU; g.beginPath(); g.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, br, 0, TAU); g.fill(); }
}

export const orrery: Style = {
  id: 'C', name: 'Enamel and gold orrery', tagline: 'the galaxy as a jewelled instrument: black enamel, gold wire, cabochon stars',

  ground(g, v) {
    // black velvet round the instrument
    g.fillStyle = '#060608'; g.fillRect(0, 0, v.w, v.h);
    const felt = texPattern(g, 'felt.webp');
    if (felt) { g.save(); g.globalAlpha = 0.18; g.globalCompositeOperation = 'soft-light'; g.fillStyle = felt; g.translate(v.sx(0) % 512, v.sy(0) % 512); g.fillRect(-512, -512, v.w + 1024, v.h + 1024); g.restore(); }
    const op = new Path2D(); polyPath(op, OUTLINE, v);
    // the instrument's cast shadow, then the dial inside its bezel
    g.save(); g.shadowColor = 'rgba(0,0,0,0.85)'; g.shadowBlur = 30; g.shadowOffsetX = 8; g.shadowOffsetY = 14; g.fillStyle = '#0a0b10'; g.fill(op); g.restore();
    g.save(); g.clip(op);
    blitMip(g, dialBake(), v.sx(D.x0), v.sy(D.y0), (D.x1 - D.x0) * v.z, (D.y1 - D.y0) * v.z, v.dpr);
    g.restore();
    // the bezel: a polished gold band, milgrain outside, the degree scale engraved round it
    g.lineJoin = 'round';
    g.lineWidth = Math.max(4, 14 * v.z) + 3; g.strokeStyle = '#1a1206'; g.stroke(op);
    g.lineWidth = Math.max(3, 14 * v.z); g.strokeStyle = gold(g, 0, 0, v.w, v.h); g.stroke(op);
    g.lineWidth = 1; g.strokeStyle = 'rgba(60,36,6,0.9)'; g.stroke(op);
    const n = OUTLINE.length;
    g.fillStyle = gold(g, 0, 0, v.w, v.h);
    for (let i = 0; i < n * 4; i++) {
      const p = OUTLINE[Math.floor(i / 4)], q = OUTLINE[(Math.floor(i / 4) + 1) % n], t = (i % 4) / 4;
      const x = v.sx(p.x + (q.x - p.x) * t), y = v.sy(p.y + (q.y - p.y) * t);
      const nx = x - v.sx(0), ny = y - v.sy(0), L = Math.hypot(nx, ny) || 1;
      const o = Math.max(4, 14 * v.z) * 0.5 + 4 + (i % 8 === 0 ? 4 : 0);
      g.beginPath(); g.moveTo(x + nx / L * (o - 3), y + ny / L * (o - 3)); g.lineTo(x + nx / L * (o + (i % 8 === 0 ? 6 : 2)), y + ny / L * (o + (i % 8 === 0 ? 6 : 2)));
      g.lineWidth = i % 8 === 0 ? 1.4 : 0.8; g.strokeStyle = 'rgba(232,190,110,0.75)'; g.stroke();
    }
  },

  territory(g, v, h, path) {
    // champlevé: the field cut down and filled with the house enamel; under the glaze the house hatch is engraved
    // (basse-taille), strongest in a band along the gold wall
    g.save(); g.clip(path);
    g.globalAlpha = 0.62; g.fillStyle = FIELD[h]; g.fill(path);
    g.globalAlpha = 1;
    const sh = g.createLinearGradient(0, 0, v.w, v.h); sh.addColorStop(0, 'rgba(255,255,255,0.05)'); sh.addColorStop(1, 'rgba(0,0,0,0.12)');
    g.fillStyle = sh; g.fill(path);
    g.restore();
    const H = HATCH[h];
    bandHatch(g, v, path, 0, H.a, H.cross, HI[h] + '12', 0.8, 4.5);
    const band = Math.max(7, Math.min(20, 64 * v.z));
    bandHatch(g, v, path, band, H.a, H.cross, HI[h] + (H.cross ? '26' : '34'), 0.9, 4.5);
    // the cloison wall: polished gold wire in a dark groove (inner edge lit from the lamp)
    g.save(); g.clip(path); groove(g, 6); g.stroke(path); g.restore();
    g.lineJoin = 'round';
    g.lineWidth = 2.4; g.strokeStyle = '#b8955a'; g.stroke(path);
    g.lineWidth = 0.8; g.strokeStyle = HI[h]; g.globalAlpha = 0.6; g.stroke(path); g.globalAlpha = 1;
  },

  lane(g, v, a, b, lit, fog) {
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y);
    if (fog) g.setLineDash([2, 4]);
    if (lit > 0) {
      const k = 1 - 0.4 * v.W.s;
      groove(g, 4.6 * k); g.stroke();
      g.lineWidth = (1.6 + lit * 1.1) * k; g.strokeStyle = lit >= 1 ? '#ffe7a8' : '#e6c27a'; g.stroke();
    } else { g.lineWidth = 1; g.strokeStyle = 'rgba(214,170,90,0.36)'; g.stroke(); }
    g.setLineDash([]);
  },
  waypoint(g, _v, x, y, lit) {
    g.save(); g.globalAlpha *= Math.min(1, lit * 1.6);
    g.beginPath(); g.arc(x, y, 3.2, 0, TAU); g.fillStyle = GROOVE; g.fill();
    g.beginPath(); g.arc(x, y, 2.1, 0, TAU); g.fillStyle = gold(g, x - 2, y - 2, x + 2, y + 2); g.fill();
    g.restore();
  },

  bodies(g, _v, s, x, y, R, alpha) {
    g.save(); g.globalAlpha *= alpha;
    s.bodies.forEach((b, i) => {
      const o = orbitOf(i, R, s.id);
      // orrery arms: each orbit an engraved gold track
      g.beginPath(); g.ellipse(x, y, o.rx, o.ry, 0, 0, TAU); g.lineWidth = 2.6; g.strokeStyle = 'rgba(2,2,4,0.6)'; g.stroke(); g.lineWidth = 1; g.strokeStyle = 'rgba(220,180,100,0.55)'; g.stroke();
      if (b === 'belt') {
        const r = rng(s.id * 7 + i);
        for (let k = 0; k < 44; k++) { const a = r() * TAU, j = 1 + (r() - 0.5) * 0.1; g.beginPath(); g.arc(x + Math.cos(a) * o.rx * j, y + Math.sin(a) * o.ry * j, 0.9 + r() * 0.8, 0, TAU); g.fillStyle = r() > 0.5 ? '#c9a45a' : '#8a6a34'; g.fill(); }
        return;
      }
      const px = x + Math.cos(o.a) * o.rx, py = y + Math.sin(o.a) * o.ry;
      const pr = Math.max(2.5, R * (b === 'gas' ? 0.4 : b === 'station' ? 0.24 : 0.28));
      // the arm from the hub to the body
      g.beginPath(); g.moveTo(x, y); g.lineTo(px, py); g.lineWidth = 1; g.strokeStyle = 'rgba(220,180,100,0.35)'; g.stroke();
      if (b === 'station') { g.save(); g.translate(px, py); g.rotate(0.785); g.fillStyle = gold(g, -pr, -pr, pr, pr); g.fillRect(-pr, -pr, pr * 2, pr * 2); g.restore(); return; }
      const C: Record<string, [string, string, string]> = { gas: ['#ffe2b0', '#b07a3a', '#3a2008'], ice: ['#f0fbff', '#8ab8d0', '#1a3444'], lava: ['#ffb08a', '#c03a20', '#3a0804'], rock: ['#e8dcc0', '#8a7a5a', '#2a2014'] };
      const c = C[b] ?? C.rock;
      cabochon(g, px, py, pr, c[0], c[1], c[2], false, true);
    });
    g.restore();
  },

  star(g, _v, kind, x, y, R, fog, _seed) {
    if (fog) { cabochon(g, x, y, R * 0.55, '#c8c8cc', '#6a6a70', '#26262c', true); return; }
    switch (kind) {
      case 'yellow': cabochon(g, x, y, R * 0.62, '#fff2b8', '#e8a420', '#5a2e00'); break;
      case 'red': cabochon(g, x, y, R * 0.74, '#ffc0b0', '#c42a34', '#3a0408'); break;
      case 'blue': cabochon(g, x, y, R * 0.52, '#e4eeff', '#3a6ad0', '#0a1a48'); break;
      case 'white': cabochon(g, x, y, R * 0.56, '#ffffff', '#e2e6f0', '#8a94aa'); break;
      case 'binary': {
        g.beginPath(); g.moveTo(x - R * 0.3, y + R * 0.16); g.lineTo(x + R * 0.38, y - R * 0.2); g.lineWidth = R * 0.3; g.strokeStyle = gold(g, x - R, y - R, x + R, y + R); g.stroke();
        cabochon(g, x - R * 0.3, y + R * 0.16, R * 0.44, '#fff2b8', '#e8a420', '#5a2e00');
        cabochon(g, x + R * 0.4, y - R * 0.22, R * 0.3, '#e4eeff', '#3a6ad0', '#0a1a48'); break;
      }
      case 'pulsar': {
        cabochon(g, x, y, R * 0.5, '#e6eaf8', '#6a78b0', '#1a2048');
        // a star sapphire: the asterism is the pulsar's mark
        g.save(); g.lineCap = 'round'; g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = Math.max(1, R * 0.07);
        for (let i = 0; i < 3; i++) { const a = i * Math.PI / 3 + 0.3; g.beginPath(); g.moveTo(x - Math.cos(a) * R * 0.46, y - Math.sin(a) * R * 0.46); g.lineTo(x + Math.cos(a) * R * 0.46, y + Math.sin(a) * R * 0.46); g.stroke(); }
        g.restore();
        for (const s of [-1, 1]) { g.beginPath(); g.moveTo(x + s * R * 0.62 * 0.7, y - s * R * 0.62 * 0.7); g.lineTo(x + s * R * 1.2 * 0.7, y - s * R * 1.2 * 0.7); groove(g, 3.4); g.stroke(); g.lineWidth = 1.6; g.strokeStyle = gold(g, x - R, y - R, x + R, y + R); g.stroke(); }
        break;
      }
      case 'blackhole': {
        const ring = (a0: number, a1: number) => { g.beginPath(); g.ellipse(x, y, R * 1.05, R * 0.38, -0.3, a0, a1); groove(g, R * 0.26); g.stroke(); g.lineWidth = R * 0.14; g.strokeStyle = gold(g, x - R, y - R, x + R, y + R); g.stroke(); };
        ring(Math.PI, TAU);
        cabochon(g, x, y, R * 0.48, '#5a5a66', '#0c0c10', '#000000');
        ring(0, Math.PI); break;
      }
      case 'throne': {
        // a gold boss: a repoussé sun with the crown struck in it
        g.beginPath(); g.arc(x + R * 0.08, y + R * 0.14, R * 0.86, 0, TAU); g.fillStyle = 'rgba(0,0,0,0.6)'; g.fill();
        g.save(); g.translate(x, y);
        g.beginPath();
        for (let i = 0; i < 32; i++) { const a = (i / 32) * TAU, rr = i % 2 ? R * 0.68 : R * 0.86; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
        g.closePath(); g.fillStyle = gold(g, -R, -R, R, R); g.fill(); g.lineWidth = 0.9; g.strokeStyle = 'rgba(60,36,6,0.9)'; g.stroke();
        const bg = g.createRadialGradient(-R * 0.2, -R * 0.25, R * 0.05, 0, 0, R * 0.58); bg.addColorStop(0, '#fff8de'); bg.addColorStop(0.6, '#e6b45a'); bg.addColorStop(1, '#a87a35');
        g.beginPath(); g.arc(0, 0, R * 0.56, 0, TAU); g.fillStyle = bg; g.fill(); g.strokeStyle = 'rgba(60,36,6,0.9)'; g.stroke();
        g.restore();
        drawIcon(g, 'crown', x, y, R * 0.6, 'rgba(70,40,4,0.92)'); break;
      }
    }
  },

  objective(g, _v, x, y, R, throne, fog) {
    const rr = objR(R, throne);
    const ring = (r: number, w: number) => {
      g.beginPath(); g.arc(x, y, r, 0, TAU); groove(g, w + 3); g.stroke();
      g.lineWidth = w; g.strokeStyle = gold(g, x - r, y - r, x + r, y + r, fog); g.stroke();
    };
    ring(rr, throne ? 2.6 : 2.3);
    beads(g, x, y, rr + 3.2, Math.round(rr * 1.1), 1.25, fog ? '#a8a8b0' : '#fbf3e0');
    if (throne) ring(rr + 6, 1.6);
    const cs = Math.max(9, R * (throne ? 0.8 : 0.66));
    drawIcon(g, 'crown', x, y - rr - (throne ? 6 : 3), cs, gold(g, x - cs, y - rr - cs, x + cs, y - rr + cs, fog), { halo: GROOVE, haloWidth: 2 });
  },
  contested(g, _v, x, y, R, holder, kingly) {
    const rc = contestR(R, kingly) + (kingly ? 3 : 0);
    g.beginPath(); g.arc(x, y, rc, 0, TAU); groove(g, 5); g.stroke();
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * TAU, a1 = a0 + TAU / n - 0.08;
      g.beginPath(); g.arc(x, y, rc, a0, a1); g.lineCap = 'butt'; g.lineWidth = 3.2;
      g.strokeStyle = i % 2 ? (holder ? HI[holder] : '#c8c8cc') : gold(g, x - rc, y - rc, x + rc, y + rc); g.stroke();
    }
  },
  occupied(g, _v, x, y, R, by) {
    const s = markSz(R), px = x + R * 1.25, py = y + R * 0.95;
    g.beginPath(); g.moveTo(px - s * 0.35, py + s * 0.5); g.lineTo(px - s * 0.35, py - s * 0.55); groove(g, 3.4); g.stroke(); g.lineWidth = 1.6; g.strokeStyle = gold(g, px - s, py - s, px + s, py + s); g.stroke();
    g.beginPath(); g.moveTo(px - s * 0.35, py - s * 0.55); g.lineTo(px + s * 0.55, py - s * 0.3); g.lineTo(px - s * 0.35, py - s * 0.04); g.closePath();
    groove(g, 2.8); g.stroke(); g.fillStyle = HI[by]; g.fill(); g.lineWidth = 1; g.strokeStyle = gold(g, px - s, py - s, px + s, py + s); g.stroke();
    beads(g, px - s * 0.35, py + s * 0.5, 0, 1, 2, gold(g, px - 2, py, px + 2, py + 4));
  },
  tribute(g, _v, x, y, R, to) {
    const s = markSz(R), px = x - R * 1.25, py = y + R * 0.95;
    g.beginPath(); g.arc(px + 1, py + 1.5, s * 0.6, 0, TAU); g.fillStyle = 'rgba(0,0,0,0.6)'; g.fill();
    g.beginPath(); g.arc(px, py, s * 0.58, 0, TAU); g.fillStyle = gold(g, px - s, py - s, px + s, py + s); g.fill();
    g.lineWidth = 1.6; g.strokeStyle = ENAMEL[to]; g.stroke();
    drawIcon(g, 'scales', px, py, s * 0.74, 'rgba(60,34,4,0.95)');
  },

  label(g, _v, text, x, y, fs, kind, owner, fog) {
    const kingly = kind === 'throne' || kind === 'crown';
    g.font = `700 ${fs}px Cinzel, serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    const tr = fs * 0.12;
    // engraved: a dark cut under the letter, then the polished face
    g.lineJoin = 'round'; g.lineWidth = 3.4; g.strokeStyle = GROOVE; spaced(g, text, x, y, tr, 'stroke');
    g.fillStyle = fog ? '#b4b2ac' : kingly ? gold(g, x, y - fs / 2, x, y + fs / 2) : owner ? HI[owner] : PALE;
    spaced(g, text, x, y, tr);
    return textW(g, text, tr);
  },
  empireName(g, _v, text, x, y, fs, h) {
    g.font = `700 ${fs}px Cinzel, serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineJoin = 'round'; g.lineWidth = 4; g.strokeStyle = GROOVE; spaced(g, text, x, y, fs * 0.38, 'stroke');
    g.fillStyle = HI[h]; spaced(g, text, x, y, fs * 0.38);
  },
  garrison(g, _v, n, x, y, fs) {
    const t = String(n);
    g.font = `800 ${fs}px "Alegreya Sans", sans-serif`; g.textAlign = 'left'; g.textBaseline = 'middle';
    const w = g.measureText(t).width + fs * 0.85, x0 = x - w / 2;
    g.lineJoin = 'round'; g.lineWidth = 3; g.strokeStyle = GROOVE; g.strokeText(t, x0 + fs * 0.85, y + 0.5);
    drawIcon(g, 'garrison', x0 + fs * 0.35, y, fs * 0.85, gold(g, x0, y - fs, x0 + fs, y + fs), { halo: GROOVE, haloWidth: 1.6 });
    g.fillStyle = IVORY; g.fillText(t, x0 + fs * 0.85, y + 0.5);
    return w;
  },

  route(g, _v, pts, h, seize) {
    const path = () => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); };
    path(); groove(g, 6); g.stroke();
    path(); g.setLineDash([9, 5]); g.lineCap = 'butt'; g.lineWidth = 3; g.strokeStyle = HI[h]; g.stroke(); g.setLineDash([]);
    const a = pts[pts.length - 2], b = pts[pts.length - 1], ang = Math.atan2(b.y - a.y, b.x - a.x);
    g.save(); g.translate(b.x, b.y); g.rotate(ang);
    g.beginPath(); g.moveTo(3, 0); g.lineTo(-9, -6.5); g.lineTo(seize ? -5.5 : -6.5, 0); g.lineTo(-9, 6.5); g.closePath();
    groove(g, 3); g.stroke(); g.fillStyle = HI[h]; g.fill(); g.lineWidth = 1; g.strokeStyle = gold(g, -9, -6, 3, 6); g.stroke();
    g.restore();
  },
  reticle(g, _v, x, y, R, h) {
    const draw = () => { g.beginPath(); g.arc(x, y, R, 0, TAU); for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; g.moveTo(x + Math.cos(a) * (R - 5), y + Math.sin(a) * (R - 5)); g.lineTo(x + Math.cos(a) * (R + 4), y + Math.sin(a) * (R + 4)); } };
    draw(); groove(g, 5.4); g.stroke(); draw(); g.lineWidth = 2.2; g.strokeStyle = gold(g, x - R, y - R, x + R, y + R); g.stroke();
    g.beginPath(); g.arc(x, y, R - 2.6, 0, TAU); g.lineWidth = 1.4; g.strokeStyle = HI[h]; g.stroke();
  },
  tether(g, _v, x0, y0, x1, y1, _h) {
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); groove(g, 3); g.stroke(); g.lineWidth = 1.2; g.strokeStyle = 'rgba(232,190,110,0.85)'; g.stroke();
  },

  pip(g, _v, x, y, ang, r, h, sel) {
    g.save(); g.translate(x, y); g.rotate(ang);
    chevron(g, r * 1.32);
    g.lineJoin = 'round'; groove(g, sel ? 5 : 4); g.stroke();
    g.lineWidth = sel ? 2.6 : 1.8; g.strokeStyle = gold(g, -r, -r, r, r); g.stroke();
    const eg = g.createLinearGradient(-r, -r, r, r); eg.addColorStop(0, '#fbf3e2'); eg.addColorStop(0.4, HI[h]); eg.addColorStop(1, HI[h]);
    g.fillStyle = eg; g.fill();
    g.restore();
  },
  counter(g, _v, x, y, ang, r, h, sel) {
    // a struck gold token: polished bezel, domed house enamel, the heading as an ivory chevron, shadow down-right
    const R = r;
    g.save(); g.translate(x, y);
    g.beginPath(); g.arc(1.6, 2.6, R + 1.6, 0, TAU); g.fillStyle = 'rgba(0,0,0,0.6)'; g.fill();
    g.beginPath(); g.arc(0, 0, R + 1.6, 0, TAU); g.fillStyle = gold(g, -R, -R, R, R); g.fill(); g.lineWidth = 0.9; g.strokeStyle = 'rgba(50,30,4,0.9)'; g.stroke();
    const eg = g.createRadialGradient(-R * 0.3, -R * 0.4, R * 0.08, 0, 0, R);
    eg.addColorStop(0, HI[h]); eg.addColorStop(0.55, ENAMEL[h]); eg.addColorStop(1, FIELD[h]);
    g.beginPath(); g.arc(0, 0, R - 0.8, 0, TAU); g.fillStyle = eg; g.fill();
    g.beginPath(); g.ellipse(-R * 0.32, -R * 0.42, R * 0.32, R * 0.16, -0.5, 0, TAU); g.fillStyle = 'rgba(255,250,235,0.32)'; g.fill();
    g.save(); g.rotate(ang); chevron(g, R * 0.56); g.lineJoin = 'round'; g.lineWidth = 1.4; g.strokeStyle = 'rgba(6,5,4,0.6)'; g.stroke(); g.fillStyle = IVORY; g.fill(); g.restore();
    if (sel) { g.beginPath(); g.arc(0, 0, R + 4.6, 0, TAU); groove(g, 4.6); g.stroke(); g.lineWidth = 2.2; g.strokeStyle = '#fff0bd'; g.stroke(); beads(g, 0, 0, R + 7.2, 16, 0.9, '#f0c873'); }
    g.restore();
  },
  mini(g, v, x, y, ang, r, h, ships, sel) {
    // cast-metal figurines (the game's sculpts gradient-mapped to the house metal, lacquer kept as enamel) on a
    // black-enamel plinth with a gold rim and a band of house enamel
    const by = y + r * 0.35;
    g.save();
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.beginPath(); g.ellipse(x + 5, by + 6, r * 1.05, r * 0.46, 0, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(x, by + 3.4, r, r * 0.44, 0, 0, TAU); g.fillStyle = ENAMEL[h]; g.fill();
    g.beginPath(); g.ellipse(x, by, r, r * 0.44, 0, 0, TAU); g.fillStyle = '#0c0d12'; g.fill();
    g.lineWidth = Math.max(1.6, r * 0.1); g.strokeStyle = gold(g, x - r, by - r, x + r, by + r); g.stroke();
    if (sel) { g.beginPath(); g.ellipse(x, by, r * 1.2, r * 0.56, 0, 0, TAU); groove(g, 4.6); g.stroke(); g.lineWidth = 2.2; g.strokeStyle = '#fff0bd'; g.stroke(); }
    const n = Math.min(3, ships.length), len = r * 1.45;
    const fn = metalFn(h);
    for (let i = n - 1; i >= 0; i--) {
      const ox = (i === 0 ? 0 : i === 1 ? -0.6 : 0.6) * r, oy = (i === 0 ? -0.12 : 0.18) * r;
      const L = i === 0 ? len : len * 0.72;
      g.fillStyle = 'rgba(232,190,110,0.7)'; g.fillRect(x + ox - 0.8, by - r * 0.62 + oy, 1.6, r * 0.62 - oy);
      const spr = stylizedShip('C', ships[i], h, L * v.dpr, ang + Math.PI / 2, fn, [24, 16, 6], Math.max(1, Math.round(v.dpr * 0.6)));
      blitShip(g, spr, x + ox, by - r * 0.68 + oy, L, L * v.dpr);
    }
    g.restore();
  },
  stack(g, _v, n, x, y, r, _h) {
    const cx = x + r * 0.95, cy = y + r * 0.95;
    g.beginPath(); g.arc(cx, cy, 8.2, 0, TAU); g.fillStyle = GROOVE; g.fill();
    g.beginPath(); g.arc(cx, cy, 7, 0, TAU); g.fillStyle = '#0c0d12'; g.fill(); g.lineWidth = 1.6; g.strokeStyle = gold(g, cx - 7, cy - 7, cx + 7, cy + 7); g.stroke();
    g.font = `800 11px "Alegreya Sans", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = IVORY; g.fillText(String(n), cx, cy + 0.5);
  },
  idle(g, _v, x, y, r, phase) {
    // a slowly turning milgrain ring: the instrument's escapement ticking for a piece that still needs orders
    const R = r * 1.45, n = 16;
    g.beginPath(); g.arc(x, y, R, 0, TAU); groove(g, 5); g.stroke();
    g.fillStyle = '#fbeac0';
    for (let i = 0; i < n; i++) { const a = (i / n) * TAU + phase * 0.6; g.beginPath(); g.arc(x + Math.cos(a) * R, y + Math.sin(a) * R, 1.7, 0, TAU); g.fill(); }
  },
  oos(g, _v, x, y, r) {
    g.beginPath(); g.arc(x, y, r * 1.3, 0, TAU); groove(g, 5); g.stroke();
    g.setLineDash([4, 3]); g.lineWidth = 2.6; g.lineCap = 'butt'; g.strokeStyle = '#f2b04a'; g.stroke(); g.setLineDash([]);
  },
  strength(g, _v, n, x, y) {
    const t = String(n);
    g.font = `800 13px "Alegreya Sans", sans-serif`; g.textAlign = 'left'; g.textBaseline = 'middle';
    const w = 15 + g.measureText(t).width, x0 = x - w / 2;
    g.lineJoin = 'round'; g.lineWidth = 3.2; g.strokeStyle = GROOVE; g.strokeText(t, x0 + 15, y + 0.5);
    drawIcon(g, 'attack', x0 + 6, y, 13, gold(g, x0, y - 7, x0 + 13, y + 7), { halo: GROOVE, haloWidth: 1.8 });
    g.fillStyle = IVORY; g.fillText(t, x0 + 15, y + 0.5);
  },
  battle(g, _v, x, y, Dm) {
    g.beginPath(); g.arc(x + 1.6, y + 2.6, Dm * 1.2, 0, TAU); g.fillStyle = 'rgba(0,0,0,0.6)'; g.fill();
    g.beginPath(); g.arc(x, y, Dm * 1.16, 0, TAU); g.fillStyle = gold(g, x - Dm, y - Dm, x + Dm, y + Dm); g.fill();
    const eg = g.createRadialGradient(x - Dm * 0.3, y - Dm * 0.4, Dm * 0.1, x, y, Dm);
    eg.addColorStop(0, '#e8705a'); eg.addColorStop(0.6, '#9a2a24'); eg.addColorStop(1, '#4a0c0c');
    g.beginPath(); g.arc(x, y, Dm * 0.98, 0, TAU); g.fillStyle = eg; g.fill();
    drawIcon(g, 'battle', x, y, Dm * 1.2, gold(g, x - Dm, y - Dm, x + Dm, y + Dm), { shadow: 'rgba(30,0,0,0.9)' });
  },
  shot(g, _v, a, b, h, k) {
    const px = a.x + (b.x - a.x) * k, py = a.y + (b.y - a.y) * k;
    const tx = a.x + (b.x - a.x) * Math.max(0, k - 0.3), ty = a.y + (b.y - a.y) * Math.max(0, k - 0.3);
    g.beginPath(); g.moveTo(tx, ty); g.lineTo(px, py); groove(g, 3.4); g.stroke(); g.lineWidth = 1.6; g.strokeStyle = HI[h]; g.stroke();
    g.beginPath(); g.arc(px, py, 2.2, 0, TAU); g.fillStyle = '#fff4d6'; g.fill();
    if (k > 0.6) beads(g, b.x, b.y, 5, 8, 1.1, '#ffd890');
  },

  light(g, v) {
    // the glaze catches the lamp: one broad, soft reflection across the dial, and the room falls off to black
    const R = Math.hypot(v.w, v.h);
    const sh = g.createLinearGradient(v.w * 0.15, 0, v.w * 0.55, v.h * 0.6);
    sh.addColorStop(0, 'rgba(255,240,210,0)'); sh.addColorStop(0.5, 'rgba(255,240,210,0.035)'); sh.addColorStop(1, 'rgba(255,240,210,0)');
    g.fillStyle = sh; g.fillRect(0, 0, v.w, v.h);
    const gr = g.createRadialGradient(v.w * 0.42, v.h * 0.32, R * 0.05, v.w * 0.42, v.h * 0.32, R * 0.8);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.5)');
    g.fillStyle = gr; g.fillRect(0, 0, v.w, v.h);
  },
};

const METAL: Record<House, [RGB, RGB, RGB]> = {
  azure: [[34, 40, 54], [150, 160, 178], [246, 248, 252]],
  crimson: [[46, 18, 10], [186, 104, 66], [255, 222, 196]],
  gilded: [[60, 36, 6], [214, 162, 66], [255, 244, 200]],
  warden: [[40, 32, 58], [150, 136, 176], [240, 232, 252]],
};
/** Cast metal: luminance through the house metal's ramp; strongly painted (saturated) pixels keep the house enamel. */
function metalFn(h: House) {
  const [lo, mid, hi] = METAL[h], E = rgb(ENAMEL[h]);
  return (r: number, gg: number, b: number, a: number, _x: number, _y: number, L: number): [number, number, number, number] => {
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), sat = mx > 0 ? (mx - mn) / mx : 0;
    let c = L < 0.5 ? mix(lo, mid, L / 0.5) : mix(mid, hi, (L - 0.5) / 0.5);
    if (sat > 0.42 && L > 0.15) c = mix(E, [255, 255, 255], Math.max(0, L - 0.55) * 0.8);
    return [c[0], c[1], c[2], a < 128 ? a * 0.6 : 255];
  };
}
void (null as unknown as StarKind);
