// Heuristic AI. Three skill levels so we can measure "do good players beat bad
// players?" in headless simulations (npm run sim -- --suite).
//   novice   – coherent but naive: greedy with noise, rough strength guesses,
//              ignores threats, edicts, doctrine and fleet concentration.
//   standard – greedy utility using a crude power ratio, a little noise.
//   expert   – plans with a battle predictor (expected-value combat sim),
//              concentrates force, defends what it holds, builds for the job
//              (bombards for sieges, big hulls for order-efficiency), plays
//              edicts, hunts the VP leader, and contests the Throne when the
//              Warden is away.
// Everything is deterministic: the only randomness is the seeded Rng.
import { hostile } from './combat.ts';
import { EDICTS } from './edicts.ts';
import { findPath, fleetPower, fleetSpeed, within } from './graph.ts';
import { canAfford, orderCost, pay, validateOrder } from './orders.ts';
import { Rng } from './rng.ts';
import { emptySubmission, currentLeader } from './resolve.ts';
import type { Fleet, FreeAction, GameState, Order, PlayerId, Region, Submission } from './types.ts';
import { coverage, seesFleetsIn } from './visibility.ts';

interface Cand { o: Order; v: number; tag: string }
type Level = 'novice' | 'standard' | 'expert';

export function planTurn(s0: GameState, pid: PlayerId, level?: Level): Submission {
  const lvl = level ?? s0.players[pid].aiLevel;
  const sub = emptySubmission(s0);
  const me = s0.players[pid];
  if (me.eliminated) return sub;
  const rng = new Rng((s0.seed ^ (s0.turn * 7919) ^ (pid * 104729)) >>> 0);
  const s = perceive(s0, pid);
  const R = s.rules;
  const expert = lvl === 'expert', novice = lvl === 'novice';
  const aggr = R.ai.aggression;
  const leader = currentLeader(s);
  const edictsNow = s.edicts.filter(e => e.scoresTurn === s.turn).map(e => e.id); // judged at the end of THIS turn
  const myFleets = () => s.fleets.filter(f => f.owner === pid && f.ships.length && f.id >= 0);
  const warden = () => s.fleets.find(f => f.owner === -1 && f.ships.length);
  const throneId = s.regions.find(r => r.kind === 'throne')!.id;
  const crowns = s.regions.filter(r => r.kind === 'crown');
  const myCrowns = crowns.filter(r => r.owner === pid).length;
  const simCache = new Map<string, SimResult>();

  // -------------------------------------------------- expert: threat map (computed once)
  // threatened[rid] = how likely the strongest nearby rival could take/break it this turn
  const threatened = new Map<number, number>();
  if (expert) {
    for (const r of s.regions) {
      if (r.owner !== pid || !(r.kind === 'home' || r.kind === 'crown' || r.kind === 'throne' || r.id === me.capital)) continue;
      const p = threatTo(r.id, []);
      if (p > 0.25) threatened.set(r.id, p);
    }
  }

  // -------------------------------------------------- free actions: merges & doctrine
  if (expert) {
    // concentrate force: merge fleets sharing a region (scouts stay separate)
    const byRegion = new Map<number, Fleet[]>();
    for (const f of myFleets()) if (!isScoutFleet(f)) (byRegion.get(f.region) ?? byRegion.set(f.region, []).get(f.region)!).push(f);
    for (const fl of byRegion.values()) {
      fl.sort((a, b) => b.ships.length - a.ships.length);
      for (let i = 1; i < fl.length; i++) {
        if (fl[0].ships.length + fl[i].ships.length > R.maxShipsPerFleet) continue;
        sub.free.push({ type: 'merge', fleet: fl[i].id, into: fl[0].id } as FreeAction);
        fl[0].ships.push(...fl[i].ships); fl[i].ships = [];
      }
    }
    s.fleets = s.fleets.filter(f => f.ships.length);
  }
  if (!novice) {
    for (const f of myFleets()) {
      const here = s.regions[f.region];
      const atHome = here.owner === pid;
      const holding = threatened.has(here.id);
      const d: Fleet['doctrine'] = {
        stance: atHome && enemyPowerNear(s, pid, f.region, 1) > fleetPower(s, f) * 0.6 ? 'defensive' : 'aggressive',
        // expert: hold the line at threatened key worlds, otherwise cut losses early
        retreatAt: expert ? (holding ? 0 : atHome ? 0.25 : 0.4) : 0.35,
        target: 'weakest',
        // (guards auto-charge into invaded neighbours: experts keep the capital's defenders home and only let real fleets guard)
        guard: expert ? atHome && here.id !== me.capital && f.ships.length >= 3 : atHome && enemyPowerNear(s, pid, f.region, 1) > fleetPower(s, f) * 0.6,
      };
      if (isScoutFleet(f) || (f.ships.length === 1 && (R.ships[f.ships[0].cls]?.hp ?? 9) <= 6)) { d.stance = 'evasive'; d.guard = false; }
      sub.free.push({ type: 'doctrine', fleet: f.id, doctrine: d });
      f.doctrine = d;
    }
  }

  // -------------------------------------------------- order slots (greedy over projected state)
  const usedTargets = new Set<string>();
  const fleetUses = new Map<number, number>();
  for (let slot = 0; slot < R.orders.perTurn; slot++) {
    const valid = candidates().filter(c => c.v > 0.3 && !usedTargets.has(c.tag) && !validateOrder(s, pid, c.o) && canAfford(me0().res, orderCost(s, c.o, pid)));
    if (!valid.length) continue;
    valid.sort((a, b) => b.v - a.v);
    let pick: Cand;
    if (novice) {
      // naive: usually the obvious move, often one of the next few
      const r = rng.next();
      pick = valid[Math.min(valid.length - 1, r < 0.45 ? 0 : r < 0.7 ? 1 : r < 0.85 ? 2 : 3 + Math.floor(rng.next() * 3))];
    } else if (!expert && rng.chance(0.2)) pick = valid[Math.min(valid.length - 1, 1)];
    else pick = valid[0];
    sub.orders[slot] = pick.o;
    usedTargets.add(pick.tag);
    project(pick.o);
  }
  return sub;

  // ====================================================================== helpers
  function me0() { return s.players[pid]; }

  function project(o: Order) {
    pay(me0().res, orderCost(s, o, pid));
    if ('fleet' in o && o.fleet !== null && o.type !== 'build') fleetUses.set(o.fleet, (fleetUses.get(o.fleet) ?? 0) + 1);
    if (o.type === 'move') { const f = s.fleets.find(x => x.id === o.fleet)!; f.region = o.path[o.path.length - 1]; f.fortified = false; }
    if (o.type === 'seize') {
      const f = s.fleets.find(x => x.id === o.fleet)!;
      f.region = o.target; f.fortified = false;
      usedTargets.add(`seize:${o.target}`); // optimistic: assume it falls (so we don't seize it twice)
    }
    if (o.type === 'fortify') { const f = s.fleets.find(x => x.id === o.fleet)!; f.fortified = true; }
    if (o.type === 'develop') s.regions[o.region].project = { key: o.project, progress: 0, owner: pid };
    if (o.type === 'build') {
      // the projected fleet gets the new hull so later slots plan with it
      const sh = { id: -1000 - slot(), name: 'new', cls: o.cls, hp: R.ships[o.cls].hp, maxHp: R.ships[o.cls].hp, sys: { engines: true, weapons: true, shields: true }, kills: 0, battles: 0, title: null, bornTurn: s.turn };
      const f = o.fleet !== null ? s.fleets.find(x => x.id === o.fleet) : undefined;
      if (f) f.ships.push(sh);
    }
  }
  function slot() { return sub.orders.filter(Boolean).length; }

  /** Rough "what is this region worth to me" in VP-ish units. */
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
    const rivalCapital = r.owner !== null && r.owner !== pid && s.players[r.owner].capital === r.id;
    if (rivalCapital) v += 8;
    if (expert) {
      if (r.owner !== null && r.owner === leader && leader !== pid) v += 4;                 // bounty + slows the leader
      if (r.kind === 'crown') {
        if (r.owner !== pid && myCrowns === 2) v += 40;                                       // the third crown wins outright
        else if (r.owner !== pid && myCrowns === 1) v += 4;                                   // majority bonus
        const holder = r.owner;
        if (holder !== null && holder !== pid && crowns.filter(c => c.owner === holder).length >= 2) v += 10; // break their pair
      }
      if (edictsNow.includes('two_crowns') && r.kind === 'crown' && myCrowns >= 1) v += 3;
      if (edictsNow.includes('throne_hold') && r.kind === 'throne') v += 4;
      if (edictsNow.includes('expansion')) v += 1.5;
      if (edictsNow.includes('border_raid') && s.players.some(o => o.id !== pid && s.regions[o.capital].neighbors.includes(r.id))) v += 3;
      if (edictsNow.includes('relic_hoard') && r.kind === 'relic') v += 2;
      v += r.neighbors.filter(n => s.regions[n].owner === pid).length * 0.4;                 // easier to hold
      if (r.kind === 'throne') {
        const w = warden();
        if (w) v = w.region === r.id ? -5 : v;                                                // the Warden judges whoever sits there
        else if (s.loreFound >= R.warden.wakeAtLore - 1 && !s.wardenAwake) v -= 3;            // it may wake soon
      }
    } else if (r.kind === 'throne' && s.fleets.some(f => f.owner === -1)) v -= 6;
    return v;
  }

  // ---------------------------------------------------------------- strength estimates
  /** Old crude defense estimate (novice / standard). */
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
    return 1 / (1 + Math.exp(-((att / def) - 1.25) * 3.2));
  }

  /** Expert: predicted chance that `units` (attacking from outside) take region t this pulse, and expected losses. */
  function seizeOdds(units: SimUnit[], t: Region, key: string): SimResult {
    const ck = `${t.id}:${key}`;
    const hit = simCache.get(ck);
    if (hit) return hit;
    const defFleets = s.fleets.filter(f => f.ships.length && hostile(s, f.owner, pid) && (f.region === t.id ||
      (t.owner !== null && f.owner === t.owner && f.doctrine.guard && t.neighbors.includes(f.region))));
    const D = defFleets.flatMap(f => unitsOf(s, f));
    const fort = t.buildings.fortress ?? 0;
    const gar = Math.round(t.garrison * (novice && t.owner === null ? 0.8 : 1)); // novices underrate neutral garrisons
    let res: SimResult;
    if (D.length) {
      // fleet battle (garrison helps only if its owner has ships here), then the siege
      const garHelps = t.owner !== null && defFleets.some(f => f.owner === t.owner);
      const b1 = simBattle(s, t.id, units, D, garHelps ? gar : 0, fort, 0.35);
      if (!b1.win) res = b1;
      else {
        const b2 = simBattle(s, t.id, b1.left, [], b1.garLeft || (garHelps ? 0 : gar), fort, 0.35);
        res = { ...b2, p: Math.min(b1.p, b2.p), lost: b1.lost + b2.lost };
      }
    } else res = simBattle(s, t.id, units, [], gar, fort, 0.35);
    simCache.set(ck, res);
    return res;
  }

  /** Expert: chance the strongest nearby rival breaks our hold on rid (with `extra` defenders added). */
  function threatTo(rid: number, extra: SimUnit[]): number {
    const r = s.regions[rid];
    let worst = 0;
    for (const p of s.players) {
      if (p.id === pid || p.eliminated || !hostile(s, p.id, pid)) continue;
      const near = s.fleets.filter(f => f.owner === p.id && f.ships.length && f.region !== rid &&
        within(s, f.region, fleetSpeed(s, f) + 1).has(rid));
      if (!near.length) continue;
      const A = near.flatMap(f => unitsOf(s, f));
      const D = [...s.fleets.filter(f => f.owner === pid && f.region === rid && f.ships.length).flatMap(f => unitsOf(s, f, true)), ...extra];
      const b = simBattle(s, rid, A, D, r.garrison, r.buildings.fortress ?? 0, 0.4);
      worst = Math.max(worst, b.p);
    }
    return worst;
  }

  // ---------------------------------------------------------------- candidates
  function candidates(): Cand[] {
    const out: Cand[] = [];
    const fleets = myFleets();
    const myPow = fleets.reduce((a, f) => a + fleetPower(s, f), 0) || 1;
    const rivalPow = Math.max(1, ...s.players.filter(p => p.id !== pid && !p.eliminated).map(p => s.fleets.filter(f => f.owner === p.id).reduce((a, f) => a + fleetPower(s, f), 0)));
    const mainArmy = fleets.filter(f => !isScoutFleet(f)).sort((a, b) => fleetPower(s, b) - fleetPower(s, a))[0];

    for (const f of fleets) {
      const uses = fleetUses.get(f.id) ?? 0;
      if (uses >= R.orders.maxPerFleet) continue;
      const fatiguePenalty = uses > 0 ? (me0().res.credits > 20 ? 1 : 4) : 0;
      const pow = fleetPower(s, f);
      const here = s.regions[f.region];
      const isScout = isScoutFleet(f);
      const units = unitsOf(s, f);
      const ukey = unitsKey(f);
      // leaving a threatened key world costs (expert only)
      const leaveCost = expert && threatened.has(here.id) && !isScout ? regionValue(here) * Math.max(0, threatWithout(f) - (threatened.get(here.id) ?? 0)) * 1.2 : 0;

      // excavate
      if (here.relic === 'unclaimed' && here.owner === pid) {
        let v = 14 - fatiguePenalty;
        // the 4th relic wakes the Warden: an expert sitting on the Throne would rather not
        if (expert && s.loreFound === R.warden.wakeAtLore - 1 && s.throne.owner === pid) v -= 6;
        out.push({ o: { type: 'excavate', fleet: f.id }, v, tag: `ex:${here.id}` });
      }

      // seize adjacent / current
      for (const tid of [here.id, ...here.neighbors]) {
        const t = s.regions[tid];
        if (t.owner === pid) continue;
        const pact = t.owner !== null && t.owner >= 0 && !hostile(s, pid, t.owner);
        if (pact && !(expert && leader === t.owner)) continue;
        if (isScout && t.garrison > 2) continue;
        let v: number;
        if (expert) {
          const sim = seizeOdds(units, t, ukey);
          if (sim.p < 0.3) continue; // never throw a fleet at a wall
          v = regionValue(t) * sim.p * aggr - sim.lost * 0.12 - (1 - sim.p) * unitsCost(units) * 0.05 - fatiguePenalty - leaveCost;
          if (pact) v -= R.influence.pactBreakVp * 2;
          if (edictsNow.includes('crown_battle') && t.kind === 'crown' && s.fleets.some(x => x.region === tid && x.owner !== pid && x.ships.length)) v += 3;
        } else {
          // standard & novice: same predictor, but no thought for what happens next
          const p = seizeOdds(units, t, ukey).p;
          if (p < (novice ? 0.3 : 0.2)) continue;
          v = regionValue(t) * p * aggr - (1 - p) * pow * 0.08 - fatiguePenalty;
        }
        if (t.owner !== null && t.owner !== pid && t.owner >= 0) v += 1.5 * aggr; // conflict is the point
        out.push({ o: { type: 'seize', fleet: f.id, target: tid }, v, tag: `seize:${tid}` });
      }

      // move: toward opportunities, home to defend, or (expert) to concentrate
      const sp = fleetSpeed(s, f);
      const canOd = expert ? !f.fatigued && uses === 0 : !f.fatigued;
      const reach = [...within(s, f.region, sp + (canOd && !novice ? R.overdrive.speedBonus : 0))].filter(x => x !== f.region);
      for (const dest of reach) {
        const path = findPath(s, f.region, dest);
        if (!path) continue;
        const od = path.length > sp;
        if (path.slice(0, -1).some(x => s.regions[x].owner !== null && s.regions[x].owner !== pid && s.regions[x].garrison > 0)) continue; // blocked en route
        if (path.slice(0, -1).some(x => hostileFleetsAt(x).length)) continue;                     // would be stopped (and fight) en route
        const dr = s.regions[dest];
        const foes = hostileFleetsAt(dest);
        if (foes.some(x => x.owner === -1) && !expert) continue;                                  // everyone knows not to poke the Warden
        if (foes.length && (isScout || (!expert && fleetPower(s, f) < foes.reduce((a, x) => a + fleetPower(s, x), 0) * 1.2))) continue;
        const rivalHeld = dr.owner !== null && dr.owner !== pid && dr.garrison > 0;
        let v = 0;
        if (!novice) v = moveValue(f, units, dest, path.length, mainArmy) - leaveCost;
        else {
          if (rivalHeld) continue;
          let best = 0;
          for (const n of [dest, ...dr.neighbors]) {
            const t = s.regions[n];
            if (t.owner === pid) continue;
            best = Math.max(best, regionValue(t) * seizeOdds(units, t, ukey).p);
          }
          v = best * 0.45 * aggr / Math.max(1, path.length * 0.6);
          if (dr.owner === pid) {
            const threat = enemyPowerNear(s, pid, dest, 1);
            if (threat > dr.garrison) v = Math.max(v, regionValue(dr) * Math.min(1.2, threat / (pow + 1)) * (novice ? 0.3 : 1));
          }
        }
        if (isScout) v = (dr.relic === 'unclaimed' ? 3 : 1.2) + (coverage(s, pid).has(dest) ? 0 : 1.5) - (rivalHeld ? 1 : 0);
        v -= fatiguePenalty + (od ? (expert ? 2.5 : 1.5) : 0);
        out.push({ o: { type: 'move', fleet: f.id, path, overdrive: od || undefined }, v, tag: `move:${f.id}` });
      }

      // fortify when threatened at home
      if (!novice && here.owner === pid && !f.fortified && !isScout) {
        if (expert) {
          const p = threatened.get(here.id) ?? 0;
          if (p > 0.25) out.push({ o: { type: 'fortify', fleet: f.id }, v: 2 + regionValue(here) * p * 0.5, tag: `fort:${f.id}` });
        } else if (enemyPowerNear(s, pid, here.id, 1) > pow * 0.8 && here.kind !== 'colony') {
          out.push({ o: { type: 'fortify', fleet: f.id }, v: 2.5 + regionValue(here) * 0.15, tag: `fort:${f.id}` });
        }
      }
    }

    // ------------- economy
    const need = Math.min(2.5, rivalPow / myPow);
    for (const r of s.regions.filter(x => x.owner === pid)) {
      const yard = r.buildings.shipyard ?? 0;
      const enemiesHere = s.fleets.some(f => f.region === r.id && f.ships.length && hostile(s, f.owner, pid));
      if (yard > 0 && !enemiesHere) {
        const joinable = myFleets().find(f => f.region === r.id && f.ships.length < R.maxShipsPerFleet && !isScoutFleet(f));
        if (expert) {
          const b = expertBuild(r, need, joinable, mainArmy);
          if (b) out.push({ o: { type: 'build', region: r.id, cls: b.cls, fleet: joinable ? joinable.id : null }, v: b.v, tag: `build:${r.id}:${b.cls}` });
        } else {
          for (const [cls, d] of Object.entries(R.ships)) {
            if (d.needsShipyard > yard || cls === 'scout') continue;
            const eff = (d.hp * 0.5 + d.attack * d.shots * 2 + d.shields * 2) / Math.max(10, (d.cost.industry ?? 0) + (d.cost.credits ?? 0));
            const v = (3 + need * 3.5 * aggr) * eff * 2.2 + (novice ? rng.next() * 2 : 0);
            out.push({ o: { type: 'build', region: r.id, cls, fleet: joinable ? joinable.id : null }, v, tag: `build:${r.id}:${cls}` });
          }
        }
      }
      if (!r.project) {
        const add = (key: string, v: number) => out.push({ o: { type: 'develop', region: r.id, project: key }, v, tag: `dev:${r.id}` });
        if (expert) expertProjects(r, add);
        else {
          const threat = enemyPowerNear(s, pid, r.id, 2);
          if (r.kind === 'home' && yard < 2) add('shipyard', s.turn < 10 ? 6 : 3);
          if (r.kind === 'home' && yard === 2 && s.turn > 8) add('shipyard', 3);
          if (r.dev < R.economy.maxDev && r.kind !== 'void') add('develop', 2.2 + r.dev * 0.4 + (s.turn < 12 ? 1.5 : 0));
          if ((r.buildings.mine ?? 0) < 2 && r.kind !== 'void') add('mine', 2.5 + (s.turn < 10 ? 1 : 0));
          if ((r.buildings.tradehub ?? 0) < 1 && me0().res.credits < 30) add('tradehub', 3);
          if ((r.buildings.fortress ?? 0) < 2 && (r.kind === 'crown' || r.kind === 'throne' || r.kind === 'home') && !novice) add('fortress', 2 + Math.min(4, threat / 15));
        }
      }
    }

    // ------------- influence regions next door
    for (const r of s.regions) {
      if (r.owner === pid || r.kind === 'void') continue;
      if (r.owner !== null && (s.players[r.owner].capital === r.id || novice)) continue;
      const near = r.neighbors.some(n => s.regions[n].owner === pid);
      if (!near) continue;
      const thr = r.owner === null ? R.influence.flipThreshold : R.influence.rivalFlipThreshold;
      const after = r.loyalty[pid] + R.influence.pushAmount + R.influence.adjacentBonus;
      let v = regionValue(r) * (after >= thr ? 1 : after / thr * 0.45) - (r.owner !== null ? 1 : 0);
      if (expert) {
        // pointless while a rival's guns sit there; and finish what we started
        if (s.fleets.some(f => f.region === r.id && f.ships.length && f.owner !== pid && hostile(s, f.owner, pid))) v *= 0.3;
        // a neutral we could just take by force with a fleet next door is not worth the influence
        if (r.owner === null && r.garrison <= 12 && r.kind === 'colony') v *= 0.5;
        if (r.loyalty[pid] > 0) v += 1;
      }
      out.push({ o: { type: 'influence', target: r.id }, v, tag: `inf:${r.id}` });
    }

    if (expert) {
      // pact with the weaker rival if someone is running away with it
      if (leader !== null && leader !== pid) {
        const other = s.players.find(p => p.id !== pid && p.id !== leader && !p.eliminated);
        if (other && !s.pacts.some(x => (x.a === pid && x.b === other.id) || (x.b === pid && x.a === other.id))) out.push({ o: { type: 'pact', with: other.id }, v: 2.5, tag: 'pact' });
      }
      // scan a nebula next to the capital when anything is lurking around
      const cap = s.regions[me0().capital];
      const hidden = cap.neighbors.find(n => s.regions[n].feature === 'nebula' && s.regions[n].owner !== pid);
      if (hidden !== undefined && threatened.size) out.push({ o: { type: 'scan', target: hidden }, v: 1.5, tag: 'scan' });
    }
    return out;
  }

  // ---------------------------------------------------------------- moves (standard: opportunity + battle check; expert: everything)
  function moveValue(f: Fleet, units: SimUnit[], dest: number, dist: number, mainArmy: Fleet | undefined): number {
    const dr = s.regions[dest];
    const isScout = isScoutFleet(f);
    if (isScout) return 0;
    // friends already at dest will be merged next turn: plan with the combined force
    const friends = expert ? s.fleets.filter(x => x.owner === pid && x.region === dest && x.ships.length && x !== f && !isScoutFleet(x)) : [];
    const combined = friends.length ? [...units, ...friends.flatMap(x => unitsOf(s, x))] : units;
    const ckey = unitsKey(f) + friends.map(x => unitsKey(x)).join('+');
    let v = 0;

    // moving onto enemy ships means a battle: only if we win it convincingly
    const foes = hostileFleetsAt(dest);
    if (foes.length) {
      const b = simBattle(s, dest, units, foes.flatMap(x => unitsOf(s, x, true)), foes.some(x => x.owner === dr.owner) ? dr.garrison : 0, dr.buildings.fortress ?? 0, 0.35);
      if (b.p < 0.65) return -99;
      v += unitsCost(foes.flatMap(x => unitsOf(s, x))) * 0.06 * b.p - b.lost * 0.1;
      if (foes.some(x => x.owner === -1)) v += R.warden.defeatVp * b.p;
      if (expert && edictsNow.includes('crown_battle') && dr.kind === 'crown') v += 3;
      if (expert && edictsNow.includes('slaughter') && foes.reduce((a, x) => a + x.ships.length, 0) >= 4) v += 3;
    }

    // (a) next-turn opportunity from dest
    if (!(dr.owner !== null && dr.owner !== pid && dr.garrison > 0)) {
      let best = 0;
      for (const n of [dest, ...dr.neighbors]) {
        const t = s.regions[n];
        if (t.owner === pid || usedTargets.has(`seize:${n}`)) continue;
        if (t.owner !== null && t.owner >= 0 && !hostile(s, pid, t.owner)) continue;
        const sim = seizeOdds(combined, t, ckey);
        if (sim.p < 0.35) continue;
        best = Math.max(best, regionValue(t) * sim.p - sim.lost * 0.1);
      }
      v += best * 0.5 * aggr / Math.max(1, dist * 0.6);
    }
    // (b) defend a threatened key world
    if (dr.owner === pid) {
      const p0 = threatened.get(dest) ?? 0;
      if (p0 > 0) {
        const p1 = threatTo(dest, units);
        v = Math.max(v, regionValue(dr) * (p0 - p1) * 1.5 + 1);
      }
      // sitting on a held Crown/Throne blocks influence and seizes
      if ((dr.kind === 'crown' || dr.kind === 'throne') && !s.fleets.some(x => x.owner === pid && x.region === dest && x !== f)) v = Math.max(v, 1.2);
    }
    if (!expert) return v;
    // (c) rally: small detachments join the main army
    if (mainArmy && mainArmy !== f && mainArmy.region === dest && f.ships.length + mainArmy.ships.length <= R.maxShipsPerFleet) {
      v = Math.max(v, 1 + Math.min(3, unitsCost(units) / 40));
    }
    // (d) Edict of the Knife: end the turn in a rival capital
    if (edictsNow.includes('deep_strike') && s.players.some(o => o.id !== pid && o.capital === dest)) {
      const def = s.fleets.filter(x => x.region === dest && x.ships.length && hostile(s, x.owner, pid)).flatMap(x => unitsOf(s, x));
      const b = def.length ? simBattle(s, dest, units, def, dr.garrison, dr.buildings.fortress ?? 0, 0.35) : null;
      if (!b || b.p > 0.6) v = Math.max(v, 4.5);
    }
    // (e) danger: rivals next to dest that could crush us there
    const danger = enemyUnitsNear(dest);
    if (danger.length && dr.owner !== pid) {
      const b = simBattle(s, dest, danger, units, 0, 0, 0.35);
      if (b.p > 0.5) v -= unitsCost(units) * 0.04 * b.p;
    }
    return v;
  }

  /** Expert: threat to f's current region if f leaves it. */
  function threatWithout(f: Fleet): number {
    const keep = s.fleets.filter(x => x.owner === pid && x.region === f.region && x !== f && x.ships.length);
    const r = s.regions[f.region];
    let worst = 0;
    for (const p of s.players) {
      if (p.id === pid || p.eliminated || !hostile(s, p.id, pid)) continue;
      const near = s.fleets.filter(x => x.owner === p.id && x.ships.length && x.region !== r.id && within(s, x.region, fleetSpeed(s, x) + 1).has(r.id));
      if (!near.length) continue;
      const b = simBattle(s, r.id, near.flatMap(x => unitsOf(s, x)), keep.flatMap(x => unitsOf(s, x, true)), r.garrison, r.buildings.fortress ?? 0, 0.4);
      worst = Math.max(worst, b.p);
    }
    return worst;
  }

  function hostileFleetsAt(rid: number): Fleet[] {
    return s.fleets.filter(x => x.region === rid && x.ships.length && x.owner !== pid && hostile(s, x.owner, pid));
  }

  function enemyUnitsNear(rid: number): SimUnit[] {
    const area = s.regions[rid].neighbors;
    return s.fleets.filter(x => x.ships.length && x.owner >= 0 && hostile(s, x.owner, pid) && (x.region === rid || area.includes(x.region))).flatMap(x => unitsOf(s, x));
  }

  // ---------------------------------------------------------------- expert: builds & projects
  function expertBuild(r: Region, need: number, joinable: Fleet | undefined, mainArmy: Fleet | undefined): { cls: string; v: number } | null {
    const yard = r.buildings.shipyard ?? 0;
    const res = me0().res;
    const ok = (c: string) => R.ships[c] && R.ships[c].needsShipyard <= yard && canAfford(res, orderCost(s, { type: 'build', region: r.id, cls: c, fleet: null }, pid));
    const army = mainArmy ? mainArmy.ships : [];
    const bombards = army.filter(x => (R.ships[x.cls]?.siege ?? 0) >= 5).length;
    // a hard nut within reach of the army (fortified capitals, crowns, the Throne) wants siege hulls
    const hardTarget = s.regions.some(t => t.owner !== pid && t.garrison >= 28 && (t.kind === 'crown' || t.kind === 'throne' || t.kind === 'home') &&
      (!mainArmy || within(s, mainArmy.region, 3).has(t.id)));
    let cls: string | null = null;
    if (hardTarget && bombards < 1 + Math.floor(army.length / 4) && ok('bombard')) cls = 'bombard';
    else if (ok('dread') && res.industry > 130) cls = 'dread';
    else if (ok('cruiser')) cls = 'cruiser';
    else if (ok('frigate')) cls = 'frigate';
    else if (ok('corvette') && (s.turn <= 3 || (threatened.get(r.id) ?? 0) > 0.3)) cls = 'corvette';
    if (!cls) return null;
    // urgent at a threatened yard; otherwise scale with how outgunned we are and how much we can afford
    const threat = threatened.get(r.id) ?? 0;
    const order = { scout: 0, corvette: 1, frigate: 2, bombard: 2.5, cruiser: 3, dread: 4 }[cls] ?? 1;
    let v = 3.5 + need * 2.2 + order * 0.6 + threat * 8;
    if (s.turn <= 2 && !threat) v -= 1.5; // grow the economy first
    if (!joinable && myFleets().length >= R.maxFleets - 1) v -= 3;
    return { cls, v };
  }

  function expertProjects(r: Region, add: (key: string, v: number) => void) {
    const yard = r.buildings.shipyard ?? 0;
    const threat = threatened.get(r.id) ?? 0;
    const early = s.turn < 10 ? 1 : 0;
    const left = R.victory.turnLimit - s.turn; // late projects never pay back
    if (r.id === me0().capital) {
      if (yard < 2) add('shipyard', 5.5 + early);
      else if (yard < 3 && s.turn > 7 && me0().res.industry > 60) add('shipyard', 3);
      if ((r.buildings.fortress ?? 0) < 3 && threat > 0.2) add('fortress', 3 + threat * 8);
    }
    if (left < 4) return;
    if (r.dev < R.economy.maxDev && r.kind !== 'void') {
      const y = R.economy.yields[r.kind] ?? R.economy.yields.colony;
      add('develop', 1.5 + (y.industry + y.credits) * 0.3 + early * 1.5);
    }
    if ((r.buildings.mine ?? 0) < 2 && r.kind !== 'void') add('mine', 3 + early);
    if ((r.buildings.tradehub ?? 0) < 1 && me0().res.credits < 25) add('tradehub', 3);
    if ((r.buildings.fortress ?? 0) < 2 && (r.kind === 'crown' || r.kind === 'throne')) add('fortress', 2.5 + threat * 6);
  }
}

// ============================================================================
//  Battle predictor: a deterministic expected-value version of combat.ts.
//  Good enough to tell "easy", "coin flip" and "suicide" apart.
// ============================================================================
export interface SimUnit { hp: number; atk: number; shots: number; sh: number; siege: number; eva: number; cost: number }
interface SimResult { win: boolean; p: number; left: SimUnit[]; garLeft: number; lost: number }

function isScoutFleet(f: Fleet): boolean { return f.ships.every(x => x.cls === 'scout'); }
function unitsKey(f: Fleet): string { return f.ships.map(x => `${x.cls[0]}${x.cls[1]}${x.hp}`).join(''); }

export function unitsOf(s: GameState, f: Fleet, defending = false): SimUnit[] {
  const R = s.rules;
  return f.ships.map(sh => {
    const d = R.ships[sh.cls];
    let atk = sh.sys.weapons ? d.attack : 0;
    if (f.fatigued) atk = Math.max(1, Math.round(atk * R.overdrive.fatigueAttackMult));
    const eva = d.evasion * (sh.sys.engines ? 1 : 0.3) + (f.fortified && defending ? R.combat.fortifyEvasion : 0);
    return { hp: sh.hp, atk, shots: sh.sys.weapons ? d.shots : 0, sh: sh.sys.shields ? d.shields : 0, siege: d.siege, eva, cost: (d.cost.industry ?? 0) + (d.cost.credits ?? 0) };
  });
}
function unitsCost(u: SimUnit[]): number { return u.reduce((a, x) => a + x.cost, 0); }

/** Attacker units A vs defender units D (+ a garrison of `gar` hp behind `fort` fortress levels). */
function simBattle(s: GameState, rid: number, A: SimUnit[], D: SimUnit[], gar: number, fort: number, retreatA: number): SimResult {
  const R = s.rules, C = R.combat, G = R.garrison;
  const neb = s.regions[rid].feature === 'nebula' ? C.nebulaHitPenalty : 0;
  type U = SimUnit & { cur: number; pend: number; gar?: boolean };
  const a: U[] = A.map(u => ({ ...u, cur: u.hp, pend: 0 }));
  const d: U[] = D.map(u => ({ ...u, cur: u.hp, pend: 0 }));
  const garU: U = { hp: gar, atk: 0, shots: 0, sh: 0, siege: 0, eva: 0, cost: 0, cur: gar, pend: 0, gar: true };
  const armor = G.armor + fort * G.armorPerFortress;
  const hp = (xs: U[]) => xs.reduce((t, x) => t + Math.max(0, x.cur), 0);
  const a0 = hp(a) || 1, d0 = hp(d) + gar || 1;
  const fire = (shooters: { atk: number; shots: number; siege: number; bonus: number }[], targets: U[]) => {
    const live = targets.filter(t => t.cur > 0).sort((x, y) => x.cur - y.cur);
    let i = 0;
    for (const sh of shooters) for (let k = 0; k < sh.shots; k++) {
      while (i < live.length && live[i].cur - live[i].pend <= 0) i++;
      if (i >= live.length) return;
      const t = live[i];
      const ph = Math.max(0.1, Math.min(0.95, C.baseHit + sh.bonus - t.eva - neb));
      const dmg = t.gar ? Math.max(1, sh.atk - armor) + sh.siege : Math.max(1, sh.atk - t.sh);
      t.pend += ph * dmg;
    }
  };
  let retreated: 'a' | 'd' | null = null;
  for (let round = 1; round <= C.maxRounds; round++) {
    const la = a.filter(u => u.cur > 0), ld = d.filter(u => u.cur > 0);
    if (!la.length || (!ld.length && garU.cur <= 0)) break;
    const dTargets = garU.cur > 0 ? [...ld, garU] : ld;
    fire(la.map(u => ({ atk: u.atk, shots: u.atk > 0 ? u.shots : 0, siege: u.siege, bonus: 0 })), dTargets);
    const dShooters = ld.map(u => ({ atk: u.atk, shots: u.atk > 0 ? u.shots : 0, siege: 0, bonus: 0 }));
    if (garU.cur > 0) dShooters.push({ atk: G.attackBase + fort * G.attackPerFortress, shots: G.shotsBase + fort * G.shotsPerFortress + Math.floor(garU.cur / G.hpPerShot), siege: 0, bonus: 0.05 });
    fire(dShooters, la);
    for (const u of [...a, ...d, garU]) { u.cur -= u.pend; u.pend = 0; }
    const fa = hp(a) / a0, fd = (hp(d) + Math.max(0, garU.cur)) / d0;
    if (hp(a) <= 0 || (hp(d) <= 0 && garU.cur <= 0)) break;
    if (fa < retreatA) { retreated = 'a'; break; }
    if (garU.cur <= 0 && fd < 0.35) { retreated = 'd'; break; }
    if (round === C.maxRounds) retreated = fa <= fd ? 'a' : 'd';
  }
  const fa = hp(a) / a0, fd = (hp(d) + Math.max(0, garU.cur)) / d0;
  const win = hp(a) > 0 && retreated !== 'a' && (retreated === 'd' || (hp(d) <= 0 && garU.cur <= 0));
  // EV sims are overconfident near the edge: turn the margin into a probability
  const p = win ? 0.55 + 0.45 * Math.min(1, fa * 2) : Math.max(0.02, 0.45 - fd);
  const left = a.filter(u => u.cur > 0.5).map(u => ({ hp: u.cur, atk: u.atk, shots: u.shots, sh: u.sh, siege: u.siege, eva: u.eva, cost: u.cost }));
  const lost = a.reduce((t, u) => t + (u.cur <= 0.5 ? u.cost : u.cost * (1 - u.cur / u.hp) * 0.3), 0);
  return { win, p, left, garLeft: Math.max(0, garU.cur), lost };
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
