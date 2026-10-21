// Animated battle replay viewer: a full-screen modal that replays a BattleReport
// round by round on a Canvas 2D stage. Rendering is a pure function of the
// timeline position T, so pause / seek / restart / skip are trivial.
import type { BattleReport, ShotRec } from '../../../shared/sim/types.ts';
import type { Rules } from '../../../shared/config/rules.ts';
import { drawShip as drawShipArt, gunPoints } from '../art/ships.ts';
type ShipOpts = Parameters<typeof drawShipArt>[9];
import { scheme } from '../art/palette.ts';
import { drawBase, drawStand, BASE_SQUASH } from '../art/minis.ts';
import { drawPlanet, drawBodyShadow, type WorldType } from '../art/planets.ts';
import { matBackdrop, lampOverlay, weaveTile, starfield } from '../art/mat.ts';
import { drawGlow, beam, tracer, fireball, smoke, shieldHit } from '../art/fx.ts';
import { fbm2, rand as artRand, mix as artMix, css as artCss, rgb as artRgb } from '../art/util.ts';
import { drawStructure } from '../art/structures.ts';

export interface BattleViewerCtx {
  rules: Rules;
  playerName: (owner: number) => string;   // owner -1 => neutral/Warden
  playerColor: (owner: number) => string;
  regionName: (id: number) => string;
  you: number | null;
  /** LIVE game: the report's `pulse` is the tick within the cycle (WEGO turns have no pulses). */
  live?: boolean;
}

// ------------------------------------------------------------------ timing
const INTRO = 1.8;          // opening card
const ROUND_LEAD = 0.6;     // round banner before the first volley
const TRAVEL = 0.3;         // bolt flight time
const RETREAT_DUR = 1.4;
const TAIL = 1.7;           // settle time after the last round
const CAPTION_DUR = 2.9;

const FONT = `"Rajdhani","Orbitron","Eurostile","Bahnschrift","Segoe UI",system-ui,sans-serif`;
const GLYPH_SIZE: Record<string, number> = { dart: 0.62, arrow: 0.78, wedge: 1, block: 1.08, long: 1.4, dread: 2.05 };
const CRIT_TEXT: Record<string, string> = { engines: 'ENGINES DOWN', weapons: 'WEAPONS OFFLINE', shields: 'SHIELDS DOWN' };

type Sys = 'engines' | 'weapons' | 'shields';

interface Unit {
  id: number;
  name: string;
  cls: string;
  clsName: string;
  glyph: string;
  owner: number;
  side: number;
  fleet: number | null;
  garrison: boolean;
  maxHp: number;
  startHp: number;
  shields: number;
  hits: { t: number; dmg: number }[];
  hpTl: { t: number; hp: number }[];
  sysTl: { t: number; sys: Sys }[];
  deathT: number;
  retreatT: number;
  lastFire: number[];  // per round
  kills: number;
  dmg: number;
  seed: number;
  // layout (CSS px)
  hx: number; hy: number; fx: number; fy: number; s: number; delay: number;
}

interface ShotFx {
  t0: number; t1: number; from: Unit; to: Unit; rec: ShotRec; off: number; idx: number;
}

interface SideInfo {
  owner: number;
  color: string;
  name: string;
  units: Unit[];
  label: { x: number; y: number; align: CanvasTextAlign };
}

// ------------------------------------------------------------------ helpers
const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function rgba(color: string, a: number): string {
  let h = color.trim();
  if (h.startsWith('#')) {
    h = h.slice(1);
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (h.length >= 6) {
      const n = parseInt(h.slice(0, 6), 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    }
  }
  return color;
}
function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

// ------------------------------------------------------------------ styles
// no backdrop-filter on the overlay: re-blurring the page behind a canvas that repaints every frame
// cost ~45 ms/frame at 1440x900 (60 fps -> 15 fps); a more opaque scrim reads the same
const CSS = `
.bv-overlay,.bv-closing{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;
  background:radial-gradient(ellipse at center,rgba(26,20,14,.72),rgba(3,3,6,.94));
  font-family:${FONT};color:#ece4d2;animation:bv-fade .25s ease-out}
@keyframes bv-fade{from{opacity:0}to{opacity:1}}
.bv-closing{pointer-events:none;animation:bv-out .18s ease-in forwards}
.bv-closing .bv-panel{animation:bv-shrink .18s ease-in forwards}
@keyframes bv-out{to{opacity:0}}
@keyframes bv-shrink{to{transform:scale(.97)}}
.bv-overlay .bv-panel{animation:bv-pop .34s cubic-bezier(.2,1.25,.4,1) both}
@keyframes bv-pop{from{opacity:0;transform:scale(.94) translateY(10px)}}
.bv-btn{transition:border-color .12s,box-shadow .15s,color .12s,background .12s,transform .06s}
.bv-btn:active{transform:scale(.95)}
.bv-card .bv-big{animation:bv-big .7s cubic-bezier(.2,.8,.2,1) both}
@keyframes bv-big{from{opacity:0;letter-spacing:.5em;filter:blur(4px)}}
@media (prefers-reduced-motion:reduce){.bv-overlay,.bv-overlay .bv-panel,.bv-card .bv-big,.bv-side,.bv-closing,.bv-closing .bv-panel{animation:none!important}}
.bv-panel{position:relative;display:flex;flex-direction:column;width:min(1180px,calc(100vw - 32px));height:min(780px,calc(100dvh - 32px));
  background:#07080c;border:1px solid rgba(214,178,110,.28);border-radius:6px;overflow:hidden;
  box-shadow:0 0 0 1px rgba(0,0,0,.6),0 0 48px rgba(0,0,0,.6),inset 0 0 60px rgba(214,178,110,.06)}
.bv-head{display:flex;align-items:center;gap:12px;padding:8px 12px 8px 16px;border-bottom:1px solid rgba(214,178,110,.35);box-shadow:inset 0 1px 0 rgba(255,240,210,.08);
  background:linear-gradient(90deg,rgba(70,74,90,.5),rgba(20,22,30,0) 70%)}
.bv-title{flex:1;min-width:0}
.bv-title b{display:block;font-size:15px;font-weight:600;letter-spacing:.22em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  text-shadow:0 0 12px rgba(230,190,110,.6)}
.bv-title span{display:block;font-size:10.5px;letter-spacing:.24em;text-transform:uppercase;color:#a89a80;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bv-x{background:none;border:1px solid rgba(214,178,110,.3);color:#e6d6b0;width:32px;height:32px;border-radius:4px;font-size:20px;line-height:1;cursor:pointer;flex:none}
.bv-x:hover{color:#fff;border-color:#e6c37a;box-shadow:0 0 12px rgba(230,180,90,.5)}
.bv-stage{position:relative;flex:1;min-height:0;overflow:hidden;background:#05060a}
.bv-stage canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none}
.bv-ctrl{display:flex;align-items:center;gap:8px;padding:8px 12px;border-top:1px solid rgba(214,178,110,.18);background:rgba(14,15,20,.95);flex-wrap:wrap}
.bv-btn{background:linear-gradient(#2c2f3a,#16171e);box-shadow:inset 0 1px 0 rgba(255,240,210,.12);border:1px solid rgba(214,178,110,.32);color:#ece2c8;font:600 11px ${FONT};letter-spacing:.18em;text-transform:uppercase;
  padding:7px 10px;border-radius:3px;cursor:pointer;min-width:34px;white-space:nowrap}
.bv-btn:hover{border-color:#e6c37a;box-shadow:0 0 10px rgba(230,180,90,.45);color:#fff}
.bv-btn.bv-on{background:rgba(214,170,90,.28);border-color:#f0d79a;color:#fff;box-shadow:0 0 10px rgba(230,180,90,.4)}
.bv-speed{display:flex;gap:0}
.bv-speed .bv-btn{border-radius:0;margin-left:-1px}
.bv-speed .bv-btn:first-child{border-radius:3px 0 0 3px}.bv-speed .bv-btn:last-child{border-radius:0 3px 3px 0}
.bv-round{font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:#d8c9a4;min-width:96px;text-align:center}
.bv-bar{flex:1;min-width:120px;height:18px;position:relative;cursor:pointer}
.bv-bar i{position:absolute;left:0;right:0;top:8px;height:2px;background:rgba(214,178,110,.18)}
.bv-bar em{position:absolute;left:0;top:8px;height:2px;background:linear-gradient(90deg,#9a7430,#ffe2a0);box-shadow:0 0 8px #d4a650}
.bv-bar s{position:absolute;top:5px;width:1px;height:8px;background:rgba(230,200,140,.45)}
.bv-card{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto;
  background:radial-gradient(ellipse at center,rgba(14,14,20,.84),rgba(4,4,8,.95));z-index:3}
.bv-card-in{max-width:880px;width:100%;text-align:center;margin:auto}
.bv-kicker{font-size:11px;letter-spacing:.42em;text-transform:uppercase;color:#a89a80}
.bv-big{font-size:clamp(22px,4.6vw,40px);font-weight:600;letter-spacing:.16em;text-transform:uppercase;margin:6px 0 4px;
  text-shadow:0 0 18px rgba(230,190,110,.7),0 0 2px #fff}
.bv-sub{font-size:11px;letter-spacing:.3em;text-transform:uppercase;color:#b4a684}
.bv-rule{height:1px;margin:14px auto;width:60%;background:linear-gradient(90deg,transparent,rgba(230,196,120,.6),transparent)}
.bv-sides{display:flex;flex-wrap:wrap;justify-content:center;gap:12px;margin-top:6px}
.bv-side{flex:1 1 200px;max-width:280px;text-align:left;padding:10px 12px;border:1px solid rgba(255,255,255,.08);border-left:2px solid var(--c);
  background:linear-gradient(90deg,color-mix(in srgb,var(--c) 14%,transparent),transparent);animation:bv-slide .45s ease-out both}
@keyframes bv-slide{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.bv-side h3{margin:0 0 6px;font-size:13px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:var(--c);text-shadow:0 0 10px var(--c)}
.bv-side p{margin:2px 0;font-size:12px;letter-spacing:.06em;color:#ddd4bc}
.bv-side small{display:block;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#a89a80;margin-top:6px}
.bv-vs{align-self:center;font-size:12px;letter-spacing:.3em;color:#8a7e66}
.bv-hint{margin-top:14px;font-size:10px;letter-spacing:.3em;color:#8a7e66;text-transform:uppercase}
.bv-caption{position:absolute;left:50%;bottom:14px;transform:translate(-50%,6px);max-width:min(760px,calc(100% - 24px));z-index:2;
  padding:8px 18px;text-align:center;font-size:clamp(12px,1.7vw,15px);letter-spacing:.08em;color:#f6efdc;pointer-events:none;
  background:linear-gradient(90deg,transparent,rgba(10,10,14,.9) 15%,rgba(10,10,14,.9) 85%,transparent);
  border-top:1px solid rgba(230,196,120,.25);border-bottom:1px solid rgba(230,196,120,.25);
  opacity:0;transition:opacity .35s,transform .35s;text-shadow:0 0 8px rgba(230,190,110,.6)}
.bv-caption.bv-show{opacity:1;transform:translate(-50%,0)}
.bv-end table{margin:10px auto 0;border-collapse:collapse;font-size:12px;letter-spacing:.1em}
.bv-end th{font-weight:500;font-size:10px;letter-spacing:.24em;text-transform:uppercase;color:#a89a80;padding:4px 10px;border-bottom:1px solid rgba(214,178,110,.2)}
.bv-end td{padding:5px 10px;text-align:center;border-bottom:1px solid rgba(255,255,255,.05)}
.bv-end td:first-child{text-align:left;text-transform:uppercase;letter-spacing:.16em;font-weight:600}
.bv-mvp{display:inline-block;margin-top:14px;padding:8px 16px;border:1px solid rgba(255,210,120,.45);background:rgba(255,190,80,.07);
  box-shadow:0 0 18px rgba(255,190,80,.15)}
.bv-mvp small{display:block;font-size:10px;letter-spacing:.34em;color:#ffcf7a;text-transform:uppercase}
.bv-mvp b{font-size:16px;letter-spacing:.12em}
.bv-hl{list-style:none;margin:14px auto 0;padding:0;max-width:640px;text-align:left}
.bv-hl li{font-size:12.5px;letter-spacing:.04em;color:#ddd4bc;padding:4px 0 4px 16px;position:relative;border-bottom:1px solid rgba(255,255,255,.04)}
.bv-hl li:before{content:'';position:absolute;left:2px;top:10px;width:5px;height:5px;transform:rotate(45deg);background:#d4a650;box-shadow:0 0 6px #d4a650}
.bv-endbtns{margin-top:16px;display:flex;gap:10px;justify-content:center}
@media (max-width:640px){
  .bv-panel{width:100vw;height:100dvh;border-radius:0;border:none}
  .bv-ctrl{gap:6px;padding:6px 8px}
  .bv-btn{padding:7px 8px;letter-spacing:.1em}
  .bv-bar{order:10;flex-basis:100%}
  .bv-round{min-width:0;flex:1}
  .bv-sides{gap:8px}.bv-side{flex-basis:140px;padding:8px}
  .bv-vs{display:none}
}`;

function injectStyle() {
  if (document.getElementById('bv-style')) return;
  const st = document.createElement('style');
  st.id = 'bv-style';
  st.textContent = CSS;
  document.head.appendChild(st);
}

// ------------------------------------------------------------------ glyphs
type P = [number, number];
function sym(g: CanvasRenderingContext2D, upper: P[], s: number) {
  // upper half from nose to tail (y >= 0), mirrored back to the nose
  g.beginPath();
  g.moveTo(upper[0][0] * s, upper[0][1] * s);
  for (let i = 1; i < upper.length; i++) g.lineTo(upper[i][0] * s, upper[i][1] * s);
  for (let i = upper.length - 1; i >= 0; i--) if (upper[i][1] !== 0 || i === 0) g.lineTo(upper[i][0] * s, -upper[i][1] * s);
  g.closePath();
}
const HULLS: Record<string, P[]> = {
  dart: [[1.15, 0], [-0.7, 0.34], [-0.42, 0.08], [-0.42, 0]],
  arrow: [[1, 0], [-0.85, 0.72], [-0.55, 0.22], [-0.35, 0]],
  wedge: [[1.05, 0], [0.2, 0.42], [-0.7, 0.78], [-0.92, 0.5], [-0.92, 0]],
  block: [[0.75, 0.52], [0.95, 0.32], [0.95, 0], [0.95, 0]],
  long: [[1.25, 0], [0.75, 0.2], [-0.2, 0.24], [-0.45, 0.58], [-0.95, 0.62], [-0.78, 0.26], [-1.05, 0.22], [-1.05, 0]],
  dread: [[1.12, 0], [0.8, 0.22], [0.92, 0.42], [0.5, 0.46], [0.22, 0.74], [-0.72, 0.74], [-0.98, 0.5], [-0.85, 0.3], [-1.02, 0.22], [-1.02, 0]],
};
function hullPath(g: CanvasRenderingContext2D, glyph: string, s: number) {
  if (glyph === 'block') {
    g.beginPath();
    g.moveTo(0.72 * s, -0.5 * s); g.lineTo(0.95 * s, -0.28 * s); g.lineTo(0.95 * s, 0.28 * s); g.lineTo(0.72 * s, 0.5 * s);
    g.lineTo(-0.88 * s, 0.5 * s); g.lineTo(-0.88 * s, -0.5 * s); g.closePath();
    return;
  }
  sym(g, HULLS[glyph] ?? HULLS.wedge, s);
}
function hullDetail(g: CanvasRenderingContext2D, glyph: string, s: number) {
  g.beginPath();
  switch (glyph) {
    case 'wedge': g.moveTo(0.45 * s, 0); g.lineTo(-0.7 * s, 0); break;
    case 'arrow': g.moveTo(0.4 * s, 0); g.lineTo(-0.2 * s, 0); break;
    case 'block':
      g.moveTo(0.95 * s, 0); g.lineTo(1.4 * s, 0);
      g.moveTo(-0.5 * s, -0.5 * s); g.lineTo(-0.5 * s, 0.5 * s);
      g.moveTo(0.32 * s, 0); g.arc(0.1 * s, 0, 0.22 * s, 0, Math.PI * 2);
      break;
    case 'long':
      g.moveTo(0.9 * s, 0); g.lineTo(-0.85 * s, 0);
      g.moveTo(0.35 * s, -0.22 * s); g.lineTo(0.35 * s, 0.22 * s);
      break;
    case 'dread':
      g.moveTo(0.6 * s, 0); g.lineTo(-0.9 * s, 0);
      g.rect(-0.55 * s, -0.22 * s, 0.4 * s, 0.44 * s);
      for (const [x, y] of [[0.15, 0.45], [0.15, -0.45], [-0.35, 0.52], [-0.35, -0.52]] as P[]) {
        g.moveTo((x + 0.1) * s, y * s); g.arc(x * s, y * s, 0.1 * s, 0, Math.PI * 2);
      }
      break;
  }
}
const ENGINE_X: Record<string, number> = { dart: -0.45, arrow: -0.4, wedge: -0.92, block: -0.88, long: -1.05, dread: -1.02 };

// ------------------------------------------------------------------ viewer
/** The open viewer's close(): opening another replaces it instead of stacking two overlays and two rAF loops. */
let closeOpen: (() => void) | null = null;
/** Is a battle viewer covering the screen? (the map pauses its redraws underneath) */
export const battleViewerOpen = () => closeOpen !== null;

export function openBattleViewer(report: BattleReport, ctx: BattleViewerCtx): void {
  injectStyle();
  closeOpen?.();
  const reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const R = ctx.rules;

  // ---------------------------------------------------------------- units
  const units = new Map<number, Unit>();
  const sides: SideInfo[] = [];
  let seedN = 1;
  report.sides.forEach((sd, si) => {
    const color = ctx.playerColor(sd.owner);
    const name = ctx.playerName(sd.owner) + (ctx.you !== null && sd.owner === ctx.you ? ' (You)' : '');
    const info: SideInfo = { owner: sd.owner, color, name, units: [], label: { x: 0, y: 0, align: 'center' } };
    const mk = (u: Partial<Unit> & Pick<Unit, 'id' | 'name' | 'cls' | 'maxHp' | 'startHp' | 'garrison'>): Unit => {
      const def = R.ships[u.cls];
      const rnd = mulberry(u.id * 7919 + 13 + seedN++)();
      const unit: Unit = {
        clsName: def?.name ?? (u.garrison ? 'Garrison' : u.cls), glyph: def?.glyph ?? 'wedge', owner: sd.owner, side: si,
        fleet: null, shields: def?.shields ?? 0, hits: [], hpTl: [], sysTl: [], deathT: Infinity, retreatT: Infinity,
        lastFire: [], kills: 0, dmg: 0, seed: rnd, hx: 0, hy: 0, fx: 1, fy: 0, s: 10, delay: rnd * 0.45, ...u,
      } as Unit;
      units.set(unit.id, unit);
      info.units.push(unit);
      return unit;
    };
    for (const sh of sd.ships) mk({ id: sh.id, name: sh.name, cls: sh.cls, maxHp: sh.maxHp, startHp: sh.hp, fleet: sh.fleet, garrison: false });
    if (sd.garrison) mk({ id: sd.garrison.id, name: 'Garrison', cls: '__garrison', maxHp: Math.max(1, sd.garrison.maxHp), startHp: sd.garrison.hp, garrison: true });
    sides.push(info);
  });
  const fleetName = new Map<number, { name: string; commander: string }>();
  for (const sd of report.sides) for (const f of sd.fleets) fleetName.set(f.id, f);
  const shipUnits = [...units.values()].filter(u => !u.garrison);

  // ---------------------------------------------------------------- timeline
  const shots: ShotFx[] = [];
  const roundStart: number[] = [];
  const retreatsAt: { t: number; fleet: number; owner: number }[] = [];
  let t = INTRO;
  let shotIdx = 0;
  const hpAtBuild = new Map<number, number>();
  for (const u of units.values()) hpAtBuild.set(u.id, u.startHp);
  const engineDownBy = (u: Unit, tt: number) => u.sysTl.some(x => x.sys === 'engines' && x.t <= tt);

  report.rounds.forEach((rd, ri) => {
    roundStart.push(t);
    const n = rd.shots.length;
    const gap = n ? Math.min(0.17, 2.5 / n) : 0;
    const base = t + ROUND_LEAD;
    const diedThisRound: Unit[] = [];
    rd.shots.forEach((rec, i) => {
      const from = units.get(rec.from), to = units.get(rec.to);
      const t0 = base + i * gap, t1 = t0 + TRAVEL;
      if (from) from.lastFire[ri] = t0;
      if (!from || !to) return;
      const off = (mulberry(shotIdx * 31 + 7)() - 0.5) * 2;
      shots.push({ t0, t1, from, to, rec, off, idx: shotIdx++ });
      if (rec.miss || rec.dmg <= 0) return;
      const prev = hpAtBuild.get(to.id)!;
      const next = prev - rec.dmg;
      hpAtBuild.set(to.id, next);
      to.hits.push({ t: t1, dmg: rec.dmg });
      to.hpTl.push({ t: t1, hp: Math.max(0, next) });
      from.dmg += Math.min(rec.dmg, Math.max(0, prev));
      if (rec.crit) to.sysTl.push({ t: t1, sys: rec.crit });
      if (prev > 0 && next <= 0 && to.deathT === Infinity) {
        to.deathT = t1;
        from.kills++;
        diedThisRound.push(to);
      }
    });
    // simultaneous fire: a ship killed mid-volley still gets its own shots off first
    for (const u of diedThisRound) {
      const lf = u.lastFire[ri];
      if (lf !== undefined && lf + 0.08 > u.deathT) u.deathT = lf + 0.08;
    }
    let end = base + (n ? (n - 1) * gap + TRAVEL : 0) + 0.5;
    for (const u of diedThisRound) end = Math.max(end, u.deathT + 0.3);
    if (rd.retreats.length) {
      for (const r of rd.retreats) {
        retreatsAt.push({ t: end, fleet: r.fleet, owner: r.owner });
        for (const u of shipUnits) {
          if (u.fleet === r.fleet && u.deathT > end && u.retreatT === Infinity && !engineDownBy(u, end)) {
            u.retreatT = end + 0.1 + u.seed * 0.25;
          }
        }
      }
      end += RETREAT_DUR + 0.45;
    } else end += 0.2;
    t = end;
  });
  // ships lost without a shot (cornered fleets scuttled): reconcile with report.losses
  {
    let k = 0;
    for (const sd of sides) {
      const lost = report.losses[String(sd.owner)] ?? 0;
      const shown = sd.units.filter(u => !u.garrison && u.deathT < Infinity).length;
      let deficit = lost - shown;
      for (const u of sd.units) {
        if (deficit <= 0) break;
        if (u.garrison || u.deathT < Infinity || u.retreatT < Infinity) continue;
        u.deathT = t + 0.2 + k++ * 0.18;
        u.hpTl.push({ t: u.deathT, hp: 0 });
        deficit--;
      }
    }
    if (k) t += 0.4 + k * 0.18;
  }
  const BATTLE_END = t;
  const END = t + TAIL;
  const nRounds = report.rounds.length;

  // ---------------------------------------------------------------- captions
  interface Cap { t: number; text: string }
  const caps: Cap[] = [];
  {
    const byLen = shipUnits.slice().sort((a, b) => b.name.length - a.name.length);
    const fleetsByLen = [...fleetName.entries()].sort((a, b) => b[1].name.length - a[1].name.length);
    const deaths = shipUnits.filter(u => u.deathT < Infinity).sort((a, b) => a.deathT - b.deathT);
    const loose: string[] = [];
    for (const h of report.highlights) {
      const low = h.toLowerCase();
      if (/promoted|earns a reputation|is now known|escapes the wreck|will command again/.test(low)) continue; // aftermath: closing card
      let at: number | null = null;
      const u = byLen.find(x => h.includes(x.name));
      if (/^first blood/.test(low)) at = deaths[0]?.deathT ?? null;
      else if (/meet for the/.test(low)) at = INTRO + 0.15;
      else if (u) {
        const crit = (k: Sys) => u.sysTl.find(x => x.sys === k)?.t ?? null;
        if (/engines/.test(low)) at = crit('engines');
        else if (/guns fall silent|weapons/.test(low)) at = crit('weapons');
        else if (/shields/.test(low)) at = crit('shields');
        else if (/must stay behind/.test(low)) at = retreatsAt.find(r => r.owner === u.owner)?.t ?? null;
        else if (u.deathT < Infinity) at = u.deathT;
      }
      if (at === null) {
        const f = fleetsByLen.find(([, v]) => h.includes(v.name));
        if (f) {
          const r = retreatsAt.find(x => x.fleet === f[0]);
          if (r) at = r.t;
          else if (/goes down with/.test(low)) {
            const fs = shipUnits.filter(x => x.fleet === f[0] && x.deathT < Infinity);
            if (fs.length) at = Math.max(...fs.map(x => x.deathT)) + 0.4;
          }
        }
      }
      if (at === null) loose.push(h);
      else caps.push({ t: at + 0.15, text: h });
    }
    loose.forEach((h, i) => caps.push({ t: lerp(INTRO + 1, Math.max(INTRO + 1.5, BATTLE_END - 1), (i + 1) / (loose.length + 1)), text: h }));
    caps.sort((a, b) => a.t - b.t);
    let prevEnd = 0;
    for (const c of caps) { c.t = Math.max(c.t, prevEnd); prevEnd = c.t + CAPTION_DUR; }
  }

  // ---------------------------------------------------------------- MVP
  const mvp = shipUnits.slice().sort((a, b) => (b.kills * 100 + b.dmg) - (a.kills * 100 + a.dmg))[0];

  // ---------------------------------------------------------------- DOM
  const when = ctx.live ? `Cycle ${report.turn} · Tick ${report.pulse}` : `Turn ${report.turn}${(report.day ?? 1) > 1 ? ` · Day ${report.day}` : ''}`;
  const overlay = el('div', 'bv-overlay');
  const panel = el('div', 'bv-panel');
  overlay.appendChild(panel);
  const head = el('div', 'bv-head');
  const title = el('div', 'bv-title',
    `<b>${esc(report.name)}</b><span>${esc(ctx.regionName(report.region))} · ${when} · ${report.sides.length} sides</span>`);
  const xBtn = el('button', 'bv-x', '×');
  xBtn.title = 'Close (Esc)';
  head.append(title, xBtn);
  const stage = el('div', 'bv-stage');
  const canvas = el('canvas');
  const caption = el('div', 'bv-caption');
  stage.append(canvas, caption);
  const ctrl = el('div', 'bv-ctrl');
  const bRestart = el('button', 'bv-btn', '⟲'); bRestart.title = 'Restart';
  const bPlay = el('button', 'bv-btn', '❚❚'); bPlay.title = 'Play / pause (Space)';
  const bNext = el('button', 'bv-btn', '▶|'); bNext.title = 'Next round (→)';
  const speedBox = el('div', 'bv-speed');
  const speedBtns = [1, 2, 4].map(v => { const b = el('button', 'bv-btn', `${v}×`); b.dataset.v = String(v); speedBox.appendChild(b); return b; });
  const roundLbl = el('div', 'bv-round');
  const bar = el('div', 'bv-bar', '<i></i><em></em>');
  const barFill = bar.querySelector('em') as HTMLElement;
  for (const rs of roundStart) { const tick = el('s'); tick.style.left = `${(rs / END) * 100}%`; bar.appendChild(tick); }
  const bSkip = el('button', 'bv-btn', 'Skip ⏭'); bSkip.title = 'Skip to the result';
  ctrl.append(bRestart, bPlay, bNext, speedBox, roundLbl, bar, bSkip);
  panel.append(head, stage, ctrl);

  // opening card
  const intro = el('div', 'bv-card');
  {
    const parts: string[] = [];
    sides.forEach((sd, i) => {
      const rs = report.sides[i];
      if (i > 0) parts.push('<div class="bv-vs">VS</div>');
      const fl = rs.fleets.map(f => `<p>${esc(f.name)} <span style="color:#9d8cc9">— ${esc(f.commander)}</span></p>`).join('');
      const g = rs.garrison ? `<small>Garrison · ${rs.garrison.hp} hp</small>` : '';
      parts.push(`<div class="bv-side" style="--c:${esc(sd.color)};animation-delay:${0.1 + i * 0.12}s"><h3>${esc(sd.name)}</h3>${fl}
        ${rs.ships.length ? `<small>${rs.ships.length} ship${rs.ships.length === 1 ? '' : 's'}</small>` : ''}${g}</div>`);
    });
    intro.innerHTML = `<div class="bv-card-in"><div class="bv-kicker">Engagement detected</div>
      <div class="bv-big">${esc(report.name)}</div>
      <div class="bv-sub">${esc(ctx.regionName(report.region))} · ${when}</div>
      <div class="bv-rule"></div><div class="bv-sides">${parts.join('')}</div>
      <div class="bv-hint">Tap to skip</div></div>`;
  }
  stage.appendChild(intro);

  // closing card
  const outro = el('div', 'bv-card bv-end');
  {
    const w = report.winner;
    let head: string, col = '#e8e0ff';
    const inBattle = ctx.you !== null && report.sides.some(sd => sd.owner === ctx.you);
    if (report.ongoing) head = 'The battle rages on';
    else if (w === null) head = 'No decision';
    else {
      col = ctx.playerColor(w);
      if (ctx.you !== null && w === ctx.you) head = 'Victory';
      else if (inBattle) { head = 'Defeat'; col = '#ff5d73'; }
      else head = `${ctx.playerName(w)} prevails`;
    }
    const sub = report.ongoing ? `Day ${report.day ?? 1} · ${report.totalRounds ?? report.rounds.length} rounds so far · it continues next ${ctx.live ? 'tick' : 'turn'}. Reinforcements can still turn it.`
      : w === null ? 'The field remains contested'
      : `<span style="color:${esc(ctx.playerColor(w))}">${esc(ctx.playerName(w))}${ctx.you === w ? ' (You)' : ''}</span> holds the field`;
    const rows = sides.map((sd, i) => {
      const rs = report.sides[i];
      const lost = report.losses[String(sd.owner)] ?? 0;
      const fled = sd.units.filter(u => u.retreatT < Infinity).length;
      const gar = rs.garrison ? (units.get(rs.garrison.id)!.deathT < Infinity ? 'Fallen' : `${Math.max(0, hpAt(units.get(rs.garrison.id)!, 1e9))} hp`) : '—';
      return `<tr><td style="color:${esc(sd.color)};text-shadow:0 0 8px ${esc(sd.color)}">${esc(sd.name)}</td><td>${rs.ships.length}</td><td>${lost}</td><td>${fled}</td><td>${gar}</td></tr>`;
    }).join('');
    const mvpHtml = mvp && (mvp.dmg > 0 || mvp.kills > 0)
      ? `<div class="bv-mvp"><small>★ Ship of the battle</small><b style="color:${esc(sides[mvp.side].color)}">${esc(mvp.name)}</b>
         <div style="font-size:11px;letter-spacing:.18em;color:#cbbfee;text-transform:uppercase">${esc(mvp.clsName)} · ${mvp.kills} kill${mvp.kills === 1 ? '' : 's'} · ${mvp.dmg} damage</div></div>`
      : '';
    const hl = report.highlights.length ? `<ul class="bv-hl">${report.highlights.map(h => `<li>${esc(h)}</li>`).join('')}</ul>` : '';
    outro.innerHTML = `<div class="bv-card-in"><div class="bv-kicker">${report.ongoing ? 'This turn' : 'Battle concluded'} · ${nRounds} round${nRounds === 1 ? '' : 's'}</div>
      <div class="bv-big" style="color:${esc(col)};text-shadow:0 0 22px ${esc(col)}">${esc(head)}</div><div class="bv-sub">${sub}</div>
      <div class="bv-rule"></div>
      <table><tr><th>Side</th><th>Ships</th><th>Lost</th><th>Fled</th><th>Garrison</th></tr>${rows}</table>
      ${mvpHtml}${hl}
      <div class="bv-endbtns"><button class="bv-btn" data-a="replay">⟲ Replay</button><button class="bv-btn" data-a="close">Close</button></div></div>`;
    outro.style.display = 'none';
  }
  stage.appendChild(outro);
  document.body.appendChild(overlay);

  // ---------------------------------------------------------------- state
  let T = 0, playing = true, speed = 1, raf = 0, last = performance.now(), closed = false;
  let W = 0, H = 0, dpr = 1;
  let mouse: { x: number; y: number } | null = null;
  const g = canvas.getContext('2d')!;
  let bg: HTMLCanvasElement | null = null;
  let farDist = 800;

  function hpAt(u: Unit, tt: number): number {
    let hp = u.startHp;
    for (const p of u.hpTl) { if (p.t <= tt) hp = p.hp; else break; }
    return hp;
  }
  const sysDown = (u: Unit, k: Sys, tt: number) => u.sysTl.some(x => x.sys === k && x.t <= tt);

  // ---------------------------------------------------------------- layout
  function layout() {
    // clientWidth/Height ignore CSS transforms: getBoundingClientRect() would return the size mid open-animation
    // (scale .94), leaving a blurry backing store and hover hit-tests offset from what is drawn
    W = Math.max(200, stage.clientWidth); H = Math.max(160, stage.clientHeight);
    // capped at 2 like the map: at 3x a full-screen phone canvas is 2.25x the pixels for no visible gain (47 ms -> ~25 ms frames)
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    farDist = Math.max(W, H) * 0.9;
    const n = sides.length;
    const portrait = H > W * 1.15;
    const mTop = 46, mBot = 84, mSide = 22;
    const cx = W / 2, cy = mTop + (H - mTop - mBot) / 2;
    const minD = Math.min(W - 2 * mSide, H - mTop - mBot);
    // per side: direction from centre (u), perpendicular (p)
    const dirs: P[] = [];
    for (let i = 0; i < n; i++) {
      let a: number;
      if (n === 1) a = Math.PI;
      else if (n === 2) a = portrait ? (i === 0 ? -Math.PI / 2 : Math.PI / 2) : (i === 0 ? Math.PI : 0);
      else a = -Math.PI * 5 / 6 + (i * 2 * Math.PI) / n;
      dirs.push([Math.cos(a), Math.sin(a)]);
    }
    const gapHalf = n === 2 ? (portrait ? H : W) * 0.09 : minD * 0.13;
    // front point of each side: on an ellipse so 3-way battles use the whole stage
    const gx = n >= 3 ? Math.max(gapHalf, (W - 2 * mSide) * 0.17) : gapHalf;
    // tall phone stages: spread the three fronts vertically instead of bunching them in the middle third
    const gy = n >= 3 ? Math.max(gapHalf * 0.8, (H - mTop - mBot) * (portrait ? 0.2 : 0.13)) : gapHalf;
    const frontPt = (u: P): P => [cx + u[0] * gx, cy + u[1] * gy];
    const frontDist = (u: P) => Math.hypot(u[0] * gx, u[1] * gy);
    const reach = (u: P) => {
      const [fx0, fy0] = frontPt(u);
      let tt = Infinity;
      if (u[0] > 1e-6) tt = Math.min(tt, (W - mSide - fx0) / u[0]);
      if (u[0] < -1e-6) tt = Math.min(tt, (mSide - fx0) / u[0]);
      if (u[1] > 1e-6) tt = Math.min(tt, (H - mBot - fy0) / u[1]);
      if (u[1] < -1e-6) tt = Math.min(tt, (mTop - fy0) / u[1]);
      return tt + frontDist(u);
    };
    const perpSpan = n === 2 ? (portrait ? W - 2 * mSide : H - mTop - mBot) * 0.82 : minD * 0.58;
    const planetR = clamp(minD * 0.075, 16, 46);
    // find a cell size that fits every side
    const fit = (cell: number, si: number) => {
      const sd = sides[si];
      const ships = sd.units.filter(u => !u.garrison).sort((a, b) => (GLYPH_SIZE[a.glyph] ?? 1) - (GLYPH_SIZE[b.glyph] ?? 1) || (a.fleet ?? 0) - (b.fleet ?? 0));
      const hasG = sd.units.some(u => u.garrison);
      const depth = reach(dirs[si]) - frontDist(dirs[si]) - (hasG ? planetR * 2.4 : 0);
      const cols: Unit[][] = [];
      let cur: Unit[] = [];
      for (const s of ships) {
        const f = GLYPH_SIZE[s.glyph] ?? 1;
        const cap = Math.max(1, Math.floor(perpSpan / (cell * Math.max(1, f * 0.8))));
        if (cur.length >= cap) { cols.push(cur); cur = []; }
        cur.push(s);
      }
      if (cur.length) cols.push(cur);
      const colDepth = cols.map(c => cell * Math.max(1, Math.max(...c.map(s => GLYPH_SIZE[s.glyph] ?? 1)) * 0.95));
      const total = colDepth.reduce((a, b) => a + b, 0);
      return { ok: total <= Math.max(cell, depth), cols, colDepth, depth };
    };
    let cell = clamp(minD * 0.11, 22, 70);
    for (let k = 0; k < 30; k++) {
      if (sides.every((_, si) => fit(cell, si).ok) || cell < 9) break;
      cell *= 0.9;
    }
    sides.forEach((sd, si) => {
      const u = dirs[si];
      const p: P = [-u[1], u[0]];
      const res = fit(cell, si);
      const fx = -u[0], fy = -u[1]; // facing the centre
      const fp = frontPt(u), fd = frontDist(u);
      const at = (dd: number, off: number): P => [fp[0] + u[0] * (dd - fd) + p[0] * off, fp[1] + u[1] * (dd - fd) + p[1] * off];
      const front = fd + cell * 0.45;
      let d = front;
      res.cols.forEach((col, ci) => {
        const cd = res.colDepth[ci];
        const dc = d + cd / 2 - cell * 0.45;
        const rows = col.length;
        const rowGap = Math.min(perpSpan / Math.max(1, rows), cell * Math.max(1, Math.max(...col.map(s => GLYPH_SIZE[s.glyph] ?? 1)) * 0.95));
        col.forEach((s, ri) => {
          const off = (ri - (rows - 1) / 2) * rowGap + (ci % 2 ? rowGap * 0.25 : 0);
          [s.hx, s.hy] = at(dc, off);
          s.fx = fx; s.fy = fy;
          s.s = cell * 0.36 * (GLYPH_SIZE[s.glyph] ?? 1);
        });
        d += cd;
      });
      const gu = sd.units.find(x => x.garrison);
      if (gu) {
        const gd = res.cols.length ? Math.min(d + planetR * 1.25, reach(u) - planetR * 0.6) : Math.max(fd + planetR * 1.4, Math.min(reach(u) * 0.6, fd + planetR * 2.5));
        [gu.hx, gu.hy] = at(gd, 0); gu.fx = fx; gu.fy = fy; gu.s = planetR;
      }
      // label above the side's bounding box
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const x of sd.units) { minX = Math.min(minX, x.hx - x.s); maxX = Math.max(maxX, x.hx + x.s); minY = Math.min(minY, x.hy - x.s); maxY = Math.max(maxY, x.hy + x.s); }
      if (!sd.units.length) { minX = maxX = cx + u[0] * gapHalf * 2; minY = maxY = cy + u[1] * gapHalf * 2; }
      if (u[1] > 0.5) {
        // bottom side: label beside the formation, clear of the caption bar
        g.font = `600 11px ${FONT}`; setLs(g, '0.24em');
        const tw = g.measureText(sd.name.toUpperCase()).width + 8;
        setLs(g, '0px');
        if (maxX + 16 + tw < W) sd.label = { x: maxX + 16, y: (minY + maxY) / 2, align: 'left' };
        else if (minX - 16 - tw > 0) sd.label = { x: minX - 16, y: (minY + maxY) / 2, align: 'right' };
        // no room beside it: below the formation (above it, the label collides with damage / crit callouts)
        else sd.label = { x: clamp((minX + maxX) / 2, tw / 2 + 4, W - tw / 2 - 4), y: Math.min(H - mBot + 12, Math.max(maxY + 26, gu ? gu.hy + gu.s * 1.55 + 36 : 0)), align: 'center' };
      } else {
        sd.label = { x: clamp((minX + maxX) / 2, 90, W - 90), y: clamp(minY - 18, mTop + 4, H), align: 'center' };
      }
    });
    buildBg();
  }

  function buildBg() {
    // the skirmish mat: deep-space cloth with a printed nebula tinted by the combatants, a fine weave, printed stars,
    // a faint range grid, and the lamp's warm pool with a dark vignette
    bg = document.createElement('canvas');
    bg.width = canvas.width; bg.height = canvas.height;
    const b = bg.getContext('2d')!;
    b.scale(dpr, dpr);
    b.drawImage(matBackdrop(W, H), 0, 0, W, H);
    const rnd = artRand(report.id * 101 + 5);
    // printed nebula: low-res fbm, coloured from the sides
    {
      const S = 5, nw = Math.ceil(W / S), nh = Math.ceil(H / S);
      const nc = document.createElement('canvas'); nc.width = nw; nc.height = nh;
      const ng = nc.getContext('2d')!;
      const img = ng.createImageData(nw, nh);
      const cols = sides.map(sd => artMix(artRgb(sd.color), [40, 30, 90], 0.55));
      while (cols.length < 2) cols.push([60, 40, 140]);
      const seed = report.id * 13 + 7;
      for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
        const n = fbm2(x / 46, y / 46, 5, seed), m = fbm2(x / 30 + 9, y / 30, 3, seed + 3), d = fbm2(x / 18, y / 18, 3, seed + 5);
        const c = artMix(cols[0], cols[1 % cols.length], Math.max(0, Math.min(1, m * 1.6 - 0.3)));
        let a = Math.max(0, n - 0.42) * 1.9 * (1 - Math.max(0, d - 0.55) * 2.2);
        a = Math.max(0, Math.min(0.55, a));
        const i = (y * nw + x) * 4;
        img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = a * 255;
      }
      ng.putImageData(img, 0, 0);
      b.imageSmoothingQuality = 'high';
      b.drawImage(nc, 0, 0, W, H);
    }
    b.globalAlpha = 0.85; b.drawImage(starfield(Math.ceil(W), Math.ceil(H), report.id), 0, 0, W, H); b.globalAlpha = 1;
    for (let i = 0; i < 6; i++) {
      const x = rnd() * W, y = rnd() * H;
      b.fillStyle = 'rgba(235,240,255,0.8)'; b.fillRect(x, y, 1.4, 1.4);
      b.strokeStyle = 'rgba(220,225,255,.28)'; b.lineWidth = 0.6;
      b.beginPath(); b.moveTo(x - 6, y + 0.7); b.lineTo(x + 7.4, y + 0.7); b.moveTo(x + 0.7, y - 6); b.lineTo(x + 0.7, y + 7.4); b.stroke();
    }
    // the cloth's weave
    const pat = b.createPattern(weaveTile(), 'repeat');
    if (pat) { b.save(); b.globalCompositeOperation = 'overlay'; b.globalAlpha = 0.22; b.fillStyle = pat; b.fillRect(0, 0, W, H); b.restore(); }
    // a faint printed range grid (hexes would be busier; a fine square grid reads as a game mat)
    b.strokeStyle = 'rgba(190,200,255,0.035)'; b.lineWidth = 1;
    const step = 56;
    b.beginPath();
    for (let x = (W / 2) % step; x < W; x += step) { b.moveTo(x, 0); b.lineTo(x, H); }
    for (let y = (H / 2) % step; y < H; y += step) { b.moveTo(0, y); b.lineTo(W, y); }
    b.stroke();
    b.drawImage(lampOverlay(W, H), 0, 0, W, H);
  }

  // ---------------------------------------------------------------- positions
  interface Pose { x: number; y: number; a: number; warp: number }
  function pose(u: Unit, tt: number): Pose {
    let x = u.hx, y = u.hy, a = 1, warp = 0;
    if (!u.garrison) {
      const w = clamp((tt - 0.2 - u.delay) / 1.0);
      const e = 1 - Math.pow(1 - w, 3);
      const off = (1 - e) * farDist * 0.7;
      x -= u.fx * off; y -= u.fy * off;
      a *= clamp(w * 3);
      warp = 1 - e;
      x += Math.sin(tt * 1.3 + u.seed * 40) * 1.4;
      y += Math.cos(tt * 1.05 + u.seed * 23) * 1.4;
      if (tt > u.retreatT) {
        const r = clamp((tt - u.retreatT) / RETREAT_DUR);
        const ease = r * r * r;
        x -= u.fx * ease * farDist; y -= u.fy * ease * farDist;
        a *= 1 - clamp((r - 0.6) / 0.4);
        warp = Math.max(warp, r * 0.8);
      }
      if (tt > u.deathT) a *= 1 - clamp((tt - u.deathT) / 0.22);
      // hits jolt the hull back, away from the enemy line
      if (!reduced) for (const h of u.hits) {
        const e = tt - h.t;
        if (e < 0 || e > 0.3) continue;
        const k = Math.min(7, 1.5 + h.dmg * 0.5) * (1 - e / 0.3) ** 2;
        x -= u.fx * k; y -= u.fy * k;
      }
    }
    return { x, y, a, warp };
  }
  const angleOf = (u: Unit, tt: number) => {
    let ang = Math.atan2(u.fy, u.fx);
    if (tt > u.retreatT) ang += Math.PI * clamp((tt - u.retreatT) / 0.45) * (u.seed > 0.5 ? 1 : -1);
    return ang;
  };
  function muzzle(u: Unit, tt: number, idx: number): P {
    const p = pose(u, tt);
    if (u.garrison) {
      const ang = mulberry(idx * 17 + 3)() * Math.PI * 2;
      return [p.x + Math.cos(ang) * u.s * 1.35, p.y + Math.sin(ang) * u.s * 1.35];
    }
    const ang = angleOf(u, tt) + Math.PI / 2;
    const gp = gunPoints(u.cls, u.owner, sides[u.side].color, p.x, p.y, shipLen(u), ang);
    const q = gp[idx % gp.length];
    return [q[0], q[1]];
  }

  // ---------------------------------------------------------------- drawing
  const shipLen = (u: Unit) => u.s * 2.6;
  /** A unit's miniature: its base on the mat, the clear stand, the painted hull (lit by the lamp), plumes, damage. */
  function drawShip(u: Unit, tt: number, color: string) {
    const ps = pose(u, tt);
    if (ps.a <= 0.01) return;
    if (tt > u.deathT) return; // the wreck takes over
    const ang = angleOf(u, tt) + Math.PI / 2;
    const L = shipLen(u);
    const hpNow = hpAt(u, tt);
    const recent = u.hits.reduce((m, h) => (h.t <= tt && tt - h.t < 0.16 ? Math.max(m, 1 - (tt - h.t) / 0.16) : m), 0);
    const dying = tt >= u.deathT - 0.6 && hpNow <= 0;
    const alpha = ps.a * (dying ? 0.7 + 0.3 * Math.sin(tt * 60) : 1);
    const stand = L * 0.32;
    const engOn = !sysDown(u, 'engines', tt) && hpNow > 0;
    // warp streak while arriving / leaving
    if (ps.warp > 0.05) {
      const eng = scheme(u.owner, color).engine;
      g.save(); g.globalCompositeOperation = 'lighter';
      g.strokeStyle = artCss(eng, 0.5 * ps.warp * ps.a); g.lineWidth = Math.max(1, L * 0.12);
      const dx = -Math.cos(ang - Math.PI / 2), dy = -Math.sin(ang - Math.PI / 2);
      g.beginPath(); g.moveTo(ps.x, ps.y); g.lineTo(ps.x + dx * L * 5 * ps.warp, ps.y + dy * L * 5 * ps.warp); g.stroke();
      g.restore();
    }
    g.save();
    g.globalAlpha = alpha * (1 - ps.warp * 0.6);
    drawBase(g, ps.x, ps.y + stand, L * 0.34, L * 0.34 * dpr, color, { big: true });
    drawStand(g, ps.x, ps.y + stand, ps.y + L * 0.05, Math.max(1, L * 0.05));
    g.restore();
    g.save();
    g.globalAlpha = alpha;
    drawShip3(u, ps.x, ps.y, L, ang, color, { shadow: { dx: stand * 0.3, dy: stand * 0.95, alpha: 0.4 }, engine: engOn ? 0.45 + ps.warp * 1.4 : 0, flash: recent * 0.8 });
    g.restore();
    if (sysDown(u, 'weapons', tt)) {
      g.strokeStyle = 'rgba(255,90,90,.9)'; g.lineWidth = 1.4;
      const k = L * 0.12;
      g.beginPath(); g.moveTo(ps.x - k, ps.y - k); g.lineTo(ps.x + k, ps.y + k); g.moveTo(ps.x + k, ps.y - k); g.lineTo(ps.x - k, ps.y + k); g.stroke();
    }
    // damage: smoke trailing off a hurt hull, sparks crawling over it
    if (hpNow > 0 && hpNow / u.maxHp < 0.5 && tt < u.retreatT) {
      for (let i = 0; i < 2; i++) {
        const life = 1.4, k = ((tt + u.seed * 3 + i * 0.7) % life) / life;
        smoke(g, ps.x + (u.seed - 0.5) * L * 0.4 - k * L * 0.25, ps.y - k * L * 0.5, L * (0.18 + k * 0.35), 0.45 * (1 - k) * ps.a);
      }
      const rnd = mulberry(u.id * 97 + Math.floor(tt * 12));
      for (let i = 0; i < 2; i++) drawGlow(g, ps.x + (rnd() - 0.5) * L * 0.5, ps.y + (rnd() - 0.5) * L * 0.4, 2 + rnd() * 3, [255, 170, 80], 0.8);
    }
    // hp bar + name
    if (ps.a > 0.2 && hpNow > 0) {
      const bw = Math.max(18, L * 0.8), by = ps.y + stand + L * 0.4 * BASE_SQUASH + 5;
      drawHpBar(ps.x - bw / 2, by, bw, 2.5, hpNow / u.maxHp, ps.a, color, lagHp(u, tt) / u.maxHp);
      const large = u.glyph === 'dread' || u.glyph === 'long' || shipUnits.length <= 8;
      if (large) {
        g.globalAlpha = ps.a * 0.8;
        g.font = `600 ${clamp(L * 0.16, 9, 11)}px ${FONT}`;
        g.textAlign = 'center'; g.textBaseline = 'top';
        g.fillStyle = '#e4dcc8';
        setLs(g, '0.1em');
        g.fillText(u.name.toUpperCase(), ps.x, by + 5);
        setLs(g, '0px');
        g.globalAlpha = 1;
      }
    }
  }
  function drawShip3(u: Unit, x: number, y: number, L: number, ang: number, color: string, o: ShipOpts) {
    drawShipArt(g, x, y, L, L * dpr, u.cls, u.owner, color, ang, o);
  }

  function drawHpBar(x: number, y: number, w: number, h: number, frac: number, a: number, color: string, lag?: number) {
    g.globalAlpha = a;
    g.fillStyle = 'rgba(255,255,255,.12)';
    g.fillRect(x, y, w, h);
    const f = clamp(frac);
    // recent damage lingers as a white chunk that drains away
    if (lag !== undefined && lag > f) { g.fillStyle = 'rgba(255,240,220,.85)'; g.fillRect(x + w * f, y, w * (clamp(lag) - f), h); }
    g.fillStyle = f > 0.6 ? color : f > 0.3 ? '#ffb347' : '#ff4b5c';
    g.fillRect(x, y, w * f, h);
    g.globalAlpha = 1;
  }

  const WORLDS: WorldType[] = ['terran', 'desert', 'ocean', 'garden', 'ice', 'lava', 'barren', 'toxic'];
  const worldBody = { type: WORLDS[Math.abs(report.region) % WORLDS.length], seed: Math.abs(report.region * 7919) % 100000, dev: 3 };
  /** The defended world: a painted planet with its orbital gun platforms; it burns when the garrison falls. */
  function drawGarrison(u: Unit, tt: number, color: string) {
    const { x, y } = pose(u, tt);
    const r = u.s;
    const hpNow = hpAt(u, tt);
    const dead = tt >= u.deathT || hpNow <= 0;
    const recent = u.hits.some(h => h.t <= tt && tt - h.t < 0.14);
    drawBodyShadow(g, x + r * 0.45, y + r * 0.9, r * 1.2, 0.55);
    // the owner's colour as a faint halo of territory
    drawGlow(g, x, y, r * 2.2, artRgb(color), dead ? 0.08 : 0.22, 0);
    // orbital batteries behind the world (upper half), then the world, then the near ones
    const n = 6, rot = reduced ? 0 : tt * 0.18;
    const plats = Array.from({ length: n }, (_, i) => { const a = rot + (i / n) * Math.PI * 2; return { a, x: x + Math.cos(a) * r * 1.5, y: y + Math.sin(a) * r * 0.55, front: Math.sin(a) > 0 }; });
    const live = (i: number) => !dead || i % 3 !== 0;
    const ps = Math.max(5, r * 0.2);
    for (let i = 0; i < n; i++) if (!plats[i].front && live(i)) drawStructure(g, 'battery', color, plats[i].x, plats[i].y, ps, ps * dpr);
    drawPlanet(g, x, y, r, r * dpr, worldBody);
    if (recent) drawGlow(g, x, y, r * 1.3, [255, 255, 255], 0.25);
    if (dead) {
      // the fall: fires across the night side, a pall of smoke
      g.save(); g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.clip();
      g.fillStyle = 'rgba(20,6,4,0.45)'; g.fillRect(x - r, y - r, r * 2, r * 2);
      const rnd = mulberry(u.id * 13 + 5);
      for (let i = 0; i < 9; i++) drawGlow(g, x + (rnd() - 0.4) * r * 1.4, y + (rnd() - 0.3) * r * 1.4, r * (0.12 + rnd() * 0.15), [255, 120, 40], 0.6 + 0.4 * Math.sin(tt * 6 + i));
      g.restore();
      for (let i = 0; i < 3; i++) { const k = ((tt * 0.4 + i / 3) % 1); smoke(g, x + (i - 1) * r * 0.5, y - r * 0.4 - k * r, r * (0.4 + k * 0.6), 0.5 * (1 - k)); }
    }
    for (let i = 0; i < n; i++) if (plats[i].front && live(i)) drawStructure(g, 'battery', color, plats[i].x, plats[i].y, ps, ps * dpr);
    // hp + label
    const bw = r * 2.4, by = y + r * 1.55 + 6;
    if (!dead) drawHpBar(x - bw / 2, by, bw, 3, hpNow / u.maxHp, 1, color, lagHp(u, tt) / u.maxHp);
    g.font = `600 10px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'top';
    g.fillStyle = dead ? 'rgba(255,120,120,.85)' : rgba(color, 0.95);
    setLs(g, '0.22em');
    g.fillText(dead ? 'GARRISON FALLEN' : `GARRISON ${Math.max(0, hpNow)}`, x, by + 6);
    setLs(g, '0px');
  }

  /** HP shown by the draining "recent damage" chunk: holds briefly after a hit, then eases down to the real value. */
  function lagHp(u: Unit, tt: number): number {
    const now = hpAt(u, tt), then = hpAt(u, tt - 0.55);
    if (then <= now) return now;
    const last = u.hits.reduce((m, h) => (h.t <= tt && h.t > m ? h.t : m), -Infinity);
    const k = clamp((tt - last - 0.25) / 0.3);
    return then + (now - then) * k;
  }

  function setLs(c: CanvasRenderingContext2D, v: string) {
    (c as unknown as { letterSpacing?: string }).letterSpacing = v;
  }

  /** Weapon fire in each house's style: Azure lances (instant beams), Crimson broadsides (shell salvos from the
   *  flank batteries), Gilded plasma (slow glowing bolts), Warden arcs, garrison flak; shield shimmer, impacts. */
  function drawShots(tt: number) {
    g.save();
    for (const sh of shots) {
      if (tt < sh.t0 - 0.2 || tt > sh.t1 + 1.0) continue;
      const color = sides[sh.from.side].color;
      const S = scheme(sh.from.owner, color);
      const style = sh.from.garrison ? 'flak' : S.faction;
      const A = muzzle(sh.from, sh.t0, sh.idx);
      const tp = pose(sh.to, Math.min(tt, sh.t1));
      let B: P = [tp.x, tp.y];
      const heavy = sh.from.garrison || sh.from.glyph === 'dread' || sh.from.glyph === 'long';
      if (sh.rec.miss) {
        const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1;
        const px = -dy / L, py = dx / L;
        const side = sh.off >= 0 ? 1 : -1;
        const m = sh.to.s * (1.4 + Math.abs(sh.off)) * side;
        B = [B[0] + px * m + dx * 0.8, B[1] + py * m + dy * 0.8];
      }
      const wcol = S.weapon;
      const w = heavy ? 2.2 : 1.5;
      if (style === 'azure' || style === 'warden' || style === 'neutral') {
        // lance: charges, fires for an instant, fades
        const e = tt - (sh.t1 - 0.1);
        if (e > -0.1 && e < 0) drawGlow(g, A[0], A[1], 4 + 6 * (1 + e / 0.1), wcol, 0.8);
        if (e >= 0 && e < 0.28) beam(g, A[0], A[1], B[0], B[1], wcol, w, 1 - e / 0.28);
      } else {
        const salvo = style === 'crimson' ? 3 : 1;
        const travel = style === 'gilded' ? TRAVEL * 1.25 : TRAVEL;
        for (let k = 0; k < salvo; k++) {
          const t0 = sh.t1 - travel - k * 0.05;
          const dur = sh.rec.miss ? travel * 1.8 : travel;
          const p = (tt - t0) / dur;
          if (p < 0 || p > 1.05) continue;
          const jx = (k - 1) * sh.from.s * 0.25, jy = (k - 1) * sh.from.s * 0.12;
          const a0: P = [A[0] + jx, A[1] + jy], b0: P = [B[0] + jx * 0.3, B[1] + jy * 0.3];
          const hx = lerp(a0[0], b0[0], clamp(p)), hy = lerp(a0[1], b0[1], clamp(p));
          const fade = sh.rec.miss ? 1 - clamp((p - 0.6) / 0.5) : 1;
          if (style === 'gilded') { drawGlow(g, hx, hy, 6 + w * 2, wcol, fade); drawGlow(g, lerp(a0[0], b0[0], clamp(p - 0.08)), lerp(a0[1], b0[1], clamp(p - 0.08)), 4, wcol, 0.5 * fade); }
          else tracer(g, lerp(a0[0], b0[0], clamp(p - 0.18)), lerp(a0[1], b0[1], clamp(p - 0.18)), hx, hy, style === 'flak' ? [255, 214, 140] : wcol, w, fade);
          // muzzle flash and a puff of gun smoke at the battery
          const mf = (tt - t0) / 0.12;
          if (mf >= 0 && mf <= 1) drawGlow(g, a0[0], a0[1], 5 + w * 3, wcol, 1 - mf);
          const ms = (tt - t0) / 0.9;
          if (ms > 0 && ms < 1 && style === 'crimson') smoke(g, a0[0] + ms * 4, a0[1] - ms * 6, 3 + ms * 7, 0.35 * (1 - ms));
        }
      }
      // impact
      if (!sh.rec.miss) {
        const ip = (tt - sh.t1) / 0.42;
        if (ip >= 0 && ip <= 1) {
          const shielded = sh.to.shields > 0 && !sysDown(sh.to, 'shields', sh.t1 - 0.001) && !sh.to.garrison;
          const ix = B[0] + (sh.off * sh.to.s * 0.3), iy = B[1] + (sh.off * 0.6 * sh.to.s * 0.3);
          if (shielded) {
            const tp2 = pose(sh.to, tt);
            shieldHit(g, tp2.x, tp2.y, shipLen(sh.to) * 0.62, Math.atan2(A[1] - tp2.y, A[0] - tp2.x), [130, 210, 255], 1 - ip);
          }
          const rr = (sh.to.garrison ? sh.to.s * 0.22 : Math.max(5, sh.to.s * 0.55)) + sh.rec.dmg * 0.5;
          if (sh.to.garrison) {
            g.save(); g.beginPath(); g.arc(tp.x, tp.y, sh.to.s, 0, Math.PI * 2); g.clip();
            fireball(g, ix, iy, rr * (sh.rec.crit ? 1.5 : 1), ip, 1);
            g.restore();
          } else fireball(g, ix, iy, rr * (sh.rec.crit ? 1.5 : 1) * (shielded ? 0.6 : 1), ip, 1);
          const rnd = mulberry(sh.idx * 13 + 1);
          g.save(); g.globalCompositeOperation = 'lighter';
          g.strokeStyle = `rgba(255,220,170,${1 - ip})`; g.lineWidth = 1;
          g.beginPath();
          for (let i = 0; i < 4; i++) {
            const a = rnd() * Math.PI * 2, d0 = rr * 0.3, d1 = rr * (0.8 + rnd() * 1.2) * (0.5 + ip);
            g.moveTo(ix + Math.cos(a) * d0, iy + Math.sin(a) * d0); g.lineTo(ix + Math.cos(a) * d1, iy + Math.sin(a) * d1);
          }
          g.stroke(); g.restore();
        }
      }
    }
    g.restore();
  }

  /** The hull breaks: a fireball and shockwave, then three charred pieces drift apart, smouldering — the wreck stays
   *  on the table until the end of the battle. Garrisons get a bigger blast. */
  const PIECES: P[][] = [
    [[-0.32, -0.62], [0.32, -0.62], [0.3, -0.1], [0.05, -0.02], [-0.12, -0.14], [-0.3, -0.05]],
    [[-0.3, -0.05], [-0.12, -0.14], [0.05, -0.02], [0.3, -0.1], [0.32, 0.2], [0.02, 0.26], [-0.32, 0.18]],
    [[-0.32, 0.18], [0.02, 0.26], [0.32, 0.2], [0.34, 0.68], [-0.34, 0.68]],
  ];
  function drawWrecks(tt: number) {
    for (const u of units.values()) {
      if (u.garrison || u.deathT === Infinity || tt < u.deathT) continue;
      const e = tt - u.deathT;
      const color = sides[u.side].color;
      const ps = pose(u, u.deathT - 0.001);
      const L = shipLen(u);
      const ang = angleOf(u, u.deathT - 0.001) + Math.PI / 2;
      const rnd = mulberry(u.id * 31 + 7);
      PIECES.forEach((poly, i) => {
        const dir = ang - Math.PI / 2 + (i - 1) * 1.2 + (rnd() - 0.5) * 0.9;
        const sp = L * (0.35 + rnd() * 0.45);
        const d = sp * (1 - Math.exp(-1.4 * e)) + e * L * 0.015;
        const spin = (rnd() - 0.5) * 1.6 * (1 - Math.exp(-0.8 * e)) * 2;
        const x = ps.x + Math.cos(dir) * d, y = ps.y + Math.sin(dir) * d;
        g.save();
        g.translate(x, y); g.rotate(ang + spin);
        g.beginPath(); poly.forEach((q, j) => (j ? g.lineTo(q[0] * L, q[1] * L) : g.moveTo(q[0] * L, q[1] * L))); g.closePath();
        g.save(); g.clip();
        drawShipArt(g, 0, 0, L, L * dpr, u.cls, u.owner, color, 0, { alpha: 0.95, char: Math.min(0.85, 0.35 + e * 0.3) });
        g.restore();
        g.restore();
        // the broken edge glows, then cools; smoke curls off it
        const cool = Math.max(0, 1 - e / 3.5);
        if (cool > 0) drawGlow(g, x, y, L * 0.2, [255, 130, 50], 0.7 * cool);
        if (!reduced) { const k = ((e * 0.5 + i * 0.33) % 1); smoke(g, x - k * 6, y - k * L * 0.5, L * (0.12 + k * 0.3), 0.3 * (1 - k) * Math.max(0.3, cool)); }
      });
    }
  }
  function drawExplosions(tt: number) {
    for (const u of units.values()) {
      if (u.deathT === Infinity) continue;
      const e = tt - u.deathT;
      if (e < 0 || e > 2.2) continue;
      const color = sides[u.side].color;
      const ps = pose(u, u.deathT - 0.001);
      const size = u.garrison ? u.s * 1.1 : shipLen(u) * 0.55;
      if (e < 1.1) fireball(g, ps.x, ps.y, size * 1.3, e / 1.1, 1);
      if (e < 0.25) drawGlow(g, ps.x, ps.y, size * (3 + 6 * e), [255, 240, 210], 1 - e / 0.25);
      if (e < 0.9) {
        const k = e / 0.9;
        g.save(); g.globalCompositeOperation = 'lighter';
        const rr = size * (1 + 2.6 * (1 - (1 - k) ** 2));
        g.strokeStyle = rgba(color, 0.55 * (1 - k) ** 2); g.lineWidth = 2 * (1 - k) + 0.5;
        g.beginPath(); g.ellipse(ps.x, ps.y, rr, rr * 0.55, 0, 0, Math.PI * 2); g.stroke();
        g.restore();
      }
      // embers
      const rnd = mulberry(u.id * 7 + 99);
      const n = 10 + Math.round(size / 2.5);
      g.save(); g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2, sp = size * (1 + rnd() * 6);
        const d = sp * (1 - Math.exp(-3 * e));
        const k = clamp(e / (0.8 + rnd() * 1.2));
        if (k >= 1) continue;
        g.fillStyle = `rgba(255,${160 + rnd() * 90 | 0},90,${1 - k})`;
        g.beginPath(); g.arc(ps.x + Math.cos(a) * d, ps.y + Math.sin(a) * d, 0.8 + rnd(), 0, Math.PI * 2); g.fill();
      }
      g.restore();
    }
  }

  function drawTexts(tt: number) {
    g.save();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    // status callouts (DESTROYED / WEAPONS OFFLINE / SHIELDS DOWN...) never overprint: each takes the first free
    // row above its ship, stepping up until it clears the ones already placed this frame
    const placed: { l: number; r: number; t: number; b: number }[] = [];
    const slot = (x: number, y: number, w: number, h: number): number => {
      for (let i = 0; i < 6; i++) {
        const yy = y - i * (h + 3);
        const box = { l: x - w / 2 - 4, r: x + w / 2 + 4, t: yy - h / 2, b: yy + h / 2 };
        if (!placed.some(p => box.l < p.r && box.r > p.l && box.t < p.b && box.b > p.t)) { placed.push(box); return yy; }
      }
      return y;
    };
    for (const sh of shots) {
      if (sh.rec.miss || tt < sh.t1 || tt > sh.t1 + 1.8) continue;
      const e = tt - sh.t1;
      const tp = pose(sh.to, sh.t1);
      const top = tp.y - (sh.to.garrison ? sh.to.s * 1.3 : Math.max(sh.to.s, 8)) - 6;
      if (e < 1.1) {
        const k = e / 1.1;
        g.globalAlpha = 1 - k * k;
        g.font = `700 ${12 + Math.min(6, sh.rec.dmg * 0.6)}px ${FONT}`;
        g.lineWidth = 3; g.strokeStyle = 'rgba(8,2,20,.85)';
        const x = tp.x + sh.off * 10, y = top - k * 22;
        g.strokeText(`-${sh.rec.dmg}`, x, y);
        g.fillStyle = sh.rec.kill ? '#ff6b6b' : '#fff';
        g.fillText(`-${sh.rec.dmg}`, x, y);
      }
      if (sh.rec.crit || sh.rec.kill) {
        const k = e / 1.8;
        const pop = e < 0.12 ? 1.4 - (e / 0.12) * 0.4 : 1;
        g.globalAlpha = 1 - clamp((k - 0.6) / 0.4);
        const txt = sh.rec.kill ? 'DESTROYED' : CRIT_TEXT[sh.rec.crit!] ?? 'CRITICAL';
        g.font = `700 ${Math.round(11 * pop)}px ${FONT}`;
        setLs(g, '0.2em');
        const y = slot(tp.x, top - 18 - k * 14, g.measureText(txt).width, 14);
        g.lineWidth = 3; g.strokeStyle = 'rgba(8,2,20,.9)';
        g.strokeText(txt, tp.x, y);
        g.shadowColor = sh.rec.kill ? '#ff3355' : '#ff9f1a'; g.shadowBlur = 10;
        g.fillStyle = sh.rec.kill ? '#ff8095' : '#ffc061';
        g.fillText(txt, tp.x, y);
        g.shadowBlur = 0;
        setLs(g, '0px');
      }
    }
    // garrison fall callout
    for (const u of units.values()) {
      if (!u.garrison || u.deathT === Infinity) continue;
      const e = tt - u.deathT;
      if (e < 0 || e > 2.2) continue;
      g.globalAlpha = 1 - clamp((e - 1.6) / 0.6);
      g.font = `700 14px ${FONT}`; setLs(g, '0.3em');
      g.fillStyle = '#ff8095'; g.shadowColor = '#ff3355'; g.shadowBlur = 12;
      g.fillText('GARRISON FALLS', u.hx, slot(u.hx, u.hy - u.s * 1.7 - 8, g.measureText('GARRISON FALLS').width, 16));
      g.shadowBlur = 0; setLs(g, '0px');
    }
    // retreat callouts
    for (const r of retreatsAt) {
      const e = tt - r.t;
      if (e < 0 || e > 1.8) continue;
      const sd = sides.find(s => s.owner === r.owner);
      const fu = shipUnits.find(u => u.fleet === r.fleet);
      if (!sd || !fu) continue;
      g.globalAlpha = 1 - clamp((e - 1.2) / 0.6);
      g.font = `700 12px ${FONT}`; setLs(g, '0.28em');
      g.fillStyle = '#e8e0ff'; g.shadowColor = sd.color; g.shadowBlur = 10;
      const fn = (fleetName.get(r.fleet)?.name ?? 'Fleet').toUpperCase();
      { const rx = clamp(fu.hx, 90, W - 90); g.fillText(`${fn} RETREATS`, rx, slot(rx, clamp(fu.hy - 40, 60, H - 60), g.measureText(`${fn} RETREATS`).width, 15)); }
      g.shadowBlur = 0; setLs(g, '0px');
    }
    g.restore();
  }

  function drawHud(tt: number) {
    // round banner
    const ri = currentRound(tt);
    if (ri >= 0) {
      const e = tt - roundStart[ri];
      if (e < 1.2) {
        const a = e < 0.15 ? e / 0.15 : 1 - clamp((e - 0.7) / 0.5);
        g.save();
        g.globalAlpha = a;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        // narrow stages: keep the banner below the strength readout in the top-left corner
        const y = W < 700 ? Math.max(Math.min(H * 0.18, 70), 14 + sides.length * 22 + 16) : Math.min(H * 0.18, 70);
        g.font = `600 ${clamp(W * 0.03, 15, 24)}px ${FONT}`;
        setLs(g, '0.5em');
        g.fillStyle = '#f4ead2'; g.shadowColor = 'rgba(214,166,80,0.9)'; g.shadowBlur = 14;
        g.fillText(`ROUND ${ri + 1}`, W / 2 + 6, y);
        g.shadowBlur = 0; setLs(g, '0px');
        const lw = 60 + 60 * clamp(e / 0.4);
        g.strokeStyle = 'rgba(214,178,110,.7)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(W / 2 - lw - 70, y); g.lineTo(W / 2 - 80, y); g.moveTo(W / 2 + 80, y); g.lineTo(W / 2 + lw + 70, y); g.stroke();
        g.restore();
      }
    }
    // side labels
    g.save();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const sd of sides) {
      g.font = `600 11px ${FONT}`; setLs(g, '0.24em');
      g.fillStyle = sd.color; g.shadowColor = sd.color; g.shadowBlur = 8;
      g.globalAlpha = clamp((tt - 0.4) / 0.6) * 0.95;
      g.textAlign = sd.label.align;
      g.fillText(sd.name.toUpperCase(), sd.label.x, sd.label.y);
      g.shadowBlur = 0;
    }
    setLs(g, '0px');
    g.restore();
    // strength readout (top-left)
    g.save();
    g.textBaseline = 'middle'; g.textAlign = 'left';
    let y = 14;
    for (const sd of sides) {
      let hp = 0, mx = 0, alive = 0, total = 0;
      for (const u of sd.units) {
        const h = Math.max(0, hpAt(u, tt));
        const gone = tt >= u.retreatT + RETREAT_DUR * 0.6;
        mx += u.startHp;
        if (!gone) hp += h;
        if (!u.garrison) { total++; if (h > 0 && !gone) alive++; }
      }
      g.fillStyle = sd.color;
      g.beginPath(); g.moveTo(12, y - 3); g.lineTo(15, y); g.lineTo(12, y + 3); g.lineTo(9, y); g.closePath(); g.fill();
      g.font = `600 9.5px ${FONT}`; setLs(g, '0.18em');
      g.fillStyle = 'rgba(230,220,255,.85)';
      let label = sd.name.toUpperCase();
      const lw = Math.min(170, W * 0.32);
      while (label.length > 3 && g.measureText(label).width > lw - 26) label = label.slice(0, -2).trimEnd() + '…';
      g.fillText(label, 20, y);
      setLs(g, '0px');
      g.fillStyle = 'rgba(190,175,230,.8)';
      g.textAlign = 'right';
      g.fillText(total ? `${alive}/${total}` : '', 20 + lw, y);
      g.textAlign = 'left';
      drawHpBar(20, y + 7, lw, 2, mx ? hp / mx : 0, 0.9, sd.color);
      y += 22;
    }
    g.restore();
  }

  function drawHover(tt: number) {
    if (!mouse) return;
    // hit-test in the camera's space, draw the tooltip in it too
    const mouse0 = mouse;
    const m = { x: (mouse0.x - camX) / camK, y: (mouse0.y - camY) / camK };
    g.save(); g.translate(camX, camY); g.scale(camK, camK);
    try { hoverAt(tt, m); } finally { g.restore(); }
  }
  function hoverAt(tt: number, mouse: { x: number; y: number }) {
    let best: Unit | null = null, bd = Infinity;
    for (const u of units.values()) {
      const ps = pose(u, tt);
      if (ps.a < 0.3 || (tt > u.deathT && !u.garrison)) continue;
      const d = Math.hypot(ps.x - mouse.x, ps.y - mouse.y);
      const r = (u.garrison ? u.s * 1.4 : Math.max(u.s, 10)) + 6;
      if (d < r && d < bd) { bd = d; best = u; }
    }
    if (!best) { canvas.style.cursor = 'default'; return; }
    canvas.style.cursor = 'pointer';
    const u = best, ps = pose(u, tt), color = sides[u.side].color;
    g.save();
    g.strokeStyle = rgba(color, 0.8); g.setLineDash([3, 3]); g.lineWidth = 1;
    g.beginPath(); g.arc(ps.x, ps.y, (u.garrison ? u.s * 1.5 : Math.max(u.s * 1.2, 9)) + 3, 0, Math.PI * 2); g.stroke();
    g.setLineDash([]);
    const fl = u.fleet !== null ? fleetName.get(u.fleet) : undefined;
    const sys = (['engines', 'weapons', 'shields'] as Sys[]).filter(k => sysDown(u, k, tt)).map(k => CRIT_TEXT[k]);
    const lines = [
      u.name.toUpperCase(),
      `${u.clsName.toUpperCase()} · HP ${Math.max(0, hpAt(u, tt))}/${u.maxHp}`,
      ...(fl ? [`${fl.name} · ${fl.commander}`] : [sides[u.side].name]),
      ...(u.kills || u.dmg ? [`${u.kills} kills · ${u.dmg} dmg`] : []),
      ...sys,
    ];
    g.font = `600 11px ${FONT}`;
    const w = Math.max(...lines.map(l => g.measureText(l).width)) + 20, h = lines.length * 15 + 10;
    let bx = ps.x + 18, by = ps.y - h / 2;
    if (bx + w > W - 6) bx = ps.x - 18 - w;
    by = clamp(by, 6, H - h - 6);
    g.fillStyle = 'rgba(10,4,24,.92)'; g.strokeStyle = rgba(color, 0.7);
    g.fillRect(bx, by, w, h); g.strokeRect(bx + 0.5, by + 0.5, w - 1, h - 1);
    g.fillStyle = color; g.fillRect(bx, by, 2, h);
    g.textAlign = 'left'; g.textBaseline = 'top';
    lines.forEach((l, i) => {
      g.fillStyle = i === 0 ? color : i > 3 || (i === 3 && !(u.kills || u.dmg)) ? '#ffb347' : '#d6cdf2';
      g.font = `${i === 0 ? 700 : 500} 11px ${FONT}`;
      g.fillText(l, bx + 10, by + 6 + i * 15);
    });
    g.restore();
  }

  function shake(tt: number): P {
    if (reduced) return [0, 0];
    let amp = 0;
    for (const u of units.values()) {
      if (u.deathT === Infinity) continue;
      const e = tt - u.deathT;
      if (e >= 0 && e < 0.45) amp += (u.garrison ? 6 : (GLYPH_SIZE[u.glyph] ?? 1) * 2.5) * (1 - e / 0.45);
    }
    amp = Math.min(amp, 9);
    return [Math.sin(tt * 91) * amp, Math.cos(tt * 77) * amp];
  }

  let camK = 1, camX = 0, camY = 0;
  function camera(tt: number) {
    if (reduced) { camK = 1; camX = 0; camY = 0; return; }
    let k = 1 + 0.045 * clamp((tt - INTRO) / Math.max(1, BATTLE_END - INTRO));
    let fx = W / 2, fy = H / 2;
    for (const u of units.values()) {
      if (u.deathT === Infinity) continue;
      const e = tt - u.deathT;
      if (e < 0 || e > 0.9) continue;
      const w = (1 - e / 0.9) ** 2 * (e < 0.08 ? e / 0.08 : 1);
      k += 0.03 * w * (u.garrison ? 1.6 : 1);
      fx = lerp(fx, u.hx, 0.25 * w); fy = lerp(fy, u.hy, 0.25 * w);
    }
    // zoom k about the focus point
    camK = k; camX = fx * (1 - k); camY = fy * (1 - k);
  }

  function currentRound(tt: number): number {
    let ri = -1;
    for (let i = 0; i < roundStart.length; i++) if (roundStart[i] <= tt) ri = i;
    return ri;
  }

  function render() {
    const tt = T;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const [sx, sy] = shake(tt);
    if (bg) g.drawImage(bg, sx * 0.3 - 2, sy * 0.3 - 2, W + 4, H + 4);
    // camera: a slow push-in over the fight, a small punch toward each kill
    camera(tt);
    g.save();
    g.translate(sx, sy);
    g.translate(camX, camY); g.scale(camK, camK);
    drawWrecks(tt);
    for (const sd of sides) for (const u of sd.units) if (u.garrison) drawGarrison(u, tt, sd.color);
    const order = shipUnits.slice().sort((a, b) => a.hy - b.hy);
    for (const u of order) drawShip(u, tt, sides[u.side].color);
    drawShots(tt);
    drawExplosions(tt);
    drawTexts(tt);
    g.restore();
    drawHud(tt);
    drawHover(tt);
    // vignette
    const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
  }

  // ---------------------------------------------------------------- UI sync
  let capShown = -1;
  function sync() {
    const ri = currentRound(T);
    roundLbl.textContent = T < INTRO ? 'Deploying' : !nRounds ? 'No fighting' : T >= BATTLE_END && T >= END - 0.01 ? `Round ${nRounds}/${nRounds}` : `Round ${Math.max(1, ri + 1)}/${nRounds}`;
    bPlay.innerHTML = playing ? '❚❚' : '▶';
    barFill.style.width = `${(T / END) * 100}%`;
    speedBtns.forEach(b => b.classList.toggle('bv-on', Number(b.dataset.v) === speed));
    // intro card
    if (T < INTRO) {
      intro.style.display = '';
      intro.style.opacity = String(1 - clamp((T - (INTRO - 0.35)) / 0.35));
    } else intro.style.display = 'none';
    outro.style.display = T >= END - 1e-6 ? '' : 'none';
    // captions
    let ci = -1;
    for (let i = 0; i < caps.length; i++) if (T >= caps[i].t && T < caps[i].t + CAPTION_DUR && T < END) ci = i;
    if (ci !== capShown) {
      capShown = ci;
      if (ci >= 0) { caption.textContent = caps[ci].text; caption.classList.add('bv-show'); }
      else caption.classList.remove('bv-show');
    }
  }

  function frame(now: number) {
    if (closed) return;
    // removed from the DOM by someone else (route change): stop the loop and drop listeners
    if (!overlay.isConnected) { close(); return; }
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (playing) {
      T += dt * speed;
      if (T >= END) { T = END; playing = false; }
    }
    render();
    sync();
    raf = requestAnimationFrame(frame);
  }

  const seek = (v: number) => { T = clamp(v, 0, END); };
  const nextRound = () => {
    if (T < INTRO) { seek(INTRO); return; }
    const nx = roundStart.find(rs => rs > T + 0.05);
    seek(nx ?? END);
  };
  const restart = () => { seek(0); playing = true; };
  const togglePlay = () => {
    if (T >= END) restart();
    else playing = !playing;
  };

  // ---------------------------------------------------------------- events
  const ro = new ResizeObserver(() => { if (!closed) layout(); });
  ro.observe(stage);
  const onKey = (e: KeyboardEvent) => {
    if (!overlay.isConnected) { close(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); nextRound(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); const pr = [...roundStart].reverse().find(rs => rs < T - 0.6); seek(pr ?? 0); }
  };
  window.addEventListener('keydown', onKey, true);
  overlay.addEventListener('pointerdown', e => { if (e.target === overlay) close(); });
  xBtn.onclick = () => close();
  bPlay.onclick = togglePlay;
  bRestart.onclick = restart;
  bNext.onclick = nextRound;
  bSkip.onclick = () => seek(END);
  speedBtns.forEach(b => (b.onclick = () => { speed = Number(b.dataset.v); }));
  intro.onclick = () => seek(INTRO);
  outro.addEventListener('click', e => {
    const a = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null;
    if (a?.dataset.a === 'replay') restart();
    else if (a?.dataset.a === 'close') close();
  });
  let dragging = false;
  const barSeek = (e: PointerEvent) => {
    const r = bar.getBoundingClientRect();
    seek(((e.clientX - r.left) / r.width) * END);
  };
  bar.addEventListener('pointerdown', e => { dragging = true; bar.setPointerCapture(e.pointerId); barSeek(e); });
  bar.addEventListener('pointermove', e => { if (dragging) barSeek(e); });
  bar.addEventListener('pointerup', () => { dragging = false; });
  bar.addEventListener('pointercancel', () => { dragging = false; });
  const setMouse = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    // map to layout px (the panel may still be scaled by its open/close animation)
    mouse = { x: (e.clientX - r.left) * (W / (r.width || W)), y: (e.clientY - r.top) * (H / (r.height || H)) };
  };
  canvas.addEventListener('pointermove', setMouse);
  canvas.addEventListener('pointerdown', setMouse);
  canvas.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') mouse = null; });
  [bPlay, bRestart, bNext, bSkip, xBtn, ...speedBtns].forEach(b => b.addEventListener('keydown', e => { if (e.key === ' ') e.preventDefault(); }));

  function close() {
    if (closed) return;
    closed = true;
    if (closeOpen === close) closeOpen = null;
    cancelAnimationFrame(raf);
    ro.disconnect();
    window.removeEventListener('keydown', onKey, true);
    // fade out (renamed so nothing treats it as an open viewer any more), unless it was already taken out of the page
    if (reduced || !overlay.isConnected) { overlay.remove(); return; }
    overlay.className = 'bv-closing';
    setTimeout(() => overlay.remove(), 190);
  }

  closeOpen = close;
  layout();
  last = performance.now();
  raf = requestAnimationFrame(frame);
}
