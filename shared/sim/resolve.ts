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
import { TECH, LAW, MODULES } from '../config/empire.ts';
import { techCost, researchBlock, opposite, blueprintFor, baseHp, hasTech, hasLaw, connected, supplied, maxDevAt } from './empire.ts';
import { RELICS, LORE } from '../config/content.ts';
import { fightRounds, hostile, wouldFight, engagementAt, newReport, disengage, type FightOutcome } from './combat.ts';
import { EDICTS } from './edicts.ts';
import { fleetSpeed, strengthBand, findPath } from './graph.ts';
import { canAfford, orderCost, pay, validateOrder, ORDER_INFO } from './orders.ts';
import { Rng } from './rng.ts';
import { maxGarrison, newFleet, newShip } from './setup.ts';
import type { TickOpts, BattleReport, Engagement, Doctrine, Fleet, FreeAction, GameEvent, GameState, Order, PlayerId, RegionId, Signal, Submission, TurnResult } from './types.ts';
import { coverage, seesFleetsIn } from './visibility.ts';

export function emptySubmission(s: GameState): Submission {
  return { orders: new Array(s.rules.orders.perTurn).fill(null), free: [] };
}

/**
 * Resolve a WEGO turn (all pulses + end of turn), or, with `tick`, a single LIVE tick:
 * one pulse in which every order in each player's list resolves, optionally followed by
 * the end-of-turn phase (end of a cycle).
 */
export function resolveTurn(prev: GameState, submissions: Record<number, Submission>, tick?: TickOpts): GameState {
  const s: GameState = structuredClone({ ...prev, last: null });
  const live = !!tick;
  const newCycle = !tick || tick.newCycle;
  const endCycle = !tick || tick.endCycle;
  const rng = new Rng(s.rngState);
  const R = s.rules;
  const events: GameEvent[] = [];
  const battles: BattleReport[] = [];
  const signals: Signal[] = [];
  const subs: Record<number, Submission> = {};
  for (const p of s.players) subs[p.id] = sanitize(s, submissions[p.id], live);
  s.log.push(live ? { turn: s.turn, submissions: structuredClone(subs), tick: { ...tick! } } : { turn: s.turn, submissions: structuredClone(subs) });

  // per-turn counters (a LIVE cycle counts as one turn: they persist across its ticks)
  if (newCycle) {
    s.turnStats = { kills: [0, 0, 0], battlesWon: [0, 0, 0], crownBattlesWon: [0, 0, 0], captures: [0, 0, 0], honors: [0, 0, 0], bounty: [0, 0, 0], influenced: [] };
    for (const f of s.fleets) { f.ordersThisTurn = 0; f.guardUsed = false; }
    for (const p of s.players) { p.pactOffers = []; p.researched = 0; }
    s.cycleStartOwners = s.regions.map(r => r.owner);
    s.concealed = [];
  }
  const ts = s.turnStats;
  const honors = (ts.honors ??= [0, 0, 0]);
  const bountyVp = (ts.bounty ??= [0, 0, 0]);
  const capped = (p: PlayerId, n: number) => { const room = Math.max(0, R.bountyCap.maxPerTurn - bountyVp[p]); const g = Math.min(room, n); bountyVp[p] += g; return g; };
  const influencedThisTurn = { has: (k: string) => (ts.influenced ??= []).includes(k), add: (k: string) => { (ts.influenced ??= []).push(k); } };
  const concealed = { has: (p: PlayerId) => (s.concealed ?? []).includes(p), add: (p: PlayerId) => { if (!(s.concealed ??= []).includes(p)) s.concealed.push(p); }, [Symbol.iterator]: () => (s.concealed ?? [])[Symbol.iterator]() };
  const covStart = s.players.map(p => coverage(s, p.id));

  // ---------------------------------------------------------- free actions
  const freeFails: GameEvent[] = [];
  for (const p of s.players) for (const fa of subs[p.id].free) {
    const err = applyFree(s, rng, p.id, fa);
    if (err) freeFails.push({ k: 'fail', pulse: 0, owner: p.id, text: `${fa.type === 'research' ? `Research (${TECH[fa.tech]?.name ?? fa.tech})` : fa.type} failed: ${err}` });
    else if (fa.type === 'research') {
      freeFails.push({ k: 'tech', pulse: 0, owner: p.id, tech: fa.tech });
      if (TECH[fa.tech]?.tier === 4) s.chronicle.push({ turn: s.turn, players: [p.id], major: true, text: `${p.name} completes ${TECH[fa.tech].name}. No other empire can ever have it.` });
    } else if (fa.type === 'revoke') freeFails.push({ k: 'law', pulse: 0, owner: p.id, law: fa.law, revoked: true });
  }

  // iterate regions from a turn-dependent offset so no part of the map always resolves first
  const rOff = (s.turn * 7) % s.regions.length;
  const rotatedRegions = [...s.regions.slice(rOff), ...s.regions.slice(0, rOff)];
  const startFleets = structuredClone(s.fleets);
  const startOwners = s.regions.map(r => r.owner);                        // for this result's replay
  const scoreOwners = live ? (s.cycleStartOwners ?? startOwners) : startOwners; // for "held the whole turn" scoring
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

  // one report per engagement per turn; rounds from every pulse are appended to it
  const reports = new Map<number, BattleReport>();
  const getReport = (eng: Engagement, pulse = 1) => {
    let r = reports.get(eng.id);
    if (!r) { r = newReport(s, eng, pulse); reports.set(eng.id, r); battles.push(r); }
    return r;
  };
  const handleFight = (out: FightOutcome, rid: RegionId, pulse: number, report: BattleReport | undefined) => {
    if (out.rounds > 0 && report) emit({ k: 'battle', pulse, region: rid, battle: report.id, name: report.name, parties: report.sides.map(x => x.owner) });
    for (const r of out.retreats) {
      emit({ k: 'retreat', pulse, fleet: r.fleet.id, owner: r.fleet.owner, from: rid, to: r.to });
      r.fleet.region = r.to;
      r.fleet.fortified = false;
    }
    for (const f of out.destroyedFleets) emit({ k: 'destroyed', pulse, fleet: f.id, owner: f.owner, region: rid, name: f.name });
    s.fleets = s.fleets.filter(f => f.ships.length > 0);
    if (s.wardenAwake && !s.wardenDefeated && !s.fleets.some(f => f.owner === -1)) wardenDefeated(out.winner);
    if (!out.ended || !out.eng) return;
    const E = out.eng;
    // battle honors for the whole engagement
    const w = out.winner;
    const enemyLosses = Object.entries(E.losses).filter(([o]) => Number(o) !== w).reduce((a, [, n]) => a + n, 0);
    if (w !== null && w !== -1 && enemyLosses >= R.bounty.battleHonorMinKills && honors[w] < R.bounty.maxHonorPerTurn) {
      const vsLeader = leader !== null && E.owners.includes(leader) && w !== leader;
      honors[w]++;
      addVp(s, w, capped(w, vsLeader ? R.bounty.battleHonorVsLeaderVp : R.bounty.battleHonorVp), `Battle honors: ${E.name}${vsLeader ? ' (against the leader)' : ''}`);
    }
    const lost = Object.values(E.losses).reduce((a, b) => a + b, 0);
    if (lost >= 2) {
      const ps = E.owners.filter((x): x is number => x >= 0);
      const long = s.turn > E.startedTurn ? ` after ${E.rounds} rounds over ${s.turn - E.startedTurn + 1} turns` : '';
      s.chronicle.push({ turn: s.turn, region: rid, players: ps, major: lost >= 5,
        text: `The ${E.name} ends${long}: ${lost} ships destroyed. ${w === null ? 'Neither side broke.' : w === -1 ? 'The defenders held.' : `${s.players[w].name} held the field.`}` });
    }
  };

  /** Combat step of a pulse: every engagement fights its rounds, then finished sieges capture. */
  const combatPhase = (pulse: number, cameFrom: Map<number, RegionId>) => {
    for (const r of rotatedRegions) {
      const eng = engagementAt(s, r.id);
      if (!wouldFight(s, r.id) && !eng) continue;
      let rep: BattleReport | undefined;
      const out = fightRounds(s, rng, r.id, pulse, R.combat.roundsPerPulse, cameFrom, e => (rep = getReport(e, pulse)));
      handleFight(out, r.id, pulse, rep);
    }
    // captures: a besieger standing in a region whose garrison is gone, with no hostile fleets left, takes it
    for (const r of rotatedRegions) {
      const besiegers = s.fleets.filter(f => f.region === r.id && f.siege === r.id && f.ships.length);
      if (!besiegers.length || r.garrison > 0) continue;
      const by = besiegers[0].owner;
      if (s.fleets.some(f => f.region === r.id && f.ships.length && hostile(s, f.owner, by))) continue;
      for (const f of besiegers) f.siege = null;
      if (r.owner === by) continue;
      if (by === -1) {
        if (r.owner !== null && R.wardenHunt.razes) {
          const victim = r.owner;
          r.owner = null; r.garrison = 0; r.project = null; r.dev = Math.max(1, r.dev - 1);
          s.chronicle.push({ turn: s.turn, region: r.id, players: [victim], major: true, text: `The Warden razes ${r.name}. ${s.players[victim].name} loses it.` });
          emit({ k: 'note', pulse, owner: null, text: `The Warden razes ${r.name}.`, region: r.id });
        }
        continue;
      }
      const from = r.owner;
      capture(s, r.id, by, 'force', pulse, emit, leader, capped);
      const taker = besiegers.find(f => f.owner === by)!;
      taker.commander.deeds.captures++;
      taker.history.push(`T${s.turn}: took ${r.name}${from !== null ? ` from ${s.players[from].name}` : ''}.`);
      if (from !== null) s.chronicle.push({ turn: s.turn, region: r.id, players: [by, from], major: r.kind !== 'colony',
        text: `${s.players[by].name} takes ${r.name} from ${s.players[from].name}.` });
      else if (r.kind === 'crown' || r.kind === 'throne') s.chronicle.push({ turn: s.turn, region: r.id, players: [by], major: true, text: `${s.players[by].name} claims ${r.name}.` });
    }
  };

  // ======================================================================
  const pulseList = live ? [tick!.pulse] : Array.from({ length: R.orders.pulses }, (_, i) => i + 1);
  for (const pulse of pulseList) {
    emit({ k: 'pulse', pulse });
    const pulseOwners = s.regions.map(r => r.owner);
    const orders: { p: PlayerId; o: Order }[] = [];
    // rotate who is processed first each turn so same-pulse ties never favour a seat
    const rot = s.turn % s.players.length;
    const seatOrder = [...s.players.slice(rot), ...s.players.slice(0, rot)];
    for (const p of seatOrder) {
      if (p.eliminated) continue;
      if (live) { for (const o of subs[p.id].orders) if (o) orders.push({ p: p.id, o }); continue; }
      const o = subs[p.id].orders[pulse - 1];
      if (o) orders.push({ p: p.id, o });
    }
    // fleet fatigue: extra orders on the same fleet cost credits (Old World style)
    for (const { p, o } of orders) {
      if (!('fleet' in o) || o.type === 'build') continue;
      const f = s.fleets.find(x => x.id === o.fleet);
      if (!f || f.owner !== p) continue;   // never let an order touch a rival's per-fleet budget
      if (f.ordersThisTurn > 0) s.players[p].res.credits -= R.orders.repeatFleetCredits;
      f.ordersThisTurn++;
    }

    // ---------------------------------------------------------- 1. prepare
    for (const { p, o } of orders) {
      if (!['fortify', 'scan', 'feint', 'conceal', 'pact', 'law', 'refit'].includes(o.type)) continue;
      const err = validateOrder(s, p, o);
      if (err) { fail(pulse, p, o, err); continue; }
      const cost = orderCost(s, o, p);
      if (!canAfford(s.players[p].res, cost, creditRate(s, p))) { fail(pulse, p, o, 'not enough resources'); continue; }
      pay(s.players[p].res, cost, creditRate(s, p));
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
        case 'law': {
          const pl = s.players[p];
          const opp = opposite(o.law);
          const repealed = !!opp && !!pl.laws?.includes(opp);
          pl.laws = (pl.laws ?? []).filter(x => x !== opp);
          pl.laws.push(o.law);
          emit({ k: 'law', pulse, owner: p, law: o.law });
          s.chronicle.push({ turn: s.turn, players: [p], text: `${pl.name} enacts ${LAW[o.law].name}${repealed ? `, repealing ${LAW[opp!].name}` : ''}.` });
          break;
        }
        case 'refit': {
          const f = s.fleets.find(x => x.id === o.fleet)!;
          for (const sh of f.ships) {
            const mod = blueprintFor(s, p, sh.cls);
            const frac = sh.hp / Math.max(1, sh.maxHp);
            sh.mod = mod;
            sh.maxHp = baseHp(s, sh.cls, mod);
            sh.hp = Math.max(1, Math.round(sh.maxHp * Math.max(frac, 1)));
            sh.sys = { engines: true, weapons: true, shields: true };
          }
          emit({ k: 'refit', pulse, owner: p, fleet: f.id, region: f.region });
          signal(pulse, p, f.region, `${s.players[p].name} refitting ships at ${s.regions[f.region].name}`);
          break;
        }
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
      if (!canAfford(s.players[p].res, cost, creditRate(s, p))) { fail(pulse, p, o, 'not enough influence'); continue; }
      pay(s.players[p].res, cost, creditRate(s, p));
      influencedThisTurn.add(key);
      if (r.owner === p) { purges.push({ p, r: r.id }); continue; }
      const adj = r.neighbors.some(n => s.regions[n].owner === p);
      r.loyalty[p] = (r.loyalty[p] ?? 0) + Math.round((R.influence.pushAmount + (adj ? R.influence.adjacentBonus : 0)) * (hasTech(s, p, 'subversion') ? R.empire.subversionPushMult : 1));
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
      for (const p of seatOrder) if (p.id !== r.owner && !p.eliminated && r.loyalty[p.id] >= thr && (best === null || r.loyalty[p.id] > r.loyalty[best])) best = p.id;
      if (best === null) continue;
      if (r.owner !== null && s.players[r.owner].capital === r.id) continue;
      const occupied = s.fleets.some(f => f.region === r.id && f.owner !== best && f.ships.length && (f.owner === r.owner || hostile(s, f.owner, best!)));
      if (occupied) continue; // can't defect under someone else's guns
      const from = r.owner;
      capture(s, r.id, best, 'influence', pulse, emit, leader, capped);
      s.chronicle.push({ turn: s.turn, region: r.id, players: [best], text: `${r.name} ${from === null ? 'joins' : 'defects to'} ${s.players[best].name} without a shot fired.` });
    }

    // ---------------------------------------------------------- 3. movement
    interface Mover { f: Fleet; path: RegionId[]; idx: number; seize: RegionId | null; p: PlayerId; o: Order; dest?: RegionId }
    const movers: Mover[] = [];
    const cameFrom = new Map<number, RegionId>();
    for (const { p, o } of orders) {
      if (o.type !== 'move' && o.type !== 'seize') continue;
      if (live) {
        // LIVE: a Move/Seize sets the fleet travelling; it advances as it earns movement points each tick
        const err = validateOrder(s, p, o.type === 'seize' ? { ...o, also: undefined } : o);
        if (err) { fail(pulse, p, o, err); continue; }
        const f = s.fleets.find(x => x.id === o.fleet)!;
        const startMp = R.live.stepCost - Math.max(1, fleetSpeed(s, f));   // the first step happens right away
        if (o.type === 'move') {
          f.route = { path: o.path.slice(), seize: null, mp: startMp, overdrive: o.overdrive || undefined };
          if (o.overdrive) f.od = true;
        } else {
          f.route = { path: f.region === o.target ? [] : [o.target], seize: o.target, mp: startMp };
          for (const id of [...new Set(o.also ?? [])].slice(0, 3)) {
            const g = s.fleets.find(x => x.id === id && x.owner === p && x.ships.length);
            if (!g || g === f || (g.region !== o.target && !s.regions[g.region].neighbors.includes(o.target))) continue;
            if (g.ordersThisTurn >= R.orders.maxPerFleet) { emit({ k: 'fail', pulse, owner: p, text: `${g.name} is exhausted (max ${R.orders.maxPerFleet} orders per turn)` }); continue; }
            if (g.ordersThisTurn > 0) s.players[p].res.credits -= R.orders.repeatFleetCredits;
            g.ordersThisTurn++;
            g.route = { path: g.region === o.target ? [] : [o.target], seize: o.target, mp: R.live.stepCost - Math.max(1, fleetSpeed(s, g)) };
          }
        }
        f.fortified = false;
        continue;
      }
      const err = validateOrder(s, p, o.type === 'seize' ? { ...o, also: undefined } : o);
      if (err) { fail(pulse, p, o, err); continue; }
      const f = s.fleets.find(x => x.id === o.fleet)!;
      if (o.type === 'move') {
        if (o.overdrive) f.od = true;
        movers.push({ f, path: o.path.slice(), idx: 0, seize: null, p, o });
      } else {
        movers.push({ f, path: f.region === o.target ? [] : [o.target], idx: 0, seize: o.target, p, o });
        // combined assault: extra fleets adjacent to (or at) the target join in
        for (const id of [...new Set(o.also ?? [])].slice(0, 3)) {
          const g = s.fleets.find(x => x.id === id && x.owner === p && x.ships.length);
          if (!g || g === f || movers.some(m => m.f === g)) continue;
          if (g.bornTurn === s.turn && s.turn > 1) { emit({ k: 'fail', pulse, owner: p, text: `${g.name} was only just formed and can't join the assault` }); continue; }
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
    if (live) {
      for (const f of s.fleets) {
        const rt = f.route;
        if (!rt || !f.ships.length || f.owner === -1) continue;
        const synth: Order = rt.seize !== null ? { type: 'seize', fleet: f.id, target: rt.seize } : { type: 'move', fleet: f.id, path: rt.path.slice() };
        if (!rt.path.length) { movers.push({ f, path: [], idx: 0, seize: rt.seize, p: f.owner, o: synth }); f.route = null; continue; }
        rt.mp += Math.max(1, fleetSpeed(s, f)) + (rt.overdrive ? R.overdrive.speedBonus : 0);
        if (rt.mp < R.live.stepCost) continue;
        rt.mp -= R.live.stepCost;
        movers.push({ f, path: [rt.path[0]], idx: 0, seize: rt.path.length === 1 ? rt.seize : null, p: f.owner, o: synth, dest: rt.path[rt.path.length - 1] });
        f.fortified = false;
      }
    }
    const seizers = movers.filter(m => m.seize !== null);
    // movement signals (destination + arrival + strength band)
    for (const m of movers) {
      if (!m.path.length) continue;
      const dest = m.dest ?? m.path[m.path.length - 1];
      const txt = live ? `Fleet movement (${strengthBand(m.f.ships.length)}) ${s.regions[m.f.region].name} → ${s.regions[dest].name}, heading onward`
        : `Fleet movement (${strengthBand(m.f.ships.length)}) ${s.regions[m.f.region].name} → ${s.regions[dest].name}, arriving pulse ${pulse}`;
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
        let rep: BattleReport | undefined;
        const out = fightRounds(s, rng, site, pulse, 1, new Map(), e => (rep = getReport(e, pulse)),
          { clash: [a.f, b.f], clashName: `Clash on the ${s.regions[ra].name}–${s.regions[rb].name} border` });
        a.f.region = ra; b.f.region = rb;
        handleFight(out, site, pulse, rep);
        // both are thrown back to their own side and stop; the fight can continue if someone presses on
        for (const m of [a, b]) m.idx = m.path.length;
      }
      // --- advance
      for (const m of stepping) {
        if (m.idx >= m.path.length || !s.fleets.includes(m.f)) continue;
        if (clashed.has(m) && m.idx >= m.path.length) continue;
        const from = m.f.region, to = m.path[m.idx++];
        if (engagementAt(s, from) && !disengage(s, rng, m.f, pulse, e => getReport(e, pulse))) {
          emit({ k: 'destroyed', pulse, fleet: m.f.id, owner: m.f.owner, region: from, name: m.f.name });
          s.fleets = s.fleets.filter(f => f !== m.f);
          m.idx = m.path.length;
          continue;
        }
        m.f.siege = null;
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
          if (movers.some(m => m.f === g && (m.idx < m.path.length || m.o.type === 'seize'))) continue;
          if (s.fleets.some(x => x.region === g.region && x.ships.length && hostile(s, x.owner, g.owner))) continue; // pinned
          g.guardUsed = true;
          g.siege = null;
          cameFrom.set(g.id, g.region);
          emit({ k: 'move', pulse, step, fleet: g.id, owner: g.owner, from: g.region, to: r.id, ships: g.ships.length, guard: true });
          g.region = r.id;
          g.fortified = false;
        }
      }
    }

    // LIVE: fleets that made their step move along their route; blocked or destroyed fleets stop
    if (live) for (const m of movers) {
      if (!m.path.length) continue;
      const f = m.f;
      if (!s.fleets.includes(f) || !f.route) continue;
      if (f.region === m.path[0]) { f.route.path.shift(); if (!f.route.path.length && f.route.seize === null) f.route = null; }
      else f.route = null;
    }

    // ---------------------------------------------------------- 4. sieges
    // A Seize order puts the fleet (and any joining fleets) under siege orders at the target.
    // The siege then continues on its own, pulse after pulse and turn after turn, until the
    // garrison and defenders are beaten (capture) or the besiegers leave or are driven off.
    for (const m of seizers) {
      const p = m.p, target = m.seize!;
      if (!s.fleets.includes(m.f)) continue;
      if (m.f.region !== target) { fail(pulse, p, m.o, `never reached ${s.regions[target].name}`); continue; }
      const r = s.regions[target];
      if (r.owner === p) continue;
      if (r.owner !== null && !hostile(s, p, r.owner) && r.owner !== pulseOwners[target]) {
        fail(pulse, p, m.o, `${s.players[r.owner].name} took ${r.name} first`);
        continue;
      }
      if (r.owner !== null && !hostile(s, p, r.owner)) {
        const victim = r.owner;
        s.pacts = s.pacts.filter(x => !((x.a === p && x.b === victim) || (x.a === victim && x.b === p)));
        addVp(s, p, -R.influence.pactBreakVp, `Broke the pact with ${s.players[victim].name}`);
        emit({ k: 'betrayal', pulse, by: p, victim, region: r.id });
        s.chronicle.push({ turn: s.turn, region: r.id, players: [p, victim], major: true, text: `${s.players[p].name} breaks its pact and falls on ${r.name}. ${s.players[victim].name} will remember.` });
      }
      const group = movers.filter(x => x.o === m.o && s.fleets.includes(x.f) && x.f.region === target).map(x => x.f);
      for (const f of group) f.siege = target;
      if (r.garrison > 0 || s.fleets.some(f => f.region === target && f.ships.length && hostile(s, f.owner, p)))
        emit({ k: 'note', pulse, owner: p, text: `${group.map(f => f.name).join(' + ')} lay${group.length > 1 ? '' : 's'} siege to ${r.name}.`, region: target });
    }

    // ---------------------------------------------------------- 5. combat
    combatPhase(pulse, cameFrom);

    // ---------------------------------------------------------- 6. economy actions
    for (const { p, o } of orders) {
      if (o.type !== 'build' && o.type !== 'develop' && o.type !== 'excavate') continue;
      const err = validateOrder(s, p, o);
      if (err) { fail(pulse, p, o, err); continue; }
      const regionId = o.type === 'excavate' ? s.fleets.find(f => f.id === o.fleet)!.region : o.region;
      if (s.fleets.some(f => f.region === regionId && f.ships.length && hostile(s, f.owner, p))) { fail(pulse, p, o, 'enemies present'); continue; }
      const cost = orderCost(s, o, p);
      if (!canAfford(s.players[p].res, cost, creditRate(s, p))) { fail(pulse, p, o, 'not enough resources'); continue; }
      pay(s.players[p].res, cost, creditRate(s, p));
      if (o.type === 'build') {
        let f = o.fleet !== null ? s.fleets.find(x => x.id === o.fleet)! : null;
        if (!f) f = newFleet(s, rng, p, o.region);
        const sh = newShip(s, rng, o.cls, p);
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

  // ======================================================================
  //  End of turn
  // ======================================================================
  const endPulse = live ? tick!.pulse : R.orders.pulses;

  function wardenDefeated(by: number | -1 | null) {
    if (s.wardenDefeated) return;
    s.wardenDefeated = true;
    const throne = s.regions.find(r => r.kind === 'throne')!;
    const victor = by !== null && by !== -1 ? by : null;
    if (victor !== null) addVp(s, victor, R.warden.defeatVp, 'Destroyed the Warden');
    s.chronicle.push({ turn: s.turn, region: throne.id, players: victor !== null ? [victor] : [], major: true,
      text: `The Warden falls${victor !== null ? ` to ${s.players[victor].name}` : ''}. ${LORE[LORE.length - 1]}` });
  }

  // ======== end of turn (in LIVE mode: end of a cycle) ========
  if (endCycle) {
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
    // it besieges wherever it stands: fighting happens in next turn's combat steps
    warden.siege = s.regions[warden.region].owner !== null ? warden.region : null;
  }
  if (s.wardenAwake && !s.wardenDefeated && !s.fleets.some(f => f.owner === -1)) wardenDefeated(null);
  // ---- upkeep & income
  for (const p of s.players) {
    if (p.eliminated) continue;
    const inc = income(s, p.id);
    const top = Math.max(...s.players.filter(x => !x.eliminated).map(x => x.vp));
    const boost = top - p.vp >= R.comeback.gap && s.regions.find(r => r.kind === 'throne')?.owner !== p.id ? 1 + R.comeback.incomeBonus : 1;
    p.res.industry += Math.round(inc.industry * boost); p.res.credits += Math.round(inc.credits * boost); p.res.influence += inc.influence;
    const upkeep = upkeepOf(s, p.id);
    p.res.credits -= upkeep;
  }
  const supplyOf = s.players.map(p => (R.empire?.enabled !== false && !p.eliminated ? supplied(s, p.id) : null));
  for (const f of s.fleets) {
    if (f.owner === -1) continue;
    const r = s.regions[f.region];
    // supply: out of supply means no repairs, and after a grace period the crews start to suffer
    const sup = supplyOf[f.owner];
    const inSupply = !sup || sup.has(f.region);
    f.oos = inSupply ? 0 : (f.oos ?? 0) + 1;
    if (!inSupply && f.oos > R.empire.oosGraceTurns) {
      for (const sh of f.ships) sh.hp = Math.max(1, sh.hp - R.empire.oosAttrition);
      if (f.oos === R.empire.oosGraceTurns + 1) emit({ k: 'note', pulse: endPulse, owner: f.owner, text: `${f.name} is out of supply at ${r.name} and wearing down.`, region: r.id });
    }
    if (engagementAt(s, r.id) && wouldFight(s, r.id)) { f.fatigued = !!f.od && !hasLaw(s, f.owner, 'vanguard'); f.od = false; continue; } // no repairs mid-battle
    const owned = r.owner === f.owner;
    const yard = owned && ((r.buildings.shipyard ?? 0) > 0 || (r.buildings.depot ?? 0) > 0);
    const regen = hasTech(s, f.owner, 'regen') && inSupply;
    for (const sh of f.ships) {
      if (owned || regen) sh.hp = Math.min(sh.maxHp, sh.hp + R.economy.shipRepairPerTurn + (yard ? R.economy.shipyardRepairBonus : 0) + (regen ? R.empire.regenRepair : 0));
      if (yard) sh.sys = { engines: true, weapons: true, shields: true };
      else if (owned && sh.hp === sh.maxHp) {
        // field repair restores one knocked-out subsystem per turn at full hull
        const k = (['engines', 'weapons', 'shields'] as const).find(x => !sh.sys[x]);
        if (k) sh.sys[k] = true;
      }
    }
    if (s.players[f.owner].res.credits < 0) for (const sh of f.ships) sh.hp = Math.max(1, sh.hp - R.economy.bankruptAttrition);
    f.fatigued = !!f.od && !hasLaw(s, f.owner, 'vanguard');
    f.od = false;
  }
  for (const r of s.regions) {
    const underAttack = (engagementAt(s, r.id) && wouldFight(s, r.id)) || s.fleets.some(f => f.siege === r.id && f.region === r.id && f.ships.length);
    if (underAttack) { /* a garrison under siege or in battle can't rebuild */ }
    else if (r.owner !== null) {
      const o = r.owner;
      const bonus = (hasLaw(s, o, 'bastion') ? R.empire.lawRegenBonus : 0) + (hasLaw(s, o, 'martial') ? R.empire.lawRegenBonus : 0);
      r.garrison = Math.min(maxGarrison(s, r.id), r.garrison + (R.garrison.regenPerTurn + bonus) * (hasTech(s, o, 'regen') ? 2 : 1));
    } else if (r.garrison < (r.baseGarrison ?? 0)) {
      r.garrison = Math.min(r.baseGarrison, r.garrison + R.neutral.garrisonRegen);
    }
    if (r.project) {
      r.project.progress++;
      const pd = R.projects[r.project.key];
      if (r.owner !== r.project.owner) r.project = null;
      else if (r.project.progress >= pd.turns) {
        const key = r.project.key;
        if (key === 'develop') r.dev = Math.min(maxDevAt(s, r.id), r.dev + 1);
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
  const heldAllTurn = (r: { owner: PlayerId | null; id: number }) => !R.crowns.mustHoldAtTurnStart || scoreOwners[r.id] === r.owner;
  for (const p of s.players) {
    if (p.eliminated) continue;
    const owned = s.regions.filter(r => r.kind === 'crown' && r.owner === p.id);
    const crowns = owned.filter(heldAllTurn).length;
    if (crowns) addVp(s, p.id, crowns * R.victory.vpPerCrownPerTurn + (crowns >= 2 ? R.victory.crownMajorityVp : 0) + (p.relics.includes('crown_key') ? R.crowns.crownKeyFlatVp : 0), `Holding ${crowns} Crown${crowns > 1 ? 's' : ''}`);
    if (owned.length > crowns) s.chronicle.push({ turn: s.turn, players: [p.id], text: `${p.name} must hold its new Crown through a whole turn before it pays.` });
    if (hasTech(s, p.id, 'mandate')) addVp(s, p.id, 1, 'Imperial Mandate');
    if (crowns && hasTech(s, p.id, 'citadel')) addVp(s, p.id, crowns * R.empire.citadelCrownVp, 'Citadel Worlds');
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
    const winners = def ? def.check(s, { startOwners: scoreOwners }) : [];
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
  }
  if (endCycle) {

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

  if (endCycle) {
    s.scans = s.scans.filter(x => x.until > s.turn);
    s.turn++;
  }
  s.rngState = rng.state;
  const result: TurnResult = { turn: endCycle ? s.turn - 1 : s.turn, events, battles: battles.filter(b => b.rounds.length || !b.ongoing), signals: finalSignals, startFleets, startOwners };
  if (live) result.tick = s.live?.tick;
  s.last = result;
  return s;
}

// --------------------------------------------------------------------------

// Submissions come straight off the network: rebuild every order / free action
// from known fields with the right types, dropping anything malformed, so that
// nothing downstream ever sees strings, NaN, prototype keys or huge arrays.
const isId = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
const isRec = (x: unknown): x is Record<string, any> => typeof x === 'object' && x !== null && !Array.isArray(x);
const idList = (x: unknown, max: number): number[] | null =>
  Array.isArray(x) && x.length <= max && x.every(isId) ? x.slice() : null;

export function cleanOrder(s: GameState, o: unknown): Order | null {
  if (!isRec(o)) return null;
  const rid = (x: unknown): x is number => isId(x) && x < s.regions.length;
  switch (o.type) {
    case 'move': {
      const path = idList(o.path, 16);
      if (!isId(o.fleet) || !path || !path.every(rid)) return null;
      return o.overdrive ? { type: 'move', fleet: o.fleet, path, overdrive: true } : { type: 'move', fleet: o.fleet, path };
    }
    case 'seize': {
      if (!isId(o.fleet) || !rid(o.target)) return null;
      if (o.also === undefined) return { type: 'seize', fleet: o.fleet, target: o.target };
      const also = idList(o.also, 8);
      return also ? { type: 'seize', fleet: o.fleet, target: o.target, also } : null;
    }
    case 'build':
      if (!rid(o.region) || typeof o.cls !== 'string' || !Object.hasOwn(s.rules.ships, o.cls)) return null;
      if (o.fleet !== null && o.fleet !== undefined && !isId(o.fleet)) return null;
      return { type: 'build', region: o.region, cls: o.cls, fleet: isId(o.fleet) ? o.fleet : null };
    case 'develop':
      if (!rid(o.region) || typeof o.project !== 'string' || !Object.hasOwn(s.rules.projects, o.project)) return null;
      return { type: 'develop', region: o.region, project: o.project };
    case 'fortify': case 'excavate':
      return isId(o.fleet) ? { type: o.type, fleet: o.fleet } : null;
    case 'influence': case 'scan': case 'feint':
      return rid(o.target) ? { type: o.type, target: o.target } : null;
    case 'conceal': return { type: 'conceal' };
    case 'pact':
      return isId(o.with) && o.with < s.players.length ? { type: 'pact', with: o.with } : null;
    case 'law':
      return typeof o.law === 'string' && Object.hasOwn(LAW, o.law) ? { type: 'law', law: o.law } : null;
    case 'refit':
      return isId(o.fleet) ? { type: 'refit', fleet: o.fleet } : null;
  }
  return null;
}

export function cleanFree(fa: unknown): FreeAction | null {
  if (!isRec(fa)) return null;
  if (fa.type === 'research') return typeof fa.tech === 'string' && Object.hasOwn(TECH, fa.tech) ? { type: 'research', tech: fa.tech } : null;
  if (fa.type === 'revoke') return typeof fa.law === 'string' && Object.hasOwn(LAW, fa.law) ? { type: 'revoke', law: fa.law } : null;
  if (fa.type === 'blueprint') return typeof fa.cls === 'string' && typeof fa.mod === 'string' && fa.cls.length < 32 && fa.mod.length < 32 ? { type: 'blueprint', cls: fa.cls, mod: fa.mod } : null;
  if (!isId(fa.fleet)) return null;
  switch (fa.type) {
    case 'doctrine': {
      const d = fa.doctrine;   // copy known fields only; applyFree validates their values
      return isRec(d) ? { type: 'doctrine', fleet: fa.fleet, doctrine: { stance: d.stance, retreatAt: d.retreatAt, target: d.target, guard: d.guard } as Doctrine } : null;
    }
    case 'split': { const ships = idList(fa.ships, 64); return ships ? { type: 'split', fleet: fa.fleet, ships } : null; }
    case 'merge': return isId(fa.into) ? { type: 'merge', fleet: fa.fleet, into: fa.into } : null;
    case 'rename': return typeof fa.name === 'string' ? { type: 'rename', fleet: fa.fleet, name: fa.name.slice(0, 40) } : null;
  }
  return null;
}

function sanitize(s: GameState, sub: Submission | undefined, tick = false): Submission {
  // WEGO: exactly perTurn slots (slot k = pulse k). LIVE tick: a list of orders that all resolve this tick.
  const out: Submission = { orders: new Array(tick ? 0 : s.rules.orders.perTurn).fill(null), free: [] };
  if (!isRec(sub)) return out;
  const orders = Array.isArray(sub.orders) ? sub.orders : [];
  if (tick) { for (const o of orders.slice(0, 16)) { const c = cleanOrder(s, o); if (c) out.orders.push(c); } }
  else for (let i = 0; i < out.orders.length; i++) out.orders[i] = cleanOrder(s, orders[i]);
  const free = Array.isArray(sub.free) ? sub.free.slice(0, 64) : [];
  for (const fa of free) { const c = cleanFree(fa); if (c) out.free.push(c); }
  return out;
}

function applyFree(s: GameState, rng: Rng, p: PlayerId, fa: Submission['free'][number]): string | null {
  const pl = s.players[p];
  if (fa.type === 'research') {
    const b = researchBlock(s, p, fa.tech);
    if (b) return b;
    const cost = techCost(s, p, fa.tech);
    if (!canAfford(pl.res, cost, creditRate(s, p))) return 'not enough resources';
    pay(pl.res, cost, creditRate(s, p));
    (pl.techs ??= []).push(fa.tech);
    pl.researched = (pl.researched ?? 0) + 1;
    return null;
  }
  if (fa.type === 'revoke') {
    if (!pl.laws?.includes(fa.law)) return 'not enacted';
    pl.laws = pl.laws.filter(x => x !== fa.law);
    return null;
  }
  if (fa.type === 'blueprint') {
    if (!Object.hasOwn(s.rules.ships, fa.cls)) return 'unknown ship class';
    const m = MODULES.find(x => x.id === fa.mod);
    if (!m) return 'unknown module';
    if (m.tech && !hasTech(s, p, m.tech)) return `needs ${TECH[m.tech]?.name ?? m.tech}`;
    (pl.blueprint ??= {})[fa.cls] = fa.mod;
    return null;
  }
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
      if (f.commander.alive) (s.players[p].reserveCommanders ??= []).push(f.commander);
      s.fleets = s.fleets.filter(x => x !== f);
      return null;
    }
  }
  return 'unknown action';
}

export function income(s: GameState, p: PlayerId) {
  return incomeDetail(s, p).total;
}

/** Income with the reasons (for the UI breakdowns). */
export function incomeDetail(s: GameState, p: PlayerId) {
  const R = s.rules, E = R.empire, on = E?.enabled !== false;
  const out = { industry: 0, credits: 0, influence: 0 };
  const why: string[] = [];
  const conn = on ? connected(s, p) : null;
  let cut = 0;
  const pl = s.players[p];
  for (const r of s.regions) {
    if (r.owner !== p) continue;
    const y = R.economy.yields[r.kind] ?? R.economy.yields.colony;
    const mult = Math.max(1, r.dev);
    let ind = y.industry * mult + (r.buildings.mine ?? 0) * R.economy.mineBonus;
    let cr = y.credits * mult + (r.buildings.tradehub ?? 0) * (R.economy.tradeHubBonus + (on && hasTech(s, p, 'trade') ? E.tradeHubBonus : 0) + (on && hasLaw(s, p, 'mercantile') ? E.mercantileHubBonus : 0));
    let inf = y.influence * (r.kind === 'void' ? 0 : 1) + (r.kind === 'home' ? Math.floor(r.dev / 2) : 0);
    if (on) {
      if (r.trait === 'forge') ind += E.forgePerDev * mult;
      if (r.trait === 'gas') cr += E.gasCredits;
      if (r.buildings.depot) ind += E.depotIndustry;
      if (r.vein && (r.buildings.extractor ?? 0) > 0 && conn!.has(r.id)) cr += E.extractorCredits;
      if (hasLaw(s, p, 'federal') && r.kind === 'colony') { ind += 1; if (r.dev >= 3) inf += 1; }
      if (r.id === pl.capital && hasLaw(s, p, 'central')) { ind *= E.centralMult; cr *= E.centralMult; inf *= E.centralMult; }
      if (!conn!.has(r.id)) { ind *= E.cutOffYield; cr *= E.cutOffYield; inf *= E.cutOffYield; cut++; }
    }
    out.industry += ind; out.credits += cr; out.influence += inf;
  }
  if (cut) why.push(`${cut} region${cut === 1 ? '' : 's'} cut off from your capital (half yield)`);
  if (pl.relics.includes('well')) out.credits += 6;
  if (on) {
    if (hasTech(s, p, 'trade')) {
      const pacts = s.pacts.filter(x => x.until >= s.turn && (x.a === p || x.b === p)).length;
      if (pacts) { out.credits += pacts * E.pactCredits; why.push(`+${pacts * E.pactCredits}¢ from pacts (Trade Compacts)`); }
    }
    if (hasLaw(s, p, 'mercantile')) out.credits *= E.mercantileMult;
    if (hasTech(s, p, 'markets')) out.credits *= E.marketsCreditsMult;
    if (hasLaw(s, p, 'industrial')) { out.industry *= E.industrialMult; out.credits *= E.industrialCreditMult; }
    if (hasLaw(s, p, 'open')) out.influence += E.openInfluence;
    if (hasTech(s, p, 'bureaucracy')) out.influence += 2;
    if (hasLaw(s, p, 'martial')) out.influence += E.martialInfluence;
  }
  const total = { industry: Math.round(out.industry), credits: Math.round(out.credits), influence: Math.max(0, Math.round(out.influence)) };
  return { total, why };
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
  if (from !== null && (r.buildings.academy ?? 0) > 0 && s.rules.empire?.enabled !== false) {
    // seized archives: steal one technology the victim has and you could have (never a ★)
    const mine = s.players[by].techs ?? [];
    const pool = (s.players[from].techs ?? []).filter(t => !mine.includes(t) && TECH[t].tier < 4 && (() => { const b = researchBlock(s, by, t); return !b || b.startsWith('one technology'); })());
    if (pool.length) {
      const t = pool.sort()[s.turn % pool.length];
      (s.players[by].techs ??= []).push(t);
      emit({ k: 'tech', pulse, owner: by, tech: t, stolen: true });
      s.chronicle.push({ turn: s.turn, region: rid, players: [by, from], text: `${s.players[by].name} seizes the archives of ${r.name} and steals ${TECH[t].name} from ${s.players[from].name}.` });
    }
  }
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

/** Credits cover missing industry at the rules' rate, or 1:1 with Free Markets. */
export function creditRate(s: GameState, p: PlayerId) {
  return hasTech(s, p, 'markets') ? { economy: { creditsPerIndustry: 1 } } : s.rules;
}

/** Credits a player pays for their ships each turn. */
export function upkeepOf(s: GameState, p: PlayerId): number {
  const raw = s.fleets.filter(f => f.owner === p).reduce((a, f) => a + f.ships.reduce((b, sh) => b + (s.rules.ships[sh.cls]?.upkeep ?? 0), 0), 0);
  return hasTech(s, p, 'depots') ? Math.round(raw * (1 - s.rules.empire.depotUpkeepCut)) : raw;
}
