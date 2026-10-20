// Per-player views: what the server sends to each client (fog of war applied).
import { coverage, seesFleetsIn } from './visibility.ts';
import type { GameState, PlayerId, TurnResult } from './types.ts';

/** Remember what a player last saw of each region (for fogged regions). */
export interface PlayerView {
  state: GameState;          // filtered state
  you: PlayerId | null;      // null = spectator / full view
  visible: number[];         // regions currently in sensor coverage
}

export function viewFor(s: GameState, p: PlayerId | null): PlayerView {
  if (p === null) return { state: s, you: null, visible: s.regions.map(r => r.id) };
  const cov = coverage(s, p);
  const v: GameState = structuredClone({ ...s, last: null, log: [] });
  v.fleets = v.fleets.filter(f => f.owner === p || seesFleetsIn(s, p, f.region, cov));
  for (const pl of v.players) {
    if (pl.id === p) continue;
    // rivals' stockpiles are secret; VP is public
    pl.res = { industry: -1, credits: -1, influence: -1 };
    pl.pactOffers = pl.pactOffers.filter(x => x === p);
    pl.reserveCommanders = [];
  }
  for (const r of v.regions) {
    if (cov.has(r.id) || r.owner === p) continue;
    // fogged: hide projects and exact garrison of rival regions
    r.project = null;
    if (r.owner !== null) r.garrison = -1;
    r.loyalty = r.loyalty.map((x, i) => (i === p ? x : 0));
  }
  if (s.last) v.last = filterResult(s, s.last, p, cov);
  v.edictDeck = [];
  v.rngState = 0;   // can't predict combat rolls
  return { state: v, you: p, visible: [...cov] };
}

function filterResult(s: GameState, r: TurnResult, p: PlayerId, cov: Set<number>): TurnResult {
  // A player sees events in regions they covered at the start or end of the turn.
  const prevCov = new Set<number>(cov);
  for (const f of r.startFleets) if (f.owner === p) { prevCov.add(f.region); for (const n of s.regions[f.region].neighbors) prevCov.add(n); }
  r.startOwners.forEach((o, i) => { if (o === p) { prevCov.add(i); for (const n of s.regions[i].neighbors) prevCov.add(n); } });
  const sees = (rid: number) => prevCov.has(rid);
  const events = r.events.filter(e => {
    switch (e.k) {
      case 'pulse': return true;
      case 'move': return e.owner === p || sees(e.from) || sees(e.to);
      case 'retreat': return e.owner === p || sees(e.from) || sees(e.to);
      case 'clash': return sees(e.a) || sees(e.b) || e.fleets.some(id => r.startFleets.some(f => f.id === id && f.owner === p));
      case 'battle': return sees(e.region) || e.parties.includes(p);
      case 'blocked': case 'fortify': return e.owner === p || sees(e.k === 'blocked' ? e.at : e.region);
      case 'destroyed': return e.owner === p || sees(e.region);
      case 'capture': return true; // ownership changes are public
      case 'build': case 'project': return e.owner === p || sees(e.region);
      case 'influence': return e.owner === p || s.regions[e.region].owner === p;
      case 'scan': return e.owner === p;
      case 'excavate': return true;
      case 'pact': case 'betrayal': return true;
      case 'fail': return e.owner === p;
      case 'note': return e.owner === null || e.owner === p;
    }
  });
  const battleIds = new Set(events.filter(e => e.k === 'battle').map(e => (e as any).battle));
  return {
    turn: r.turn,
    events,
    battles: r.battles.filter(b => battleIds.has(b.id)),
    signals: r.signals.filter(x => x.observer === p),
    startFleets: r.startFleets.filter(f => f.owner === p || sees(f.region)),
    startOwners: r.startOwners,
  };
}
