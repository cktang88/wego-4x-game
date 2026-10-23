// Shared bits for the Court modules (client/src/court/): escaping, house crests, the mount contract.
// Self-contained: these modules read the (fogged) GameState they are given and hand back FreeActions; they never
// touch game.ts, the HUD or the network. See /tmp/claude-0/court/hooks.md for where they mount.
import type { FreeAction, GameState, PlayerId } from '../../../shared/sim/types.ts';
import { bannerSvg } from '../art/sigils.ts';
import { ownerText } from '../art/bible.ts';
import './court.css';

/** What every Court module returns from its mount function. */
export interface CourtMount<P> {
  /** The module's root element (already appended to the host). */
  el: HTMLElement;
  /** Re-render with new props (a new view, the plan changed). Cheap: call it on every renderAll. */
  update(props: P): void;
  /** Remove it and its listeners. */
  destroy(): void;
}

/** The props every module shares. `pending`: the free actions already in the player's plan (WEGO) or LIVE queue. */
export interface CourtProps {
  st: GameState;
  you: PlayerId;
  pending?: FreeAction[];
  /** True when the player may still change the plan (not sealed, game not over). Default true. */
  canPlan?: boolean;
}
/** The callbacks every module takes. `onAction` puts a free action into the plan, replacing an earlier one for the same
 *  thing (same captive / the decree / the whisper); `onClear` takes it back out. */
export interface CourtHandlers {
  onAction(fa: FreeAction): void;
  onClear?(match: (fa: FreeAction) => boolean): void;
}

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
/** A house's name, coloured as text on dark steel (the bible's ownerText). */
export function houseName(st: GameState, p: PlayerId): string {
  const pl = st.players[p];
  return `<span class="ct-house" style="color:${ownerText(pl?.color)}">${esc(pl?.name ?? '?')}</span>`;
}
/** The charge on each seat's crest (cosmetic: the houses have no banner of their own). */
const SEAT_SIGIL = ['star', 'blade', 'crown'];
/** A house crest: an enamel heater shield in the house colour. */
export function crest(st: GameState, p: PlayerId, size = 28): string {
  return bannerSvg(SEAT_SIGIL[p] ?? 'star', st.players[p]?.color ?? '#888', size, { rim: 'gold', cls: 'ct-crest' });
}
/** "turn 12" or "this turn" / "next turn". */
export function turnWord(st: GameState, t: number): string {
  const cyc = st.mode === 'live' ? 'cycle' : 'turn';
  return t === st.turn ? `this ${cyc}` : t === st.turn + 1 ? `next ${cyc}` : `${cyc} ${t}`;
}
export const RANKS = ['', 'Untried', 'Blooded', 'Veteran', 'Storied', 'Legend'];
export const rankWord = (r: number) => RANKS[r] ?? `Rank ${r}`;

/** Mount helper: a root element with a class, appended to the host; rendering goes through `paint`. */
export function shell<P>(host: HTMLElement, cls: string, props: P, paint: (el: HTMLElement, p: P) => void, wire: (el: HTMLElement, get: () => P) => () => void): CourtMount<P> {
  const el = document.createElement('section');
  el.className = cls;
  host.appendChild(el);
  let cur = props;
  paint(el, cur);
  const unwire = wire(el, () => cur);
  return {
    el,
    update(p: P) { cur = p; paint(el, cur); },
    destroy() { unwire(); el.remove(); },
  };
}
/** The court free action already in the plan that `match` picks, if any. */
export const pendingOf = (p: CourtProps, match: (fa: FreeAction) => boolean) => (p.pending ?? []).find(match);
