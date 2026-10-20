// Canvas renderer for the strategic map: neon Voronoi regions, stars, fleets,
// planned orders, intel signals and replay animation overlays.
import type { GameState, Region, Fleet, Pt, Signal, Order } from '../../../shared/sim/types.ts';
import { NEUTRAL_COLOR } from '../../../shared/config/content.ts';
import { Rng, hashString } from '../../../shared/sim/rng.ts';
import { pointInPoly } from '../../../shared/sim/mapgen.ts';

export interface FleetDraw { id: number; owner: number; ships: number; pos: Pt; alpha: number; name: string; fortified?: boolean; selected?: boolean; ghost?: boolean; cls?: string[] }
export interface Fx { kind: 'battle' | 'capture' | 'excavate' | 'clash' | 'build' | 'text'; pos: Pt; color: string; t0: number; dur: number; text?: string }

export interface DrawInput {
  state: GameState;
  you: number | null;
  visible: Set<number>;
  owners: (number | null)[];          // region owners to draw (replay overrides)
  fleets: FleetDraw[];
  selectedRegion: number | null;
  hoverRegion: number | null;
  highlight: Map<number, string>;     // region -> color (move targets etc.)
  plannedArrows: { from: Pt; to: Pt; label: string; color: string; dashed?: boolean; kind: Order['type'] }[];
  pathPreview: { pts: Pt[]; ok: boolean } | null;
  signals: Signal[];
  showSignals: boolean;
  fx: Fx[];
  now: number;
}

const TAU = Math.PI * 2;

export class MapRenderer {
  ctx: CanvasRenderingContext2D;
  cam = { x: 0, y: 0, z: 0.4 };
  w = 0; h = 0; dpr = 1;
  private stars: HTMLCanvasElement | null = null;
  private asteroidCache = new Map<number, Pt[]>();
  private nebulaBlobs: { p: Pt; r: number; c: string }[] = [];
  private seed = -1;
  fitted = false;
  private labelBoxes: { x: number; y: number; w: number; h: number }[] = [];

  constructor(public canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = r.width; this.h = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.stars = null;
  }

  fit(state: GameState, focus?: Pt) {
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const r of state.regions) for (const p of r.poly) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
    const z = Math.min(this.w / (maxX - minX + 80), this.h / (maxY - minY + 80));
    // leave room for the side panels on wide screens
    const side = this.w > 900 ? 360 : 0;
    const z2 = Math.min((this.w - side * 1.9) / (maxX - minX + 80), this.h / (maxY - minY + 80));
    const zz = side ? Math.max(z * 0.7, z2) : z;
    this.cam = { x: (focus ? focus.x * 0.3 : (minX + maxX) / 2), y: focus ? focus.y * 0.3 : (minY + maxY) / 2, z: zz };
    this.fitted = true;
  }

  toWorld(sx: number, sy: number): Pt { return { x: (sx - this.w / 2) / this.cam.z + this.cam.x, y: (sy - this.h / 2) / this.cam.z + this.cam.y }; }
  toScreen(p: Pt): Pt { return { x: (p.x - this.cam.x) * this.cam.z + this.w / 2, y: (p.y - this.cam.y) * this.cam.z + this.h / 2 }; }

  regionAt(state: GameState, sx: number, sy: number): number | null {
    const p = this.toWorld(sx, sy);
    for (const r of state.regions) if (pointInPoly(p, r.poly)) return r.id;
    return null;
  }

  fleetAt(fleets: FleetDraw[], sx: number, sy: number): FleetDraw | null {
    let best: FleetDraw | null = null, bd = 1e9;
    for (const f of fleets) {
      if (f.ghost) continue;
      const s = this.toScreen(f.pos);
      const d = Math.hypot(s.x - sx, s.y - sy);
      if (d < 16 && d < bd) { bd = d; best = f; }
    }
    return best;
  }

  /** Screen-constant size in world units. */
  px(n: number) { return n / this.cam.z; }

  draw(I: DrawInput) {
    const { ctx } = this;
    const st = I.state;
    if (this.seed !== st.seed) this.prepare(st);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // ---------------------------------------------------------------- background
    const bg = ctx.createRadialGradient(this.w * 0.5, this.h * 0.45, 0, this.w * 0.5, this.h * 0.5, Math.max(this.w, this.h) * 0.8);
    bg.addColorStop(0, '#1a1030'); bg.addColorStop(0.6, '#0d0819'); bg.addColorStop(1, '#05030b');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, this.w, this.h);
    if (!this.stars) this.stars = makeStars(this.w, this.h, st.seed);
    ctx.save();
    const par = { x: -this.cam.x * this.cam.z * 0.05, y: -this.cam.y * this.cam.z * 0.05 };
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) ctx.drawImage(this.stars, ((par.x % this.w) + ox * this.w), ((par.y % this.h) + oy * this.h), this.w, this.h);
    ctx.restore();

    // ---------------------------------------------------------------- world
    ctx.save();
    ctx.translate(this.w / 2, this.h / 2);
    ctx.scale(this.cam.z, this.cam.z);
    ctx.translate(-this.cam.x, -this.cam.y);

    // deep-space nebula haze
    for (const b of this.nebulaBlobs) {
      const g = ctx.createRadialGradient(b.p.x, b.p.y, 0, b.p.x, b.p.y, b.r);
      g.addColorStop(0, b.c); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.p.x, b.p.y, b.r, 0, TAU); ctx.fill();
    }

    const colorOf = (o: number | null | undefined) => (o === null || o === undefined || o < 0 ? NEUTRAL_COLOR : st.players[o]?.color ?? NEUTRAL_COLOR);

    // region fills
    for (const r of st.regions) {
      const owner = I.owners[r.id];
      path(ctx, r.poly);
      ctx.fillStyle = owner === null ? 'rgba(40,30,70,0.30)' : hexA(colorOf(owner), 0.13);
      ctx.fill();
      if (r.feature === 'nebula') {
        const g = ctx.createRadialGradient(r.centroid.x, r.centroid.y, 0, r.centroid.x, r.centroid.y, 260);
        g.addColorStop(0, 'rgba(190,70,255,0.28)'); g.addColorStop(1, 'rgba(120,40,200,0.02)');
        ctx.fillStyle = g; ctx.fill();
      }
      if (r.feature === 'asteroids') {
        ctx.fillStyle = 'rgba(200,190,230,0.35)';
        for (const p of this.asteroidCache.get(r.id) ?? []) { ctx.beginPath(); ctx.arc(p.x, p.y, 2.2 + Math.abs((p.x * 7 + p.y) % 3), 0, TAU); ctx.fill(); }
      }
      if (r.kind === 'void') {
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; path(ctx, r.poly); ctx.fill();
      }
      if (I.highlight.has(r.id)) {
        path(ctx, r.poly);
        ctx.fillStyle = hexA(I.highlight.get(r.id)!, 0.13 + 0.06 * Math.sin(I.now / 250));
        ctx.fill();
      }
      if (I.hoverRegion === r.id) { path(ctx, r.poly); ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fill(); }
      if (I.you !== null && !I.visible.has(r.id)) { path(ctx, r.poly); ctx.fillStyle = 'rgba(3,2,8,0.42)'; ctx.fill(); }
    }

    // wreckage: persistent scars of old battles
    for (const r of st.regions) {
      if (!r.wreckage) continue;
      const rng = new Rng(hashString(`wreck${r.id}`));
      ctx.fillStyle = 'rgba(255,170,120,0.25)';
      const n = Math.min(40, r.wreckage * 3);
      for (let i = 0; i < n; i++) {
        const a = rng.next() * TAU, d = 30 + rng.next() * 70;
        ctx.save(); ctx.translate(r.site.x + Math.cos(a) * d, r.site.y + Math.sin(a) * d); ctx.rotate(rng.next() * TAU);
        ctx.fillRect(-3, -1, 6 + rng.next() * 4, 2); ctx.restore();
      }
    }

    // neon inset borders (clip to region, stroke wide => inner half shows)
    for (const r of st.regions) {
      const owner = I.owners[r.id];
      const c = colorOf(owner);
      ctx.save();
      path(ctx, r.poly); ctx.clip();
      path(ctx, r.poly);
      ctx.lineJoin = 'round';
      if (owner !== null) {
        ctx.strokeStyle = hexA(c, 0.85); ctx.lineWidth = 16; ctx.stroke();
        ctx.strokeStyle = hexA(c, 0.25); ctx.lineWidth = 34; ctx.stroke();
      } else {
        ctx.strokeStyle = 'rgba(150,140,190,0.32)'; ctx.lineWidth = 9; ctx.stroke();
      }
      if (r.kind === 'crown' || r.kind === 'throne') {
        ctx.setLineDash([14, 10]); ctx.strokeStyle = 'rgba(255,215,120,0.55)'; ctx.lineWidth = 26; ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.restore();
    }
    // separating seams
    ctx.strokeStyle = 'rgba(4,2,10,0.95)'; ctx.lineWidth = 3;
    for (const r of st.regions) { path(ctx, r.poly); ctx.stroke(); }
    if (I.selectedRegion !== null) {
      const r = st.regions[I.selectedRegion];
      ctx.save(); path(ctx, r.poly); ctx.clip(); path(ctx, r.poly);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 7; ctx.stroke(); ctx.restore();
    }
    // outer rim glow
    // (drawn implicitly by region borders)

    // ---------------------------------------------------------------- sites & labels
    this.labelBoxes = [];
    const prio = (r: Region) => ({ throne: 0, crown: 1, home: 2, relic: 3, colony: 4, void: 5 })[r.kind];
    for (const r of st.regions.slice().sort((a, b) => prio(a) - prio(b))) this.drawSite(r, I, colorOf(I.owners[r.id]));

    // ---------------------------------------------------------------- signals (intel)
    if (I.showSignals) {
      for (const sg of I.signals) {
        const r = st.regions[sg.region];
        const c = sg.about !== null && sg.about >= 0 ? colorOf(sg.about) : '#ff9a3c';
        const m = /(.+?) → (.+?),/.exec(sg.text.replace(/^Fleet movement \(\w+\) /, ''));
        if (m) {
          const a = st.regions.find(x => x.name === m[1]);
          const b = st.regions.find(x => x.name === m[2]);
          if (a && b) { this.arrow(a.site, b.site, c, sg.confidence === 'inferred', `?${sg.pulse}`, 0.75); continue; }
        }
        ctx.strokeStyle = hexA(c, 0.8); ctx.lineWidth = this.px(1.5); ctx.setLineDash([this.px(4), this.px(4)]);
        ctx.beginPath(); ctx.arc(r.site.x, r.site.y, this.px(26) + 6 * Math.sin(I.now / 300), 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      }
    }

    // ---------------------------------------------------------------- planned orders
    for (const a of I.plannedArrows) this.arrow(a.from, a.to, a.color, !!a.dashed, a.label, 1);
    if (I.pathPreview && I.pathPreview.pts.length > 1) {
      ctx.strokeStyle = I.pathPreview.ok ? 'rgba(140,255,200,0.9)' : 'rgba(255,90,90,0.9)';
      ctx.lineWidth = this.px(3); ctx.setLineDash([this.px(8), this.px(6)]); ctx.lineDashOffset = -I.now / 40;
      ctx.beginPath(); I.pathPreview.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
      ctx.setLineDash([]); ctx.lineDashOffset = 0;
    }

    // ---------------------------------------------------------------- fleets
    for (const f of I.fleets) this.drawFleet(f, colorOf(f.owner), I.now);

    // ---------------------------------------------------------------- fx
    for (const fx of I.fx) {
      const t = (I.now - fx.t0) / fx.dur;
      if (t < 0 || t > 1) continue;
      const c = fx.color;
      if (fx.kind === 'battle' || fx.kind === 'clash') {
        for (let k = 0; k < 3; k++) {
          const tt = (t + k * 0.18) % 1;
          ctx.strokeStyle = hexA(c, (1 - tt) * 0.9); ctx.lineWidth = this.px(3);
          ctx.beginPath(); ctx.arc(fx.pos.x, fx.pos.y, this.px(10) + tt * this.px(60), 0, TAU); ctx.stroke();
        }
        const g = ctx.createRadialGradient(fx.pos.x, fx.pos.y, 0, fx.pos.x, fx.pos.y, this.px(45));
        g.addColorStop(0, `rgba(255,240,200,${0.7 * (1 - t)})`); g.addColorStop(1, 'rgba(255,120,60,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(fx.pos.x, fx.pos.y, this.px(45), 0, TAU); ctx.fill();
      } else if (fx.kind === 'capture' || fx.kind === 'excavate' || fx.kind === 'build') {
        ctx.strokeStyle = hexA(c, 1 - t); ctx.lineWidth = this.px(4);
        ctx.beginPath(); ctx.arc(fx.pos.x, fx.pos.y, this.px(20) + t * this.px(fx.kind === 'build' ? 30 : 90), 0, TAU); ctx.stroke();
      }
      if (fx.text) {
        ctx.font = `600 ${this.px(13)}px "Rajdhani", system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = hexA(fx.kind === 'text' ? c : '#ffffff', Math.min(1, (1 - t) * 2));
        ctx.fillText(fx.text, fx.pos.x, fx.pos.y - this.px(36) - t * this.px(18));
      }
    }
    ctx.restore();
  }

  private drawSite(r: Region, I: DrawInput, c: string) {
    const { ctx } = this;
    const p = r.site;
    const t = I.now / 1000;
    const k = this.px(1);
    const size = (r.kind === 'throne' ? 15 : r.kind === 'home' ? 12 : r.kind === 'crown' ? 12 : r.kind === 'void' ? 3 : 7 + r.dev) * Math.max(1, Math.min(2.2, k * 1.6));
    // glow
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size * 4);
    g.addColorStop(0, hexA(c, 0.55)); g.addColorStop(1, hexA(c, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, size * 4, 0, TAU); ctx.fill();
    ctx.lineWidth = Math.max(1.5, k * 1.8);
    if (r.kind === 'void') {
      ctx.fillStyle = 'rgba(200,200,255,0.5)'; ctx.beginPath(); ctx.arc(p.x, p.y, size, 0, TAU); ctx.fill();
    } else if (r.kind === 'throne') {
      ctx.strokeStyle = '#ffe9a8';
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(p.x, p.y, size * (1.2 + i * 0.55), t * (i % 2 ? -0.4 : 0.3) + i, t * (i % 2 ? -0.4 : 0.3) + i + Math.PI * 1.4); ctx.stroke(); }
      star(ctx, p, size * 0.9, 8, '#fff6d8');
      if (I.state.fleets.some(f => f.owner === -1)) {
        ctx.strokeStyle = `rgba(220,120,255,${0.5 + 0.4 * Math.sin(t * 3)})`; ctx.lineWidth = k * 3;
        ctx.beginPath(); ctx.arc(p.x, p.y, size * 3.2, 0, TAU); ctx.stroke();
      }
    } else if (r.kind === 'crown') {
      ctx.strokeStyle = '#ffd86b';
      ctx.beginPath(); ctx.arc(p.x, p.y, size * 1.5, 0, TAU); ctx.stroke();
      crown(ctx, p, size, '#ffe7a0');
    } else if (r.kind === 'home') {
      ctx.strokeStyle = hexA(c, 0.95);
      ctx.beginPath(); ctx.arc(p.x, p.y, size * 1.25, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(p.x, p.y, size * 1.8, t * 0.5, t * 0.5 + Math.PI * 1.5); ctx.stroke();
      planet(ctx, p, size * 0.8, c);
    } else if (r.kind === 'relic') {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.PI / 4 + (r.relic === 'unclaimed' ? t * 0.6 : 0));
      ctx.strokeStyle = r.relic === 'unclaimed' ? '#7ff7ff' : 'rgba(127,247,255,0.35)';
      ctx.strokeRect(-size, -size, size * 2, size * 2);
      ctx.fillStyle = r.relic === 'unclaimed' ? 'rgba(127,247,255,0.5)' : 'rgba(127,247,255,0.15)'; ctx.fillRect(-size * 0.45, -size * 0.45, size * 0.9, size * 0.9);
      ctx.restore();
    } else {
      planet(ctx, p, size, c);
    }
    // buildings pips
    const pips: string[] = [];
    if (r.buildings.shipyard) pips.push('⚙'.repeat(r.buildings.shipyard));
    if (r.buildings.fortress) pips.push('⛨'.repeat(r.buildings.fortress));
    if (r.buildings.mine) pips.push('⛏'.repeat(r.buildings.mine));
    if (r.buildings.tradehub) pips.push('¢'.repeat(r.buildings.tradehub));
    if (r.buildings.sensor) pips.push('◎'.repeat(r.buildings.sensor));

    // labels (with simple collision avoidance: try above, then below, then shifted)
    const fs = Math.max(11, Math.min(15, 13 * Math.sqrt(k)));
    ctx.textAlign = 'center';
    ctx.font = `600 ${this.px(fs)}px "Rajdhani", system-ui, sans-serif`;
    ctx.fillStyle = r.kind === 'crown' || r.kind === 'throne' ? 'rgba(255,230,160,0.95)' : 'rgba(220,215,245,0.82)';
    const name = r.name.toUpperCase();
    const lw = ctx.measureText(name).width + this.px(1.2) * name.length;
    const lh = this.px(fs);
    const cands = [
      { x: p.x, y: p.y - size * 1.9 - this.px(6) },
      { x: p.x, y: p.y - size * 1.9 - this.px(6) - lh * 1.1 },
      { x: p.x + lw * 0.45, y: p.y - size * 1.9 - this.px(6) },
      { x: p.x - lw * 0.45, y: p.y - size * 1.9 - this.px(6) },
      { x: p.x, y: p.y + size * 1.9 + this.px(30) },
      { x: p.x + lw * 0.45, y: p.y + size * 1.9 + this.px(30) },
      { x: p.x - lw * 0.45, y: p.y + size * 1.9 + this.px(30) },
    ];
    let spot = cands[0], free = false;
    const hit = (c: Pt) => { const box = { x: c.x - lw / 2, y: c.y - lh, w: lw, h: lh * 1.2 }; return this.labelBoxes.some(b => box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y); };
    for (const c of cands) if (!hit(c)) { spot = c; free = true; break; }
    const minor = r.kind === 'colony' || r.kind === 'void' || r.kind === 'relic';
    if (!free) ctx.globalAlpha = minor && I.hoverRegion !== r.id ? 0 : 0.45;
    this.labelBoxes.push({ x: spot.x - lw / 2, y: spot.y - lh, w: lw, h: lh * 1.2 });
    const ly = spot.y;
    letterSpaced(ctx, name, spot.x, ly, this.px(1.2));
    ctx.globalAlpha = 1;
    const below = spot.y > p.y;
    ctx.font = `500 ${this.px(11)}px "Rajdhani", system-ui, sans-serif`;
    const sub: string[] = [];
    if (r.garrison > 0) sub.push(`⛨${r.garrison}`);
    else if (r.garrison < 0) sub.push('⛨?');
    if (r.owner !== null && r.dev > 0 && r.kind !== 'void') sub.push(`dev ${r.dev}`);
    if (pips.length) sub.push(pips.join(' '));
    if (r.project) sub.push(`⏳${I.state.rules.projects[r.project.key]?.name ?? r.project.key}`);
    if (r.memorials.length) sub.push(`✝${r.memorials.length}`);
    if (sub.length) { ctx.fillStyle = 'rgba(200,195,230,0.7)'; ctx.fillText(sub.join('  '), below ? spot.x : p.x, below ? spot.y + this.px(13) : p.y + size * 1.9 + this.px(14)); }
    // influence progress (your loyalty)
    if (I.you !== null && r.owner !== I.you && (r.loyalty[I.you] ?? 0) > 0) {
      const thr = r.owner === null ? I.state.rules.influence.flipThreshold : I.state.rules.influence.rivalFlipThreshold;
      const fr = Math.min(1, r.loyalty[I.you] / thr);
      ctx.strokeStyle = hexA(I.state.players[I.you].color, 0.9); ctx.lineWidth = this.px(3);
      ctx.beginPath(); ctx.arc(p.x, p.y, size * 2.3, -Math.PI / 2, -Math.PI / 2 + fr * TAU); ctx.stroke();
    }
  }

  private drawFleet(f: FleetDraw, c: string, now: number) {
    const { ctx } = this;
    const s = this.px(1);
    const p = f.pos;
    ctx.save();
    ctx.globalAlpha = f.alpha * (f.ghost ? 0.35 : 1);
    ctx.translate(p.x, p.y);
    const R = 11 * s;
    if (f.selected) {
      ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 2 * s;
      ctx.beginPath(); ctx.arc(0, 0, R * 1.7 + Math.sin(now / 200) * s, 0, TAU); ctx.stroke();
    }
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 2.2);
    g.addColorStop(0, hexA(c, 0.5)); g.addColorStop(1, hexA(c, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R * 2.2, 0, TAU); ctx.fill();
    // chevron
    ctx.fillStyle = f.owner === -1 ? '#e7b6ff' : c;
    ctx.strokeStyle = 'rgba(10,5,20,0.9)'; ctx.lineWidth = 1.5 * s;
    ctx.beginPath(); ctx.moveTo(0, -R); ctx.lineTo(R * 0.85, R * 0.75); ctx.lineTo(0, R * 0.35); ctx.lineTo(-R * 0.85, R * 0.75); ctx.closePath();
    ctx.fill(); ctx.stroke();
    if (f.fortified) { ctx.strokeStyle = hexA('#ffffff', 0.8); ctx.lineWidth = 1.5 * s; ctx.strokeRect(-R * 1.2, -R * 1.3, R * 2.4, R * 2.4); }
    // count badge
    ctx.fillStyle = 'rgba(8,4,16,0.9)';
    ctx.beginPath(); ctx.arc(R * 0.95, -R * 0.75, 7 * s, 0, TAU); ctx.fill();
    ctx.strokeStyle = c; ctx.lineWidth = 1 * s; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = `700 ${10 * s}px "Rajdhani", system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(f.ships), R * 0.95, -R * 0.72);
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  arrow(a: Pt, b: Pt, color: string, dashed: boolean, label: string, alpha: number) {
    const { ctx } = this;
    const dx = b.x - a.x, dy = b.y - a.y;
    const L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L, ny = dx / L;
    const bend = Math.min(60, L * 0.18);
    const cx = (a.x + b.x) / 2 + nx * bend, cy = (a.y + b.y) / 2 + ny * bend;
    const s = this.px(1);
    const shrink = 22 * s;
    const t1 = shrink / L, t2 = 1 - shrink / L;
    const q = (t: number) => ({ x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * cx + t * t * b.x, y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * cy + t * t * b.y });
    const p1 = q(t1), p2 = q(t2), pm = q(0.5), pb = q(t2 - 0.02);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color; ctx.lineWidth = 3 * s;
    if (dashed) ctx.setLineDash([7 * s, 6 * s]);
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y);
    const N = 16;
    for (let i = 1; i <= N; i++) { const pp = q(t1 + (t2 - t1) * (i / N)); ctx.lineTo(pp.x, pp.y); }
    ctx.stroke(); ctx.setLineDash([]);
    const ang = Math.atan2(p2.y - pb.y, p2.x - pb.x);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(p2.x + Math.cos(ang) * 9 * s, p2.y + Math.sin(ang) * 9 * s);
    ctx.lineTo(p2.x + Math.cos(ang + 2.5) * 9 * s, p2.y + Math.sin(ang + 2.5) * 9 * s);
    ctx.lineTo(p2.x + Math.cos(ang - 2.5) * 9 * s, p2.y + Math.sin(ang - 2.5) * 9 * s); ctx.fill();
    if (label) {
      ctx.fillStyle = 'rgba(8,4,16,0.92)'; ctx.beginPath(); ctx.arc(pm.x, pm.y, 9 * s, 0, TAU); ctx.fill();
      ctx.strokeStyle = color; ctx.lineWidth = 1.5 * s; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = `700 ${10 * s}px "Rajdhani", system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, pm.x, pm.y + 0.5 * s); ctx.textBaseline = 'alphabetic';
    }
    ctx.restore();
  }

  private prepare(st: GameState) {
    this.seed = st.seed;
    this.asteroidCache.clear();
    for (const r of st.regions) {
      if (r.feature !== 'asteroids') continue;
      const rng = new Rng(hashString(`ast${st.seed}:${r.id}`));
      const pts: Pt[] = [];
      for (let i = 0; i < 400 && pts.length < 70; i++) {
        const p = { x: r.centroid.x + (rng.next() - 0.5) * 420, y: r.centroid.y + (rng.next() - 0.5) * 420 };
        if (pointInPoly(p, r.poly) && Math.hypot(p.x - r.site.x, p.y - r.site.y) > 40) pts.push(p);
      }
      this.asteroidCache.set(r.id, pts);
    }
    const rng = new Rng(hashString(`neb${st.seed}`));
    const cols = ['rgba(120,50,200,0.22)', 'rgba(40,90,200,0.18)', 'rgba(200,50,140,0.14)', 'rgba(60,160,190,0.12)'];
    this.nebulaBlobs = Array.from({ length: 14 }, () => ({ p: { x: (rng.next() - 0.5) * 2600, y: (rng.next() - 0.5) * 2600 }, r: 250 + rng.next() * 600, c: rng.pick(cols) }));
  }
}

// ---------------------------------------------------------------- helpers
export function regionLayout(st: GameState, fleets: { id: number; region: number }[], scale = 2.5): Map<number, Pt> {
  const by = new Map<number, number[]>();
  for (const f of fleets) (by.get(f.region) ?? by.set(f.region, []).get(f.region)!).push(f.id);
  const out = new Map<number, Pt>();
  for (const [rid, ids] of by) {
    const r = st.regions[rid];
    ids.sort((a, b) => a - b);
    ids.forEach((id, i) => {
      const n = ids.length;
      // a little arc of tokens under the star, at a screen-constant distance
      const col = i % 6, row = Math.floor(i / 6);
      const m = Math.min(n - row * 6, 6);
      const dx = (col - (m - 1) / 2) * 26 * scale;
      const dy = (34 + row * 24) * scale;
      let p = { x: r.site.x + dx, y: r.site.y + dy + Math.abs(dx) * 0.15 };
      // keep the stack inside its own region: pull toward the centroid until it is
      for (let k = 1; k <= 6 && !pointInPoly(p, r.poly); k++) {
        const t = k / 6;
        const ax = r.site.x + (r.centroid.x - r.site.x) * t, ay = r.site.y + (r.centroid.y - r.site.y) * t;
        p = { x: ax + dx, y: ay + dy * (1 - t * 0.5) };
      }
      out.set(id, p);
    });
  }
  return out;
}

export function path(ctx: CanvasRenderingContext2D, poly: Pt[]) {
  ctx.beginPath();
  poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
}

export function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}

function letterSpaced(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, sp: number) {
  const w = ctx.measureText(text).width + sp * (text.length - 1);
  let cx = x - w / 2;
  const prev = ctx.textAlign;
  ctx.textAlign = 'left';
  for (const ch of text) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + sp; }
  ctx.textAlign = prev;
}

function planet(ctx: CanvasRenderingContext2D, p: Pt, r: number, c: string) {
  const g = ctx.createRadialGradient(p.x - r * 0.4, p.y - r * 0.4, r * 0.1, p.x, p.y, r);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, c); g.addColorStop(1, 'rgba(10,5,25,1)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
}

function star(ctx: CanvasRenderingContext2D, p: Pt, r: number, n: number, c: string) {
  ctx.fillStyle = c; ctx.beginPath();
  for (let i = 0; i < n * 2; i++) { const a = (i / (n * 2)) * TAU; const rr = i % 2 ? r * 0.45 : r; ctx.lineTo(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr); }
  ctx.closePath(); ctx.fill();
}

function crown(ctx: CanvasRenderingContext2D, p: Pt, r: number, c: string) {
  ctx.fillStyle = c; ctx.beginPath();
  ctx.moveTo(p.x - r, p.y + r * 0.6); ctx.lineTo(p.x - r, p.y - r * 0.3); ctx.lineTo(p.x - r * 0.5, p.y + r * 0.1);
  ctx.lineTo(p.x, p.y - r * 0.8); ctx.lineTo(p.x + r * 0.5, p.y + r * 0.1); ctx.lineTo(p.x + r, p.y - r * 0.3); ctx.lineTo(p.x + r, p.y + r * 0.6);
  ctx.closePath(); ctx.fill();
}

function makeStars(w: number, h: number, seed: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  const x = c.getContext('2d')!;
  const rng = new Rng(seed ^ 0xabcdef);
  for (let i = 0; i < (w * h) / 900; i++) {
    const a = rng.next();
    x.fillStyle = `rgba(${200 + rng.int(0, 55)},${200 + rng.int(0, 55)},255,${0.15 + a * 0.6})`;
    const s = a > 0.97 ? 2 : 1;
    x.fillRect(rng.next() * w, rng.next() * h, s, s);
  }
  return c;
}
