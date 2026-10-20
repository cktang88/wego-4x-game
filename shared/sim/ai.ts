// Heuristic AI. Three skill levels so we can measure "do good players beat bad
// players?" in headless simulations (npm run sim).
//   novice   – greedy-ish but noisy, ignores threats, edicts and doctrine.
//   standard – greedy utility with a little noise.
//   expert   – greedy utility + threat response, edicts, leader bounties,
//              force concentration, doctrine tuning, overdrive strikes, pacts.
import { hostile } from './combat.ts';
import { EDICTS } from './edicts.ts';
import { findPath, fleetPower, fleetSpeed, within } from './graph.ts';
import { canAfford, orderCost, pay, validateOrder } from './orders.ts';
import { Rng } from './rng.ts';
import { emptySubmission, currentLeader } from './resolve.ts';
import type { Fleet, FreeAction, GameState, Order, PlayerId, Region, Submission } from './types.ts';
import { coverage, seesFleetsIn } from './visibility.ts';

interface Cand { o: Order; v: number; tag: string }

export function planTurn(s0: GameState, pid: PlayerId, level?: 'novice' | 'standard' | 'expert'): Submission {
  const lvl = level ?? s0.players[pid].aiLevel;
  const sub = emptySubmission(s0);
  const me = s0.players[pid];
  if (me.eliminated) return sub;
  const rng = new Rng((s0.seed ^ (s0.turn * 7919) ^ (pid * 104729)) >>> 0);
  const s = perceive(s0, pid);
  const expert = lvl === 'expert', novice = lvl === 'novice';
  const aggr = s.rules.ai.aggression * (expert ? 1.1 : 1);
  const leader = currentLeader(s);
  const nextEdicts = s.edicts.map(e => e.id);

  // -------------------------------------------------- free actions: doctrine & merges
  const myFleets = () => s.fleets.filter(f => f.owner === pid && f.ships.length);
  if (!novice) {
    for (const f of myFleets()) {
      const threatened = enemyPowerNear(s, pid, f.region, 1) > fleetPower(s, f) * 0.6;
      const atHome = s.regions[f.region].owner === pid;
      const hasSiege = f.ships.some(x => (s.rules.ships[x.cls]?.siege ?? 0) >= 4);
      const d = {
        stance: (atHome && threatened ? 'defensive' : 'aggressive') as Fleet['doctrine']['stance'],
        retreatAt: expert ? (atHome ? 0.2 : 0.4) : 0.35,
        target: (hasSiege ? 'garrison' : expert ? 'weakest' : 'weakest') as Fleet['doctrine']['target'],
        guard: atHome && (expert || threatened),
      };
      if (f.ships.length === 1 && s.rules.ships[f.ships[0].cls]?.hp <= 6) { d.stance = 'evasive'; d.guard = false; }
      sub.free.push({ type: 'doctrine', fleet: f.id, doctrine: d });
      f.doctrine = d;
    }
    // concentrate force: merge small fleets sharing a region
    if (expert) {
      const byRegion = new Map<number, Fleet[]>();
      for (const f of myFleets()) (byRegion.get(f.region) ?? byRegion.set(f.region, []).get(f.region)!).push(f);
      for (const fl of byRegion.values()) {
        fl.sort((a, b) => b.ships.length - a.ships.length);
        for (let i = 1; i < fl.length; i++) {
          if (fl[0].ships.length + fl[i].ships.length <= s.rules.maxShipsPerFleet && fl[i].ships.every(x => x.cls !== 'scout')) {
            const fa: FreeAction = { type: 'merge', fleet: fl[i].id, into: fl[0].id };
            sub.free.push(fa);
            fl[0].ships.push(...fl[i].ships); fl[i].ships = [];
          }
        }
      }
      s.fleets = s.fleets.filter(f => f.ships.length);
    }
  }

  // -------------------------------------------------- order slots (greedy over projected state)
  const usedTargets = new Set<string>();
  const fleetUses = new Map<number, number>();
  for (let slot = 0; slot < s.rules.orders.perTurn; slot++) {
    const cands = candidates();
    const valid = cands.filter(c => !validateOrder(s, pid, c.o) && canAfford(me0().res, orderCost(s, c.o, pid)) && !usedTargets.has(c.tag) && c.v > 0.3);
    if (!valid.length) continue;
    valid.sort((a, b) => b.v - a.v);
    let pick: Cand;
    if (novice) pick = valid[Math.floor(rng.next() * Math.min(valid.length, 6))];
    else if (!expert && rng.chance(0.2)) pick = valid[Math.min(valid.length - 1, 1)];
    else pick = valid[0];
    sub.orders[slot] = pick.o;
    usedTargets.add(pick.tag);
    project(pick.o);
  }
  return sub;

  function me0() { return s.players[pid]; }

  function project(o: Order) {
    pay(me0().res, orderCost(s, o, pid));
    if ('fleet' in o && o.fleet !== null) fleetUses.set(o.fleet, (fleetUses.get(o.fleet) ?? 0) + 1);
    if (o.type === 'move') { const f = s.fleets.find(x => x.id === o.fleet)!; f.region = o.path[o.path.length - 1]; }
    if (o.type === 'seize') {
      const f = s.fleets.find(x => x.id === o.fleet)!;
      f.region = o.target;
      // optimistic: assume it falls (so we don't seize it twice)
      usedTargets.add(`seize:${o.target}`);
    }
    if (o.type === 'develop') s.regions[o.region].project = { key: o.project, progress: 0, owner: pid };
  }

  function regionValue(r: Region): number {
    let v = 0;
    switch (r.kind) {
      case 'throne': v = 9 + Math.min(5, s.throne.owner === pid ? s.throne.streak + 1 : 1) * 1.5; break;
      case 'crown': v = 10; break;
      case 'relic': v = r.relic === 'unclaimed' ? 8 : 3; break;
      case 'home': v = 6 + r.dev * 2; break;
      case 'void': v = 1; break;
      default: v = 2 + r.dev * 1.5;
    }
    if (r.owner !== null && r.owner !== pid && s.players[r.owner].capital === r.id) v += 8;
    if (expert) {
      if (r.owner !== null && r.owner === leader && leader !== pid) v += 3;
      if (nextEdicts.includes('two_crowns') && r.kind === 'crown') v += 3;
      if (nextEdicts.includes('throne_hold') && r.kind === 'throne') v += 4;
      if (nextEdicts.includes('border_raid') && s.players.some(o => o.id !== pid && s.regions[o.capital].neighbors.includes(r.id))) v += 3;
      if (nextEdicts.includes('relic_hoard') && r.kind === 'relic') v += 2;
      // neighbours we already own make a region easier to hold
      v += r.neighbors.filter(n => s.regions[n].owner === pid).length * 0.4;
    }
    if (r.kind === 'throne' && s.fleets.some(f => f.owner === -1)) v -= 6;
    return v;
  }

  function defense(r: Region, attacker: PlayerId): number {
    let d = r.owner === null && novice ? r.garrison * 0.5 : r.garrison * 1.15 + (r.buildings.fortress ?? 0) * 5;
    for (const f of s.fleets) {
      if (!f.ships.length || !hostile(s, f.owner, attacker)) continue;
      if (f.region === r.id) d += fleetPower(s, f) * (f.fortified ? 1.3 : 1);
      else if (!novice && r.owner !== null && f.owner === r.owner && f.doctrine.guard && r.neighbors.includes(f.region)) d += fleetPower(s, f) * 0.7;
    }
    return d;
  }

  function winP(att: number, def: number): number {
    if (def <= 0) return 0.98;
    const ratio = att / def;
    return 1 / (1 + Math.exp(-(ratio - 1.25) * 3.2));
  }

  function candidates(): Cand[] {
    const out: Cand[] = [];
    const R = s.rules;
    const fleets = myFleets();
    const myPow = fleets.reduce((a, f) => a + fleetPower(s, f), 0) || 1;
    const rivalPow = Math.max(1, ...s.players.filter(p => p.id !== pid && !p.eliminated).map(p => s.fleets.filter(f => f.owner === p.id).reduce((a, f) => a + fleetPower(s, f), 0)));

    for (const f of fleets) {
      if (f.id < 0) continue;
      const uses = fleetUses.get(f.id) ?? 0;
      if (uses >= R.orders.maxPerFleet) continue;
      const fatiguePenalty = uses > 0 ? (me0().res.credits > 20 ? 1 : 4) : 0;
      const pow = fleetPower(s, f);
      const here = s.regions[f.region];
      const isScout = f.ships.every(x => x.cls === 'scout');
      // excavate
      if (here.relic === 'unclaimed' && here.owner === pid) out.push({ o: { type: 'excavate', fleet: f.id }, v: 14 - fatiguePenalty, tag: `ex:${here.id}` });
      // seize adjacent / current
      for (const tid of [here.id, ...here.neighbors]) {
        const t = s.regions[tid];
        if (t.owner === pid) continue;
        if (t.owner !== null && !hostile(s, pid, t.owner) && !(expert && leader === t.owner)) continue;
        if (isScout && t.garrison > 2) continue;
        const def = defense(t, pid);
        const p = winP(pow, def);
        let v = regionValue(t) * p * aggr - (1 - p) * pow * 0.08 - fatiguePenalty;
        if (t.owner !== null && t.owner !== pid && t.owner >= 0) v += 1.5 * aggr; // conflict is the point
        out.push({ o: { type: 'seize', fleet: f.id, target: tid }, v, tag: `seize:${tid}` });
      }
      // move toward something worth taking, or home to defend
      const sp = fleetSpeed(s, f);
      const reach = [...within(s, f.region, sp + (expert && !f.fatigued ? R.overdrive.speedBonus : 0))].filter(x => x !== f.region);
      for (const dest of reach) {
        const path = findPath(s, f.region, dest);
        if (!path) continue;
        const od = path.length > sp;
        // no passing through hostile garrisons
        if (path.slice(0, -1).some(x => s.regions[x].owner !== null && s.regions[x].owner !== pid && s.regions[x].garrison > 0)) continue;
        const dr = s.regions[dest];
        // value: best seize opportunity next turn from dest, plus defensive value
        let best = 0;
        for (const n of [dest, ...dr.neighbors]) {
          const t = s.regions[n];
          if (t.owner === pid) continue;
          best = Math.max(best, regionValue(t) * winP(pow, defense(t, pid)));
        }
        let v = best * 0.45 * aggr / Math.max(1, path.length * 0.6);
        if (dr.owner === pid) {
          const threat = enemyPowerNear(s, pid, dest, 1);
          if (threat > dr.garrison) v = Math.max(v, regionValue(dr) * Math.min(1.2, threat / (pow + 1)) * (novice ? 0.3 : 1));
        }
        if (dr.owner !== null && dr.owner !== pid && dr.garrison > 0) continue; // would be blocked anyway
        if (isScout) v = (s.regions[dest].relic === 'unclaimed' ? 3 : 1.2) + (coverage(s, pid).has(dest) ? 0 : 1.5);
        v -= fatiguePenalty + (od ? 1.5 : 0);
        out.push({ o: { type: 'move', fleet: f.id, path, overdrive: od || undefined }, v, tag: `move:${f.id}` });
      }
      // fortify when threatened at home
      if (!novice && here.owner === pid && enemyPowerNear(s, pid, here.id, 1) > pow * 0.5 && !f.fortified) {
        out.push({ o: { type: 'fortify', fleet: f.id }, v: 4 + regionValue(here) * 0.2, tag: `fort:${f.id}` });
      }
    }

    // ------------- economy
    const need = Math.min(2.5, rivalPow / myPow);
    for (const r of s.regions.filter(x => x.owner === pid)) {
      const yard = r.buildings.shipyard ?? 0;
      if (yard > 0 && !s.fleets.some(f => f.region === r.id && f.ships.length && hostile(s, f.owner, pid))) {
        const joinable = myFleets().find(f => f.region === r.id && f.ships.length < R.maxShipsPerFleet && f.id >= 0);
        for (const [cls, d] of Object.entries(R.ships)) {
          if (d.needsShipyard > yard || cls === 'scout') continue;
          const cost = d.cost.industry ?? 0;
          const eff = (d.hp * 0.5 + d.attack * d.shots * 2 + d.shields * 2) / Math.max(10, cost + (d.cost.credits ?? 0));
          const v = (3 + need * 3.5 * aggr) * eff * 2.2 + (novice ? rng.next() * 2 : 0);
          out.push({ o: { type: 'build', region: r.id, cls, fleet: joinable ? joinable.id : null }, v, tag: `build:${r.id}:${cls}` });
        }
      }
      if (!r.project) {
        const add = (key: string, v: number) => out.push({ o: { type: 'develop', region: r.id, project: key }, v, tag: `dev:${r.id}` });
        const threat = enemyPowerNear(s, pid, r.id, 2);
        if (r.kind === 'home' && yard < 2) add('shipyard', s.turn < 10 ? 6 : 3);
        if (r.kind === 'home' && yard === 2 && s.turn > 8) add('shipyard', 3);
        if (r.dev < R.economy.maxDev && r.kind !== 'void') add('develop', 2.2 + r.dev * 0.4 + (s.turn < 12 ? 1.5 : 0));
        if ((r.buildings.mine ?? 0) < 2 && r.kind !== 'void') add('mine', 2.5 + (s.turn < 10 ? 1 : 0));
        if ((r.buildings.tradehub ?? 0) < 1 && me0().res.credits < 30) add('tradehub', 3);
        if ((r.buildings.fortress ?? 0) < 2 && (r.kind === 'crown' || r.kind === 'throne' || r.kind === 'home') && !novice) add('fortress', 2 + Math.min(4, threat / 15));
      }
    }
    // influence neutrals next door
    for (const r of s.regions) {
      if (r.owner === pid || r.kind === 'void') continue;
      if (r.owner !== null && (s.players[r.owner].capital === r.id || novice)) continue;
      const near = r.neighbors.some(n => s.regions[n].owner === pid);
      if (!near) continue;
      const thr = r.owner === null ? R.influence.flipThreshold : R.influence.rivalFlipThreshold;
      const after = r.loyalty[pid] + R.influence.pushAmount + R.influence.adjacentBonus;
      const v = regionValue(r) * (after >= thr ? 1 : after / thr * 0.45) - (r.owner !== null ? 1 : 0);
      out.push({ o: { type: 'influence', target: r.id }, v, tag: `inf:${r.id}` });
    }
    if (expert) {
      // pact with the weaker rival if someone is running away with it
      if (leader !== null && leader !== pid) {
        const other = s.players.find(p => p.id !== pid && p.id !== leader && !p.eliminated);
        if (other && !s.pacts.some(x => (x.a === pid && x.b === other.id) || (x.b === pid && x.a === other.id))) out.push({ o: { type: 'pact', with: other.id }, v: 3, tag: 'pact' });
      }
      // scan an enemy staging area next to our best region
      const cap = s.regions[me0().capital];
      const hidden = cap.neighbors.find(n => s.regions[n].feature === 'nebula' && s.regions[n].owner !== pid);
      if (hidden !== undefined) out.push({ o: { type: 'scan', target: hidden }, v: 1.5, tag: 'scan' });
    }
    return out;
  }
}

/** The AI's view of the world: fleets it can't see are removed (unless cheatVision). */
function perceive(s0: GameState, pid: PlayerId): GameState {
  const s = structuredClone({ ...s0, last: null, log: [] }) as GameState;
  if (s.rules.ai.cheatVision) return s;
  const cov = coverage(s, pid);
  s.fleets = s.fleets.filter(f => f.owner === pid || seesFleetsIn(s, pid, f.region, cov));
  return s;
}

function enemyPowerNear(s: GameState, pid: PlayerId, rid: number, range: number): number {
  const area = within(s, rid, range);
  return s.fleets.filter(f => f.ships.length && area.has(f.region) && hostile(s, f.owner, pid)).reduce((a, f) => a + fleetPower(s, f), 0);
}

export { EDICTS };
