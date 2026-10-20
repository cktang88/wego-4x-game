// Order catalogue: costs, descriptions and validation. Used by the resolver,
// the UI (to grey out impossible orders) and the AI.
import type { Res } from '../config/rules.ts';
import { fleetSpeed } from './graph.ts';
import type { GameState, Order, PlayerId } from './types.ts';

export const ORDER_INFO: Record<Order['type'], { name: string; icon: string; help: string }> = {
  move:      { name: 'Move',      icon: '➤', help: 'Move a fleet up to its speed in regions. Overdrive: +1 range, but the fleet is fatigued next turn (weaker attacks).' },
  seize:     { name: 'Seize',     icon: '⚔', help: 'Move into an adjacent (or current) region and take it by force: defeat its garrison and any defenders.' },
  build:     { name: 'Build',     icon: '⚙', help: 'Build a ship at a region you own that has a shipyard. It joins a fleet there or forms a new one.' },
  develop:   { name: 'Develop',   icon: '▲', help: 'Start a project at a region you own. Projects finish on their own over the next turns.' },
  fortify:   { name: 'Fortify',   icon: '⛨', help: 'Dig a fleet in: it hits harder and is harder to hit until it moves.' },
  influence: { name: 'Influence', icon: '✦', help: 'Push a region\'s loyalty toward you. Neutral regions defect at 100. Rival regions (not capitals) at 150.' },
  scan:      { name: 'Scan',      icon: '◎', help: 'Reveal a region and its neighbours this turn and next, including fleets in nebulae. Exposes feints there.' },
  feint:     { name: 'Feint',     icon: '☍', help: 'Broadcast fake fleet-movement signals toward a region. Rivals who scan it see through it.' },
  conceal:   { name: 'Conceal',   icon: '☾', help: 'Hide all your signals this turn. Rivals only see a jamming signal from your capital.' },
  excavate:  { name: 'Excavate',  icon: '✧', help: 'A fleet in a relic region you own digs up its relic: VP, a permanent bonus, and a piece of the truth.' },
  pact:      { name: 'Pact',      icon: '⚭', help: 'Offer a non-aggression pact. If both players offer each other on the same turn it forms for several turns. Breaking one costs VP.' },
};

export function orderCost(s: GameState, o: Order, p: PlayerId): Partial<Res> {
  const I = s.rules.influence;
  switch (o.type) {
    case 'build': {
      const c = { ...s.rules.ships[o.cls]?.cost };
      if (s.players[p]?.relics.includes('loom') && c.industry) c.industry = Math.round(c.industry * 0.85);
      return c;
    }
    case 'develop': return { ...s.rules.projects[o.project]?.cost };
    case 'influence': {
      const r = s.regions[o.target];
      return { influence: r && r.owner !== null && r.owner !== p ? I.rivalSubvertCost : I.orderCost };
    }
    case 'scan': return { influence: I.scanCost };
    case 'feint': return { influence: I.feintCost };
    case 'conceal': return { influence: I.concealCost };
    case 'pact': return { influence: I.pactCost };
    default: return {};
  }
}

export function canAfford(have: Res, cost: Partial<Res>): boolean {
  return (Object.keys(cost) as (keyof Res)[]).every(k => (have[k] ?? 0) >= (cost[k] ?? 0));
}
export function pay(have: Res, cost: Partial<Res>) {
  for (const k of Object.keys(cost) as (keyof Res)[]) have[k] -= cost[k] ?? 0;
}
export function costText(c: Partial<Res>): string {
  const parts: string[] = [];
  if (c.industry) parts.push(`${c.industry}⚙`);
  if (c.credits) parts.push(`${c.credits}¢`);
  if (c.influence) parts.push(`${c.influence}✦`);
  return parts.join(' ');
}

/** Human description of an order. */
export function describeOrder(s: GameState, o: Order): string {
  const rn = (id: number) => s.regions[id]?.name ?? '?';
  const fn = (id: number) => s.fleets.find(f => f.id === id)?.name ?? `fleet #${id}`;
  switch (o.type) {
    case 'move': return `${fn(o.fleet)} → ${o.path.map(rn).join(' → ')}${o.overdrive ? ' (overdrive)' : ''}`;
    case 'seize': return `${fn(o.fleet)} seizes ${rn(o.target)}`;
    case 'build': return `Build ${s.rules.ships[o.cls]?.name ?? o.cls} at ${rn(o.region)}`;
    case 'develop': return `${s.rules.projects[o.project]?.name ?? o.project} at ${rn(o.region)}`;
    case 'fortify': return `${fn(o.fleet)} fortifies`;
    case 'influence': return `Influence ${rn(o.target)}`;
    case 'scan': return `Scan ${rn(o.target)}`;
    case 'feint': return `Feint toward ${rn(o.target)}`;
    case 'conceal': return 'Conceal all signals';
    case 'excavate': return `${fn(o.fleet)} excavates`;
    case 'pact': return `Offer pact to ${s.players[o.with]?.name ?? '?'}`;
  }
}

/**
 * Validate an order against a state. At planning time the state is the start of
 * the turn (with fleet positions projected by the client); at resolution time it
 * is the live mid-turn state. Returns an error string or null.
 */
export function validateOrder(s: GameState, p: PlayerId, o: Order): string | null {
  const usesFleet = 'fleet' in o && o.type !== 'build';
  const fleet = usesFleet ? s.fleets.find(f => f.id === (o as { fleet: number }).fleet) : undefined;
  if (usesFleet) {
    if (!fleet || !fleet.ships.length) return 'fleet no longer exists';
    if (fleet.owner !== p) return 'not your fleet';
  }
  if (usesFleet && fleet!.ordersThisTurn > s.rules.orders.maxPerFleet) return `a fleet can take at most ${s.rules.orders.maxPerFleet} orders per turn`;
  const own = (rid: number) => s.regions[rid]?.owner === p;
  switch (o.type) {
    case 'move': {
      if (!o.path.length) return 'empty path';
      let cur = fleet!.region;
      for (const r of o.path) {
        if (!s.regions[cur].neighbors.includes(r)) return 'path is not connected';
        cur = r;
      }
      const sp = fleetSpeed(s, fleet!) + (o.overdrive ? s.rules.overdrive.speedBonus : 0);
      if (o.overdrive && fleet!.fatigued) return 'fleet is fatigued and cannot overdrive';
      if (o.path.length > sp) return `too far (speed ${sp})`;
      return null;
    }
    case 'seize': {
      const t = s.regions[o.target];
      if (!t) return 'no such region';
      if (t.owner === p) return 'already yours';
      if (fleet!.region !== o.target && !s.regions[fleet!.region].neighbors.includes(o.target)) return 'target must be adjacent';
      return null;
    }
    case 'build': {
      const r = s.regions[o.region];
      const d = s.rules.ships[o.cls];
      if (!d) return 'unknown ship class';
      if (!own(o.region)) return 'not your region';
      if ((r.buildings.shipyard ?? 0) < d.needsShipyard) return `needs shipyard level ${d.needsShipyard}`;
      if (o.fleet !== null) {
        const f = s.fleets.find(x => x.id === o.fleet);
        if (!f || f.owner !== p || f.region !== o.region) return 'target fleet not here';
        if (f.ships.length >= s.rules.maxShipsPerFleet) return 'fleet is full';
      } else if (s.fleets.filter(f => f.owner === p && f.ships.length).length >= s.rules.maxFleets) return 'too many fleets';
      return null;
    }
    case 'develop': {
      const r = s.regions[o.region];
      const pd = s.rules.projects[o.project];
      if (!pd) return 'unknown project';
      if (!own(o.region)) return 'not your region';
      if (r.project) return 'a project is already underway here';
      if (r.kind === 'void' && o.project !== 'sensor' && o.project !== 'fortress') return 'nothing to build on in the void';
      const lvl = o.project === 'develop' ? r.dev : (r.buildings[o.project] ?? 0);
      if (lvl >= pd.max) return 'already at max level';
      return null;
    }
    case 'fortify': return null;
    case 'influence': {
      const r = s.regions[o.target];
      if (!r) return 'no such region';
      if (r.owner === p) return 'already yours';
      if (r.kind === 'void') return 'nobody lives there';
      if (r.owner !== null && s.players[r.owner].capital === r.id) return 'capitals cannot be subverted';
      const near = r.neighbors.some(n => s.regions[n].owner === p) || s.fleets.some(f => f.owner === p && f.region === r.id && f.ships.length);
      if (!near) return 'must border a region you own (or have a fleet there)';
      return null;
    }
    case 'scan': case 'feint': return s.regions[o.target] ? null : 'no such region';
    case 'conceal': return null;
    case 'excavate': {
      const r = s.regions[fleet!.region];
      if (r.relic !== 'unclaimed') return 'no relic here';
      if (r.owner !== p) return 'you must own the region';
      return null;
    }
    case 'pact': {
      if (o.with === p || !s.players[o.with] || s.players[o.with].eliminated) return 'invalid partner';
      return null;
    }
  }
}
