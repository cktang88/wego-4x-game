// Direction A, "The printed star chart": the board is a hand-coloured engraved celestial plate (after Cellarius'
// Harmonia Macrocosmica, 1660) laid on the war-table's walnut. Everything PRINTED (space, nebulae, stars, names,
// borders, routes) is flat ink, gilt and watercolour on vellum and casts no shadow; everything that is a PIECE on
// the plate (counters, standees, the battle's wax seal) is an object lit by the one lamp and casts a shadow.
// Value structure: the paper lives in a narrow light band (Y 0.45..0.62); every mark is carried by sepia ink
// (Y < 0.03), so contrast is structural, not a glow.
import { OUTLINE, SYSTEMS, type House, type Pt, type StarKind, type Sys } from './board.ts';
import { type View, TAU, cv, fbm, rng, blitMip, chevron, spaced, textW, bandHatch, HATCH, texPattern, polyPath, stylizedShip, blitShip, rgb, mix, type RGB, LAMP } from './kit.ts';
import { type Style, objR, contestR, markSz, orbitOf } from './render.ts';
import { drawIcon } from '../icons.ts';

type G = CanvasRenderingContext2D;
const INK = '#21170c', INK_RGB: RGB = [33, 23, 12], FADED = '#3d2f1c';
const PAPER = '#e8d9b4', PAPER_HI = '#f1e6c8';
const GILT = '#b8862c', GILT_HI = '#ecc76a', GILT_LO = '#6e4a12';
/** Watercolour washes (territory) and the dark ink of each house (names, routes, counters' print). */
const WASH: Record<House, string> = { azure: '#4f7fb6', crimson: '#bf4a3c', gilded: '#cf9f35', warden: '#7d68ad' };
const DARK: Record<House, string> = { azure: '#12335c', crimson: '#6c161c', gilded: '#4a3407', warden: '#3a2b60' };
const FACE: Record<House, string> = { azure: '#3a6ea8', crimson: '#a8343a', gilded: '#c49a2e', warden: '#6a559c' };
const PLATE = { x0: -1700, y0: -1180, x1: 1700, y1: 1180 };

// ------------------------------------------------------------------ the plate (baked once, world space)
const BK = 0.22; // bake px per world unit (the washes are soft; fine detail is vector or screen-space grain)
let bake: HTMLCanvasElement | null = null;
function plateBake(): HTMLCanvasElement {
  if (bake) return bake;
  const W = Math.ceil((PLATE.x1 - PLATE.x0) * BK), H = Math.ceil((PLATE.y1 - PLATE.y0) * BK);
  const c = cv(W, H), g = c.getContext('2d')!;
  const img = g.createImageData(W, H), D = img.data;
  const paper = rgb(PAPER), sepia: RGB = [150, 112, 70], indigo: RGB = [86, 104, 140], madder: RGB = [168, 92, 84], verd: RGB = [92, 128, 112];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const wx = PLATE.x0 + x / BK, wy = PLATE.y0 + y / BK;
    let col: RGB = paper;
    // paper mottling ±3%
    const m = fbm(wx * 0.004, wy * 0.004, 3, 3) - 0.5;
    col = mix(col, m > 0 ? [246, 236, 210] : [205, 186, 146], Math.abs(m) * 0.5);
    // watercolour nebula washes: three pigments, pooled (darker) at the wash's edge like real watercolour
    const washes: [RGB, number, number][] = [[indigo, 11, 0.56], [madder, 23, 0.6], [sepia, 37, 0.58], [verd, 51, 0.62]];
    for (const [pig, sd, th] of washes) {
      const f = fbm(wx * 0.0011 + sd, wy * 0.0011 - sd, 4, sd);
      const warp = fbm(wx * 0.004 + sd * 2, wy * 0.004, 2, sd + 5) * 0.06;
      const d = f + warp;
      if (d < th - 0.04) continue;
      const body = Math.min(1, (d - th + 0.04) / 0.16);
      const edge = Math.exp(-(((d - th + 0.01) / 0.012) ** 2));
      // keep the middle of the board quietest
      const quiet = 0.55 + 0.45 * Math.min(1, Math.hypot(wx / 1300, wy / 880));
      col = mix(col, pig, (body * 0.13 + edge * 0.1) * quiet);
    }
    const i = (y * W + x) * 4;
    D[i] = col[0]; D[i + 1] = col[1]; D[i + 2] = col[2]; D[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // foxing: a few faint age spots
  const r = rng(77);
  for (let i = 0; i < 40; i++) {
    const x = r() * W, y = r() * H, s = 1 + r() * 4;
    g.fillStyle = `rgba(140,100,50,${0.04 + r() * 0.05})`; g.beginPath(); g.arc(x, y, s, 0, TAU); g.fill();
  }
  bake = c;
  return c;
}
// background stars: printed dots of six magnitudes
const DOTS: { x: number; y: number; m: number }[] = (() => {
  const r = rng(9), out: { x: number; y: number; m: number }[] = [];
  for (let i = 0; i < 900; i++) {
    const x = PLATE.x0 + 60 + r() * (PLATE.x1 - PLATE.x0 - 120), y = PLATE.y0 + 60 + r() * (PLATE.y1 - PLATE.y0 - 120);
    if (SYSTEMS.some(s => Math.hypot(s.x - x, s.y - y) < 70)) continue;
    out.push({ x, y, m: Math.pow(r(), 3) });
  }
  return out;
})();

function inkLine(g: G, w: number, col = INK) { g.lineWidth = w; g.strokeStyle = col; g.stroke(); }
/** A knock-out: paper behind lettering and marks, the way engraved lettering interrupts the hatching. */
function knock(g: G, w: number) { g.lineJoin = 'round'; g.lineWidth = w; g.strokeStyle = 'rgba(236,224,192,0.92)'; }

export const chart: Style = {
  id: 'A', name: 'The printed star chart', tagline: 'an engraved, hand-coloured celestial plate on the war table',

  ground(g, v) {
    // the walnut table round the plate
    g.fillStyle = '#20150d'; g.fillRect(0, 0, v.w, v.h);
    const wood = texPattern(g, 'wood-dark.webp');
    if (wood) { g.save(); g.globalAlpha = 0.55; g.globalCompositeOperation = 'overlay'; g.fillStyle = wood; g.translate(v.sx(0) % 512, v.sy(0) % 512); g.fillRect(-512, -512, v.w + 1024, v.h + 1024); g.restore(); }
    const x0 = v.sx(PLATE.x0), y0 = v.sy(PLATE.y0), x1 = v.sx(PLATE.x1), y1 = v.sy(PLATE.y1);
    // the plate's cast shadow on the wood (down-right, from the lamp)
    g.save(); g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 24; g.shadowOffsetX = 6; g.shadowOffsetY = 10;
    g.fillStyle = PAPER; g.fillRect(x0, y0, x1 - x0, y1 - y0); g.restore();
    g.save(); g.beginPath(); g.rect(x0, y0, x1 - x0, y1 - y0); g.clip();
    blitMip(g, plateBake(), x0, y0, x1 - x0, y1 - y0, v.dpr);
    // vellum fibre at screen scale (fine detail at every zoom)
    const parch = texPattern(g, 'parchment.webp');
    if (parch) { g.save(); g.globalAlpha = 0.5; g.globalCompositeOperation = 'soft-light'; g.fillStyle = parch; g.translate(v.sx(0) % 1024, v.sy(0) % 1024); g.fillRect(-1024, -1024, v.w + 2048, v.h + 2048); g.restore(); }
    // the planisphere graticule: circles round the Throne, meridians every 30°
    g.strokeStyle = 'rgba(60,40,20,0.13)'; g.lineWidth = 0.7;
    const cx = v.sx(0), cy = v.sy(0);
    for (let r = 300; r < 2000; r += 300) { g.beginPath(); g.ellipse(cx, cy, r * v.z * 1.25, r * v.z * 0.86, 0, 0, TAU); g.stroke(); }
    g.beginPath();
    for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU; g.moveTo(cx + Math.cos(a) * 120 * v.z, cy + Math.sin(a) * 90 * v.z); g.lineTo(cx + Math.cos(a) * 2400 * v.z, cy + Math.sin(a) * 1700 * v.z); }
    g.stroke();
    // off the chart: outside the playable outline the plate is finely ruled (terra incognita)
    g.save();
    const ob = new Path2D(); ob.rect(x0, y0, x1 - x0, y1 - y0); polyPath(ob, OUTLINE, v);
    g.clip(ob, 'evenodd');
    g.fillStyle = 'rgba(120,90,50,0.10)'; g.fillRect(x0, y0, x1 - x0, y1 - y0);
    g.strokeStyle = 'rgba(60,40,20,0.16)'; g.lineWidth = 0.6; g.beginPath();
    for (let y = y0; y < y1; y += 3.2) { g.moveTo(x0, y); g.lineTo(x1, y); }
    g.stroke();
    g.restore();
    // background stars: printed dots
    const k = Math.min(1.6, 0.6 + v.z * 0.9);
    g.fillStyle = 'rgba(33,23,12,0.62)';
    for (const d of DOTS) {
      const x = v.sx(d.x), y = v.sy(d.y);
      if (x < -4 || y < -4 || x > v.w + 4 || y > v.h + 4) continue;
      g.beginPath(); g.arc(x, y, (0.35 + d.m * 1.3) * k, 0, TAU); g.fill();
    }
    g.restore();
    // the playable outline: a ruled ink coast
    g.beginPath(); polyPath(g, OUTLINE, v); inkLine(g, 1.1, 'rgba(33,23,12,0.55)');
    // the neatline and the graduated border of the plate
    g.lineWidth = 2; g.strokeStyle = INK; g.strokeRect(x0 + 6, y0 + 6, x1 - x0 - 12, y1 - y0 - 12);
    const bw = Math.max(3, 24 * v.z);
    g.lineWidth = 0.8; g.strokeRect(x0 + 6 + bw, y0 + 6 + bw, x1 - x0 - 12 - bw * 2, y1 - y0 - 12 - bw * 2);
    const step = 100 * v.z;
    if (step > 3) {
      g.fillStyle = INK;
      let i = 0;
      for (let x = x0 + 6; x < x1 - 6 - step; x += step, i++) if (i % 2) { g.fillRect(x, y0 + 6, step, bw * 0.38); g.fillRect(x, y1 - 6 - bw * 0.38, step, bw * 0.38); }
      i = 0;
      for (let y = y0 + 6; y < y1 - 6 - step; y += step, i++) if (i % 2) { g.fillRect(x0 + 6, y, bw * 0.38, step); g.fillRect(x1 - 6 - bw * 0.38, y, bw * 0.38, step); }
    }
    // the title cartouche, lower right
    const tx = v.sx(PLATE.x1 - 420), ty = v.sy(PLATE.y1 - 150);
    if (tx > -200 && ty > -100 && tx < v.w + 200 && ty < v.h + 100) {
      const fs = Math.max(6, 46 * v.z);
      g.save(); g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `italic ${fs}px "IM Fell English", serif`; g.fillStyle = INK;
      g.fillText('Tabula Trium Coronarum', tx, ty);
      g.font = `600 ${fs * 0.45}px Cinzel, serif`; spaced(g, 'THE THREE CROWNS · A NEW CHART OF THE REACH', tx, ty + fs * 0.75, fs * 0.08);
      g.restore();
    }
  },

  territory(g, v, h, path) {
    // the wash, then the hand-coloured band along the border (the antique "outline colouring"), then the engraved
    // hatch in that band only, so the interior stays quiet under the pieces
    g.save(); g.clip(path);
    g.fillStyle = WASH[h]; g.globalAlpha = 0.17; g.fill(path);
    const band = Math.max(7, Math.min(22, 70 * v.z));
    g.globalAlpha = 0.26; g.lineWidth = band * 2; g.lineJoin = 'round'; g.strokeStyle = WASH[h]; g.stroke(path);
    g.globalAlpha = 0.22; g.lineWidth = band * 0.7; g.stroke(path);
    g.restore();
    const H = HATCH[h];
    bandHatch(g, v, path, band * 1.15, H.a, H.cross, DARK[h] + '5c', 0.8, 4.2);
    // the border: an ink rule with a fine coloured line inside
    g.save(); g.clip(path);
    g.lineJoin = 'round';
    g.lineWidth = 3.6; g.strokeStyle = WASH[h]; g.globalAlpha = 0.9; g.stroke(path);
    g.restore();
    g.lineWidth = 1.4; g.strokeStyle = INK; g.stroke(path);
  },

  lane(g, v, a, b, lit, fog) {
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y);
    if (fog) g.setLineDash([3, 3]);
    g.lineCap = 'round';
    if (lit > 0) {
      knock(g, 5.8); g.stroke();
      g.lineWidth = 2.8 + lit * 1.0; g.strokeStyle = INK; g.stroke();
      if (lit >= 1) { g.lineWidth = 0.9; g.strokeStyle = GILT_HI; g.stroke(); }
    } else { g.lineWidth = 0.75; g.strokeStyle = 'rgba(33,23,12,0.42)'; g.stroke(); }
    g.setLineDash([]);
  },
  waypoint(g, _v, x, y, lit) {
    g.save(); g.globalAlpha *= Math.min(1, lit * 1.6);
    g.beginPath(); g.arc(x, y, 2.6, 0, TAU); g.fillStyle = PAPER_HI; g.fill(); inkLine(g, 1);
    g.restore();
  },

  bodies(g, v, s, x, y, R, alpha) {
    g.save(); g.globalAlpha *= alpha;
    s.bodies.forEach((b, i) => {
      const o = orbitOf(i, R, s.id);
      g.beginPath(); g.ellipse(x, y, o.rx, o.ry, 0, 0, TAU);
      g.setLineDash(b === 'belt' ? [] : [1.5, 3]); inkLine(g, 0.8, 'rgba(33,23,12,0.6)'); g.setLineDash([]);
      if (b === 'belt') {
        const r = rng(s.id * 7 + i);
        g.fillStyle = INK;
        for (let k = 0; k < 70; k++) { const a = r() * TAU, j = 1 + (r() - 0.5) * 0.12; g.beginPath(); g.arc(x + Math.cos(a) * o.rx * j, y + Math.sin(a) * o.ry * j, 0.5 + r() * 0.8, 0, TAU); g.fill(); }
        return;
      }
      const px = x + Math.cos(o.a) * o.rx, py = y + Math.sin(o.a) * o.ry;
      const pr = Math.max(2.5, R * (b === 'gas' ? 0.42 : b === 'station' ? 0.26 : 0.3));
      if (b === 'station') { g.save(); g.translate(px, py); g.rotate(0.5); g.fillStyle = PAPER_HI; g.fillRect(-pr, -pr, pr * 2, pr * 2); g.lineWidth = 1; g.strokeStyle = INK; g.strokeRect(-pr, -pr, pr * 2, pr * 2); g.beginPath(); g.moveTo(-pr * 1.8, 0); g.lineTo(pr * 1.8, 0); g.stroke(); g.restore(); return; }
      const tint = b === 'gas' ? '#c7a26a' : b === 'ice' ? '#a9c0d0' : b === 'lava' ? '#c4674a' : '#b3a58a';
      g.beginPath(); g.arc(px, py, pr, 0, TAU); g.fillStyle = tint; g.fill();
      // engraved shade on the side away from the lamp
      g.save(); g.clip();
      g.beginPath(); g.arc(px - LAMP.x * pr * 0.55, py - LAMP.y * pr * 0.55, pr * 1.05, 0, TAU); g.arc(px + LAMP.x * pr * 0.25, py + LAMP.y * pr * 0.25, pr * 0.95, 0, TAU, true);
      g.clip('evenodd');
      g.strokeStyle = INK; g.lineWidth = 0.6; g.beginPath();
      for (let k = -pr * 2; k < pr * 2; k += 1.8) { g.moveTo(px + k - pr, py - pr); g.lineTo(px + k + pr, py + pr); }
      g.stroke(); g.restore();
      if (b === 'gas') { g.beginPath(); g.ellipse(px, py, pr * 1.7, pr * 0.45, -0.3, 0, TAU); inkLine(g, 0.8); }
      g.beginPath(); g.arc(px, py, pr, 0, TAU); inkLine(g, 1);
    });
    g.restore();
  },

  star(g, v, kind, x, y, R, fog, seed) {
    // engraved glyphs: the SHAPE says the kind (rays, points, rings, beams), colour only confirms it
    const fill = (c: string) => (fog ? PAPER_HI : c);
    const ink = fog ? FADED : INK;
    const lw = Math.max(1.15, Math.min(1.7, R * 0.1));
    g.save();
    g.lineJoin = 'miter';
    const disc = (cx: number, cy: number, r: number, c: string) => { g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fillStyle = fill(c); g.fill(); g.lineWidth = lw; g.strokeStyle = ink; g.stroke(); };
    const rays = (n: number, r0: number, r1: number, w: number, c: string, rot = 0, alt = 0) => {
      for (let i = 0; i < n; i++) {
        const a = rot + (i / n) * TAU, rr = alt && i % 2 ? r0 + (r1 - r0) * alt : r1;
        g.beginPath();
        g.moveTo(x + Math.cos(a - w) * r0, y + Math.sin(a - w) * r0); g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); g.lineTo(x + Math.cos(a + w) * r0, y + Math.sin(a + w) * r0);
        g.closePath(); g.fillStyle = fill(c); g.fill(); g.lineWidth = lw * 0.8; g.strokeStyle = ink; g.stroke();
      }
    };
    const point = (n: number, ro: number, ri: number, c: string, rot = -Math.PI / 2) => {
      g.beginPath();
      for (let i = 0; i < n * 2; i++) { const a = rot + (i * Math.PI) / n, r = i % 2 ? ri : ro; const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; if (i) g.lineTo(px, py); else g.moveTo(px, py); }
      g.closePath(); g.fillStyle = fill(c); g.fill(); g.lineWidth = lw; g.strokeStyle = ink; g.stroke();
    };
    switch (kind) {
      case 'yellow': rays(8, R * 0.5, R * 1.05, 0.2, GILT, seed % 7 * 0.05); disc(x, y, R * 0.56, GILT); break;
      case 'throne': rays(16, R * 0.55, R * 1.18, 0.12, GILT, 0, 0.6); disc(x, y, R * 0.6, GILT);
        if (!fog) drawIcon(g, 'crown', x, y - R * 0.02, R * 0.72, INK); break;
      case 'red': disc(x, y, R * 0.74, '#c05a3c'); g.beginPath(); g.arc(x, y, R * 0.98, 0, TAU); g.setLineDash([1.4, 2]); g.lineWidth = lw * 0.8; g.strokeStyle = ink; g.stroke(); g.setLineDash([]); break;
      case 'blue': point(6, R * 1.08, R * 0.45, '#6f9bd1'); disc(x, y, R * 0.2, PAPER_HI); break;
      case 'white': point(4, R * 1.05, R * 0.34, PAPER_HI); point(4, R * 0.62, R * 0.24, PAPER_HI, -Math.PI / 4); break;
      case 'binary': {
        g.beginPath(); g.ellipse(x, y, R * 1.02, R * 0.62, -0.5, 0, TAU); g.lineWidth = lw * 0.7; g.strokeStyle = ink; g.stroke();
        disc(x - R * 0.32, y + R * 0.18, R * 0.44, GILT); disc(x + R * 0.36, y - R * 0.2, R * 0.3, '#8fb2dc'); break;
      }
      case 'pulsar': {
        for (const s of [-1, 1]) {
          g.beginPath(); g.moveTo(x + s * R * 0.3 * 0.7, y - s * R * 0.3 * 0.7); g.lineTo(x + s * R * 1.25 * 0.7, y - s * R * 1.25 * 0.7);
          g.lineWidth = lw * 2.4; g.strokeStyle = ink; g.stroke(); g.lineWidth = lw * 0.9; g.strokeStyle = fill('#9db4d8'); g.stroke();
        }
        for (const rr of [0.62, 0.86]) { g.beginPath(); g.arc(x, y, R * rr, -0.4, 0.9); g.lineWidth = lw * 0.7; g.strokeStyle = ink; g.stroke(); g.beginPath(); g.arc(x, y, R * rr, Math.PI - 0.4, Math.PI + 0.9); g.stroke(); }
        disc(x, y, R * 0.32, '#9db4d8'); break;
      }
      case 'blackhole': {
        g.beginPath(); g.ellipse(x, y, R * 1.08, R * 0.38, -0.32, 0, TAU); g.lineWidth = lw * 2.6; g.strokeStyle = ink; g.stroke(); g.lineWidth = lw * 1.2; g.strokeStyle = fill(GILT_HI); g.stroke();
        g.beginPath(); g.arc(x, y, R * 0.5, 0, TAU); g.fillStyle = ink; g.fill();
        // the near side of the ring crosses in front
        g.beginPath(); g.ellipse(x, y, R * 1.08, R * 0.38, -0.32, 0.15, Math.PI - 0.15); g.lineWidth = lw * 2.6; g.strokeStyle = ink; g.stroke(); g.lineWidth = lw * 1.2; g.strokeStyle = fill(GILT_HI); g.stroke();
        break;
      }
    }
    g.restore();
    void v;
  },

  objective(g, _v, x, y, R, throne, fog) {
    const rr = objR(R, throne);
    const ring = (r: number, w: number) => {
      g.beginPath(); g.arc(x, y, r, 0, TAU);
      g.lineWidth = w + 2.8; g.strokeStyle = fog ? FADED : INK; g.stroke();
      g.lineWidth = w; g.strokeStyle = fog ? PAPER_HI : GILT_HI; g.stroke();
    };
    ring(rr, throne ? 2.2 : 1.7);
    if (throne) ring(rr + 4.5, 1.2);
    // a small engraved crown on the ring's crest
    const cs = Math.max(8, R * (throne ? 0.8 : 0.62));
    const cy = y - rr - (throne ? 4.5 : 0);
    g.beginPath(); g.arc(x, cy, cs * 0.62, 0, TAU); g.fillStyle = PAPER_HI; g.fill(); g.lineWidth = 1; g.strokeStyle = fog ? FADED : INK; g.stroke();
    drawIcon(g, 'crown', x, cy, cs * 0.9, fog ? FADED : INK);
  },
  contested(g, _v, x, y, R, holder, kingly) {
    const rc = contestR(R, kingly);
    g.beginPath(); g.arc(x, y, rc, 0, TAU);
    g.lineWidth = 3.4; g.strokeStyle = INK; g.setLineDash([5, 3]); g.stroke();
    g.lineWidth = 1.6; g.strokeStyle = holder ? WASH[holder] : PAPER_HI; g.stroke(); g.setLineDash([]);
  },
  occupied(g, _v, x, y, R, by) {
    const s = markSz(R), px = x + R * 1.25, py = y + R * 0.95;
    // a planted pennant in the occupier's colour
    g.lineCap = 'round';
    g.beginPath(); g.moveTo(px - s * 0.35, py + s * 0.5); g.lineTo(px - s * 0.35, py - s * 0.5); inkLine(g, 1.5);
    g.beginPath(); g.moveTo(px - s * 0.35, py - s * 0.5); g.lineTo(px + s * 0.5, py - s * 0.28); g.lineTo(px - s * 0.35, py - s * 0.02); g.closePath();
    g.fillStyle = FACE[by]; g.fill(); inkLine(g, 1);
  },
  tribute(g, _v, x, y, R, to) {
    const s = markSz(R), px = x - R * 1.25, py = y + R * 0.95;
    g.beginPath(); g.arc(px, py, s * 0.6, 0, TAU); g.fillStyle = PAPER_HI; g.fill(); g.lineWidth = 2.4; g.strokeStyle = DARK[to]; g.stroke(); g.beginPath(); g.arc(px, py, s * 0.6 + 1.6, 0, TAU); g.lineWidth = 1.2; g.strokeStyle = INK; g.stroke();
    drawIcon(g, 'scales', px, py, s * 0.78, INK);
  },

  label(g, _v, text, x, y, fs, kind, owner, fog) {
    const kingly = kind === 'throne' || kind === 'crown';
    fs *= 1.05;
    g.font = `700 ${fs}px Cinzel, serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const tr = fs * 0.1;
    knock(g, 4); spaced(g, text, x, y, tr, 'stroke');
    g.fillStyle = fog ? '#3a2c1a' : owner ? DARK[owner] : INK;
    if (fog) g.font = `italic 400 ${fs * 1.06}px "IM Fell English", serif`;
    spaced(g, text, x, y, fog ? fs * 0.04 : tr);
    const w = textW(g, text, tr);
    if (kingly && !fog) {
      // a gilt flourish under the objectives' names
      g.beginPath(); g.moveTo(x - w * 0.3, y + fs * 0.62); g.quadraticCurveTo(x, y + fs * 0.9, x + w * 0.3, y + fs * 0.62);
      g.lineWidth = 1.1; g.strokeStyle = GILT_LO; g.stroke();
    }
    return w;
  },
  empireName(g, _v, text, x, y, fs, h) {
    g.font = `600 ${fs}px Cinzel, serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    knock(g, 5); spaced(g, text, x, y, fs * 0.42, 'stroke');
    g.fillStyle = DARK[h]; spaced(g, text, x, y, fs * 0.42);
  },
  garrison(g, _v, n, x, y, fs) {
    const t = String(n);
    g.font = `700 ${fs}px "Alegreya Sans", sans-serif`; g.textAlign = 'left'; g.textBaseline = 'middle';
    const w = g.measureText(t).width + fs * 0.85;
    const x0 = x - w / 2;
    knock(g, 4); g.strokeText(t, x0 + fs * 0.85, y);
    drawIcon(g, 'garrison', x0 + fs * 0.35, y, fs * 0.85, INK, { halo: 'rgba(236,224,192,0.92)', haloWidth: 1.5 });
    g.fillStyle = INK; g.fillText(t, x0 + fs * 0.85, y);
    return w;
  },

  route(g, _v, pts, h, seize) {
    const path = () => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); };
    g.lineCap = 'butt'; g.lineJoin = 'round';
    path(); knock(g, 5.5); g.stroke();
    path(); g.setLineDash([7, 4]); g.lineWidth = 3.8; g.strokeStyle = INK; g.stroke(); g.lineWidth = 1.6; g.strokeStyle = FACE[h]; g.stroke(); g.setLineDash([]);
    // the head: an engraved arrowhead (a seize gets a barbed head)
    const a = pts[pts.length - 2], b = pts[pts.length - 1], ang = Math.atan2(b.y - a.y, b.x - a.x);
    g.save(); g.translate(b.x, b.y); g.rotate(ang);
    g.beginPath(); g.moveTo(2, 0); g.lineTo(-9, -5.5); g.lineTo(seize ? -6 : -7, 0); g.lineTo(-9, 5.5); g.closePath();
    g.fillStyle = DARK[h]; g.fill(); g.lineWidth = 1; g.strokeStyle = INK; g.stroke();
    g.restore();
  },
  reticle(g, _v, x, y, R, h) {
    const draw = () => { g.beginPath(); g.arc(x, y, R, 0, TAU); for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; g.moveTo(x + Math.cos(a) * (R - 5), y + Math.sin(a) * (R - 5)); g.lineTo(x + Math.cos(a) * (R + 5), y + Math.sin(a) * (R + 5)); } };
    draw(); knock(g, 5); g.stroke();
    draw(); g.lineWidth = 2; g.strokeStyle = DARK[h]; g.stroke();
    g.beginPath(); g.arc(x, y, R + 3, 0, TAU); g.lineWidth = 0.8; g.strokeStyle = INK; g.stroke();
  },
  tether(g, _v, x0, y0, x1, y1, h) {
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.lineWidth = 1.2; g.strokeStyle = DARK[h]; g.stroke();
  },

  pip(g, _v, x, y, ang, r, h, sel) {
    g.save(); g.translate(x, y); g.rotate(ang);
    chevron(g, r * 1.3);
    g.lineJoin = 'round'; g.lineWidth = sel ? 3.4 : 2.6; g.strokeStyle = sel ? GILT_HI : PAPER_HI; g.stroke();
    g.fillStyle = FACE[h]; g.fill(); g.lineWidth = 1.6; g.strokeStyle = INK; g.stroke();
    g.restore();
  },
  counter(g, _v, x, y, ang, r, h, sel) {
    // a die-cut card counter lying on the plate: lit face, a thickness edge and a shadow down-right
    const s = r * 0.92;
    g.save(); g.translate(x, y);
    g.fillStyle = 'rgba(40,24,8,0.38)'; rr(g, -s + 2.4, -s + 3.4, s * 2, s * 2, 2.5); g.fill();
    g.fillStyle = '#3a2a18'; rr(g, -s + 1, -s + 1.4, s * 2, s * 2, 2.5); g.fill();
    const face = g.createLinearGradient(-s, -s, s, s);
    const F = rgb(FACE[h]);
    face.addColorStop(0, `rgb(${mix(F, [255, 240, 210], 0.22).join(',')})`); face.addColorStop(1, `rgb(${mix(F, [0, 0, 0], 0.12).join(',')})`);
    g.fillStyle = PAPER_HI; rr(g, -s, -s, s * 2, s * 2, 2.5); g.fill();
    g.lineWidth = 1.6; g.strokeStyle = INK; g.stroke();
    // the printed face inside a paper margin, and the heading chevron
    g.fillStyle = face; rr(g, -s + 1.8, -s + 1.8, s * 2 - 3.6, s * 2 - 3.6, 1.5); g.fill();
    g.save(); g.rotate(ang); chevron(g, s * 0.62); g.fillStyle = PAPER_HI; g.fill(); g.lineWidth = 0.9; g.strokeStyle = INK; g.stroke(); g.restore();
    if (sel) { g.lineWidth = 2.2; g.strokeStyle = GILT_HI; rr(g, -s - 3, -s - 3, s * 2 + 6, s * 2 + 6, 4); g.stroke(); g.lineWidth = 0.9; g.strokeStyle = INK; rr(g, -s - 4.6, -s - 4.6, s * 2 + 9.2, s * 2 + 9.2, 5); g.stroke(); }
    g.restore();
  },
  mini(g, v, x, y, ang, r, h, ships, sel) {
    // a hand-coloured engraving of the game's own sculpt, cut out and stood on a turned walnut base
    const by = y + r * 0.35;
    g.save();
    g.fillStyle = 'rgba(40,24,8,0.35)'; g.beginPath(); g.ellipse(x + 4, by + 5, r * 1.02, r * 0.44, 0, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(x, by + 2.5, r, r * 0.42, 0, 0, TAU); g.fillStyle = '#2b1d10'; g.fill();
    g.beginPath(); g.ellipse(x, by, r, r * 0.42, 0, 0, TAU);
    const bg = g.createLinearGradient(x - r, by - r * 0.4, x + r, by + r * 0.4); bg.addColorStop(0, '#7a5a38'); bg.addColorStop(1, '#3a2814');
    g.fillStyle = bg; g.fill(); g.lineWidth = 1; g.strokeStyle = INK; g.stroke();
    g.beginPath(); g.ellipse(x, by, r * 0.82, r * 0.34, 0, 0, TAU); g.lineWidth = 2.4; g.strokeStyle = FACE[h]; g.stroke();
    if (sel) { g.beginPath(); g.ellipse(x, by, r * 1.18, r * 0.52, 0, 0, TAU); g.lineWidth = 2.2; g.strokeStyle = GILT_HI; g.stroke(); g.lineWidth = 0.8; g.strokeStyle = INK; g.stroke(); }
    const n = Math.min(3, ships.length);
    const len = r * 1.45;
    const lenDev = len * v.dpr;
    const fn = engraveFn(h);
    for (let i = n - 1; i >= 0; i--) {
      const ox = (i === 0 ? 0 : i === 1 ? -0.55 : 0.55) * r, oy = (i === 0 ? -0.1 : 0.2) * r;
      const L = i === 0 ? len : len * 0.72;
      const spr = stylizedShip('A', ships[i], h, L * v.dpr, ang + Math.PI / 2, fn, INK_RGB, Math.max(1, Math.round(v.dpr * 0.7)));
      blitShip(g, spr, x + ox, by - r * 0.62 + oy, L, L * v.dpr);
    }
    g.restore();
  },
  stack(g, _v, n, x, y, r, h) {
    // the counters under it show as offset card edges; the count is a paper roundel
    const cx = x + r * 0.95, cy = y + r * 0.95, rr0 = 6.5;
    g.beginPath(); g.arc(cx, cy, rr0, 0, TAU); g.fillStyle = PAPER_HI; g.fill(); g.lineWidth = 1.6; g.strokeStyle = INK; g.stroke(); g.beginPath(); g.arc(cx, cy, rr0 - 1.8, 0, TAU); g.lineWidth = 0.8; g.strokeStyle = DARK[h]; g.stroke();
    g.font = `800 10.5px "Alegreya Sans", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = INK; g.fillText(String(n), cx, cy + 0.5);
  },
  idle(g, _v, x, y, r, phase) {
    // a graphite ring, as if the piece were circled in pencil: "this one still needs orders"
    g.save();
    g.beginPath(); g.arc(x, y, r * 1.45, 0, TAU); g.setLineDash([2.6, 2.4]); g.lineDashOffset = phase * 10;
    g.lineWidth = 4; g.strokeStyle = 'rgba(241,230,200,0.9)'; g.stroke(); g.lineWidth = 2.1; g.strokeStyle = '#26262a'; g.stroke(); g.setLineDash([]);
    g.restore();
  },
  oos(g, _v, x, y, r) {
    g.beginPath(); g.arc(x, y, r * 1.3, 0, TAU);
    g.setLineDash([4, 2.5]); g.lineWidth = 3.4; g.strokeStyle = INK; g.stroke(); g.lineWidth = 1.8; g.strokeStyle = '#d9962c'; g.stroke(); g.setLineDash([]);
  },
  strength(g, _v, n, x, y) {
    const t = String(n);
    g.font = `800 13px "Alegreya Sans", sans-serif`; g.textAlign = 'left'; g.textBaseline = 'middle';
    const w = 15 + g.measureText(t).width, x0 = x - w / 2;
    knock(g, 4); g.strokeText(t, x0 + 15, y);
    drawIcon(g, 'attack', x0 + 6, y, 13, INK, { halo: 'rgba(236,224,192,0.92)', haloWidth: 1.6 });
    g.fillStyle = INK; g.fillText(t, x0 + 15, y + 0.5);
  },
  battle(g, _v, x, y, D) {
    // a red wax seal pressed onto the plate: the one red object on the board, lit and shadowed
    g.save();
    g.fillStyle = 'rgba(40,10,6,0.4)'; g.beginPath(); g.arc(x + 2, y + 3, D * 1.08, 0, TAU); g.fill();
    g.beginPath();
    for (let i = 0; i <= 20; i++) { const a = (i / 20) * TAU, rr2 = D * (1.02 + 0.07 * Math.sin(i * 2.7)); if (i) g.lineTo(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2); else g.moveTo(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2); }
    const wg = g.createRadialGradient(x - D * 0.35, y - D * 0.4, D * 0.1, x, y, D * 1.1);
    wg.addColorStop(0, '#d0503f'); wg.addColorStop(0.55, '#8e1f1f'); wg.addColorStop(1, '#4a0d0e');
    g.fillStyle = wg; g.fill(); g.lineWidth = 1; g.strokeStyle = INK; g.stroke();
    g.beginPath(); g.arc(x, y, D * 0.74, 0, TAU); g.lineWidth = 0.9; g.strokeStyle = 'rgba(255,220,190,0.45)'; g.stroke();
    drawIcon(g, 'battle', x, y, D * 1.15, '#f6e6c4', { shadow: 'rgba(40,0,0,0.8)' });
    g.restore();
  },

  shot(g, _v, a, b, h, k) {
    // a cannon's track, inked: a dotted arc and the ball
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 - Math.hypot(b.x - a.x, b.y - a.y) * 0.18;
    g.beginPath(); g.moveTo(a.x, a.y); g.quadraticCurveTo(mx, my, b.x, b.y); g.setLineDash([1.5, 3]); g.lineWidth = 1.2; g.strokeStyle = DARK[h]; g.stroke(); g.setLineDash([]);
    const t = k, px = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * mx + t * t * b.x, py = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * my + t * t * b.y;
    g.beginPath(); g.arc(px, py, 2.6, 0, TAU); g.fillStyle = INK; g.fill();
    if (k > 0.6) { g.beginPath(); for (let i = 0; i < 8; i++) { const an = i * TAU / 8; g.moveTo(b.x + Math.cos(an) * 3, b.y + Math.sin(an) * 3); g.lineTo(b.x + Math.cos(an) * 7, b.y + Math.sin(an) * 7); } g.lineWidth = 1.2; g.strokeStyle = '#8e1f1f'; g.stroke(); }
  },

  light(g, v) {
    // the lamp: a warm pool upper-left of centre, falling off to the table's dark edge. Paper is lit, never glows.
    const lx = v.w * 0.42, ly = v.h * 0.3, R = Math.hypot(v.w, v.h);
    const gr = g.createRadialGradient(lx, ly, R * 0.05, lx, ly, R * 0.85);
    gr.addColorStop(0, 'rgba(255,236,200,0.08)'); gr.addColorStop(0.55, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(20,10,0,0.24)');
    g.fillStyle = gr; g.fillRect(0, 0, v.w, v.h);
  },
};

function rr(g: G, x: number, y: number, w: number, h: number, r: number) { g.beginPath(); g.roundRect(x, y, w, h, r); }
/** Engraving material for the minis: three tones of the house colour on paper, hatched in the shadows. */
function engraveFn(h: House) {
  const F = rgb(FACE[h]), P = rgb(PAPER_HI), Dk = rgb(DARK[h]);
  const light = mix(F, P, 0.62), mid = mix(F, P, 0.12);
  return (_r: number, _g: number, _b: number, a: number, x: number, y: number, L: number): [number, number, number, number] => {
    const A = a < 128 ? a * 0.6 : 255;
    if (L > 0.62) return [light[0], light[1], light[2], A];
    if (L > 0.3) return [mid[0], mid[1], mid[2], A];
    // the shadow side: engraved diagonal hatching, ink over the house's dark
    return (x + y) % 3 === 0 ? [INK_RGB[0], INK_RGB[1], INK_RGB[2], A] : [Dk[0], Dk[1], Dk[2], A];
  };
}
export const chartTokens = { INK, PAPER, GILT, WASH, DARK, FACE };
void (null as unknown as Sys); void (null as unknown as Pt); void (null as unknown as StarKind);
