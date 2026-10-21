// Small shared helpers for the HUD: icons, ship silhouettes, number formatting, short reasons.
import type { Order } from '../../../shared/sim/types.ts';
import { ORDER_INFO } from '../../../shared/sim/orders.ts';
import { esc } from '../ui/dom.ts';

/** The closed icon set (docs/UX-V2.md §6). */
export const IC = {
  industry: '⚙', credits: '¢', influence: '✦', vp: '♛', power: '⚔', garrison: '⛨', move: '➤', build: '⚒',
  develop: '▲', research: '✺', law: '⚑', scan: '◎', time: '⏱', alert: '⚠', antimatter: '⚛', crystal: '◆',
} as const;

/** One glyph per order type, from the closed set where one fits. */
const ORDER_ICONS: Partial<Record<Order['type'], string>> = {
  move: '➤', seize: '⚔', build: '⚒', develop: '▲', fortify: '⛨', influence: '✦', scan: '◎', feint: '☍',
  conceal: '☾', excavate: '✧', pact: '⚭', law: '⚑', refit: '⚒',
};
/** Order glyph (new order kinds fall back to the rule table's icon). */
export const ORDER_ICON = new Proxy(ORDER_ICONS as Record<string, string>, { get: (t, k: string) => t[k] ?? (ORDER_INFO as Record<string, { icon: string } | undefined>)[k]?.icon ?? '•' }) as Record<Order['type'], string>;

/** Ship class silhouettes (inline SVG, 28x14, pointing right). */
const SIL: Record<string, string> = {
  scout: 'M2 7 L16 4 L26 7 L16 10 Z',
  corvette: 'M2 4 L10 6 L26 7 L10 8 L2 10 L5 7 Z',
  frigate: 'M2 3 L12 5 L26 7 L12 9 L2 11 L6 7 Z M8 2 L12 5 L8 4 Z M8 12 L12 9 L8 10 Z',
  bombard: 'M2 3 H18 L24 5 V9 L18 11 H2 Z M24 6 H27 V8 H24 Z',
  cruiser: 'M1 5 L6 3 H20 L27 7 L20 11 H6 L1 9 Z M8 1 H14 L16 3 H8 Z M8 13 H14 L16 11 H8 Z',
  dread: 'M1 3 L5 1 H19 L27 5 V9 L19 13 H5 L1 11 Z M9 0 H15 V1 H9 Z M9 13 H15 V14 H9 Z',
};
export function shipSvg(cls: string, color = 'currentColor', w = 28): string {
  const d = SIL[cls] ?? SIL.frigate;
  return `<svg class="sil" viewBox="0 0 28 14" width="${w}" height="${Math.round(w / 2)}" aria-hidden="true"><path d="${d}" fill="${esc(color)}"/></svg>`;
}

export const plus = (n: number) => `${n >= 0 ? '+' : ''}${n}`;
export function tip(text: string): string { return ` data-tip="${esc(text)}"`; }

/** "2h 05m", "4m 10s", "12s" */
export function fmtDur(ms: number): string {
  ms = Math.max(0, ms);
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${s}s`;
}
/** "2:14", "1h05" (compact clock for buttons) */
export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000)), m = Math.floor(s / 60), h = Math.floor(m / 60);
  if (h > 0) return `${h}h${String(m % 60).padStart(2, '0')}`;
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** First n words of a name ("The Gilded Reach" → "Gilded Reach" for n=2 drops leading "The"). */
export function shortName(name: string, n = 2): string {
  const w = name.replace(/^the\s+/i, '').split(/\s+/);
  return w.slice(0, n).join(' ');
}

/** Rule-engine reasons (sentences) → at most ~3 words for the preview card. */
export function shortWhy(t: string | null | undefined): string {
  if (!t) return '';
  const s = t.toLowerCase();
  const map: [RegExp, string][] = [
    // star systems (docs/SYSTEMS.md): the cap, gates, sites and slots
    [/citizens at the cap/, 'at cap'], [/shipyard needs (\d+) citizens/, '$1 citizens or Station'], [/academy needs (\d+) citizens/, '$1 citizens'],
    [/no free civil slot/, 'no civil slot'], [/no free military slot/, 'no military slot'], [/no belt, barren world or vein/, 'no mine site'],
    [/trade hub needs/, 'no trade site'], [/no surface to mine/, 'no surface'], [/already has a station/, 'has Station'],
    [/too far \(speed (\d+)\)/, 'too far'], [/adjacent/, 'not adjacent'], [/already yours/, 'already yours'],
    [/at most \d+ orders|already has \d+ orders/, '2 orders max'], [/only just formed/, 'new: next turn'],
    [/fatigued/, 'fatigued'], [/not connected/, 'no route'], [/spectating/, 'spectating'], [/sealed/, 'sealed'],
    [/game is over/, 'game over'], [/eliminated/, 'eliminated'], [/no orders banked/, 'no orders banked'],
    [/fleet is full/, 'fleet full'], [/too many fleets/, 'fleet limit'], [/shipyard/, 'needs shipyard'],
    [/project is already/, 'busy'], [/max level/, 'maxed'], [/capitals/, 'capital'], [/martial/, 'martial law'],
    [/pact/, 'pact'], [/must border/, 'not bordering'], [/no rival agents/, 'no agents'], [/enemies present/, 'enemies here'],
    [/up to date/, 'up to date'], [/relic/, 'no relic'], [/must own/, 'not yours'], [/nobody lives/, 'empty void'],
    [/research|requires|needs/, 'locked'], [/all \d+ orders are used/, 'no slot free'],
  ];
  for (const [re, out] of map) { const m = re.exec(s); if (m) return out.replace(/\$(\d)/g, (_, k) => m[Number(k)] ?? ''); }
  return s.replace(/[.!]$/, '').split(/\s+/).slice(0, 3).join(' ');
}

export const romanN = (n: number) => ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n] ?? String(n);

/** Is the keyboard focus in a text field (shortcuts must not fire)? */
export function typing(t: EventTarget | null): boolean {
  const e = t as HTMLElement | null;
  return !!e && (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.tagName === 'SELECT' || e.isContentEditable);
}
