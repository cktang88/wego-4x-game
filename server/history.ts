import { filterResultFor, type TurnResult } from '../shared/index.ts';
import type { StoredGame } from './store.ts';

export function filterHistoryFor(g: StoredGame, r: TurnResult, seat: number | null): TurnResult {
  if (g.state.winner !== null) return r;
  if (seat === null) return { ...r, events: [], battles: [], signals: [], startFleets: [] };
  return filterResultFor(g.state, r, seat);
}
