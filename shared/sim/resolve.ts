// ============================================================================
//  TURN RESOLUTION — the WEGO heart of the game.
//
//  Each player submits up to N orders. The order in slot k resolves in pulse k,
//  simultaneously for everyone. Inside a pulse the steps always run in this
//  fixed, published order:
//
//    1. Prepare   — fortify, scan, feint, conceal, pact offers
//    2. Influence — loyalty pushes; neutral regions may defect
//    3. Movement  — all moving fleets advance one region per step, together.
//                   Head-on moves through the same border CLASH (no bounces).
//                   Entering a region with hostile fleets or a hostile
//                   garrison stops movement. Guard fleets react to invasions.
//                   Battles happen wherever hostile fleets end a step together.
//    4. Seize     — fleets ordered to seize fight the garrison and capture
//    5. Economy   — build ships, start projects, excavate relics
//
//  After pulse N: the Warden acts, upkeep and income, pacts, then scoring.
//  VP is only ever scored on the final end-of-turn state.
// ============================================================================
import { RELICS, LORE } from '../config/content.ts';
import { runBattle, hostile, type BattleOutcome } from './combat.ts';
import { EDICTS } from './edicts.ts';
import { fleetSpeed, strengthBand, findPath } from './graph.ts';
import { canAfford, orderCost, pay, validateOrder, ORDER_INFO } from './orders.ts';
import { Rng } from './rng.ts';
import { maxGarrison, newFleet, newShip } from './setup.ts';
import type { BattleReport, Fleet, GameEvent, GameState, Order, PlayerId, RegionId, Signal, Submission, TurnResult } from './types.ts';
import { coverage, seesFleetsIn } from './visibility.ts';

export function emptySubmission(s: GameState): Submission {
  return { orders: new Array(s.rules.orders.perTurn).fill(null), free: [] };
}

export function resolveTurn(prev: GameState, submissions: Record<number, Submission>): GameState {
  const s: GameState = structuredClone({ ...prev, last: null });
  const rng = new Rng(s.rngState);
  const R = s.rules;
  const events: GameEvent[] = [];
  const battles: BattleReport[] = [];
  const signals: Signal[] = [];
  const subs: Record<number, Submission> = {};
  for (const p of s.players) subs[p.id] = sanitize(s, submissions[p.id]);
  s.log.push({ turn: s.turn, submissions: structuredClone(subs) });

  s.turnStats = { kills: [0, 0, 0], battlesWon: [0, 0, 0], crownBattlesWon: [0, 0, 0], captures: [0, 0, 0] };
  const honors = [0, 0, 0];
  const bountyVp = [0, 0, 0];
  const capped = (p: PlayerId, n: number) => { const room = Math.max(0, R.bountyCap.maxPerTurn - bountyVp[p]); const g = Math.min(room, n); bountyVp[p] += g; return g; };
  const influencedThisTurn = new Set<string>();
  const overdrove = new Set<number>();
  const concealed = new Set<PlayerId>();
  const covStart = s.players.map(p => coverage(s, p.id));
  for (const f of s.fleets) { f.ordersThisTurn = 0; f.guardUsed = false; }
  for (const p of s.players) p.pactOffers = [];

  // ---------------------------------------------------------- free actions
  const freeFails: GameEvent[] = [];
  for (const p of s.players) for (const fa of subs[p.id].free) {
    const err = applyFree(s, rng, p.id, fa);
    if (err) freeFails.push({ k: 'fail', pulse: 0, owner: p.id, text: `${fa.type} failed: ${err}` });
  }

  // iterate regions from a turn-dependent offset so no part of the map always resolves first
  const rOff = (s.turn * 7) % s.regions.length;
  const rotatedRegions = [...s.regions.slice(rOff), ...s.regions.slice(0, rOff)];
  const startFleets = structuredClone(s.fleets);
  const startOwners = s.regions.map(r => r.owner);
  const leader = currentLeader(s);

  const emit = (e: GameEvent) => events.push(e);
  events.push(...freeFails);
  const signal = (pulse: number, about: PlayerId | null, region: RegionId, text: string, opts: { confirmed?: boolean; force?: boolean } = {}) => {
    for (const o of s.players) {
      if (o.id === about) continue;
      if (!opts.force && !covStart[o.id].has(region) && !coverage(s, o.id).has(region)) continue;
      signals.push({ turn: s.turn, pulse, observer: o.id, about, region, text, confidence: opts.confirmed === false ? 'inferred' : 'confirmed' });
    }
  };
  const fail = (pulse: number, p: PlayerId, o: Order, why: string) =>
    emit({ k: 'fail', pulse, owner: p, text: `${ORDER_INFO[o.type].name} failed: ${why}` });

  const recordBattle = (out: BattleOutcome, pulse: number) => {
    battles.push(out.report);
    emit({ k: 'battle', pulse, region: out.report.region, battle: out.report.id, name: out.report.name, parties: out.report.sides.map(x => x.owner) });
    for (const r of out.retreats) {
      emit({ k: 'retreat', pulse, fleet: r.fleet.id, owner: r.fleet.owner, from: out.report.region, to: r.to });
      r.fleet.region = r.to;
      r.fleet.fortified = false;
    }
    for (const f of out.destroyedFleets) emit({ k: 'destroyed', pulse, fleet: f.id, owner: f.owner, region: out.report.region, name: f.name });
    s.fleets = s.fleets.filter(f => f.ships.length > 0);
    if (s.wardenAwake && !s.wardenDefeated && out.report.sides.some(x => x.owner === -1 && x.fleets.length) && !s.fleets.some(f => f.owner === -1)) wardenDefeated(out.winner);
    // battle honors
    const w = out.winner;
    const enemyLosses = Object.entries(out.report.losses).filter(([o]) => Number(o) !== w).reduce((a, [, n]) => a + n, 0);
    if (w !== null && w !== -1 && enemyLosses >= R.bounty.battleHonorMinKills && honors[w] < R.bounty.maxHonorPerTurn) {
      const vsLeader = leader !== null && out.report.sides.some(x => x.owner === leader) && w !== leader;
      honors[w]++;
      addVp(s, w, capped(w, vsLeader ? R.bounty.battleHonorVsLeaderVp : R.bounty.battleHonorVp), `Battle honors: ${out.report.name}${vsLeader ? ' (against the leader)' : ''}`);
    }
    const lost = Object.values(out.report.losses).reduce((a, b) => a + b, 0);
    if (lost >= 2) {
      const ps = out.report.sides.map(x => x.owner).filter((x): x is number => x >= 0);
      s.chronicle.push({ turn: s.turn, region: out.report.region, players: ps, major: lost >= 5,
        text: `The ${out.report.name}: ${lost} ships destroyed. ${w === null ? 'Neither side broke.' : w === -1 ? 'The defenders held.' : `${s.players[w].name} held the field.`}` });
    }
  };

  // ======================================================================
  for (let pulse = 1; pulse <= R.orders.pulses; pulse++) {
    emit({ k: 'pulse', pulse });
    const orders: { p: PlayerId; o: Order }[] = [];
    // rotate who is processed first each turn so same-pulse ties never favour a seat
    const rot = s.turn % s.players.length;
    for (const p of [...s.players.slice(rot), ...s.players.slice(0, rot)]) {
      if (p.eliminated) continue;
      const o = subs[p.id].orders[pulse - 1];
      if (o) orders.push({ p: p.id, o });
    }
    // fleet fatigue: extra orders on the same fleet cost credits (Old World style)
    for (const { p, o } of orders) {
      if (!('fleet' in o) || o.type === 'build') continue;
      const f = s.fleets.find(x => x.id === o.fleet);
      if (!f) continue;
      if (f.ordersThisTurn > 0) s.players[p].res.credits -= R.orders.repeatFleetCredits;
      f.ordersThisTurn++;
    }

    // ---------------------------------------------------------- 1. prepare
    for (const { p, o } of orders) {
      if (!['fortify', 'scan', 'feint', 'conceal', 'pact'].includes(o.type)) continue;
      const err = validateOrder(s, p, o);
      if (err) { fail(pulse, p, o, err); continue; }
      const cost = orderCost(s, o, p);
      if (!canAfford(s.players[p].res, cost, R)) { fail(pulse, p, o, 'not enough resources'); continue; }
      pay(s.players[p].res, cost, R);
      switch (o.type) {
        case 'fortify': {
          const f = s.fleets.find(x => x.id === o.fleet)!;
          f.fortified = true;
          emit({ k: 'fortify', pulse, fleet: f.id, owner: p, region: f.region });
          signal(pulse, p, f.region, `${s.players[p].name} fortifying at ${s.regions[f.region].name}`);
          break;
        }
        case 'scan':
          s.scans.push({ owner: p, region: o.target, until: s.turn + 1 });
          emit({ k: 'scan', pulse, owner: p, region: o.target });
          signal(pulse, p, o.target, `Sensor sweep detected over ${s.regions[o.target].name}`, { confirmed: false });
          break;
        case 'feint': {
          const t = s.regions[o.target];
          for (let i = 0; i < R.sensors.feintSignals; i++) {
            const from = rng.pick(t.neighbors);
            for (const obs of s.players) {
              if (obs.id === p) continue;
              const exposed = s.scans.some(sc => sc.owner === obs.id && sc.until >= s.turn && (sc.region === o.target || s.regions[sc.region].neighbors.includes(o.target)));
              signals.push({ turn: s.turn, pulse: Math.min(R.orders.pulses, pulse + i), observer: obs.id, about: p, region: o.target, confidence: exposed ? 'confirmed' : 'inferred',
                text: exposed ? `FALSE SIGNAL exposed by your scan: ${s.players[p].name} is faking movement toward ${t.name}`
                  : `Fleet movement (${rng.pick(['small', 'medium', 'large'])}) ${s.regions[from].name} → ${t.name}, arriving pulse ${Math.min(R.orders.pulses, pulse + i + 1)}` });
            }
          }
          emit({ k: 'note', pulse, owner: p, text: `Feint launched toward ${t.name}.`, region: o.target });
          break;
        }
        case 'conceal':
          concealed.add(p);
          emit({ k: 'note', pulse, owner: p, text: 'Signals concealed this turn.' });
          break;
        case 'pact':
          s.players[p].pactOffers.push(o.with);
          emit({ k: 'note', pulse, owner: p, text: `Pact offered to ${s.players[o.with].name}.` });
          signal(pulse, p, s.players[o.with].capital, `${s.players[p].name} has offered you a pact`, { force: true });
          break;
      }
    }

    // ---------------------------------------------------------- 2. influence
    // all pushes and purges land together, then defections are checked
    const purges: { p: PlayerId; r: RegionId }[] = [];
    for (const { p, o } of orders) {
      if (o.type !== 'influence') continue;
      const err = validateOrder(s, p, o);
      if (err) { fail(pulse, p, o, err); continue; }
      const r = s.regions[o.target];
      const key = `${p}:${r.id}`;
      if (R.influenceLimits.onePerTargetPerTurn && influencedThisTurn.has(key)) { fail(pulse, p, o, `already influenced ${r.name} this turn`); continue; }
      const cost = orderCost(s, o, p);
      if (!canAfford(s.players[p].res, cost, R)) { fail(pulse, p, o, 'not enough influence'); continue; }
      pay(s.players[p].res, cost, R);
      influencedThisTurn.add(key);
      if (r.owner === p) { purges.push({ p, r: r.id }); continue; }
      const adj = r.neighbors.some(n => s.regions[n].owner === p);
      r.loyalty[p] = (r.loyalty[p] ?? 0) + R.influence.pushAmount + (adj ? R.influence.adjacentBonus : 0);
      if (R.influenceLimits.capAtThreshold) r.loyalty[p] = Math.min(r.loyalty[p], flipThreshold(s, r.id));
      emit({ k: 'influence', pulse, region: r.id, owner: p, loyalty: r.loyalty[p] });
      signal(pulse, p, r.id, `${s.players[p].name} agents active in ${r.name}${r.owner !== null ? ` (loyalty ${r.loyalty[p]}/${flipThreshold(s, r.id)})` : ''}`);
    }
    for (const { p, r: rid } of purges) {
      const r = s.regions[rid];
      for (let i = 0; i < r.loyalty.length; i++) if (i !== p) r.loyalty[i] = Math.max(0, r.loyalty[i] - R.influenceLimits.purgeAmount);
      emit({ k: 'note', pulse, owner: p, text: `Rival agents purged from ${r.name}.`, region: r.id });
    }
    // defections (resolved together: the highest loyalty over threshold wins)
    for (const r of s.regions) {
      const thr = flipThreshold(s, r.id);
      let best: PlayerId | null = null;
      for (const p of s.players) if (p.id !== r.owner && !p.eliminated && r.loyalty[p.id] >= thr && (best === null || r.loyalty[p.id] > r.loyalty[best])) best = p.id;
      if (best === null) continue;
      if (r.owner !== null && s.players[r.owner].capital === r.id) continue;
      const occupied = s.fleets.some(f => f.region === r.id && f.owner !== best && f.ships.length && (f.owner === r.owner || hostile(s, f.owner, best!)));
      if (occupied) continue; // can't defect under someone else's guns
      const from = r.owner;
      capture(s, r.id, best, 'influence', pulse, emit, leader, capped);
      s.chronicle.push({ turn: s.turn, region: r.id, players: [best], text: `${r.name} ${from === null ? 'joins' : 'defects to'} ${s.players[best].name} without a shot fired.` });
    }

    // ---------------------------------------------------------- 3. movement
    interface Mover { f: Fleet; path: RegionId[]; idx: number; seize: RegionId | null; p: PlayerId; o: Order }
    const movers: Mover[] = [];
    const cameFrom = new Map<number, RegionId>();
    for (const { p, o } of orders) {
      if (o.type !== 'move' && o.type !== 'seize') continue;
      const err = validateOrder(s, p, o);
      if (err) { fail(pulse, p, o, err); continue; }
      const f = s.fleets.find(x => x.id === o.fleet)!;
      if (o.type === 'move') {
        if (o.overdrive) overdrove.add(f.id);
        movers.push({ f, path: o.path.slice(), idx: 0, seize: null, p, o });
      } else {
        movers.push({ f, path: f.region === o.target ? [] : [o.target], idx: 0, seize: o.target, p, o });
        // combined assault: extra fleets adjacent to (or at) the target join in
        for (const id of [...new Set(o.also ?? [])].slice(0, 3)) {
          const g = s.fleets.find(x => x.id === id && x.owner === p && x.ships.length);
          if (!g || g === f || movers.some(m => m.f === g)) continue;
          if (g.region !== o.target && !s.regions[g.region].neighbors.includes(o.target)) { emit({ k: 'fail', pulse, owner: p, text: `${g.name} is not adjacent to ${s.regions[o.target].name} and can't join the assault` }); continue; }
          if (g.ordersThisTurn >= R.orders.maxPerFleet) { emit({ k: 'fail', pulse, owner: p, text: `${g.name} is exhausted (max ${R.orders.maxPerFleet} orders per turn)` }); continue; }
          if (g.ordersThisTurn > 0) s.players[p].res.credits -= R.orders.repeatFleetCredits;
          g.ordersThisTurn++;
          g.fortified = false;
          movers.push({ f: g, path: g.region === o.target ? [] : [o.target], idx: 0, seize: null, p, o });
        }
      }
      f.fortified = false;
    }
    const seizers = movers.filter(m => m.seize !== null);
    // movement signals (destination + arrival + strength band)
    for (const m of movers) {
      if (!m.path.length) continue;
      const dest = m.path[m.path.length - 1];
      const txt = `Fleet movement (${strengthBand(m.f.ships.length)}) ${s.regions[m.f.region].name} → ${s.regions[dest].name}, arriving pulse ${pulse}`;
      for (const o of s.players) {
        if (o.id === m.p) continue;
        const seesFrom = covStart[o.id].has(m.f.region), seesTo = covStart[o.id].has(dest) || coverage(s, o.id).has(dest);
        if (!seesFrom && !seesTo) continue;
        signals.push({ turn: s.turn, pulse, observer: o.id, about: m.p, region: seesFrom ? m.f.region : dest, text: seesFrom ? txt : `${txt} (origin unclear)`, confidence: seesFrom ? 'confirmed' : 'inferred' });
      }
    }

    const maxSteps = Math.max(0, ...movers.map(m => m.path.length));
    for (let step = 1; step <= maxSteps; step++) {
      const stepping = movers.filter(m => m.idx < m.path.length && s.fleets.includes(m.f));
      // --- head-on clashes
      const clashed = new Set<Mover>();
      for (let i = 0; i < stepping.length; i++) for (let j = i + 1; j < stepping.length; j++) {
        const a = stepping[i], b = stepping[j];
        if (clashed.has(a) || clashed.has(b)) continue;
        if (!hostile(s, a.f.owner, b.f.owner)) continue;
        if (a.path[a.idx] !== b.f.region || b.path[b.idx] !== a.f.region) continue;
        if (a.f.doctrine.stance === 'evasive' && b.f.doctrine.stance === 'evasive') continue;
        clashed.add(a); clashed.add(b);
        const ra = a.f.region, rb = b.f.region;
        emit({ k: 'clash', pulse, a: ra, b: rb, fleets: [a.f.id, b.f.id] });
        const site = s.regions[ra].owner === a.f.owner ? ra : s.regions[rb].owner === b.f.owner ? rb : Math.min(ra, rb);
        const cf = new Map([[a.f.id, ra], [b.f.id, rb]]);
        const out = runBattle(s, rng, site, pulse, [a.f, b.f], null, cf);
        out.report.name = `Clash on the ${s.regions[ra].name}–${s.regions[rb].name} border`;
        // everyone returns to their own side of the border first...
        a.f.region = ra; b.f.region = rb;
        recordBattle(out, pulse);
        // ...then the winner breaks through and keeps going, the loser stops.
        for (const m of [a, b]) {
          const won = out.winner === m.f.owner && s.fleets.includes(m.f) && !out.retreats.some(r => r.fleet === m.f);
          if (!won) { m.idx = m.path.length; if (s.fleets.includes(m.f)) m.f.region = m === a ? ra : rb; }
        }
      }
      // --- advance
      for (const m of stepping) {
        if (m.idx >= m.path.length || !s.fleets.includes(m.f)) continue;
        if (clashed.has(m) && m.idx >= m.path.length) continue;
        const from = m.f.region, to = m.path[m.idx++];
        cameFrom.set(m.f.id, from);
        m.f.region = to;
        emit({ k: 'move', pulse, step, fleet: m.f.id, owner: m.f.owner, from, to, ships: m.f.ships.length });
      }
      // --- blocking: hostile fleets or a hostile garrison stop you (unless it's your seize target)
      for (const m of stepping) {
        if (!s.fleets.includes(m.f) || m.idx >= m.path.length) continue;
        const r = s.regions[m.f.region];
        const enemyFleet = s.fleets.some(x => x !== m.f && x.region === r.id && x.ships.length && hostile(s, x.owner, m.f.owner));
        const enemyGarrison = r.owner !== null && hostile(s, r.owner, m.f.owner) && r.garrison > 0;
        if (enemyFleet || enemyGarrison) {
          m.idx = m.path.length;
          emit({ k: 'blocked', pulse, fleet: m.f.id, owner: m.f.owner, at: r.id, reason: enemyFleet ? 'enemy fleet' : 'enemy garrison' });
        }
      }
      // --- guard reactions (free standing order)
      for (const r of rotatedRegions) {
        if (r.owner === null) continue;
        const invaders = s.fleets.filter(x => x.region === r.id && x.ships.length && hostile(s, x.owner, r.owner!) && x.owner !== -1
          && x.doctrine.stance !== 'evasive' && !x.ships.every(sh => sh.cls === 'scout'));
        if (!invaders.length) continue;
        for (const g of s.fleets) {
          if (g.owner !== r.owner || !g.doctrine.guard || g.guardUsed || !g.ships.length) continue;
          if (g.region === r.id || !r.neighbors.includes(g.region)) continue;
          if (movers.some(m => m.f === g && m.idx < m.path.length)) continue;
          if (s.fleets.some(x => x.region === g.region && x.ships.length && hostile(s, x.owner, g.owner))) continue; // pinned
          g.guardUsed = true;
          cameFrom.set(g.id, g.region);
          emit({ k: 'move', pulse, step, fleet: g.id, owner: g.owner, from: g.region, to: r.id, ships: g.ships.length, guard: true });
          g.region = r.id;
          g.fortified = false;
        }
      }
      // --- battles wherever hostile fleets share a region
      fightEverywhere(pulse, cameFrom);
    }
    // stationary hostile fleets that ended up together (e.g. via defection) also fight
    fightEverywhere(pulse, cameFrom);

    // ---------------------------------------------------------- 4. seize
    for (const m of seizers) {
      const p = m.p, target = m.seize!;
      if (!s.fleets.includes(m.f)) continue;
      if (m.f.region !== target) { fail(pulse, p, m.o, `never reached ${s.regions[target].name}`); continue; }
      const r = s.regions[target];
      if (r.owner === p) continue;
      if (r.owner !== null && !hostile(s, p, r.owner)) {
        // pact betrayal
        const victim = r.owner;
        s.pacts = s.pacts.filter(x => !((x.a === p && x.b === victim) || (x.a === victim && x.b === p)));
        addVp(s, p, -R.influence.pactBreakVp, `Broke the pact with ${s.players[victim].name}`);
        emit({ k: 'betrayal', pulse, by: p, victim, region: r.id });
        s.chronicle.push({ turn: s.turn, region: r.id, players: [p, victim], major: true, text: `${s.players[p].name} breaks its pact and falls on ${r.name}. ${s.players[victim].name} will remember.` });
        fightEverywhere(pulse, cameFrom);
        if (!s.fleets.includes(m.f) || m.f.region !== target) continue;
      }
      const defenders = s.fleets.filter(x => x.region === target && x.ships.length && hostile(s, x.owner, p));
      if (defenders.length) { fail(pulse, p, m.o, 'defenders still hold the region'); continue; }
      const mine = s.fleets.filter(x => x.region === target && x.owner === p && x.ships.length);
      if (r.garrison > 0) {
        const out = runBattle(s, rng, target, pulse, mine, r.owner === null ? -1 : r.owner, cameFrom);
        out.report.name = `Siege of ${r.name}${r.battles > 1 ? ` (${r.battles})` : ''}`;
        recordBattle(out, pulse);
      }
      if (r.garrison <= 0 && s.fleets.some(x => x.region === target && x.owner === p && x.ships.length)) {
        const from = r.owner;
        capture(s, target, p, 'force', pulse, emit, leader, capped);
        m.f.commander.deeds.captures++;
        m.f.history.push(`T${s.turn}: took ${r.name}${from !== null ? ` from ${s.players[from].name}` : ''}.`);
        if (from !== null) s.chronicle.push({ turn: s.turn, region: r.id, players: [p, from], major: r.kind !== 'colony',
          text: `${s.players[p].name} takes ${r.name} from ${s.players[from].name}.` });
        else if (r.kind === 'crown' || r.kind === 'throne') s.chronicle.push({ turn: s.turn, region: r.id, players: [p], major: true, text: `${s.players[p].name} claims ${r.name}.` });
      } else if (s.fleets.includes(m.f)) {
        fail(pulse, p, m.o, `the garrison of ${r.name} held (${r.garrison} left)`);
      }
    }

    // ---------------------------------------------------------- 5. economy actions
    for (const { p, o } of orders) {
      if (o.type !== 'build' && o.type !== 'develop' && o.type !== 'excavate') continue;
      const err = validateOrder(s, p, o);
      if (err) { fail(pulse, p, o, err); continue; }
      const regionId = o.type === 'excavate' ? s.fleets.find(f => f.id === o.fleet)!.region : o.region;
      if (s.fleets.some(f => f.region === regionId && f.ships.length && hostile(s, f.owner, p))) { fail(pulse, p, o, 'enemies present'); continue; }
      const cost = orderCost(s, o, p);
      if (!canAfford(s.players[p].res, cost, R)) { fail(pulse, p, o, 'not enough resources'); continue; }
      pay(s.players[p].res, cost, R);
      if (o.type === 'build') {
        let f = o.fleet !== null ? s.fleets.find(x => x.id === o.fleet)! : null;
        if (!f) f = newFleet(s, rng, p, o.region);
        const sh = newShip(s, rng, o.cls);
        f.ships.push(sh);
        emit({ k: 'build', pulse, region: o.region, owner: p, cls: o.cls, fleet: f.id, name: sh.name });
        signal(pulse, p, o.region, `Shipyard activity at ${s.regions[o.region].name}`, { confirmed: false });
      } else if (o.type === 'develop') {
        s.regions[o.region].project = { key: o.project, progress: 0, owner: p };
        emit({ k: 'project', pulse, region: o.region, owner: p, key: o.project, done: false });
        signal(pulse, p, o.region, `Construction at ${s.regions[o.region].name}`);
      } else {
        excavate(s, rng, p, regionId, pulse, emit);
      }
    }
  }

  function fightEverywhere(pulse: number, cameFrom: Map<number, RegionId>) {
    for (const r of rotatedRegions) {
      const here = s.fleets.filter(f => f.region === r.id && f.ships.length);
      if (!here.length) continue;
      let wants = false;
      for (const a of here) for (const b of here) {
        if (a.owner >= b.owner || !hostile(s, a.owner, b.owner)) continue;
        if (a.doctrine.stance !== 'evasive' || b.doctrine.stance !== 'evasive') wants = true;
      }
      // an owned garrison always fires on hostile fleets inside its region
      const garrisonFights = r.owner !== null && r.garrison > 0 && here.some(f => hostile(s, f.owner, r.owner!));
      if (!wants && !garrisonFights) continue;
      const garrisonFor = r.owner !== null && r.garrison > 0 ? r.owner : null;
      const out = runBattle(s, rng, r.id, pulse, here, garrisonFor, cameFrom);
      recordBattle(out, pulse);
    }
  }

  // ======================================================================
  //  End of turn
  // ======================================================================
  const endPulse = R.orders.pulses;

  // ---- the Warden: once awake it marches on the VP leader (the Throne's failsafe)
  const throne = s.regions.find(r => r.kind === 'throne')!;
  const warden = s.fleets.find(f => f.owner === -1);
  if (warden) {
    if (R.wardenHunt.enabled) {
      const lead = currentLeader(s);   // only hunts a clear leader (bounty.leaderMinLead)
      if (lead !== null && s.regions[warden.region].owner !== lead) {
        let best: RegionId[] | null = null;
        for (const r of s.regions) {
          if (r.owner !== lead) continue;
          const path = findPath(s, warden.region, r.id);
          if (path && (!best || path.length < best.length)) best = path;
        }
        for (const to of (best ?? []).slice(0, R.wardenHunt.stepsPerTurn)) {
          emit({ k: 'move', pulse: endPulse, step: 9, fleet: warden.id, owner: -1, from: warden.region, to, ships: warden.ships.length });
          warden.region = to;
        }
        if (best?.length) signal(endPulse, null, warden.region, `THE WARDEN advances on ${s.players[lead].name}: now at ${s.regions[warden.region].name}`, { force: true });
      }
    }
    const site = s.regions[warden.region];
    const here = s.fleets.filter(f => f.region === site.id && f.ships.length);
    const victim = site.owner;
    if (here.some(f => f.owner !== -1) || (victim !== null && site.garrison > 0)) {
      const out = runBattle(s, rng, site.id, endPulse, here, victim, new Map());
      out.report.name = `The Warden's Judgement at ${site.name}`;
      recordBattle(out, endPulse);
      if (!s.fleets.some(f => f.owner === -1)) wardenDefeated(out.winner);
      else if (victim !== null && site.garrison <= 0 && R.wardenHunt.razes && !s.fleets.some(f => f.region === site.id && f.owner === victim)) {
        site.owner = null; site.garrison = 0; site.project = null; site.dev = Math.max(1, site.dev - 1);
        s.chronicle.push({ turn: s.turn, region: site.id, players: [victim], major: true, text: `The Warden razes ${site.name}. ${s.players[victim].name} loses it.` });
        emit({ k: 'note', pulse: endPulse, owner: null, text: `The Warden razes ${site.name}.`, region: site.id });
      }
    }
  }
  if (s.wardenAwake && !s.wardenDefeated && !s.fleets.some(f => f.owner === -1)) wardenDefeated(null);
  function wardenDefeated(by: number | -1 | null) {
    if (s.wardenDefeated) return;
    s.wardenDefeated = true;
    const throne = s.regions.find(r => r.kind === 'throne')!;
    const victor = by !== null && by !== -1 ? by : null;
    if (victor !== null) addVp(s, victor, R.warden.defeatVp, 'Destroyed the Warden');
    s.chronicle.push({ turn: s.turn, region: throne.id, players: victor !== null ? [victor] : [], major: true,
      text: `The Warden falls${victor !== null ? ` to ${s.players[victor].name}` : ''}. ${LORE[LORE.length - 1]}` });
  }

  // ---- upkeep & income
  for (const p of s.players) {
    if (p.eliminated) continue;
    const inc = income(s, p.id);
    const top = Math.max(...s.players.filter(x => !x.eliminated).map(x => x.vp));
    const boost = top - p.vp >= R.comeback.gap && s.regions.find(r => r.kind === 'throne')?.owner !== p.id ? 1 + R.comeback.incomeBonus : 1;
    p.res.industry += Math.round(inc.industry * boost); p.res.credits += Math.round(inc.credits * boost); p.res.influence += inc.influence;
    const upkeep = s.fleets.filter(f => f.owner === p.id).reduce((a, f) => a + f.ships.reduce((b, sh) => b + (R.ships[sh.cls]?.upkeep ?? 0), 0), 0);
    p.res.credits -= upkeep;
  }
  for (const f of s.fleets) {
    if (f.owner === -1) continue;
    const r = s.regions[f.region];
    const owned = r.owner === f.owner;
    const yard = owned && (r.buildings.shipyard ?? 0) > 0;
    for (const sh of f.ships) {
      if (owned) sh.hp = Math.min(sh.maxHp, sh.hp + R.economy.shipRepairPerTurn + (yard ? R.economy.shipyardRepairBonus : 0));
      if (yard) sh.sys = { engines: true, weapons: true, shields: true };
      else if (owned && sh.hp === sh.maxHp) {
        // field repair restores one knocked-out subsystem per turn at full hull
        const k = (['engines', 'weapons', 'shields'] as const).find(x => !sh.sys[x]);
        if (k) sh.sys[k] = true;
      }
    }
    if (s.players[f.owner].res.credits < 0) for (const sh of f.ships) sh.hp = Math.max(1, sh.hp - R.economy.bankruptAttrition);
    f.fatigued = overdrove.has(f.id);
  }
  for (const r of s.regions) {
    if (r.owner !== null) {
      r.garrison = Math.min(maxGarrison(s, r.id), r.garrison + R.garrison.regenPerTurn);
    } else if (r.garrison < (r.baseGarrison ?? 0)) {
      r.garrison = Math.min(r.baseGarrison, r.garrison + R.neutral.garrisonRegen);
    }
    if (r.project) {
      r.project.progress++;
      const pd = R.projects[r.project.key];
      if (r.owner !== r.project.owner) r.project = null;
      else if (r.project.progress >= pd.turns) {
        const key = r.project.key;
        if (key === 'develop') r.dev = Math.min(R.economy.maxDev, r.dev + 1);
        else r.buildings[key] = (r.buildings[key] ?? 0) + 1;
        emit({ k: 'project', pulse: endPulse, region: r.id, owner: r.owner!, key, done: true });
        r.project = null;
      }
    }
    for (let i = 0; i < 3; i++) if (r.loyalty[i] > 0) r.loyalty[i] = Math.max(0, r.loyalty[i] - R.influence.decayPerTurn);
  }

  // ---- pacts
  for (const p of s.players) for (const q of p.pactOffers) {
    if (q > p.id && s.players[q].pactOffers.includes(p.id) && !p.eliminated && !s.players[q].eliminated) {
      s.pacts = s.pacts.filter(x => !((x.a === p.id && x.b === q) || (x.a === q && x.b === p.id)));
      s.pacts.push({ a: p.id, b: q, until: s.turn + R.influence.pactTurns });
      emit({ k: 'pact', pulse: endPulse, a: p.id, b: q, formed: true });
      s.chronicle.push({ turn: s.turn, players: [p.id, q], text: `${p.name} and ${s.players[q].name} sign a pact of non-aggression until turn ${s.turn + R.influence.pactTurns}.` });
    }
  }
  s.pacts = s.pacts.filter(x => x.until > s.turn);

  // ---- capitals & elimination
  for (const p of s.players) {
    if (p.eliminated) continue;
    const owned = s.regions.filter(r => r.owner === p.id);
    const fleets = s.fleets.filter(f => f.owner === p.id);
    if (!owned.length && !fleets.length) {
      p.eliminated = true;
      s.chronicle.push({ turn: s.turn, players: [p.id], major: true, text: `${p.name} is no more.` });
      continue;
    }
    if (s.regions[p.capital].owner !== p.id && owned.length) {
      const best = owned.slice().sort((a, b) => b.dev - a.dev || (b.buildings.shipyard ?? 0) - (a.buildings.shipyard ?? 0))[0];
      p.capital = best.id;
      s.chronicle.push({ turn: s.turn, players: [p.id], region: best.id, text: `${p.name} moves its court to ${best.name}.` });
    }
  }

  // ---- scoring (final state only)
  const heldAllTurn = (r: { owner: PlayerId | null; id: number }) => !R.crowns.mustHoldAtTurnStart || startOwners[r.id] === r.owner;
  for (const p of s.players) {
    if (p.eliminated) continue;
    const owned = s.regions.filter(r => r.kind === 'crown' && r.owner === p.id);
    const crowns = owned.filter(heldAllTurn).length;
    if (crowns) addVp(s, p.id, crowns * R.victory.vpPerCrownPerTurn + (crowns >= 2 ? R.victory.crownMajorityVp : 0) + (p.relics.includes('crown_key') ? R.crowns.crownKeyFlatVp : 0), `Holding ${crowns} Crown${crowns > 1 ? 's' : ''}`);
    if (owned.length > crowns) s.chronicle.push({ turn: s.turn, players: [p.id], text: `${p.name} must hold its new Crown through a whole turn before it pays.` });
  }
  {
    const crowns = s.regions.filter(r => r.kind === 'crown');
    const o = crowns[0]?.owner ?? null;
    const all = o !== null && crowns.every(r => r.owner === o);
    s.crownHold = all ? { owner: o, turns: (s.crownHold?.owner === o ? s.crownHold.turns : 0) + 1 } : { owner: null, turns: 0 };
    if (all && s.crownHold.turns < R.crowns.holdTurnsToWin) s.chronicle.push({ turn: s.turn, players: [0, 1, 2], major: true, text: `${s.players[o!].name} holds ALL THREE CROWNS. If they still hold them at the end of next turn, they win.` });
  }
  const holder = throne.owner !== null && heldAllTurn(throne) ? throne.owner : null;
  if (holder !== null && holder === s.throne.owner) s.throne.streak++;
  else s.throne = { owner: holder, streak: holder !== null ? 1 : 0 };
  if (holder !== null) addVp(s, holder, Math.min(R.throne.streakMaxVp, s.throne.streak) * Math.max(1, Math.round(R.victory.vpPerThronePerTurn / 3)), `Holding the Throne (${s.throne.streak} turn streak)`);

  // ---- edicts
  for (const e of s.edicts.filter(x => x.scoresTurn === s.turn)) {
    const def = EDICTS[e.id];
    const winners = def ? def.check(s, { startOwners }) : [];
    for (const w of winners) addVp(s, w, e.vp, e.name);
    s.chronicle.push({ turn: s.turn, players: winners, major: winners.length > 0,
      text: `${e.name} is judged: ${winners.length ? winners.map(w => s.players[w].name).join(' and ') + ` gain ${e.vp} VP` : 'no one satisfied it'}.` });
  }
  s.edicts = s.edicts.filter(x => x.scoresTurn > s.turn);
  if (s.turn >= R.edicts.firstReveal && (s.turn - R.edicts.firstReveal) % R.edicts.every === 0 && s.edictDeck.length) {
    const id = s.edictDeck.shift()!;
    const d = EDICTS[id];
    if (d) {
      s.edicts.push({ id, name: d.name, desc: d.desc, vp: d.vp, revealedTurn: s.turn, scoresTurn: s.turn + 1 });
      s.chronicle.push({ turn: s.turn, players: [0, 1, 2], text: `A new edict echoes from the Throne: ${d.name}. ${d.desc} (${d.vp} VP, judged at the end of next turn)` });
    }
  }

  maybeWakeWarden(s, rng, endPulse, emit);

  // ---- relic ghost echoes (noise that gives feints cover)
  for (const r of s.regions) {
    if (r.relic !== 'unclaimed') continue;
    if (!rng.chance(R.intel.ghostEchoChance)) continue;
    const to = rng.pick(r.neighbors);
    for (const o of s.players) if (covStart[o.id].has(r.id) || covStart[o.id].has(to)) {
      signals.push({ turn: s.turn, pulse: rng.int(1, R.orders.pulses), observer: o.id, about: null, region: r.id, confidence: 'inferred',
        text: `Unidentified movement near ${r.name}` });
    }
  }

  // ---- conceal
  const finalSignals: Signal[] = [];
  const seen = new Map<string, { sig: Signal; n: number }>();
  for (const x of signals) {
    if (!(x.about === null || !concealed.has(x.about) || x.text.startsWith('FALSE'))) continue;
    const key = `${x.observer}|${x.pulse}|${x.text}`;
    const prev = seen.get(key);
    if (prev) { prev.n++; continue; }
    const copy = { ...x };
    seen.set(key, { sig: copy, n: 1 });
    finalSignals.push(copy);
  }
  for (const { sig, n } of seen.values()) if (n > 1) sig.text += ` (×${n})`;
  for (const p of concealed) for (const o of s.players) if (o.id !== p) {
    finalSignals.push({ turn: s.turn, pulse: 1, observer: o.id, about: p, region: s.players[p].capital, confidence: 'confirmed', text: `Heavy jamming from ${s.players[p].name}'s capital. Their movements this turn are hidden.` });
  }

  // ---- victory
  checkVictory(s);

  s.scans = s.scans.filter(x => x.until > s.turn);
  s.turn++;
  s.rngState = rng.state;
  const result: TurnResult = { turn: s.turn - 1, events, battles, signals: finalSignals, startFleets, startOwners };
  s.last = result;
  return s;
}

// --------------------------------------------------------------------------

function sanitize(s: GameState, sub: Submission | undefined): Submission {
  const out: Submission = { orders: new Array(s.rules.orders.perTurn).fill(null), free: [] };
  if (!sub) return out;
  for (let i = 0; i < out.orders.length; i++) out.orders[i] = sub.orders?.[i] ?? null;
  out.free = Array.isArray(sub.free) ? sub.free.slice(0, 64) : [];
  return out;
}

function applyFree(s: GameState, rng: Rng, p: PlayerId, fa: Submission['free'][number]): string | null {
  const f = s.fleets.find(x => x.id === fa.fleet && x.owner === p);
  if (!f) return 'no such fleet of yours';
  switch (fa.type) {
    case 'doctrine': {
      const d = fa.doctrine;
      if (!d || !['aggressive', 'defensive', 'evasive'].includes(d.stance)) return 'bad stance';
      if (!['weakest', 'strongest', 'cheapest', 'garrison'].includes(d.target)) return 'bad target priority';
      f.doctrine = { stance: d.stance, target: d.target, guard: !!d.guard, retreatAt: Math.max(0, Math.min(0.9, Number(d.retreatAt) || 0)) };
      return null;
    }
    case 'rename': f.name = String(fa.name).slice(0, 40) || f.name; return null;
    case 'split': {
      const ids = new Set(fa.ships);
      const moving = f.ships.filter(x => ids.has(x.id));
      if (!moving.length) return 'no matching ships';
      if (moving.length === f.ships.length) return 'cannot split off every ship';
      if (s.fleets.filter(x => x.owner === p).length >= s.rules.maxFleets) return `at most ${s.rules.maxFleets} fleets`;
      f.ships = f.ships.filter(x => !ids.has(x.id));
      const nf = newFleet(s, rng, p, f.region);
      nf.ships = moving;
      nf.doctrine = { ...f.doctrine };
      return null;
    }
    case 'merge': {
      const into = s.fleets.find(x => x.id === fa.into && x.owner === p);
      if (!into || into === f) return 'no such target fleet';
      if (into.region !== f.region) return 'fleets must be in the same region';
      if (into.ships.length + f.ships.length > s.rules.maxShipsPerFleet) return `fleet would exceed ${s.rules.maxShipsPerFleet} ships`;
      into.ships.push(...f.ships);
      f.ships = [];
      if (f.commander.alive) s.players[p].reserveCommanders.push(f.commander);
      s.fleets = s.fleets.filter(x => x !== f);
      return null;
    }
  }
  return 'unknown action';
}

export function income(s: GameState, p: PlayerId) {
  const R = s.rules;
  const out = { industry: 0, credits: 0, influence: 0 };
  for (const r of s.regions) {
    if (r.owner !== p) continue;
    const y = R.economy.yields[r.kind] ?? R.economy.yields.colony;
    const mult = Math.max(1, r.dev);
    out.industry += y.industry * mult + (r.buildings.mine ?? 0) * R.economy.mineBonus;
    out.credits += y.credits * mult + (r.buildings.tradehub ?? 0) * R.economy.tradeHubBonus;
    out.influence += y.influence * (r.kind === 'void' ? 0 : 1) + (r.kind === 'home' ? Math.floor(r.dev / 2) : 0);
  }
  if (s.players[p].relics.includes('well')) out.credits += 6;
  return out;
}

export function addVp(s: GameState, p: PlayerId, n: number, why: string) {
  if (!n) return;
  s.players[p].vp += n;
  s.players[p].vpLog.push({ turn: s.turn, amount: n, why });
}

/** The VP leader, if they lead by enough to count as "the leader" for bounties. */
export function currentLeader(s: GameState): PlayerId | null {
  const live = s.players.filter(p => !p.eliminated).sort((a, b) => b.vp - a.vp);
  if (live.length < 2) return null;
  return live[0].vp - live[1].vp >= s.rules.bounty.leaderMinLead ? live[0].id : null;
}

function capture(s: GameState, rid: RegionId, by: PlayerId, how: 'force' | 'influence', pulse: number, emit: (e: GameEvent) => void, leader: PlayerId | null, capped: (p: PlayerId, n: number) => number) {
  const r = s.regions[rid];
  const from = r.owner;
  r.owner = by;
  r.heldSince = s.turn;
  r.project = null;
  r.loyalty = [0, 0, 0];
  if (how === 'force' && r.dev > 1 && r.kind !== 'crown' && r.kind !== 'throne') r.dev--; // war scars
  r.garrison = how === 'force' ? s.rules.garrison.afterCapture + (s.rules.crowns.capturedGarrisonBonus[r.kind] ?? 0) : Math.max(s.rules.garrison.afterCapture, Math.floor(maxGarrison(s, rid) / 2));
  r.garrison = Math.min(r.garrison, Math.max(maxGarrison(s, rid), s.rules.garrison.afterCapture));
  s.turnStats.captures[by]++;
  emit({ k: 'capture', pulse, region: rid, by, from, how });
  if (from !== null) {
    if (r.homeOf === from && !(s.capitalsTaken ?? []).includes(from)) {
      (s.capitalsTaken ??= []).push(from);
      addVp(s, by, s.rules.victory.vpCapitalCapture, `Captured ${s.players[from].name}'s capital`);
    }
    if (leader !== null && from === leader) addVp(s, by, capped(by, s.rules.bounty.vpTakeFromLeader), `Bounty: took ${r.name} from the leader`);
  }
}

function excavate(s: GameState, rng: Rng, p: PlayerId, rid: RegionId, pulse: number, emit: (e: GameEvent) => void) {
  const r = s.regions[rid];
  const taken = new Set(s.players.flatMap(x => x.relics));
  const pool = RELICS.filter(x => !taken.has(x.id));
  const relic = pool.length ? rng.pick(pool) : null;
  r.relic = relic ? relic.id : 'empty';
  if (relic) s.players[p].relics.push(relic.id);
  const lore = s.loreFound++;
  addVp(s, p, s.rules.victory.vpPerRelic, `Excavated ${relic?.name ?? 'an empty vault'}`);
  emit({ k: 'excavate', pulse, owner: p, region: rid, relic: relic?.id ?? 'empty', lore });
  s.chronicle.push({ turn: s.turn, region: rid, players: [0, 1, 2], major: true,
    text: `${s.players[p].name} unearths ${relic?.name ?? 'an empty vault'} at ${r.name}. Fragment ${lore + 1}: "${LORE[Math.min(lore, LORE.length - 2)]}"` });
}

/** Called at the very end of the turn (after scoring) so it never ambushes mid-turn. */
function maybeWakeWarden(s: GameState, rng: Rng, pulse: number, emit: (e: GameEvent) => void) {
  if (s.loreFound >= s.rules.warden.wakeAtLore && !s.wardenAwake) {
    s.wardenAwake = true;
    const throne = s.regions.find(x => x.kind === 'throne')!;
    const w: Fleet = {
      id: s.nextId++, owner: -1, name: 'The Warden', region: throne.id, ships: [],
      commander: { name: 'The Warden', xp: 0, rank: 3, traits: [], alive: true, deeds: { kills: 0, wins: 0, defWins: 0, losses: 0, retreats: 0, captures: 0 }, rivals: {} },
      doctrine: { stance: 'aggressive', retreatAt: 0, target: 'strongest', guard: false },
      fortified: false, fatigued: false, ordersThisTurn: 0, guardUsed: false, history: [], bornTurn: s.turn,
    };
    for (const c of s.rules.warden.ships) { const sh = newShip(s, rng, c); sh.name = `Warden-${sh.name}`; w.ships.push(sh); }
    s.fleets.push(w);
    s.chronicle.push({ turn: s.turn, region: throne.id, players: [0, 1, 2], major: true,
      text: `Fragment ${s.loreFound} is spoken aloud and the Hollow Throne wakes. THE WARDEN rises${s.rules.wardenHunt.enabled ? ' and marches on whoever leads in VP, razing what it reaches' : ' to judge whoever sits on the Throne'}. Destroying it is worth ${s.rules.warden.defeatVp} VP.` });
    emit({ k: 'note', pulse, owner: null, text: 'THE WARDEN AWAKENS in the Hollow Throne.', region: throne.id });
  }
}

export function checkVictory(s: GameState) {
  if (s.winner !== null) return;
  const V = s.rules.victory;
  const live = s.players.filter(p => !p.eliminated);
  if (live.length === 1) { s.winner = live[0].id; s.winReason = 'Last empire standing.'; return; }
  if (V.holdAllCrownsWins) {
    const crowns = s.regions.filter(r => r.kind === 'crown');
    const o = crowns[0]?.owner;
    if (o !== null && o !== undefined && crowns.every(r => r.owner === o) && (s.crownHold?.owner === o && s.crownHold.turns >= s.rules.crowns.holdTurnsToWin)) { s.winner = o; s.winReason = `Held all three Crowns for ${s.rules.crowns.holdTurnsToWin} turns.`; return; }
  }
  const rank = () => live.slice().sort((a, b) => b.vp - a.vp
    || (s.throne.owner === b.id ? 1 : 0) - (s.throne.owner === a.id ? 1 : 0)
    || s.regions.filter(r => r.kind === 'crown' && r.owner === b.id).length - s.regions.filter(r => r.kind === 'crown' && r.owner === a.id).length
    || (a.id + s.seed) % 3 - (b.id + s.seed) % 3);
  if (V.mode === 'vp') {
    const top = rank()[0];
    if (top.vp >= V.vpTarget) { s.winner = top.id; s.winReason = `Reached ${V.vpTarget} VP.`; return; }
  }
  if (s.turn >= V.turnLimit) { const top = rank()[0]; s.winner = top.id; s.winReason = `Most VP when the ${V.turnLimit}-turn limit expired.`; }
}

/** Loyalty needed for a region to defect to you. */
export function flipThreshold(s: GameState, rid: RegionId): number {
  const r = s.regions[rid];
  const mult = r.kind === 'crown' || r.kind === 'throne' ? s.rules.influenceLimits.crownMult : 1;
  if (r.owner === null) return s.rules.influence.flipThreshold * mult;
  return (s.rules.influence.rivalFlipThreshold + (r.buildings.fortress ?? 0) * s.rules.influenceLimits.perFortress) * mult;
}
