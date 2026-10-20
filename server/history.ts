import { filterResultFor, type GameState, type PlayerView, type TurnResult } from '../shared/index.ts';
import type { StoredGame } from './store.ts';

/** Event kinds anyone (including spectators) may see while a game is running. */
const PUBLIC_EVENTS = new Set(['pulse', 'capture', 'excavate', 'pact', 'betrayal']);

function publicResult(r: TurnResult): TurnResult {
  return {
    turn: r.turn,
    events: r.events.filter(e => PUBLIC_EVENTS.has(e.k) || (e.k === 'note' && (e as { owner?: unknown }).owner === null)),
    battles: [], signals: [], startFleets: [],
    startOwners: r.startOwners,
  };
}

export function filterHistoryFor(g: StoredGame, r: TurnResult, seat: number | null): TurnResult {
  if (g.state.winner !== null) return r;      // full reveal once the game is over (intended)
  if (seat === null) return publicResult(r);
  return filterResultFor(g.state, r, seat);
}

/**
 * What a spectator of a *running* game sees: the map, ownership, VP and public
 * objectives, but no fleets, stockpiles, projects, garrisons, orders or RNG.
 * (viewFor(state, null) is the omniscient view and must only be used after the game ends.)
 */
export function spectatorView(s: GameState): PlayerView {
  const v: GameState = structuredClone({ ...s, last: null, log: [] });
  v.fleets = [];
  v.scans = [];
  for (const pl of v.players) {
    pl.res = { industry: -1, credits: -1, influence: -1 };
    pl.pactOffers = [];
    pl.reserveCommanders = [];
  }
  for (const r of v.regions) {
    r.project = null;
    if (r.owner !== null) r.garrison = -1;
    r.loyalty = r.loyalty.map(() => 0);
  }
  if (s.last) v.last = publicResult(s.last);
  v.edictDeck = [];
  v.rngState = 0;
  return { state: v, you: null, visible: [] };
}
