// Small modelled pieces for the detail tier: orbital shipyards, gun platforms, the citadel, the warp gate, shield
// domes; plus asteroid rocks and hyperlane beacon buoys. All baked into cached sprites (device px).
import { type RGB, TAU, LIGHT, css, lit, rgb, mix, canvas, SpriteCache, sizeBucket, rand } from './util.ts';

const cache = new SpriteCache<{ img: HTMLCanvasElement; s: number; size: number }>(200);

function bev(g: CanvasRenderingContext2D, pts: [number, number][], col: RGB, d: number) {
  // bevelled block: facets lit by normal, top face gradient, edge highlights
  const n = pts.length;
  let a = 0; for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; }
  const sg = a >= 0 ? 1 : -1;
  const ns = pts.map((p, i) => { const q = pts[(i + 1) % n]; const ex = q[0] - p[0], ey = q[1] - p[1], l = Math.hypot(ex, ey) || 1; return [sg * ey / l, -sg * ex / l]; });
  let cx = 0, cy = 0; for (const p of pts) { cx += p[0] / n; cy += p[1] / n; }
  const Q = pts.map(p => { const dx = cx - p[0], dy = cy - p[1], l = Math.hypot(dx, dy) || 1; const k = Math.min(d, l * 0.6); return [p[0] + dx / l * k, p[1] + dy / l * k]; });
  g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath();
  g.fillStyle = 'rgba(4,4,10,0.9)'; g.fill(); g.strokeStyle = 'rgba(4,4,10,0.8)'; g.lineWidth = 1; g.stroke();
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, k = ns[i][0] * LIGHT.x + ns[i][1] * LIGHT.y;
    g.beginPath(); g.moveTo(pts[i][0], pts[i][1]); g.lineTo(pts[j][0], pts[j][1]); g.lineTo(Q[j][0], Q[j][1]); g.lineTo(Q[i][0], Q[i][1]); g.closePath();
    g.fillStyle = css(lit(col, k * 0.55 - 0.1)); g.fill();
  }
  const gr = g.createLinearGradient(cx + LIGHT.x * d * 3, cy + LIGHT.y * d * 3, cx - LIGHT.x * d * 3, cy - LIGHT.y * d * 3);
  gr.addColorStop(0, css(lit(col, 0.25))); gr.addColorStop(1, css(lit(col, -0.2)));
  g.beginPath(); Q.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.fillStyle = gr; g.fill();
}

export type Structure = 'shipyard' | 'battery' | 'fortress' | 'pshield' | 'gate' | 'depot' | 'sensor';
/** A structure sprite of nominal size s (device px). */
export function structureSprite(kind: Structure, team: string, sDev: number) {
  const s = sizeBucket(sDev);
  return cache.get(`${kind}|${team}|${s}`, () => {
    const size = Math.ceil(s * 2.6);
    const c = canvas(size, size);
    const g = c.getContext('2d')!;
    const o = size / 2;
    const T = rgb(team), steel: RGB = [130, 136, 152], dark: RGB = [52, 56, 70];
    g.lineJoin = 'round';
    switch (kind) {
      case 'shipyard': {
        // a drydock frame: two gantry rails with cross ribs, a hull under construction inside, work lights
        for (const sx of [-1, 1]) bev(g, [[o + sx * s * 0.62, o - s], [o + sx * s * 0.42, o - s], [o + sx * s * 0.42, o + s], [o + sx * s * 0.62, o + s]], steel, s * 0.08);
        g.strokeStyle = css(lit(steel, -0.2)); g.lineWidth = Math.max(1, s * 0.07);
        for (let i = 0; i < 5; i++) { const y = o - s * 0.85 + i * s * 0.42; g.beginPath(); g.moveTo(o - s * 0.45, y); g.lineTo(o + s * 0.45, y); g.stroke(); }
        bev(g, [[o, o - s * 0.8], [o + s * 0.22, o - s * 0.3], [o + s * 0.22, o + s * 0.75], [o - s * 0.22, o + s * 0.75], [o - s * 0.22, o - s * 0.3]], mix(T, steel, 0.5), s * 0.07);
        for (const [x, y] of [[-0.52, -0.9], [0.52, -0.9], [-0.52, 0.9], [0.52, 0.9]]) { g.fillStyle = 'rgba(255,220,150,0.95)'; g.beginPath(); g.arc(o + x * s, o + y * s, Math.max(0.8, s * 0.07), 0, TAU); g.fill(); }
        break;
      }
      case 'battery': {
        // an octagonal gun platform with a twin barrel turret
        const pts: [number, number][] = [];
        for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + Math.PI / 8; pts.push([o + Math.cos(a) * s * 0.7, o + Math.sin(a) * s * 0.7]); }
        bev(g, pts, dark, s * 0.14);
        g.strokeStyle = 'rgba(4,4,10,0.95)'; g.lineWidth = Math.max(1.2, s * 0.2); g.lineCap = 'round';
        for (const dx of [-0.12, 0.12]) { g.beginPath(); g.moveTo(o + dx * s, o); g.lineTo(o + dx * s + s * 0.45, o - s * 0.85); g.stroke(); }
        g.strokeStyle = css(steel); g.lineWidth = Math.max(0.7, s * 0.1);
        for (const dx of [-0.12, 0.12]) { g.beginPath(); g.moveTo(o + dx * s, o); g.lineTo(o + dx * s + s * 0.45, o - s * 0.85); g.stroke(); }
        const gr = g.createRadialGradient(o - s * 0.12, o - s * 0.15, 0, o, o, s * 0.32);
        gr.addColorStop(0, css(lit(steel, 0.5))); gr.addColorStop(1, css(lit(steel, -0.5)));
        g.fillStyle = gr; g.beginPath(); g.arc(o, o, s * 0.32, 0, TAU); g.fill();
        g.fillStyle = css(T); g.beginPath(); g.arc(o, o, s * 0.1, 0, TAU); g.fill();
        break;
      }
      case 'fortress': {
        // the citadel: a star-fort block with corner towers and a spire
        const pts: [number, number][] = [];
        for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU - Math.PI / 2, r = i % 2 ? s * 0.55 : s * 0.95; pts.push([o + Math.cos(a) * r, o + Math.sin(a) * r]); }
        bev(g, pts, [96, 100, 116], s * 0.2);
        bev(g, [[o - s * 0.3, o - s * 0.3], [o + s * 0.3, o - s * 0.3], [o + s * 0.3, o + s * 0.3], [o - s * 0.3, o + s * 0.3]], mix(T, [90, 90, 100], 0.55), s * 0.3);
        g.fillStyle = 'rgba(255,230,170,0.9)';
        for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU - Math.PI / 2; g.beginPath(); g.arc(o + Math.cos(a) * s * 0.78, o + Math.sin(a) * s * 0.78, Math.max(0.7, s * 0.06), 0, TAU); g.fill(); }
        break;
      }
      case 'gate': {
        // a ring of segments with a glowing throat
        const gr = g.createRadialGradient(o, o, 0, o, o, s);
        gr.addColorStop(0, 'rgba(190,240,255,0.9)'); gr.addColorStop(0.55, 'rgba(90,170,255,0.35)'); gr.addColorStop(1, 'rgba(60,120,255,0)');
        g.fillStyle = gr; g.beginPath(); g.ellipse(o, o, s * 0.75, s * 0.95, 0, 0, TAU); g.fill();
        for (let i = 0; i < 8; i++) {
          const a0 = (i / 8) * TAU + 0.08, a1 = ((i + 1) / 8) * TAU - 0.08;
          g.strokeStyle = 'rgba(4,4,10,0.9)'; g.lineWidth = Math.max(2, s * 0.28);
          g.beginPath(); g.ellipse(o, o, s * 0.85, s * 1.05, 0, a0, a1); g.stroke();
          const k = Math.cos((a0 + a1) / 2 + 2.1);
          g.strokeStyle = css(lit(steel, k * 0.5)); g.lineWidth = Math.max(1.2, s * 0.18);
          g.beginPath(); g.ellipse(o, o, s * 0.85, s * 1.05, 0, a0, a1); g.stroke();
        }
        break;
      }
      case 'depot': {
        bev(g, [[o - s * 0.7, o - s * 0.45], [o + s * 0.7, o - s * 0.45], [o + s * 0.7, o + s * 0.45], [o - s * 0.7, o + s * 0.45]], [150, 120, 70], s * 0.12);
        for (const dx of [-0.35, 0, 0.35]) bev(g, [[o + dx * s - s * 0.13, o - s * 0.3], [o + dx * s + s * 0.13, o - s * 0.3], [o + dx * s + s * 0.13, o + s * 0.3], [o + dx * s - s * 0.13, o + s * 0.3]], [190, 160, 100], s * 0.06);
        break;
      }
      case 'sensor': {
        g.strokeStyle = css(steel); g.lineWidth = Math.max(1, s * 0.12);
        g.beginPath(); g.arc(o, o, s * 0.75, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
        g.beginPath(); g.moveTo(o, o); g.lineTo(o, o - s * 0.6); g.stroke();
        g.fillStyle = 'rgba(150,255,220,0.95)'; g.beginPath(); g.arc(o, o - s * 0.6, Math.max(0.8, s * 0.1), 0, TAU); g.fill();
        break;
      }
      case 'pshield': break;
    }
    return { img: c, s, size };
  });
}
export function drawStructure(g: CanvasRenderingContext2D, kind: Structure, team: string, x: number, y: number, s: number, sDev: number) {
  const sp = structureSprite(kind, team, sDev);
  const k = s / sp.s;
  g.drawImage(sp.img, x - (sp.size * k) / 2, y - (sp.size * k) / 2, sp.size * k, sp.size * k);
}

/** A planetary shield: a faint hex-shimmer bubble around the world (drawn over the planet). */
export function shieldDome(g: CanvasRenderingContext2D, x: number, y: number, r: number, lw: number) {
  const gr = g.createRadialGradient(x, y, r * 0.7, x, y, r);
  gr.addColorStop(0, 'rgba(120,220,255,0)'); gr.addColorStop(0.85, 'rgba(120,220,255,0.12)'); gr.addColorStop(1, 'rgba(170,240,255,0.32)');
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(190,245,255,0.55)'; g.lineWidth = lw; g.beginPath(); g.arc(x, y, r, Math.PI * 1.05, Math.PI * 1.7); g.stroke();
}

// ------------------------------------------------------------------ rocks + buoys
const rockCache = new SpriteCache<HTMLCanvasElement>(40);
/** A lumpy lit asteroid, variant v, s device px. */
export function rockSprite(v: number, sDev: number): HTMLCanvasElement {
  const s = Math.max(3, Math.round(sDev));
  return rockCache.get(`${v % 8}|${s}`, () => {
    const size = s * 2 + 4, c = canvas(size, size), g = c.getContext('2d')!;
    const r = rand(v * 31 + 7), o = size / 2;
    g.beginPath();
    const n = 9;
    for (let i = 0; i < n; i++) { const a = (i / n) * TAU, rr = s * (0.65 + r() * 0.35); g.lineTo(o + Math.cos(a) * rr, o + Math.sin(a) * rr * 0.85); }
    g.closePath();
    const gr = g.createRadialGradient(o + LIGHT.x * s * 0.5, o + LIGHT.y * s * 0.5, 0, o, o, s);
    const base: RGB = [[120, 110, 104], [104, 100, 110], [130, 118, 98]][v % 3] as RGB;
    gr.addColorStop(0, css(lit(base, 0.45))); gr.addColorStop(0.55, css(base)); gr.addColorStop(1, css(lit(base, -0.7)));
    g.fillStyle = gr; g.fill();
    g.strokeStyle = 'rgba(0,0,6,0.6)'; g.lineWidth = 0.8; g.stroke();
    return c;
  });
}

const buoyCache = new SpriteCache<HTMLCanvasElement>(12);
/** A hyperlane beacon buoy (s = radius, device px). */
export function buoySprite(sDev: number, lit_: boolean): HTMLCanvasElement {
  const s = Math.max(2, Math.round(sDev));
  return buoyCache.get(`${s}|${lit_ ? 1 : 0}`, () => {
    const size = s * 6, c = canvas(size, size), g = c.getContext('2d')!, o = size / 2;
    const glow = g.createRadialGradient(o, o, 0, o, o, s * 3);
    glow.addColorStop(0, lit_ ? 'rgba(200,235,255,0.55)' : 'rgba(170,200,255,0.25)'); glow.addColorStop(1, 'rgba(120,160,255,0)');
    g.fillStyle = glow; g.fillRect(0, 0, size, size);
    const gr = g.createRadialGradient(o - s * 0.3, o - s * 0.35, 0, o, o, s);
    gr.addColorStop(0, '#e8ecf6'); gr.addColorStop(0.5, '#7c8296'); gr.addColorStop(1, '#22242e');
    g.fillStyle = gr; g.beginPath(); g.arc(o, o, s, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(0,0,8,0.7)'; g.lineWidth = Math.max(0.6, s * 0.15); g.stroke();
    g.fillStyle = lit_ ? '#ffffff' : '#bfe6ff'; g.beginPath(); g.arc(o, o, s * 0.38, 0, TAU); g.fill();
    return c;
  });
}
