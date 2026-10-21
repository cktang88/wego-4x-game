// Order catalogue: costs, descriptions and validation. Used by the resolver,
// the UI (to grey out impossible orders) and the AI.
import type { Res } from '../config/rules.ts';
import { fleetSpeed } from './graph.ts';
import type { GameState, Order, PlayerId, Ship } from './types.ts';
import { classBlock, moveNeighbors, hasLaw, hasTech, lawBlock, lawCost, lookup, maxDevAt, projectBlock, projectCostMod, shipCostMod, blueprintFor } from './empire.ts';
import { LAW } from '../config/empire.ts';
import { DEEDS } from '../config/content.ts';
import { soulOn, SR, bannersFree, bannerLimit, resolveFound, razeBlock, soulShipDiscount, hasBane } from './soul.ts';
import { isDugIn } from './signature.ts';

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
  law:       { name: 'Enact law', icon: '⚑', help: 'Enact a law from your Charter (costs influence). Switching a pair to its other side costs double.' },
  refit:     { name: 'Refit',     icon: '⚒', help: 'At one of your shipyards: every ship in the fleet gets its class\'s current module, and is fully repaired.' },
  retire:    { name: 'Retire',    icon: '⚑', help: 'A Storied or Legend fleet furls its banner at one of your worlds. Its ships stand down; the world becomes its Haven (a permanent Deed carrying its first boon).' },
  engrave:   { name: 'Engrave',   icon: '✎', help: 'Engrave one of a world\'s Deeds so it is never replaced.' },
  raze:      { name: 'Raze',      icon: '🔥', help: 'Raze a world you captured last turn: a lump of industry and credits, development −1, its calling lost; its former owner swears vengeance.' },
};

export function orderCost(s: GameState, o: Order, p: PlayerId): Partial<Res> {
  const I = s.rules.influence;
  switch (o.type) {
    case 'build': {
      const c = { ...(Object.hasOwn(s.rules.ships, o.cls) ? s.rules.ships[o.cls].cost : undefined) };
      if (s.players[p]?.relics.includes('loom') && c.industry) c.industry = Math.round(c.industry * 0.85);
      const out = shipCostMod(s, p, o.cls, c);
      if (soulOn(s)) {
        // Soul: an Arsenal world builds cheaper; a Gilded fleet costs more to reinforce
        const disc = soulShipDiscount(s, s.regions[o.region]);
        if (disc && out.industry) out.industry = Math.round(out.industry * (1 - disc));
        const tf = o.fleet !== null ? s.fleets.find(x => x.id === o.fleet) : undefined;
        if (tf && hasBane(s, tf, 'gilded')) out.credits = (out.credits ?? 0) + SR(s).gildedCredits;
      }
      return out;
    }
    case 'develop': return projectCostMod(s, p, o.project, o.region, { ...(Object.hasOwn(s.rules.projects, o.project) ? s.rules.projects[o.project].cost : undefined) });
    case 'influence': {
      const r = s.regions[o.target];
      const c = r && r.owner !== null && r.owner !== p ? I.rivalSubvertCost : I.orderCost;
      return { influence: hasTech(s, p, 'subversion') ? Math.round(c * s.rules.empire.subversionCostMult) : c };
    }
    case 'scan': return hasLaw(s, p, 'open') ? {} : { influence: I.scanCost };
    case 'feint': return hasLaw(s, p, 'open') ? {} : { influence: I.feintCost };
    case 'conceal': return hasLaw(s, p, 'open') ? {} : { influence: I.concealCost };
    case 'law': return { influence: lookup(LAW, o.law) ? lawCost(s, p, o.law) : 0 };
    case 'refit': {
      const f = s.fleets.find(x => x.id === o.fleet);
      const n = f ? f.ships.filter(sh => outdated(s, p, sh)).length : 0;
      return n ? { industry: n * s.rules.empire.refitIndustryPerShip } : {};
    }
    case 'pact': return { influence: I.pactCost };
    case 'engrave': return { influence: SR(s).engraveInfluence, credits: SR(s).engraveCredits };
    default: return {};
  }
}

/** Joining fleets a combined Seize can take (resolve.ts uses `[...new Set(also)].slice(0, 3)`). */
export const MAX_JOINERS = 3;

/** A ship whose module isn't its class's current blueprint (a missing `mod` from an old save counts as none). */
const outdated = (s: GameState, p: PlayerId, sh: Ship) => (sh.mod ?? null) !== blueprintFor(s, p, sh.cls);

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
    case 'build': return `Build ${lookup(s.rules.ships, o.cls)?.name ?? o.cls} at ${rn(o.region)}`;
    case 'develop': return `${lookup(s.rules.projects, o.project)?.name ?? o.project} at ${rn(o.region)}`;
    case 'fortify': return `${fn(o.fleet)} fortifies`;
    case 'influence': return `Influence ${rn(o.target)}`;
    case 'scan': return `Scan ${rn(o.target)}`;
    case 'feint': return `Feint toward ${rn(o.target)}`;
    case 'conceal': return 'Conceal all signals';
    case 'excavate': return `${fn(o.fleet)} excavates`;
    case 'pact': return `Offer pact to ${s.players[o.with]?.name ?? '?'}`;
    case 'law': return `Enact ${lookup(LAW, o.law)?.name ?? o.law}`;
    case 'refit': return `Refit ${fn(o.fleet)}`;
    case 'retire': return `${fn(o.fleet)} retires`;
    case 'engrave': return `Engrave ${lookup(DEEDS, o.deed)?.name.replace(/\{fleet\}/, '…') ?? o.deed} at ${rn(o.region)}`;
    case 'raze': return `Raze ${rn(o.region)}`;
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
  // Signature: a Guarded fleet nobody came for is dug in: it can't move this turn
  if (usesFleet && (o.type === 'move' || o.type === 'seize') && isDugIn(s, fleet!)) return 'dug in: it cannot move this turn';
  // ids may come from untrusted clients: only plain integer indices name a region
  const reg = (rid: unknown) => (Number.isInteger(rid) ? s.regions[rid as number] : undefined);
  const own = (rid: number) => reg(rid)?.owner === p;
  switch (o.type) {
    case 'move': {
      if (!Array.isArray(o.path) || !o.path.length) return 'empty path';
      const sp = fleetSpeed(s, fleet!) + (o.overdrive ? s.rules.overdrive.speedBonus : 0);
      // WEGO and LIVE: any distance; the fleet travels its speed per turn/tick along the route (legacy pulse rules: one turn's reach)
      if (!s.live && s.rules.orders.pulses > 1 && o.path.length > sp) return `too far (speed ${sp})`;
      let cur = fleet!.region;
      for (const r of o.path) {
        if (!s.regions[cur] || !moveNeighbors(s, p, cur).includes(r)) return 'path is not connected';
        cur = r;
      }
      if (o.overdrive && fleet!.fatigued) return 'fleet is fatigued and cannot overdrive';
      return null;
    }
    case 'seize': {
      const t = reg(o.target);
      if (!t) return 'no such region';
      if (t.owner === p) return 'already yours';
      if (t.kind === 'lane') return 'nothing to seize in deep space';
      if (o.via !== undefined && (!Array.isArray(o.via) || o.via.length > 32 || !o.via.every(x => reg(x)))) return 'bad path';
      if (fleet!.limping) return 'a limping fleet cannot attack';
      const via = o.via ?? [];
      if (via.length) {
        // march then assault: the whole way (via + the target) must fit in one turn's movement
        if (!s.live && s.rules.orders.pulses > 1 && via.length + 1 > fleetSpeed(s, fleet!)) return `too far (speed ${fleetSpeed(s, fleet!)})`;
        let cur = fleet!.region;
        for (const r of via) { if (!moveNeighbors(s, p, cur).includes(r)) return 'path is not connected'; cur = r; }
        if (!moveNeighbors(s, p, cur).includes(o.target)) return 'target must be next to the end of the path';
      } else if (fleet!.region !== o.target && !moveNeighbors(s, p, fleet!.region).includes(o.target)) return 'target must be adjacent';
      if (o.also !== undefined && (!Array.isArray(o.also) || o.also.length > 8)) return 'bad joining fleets';
      // the resolver takes at most MAX_JOINERS distinct joiners and silently drops the rest: say so up front
      if (new Set((o.also ?? []).filter(id => id !== o.fleet)).size > MAX_JOINERS) return `at most ${MAX_JOINERS} fleets can join an assault`;
      for (const id of o.also ?? []) {
        const g = s.fleets.find(x => x.id === id);
        if (!g || g.owner !== p || !g.ships.length) return 'a joining fleet is not yours';
        if (g.region !== o.target && !moveNeighbors(s, p, g.region).includes(o.target)) return `${g.name} is not next to the target`;
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
      const cb = classBlock(s, p, o.cls);
      if (cb) return cb;
      if (o.fleet !== null) {
        const f = s.fleets.find(x => x.id === o.fleet);
        if (!f || f.owner !== p || f.region !== o.region) return 'target fleet not here';
        if (f.ships.length >= s.rules.maxShipsPerFleet) return 'fleet is full';
        if (soulOn(s) && !f.banner && o.cls !== 'scout') return 'a picket carries only scouts: found a fleet (a new banner) or build into a bannered fleet';
      } else {
        if (s.fleets.filter(f => f.owner === p && f.ships.length).length >= s.rules.maxFleets) return 'too many fleets';
        if (soulOn(s) && (o.cls !== 'scout' || o.found)) {
          // Soul: a new fleet raises a banner: one must be free (bannersBase + 1 per Crown held)
          if (bannersFree(s, p) <= 0) return `no free banner (${bannerLimit(s, p)} in use): build into a fleet here, or hold more Crowns`;
          const fd = resolveFound(s, p, o.region, o.found);
          if (typeof fd === 'string') return fd;
        }
      }
      return null;
    }
    case 'develop': {
      const r = reg(o.region);
      if (!r) return 'no such region';
      const pd = Object.hasOwn(s.rules.projects, o.project) ? s.rules.projects[o.project] : undefined;
      if (!pd) return 'unknown project';
      if (!own(o.region)) return 'not your region';
      if (r.project) return 'a project is already underway here';
      if (r.kind === 'void' && !['sensor', 'fortress', 'extractor', 'depot', 'gate', 'battery'].includes(o.project)) return 'nothing to build on in the void';
      const lvl = o.project === 'develop' ? r.dev : (r.buildings[o.project] ?? 0);
      if (lvl >= (o.project === 'develop' ? maxDevAt(s, r.id) : pd.max)) return 'already at max level';
      return projectBlock(s, p, o.project, r.id);
    }
    case 'fortify': return null;
    case 'influence': {
      const r = reg(o.target);
      if (!r) return 'no such region';
      if (r.owner === p) return r.loyalty.some((x, i) => i !== p && x > 0) ? null : 'no rival agents to purge here';
      if (r.kind === 'void' || r.kind === 'lane') return 'nobody lives there';
      if (r.owner !== null && s.players[r.owner].capital === r.id) return 'capitals cannot be subverted';
      if (r.owner !== null && hasLaw(s, r.owner, 'martial')) return `${s.players[r.owner].name} is under Martial Law`;
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
    case 'law': return typeof o.law === 'string' ? lawBlock(s, p, o.law) : 'unknown law';
    case 'retire': {
      if (!soulOn(s) || !fleet!.banner) return 'only a bannered fleet can retire';
      if (fleet!.commander.rank < SR(s).retireMinRank) return 'only Storied or Legend fleets retire';
      const r = s.regions[fleet!.region];
      if (r.owner !== p || r.kind === 'lane') return 'must be at one of your worlds';
      if (s.fleets.some(f => f.region === r.id && f.ships.length && f.owner !== p && (f.owner === -1 || !s.pacts.some(x => x.until >= s.turn && ((x.a === p && x.b === f.owner) || (x.b === p && x.a === f.owner)))))) return 'enemies present';
      return null;
    }
    case 'engrave': {
      const r = reg(o.region);
      if (!r) return 'no such region';
      if (!soulOn(s) || !r.story) return 'no deeds here';
      if (r.owner !== p) return 'not your world';
      const d = r.story.deeds.find(x => x.id === o.deed);
      if (!d) return 'that deed is not here';
      if (r.story.deeds.some(x => x.engraved)) return 'a deed is already engraved here';
      return null;
    }
    case 'raze': return razeBlock(s, p, o.region, false);
    case 'refit': {
      const r = s.regions[fleet!.region];
      if (r.owner !== p || !(r.buildings.shipyard ?? 0)) return 'must be at one of your shipyards';
      if (s.fleets.some(f => f.region === r.id && f.owner !== p && f.ships.length && (f.owner === -1 || !s.pacts.some(x => x.until >= s.turn && ((x.a === p && x.b === f.owner) || (x.b === p && x.a === f.owner)))))) return 'enemies present';
      if (!fleet!.ships.some(sh => outdated(s, p, sh) || sh.hp < sh.maxHp)) return 'already up to date and repaired';
      return null;
    }
  }
  return 'unknown order';
}
