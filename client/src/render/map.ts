// Canvas renderer for the strategic map (UX v2, docs/UX-V2.md §2): semantic zoom in three tiers
// (strategic / operational / detail), one object per idea (region banner, fleet token per owner per region,
// battle roundel), lenses, order and drag arrows, plus replay animation overlays and effects.
// The look is the enamel and gold orrery (docs/ART-BIBLE.md §13): the ground is baked in world-space tiles by
// render/dial.ts; stars are gems, pieces are lit cast-metal and gold (art/orrery.ts, art/figurine.ts). 2D only.
import type { GameState, Region, Fleet, Pt, Signal, Order, Engagement } from '../../../shared/sim/types.ts';
import { NEUTRAL_COLOR, SIGILS, CALLINGS, POSTURES } from '../../../shared/config/content.ts';
import { tenureTier } from '../../../shared/sim/soul.ts';
import { drawSigil, goldPaint } from '../art/sigils.ts';
import { drawShip } from '../art/ships.ts';
import { scheme } from '../art/palette.ts';
import { CLASS_RANK, classLen } from '../art/palette.ts';
import { formation } from '../art/minis.ts';
import { drawBodyShadow, bodyWorldType } from '../art/planets.ts';
import { starKindOf } from '../art/stars.ts';
import { retint, SEMANTIC, enamel as enamelOf } from '../art/bible.ts';
import { drawGlow, fireball, smoke, stamp } from '../art/fx.ts';
import { enamel } from '../art/plates.ts';
import { drawStructure, shieldDome, type Structure } from '../art/structures.ts';
import { rgb as rgbA, h2 } from '../art/util.ts';
import { pointInPoly } from '../../../shared/sim/mapgen.ts';
import * as O from '../art/orrery.ts';
import { drawFigurine, drawPlinth, drawPin, figurineFrame, PLINTH_SQUASH } from '../art/figurine.ts';
import { gfxQuality, gfxFrame, onGfxChange } from '../art/gfx.ts';
import { Dial, type DialContent } from './dial.ts';
import { TRAITS as WORLD_TRAITS, VEINS } from '../../../shared/config/empire.ts';
import { connected, supplied, maxDevAt } from '../../../shared/sim/empire.ts';
import { contestOn, systemStatus } from '../../../shared/sim/contest.ts';
import { STARS } from '../../../shared/config/systems.ts';
import { battleViewerOpen } from './battle.ts';
import { uiScale } from '../ui/dom.ts';
import { drawIcon, fillIconText, measureIconText, icFor, type IconName } from '../art/icons.ts';
import {
  type Tier, type Lens, type ZoomW, coarsePointer, medianRegionRadius, tierFor, slotFor, anchorOf, powerOf, garrisonPower,
  garrisonMax, regionEdges, empireLabels, nearestRegion, isLane, hyperlanes, zoomW, starPx, tokR, artGrow, setViewer,
} from './mapmodel.ts';
import { fleetSpeed, within, findPath } from '../../../shared/sim/graph.ts';
import {
  TAU, numFont, displayFont, desat, inkOn, roundRect, swords, haloText, letterSpaced, hexA as hexA0,
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
export interface DragArrow {
  from: Pt; to: Pt; verb: DragVerb; color: string; path?: Pt[]; ghost?: Pt | null;
  /** a hover preview of the selected fleet's order (not a drag in progress) */
  blink?: boolean;
}
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
const GOLD = SEMANTIC.fate;
const WARDEN = '#ab95d8';
const BASE_SQUASH = PLINTH_SQUASH;
/** Body stones at detail zoom, by world type (orrery cabochons on their gold tracks). */
const BODY_STONE: Record<string, O.Stone> = {
  gas: O.STONE.gas, ice: O.STONE.ice, lava: O.STONE.lava, ash: O.STONE.lava, ocean: O.STONE.ocean, terran: O.STONE.ocean,
  garden: O.STONE.garden, thorn: O.STONE.garden, toxic: O.STONE.garden, crystal: O.STONE.ice, desert: O.STONE.gas, barren: O.STONE.rock,
};

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
  /** the fleet picked up by a drag: its miniature lifts off the felt (DELIGHT #10) */
  lift?: number | null;
  /** map lens (default political) */
  lens?: Lens;
  /** region whose own fleet stack is fanned out into per-fleet tokens */
  expanded?: number | null;
  /** hold Space: detail-tier banners everywhere */
  peek?: boolean;
  /** Signature: fleet id → posture to show (yours: planned or in force; rivals': only what your view reveals) */
  postures?: Map<number, string> | null;
}

export class MapRenderer {
  ctx: CanvasRenderingContext2D;
  cam = { x: 0, y: 0, z: 0.4 };
  w = 0; h = 0; dpr = 1;
  /** UI scale (style.css root font-size / 16): screen-constant map furniture (labels, plates, chips, tokens) is
   *  drawn in design px, `ui` CSS px each, so it grows with the HUD on big screens. 1 on phones and up to 1440x900. */
  ui = 1;
  /** the ground: the dial, territories and resting lanes, baked in world-space tiles (render/dial.ts) */
  private dial = new Dial();
  /** the lamp over the ground: one glaze reflection (High) and the room's falloff, screen space, baked per size */
  private lamp: { c: HTMLCanvasElement; key: string } | null = null;
  private seed = -1;
  fitted = false;
  /** intel signal markers drawn this frame (world centre), for the tooltip */
  private signalHits: { x: number; y: number; text: string }[] = [];
  /** the star under the mouse this frame (hover reveals its name and garrison) */
  private hovStar: number | null = null;
  /** battle markers drawn this frame (world centre, radius in design px), for the tooltip */
  private battleHits: { rid: number; x: number; y: number; r: number }[] = [];
  private frameNo = 0;

  // ---- semantic zoom
  private _tier: Tier | null = null;
  /** non-null while the ground crossfades between two bakes (a new zoom bucket, a capture, the fog moving) */
  get fade(): { dial: true } | null { return this.dial.fading ? { dial: true } : null; }
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
  private lastKnownBy = new Map<number | null, Map<number, number>>();
  /** the current viewer's memory (per seat: hotseat seats must not see each other's scouting) */
  private lastKnown = new Map<number, number>();
  private lkVer = 0;
  private dragHead: Pt | null = null;
  /** lane focus: eased brightness per hyperlane segment (key = segment index in laneSegs) */
  private laneA = new Map<number, number>();
  private laneMemo: { key: string; t: Map<number, number> } = { key: '', t: new Map() };
  /** last mouse position over the map canvas (screen px), for star / fleet hover; null for touch or when it left */
  private mouse: Pt | null = null;
  private aftermathSeen = new Map<string, number>();
  private memoSup: { st: GameState | null; you: number | null; conn: Set<number> | null; sup: Set<number> | null } = { st: null, you: null, conn: null, sup: null };
  private fleetIdx: { src: Fleet[] | null; m: Map<number, Fleet>; last: Map<number, Fleet> } = { src: null, m: new Map(), last: new Map() };

  constructor(public canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    // hover is mouse-only (touch selects instead): remember where it is for the lane focus
    canvas.addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse') { this.mouse = null; return; }
      const r = canvas.getBoundingClientRect();
      this.mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
    }, { passive: true });
    canvas.addEventListener('pointerleave', () => { this.mouse = null; }, { passive: true });
    canvas.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') this.mouse = null; }, { passive: true });
    // name widths are measured once: measure again once web fonts arrive
    document.fonts?.ready.then(() => { this.nameWidth.clear(); this.nameMemo.key = ''; }).catch(() => { /* */ });
    // the Graphics tier changed: the ground rebakes at its new resolution, the lamp drops or keeps its reflection
    this.offTable = onGfxChange(() => { this.lamp = null; });
    // sprites painted in idle time (stars, planets) are drawn in the per-frame pass, which picks them up on the next
    // frame: the cached layer holds no such art, so a bake landing must not force a rebuild (it did, every frame,
    // while zooming)
    this.bindTip();
  }

  private offTable: () => void;
  /** Stop listening to the Graphics setting. */
  dispose() { this.offTable(); }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const ui = uiScale();
    const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
    if (W === this.canvas.width && H === this.canvas.height && dpr === this.dpr && r.width === this.w && r.height === this.h && ui === this.ui) return;
    this.dpr = dpr;
    this.ui = ui;
    this.w = r.width; this.h = r.height;
    this.canvas.width = W;
    this.canvas.height = H;
    this.lamp = null;
  }

  // ---------------------------------------------------------------- camera flights
  /** Glide the camera to p (and optionally zoom z). User input (drag/pinch/wheel) cancels the flight. */
  flyTo(p: Pt, z?: number, dur = 650) {
    const zz = z !== undefined && Number.isFinite(z) && z > 0 ? z : this.cam.z;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    const to = { x: p.x, y: p.y, z: zz };
    this.zoomAnim = null;
    if (reducedMotion() || dur <= 0) { this.cam = { ...to }; this.camAnim = null; return; }
    this.camAnim = { from: { ...this.cam }, to, t0: performance.now(), dur, set: { ...this.cam } };
  }
  get flying() { return !!this.camAnim || !!this.zoomAnim; }
  /** Eased zoom by `factor` about screen point (sx, sy) (wheel notches, double-click, zoom buttons): the world point
   *  under (sx, sy) stays put while the zoom glides over `dur` ms; consecutive calls retarget the same glide, so a
   *  fast wheel spin is one smooth motion. Reduced motion: instant. Pinch should keep setting cam.z directly. */
  zoomAt(sx: number, sy: number, factor: number, dur = 240) {
    if (!(factor > 0) || !Number.isFinite(factor)) return;
    const Z = this.zoomAnim;
    const base = Z ? Z.to : this.cam.z;
    const to = Math.max(0.12, Math.min(3, base * factor));
    const w = this.toWorld(sx, sy);
    this.camAnim = null;
    if (reducedMotion() || dur <= 0) {
      this.cam.z = to;
      const a = this.toWorld(sx, sy);
      this.cam.x += w.x - a.x; this.cam.y += w.y - a.y;
      this.zoomAnim = null;
      return;
    }
    this.zoomAnim = { sx, sy, wx: w.x, wy: w.y, from: this.cam.z, to, p: 0, last: performance.now(), dur, set: { ...this.cam } };
  }
  private zoomAnim: { sx: number; sy: number; wx: number; wy: number; from: number; to: number; p: number; last: number; dur: number; set: Cam } | null = null;
  /** Is world point p inside the viewport, with a margin in screen px? */
  onScreen(p: Pt, margin = 40) {
    const s = this.toScreen(p);
    return s.x >= margin && s.y >= margin && s.x <= this.w - margin && s.y <= this.h - margin;
  }
  private stepCam(now: number) {
    const Zm = this.zoomAnim;
    if (Zm) {
      if (Math.abs(this.cam.x - Zm.set.x) > 1e-6 || Math.abs(this.cam.y - Zm.set.y) > 1e-6 || Math.abs(this.cam.z - Zm.set.z) > 1e-9) this.zoomAnim = null;
      else {
        // progress by frame time, capped per frame: a slow frame stretches the glide instead of skipping it
        const nowT = performance.now();
        Zm.p += Math.min(34, nowT - Zm.last) / Zm.dur; Zm.last = nowT;
        const t = clamp01(Zm.p);
        const e = easeOutCubic(t);
        const z = Math.exp(Math.log(Zm.from) + (Math.log(Zm.to) - Math.log(Zm.from)) * e);
        this.cam = { x: Zm.wx - (Zm.sx - this.w / 2) / z, y: Zm.wy - (Zm.sy - this.h / 2) / z, z };
        Zm.set = { ...this.cam };
        if (t >= 1) this.zoomAnim = null;
      }
    }
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
      const d = Math.hypot(s.x - sx, s.y - sy) / this.ui;
      if (d < this.hitR() && d < bd) { bd = d; best = f; }
    }
    return best;
  }

  /** The token under screen point (sx, sy): a group token (owner+region) or, when fanned out, a single fleet. */
  tokenAt(sx: number, sy: number): TokenHit | null {
    let best: TokHit | null = null, bd = Infinity;
    for (const h of this.tokHits) {
      const c = this.toScreen(h);
      const dx = (sx - c.x) / this.ui, dy = (sy - c.y) / this.ui;
      const inBox = dx >= h.l && dx <= h.r && dy >= h.t && dy <= h.b;
      const d = Math.hypot(dx, dy);
      if (!inBox && d > h.cr) continue;
      const score = inBox ? Math.min(d, 8) : d;
      if (score < bd) { bd = score; best = h; }
    }
    if (!best) return null;
    // zoomed out, a parked piece sits ~20 px from its star and its hit circle covers the star itself: a press on the
    // star's own centre is meant for the star (tapping your capital picked the fleet beside it on phones)
    const r = this.lastState?.regions[best.hit.region];
    if (r && !isLane(r)) {
      const s = this.toScreen(r.site), c = this.toScreen(best);
      const dStar = Math.hypot(sx - s.x, sy - s.y), dTok = Math.hypot(sx - c.x, sy - c.y);
      if (dStar < dTok && dStar <= 10 * this.ui) return null;
    }
    return { ...best.hit, fleetIds: best.hit.fleetIds.slice() };
  }

  /** The region whose banner (garrison cap / name plate / strategic plate) is under screen point (sx, sy). */
  bannerAt(sx: number, sy: number): number | null {
    const pad = this.coarse ? 6 : 3;
    for (let i = this.bannerHits.length - 1; i >= 0; i--) {
      const b = this.bannerHits[i];
      const c = this.toScreen(b);
      const dx = (sx - c.x) / this.ui, dy = (sy - c.y) / this.ui;
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
    return this.toScreen(anchorOf(r, owner, this.px(1), this.zr));
  }

  /** Phone-sized viewport: smaller labels, bigger touch targets. */
  get compact() { return this.w > 0 && this.w <= 700; }
  private get coarse() { return coarsePointer() || this.compact; }
  private hitR() { return this.coarse ? 26 : 22; }

  /** Screen-constant size in world units: n design px (n * ui CSS px). */
  px(n: number) { return n * this.ui / this.cam.z; }
  /** Backing-store px per design px: the resolution for sprites sized in design px. */
  private get rdpr() { return this.dpr * this.ui; }
  /** Zoom in design px per world unit (tiers and slot scales are tuned in design px). */
  private get zd() { return this.cam.z / this.ui; }

  private lastState: GameState | null = null;
  private computeTier(prev: Tier | null): Tier {
    const st = this.lastState;
    if (!st) return 'operational';
    return tierFor(medianRegionRadius(st) * this.zd, prev, this.coarse);
  }
  /** On-screen median region radius (design px): the one number every zoom-dependent size and fade is a function of. */
  private get zr() { return this.lastState ? medianRegionRadius(this.lastState) * this.zd : 112; }
  /** This frame's tier weights (strategic / operational / detail representations fade over a zoom range). */
  private zw: ZoomW = { s: 0, o: 1, d: 0 };
  /** How much the system art (planets, structures, minis) grows when zoomed in (1 up to operational). */
  private artK() { return artGrow(this.zr); }

  private lastCam: Cam | null = null;
  private camMovedAt = 0;
  private drawnOnce = false;
  private ids = new WeakMap<object, number>();
  private nextObjId = 1;
  private objId(o: object): number { let v = this.ids.get(o); if (v === undefined) { v = this.nextObjId++; this.ids.set(o, v); } return v; }
  /** Rebake the ground (progressively: the old bake stands in until the new one is ready) and re-measure names. */
  invalidate() { this.dial.invalidate(); this.nameWidth.clear(); this.nameMemo.key = ''; }
  /** what the ground holds (tests and the perf harness) */
  get dialStats() { return { tiles: this.dial.tileCount, missing: this.dial.missing, bakeMs: this.dial.bakeMs, baked: this.dial.baked }; }

  private fogMemo: { vis: Set<number> | null; size: number; you: number | null; st: GameState | null; owners: string; set: Set<number>; key: string } = { vis: null, size: -1, you: null, st: null, owners: '', set: new Set(), key: '' };
  /** What the ground shows: owners, fog, lens, supply. Its key changes whenever the bake must. */
  private dialContent(I: DrawInput): DialContent {
    const st = I.state, lens = I.lens ?? 'political';
    const ow = I.owners.join(',');
    const F = this.fogMemo;
    if (F.vis !== I.visible || F.size !== I.visible.size || F.you !== I.you || F.st !== st || F.owners !== ow) {
      const set = new Set<number>();
      if (I.you !== null) for (const r of st.regions) if (!isLane(r) && r.poly.length > 2 && !I.visible.has(r.id) && I.owners[r.id] !== I.you) set.add(r.id);
      Object.assign(F, { vis: I.visible, size: I.visible.size, you: I.you, st, owners: ow, set, key: [...set].join(',') });
    }
    const cut = this.cutOffOf(I);
    const { sup } = this.supplySets(I);
    let unsup: Set<number> | null = null;
    if (lens === 'supply' && sup) { unsup = new Set(st.regions.filter(r => r.kind !== 'void' && !isLane(r) && !sup.has(r.id)).map(r => r.id)); }
    const key = [this.bare ?? '', this.objId(st.regions), ow, F.key, lens, cut ? [...cut].join('.') : '', unsup ? [...unsup].join('.') : '', st.players.map(p => p.color).join(','), I.you].join('|');
    return { st, owners: I.owners, fogged: F.set, lens, cutOff: cut, unsup, key, bare: this.bare };
  }

  // ---- readability probes (scripts/orrery-contrast.mjs): every indicator drawn leaves a box, in css px
  /** non-null while a measurement frame is drawn */
  private probes: { kind: string; x: number; y: number; w: number; h: number; bg?: number }[] | null = null;
  /** draw only the ground (dial, territories, resting lanes, the lamp): the measurement's background frame */
  private groundOnly = false;
  private bare: 0 | 1 | undefined = undefined;
  private syncBake = false;
  /** the empire lettering drawn this frame (screen boxes): lines under it are not measured there */
  private letterBoxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
  private lastInput: DrawInput | null = null;
  /** A probe on a world point (w, h in design px). */
  private probe(kind: string, wx: number, wy: number, w: number, h: number, bg = 1) {
    if (!this.probes) return;
    const p = this.toScreen({ x: wx, y: wy });
    this.probeS(kind, p.x, p.y, w * this.ui, h * this.ui, bg);
  }
  /** A probe at a screen point (css px). */
  private probeS(kind: string, x: number, y: number, w: number, h: number, bg = 1) {
    if (!this.probes) return;
    const p = { x, y }, k = 1;
    if (p.x - w * k / 2 < 2 || p.y - h * k / 2 < 2 || p.x + w * k / 2 > this.w - 2 || p.y + h * k / 2 > this.h - 2) return;
    // only where the map itself shows (not under the HUD)
    const cr = this.canvas.getBoundingClientRect(), pad = Math.max(w, h) * k * 0.5 + 6;
    for (const [dx, dy] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) if (document.elementFromPoint(p.x + dx * pad + cr.left, p.y + dy * pad + cr.top) !== this.canvas) return;
    this.probes.push({ kind, x: p.x, y: p.y, w: w * k, h: h * k, bg });
  }
  /** Draw the last frame twice (every mark, then the ground alone) and measure each indicator's contrast against the
   *  ground round it (the method of docs/STYLE-EXPLORE.md §2: the light tone against the ground's bright side, or the
   *  dark tone against its dark side, or a two-tone keyline against both). */
  measureContrast(): { kind: string; x: number; y: number; contrast: number; n: number }[] {
    const I = this.lastInput;
    if (!I) return [];
    const g = this.ctx, W = this.canvas.width, H = this.canvas.height;
    this.syncBake = true;
    this.probes = []; this.letterBoxes = [];
    this.lastNow = I.now; this.draw(I);
    const C = g.getImageData(0, 0, W, H).data;
    // a line under a piece, a star or a name is not that line's reading: those probes are dropped
    const occ = [...this.tokHits, ...this.bannerHits].map(h => { const c = this.toScreen(h); return { x0: c.x + h.l * this.ui, y0: c.y + h.t * this.ui, x1: c.x + h.r * this.ui, y1: c.y + h.b * this.ui }; });
    occ.push(...this.letterBoxes);
    const linear = (k: string) => k.startsWith('lane') || k.startsWith('route') || k === 'territory border';
    const trS = tokR(this.zr, this.coarse) * this.ui * 1.25;
    const toks = this.tokHits.map(h => { const c = this.toScreen(h); return { x0: c.x - trS, y0: c.y - trS, x1: c.x + trS, y1: c.y + trS }; });
    const over = (p: { x: number; y: number; w: number; h: number }, os: typeof occ) => os.some(o => p.x + p.w / 2 > o.x0 && p.x - p.w / 2 < o.x1 && p.y + p.h / 2 > o.y0 && p.y - p.h / 2 < o.y1);
    const probes = this.probes.filter(p => !((p.kind === 'contested' || p.kind.startsWith('star')) && over(p, toks)) && !(linear(p.kind) && over(p, occ)));
    this.probes = null;
    // the backgrounds (docs/STYLE-EXPLORE.md §2): the dial with its territories and walls (for every mark), and the
    // dial alone (for the walls themselves)
    this.groundOnly = true;
    this.bare = 1; this.lastNow = I.now; this.draw(I);
    const bg = g.getImageData(0, 0, W, H).data;
    this.bare = 0; this.lastNow = I.now; this.draw(I); this.bare = undefined;
    const bare = g.getImageData(0, 0, W, H).data;
    this.groundOnly = false;
    this.lastNow = I.now; this.draw(I);
    this.syncBake = false;
    const lin = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const lum = (D: Uint8ClampedArray, i: number) => 0.2126 * lin(D[i]) + 0.7152 * lin(D[i + 1]) + 0.0722 * lin(D[i + 2]);
    const pct = (a: number[], q: number) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))]; };
    const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const dpr = this.dpr, out: { kind: string; x: number; y: number; contrast: number; n: number }[] = [];
    for (const p of probes) {
      const bgd = p.bg === 0 ? bare : bg;
      const x0 = Math.round((p.x - p.w / 2) * dpr), y0 = Math.round((p.y - p.h / 2) * dpr), x1 = Math.round((p.x + p.w / 2) * dpr), y1 = Math.round((p.y + p.h / 2) * dpr);
      const pad = Math.round(Math.max(4, Math.min(p.w, p.h) * 0.35) * dpr), step = dpr >= 2 ? 2 : 1;
      const mk: number[] = [], ring: number[] = [];
      for (let y = Math.max(0, y0 - pad); y < Math.min(H, y1 + pad); y += step) for (let x = Math.max(0, x0 - pad); x < Math.min(W, x1 + pad); x += step) {
        const i = (y * W + x) * 4;
        if (x >= x0 && x < x1 && y >= y0 && y < y1) { if (Math.abs(C[i] - bgd[i]) + Math.abs(C[i + 1] - bgd[i + 1]) + Math.abs(C[i + 2] - bgd[i + 2]) > 36) mk.push(lum(C, i)); }
        else ring.push(lum(bgd, i));
      }
      if (mk.length < 4 || !ring.length) { out.push({ kind: p.kind, x: Math.round(p.x), y: Math.round(p.y), contrast: 0, n: mk.length }); continue; }
      const light = pct(mk, 0.95), dark = pct(mk, 0.05), hi = pct(ring, 0.85), lo = pct(ring, 0.15);
      const c1 = light > hi ? ratio(light, hi) : 1, c2 = dark < lo ? ratio(dark, lo) : 1;
      const c3 = light > lo && dark < hi ? Math.min(ratio(light, lo), ratio(dark, hi)) : 1;
      out.push({ kind: p.kind, x: Math.round(p.x), y: Math.round(p.y), contrast: +Math.max(c1, c2, c3).toFixed(2), n: mk.length, tones: [light, dark, hi, lo].map(v => +v.toFixed(3)) } as { kind: string; x: number; y: number; contrast: number; n: number });
    }
    return out;
  }

  draw(I: DrawInput) {
    this.lastInput = I;
    const st = I.state;
    if (this.seed !== st.seed) this.prepare(st);
    this.lastState = st;
    const W = this.canvas.width, H = this.canvas.height;
    if (!W || !H) return;
    // the battle viewer covers the whole screen: keep the last frame instead of animating the map underneath it
    if (battleViewerOpen() && this.drawnOnce) return;
    const t0 = performance.now();
    const now = I.now;
    this.dt = this.lastNow ? Math.min(100, Math.max(0, now - this.lastNow)) : 16;
    this.lastNow = now; this.now = now;
    this.frameNo++;
    this.stepCam(now);
    const prevTier = this._tier;
    this._tier = this.computeTier(prevTier);
    this.zw = zoomW(this.zr, this.coarse);
    setViewer(I.you);
    this.trackOwners(I);
    this.rememberGarrisons(I);
    const cam = this.cam;
    if (!this.lastCam || cam.x !== this.lastCam.x || cam.y !== this.lastCam.y || cam.z !== this.lastCam.z) { this.camMovedAt = now; this.lastCam = { ...cam }; }
    const q = gfxQuality();
    figurineFrame(this.frameNo, q === 'high' ? 6 : 3);
    const { ctx } = this;
    // ---- the ground: the room's velvet, then the dial's baked tiles, then the lamp over them (under every mark)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#060608'; ctx.fillRect(0, 0, W, H);
    this.dial.draw(ctx, this.dialContent(I), { cx: cam.x, cy: cam.y, z: cam.z, w: this.w, h: this.h, dpr: this.dpr, ui: this.ui, coarse: this.coarse, now, reduced: reducedMotion(), sync: this.syncBake }, q,
      // a still camera has the frame to spare: bake ahead (the ring just off screen) faster than while moving
      now - this.camMovedAt > 150 && !this.camAnim && !this.zoomAnim ? (this.coarse ? 9 : 12) : (this.coarse ? 4 : 5));
    this.drawLamp(q);
    this.drawnOnce = true;
    if (this.groundOnly) return;
    if (this.probes) this.probeGround(I);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.save();
    ctx.translate(this.w / 2, this.h / 2);
    ctx.scale(this.cam.z, this.cam.z);
    ctx.translate(-this.cam.x, -this.cam.y);
    this.drawOwnerFx(I);
    this.drawHover(I);
    this.drawTargeting(I);
    if (I.unsupplied?.size) {
      for (const rid of I.unsupplied) { const r = st.regions[rid]; if (!r || r.kind === 'void') continue; path(ctx, r.poly); ctx.fillStyle = 'rgba(0,0,0,0.14)'; ctx.fill(); }
    }
    this.drawRegionSelection(I);
    this.drawLensMarks(I);
    this.hovStar = this.hoverStar(I);
    this.drawLaneFocus(I);
    // the board: empire names, stars, names in space (culled with a wide margin: nothing pops)
    { const a = this.toWorld(-200, -200), b = this.toWorld(this.w + 200, this.h + 200); this.view = { x0: a.x, y0: a.y, x1: b.x, y1: b.y }; }
    this.reticleLast = this.reticleNow; this.reticleNow = new Set();
    this.drawEmpireNames(I);
    this.drawStars(I);
    this.drawNames(I);
    this.drawDynamic(I);
    ctx.restore();
    this.updateTip(I);
    // the Auto governor sees the frame's own cost (the ground's bakes are budgeted separately)
    gfxFrame(performance.now() - t0 - this.dial.bakeMs);
  }

  /** Probes on what the ground carries: each house's wall (its longest outer edge) and the resting lanes. */
  private probeGround(I: DrawInput) {
    const st = I.state, edges = regionEdges(st);
    // walls right by the bezel read against the bezel's gold, not the dial: probe the inland walls
    const rim: Pt[] = [];
    for (const r of st.regions) if (!isLane(r) && r.poly.length > 2) for (const e of edges[r.id]) if (e.other < 0) rim.push({ x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 });
    const nearRim = (m: Pt) => rim.some(q => Math.hypot(q.x - m.x, q.y - m.y) * this.cam.z < 30 * this.ui);
    for (const pl of st.players) {
      let best = 0, mid: Pt | null = null;
      for (const r of st.regions) {
        if (I.owners[r.id] !== pl.id || isLane(r) || r.poly.length < 3) continue;
        for (const e of edges[r.id]) {
          // a wall between two lands or against unclaimed space (the board's rim is the bezel's, not a wall)
          if (e.other < 0 || I.owners[e.other] === pl.id || isLane(st.regions[e.other])) continue;
          const L = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y), m = { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 };
          const s = this.toScreen(m);
          if (L > best && !nearRim(m) && s.x > 20 && s.y > 60 && s.x < this.w - 20 && s.y < this.h - 120) { best = L; mid = m; }
        }
      }
      if (mid) this.probe('territory border', mid.x, mid.y, 8, 8, 0);
    }
    for (const L of hyperlanes(st)) {
      const a = L.pts[0], b = L.pts[L.pts.length - 1];
      this.probe('lane (rest)', a.x * 0.6 + b.x * 0.4, a.y * 0.6 + b.y * 0.4, 6, 6);
    }
  }

  /** The lamp over the ground (screen space, under the marks): on High the glaze catches one broad soft reflection;
   *  always, the room falls off toward the edges. Baked at half size per viewport and tier. */
  private drawLamp(q: 'high' | 'low') {
    const key = `${this.w}x${this.h}|${q}`;
    if (!this.lamp || this.lamp.key !== key) {
      const w = this.w, h = this.h;
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.ceil(w / 2)); c.height = Math.max(1, Math.ceil(h / 2));
      const g = c.getContext('2d')!;
      g.scale(0.5, 0.5);
      const R = Math.hypot(w, h);
      if (q === 'high') {
        const sh = g.createLinearGradient(w * 0.15, 0, w * 0.55, h * 0.6);
        sh.addColorStop(0, 'rgba(255,240,210,0)'); sh.addColorStop(0.5, 'rgba(255,240,210,0.035)'); sh.addColorStop(1, 'rgba(255,240,210,0)');
        g.fillStyle = sh; g.fillRect(0, 0, w, h);
      }
      const gr = g.createRadialGradient(w * 0.42, h * 0.32, R * 0.05, w * 0.42, h * 0.32, R * 0.8);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.55, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.42)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      this.lamp = { c, key };
    }
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.drawImage(this.lamp.c, 0, 0, this.w, this.h);
  }

  /** An owner's colour on the board: the house enamel's lit tone (`hi`), whatever the state carries (old saves and
   *  servers still hold the retired neons). Ships, bases and counters take the enamel `base` from it themselves. */
  private colorOf(st: GameState, o: number | null | undefined) { return enamelOf(o === null || o === undefined || o < 0 ? (o === -1 ? WARDEN : NEUTRAL_COLOR) : st.players[o]?.color ?? NEUTRAL_COLOR).hi; }
  private regionColor(st: GameState, o: number | null | undefined) { return enamelOf(o === null || o === undefined || o < 0 ? NEUTRAL_COLOR : st.players[o]?.color ?? NEUTRAL_COLOR).hi; }

  /** Remember garrisons while visible, so fogged banners can say "~N". */
  private rememberGarrisons(I: DrawInput) {
    let lk = this.lastKnownBy.get(I.you);
    if (!lk) { lk = new Map(); this.lastKnownBy.set(I.you, lk); }
    if (lk !== this.lastKnown) { this.lastKnown = lk; this.lkVer++; }
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

  // ================================================================ lens marks over the ground
  /** What the lenses (and Space-peek) add over the baked ground: your supply network, warp-gate links (detail or the
   *  supply lens) and, on the economy lens, veins and traits beside each world. Gilt and enamel, flat. */
  private drawLensMarks(I: DrawInput) {
    const { ctx } = this;
    const st = I.state;
    const lens = I.lens ?? 'political';
    const S = this.px(1);
    const W = this.zw;
    const { conn } = this.supplySets(I);
    if ((lens === 'supply' || I.peek) && conn && I.you !== null) {
      const c = O.hiOf(this.regionColor(st, I.you));
      ctx.save();
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (const rid of conn) {
        const r = st.regions[rid];
        if (!r || isLane(r)) continue;
        for (const n of r.neighbors) if (n > rid && conn.has(n)) { ctx.moveTo(r.site.x, r.site.y); ctx.lineTo(st.regions[n].site.x, st.regions[n].site.y); }
      }
      ctx.setLineDash([2 * S, 6 * S]);
      ctx.strokeStyle = O.GROOVE; ctx.lineWidth = ((lens === 'supply' ? 3 : 2) + 2.4) * S; ctx.stroke();
      ctx.strokeStyle = hexA(c, lens === 'supply' ? 0.95 : 0.7); ctx.lineWidth = (lens === 'supply' ? 3 : 2) * S; ctx.stroke();
      ctx.restore();
    }
    if (W.d > 0.5 || lens === 'supply') {
      const gates = new Map<number, Region[]>();
      for (const r of st.regions) if (r.buildings.gate && r.owner !== null && I.owners[r.id] === r.owner) { const a = gates.get(r.owner) ?? []; a.push(r); gates.set(r.owner, a); }
      ctx.save();
      ctx.setLineDash([2 * S, 6 * S]); ctx.lineCap = 'round';
      for (const [o, gs] of gates) {
        ctx.strokeStyle = hexA(O.hiOf(this.regionColor(st, o)), o === I.you ? 0.75 : 0.45); ctx.lineWidth = (o === I.you ? 2 : 1.4) * S;
        for (let i = 0; i < gs.length; i++) for (let j = i + 1; j < gs.length; j++) { ctx.beginPath(); ctx.moveTo(gs[i].site.x, gs[i].site.y); ctx.lineTo(gs[j].site.x, gs[j].site.y); ctx.stroke(); }
      }
      ctx.restore();
    }
    if (lens === 'economy') for (const r of st.regions) if (!isLane(r)) this.drawEconomyIcons(r, I);
  }

  /** Kept for callers: banners no longer change with selection (the art never jumps in size). */
  private bannerTier(_r: Region, _I: DrawInput): Tier { return this.tier; }

  /** A system's star radius (design px) at the current zoom: continuous, so nothing jumps between tiers. */
  private siteR(r: Region, _bt?: Tier): number { return starPx(r, this.zr); }
  /** A star you can't currently see (fog of war): drawn desaturated and dim. */
  private starFogged(r: Region, I: DrawInput): boolean {
    return I.you !== null && !I.visible.has(r.id) && I.owners[r.id] !== I.you;
  }

  private garrisonText(r: Region, I: DrawInput): { txt: string; fog: boolean; known: boolean } {
    const fog = I.you !== null && !I.visible.has(r.id) && r.owner !== I.you;
    if (r.garrison >= 0 && !fog) return { txt: String(r.garrison), fog, known: true };
    // fogged: a neutral garrison you have a number for shows it plainly (it barely changes); a rival's is a stale
    // estimate ("~N"); never seen at all is "?"
    const lk = this.lastKnown.get(r.id);
    const known = r.garrison >= 0 ? r.garrison : lk;
    if (known === undefined) return { txt: '?', fog, known: false };
    const neutral = (I.owners[r.id] ?? null) === null || (I.owners[r.id] ?? -1) < 0;
    return { txt: neutral ? String(known) : `~${known}`, fog, known: true };
  }

  private sieged(r: Region, st: GameState): Engagement | true | null {
    const e = (st.engagements ?? []).find(x => x.region === r.id);
    if (e) return e;
    return st.fleets.some(f => f.siege === r.id && f.region === r.id && f.ships.length) ? true : null;
  }

  // ================================================================ the board: stars, objectives, names in space
  /** Every system as its gem in a gold collet (the stone tells the kind), objectives in their gold settings, a
   *  contested system's ring, occupied and tribute marks, and at detail zoom its orbits (bodies as small cabochons on
   *  engraved gold tracks) and orbital structures. Drawn every frame, so sizes follow the zoom continuously. No glow,
   *  bloom or corona: the stones are lit by the lamp like everything else. */
  private drawStars(I: DrawInput) {
    const { ctx } = this;
    const st = I.state;
    const S = this.px(1);
    const W = this.zw;
    const v = this.view;
    const t = reducedMotion() ? 0 : I.now / 1000;
    const cOn = contestOn(st);
    this.bannerHits = [];
    for (const r of st.regions) {
      if (isLane(r)) continue;
      const p = r.site;
      const R = this.siteR(r);
      const m = (R * 4 + 60) * S;
      if (p.x + m < v.x0 || p.x - m > v.x1 || p.y + m < v.y0 || p.y - m > v.y1) continue;
      const hr = Math.max(R + 5, this.coarse ? 16 : 12);
      this.bannerHits.push({ rid: r.id, x: p.x, y: p.y, l: -hr, t: -hr, r: hr, b: hr });
      if (r.kind === 'void') { ctx.fillStyle = 'rgba(150,140,120,0.5)'; ctx.beginPath(); ctx.arc(p.x, p.y, 2 * S, 0, TAU); ctx.fill(); continue; }
      const fog = this.starFogged(r, I);
      const kind = starKindOf(r);
      const pr = R * S;
      // ---- detail: the system as an orrery (tracks, arms and its bodies as small cabochons), under the gem
      if (W.d > 0.02) { ctx.save(); ctx.globalAlpha = W.d; this.drawBodies(r, p, pr, S, t, fog); ctx.restore(); }
      // a blockaded world's stone clouds over to match its blockaded output (DELIGHT #34)
      const dim = !fog ? this.blockadeDim(st, r) : 1;
      const holder = r.kind === 'throne' && r.owner !== null && r.owner >= 0 ? this.colorOf(st, r.owner) : null;
      O.gem(ctx, kind, p.x, p.y, pr, S, { fog, dim: dim < 1 ? Math.min(1, (1 - dim) * 1.3) : 0, t, holder });
      if (this.probes) this.probe(fog ? 'star (fogged)' : `star: ${kind}`, p.x, p.y, R * 2, R * 2);
      // tenure (DELIGHT #26): a thin ring of the holder's enamel round the collet for each tier held (3, 6, 10 turns)
      const ten = !fog && r.owner !== null && r.owner >= 0 && r.story ? tenureTier(st, r) : 0;
      if (ten && r.kind !== 'throne') O.tenure(ctx, p.x, p.y, this.colletR(kind, pr, S), ten, this.colorOf(st, r.owner), S);
      // objectives: a Crown in a gold ring with pearl milgrain and a crown on top, the Throne in its grand bezel
      if (r.kind === 'crown' || r.kind === 'throne') {
        O.objective(ctx, p.x, p.y, pr, S, r.kind === 'throne', fog, holder, t);
        if (this.probes) { const rr = O.objR(R, r.kind === 'throne', 1); this.probe(r.kind === 'throne' ? 'throne ring' : 'crown ring', p.x + rr * 0.71 * S, p.y + rr * 0.71 * S, 5, 5); }
        if (ten && r.kind === 'throne') O.tenure(ctx, p.x, p.y, O.objR(pr, true, S) + 8 * S, ten, this.colorOf(st, r.owner), S);
      }
      if (r.kind === 'relic' && r.relic && W.d > 0.02) {
        // an unexcavated relic: a glinting monolith drifting by the star (detail only)
        const mx = p.x + pr * 1.1, my = p.y + pr * 0.5;
        ctx.save(); ctx.globalAlpha = W.d; ctx.translate(mx, my); ctx.rotate(0.35);
        const mg = ctx.createLinearGradient(-3 * S, 0, 3 * S, 0); mg.addColorStop(0, '#f4f7ff'); mg.addColorStop(0.5, '#7d86a8'); mg.addColorStop(1, '#1a1c28');
        ctx.fillStyle = O.GROOVE; ctx.fillRect(-3.4 * S, -6.9 * S, 6.8 * S, 13.8 * S);
        ctx.fillStyle = mg; ctx.fillRect(-2.5 * S, -6 * S, 5 * S, 12 * S);
        ctx.restore();
      }
      // contested, occupied, tribute (operational and closer: no marks at the strategic tier)
      if (W.s < 0.98 && cOn && r.owner !== null && r.bodies) {
        let cs: ReturnType<typeof systemStatus> | null = null;
        try { cs = systemStatus(st, r); } catch { cs = null; }
        if (cs) {
          ctx.save(); ctx.globalAlpha = 1 - W.s;
          const full = W.s < 0.1;
          const kingly = r.kind === 'crown' || r.kind === 'throne';
          if (cs.contested) { O.contested(ctx, p.x, p.y, O.contestR(pr, kingly, S), cs.holder === null ? null : this.colorOf(st, cs.holder), S); const rc = O.contestR(R, kingly, 1); if (full) this.probe('contested', p.x - rc * 0.906 * S, p.y + rc * 0.423 * S, 6, 6); }
          if (cs.occupiedLeft > 0 && r.owner !== null && r.owner >= 0) { O.occupied(ctx, p.x, p.y, pr, this.colorOf(st, r.owner), S); if (full) this.probe('occupied', p.x + R * 1.25 * S, p.y + R * 0.95 * S, O.markSz(R, 1) * 0.8, O.markSz(R, 1) * 0.8); }
          if (cs.tribute) { O.tribute(ctx, p.x, p.y, pr, this.colorOf(st, cs.tribute.to), S); if (full) this.probe('tribute', p.x - R * 1.25 * S, p.y + R * 0.95 * S, O.markSz(R, 1) * 0.8, O.markSz(R, 1) * 0.8); }
          ctx.restore();
        }
      }
      // ---- detail: the system's orbital pieces as little modelled structures, the planetary shield as a dome
      if (W.d > 0.02 && !fog) {
        const b = r.buildings;
        const list: Structure[] = [];
        if (b.shipyard) list.push('shipyard');
        if (b.fortress) list.push('fortress');
        for (let i = 0; i < Math.min(3, b.battery ?? 0); i++) list.push('battery');
        if (b.gate) list.push('gate');
        if (b.depot) list.push('depot');
        if (b.sensor) list.push('sensor');
        const angs = [0.32, 2.82, 0.85, 2.3, 1.2, 1.95, 0.0];
        const team = this.regionColor(st, I.owners[r.id]);
        ctx.save(); ctx.globalAlpha = W.d;
        list.slice(0, angs.length).forEach((k, i) => {
          const a = angs[i];
          const RR = pr * (1.55 + (i % 2) * 0.12) + 6 * S;
          const sx = p.x + Math.cos(a) * RR, sy = p.y + Math.sin(a) * RR * 0.85;
          const sz = (k === 'gate' ? 7 : k === 'shipyard' ? 7 : 5.5) * S * Math.sqrt(this.artK());
          drawBodyShadow(ctx, sx + sz * 0.4, sy + sz * 0.8, sz * 1.1, 0.4);
          drawStructure(ctx, k, team, sx, sy, sz, (sz / S) * this.rdpr);
        });
        if (b.pshield) shieldDome(ctx, p.x, p.y, pr * 1.28, 1.2 * S);
        ctx.restore();
      }
    }
  }
  /** The outer radius of a star's collet (ctx units), where tenure rings start. */
  private colletR(kind: string, pr: number, S: number) {
    const k = kind === 'red' ? 0.74 : kind === 'blue' ? 0.52 : kind === 'white' ? 0.56 : kind === 'pulsar' ? 0.5 : kind === 'blackhole' ? 0.48 : kind === 'binary' ? 0.62 : 0.62;
    return Math.max(2.4 * S, pr * k) * 1.18 + 2.4 * S;
  }
  /** The orrery up close: each body on an engraved gold track, an arm from the hub, the body a small cabochon (a belt
   *  as gold granules, a station a gold lozenge); they turn slowly (frozen with reduced motion). */
  private drawBodies(r: Region, p: Pt, pr: number, S: number, t: number, fog: boolean) {
    const { ctx } = this;
    const list: { kind: string; q?: string; adj?: string; name?: string }[] = (r.bodies ?? []).slice(0, 3);
    if ((r.buildings.station ?? 0) > 0) list.push({ kind: 'station' });
    const seed = r.id * 37 + 11;
    list.slice(0, 4).forEach((b, i) => {
      const rx = pr * (1.85 + i * 0.62), ry = rx * 0.42;
      const a = ((seed * 0.6180339 + i * 0.37) % 1) * TAU + t * (0.05 / (1 + i));
      ctx.beginPath(); ctx.ellipse(p.x, p.y, rx, ry, 0, 0, TAU);
      ctx.lineWidth = 2.6 * S; ctx.strokeStyle = 'rgba(2,2,4,0.6)'; ctx.stroke();
      ctx.lineWidth = 1 * S; ctx.strokeStyle = fog ? 'rgba(190,190,198,0.5)' : 'rgba(220,180,100,0.55)'; ctx.stroke();
      if (b.kind === 'belt') {
        let q = (seed * 7 + i) >>> 0; const rnd = () => ((q = (Math.imul(q, 1664525) + 1013904223) >>> 0) / 4294967296);
        ctx.fillStyle = fog ? '#9a9aa2' : '#c9a45a';
        ctx.beginPath();
        for (let k = 0; k < 44; k++) { const aa = rnd() * TAU, j = 1 + (rnd() - 0.5) * 0.1, rr = (0.9 + rnd() * 0.8) * S; const bx = p.x + Math.cos(aa) * rx * j, by = p.y + Math.sin(aa) * ry * j; ctx.moveTo(bx + rr, by); ctx.arc(bx, by, rr, 0, TAU); }
        ctx.fill();
        return;
      }
      const px = p.x + Math.cos(a) * rx, py = p.y + Math.sin(a) * ry;
      const br = Math.max(2.5 * S, pr * (b.kind === 'gas' ? 0.4 : b.kind === 'station' ? 0.24 : b.kind === 'moon' ? 0.22 : 0.28));
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(px, py); ctx.lineWidth = 1 * S; ctx.strokeStyle = fog ? 'rgba(190,190,198,0.35)' : 'rgba(220,180,100,0.35)'; ctx.stroke();
      if (b.kind === 'station' || b.kind === 'ruin') {
        ctx.save(); ctx.translate(px, py); ctx.rotate(0.785);
        ctx.fillStyle = O.GROOVE; ctx.fillRect(-br - 1.2 * S, -br - 1.2 * S, (br + 1.2 * S) * 2, (br + 1.2 * S) * 2);
        ctx.fillStyle = O.goldBox(ctx, 0, 0, br, fog); ctx.fillRect(-br, -br, br * 2, br * 2);
        ctx.restore();
        return;
      }
      const wt = bodyWorldType(b, r.kind, r.name) ?? 'barren';
      O.cabochon(ctx, px, py, br, fog ? O.STONE.pewter : BODY_STONE[wt] ?? O.STONE.rock, S, fog, true);
    });
  }

  /** Blockaded worlds (memoized per state): the light factor is the rules' blockaded industry share, never below 0.35. */
  private blockMemo: { st: GameState | null; m: Map<number, number> } = { st: null, m: new Map() };
  private blockadeDim(st: GameState, r: Region): number {
    const B = this.blockMemo;
    if (B.st !== st) {
      B.st = st; B.m = new Map();
      if (contestOn(st)) {
        const k = Math.max(0.35, Math.min(1, (st.rules as unknown as { systems?: { blockadeIndustry?: number } }).systems?.blockadeIndustry ?? 0.5));
        for (const x of st.regions) if (x.owner !== null && x.owner >= 0 && x.bodies) { try { if (systemStatus(st, x).blockaded) B.m.set(x.id, k); } catch { /* an old save */ } }
      }
    }
    return B.m.get(r.id) ?? 1;
  }

  /** Empire names: large letter-spaced lettering across each territory, zoomed out only (fades as you zoom in). */
  private empMemo: { key: string; v: { owner: number; p: Pt; span: number; n: number }[] } = { key: '', v: [] };
  /** Set true while a ceremony overlay owns the screen (a title card, the crowning): the board's big empire lettering
   *  steps back so it never reads through the title. The map also notices `.dl-title` / `.cr-room` on its own. */
  hushLettering = false;
  private hushA = 1;
  private hushSeen = { at: 0, on: false };
  private lettersHushed(now: number): boolean {
    if (this.hushLettering) return true;
    if (now - this.hushSeen.at > 250) this.hushSeen = { at: now, on: !!document.querySelector('.dl-title, .cr-room, .dl-crown') };
    return this.hushSeen.on;
  }
  private drawEmpireNames(I: DrawInput) {
    const hushed = this.lettersHushed(this.now);
    this.hushA += ((hushed ? 0 : 1) - this.hushA) * (reducedMotion() ? 1 : 1 - Math.exp(-this.dt / 140));
    const a0 = this.zw.s * (I.peek ? 0.3 : 1) * this.hushA;
    if (a0 < 0.02) return;
    const { ctx } = this;
    const st = I.state;
    const S = this.px(1);
    const key = `${this.objId(st.regions)}|${I.owners.join(',')}`;
    if (this.empMemo.key !== key) this.empMemo = { key, v: empireLabels(st, I.owners) };
    const political = (I.lens ?? 'political') === 'political';
    for (const L of this.empMemo.v) {
      const pl = st.players[L.owner];
      const name = pl.name.toUpperCase();
      const span = L.span * this.cam.z / this.ui;
      // one line if it fits, else split at the middle word; size measured to the territory's width
      const words = name.split(/\s+/);
      const lines = words.length > 1 && span < name.length * 14 ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')] : [name];
      ctx.font = displayFont(24);
      const w24 = Math.max(...lines.map(l => ctx.measureText(l).width + 24 * 0.3 * (l.length - 1)));
      const fs = Math.min(this.compact ? 17 : 22, (24 * span * 0.85) / Math.max(1, w24));
      // a territory too small for a readable name gets none
      if (fs < 13) continue;
      ctx.save();
      ctx.font = displayFont(fs * S);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      // engraved in the glaze: a dark cut under each letter, the house's lifted enamel as the face (fogged
      // or not, the house name is public)
      ctx.globalAlpha = a0 * (political ? 1 : 0.45);
      ctx.lineWidth = 4 * S; ctx.strokeStyle = O.GROOVE; ctx.lineJoin = 'round';
      ctx.fillStyle = O.inkOf(pl.color);
      const lh = fs * 1.15 * S;
      if (this.probes) for (let i = 0; i < lines.length; i++) {
        const c = this.toScreen({ x: L.p.x, y: L.p.y + (i - (lines.length - 1) / 2) * lh }), hw = (ctx.measureText(lines[i]).width + fs * 0.3 * S * lines[i].length) * this.cam.z / 2, hh = fs * this.ui * 0.7;
        this.letterBoxes.push({ x0: c.x - hw, y0: c.y - hh, x1: c.x + hw, y1: c.y + hh });
      }
      lines.forEach((l, i) => { letterSpaced(ctx, l, L.p.x, L.p.y + (i - (lines.length - 1) / 2) * lh, fs * 0.3 * S, true); if (a0 > 0.92 && political) this.probe('empire name', L.p.x, L.p.y + (i - (lines.length - 1) / 2) * lh, Math.min(40, fs * 2), fs * 0.6); });
      ctx.restore();
    }
  }

  // ---- names in space
  /** Name layout: candidate per system (0 below, 1 right, 2 left, 3 above; -1 hidden), computed in zoom space (never
   *  depends on the pan, so panning can't make a name pop) and only when the zoom moves a step or the board changes.
   *  A name already shown keeps its spot while it still (nearly) fits: hysteresis instead of flicker. */
  private nameMemo: { key: string; show: Map<number, number> } = { key: '', show: new Map() };
  private nameA = new Map<number, number>();
  private nameWidth = new Map<string, number>();
  /** Name size by importance (design px): the Throne largest, Crowns and capitals next, colonies smallest. */
  private nameFs(r: Region): number {
    const c = this.coarse ? 0.5 : 0;
    return (r.kind === 'throne' ? 15 : r.kind === 'crown' ? 13.5 : r.kind === 'home' ? 13 : 12) + c;
  }
  private nameW(r: Region): number {
    const fs = this.nameFs(r), k = `${fs}|${r.name}`;
    let w = this.nameWidth.get(k);
    if (w === undefined) {
      this.ctx.save(); this.ctx.font = displayFont(fs);
      w = spacedWidth(this.ctx, r.name, fs * 0.12);
      this.ctx.restore();
      this.nameWidth.set(k, w);
    }
    return w;
  }
  /** How visible a system's name is at this zoom (names belong to the operational and detail views). */
  private nameVis(_r: Region): number { return 1 - this.zw.s; }
  private nameBox(r: Region, cand: number, R: number): { x: number; y: number; w: number; h: number } {
    const w = this.nameW(r), h = this.nameFs(r) * 1.2;
    // an objective's name clears its gold setting (ring and pearl milgrain; the crown above)
    if (r.kind === 'crown' || r.kind === 'throne') R = R * (r.kind === 'throne' ? 1.5 : 1.36) + (cand === 3 ? 12 : 5.5);
    return cand === 1 ? { x: R + 5, y: -h / 2, w, h } : cand === 2 ? { x: -R - 5 - w, y: -h / 2, w, h } : cand === 3 ? { x: -w / 2, y: -R - 3 - h, w, h } : { x: -w / 2, y: R + 3, w, h };
  }
  private layoutNames(I: DrawInput): Map<number, number> {
    const st = I.state;
    const qz = Math.round(Math.log(this.zd) * 40);
    const fleetSig = st.fleets.filter(f => f.ships.length).map(f => `${f.owner}@${f.region}`).sort().join(',');
    const key = `${this.objId(st.regions)}|${qz}|${I.you}|${this.coarse ? 1 : 0}|${this.ui}|${fleetSig}|${I.owners.join(',')}|${I.selectedRegion}`;
    if (key === this.nameMemo.key) return this.nameMemo.show;
    const z = Math.exp(qz / 40);
    const zr = medianRegionRadius(st) * z;
    const W = zoomW(zr, this.coarse);
    const prev = this.nameMemo.show;
    const boxes: { x: number; y: number; w: number; h: number }[] = [];
    const sys = st.regions.filter(r => !isLane(r) && r.kind !== 'void');
    for (const r of sys) { const R = starPx(r, zr); boxes.push({ x: r.site.x * z - R, y: r.site.y * z - R, w: R * 2, h: R * 2 }); }
    // fleet pieces park beside their star: names must not sit under them
    const tr = tokR(zr, this.coarse), tall = W.d * 26 * Math.pow(artGrow(zr), 0.75);
    const seen = new Set<string>();
    for (const f of st.fleets) {
      const r = st.regions[f.region];
      if (!f.ships.length || !r || isLane(r) || seen.has(`${f.owner}:${f.region}`)) continue;
      seen.add(`${f.owner}:${f.region}`);
      const a = anchorOf(r, f.owner, 1 / z, zr);
      boxes.push({ x: a.x * z - tr - 2, y: a.y * z - tr - 2 - tall, w: tr * 2 + 4, h: tr * 2 + 6 + tall });
    }
    const hit = (b: { x: number; y: number; w: number; h: number }) => boxes.some(o => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y);
    const prio = (r: Region) => (r.id === I.selectedRegion ? -1 : ({ throne: 0, crown: 1, home: 2 } as Record<string, number>)[r.kind] ?? (I.owners[r.id] === I.you && I.you !== null ? 3 : 4));
    const order = sys.slice().sort((a, b) => prio(a) - prio(b) || a.id - b.id);
    const show = new Map<number, number>();
    for (const r of order) {
      if (1 - W.s < 0.02) { show.set(r.id, -1); continue; }
      const R = starPx(r, zr), cx = r.site.x * z, cy = r.site.y * z;
      const at = (c: number, inset: number) => { const b = this.nameBox(r, c, R); return { x: cx + b.x + b.w * inset, y: cy + b.y + b.h * inset, w: b.w * (1 - 2 * inset), h: b.h * (1 - 2 * inset) }; };
      let pick = -1;
      const was = prev.get(r.id) ?? -1;
      if (was >= 0 && !hit(at(was, 0.2))) pick = was;
      else for (let c = 0; c < 4 && pick < 0; c++) { const b = at(c, 0); if (!hit({ x: b.x - 3, y: b.y - 2, w: b.w + 6, h: b.h + 4 })) pick = c; }
      show.set(r.id, pick);
      if (pick >= 0) boxes.push(at(pick, 0));
    }
    this.nameMemo = { key, show };
    return show;
  }

  /** The region an in-progress drag (or the selected fleet's hover preview) is aimed at. */
  private dragTarget(I: DrawInput): number | null {
    const D = I.drag;
    if (!D || D.verb === 'invalid') return null;
    for (const r of I.state.regions) if (Math.abs(r.site.x - D.to.x) < 1 && Math.abs(r.site.y - D.to.y) < 1) return r.id;
    return null;
  }

  /** System names written in space (letter-spaced display caps with a soft dark halo, no plates), fading in and out;
   *  and the garrison as one small figure under the name, only where it matters (hover, selection, the drag target,
   *  Space-peek, and faintly everywhere when zoomed right in). */
  private drawNames(I: DrawInput) {
    const { ctx } = this;
    const st = I.state;
    const S = this.px(1);
    const W = this.zw;
    const v = this.view;
    const show = this.layoutNames(I);
    const hov = this.hovStar;
    const tgt = this.dragTarget(I);
    const e = reducedMotion() ? 1 : 1 - Math.exp(-this.dt / 110);
    for (const r of st.regions) {
      if (isLane(r) || r.kind === 'void') continue;
      const pick = show.get(r.id) ?? -1;
      const focus = r.id === hov || r.id === I.selectedRegion || r.id === tgt;
      const target = focus ? 1 : pick >= 0 ? this.nameVis(r) : 0;
      const a0 = this.nameA.get(r.id) ?? (this.nameA.size ? 0 : target);
      const a = a0 + (target - a0) * e;
      if (a < 0.01 && target === 0) { this.nameA.delete(r.id); } else this.nameA.set(r.id, a);
      const p = r.site;
      if (p.x < v.x0 || p.x > v.x1 || p.y < v.y0 || p.y > v.y1) continue;
      const R = this.siteR(r) + (this.reticleLast.has(r.id) ? 9 : 0);
      const b = this.nameBox(r, pick >= 0 ? pick : 0, R);
      const fog = this.starFogged(r, I);
      const kingly = r.kind === 'crown' || r.kind === 'throne';
      if (a >= 0.01) {
        // drawn in screen space at a fixed font size: the text is crisp and the font string never changes with zoom
        const fs = this.nameFs(r) * this.ui;
        const sp = this.toScreen(p);
        ctx.save();
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        // fog takes the colour, never the contrast: a fogged name is uncoloured ink at full value
        ctx.globalAlpha = a;
        ctx.font = displayFont(fs);
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        const x = sp.x + b.x * this.ui, y = sp.y + (b.y + b.h / 2) * this.ui;
        const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
        const ls = typeof c.letterSpacing === 'string';
        if (ls) c.letterSpacing = `${(fs * 0.12).toFixed(1)}px`;
        // cut in the glaze: a dark groove under the letters, then the face (gilt for objectives, the owner's lifted
        // enamel for held worlds, pale gold for the unclaimed)
        ctx.lineJoin = 'round'; ctx.lineWidth = 3.6 * this.ui; ctx.strokeStyle = O.GROOVE;
        if (ls) ctx.strokeText(r.name, x, y);
        const own = I.owners[r.id];
        ctx.fillStyle = O.nameFill(ctx, kingly ? 'kingly' : 'owned', own !== null && own !== undefined ? this.colorOf(st, own) : null, fog, x, y, fs);
        if (ls) ctx.fillText(r.name, x, y); else spacedText(ctx, r.name, x, y, fs * 0.12);
        if (ls) c.letterSpacing = '0px';
        ctx.restore();
        if (this.probes && a > 0.92) this.probeS(fog ? 'name (fogged)' : kingly ? 'name (objective)' : 'name', x + b.w * this.ui / 2, y, Math.min(b.w * this.ui, 60), fs * 0.62);
        if (pick >= 0 || focus) this.bannerHits.push({ rid: r.id, x: p.x, y: p.y, l: b.x, t: b.y, r: b.x + b.w, b: b.y + b.h });
      }
      // the garrison figure
      const ga = focus || I.peek ? 1 : W.d * 0.95 * (pick >= 0 ? 1 : 0);
      if (ga < 0.02) continue;
      const g = this.garrisonText(r, I);
      if (!g.known && !focus) continue;
      const gy = pick === 0 || pick < 0 ? b.y + b.h + 2 : R + 3;
      const u = this.ui, sp = this.toScreen(p);
      ctx.save();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.globalAlpha = ga;
      ctx.font = numFont(12.5 * u); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      const tw = ctx.measureText(g.txt).width;
      const sw = 10 * u, gap = 1.5 * u, w = sw + gap + tw;
      const x0 = sp.x - w / 2, yc = sp.y + (gy + 8) * u;
      // a gold garrison shield and an ivory figure, cut in the glaze (silver and uncoloured ink when fogged)
      drawIcon(ctx, 'garrison', x0 + sw / 2, yc, 11 * u, O.gold(ctx, x0, yc - 6 * u, x0 + sw, yc + 6 * u, g.fog), { halo: O.GROOVE, haloWidth: 2 * u });
      haloText(ctx, g.txt, x0 + sw + gap, yc + 0.5 * u, g.fog ? O.FOG_INK : O.IVORY, O.GROOVE, 3.4 * u);
      if (this.probes && ga > 0.9) this.probeS('garrison', x0 + w / 2, yc, Math.min(w, 24 * u), 9 * u);
      ctx.restore();
    }
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
      // a black-enamel stud in a gold rim; a mined vein's rim is its own colour
      ctx.beginPath(); ctx.arc(x, y, 14.4 * S, 0, TAU); ctx.fillStyle = O.GROOVE; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, 13 * S, 0, TAU); ctx.fillStyle = '#0c0d12'; ctx.fill();
      ctx.strokeStyle = mined ? V.color : O.goldBox(ctx, x, y, 13 * S); ctx.lineWidth = (mined ? 2.4 : 1.4) * S; ctx.stroke();
      drawIcon(ctx, icFor('vein', r.vein!, V.icon), x, y, 17 * S, V.color);
      ctx.restore();
    }
    if (T) {
      const x = r.site.x - off * S, y = r.site.y + 3 * S;
      ctx.beginPath(); ctx.arc(x, y, 13.4 * S, 0, TAU); ctx.fillStyle = O.GROOVE; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, 12 * S, 0, TAU); ctx.fillStyle = '#0c0d12'; ctx.fill();
      ctx.strokeStyle = O.goldBox(ctx, x, y, 12 * S); ctx.lineWidth = 1.4 * S; ctx.stroke();
      drawIcon(ctx, icFor('trait', r.trait!, T.icon), x, y, 15 * S, '#ffe2a8');
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
    this.signalHits = [];
    if (I.showSignals) {
      this.routeHits = [];
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
        const S = this.px(1), x = r.site.x + (this.siteR(r) + 12) * S, y = r.site.y + 4 * S;
        this.signalHits.push({ x, y, text: sg.text });
        roundRect(ctx, x - 11 * S, y - 10 * S, 22 * S, 20 * S, 6 * S); ctx.fillStyle = O.GROOVE; ctx.fill();
        roundRect(ctx, x - 10 * S, y - 9 * S, 20 * S, 18 * S, 5 * S); ctx.fillStyle = '#0c0d12'; ctx.fill();
        ctx.strokeStyle = O.hiOf(c); ctx.lineWidth = 1.5 * S; ctx.stroke();
        drawIcon(ctx, 'scan', x, y, 14 * S, O.hiOf(c));
      }
    }

    // ---------------------------------------------------------------- planned orders (under the tokens)
    this.routeHits = [];
    for (const a of I.plannedArrows) this.arrow(a.from, a.to, a.color, !!a.dashed, a.label, 1, a.kind);
    // arrows that left the plan animate in again when they come back
    for (const k of this.arrowSeen.keys()) if (!this.arrowFrame.has(k)) this.arrowSeen.delete(k);
    this.arrowFrame.clear();
    if (I.pathPreview && I.pathPreview.pts.length > 1) {
      ctx.lineCap = 'round';
      ctx.beginPath(); I.pathPreview.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.strokeStyle = O.GROOVE; ctx.lineWidth = this.px(5.4); ctx.stroke();
      ctx.strokeStyle = I.pathPreview.ok ? '#ffe7a8' : 'rgba(200,200,215,0.8)';
      ctx.lineWidth = this.px(3); ctx.setLineDash(I.pathPreview.ok ? [this.px(8), this.px(6)] : [this.px(1), this.px(7)]); ctx.lineDashOffset = -I.now / 40;
      ctx.lineCap = 'round';
      ctx.beginPath(); I.pathPreview.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
      ctx.setLineDash([]); ctx.lineDashOffset = 0; ctx.lineCap = 'butt';
    }

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
      const col0 = I.highlight.get(r.id);
      if (!col0) continue;
      const col = retint(col0);
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
      // the region's enamel lifts a little (a flat tint, no light under the marks) and its wall is gilt
      path(ctx, r.poly);
      ctx.fillStyle = hexA(col, 0.1 * k * pulse); ctx.fill();
      ctx.save(); ctx.clip();
      ctx.strokeStyle = O.GROOVE; ctx.lineWidth = (4 + 2 * k) * S; ctx.stroke();
      ctx.strokeStyle = hexA(O.mixHex(col, '#fff4e0', 0.25), (0.78 + 0.22 * k) * pulse); ctx.lineWidth = (1.6 + 1.4 * k) * S; ctx.stroke();
      ctx.restore();
    }
  }

  // ================================================================ tokens
  /** Group fleets into one piece per owner per system (fanned out for your expanded stack), park it beside its star
   *  (or on its lane dot), and draw it with eased positions; battles add one marker at the star. */
  private drawTokens(I: DrawInput) {
    const { ctx } = this;
    const st = I.state;
    const now = I.now;
    const S = this.px(1);
    const W = this.zw;
    const reduced = reducedMotion();
    const zr = this.zr;
    const tr = tokR(zr, this.coarse);
    this.drawnPos.clear();
    this.tokHits = [];
    this.battleHits = [];
    // ---- per-fleet motion tracks (trails, heading, arrival pings, warp-in)
    const seen = new Set<number>();
    for (const f of I.fleets) {
      if (f.ghost) continue;
      seen.add(f.id);
      const color = this.colorOf(st, f.owner);
      let trk = this.tracks.get(f.id);
      if (!trk) {
        trk = { x: f.pos.x, y: f.pos.y, vx: 0, vy: 0, ang: 0, trail: [], born: this.fleetsReset || reduced ? -1e9 : now, travel: 0, moving: false, draw: f, color };
        this.tracks.set(f.id, trk);
      } else {
        const dx = f.pos.x - trk.x, dy = f.pos.y - trk.y;
        const d = Math.hypot(dx, dy);
        if (d > S * 160) { trk.trail.length = 0; trk.vx = trk.vy = 0; }
        else { const dt = Math.max(1, this.dt); const a = Math.min(1, dt / 60); trk.vx += (dx / dt - trk.vx) * a; trk.vy += (dy / dt - trk.vy) * a; }
        const sp = Math.hypot(trk.vx, trk.vy) / S;
        const moving = sp > 0.02 && f.alpha > 0;
        if (moving) trk.travel += d / S;
        else if (!moving && sp < 0.005) trk.travel = 0;
        trk.moving = moving;
        const target = moving && sp > 0.05 ? Math.atan2(trk.vy, trk.vx) + Math.PI / 2 : 0;
        let da = target - trk.ang;
        while (da > Math.PI) da -= TAU;
        while (da < -Math.PI) da += TAU;
        trk.ang += da * Math.min(1, this.dt / (moving ? 90 : 260));
      }
      trk.x = f.pos.x; trk.y = f.pos.y; trk.draw = f; trk.color = color;
      if (!reduced && trk.moving) trk.trail.push({ x: f.pos.x, y: f.pos.y, t: now });
      while (trk.trail.length && now - trk.trail[0].t > 700) trk.trail.shift();
      if (reduced) trk.trail.length = 0;
    }
    for (const id of this.tracks.keys()) if (!seen.has(id)) this.tracks.delete(id);

    // ---- group: a fleet is IN a system (parked beside its star), ON a lane dot, or travelling a lane (its position)
    const groups = new Map<string, Tok>();
    const { sup } = this.supplySets(I);
    for (const f of I.fleets) {
      if (f.ghost || f.alpha <= 0.02) continue;
      let rid = f.region !== undefined && st.regions[f.region] ? f.region : -1;
      let rest = false;
      const rr = (q: Region) => (isLane(q) ? 30 * S : (this.siteR(q) + tr + 50) * S);
      if (rid >= 0) { const q = st.regions[rid]; rest = Math.hypot(f.pos.x - q.site.x, f.pos.y - q.site.y) <= rr(q); }
      if (!rest) {
        const n = nearestRegion(st, f.pos);
        const q = st.regions[n];
        if (Math.hypot(f.pos.x - q.site.x, f.pos.y - q.site.y) <= rr(q)) { rid = n; rest = true; } else if (rid < 0) rid = n;
      }
      const key = rest ? `${f.owner}:${rid}` : `f${f.id}`;
      let t = groups.get(key);
      if (!t) {
        const slot = slotFor(null, f.owner);
        const an = rest ? anchorOf(st.regions[rid], f.owner, S, zr) : f.pos;
        t = { key, owner: f.owner, region: rid, fleets: [], rest, target: an, side: slot.side, power: 0, ships: 0, selected: false, idle: false, oos: false, alpha: 0, moving: false, ang: 0, born: -1e9 };
        groups.set(key, t);
      }
      t.fleets.push(f);
    }
    // ---- fan out your stack when you open it: further out along its side, in fixed slots
    const toks: Tok[] = [];
    for (const t of groups.values()) {
      const fan = t.rest && t.fleets.length > 1 && t.owner === I.you && I.you !== null && I.expanded === t.region;
      if (!fan) { toks.push(t); continue; }
      const fl = t.fleets.slice().sort((a, b) => a.id - b.id);
      const slot = slotFor(null, t.owner);
      const step = (tr * 2 + 8) * S;
      fl.forEach((f, i) => {
        const col = i % 3, row = Math.floor(i / 3);
        toks.push({ ...t, key: `x${f.id}`, fleets: [f], target: { x: t.target.x + slot.dx * col * step, y: t.target.y - row * step } });
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
        const trk = this.tracks.get(t.fleets[0].id);
        t.moving = !!trk?.moving; t.ang = trk?.ang ?? 0;
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

    // ---- battles you can see
    const engaged = new Map<number, Engagement>();
    for (const e of st.engagements ?? []) if (st.regions[e.region] && (I.you === null || I.visible.has(e.region) || toks.some(t => t.rest && t.region === e.region && t.owner === I.you))) engaged.set(e.region, e);
    const drawList = toks;

    // ---- hyperlane waypoints your fleets sit on or are heading through: the dots show where the route goes
    if (I.you !== null) {
      const hot = new Set<number>();
      for (const t of toks) if (t.owner === I.you && t.rest && isLane(st.regions[t.region])) hot.add(t.region);
      for (const f of st.fleets) if (f.owner === I.you) for (const rid of f.route?.path ?? []) if (isLane(st.regions[rid])) hot.add(rid);
      if (hot.size) {
        const dr = 2.1 + 1.1 * (1 - W.s);
        for (const rid of hot) { const q = st.regions[rid].site; O.waypoint(ctx, q.x, q.y, S, dr); }
      }
    }
    // ---- multi-turn routes (WEGO; LIVE routes come in as planned arrows): one dashed line along the lane dots
    if (st.mode !== 'live') {
      const shown = new Set(I.fleets.map(f => f.id));
      for (const f of st.fleets) {
        const rt = f.route;
        if (!rt?.path?.length || !shown.has(f.id) || !st.regions[f.region]) continue;
        const pts = [st.regions[f.region].site, ...rt.path.filter(r => st.regions[r]).map(r => st.regions[r].site)];
        if (pts.length < 2) continue;
        let eta = 0;
        try { eta = Math.max(1, Math.ceil(rt.path.length / Math.max(1, fleetSpeed(st, f)))); } catch { eta = rt.path.length; }
        const dest = rt.path[rt.path.length - 1];
        const seize = rt.seize !== null && rt.seize !== undefined;
        this.routeArrow(pts, this.colorOf(st, f.owner), seize, dest, f.owner === I.you);
        this.routeHits.push({ pts, kind: seize ? 'seize' : 'route', to: seize ? rt.seize! : dest, owner: f.owner, eta, fleet: f.id });
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

    // ---- the wake under every piece in flight: a fading line of the house's lifted enamel (flat, not light)
    ctx.save();
    ctx.lineCap = 'round';
    for (const t of drawList) {
      if (t.rest) continue;
      const trk = this.tracks.get(t.fleets[0].id);
      if (!trk || trk.trail.length < 2) continue;
      const eng = O.hiOf(trk.color);
      const pts = trk.trail;
      const lift = -this.miniGeom().stand * S * W.d;
      for (let i = 1; i < pts.length; i++) {
        const kk = i / pts.length;
        const age = clamp01(1 - (now - pts[i].t) / 700);
        ctx.globalAlpha = 0.45 * kk * age;
        ctx.strokeStyle = eng;
        ctx.lineWidth = S * (1.2 + 3.5 * kk);
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
      // zoom changes the parking distance continuously: follow it exactly (easing would make pieces swim while zooming)
      const dx = t.target.x - d.x, dy = t.target.y - d.y;
      const camMoving = this.now - this.camMovedAt < 60;
      if (reduced || camMoving || Math.hypot(dx, dy) > 400 * S || !t.rest) { d.x = t.target.x; d.y = t.target.y; }
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

    // ---- draw: in-transit first, then parked, the selected one on top
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
    // ghost fleets (plan preview): faint pieces, not hit-testable
    for (const f of I.fleets) {
      if (!f.ghost) continue;
      const c = this.colorOf(st, f.owner);
      ctx.save(); ctx.globalAlpha = 0.4 * f.alpha;
      if (W.d > 0.5) drawFigurine(ctx, f.pos.x, f.pos.y - this.miniGeom().stand * S, this.miniGeom().len * S, this.miniGeom().len * this.rdpr, (f.cls?.[0]) ?? 'frigate', f.owner, c, 0);
      else O.pip(ctx, f.pos.x, f.pos.y, -Math.PI / 2, tr * 0.8 * S, c, false, S);
      ctx.restore();
    }

    // ---- one battle marker per fight, at its star
    for (const [rid, e] of engaged) this.drawBattle(st.regions[rid], e, drawList.filter(t => t.rest && t.region === rid), I);
    // sieges without a battle: the besiegers bombard the world (the tabletop, detail zoom only)
    if (W.d > 0.3 && !reduced) for (const t of drawList) {
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

  /** Miniature geometry at detail zoom (design px): base radius, lead hull length, flight-stand height. */
  private miniGeom() {
    const K = Math.pow(this.artK(), 0.75);
    return { rb: 19 * K, len: 30 * K, stand: 14 * K, max: 3 };
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

  /** A fleet piece, as the zoom calls for it (crossfaded over a zoom range): a chevron pip zoomed out, a round
   *  counter with a ship arrow in the middle, painted miniatures on a base up close. A parked piece is tethered to
   *  its star. A stack of 2+ fleets carries a small count chip. Strength is shown only when selected (and in the
   *  hover tooltip); status is encoded on the piece (idle breathes, out of supply has an amber dashed rim). */
  /** The lift of a picked-up fleet: rises over 120 ms, settles back over 140 ms when it is put down. */
  private liftSt: { fleet: number | null; t0: number; up: boolean } = { fleet: null, t0: 0, up: false };
  private liftOf(I: DrawInput, t: Tok, now: number): number {
    const want = I.lift ?? null, L = this.liftSt;
    if (want !== null && (L.fleet !== want || !L.up)) this.liftSt = { fleet: want, t0: now, up: true };
    else if (want === null && L.up) this.liftSt = { fleet: L.fleet, t0: now, up: false };
    const S2 = this.liftSt;
    if (S2.fleet === null || !t.fleets.some(f => f.id === S2.fleet)) return 0;
    if (reducedMotion()) return S2.up ? 1 : 0;
    const k = Math.min(1, (now - S2.t0) / (S2.up ? 120 : 140));
    const e = 1 - Math.pow(1 - k, 3);
    return S2.up ? e : 1 - e;
  }
  private drawToken(t: Tok, d: { x: number; y: number; ang: number; bank?: number }, c: string, now: number, scale: number, alpha: number, I: DrawInput, hit = true) {
    const { ctx } = this;
    const S = this.px(1);
    const W = this.zw;
    const reduced = reducedMotion();
    const lensDim = (I.lens ?? 'political') === 'economy' || (I.lens ?? 'political') === 'supply' ? 0.7 : 1;
    const fill = t.owner === -1 ? WARDEN : c;
    const sel = t.selected;
    const owner = t.owner;
    const mine = I.you !== null && owner === I.you;
    const tr = tokR(this.zr, this.coarse);
    const pmap = I.postures;
    const tPost = pmap ? t.fleets.map(f => pmap.get(f.id)).find(Boolean) ?? null : null;
    const sfl = t.fleets.map(f => this.fleetById(I.state, f.id)).filter((x): x is Fleet => !!x);
    const turnNow = I.state.turn;
    const exposed = sfl.some(f => f.exposed !== null && f.exposed !== undefined && f.exposed >= turnNow);
    const dug = sfl.some(f => f.dugIn !== null && f.dugIn !== undefined && f.dugIn >= turnNow);
    const fated = sfl.some(f => f.fate && f.fate.turn === turnNow);
    const lurking = tPost === 'ambush' && mine;
    const A = clamp01(alpha * lensDim * (lurking ? 0.62 : 1));
    // the tether: a fine gold wire from the star's collet to the piece (it belongs to that system)
    const reg = t.rest ? I.state.regions[t.region] : undefined;
    if (reg && !isLane(reg) && hit && W.s < 0.95) {
      const R = (this.siteR(reg) * 0.75 + 2) * S;
      const dx = d.x - reg.site.x, dy = d.y - reg.site.y, L = Math.hypot(dx, dy) || 1;
      const end = L - tr * S * 0.9;
      if (end > R + 2 * S) {
        ctx.save(); ctx.globalAlpha = A * (1 - W.s);
        O.tether(ctx, reg.site.x + dx / L * R, reg.site.y + dy / L * R, reg.site.x + dx / L * end, reg.site.y + dy / L * end, S);
        ctx.restore();
      }
    }
    ctx.save();
    ctx.translate(d.x, d.y);
    if (scale !== 1) ctx.scale(scale, scale);
    // picked up: the piece rises 4 px off the dial and its shadow widens and softens beneath it
    const lk = hit ? this.liftOf(I, t, now) : 0;
    if (lk > 0.001) {
      const sr = tr * S * (1.05 + 0.4 * lk);
      const sg = ctx.createRadialGradient(1.5 * S * lk, 3 * S * lk, 0, 1.5 * S * lk, 3 * S * lk, sr);
      sg.addColorStop(0, `rgba(0,0,0,${(0.5 - 0.14 * lk).toFixed(3)})`); sg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save(); ctx.globalAlpha = A; ctx.fillStyle = sg; ctx.beginPath(); ctx.ellipse(1.5 * S * lk, 3 * S * lk, sr, sr * 0.7, 0, 0, TAU); ctx.fill(); ctx.restore();
      ctx.translate(0, -4 * S * lk);
    }
    if (fated && W.d > 0.02) {
      // a fleet under a Fate: a slowly turning ring of pale violet milgrain round its plinth (no glow)
      ctx.globalAlpha = A * W.d;
      O.beads(ctx, 0, 0, tr * S * 1.62, 22, 1.3 * S, '#e2d2ff', reduced ? 0 : now / 2600);
    }
    if (W.d > 0.01) { ctx.globalAlpha = A * W.d; this.drawMinis(t, d, fill, now, I); }
    if (W.o > 0.01) { ctx.globalAlpha = A * W.o; O.counter(ctx, 0, 0, d.ang - Math.PI / 2, tr * S, fill, sel, S); }
    if (W.s > 0.01) { ctx.globalAlpha = A * W.s; O.pip(ctx, 0, 0, d.ang - Math.PI / 2, tr * S, fill, sel, S); }
    ctx.globalAlpha = A;
    const ry = tr * (W.d > 0 ? 1 - 0.54 * W.d : 1);
    // status on the piece: idle (yours, while you plan) a slowly turning milgrain ring; out of supply an amber dashed
    // rim; exposed a cinnabar rim; lurking a pale dashed rim. Each sits in a groove, so it reads on any ground.
    if (mine && t.idle && !sel && W.s < 0.98) {
      ctx.save(); ctx.globalAlpha = A * (1 - W.s);
      O.idle(ctx, 0, 0, tr * S * 1.42, ry * S * 1.42, reduced ? 0 : now / 1900, S);
      ctx.restore();
    }
    if (t.oos) O.rim(ctx, 0, 0, tr * S * 1.26, ry * S * 1.26, O.AMBER, [3.2, 2.4], 2.2, S);
    if (exposed) O.rim(ctx, 0, 0, tr * S * 1.34, ry * S * 1.34, O.CINNABAR, [], 2.2, S);
    if (lurking) O.rim(ctx, 0, 0, tr * S * 1.4, ry * S * 1.4, 'rgba(236,228,255,0.95)', [3, 3], 1.6, S);
    // a stack of 2+ fleets: a black-enamel stud with the count, lower right of the piece
    if (t.fleets.length > 1) O.stack(ctx, t.fleets.length, tr * 0.95 * S, ry * 0.95 * S, S);
    if (this.probes && hit && scale === 1 && A > 0.9) {
      const lift = -4 * S * lk, who = O.houseOf(fill);
      this.probe(`${W.d > 0.5 ? 'miniature' : W.o > 0.5 ? 'fleet counter' : 'fleet pip'} (${who})`, d.x, d.y + lift, tr * 2.2, tr * 2.2);
      if (mine && t.idle && !sel && W.s < 0.1) this.probe('idle rim', d.x - tr * 1.42 * S, d.y + lift, 7, 7);
      if (t.oos) this.probe('out-of-supply rim', d.x + tr * 1.26 * S, d.y + lift, 5, 5);
      if (t.fleets.length > 1) this.probe('stack count', d.x + tr * 0.95 * S, d.y + ry * 0.95 * S + lift, 9, 9);
      if (sel && W.s < 0.5) this.probe('strength', d.x + 4 * S, d.y + lift - (tr + 10 + W.d * (this.miniGeom().stand + this.miniGeom().len * 0.7)) * S, 12, 10);
    }
    // selected: its strength (attack power) over it
    if (sel && W.s < 0.98) {
      ctx.save(); ctx.globalAlpha = A * (1 - W.s);
      O.strength(ctx, Math.max(0, Math.round(t.power)), 0, -(tr + 10 + W.d * (this.miniGeom().stand + this.miniGeom().len * 0.7)) * S, S);
      ctx.restore();
    }
    if (tPost && tPost !== 'steady' && (sel || W.d > 0.5) || (dug && W.d > 0.5)) {
      const marks: { t: IconName; ink: string }[] = [];
      if (tPost && tPost !== 'steady') marks.push({ t: icFor('posture', tPost, POSTURES[tPost]?.icon), ink: mine ? '#ffe2a0' : '#ffb0a0' });
      if (dug && W.d > 0.5) marks.push({ t: icFor('state', 'dug'), ink: '#d8dbe6' });
      const R = 9 * S;
      let x = -tr * S - R * 0.6;
      for (const m of marks) {
        ctx.beginPath(); ctx.arc(x, ry * S, R + 1.3 * S, 0, TAU); ctx.fillStyle = O.GROOVE; ctx.fill();
        ctx.beginPath(); ctx.arc(x, ry * S, R, 0, TAU); ctx.fillStyle = '#0c0d12'; ctx.fill();
        ctx.strokeStyle = O.goldBox(ctx, x, ry * S, R); ctx.lineWidth = 1.3 * S; ctx.stroke();
        drawIcon(ctx, m.t, x, ry * S, R * 1.35, m.ink);
        x -= R * 2 + 3 * S;
      }
    }
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
    if (!hit) return;
    for (const f of t.fleets) this.drawnPos.set(f.id, { x: d.x, y: d.y });
    const top = tr + W.d * (this.miniGeom().stand + this.miniGeom().len * 0.5);
    const hr = Math.max(this.hitR() * 0.8, tr + 4);
    this.tokHits.push({ x: d.x, y: d.y, l: -hr, t: -top - 4, r: hr, b: tr + 6, cr: Math.max(this.hitR(), tr + 5), hit: { region: t.region, owner: t.owner, fleetIds: t.fleets.map(f => f.id) } });
  }

  /** Detail zoom: cast-metal figurines on gold pins over one black-enamel plinth (gold rim, house-enamel band), and
   *  the fleet's pennant with its sigil and rank (a limping fleet lists on its pins, its pennant droops and it trails
   *  smoke). */
  private drawMinis(t: Tok, d: { x: number; y: number; ang: number; bank?: number }, fill: string, now: number, I: DrawInput) {
    const { ctx } = this;
    const S = this.px(1);
    const G = this.miniGeom();
    const reduced = reducedMotion();
    const high = gfxQuality() === 'high';
    const owner = t.owner;
    const cls = this.classesOf(I, t.fleets);
    const n = Math.min(G.max, cls.length);
    const lead = cls[0] ?? 'frigate';
    const len0 = G.len * (0.8 + 0.2 * classLen(lead) / 1.06);
    const F = formation(n);
    let mx = 0, my = 0; for (const f of F) { mx += f.x / n; my += f.y / n; }
    const flip = Math.cos(d.ang) < -0.2 ? -1 : 1;
    const pos = F.map((f, i) => ({ x: (f.x - mx) * len0 * 0.72 * 1.05, y: (f.y - my) * len0 * 0.72 * flip, s: f.s, cls: cls[i] }));
    const rb = G.rb * (n > 2 ? 1.18 : n > 1 ? 1.08 : 1);
    drawPlinth(ctx, 0, 0, rb * S, fill, S, { sel: t.selected, oos: t.oos, soft: high });
    const bob = reduced || t.moving ? 0 : Math.sin(now / 850 + (t.fleets[0]?.id ?? 0) * 1.7) * 1.3;
    const order = pos.map((q, i) => ({ ...q, i })).sort((a, b) => a.y - b.y);
    // a limping fleet lists 8° on its pins (DELIGHT #40)
    const listing = t.fleets.some(f => !!this.fleetById(I.state, f.id)?.limping);
    const devK = high ? this.rdpr : Math.min(this.rdpr, 1.5);
    for (const q of order) {
      const gx = q.x * S, gy = q.y * BASE_SQUASH * S;
      const L = len0 * q.s * (0.78 + 0.22 * classLen(q.cls) / classLen(lead));
      const stH = (G.stand + (q.i === 0 ? 2 : 0)) * S;
      const sy = gy - stH + bob * S * (q.i % 2 ? 0.7 : 1);
      drawPin(ctx, gx, gy, sy + L * S * 0.05, Math.max(1.1, L * 0.055) * S);
      if (listing) { ctx.save(); ctx.translate(gx, sy); ctx.rotate(0.14 * -t.side || 0.14); ctx.translate(-gx, -sy); }
      drawFigurine(ctx, gx, sy, L * S, L * devK, q.cls, owner, fill, d.ang, { shadow: { dx: stH * 0.3, dy: stH * 0.95, alpha: high ? 0.5 : 0.4 }, engine: t.moving ? (listing ? 0.4 : 0.8) : 0, bank: d.bank ?? 0 });
      if (listing) ctx.restore();
    }
    if (owner < 0) return;
    const sfs = t.fleets.map(f => this.fleetById(I.state, f.id)).filter((x): x is Fleet => !!x && !!x.banner && x.ships.length > 0);
    const ld = sfs.sort((a, b) => b.commander.rank - a.commander.rank)[0];
    const limp = t.fleets.map(f => this.fleetById(I.state, f.id)).find(x => x?.limping);
    if (limp && !reduced) {
      for (let i = 0; i < 4; i++) {
        const k = ((now / 1400) + i / 4) % 1;
        smoke(ctx, (-t.side * 4 + Math.sin(i * 2.3 + k * 4) * 5) * S, (-G.stand * 0.6 - k * 34) * S, (5 + k * 12) * S, 0.42 * (1 - k));
      }
    }
    if (!ld?.banner) return;
    const pk = Math.pow(this.artK(), 0.4);
    const dir = -t.side;
    const ry = rb * BASE_SQUASH;
    const bx = dir * rb * 0.78 * S, by = ry * 0.2 * S;
    const top = by - (G.stand * 0.9 + len0 * 0.5 + 10) * S;
    ctx.strokeStyle = O.GROOVE; ctx.lineWidth = 2.8 * S; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx, top - 2 * S); ctx.stroke();
    ctx.strokeStyle = O.gold(ctx, bx - 1.2 * S, 0, bx + 1.2 * S, 0); ctx.lineWidth = 1.3 * S; ctx.stroke();
    const fw = 22 * S * pk, fh = 15 * S * pk;
    const wv = reduced || ld.limping ? 0 : Math.sin(now / 300 + ld.id) * 1.4 * S;
    ctx.save();
    ctx.translate(bx, top);
    if (ld.limping) ctx.rotate(dir * 1.2);
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(dir * fw * 0.5, wv, dir * fw, 1.5 * S + wv * 0.7);
    ctx.lineTo(dir * fw * 0.74, fh * 0.52 + wv * 0.4);
    ctx.lineTo(dir * fw, fh + wv * 0.3);
    ctx.quadraticCurveTo(dir * fw * 0.5, fh + wv * 0.6, 0, fh);
    ctx.closePath();
    enamel(ctx, ld.limping ? desat(O.enamelBase(fill), 0.45) : O.enamelBase(fill), 0, fh, ld.commander.rank >= 4 ? 'gold' : 'iron', 0.9 * S);
    drawSigil(ctx, ld.banner.sigil, dir * fw * 0.4, fh * 0.48 + wv * 0.5, 10.5 * S * pk, goldPaint(ctx, 0, fh), true);
    if (ld.oathbreaker) {
      ctx.strokeStyle = '#ff4a3a'; ctx.lineWidth = 1.3 * S; ctx.beginPath();
      ctx.moveTo(dir * fw * 0.62, 0.5 * S); ctx.lineTo(dir * fw * 0.48, fh * 0.4); ctx.lineTo(dir * fw * 0.6, fh * 0.6); ctx.lineTo(dir * fw * 0.44, fh); ctx.stroke();
    }
    ctx.restore();
  }

  // ================================================================ battles on the board
  private shotSeen = new Set<string>();
  /** A world's on-screen radius (ctx units). */
  private worldR(r: Region, _I: DrawInput) { return this.siteR(r) * this.px(1); }

  /** One clear battle marker: crossed swords in a ring, on the star zoomed out and just above it closer in (the
   *  pieces stay at their places beside the star). Round, odds and progress are in its tooltip. Up close, the pieces
   *  exchange fire in their house's style and the garrison answers from the surface. */
  private drawBattle(r: Region, _e: Engagement, toks: Tok[], I: DrawInput) {
    const { ctx } = this;
    const S = this.px(1);
    const W = this.zw;
    const now = I.now;
    const reduced = reducedMotion();
    const lane = isLane(r);
    const R = lane ? 0 : this.siteR(r);
    const D = W.s * 8.5 + (1 - W.s) * 11 + (this.coarse ? 1.5 : 0) + (lane ? 0 : W.d * Math.max(4, R * 0.35));
    // over the star's setting (a Crown's ring and crown, the Throne's bezel) rather than on it
    const kingly = r.kind === 'crown' || r.kind === 'throne';
    const top = lane ? 0 : kingly ? O.objR(R, r.kind === 'throne', 1) + (r.kind === 'throne' ? 10 : 6) : R;
    const lift = lane ? 0 : (1 - W.s) * (top + D + 4);
    const P = { x: r.site.x, y: r.site.y - lift * S };
    const beat = reduced ? 0 : Math.max(0, Math.sin((now / 700) * Math.PI)) ** 4;
    // a gold coin with cinnabar enamel and gold crossed swords, standing on the dial
    O.battleCoin(ctx, P.x, P.y, D * S, S, beat);
    this.probe('battle mark', P.x, P.y, D * 1.5, D * 1.5);
    this.battleHits.push({ rid: r.id, x: P.x, y: P.y, r: D + 5 });
    if (W.d < 0.3 || reduced || lane) return;
    // ---- the exchange of fire (detail)
    const G = this.miniGeom();
    const lift2 = (G.stand + 2) * S;
    const owner = I.owners[r.id];
    const shooters: { owner: number; x: number; y: number; planet: boolean }[] = [];
    for (const t of toks) { const d = this.tokDisp.get(t.key); if (d) shooters.push({ owner: t.owner, x: d.x, y: d.y - lift2, planet: false }); }
    if (r.garrison > 0) shooters.push({ owner: owner ?? -2, x: r.site.x, y: r.site.y, planet: true });
    if (shooters.length < 2) return;
    const pr = R * S, K = Math.pow(this.artK(), 0.75);
    ctx.save();
    ctx.globalAlpha = W.d;
    shooters.forEach((sh, si) => {
      const enemies = shooters.filter(o => o.owner !== sh.owner);
      if (!enemies.length) return;
      const period = 900 + si * 170;
      const ph = (r.id * 337 + si * 491) % period;
      const k = Math.floor((now + ph) / period), t0 = k * period - ph;
      for (let j = 0; j < 4; j++) {
        const age = now - (t0 + j * 95);
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
    if (this.shotSeen.size > 400) this.shotSeen.clear();
  }

  /** One discharge `age` ms after it fired, in the orrery's flat language: an enamel bolt in the shooter's house
   *  colour (ivory head) flying to its target, gold beads where it lands. A lance (Azure, the Warden) arrives at once. */
  private weaponShot(owner: number, planet: boolean, from: Pt, to: Pt, age: number, S: number, key: string, targetR: number, targetC: Pt | null) {
    const { ctx } = this;
    if (age < 0 || age > 1200) return;
    const st = this.lastState;
    const col = planet ? '#f1d488' : this.colorOf(st!, owner);
    const fac = planet ? 'battery' : scheme(owner, col).faction;
    const travel = fac === 'azure' || fac === 'warden' || fac === 'neutral' ? 160 : fac === 'crimson' || fac === 'battery' ? 300 : 420;
    if (age < travel) O.shot(ctx, from.x, from.y, to.x, to.y, col, Math.min(1, age / travel), S);
    const ia = age - travel;
    if (ia >= 0 && ia < 420) {
      O.impact(ctx, to.x, to.y, ia / 420, S);
      if (targetC && targetR > 0 && ia < 160) { ctx.beginPath(); ctx.arc(to.x, to.y, 2.6 * S, 0, TAU); ctx.fillStyle = '#fff4d6'; ctx.fill(); }
      if (!this.shotSeen.has(key)) { this.shotSeen.add(key); this.spark(to.x, to.y, '#ffd27a', this.compact ? 2 : 3, 0.1, 340); }
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
      // planted, then gone: an aftermath is news, not a permanent mark on the board
      const a = Math.min(1, age / 300) * Math.max(0, 1 - age / 5000);
      if (a <= 0) continue;
      const r = st.regions[b.region];
      const c = this.colorOf(st, b.winner);
      // the victor's banner planted on the world (top of the plate at strategic zoom)
      const base = { x: r.site.x, y: r.site.y - (this.siteR(r) * 0.6) * S };
      const top = base.y - 24 * S;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.lineCap = 'round';
      ctx.strokeStyle = O.GROOVE; ctx.lineWidth = 4 * S;
      ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(base.x, top); ctx.stroke();
      ctx.strokeStyle = O.gold(ctx, base.x - 1, top, base.x + 1, base.y); ctx.lineWidth = 2 * S; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(base.x + 1 * S, top); ctx.lineTo(base.x + 17 * S, top + 5 * S); ctx.lineTo(base.x + 1 * S, top + 11 * S); ctx.closePath();
      ctx.fillStyle = c; ctx.fill(); ctx.strokeStyle = 'rgba(6,5,4,0.9)'; ctx.lineWidth = 1.2 * S; ctx.stroke();
      swords(ctx, base.x + 7 * S, top + 5.5 * S, 3.5 * S, inkOn(c), 1.1 * S);
      ctx.restore();
    }
  }

  // ================================================================ animated layers
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

  /** The star the mouse is over: the hovered region, when the pointer is on its star or its banner (not just
   *  anywhere inside the region, which tiles the whole map). */
  private hoverStar(I: DrawInput): number | null {
    const m = this.mouse;
    if (!m) return null;
    const b = this.bannerAt(m.x, m.y);
    if (b !== null) return b;
    const rid = I.hoverRegion;
    const r = rid !== null ? I.state.regions[rid] : null;
    if (!r || isLane(r) || r.kind === 'void') return null;
    const p = this.toScreen(r.site);
    const R = Math.max(14, this.siteR(r) + 6) * this.ui;
    return Math.hypot(p.x - m.x, p.y - m.y) <= R ? r.id : null;
  }

  /** Per-segment target brightness: 0.5 for lanes touching a hovered/selected star, 0.34 for the lanes your
   *  selected fleet can reach this turn (a hovered one lights only its route), 1 along its route or planned path.
   *  Nothing while dragging. */
  private laneTargets(I: DrawInput, segs: LaneSeg[]): Map<number, number> {
    const st = I.state;
    const stars: number[] = [];
    const dragging = !!I.drag && !I.drag.blink;
    const sr = I.selectedRegion;
    if (sr !== null && st.regions[sr] && !isLane(st.regions[sr])) stars.push(sr);
    const hs = dragging ? null : this.hoverStar(I);
    if (hs !== null && !stars.includes(hs)) stars.push(hs);
    const fleets = new Set<number>(), hovered = new Set<number>();
    if (!dragging && I.you !== null) {
      for (const f of I.fleets) if (f.selected && f.owner === I.you && !f.ghost) fleets.add(f.id);
      const hit = this.mouse ? this.tokenAt(this.mouse.x, this.mouse.y) : null;
      if (hit && hit.owner === I.you) for (const id of hit.fleetIds) { fleets.add(id); hovered.add(id); }
    }
    if (dragging) stars.length = 0;
    const fl = [...fleets].map(id => this.fleetById(st, id)).filter((f): f is Fleet => !!f && !!st.regions[f.region]);
    const arrows = I.plannedArrows.map(a => `${a.from.x},${a.from.y}>${a.to.x},${a.to.y}`).join(';');
    const key = `${this.objId(st)}|${stars.join(',')}|${fl.map(f => `${f.id}@${f.region}${hovered.has(f.id) ? 'h' : ''}`).join(',')}|${arrows}`;
    if (key === this.laneMemo.key) return this.laneMemo.t;
    const t = new Map<number, number>();
    const idx = laneIndex(st, segs);
    const bump = (si: number, v: number) => { if ((t.get(si) ?? 0) < v) t.set(si, v); };
    for (const rid of stars) for (const si of idx.touch.get(rid) ?? []) bump(si, 0.5);
    const markPath = (ids: number[]) => { for (let i = 1; i < ids.length; i++) { const si = idx.pair.get(pairKey(ids[i - 1], ids[i])); if (si !== undefined) bump(si, 1); } };
    for (const f of fl) {
      let sp = 1;
      try { sp = Math.max(1, fleetSpeed(st, f)); } catch { /* */ }
      // this turn's reach, softly, only for the fleet you selected (not every fleet the mouse passes over)
      const sel = I.fleets.some(d => d.id === f.id && d.selected);
      if (sel) { const reach = within(st, f.region, sp); segs.forEach((g, si) => { if (reach.has(g.u) && reach.has(g.v)) bump(si, 0.34); }); }
      if (f.route?.path?.length) markPath([f.region, ...f.route.path]);
      // your plan for it this turn: the chain of planned arrows that starts at its token (or its system)
      const near = (a: Pt, b: Pt | undefined) => !!b && Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1;
      const tokPos = I.fleets.find(d => d.id === f.id)?.pos;
      let cur = f.region, starts = [st.regions[f.region].site, tokPos];
      for (let hop = 0; hop < 64; hop++) {
        const a = I.plannedArrows.find(x => starts.some(p => near(x.from, p)));
        const to = a ? st.regions.find(r => near(a.to, r.site)) : undefined;
        const p = to && to.id !== cur ? findPath(st, cur, to.id) : null;
        if (!to || !p) break;
        markPath([cur, ...p]);
        cur = to.id; starts = [to.site, undefined];
      }
    }
    this.laneMemo = { key, t };
    return t;
  }

  /** Brighten the hyperlanes that matter right now over the faint base (eased ~150 ms, culled to the view). */
  private drawLaneFocus(I: DrawInput) {
    const st = I.state;
    const segs = laneSegs(st);
    const tg = this.laneTargets(I, segs);
    for (const si of tg.keys()) if (!this.laneA.has(si)) this.laneA.set(si, 0);
    if (!this.laneA.size) return;
    const e = reducedMotion() ? 1 : 1 - Math.exp(-this.dt / 50);
    const { ctx } = this;
    const S = this.px(1);
    const strat = this.tier === 'strategic';
    const v = this.toWorld(-40, -40), w = this.toWorld(this.w + 40, this.h + 40);
    const dots = new Map<number, number>();
    ctx.save();
    ctx.lineCap = 'round';
    for (const [si, a0] of this.laneA) {
      const target = tg.get(si) ?? 0;
      const a = a0 + (target - a0) * e;
      if (a < 0.01 && !target) { this.laneA.delete(si); continue; }
      this.laneA.set(si, a);
      const g = segs[si];
      if (!g) continue;
      if (Math.max(g.a.x, g.b.x) < v.x || Math.min(g.a.x, g.b.x) > w.x || Math.max(g.a.y, g.b.y) < v.y || Math.min(g.a.y, g.b.y) > w.y) continue;
      // stop short of the stars (they sit in the static layer underneath)
      const L = Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y) || 1;
      const ra = this.laneTrim(st.regions[g.u], I) * S, rb = this.laneTrim(st.regions[g.v], I) * S;
      if (ra + rb >= L) continue;
      const ux = (g.b.x - g.a.x) / L, uy = (g.b.y - g.a.y) / L;
      const x0 = g.a.x + ux * ra, y0 = g.a.y + uy * ra, x1 = g.b.x - ux * rb, y1 = g.b.y - uy * rb;
      // lit: polished gold wire in its groove (brighter along a route)
      // eased in and out, but at full value once lit (a half-transparent wire loses to the field under it)
      ctx.globalAlpha = target ? Math.min(1, a / target) : Math.min(1, a * 3);
      O.litLane(ctx, x0, y0, x1, y1, target || a, S, strat);
      if (this.probes && target >= 0.3 && target < 1 && a >= target * 0.95) this.probe('lane (lit)', x0 * 0.6 + x1 * 0.4, y0 * 0.6 + y1 * 0.4, 6, 6);
      ctx.globalAlpha = 1;
      for (const id of [g.u, g.v]) if (isLane(st.regions[id])) dots.set(id, Math.max(dots.get(id) ?? 0, a));
    }
    if (dots.size) {
      const dr = strat ? 2.1 : 2.8;
      for (const [id, a] of dots) {
        const q = st.regions[id].site;
        ctx.globalAlpha = Math.min(1, a * 1.6);
        O.waypoint(ctx, q.x, q.y, S, dr);
      }
    }
    ctx.restore();
  }
  /** How far (design px) a lit lane stops short of a system's site: its star, plus a little air. */
  private laneTrim(r: Region | undefined, I: DrawInput): number {
    if (!r || isLane(r)) return 0;
    return this.siteR(r, this.bannerTier(r, I)) + 3;
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
      ctx.fillStyle = `rgba(255,236,190,${0.04 * a})`; ctx.fill();
      ctx.strokeStyle = `rgba(232,196,120,${0.45 * a})`; ctx.lineWidth = this.px(1.4); ctx.stroke();
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
    const c = this.regionColor(I.state, I.owners[rid]);
    if (r.poly.length < 3) return;
    // a clear, solid highlight: the region lights up and gets a bright border (no moving outlines)
    path(ctx, r.poly);
    ctx.fillStyle = `rgba(255,236,190,${0.06 * e + (k < 1 ? 0.08 * (1 - k) : 0)})`; ctx.fill();
    ctx.save(); ctx.clip();
    ctx.lineJoin = 'round';
    // a polished gold wall just inside the selected region, in its groove
    ctx.strokeStyle = O.GROOVE; ctx.lineWidth = this.px(8); ctx.globalAlpha = e; ctx.stroke();
    ctx.strokeStyle = '#fff0bd'; ctx.lineWidth = this.px(3.2); ctx.stroke();
    ctx.restore();
    void c;
  }

  /** The visible world rectangle this frame (with a margin), for culling animated parts (set in draw). */
  private view = { x0: -1e9, y0: -1e9, x1: 1e9, y1: 1e9 };

  // ================================================================ arrows
  /** Routes and planned orders drawn this frame (world polylines), for the map tooltip. */
  /** systems wearing an attack reticle (this frame / last frame): their names step down to clear it */
  private reticleNow = new Set<number>();
  private reticleLast = new Set<number>();
  private routeHits: { pts: Pt[]; kind: 'route' | 'seize' | Order['type']; to: number; owner: number; eta: number; fleet: number | null }[] = [];
  /** The region whose star sits at world point p (an arrow's end), or -1. */
  private regionAtSite(p: Pt): number {
    const st = this.lastState;
    if (!st) return -1;
    for (const r of st.regions) if (Math.abs(r.site.x - p.x) < 1 && Math.abs(r.site.y - p.y) < 1) return r.id;
    return -1;
  }
  /** Attack target: a reticle (ring + four ticks) round the target star in the attacker's colour. */
  private reticle(p: Pt, rid: number, color: string, alpha = 1) {
    const { ctx } = this;
    const S = this.px(1);
    const r = this.lastState?.regions[rid];
    const R = ((r && !isLane(r) ? this.siteR(r) : 4) + 7) * S;
    this.reticleNow.add(rid);
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.lineCap = 'round';
    O.reticle(ctx, p.x, p.y, R, color, S);
    this.probe('seize reticle', p.x, p.y - R, 7, 7);
    ctx.restore();
    return R / S;
  }

  /** A planned order: one clean dashed line in the owner colour with a head at the destination (hollow for a join);
   *  a seize ends in a target reticle round the star it attacks. A label is only kept for LIVE ETAs and the join "+". */
  arrow(a: Pt, b: Pt, color: string, dashed: boolean, label: string, alpha: number, kind: Order['type'] = 'move') {
    color = retint(color);
    const { ctx } = this;
    const dx = b.x - a.x, dy = b.y - a.y;
    const L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L, ny = dx / L;
    const bend = Math.min(60, L * 0.14);
    const cx = (a.x + b.x) / 2 + nx * bend, cy = (a.y + b.y) / 2 + ny * bend;
    const s = this.px(1);
    const seize = kind === 'seize';
    const to = this.regionAtSite(b);
    let endGap = 20;
    if (seize && to >= 0) { const r = this.lastState!.regions[to]; endGap = (isLane(r) ? 4 : this.siteR(r)) + 12; }
    const t1 = 18 * s / L, t2full = 1 - endGap * s / L;
    if (t2full <= t1) return;
    const key = `${a.x | 0},${a.y | 0},${b.x | 0},${b.y | 0},${color},${dashed ? 1 : 0}`;
    this.arrowFrame.add(key);
    let born = this.arrowSeen.get(key);
    if (born === undefined) { born = reducedMotion() ? -1e9 : this.now; this.arrowSeen.set(key, born); }
    const grow = easeOutCubic(clamp01((this.now - born) / 380));
    const t2 = t1 + (t2full - t1) * grow;
    const q = (t: number) => ({ x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * cx + t * t * b.x, y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * cy + t * t * b.y });
    const p2 = q(t2), pb = q(Math.max(t1, t2 - 0.02));
    const pts: Pt[] = [];
    for (let i = 0; i <= 16; i++) pts.push(q(t1 + (t2 - t1) * (i / 16)));
    if (alpha >= 0.9) this.routeHits.push({ pts, kind, to, owner: -9, eta: 0, fleet: null });
    ctx.save();
    ctx.globalAlpha = alpha;
    const trace = () => { ctx.beginPath(); pts.forEach((pp, i) => (i ? ctx.lineTo(pp.x, pp.y) : ctx.moveTo(pp.x, pp.y))); };
    // printed, flat: the house's enamel dashes inlaid in a groove, a gilt-keyed head (hollow for a join)
    O.routeStroke(ctx, trace, color, s, reducedMotion() ? 0 : -(this.now / 60) * s);
    if (this.probes && alpha >= 0.9) { const q = pts[Math.floor(pts.length / 2)]; this.probe('route (planned)', q.x, q.y, 12, 12); }
    const ang = Math.atan2(p2.y - pb.y, p2.x - pb.x);
    if (seize && grow >= 0.9 && to >= 0) this.reticle(b, to, color);
    else O.routeHead(ctx, p2.x, p2.y, ang, color, s, dashed && kind !== 'move' && !seize);
    // only a LIVE ETA ("3h") or the join "+" is spelled out on the map; order slots live in the strip
    if (label && !/^[IVX]+$/.test(label) && grow > 0.5) {
      ctx.font = numFont(13 * s); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      const w = measureIconText(ctx, label);
      const hx = p2.x + (Math.cos(ang) >= 0 ? 10 * s : -10 * s - w), hy = p2.y - 14 * s;
      haloText(ctx, label, hx, hy, O.IVORY, O.GROOVE, 3.4 * s);
      ctx.textBaseline = 'alphabetic';
    }
    ctx.restore();
  }

  /** A route along hyperlane dots: one dashed polyline in the owner colour, a head at the destination, or the target
   *  reticle for a seize. Rivals' routes are fainter. */
  private routeArrow(pts: Pt[], color: string, seize: boolean, dest: number, mine: boolean) {
    color = retint(color);
    const { ctx } = this;
    const s = this.px(1);
    const end = pts[pts.length - 1], prev = pts[pts.length - 2];
    const L = Math.hypot(end.x - prev.x, end.y - prev.y) || 1;
    const r = this.lastState?.regions[dest];
    const back = Math.min(L * 0.6, ((r && !isLane(r) ? this.siteR(r) : 3) + (seize ? 12 : 6)) * s);
    const tip = { x: end.x - ((end.x - prev.x) / L) * back, y: end.y - ((end.y - prev.y) / L) * back };
    const ang = Math.atan2(end.y - prev.y, end.x - prev.x);
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const trace = () => { ctx.beginPath(); pts.slice(0, -1).forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.lineTo(tip.x, tip.y); };
    // rivals' routes: the groove at full value, the enamel a little quieter (never below the 4.5:1 line)
    O.routeStroke(ctx, trace, color, s, reducedMotion() ? 0 : -(this.now / 60) * s, mine ? 1 : 0.8);
    if (this.probes) {
      // the middle of its longest leg (clear of the stars at either end)
      const legs = [...pts.slice(0, -1), tip];
      let q0 = legs[0], q1 = legs[1], best = 0;
      for (let i = 1; i < legs.length; i++) { const L = Math.hypot(legs[i].x - legs[i - 1].x, legs[i].y - legs[i - 1].y); if (L > best) { best = L; q0 = legs[i - 1]; q1 = legs[i]; } }
      this.probe(seize ? 'route (seize)' : 'route (move)', (q0.x + q1.x) / 2, (q0.y + q1.y) / 2, 12, 12); }
    if (seize) this.reticle(end, dest, color);
    else O.routeHead(ctx, tip.x, tip.y, ang, color, s);
    ctx.restore();
  }

  // ================================================================ map tooltip
  /** Hover anything on the map (tap on touch) to learn what it is: a small plain-words card next to the pointer.
   *  The renderer owns it because it knows what is drawn where; it reuses the shell's `.uxtip` look. */
  private tipEl: HTMLDivElement | null = null;
  private tipKey = '';
  /** the last tap, in world units: a tap often selects and the camera then glides, so the tip stays with what was
   *  tapped (a screen point would describe whatever slid under the finger: another star, or empty space) */
  private tapAt: { x: number; y: number; until: number } | null = null;
  private tipCand = { key: '', t: 0 };
  private quietUntil = 0;
  private downAt: { x: number; y: number; t: number } | null = null;
  private bindTip() {
    const c = this.canvas;
    const local = (e: PointerEvent) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    c.addEventListener('pointerdown', e => {
      this.tapAt = null;
      this.downAt = e.pointerType === 'mouse' ? null : { ...local(e), t: performance.now() };
    }, { passive: true });
    c.addEventListener('pointerup', e => {
      const d = this.downAt;
      this.downAt = null;
      if (!d || e.pointerType === 'mouse') return;
      const p = local(e);
      if (performance.now() - d.t < 450 && Math.hypot(p.x - d.x, p.y - d.y) < 12) this.tapAt = { ...this.toWorld(p.x, p.y), until: performance.now() + 3500 };
    }, { passive: true });
    c.addEventListener('pointercancel', () => { this.downAt = null; this.tapAt = null; }, { passive: true });
  }

  private updateTip(I: DrawInput) {
    const tapping = this.tapAt && performance.now() < this.tapAt.until ? this.toScreen(this.tapAt) : null;
    const pt = this.mouse ?? tapping;
    // quiet while dragging, while the selected fleet previews an order (the shell's preview card speaks then), just
    // after a drop (the shell may pop an offer there), and until the mouse has rested on a mark for a moment
    if (I.drag) this.quietUntil = performance.now() + 900;
    const busy = !!I.drag || performance.now() < this.quietUntil || battleViewerOpen() || !this.canvas.isConnected;
    let tip = pt && !busy ? this.tipFor(I, pt.x, pt.y) : null;
    if (tip && !tapping) {
      if (tip.key !== this.tipCand.key) this.tipCand = { key: tip.key, t: performance.now() };
      if (tip.key !== this.tipKey && performance.now() - this.tipCand.t < 350) tip = null;
    }
    if (!tip) {
      if (this.tipEl && this.tipKey) { this.tipEl.style.display = 'none'; this.tipKey = ''; }
      return;
    }
    if (!this.tipEl) {
      const el = document.createElement('div');
      el.className = 'uxtip maptip';
      el.setAttribute('role', 'tooltip');
      el.style.cssText = 'position:fixed;display:none;pointer-events:none;white-space:normal;max-width:17rem;';
      (this.canvas.parentElement ?? document.body).appendChild(el);
      this.tipEl = el;
    }
    const el = this.tipEl;
    if (tip.key !== this.tipKey) { el.innerHTML = tip.html; this.tipKey = tip.key; el.style.display = 'block'; }
    const cr = this.canvas.getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight;
    const ax = cr.left + pt!.x, ay = cr.top + pt!.y;
    let y = ay - h - (tapping ? 34 : 18);
    if (y < 8) y = ay + 24;
    const x = Math.max(8, Math.min(window.innerWidth - w - 8, ax - w / 2));
    el.style.left = `${Math.round(x)}px`; el.style.top = `${Math.round(Math.min(window.innerHeight - h - 8, y))}px`;
  }

  /** What is under screen point (x, y), in plain words: a fleet piece, a battle, a star (or its name), a route, a
   *  hyperlane waypoint. */
  private tipFor(I: DrawInput, x: number, y: number): { key: string; html: string } | null {
    const st = I.state;
    const tok = this.tokenAt(x, y);
    if (tok) return { key: `f${tok.fleetIds.join(',')}|${st.turn}`, html: this.fleetTip(I, tok) };
    for (const b of this.battleHits) {
      const c = this.toScreen(b);
      if (Math.hypot(c.x - x, c.y - y) <= b.r * this.ui) return { key: `b${b.rid}|${st.turn}`, html: this.battleTip(I, b.rid) };
    }
    for (const g of this.signalHits) {
      const c = this.toScreen(g);
      if (Math.abs(c.x - x) <= 11 * this.ui && Math.abs(c.y - y) <= 10 * this.ui) return { key: `i${g.text}`, html: tipHtml('Intel report', [g.text, 'Reports can be feints: a rival may fake movement.']) };
    }
    const star = this.bannerAt(x, y);
    if (star !== null) return { key: `s${star}|${st.turn}|${I.owners[star]}`, html: this.starTip(I, star) };
    const w = this.toWorld(x, y), tol = 7 / this.cam.z * this.ui;
    for (const h of this.routeHits) {
      for (let i = 1; i < h.pts.length; i++) {
        if (segDist(w, h.pts[i - 1], h.pts[i]) <= tol) return { key: `r${h.kind}${h.to}${h.fleet}`, html: this.routeTip(I, h) };
      }
    }
    for (const r of st.regions) {
      if (!isLane(r)) continue;
      const c = this.toScreen(r.site);
      if (Math.hypot(c.x - x, c.y - y) <= 7 * this.ui) return { key: `w${r.id}`, html: tipHtml('Hyperlane waypoint', ['One jump of travel along this lane. Fleets move a few jumps a turn; a route through the dots shows the way.']) };
    }
    return null;
  }

  private ownerName(I: DrawInput, o: number | null | undefined, cap = true): string {
    if (o === null || o === undefined || o === -2) return cap ? 'Unclaimed' : 'unclaimed';
    if (o === -1) return 'The Warden';
    if (o === I.you) return cap ? 'Yours' : 'you';
    return I.state.players[o]?.name ?? 'Unknown';
  }

  private starTip(I: DrawInput, rid: number): string {
    const st = I.state, r = st.regions[rid];
    const owner = I.owners[rid];
    const V = st.rules.victory as typeof st.rules.victory & { vpPerThronePerTurn?: number; vpPerRelic?: number; crownMajorityVp?: number };
    const lines: string[] = [];
    const kindWord = r.kind === 'throne' ? 'The Throne' : r.kind === 'crown' ? 'Crown world' : r.kind === 'home' ? 'Capital' : r.kind === 'relic' ? 'Relic site' : r.kind === 'void' ? 'Empty space' : 'Colony world';
    lines.push(`${kindWord} · ${owner === I.you && I.you !== null ? 'yours' : this.ownerName(I, owner)}`);
    if (r.kind === 'crown') lines.push(`Hold it to score ${V.vpPerCrownPerTurn ?? 1} victory point each turn${V.crownMajorityVp ? ` (+${V.crownMajorityVp} more while you hold 2 or more Crowns)` : ''}.`);
    if (r.kind === 'throne') {
      lines.push('Hold it to score victory points every turn, more the longer you keep it.');
      // the King's Seat (DELIGHT #32): every reign so far, carved on the plaque
      const reigns = st.soul?.reigns ?? [];
      if (reigns.length) lines.push(`King's Seat: ${reigns.slice(-4).map(x => `${st.players[x.p]?.name.split(' ')[0] ?? '?'} T${x.from}${x.to === null ? '–now' : x.to !== x.from ? `–${x.to}` : ''}`).join(' · ')}.`);
    }
    if (this.blockadeDim(st, r) < 1 && !this.starFogged(r, I)) lines.push('Blockaded: its light, and its output, at half.');
    // tenure (DELIGHT #26): what the rings round a long-held star mean
    if (r.owner !== null && r.owner >= 0 && r.story && !this.starFogged(r, I)) {
      const tt = tenureTier(st, r);
      if (tt) lines.push(`Held ${Math.max(0, st.turn - r.story.tenureFrom)} turns unbroken: ${['', 'one ring', 'two rings', 'three rings'][tt]} of tenure.`);
    }
    if (r.kind === 'relic' && r.relic) lines.push(`An unexcavated relic: excavate it for ${V.vpPerRelic ?? 2} victory points.`);
    if (r.kind !== 'void') {
      const g = this.garrisonText(r, I);
      const mine = owner === I.you && I.you !== null;
      if (!g.known) lines.push('Defenders unknown: not scouted yet.');
      else if (mine) lines.push(`Defenders ${g.txt}: your garrison here.`);
      else lines.push(`Defenders ${g.txt}${g.fog ? ' (last seen)' : ''}: the garrison you must beat to take it.`);
    }
    const fogged = this.starFogged(r, I);
    if (!fogged) {
      const b = r.buildings;
      const parts: string[] = [];
      if (b.fortress) parts.push(`fortress ${b.fortress}`);
      if (b.battery) parts.push(`${b.battery} batter${b.battery > 1 ? 'ies' : 'y'}`);
      if (b.pshield) parts.push('planetary shield');
      if (b.shipyard) parts.push('shipyard');
      if (b.gate) parts.push('warp gate');
      if (b.depot) parts.push('supply depot');
      if (b.academy) parts.push('academy');
      if (b.extractor) parts.push('extractor');
      if (parts.length) lines.push(`Built: ${parts.join(', ')}.`);
      if (owner !== null && owner !== undefined && owner >= 0 && r.kind !== 'void') {
        let max = 0; try { max = maxDevAt(st, rid); } catch { max = 0; }
        if (max) lines.push(`Development ${r.dev} of ${max}.`);
      }
    }
    if (st.rules.empire?.enabled !== false) {
      const T = r.trait ? WORLD_TRAITS[r.trait] : null, Vn = r.vein ? VEINS[r.vein] : null;
      if (T) lines.push(`${T.name}: ${T.desc}`);
      if (Vn) lines.push(`${Vn.name} vein: ${Vn.desc}`);
    }
    const sg = this.sieged(r, st);
    if (sg && r.garrison >= 0) lines.push(`Under siege: garrison ${r.garrison} of ${garrisonMax(st, r, sg === true ? 0 : sg.garrisonStart)} left.`);
    if (I.you !== null && owner !== I.you && (r.loyalty[I.you] ?? 0) > 0) {
      const thr = owner === null || owner === undefined ? st.rules.influence.flipThreshold : st.rules.influence.rivalFlipThreshold;
      lines.push(`Your influence here: ${Math.round(clamp01(r.loyalty[I.you] / Math.max(1e-6, thr)) * 100)}% of the way to winning it over.`);
    }
    if (contestOn(st) && r.owner !== null && r.bodies) {
      const cs = systemStatus(st, r);
      if (cs.contested) lines.push(`Contested: ${cs.holder === null ? 'nobody' : this.ownerName(I, cs.holder)} holds its space (the dashed ring), ${cs.contestedTurns} turn${cs.contestedTurns === 1 ? '' : 's'} so far.`);
      if (cs.occupiedLeft > 0) lines.push(`Occupied: ${cs.occupiedLeft} turn${cs.occupiedLeft === 1 ? '' : 's'} left.`);
      if (cs.tribute) lines.push(`Paying tribute to ${this.ownerName(I, cs.tribute.to, false)}: ${cs.tributeLeft} turn${cs.tributeLeft === 1 ? '' : 's'} left.`);
    }
    if (this.cutOffOf(I)?.has(rid)) lines.push('Cut off from your capital: half yield (the hatching).');
    if (r.story?.calling && owner !== null && owner !== undefined && owner >= 0) { const c = CALLINGS[r.story.calling.id]; if (c) lines.push(`Calling: ${c.name}.`); }
    const debts = (st.soul?.debts ?? []).filter(d => !d.cleared && d.region === rid);
    if (debts.length) lines.push(`Blood-debt owed here (${debts.length}).`);
    return tipHtml(r.name, lines, 'Click for the full card.');
  }

  private fleetTip(I: DrawInput, hit: TokenHit): string {
    const st = I.state;
    const fl = hit.fleetIds.map(id => this.fleetById(st, id)).filter((f): f is Fleet => !!f);
    const mine = hit.owner === I.you && I.you !== null;
    const power = Math.round(fl.reduce((a, f) => a + powerOf(st, f), 0));
    const ships = fl.reduce((a, f) => a + f.ships.length, 0);
    const who = mine ? 'Your' : hit.owner === -1 ? "The Warden's" : `${this.ownerName(I, hit.owner)}`;
    const title = fl.length > 1 ? `${who} ${fl.length} fleets` : `${who} fleet${fl[0]?.name ? `: ${fl[0].name}` : ''}`;
    const lines = [`Strength ${power} (${ships} ship${ships === 1 ? '' : 's'}): its attack power in battle.`];
    const r = st.regions[hit.region];
    if (r) lines.push(isLane(r) ? 'On a hyperlane, between systems.' : `At ${r.name}.`);
    const f0 = fl.find(f => f.route?.path?.length);
    if (f0?.route) {
      const dest = st.regions[f0.route.seize ?? f0.route.path[f0.route.path.length - 1]];
      let eta = 0; try { eta = Math.max(1, Math.ceil(f0.route.path.length / Math.max(1, fleetSpeed(st, f0)))); } catch { eta = 0; }
      if (dest) lines.push(`${f0.route.seize !== null && f0.route.seize !== undefined ? 'Attacking' : 'Moving to'} ${dest.name}${eta && st.mode !== 'live' ? `, arrives in ${eta} turn${eta === 1 ? '' : 's'}` : ''}.`);
    }
    if (mine && I.fleets.some(d => hit.fleetIds.includes(d.id) && d.idle)) lines.push('Idle: no orders yet this turn (it breathes).');
    if (fl.some(f => (f.oos ?? 0) > 0)) lines.push('Out of supply (amber rim): it weakens each turn away from supply.');
    if (fl.some(f => f.limping)) lines.push('Limping home: cannot attack and dies if caught.');
    if (fl.some(f => f.exposed !== null && f.exposed !== undefined && f.exposed >= st.turn)) lines.push('Exposed (red rim): caught out this turn.');
    const post = I.postures ? hit.fleetIds.map(id => I.postures!.get(id)).find(Boolean) : null;
    if (post && post !== 'steady') lines.push(`Posture: ${POSTURES[post]?.name ?? post}.`);
    return tipHtml(title, lines, mine ? 'Drag it onto a system to give an order.' : '');
  }

  private battleTip(I: DrawInput, rid: number): string {
    const st = I.state, r = st.regions[rid];
    const e = (st.engagements ?? []).find(x => x.region === rid);
    const sides = new Map<number, number>();
    for (const f of st.fleets) if (f.region === rid && f.ships.length) sides.set(f.owner, (sides.get(f.owner) ?? 0) + powerOf(st, f));
    const owner = I.owners[rid];
    const gp = r.garrison > 0 ? garrisonPower(st, r) : 0;
    const gk = owner === null || owner === undefined ? -2 : owner;
    if (gp) sides.set(gk, (sides.get(gk) ?? 0) + gp);
    const total = [...sides.values()].reduce((a, b) => a + b, 0) || 1;
    const list = [...sides.entries()].sort((a, b) => b[1] - a[1]);
    const lines = [`${list.map(([o, p]) => `${this.ownerName(I, o)} ${Math.round(p)}${o === gk && gp ? ' (with the garrison)' : ''}`).join(' vs ')}.`];
    if (list.length > 1) lines.push(`Odds: ${this.ownerName(I, list[0][0], false) === 'you' ? 'you are' : `${this.ownerName(I, list[0][0])} is`} favoured, about ${Math.round((list[0][1] / total) * 100)}% of the strength.`);
    if (r.garrison >= 0 && e) lines.push(`Garrison ${r.garrison} of ${garrisonMax(st, r, e.garrisonStart)} left.`);
    return tipHtml(`Battle at ${r.name}${e ? `, round ${e.rounds}` : ''}`, lines, 'It goes on next turn unless one side breaks.');
  }

  private routeTip(I: DrawInput, h: { kind: string; to: number; owner: number; eta: number; fleet: number | null }): string {
    const st = I.state;
    const dest = st.regions[h.to];
    const name = dest ? (isLane(dest) ? 'a hyperlane waypoint' : dest.name) : 'there';
    if (h.kind === 'seize') return tipHtml(`Attack target: ${name}`, [`${h.fleet !== null ? this.ownerName(I, h.owner) === 'Yours' ? 'Your fleet' : `${this.ownerName(I, h.owner)} fleet` : 'Your fleet'} will try to seize it${h.eta ? `, arriving in ${h.eta} turn${h.eta === 1 ? '' : 's'}` : ''}.`, 'The reticle marks the system under attack.']);
    if (h.kind === 'route') return tipHtml(`Route to ${name}`, [`${this.ownerName(I, h.owner) === 'Yours' ? 'Your fleet' : `${this.ownerName(I, h.owner)} fleet`} is on its way${h.eta ? `, arriving in ${h.eta} turn${h.eta === 1 ? '' : 's'}` : ''}.`]);
    return tipHtml(`Planned ${h.kind === 'move' ? 'move' : h.kind}: ${name}`, ['An order in your plan for this turn (the strip below lists them).']);
  }

  /** The arrow under a drag: marching dashes toward the head, a verb glyph at the head; the head eases (snaps) to `to`. */
  private drawDrag(D: DragArrow, now: number) {
    D = { ...D, color: retint(D.color) };
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
    trace(); ctx.strokeStyle = 'rgba(6,5,4,0.6)'; ctx.lineWidth = 8 * s; ctx.stroke();
    if (invalid) { ctx.setLineDash([0.1 * s, 8 * s]); ctx.strokeStyle = col; ctx.lineWidth = 4 * s; trace(); ctx.stroke(); }
    else {
      ctx.strokeStyle = hexA0(od ? '#ffb347' : D.color.startsWith('#') ? D.color : '#ffffff', hollow ? 0.0 : 0.45); ctx.lineWidth = 4.5 * s; if (!hollow) { trace(); ctx.stroke(); }
      if (hollow) { ctx.strokeStyle = col; ctx.lineWidth = 5 * s; trace(); ctx.stroke(); ctx.strokeStyle = 'rgba(6,5,4,0.95)'; ctx.lineWidth = 2 * s; trace(); ctx.stroke(); }
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
      ctx.fill(); ctx.strokeStyle = 'rgba(6,5,4,0.9)'; ctx.lineWidth = 1.5 * s; ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(H.x, H.y, 14 * s, 0, TAU); ctx.fillStyle = 'rgba(6,5,4,0.94)'; ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 2.5 * s; if (invalid || hollow) ctx.setLineDash([3 * s, 2.5 * s]); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = invalid ? '#c8c6d7' : '#ffffff'; ctx.lineWidth = 2.6 * s; ctx.lineCap = 'round';
      const vi: IconName = D.verb === 'seize' || D.verb === 'join' ? 'attack' : D.verb === 'merge' ? 'merge' : D.verb === 'split' ? 'split' : 'close';
      drawIcon(ctx, vi, H.x, H.y, 17 * s, invalid ? '#c8c6d7' : '#ffffff');
    }
    ctx.restore();
  }

  /** The drag arrow along a multi-step route: a polyline through the waypoints to the (eased) head. */
  private drawDragRoute(D: DragArrow, now: number) {
    D = { ...D, color: retint(D.color) };
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
    trace(); ctx.strokeStyle = 'rgba(6,5,4,0.6)'; ctx.lineWidth = 8 * s; ctx.stroke();
    trace(); ctx.strokeStyle = hexA0(col.startsWith('#') ? col : '#ffffff', hollow ? 0.9 : 0.45); ctx.lineWidth = (hollow ? 5 : 4.5) * s; ctx.stroke();
    ctx.setLineDash([10 * s, 8 * s]); ctx.lineDashOffset = reducedMotion() ? 0 : -(now / 28) * s;
    trace(); ctx.strokeStyle = hollow ? 'rgba(6,5,4,0.95)' : '#ffffff'; ctx.lineWidth = (hollow ? 2 : 2.4) * s; ctx.stroke();
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
      ctx.fill(); ctx.strokeStyle = 'rgba(6,5,4,0.9)'; ctx.lineWidth = 1.5 * s; ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(H.x, H.y, 14 * s, 0, TAU); ctx.fillStyle = 'rgba(6,5,4,0.94)'; ctx.fill();
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
      const c = retint(fx.color);
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
          drawShip(ctx, P.x, P.y - 4 * S, L * S, L * this.rdpr, fx.cls ?? 'frigate', fx.owner ?? 0, c, 0, { alpha: k * (1 - clamp01((t - 0.85) / 0.15)), flash: 1 - k, engine: 1 });
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
        const pop = t < 0.12 ? 0.94 + 0.06 * easeOutBack(t / 0.12) : 1;
        ctx.font = numFont(this.px(14 * pop));
        ctx.textAlign = 'center';
        const y = P.y - this.px(36) - easeOutCubic(t) * this.px(20);
        ctx.fillStyle = hexA(fx.kind === 'text' || fx.kind === 'explode' ? c : '#ffffff', Math.min(1, (1 - t) * 2));
        fillIconText(ctx, fx.text, P.x, y, { halo: `rgba(6,3,14,${0.7 * Math.min(1, (1 - t) * 2)})`, haloWidth: this.px(3) });
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
        this.burst(P, '#ffb36b', Math.round(14 * m * S), 0.3 * Math.sqrt(S), 900, true);
        // hull debris: dark tumbling shards lit by the fire
        this.burst(P, '#a85a30', Math.round(10 * m * S), 0.16 * Math.sqrt(S), 1600);
        break;
      }
      case 'warden': this.burst(P, '#d9a8ff', Math.round(14 * m), 0.2, 1000, true); break;
      case 'capture': this.burst(P, retint(fx.color), Math.round(18 * m), 0.25, 900); break;
      case 'excavate': for (let i = 0; i < 16 * m && this.particles.length < (this.compact ? 220 : 450); i++) this.particles.push({ x: P.x + (Math.random() - 0.5) * this.px(24), y: P.y, vx: (Math.random() - 0.5) * this.px(0.02), vy: -this.px(0.04 + Math.random() * 0.08), t0: this.now, life: 900 + Math.random() * 600, size: 1.5 + Math.random() * 1.5, color: retint(fx.color), drag: 0.999, streak: false, grav: 0 }); break;
      case 'clash': case 'battle': this.burst(P, '#ffd27a', Math.round(12 * m), 0.28, 700, true); break;
      case 'build': this.burst(P, retint(fx.color), Math.round(8 * m), 0.12, 700); break;
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
    this.lastKnownBy.clear(); this.lastKnown = new Map();
    this.tokDisp.clear();
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
    out.set(f.id, anchorOf(r, f.owner ?? ownerOf(f.id), scale, Rs));
  }
  return out;
}

export function path(ctx: CanvasRenderingContext2D, poly: Pt[]) {
  ctx.beginPath();
  poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
}

export function hexA(hex: string, a: number): string { return hexA0(retint(hex), a); }

// ------------------------------------------------------------------ lane focus: hyperlanes as segments
interface LaneSeg { a: Pt; b: Pt; u: number; v: number }
const pairKey = (u: number, v: number) => (u < v ? `${u}|${v}` : `${v}|${u}`);
const segCache = new WeakMap<Region[], LaneSeg[]>();
/** Every hyperlane split into site-to-site segments (stable order per map). */
function laneSegs(st: GameState): LaneSeg[] {
  let v = segCache.get(st.regions);
  if (v) return v;
  v = [];
  for (const L of hyperlanes(st)) for (let i = 1; i < L.ids.length; i++) v.push({ a: L.pts[i - 1], b: L.pts[i], u: L.ids[i - 1], v: L.ids[i] });
  segCache.set(st.regions, v);
  return v;
}
const idxCache = new WeakMap<LaneSeg[], { pair: Map<string, number>; touch: Map<number, number[]> }>();
/** Segment by its two ends, and every segment of each lane that touches a real system. */
function laneIndex(st: GameState, segs: LaneSeg[]) {
  let v = idxCache.get(segs);
  if (v) return v;
  const pair = new Map<string, number>(), touch = new Map<number, number[]>();
  segs.forEach((g, i) => pair.set(pairKey(g.u, g.v), i));
  let si = 0;
  for (const L of hyperlanes(st)) {
    const n = L.ids.length - 1, mine = Array.from({ length: n }, (_, k) => si + k);
    for (const end of [L.ids[0], L.ids[L.ids.length - 1]]) (touch.get(end) ?? touch.set(end, []).get(end)!).push(...mine);
    si += n;
  }
  v = { pair, touch };
  idxCache.set(segs, v);
  return v;
}

/** Distance from p to the segment ab (world units). */
function segDist(p: Pt, a: Pt, b: Pt): number {
  const bx = b.x - a.x, by = b.y - a.y, L2 = bx * bx + by * by || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * bx + (p.y - a.y) * by) / L2));
  return Math.hypot(p.x - (a.x + bx * t), p.y - (a.y + by * t));
}
const escTip = (t: string) => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
/** A map tooltip: a bold title, plain-words lines, an optional faint hint. */
function tipHtml(title: string, lines: string[], hint = ''): string {
  return `<b>${escTip(title)}</b>${lines.map(l => `<br>${escTip(l)}`).join('')}${hint ? `<br><span style="opacity:.62">${escTip(hint)}</span>` : ''}`;
}
