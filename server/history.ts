import { BATTLE_LINE, filterResultFor, type GameState, type PlayerView, type TurnResult } from '../shared/index.ts';
import type { StoredGame } from './store.ts';

/** Event kinds anyone (including spectators) may see while a game is running. */
const PUBLIC_EVENTS = new Set(['pulse', 'capture', 'excavate', 'pact', 'betrayal']);

function publicResult(r: TurnResult): TurnResult {
  return {
    turn: r.turn,
    ...(r.tick !== undefined ? { tick: r.tick } : {}),
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
  v.engagements = [];   // where battles rage, who fights and with how many hulls
  for (const pl of v.players) {
    pl.res = { industry: -1, credits: -1, influence: -1 };
    pl.pactOffers = [];
    pl.reserveCommanders = [];
    pl.vpLog = (pl.vpLog ?? []).map(e => e.why.startsWith('Battle honors') ? { ...e, why: 'Battle honors' } : e);
  }
  // battles are not public: no per-player kill/win counts, no rival influence targets, no battle lines
  if (v.turnStats) {
    const zero = (a: number[] | undefined) => (a ?? []).map(() => 0);
    v.turnStats = { ...v.turnStats, kills: zero(v.turnStats.kills), battlesWon: zero(v.turnStats.battlesWon), crownBattlesWon: zero(v.turnStats.crownBattlesWon), influenced: [] };
  }
  v.chronicle = v.chronicle.filter(c => c.region === undefined || !BATTLE_LINE.test(c.text));
  if (v.live) {
    // LIVE: every seat's bank, earning timer and queued orders are private
    v.live.queue = {};
    v.live.free = {};
    v.live.bank = v.live.bank.map(() => -1);
    v.live.nextOrderAt = v.live.nextOrderAt.map(() => 0);
  }
  for (const r of v.regions) {
    r.project = null;
    if (r.owner !== null) r.garrison = -1;
    r.loyalty = r.loyalty.map(() => 0);
  }
  if (s.last) v.last = publicResult(s.last);
  v.edictDeck = [];
  delete v.cycleFought;   // LIVE bookkeeping: which fleets fought this cycle (viewFor drops it too)
  v.rngState = 0;
  return { state: v, you: null, visible: [] };
}
