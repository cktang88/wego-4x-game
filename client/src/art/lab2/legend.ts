// Style lab legend sheet: every indicator of the map, drawn by a direction's Style on that direction's own ground,
// one per cell, each with its readability probe (the measured effective contrast is printed under it).
import { type Style, orbitOf } from './render.ts';
import { type View, type Probe, makeView } from './kit.ts';
import { MEDIAN_R, SYSTEMS, type House, type StarKind } from './board.ts';

type G = CanvasRenderingContext2D;
export interface Cell { label: string; x: number; y: number; w: number; h: number; probes: string[] }
type Draw = (g: G, v: View, st: Style, cx: number, cy: number, P: (kind: string, x: number, y: number, w: number, h: number, bg?: 0 | 1 | 2) => void) => void;
interface Def { label: string; terr?: House; draw: Draw }

const R0 = 13, TR = 11;
/** A star at its operational size (left, measured) and enlarged 2.4x (right) so the glyph can be read in the key. */
const star = (k: StarKind, R = R0, fog = false): Draw => (g, v, st, cx, cy, P) => { st.star(g, v, k, cx - 52, cy - 8, R, fog, 7); P(fog ? 'star (fogged)' : `star: ${k}`, cx - 52, cy - 8, R * 2, R * 2); st.star(g, v, k, cx + 30, cy - 8, R * 2.4, fog, 7); };

const DEFS: Def[] = [
  { label: 'Yellow star', draw: star('yellow') },
  { label: 'Red star', draw: star('red', 11) },
  { label: 'Blue star', draw: star('blue', 15) },
  { label: 'White star', draw: star('white', 12) },
  { label: 'Binary star', draw: star('binary', 13.5) },
  { label: 'Pulsar', draw: star('pulsar', 12) },
  { label: 'Black hole', draw: star('blackhole', 14) },
  { label: 'The Throne (double ring)', draw: (g, v, st, cx, cy, P) => { st.star(g, v, 'throne', cx, cy - 6, 18, false, 3); st.objective(g, v, cx, cy - 6, 18, true, false); P('throne ring', cx + 27 * 0.71 + 2, cy - 6 + 27 * 0.71 + 2, 5, 5); } },
  { label: 'Crown (gold ring)', draw: (g, v, st, cx, cy, P) => { st.star(g, v, 'yellow', cx, cy - 4, 14.5, false, 3); st.objective(g, v, cx, cy - 4, 14.5, false, false); const rr = Math.max(14.5 * 1.36, 7.5) + 2; P('crown ring', cx + rr * 0.71, cy - 4 + rr * 0.71, 5, 5); } },
  { label: 'Fogged system', draw: (g, v, st, cx, cy, P) => { st.star(g, v, 'yellow', cx, cy - 18, 12.5, true, 3); st.label(g, v, 'Cowboy Leg', cx, cy + 6, 12, 'colony', null, true); P('star (fogged)', cx, cy - 18, 20, 20); P('name (fogged)', cx, cy + 6, 60, 7); } },
  ...(['azure', 'crimson', 'gilded', 'warden'] as House[]).map((h): Def => ({ label: `${h[0].toUpperCase() + h.slice(1)} territory + hatch`, terr: h, draw: () => {} })),
  { label: 'Lanes: rest, lit, route + waypoints', draw: (g, v, st, cx, cy, P) => {
    st.lane(g, v, { x: cx - 90, y: cy - 34 }, { x: cx + 90, y: cy - 34 }, 0, false); P('lane (rest)', cx, cy - 34, 6, 6, 1);
    st.lane(g, v, { x: cx - 90, y: cy - 8 }, { x: cx + 90, y: cy - 8 }, 0.5, false); P('lane (lit)', cx - 30, cy - 8, 6, 6, 1);
    st.lane(g, v, { x: cx - 90, y: cy + 18 }, { x: cx + 90, y: cy + 18 }, 1, false); P('lane (lit)', cx - 30, cy + 18, 6, 6, 1);
    for (const x of [-40, 40]) { st.waypoint(g, v, cx + x, cy - 8, 0.5); st.waypoint(g, v, cx + x, cy + 18, 1); }
  } },
  { label: 'Move route', draw: (g, v, st, cx, cy, P) => { st.route(g, v, [{ x: cx - 90, y: cy + 14 }, { x: cx - 10, y: cy - 22 }, { x: cx + 80, y: cy - 6 }], 'azure', false); P('route (move)', cx - 50, cy - 4, 7, 7); } },
  { label: 'Seize route + reticle', draw: (g, v, st, cx, cy, P) => { st.star(g, v, 'white', cx + 52, cy - 8, 12, false, 2); st.route(g, v, [{ x: cx - 95, y: cy + 10 }, { x: cx + 52 - 21, y: cy - 4 }], 'azure', true); st.reticle(g, v, cx + 52, cy - 8, 19, 'azure'); P('route (seize)', cx - 40, cy + 4, 7, 7); P('seize reticle', cx + 52, cy - 27, 7, 7); } },
  { label: 'Fleet pips (strategic)', draw: (g, v, st, cx, cy, P) => { (['azure', 'crimson', 'gilded', 'warden'] as House[]).forEach((h, i) => { const x = cx - 66 + i * 44; st.pip(g, sv(v), x, cy - 6, -0.6, 6.5, h, i === 0); P(`fleet pip (${h})`, x, cy - 6, 11, 11); }); } },
  { label: 'Fleet counters (operational)', draw: (g, v, st, cx, cy, P) => { (['azure', 'crimson', 'gilded', 'warden'] as House[]).forEach((h, i) => { const x = cx - 72 + i * 48; st.counter(g, v, x, cy - 6, -0.6, TR, h, false); P(`fleet counter (${h})`, x, cy - 6, 24, 24); }); } },
  { label: 'Miniatures (detail)', draw: (g, v, st, cx, cy, P) => { const dv = dvw(v); (['azure', 'crimson', 'gilded'] as House[]).forEach((h, i) => { const x = cx - 70 + i * 70; st.mini(g, dv, x, cy - 2, -0.4 + i * 0.3, 22, h, ['cruiser', 'frigate', 'frigate'], false); P(`miniature (${h})`, x, cy - 2, 37, 37); }); } },
  { label: 'Stack of 2+ (count)', draw: (g, v, st, cx, cy, P) => { st.counter(g, v, cx, cy - 6, -0.6, TR, 'gilded', false); st.stack(g, v, 3, cx, cy - 6, TR, 'gilded'); P('stack count', cx + TR * 0.95, cy - 6 + TR * 0.95, 9, 9); } },
  { label: 'Selected + strength', draw: (g, v, st, cx, cy, P) => { st.counter(g, v, cx, cy + 6, -0.6, TR, 'azure', true); st.strength(g, v, 112, cx, cy + 6 - TR - 12); P('strength', cx + 4, cy + 6 - TR - 12, 12, 10); } },
  { label: 'Idle (yours, breathing)', draw: (g, v, st, cx, cy, P) => { st.counter(g, v, cx, cy - 6, -0.6, TR, 'azure', false); st.idle(g, v, cx, cy - 6, TR, 0.5); P('idle rim', cx - TR * 1.3, cy - 6, 5, 5); } },
  { label: 'Out of supply', draw: (g, v, st, cx, cy, P) => { st.counter(g, v, cx, cy - 6, -0.6, TR, 'azure', false); st.oos(g, v, cx, cy - 6, TR); P('out-of-supply rim', cx + TR * 1.25, cy - 6 + 0.3 * TR, 5, 5); } },
  { label: 'Battle (strategic, operational)', draw: (g, v, st, cx, cy, P) => { st.battle(g, v, cx - 40, cy - 6, 8.5); st.battle(g, v, cx + 30, cy - 6, 11); P('battle mark', cx - 40, cy - 6, 13, 13); P('battle mark', cx + 30, cy - 6, 16, 16); } },
  { label: 'Contested (holder: Crimson)', draw: (g, v, st, cx, cy, P) => { st.star(g, v, 'yellow', cx, cy - 6, 12.5, false, 2); st.contested(g, v, cx, cy - 6, 12.5, 'crimson', false); const rc = 12.5 * 1.5 + 4; P('contested', cx - rc * 0.94, cy - 6 + rc * 0.34, 6, 6); } },
  { label: 'Occupied (by Crimson)', draw: (g, v, st, cx, cy, P) => { st.star(g, v, 'blue', cx, cy - 6, 15, false, 2); st.occupied(g, v, cx, cy - 6, 15, 'crimson'); const s = Math.max(10, 15 * 0.95); P('occupied', cx + 15 * 1.25, cy - 6 + 15 * 0.95, s * 0.8, s * 0.8); } },
  { label: 'Tribute (to Azure)', draw: (g, v, st, cx, cy, P) => { st.star(g, v, 'binary', cx, cy - 6, 13.5, false, 2); st.tribute(g, v, cx, cy - 6, 13.5, 'azure'); const s = Math.max(10, 13.5 * 0.95); P('tribute', cx - 13.5 * 1.25, cy - 6 + 13.5 * 0.95, s * 0.8, s * 0.8); } },
  { label: 'Orbiting bodies (detail)', draw: (g, v, st, cx, cy, P) => { const s = { ...SYSTEMS[4], bodies: ['rock', 'gas', 'belt'] as typeof SYSTEMS[4]['bodies'] }; st.bodies(g, dvw(v), s, cx, cy - 8, 14, 1); st.star(g, v, 'yellow', cx, cy - 8, 14, false, 4); const o = orbitOf(0, 14, s.id); P('body', cx + Math.cos(o.a) * o.rx, cy - 8 + Math.sin(o.a) * o.ry, 8, 8); } },
  { label: 'System names (plain, owned)', draw: (g, v, st, cx, cy, P) => { st.label(g, v, 'Old Lantern', cx, cy - 24, 12, 'colony', null, false); st.label(g, v, 'Kappa Drift', cx, cy + 2, 12, 'colony', 'azure', false); P('name', cx, cy - 24, 60, 7); P('name (owned)', cx, cy + 2, 60, 7); } },
  { label: 'Objective name + garrison', draw: (g, v, st, cx, cy, P) => { st.label(g, v, 'Crown of Thorns', cx, cy - 22, 13.5, 'crown', 'azure', false); st.garrison(g, v, 48, cx, cy + 4, 12.5); P('name (objective)', cx, cy - 22, 60, 8); P('garrison', cx + 4, cy + 4, 10, 9); } },
  { label: 'Empire name (strategic)', terr: 'gilded', draw: (g, v, st, cx, cy, P) => { st.empireName(g, v, 'GILDED', cx, cy - 6, 22, 'gilded'); P('empire name', cx, cy - 6, 40, 12, 1); } },
  { label: 'Own colour on own land', terr: 'gilded', draw: (g, v, st, cx, cy, P) => {
    st.route(g, v, [{ x: cx - 90, y: cy + 22 }, { x: cx + 20, y: cy + 22 }], 'gilded', false); P('route (move)', cx - 40, cy + 22, 7, 7);
    st.pip(g, sv(v), cx - 60, cy - 18, -0.5, 6.5, 'gilded', false); P('fleet pip (gilded)', cx - 60, cy - 18, 11, 11);
    st.counter(g, v, cx + 50, cy - 10, -0.6, TR, 'gilded', false); P('fleet counter (gilded)', cx + 50, cy - 10, 24, 24);
  } },
];

const sv = (v: View): View => ({ ...v, W: { s: 1, o: 0, d: 0 } });
const dvw = (v: View): View => ({ ...v, W: { s: 0, o: 0, d: 1 } });

export const LEGEND_COLS = 6;
export function legendLayout(width: number): { cells: Cell[]; height: number } {
  const top = 54, gap = 8, cw = Math.floor((width - 24 - gap * (LEGEND_COLS - 1)) / LEGEND_COLS), ch = 150;
  const cells = DEFS.map((d, i) => ({ label: d.label, x: 12 + (i % LEGEND_COLS) * (cw + gap), y: top + Math.floor(i / LEGEND_COLS) * (ch + gap), w: cw, h: ch, probes: [] as string[] }));
  return { cells, height: top + Math.ceil(DEFS.length / LEGEND_COLS) * (ch + gap) + 12 };
}
/** The tooltip cell is the last one (the DOM slip is placed there by main). */
export const TIP_CELL = DEFS.length;

/** Draw the legend (or only its background layers when `marks` is false). */
export let lastCells: Cell[] = [];
export function drawLegend(g: G, w: number, h: number, dpr: number, st: Style, marks = true, terr = true): { probes: Probe[]; cells: Cell[] } {
  const v = makeView(w, h, dpr, 60, 40, 1, MEDIAN_R, false, 14);
  // as an operational view for the marks (tier weights), on the direction's ground
  const vo: View = { ...v, W: { s: 0, o: 1, d: 0 }, zr: 105 };
  st.ground(g, v);
  const { cells } = legendLayout(w);
  const probes: Probe[] = [];
  DEFS.forEach((d, i) => {
    const c = cells[i];
    const cx = c.x + c.w / 2, cy = c.y + (c.h - 22) / 2;
    if (d.terr && terr) {
      const p = new Path2D(); p.roundRect(c.x + 10, c.y + 8, c.w - 20, c.h - 38, 10);
      st.territory(g, vo, d.terr, p);
      if (marks) probes.push({ kind: 'territory border', x: c.x + c.w / 2, y: c.y + 8, w: 8, h: 8, bg: 0 });
    }
    if (!marks) return;
    const P = (kind: string, x: number, y: number, pw: number, ph: number, bg: 0 | 1 | 2 = 1) => { probes.push({ kind, x, y, w: pw, h: ph, bg }); c.probes.push(kind); };
    d.draw(g, vo, st, cx, cy, P);
  });
  st.light(g, v);
  if (marks) lastCells = cells;
  return { probes, cells };
}
