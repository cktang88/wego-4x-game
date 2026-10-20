// Animated battle replay viewer: a full-screen modal that replays a BattleReport
// round by round on a Canvas 2D stage. Rendering is a pure function of the
// timeline position T, so pause / seek / restart / skip are trivial.
import type { BattleReport, ShotRec } from '../../../shared/sim/types.ts';
import type { Rules } from '../../../shared/config/rules.ts';

export interface BattleViewerCtx {
  rules: Rules;
  playerName: (owner: number) => string;   // owner -1 => neutral/Warden
  playerColor: (owner: number) => string;
  regionName: (id: number) => string;
  you: number | null;
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
const CSS = `
.bv-overlay,.bv-closing{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;
  background:radial-gradient(ellipse at center,rgba(40,14,80,.55),rgba(3,1,10,.88));backdrop-filter:blur(3px);
  font-family:${FONT};color:#e8e0ff;animation:bv-fade .25s ease-out}
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
  background:#06030f;border:1px solid rgba(170,130,255,.28);border-radius:6px;overflow:hidden;
  box-shadow:0 0 0 1px rgba(0,0,0,.6),0 0 48px rgba(120,60,255,.28),inset 0 0 60px rgba(90,40,200,.12)}
.bv-head{display:flex;align-items:center;gap:12px;padding:8px 12px 8px 16px;border-bottom:1px solid rgba(170,130,255,.18);
  background:linear-gradient(90deg,rgba(80,40,160,.22),rgba(20,8,40,0) 70%)}
.bv-title{flex:1;min-width:0}
.bv-title b{display:block;font-size:15px;font-weight:600;letter-spacing:.22em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  text-shadow:0 0 12px rgba(180,140,255,.6)}
.bv-title span{display:block;font-size:10.5px;letter-spacing:.24em;text-transform:uppercase;color:#9d8cc9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bv-x{background:none;border:1px solid rgba(170,130,255,.3);color:#cbbcff;width:32px;height:32px;border-radius:4px;font-size:20px;line-height:1;cursor:pointer;flex:none}
.bv-x:hover{color:#fff;border-color:#c9a8ff;box-shadow:0 0 12px rgba(180,120,255,.5)}
.bv-stage{position:relative;flex:1;min-height:0;overflow:hidden;background:#05020c}
.bv-stage canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none}
.bv-ctrl{display:flex;align-items:center;gap:8px;padding:8px 12px;border-top:1px solid rgba(170,130,255,.18);background:rgba(12,6,26,.9);flex-wrap:wrap}
.bv-btn{background:rgba(120,80,220,.08);border:1px solid rgba(170,130,255,.32);color:#e4dbff;font:600 11px ${FONT};letter-spacing:.18em;text-transform:uppercase;
  padding:7px 10px;border-radius:3px;cursor:pointer;min-width:34px;white-space:nowrap}
.bv-btn:hover{border-color:#c9a8ff;box-shadow:0 0 10px rgba(180,120,255,.45);color:#fff}
.bv-btn.bv-on{background:rgba(170,120,255,.28);border-color:#d6c0ff;color:#fff;box-shadow:0 0 10px rgba(180,120,255,.4)}
.bv-speed{display:flex;gap:0}
.bv-speed .bv-btn{border-radius:0;margin-left:-1px}
.bv-speed .bv-btn:first-child{border-radius:3px 0 0 3px}.bv-speed .bv-btn:last-child{border-radius:0 3px 3px 0}
.bv-round{font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:#bfaef0;min-width:96px;text-align:center}
.bv-bar{flex:1;min-width:120px;height:18px;position:relative;cursor:pointer}
.bv-bar i{position:absolute;left:0;right:0;top:8px;height:2px;background:rgba(170,130,255,.18)}
.bv-bar em{position:absolute;left:0;top:8px;height:2px;background:linear-gradient(90deg,#7b4dff,#e0b0ff);box-shadow:0 0 8px #a070ff}
.bv-bar s{position:absolute;top:5px;width:1px;height:8px;background:rgba(200,170,255,.45)}
.bv-card{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto;
  background:radial-gradient(ellipse at center,rgba(20,8,44,.82),rgba(4,2,10,.94));z-index:3}
.bv-card-in{max-width:880px;width:100%;text-align:center;margin:auto}
.bv-kicker{font-size:11px;letter-spacing:.42em;text-transform:uppercase;color:#9d8cc9}
.bv-big{font-size:clamp(22px,4.6vw,40px);font-weight:600;letter-spacing:.16em;text-transform:uppercase;margin:6px 0 4px;
  text-shadow:0 0 18px rgba(190,140,255,.7),0 0 2px #fff}
.bv-sub{font-size:11px;letter-spacing:.3em;text-transform:uppercase;color:#a493d6}
.bv-rule{height:1px;margin:14px auto;width:60%;background:linear-gradient(90deg,transparent,rgba(200,160,255,.6),transparent)}
.bv-sides{display:flex;flex-wrap:wrap;justify-content:center;gap:12px;margin-top:6px}
.bv-side{flex:1 1 200px;max-width:280px;text-align:left;padding:10px 12px;border:1px solid rgba(255,255,255,.08);border-left:2px solid var(--c);
  background:linear-gradient(90deg,color-mix(in srgb,var(--c) 14%,transparent),transparent);animation:bv-slide .45s ease-out both}
@keyframes bv-slide{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.bv-side h3{margin:0 0 6px;font-size:13px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:var(--c);text-shadow:0 0 10px var(--c)}
.bv-side p{margin:2px 0;font-size:12px;letter-spacing:.06em;color:#d4cbef}
.bv-side small{display:block;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#9d8cc9;margin-top:6px}
.bv-vs{align-self:center;font-size:12px;letter-spacing:.3em;color:#7e6bb5}
.bv-hint{margin-top:14px;font-size:10px;letter-spacing:.3em;color:#7e6bb5;text-transform:uppercase}
.bv-caption{position:absolute;left:50%;bottom:14px;transform:translate(-50%,6px);max-width:min(760px,calc(100% - 24px));z-index:2;
  padding:8px 18px;text-align:center;font-size:clamp(12px,1.7vw,15px);letter-spacing:.08em;color:#f3ecff;pointer-events:none;
  background:linear-gradient(90deg,transparent,rgba(10,4,24,.88) 15%,rgba(10,4,24,.88) 85%,transparent);
  border-top:1px solid rgba(200,160,255,.25);border-bottom:1px solid rgba(200,160,255,.25);
  opacity:0;transition:opacity .35s,transform .35s;text-shadow:0 0 8px rgba(180,140,255,.6)}
.bv-caption.bv-show{opacity:1;transform:translate(-50%,0)}
.bv-end table{margin:10px auto 0;border-collapse:collapse;font-size:12px;letter-spacing:.1em}
.bv-end th{font-weight:500;font-size:10px;letter-spacing:.24em;text-transform:uppercase;color:#9d8cc9;padding:4px 10px;border-bottom:1px solid rgba(170,130,255,.2)}
.bv-end td{padding:5px 10px;text-align:center;border-bottom:1px solid rgba(255,255,255,.05)}
.bv-end td:first-child{text-align:left;text-transform:uppercase;letter-spacing:.16em;font-weight:600}
.bv-mvp{display:inline-block;margin-top:14px;padding:8px 16px;border:1px solid rgba(255,210,120,.45);background:rgba(255,190,80,.07);
  box-shadow:0 0 18px rgba(255,190,80,.15)}
.bv-mvp small{display:block;font-size:10px;letter-spacing:.34em;color:#ffcf7a;text-transform:uppercase}
.bv-mvp b{font-size:16px;letter-spacing:.12em}
.bv-hl{list-style:none;margin:14px auto 0;padding:0;max-width:640px;text-align:left}
.bv-hl li{font-size:12.5px;letter-spacing:.04em;color:#d6cdf2;padding:4px 0 4px 16px;position:relative;border-bottom:1px solid rgba(255,255,255,.04)}
.bv-hl li:before{content:'';position:absolute;left:2px;top:10px;width:5px;height:5px;transform:rotate(45deg);background:#b48cff;box-shadow:0 0 6px #b48cff}
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
export function openBattleViewer(report: BattleReport, ctx: BattleViewerCtx): void {
  injectStyle();
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
  const overlay = el('div', 'bv-overlay');
  const panel = el('div', 'bv-panel');
  overlay.appendChild(panel);
  const head = el('div', 'bv-head');
  const title = el('div', 'bv-title',
    `<b>${esc(report.name)}</b><span>${esc(ctx.regionName(report.region))} · Turn ${report.turn} · Pulse ${report.pulse} · ${report.sides.length} sides</span>`);
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
      <div class="bv-sub">${esc(ctx.regionName(report.region))} · Turn ${report.turn} · Pulse ${report.pulse}</div>
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
    const sub = report.ongoing ? `Day ${report.day ?? 1} · ${report.totalRounds ?? report.rounds.length} rounds so far · it continues next pulse. Reinforcements can still turn it.`
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
    const r = stage.getBoundingClientRect();
    W = Math.max(200, r.width); H = Math.max(160, r.height);
    dpr = Math.min(3, window.devicePixelRatio || 1);
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
    const gy = n >= 3 ? Math.max(gapHalf * 0.8, (H - mTop - mBot) * 0.13) : gapHalf;
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
        else sd.label = { x: clamp((minX + maxX) / 2, tw / 2 + 4, W - tw / 2 - 4), y: minY - 14, align: 'center' };
      } else {
        sd.label = { x: clamp((minX + maxX) / 2, 90, W - 90), y: clamp(minY - 18, mTop + 4, H), align: 'center' };
      }
    });
    buildBg();
  }

  function buildBg() {
    bg = document.createElement('canvas');
    bg.width = canvas.width; bg.height = canvas.height;
    const b = bg.getContext('2d')!;
    b.scale(dpr, dpr);
    const grd = b.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.75);
    grd.addColorStop(0, '#140828'); grd.addColorStop(0.55, '#0a0418'); grd.addColorStop(1, '#030108');
    b.fillStyle = grd; b.fillRect(0, 0, W, H);
    const rnd = mulberry(report.id * 101 + 5);
    // faint nebulae tinted by the combatants
    sides.forEach(sd => {
      const u = sd.units[0];
      const x = u ? lerp(W / 2, u.hx, 1.3) : rnd() * W, y = u ? lerp(H / 2, u.hy, 1.3) : rnd() * H;
      const r = Math.max(W, H) * (0.35 + rnd() * 0.15);
      const ng = b.createRadialGradient(x, y, 0, x, y, r);
      ng.addColorStop(0, rgba(sd.color, 0.10)); ng.addColorStop(1, rgba(sd.color, 0));
      b.fillStyle = ng; b.fillRect(0, 0, W, H);
    });
    for (let i = 0; i < 3; i++) {
      const x = rnd() * W, y = rnd() * H, r = Math.max(W, H) * (0.2 + rnd() * 0.3);
      const ng = b.createRadialGradient(x, y, 0, x, y, r);
      ng.addColorStop(0, `rgba(${110 + rnd() * 60 | 0},${40 + rnd() * 40 | 0},${200 + rnd() * 55 | 0},0.08)`); ng.addColorStop(1, 'rgba(0,0,0,0)');
      b.fillStyle = ng; b.fillRect(0, 0, W, H);
    }
    const nStars = Math.round((W * H) / 1400);
    for (let i = 0; i < nStars; i++) {
      const x = rnd() * W, y = rnd() * H, m = rnd();
      const r = m > 0.985 ? 1.4 : m > 0.9 ? 0.9 : 0.5;
      b.fillStyle = `rgba(${200 + rnd() * 55 | 0},${190 + rnd() * 50 | 0},255,${0.25 + rnd() * 0.6})`;
      b.beginPath(); b.arc(x, y, r, 0, Math.PI * 2); b.fill();
      if (m > 0.993) {
        b.strokeStyle = 'rgba(220,200,255,.35)'; b.lineWidth = 0.6;
        b.beginPath(); b.moveTo(x - 5, y); b.lineTo(x + 5, y); b.moveTo(x, y - 5); b.lineTo(x, y + 5); b.stroke();
      }
    }
    // faint tactical grid
    b.strokeStyle = 'rgba(150,110,255,0.045)'; b.lineWidth = 1;
    const step = 48;
    b.beginPath();
    for (let x = (W / 2) % step; x < W; x += step) { b.moveTo(x, 0); b.lineTo(x, H); }
    for (let y = (H / 2) % step; y < H; y += step) { b.moveTo(0, y); b.lineTo(W, y); }
    b.stroke();
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
    const ang = angleOf(u, tt);
    return [p.x + Math.cos(ang) * u.s * 1.05, p.y + Math.sin(ang) * u.s * 1.05];
  }

  // ---------------------------------------------------------------- drawing
  function drawShip(u: Unit, tt: number, color: string) {
    const ps = pose(u, tt);
    if (ps.a <= 0.01) return;
    const ang = angleOf(u, tt);
    const s = u.s;
    const hpNow = hpAt(u, tt);
    const recentHit = u.hits.some(h => h.t <= tt && tt - h.t < 0.14);
    const dying = tt >= u.deathT - 0.6 && hpNow <= 0;
    g.save();
    g.globalAlpha = ps.a * (dying ? 0.6 + 0.4 * Math.sin(tt * 60) : 1);
    if (ps.warp > 0.05) {
      g.strokeStyle = rgba(color, 0.5 * ps.warp); g.lineWidth = Math.max(1, s * 0.25);
      g.beginPath(); g.moveTo(ps.x, ps.y); g.lineTo(ps.x - Math.cos(ang) * s * 8 * ps.warp, ps.y - Math.sin(ang) * s * 8 * ps.warp); g.stroke();
    }
    g.translate(ps.x, ps.y); g.rotate(ang);
    // engine plume
    if (!sysDown(u, 'engines', tt) && hpNow > 0) {
      const ex = (ENGINE_X[u.glyph] ?? -0.9) * s;
      const fl = 0.75 + 0.25 * Math.sin(tt * 30 + u.seed * 50) + ps.warp * 2;
      const pg = g.createLinearGradient(ex, 0, ex - s * 1.1 * fl, 0);
      pg.addColorStop(0, 'rgba(255,255,255,.9)'); pg.addColorStop(0.3, rgba(color, 0.7)); pg.addColorStop(1, rgba(color, 0));
      g.fillStyle = pg;
      g.beginPath(); g.moveTo(ex, -s * 0.16); g.lineTo(ex - s * 1.1 * fl, 0); g.lineTo(ex, s * 0.16); g.closePath(); g.fill();
    }
    g.shadowColor = color; g.shadowBlur = Math.max(6, s * 0.9);
    hullPath(g, u.glyph, s);
    g.fillStyle = recentHit ? 'rgba(255,255,255,.55)' : rgba(color, 0.2);
    g.fill();
    g.lineWidth = Math.max(1.1, s * 0.09);
    g.strokeStyle = recentHit ? '#fff' : color;
    g.lineJoin = 'round';
    g.stroke();
    g.shadowBlur = 0;
    hullDetail(g, u.glyph, s);
    g.lineWidth = Math.max(0.7, s * 0.05);
    g.strokeStyle = rgba(color, 0.75);
    g.stroke();
    if (sysDown(u, 'weapons', tt)) {
      g.strokeStyle = 'rgba(255,90,90,.9)'; g.lineWidth = 1.2;
      const k = s * 0.22;
      g.beginPath(); g.moveTo(-k, -k); g.lineTo(k, k); g.moveTo(k, -k); g.lineTo(-k, k); g.stroke();
    }
    g.restore();
    // damage sparks
    if (hpNow > 0 && hpNow / u.maxHp < 0.4 && tt < u.retreatT) {
      const rnd = mulberry(u.id * 97 + Math.floor(tt * 12));
      g.fillStyle = `rgba(255,${150 + rnd() * 80 | 0},60,${0.5 + rnd() * 0.5})`;
      for (let i = 0; i < 2; i++) { g.beginPath(); g.arc(ps.x + (rnd() - 0.5) * s * 1.4, ps.y + (rnd() - 0.5) * s, 0.6 + rnd() * 1.2, 0, Math.PI * 2); g.fill(); }
    }
    // hp bar + name
    if (ps.a > 0.2 && hpNow > 0) {
      const bw = Math.max(16, s * 2), by = ps.y + Math.max(s * 0.85, 7) + 4;
      drawHpBar(ps.x - bw / 2, by, bw, 2.5, hpNow / u.maxHp, ps.a, color, lagHp(u, tt) / u.maxHp);
      const large = u.glyph === 'dread' || u.glyph === 'long' || shipUnits.length <= 8;
      if (large) {
        g.globalAlpha = ps.a * 0.75;
        g.font = `500 ${clamp(s * 0.4, 9, 11)}px ${FONT}`;
        g.textAlign = 'center'; g.textBaseline = 'top';
        g.fillStyle = '#d9d0f5';
        setLs(g, '0.08em');
        g.fillText(u.name.toUpperCase(), ps.x, by + 5);
        setLs(g, '0px');
        g.globalAlpha = 1;
      }
    }
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

  function drawGarrison(u: Unit, tt: number, color: string) {
    const { x, y } = pose(u, tt);
    const r = u.s;
    const hpNow = hpAt(u, tt);
    const dead = tt >= u.deathT || hpNow <= 0;
    const recentHit = u.hits.some(h => h.t <= tt && tt - h.t < 0.14);
    g.save();
    // atmosphere
    const atm = g.createRadialGradient(x, y, r * 0.8, x, y, r * 1.9);
    atm.addColorStop(0, rgba(color, dead ? 0.08 : 0.28)); atm.addColorStop(1, rgba(color, 0));
    g.fillStyle = atm; g.beginPath(); g.arc(x, y, r * 1.9, 0, Math.PI * 2); g.fill();
    // body
    const body = g.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
    body.addColorStop(0, dead ? '#2a2233' : rgba(color, 0.55)); body.addColorStop(0.6, dead ? '#140f1c' : '#1a0f30'); body.addColorStop(1, '#07040e');
    g.fillStyle = body; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = recentHit ? '#fff' : rgba(color, dead ? 0.3 : 0.9); g.lineWidth = 1.4;
    g.shadowColor = color; g.shadowBlur = dead ? 0 : 14;
    g.stroke(); g.shadowBlur = 0;
    // surface bands
    g.save(); g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.clip();
    g.strokeStyle = rgba(color, 0.18); g.lineWidth = 1;
    for (let i = -2; i <= 2; i++) { g.beginPath(); g.ellipse(x, y + i * r * 0.33, r * 1.05, r * 0.12, 0.25, 0, Math.PI * 2); g.stroke(); }
    g.restore();
    // fortress ring
    const rot = tt * 0.35;
    g.strokeStyle = rgba(color, dead ? 0.15 : 0.7); g.lineWidth = 1.2;
    const segs = 10;
    for (let i = 0; i < segs; i++) {
      if (dead && i % 3 === 0) continue;
      const a0 = rot + (i / segs) * Math.PI * 2, a1 = a0 + (Math.PI * 2) / segs * 0.62;
      g.beginPath(); g.arc(x, y, r * 1.35, a0, a1); g.stroke();
      if (!dead) {
        g.fillStyle = color;
        g.beginPath(); g.arc(x + Math.cos(a0) * r * 1.35, y + Math.sin(a0) * r * 1.35, 1.6, 0, Math.PI * 2); g.fill();
      }
    }
    g.restore();
    // hp + label
    const bw = r * 2.4, by = y + r * 1.55 + 6;
    if (!dead) drawHpBar(x - bw / 2, by, bw, 3, hpNow / u.maxHp, 1, color, lagHp(u, tt) / u.maxHp);
    g.font = `600 10px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'top';
    g.fillStyle = dead ? 'rgba(255,120,120,.8)' : rgba(color, 0.9);
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

  function drawShots(tt: number) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const sh of shots) {
      if (tt < sh.t0 || tt > sh.t1 + 1.7) continue;
      const color = sides[sh.from.side].color;
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
      // bolt
      const dur = sh.rec.miss ? TRAVEL * 1.8 : TRAVEL;
      const p = (tt - sh.t0) / dur;
      if (p <= 1.25) {
        const head = clamp(p), tail = clamp(p - 0.4);
        const hx = lerp(A[0], B[0], head), hy = lerp(A[1], B[1], head);
        const tx = lerp(A[0], B[0], tail), ty = lerp(A[1], B[1], tail);
        const fade = sh.rec.miss ? 1 - clamp((p - 0.6) / 0.6) : 1;
        g.globalAlpha = fade;
        g.strokeStyle = rgba(color, 0.55); g.lineWidth = heavy ? 4.5 : 3; g.lineCap = 'round';
        g.beginPath(); g.moveTo(tx, ty); g.lineTo(hx, hy); g.stroke();
        g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = heavy ? 1.6 : 1;
        g.beginPath(); g.moveTo(lerp(tx, hx, 0.4), lerp(ty, hy, 0.4)); g.lineTo(hx, hy); g.stroke();
        g.globalAlpha = 1;
      }
      // muzzle flash
      const mf = (tt - sh.t0) / 0.12;
      if (mf >= 0 && mf <= 1) {
        g.fillStyle = rgba(color, 0.7 * (1 - mf));
        g.beginPath(); g.arc(A[0], A[1], 2 + 4 * mf, 0, Math.PI * 2); g.fill();
      }
      // impact
      if (!sh.rec.miss) {
        const ip = (tt - sh.t1) / 0.38;
        if (ip >= 0 && ip <= 1) {
          const shielded = sh.to.shields > 0 && !sysDown(sh.to, 'shields', sh.t1 - 0.001) && !sh.to.garrison;
          const rr = (sh.to.garrison ? sh.to.s * 0.35 : Math.max(6, sh.to.s * 0.7)) * (0.6 + ip) + sh.rec.dmg * 0.6;
          const ix = B[0] + (sh.off * sh.to.s * 0.35), iy = B[1] + (sh.off * 0.7 * sh.to.s * 0.35);
          const ig = g.createRadialGradient(ix, iy, 0, ix, iy, rr);
          ig.addColorStop(0, `rgba(255,255,255,${0.95 * (1 - ip)})`);
          ig.addColorStop(0.35, sh.rec.crit ? `rgba(255,170,60,${0.8 * (1 - ip)})` : rgba(color, 0.6 * (1 - ip)));
          ig.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = ig; g.beginPath(); g.arc(ix, iy, rr, 0, Math.PI * 2); g.fill();
          if (shielded) {
            const ang = Math.atan2(A[1] - B[1], A[0] - B[0]);
            // the whole bubble shimmers into view, brightest where the bolt struck
            const tp2 = pose(sh.to, tt);
            const br = sh.to.s * 1.25 * (1 + 0.08 * ip);
            g.fillStyle = `rgba(110,200,255,${0.09 * (1 - ip)})`;
            g.beginPath(); g.arc(tp2.x, tp2.y, br, 0, Math.PI * 2); g.fill();
            g.strokeStyle = `rgba(150,225,255,${0.3 * (1 - ip)})`; g.lineWidth = 1;
            g.setLineDash([3, 4]); g.lineDashOffset = -tt * 40;
            g.beginPath(); g.arc(tp2.x, tp2.y, br, 0, Math.PI * 2); g.stroke();
            g.setLineDash([]);
            g.strokeStyle = `rgba(170,235,255,${0.9 * (1 - ip)})`; g.lineWidth = 2;
            g.beginPath(); g.arc(tp2.x, tp2.y, br, ang - 0.7, ang + 0.7); g.stroke();
          }
          const rnd = mulberry(sh.idx * 13 + 1);
          g.strokeStyle = `rgba(255,220,170,${1 - ip})`; g.lineWidth = 1;
          g.beginPath();
          for (let i = 0; i < 4; i++) {
            const a = rnd() * Math.PI * 2, d0 = rr * 0.3, d1 = rr * (0.6 + rnd() * 0.8);
            g.moveTo(ix + Math.cos(a) * d0, iy + Math.sin(a) * d0); g.lineTo(ix + Math.cos(a) * d1, iy + Math.sin(a) * d1);
          }
          g.stroke();
        }
      }
    }
    g.restore();
  }

  function drawExplosions(tt: number) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const u of units.values()) {
      if (u.deathT === Infinity) continue;
      const e = tt - u.deathT;
      if (e < 0 || e > 2.6) continue;
      const color = sides[u.side].color;
      const ps = pose(u, u.deathT - 0.001);
      const size = u.garrison ? u.s * 0.9 : u.s;
      const rnd = mulberry(u.id * 7 + 99);
      // flash
      if (e < 0.3) {
        const k = e / 0.3;
        const fr = size * (2 + 4 * k);
        const fg = g.createRadialGradient(ps.x, ps.y, 0, ps.x, ps.y, fr);
        fg.addColorStop(0, `rgba(255,255,255,${1 - k})`); fg.addColorStop(0.4, `rgba(255,200,120,${0.8 * (1 - k)})`); fg.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = fg; g.beginPath(); g.arc(ps.x, ps.y, fr, 0, Math.PI * 2); g.fill();
      }
      // fireball
      if (e < 0.9) {
        const k = e / 0.9;
        const fr = size * (1.2 + 2.2 * Math.sqrt(k));
        const fg = g.createRadialGradient(ps.x, ps.y, 0, ps.x, ps.y, fr);
        fg.addColorStop(0, `rgba(255,230,180,${0.9 * (1 - k)})`); fg.addColorStop(0.5, `rgba(255,110,40,${0.6 * (1 - k)})`); fg.addColorStop(1, 'rgba(80,0,40,0)');
        g.fillStyle = fg; g.beginPath(); g.arc(ps.x, ps.y, fr, 0, Math.PI * 2); g.fill();
      }
      // shockwave
      if (e < 1.0) {
        const k = e / 1.0;
        g.strokeStyle = rgba(color, 0.9 * (1 - k)); g.lineWidth = 2.5 * (1 - k) + 0.5;
        g.beginPath(); g.arc(ps.x, ps.y, size * (1 + 6 * (1 - Math.pow(1 - k, 2))), 0, Math.PI * 2); g.stroke();
      }
      // debris shards
      const n = 10 + Math.round(size / 2.5);
      const fade = 1 - clamp(e / 2.6);
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2, sp = size * (2 + rnd() * 5), spin = (rnd() - 0.5) * 8, len = size * (0.15 + rnd() * 0.45);
        const d = sp * (1 - Math.exp(-2.2 * e));
        const x = ps.x + Math.cos(a) * d, y = ps.y + Math.sin(a) * d;
        const ra = rnd() * 6 + spin * e;
        g.strokeStyle = i % 3 === 0 ? `rgba(255,180,90,${fade})` : rgba(color, fade * 0.85);
        g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(x - Math.cos(ra) * len, y - Math.sin(ra) * len); g.lineTo(x + Math.cos(ra) * len, y + Math.sin(ra) * len); g.stroke();
      }
      // embers
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2, sp = size * (1 + rnd() * 7);
        const d = sp * (1 - Math.exp(-3 * e));
        const k = clamp(e / (0.8 + rnd() * 1.2));
        if (k >= 1) continue;
        g.fillStyle = `rgba(255,${160 + rnd() * 90 | 0},90,${1 - k})`;
        g.beginPath(); g.arc(ps.x + Math.cos(a) * d, ps.y + Math.sin(a) * d, 0.8 + rnd(), 0, Math.PI * 2); g.fill();
      }
    }
    g.restore();
  }

  function drawTexts(tt: number) {
    g.save();
    g.textAlign = 'center'; g.textBaseline = 'middle';
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
        const y = top - 18 - k * 14;
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
      g.fillText('GARRISON FALLS', u.hx, u.hy - u.s * 1.7 - 8);
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
      g.fillText(`${fn} RETREATS`, clamp(fu.hx, 90, W - 90), clamp(fu.hy - 40, 60, H - 60));
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
        const y = Math.min(H * 0.18, 70);
        g.font = `600 ${clamp(W * 0.03, 15, 24)}px ${FONT}`;
        setLs(g, '0.5em');
        g.fillStyle = '#efe6ff'; g.shadowColor = '#a070ff'; g.shadowBlur = 16;
        g.fillText(`ROUND ${ri + 1}`, W / 2 + 6, y);
        g.shadowBlur = 0; setLs(g, '0px');
        const lw = 60 + 60 * clamp(e / 0.4);
        g.strokeStyle = 'rgba(190,150,255,.7)'; g.lineWidth = 1;
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
    g.save();
    g.translate(sx, sy);
    for (const sd of sides) for (const u of sd.units) if (u.garrison) drawGarrison(u, tt, sd.color);
    for (const sd of sides) for (const u of sd.units) if (!u.garrison) drawShip(u, tt, sd.color);
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
    mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  canvas.addEventListener('pointermove', setMouse);
  canvas.addEventListener('pointerdown', setMouse);
  canvas.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') mouse = null; });
  [bPlay, bRestart, bNext, bSkip, xBtn, ...speedBtns].forEach(b => b.addEventListener('keydown', e => { if (e.key === ' ') e.preventDefault(); }));

  function close() {
    if (closed) return;
    closed = true;
    cancelAnimationFrame(raf);
    ro.disconnect();
    window.removeEventListener('keydown', onKey, true);
    // fade out (renamed so nothing treats it as an open viewer any more), unless it was already taken out of the page
    if (reduced || !overlay.isConnected) { overlay.remove(); return; }
    overlay.className = 'bv-closing';
    setTimeout(() => overlay.remove(), 190);
  }

  layout();
  last = performance.now();
  raf = requestAnimationFrame(frame);
}
