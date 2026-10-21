// Canvas renderer for the strategic map: neon Voronoi regions, stars, fleets,
// planned orders, intel signals and replay animation overlays.
import type { GameState, Region, Fleet, Pt, Signal, Order } from '../../../shared/sim/types.ts';
import { NEUTRAL_COLOR } from '../../../shared/config/content.ts';
import { Rng, hashString } from '../../../shared/sim/rng.ts';
import { pointInPoly } from '../../../shared/sim/mapgen.ts';
import { TRAITS as WORLD_TRAITS, VEINS } from '../../../shared/config/empire.ts';

export interface FleetDraw { id: number; owner: number; ships: number; pos: Pt; alpha: number; name: string; fortified?: boolean; selected?: boolean; ghost?: boolean; cls?: string[]; idle?: boolean }
export interface Fx {
  kind: 'battle' | 'capture' | 'excavate' | 'clash' | 'build' | 'text' | 'explode' | 'ripple' | 'arrive';
  pos: Pt; color: string; t0: number; dur: number; text?: string;
  /** effect scale (explosion size, ripple radius in screen px) */
  size?: number;
}
/** Short-lived cosmetic particle (world position, screen-constant size). Purely visual: Math.random is fine here. */
interface Particle { x: number; y: number; vx: number; vy: number; t0: number; life: number; size: number; color: string; drag: number; streak: boolean; grav: number }
interface Track { x: number; y: number; vx: number; vy: number; ang: number; trail: { x: number; y: number; t: number }[]; born: number; travel: number; moving: boolean; draw: FleetDraw; color: string }
type Cam = { x: number; y: number; z: number };

/** The player asked the OS for less motion: skip trails, particles, camera flights and twinkles. */
const reducedMQ = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
export const reducedMotion = () => !!reducedMQ?.matches;
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOutBack = (t: number) => { const c = 1.9; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

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
  /** your owned regions that are cut off from your capital (half yield): red dashed borders */
  cutOff?: Set<number> | null;
  /** while one of your fleets is selected: regions where it would be out of supply (faint red) */
  unsupplied?: Set<number> | null;
}

const TAU = Math.PI * 2;

export class MapRenderer {
  ctx: CanvasRenderingContext2D;
  cam = { x: 0, y: 0, z: 0.4 };
  w = 0; h = 0; dpr = 1;
  private stars: HTMLCanvasElement | null = null;
  private starPattern: CanvasPattern | null = null;
  private bgCanvas: HTMLCanvasElement | null = null;
  private haze: { c: HTMLCanvasElement; x: number; y: number; w: number; h: number } | null = null;
  private asteroidCache = new Map<number, Pt[]>();
  private nebulaBlobs: { p: Pt; r: number; c: string }[] = [];
  private seed = -1;
  fitted = false;
  private labelBoxes: { x: number; y: number; w: number; h: number }[] = [];
  /** minor labels hidden by collisions: revealed (faded in) on hover */
  private hiddenLabels = new Map<number, { x: number; y: number; name: string; font: string; sp: number }>();

  // ---- animation state (all cosmetic)
  private lastNow = 0;
  private dt = 16;
  private camAnim: { from: Cam; to: Cam; t0: number; dur: number; set: Cam } | null = null;
  private hoverA = new Map<number, number>();
  private prevOwners: (number | null)[] | null = null;
  private ownersReset = true;
  private ownerFx: { rid: number; from: string; to: string; t0: number }[] = [];
  private tracks = new Map<number, Track>();
  private vanish: { d: FleetDraw; t0: number; ang: number; color: string }[] = [];
  private fleetsReset = true;
  private particles: Particle[] = [];
  private fxInit = new WeakSet<Fx>();
  private ownFx: Fx[] = [];
  private arrowSeen = new Map<string, number>();
  private arrowFrame = new Set<string>();
  private twinkles: { x: number; y: number; ph: number; sp: number; s: number; c: string }[] = [];
  private selFleet: number | null = null; private selFleetT0 = 0;
  private selRegion: number | null = null; private selRegionT0 = 0;
  private sparkAcc = 0;
  private now = 0;

  constructor(public canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    // labels are cached in the static layer: redraw once web fonts arrive
    document.fonts?.ready.then(() => this.invalidate()).catch(() => { /* */ });
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
    if (W === this.canvas.width && H === this.canvas.height && dpr === this.dpr && r.width === this.w && r.height === this.h) return;
    this.dpr = dpr;
    this.w = r.width; this.h = r.height;
    this.canvas.width = W;
    this.canvas.height = H;
    this.stars = null;
    this.bgCanvas = null;
    this.layerKey = '';
    // a few twinkling stars drawn live over the cached starfield (cosmetic randomness)
    const n = Math.round(Math.min(60, (r.width * r.height) / 24000));
    const cols = ['#ffffff', '#cfe0ff', '#ffe9c8', '#e2c8ff'];
    this.twinkles = Array.from({ length: n }, () => ({ x: Math.random() * r.width, y: Math.random() * r.height, ph: Math.random() * TAU, sp: 0.6 + Math.random() * 1.6, s: Math.random() < 0.2 ? 2 : 1.2, c: cols[(Math.random() * cols.length) | 0] }));
  }

  // ---------------------------------------------------------------- camera flights
  /** Glide the camera to p (and optionally zoom z). User input (drag/pinch/wheel) cancels the flight. */
  flyTo(p: Pt, z?: number, dur = 650) {
    const to = { x: p.x, y: p.y, z: z ?? this.cam.z };
    if (reducedMotion() || dur <= 0) { this.cam = { ...to }; this.camAnim = null; return; }
    this.camAnim = { from: { ...this.cam }, to, t0: performance.now(), dur, set: { ...this.cam } };
  }
  get flying() { return !!this.camAnim; }
  /** Is world point p inside the viewport, with a margin in screen px? */
  onScreen(p: Pt, margin = 40) {
    const s = this.toScreen(p);
    return s.x >= margin && s.y >= margin && s.x <= this.w - margin && s.y <= this.h - margin;
  }
  private stepCam(now: number) {
    const A = this.camAnim;
    if (!A) return;
    // somebody else moved the camera (drag, pinch, wheel): hand control back immediately
    if (Math.abs(this.cam.x - A.set.x) > 1e-6 || Math.abs(this.cam.y - A.set.y) > 1e-6 || Math.abs(this.cam.z - A.set.z) > 1e-9) { this.camAnim = null; return; }
    const t = clamp01((now - A.t0) / A.dur);
    const e = easeInOutCubic(t);
    const z = Math.exp(Math.log(A.from.z) + (Math.log(A.to.z) - Math.log(A.from.z)) * e);
    this.cam = { x: A.from.x + (A.to.x - A.from.x) * e, y: A.from.y + (A.to.y - A.from.y) * e, z };
    A.set = { ...this.cam };
    if (t >= 1) this.camAnim = null;
  }
  /** The next owners/fleets change is a reset (replay start/end), not something happening: don't animate it. */
  resetAnim() { this.ownersReset = true; this.fleetsReset = true; for (const t of this.tracks.values()) t.trail.length = 0; this.vanish = []; this.ownerFx = []; }

  fit(state: GameState, focus?: Pt) {
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const r of state.regions) for (const p of r.poly) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
    const z = Math.min(this.w / (maxX - minX + 80), this.h / (maxY - minY + 80));
    // leave room for the side panels on wide screens
    const side = this.w > 900 ? 360 : 0;
    const z2 = Math.min((this.w - side * 1.9) / (maxX - minX + 80), this.h / (maxY - minY + 80));
    const zz = side ? Math.max(z * 0.7, z2) : z;
    this.cam = { x: (focus ? focus.x * 0.3 : (minX + maxX) / 2), y: focus ? focus.y * 0.3 : (minY + maxY) / 2, z: zz };
    if (this.compact) {
      // phones: start zoomed in on your capital (about half the map visible); pan/pinch for the rest
      const zp = Math.max(z * 1.35, Math.min(0.32, this.w / 1400));
      this.cam = { x: focus ? focus.x * 0.6 : (minX + maxX) / 2, y: focus ? focus.y * 0.6 : (minY + maxY) / 2, z: zp };
    }
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
      if (d < (this.compact ? 26 : 16) && d < bd) { bd = d; best = f; }
    }
    return best;
  }

  /** Phone-sized viewport: smaller labels, bigger touch targets. */
  get compact() { return this.w > 0 && this.w <= 700; }

  /** Screen-constant size in world units. */
  px(n: number) { return n / this.cam.z; }

  /** Cached static layer (background, regions, borders, labels): redrawn only when its inputs change. */
  private layer: HTMLCanvasElement | null = null;
  private layerKey = '';
  private layerCam: Cam | null = null;
  private lastCam: Cam | null = null;
  private camMovedAt = 0;
  private ids = new WeakMap<object, number>();
  private nextObjId = 1;
  private objId(o: object): number { let v = this.ids.get(o); if (v === undefined) { v = this.nextObjId++; this.ids.set(o, v); } return v; }
  /** Force the static layer to be rebuilt on the next draw (e.g. web fonts finished loading). */
  invalidate() { this.layerKey = ''; this.layerCam = null; }

  draw(I: DrawInput) {
    const st = I.state;
    if (this.seed !== st.seed) this.prepare(st);
    const W = this.canvas.width, H = this.canvas.height;
    if (!W || !H) return;
    const now = I.now;
    this.dt = this.lastNow ? Math.min(100, Math.max(0, now - this.lastNow)) : 16;
    this.lastNow = now; this.now = now;
    this.stepCam(now);
    this.trackOwners(I);
    // hover & selection live in the dynamic pass (faded), so they don't force a rebuild of the static layer
    const base = [this.objId(st), this.objId(I.visible), I.you, I.owners.join(','), W, H, this.dpr, I.cutOff ? this.objId(I.cutOff) : 0].join('|');
    const cam = this.cam;
    if (!this.lastCam || cam.x !== this.lastCam.x || cam.y !== this.lastCam.y || cam.z !== this.lastCam.z) { this.camMovedAt = now; this.lastCam = { ...cam }; }
    if (!this.layer || this.layer.width !== W || this.layer.height !== H) {
      this.layer = document.createElement('canvas');
      this.layer.width = W; this.layer.height = H;
      this.layerKey = '';
    }
    const lc = this.layerCam;
    const camSame = !!lc && lc.x === cam.x && lc.y === cam.y && lc.z === cam.z;
    // while the camera is moving (drag, pinch, wheel, flights) the cached layer is blitted with the camera transform
    // instead of being redrawn every frame; it is rebuilt crisp once the camera settles (cheap frames on phones)
    const moving = !camSame && (now - this.camMovedAt < 140 || !!this.camAnim);
    const fast = base === this.layerKey && moving && !!lc && !!this.bgCanvas && Math.abs(Math.log(cam.z / lc.z)) < 1.2;
    if (!fast && (base !== this.layerKey || !camSame)) {
      const main = this.ctx;
      this.ctx = this.layer.getContext('2d')!;
      try { this.drawStatic(I); } finally { this.ctx = main; }
      this.layerKey = base;
      this.layerCam = { ...cam };
    }
    const { ctx } = this;
    if (fast && lc) {
      const k = cam.z / lc.z;
      const ox = (this.w / 2) * (1 - k) + (lc.x - cam.x) * cam.z, oy = (this.h / 2) * (1 - k) + (lc.y - cam.y) * cam.z;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.drawImage(this.bgCanvas!, 0, 0, this.w, this.h);
      // stars under the strip the shifted layer uncovers at the edge
      if (this.starPattern) {
        const px = -cam.x * cam.z * 0.05, py = -cam.y * cam.z * 0.05;
        ctx.save(); ctx.translate(((px % this.w) + this.w) % this.w, ((py % this.h) + this.h) % this.h);
        ctx.fillStyle = this.starPattern; ctx.fillRect(-this.w, -this.h, this.w * 2, this.h * 2); ctx.restore();
      }
      ctx.drawImage(this.layer, ox, oy, this.w * k, this.h * k);
    } else {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.layer, 0, 0);
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawTwinkles(now);
    ctx.save();
    ctx.translate(this.w / 2, this.h / 2);
    ctx.scale(this.cam.z, this.cam.z);
    ctx.translate(-this.cam.x, -this.cam.y);
    this.drawOwnerFx(I);
    this.drawHover(I);
    // pulsing move/target highlights
    if (I.highlight.size) {
      const a = 0.13 + 0.06 * Math.sin(I.now / 250);
      for (const [rid, col] of I.highlight) {
        const r = st.regions[rid];
        if (!r) continue;
        path(ctx, r.poly); ctx.fillStyle = hexA(col, a); ctx.fill();
      }
    }
    if (I.unsupplied?.size) {
      ctx.save();
      for (const rid of I.unsupplied) { const r = st.regions[rid]; if (!r || r.kind === 'void') continue; path(ctx, r.poly); ctx.fillStyle = 'rgba(255,70,100,0.07)'; ctx.fill(); }
      ctx.restore();
    }
    this.drawRegionSelection(I);
    // animated parts of sites
    for (const r of st.regions) this.drawSiteAnim(r, I, this.colorOf(st, I.owners[r.id]));
    this.drawDynamic(I);
    ctx.restore();
  }

  private colorOf(st: GameState, o: number | null | undefined) { return o === null || o === undefined || o < 0 ? NEUTRAL_COLOR : st.players[o]?.color ?? NEUTRAL_COLOR; }

  private drawStatic(I: DrawInput) {
    const { ctx } = this;
    const st = I.state;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // ---------------------------------------------------------------- background (pre-rendered gradient + one star-pattern pass)
    if (!this.stars || !this.bgCanvas) {
      this.stars = makeStars(this.w, this.h, st.seed);
      this.starPattern = ctx.createPattern(this.stars, 'repeat');
      this.bgCanvas = makeBackdrop(this.w, this.h);
    }
    ctx.drawImage(this.bgCanvas, 0, 0, this.w, this.h);
    if (this.starPattern) {
      const par = { x: -this.cam.x * this.cam.z * 0.05, y: -this.cam.y * this.cam.z * 0.05 };
      ctx.save();
      ctx.translate(((par.x % this.w) + this.w) % this.w, ((par.y % this.h) + this.h) % this.h);
      ctx.fillStyle = this.starPattern;
      ctx.fillRect(-this.w, -this.h, this.w * 2, this.h * 2);
      ctx.restore();
    }

    // ---------------------------------------------------------------- world
    ctx.save();
    ctx.translate(this.w / 2, this.h / 2);
    ctx.scale(this.cam.z, this.cam.z);
    ctx.translate(-this.cam.x, -this.cam.y);

    // deep-space nebula haze: soft, so a low-resolution bake scaled up looks the same and costs one blit
    if (this.haze) ctx.drawImage(this.haze.c, this.haze.x, this.haze.y, this.haze.w, this.haze.h);

    const colorOf = (o: number | null | undefined) => this.colorOf(st, o);

    // region fills
    for (const r of st.regions) {
      const owner = I.owners[r.id];
      path(ctx, r.poly);
      ctx.fillStyle = owner === null || owner === undefined ? 'rgba(40,30,70,0.30)' : hexA(colorOf(owner), 0.13);
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
      if (I.you !== null && !I.visible.has(r.id)) { path(ctx, r.poly); ctx.fillStyle = 'rgba(3,2,8,0.42)'; ctx.fill(); }
    }

    // ---------------------------------------------------------------- empire overlays: cut-off regions, warp-gate links
    if (I.cutOff?.size) {
      ctx.save();
      ctx.setLineDash([this.px(7), this.px(5)]); ctx.lineJoin = 'round';
      for (const rid of I.cutOff) {
        const r = st.regions[rid];
        if (!r) continue;
        path(ctx, r.poly);
        ctx.fillStyle = 'rgba(255,60,90,0.07)'; ctx.fill();
        ctx.strokeStyle = 'rgba(255,93,122,0.85)'; ctx.lineWidth = this.px(2); ctx.stroke();
      }
      ctx.restore();
    }
    {
      const gates = new Map<number, Region[]>();
      for (const r of st.regions) if (r.buildings.gate && r.owner !== null && I.owners[r.id] === r.owner) { const a = gates.get(r.owner) ?? []; a.push(r); gates.set(r.owner, a); }
      ctx.save();
      ctx.setLineDash([this.px(2), this.px(6)]); ctx.lineCap = 'round';
      for (const [o, gs] of gates) {
        ctx.strokeStyle = hexA(colorOf(o), o === I.you ? 0.55 : 0.3); ctx.lineWidth = this.px(o === I.you ? 2 : 1.4);
        for (let i = 0; i < gs.length; i++) for (let j = i + 1; j < gs.length; j++) { ctx.beginPath(); ctx.moveTo(gs[i].site.x, gs[i].site.y); ctx.lineTo(gs[j].site.x, gs[j].site.y); ctx.stroke(); }
      }
      ctx.restore();
    }

    // ---------------------------------------------------------------- sites & labels
    this.labelBoxes = [];
    this.hiddenLabels.clear();
    const prio = (r: Region) => ({ throne: 0, crown: 1, home: 2, relic: 3, colony: 4, void: 5 })[r.kind];
    for (const r of st.regions.slice().sort((a, b) => prio(a) - prio(b))) this.drawSite(r, I, colorOf(I.owners[r.id]));
    ctx.restore();
  }

  /** Everything that changes every frame: signals, planned orders, fleets, effects (world transform already set). */
  private drawDynamic(I: DrawInput) {
    const { ctx } = this;
    const st = I.state;
    const colorOf = (o: number | null | undefined) => this.colorOf(st, o);

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

    // ---------------------------------------------------------------- battles in progress
    const reduced = reducedMotion();
    const engs = st.engagements ?? [];
    this.sparkAcc += this.dt;
    const emit = !reduced && this.sparkAcc > (this.compact ? 140 : 90);
    if (emit) this.sparkAcc = 0;
    for (const e of engs) {
      const r = st.regions[e.region];
      if (!r) continue;
      const p = { x: r.site.x + this.px(30), y: r.site.y - this.px(26) };
      const pulse = 0.5 + 0.5 * Math.sin(I.now / 260);
      // firelight flicker: a ragged, uneven glow instead of a smooth sine
      const flick = reduced ? 1 : 0.8 + 0.35 * Math.sin(I.now / 47 + e.region) * Math.sin(I.now / 83 + e.region * 3);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, this.px(24));
      g.addColorStop(0, `rgba(255,140,70,${(0.35 + 0.25 * pulse) * flick})`); g.addColorStop(1, 'rgba(255,80,40,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, this.px(24), 0, TAU); ctx.fill();
      ctx.font = `700 ${this.px(15)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffd6b0'; ctx.fillText('⚔', p.x, p.y);
      ctx.font = `600 ${this.px(10)}px "Rajdhani", system-ui, sans-serif`; ctx.fillStyle = 'rgba(255,214,176,0.95)';
      ctx.fillText(`R${e.rounds}`, p.x, p.y + this.px(15));
      ctx.textBaseline = 'alphabetic';
      // sparks thrown off the fight, and the odd weapon flash at the site itself
      if (emit) {
        this.spark(p.x, p.y, Math.random() < 0.5 ? '#ffd27a' : '#ff8a4c', 2, 0.12, 420);
        if (Math.random() < 0.35) this.flash(r.site.x + (Math.random() - 0.5) * this.px(40), r.site.y + (Math.random() - 0.5) * this.px(30));
      }
    }
    // sieges: besieging fleets ring the region in their colour
    for (const f of st.fleets) {
      if (f.siege === null || f.siege === undefined || f.siege !== f.region || !f.ships.length) continue;
      const r = st.regions[f.region];
      ctx.strokeStyle = hexA(colorOf(f.owner), 0.75); ctx.lineWidth = this.px(2.5); ctx.setLineDash([this.px(6), this.px(5)]);
      ctx.lineDashOffset = -I.now / 60;
      ctx.beginPath(); ctx.arc(r.site.x, r.site.y, this.px(24), 0, TAU); ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
    }

    // ---------------------------------------------------------------- planned orders
    for (const a of I.plannedArrows) this.arrow(a.from, a.to, a.color, !!a.dashed, a.label, 1);
    // arrows that left the plan animate in again when they come back
    for (const k of this.arrowSeen.keys()) if (!this.arrowFrame.has(k)) this.arrowSeen.delete(k);
    this.arrowFrame.clear();
    if (I.pathPreview && I.pathPreview.pts.length > 1) {
      ctx.strokeStyle = I.pathPreview.ok ? 'rgba(140,255,200,0.9)' : 'rgba(255,90,90,0.9)';
      ctx.lineWidth = this.px(3); ctx.setLineDash([this.px(8), this.px(6)]); ctx.lineDashOffset = -I.now / 40;
      ctx.beginPath(); I.pathPreview.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
      ctx.setLineDash([]); ctx.lineDashOffset = 0;
      // the destination pulses so the end of the route reads at a glance
      const end = I.pathPreview.pts[I.pathPreview.pts.length - 1];
      const k = (I.now % 900) / 900;
      ctx.strokeStyle = I.pathPreview.ok ? `rgba(140,255,200,${0.8 * (1 - k)})` : `rgba(255,90,90,${0.8 * (1 - k)})`;
      ctx.lineWidth = this.px(2);
      ctx.beginPath(); ctx.arc(end.x, end.y, this.px(10 + 22 * k), 0, TAU); ctx.stroke();
    }

    // ---------------------------------------------------------------- fleets
    this.drawFleets(I);

    // ---------------------------------------------------------------- fx
    this.drawFx(I, I.fx);
    this.ownFx = this.ownFx.filter(f => I.now - f.t0 < f.dur);
    this.drawFx(I, this.ownFx);
    this.drawParticles(I.now);
  }

  // ================================================================ animated layers
  private drawTwinkles(now: number) {
    if (!this.twinkles.length || reducedMotion()) return;
    const { ctx } = this;
    // deeper parallax than the cached starfield, so the two layers slide past each other when panning
    const ox = -this.cam.x * this.cam.z * 0.09, oy = -this.cam.y * this.cam.z * 0.09;
    const t = now / 1000;
    for (const s of this.twinkles) {
      const a = 0.5 + 0.5 * Math.sin(t * s.sp + s.ph);
      if (a < 0.15) continue;
      const x = (((s.x + ox) % this.w) + this.w) % this.w, y = (((s.y + oy) % this.h) + this.h) % this.h;
      ctx.globalAlpha = a * 0.85;
      ctx.fillStyle = s.c;
      ctx.fillRect(x - s.s / 2, y - s.s / 2, s.s, s.s);
      if (s.s > 1.5 && a > 0.75) {
        ctx.globalAlpha = (a - 0.75) * 1.6;
        ctx.fillRect(x - 4, y - 0.5, 8, 1); ctx.fillRect(x - 0.5, y - 4, 1, 8);
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Detect region owner changes between frames (captures, defections) and animate them. */
  private trackOwners(I: DrawInput) {
    const prev = this.prevOwners;
    const cur = I.owners;
    if (prev && !this.ownersReset && prev.length === cur.length) {
      let changed: number[] | null = null;
      for (let i = 0; i < cur.length; i++) if ((prev[i] ?? null) !== (cur[i] ?? null)) (changed ??= []).push(i);
      // many at once is a reset (new state, fog reveal), not a capture
      if (changed && changed.length <= 4) {
        for (const rid of changed) {
          this.ownerFx.push({ rid, from: this.colorOf(I.state, prev[rid]), to: this.colorOf(I.state, cur[rid]), t0: I.now });
          if (!reducedMotion() && I.state.regions[rid]) this.burst(I.state.regions[rid].site, this.colorOf(I.state, cur[rid]), this.compact ? 10 : 16, 0.22);
        }
      }
      if (changed) this.prevOwners = cur.slice();
    } else this.prevOwners = cur.slice();
    this.ownersReset = false;
  }

  /** New owner colour floods out from the site and the border flares, then settles into the static layer. */
  private drawOwnerFx(I: DrawInput) {
    if (!this.ownerFx.length) return;
    const { ctx } = this;
    const DUR = 1300;
    this.ownerFx = this.ownerFx.filter(o => I.now - o.t0 < DUR);
    for (const o of this.ownerFx) {
      const r = I.state.regions[o.rid];
      if (!r) continue;
      const t = clamp01((I.now - o.t0) / DUR);
      ctx.save();
      path(ctx, r.poly); ctx.clip();
      // the old colour lingers and fades
      ctx.fillStyle = hexA(o.from, 0.16 * (1 - t)); ctx.fill();
      // the new colour floods outward from the site
      let R = 0;
      for (const q of r.poly) R = Math.max(R, Math.hypot(q.x - r.site.x, q.y - r.site.y));
      const e = easeOutCubic(clamp01(t / 0.7));
      ctx.fillStyle = hexA(o.to, 0.38 * (1 - t) + 0.05);
      ctx.beginPath(); ctx.arc(r.site.x, r.site.y, Math.max(1, R * e), 0, TAU); ctx.fill();
      ctx.restore();
      // the border flares in the new colour
      path(ctx, r.poly);
      ctx.strokeStyle = hexA(o.to, 0.9 * (1 - t)); ctx.lineWidth = this.px(2 + 3 * (1 - t)); ctx.stroke();
    }
  }

  private drawHover(I: DrawInput) {
    const { ctx } = this;
    const k = Math.min(1, this.dt / 110);
    if (I.hoverRegion !== null && !this.hoverA.has(I.hoverRegion)) this.hoverA.set(I.hoverRegion, 0);
    for (const [rid, a0] of this.hoverA) {
      const target = rid === I.hoverRegion ? 1 : 0;
      const a = a0 + (target - a0) * k * (target ? 1.4 : 1);
      if (a < 0.02 && !target) { this.hoverA.delete(rid); continue; }
      this.hoverA.set(rid, a);
      const r = I.state.regions[rid];
      if (!r) continue;
      path(ctx, r.poly);
      ctx.fillStyle = `rgba(255,255,255,${0.055 * a})`; ctx.fill();
      ctx.strokeStyle = `rgba(220,205,255,${0.35 * a})`; ctx.lineWidth = this.px(1.5); ctx.stroke();
      const hl = this.hiddenLabels.get(rid);
      if (hl) {
        ctx.font = hl.font; ctx.fillStyle = `rgba(220,215,245,${0.82 * a})`; ctx.textAlign = 'center';
        letterSpaced(ctx, hl.name, hl.x, hl.y, hl.sp);
      }
    }
  }

  private drawRegionSelection(I: DrawInput) {
    const rid = I.selectedRegion;
    if (rid !== this.selRegion) { this.selRegion = rid; this.selRegionT0 = I.now; }
    if (rid === null) return;
    const r = I.state.regions[rid];
    if (!r) return;
    const { ctx } = this;
    const k = clamp01((I.now - this.selRegionT0) / 320);
    const e = easeOutCubic(k);
    const c = this.colorOf(I.state, I.owners[rid]);
    // a soft flash when picked, then a glowing border with marching dashes
    path(ctx, r.poly);
    if (k < 1) { ctx.fillStyle = hexA(c === NEUTRAL_COLOR ? '#ffffff' : c, 0.18 * (1 - k)); ctx.fill(); }
    ctx.lineJoin = 'round';
    ctx.strokeStyle = hexA(c === NEUTRAL_COLOR ? '#cbb8ff' : c, 0.28 * e); ctx.lineWidth = this.px(7); ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${0.75 * e})`; ctx.lineWidth = this.px(1.6);
    ctx.setLineDash([this.px(10), this.px(7)]); ctx.lineDashOffset = reducedMotion() ? 0 : -I.now / 45;
    ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
    // rotating brackets around the site, closing in as the selection lands
    const size = this.siteSize(r);
    const rad = size * 2.6 + this.px(6) + (1 - e) * this.px(26);
    const rot = reducedMotion() ? 0 : I.now / 1600;
    ctx.strokeStyle = `rgba(255,255,255,${0.9 * e})`; ctx.lineWidth = this.px(2);
    for (let i = 0; i < 4; i++) {
      const a0 = rot + (i * TAU) / 4;
      ctx.beginPath(); ctx.arc(r.site.x, r.site.y, rad, a0, a0 + 0.55); ctx.stroke();
    }
  }

  /** The animated parts of a site (rotating rings, the Warden's pulse, crown glow): drawn every frame over the cached layer. */
  private drawSiteAnim(r: Region, I: DrawInput, c: string) {
    const { ctx } = this;
    const p = r.site;
    const t = I.now / 1000;
    const k = this.px(1);
    const size = this.siteSize(r);
    ctx.lineWidth = Math.max(1.5, k * 1.8);
    if (r.kind === 'throne') {
      // a slow golden breath and two turning light rays
      const br = 0.5 + 0.5 * Math.sin(t * 1.4);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size * 5.5);
      g.addColorStop(0, `rgba(255,236,170,${0.22 + 0.16 * br})`); g.addColorStop(1, 'rgba(255,200,90,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, size * 5.5, 0, TAU); ctx.fill();
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(t * 0.15);
      ctx.fillStyle = `rgba(255,240,190,${0.07 + 0.05 * br})`;
      for (let i = 0; i < 4; i++) { ctx.rotate(TAU / 4); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(size * 6, -size * 0.35); ctx.lineTo(size * 6, size * 0.35); ctx.closePath(); ctx.fill(); }
      ctx.restore();
      ctx.strokeStyle = '#ffe9a8';
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(p.x, p.y, size * (1.2 + i * 0.55), t * (i % 2 ? -0.4 : 0.3) + i, t * (i % 2 ? -0.4 : 0.3) + i + Math.PI * 1.4); ctx.stroke(); }
      if (I.state.fleets.some(f => f.owner === -1)) {
        ctx.strokeStyle = `rgba(220,120,255,${0.5 + 0.4 * Math.sin(t * 3)})`; ctx.lineWidth = k * 3;
        ctx.beginPath(); ctx.arc(p.x, p.y, size * 3.2, 0, TAU); ctx.stroke();
      }
    } else if (r.kind === 'crown') {
      // crowns shimmer: a soft ring breathing out of phase with its neighbours
      const br = 0.5 + 0.5 * Math.sin(t * 1.7 + r.id);
      ctx.strokeStyle = `rgba(255,216,107,${0.15 + 0.3 * br})`;
      ctx.lineWidth = k * (1.5 + br);
      ctx.beginPath(); ctx.arc(p.x, p.y, size * (1.9 + 0.25 * br), 0, TAU); ctx.stroke();
    } else if (r.kind === 'home') {
      ctx.strokeStyle = hexA(c, 0.95);
      ctx.beginPath(); ctx.arc(p.x, p.y, size * 1.8, t * 0.5, t * 0.5 + Math.PI * 1.5); ctx.stroke();
    } else if (r.kind === 'relic' && r.relic === 'unclaimed') {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.PI / 4 + t * 0.6);
      ctx.strokeStyle = '#7ff7ff';
      ctx.strokeRect(-size, -size, size * 2, size * 2);
      ctx.fillStyle = `rgba(127,247,255,${0.35 + 0.25 * Math.sin(t * 2.2)})`; ctx.fillRect(-size * 0.45, -size * 0.45, size * 0.9, size * 0.9);
      ctx.restore();
    }
  }

  // ================================================================ fleets
  /** Tracks fleets between frames: motion trails, heading, arrival pings, warp-in and fade-out. */
  private drawFleets(I: DrawInput) {
    const { ctx } = this;
    const now = I.now;
    const reduced = reducedMotion();
    const s = this.px(1);
    const seen = new Set<number>();
    const draws: { f: FleetDraw; tr: Track | null }[] = [];
    for (const f of I.fleets) {
      if (f.ghost) { draws.push({ f, tr: null }); continue; }
      seen.add(f.id);
      const color = this.colorOf(I.state, f.owner);
      let tr = this.tracks.get(f.id);
      if (!tr) {
        tr = { x: f.pos.x, y: f.pos.y, vx: 0, vy: 0, ang: 0, trail: [], born: this.fleetsReset || reduced ? -1e9 : now, travel: 0, moving: false, draw: f, color };
        this.tracks.set(f.id, tr);
        if (tr.born === now) this.ring(f.pos, color, 500, 6, 34);
      } else {
        const dx = f.pos.x - tr.x, dy = f.pos.y - tr.y;
        const d = Math.hypot(dx, dy);
        if (d > s * 160) { tr.trail.length = 0; tr.vx = tr.vy = 0; } // teleport (reset): no streak
        else {
          const dt = Math.max(1, this.dt);
          const a = Math.min(1, dt / 60);
          tr.vx += (dx / dt - tr.vx) * a; tr.vy += (dy / dt - tr.vy) * a;
        }
        const sp = Math.hypot(tr.vx, tr.vy) / s; // screen px per ms
        const moving = sp > 0.02 && f.alpha > 0;
        if (moving) tr.travel += d / s;
        else if (tr.moving && tr.travel > 40 && !reduced) {
          // arrival: a small ping where the fleet settles
          this.ring(f.pos, color, 650, 8, 30);
          tr.travel = 0;
        }
        if (!moving && sp < 0.005) tr.travel = 0;
        tr.moving = moving;
        // heading: face the direction of travel, ease back upright when parked
        const target = moving && sp > 0.05 ? Math.atan2(tr.vy, tr.vx) + Math.PI / 2 : 0;
        let da = target - tr.ang;
        while (da > Math.PI) da -= TAU;
        while (da < -Math.PI) da += TAU;
        tr.ang += da * Math.min(1, this.dt / (moving ? 90 : 260));
      }
      tr.x = f.pos.x; tr.y = f.pos.y; tr.draw = f; tr.color = color;
      if (!reduced) {
        if (tr.moving) tr.trail.push({ x: f.pos.x, y: f.pos.y, t: now });
        while (tr.trail.length && now - tr.trail[0].t > 420) tr.trail.shift();
      } else tr.trail.length = 0;
      draws.push({ f, tr });
    }
    // fleets that vanished (destroyed, merged, out of sight) fade out instead of popping
    for (const [id, tr] of this.tracks) {
      if (seen.has(id)) continue;
      this.tracks.delete(id);
      if (!this.fleetsReset && !reduced && tr.draw.alpha > 0) this.vanish.push({ d: tr.draw, t0: now, ang: tr.ang, color: tr.color });
    }
    this.fleetsReset = false;

    // trails under every token
    ctx.lineCap = 'round';
    for (const { tr } of draws) {
      if (!tr || tr.trail.length < 2) continue;
      const pts = tr.trail;
      for (let i = 1; i < pts.length; i++) {
        const k = i / pts.length;
        const age = clamp01(1 - (now - pts[i].t) / 420);
        ctx.strokeStyle = hexA(tr.color, 0.45 * k * age);
        ctx.lineWidth = s * (1 + 5 * k);
        ctx.beginPath(); ctx.moveTo(pts[i - 1].x, pts[i - 1].y); ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke();
      }
    }
    ctx.lineCap = 'butt';

    for (const { f, tr } of draws) {
      const color = tr?.color ?? this.colorOf(I.state, f.owner);
      let scale = 1, extraA = 1;
      if (tr && tr.born > 0) {
        const k = clamp01((now - tr.born) / 480);
        if (k < 1) { scale = Math.max(0.01, easeOutBack(k)); extraA = Math.min(1, k * 2.5); }
      }
      // selection pop
      if (f.selected && this.selFleet !== f.id) { this.selFleet = f.id; this.selFleetT0 = now; }
      this.drawFleet(f, color, now, scale, tr?.ang ?? 0, extraA, tr?.moving ?? false);
    }
    if (!I.fleets.some(f => f.selected)) this.selFleet = null;

    this.vanish = this.vanish.filter(v => now - v.t0 < 420);
    for (const v of this.vanish) {
      const k = clamp01((now - v.t0) / 420);
      this.drawFleet({ ...v.d, selected: false, idle: false }, v.color, now, 1 + 0.5 * k, v.ang, 1 - k, false);
    }
  }

  // ================================================================ effects & particles
  private drawFx(I: DrawInput, list: Fx[]) {
    const { ctx } = this;
    const reduced = reducedMotion();
    for (const fx of list) {
      const t = (I.now - fx.t0) / fx.dur;
      if (t < 0 || t > 1) continue;
      const c = fx.color;
      const P = fx.pos;
      if (!this.fxInit.has(fx)) { this.fxInit.add(fx); if (!reduced) this.spawnFor(fx); }
      if (fx.kind === 'battle' || fx.kind === 'clash') {
        for (let k = 0; k < 3; k++) {
          const tt = (t + k * 0.18) % 1;
          ctx.strokeStyle = hexA(c, (1 - tt) * 0.9); ctx.lineWidth = this.px(3);
          ctx.beginPath(); ctx.arc(P.x, P.y, this.px(10) + tt * this.px(60), 0, TAU); ctx.stroke();
        }
        const g = ctx.createRadialGradient(P.x, P.y, 0, P.x, P.y, this.px(45));
        g.addColorStop(0, `rgba(255,240,200,${0.7 * (1 - t)})`); g.addColorStop(1, 'rgba(255,120,60,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(P.x, P.y, this.px(45), 0, TAU); ctx.fill();
        // weapon flashes flicker across the fight while it lasts
        if (!reduced && Math.random() < 0.3) this.flash(P.x + (Math.random() - 0.5) * this.px(60), P.y + (Math.random() - 0.5) * this.px(46));
      } else if (fx.kind === 'capture') {
        // the ring burst
        ctx.strokeStyle = hexA(c, 1 - t); ctx.lineWidth = this.px(4 * (1 - t) + 1);
        ctx.beginPath(); ctx.arc(P.x, P.y, this.px(20) + easeOutCubic(t) * this.px(90), 0, TAU); ctx.stroke();
        // the flag: a staff rises out of the site, the pennant snaps open in the new colour
        const rise = easeOutBack(clamp01(t / 0.3));
        const a = 1 - clamp01((t - 0.75) / 0.25);
        const top = P.y - this.px(46) * rise;
        ctx.strokeStyle = `rgba(255,255,255,${0.9 * a})`; ctx.lineWidth = this.px(2);
        ctx.beginPath(); ctx.moveTo(P.x, P.y - this.px(6)); ctx.lineTo(P.x, top); ctx.stroke();
        const wave = Math.sin(I.now / 90) * this.px(2.5);
        const open = clamp01((t - 0.15) / 0.2);
        ctx.fillStyle = hexA(c, a);
        ctx.beginPath(); ctx.moveTo(P.x, top); ctx.quadraticCurveTo(P.x + this.px(12) * open, top + this.px(2) + wave, P.x + this.px(24) * open, top + this.px(5) + wave * 0.4);
        ctx.lineTo(P.x, top + this.px(13)); ctx.closePath(); ctx.fill();
        if (t < 0.25) {
          const f = 1 - t / 0.25;
          const g = ctx.createRadialGradient(P.x, P.y, 0, P.x, P.y, this.px(50));
          g.addColorStop(0, `rgba(255,255,255,${0.7 * f})`); g.addColorStop(1, hexA(c, 0));
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(P.x, P.y, this.px(50), 0, TAU); ctx.fill();
        }
      } else if (fx.kind === 'excavate') {
        ctx.strokeStyle = hexA(c, 1 - t); ctx.lineWidth = this.px(4);
        ctx.beginPath(); ctx.arc(P.x, P.y, this.px(20) + t * this.px(90), 0, TAU); ctx.stroke();
        const g = ctx.createLinearGradient(P.x, P.y - this.px(120), P.x, P.y);
        g.addColorStop(0, hexA(c, 0)); g.addColorStop(1, hexA(c, 0.55 * (1 - t)));
        ctx.fillStyle = g; ctx.fillRect(P.x - this.px(7), P.y - this.px(120), this.px(14), this.px(120));
      } else if (fx.kind === 'build') {
        // warp-in: a beam drops onto the shipyard, a ring collapses inward, then a flash
        const beamA = t < 0.5 ? t / 0.5 : 1 - (t - 0.5) / 0.5;
        const g = ctx.createLinearGradient(P.x, P.y - this.px(140), P.x, P.y);
        g.addColorStop(0, hexA(c, 0)); g.addColorStop(0.8, hexA(c, 0.45 * beamA)); g.addColorStop(1, `rgba(255,255,255,${0.8 * beamA})`);
        const bw = this.px(5 + 6 * beamA);
        ctx.fillStyle = g; ctx.fillRect(P.x - bw / 2, P.y - this.px(140), bw, this.px(140));
        const ci = clamp01(t / 0.6);
        ctx.strokeStyle = hexA(c, 0.9 * ci); ctx.lineWidth = this.px(2.5);
        ctx.beginPath(); ctx.arc(P.x, P.y, this.px(8) + (1 - easeOutCubic(ci)) * this.px(46), 0, TAU); ctx.stroke();
        if (t > 0.55) {
          const f = 1 - (t - 0.55) / 0.45;
          const gg = ctx.createRadialGradient(P.x, P.y, 0, P.x, P.y, this.px(34));
          gg.addColorStop(0, `rgba(255,255,255,${0.85 * f})`); gg.addColorStop(1, hexA(c, 0));
          ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(P.x, P.y, this.px(34), 0, TAU); ctx.fill();
        }
      } else if (fx.kind === 'explode') {
        const S = fx.size ?? 1;
        if (t < 0.35) {
          const f = t / 0.35;
          const R = this.px(14 + 40 * S * f);
          const g = ctx.createRadialGradient(P.x, P.y, 0, P.x, P.y, R);
          g.addColorStop(0, `rgba(255,255,255,${1 - f})`); g.addColorStop(0.35, `rgba(255,200,120,${0.85 * (1 - f)})`); g.addColorStop(1, 'rgba(255,80,40,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(P.x, P.y, R, 0, TAU); ctx.fill();
        }
        const k = easeOutCubic(clamp01(t / 0.7));
        ctx.strokeStyle = hexA(c, 0.85 * (1 - k)); ctx.lineWidth = this.px(3 * (1 - k) + 0.5);
        ctx.beginPath(); ctx.arc(P.x, P.y, this.px(8 + 55 * S * k), 0, TAU); ctx.stroke();
      } else if (fx.kind === 'ripple' || fx.kind === 'arrive') {
        const R = fx.size ?? 40;
        const k = easeOutCubic(t);
        ctx.strokeStyle = hexA(c, (fx.kind === 'ripple' ? 0.35 : 0.8) * (1 - t)); ctx.lineWidth = this.px(fx.kind === 'ripple' ? 1.5 : 2);
        ctx.beginPath(); ctx.arc(P.x, P.y, this.px(fx.kind === 'ripple' ? 6 : 10) + k * this.px(R), 0, TAU); ctx.stroke();
      }
      if (fx.text) {
        // text pops in, floats up, fades
        const pop = t < 0.12 ? 0.6 + 0.4 * easeOutBack(t / 0.12) : 1;
        ctx.font = `700 ${this.px(13 * pop)}px "Rajdhani", system-ui, sans-serif`;
        ctx.textAlign = 'center';
        const y = P.y - this.px(36) - easeOutCubic(t) * this.px(20);
        ctx.lineWidth = this.px(3); ctx.strokeStyle = `rgba(6,3,14,${0.7 * Math.min(1, (1 - t) * 2)})`;
        ctx.strokeText(fx.text, P.x, y);
        ctx.fillStyle = hexA(fx.kind === 'text' || fx.kind === 'explode' ? c : '#ffffff', Math.min(1, (1 - t) * 2));
        ctx.fillText(fx.text, P.x, y);
      }
    }
  }

  /** Particles that belong to an effect, spawned on its first visible frame. */
  private spawnFor(fx: Fx) {
    const P = fx.pos;
    const m = this.compact ? 0.6 : 1;
    switch (fx.kind) {
      case 'explode': {
        const S = fx.size ?? 1;
        this.burst(P, '#ffb36b', Math.round(14 * m * S), 0.3 * Math.sqrt(S), 900);
        this.burst(P, fx.color, Math.round(10 * m * S), 0.22 * Math.sqrt(S), 1100, true);
        break;
      }
      case 'capture': this.burst(P, fx.color, Math.round(18 * m), 0.25, 900); break;
      case 'excavate': for (let i = 0; i < 16 * m; i++) this.particles.push({ x: P.x + (Math.random() - 0.5) * this.px(24), y: P.y, vx: (Math.random() - 0.5) * this.px(0.02), vy: -this.px(0.04 + Math.random() * 0.08), t0: this.now, life: 900 + Math.random() * 600, size: 1.5 + Math.random() * 1.5, color: fx.color, drag: 0.999, streak: false, grav: 0 }); break;
      case 'clash': case 'battle': this.burst(P, '#ffd27a', Math.round(12 * m), 0.28, 700, true); break;
      case 'build': this.burst(P, fx.color, Math.round(8 * m), 0.12, 700); break;
    }
  }

  /** Radial burst of particles (speeds in screen px per ms). */
  private burst(p: Pt, color: string, n: number, speed: number, life = 800, streak = false) {
    if (reducedMotion()) return;
    const cap = this.compact ? 220 : 450;
    for (let i = 0; i < n && this.particles.length < cap; i++) {
      const a = Math.random() * TAU, v = this.px(speed * (0.35 + Math.random()));
      this.particles.push({ x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t0: this.now, life: life * (0.6 + Math.random() * 0.6), size: streak ? 1.4 : 1.5 + Math.random() * 2, color, drag: 0.996, streak, grav: 0 });
    }
  }
  private spark(x: number, y: number, color: string, n: number, speed: number, life: number) {
    const cap = this.compact ? 220 : 450;
    for (let i = 0; i < n && this.particles.length < cap; i++) {
      const a = Math.random() * TAU, v = this.px(speed * (0.4 + Math.random()));
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - this.px(0.03), t0: this.now, life: life * (0.6 + Math.random() * 0.7), size: 1.2, color, drag: 0.995, streak: true, grav: this.px(0.00025) });
    }
  }
  /** A single bright weapon flash (one short-lived particle). */
  private flash(x: number, y: number) {
    if (this.particles.length > (this.compact ? 220 : 450)) return;
    this.particles.push({ x, y, vx: 0, vy: 0, t0: this.now, life: 160, size: 7, color: '#fff2c8', drag: 1, streak: false, grav: 0 });
  }
  private ring(p: Pt, color: string, dur: number, from: number, to: number) {
    if (reducedMotion()) return;
    this.ownFx.push({ kind: 'arrive', pos: { ...p }, color, t0: this.now, dur, size: to - from });
  }

  private drawParticles(now: number) {
    if (!this.particles.length) return;
    const { ctx } = this;
    const dt = this.dt;
    const s = this.px(1);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    let w = 0;
    for (const p of this.particles) {
      const age = now - p.t0;
      if (age > p.life) continue;
      this.particles[w++] = p;
      const d = Math.pow(p.drag, dt);
      p.vx *= d; p.vy = p.vy * d + p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const a = 1 - age / p.life;
      ctx.globalAlpha = a;
      if (p.streak) {
        ctx.strokeStyle = p.color; ctx.lineWidth = p.size * s;
        ctx.beginPath(); ctx.moveTo(p.x - p.vx * 40, p.y - p.vy * 40); ctx.lineTo(p.x, p.y); ctx.stroke();
      } else if (p.life < 200) {
        // weapon flash: a soft round bloom
        ctx.fillStyle = p.color;
        ctx.globalAlpha = a * 0.35;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * s * (1.6 - a * 0.6), 0, TAU); ctx.fill();
        ctx.globalAlpha = a;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * s * 0.45, 0, TAU); ctx.fill();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * s * 0.5 * (0.5 + 0.5 * a), 0, TAU); ctx.fill();
      }
    }
    this.particles.length = w;
    ctx.restore();
  }


  private siteSize(r: Region) {
    const k = this.px(1);
    return (r.kind === 'throne' ? 15 : r.kind === 'home' ? 12 : r.kind === 'crown' ? 12 : r.kind === 'void' ? 3 : 7 + r.dev) * Math.max(1, Math.min(2.2, k * 1.6));
  }

  private drawSite(r: Region, I: DrawInput, c: string) {
    const { ctx } = this;
    const p = r.site;
    const k = this.px(1);
    const size = this.siteSize(r);
    // glow
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size * 4);
    g.addColorStop(0, hexA(c, 0.55)); g.addColorStop(1, hexA(c, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, size * 4, 0, TAU); ctx.fill();
    ctx.lineWidth = Math.max(1.5, k * 1.8);
    if (r.kind === 'void') {
      ctx.fillStyle = 'rgba(200,200,255,0.5)'; ctx.beginPath(); ctx.arc(p.x, p.y, size, 0, TAU); ctx.fill();
    } else if (r.kind === 'throne') {
      star(ctx, p, size * 0.9, 8, '#fff6d8');
    } else if (r.kind === 'crown') {
      ctx.strokeStyle = '#ffd86b';
      ctx.beginPath(); ctx.arc(p.x, p.y, size * 1.5, 0, TAU); ctx.stroke();
      crown(ctx, p, size, '#ffe7a0');
    } else if (r.kind === 'home') {
      ctx.strokeStyle = hexA(c, 0.95);
      ctx.beginPath(); ctx.arc(p.x, p.y, size * 1.25, 0, TAU); ctx.stroke();
      planet(ctx, p, size * 0.8, c);
    } else if (r.kind === 'relic') {
      if (r.relic !== 'unclaimed') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.PI / 4);
        ctx.strokeStyle = 'rgba(127,247,255,0.35)';
        ctx.strokeRect(-size, -size, size * 2, size * 2);
        ctx.fillStyle = 'rgba(127,247,255,0.15)'; ctx.fillRect(-size * 0.45, -size * 0.45, size * 0.9, size * 0.9);
        ctx.restore();
      }
    } else {
      planet(ctx, p, size, c);
    }
    // planetary defences and gates
    const b = r.buildings;
    if (b.battery) {
      ctx.save(); ctx.strokeStyle = hexA(c, 0.8); ctx.lineWidth = Math.max(1, k * 1.2); ctx.setLineDash([k * 2, k * 3]);
      for (let i = 0; i < b.battery; i++) { ctx.beginPath(); ctx.arc(p.x, p.y, size * (1.55 + i * 0.3), 0, TAU); ctx.stroke(); }
      ctx.restore();
    }
    if (b.pshield) {
      const R2 = size * (1.6 + (b.battery ?? 0) * 0.3 + 0.35);
      const sg = ctx.createRadialGradient(p.x, p.y, R2 * 0.6, p.x, p.y, R2);
      sg.addColorStop(0, 'rgba(111,243,255,0)'); sg.addColorStop(1, 'rgba(111,243,255,0.22)');
      ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(p.x, p.y, R2, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(150,245,255,0.75)'; ctx.lineWidth = Math.max(1, k * 1.3); ctx.stroke();
    }
    if (b.gate) {
      const gp = { x: p.x - size * 1.9 - k * 6, y: p.y + size * 1.2 };
      ctx.save(); ctx.translate(gp.x, gp.y);
      ctx.strokeStyle = hexA(c, 0.95); ctx.lineWidth = k * 2.2;
      ctx.beginPath(); ctx.ellipse(0, 0, k * 6, k * 7.5, 0, 0, TAU); ctx.stroke();
      ctx.fillStyle = hexA('#ffffff', 0.25); ctx.beginPath(); ctx.ellipse(0, 0, k * 3, k * 4.5, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
    // buildings pips
    const pips: string[] = [];
    if (r.buildings.shipyard) pips.push('⚙'.repeat(r.buildings.shipyard));
    if (r.buildings.fortress) pips.push('⛨'.repeat(r.buildings.fortress));
    if (r.buildings.mine) pips.push('⛏'.repeat(r.buildings.mine));
    if (r.buildings.tradehub) pips.push('¢'.repeat(r.buildings.tradehub));
    if (r.buildings.sensor) pips.push('◎'.repeat(r.buildings.sensor));
    if (r.buildings.academy) pips.push('⚗'.repeat(r.buildings.academy));
    if (r.buildings.depot) pips.push('⊞');

    // labels (with simple collision avoidance: try above, then below, then shifted)
    const fs = this.compact ? 11 : Math.max(11, Math.min(15, 13 * Math.sqrt(k)));
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
    if (!free) ctx.globalAlpha = minor ? 0 : 0.45;
    if (!free && minor) this.hiddenLabels.set(r.id, { x: spot.x, y: spot.y, name, font: ctx.font, sp: this.px(1.2) });
    this.labelBoxes.push({ x: spot.x - lw / 2, y: spot.y - lh, w: lw, h: lh * 1.2 });
    const ly = spot.y;
    letterSpaced(ctx, name, spot.x, ly, this.px(1.2));
    ctx.globalAlpha = 1;
    const below = spot.y > p.y;
    ctx.font = `500 ${this.px(this.compact ? 9.5 : 11)}px "Rajdhani", system-ui, sans-serif`;
    const sub: string[] = [];
    if (r.garrison > 0) sub.push(`⛨${r.garrison}`);
    else if (r.garrison < 0) sub.push('⛨?');
    if (r.owner !== null && r.dev > 0 && r.kind !== 'void') sub.push(`dev ${r.dev}`);
    if (pips.length) sub.push(pips.join(' '));
    if (r.project) sub.push(`⏳${I.state.rules.projects[r.project.key]?.name ?? r.project.key}`);
    if (r.memorials.length) sub.push(`✝${r.memorials.length}`);
    // world trait (hidden on phones to keep labels short) and the vein, in its colour (lit when an Extractor mines it)
    const emp = I.state.rules.empire?.enabled !== false;
    const T = emp && r.trait ? WORLD_TRAITS[r.trait] : null, V = emp && r.vein ? VEINS[r.vein] : null;
    if (T && !this.compact) sub.unshift(T.icon);
    const txt = sub.join('  '), vtxt = V ? V.icon : '';
    if (txt || vtxt) {
      const sx = below ? spot.x : p.x, sy = below ? spot.y + this.px(13) : p.y + size * 1.9 + this.px(14);
      const gap = txt && vtxt ? ctx.measureText('  ').width : 0;
      const w1 = txt ? ctx.measureText(txt).width : 0, w2 = vtxt ? ctx.measureText(vtxt).width : 0;
      const x0 = sx - (w1 + gap + w2) / 2;
      ctx.textAlign = 'left';
      if (txt) { ctx.fillStyle = 'rgba(200,195,230,0.7)'; ctx.fillText(txt, x0, sy); }
      if (V) {
        const mined = (r.buildings.extractor ?? 0) > 0;
        ctx.save();
        if (mined) { ctx.shadowColor = V.color; ctx.shadowBlur = 8; }
        ctx.fillStyle = hexA(V.color, mined ? 1 : 0.6);
        ctx.font = `700 ${this.px(this.compact ? 11 : 12.5)}px "Rajdhani", system-ui, sans-serif`;
        ctx.fillText(vtxt, x0 + w1 + gap, sy);
        ctx.restore();
      }
      ctx.textAlign = 'center';
    }
    // influence progress (your loyalty)
    if (I.you !== null && r.owner !== I.you && (r.loyalty[I.you] ?? 0) > 0) {
      const thr = r.owner === null ? I.state.rules.influence.flipThreshold : I.state.rules.influence.rivalFlipThreshold;
      const fr = Math.min(1, r.loyalty[I.you] / thr);
      ctx.strokeStyle = hexA(I.state.players[I.you].color, 0.9); ctx.lineWidth = this.px(3);
      ctx.beginPath(); ctx.arc(p.x, p.y, size * 2.3, -Math.PI / 2, -Math.PI / 2 + fr * TAU); ctx.stroke();
    }
  }

  private drawFleet(f: FleetDraw, c: string, now: number, scale = 1, ang = 0, alphaMul = 1, moving = false) {
    const { ctx } = this;
    const s = this.px(1);
    const p = f.pos;
    ctx.save();
    ctx.globalAlpha = f.alpha * (f.ghost ? 0.35 : 1) * alphaMul;
    ctx.translate(p.x, p.y);
    if (scale !== 1) ctx.scale(scale, scale);
    const R = 11 * s;
    if (f.idle && !f.selected) {
      // affordance: an own fleet that can act right now breathes a soft beacon
      const k = (now % 1800) / 1800;
      ctx.strokeStyle = hexA('#7dffb8', 0.75 * (1 - k)); ctx.lineWidth = 2 * s;
      ctx.beginPath(); ctx.arc(0, 0, R * (1.3 + k * 1.3), 0, TAU); ctx.stroke();
    }
    if (f.selected) {
      // pops in wide, settles, then rotating brackets hold it
      const k = clamp01((now - this.selFleetT0) / 300);
      const e = easeOutCubic(k);
      const rr = R * 1.7 * (1 + 0.8 * (1 - e)) + Math.sin(now / 200) * s;
      ctx.strokeStyle = `rgba(255,255,255,${0.95 * e})`; ctx.lineWidth = 2 * s;
      ctx.beginPath(); ctx.arc(0, 0, rr, 0, TAU); ctx.stroke();
      const rot = reducedMotion() ? 0 : now / 900;
      ctx.strokeStyle = hexA(c, 0.9 * e); ctx.lineWidth = 2.5 * s;
      for (let i = 0; i < 3; i++) { const a0 = rot + (i * TAU) / 3; ctx.beginPath(); ctx.arc(0, 0, rr + 5 * s, a0, a0 + 0.8); ctx.stroke(); }
    }
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 2.2);
    g.addColorStop(0, hexA(c, moving ? 0.7 : 0.5)); g.addColorStop(1, hexA(c, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R * 2.2, 0, TAU); ctx.fill();
    // chevron (turns to face its heading while travelling)
    if (ang) ctx.rotate(ang);
    if (moving) {
      // engine flare behind the chevron
      const fl = 0.8 + 0.2 * Math.sin(now / 30);
      ctx.fillStyle = `rgba(255,255,255,${0.8 * fl})`;
      ctx.beginPath(); ctx.moveTo(-R * 0.3, R * 0.45); ctx.lineTo(0, R * (0.9 + 0.5 * fl)); ctx.lineTo(R * 0.3, R * 0.45); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = f.owner === -1 ? '#e7b6ff' : c;
    ctx.strokeStyle = 'rgba(10,5,20,0.9)'; ctx.lineWidth = 1.5 * s;
    ctx.beginPath(); ctx.moveTo(0, -R); ctx.lineTo(R * 0.85, R * 0.75); ctx.lineTo(0, R * 0.35); ctx.lineTo(-R * 0.85, R * 0.75); ctx.closePath();
    ctx.fill(); ctx.stroke();
    if (ang) ctx.rotate(-ang);
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
    const t1 = shrink / L, t2full = 1 - shrink / L;
    if (t2full <= t1) return;
    // new arrows draw themselves from the fleet toward the target
    const key = `${a.x | 0},${a.y | 0},${b.x | 0},${b.y | 0},${color},${dashed ? 1 : 0}`;
    this.arrowFrame.add(key);
    let born = this.arrowSeen.get(key);
    if (born === undefined) { born = reducedMotion() ? -1e9 : this.now; this.arrowSeen.set(key, born); }
    const grow = easeOutCubic(clamp01((this.now - born) / 380));
    const t2 = t1 + (t2full - t1) * grow;
    const q = (t: number) => ({ x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * cx + t * t * b.x, y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * cy + t * t * b.y });
    const p2 = q(t2), pm = q(0.5), pb = q(Math.max(t1, t2 - 0.02));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color; ctx.lineWidth = 3 * s;
    if (dashed) {
      // marching ants: dashed routes flow toward the destination
      ctx.setLineDash([7 * s, 6 * s]);
      ctx.lineDashOffset = reducedMotion() ? 0 : -(this.now / 45) * s;
    }
    ctx.beginPath(); ctx.moveTo(q(t1).x, q(t1).y);
    const N = 16;
    for (let i = 1; i <= N; i++) { const pp = q(t1 + (t2 - t1) * (i / N)); ctx.lineTo(pp.x, pp.y); }
    ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
    // a spark of light travels along solid (planned) routes
    if (!dashed && grow >= 1 && !reducedMotion()) {
      const ph = ((this.now / 1500) + ((a.x * 7 + b.y * 3) % 1000) / 1000) % 1;
      const sp = q(t1 + (t2 - t1) * ph);
      const fade = Math.sin(ph * Math.PI);
      ctx.fillStyle = `rgba(255,255,255,${0.85 * fade})`;
      ctx.beginPath(); ctx.arc(sp.x, sp.y, 2.4 * s, 0, TAU); ctx.fill();
      ctx.fillStyle = hexA(color, 0.35 * fade);
      ctx.beginPath(); ctx.arc(sp.x, sp.y, 6 * s, 0, TAU); ctx.fill();
    }
    const ang = Math.atan2(p2.y - pb.y, p2.x - pb.x);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(p2.x + Math.cos(ang) * 9 * s, p2.y + Math.sin(ang) * 9 * s);
    ctx.lineTo(p2.x + Math.cos(ang + 2.5) * 9 * s, p2.y + Math.sin(ang + 2.5) * 9 * s);
    ctx.lineTo(p2.x + Math.cos(ang - 2.5) * 9 * s, p2.y + Math.sin(ang - 2.5) * 9 * s); ctx.fill();
    if (label && grow > 0.5) {
      const ls = grow < 1 ? easeOutBack(clamp01((grow - 0.5) / 0.5)) : 1;
      ctx.fillStyle = 'rgba(8,4,16,0.92)'; ctx.beginPath(); ctx.arc(pm.x, pm.y, 9 * s * ls, 0, TAU); ctx.fill();
      ctx.strokeStyle = color; ctx.lineWidth = 1.5 * s; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = `700 ${10 * s * ls}px "Rajdhani", system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
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
    this.stars = null;
    // bake the haze at 1px per 6 world units
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const b of this.nebulaBlobs) { minX = Math.min(minX, b.p.x - b.r); minY = Math.min(minY, b.p.y - b.r); maxX = Math.max(maxX, b.p.x + b.r); maxY = Math.max(maxY, b.p.y + b.r); }
    const S = 6;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil((maxX - minX) / S)); c.height = Math.max(1, Math.ceil((maxY - minY) / S));
    const x = c.getContext('2d')!;
    x.scale(1 / S, 1 / S); x.translate(-minX, -minY);
    for (const b of this.nebulaBlobs) {
      const g = x.createRadialGradient(b.p.x, b.p.y, 0, b.p.x, b.p.y, b.r);
      g.addColorStop(0, b.c); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.beginPath(); x.arc(b.p.x, b.p.y, b.r, 0, TAU); x.fill();
    }
    this.haze = { c, x: minX, y: minY, w: c.width * S, h: c.height * S };
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

function makeBackdrop(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w / 2)); c.height = Math.max(1, Math.round(h / 2));
  const x = c.getContext('2d')!;
  x.scale(0.5, 0.5);
  const bg = x.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.8);
  bg.addColorStop(0, '#1a1030'); bg.addColorStop(0.6, '#0d0819'); bg.addColorStop(1, '#05030b');
  x.fillStyle = bg; x.fillRect(0, 0, w, h);
  return c;
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
