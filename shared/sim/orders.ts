// Order catalogue: costs, descriptions and validation. Used by the resolver,
// the UI (to grey out impossible orders) and the AI.
import type { Res } from '../config/rules.ts';
import { fleetSpeed } from './graph.ts';
import type { GameState, Order, PlayerId } from './types.ts';

export const ORDER_INFO: Record<Order['type'], { name: string; icon: string; help: string }> = {
  move:      { name: 'Move',      icon: '➤', help: 'Move a fleet up to its speed in regions. Overdrive: +1 range, but the fleet is fatigued next turn (weaker attacks).' },
  seize:     { name: 'Seize',     icon: '⚔', help: 'Move into an adjacent (or current) region and take it by force: defeat its garrison and any defenders. Other fleets adjacent to the target can JOIN the assault (they each use one of their own per-fleet actions).' },
  build:     { name: 'Build',     icon: '⚙', help: 'Build a ship at a region you own that has a shipyard. It joins a fleet there or forms a new one.' },
  develop:   { name: 'Develop',   icon: '▲', help: 'Start a project at a region you own. Projects finish on their own over the next turns.' },
  fortify:   { name: 'Fortify',   icon: '⛨', help: 'Dig a fleet in: it hits harder and is harder to hit until it moves.' },
  influence: { name: 'Influence', icon: '✦', help: 'Push a region\'s loyalty toward you; it defects when loyalty reaches its threshold (higher for rival regions and fortresses; capitals never). One per region per turn. On your OWN region it purges rival agents.' },
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
      const c = { ...(Object.hasOwn(s.rules.ships, o.cls) ? s.rules.ships[o.cls].cost : undefined) };
      if (s.players[p]?.relics.includes('loom') && c.industry) c.industry = Math.round(c.industry * 0.85);
      return c;
    }
    case 'develop': return { ...(Object.hasOwn(s.rules.projects, o.project) ? s.rules.projects[o.project].cost : undefined) };
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

/** Credits can cover an industry shortfall at economy.creditsPerIndustry ¢ per ⚙ (a sink for spare cash). */
export function canAfford(have: Res, cost: Partial<Res>, rules?: { economy: { creditsPerIndustry: number } }): boolean {
  const rate = rules?.economy.creditsPerIndustry ?? 0;
  const shortInd = Math.max(0, (cost.industry ?? 0) - Math.max(0, have.industry));
  const credNeed = (cost.credits ?? 0) + (rate > 0 ? shortInd * rate : shortInd > 0 ? Infinity : 0);
  return have.credits >= credNeed && have.influence >= (cost.influence ?? 0);
}
export function pay(have: Res, cost: Partial<Res>, rules?: { economy: { creditsPerIndustry: number } }) {
  const rate = rules?.economy.creditsPerIndustry ?? 0;
  const ind = cost.industry ?? 0;
  const fromInd = Math.min(ind, Math.max(0, have.industry));
  have.industry -= fromInd;
  have.credits -= (ind - fromInd) * rate + (cost.credits ?? 0);
  have.influence -= cost.influence ?? 0;
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
    case 'seize': return `${fn(o.fleet)}${o.also?.length ? ` + ${o.also.map(fn).join(' + ')}` : ''} seize${o.also?.length ? '' : 's'} ${rn(o.target)}`;
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
  if (usesFleet && fleet!.bornTurn === s.turn && s.turn > 1) return 'this fleet was only just formed and can act next turn';
  if (usesFleet && fleet!.ordersThisTurn > s.rules.orders.maxPerFleet) return `a fleet can take at most ${s.rules.orders.maxPerFleet} orders per turn`;
  // ids may come from untrusted clients: only plain integer indices name a region
  const reg = (rid: unknown) => (Number.isInteger(rid) ? s.regions[rid as number] : undefined);
  const own = (rid: number) => reg(rid)?.owner === p;
  switch (o.type) {
    case 'move': {
      if (!Array.isArray(o.path) || !o.path.length) return 'empty path';
      const sp = fleetSpeed(s, fleet!) + (o.overdrive ? s.rules.overdrive.speedBonus : 0);
      if (!s.live && o.path.length > sp) return `too far (speed ${sp})`;   // LIVE: any distance; travel takes time
      let cur = fleet!.region;
      for (const r of o.path) {
        if (!s.regions[cur].neighbors.includes(r)) return 'path is not connected';
        cur = r;
      }
      if (o.overdrive && fleet!.fatigued) return 'fleet is fatigued and cannot overdrive';
      return null;
    }
    case 'seize': {
      const t = reg(o.target);
      if (!t) return 'no such region';
      if (t.owner === p) return 'already yours';
      if (fleet!.region !== o.target && !s.regions[fleet!.region].neighbors.includes(o.target)) return 'target must be adjacent';
      if (o.also !== undefined && (!Array.isArray(o.also) || o.also.length > 8)) return 'bad joining fleets';
      for (const id of o.also ?? []) {
        const g = s.fleets.find(x => x.id === id);
        if (!g || g.owner !== p || !g.ships.length) return 'a joining fleet is not yours';
        if (g.region !== o.target && !s.regions[g.region].neighbors.includes(o.target)) return `${g.name} is not adjacent to the target`;
      }
      return null;
    }
    case 'build': {
      const r = reg(o.region);
      if (!r) return 'no such region';
      const d = Object.hasOwn(s.rules.ships, o.cls) ? s.rules.ships[o.cls] : undefined;
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
      const r = reg(o.region);
      if (!r) return 'no such region';
      const pd = Object.hasOwn(s.rules.projects, o.project) ? s.rules.projects[o.project] : undefined;
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
      const r = reg(o.target);
      if (!r) return 'no such region';
      if (r.owner === p) return r.loyalty.some((x, i) => i !== p && x > 0) ? null : 'no rival agents to purge here';
      if (r.kind === 'void') return 'nobody lives there';
      if (r.owner !== null && s.players[r.owner].capital === r.id) return 'capitals cannot be subverted';
      if (r.owner !== null && s.pacts.some(x => x.until >= s.turn && ((x.a === p && x.b === r.owner) || (x.b === p && x.a === r.owner)))) return 'you have a pact with its owner';
      const near = r.neighbors.some(n => s.regions[n].owner === p) || s.fleets.some(f => f.owner === p && f.region === r.id && f.ships.length);
      if (!near) return 'must border a region you own (or have a fleet there)';
      return null;
    }
    case 'scan': case 'feint': return reg(o.target) ? null : 'no such region';
    case 'conceal': return null;
    case 'excavate': {
      const r = s.regions[fleet!.region];
      if (r.relic !== 'unclaimed') return 'no relic here';
      if (r.owner !== p) return 'you must own the region';
      return null;
    }
    case 'pact': {
      if (o.with === p || !Number.isInteger(o.with) || !s.players[o.with] || s.players[o.with].eliminated) return 'invalid partner';
      return null;
    }
  }
  return 'unknown order';
}
