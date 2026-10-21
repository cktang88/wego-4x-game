// Canvas renderer for the strategic map (UX v2, docs/UX-V2.md §2): semantic zoom in three tiers
// (strategic / operational / detail), one object per idea (region banner, fleet token per owner per region,
// battle roundel), lenses, order and drag arrows, plus replay animation overlays and effects.
import type { GameState, Region, Fleet, Pt, Signal, Order, Engagement } from '../../../shared/sim/types.ts';
import { NEUTRAL_COLOR, SIGILS, CALLINGS } from '../../../shared/config/content.ts';
import { tenureTier } from '../../../shared/sim/soul.ts';
import { drawSigil, goldPaint } from '../art/sigils.ts';
import { drawShip, drawPlumes, gunPoints } from '../art/ships.ts';
import { scheme } from '../art/palette.ts';
import { CLASS_RANK, classLen } from '../art/palette.ts';
import { drawBase, drawStand, formation, BASE_SQUASH } from '../art/minis.ts';
import { drawPlanet, drawStar, drawBodyShadow, regionArt, onArtReady, artGeneration } from '../art/planets.ts';
import { matBackdrop, lampOverlay, weaveTile, nebulaPrint, starfield } from '../art/mat.ts';
import { drawGlow, beam, tracer, fireball, smoke, stamp, shieldHit } from '../art/fx.ts';
import { enamel, gunmetal, topGlint, stampedText, type Rim } from '../art/plates.ts';
import { drawStructure, shieldDome, rockSprite, buoySprite, type Structure } from '../art/structures.ts';
import { rgb as rgbA, css as cssA, mix as mixA, h2 } from '../art/util.ts';
import { Rng, hashString } from '../../../shared/sim/rng.ts';
import { pointInPoly } from '../../../shared/sim/mapgen.ts';
import { TRAITS as WORLD_TRAITS, VEINS } from '../../../shared/config/empire.ts';
import { connected, supplied, maxDevAt } from '../../../shared/sim/empire.ts';
import { battleViewerOpen } from './battle.ts';
import {
  type Tier, type Lens, coarsePointer, medianRegionRadius, tierFor, slotFor, slotScale, anchorOf, powerOf, garrisonPower,
  garrisonMax, regionEdges, empireLabels, nearestRegion, ROMAN, isLane, hyperlanes,
} from './mapmodel.ts';
import { fleetSpeed } from '../../../shared/sim/graph.ts';
import {
  TAU, numFont, nameFont, displayFont, PLATE, INK, desat, inkOn, roundRect, shieldPath, diamondPath, chevronPath, swords,
  crownGlyph, starGlyph, planet, haloText, letterSpaced, buildingIcon, TRAY_ORDER, hatchTile, hexA as hexA0,
} from './glyphs.ts';

export type { Tier, Lens } from './mapmodel.ts';

export interface FleetDraw {
  id: number; owner: number; ships: number; pos: Pt; alpha: number; name: string;
  fortified?: boolean; selected?: boolean; ghost?: boolean; cls?: string[]; idle?: boolean;
  /** the region the fleet is in (or arriving at); used to group tokens. Falls back to the nearest region. */
  region?: number;
}
export interface Fx {
  kind: 'battle' | 'capture' | 'excavate' | 'clash' | 'build' | 'text' | 'explode' | 'ripple' | 'arrive' | 'warden' | 'stamp';
  pos: Pt; color: string; t0: number; dur: number; text?: string;
  /** effect scale (explosion size, ripple radius in screen px) */
  size?: number;
  /** 'stamp': the stamp text ("CALLED IT", "CAUGHT OUT"); 'build': the hull class warping in */
  cls?: string;
  /** 'build': the owner seat (picks the house's miniature) */
  owner?: number;
}
export type DragVerb = 'move' | 'od' | 'seize' | 'join' | 'merge' | 'split' | 'invalid';
/** The live arrow while a fleet token (or ship chip) is being dragged. `to` should already be snapped to a region site. */
export interface DragArrow { from: Pt; to: Pt; verb: DragVerb; color: string; path?: Pt[]; ghost?: Pt | null }
export interface PlannedArrow {
  from: Pt; to: Pt;
  /** roman slot ("II") → badge at the midpoint; anything else (LIVE ETA "3h") → label at the head */
  label: string;
  color: string;
  /** dashed/hollow = join (or a LIVE route in transit) */
  dashed?: boolean;
  kind: Order['type'];
}
/** What tokenAt returns: the group token (or the single fleet when fanned out) under the pointer. */
export interface TokenHit { region: number; owner: number; fleetIds: number[] }

/** Short-lived cosmetic particle (world position, screen-constant size). Purely visual: Math.random is fine here. */
interface Particle { x: number; y: number; vx: number; vy: number; t0: number; life: number; size: number; color: string; drag: number; streak: boolean; grav: number }
interface Track { x: number; y: number; vx: number; vy: number; ang: number; trail: { x: number; y: number; t: number }[]; born: number; travel: number; moving: boolean; draw: FleetDraw; color: string }
type Cam = { x: number; y: number; z: number };

/** A token as laid out this frame. */
interface Tok {
  key: string; owner: number; region: number; fleets: FleetDraw[]; rest: boolean;
  target: Pt; side: -1 | 1; power: number; ships: number;
  selected: boolean; idle: boolean; oos: boolean; alpha: number; moving: boolean; ang: number; born: number;
}
/** Hit box of a drawn token, in screen px around a world point. */
interface TokHit { x: number; y: number; l: number; t: number; r: number; b: number; cr: number; hit: TokenHit }
interface BannerHit { rid: number; x: number; y: number; l: number; t: number; r: number; b: number }
interface Side { owner: number; color: string; power: number; ids: number[]; garrison: number; garrisonOnly: boolean }

/** The player asked the OS for less motion: skip trails, particles, camera flights and twinkles. */
const reducedMQ = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
export const reducedMotion = () => !!reducedMQ?.matches;
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOutBack = (t: number) => { const c = 1.9; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const GOLD = '#ffd86b';
const WARDEN = '#e7b6ff';
const STONE = '#e6e0fa';
const FADE_MS = 150;

export interface DrawInput {
  state: GameState;
  you: number | null;
  visible: Set<number>;
  owners: (number | null)[];          // region owners to draw (replay overrides)
  fleets: FleetDraw[];
  selectedRegion: number | null;
  hoverRegion: number | null;
  highlight: Map<number, string>;     // region -> color (move targets etc.)
  plannedArrows: PlannedArrow[];
  pathPreview: { pts: Pt[]; ok: boolean } | null;
  signals: Signal[];
  showSignals: boolean;
  fx: Fx[];
  now: number;
  /** your owned regions that are cut off from your capital (half yield): hatched */
  cutOff?: Set<number> | null;
  /** while one of your fleets is selected: regions where it would be out of supply (faint tint) */
  unsupplied?: Set<number> | null;
  /** the arrow under a drag gesture (DOM preview card is the shell's) */
  drag?: DragArrow | null;
  /** map lens (default political) */
  lens?: Lens;
  /** region whose own fleet stack is fanned out into per-fleet tokens */
  expanded?: number | null;
  /** hold Space: detail-tier banners everywhere */
  peek?: boolean;
}

export class MapRenderer {
  ctx: CanvasRenderingContext2D;
  cam = { x: 0, y: 0, z: 0.4 };
  w = 0; h = 0; dpr = 1;
  private stars: HTMLCanvasElement | null = null;
  private starPattern: CanvasPattern | null = null;
  private bgCanvas: HTMLCanvasElement | null = null;
  private haze: { c: HTMLCanvasElement; x: number; y: number; w: number; h: number } | null = null;
  private lamp: HTMLCanvasElement | null = null;
  private weave: CanvasPattern | null = null;
  private asteroidCache = new Map<number, Pt[]>();
  private seed = -1;
  fitted = false;
  private labelBoxes: { x: number; y: number; w: number; h: number }[] = [];
  /** names hidden by collisions: revealed on hover */
  private hiddenLabels = new Map<number, { x: number; y: number; w: number; h: number; name: string; font: string }>();
  private hatch: { cut: CanvasPattern | null; dark: CanvasPattern | null } = { cut: null, dark: null };

  // ---- semantic zoom
  private _tier: Tier | null = null;
  private fade: { c: HTMLCanvasElement; cam: Cam; t0: number } | null = null;
  /** read-only: the current semantic-zoom tier */
  get tier(): Tier { return this._tier ?? this.computeTier(null); }

  // ---- animation state (all cosmetic)
  private lastNow = 0;
  private dt = 16;
  private camAnim: { from: Cam; to: Cam; t0: number; dur: number; set: Cam } | null = null;
  private hoverA = new Map<number, number>();
  private prevOwners: (number | null)[] | null = null;
  private ownersReset = true;
  private ownerFx: { rid: number; from: string; to: string; t0: number }[] = [];
  private tracks = new Map<number, Track>();
  private fleetsReset = true;
  private particles: Particle[] = [];
  private fxInit = new WeakSet<Fx>();
  private ownFx: Fx[] = [];
  private arrowSeen = new Map<string, number>();
  private arrowFrame = new Set<string>();
  private twinkles: { x: number; y: number; ph: number; sp: number; s: number; c: string }[] = [];
  private selFleet: string | null = null; private selFleetT0 = 0;
  private selRegion: number | null = null; private selRegionT0 = 0;
  private sparkAcc = 0;
  private now = 0;
  /** where each fleet token was drawn last frame (for fleetAt) */
  private drawnPos = new Map<number, Pt>();
  /** token display state (eased positions/headings), by token key */
  private tokDisp = new Map<string, { x: number; y: number; ang: number; bank: number; born: number; owner: number; region: number; ids: number[]; color: string; last: Tok }>();
  private tokVanish: { t: Tok; x: number; y: number; ang: number; color: string; t0: number }[] = [];
  private tokHits: TokHit[] = [];
  private bannerHits: BannerHit[] = [];
  /** last garrison seen per region (fogged banners show "~N") */
  private lastKnown = new Map<number, number>();
  private lkVer = 0;
  private dragHead: Pt | null = null;
  private aftermathSeen = new Map<string, number>();
  private memoSup: { st: GameState | null; you: number | null; conn: Set<number> | null; sup: Set<number> | null } = { st: null, you: null, conn: null, sup: null };
  private fleetIdx: { src: Fleet[] | null; m: Map<number, Fleet>; last: Map<number, Fleet> } = { src: null, m: new Map(), last: new Map() };

  constructor(public canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    // labels are cached in the static layer: redraw once web fonts arrive
    document.fonts?.ready.then(() => this.invalidate()).catch(() => { /* */ });
    // planets painted in idle time: refresh the cached layer when they land
    onArtReady(() => this.invalidate());
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
    this.fade = null;
    // a few twinkling stars drawn live over the cached starfield (cosmetic randomness)
    const n = Math.round(Math.min(60, (r.width * r.height) / 24000));
    const cols = ['#ffffff', '#cfe0ff', '#ffe9c8', '#e2c8ff'];
    this.twinkles = Array.from({ length: n }, () => ({ x: Math.random() * r.width, y: Math.random() * r.height, ph: Math.random() * TAU, sp: 0.6 + Math.random() * 1.6, s: Math.random() < 0.2 ? 2 : 1.2, c: cols[(Math.random() * cols.length) | 0] }));
  }

  // ---------------------------------------------------------------- camera flights
  /** Glide the camera to p (and optionally zoom z). User input (drag/pinch/wheel) cancels the flight. */
  flyTo(p: Pt, z?: number, dur = 650) {
    const zz = z !== undefined && Number.isFinite(z) && z > 0 ? z : this.cam.z;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    const to = { x: p.x, y: p.y, z: zz };
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
  resetAnim() {
    this.ownersReset = true; this.fleetsReset = true;
    for (const t of this.tracks.values()) t.trail.length = 0;
    this.ownerFx = []; this.tokVanish = []; this.tokDisp.clear();
  }

  /** Whole map in view on desktop (operational tier); phones start closer, around the capital (strategic tier). */
  fit(state: GameState, focus?: Pt) {
    // a zero-sized canvas (hidden, mid-layout) would give z = 0 and NaN everywhere downstream: fit later instead
    if (!(this.w > 0 && this.h > 0) || !state.regions.length) return;
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const r of state.regions) for (const p of r.poly) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
    const z = Math.min(this.w / (maxX - minX + 80), this.h / (maxY - minY + 80));
    this.cam = { x: focus ? focus.x * 0.15 + (minX + maxX) / 2 * 0.85 : (minX + maxX) / 2, y: focus ? focus.y * 0.15 + (minY + maxY) / 2 * 0.85 : (minY + maxY) / 2, z };
    if (this.compact) {
      // phones: start zoomed in on your capital (about half the map visible); pan/pinch for the rest
      const zp = Math.max(z * 1.35, Math.min(0.32, this.w / 1400));
      this.cam = { x: focus ? focus.x * 0.6 : (minX + maxX) / 2, y: focus ? focus.y * 0.6 : (minY + maxY) / 2, z: zp };
      // never open on empty space: keep the map's edges at (or past) the screen's edges, below the top bar
      const top = 64, bottom = 150;
      const hy = this.h / 2 / zp, hx = this.w / 2 / zp;
      if (maxY - minY + 80 > (this.h - top - bottom) / zp) {
        const lo = minY - 30 + (this.h / 2 - top) / zp, hi = maxY + 30 - (this.h / 2 - bottom) / zp;
        this.cam.y = Math.max(lo, Math.min(hi, this.cam.y));
      } else this.cam.y = (minY + maxY) / 2 + (bottom - top) / 2 / zp;
      if (maxX - minX + 40 > this.w / zp) this.cam.x = Math.max(minX - 10 + hx, Math.min(maxX + 10 - hx, this.cam.x));
      void hy;
    }
    this.fitted = true;
  }

  toWorld(sx: number, sy: number): Pt { return { x: (sx - this.w / 2) / this.cam.z + this.cam.x, y: (sy - this.h / 2) / this.cam.z + this.cam.y }; }
  toScreen(p: Pt): Pt { return { x: (p.x - this.cam.x) * this.cam.z + this.w / 2, y: (p.y - this.cam.y) * this.cam.z + this.h / 2 }; }

  regionAt(state: GameState, sx: number, sy: number): number | null {
    const p = this.toWorld(sx, sy);
    for (const r of state.regions) if (r.poly.length > 2 && !isLane(r) && pointInPoly(p, r.poly)) return r.id;
    return null;
  }

  /** Legacy hit-test: the fleet whose token is under the pointer (a group token returns its first fleet). */
  fleetAt(fleets: FleetDraw[], sx: number, sy: number): FleetDraw | null {
    const hit = this.tokenAt(sx, sy);
    if (hit) {
      const sel = fleets.find(f => f.selected && hit.fleetIds.includes(f.id));
      return sel ?? fleets.find(f => f.id === hit.fleetIds[0]) ?? fleets.find(f => hit.fleetIds.includes(f.id)) ?? null;
    }
    let best: FleetDraw | null = null, bd = 1e9;
    for (const f of fleets) {
      if (f.ghost || f.alpha <= 0.05) continue;
      const s = this.toScreen(this.drawnPos.get(f.id) ?? f.pos);
      const d = Math.hypot(s.x - sx, s.y - sy);
      if (d < this.hitR() && d < bd) { bd = d; best = f; }
    }
    return best;
  }

  /** The token under screen point (sx, sy): a group token (owner+region) or, when fanned out, a single fleet. */
  tokenAt(sx: number, sy: number): TokenHit | null {
    let best: TokHit | null = null, bd = Infinity;
    for (const h of this.tokHits) {
      const c = this.toScreen(h);
      const dx = sx - c.x, dy = sy - c.y;
      const inBox = dx >= h.l && dx <= h.r && dy >= h.t && dy <= h.b;
      const d = Math.hypot(dx, dy);
      if (!inBox && d > h.cr) continue;
      const score = inBox ? Math.min(d, 8) : d;
      if (score < bd) { bd = score; best = h; }
    }
    return best ? { ...best.hit, fleetIds: best.hit.fleetIds.slice() } : null;
  }

  /** The region whose banner (garrison cap / name plate / strategic plate) is under screen point (sx, sy). */
  bannerAt(sx: number, sy: number): number | null {
    const pad = this.coarse ? 6 : 3;
    for (let i = this.bannerHits.length - 1; i >= 0; i--) {
      const b = this.bannerHits[i];
      const c = this.toScreen(b);
      const dx = sx - c.x, dy = sy - c.y;
      if (dx >= b.l - pad && dx <= b.r + pad && dy >= b.t - pad && dy <= b.b + pad) return b.rid;
    }
    return null;
  }

  /** Screen position of a region's site (planet). */
  screenOfRegion(rid: number): Pt {
    const r = this.lastState?.regions[rid];
    return r ? this.toScreen(r.site) : { x: this.w / 2, y: this.h / 2 };
  }
  /** Screen position of an owner's token in a region (where it was drawn last frame, else its parking slot). */
  tokenScreenPos(region: number, owner: number): Pt {
    for (const h of this.tokHits) if (h.hit.region === region && h.hit.owner === owner) return this.toScreen(h);
    const r = this.lastState?.regions[region];
    if (!r) return { x: this.w / 2, y: this.h / 2 };
    return this.toScreen(anchorOf(r, owner, this.tier, this.px(1), this.slotK()));
  }

  /** Phone-sized viewport: smaller labels, bigger touch targets. */
  get compact() { return this.w > 0 && this.w <= 700; }
  private get coarse() { return coarsePointer() || this.compact; }
  private hitR() { return this.coarse ? 26 : 22; }

  /** Screen-constant size in world units. */
  px(n: number) { return n / this.cam.z; }

  private lastState: GameState | null = null;
  private computeTier(prev: Tier | null): Tier {
    const st = this.lastState;
    if (!st) return 'operational';
    return tierFor(medianRegionRadius(st) * this.cam.z, prev, this.coarse);
  }
  private slotK() { return this.lastState ? slotScale(this.tier, medianRegionRadius(this.lastState) * this.cam.z) : 1; }
  /** How much the system art (planets, structures, minis) grows at detail zoom (1 elsewhere). */
  private artK() { return this.lastState ? slotScale('detail', medianRegionRadius(this.lastState) * this.cam.z) : 1; }

  /** Cached static layer (background, regions, borders, banners): redrawn only when its inputs change. */
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
    this.lastState = st;
    const W = this.canvas.width, H = this.canvas.height;
    if (!W || !H) return;
    // the battle viewer covers the whole screen: keep the last frame instead of animating the map underneath it
    if (battleViewerOpen() && this.layer && this.layerKey) return;
    const now = I.now;
    this.dt = this.lastNow ? Math.min(100, Math.max(0, now - this.lastNow)) : 16;
    this.lastNow = now; this.now = now;
    this.stepCam(now);
    const prevTier = this._tier;
    this._tier = this.computeTier(prevTier);
    this.trackOwners(I);
    this.rememberGarrisons(I);
    const lens = I.lens ?? 'political';
    // hover & selection live in the dynamic pass (faded), so they don't force a rebuild of the static layer
    const base = [this.objId(st), this.staticSig(I), this.objId(I.visible), I.visible.size, I.you, I.owners.join(','), W, H, this.dpr,
      I.cutOff ? `${this.objId(I.cutOff)}:${I.cutOff.size}` : 0, this._tier, lens, I.peek ? 1 : 0, I.selectedRegion ?? -1, this.lkVer, this.coarse ? 1 : 0].join('|');
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
      // tier switch: keep a snapshot of the old layer and crossfade it out (text never scales; the content swaps)
      if (prevTier && prevTier !== this._tier && this.layerKey && lc && !reducedMotion()) {
        const c = this.fade?.c && this.fade.c.width === W && this.fade.c.height === H ? this.fade.c : document.createElement('canvas');
        c.width = W; c.height = H;
        const x = c.getContext('2d')!;
        x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, W, H); x.drawImage(this.layer, 0, 0);
        this.fade = { c, cam: { ...lc }, t0: now };
      }
      const main = this.ctx;
      this.ctx = this.layer.getContext('2d')!;
      artGeneration();
      try { this.drawStatic(I); } finally { this.ctx = main; }
      this.layerKey = base;
      this.layerCam = { ...cam };
    }
    const { ctx } = this;
    if (fast && lc) {
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.drawImage(this.bgCanvas!, 0, 0, this.w, this.h);
      // stars under the strip the shifted layer uncovers at the edge
      if (this.starPattern) {
        const px = -cam.x * cam.z * 0.05, py = -cam.y * cam.z * 0.05;
        ctx.save(); ctx.translate(((px % this.w) + this.w) % this.w, ((py % this.h) + this.h) % this.h);
        ctx.fillStyle = this.starPattern; ctx.fillRect(-this.w, -this.h, this.w * 2, this.h * 2); ctx.restore();
      }
      this.blitAt(this.layer, lc, 1);
    } else {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.layer, 0, 0);
    }
    if (this.fade) {
      const t = (now - this.fade.t0) / FADE_MS;
      if (t >= 1) this.fade = null;
      else { ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); this.blitAt(this.fade.c, this.fade.cam, 1 - easeOutCubic(clamp01(t))); }
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawTwinkles(now);
    ctx.save();
    ctx.translate(this.w / 2, this.h / 2);
    ctx.scale(this.cam.z, this.cam.z);
    ctx.translate(-this.cam.x, -this.cam.y);
    this.drawOwnerFx(I);
    this.drawHover(I);
    this.drawTargeting(I);
    if (I.unsupplied?.size) {
      for (const rid of I.unsupplied) { const r = st.regions[rid]; if (!r || r.kind === 'void') continue; path(ctx, r.poly); ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fill(); }
    }
    this.drawRegionSelection(I);
    // animated parts of sites
    for (const r of st.regions) this.drawSiteAnim(r, I, this.colorOf(st, I.owners[r.id]));
    this.drawDynamic(I);
    ctx.restore();
  }

  /** Draw a cached full-canvas layer rendered at camera `lc` under the current camera (dpr transform already set). */
  private blitAt(img: HTMLCanvasElement, lc: Cam, alpha: number) {
    const cam = this.cam, ctx = this.ctx;
    const k = cam.z / lc.z;
    const ox = (this.w / 2) * (1 - k) + (lc.x - cam.x) * cam.z, oy = (this.h / 2) * (1 - k) + (lc.y - cam.y) * cam.z;
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, ox, oy, this.w * k, this.h * k);
    ctx.globalAlpha = 1;
  }

  /** Hash of every region field the static layer draws, so an in-place change (a battery, a vein, a garrison, a
   *  project, loyalty, a renamed region, a siege…) rebuilds the cache even when the state object is the same one. */
  private staticSig(I: DrawInput): number {
    let h = 17;
    const mix = (v: number) => { h = (Math.imul(h, 31) + (v | 0)) | 0; };
    const str = (t: string | null | undefined) => { if (!t) { mix(0); return; } for (let i = 0; i < t.length; i++) mix(t.charCodeAt(i)); mix(t.length); };
    const st = I.state;
    for (const r of st.regions) {
      mix(r.owner ?? -9); mix(r.garrison); mix(r.dev); str(r.kind); str(r.relic as string | undefined); str(r.name);
      str(r.trait as string | undefined); str(r.vein as string | undefined); str(r.project?.key); mix(Math.round((r.project?.progress ?? 0) * 100)); mix(r.memorials.length);
      if (I.you !== null) mix(Math.round((r.loyalty[I.you] ?? 0) * 100));
      const b = r.buildings as Record<string, number | undefined>;
      for (const k in b) { str(k); mix(b[k] ?? 0); }
    }
    for (const p of st.players) { str(p.color); str(p.name); }
    for (const e of st.engagements ?? []) { mix(e.region); mix(e.garrisonStart); }
    for (const f of st.fleets) if (f.siege !== null && f.siege !== undefined) { mix(f.siege); mix(f.region); }
    // every token's parking slot (name plates step aside for them), and your own fleets (supply)
    for (const f of st.fleets) if (f.ships.length) { mix(f.region); mix(f.owner); }
    // the Soul layer's world marks: calling (+ dormant), tenure tier, deeds
    for (const r of st.regions) {
      const so = r.story;
      if (!so) continue;
      str(so.calling?.id); mix((so.calling?.dormantUntil ?? 0) > st.turn ? 1 : 0); mix(so.calling ? tenureTier(st, r) : 0);
      for (const d of so.deeds) { str(d.id); mix(d.engraved ? 1 : 0); }
    }
    mix(st.rules.empire?.enabled === false ? 1 : 0);
    return h;
  }

  private colorOf(st: GameState, o: number | null | undefined) { return o === null || o === undefined || o < 0 ? (o === -1 ? WARDEN : NEUTRAL_COLOR) : st.players[o]?.color ?? NEUTRAL_COLOR; }
  private regionColor(st: GameState, o: number | null | undefined) { return o === null || o === undefined || o < 0 ? NEUTRAL_COLOR : st.players[o]?.color ?? NEUTRAL_COLOR; }

  /** Remember garrisons while visible, so fogged banners can say "~N". */
  private rememberGarrisons(I: DrawInput) {
    for (const r of I.state.regions) {
      if (r.garrison < 0) continue;
      if (I.you !== null && !I.visible.has(r.id) && r.owner !== I.you) continue;
      if (this.lastKnown.get(r.id) !== r.garrison) { this.lastKnown.set(r.id, r.garrison); this.lkVer++; }
    }
  }

  /** Your connected + supplied sets (memoized per state). */
  private supplySets(I: DrawInput): { conn: Set<number> | null; sup: Set<number> | null } {
    const st = I.state, you = I.you;
    if (you === null || st.rules.empire?.enabled === false || !st.players[you]) return { conn: null, sup: null };
    const m = this.memoSup;
    if (m.st !== st || m.you !== you) {
      m.st = st; m.you = you;
      try { m.conn = connected(st, you); m.sup = supplied(st, you, m.conn); } catch { m.conn = null; m.sup = null; }
    }
    return { conn: m.conn, sup: m.sup };
  }
  private cutOffOf(I: DrawInput): Set<number> | null {
    if (I.cutOff !== undefined) return I.cutOff;
    const { conn } = this.supplySets(I);
    if (!conn || I.you === null) return null;
    const s = new Set(I.state.regions.filter(r => r.owner === I.you && !conn.has(r.id)).map(r => r.id));
    return s.size ? s : null;
  }

  private fleetById(st: GameState, id: number): Fleet | undefined {
    const F = this.fleetIdx;
    if (F.src !== st.fleets) {
      F.src = st.fleets; F.m = new Map(st.fleets.map(f => [f.id, f]));
      F.last = new Map((st.last?.startFleets ?? []).map(f => [f.id, f]));
    }
    return F.m.get(id) ?? F.last.get(id);
  }

  // ================================================================ static layer
  private drawStatic(I: DrawInput) {
    const { ctx } = this;
    const st = I.state;
    const tier = this.tier;
    const lens = I.lens ?? 'political';
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // ---------------------------------------------------------------- background (pre-rendered gradient + one star-pattern pass)
    if (!this.stars || !this.bgCanvas) {
      this.stars = starfield(this.w, this.h, st.seed);
      this.starPattern = ctx.createPattern(this.stars, 'repeat');
      this.bgCanvas = matBackdrop(this.w, this.h);
      this.lamp = lampOverlay(this.w, this.h);
      this.weave = ctx.createPattern(weaveTile(), 'repeat');
      this.hatch = { cut: ctx.createPattern(hatchTile('rgba(255,255,255,0.55)', 8, 1.6), 'repeat'), dark: ctx.createPattern(hatchTile('rgba(0,0,0,0.55)', 6, 2), 'repeat') };
    }
    ctx.drawImage(this.bgCanvas, 0, 0, this.w, this.h);
    if (this.starPattern) {
      const par = { x: -this.cam.x * this.cam.z * 0.05, y: -this.cam.y * this.cam.z * 0.05 };
      ctx.save();
      ctx.globalAlpha = 0.8;
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
    const S = this.px(1);
    // screen-constant hatch patterns
    const pm = new DOMMatrix().scale(S, S);
    this.hatch.cut?.setTransform(pm); this.hatch.dark?.setTransform(pm);

    // deep-space nebula haze: soft, so a low-resolution bake scaled up looks the same and costs one blit
    if (this.haze) ctx.drawImage(this.haze.c, this.haze.x, this.haze.y, this.haze.w, this.haze.h);
    // the cloth's weave, anchored to the mat (screen-constant scale)
    if (this.weave) {
      ctx.save();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const ox = -this.cam.x * this.cam.z, oy = -this.cam.y * this.cam.z;
      ctx.translate(((ox % 96) + 96) % 96 - 96, ((oy % 96) + 96) % 96 - 96);
      ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.22;
      ctx.fillStyle = this.weave; ctx.fillRect(0, 0, this.w + 192, this.h + 192);
      ctx.restore();
    }

    const political = lens === 'political';
    const fillA = tier === 'strategic' ? 0.44 : tier === 'operational' ? 0.17 : 0.12;
    const { conn, sup } = this.supplySets(I);
    // ---------------------------------------------------------------- region fills + terrain textures
    for (const r of st.regions) {
      if (isLane(r) || r.poly.length < 3) continue;
      const owner = I.owners[r.id];
      const c = this.regionColor(st, owner);
      path(ctx, r.poly);
      if (owner === null || owner === undefined) ctx.fillStyle = 'rgba(40,30,70,0.30)';
      else ctx.fillStyle = political ? hexA(c, fillA) : hexA(desat(c, 0.8), 0.12);
      ctx.fill();
      // terrain by texture only: void is black and starless, a nebula a soft haze, an asteroid field speckle
      if (r.kind === 'void') { ctx.fillStyle = 'rgba(2,1,6,0.86)'; ctx.fill(); }
      if (r.feature === 'nebula') {
        const g = ctx.createRadialGradient(r.centroid.x, r.centroid.y, 0, r.centroid.x, r.centroid.y, 260);
        g.addColorStop(0, 'rgba(190,90,255,0.24)'); g.addColorStop(1, 'rgba(120,40,200,0.02)');
        ctx.fillStyle = g; ctx.fill();
      }
      if (r.feature === 'asteroids') {
        // a rendered rock field: lit lumps with tiny shadows (screen-constant size, fixed on the mat)
        const pts = this.asteroidCache.get(r.id) ?? [];
        const big = tier !== 'strategic';
        pts.forEach((p, i) => {
          if (i % (big ? 2 : 3)) return;
          const sz = ((big ? 1.8 : 1.2) + ((i * 7) % 5) * (big ? 0.55 : 0.3)) * (tier === 'detail' ? Math.sqrt(this.artK()) : 1);
          const spr = rockSprite(i, sz * this.dpr);
          const w = (spr.width / this.dpr) * S;
          ctx.drawImage(spr, p.x - w / 2, p.y - w / 2, w, w);
        });
      }
      if (lens === 'economy' && r.kind !== 'void') {
        // development tint: richer worlds glow warmer
        const d = owner !== null && owner !== undefined ? r.dev : 0;
        const v = r.vein ? 1 : 0;
        if (d || v) { path(ctx, r.poly); ctx.fillStyle = `rgba(255,200,110,${0.05 + 0.05 * d + 0.04 * v})`; ctx.fill(); }
      }
      if (lens === 'supply' && sup && r.kind !== 'void' && !sup.has(r.id)) { path(ctx, r.poly); ctx.fillStyle = 'rgba(0,0,0,0.38)'; ctx.fill(); if (this.hatch.dark) { ctx.fillStyle = this.hatch.dark; ctx.fill(); } }
      if (I.you !== null && !I.visible.has(r.id)) { path(ctx, r.poly); ctx.fillStyle = 'rgba(3,2,8,0.42)'; ctx.fill(); }
    }

    // ---------------------------------------------------------------- borders: thin region seams, thick empire edges
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(170,150,230,0.10)'; ctx.lineWidth = S;
    for (const r of st.regions) { if (r.poly.length > 2) { path(ctx, r.poly); ctx.stroke(); } }
    const edges = regionEdges(st);
    const bw = (tier === 'strategic' ? 5 : tier === 'operational' ? 3.4 : 3) * (political ? 1 : 0.6);
    // one clip (the owner's territory) and one stroke (its outer edges) per owner: the band sits inside the border
    for (const pl of st.players) {
      const mine = st.regions.filter(r => I.owners[r.id] === pl.id && r.poly.length > 2);
      if (!mine.length) continue;
      const c = this.regionColor(st, pl.id);
      ctx.save();
      ctx.beginPath();
      for (const r of mine) { r.poly.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); }
      ctx.clip();
      ctx.beginPath();
      for (const r of mine) for (const e of edges[r.id]) {
        if (e.other >= 0 && I.owners[e.other] === pl.id) continue;
        ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(e.b.x, e.b.y);
      }
      // painted border: a soft wash, a solid brush band, then a fine dark ink line on the edge itself
      ctx.lineCap = 'round';
      ctx.strokeStyle = hexA(c, political ? 0.16 : 0.08); ctx.lineWidth = bw * 6 * S; ctx.stroke();
      ctx.strokeStyle = political ? hexA(c, 0.85) : hexA(c, 0.45); ctx.lineWidth = bw * 2 * S; ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = 'rgba(2,2,8,0.7)'; ctx.lineWidth = 1.3 * S; ctx.stroke();
    }

    // ---------------------------------------------------------------- hyperlanes: etched routes on the mat, beacon buoys
    {
      const strat = tier === 'strategic';
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      for (const L of hyperlanes(st)) { L.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); }
      // groove (dark), the lit lip on the lamp side, the faint glow of the printed route
      ctx.strokeStyle = 'rgba(0,0,8,0.5)'; ctx.lineWidth = (strat ? 3 : 4.2) * S; ctx.stroke();
      ctx.strokeStyle = strat ? 'rgba(150,180,255,0.16)' : 'rgba(150,185,255,0.24)'; ctx.lineWidth = (strat ? 2.2 : 3) * S; ctx.stroke();
      ctx.strokeStyle = strat ? 'rgba(215,228,255,0.38)' : 'rgba(225,235,255,0.55)'; ctx.lineWidth = (strat ? 0.8 : 1.1) * S; ctx.stroke();
      const dr = (strat ? 2.2 : 3.4);
      const buoy = buoySprite(dr * this.dpr, false);
      const bw = (buoy.width / this.dpr) * S;
      for (const r of st.regions) if (isLane(r)) ctx.drawImage(buoy, r.site.x - bw / 2, r.site.y - bw / 2, bw, bw);
      ctx.restore();
    }

    // ---------------------------------------------------------------- supply: cut-off hatch (every tier), network lines (detail / lens)
    const cut = this.cutOffOf(I);
    if (cut?.size) {
      for (const rid of cut) {
        const r = st.regions[rid];
        if (!r) continue;
        path(ctx, r.poly);
        if (this.hatch.cut) { ctx.globalAlpha = lens === 'supply' ? 1 : 0.65; ctx.fillStyle = this.hatch.cut; ctx.fill(); ctx.globalAlpha = 1; }
        ctx.save(); ctx.setLineDash([7 * S, 5 * S]); ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.6 * S; ctx.stroke(); ctx.restore();
      }
    }
    if ((tier === 'detail' || lens === 'supply' || I.peek) && conn && I.you !== null) {
      const c = this.regionColor(st, I.you);
      ctx.save();
      ctx.strokeStyle = hexA(c, lens === 'supply' ? 0.85 : 0.45); ctx.lineWidth = (lens === 'supply' ? 3 : 2) * S; ctx.lineCap = 'round';
      ctx.setLineDash([2 * S, 6 * S]);
      ctx.beginPath();
      for (const rid of conn) {
        const r = st.regions[rid];
        if (!r || isLane(r)) continue;
        for (const n of r.neighbors) if (n > rid && conn.has(n)) { ctx.moveTo(r.site.x, r.site.y); ctx.lineTo(st.regions[n].site.x, st.regions[n].site.y); }
      }
      ctx.stroke();
      ctx.restore();
    }
    if (tier !== 'strategic' || lens === 'supply') {
      const gates = new Map<number, Region[]>();
      for (const r of st.regions) if (r.buildings.gate && r.owner !== null && I.owners[r.id] === r.owner) { const a = gates.get(r.owner) ?? []; a.push(r); gates.set(r.owner, a); }
      ctx.save();
      ctx.setLineDash([2 * S, 6 * S]); ctx.lineCap = 'round';
      for (const [o, gs] of gates) {
        ctx.strokeStyle = hexA(this.regionColor(st, o), o === I.you ? 0.55 : 0.3); ctx.lineWidth = (o === I.you ? 2 : 1.4) * S;
        for (let i = 0; i < gs.length; i++) for (let j = i + 1; j < gs.length; j++) { ctx.beginPath(); ctx.moveTo(gs[i].site.x, gs[i].site.y); ctx.lineTo(gs[j].site.x, gs[j].site.y); ctx.stroke(); }
      }
      ctx.restore();
    }

    // ---------------------------------------------------------------- empire names across their territory (strategic)
    if (tier === 'strategic' && !I.peek) {
      for (const L of empireLabels(st, I.owners)) {
        const pl = st.players[L.owner];
        const name = pl.name.toUpperCase();
        const span = L.span * this.cam.z;
        // one line if it fits, else split at the middle word; size measured to the territory's width
        const words = name.split(/\s+/);
        const lines = words.length > 1 && span < name.length * 15 ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')] : [name];
        const widthAt = (fs: number) => { ctx.font = displayFont(fs * S); return Math.max(...lines.map(l => ctx.measureText(l).width / S + fs * 0.18 * (l.length - 1))); };
        let fs = 30;
        const w30 = widthAt(30);
        fs = Math.max(11, Math.min(this.compact ? 18 : 26, (30 * span * 0.95) / Math.max(1, w30)));
        ctx.font = displayFont(fs * S);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.globalAlpha = political ? 0.6 : 0.3;
        ctx.lineWidth = 3 * S; ctx.strokeStyle = 'rgba(5,3,12,0.6)'; ctx.lineJoin = 'round';
        ctx.fillStyle = hexA(pl.color, 1);
        const lh = fs * 1.1 * S;
        lines.forEach((l, i) => letterSpaced(ctx, l, L.p.x, L.p.y + (i - (lines.length - 1) / 2) * lh, fs * 0.18 * S, true));
        ctx.globalAlpha = 1; ctx.textBaseline = 'alphabetic';
      }
    }

    // ---------------------------------------------------------------- sites & banners
    this.labelBoxes = [];
    this.hiddenLabels.clear();
    this.bannerHits = [];
    const prio = (r: Region) => (r.id === I.selectedRegion ? -1 : ({ throne: 0, crown: 1, home: 2, relic: 3, colony: 4, void: 5 } as Record<string, number>)[r.kind] ?? 6);
    const order = st.regions.filter(r => !isLane(r)).sort((a, b) => prio(a) - prio(b));
    this.relaxPlates(I, order);
    // planets and garrison numbers first: they are obstacles for names, and never hidden
    for (const r of order) this.drawSiteAndCap(r, I, this.bannerTier(r, I));
    this.tokenObstacles(I);
    for (const r of order) this.drawBannerExtras(r, I, this.bannerTier(r, I));
    if (lens === 'economy') for (const r of order) this.drawEconomyIcons(r, I);
    ctx.restore();
    // the table: lamp pool and vignette over the board (screen space, static)
    if (this.lamp) ctx.drawImage(this.lamp, 0, 0, this.w, this.h);
  }

  /** Fleet tokens park at fixed slots around their world: name plates (placed after) must not sit under them, or a
   *  miniature ends up standing on a neighbouring world's name. Their boxes join the label obstacles. */
  private tokenObstacles(I: DrawInput) {
    if (this.tier === 'strategic' && !I.peek) return;
    const st = I.state, S = this.px(1), k = this.slotK(), tier = this.tier;
    const seen = new Set<string>();
    for (const f of st.fleets) {
      if (!f.ships.length) continue;
      const r = st.regions[f.region];
      if (!r || (I.you !== null && f.owner !== I.you && !I.visible.has(r.id))) continue;
      const key = `${f.owner}:${f.region}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const a = anchorOf(r, f.owner, tier, S, k);
      const side = slotFor(tier, f.owner).side;
      const rb = tier === 'detail' ? 22 * Math.pow(this.artK(), 0.75) : 18;
      const l = a.x - rb * S - (side < 0 ? 44 * S : 0), rr = a.x + rb * S + (side > 0 ? 44 * S : 0);
      this.labelBoxes.push({ x: l, y: a.y - 42 * S, w: rr - l, h: 50 * S });
    }
  }

  /** Strategic plates whose sites sit close together are nudged apart (≤ 16px) so numbers never overprint. */
  private plateOff = new Map<number, Pt>();
  private relaxPlates(I: DrawInput, regs: Region[]) {
    this.plateOff.clear();
    if (this.tier !== 'strategic' || I.peek) return;
    const S = this.px(1);
    const z = this.cam.z;
    const items = regs.filter(r => r.kind !== 'void' && this.bannerTier(r, I) === 'strategic').map(r => ({ r, x: r.site.x * z, y: r.site.y * z, ox: 0, oy: 0, rad: r.kind === 'crown' || r.kind === 'throne' ? 21 : 15 }));
    for (let it = 0; it < 8; it++) {
      for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        const dx = (b.x + b.ox) - (a.x + a.ox), dy = (b.y + b.oy) - (a.y + a.oy);
        const d = Math.hypot(dx, dy) || 0.01, need = a.rad + b.rad + 2;
        if (d >= need) continue;
        const push = (need - d) / 2, ux = dx / d, uy = dy / d;
        a.ox -= ux * push; a.oy -= uy * push; b.ox += ux * push; b.oy += uy * push;
      }
      for (const q of items) { const m = Math.hypot(q.ox, q.oy); if (m > 16) { q.ox *= 16 / m; q.oy *= 16 / m; } }
    }
    for (const q of items) if (q.ox || q.oy) this.plateOff.set(q.r.id, { x: q.ox * S, y: q.oy * S });
  }

  private bannerTier(r: Region, I: DrawInput): Tier {
    if (I.peek || r.id === I.selectedRegion) return 'detail';
    return this.tier;
  }

  private siteR(r: Region, bt: Tier): number {
    if (r.kind === 'void') return 2.5;
    if (bt === 'strategic') return 4;
    const big = r.kind === 'throne' ? 14 : r.kind === 'home' || r.kind === 'crown' ? 14 : r.trait === 'gas' ? 12.5 : 9.5 + Math.min(4, r.dev) * 0.7;
    return bt === 'detail' ? big * 1.6 * this.artK() : big;
  }

  /** Banner geometry (screen px relative to the site) for region r at banner tier bt. */
  private capGeom(r: Region, bt: Tier, txt: string) {
    const C = this.coarse;
    if (bt === 'strategic') {
      const nf = C ? 14 : 13;
      this.ctx.font = numFont(nf * this.px(1));
      const tw = this.ctx.measureText(txt).width / this.px(1);
      const w = Math.max(C ? 26 : 23, tw + 10), h = C ? 28 : 25;
      return { nf, w, h, cy: 0 };
    }
    const nf = C ? 17 : 16;
    this.ctx.font = numFont(nf * this.px(1));
    const tw = this.ctx.measureText(txt).width / this.px(1);
    const w = Math.max(C ? 30 : 27, tw + 11), h = C ? 32 : 29;
    const pr = this.siteR(r, bt);
    return { nf, w, h, cy: pr + 7 + h / 2 };
  }

  private garrisonText(r: Region, I: DrawInput): { txt: string; fog: boolean } {
    const fog = I.you !== null && !I.visible.has(r.id) && r.owner !== I.you;
    if (r.garrison >= 0 && !fog) return { txt: String(r.garrison), fog };
    // fogged: a neutral garrison you have a number for shows it plainly (it barely changes); a rival's is a stale
    // estimate ("~N"); never seen at all is "?"
    const lk = this.lastKnown.get(r.id);
    const known = r.garrison >= 0 ? r.garrison : lk;
    if (known === undefined) return { txt: '?', fog };
    const neutral = (I.owners[r.id] ?? null) === null || (I.owners[r.id] ?? -1) < 0;
    return { txt: neutral ? String(known) : `~${known}`, fog };
  }

  private sieged(r: Region, st: GameState): Engagement | true | null {
    const e = (st.engagements ?? []).find(x => x.region === r.id);
    if (e) return e;
    return st.fleets.some(f => f.siege === r.id && f.region === r.id && f.ships.length) ? true : null;
  }

  /** Literal defences under the shield cap: a tower per fortress level, guns, a dome for a planetary shield. */
  private defenses(r: Region): { k: string; n: number }[] {
    const b = r.buildings, out: { k: string; n: number }[] = [];
    if (b.fortress) out.push({ k: 'fortress', n: b.fortress });
    if (b.battery) out.push({ k: 'battery', n: b.battery });
    if (b.pshield) out.push({ k: 'pshield', n: 1 });
    return out;
  }
  /** Bottom of the cap (+ defence tab), screen px below the site, per region (filled by drawSiteAndCap). */
  private capBottom = new Map<number, number>();

  /** The planet (operational/detail) or the garrison plate (strategic), and the banner's shield cap with the garrison. */
  private drawSiteAndCap(r: Region, I: DrawInput, bt: Tier) {
    const { ctx } = this;
    const st = I.state;
    const S = this.px(1);
    const p = r.site;
    const owner = I.owners[r.id];
    const c = this.regionColor(st, owner);
    const lens = I.lens ?? 'political';
    if (r.kind === 'void') {
      ctx.fillStyle = 'rgba(200,200,255,0.35)'; ctx.beginPath(); ctx.arc(p.x, p.y, 2 * S, 0, TAU); ctx.fill();
      return;
    }
    const { txt, fog } = this.garrisonText(r, I);
    const neutral = owner === null || owner === undefined;
    const fillC = fog ? '#5d5a74' : neutral ? '#34304a' : c;
    const ink = fog ? '#e4e0f4' : neutral ? '#e9e6f6' : inkOn(c);
    const kingly = r.kind === 'crown' || r.kind === 'throne';
    const defs = this.defenses(r);
    if (bt === 'strategic') {
      const g = this.capGeom(r, bt, txt);
      const po = this.plateOff.get(r.id);
      const p = po ? { x: r.site.x + po.x, y: r.site.y + po.y } : r.site;
      // the plate *is* the region marker at this zoom: shield for worlds, diamond for Crowns and the Throne
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 6 * S;
      ctx.shadowOffsetY = 2 * S;
      if (kingly) {
        const rx = (g.w / 2 + 7) * S, ry = (g.h / 2 + 7) * S;
        diamondPath(ctx, p.x, p.y, rx, ry);
        ctx.fillStyle = '#000'; ctx.fill(); ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
        enamel(ctx, fillC, p.y - ry, p.y + ry, 'gold', (r.kind === 'throne' ? 3.2 : 2.4) * S);
      } else {
        shieldPath(ctx, p.x, p.y, g.w * S, g.h * S);
        ctx.fillStyle = '#000'; ctx.fill(); ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
        enamel(ctx, fillC, p.y - g.h / 2 * S, p.y + g.h / 2 * S, r.kind === 'home' ? 'silver' : 'iron', (r.kind === 'home' ? 2.2 : 1.5) * S);
      }
      ctx.restore();
      ctx.font = numFont(g.nf * S); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      stampedText(ctx, txt, p.x, p.y + (kingly ? 0.5 : -1.5) * S, ink, S);
      ctx.textBaseline = 'alphabetic';
      const hw = kingly ? g.w / 2 + 7 : g.w / 2, hh = kingly ? g.h / 2 + 7 : g.h / 2;
      // fortified: a little tower on the plate's shoulder
      if (defs.length && !fog) {
        const tx = p.x + (hw - 2) * S, ty = p.y - (hh - 2) * S;
        ctx.beginPath(); ctx.arc(tx, ty, 6.5 * S, 0, TAU); ctx.fillStyle = 'rgba(8,4,16,0.95)'; ctx.fill();
        buildingIcon(ctx, 'fortress', tx, ty, 4 * S, STONE, 1.2 * S);
      }
      this.labelBoxes.push({ x: p.x - hw * S, y: p.y - hh * S, w: hw * 2 * S, h: hh * 2 * S });
      this.bannerHits.push({ rid: r.id, x: p.x, y: p.y, l: -hw, t: -hh, r: hw, b: hh });
      return;
    }
    // ---- the world: a painted body floating over the mat (or the Throne's star, a relic site's dark star)
    const pr = this.siteR(r, bt) * S;
    const prDev = this.siteR(r, bt) * this.dpr;
    const art = regionArt(r, I.state.seed);
    const halo = ctx.createRadialGradient(p.x, p.y, pr * 0.8, p.x, p.y, pr * 2.6);
    halo.addColorStop(0, hexA(c, owner === null || owner === undefined ? 0.06 : 0.22)); halo.addColorStop(1, hexA(c, 0));
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(p.x, p.y, pr * 2.6, 0, TAU); ctx.fill();
    if (art.star) {
      const sk = r.kind === 'throne' ? 0.75 : art.star === 'pulsar' ? 0.32 : 0.5;
      drawStar(ctx, p.x, p.y, pr * sk, prDev * sk, art.star);
      if (r.kind === 'throne') {
        // the Ring Ruin: broken golden arcs around the throne star
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(-0.3);
        ctx.lineCap = 'butt';
        for (let i = 0; i < 7; i++) {
          const a0 = (i / 7) * TAU + 0.15, a1 = a0 + TAU / 7 - 0.32;
          ctx.strokeStyle = 'rgba(20,12,4,0.85)'; ctx.lineWidth = 3.4 * S; ctx.beginPath(); ctx.ellipse(0, 0, pr * 1.6, pr * 0.62, 0, a0, a1); ctx.stroke();
          ctx.strokeStyle = i % 2 ? '#e0aa3c' : '#ffe08a'; ctx.lineWidth = 2 * S; ctx.beginPath(); ctx.ellipse(0, 0, pr * 1.6, pr * 0.62, 0, a0, a1); ctx.stroke();
        }
        ctx.restore();
      }
      if (r.kind === 'relic' && r.relic && bt !== 'detail') drawGlow(ctx, p.x + pr * 0.9, p.y + pr * 0.3, 7 * S, [200, 230, 255], 0.55);
      if (r.kind === 'relic' && r.relic && bt === 'detail') {
        // an unexcavated relic: a glinting monolith drifting by the dark star
        const mx = p.x + pr * 1.1, my = p.y + pr * 0.5;
        ctx.save(); ctx.translate(mx, my); ctx.rotate(0.35);
        const mg = ctx.createLinearGradient(-3 * S, 0, 3 * S, 0); mg.addColorStop(0, '#f4f7ff'); mg.addColorStop(0.5, '#7d86a8'); mg.addColorStop(1, '#1a1c28');
        ctx.fillStyle = mg; ctx.fillRect(-2.5 * S, -6 * S, 5 * S, 12 * S);
        ctx.restore();
        drawGlow(ctx, mx, my - 5 * S, 9 * S, [200, 230, 255], 0.6);
      }
    } else if (art.body) {
      drawBodyShadow(ctx, p.x + pr * 0.45, p.y + pr * 0.9, pr * 1.15, 0.55);
      if (bt === 'detail' && art.moon) {
        const mx = p.x - pr * 1.75, my = p.y + pr * 0.85;
        drawBodyShadow(ctx, mx + pr * 0.15, my + pr * 0.32, pr * 0.36, 0.45);
        drawPlanet(ctx, mx, my, pr * 0.3, prDev * 0.3, art.moon, true);
      }
      drawPlanet(ctx, p.x, p.y, pr, prDev, art.body, true);
      if (r.kind === 'crown') {
        ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 3 * S; ctx.shadowOffsetY = 1 * S;
        const cr = Math.max(5 * S, pr * 0.36), cy0 = p.y - pr - cr * 0.9;
        const cg = ctx.createLinearGradient(0, cy0 - cr, 0, cy0 + cr);
        cg.addColorStop(0, '#fff3b8'); cg.addColorStop(0.45, '#e2aa3a'); cg.addColorStop(1, '#7a4c10');
        crownGlyph(ctx, p.x, cy0, cr, cg); ctx.strokeStyle = "rgba(40,24,4,0.85)"; ctx.lineWidth = 0.8 * S; ctx.stroke();
        ctx.restore();
      }
    }
    // ---- detail tier: the system's orbital pieces as little modelled structures
    if (bt === 'detail' && !fog) {
      const b = r.buildings;
      const list: Structure[] = [];
      if (b.shipyard) list.push('shipyard');
      if (b.fortress) list.push('fortress');
      for (let i = 0; i < Math.min(3, b.battery ?? 0); i++) list.push('battery');
      if (b.gate) list.push('gate');
      if (b.depot) list.push('depot');
      if (b.sensor) list.push('sensor');
      const angs = [0.32, 2.82, 0.85, 2.3, 1.2, 1.95, 0.0];
      const team = this.regionColor(st, owner);
      list.slice(0, angs.length).forEach((k, i) => {
        const a = angs[i] + (art.moon && i === 1 ? 0.3 : 0);
        const R = pr * (1.55 + (i % 2) * 0.12) + 6 * S;
        const sx = p.x + Math.cos(a) * R, sy = p.y + Math.sin(a) * R * 0.85;
        const sz = (k === 'gate' ? 7 : k === 'shipyard' ? 7 : 5.5) * S * this.artK();
        drawBodyShadow(ctx, sx + sz * 0.4, sy + sz * 0.8, sz * 1.1, 0.4);
        drawStructure(ctx, k, team, sx, sy, sz, (sz / S) * this.dpr);
      });
      if (b.pshield) shieldDome(ctx, p.x, p.y, pr * 1.28, 1.2 * S);
    } else if (bt === 'operational' && r.buildings.pshield && !fog) shieldDome(ctx, p.x, p.y, pr * 1.3, 1 * S);
    this.labelBoxes.push({ x: p.x - pr * 1.2, y: p.y - pr * 2.1, w: pr * 2.4, h: pr * 3.2 });

    // ---- shield cap with the garrison number
    const g = this.capGeom(r, bt, txt);
    const cx = p.x, cy = p.y + g.cy * S;
    this.drawCap(r, I, bt, txt, fog);
    this.drawSoulMarks(r, I, cx, cy, g.w, g.h);
    let bot = g.cy + g.h / 2;
    // ---- defence tab under the cap: literal towers / guns / dome, with a level number when > 1
    if (defs.length) {
      const mil = lens === 'military';
      const is = (mil ? 7.5 : 6) * S;
      ctx.font = numFont(12 * S);
      const parts = defs.map(d => ({ ...d, w: is * 2 + (d.n > 1 ? ctx.measureText(String(d.n)).width + 2 * S : 0) }));
      const w = parts.reduce((a, q) => a + q.w, 0) + 4 * S * (parts.length - 1) + 10 * S;
      const th = is * 2 + 5 * S;
      const ty = cy + (g.h / 2 - 5) * S;
      ctx.save();
      if (lens === 'economy') ctx.globalAlpha = 0.55;
      roundRect(ctx, cx - w / 2, ty, w, th, 4 * S); gunmetal(ctx, ty, ty + th, fog ? 'rgba(150,145,175,0.5)' : 'rgba(200,204,222,0.7)', 1 * S);
      let x = cx - w / 2 + 5 * S;
      for (const q of parts) {
        buildingIcon(ctx, q.k, x + is, ty + th / 2, is * 0.85, fog ? '#9a97b0' : STONE, 1.3 * S);
        if (q.n > 1) { ctx.font = numFont(12 * S); ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#ffffff'; ctx.fillText(String(q.n), x + is * 2 + 1 * S, ty + th / 2 + 0.5 * S); ctx.textBaseline = 'alphabetic'; }
        x += q.w + 4 * S;
      }
      ctx.restore();
      bot = (ty + th - p.y) / S;
      this.labelBoxes.push({ x: cx - w / 2, y: ty, w, h: th });
    }
    this.capBottom.set(r.id, bot);
    const hw = g.w / 2, top = g.cy - g.h / 2;
    this.labelBoxes.push({ x: cx - hw * S, y: p.y + top * S, w: hw * 2 * S, h: (g.cy + g.h / 2 - top) * S });
    this.bannerHits.push({ rid: r.id, x: p.x, y: p.y, l: -hw - 4, t: top, r: hw + 4, b: bot });
  }

  /** Soul layer on a world's banner: the calling medallion on the cap's left shoulder, ringed by tenure segments
   *  (dormant: grey, dashed), and deed pips over the cap (an engraved deed has a gold rim). */
  private drawSoulMarks(r: Region, I: DrawInput, cx: number, cy: number, w: number, h: number) {
    const so = r.story, st = I.state;
    if (!so || (I.lens ?? 'political') === 'economy') return;
    const { ctx } = this;
    const S = this.px(1);
    const owner = I.owners[r.id];
    if (so.calling && owner !== null && owner !== undefined && owner >= 0) {
      const c = CALLINGS[so.calling.id];
      const dorm = (so.calling.dormantUntil ?? -1) > st.turn;
      const tier = dorm ? 0 : tenureTier(st, r);
      const R = 8.5 * S;
      const mx = cx - (w / 2 + 6) * S, my = cy - (h / 2 - 5) * S;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 3 * S; ctx.shadowOffsetY = 1 * S;
      ctx.beginPath(); ctx.arc(mx, my, R, 0, TAU);
      ctx.fillStyle = '#000'; ctx.fill(); ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      gunmetal(ctx, my - R, my + R, dorm ? 'rgba(140,140,150,0.6)' : '#c9a35c', 1.1 * S);
      // tenure: three arcs around the medallion, lit as the calling grows (3, 6, 10 turns)
      ctx.lineCap = 'butt';
      for (let i = 0; i < 3; i++) {
        const a0 = -Math.PI / 2 + (i * TAU) / 3 + 0.22, a1 = a0 + TAU / 3 - 0.44;
        ctx.beginPath(); ctx.arc(mx, my, R + 2.6 * S, a0, a1);
        ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.lineWidth = 3.4 * S; ctx.stroke();
        ctx.beginPath(); ctx.arc(mx, my, R + 2.6 * S, a0, a1);
        ctx.strokeStyle = i < tier ? '#ffd86b' : dorm ? 'rgba(150,150,160,0.35)' : 'rgba(200,180,140,0.32)'; ctx.lineWidth = 2 * S; ctx.stroke();
      }
      ctx.font = numFont(11 * S); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = dorm ? '#9a98a6' : '#ffe2a0';
      ctx.fillText(c?.icon ?? '◇', mx, my + 0.5 * S);
      ctx.textBaseline = 'alphabetic';
      ctx.restore();
      this.labelBoxes.push({ x: mx - R - 4 * S, y: my - R - 4 * S, w: (R + 4 * S) * 2, h: (R + 4 * S) * 2 });
    }
    if (so.deeds.length) {
      const n = Math.min(2, so.deeds.length);
      const y = cy - (h / 2 + 4) * S;
      for (let i = 0; i < n; i++) {
        const d = so.deeds[i];
        const x = cx + (i - (n - 1) / 2) * 9 * S;
        diamondPath(ctx, x, y, 3.4 * S, 4.2 * S);
        ctx.fillStyle = d.engraved ? '#ffd86b' : '#d8dbe6'; ctx.fill();
        ctx.strokeStyle = d.engraved ? '#6a420c' : 'rgba(10,10,18,0.9)'; ctx.lineWidth = 1 * S; ctx.stroke();
      }
    }
  }

  /** Shield cap in the owner colour holding the garrison number (gold edge for Crowns and the Throne). */
  private drawCap(r: Region, I: DrawInput, bt: Tier, txt: string, fog: boolean) {
    const { ctx } = this;
    const S = this.px(1);
    const owner = I.owners[r.id];
    const c = this.regionColor(I.state, owner);
    const neutral = owner === null || owner === undefined;
    const g = this.capGeom(r, bt, txt);
    const cx = r.site.x, cy = r.site.y + g.cy * S;
    const kingly = r.kind === 'crown' || r.kind === 'throne';
    ctx.save();
    if ((I.lens ?? 'political') === 'economy') ctx.globalAlpha = 0.55;
    ctx.shadowColor = 'rgba(0,0,0,0.65)'; ctx.shadowBlur = 5 * S; ctx.shadowOffsetY = 2 * S;
    shieldPath(ctx, cx, cy, g.w * S, g.h * S);
    ctx.fillStyle = '#000'; ctx.fill(); ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    const rim: Rim = kingly ? 'gold' : r.kind === 'home' ? 'silver' : 'iron';
    enamel(ctx, fog ? '#5d5a74' : neutral ? '#3a3650' : c, cy - g.h / 2 * S, cy + g.h / 2 * S, rim, (kingly ? 2.2 : 1.5) * S);
    ctx.font = numFont(g.nf * S); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    stampedText(ctx, txt, cx, cy - g.h * 0.08 * S, fog ? '#e4e0f4' : neutral ? '#ffffff' : inkOn(c), S);
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  /** Name plate + badges (operational), siege bar, influence bar, and the detail rows (dev pips, building tray, trait/vein). */
  private drawBannerExtras(r: Region, I: DrawInput, bt: Tier) {
    if (r.kind === 'void' || bt === 'strategic') return;
    const { ctx } = this;
    const st = I.state;
    const S = this.px(1);
    const C = this.coarse;
    const p = r.site;
    const owner = I.owners[r.id];
    const lens = I.lens ?? 'political';
    const { txt, fog } = this.garrisonText(r, I);
    const g = this.capGeom(r, bt, txt);
    const cx = p.x, cy = p.y + g.cy * S;
    const kingly = r.kind === 'crown' || r.kind === 'throne';
    const hit = (b: { x: number; y: number; w: number; h: number }) => this.labelBoxes.some(o => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y);

    // ---- name plate (right of the cap, else left of it, else hidden: names hide before numbers)
    const nfz = C ? 14 : 13;
    const name = r.name.toUpperCase();
    ctx.font = nameFont(nfz * S);
    const sp = 0.6 * S;
    const nw = spacedWidth(ctx, name, sp);
    const badges = this.badges(r, st);
    const bsz = C ? 17 : 15;
    const ph = (C ? 21 : 19) * S;
    const bw0 = badges.length ? badges.length * (bsz + 3) * S + 2 * S : 0;
    const plateW = 8 * S + nw + bw0 + 8 * S;
    const py = cy - g.h * 0.1 * S - ph / 2;
    const tuck = 5 * S;
    const right = { x: cx + (g.w / 2) * S - tuck, y: py, w: plateW + tuck, h: ph };
    const left = { x: cx - (g.w / 2) * S - plateW, y: py, w: plateW + tuck, h: ph };
    const pad = (b: typeof right) => ({ x: b.x + (b === right ? tuck + 1 * S : -3 * S), y: b.y - 1.5 * S, w: b.w - tuck + 2 * S, h: b.h + 3 * S });
    const capBot = this.capBottom.get(r.id) ?? g.cy + g.h / 2;
    const below = { x: cx - plateW / 2, y: p.y + (capBot + 3) * S, w: plateW, h: ph };
    let spot: typeof right | null = null;
    if (!hit(pad(right))) spot = right; else if (!hit(pad(left))) spot = left;
    else if (!hit({ x: below.x - 3 * S, y: below.y - 1.5 * S, w: below.w + 6 * S, h: below.h + 3 * S })) spot = below;
    let underY = 0;
    const nameCol = fog ? 'rgba(190,186,210,0.7)' : kingly ? 'rgba(255,232,170,0.97)' : 'rgba(232,228,250,0.95)';
    if (spot) {
      const isRight = spot === right;
      if (spot === below) underY = ph + 3 * S;
      ctx.save();
      ctx.globalAlpha = lens === 'economy' ? 0.7 : 1;
      roundRect(ctx, spot.x, spot.y, spot.w, ph, 3 * S);
      gunmetal(ctx, spot.y, spot.y + ph, fog ? 'rgba(150,145,175,0.3)' : hexA(this.regionColor(st, owner), owner === null || owner === undefined ? 0.35 : 0.75), 1.1 * S, fog ? 0.85 : 1);
      topGlint(ctx, spot.x + 4 * S, spot.x + spot.w - 4 * S, spot.y + 1.2 * S, 0.8 * S, fog ? 0.15 : 0.32);
      ctx.restore();
      const x0 = isRight ? spot.x + tuck : spot.x;
      const isBelow = spot === below;
      ctx.font = nameFont(nfz * S); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillStyle = nameCol;
      const tx = x0 + 8 * S + (isRight || isBelow ? 0 : bw0);
      spacedText(ctx, name, tx, spot.y + ph / 2 + 0.5 * S, sp);
      ctx.textBaseline = 'alphabetic';
      let bx = isRight || isBelow ? tx + nw + 4 * S + (bsz / 2) * S : x0 + 6 * S + (bsz / 2) * S;
      for (const b of badges) { this.badge(b, bx, spot.y + ph / 2, bsz * S, fog); bx += (bsz + 3) * S; }
      this.labelBoxes.push(spot);
      // the cap stays in front of the tucked plate end
      if (!isBelow) this.drawCap(r, I, bt, txt, fog);
      this.bannerHits.push({ rid: r.id, x: p.x, y: p.y, l: (spot.x - p.x) / S, t: (spot.y - p.y) / S, r: (spot.x + spot.w - p.x) / S, b: (spot.y + spot.h - p.y) / S });
    } else {
      this.hiddenLabels.set(r.id, { x: right.x + tuck, y: right.y, w: plateW - bw0, h: ph, name, font: nameFont(nfz * S) });
    }

    let y = p.y + (capBot + 4) * S + underY;
    // ---- siege: crossed-swords badge + a bar that drains as the garrison falls
    const sg = this.sieged(r, st);
    if (sg && r.garrison >= 0) {
      const max = garrisonMax(st, r, sg === true ? 0 : sg.garrisonStart);
      const fr = clamp01(r.garrison / max);
      const bw = Math.max(46, g.w + 22) * S, bh = 7 * S;
      const bx = cx - bw / 2 + 9 * S;
      roundRect(ctx, bx - 1.5 * S, y - 1.5 * S, bw + 3 * S, bh + 3 * S, 3 * S); ctx.fillStyle = 'rgba(5,3,12,0.92)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1 * S; ctx.stroke();
      if (fr > 0) { roundRect(ctx, bx, y, bw * fr, bh, 2 * S); ctx.fillStyle = this.regionColor(st, owner); ctx.fill(); }
      ctx.strokeStyle = 'rgba(5,3,12,0.8)'; ctx.lineWidth = 1 * S; ctx.beginPath();
      for (let k = 10; k < max; k += 10) { const x = bx + (bw * k) / max; ctx.moveTo(x, y); ctx.lineTo(x, y + bh); }
      ctx.stroke();
      const sx = bx - 10 * S, sy = y + bh / 2;
      ctx.beginPath(); ctx.arc(sx, sy, 9 * S, 0, TAU); ctx.fillStyle = '#1b0d14'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,214,176,0.8)'; ctx.lineWidth = 1.2 * S; ctx.stroke();
      swords(ctx, sx, sy, 5.5 * S, '#ffe7c2', 1.5 * S);
      this.labelBoxes.push({ x: sx - 9 * S, y: y - 2 * S, w: bw + 20 * S, h: bh + 4 * S });
      y += bh + 6 * S;
    }
    // ---- your influence here: ✦ and a bar in your colour
    if (I.you !== null && r.owner !== I.you && (r.loyalty[I.you] ?? 0) > 0 && st.players[I.you]) {
      const thr = r.owner === null ? st.rules.influence.flipThreshold : st.rules.influence.rivalFlipThreshold;
      const fr = clamp01(r.loyalty[I.you] / Math.max(1e-6, thr));
      const bw = 36 * S, bh = 5 * S;
      const box = { x: cx - bw / 2 - 12 * S, y: y - 3 * S, w: bw + 14 * S, h: 12 * S };
      if (!hit(box)) {
        ctx.font = numFont(12 * S); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        haloText(ctx, '✦', cx - bw / 2 - 6 * S, y + bh / 2, st.players[I.you].color, 'rgba(5,3,12,0.9)', 3 * S);
        ctx.textBaseline = 'alphabetic';
        roundRect(ctx, cx - bw / 2, y, bw, bh, 2 * S); ctx.fillStyle = 'rgba(5,3,12,0.9)'; ctx.fill();
        roundRect(ctx, cx - bw / 2, y, Math.max(2 * S, bw * fr), bh, 2 * S); ctx.fillStyle = st.players[I.you].color; ctx.fill();
        this.labelBoxes.push(box);
        y += bh + 6 * S;
      }
    }

    // ---- detail rows (and the military lens' shipyard tray)
    if (bt !== 'detail' && lens !== 'military') return;
    const rows: (() => void)[] = [];
    const lineH = (C ? 18 : 16) * S;
    if (bt === 'detail' && owner !== null && owner !== undefined && !fog) {
      const max = (() => { try { return maxDevAt(st, r.id); } catch { return 5; } })();
      const n = Math.max(max, r.dev);
      const pw = 9 * S;
      const w = n * pw;
      const box = { x: cx - w / 2, y, w, h: 9 * S };
      if (!hit(box)) {
        const yy = y;
        rows.push(() => {
          for (let i = 0; i < n; i++) {
            const x = cx - w / 2 + i * pw + pw / 2;
            ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + 3.6 * S, yy + 7 * S); ctx.lineTo(x - 3.6 * S, yy + 7 * S); ctx.closePath();
            if (i < r.dev) { ctx.fillStyle = 'rgba(255,240,200,0.95)'; ctx.fill(); } else { ctx.strokeStyle = 'rgba(220,215,245,0.45)'; ctx.lineWidth = 1 * S; ctx.stroke(); }
          }
        });
        this.labelBoxes.push(box);
        y += 11 * S;
      }
    }
    const DEF = ['fortress', 'battery', 'pshield'];
    const keys = TRAY_ORDER.filter(k => (r.buildings[k] ?? 0) > 0 && !DEF.includes(k) && (bt === 'detail' || k === 'shipyard'));
    const proj = bt === 'detail' && r.project && !fog ? r.project : null;
    if ((keys.length || proj) && !fog) {
      const isz = C ? 9 : 8;
      const cell = (isz * 2 + 6) * S;
      const n = keys.length + (proj ? 1 : 0);
      const w = n * cell + 6 * S, h = (isz * 2 + 8) * S;
      const box = { x: cx - w / 2, y, w, h };
      if (!hit(box)) {
        const yy = y;
        rows.push(() => {
          roundRect(ctx, box.x, yy, w, h, 4 * S); ctx.fillStyle = PLATE; ctx.fill();
          let x = box.x + 3 * S + cell / 2;
          for (const k of keys) {
            buildingIcon(ctx, k, x, yy + h / 2, isz * S, k === 'extractor' && r.vein ? (VEINS[r.vein]?.color ?? STONE) : STONE, 1.4 * S);
            const lv = r.buildings[k] ?? 0;
            if (lv > 1) {
              ctx.font = numFont(12 * S); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
              haloText(ctx, String(lv), x + isz * S, yy + h - 3 * S, '#ffffff', 'rgba(5,3,12,0.95)', 3 * S);
              ctx.textBaseline = 'alphabetic';
            }
            x += cell;
          }
          if (proj) {
            const key = proj.key;
            ctx.save(); ctx.globalAlpha = 0.55;
            if (key === 'develop') { ctx.fillStyle = STONE; ctx.beginPath(); ctx.moveTo(x, yy + 4 * S); ctx.lineTo(x + isz * S, yy + h - 6 * S); ctx.lineTo(x - isz * S, yy + h - 6 * S); ctx.closePath(); ctx.fill(); }
            else buildingIcon(ctx, key, x, yy + h / 2 - 1 * S, isz * S, STONE, 1.4 * S);
            ctx.restore();
            const turns = st.rules.projects[proj.key]?.turns ?? 1;
            const fr = clamp01(proj.progress / Math.max(1, turns));
            ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(x - cell / 2 + 3 * S, yy + h - 4 * S, cell - 6 * S, 2.5 * S);
            ctx.fillStyle = '#ffffff'; ctx.fillRect(x - cell / 2 + 3 * S, yy + h - 4 * S, (cell - 6 * S) * Math.max(0.08, fr), 2.5 * S);
          }
        });
        this.labelBoxes.push(box);
        y += h + 3 * S;
      }
    }
    if (bt === 'detail' && st.rules.empire?.enabled !== false && (r.trait || r.vein)) {
      const T = r.trait ? WORLD_TRAITS[r.trait] : null, V = r.vein ? VEINS[r.vein] : null;
      const parts: { t: string; c: string }[] = [];
      if (T) parts.push({ t: `${T.icon} ${T.name.split(' ')[0].toUpperCase()}`, c: 'rgba(225,220,248,0.9)' });
      if (V) parts.push({ t: `${V.icon} ${V.name.toUpperCase()}`, c: (r.buildings.extractor ?? 0) > 0 ? '#ffffff' : 'rgba(225,220,248,0.75)' });
      ctx.font = nameFont(12 * S);
      const gap = 10 * S;
      const ws = parts.map(q => ctx.measureText(q.t).width);
      const w = ws.reduce((a, b) => a + b, 0) + gap * (parts.length - 1) + 12 * S;
      const box = { x: cx - w / 2, y, w, h: lineH };
      if (!hit(box)) {
        const yy = y;
        rows.push(() => {
          roundRect(ctx, box.x, yy, w, lineH, lineH / 2); ctx.fillStyle = 'rgba(9,6,20,0.7)'; ctx.fill();
          ctx.font = nameFont(12 * S); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
          let x = box.x + 6 * S;
          parts.forEach((q, i) => { ctx.fillStyle = q.c; ctx.fillText(q.t, x, yy + lineH / 2 + 0.5 * S); x += ws[i] + gap; });
          ctx.textBaseline = 'alphabetic';
        });
        this.labelBoxes.push(box);
      }
    }
    for (const f of rows) f();
  }

  /** At most 2 badges, in priority: Crown/Throne/relic > shipyard > warp gate > vein > academy. */
  private badges(r: Region, st: GameState): string[] {
    const out: string[] = [];
    if (r.kind === 'throne') out.push('throne'); else if (r.kind === 'crown') out.push('crown'); else if (r.kind === 'relic' && r.relic) out.push('relic');
    if (r.buildings.shipyard) out.push('shipyard');
    if (r.buildings.gate) out.push('gate');
    if (r.vein && st.rules.empire?.enabled !== false) out.push(`vein:${r.vein}`);
    if (r.buildings.academy) out.push('academy');
    return out.slice(0, 2);
  }
  private badge(b: string, x: number, y: number, size: number, fog: boolean) {
    const { ctx } = this;
    const S = this.px(1);
    const s = size / 2;
    ctx.save();
    if (fog) ctx.globalAlpha = 0.6;
    if (b === 'crown') crownGlyph(ctx, x, y + 0.5 * S, s * 0.85, GOLD);
    else if (b === 'throne') starGlyph(ctx, { x, y }, s * 0.95, 5, GOLD);
    else if (b === 'relic') { diamondPath(ctx, x, y, s * 0.7, s * 0.9); ctx.strokeStyle = '#f2f6ff'; ctx.lineWidth = 1.5 * S; ctx.stroke(); }
    else if (b.startsWith('vein:')) {
      const V = VEINS[b.slice(5)];
      ctx.font = numFont(size * 0.95); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = V ? desat(V.color, 0.35) : STONE; ctx.fillText(V?.icon ?? '◆', x, y + 0.5 * S);
      ctx.textBaseline = 'alphabetic';
    } else buildingIcon(ctx, b, x, y, s * 0.78, STONE, 1.3 * S);
    ctx.restore();
  }

  /** Economy lens: veins and traits as big icons beside the planet. */
  private drawEconomyIcons(r: Region, I: DrawInput) {
    if (r.kind === 'void' || I.state.rules.empire?.enabled === false) return;
    const { ctx } = this;
    const S = this.px(1);
    const tier = this.bannerTier(r, I);
    const off = tier === 'strategic' ? 22 : 26;
    const T = r.trait ? WORLD_TRAITS[r.trait] : null, V = r.vein ? VEINS[r.vein] : null;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (V) {
      const mined = (r.buildings.extractor ?? 0) > 0;
      ctx.save();
      const x = r.site.x + off * S, y = r.site.y + 3 * S;
      ctx.beginPath(); ctx.arc(x, y, 13 * S, 0, TAU); ctx.fillStyle = PLATE; ctx.fill();
      ctx.strokeStyle = hexA0(V.color, mined ? 1 : 0.5); ctx.lineWidth = (mined ? 2.2 : 1.2) * S; ctx.stroke();
      if (mined) { ctx.shadowColor = V.color; ctx.shadowBlur = 10 * S; }
      ctx.font = numFont(18 * S); ctx.fillStyle = V.color; ctx.fillText(V.icon, x, y + 1 * S);
      ctx.restore();
    }
    if (T) {
      const x = r.site.x - off * S, y = r.site.y + 3 * S;
      ctx.beginPath(); ctx.arc(x, y, 12 * S, 0, TAU); ctx.fillStyle = PLATE; ctx.fill();
      ctx.strokeStyle = 'rgba(255,220,150,0.6)'; ctx.lineWidth = 1.2 * S; ctx.stroke();
      ctx.font = numFont(16 * S); ctx.fillStyle = '#ffe2a8'; ctx.fillText(T.icon, x, y + 1 * S);
    }
    ctx.textBaseline = 'alphabetic';
  }

  // ================================================================ dynamic layer
  /** Everything that changes every frame: signals, planned orders, tokens, roundels, drag arrow, effects. */
  private drawDynamic(I: DrawInput) {
    const { ctx } = this;
    const st = I.state;
    const colorOf = (o: number | null | undefined) => this.colorOf(st, o);

    // ---------------------------------------------------------------- signals (intel)
    if (I.showSignals) {
      for (const sg of I.signals) {
        const r = st.regions[sg.region];
        if (!r) continue;
        const c = sg.about !== null && sg.about >= 0 ? colorOf(sg.about) : '#ff9a3c';
        const m = /(.+?) → (.+?),/.exec(sg.text.replace(/^Fleet movement \(\w+\) /, ''));
        if (m) {
          const a = st.regions.find(x => x.name === m[1]);
          const b = st.regions.find(x => x.name === m[2]);
          if (a && b) { this.arrow(a.site, b.site, c, true, '', 0.6); continue; }
        }
        const S = this.px(1), x = r.site.x + 22 * S, y = r.site.y + 10 * S;
        roundRect(ctx, x - 10 * S, y - 9 * S, 20 * S, 18 * S, 5 * S); ctx.fillStyle = PLATE; ctx.fill();
        ctx.strokeStyle = c; ctx.lineWidth = 1.5 * S; ctx.stroke();
        ctx.font = numFont(13 * S); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = c; ctx.fillText('◎', x, y + 0.5 * S); ctx.textBaseline = 'alphabetic';
      }
    }

    // ---------------------------------------------------------------- planned orders (under the tokens)
    for (const a of I.plannedArrows) this.arrow(a.from, a.to, a.color, !!a.dashed, a.label, 1, a.kind);
    // arrows that left the plan animate in again when they come back
    for (const k of this.arrowSeen.keys()) if (!this.arrowFrame.has(k)) this.arrowSeen.delete(k);
    this.arrowFrame.clear();
    if (I.pathPreview && I.pathPreview.pts.length > 1) {
      ctx.strokeStyle = I.pathPreview.ok ? 'rgba(235,235,255,0.9)' : 'rgba(200,200,215,0.7)';
      ctx.lineWidth = this.px(3); ctx.setLineDash(I.pathPreview.ok ? [this.px(8), this.px(6)] : [this.px(1), this.px(7)]); ctx.lineDashOffset = -I.now / 40;
      ctx.lineCap = 'round';
      ctx.beginPath(); I.pathPreview.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
      ctx.setLineDash([]); ctx.lineDashOffset = 0; ctx.lineCap = 'butt';
    }

    // ---------------------------------------------------------------- blood-debts: a small drop of blood where the debt was made
    this.drawDebts(I);

    // ---------------------------------------------------------------- fleets, battles
    this.drawTokens(I);

    // ---------------------------------------------------------------- drag arrow (on top of tokens)
    if (I.drag) this.drawDrag(I.drag, I.now); else this.dragHead = null;

    // ---------------------------------------------------------------- fx
    this.drawFx(I, I.fx);
    this.ownFx = this.ownFx.filter(f => I.now - f.t0 < f.dur);
    this.drawFx(I, this.ownFx);
    this.drawParticles(I.now);
  }

  /** Uncleared blood-debts: a dark drop of blood by the world where the commander fell, rimmed in the creditor's
   *  colour (subtle: operational and detail zoom only). */
  private drawDebts(I: DrawInput) {
    const st = I.state;
    const debts = st.soul?.debts;
    if (!debts?.length || this.tier === 'strategic') return;
    const { ctx } = this;
    const S = this.px(1);
    const at = new Map<number, number[]>();
    for (const d of debts) {
      if (d.cleared || !st.regions[d.region]) continue;
      if (I.you !== null && !I.visible.has(d.region) && d.creditor !== I.you && d.debtor !== I.you) continue;
      (at.get(d.region) ?? at.set(d.region, []).get(d.region)!).push(d.creditor);
    }
    for (const [rid, cs] of at) {
      const r = st.regions[rid];
      const R = this.worldR(r, I);
      cs.slice(0, 3).forEach((c, i) => {
        const x = r.site.x - R - (7 + i * 9) * S, y = r.site.y - R * 0.2;
        ctx.save();
        ctx.translate(x, y);
        ctx.beginPath(); ctx.moveTo(0, -6 * S); ctx.bezierCurveTo(3.5 * S, -1.5 * S, 4.2 * S, 1 * S, 4.2 * S, 2.4 * S); ctx.arc(0, 2.4 * S, 4.2 * S, 0, Math.PI); ctx.bezierCurveTo(-4.2 * S, 1 * S, -3.5 * S, -1.5 * S, 0, -6 * S); ctx.closePath();
        const gr = ctx.createLinearGradient(-3 * S, -5 * S, 3 * S, 6 * S); gr.addColorStop(0, '#ff6a6a'); gr.addColorStop(0.5, '#a3121c'); gr.addColorStop(1, '#3a0408');
        ctx.globalAlpha = 0.85; ctx.fillStyle = gr; ctx.fill();
        ctx.strokeStyle = hexA(this.colorOf(st, c), 0.9); ctx.lineWidth = 1.1 * S; ctx.stroke();
        ctx.restore();
      });
    }
  }

  /** Targeting: valid drops get a light outline and a soft glow, strongest near the pointer's path; nothing is
   *  painted over, so the board stays readable while dragging (invalid targets never light up). */
  private drawTargeting(I: DrawInput) {
    const { ctx } = this;
    const st = I.state;
    if (!I.highlight.size) return;
    const S = this.px(1);
    const D = I.drag;
    const ptr = D ? (D.ghost ?? D.to) : null;
    const reach = 240 * S;
    const near = (p: Pt): number => {
      if (!D || !ptr) return 0.55;
      // distance to the segment from the fleet to the pointer
      const ax = D.from.x, ay = D.from.y, bx = ptr.x - ax, by = ptr.y - ay;
      const L2 = bx * bx + by * by || 1;
      const t = clamp01(((p.x - ax) * bx + (p.y - ay) * by) / L2);
      const d = Math.min(Math.hypot(p.x - (ax + bx * t), p.y - (ay + by * t)) * 1.4, Math.hypot(p.x - ptr.x, p.y - ptr.y));
      return clamp01(1 - d / reach);
    };
    const pulse = 0.85 + 0.15 * Math.sin(I.now / 260);
    for (const r of st.regions) {
      const col = I.highlight.get(r.id);
      if (!col) continue;
      const k = near(r.site);
      if (r.poly.length < 3) {
        ctx.beginPath(); ctx.arc(r.site.x, r.site.y, this.px(5), 0, TAU); ctx.fillStyle = hexA(col, 0.35 + 0.5 * k); ctx.fill();
        continue;
      }
      if (k <= 0.02) {
        // far from the pointer: just a faint dotted rim so the reach still reads
        path(ctx, r.poly); ctx.save(); ctx.setLineDash([2 * S, 6 * S]); ctx.strokeStyle = hexA(col, 0.22); ctx.lineWidth = 1.2 * S; ctx.stroke(); ctx.restore();
        continue;
      }
      const R = (30 + 16 * k) * S;
      const g = ctx.createRadialGradient(r.site.x, r.site.y, R * 0.2, r.site.x, r.site.y, R * 1.6);
      g.addColorStop(0, hexA(col, 0.22 * k * pulse)); g.addColorStop(1, hexA(col, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(r.site.x, r.site.y, R * 1.6, 0, TAU); ctx.fill();
      path(ctx, r.poly);
      ctx.strokeStyle = hexA(col, (0.25 + 0.55 * k) * pulse); ctx.lineWidth = (1.2 + 1.2 * k) * S; ctx.stroke();
    }
  }

  // ================================================================ tokens
  /** Group fleets into one token per owner per region (fanned out for your expanded stack / detail tier), replace
   *  opposing tokens in battles with a roundel, and draw it all with eased positions. */
  private drawTokens(I: DrawInput) {
    const { ctx } = this;
    const st = I.state;
    const now = I.now;
    const S = this.px(1);
    const tier = this.tier;
    const reduced = reducedMotion();
    const k = this.slotK();
    const restR = 82 * S * Math.max(1, k);
    this.drawnPos.clear();
    this.tokHits = [];
    // ---- per-fleet motion tracks (trails, heading, arrival pings, warp-in)
    const seen = new Set<number>();
    for (const f of I.fleets) {
      if (f.ghost) continue;
      seen.add(f.id);
      const color = this.colorOf(st, f.owner);
      let tr = this.tracks.get(f.id);
      if (!tr) {
        tr = { x: f.pos.x, y: f.pos.y, vx: 0, vy: 0, ang: 0, trail: [], born: this.fleetsReset || reduced ? -1e9 : now, travel: 0, moving: false, draw: f, color };
        this.tracks.set(f.id, tr);
        if (tr.born === now) this.ring(f.pos, color, 500, 6, 34);
      } else {
        const dx = f.pos.x - tr.x, dy = f.pos.y - tr.y;
        const d = Math.hypot(dx, dy);
        if (d > S * 160) { tr.trail.length = 0; tr.vx = tr.vy = 0; }
        else { const dt = Math.max(1, this.dt); const a = Math.min(1, dt / 60); tr.vx += (dx / dt - tr.vx) * a; tr.vy += (dy / dt - tr.vy) * a; }
        const sp = Math.hypot(tr.vx, tr.vy) / S;
        const moving = sp > 0.02 && f.alpha > 0;
        if (moving) tr.travel += d / S;
        else if (tr.moving && tr.travel > 40 && !reduced) { this.ring(f.pos, color, 650, 8, 30); tr.travel = 0; }
        if (!moving && sp < 0.005) tr.travel = 0;
        tr.moving = moving;
        const target = moving && sp > 0.05 ? Math.atan2(tr.vy, tr.vx) + Math.PI / 2 : 0;
        let da = target - tr.ang;
        while (da > Math.PI) da -= TAU;
        while (da < -Math.PI) da += TAU;
        tr.ang += da * Math.min(1, this.dt / (moving ? 90 : 260));
      }
      tr.x = f.pos.x; tr.y = f.pos.y; tr.draw = f; tr.color = color;
      if (!reduced && tr.moving) tr.trail.push({ x: f.pos.x, y: f.pos.y, t: now });
      while (tr.trail.length && now - tr.trail[0].t > 700) tr.trail.shift();
      if (reduced) tr.trail.length = 0;
    }
    for (const id of this.tracks.keys()) if (!seen.has(id)) this.tracks.delete(id);

    // ---- group
    const groups = new Map<string, Tok>();
    const { sup } = this.supplySets(I);
    for (const f of I.fleets) {
      if (f.ghost || f.alpha <= 0.02) continue;
      let rid = f.region !== undefined && st.regions[f.region] ? f.region : -1;
      let rest = false;
      const rr = (q: Region) => (isLane(q) ? 30 * S : restR);
      if (rid >= 0) { const q = st.regions[rid]; rest = Math.hypot(f.pos.x - q.site.x, f.pos.y - q.site.y) <= rr(q); }
      if (!rest) {
        const n = nearestRegion(st, f.pos);
        const q = st.regions[n];
        if (Math.hypot(f.pos.x - q.site.x, f.pos.y - q.site.y) <= rr(q)) { rid = n; rest = true; } else if (rid < 0) rid = n;
      }
      const key = rest ? `${f.owner}:${rid}` : `f${f.id}`;
      let t = groups.get(key);
      if (!t) {
        const slot = slotFor(tier, f.owner);
        const po = rest ? this.plateOff.get(rid) : undefined;
        const an = rest ? anchorOf(st.regions[rid], f.owner, tier, S, k) : f.pos;
        t = { key, owner: f.owner, region: rid, fleets: [], rest, target: po ? { x: an.x + po.x, y: an.y + po.y } : an, side: slot.side, power: 0, ships: 0, selected: false, idle: false, oos: false, alpha: 0, moving: false, ang: 0, born: -1e9 };
        groups.set(key, t);
      }
      t.fleets.push(f);
    }
    // ---- fan out your stack (expanded region, or detail tier)
    const toks: Tok[] = [];
    for (const t of groups.values()) {
      const fan = t.rest && t.fleets.length > 1 && t.owner === I.you && I.you !== null && (I.expanded === t.region || tier === 'detail');
      if (!fan) { toks.push(t); continue; }
      const fl = t.fleets.slice().sort((a, b) => a.id - b.id);
      const slot = slotFor(tier, t.owner);
      const dirX = slot.dx === 0 ? 1 : Math.sign(slot.dx);
      fl.forEach((f, i) => {
        const col = i % 3, row = Math.floor(i / 3);
        const fk = tier === 'detail' ? Math.pow(this.artK(), 0.75) : 1;
        const dx = dirX * col * 74 * fk * S, dy = -row * 52 * fk * S;
        toks.push({ ...t, key: `x${f.id}`, fleets: [f], target: { x: t.target.x + dx, y: t.target.y + dy } });
      });
    }
    // ---- stats per token
    const arrowsFrom = (rid: number) => I.plannedArrows.find(a => { const s = st.regions[rid].site; return Math.abs(a.from.x - s.x) < 1 && Math.abs(a.from.y - s.y) < 1; });
    for (const t of toks) {
      let pw = 0, ships = 0, oos = false;
      for (const f of t.fleets) {
        const sf = this.fleetById(st, f.id);
        pw += sf ? powerOf(st, sf) : f.ships * 6;
        ships += f.ships;
        if (f.selected) t.selected = true;
        if (f.idle) t.idle = true;
        t.alpha = Math.max(t.alpha, f.alpha);
        if (I.you !== null && f.owner === I.you && sf && ((sf.oos ?? 0) > 0 || (sup && t.rest && !sup.has(t.region)))) oos = true;
      }
      t.power = pw; t.ships = ships; t.oos = oos;
      if (!t.rest) {
        const tr = this.tracks.get(t.fleets[0].id);
        t.moving = !!tr?.moving; t.ang = tr?.ang ?? 0;
      } else {
        // point along the order: your planned arrow, else the fleet's route (on a hyperlane: where it is heading)
        const a = t.owner === I.you ? arrowsFrom(t.region) : undefined;
        if (a) t.ang = Math.atan2(a.to.y - a.from.y, a.to.x - a.from.x) + Math.PI / 2;
        else {
          const rf = t.fleets.map(f => this.fleetById(st, f.id)).find(sf => sf?.route?.path?.length && st.regions[sf.route.path[0]]);
          if (rf) { const from = st.regions[t.region].site, to = st.regions[rf.route!.path[0]].site; t.ang = Math.atan2(to.y - from.y, to.x - from.x) + Math.PI / 2; }
        }
      }
    }
    this.fleetsReset = false;

    // ---- battles: opposing tokens in an engaged region become a roundel
    const engaged = new Map<number, Engagement>();
    for (const e of st.engagements ?? []) if (st.regions[e.region] && (I.you === null || I.visible.has(e.region) || toks.some(t => t.rest && t.region === e.region && t.owner === I.you))) engaged.set(e.region, e);
    const inBattle = new Map<number, Tok[]>();
    const drawList: Tok[] = [];
    for (const t of toks) {
      if (t.rest && engaged.has(t.region)) { (inBattle.get(t.region) ?? inBattle.set(t.region, []).get(t.region)!).push(t); continue; }
      drawList.push(t);
    }

    // ---- hyperlane waypoints in use: brighter dots where a fleet sits or is heading through
    {
      const hot = new Set<number>();
      for (const t of toks) if (t.rest && isLane(st.regions[t.region])) hot.add(t.region);
      for (const f of st.fleets) for (const rid of f.route?.path ?? []) if (isLane(st.regions[rid])) hot.add(rid);
      if (hot.size) {
        ctx.fillStyle = 'rgba(245,242,255,0.95)';
        const dr = (tier === 'strategic' ? 3 : 4.5) * S;
        for (const rid of hot) { const q = st.regions[rid].site; ctx.beginPath(); ctx.arc(q.x, q.y, dr, 0, TAU); ctx.fill(); }
      }
    }
    // ---- multi-turn routes (WEGO; LIVE routes come in as planned arrows): along the lane dots, ETA in turns at the head
    if (st.mode !== 'live') {
      const shown = new Set(I.fleets.map(f => f.id));
      for (const f of st.fleets) {
        const rt = f.route;
        if (!rt?.path?.length || !shown.has(f.id) || !st.regions[f.region]) continue;
        const pts = [st.regions[f.region].site, ...rt.path.filter(r => st.regions[r]).map(r => st.regions[r].site)];
        if (pts.length < 2) continue;
        let eta = 0;
        try { eta = Math.max(1, Math.ceil(rt.path.length / Math.max(1, fleetSpeed(st, f)))); } catch { eta = rt.path.length; }
        this.routeArrow(pts, this.colorOf(st, f.owner), `${eta}T`, rt.seize !== null && rt.seize !== undefined);
      }
    }

    // ---- military lens: enemy power heat
    if ((I.lens ?? 'political') === 'military') {
      for (const t of toks) {
        if (t.owner === I.you || t.power <= 0) continue;
        const R = (24 + Math.sqrt(t.power) * 5) * S;
        const c = this.colorOf(st, t.owner);
        const p = t.rest ? st.regions[t.region].site : t.target;
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
        g.addColorStop(0, hexA(c, 0.32)); g.addColorStop(1, hexA(c, 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, TAU); ctx.fill();
      }
    }

    // ---- engine trails under every token in flight: an additive streak in the house's engine colour
    ctx.save();
    ctx.lineCap = 'round';
    ctx.globalCompositeOperation = 'lighter';
    for (const t of drawList) {
      if (t.rest) continue;
      const tr = this.tracks.get(t.fleets[0].id);
      if (!tr || tr.trail.length < 2) continue;
      const eng = cssA(scheme(t.owner, tr.color).engine);
      const pts = tr.trail;
      const lift = -this.miniGeom().stand * S;
      for (let i = 1; i < pts.length; i++) {
        const kk = i / pts.length;
        const age = clamp01(1 - (now - pts[i].t) / 700);
        ctx.globalAlpha = 0.75 * kk * age;
        ctx.strokeStyle = eng;
        ctx.lineWidth = S * (1.5 + 5 * kk);
        ctx.beginPath(); ctx.moveTo(pts[i - 1].x, pts[i - 1].y + lift); ctx.lineTo(pts[i].x, pts[i].y + lift); ctx.stroke();
      }
    }
    ctx.restore();

    // ---- eased display positions; vanished tokens fade out
    const ease = 1 - Math.exp(-this.dt / 70);
    const live = new Set<string>();
    const fleetLast = new Map<number, Pt>();
    for (const [, d] of this.tokDisp) for (const id of d.ids) fleetLast.set(id, d);
    const presentIds = new Set(I.fleets.map(f => f.id));
    for (const t of drawList) {
      live.add(t.key);
      let d = this.tokDisp.get(t.key);
      const color = this.colorOf(st, t.owner);
      if (!d) {
        // start from where its fleets were drawn (a stack splitting, a mover arriving) so nothing pops
        let sx = 0, sy = 0, n = 0;
        for (const f of t.fleets) { const q = fleetLast.get(f.id); if (q) { sx += q.x; sy += q.y; n++; } }
        const start = n ? { x: sx / n, y: sy / n } : t.target;
        const fresh = !n && t.fleets.every(f => (this.tracks.get(f.id)?.born ?? -1e9) === now);
        d = { x: start.x, y: start.y, ang: t.ang, bank: 0, born: fresh ? now : -1e9, owner: t.owner, region: t.region, ids: [], color, last: t };
        this.tokDisp.set(t.key, d);
      }
      const dx = t.target.x - d.x, dy = t.target.y - d.y;
      if (reduced || Math.hypot(dx, dy) > 400 * S || !t.rest) { d.x = t.target.x; d.y = t.target.y; }
      else { d.x += dx * ease; d.y += dy * ease; }
      let da = t.ang - d.ang;
      while (da > Math.PI) da -= TAU;
      while (da < -Math.PI) da += TAU;
      const prevAng = d.ang;
      d.ang = t.rest ? d.ang + da * Math.min(1, this.dt / 160) : t.ang;
      // roll into turns (a miniature banking on its stand)
      let dd = d.ang - prevAng; while (dd > Math.PI) dd -= TAU; while (dd < -Math.PI) dd += TAU;
      const target = reduced ? 0 : Math.max(-1, Math.min(1, (dd / Math.max(1, this.dt)) * 260));
      d.bank += (target - d.bank) * Math.min(1, this.dt / 140);
      d.ids = t.fleets.map(f => f.id); d.color = color; d.last = t; d.owner = t.owner; d.region = t.region;
    }
    for (const [key, d] of this.tokDisp) {
      if (live.has(key)) continue;
      this.tokDisp.delete(key);
      // only fade when its fleets are gone for good (merged into another token = no fade)
      if (!reduced && !this.fleetsReset && d.ids.every(id => !presentIds.has(id))) this.tokVanish.push({ t: d.last, x: d.x, y: d.y, ang: d.ang, color: d.color, t0: now });
    }

    // ---- draw: in-transit first, then parked (so parked numbers read on top)
    drawList.sort((a, b) => Number(a.rest) - Number(b.rest) || Number(a.selected) - Number(b.selected));
    const anySel = drawList.find(t => t.selected);
    if (!anySel) this.selFleet = null;
    else if (this.selFleet !== anySel.key) { this.selFleet = anySel.key; this.selFleetT0 = now; }
    for (const t of drawList) {
      const d = this.tokDisp.get(t.key)!;
      let scale = 1, a = 1;
      if (d.born > 0) { const kk = clamp01((now - d.born) / 480); if (kk < 1) { scale = Math.max(0.01, easeOutBack(kk)); a = Math.min(1, kk * 2.5); } }
      this.drawToken(t, d, d.color, now, scale, a * t.alpha, I);
    }
    this.tokVanish = this.tokVanish.filter(v => now - v.t0 < 420);
    for (const v of this.tokVanish) {
      const kk = clamp01((now - v.t0) / 420);
      this.drawToken({ ...v.t, selected: false, idle: false }, { x: v.x, y: v.y, ang: v.ang }, v.color, now, 1 + 0.25 * kk, 1 - kk, I, false);
    }
    // ghost fleets (plan preview): faint chevrons, not hit-testable
    for (const f of I.fleets) {
      if (!f.ghost) continue;
      const c = this.colorOf(st, f.owner);
      ctx.save(); ctx.globalAlpha = 0.35 * f.alpha; ctx.translate(f.pos.x, f.pos.y);
      ctx.restore();
      ctx.save(); ctx.globalAlpha = 0.4 * f.alpha;
      drawShip(ctx, f.pos.x, f.pos.y - this.miniGeom().stand * S, this.miniGeom().len * S, this.miniGeom().len * this.dpr, (f.cls?.[0]) ?? 'frigate', f.owner, c, 0);
      ctx.restore();
    }

    // ---- battle roundels + aftermath markers
    for (const [rid, e] of engaged) {
      const r = st.regions[rid];
      if (tier !== 'strategic' && !isLane(r)) this.drawSkirmish(r, e, inBattle.get(rid) ?? [], I);
      else this.drawRoundel(r, e, inBattle.get(rid) ?? [], I);
    }
    // sieges without a battle: the besiegers bombard the world
    if (tier !== 'strategic' && !reduced) for (const t of drawList) {
      if (!t.rest || engaged.has(t.region)) continue;
      const r = st.regions[t.region];
      if (!r || isLane(r)) continue;
      const sieging = t.fleets.some(f => this.fleetById(st, f.id)?.siege === t.region);
      if (!sieging) continue;
      const d = this.tokDisp.get(t.key);
      if (d) this.bombard(r, t.owner, { x: d.x, y: d.y - this.miniGeom().stand * S }, I, t.key);
    }
    this.drawAftermath(I, engaged);
  }

  private tokSizes() {
    const C = this.coarse;
    const t = this.tier;
    if (t === 'strategic') return { R: 8, nf: C ? 14 : 12, sf: 0, ph: C ? 18 : 16 };
    return { R: t === 'detail' ? 11 : 10, nf: C ? 16 : 15, sf: C ? 13 : 12, ph: C ? 21 : 20 };
  }

  /** Mini geometry per tier (css px): base radius, lead hull length, flight-stand height. */
  private miniGeom(n = 1) {
    const tier = this.tier;
    if (tier === 'strategic') return { rb: 11, len: 20, stand: 7, max: 1 };
    if (tier === 'operational') return { rb: 16, len: 34, stand: 13, max: 3 };
    const K = Math.pow(this.artK(), 0.75);
    void n;
    return { rb: 19 * K, len: 36 * K, stand: 15 * K, max: 8 };
  }

  /** The hull classes of a token's fleets, biggest first. */
  private classesOf(I: DrawInput, fleets: FleetDraw[]): string[] {
    const out: string[] = [];
    for (const f of fleets) {
      const sf = this.fleetById(I.state, f.id);
      if (sf && sf.ships.length) for (const sh of sf.ships) out.push(sh.cls);
      else if (f.cls?.length) out.push(...f.cls);
      else for (let i = 0; i < Math.max(1, f.ships); i++) out.push('frigate');
    }
    return out.sort((a, b) => (CLASS_RANK[b] ?? 0) - (CLASS_RANK[a] ?? 0));
  }

  /** Draw a fleet token: miniatures on clear flight stands over one enamel base (the base rim is the owner colour and
   *  the hit area), a cast shadow on the mat, a gunmetal number plate with the power, status badges, a pennant. */
  private drawToken(t: Tok, d: { x: number; y: number; ang: number; bank?: number }, c: string, now: number, scale: number, alpha: number, I: DrawInput, hit = true) {
    const { ctx } = this;
    const S = this.px(1);
    const Z = this.tokSizes();
    const G = this.miniGeom();
    const tier = this.tier;
    const reduced = reducedMotion();
    const lensDim = (I.lens ?? 'political') === 'economy' || (I.lens ?? 'political') === 'supply' ? 0.7 : 1;
    const fill = t.owner === -1 ? WARDEN : c;
    const sel = t.selected;
    const owner = t.owner;
    const cls = this.classesOf(I, t.fleets);
    const n = Math.min(G.max, cls.length);
    const lead = cls[0] ?? 'frigate';
    const len0 = G.len * (0.8 + 0.2 * classLen(lead) / 1.06);
    // formation (ship-local units of the lead's length), centred, rotated to the heading
    const F = formation(n);
    let mx = 0, my = 0; for (const f of F) { mx += f.x / n; my += f.y / n; }
    // the squadron is laid out on the base in screen space (a wedge, lead toward the heading's vertical sense) and
    // each model turns to the heading on its own stand: reads cleanly at any angle
    const flip = Math.cos(d.ang) < -0.2 ? -1 : 1;
    const spacing = tier === 'detail' ? 0.72 : 0.78;
    const pos = F.map((f, i) => ({ x: (f.x - mx) * len0 * spacing * 1.05, y: (f.y - my) * len0 * spacing * flip, s: f.s, cls: cls[i] }));
    let ext = 0; for (const q of pos) ext = Math.max(ext, Math.hypot(q.x, q.y));
    const rb = Math.max(G.rb, ext + len0 * (n > 1 ? 0.36 : 0.3));
    const ry = rb * BASE_SQUASH;
    ctx.save();
    ctx.globalAlpha = clamp01(alpha * lensDim);
    ctx.translate(d.x, d.y);
    if (scale !== 1) ctx.scale(scale, scale);
    drawBase(ctx, 0, 0, rb * S, rb * this.dpr, fill, { sel, oos: t.oos, big: n > 2 });
    // models: back to front
    const bob = reduced || t.moving ? 0 : Math.sin(now / 850 + (t.fleets[0]?.id ?? 0) * 1.7) * 1.3;
    const order = pos.map((q, i) => ({ ...q, i })).sort((a, b) => a.y - b.y);
    const team = fill;
    const eng = t.moving ? 1.1 : 0.3;
    for (const q of order) {
      const gx = q.x * S, gy = q.y * BASE_SQUASH * S;
      const L = len0 * q.s * (0.78 + 0.22 * classLen(q.cls) / classLen(lead));
      const st = (G.stand + (q.i === 0 ? 2 : 0)) * S;
      const sy = gy - st + bob * S * (q.i % 2 ? 0.7 : 1);
      drawStand(ctx, gx, gy, sy + L * S * 0.05, Math.max(1.2, L * 0.07) * S);
      drawShip(ctx, gx, sy, L * S, L * this.dpr * (scale > 1 ? scale : 1), q.cls, owner, team, d.ang, {
        shadow: { dx: st * 0.3, dy: st * 0.95, alpha: 0.42 }, engine: eng, bank: d.bank ?? 0,
      });
    }
    // the fleet's banner: a pennant on a pole at the base's outer rim (operational + detail), with its sigil, rank
    // chevrons down the pole, scar notches cut into the cloth, an Oathbreaker crack; a limping fleet's pennant droops
    // and it trails smoke
    if (tier !== 'strategic' && owner >= 0) {
      const sfs = t.fleets.map(f => this.fleetById(I.state, f.id)).filter((x): x is Fleet => !!x && !!x.banner && x.ships.length > 0);
      const lead = sfs.sort((a, b) => b.commander.rank - a.commander.rank)[0];
      const limp = t.fleets.map(f => this.fleetById(I.state, f.id)).find(x => x?.limping);
      if (limp && !reduced) {
        for (let i = 0; i < 4; i++) {
          const k = ((now / 1400) + i / 4) % 1;
          smoke(ctx, (-t.side * 4 + Math.sin(i * 2.3 + k * 4) * 5) * S, (-G.stand * 0.6 - k * 34) * S, (5 + k * 12) * S, 0.42 * (1 - k));
        }
      }
      if (lead?.banner) {
        const pk = tier === 'detail' ? Math.pow(this.artK(), 0.4) : 1;
        const dir = -t.side;
        const bx = dir * rb * 0.78 * S, by = ry * 0.2 * S;
        const top = by - (G.stand * 0.9 + len0 * 0.5 + 10) * S;
        ctx.strokeStyle = 'rgba(8,8,14,0.9)'; ctx.lineWidth = 2.6 * S; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx, top - 2 * S); ctx.stroke();
        const pg = ctx.createLinearGradient(bx - 1.2 * S, 0, bx + 1.2 * S, 0); pg.addColorStop(0, '#fff0c0'); pg.addColorStop(1, '#8a6420');
        ctx.strokeStyle = pg; ctx.lineWidth = 1.2 * S; ctx.stroke();
        ctx.fillStyle = '#ffe08a'; ctx.beginPath(); ctx.arc(bx, top - 2.5 * S, 1.8 * S, 0, TAU); ctx.fill();
        const fw = 22 * S * pk, fh = 15 * S * pk;
        const wv = reduced || lead.limping ? 0 : Math.sin(now / 300 + lead.id) * 1.4 * S;
        ctx.save();
        ctx.translate(bx, top);
        if (lead.limping) ctx.rotate(dir * 1.2);
        ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(dir * fw * 0.5, wv, dir * fw, 1.5 * S + wv * 0.7);
        ctx.lineTo(dir * fw * 0.74, fh * 0.52 + wv * 0.4);
        ctx.lineTo(dir * fw, fh + wv * 0.3);
        ctx.quadraticCurveTo(dir * fw * 0.5, fh + wv * 0.6, 0, fh);
        ctx.closePath();
        ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 3 * S; ctx.shadowOffsetY = 1.5 * S; ctx.fillStyle = '#000'; ctx.fill(); ctx.restore();
        enamel(ctx, lead.limping ? desat(fill, 0.45) : fill, 0, fh, lead.commander.rank >= 4 ? 'gold' : 'iron', 0.9 * S);
        // scar notches: bites out of the cloth's lower edge
        const sc = Math.min(3, lead.scars?.length ?? 0);
        for (let i = 0; i < sc; i++) {
          const x = dir * fw * (0.2 + i * 0.18);
          ctx.beginPath(); ctx.moveTo(x - 2.2 * S, fh + 0.5 * S); ctx.lineTo(x, fh - 3.6 * S); ctx.lineTo(x + 2.2 * S, fh + 0.5 * S); ctx.closePath();
          ctx.fillStyle = 'rgba(12,6,8,0.95)'; ctx.fill();
        }
        drawSigil(ctx, lead.banner.sigil, dir * fw * 0.4, fh * 0.48 + wv * 0.5, 10.5 * S * pk, goldPaint(ctx, 0, fh), true);
        if (lead.oathbreaker) {
          ctx.strokeStyle = '#ff4a3a'; ctx.lineWidth = 1.3 * S; ctx.beginPath();
          ctx.moveTo(dir * fw * 0.62, 0.5 * S); ctx.lineTo(dir * fw * 0.48, fh * 0.4); ctx.lineTo(dir * fw * 0.6, fh * 0.6); ctx.lineTo(dir * fw * 0.44, fh); ctx.stroke();
        }
        ctx.restore();
        // rank chevrons down the pole (Legend: a star)
        const rank = lead.commander.rank;
        const cy0 = top + fh + 5 * S;
        if (rank >= 5) starGlyph(ctx, { x: bx, y: cy0 + 1 * S }, 4.5 * S, 5, GOLD);
        else for (let i = 0; i < Math.min(4, rank - 1); i++) {
          const yy = cy0 + i * 3.6 * S;
          ctx.strokeStyle = 'rgba(8,6,2,0.9)'; ctx.lineWidth = 2.6 * S; ctx.beginPath(); ctx.moveTo(bx - 3.6 * S, yy); ctx.lineTo(bx, yy - 2.6 * S); ctx.lineTo(bx + 3.6 * S, yy); ctx.stroke();
          ctx.strokeStyle = GOLD; ctx.lineWidth = 1.3 * S; ctx.stroke();
        }
      }
    }
    // power number (+ ship count) on a gunmetal plate beside the base
    const pw = String(Math.max(0, Math.round(t.power)));
    ctx.font = numFont(Z.nf * S);
    const w1 = ctx.measureText(pw).width;
    const sub = Z.sf ? String(t.ships) : '';
    let w2 = 0;
    if (sub) { ctx.font = numFont(Z.sf * S, 600); w2 = ctx.measureText(sub).width + 2 * S; }
    const pw2 = w1 + w2 + 10 * S, ph = Z.ph * S;
    const gap = rb * S + 2 * S;
    const px0 = t.side > 0 ? gap : -gap - pw2;
    const py0 = -ph / 2 - (tier === 'strategic' ? 2 : 4) * S;
    roundRect(ctx, px0, py0, pw2, ph, 3 * S);
    gunmetal(ctx, py0, py0 + ph, sel ? '#ffffff' : hexA(fill, 0.95), (sel ? 2.4 : 1.6) * S);
    topGlint(ctx, px0 + 3 * S, px0 + pw2 - 3 * S, py0 + 1.2 * S, 0.8 * S, 0.3);
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.font = numFont(Z.nf * S);
    stampedText(ctx, pw, px0 + 5 * S, py0 + ph / 2 + 0.5 * S, '#ffffff', S);
    if (sub) {
      ctx.font = numFont(Z.sf * S, 600); ctx.fillStyle = 'rgba(214,210,236,0.9)';
      ctx.fillText(sub, px0 + 5 * S + w1 + 2 * S, py0 + ph / 2 + 3 * S);
    }
    // a limping fleet: where it is limping to, and when it gets there
    if (tier !== 'strategic') {
      const lf = t.fleets.map(f => this.fleetById(I.state, f.id)).find(x => x?.limping);
      if (lf?.limping) {
        let eta = 0;
        try { eta = lf.route?.path.length ? Math.max(1, Math.ceil(lf.route.path.length / Math.max(1, fleetSpeed(I.state, lf)))) : 0; } catch { eta = 0; }
        const lt = eta ? `⌂ ${eta}${I.state.mode === 'live' ? '' : 'T'}` : '⌂';
        ctx.font = numFont(11 * S, 700);
        const lw = ctx.measureText(lt).width + 8 * S, lh = 14 * S;
        const lx = px0 + (t.side > 0 ? 0 : pw2 - lw), ly = py0 + ph + 2 * S;
        roundRect(ctx, lx, ly, lw, lh, 3 * S); ctx.fillStyle = 'rgba(40,22,10,0.95)'; ctx.fill();
        ctx.strokeStyle = 'rgba(255,170,110,0.8)'; ctx.lineWidth = 1 * S; ctx.stroke();
        ctx.fillStyle = '#ffcf9e'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(lt, lx + 4 * S, ly + lh / 2 + 0.5 * S);
      }
    }
    // status badges at the base's inner shoulder: ⚠ out of supply, Zz idle (can take orders)
    const badge = t.oos ? '⚠' : t.idle && !sel ? 'Zz' : '';
    const topY = -(G.stand + len0 * 0.55) * S;
    if (badge) {
      const bx = -t.side * rb * 0.85 * S, by = -(G.stand * 0.9) * S;
      const bf = this.coarse ? 12 : 11;
      ctx.font = numFont(bf * S);
      const bw = Math.max(15 * S, ctx.measureText(badge).width + 7 * S), bh = 14 * S;
      roundRect(ctx, bx - bw / 2, by - bh / 2, bw, bh, bh / 2);
      ctx.fillStyle = t.oos ? '#ffd27a' : '#f2efff'; ctx.fill();
      ctx.strokeStyle = 'rgba(8,4,16,0.9)'; ctx.lineWidth = 1.2 * S; ctx.stroke();
      ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.fillText(badge, bx, by + 0.5 * S);
    }
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
    if (!hit) return;
    for (const f of t.fleets) this.drawnPos.set(f.id, { x: d.x, y: d.y });
    const l = Math.min(-rb, px0 / S) - 4, r = Math.max(rb, (px0 + pw2) / S) + 4;
    this.tokHits.push({ x: d.x, y: d.y, l, t: Math.min(topY / S, -ph / S / 2) - 4, r, b: ry + 6, cr: Math.max(this.hitR(), rb * 1.05), hit: { region: t.region, owner: t.owner, fleetIds: t.fleets.map(f => f.id) } });
  }

  // ================================================================ battles on the board
  private shotSeen = new Set<string>();
  /** A world's on-screen radius (ctx units) at its banner tier. */
  private worldR(r: Region, I: DrawInput) { return this.siteR(r, this.bannerTier(r, I)) * this.px(1); }

  /** Operational/detail battle: each side's miniatures face off around the contested world, exchanging fire in their
   *  house's style (lances, broadsides, plasma), the garrison answers from the surface; a compact roundel overlay
   *  (swords, balance ring, round count) floats over the world. Side tokens keep their plates and hit areas. */
  private drawSkirmish(r: Region, e: Engagement, toks: Tok[], I: DrawInput) {
    const { ctx } = this;
    const st = I.state;
    const S = this.px(1);
    const now = I.now;
    const reduced = reducedMotion();
    const tier = this.tier;
    const K = tier === 'detail' ? Math.pow(this.artK(), 0.75) : 1;
    const pr = this.worldR(r, I);
    // one token per owner
    const byOwner = new Map<number, Tok>();
    for (const t of toks) {
      const o = byOwner.get(t.owner);
      if (!o) byOwner.set(t.owner, { ...t, fleets: t.fleets.slice(), key: `b${r.id}:${t.owner}` });
      else { o.fleets.push(...t.fleets); o.power += t.power; o.ships += t.ships; o.selected ||= t.selected; o.idle ||= t.idle; o.oos ||= t.oos; }
    }
    const sides = [...byOwner.values()].sort((a, b) => (a.owner === I.you ? -1 : b.owner === I.you ? 1 : a.owner - b.owner));
    const owner = I.owners[r.id];
    const garrison = r.garrison > 0 ? { owner: owner ?? -2, color: this.regionColor(st, owner) } : null;
    const m = sides.length;
    const R = pr + (58 + (m > 2 ? 8 : 0)) * K * S;
    // pick each side's station around the world: preferred angles first, avoiding banners, plates and each other
    const G0 = this.miniGeom();
    const boxAt = (a: number) => {
      const x = r.site.x + Math.cos(a) * R, y = r.site.y + Math.sin(a) * R * 0.8;
      const w = (G0.rb * 2.2 + 40) * K * S, h = (G0.stand + G0.len) * K * S;
      return { x: x - w / 2, y: y - h, w, h: h + G0.rb * 0.6 * K * S };
    };
    const over = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const prefs = m === 1 ? [-2.3, -0.84, -1.57, -2.85, -0.3, 2.6, 0.55] : m === 2 ? [-2.62, -0.52, -1.57, -2.95, -0.2, 2.6, 0.55] : [-2.85, -1.57, -0.3, -2.2, -0.95, 2.6, 0.55];
    const angs: number[] = [];
    const taken: { x: number; y: number; w: number; h: number }[] = [];
    for (let i = 0; i < m; i++) {
      let best = prefs[i % prefs.length], bs = Infinity;
      prefs.forEach((a, j) => {
        if (angs.includes(a)) return;
        const b = boxAt(a);
        let sc = j * 0.02 * b.w * b.h;
        for (const o of this.labelBoxes) sc += over(b, o);
        for (const o of taken) sc += over(b, o) * 3;
        // keep opposing sides on opposite flanks when possible
        if (i === 1 && angs.length && Math.sign(Math.cos(a)) === Math.sign(Math.cos(angs[0]))) sc += b.w * b.h * 0.3;
        if (sc < bs) { bs = sc; best = a; }
      });
      angs.push(best); taken.push(boxAt(best));
    }
    const pos = sides.map((t, i) => ({ t, x: r.site.x + Math.cos(angs[i]) * R, y: r.site.y + Math.sin(angs[i]) * R * 0.8 }));
    // facing: toward the world (sieges) or toward the middle of the enemy line
    const tgtOf = (i: number) => {
      const others = pos.filter((_, j) => j !== i);
      if (garrison && garrison.owner !== sides[i].owner) return r.site;
      if (!others.length) return r.site;
      return { x: others.reduce((a, q) => a + q.x, 0) / others.length, y: others.reduce((a, q) => a + q.y, 0) / others.length };
    };
    const live = new Set<string>();
    pos.forEach((q, i) => {
      const tg = tgtOf(i);
      const ang = Math.atan2(tg.y - q.y, tg.x - q.x) + Math.PI / 2;
      live.add(q.t.key);
      let d = this.tokDisp.get(q.t.key);
      if (!d) { d = { x: q.x, y: q.y, ang, bank: 0, born: -1e9, owner: q.t.owner, region: r.id, ids: [], color: this.colorOf(st, q.t.owner), last: q.t }; this.tokDisp.set(q.t.key, d); }
      d.x = q.x; d.y = q.y; d.ang = ang; d.ids = q.t.fleets.map(f => f.id); d.last = q.t;
      q.t.side = Math.cos(angs[i]) >= 0 ? 1 : -1;
      this.drawToken(q.t, d, this.colorOf(st, q.t.owner), now, 1, q.t.alpha, I, true);
    });
    // ---- the exchange of fire
    const G = this.miniGeom();
    const lift = (G.stand + 2) * S;
    const shooters: { owner: number; x: number; y: number; planet: boolean }[] = pos.map(q => ({ owner: q.t.owner, x: q.x, y: q.y - lift, planet: false }));
    if (garrison) shooters.push({ owner: garrison.owner, x: r.site.x, y: r.site.y, planet: true });
    if (!reduced && shooters.length > 1) {
      ctx.save();
      shooters.forEach((sh, si) => {
        const enemies = shooters.filter(o => o.owner !== sh.owner);
        if (!enemies.length) return;
        const period = 900 + si * 170;
        const ph = (r.id * 337 + si * 491) % period;
        const k = Math.floor((now + ph) / period), t0 = k * period - ph;
        for (let j = 0; j < 4; j++) {
          const ts = t0 + j * 95;
          const age = now - ts;
          const tgt = enemies[(k + j) % enemies.length];
          const seed = r.id * 7919 + si * 131 + k * 17 + j;
          const jit = (n: number) => (h2(seed, n) - 0.5);
          const from = sh.planet ? { x: sh.x + Math.cos(-1.9 + jit(1) * 2) * pr * 0.9, y: sh.y + Math.sin(-1.9 + jit(1) * 2) * pr * 0.9 } : { x: sh.x + jit(1) * G.len * 0.7 * S, y: sh.y + jit(2) * G.len * 0.3 * S };
          let to: Pt;
          if (tgt.planet) { const a = Math.atan2(from.y - tgt.y, from.x - tgt.x) + jit(3) * 1.2; to = { x: tgt.x + Math.cos(a) * pr * 0.75, y: tgt.y + Math.sin(a) * pr * 0.75 }; }
          else to = { x: tgt.x + jit(3) * G.len * 0.6 * S, y: tgt.y + jit(4) * G.len * 0.3 * S };
          this.weaponShot(sh.owner, sh.planet, from, to, age, S * K, `${r.id}:${si}:${k}:${j}`, tgt.planet ? pr : 0, tgt.planet ? { x: tgt.x, y: tgt.y } : null);
        }
      });
      ctx.restore();
    }
    // ---- roundel overlay: crossed swords over the world, balance ring, round count
    const list: Side[] = sides.map(t => ({ owner: t.owner, color: this.colorOf(st, t.owner), power: t.power, ids: t.fleets.map(f => f.id), garrison: 0, garrisonOnly: false }));
    if (garrison) list.push({ owner: garrison.owner, color: garrison.color, power: garrisonPower(st, r), ids: [], garrison: r.garrison, garrisonOnly: true });
    const total = list.reduce((a, q) => a + Math.max(0, q.power), 0) || 1;
    const D = (this.coarse ? 13 : 12) * S;
    const P = { x: r.site.x, y: r.site.y - pr - D - 5 * S };
    const beat = reduced ? 0 : Math.max(0, Math.sin((now / 700) * Math.PI)) ** 4;
    drawGlow(ctx, P.x, P.y, D * 2.6, [255, 140, 70], 0.35 + 0.25 * beat);
    ctx.beginPath(); ctx.arc(P.x, P.y, D, 0, TAU);
    ctx.fillStyle = '#1b0d14'; ctx.fill();
    // balance ring: each side's share of the strength, in its colour
    let a0 = -Math.PI / 2;
    ctx.lineWidth = 3.4 * S;
    for (const sd of list) { const da = (Math.max(0, sd.power) / total) * TAU; if (da > 0.02) { ctx.strokeStyle = sd.color; ctx.beginPath(); ctx.arc(P.x, P.y, D + 1.5 * S, a0, a0 + da); ctx.stroke(); } a0 += da; }
    ctx.strokeStyle = 'rgba(255,214,176,0.85)'; ctx.lineWidth = 1 * S; ctx.beginPath(); ctx.arc(P.x, P.y, D - 0.8 * S, 0, TAU); ctx.stroke();
    swords(ctx, P.x, P.y, D * 0.6, '#ffe7c2', 2 * S);
    const rc = `R${e.rounds}`;
    ctx.font = numFont(11 * S); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const rw = ctx.measureText(rc).width + 8 * S;
    roundRect(ctx, P.x + D + 5 * S, P.y - 7 * S, rw, 14 * S, 7 * S); gunmetal(ctx, P.y - 7 * S, P.y + 7 * S, 'rgba(255,214,176,0.6)', 1 * S);
    ctx.fillStyle = '#ffd6b0'; ctx.fillText(rc, P.x + D + 5 * S + rw / 2, P.y + 0.5 * S);
    ctx.textBaseline = 'alphabetic';
    // drifting smoke over the fight
    if (!reduced) for (let i = 0; i < 4; i++) {
      const life = 3200, tt = ((now + i * 800 + r.id * 97) % life) / life;
      const sx = r.site.x + (h2(r.id, i) - 0.5) * pr * 3, sy = r.site.y - pr * 0.8 + (h2(r.id, i + 9) - 0.5) * pr * 1.4 - tt * 16 * S;
      smoke(ctx, sx, sy, (10 + tt * 14) * S * K, 0.35 * Math.sin(tt * Math.PI));
    }
    if (this.shotSeen.size > 400) this.shotSeen.clear();
  }

  /** One weapon discharge in the shooter's house style, `age` ms after it fired; spawns sparks on impact once. */
  private weaponShot(owner: number, planet: boolean, from: Pt, to: Pt, age: number, S: number, key: string, targetR: number, targetC: Pt | null) {
    const { ctx } = this;
    if (age < 0 || age > 1200) return;
    const st = this.lastState;
    const col = planet ? '#ffcf8a' : this.colorOf(st!, owner);
    const sch = scheme(owner, col);
    const fac = planet ? 'battery' : sch.faction;
    const travel = fac === 'azure' || fac === 'warden' || fac === 'neutral' ? 0 : fac === 'crimson' || fac === 'battery' ? 300 : 420;
    const hitT = travel;
    // muzzle flash
    if (age < 120) drawGlow(ctx, from.x, from.y, (6 + (planet ? 2 : 0)) * S, sch.weapon, 1 - age / 120);
    if (travel === 0) {
      // lance: instantaneous beam that fades
      if (age < 260) beam(ctx, from.x, from.y, to.x, to.y, sch.weapon, 1.4 * S, 1 - age / 260);
    } else if (age < travel) {
      const k = age / travel, k0 = Math.max(0, k - (fac === 'gilded' ? 0.08 : 0.22));
      const hx = from.x + (to.x - from.x) * k, hy = from.y + (to.y - from.y) * k;
      const tx = from.x + (to.x - from.x) * k0, ty = from.y + (to.y - from.y) * k0;
      if (fac === 'gilded') drawGlow(ctx, hx, hy, 5 * S, sch.weapon, 1);
      else tracer(ctx, tx, ty, hx, hy, sch.weapon, 1.6 * S, 1);
    }
    const ia = age - hitT;
    if (ia >= 0 && ia < 420) {
      if (targetC && targetR > 0) {
        // impact on the planet's surface: clipped to the disc, a flash and a scorch
        ctx.save(); ctx.beginPath(); ctx.arc(targetC.x, targetC.y, targetR, 0, TAU); ctx.clip();
        fireball(ctx, to.x, to.y, 4.5 * S, ia / 420, 1);
        ctx.restore();
        drawGlow(ctx, to.x, to.y, 7 * S, [255, 200, 120], (1 - ia / 420) * 0.6);
      } else fireball(ctx, to.x, to.y, 4 * S, ia / 420, 0.9);
      if (!this.shotSeen.has(key)) { this.shotSeen.add(key); this.spark(to.x, to.y, '#ffd27a', this.compact ? 2 : 4, 0.12, 380); }
    }
  }

  /** Besiegers shell the world: shots from the token at the planet's surface. */
  private bombard(r: Region, owner: number, from: Pt, I: DrawInput, key: string) {
    const now = I.now, S = this.px(1);
    const pr = this.worldR(r, I);
    const K = this.tier === 'detail' ? Math.pow(this.artK(), 0.75) : 1;
    const period = 1400;
    const ph = (r.id * 211 + owner * 377) % period;
    const k = Math.floor((now + ph) / period), t0 = k * period - ph;
    for (let j = 0; j < 3; j++) {
      const seed = r.id * 31 + owner * 7 + k * 13 + j;
      const a = Math.atan2(from.y - r.site.y, from.x - r.site.x) + (h2(seed, 1) - 0.5) * 1.6;
      const to = { x: r.site.x + Math.cos(a) * pr * 0.72, y: r.site.y + Math.sin(a) * pr * 0.72 };
      const f = { x: from.x + (h2(seed, 2) - 0.5) * 18 * S, y: from.y + (h2(seed, 3) - 0.5) * 8 * S };
      this.weaponShot(owner, false, f, to, now - (t0 + j * 140), S * K, `s${key}:${k}:${j}`, pr, r.site);
    }
  }

  /** Crossed-swords disc ringed by a balance arc (each side ∝ its strength), each side's number beside it, the round count. */
  private drawRoundel(r: Region, e: Engagement, toks: Tok[], I: DrawInput) {
    const { ctx } = this;
    const st = I.state;
    const S = this.px(1);
    const tier = this.tier;
    const C = this.coarse;
    const now = I.now;
    const reduced = reducedMotion();
    // sides: fleet tokens by owner, plus the garrison (on its owner's side, or a neutral side)
    const sides = new Map<number, Side>();
    for (const t of toks) {
      const s = sides.get(t.owner) ?? { owner: t.owner, color: this.colorOf(st, t.owner), power: 0, ids: [], garrison: 0, garrisonOnly: false };
      s.power += t.power; s.ids.push(...t.fleets.map(f => f.id));
      sides.set(t.owner, s);
    }
    const owner = I.owners[r.id];
    if (r.garrison > 0) {
      const gk = owner === null || owner === undefined ? -2 : owner;
      const s = sides.get(gk) ?? { owner: gk, color: this.regionColor(st, owner), power: 0, ids: [], garrison: 0, garrisonOnly: true };
      s.power += garrisonPower(st, r); s.garrison = r.garrison;
      sides.set(gk, s);
    }
    const list = [...sides.values()].sort((a, b) => (a.owner === I.you ? -1 : b.owner === I.you ? 1 : 0) || (a.garrisonOnly ? 1 : 0) - (b.garrisonOnly ? 1 : 0) || a.owner - b.owner);
    const total = list.reduce((a, s) => a + Math.max(0, s.power), 0) || 1;
    const D = (tier === 'strategic' ? 13 : 15) * S + (C ? 2 * S : 0);
    const lane = isLane(r);
    // on the planet itself (its tokens are replaced, the banner stays below); above the plate at strategic zoom
    const P = lane ? { x: r.site.x, y: r.site.y } : tier === 'strategic' ? { x: r.site.x, y: r.site.y - 30 * S } : { x: r.site.x, y: r.site.y - 4 * S };
    // the disc throbs (harder at strategic zoom, where it is the thing to notice) and flickers like firelight
    const strong = tier === 'strategic';
    const beat = reduced ? 0 : Math.max(0, Math.sin((now / 700) * Math.PI)) ** 4;
    const Dz = D * (1 + (strong ? 0.14 : 0.07) * beat);
    const flick = reduced ? 1 : 0.85 + 0.25 * Math.sin(now / 47 + r.id) * Math.sin(now / 83 + r.id * 3);
    const gl = ctx.createRadialGradient(P.x, P.y, 0, P.x, P.y, D * 2.3);
    gl.addColorStop(0, `rgba(255,140,70,${(0.3 + (strong ? 0.25 : 0.12) * beat) * flick})`); gl.addColorStop(1, 'rgba(255,80,40,0)');
    ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(P.x, P.y, D * 2.3, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(P.x, P.y, Dz, 0, TAU); ctx.fillStyle = '#1b0d14'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,214,176,0.85)'; ctx.lineWidth = 1.5 * S; ctx.stroke();
    swords(ctx, P.x, P.y, Dz * 0.62, '#ffe7c2', 2.2 * S);
    // balance bar under the disc: each side's share of the fighting strength, in its colour (a tug of war)
    const bw = (tier === 'strategic' ? 44 : 56) * S, bh = 6 * S, by = P.y - D - 12 * S;
    roundRect(ctx, P.x - bw / 2 - 1.5 * S, by - 1.5 * S, bw + 3 * S, bh + 3 * S, 3 * S); ctx.fillStyle = 'rgba(5,3,12,0.95)'; ctx.fill();
    let bx = P.x - bw / 2;
    for (const sd of list) { const w = (Math.max(0, sd.power) / total) * bw; if (w > 0.5 * S) { ctx.fillStyle = sd.color; ctx.fillRect(bx, by, w, bh); } bx += w; }
    // round counter
    const rc = `R${e.rounds}`;
    ctx.font = numFont(12 * S); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const rw = ctx.measureText(rc).width + 8 * S;
    roundRect(ctx, P.x + bw / 2 + 4 * S, by + bh / 2 - 7 * S, rw, 14 * S, 7 * S); ctx.fillStyle = 'rgba(5,3,12,0.95)'; ctx.fill();
    ctx.fillStyle = '#ffd6b0'; ctx.fillText(rc, P.x + bw / 2 + 4 * S + rw / 2, by + bh / 2 + 0.5 * S);
    // side numbers: first left, second right, others above
    const Z = this.tokSizes();
    // a garrison fighting alone already shows its number on the banner: it only takes part in the balance bar
    list.filter(s => !s.garrisonOnly || isLane(r)).forEach((s, i) => {
      const txt = s.garrisonOnly ? String(s.garrison) : String(Math.round(s.power));
      ctx.font = numFont(Z.nf * S);
      const w = ctx.measureText(txt).width + (s.garrisonOnly ? 18 * S : 10 * S), h = Z.ph * S;
      const pos = i === 0 ? { x: P.x - D - 6 * S - w, y: P.y - h / 2 } : i === 1 ? { x: P.x + D + 6 * S, y: P.y - h / 2 } : { x: P.x - w / 2, y: P.y - D - 18 * S - h - (i - 2) * (h + 3 * S) };
      roundRect(ctx, pos.x, pos.y, w, h, 4 * S);
      ctx.fillStyle = PLATE; ctx.fill();
      ctx.strokeStyle = s.color; ctx.lineWidth = 2 * S; ctx.stroke();
      ctx.textBaseline = 'middle';
      if (s.garrisonOnly) {
        shieldPath(ctx, pos.x + 8 * S, pos.y + h / 2, 9 * S, 11 * S); ctx.fillStyle = s.color; ctx.fill();
        ctx.textAlign = 'left'; ctx.fillStyle = '#ffffff'; ctx.fillText(txt, pos.x + 15 * S, pos.y + h / 2 + 0.5 * S);
      } else { ctx.textAlign = 'center'; ctx.fillStyle = '#ffffff'; ctx.fillText(txt, pos.x + w / 2, pos.y + h / 2 + 0.5 * S); }
      ctx.textBaseline = 'alphabetic';
      if (s.ids.length) {
        const c = { x: pos.x + w / 2, y: pos.y + h / 2 };
        for (const id of s.ids) this.drawnPos.set(id, c);
        this.tokHits.push({ x: c.x, y: c.y, l: -w / S / 2 - 4, t: -h / S / 2 - 6, r: w / S / 2 + 4, b: h / S / 2 + 6, cr: this.hitR(), hit: { region: r.id, owner: s.owner, fleetIds: s.ids.slice() } });
      }
    });
    // sparks thrown off the fight
    this.sparkAcc += this.dt / Math.max(1, engagedCount(st));
    if (!reduced && this.sparkAcc > (this.compact ? 140 : 90)) {
      this.sparkAcc = 0;
      this.spark(P.x, P.y, Math.random() < 0.5 ? '#ffd27a' : '#ff8a4c', 2, 0.12, 420);
      if (Math.random() < 0.35) this.flash(r.site.x + (Math.random() - 0.5) * this.px(40), r.site.y + (Math.random() - 0.5) * this.px(30));
    }
  }

  /** A battle that ended last turn leaves a pennant in the winner's colour, fading. */
  private drawAftermath(I: DrawInput, engaged: Map<number, Engagement>) {
    const st = I.state;
    const L = st.last;
    if (!L || !L.battles?.length) return;
    if (L.turn < st.turn - 1) return;
    const { ctx } = this;
    const S = this.px(1);
    const now = I.now;
    const done = new Set<number>();
    for (let i = L.battles.length - 1; i >= 0; i--) {
      const b = L.battles[i];
      if (b.ongoing || b.winner === null || b.winner === undefined || engaged.has(b.region) || done.has(b.region) || !st.regions[b.region]) continue;
      done.add(b.region);
      const key = `${L.turn}:${L.tick ?? 0}:${b.id}`;
      let t0 = this.aftermathSeen.get(key);
      if (t0 === undefined) { t0 = now; this.aftermathSeen.set(key, t0); if (this.aftermathSeen.size > 64) this.aftermathSeen.delete(this.aftermathSeen.keys().next().value!); }
      const age = now - t0;
      const a = Math.min(1, age / 300) * (0.55 + 0.45 * Math.max(0, 1 - age / 6000));
      const r = st.regions[b.region];
      const c = this.colorOf(st, b.winner);
      // the victor's banner planted on the world (top of the plate at strategic zoom)
      const po = this.plateOff.get(r.id);
      const base = this.tier === 'strategic' && !isLane(r) ? { x: r.site.x + (po?.x ?? 0), y: r.site.y + (po?.y ?? 0) - 12 * S } : { x: r.site.x, y: r.site.y - 3 * S };
      const top = base.y - 24 * S;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(5,3,12,0.9)'; ctx.lineWidth = 4 * S;
      ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(base.x, top); ctx.stroke();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2 * S; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(base.x + 1 * S, top); ctx.lineTo(base.x + 17 * S, top + 5 * S); ctx.lineTo(base.x + 1 * S, top + 11 * S); ctx.closePath();
      ctx.fillStyle = c; ctx.fill(); ctx.strokeStyle = 'rgba(5,3,12,0.9)'; ctx.lineWidth = 1.2 * S; ctx.stroke();
      swords(ctx, base.x + 7 * S, top + 5.5 * S, 3.5 * S, inkOn(c), 1.1 * S);
      ctx.restore();
    }
  }

  // ================================================================ animated layers
  private drawTwinkles(now: number) {
    if (!this.twinkles.length || reducedMotion()) return;
    const { ctx } = this;
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
          this.ownerFx.push({ rid, from: this.regionColor(I.state, prev[rid]), to: this.regionColor(I.state, cur[rid]), t0: I.now });
          if (!reducedMotion() && I.state.regions[rid]) this.burst(I.state.regions[rid].site, this.regionColor(I.state, cur[rid]), this.compact ? 10 : 16, 0.22);
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
      ctx.fillStyle = hexA(o.from, 0.16 * (1 - t)); ctx.fill();
      let R = 0;
      for (const q of r.poly) R = Math.max(R, Math.hypot(q.x - r.site.x, q.y - r.site.y));
      const e = easeOutCubic(clamp01(t / 0.7));
      // the new owner's paint spreads out from the world with a ragged, brushed edge
      ctx.fillStyle = hexA(o.to, 0.4 * (1 - t) + 0.06);
      ctx.beginPath();
      const RR = Math.max(1, R * e);
      for (let i = 0; i <= 40; i++) {
        const a = (i / 40) * TAU;
        const wob = 1 + 0.14 * (h2(o.rid * 13 + i % 40, 3) - 0.5) + 0.08 * Math.sin(a * 5 + o.rid);
        const x = r.site.x + Math.cos(a) * RR * wob, y = r.site.y + Math.sin(a) * RR * wob;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.closePath(); ctx.fill();
      ctx.restore();
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
    }
  }
  /** Names hidden by collisions fade in over everything while hovered. */
  private drawHoverLabels(I: DrawInput) {
    const { ctx } = this;
    for (const [rid, a] of this.hoverA) {
      const hl = this.hiddenLabels.get(rid);
      if (!hl || a < 0.05) continue;
      ctx.save(); ctx.globalAlpha = a;
      roundRect(ctx, hl.x, hl.y, hl.w, hl.h, hl.h / 2); ctx.fillStyle = PLATE; ctx.fill();
      ctx.font = hl.font; ctx.fillStyle = 'rgba(232,228,250,0.95)'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(hl.name, hl.x + this.px(8), hl.y + hl.h / 2 + this.px(0.5));
      ctx.restore();
    }
    void I;
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
    const c = this.regionColor(I.state, I.owners[rid]);
    if (r.poly.length < 3) return;
    // a clear, solid highlight: the region lights up and gets a bright border (no moving outlines)
    path(ctx, r.poly);
    ctx.fillStyle = `rgba(255,255,255,${0.07 * e + (k < 1 ? 0.1 * (1 - k) : 0)})`; ctx.fill();
    ctx.save(); ctx.clip();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = `rgba(255,255,255,${0.9 * e})`; ctx.lineWidth = this.px(6); ctx.stroke();
    ctx.restore();
    void c;
  }

  /** The animated parts of a site (the Throne's breath, crown shimmer, capital ring): over the cached layer. */
  private drawSiteAnim(r: Region, I: DrawInput, c: string) {
    if (reducedMotion()) return;
    const { ctx } = this;
    const p = r.site;
    const t = I.now / 1000;
    const S = this.px(1);
    const bt = this.bannerTier(r, I);
    if (bt === 'strategic') {
      if (r.kind === 'throne') {
        const br = 0.5 + 0.5 * Math.sin(t * 1.4);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 44 * S);
        g.addColorStop(0, `rgba(255,236,170,${0.12 + 0.1 * br})`); g.addColorStop(1, 'rgba(255,200,90,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, 44 * S, 0, TAU); ctx.fill();
      }
      return;
    }
    if (r.kind === 'throne') {
      const size = this.siteR(r, bt) * S;
      const br = 0.5 + 0.5 * Math.sin(t * 1.4);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size * 4.5);
      g.addColorStop(0, `rgba(255,236,170,${0.2 + 0.14 * br})`); g.addColorStop(1, 'rgba(255,200,90,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, size * 4.5, 0, TAU); ctx.fill();
    }
    void c;
  }

  // ================================================================ arrows
  /** A planned-order arrow: owner colour, roman slot badge at the midpoint, swords head for a seize, dashed for a
   *  join / route in transit, a non-roman label (LIVE ETA) at the head. */
  arrow(a: Pt, b: Pt, color: string, dashed: boolean, label: string, alpha: number, kind: Order['type'] = 'move') {
    const { ctx } = this;
    const dx = b.x - a.x, dy = b.y - a.y;
    const L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L, ny = dx / L;
    const bend = Math.min(60, L * 0.18);
    const cx = (a.x + b.x) / 2 + nx * bend, cy = (a.y + b.y) / 2 + ny * bend;
    const s = this.px(1);
    const shrink = 20 * s;
    const t1 = shrink / L, t2full = 1 - shrink / L;
    if (t2full <= t1) return;
    const key = `${a.x | 0},${a.y | 0},${b.x | 0},${b.y | 0},${color},${dashed ? 1 : 0}`;
    this.arrowFrame.add(key);
    let born = this.arrowSeen.get(key);
    if (born === undefined) { born = reducedMotion() ? -1e9 : this.now; this.arrowSeen.set(key, born); }
    const grow = easeOutCubic(clamp01((this.now - born) / 380));
    const t2 = t1 + (t2full - t1) * grow;
    const q = (t: number) => ({ x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * cx + t * t * b.x, y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * cy + t * t * b.y });
    const p2 = q(t2), pm = q(0.5), pb = q(Math.max(t1, t2 - 0.02));
    const seize = kind === 'seize';
    ctx.save();
    ctx.globalAlpha = alpha;
    // dark casing so the arrow reads over any fill
    const trace = () => { ctx.beginPath(); ctx.moveTo(q(t1).x, q(t1).y); const N = 16; for (let i = 1; i <= N; i++) { const pp = q(t1 + (t2 - t1) * (i / N)); ctx.lineTo(pp.x, pp.y); } };
    ctx.lineCap = 'round';
    trace(); ctx.strokeStyle = 'rgba(5,3,12,0.55)'; ctx.lineWidth = 6 * s; ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = 3 * s;
    if (dashed) { ctx.setLineDash([7 * s, 6 * s]); ctx.lineDashOffset = reducedMotion() ? 0 : -(this.now / 45) * s; }
    trace(); ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
    if (!dashed && grow >= 1 && !reducedMotion()) {
      const ph = ((this.now / 1500) + ((a.x * 7 + b.y * 3) % 1000) / 1000) % 1;
      const sp = q(t1 + (t2 - t1) * ph);
      const fade = Math.sin(ph * Math.PI);
      ctx.fillStyle = `rgba(255,255,255,${0.85 * fade})`;
      ctx.beginPath(); ctx.arc(sp.x, sp.y, 2.4 * s, 0, TAU); ctx.fill();
    }
    const ang = Math.atan2(p2.y - pb.y, p2.x - pb.x);
    if (seize && grow >= 0.9) {
      ctx.beginPath(); ctx.arc(p2.x, p2.y, 10 * s, 0, TAU); ctx.fillStyle = 'rgba(5,3,12,0.92)'; ctx.fill();
      ctx.strokeStyle = color; ctx.lineWidth = 2 * s; if (dashed) ctx.setLineDash([3 * s, 2 * s]); ctx.stroke(); ctx.setLineDash([]);
      swords(ctx, p2.x, p2.y, 6.5 * s, '#ffffff', 1.7 * s);
    } else {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.moveTo(p2.x + Math.cos(ang) * 10 * s, p2.y + Math.sin(ang) * 10 * s);
      ctx.lineTo(p2.x + Math.cos(ang + 2.5) * 10 * s, p2.y + Math.sin(ang + 2.5) * 10 * s);
      ctx.lineTo(p2.x + Math.cos(ang - 2.5) * 10 * s, p2.y + Math.sin(ang - 2.5) * 10 * s); ctx.closePath();
      if (dashed && kind !== 'move') { ctx.fillStyle = 'rgba(5,3,12,0.9)'; ctx.fill(); ctx.strokeStyle = color; ctx.lineWidth = 1.6 * s; ctx.stroke(); } else ctx.fill();
    }
    if (label && grow > 0.5) {
      const ls = grow < 1 ? easeOutBack(clamp01((grow - 0.5) / 0.5)) : 1;
      ctx.font = numFont(12 * s * ls); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (ROMAN.test(label)) {
        const w = Math.max(20 * s, ctx.measureText(label).width + 10 * s) * ls;
        roundRect(ctx, pm.x - w / 2, pm.y - 9 * s * ls, w, 18 * s * ls, 9 * s * ls); ctx.fillStyle = 'rgba(8,4,16,0.94)'; ctx.fill();
        ctx.strokeStyle = color; ctx.lineWidth = 1.5 * s; ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.fillText(label, pm.x, pm.y + 0.5 * s);
      } else {
        // ETA at the head
        const w = ctx.measureText(label).width + 10 * s;
        const hx = p2.x + Math.cos(ang) * 4 * s + (Math.cos(ang) >= 0 ? 8 * s : -8 * s - w), hy = p2.y - 20 * s;
        roundRect(ctx, hx, hy, w, 17 * s, 4 * s); ctx.fillStyle = 'rgba(8,4,16,0.92)'; ctx.fill();
        ctx.strokeStyle = hexA(color, 0.8); ctx.lineWidth = 1 * s; ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.fillText(label, hx + 5 * s, hy + 9 * s);
      }
      ctx.textBaseline = 'alphabetic';
    }
    ctx.restore();
  }

  /** A route along hyperlane dots: dashed polyline in the owner colour, head (or swords for a seize), ETA label. */
  private routeArrow(pts: Pt[], color: string, label: string, seize: boolean) {
    const { ctx } = this;
    const s = this.px(1);
    const end = pts[pts.length - 1], prev = pts[pts.length - 2];
    const L = Math.hypot(end.x - prev.x, end.y - prev.y) || 1;
    const back = Math.min(L * 0.5, 16 * s);
    const tip = { x: end.x - ((end.x - prev.x) / L) * back, y: end.y - ((end.y - prev.y) / L) * back };
    const ang = Math.atan2(end.y - prev.y, end.x - prev.x);
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const trace = () => { ctx.beginPath(); pts.slice(0, -1).forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.lineTo(tip.x, tip.y); };
    trace(); ctx.strokeStyle = 'rgba(5,3,12,0.55)'; ctx.lineWidth = 6 * s; ctx.stroke();
    ctx.setLineDash([7 * s, 6 * s]); ctx.lineDashOffset = reducedMotion() ? 0 : -(this.now / 45) * s;
    trace(); ctx.strokeStyle = color; ctx.lineWidth = 3 * s; ctx.stroke();
    ctx.setLineDash([]); ctx.lineDashOffset = 0;
    if (seize) {
      ctx.beginPath(); ctx.arc(tip.x, tip.y, 10 * s, 0, TAU); ctx.fillStyle = 'rgba(5,3,12,0.92)'; ctx.fill();
      ctx.strokeStyle = color; ctx.lineWidth = 2 * s; ctx.stroke();
      swords(ctx, tip.x, tip.y, 6.5 * s, '#ffffff', 1.7 * s);
    } else {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.moveTo(tip.x + Math.cos(ang) * 10 * s, tip.y + Math.sin(ang) * 10 * s);
      ctx.lineTo(tip.x + Math.cos(ang + 2.5) * 10 * s, tip.y + Math.sin(ang + 2.5) * 10 * s);
      ctx.lineTo(tip.x + Math.cos(ang - 2.5) * 10 * s, tip.y + Math.sin(ang - 2.5) * 10 * s); ctx.closePath(); ctx.fill();
    }
    if (label) {
      ctx.font = numFont(12 * s); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      const w = ctx.measureText(label).width + 10 * s;
      const hx = tip.x + (Math.cos(ang) >= 0 ? 12 * s : -12 * s - w), hy = tip.y - 22 * s;
      roundRect(ctx, hx, hy, w, 17 * s, 4 * s); ctx.fillStyle = 'rgba(8,4,16,0.92)'; ctx.fill();
      ctx.strokeStyle = hexA(color, 0.8); ctx.lineWidth = 1 * s; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.fillText(label, hx + 5 * s, hy + 9 * s);
      ctx.textBaseline = 'alphabetic';
    }
    ctx.restore();
  }

  /** The arrow under a drag: marching dashes toward the head, a verb glyph at the head; the head eases (snaps) to `to`. */
  private drawDrag(D: DragArrow, now: number) {
    const { ctx } = this;
    const s = this.px(1);
    if (!this.dragHead || reducedMotion()) this.dragHead = { ...D.to };
    else {
      const e = 1 - Math.exp(-this.dt / 45);
      this.dragHead.x += (D.to.x - this.dragHead.x) * e; this.dragHead.y += (D.to.y - this.dragHead.y) * e;
    }
    const a = D.from, b = this.dragHead;
    const dx = b.x - a.x, dy = b.y - a.y;
    const L = Math.hypot(dx, dy);
    if (L < 6 * s) return;
    // a route through lane waypoints: the arrow follows the hyperlane, not the crow's flight
    if (D.path && D.path.length > 2 && D.verb !== 'invalid') { this.drawDragRoute(D, now); return; }
    const invalid = D.verb === 'invalid', od = D.verb === 'od', hollow = D.verb === 'join';
    const col = invalid ? 'rgba(200,198,215,0.85)' : od ? '#ffb347' : D.color;
    const nx = -dy / L, ny = dx / L;
    const bend = Math.min(50, L * 0.15);
    const cx = (a.x + b.x) / 2 + nx * bend, cy = (a.y + b.y) / 2 + ny * bend;
    const q = (t: number) => ({ x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * cx + t * t * b.x, y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * cy + t * t * b.y });
    const headGap = 14 * s / L;
    const t2 = Math.max(0.05, 1 - headGap);
    const N = od ? Math.max(4, Math.round(L / s / 16)) * 2 : 28;
    const trace = () => {
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const t = (i / N) * t2;
        const p = q(t);
        let ox = 0, oy = 0;
        if (od && i > 0 && i < N) { const j = (i % 2 ? 1 : -1) * 5 * s; const p1 = q(Math.min(1, t + 0.01)); const l = Math.hypot(p1.x - p.x, p1.y - p.y) || 1; ox = -(p1.y - p.y) / l * j; oy = (p1.x - p.x) / l * j; }
        if (i) ctx.lineTo(p.x + ox, p.y + oy); else ctx.moveTo(p.x, p.y);
      }
    };
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    trace(); ctx.strokeStyle = 'rgba(5,3,12,0.6)'; ctx.lineWidth = 8 * s; ctx.stroke();
    if (invalid) { ctx.setLineDash([0.1 * s, 8 * s]); ctx.strokeStyle = col; ctx.lineWidth = 4 * s; trace(); ctx.stroke(); }
    else {
      ctx.strokeStyle = hexA0(od ? '#ffb347' : D.color.startsWith('#') ? D.color : '#ffffff', hollow ? 0.0 : 0.45); ctx.lineWidth = 4.5 * s; if (!hollow) { trace(); ctx.stroke(); }
      if (hollow) { ctx.strokeStyle = col; ctx.lineWidth = 5 * s; trace(); ctx.stroke(); ctx.strokeStyle = 'rgba(5,3,12,0.95)'; ctx.lineWidth = 2 * s; trace(); ctx.stroke(); }
      ctx.setLineDash([10 * s, 8 * s]); ctx.lineDashOffset = reducedMotion() ? 0 : -(now / 28) * s;
      ctx.strokeStyle = hollow ? col : '#ffffff'; ctx.lineWidth = (hollow ? 2 : 2.4) * s; trace(); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.lineDashOffset = 0;
    // head
    const pe = q(t2), pb = q(Math.max(0, t2 - 0.04));
    const ang = Math.atan2(pe.y - pb.y, pe.x - pb.x);
    const H = { x: b.x, y: b.y };
    if (D.verb === 'move' || D.verb === 'od') {
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(H.x + Math.cos(ang) * 4 * s, H.y + Math.sin(ang) * 4 * s);
      ctx.lineTo(H.x + Math.cos(ang + 2.55) * 16 * s, H.y + Math.sin(ang + 2.55) * 16 * s);
      ctx.lineTo(H.x - Math.cos(ang) * 6 * s, H.y - Math.sin(ang) * 6 * s);
      ctx.lineTo(H.x + Math.cos(ang - 2.55) * 16 * s, H.y + Math.sin(ang - 2.55) * 16 * s); ctx.closePath();
      ctx.fill(); ctx.strokeStyle = 'rgba(5,3,12,0.9)'; ctx.lineWidth = 1.5 * s; ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(H.x, H.y, 14 * s, 0, TAU); ctx.fillStyle = 'rgba(5,3,12,0.94)'; ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 2.5 * s; if (invalid || hollow) ctx.setLineDash([3 * s, 2.5 * s]); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = invalid ? '#c8c6d7' : '#ffffff'; ctx.lineWidth = 2.6 * s; ctx.lineCap = 'round';
      if (D.verb === 'seize' || D.verb === 'join') swords(ctx, H.x, H.y, 8.5 * s, '#ffffff', 2 * s);
      else if (D.verb === 'merge') { ctx.beginPath(); ctx.moveTo(H.x - 7 * s, H.y); ctx.lineTo(H.x + 7 * s, H.y); ctx.moveTo(H.x, H.y - 7 * s); ctx.lineTo(H.x, H.y + 7 * s); ctx.stroke(); }
      else if (D.verb === 'split') { ctx.beginPath(); ctx.moveTo(H.x, H.y + 7 * s); ctx.lineTo(H.x, H.y); ctx.lineTo(H.x - 6 * s, H.y - 6 * s); ctx.moveTo(H.x, H.y); ctx.lineTo(H.x + 6 * s, H.y - 6 * s); ctx.stroke(); }
      else { ctx.beginPath(); ctx.moveTo(H.x - 6 * s, H.y - 6 * s); ctx.lineTo(H.x + 6 * s, H.y + 6 * s); ctx.moveTo(H.x + 6 * s, H.y - 6 * s); ctx.lineTo(H.x - 6 * s, H.y + 6 * s); ctx.stroke(); }
    }
    ctx.restore();
  }

  /** The drag arrow along a multi-step route: a polyline through the waypoints to the (eased) head. */
  private drawDragRoute(D: DragArrow, now: number) {
    const { ctx } = this;
    const s = this.px(1);
    const pts = [D.from, ...D.path!.slice(1, -1), this.dragHead ?? D.to];
    const end = pts[pts.length - 1], prev = pts[pts.length - 2];
    const L = Math.hypot(end.x - prev.x, end.y - prev.y) || 1;
    const back = Math.min(L * 0.6, 14 * s);
    const tipP = { x: end.x - ((end.x - prev.x) / L) * back, y: end.y - ((end.y - prev.y) / L) * back };
    const ang = Math.atan2(end.y - prev.y, end.x - prev.x);
    const od = D.verb === 'od', hollow = D.verb === 'join';
    const col = od ? '#ffb347' : D.color;
    const trace = () => { ctx.beginPath(); pts.slice(0, -1).forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.lineTo(tipP.x, tipP.y); };
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    trace(); ctx.strokeStyle = 'rgba(5,3,12,0.6)'; ctx.lineWidth = 8 * s; ctx.stroke();
    trace(); ctx.strokeStyle = hexA0(col.startsWith('#') ? col : '#ffffff', hollow ? 0.9 : 0.45); ctx.lineWidth = (hollow ? 5 : 4.5) * s; ctx.stroke();
    ctx.setLineDash([10 * s, 8 * s]); ctx.lineDashOffset = reducedMotion() ? 0 : -(now / 28) * s;
    trace(); ctx.strokeStyle = hollow ? 'rgba(5,3,12,0.95)' : '#ffffff'; ctx.lineWidth = (hollow ? 2 : 2.4) * s; ctx.stroke();
    ctx.setLineDash([]);
    // waypoint beads
    ctx.fillStyle = '#ffffff';
    for (const p of pts.slice(1, -1)) { ctx.beginPath(); ctx.arc(p.x, p.y, 2.6 * s, 0, TAU); ctx.fill(); }
    const H = end;
    if (D.verb === 'move' || od) {
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(H.x + Math.cos(ang) * 4 * s, H.y + Math.sin(ang) * 4 * s);
      ctx.lineTo(H.x + Math.cos(ang + 2.55) * 16 * s, H.y + Math.sin(ang + 2.55) * 16 * s);
      ctx.lineTo(H.x - Math.cos(ang) * 6 * s, H.y - Math.sin(ang) * 6 * s);
      ctx.lineTo(H.x + Math.cos(ang - 2.55) * 16 * s, H.y + Math.sin(ang - 2.55) * 16 * s); ctx.closePath();
      ctx.fill(); ctx.strokeStyle = 'rgba(5,3,12,0.9)'; ctx.lineWidth = 1.5 * s; ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(H.x, H.y, 14 * s, 0, TAU); ctx.fillStyle = 'rgba(5,3,12,0.94)'; ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 2.5 * s; if (hollow) ctx.setLineDash([3 * s, 2.5 * s]); ctx.stroke(); ctx.setLineDash([]);
      swords(ctx, H.x, H.y, 8.5 * s, '#ffffff', 2 * s);
    }
    ctx.restore();
  }

  // ================================================================ effects & particles
  private drawFx(I: DrawInput, list: Fx[]) {
    const { ctx } = this;
    const reduced = reducedMotion();
    const S = this.px(1);
    for (const fx of list) {
      const t = (I.now - fx.t0) / fx.dur;
      if (t < 0 || t > 1) continue;
      const c = fx.color;
      const P = fx.pos;
      if (!this.fxInit.has(fx)) { this.fxInit.add(fx); if (!reduced) this.spawnFor(fx); }
      if (fx.kind === 'battle' || fx.kind === 'clash') {
        // a burst of fire: a fireball and a few flashes around it
        fireball(ctx, P.x, P.y, 14 * S, Math.min(1, t * 1.6), 0.9);
        if (!reduced && Math.random() < 0.3) this.flash(P.x + (Math.random() - 0.5) * this.px(60), P.y + (Math.random() - 0.5) * this.px(46));
      } else if (fx.kind === 'capture') {
        // a new house banner planted on the world: a pole rises, the enamelled flag unfurls
        const rise = easeOutBack(clamp01(t / 0.3));
        const a = 1 - clamp01((t - 0.8) / 0.2);
        const top = P.y - 50 * S * rise;
        ctx.save(); ctx.globalAlpha = a;
        if (t < 0.25) drawGlow(ctx, P.x, P.y, 46 * S, rgbA(c), 1 - t / 0.25);
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(10,8,14,0.9)'; ctx.lineWidth = 3.4 * S; ctx.beginPath(); ctx.moveTo(P.x, P.y - 4 * S); ctx.lineTo(P.x, top); ctx.stroke();
        const pg = ctx.createLinearGradient(P.x - 1.5 * S, 0, P.x + 1.5 * S, 0); pg.addColorStop(0, '#fff2c0'); pg.addColorStop(1, '#8a6420');
        ctx.strokeStyle = pg; ctx.lineWidth = 1.8 * S; ctx.stroke();
        ctx.fillStyle = '#ffe08a'; ctx.beginPath(); ctx.arc(P.x, top - 2 * S, 2.6 * S, 0, TAU); ctx.fill();
        const open = clamp01((t - 0.15) / 0.25);
        const wave = reduced ? 0 : Math.sin(I.now / 110) * 2.5 * S;
        const fw = 26 * S * open, fh = 16 * S;
        ctx.beginPath(); ctx.moveTo(P.x, top);
        ctx.quadraticCurveTo(P.x + fw * 0.5, top + wave, P.x + fw, top + 2 * S + wave * 0.6);
        ctx.lineTo(P.x + fw * 0.82, top + fh * 0.55 + wave * 0.3);
        ctx.lineTo(P.x + fw, top + fh + wave * 0.2);
        ctx.quadraticCurveTo(P.x + fw * 0.5, top + fh + wave * 0.6, P.x, top + fh);
        ctx.closePath();
        if (open > 0.05) enamel(ctx, c, top, top + fh, 'gold', 1.1 * S);
        ctx.restore();
      } else if (fx.kind === 'excavate') {
        // the dig: a shaft of amber light, dust boiling up and drifting
        const a = Math.sin(Math.PI * t);
        const g = ctx.createLinearGradient(P.x, P.y - 110 * S, P.x, P.y);
        g.addColorStop(0, hexA(c, 0)); g.addColorStop(1, hexA(c, 0.55 * a));
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = g; ctx.fillRect(P.x - 6 * S, P.y - 110 * S, 12 * S, 110 * S);
        ctx.restore();
        for (let i = 0; i < 5; i++) { const k = (t * 1.6 + i / 5) % 1; smoke(ctx, P.x + Math.sin(i * 2.1 + k * 3) * 14 * S, P.y - k * 46 * S, (8 + k * 16) * S, 0.5 * (1 - k) * a); }
        drawGlow(ctx, P.x, P.y, 20 * S, rgbA(c), 0.6 * a);
      } else if (fx.kind === 'build') {
        // a hull warps in at the yard: a lens streak, a contracting ring of light, the model resolving out of it
        const flash = t < 0.35 ? t / 0.35 : 1 - (t - 0.35) / 0.65;
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        const sw = (60 + 40 * (1 - t)) * S;
        const lg = ctx.createLinearGradient(P.x - sw, 0, P.x + sw, 0);
        lg.addColorStop(0, hexA(c, 0)); lg.addColorStop(0.5, `rgba(255,255,255,${0.9 * flash})`); lg.addColorStop(1, hexA(c, 0));
        ctx.fillStyle = lg; ctx.fillRect(P.x - sw, P.y - 1.4 * S, sw * 2, 2.8 * S);
        const rr = (34 * (1 - easeOutCubic(clamp01(t / 0.5))) + 4) * S;
        ctx.strokeStyle = hexA(c, 0.8 * (1 - t)); ctx.lineWidth = 2.2 * S; ctx.beginPath(); ctx.ellipse(P.x, P.y, rr, rr * 0.5, 0, 0, TAU); ctx.stroke();
        ctx.restore();
        drawGlow(ctx, P.x, P.y, 26 * S, rgbA(c), flash);
        if (t > 0.3) {
          const k = clamp01((t - 0.3) / 0.4);
          const L = this.miniGeom().len * 1.1;
          drawShip(ctx, P.x, P.y - 4 * S, L * S, L * this.dpr, fx.cls ?? 'frigate', fx.owner ?? 0, c, 0, { alpha: k * (1 - clamp01((t - 0.85) / 0.15)), flash: 1 - k, engine: 1 });
        }
      } else if (fx.kind === 'explode') {
        const sz = fx.size ?? 1;
        fireball(ctx, P.x, P.y, (12 + 10 * sz) * S, Math.min(1, t * 1.4), 1);
        if (t > 0.2) smoke(ctx, P.x + 6 * S * t, P.y - 10 * S * t, (14 + 20 * t) * S * sz, 0.5 * (1 - t));
      } else if (fx.kind === 'warden') {
        // the Warden stirs: a violet rift tears open, lightning crawls out, then it seals
        const open = t < 0.2 ? easeOutCubic(t / 0.2) : t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        drawGlow(ctx, P.x, P.y, 60 * S * open, [200, 120, 255], 0.8 * open);
        ctx.restore();
        ctx.save(); ctx.translate(P.x, P.y); ctx.rotate(-0.5);
        ctx.fillStyle = `rgba(6,0,14,${0.9 * open})`; ctx.beginPath(); ctx.ellipse(0, 0, 9 * S * open, 30 * S * open, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = `rgba(235,200,255,${0.9 * open})`; ctx.lineWidth = 1.6 * S; ctx.stroke();
        ctx.restore();
        if (!reduced) {
          ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = `rgba(220,170,255,${0.85 * open})`; ctx.lineWidth = 1.2 * S;
          for (let i = 0; i < 4; i++) {
            const seed = Math.floor(I.now / 70) * 7 + i;
            let x = P.x, y = P.y, ang = h2(seed, 1) * TAU;
            ctx.beginPath(); ctx.moveTo(x, y);
            for (let j = 0; j < 6; j++) { ang += (h2(seed, j + 2) - 0.5) * 1.6; x += Math.cos(ang) * 9 * S; y += Math.sin(ang) * 9 * S; ctx.lineTo(x, y); }
            ctx.stroke();
          }
          ctx.restore();
        }
      } else if (fx.kind === 'stamp') {
        // CALLED IT / CAUGHT OUT: a rubber stamp slammed onto the table
        const txt = fx.text ?? 'CALLED IT';
        stamp(ctx, txt, P.x, P.y - 40 * S, 20 * S, c, t);
        continue;
      }
      // 'ripple' / 'arrive' were expanding rings: no longer drawn (no abstract outlines on the map)
      if (fx.text) {
        const pop = t < 0.12 ? 0.6 + 0.4 * easeOutBack(t / 0.12) : 1;
        ctx.font = numFont(this.px(14 * pop));
        ctx.textAlign = 'center';
        const y = P.y - this.px(36) - easeOutCubic(t) * this.px(20);
        ctx.lineWidth = this.px(3); ctx.strokeStyle = `rgba(6,3,14,${0.7 * Math.min(1, (1 - t) * 2)})`;
        ctx.strokeText(fx.text, P.x, y);
        ctx.fillStyle = hexA(fx.kind === 'text' || fx.kind === 'explode' ? c : '#ffffff', Math.min(1, (1 - t) * 2));
        ctx.fillText(fx.text, P.x, y);
      }
    }
    if (list === this.ownFx) this.drawHoverLabels(I);
  }

  /** Particles that belong to an effect, spawned on its first visible frame. */
  private spawnFor(fx: Fx) {
    const P = fx.pos;
    const m = this.compact ? 0.6 : 1;
    switch (fx.kind) {
      case 'explode': {
        const S = fx.size ?? 1;
        this.burst(P, '#ffb36b', Math.round(14 * m * S), 0.3 * Math.sqrt(S), 900, true);
        // hull debris: dark tumbling shards lit by the fire
        this.burst(P, '#a85a30', Math.round(10 * m * S), 0.16 * Math.sqrt(S), 1600);
        break;
      }
      case 'warden': this.burst(P, '#d9a8ff', Math.round(14 * m), 0.2, 1000, true); break;
      case 'capture': this.burst(P, fx.color, Math.round(18 * m), 0.25, 900); break;
      case 'excavate': for (let i = 0; i < 16 * m && this.particles.length < (this.compact ? 220 : 450); i++) this.particles.push({ x: P.x + (Math.random() - 0.5) * this.px(24), y: P.y, vx: (Math.random() - 0.5) * this.px(0.02), vy: -this.px(0.04 + Math.random() * 0.08), t0: this.now, life: 900 + Math.random() * 600, size: 1.5 + Math.random() * 1.5, color: fx.color, drag: 0.999, streak: false, grav: 0 }); break;
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
    if (this.particles.length >= (this.compact ? 220 : 450)) return;
    this.particles.push({ x, y, vx: 0, vy: 0, t0: this.now, life: 160, size: 7, color: '#fff2c8', drag: 1, streak: false, grav: 0 });
  }
  /** Arrival / warp-in pings used to be expanding rings; the map no longer draws abstract rings (tokens pop in instead). */
  private ring(_p: Pt, _color: string, _dur: number, _from: number, _to: number) { /* intentionally empty */ }

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

  private prepare(st: GameState) {
    this.seed = st.seed;
    this.asteroidCache.clear();
    this.lastKnown.clear();
    this.tokDisp.clear();
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
    this.stars = null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of st.regions) for (const p of r.poly) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
    if (!Number.isFinite(minX)) { minX = minY = -1000; maxX = maxY = 1000; }
    this.haze = nebulaPrint(minX, minY, maxX, maxY, st.seed);
  }
}

/** Left-aligned letter-spaced text: native canvas letterSpacing where available (one call), else per glyph. */
type LS = CanvasRenderingContext2D & { letterSpacing?: string };
function spacedText(ctx: CanvasRenderingContext2D, t: string, x: number, y: number, sp: number) {
  const c = ctx as LS;
  if (typeof c.letterSpacing === 'string') { const prev = c.letterSpacing; c.letterSpacing = `${sp}px`; ctx.fillText(t, x, y); c.letterSpacing = prev; return; }
  for (const ch of t) { ctx.fillText(ch, x, y); x += ctx.measureText(ch).width + sp; }
}
function spacedWidth(ctx: CanvasRenderingContext2D, t: string, sp: number) {
  const c = ctx as LS;
  if (typeof c.letterSpacing === 'string') { const prev = c.letterSpacing; c.letterSpacing = `${sp}px`; const w = ctx.measureText(t).width - sp; c.letterSpacing = prev; return w; }
  return ctx.measureText(t).width + sp * (t.length - 1);
}

function engagedCount(st: GameState) { return Math.max(1, st.engagements?.length ?? 1); }

// ---------------------------------------------------------------- helpers
/** Token parking positions: every fleet of one owner in one region shares that owner's anchor slot (screen-constant
 *  offset from the site, per zoom tier). `scale` = world units per screen px (MapRenderer.px(1)). */
export function regionLayout(st: GameState, fleets: { id: number; region: number; owner?: number }[], scale = 2.5): Map<number, Pt> {
  const out = new Map<number, Pt>();
  if (!(scale > 0)) scale = 2.5;
  const Rs = medianRegionRadius(st) / scale;
  const tier = tierFor(Rs, null);
  const k = slotScale(tier, Rs);
  let byId: Map<number, number> | null = null;
  const ownerOf = (id: number): number => {
    if (!byId) {
      byId = new Map();
      for (const f of st.last?.startFleets ?? []) byId.set(f.id, f.owner);
      for (const f of st.fleets) byId.set(f.id, f.owner);
    }
    return byId.get(id) ?? 0;
  };
  for (const f of fleets) {
    const r = st.regions[f.region];
    if (!r) continue;
    out.set(f.id, anchorOf(r, f.owner ?? ownerOf(f.id), tier, scale, k));
  }
  return out;
}

export function path(ctx: CanvasRenderingContext2D, poly: Pt[]) {
  ctx.beginPath();
  poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
}

export function hexA(hex: string, a: number): string { return hexA0(hex, a); }
