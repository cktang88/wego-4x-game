// Imperial Edicts: public objectives revealed one turn before they score.
// Every edict points at a contested place or at fighting. Add your own here.
import type { GameState, PlayerId } from './types.ts';

export interface EdictDef {
  name: string;
  desc: string;
  vp: number;
  /** Return the players who satisfy the edict at the end of the scoring turn. */
  check: (s: GameState, ctx: { startOwners: (PlayerId | null)[] }) => PlayerId[];
}

const alive = (s: GameState) => s.players.filter(p => !p.eliminated).map(p => p.id);
/** Capitals of living rivals that they still hold (an eliminated / homeless player's `capital` is stale). */
const rivalCapitals = (s: GameState, p: PlayerId) =>
  s.players.filter(o => o.id !== p && !o.eliminated && s.regions[o.capital]?.owner === o.id).map(o => o.capital);

export const EDICTS: Record<string, EdictDef> = {
  border_raid: {
    name: 'Edict of the Open Gate', vp: 3,
    desc: 'Own a region adjacent to a rival capital.',
    check: s => alive(s).filter(p => rivalCapitals(s, p).some(c => s.regions[c].neighbors.some(n => s.regions[n].owner === p))),
  },
  crown_battle: {
    name: 'Edict of Crowned Blood', vp: 3,
    desc: 'Win a battle in a Crown region this turn.',
    check: s => alive(s).filter(p => s.turnStats.crownBattlesWon[p] > 0),
  },
  slaughter: {
    name: 'Edict of the Iron Tithe', vp: 3,
    desc: 'Destroy 4 or more enemy ships this turn.',
    check: s => alive(s).filter(p => s.turnStats.kills[p] >= 4),
  },
  expansion: {
    name: 'Edict of the Long Reach', vp: 3,
    desc: 'Capture 2 or more regions this turn (force or influence).',
    check: s => alive(s).filter(p => s.turnStats.captures[p] >= 2),
  },
  throne_hold: {
    name: 'Edict of the Empty Seat', vp: 4,
    desc: 'Hold the Hollow Throne for the whole turn.',
    check: (s, c) => alive(s).filter(p => s.regions.some(r => r.kind === 'throne' && r.owner === p && c.startOwners[r.id] === p)),
  },
  deep_strike: {
    name: 'Edict of the Knife', vp: 4,
    desc: 'End the turn with a fleet in a rival\'s capital.',
    check: s => alive(s).filter(p => { const caps = rivalCapitals(s, p); return s.fleets.some(f => f.owner === p && f.ships.length && caps.includes(f.region)); }),
  },
  relic_hoard: {
    name: 'Edict of Memory', vp: 2,
    desc: 'Own strictly the most relic regions.',
    check: s => {
      const c = alive(s).map(p => ({ p, n: s.regions.filter(r => r.kind === 'relic' && r.owner === p).length }));
      const max = Math.max(...c.map(x => x.n));
      const top = c.filter(x => x.n === max);
      return max > 0 && top.length === 1 ? [top[0].p] : [];
    },
  },
  two_crowns: {
    name: 'Edict of the Pair', vp: 3,
    desc: 'Hold two or more Crowns for the whole turn.',
    check: (s, c) => alive(s).filter(p => s.regions.filter(r => r.kind === 'crown' && r.owner === p && c.startOwners[r.id] === p).length >= 2),
  },
};
