// ============================================================================
//  LIVE MODE (Neptune's Pride-style real time, but very slow)
//
//  The world advances one tick at a time on a real-time clock. Each tick is one
//  pulse of the normal resolver (movement, sieges, combat, captures, builds).
//  Every `ticksPerCycle` ticks a cycle ends: income, upkeep, scoring, edicts —
//  exactly what ends a WEGO turn.
//
//  Orders are earned over time (one every `orderEveryHours`, banked up to
//  `bankCap`). Spending one queues it; it executes at the next tick. Moves can
//  target any distance — fleets then travel in real time.
//
//  Everything here is pure and deterministic given the same sequence of calls,
//  so the server (authoritative) and the browser (solo games) share it.
// ============================================================================
import { resolveTurn, creditRate } from './resolve.ts';
import { fleetSpeed } from './graph.ts';
import { planTurn } from './ai.ts';
import { validateOrder, ORDER_INFO, orderCost, canAfford, pay } from './orders.ts';
import { researchBlock, techCost, opposite, blueprintFor, baseHp, hasTech, gateNeighbors } from './empire.ts';
import { MODULE } from '../config/empire.ts';
import type { FreeAction, GameState, LiveState, Order, PlayerId, Ship, TurnResult } from './types.ts';

export const LIVE_SPEEDS: Record<string, { label: string; mult: number; desc: string }> = {
  normal: { label: 'Normal', mult: 1, desc: 'A tick every 30 min, an order every 4 h. Plays out over days.' },
  fast: { label: 'Fast', mult: 60, desc: 'A tick every 30 s, an order every 4 min. Try it out in an evening.' },
  blitz: { label: 'Blitz', mult: 360, desc: 'A tick every 5 s. For testing.' },
};

// Degenerate (tweaked) rules must never stall the clock or divide by zero: a zero, negative or
// non-finite interval would make advanceTo burn its whole tick budget on every call.
const speedOf = (s: GameState) => (s.live && s.live.speed > 0 && Number.isFinite(s.live.speed) ? s.live.speed : 1);
export const tickMs = (s: GameState) => Math.max(50, (s.rules.live.tickMinutes * 60_000) / speedOf(s)) || 1_800_000;
export const orderMs = (s: GameState) => Math.max(50, (s.rules.live.orderEveryHours * 3_600_000) / speedOf(s)) || 14_400_000;
/** Ticks per cycle (at least 1: `tick % 0` is NaN and would never end a cycle). */
export const ticksPerCycle = (s: GameState) => Math.max(1, Math.floor(s.rules.live.ticksPerCycle) || 1);
export const nextTickAt = (s: GameState) => (s.live ? s.live.startedAt + (s.live.tick + 1) * tickMs(s) : 0);
export const tickInCycle = (s: GameState) => (s.live ? s.live.tick % ticksPerCycle(s) : 0);

/** Turn a freshly created game into a LIVE game starting at `now`. */
export function makeLive(s: GameState, now: number, speed = 1): GameState {
  s.mode = 'live';
  const L: LiveState = {
    speed, startedAt: now, tick: 0,
    bank: s.players.map(() => s.rules.live.startOrders),
    nextOrderAt: s.players.map(() => 0),
    queue: {}, free: {},
  };
  s.live = L;
  for (const p of s.players) L.nextOrderAt[p.id] = now + orderMs(s);
  return s;
}

/**
 * Earn orders up to `now` (capped bank: orders earned while full are lost — spend them!).
 * Computed in one step, so a long absence can't leave `nextOrderAt` lagging in the past
 * (which used to pay out a burst of "back pay" orders on the following calls).
 */
export function accrue(s: GameState, now: number) {
  const L = s.live!;
  const every = orderMs(s);
  const cap = s.rules.live.bankCap;
  for (const p of s.players) {
    const next = L.nextOrderAt[p.id];
    if (!(now >= next)) continue;
    const n = Math.floor((now - next) / every) + 1;
    if (L.bank[p.id] < cap) L.bank[p.id] = Math.min(cap, L.bank[p.id] + n);
    L.nextOrderAt[p.id] = next + n * every;
  }
}

const placeholderShip = (cls: string, turn: number): Ship => ({
  id: -1, name: '', cls, hp: 1, maxHp: 1, sys: { engines: true, weapons: true, shields: true }, kills: 0, battles: 0, title: null, bornTurn: turn,
});

/**
 * Project the state as if this player's queued free actions and orders had already resolved at the
 * next tick (for validating the next one): free actions first (research, revokes, blueprints, merges
 * and splits apply before any order, as in the resolver), then each queued order's cost and effect
 * (laws enacted, projects started, relics dug, ships built, fleets refitted, per-fleet order counts).
 * If the next tick opens a new cycle, the per-cycle counters it resets start from zero.
 */
function projected(s: GameState, pid: PlayerId, withOrders = true): GameState {
  const L = s.live!;
  const fresh = tickInCycle(s) === 0;
  const p: GameState = {
    ...s,
    last: null,   // "resolving": per-turn counters are read raw (see researchedThisTurn)
    players: s.players.map(pl => pl.id !== pid ? pl : {
      ...pl, res: { ...pl.res }, techs: [...(pl.techs ?? [])], laws: [...(pl.laws ?? [])], blueprint: { ...(pl.blueprint ?? {}) },
      pactOffers: fresh ? [] : [...(pl.pactOffers ?? [])], researched: fresh ? 0 : pl.researched ?? 0,
    }),
    fleets: s.fleets.map(f => ({ ...f, ships: f.ships.map(sh => ({ ...sh })), ordersThisTurn: fresh ? 0 : f.ordersThisTurn })),
    regions: s.regions.map(r => ({ ...r })),
    concealed: fresh ? [] : [...(s.concealed ?? [])],
    turnStats: { ...s.turnStats, influenced: fresh ? [] : [...(s.turnStats?.influenced ?? [])] },
  };
  const me = p.players[pid];
  let fake = -1_000_000;
  for (const fa of L.free[pid] ?? []) {
    switch (fa.type) {
      case 'research': {
        if (researchBlock(p, pid, fa.tech)) break;
        const c = techCost(p, pid, fa.tech);
        if (!canAfford(me.res, c, creditRate(p, pid))) break;
        pay(me.res, c, creditRate(p, pid));
        me.techs!.push(fa.tech);
        me.researched = (me.researched ?? 0) + 1;
        break;
      }
      case 'revoke': me.laws = me.laws!.filter(x => x !== fa.law); break;
      case 'blueprint': {
        const m = Object.hasOwn(MODULE, fa.mod) ? MODULE[fa.mod] : undefined;
        if (Object.hasOwn(p.rules.ships, fa.cls) && m && (!m.tech || hasTech(p, pid, m.tech))) me.blueprint![fa.cls] = fa.mod;
        break;
      }
      case 'merge': {
        const f = p.fleets.find(x => x.id === fa.fleet && x.owner === pid);
        const into = p.fleets.find(x => x.id === fa.into && x.owner === pid);
        if (!f || !into || f === into || f.region !== into.region || into.ships.length + f.ships.length > p.rules.maxShipsPerFleet) break;
        into.ships.push(...f.ships);
        p.fleets = p.fleets.filter(x => x !== f);
        break;
      }
      case 'split': {
        const f = p.fleets.find(x => x.id === fa.fleet && x.owner === pid);
        if (!f) break;
        const ids = new Set(fa.ships);
        const moving = f.ships.filter(x => ids.has(x.id));
        if (!moving.length || moving.length === f.ships.length) break;
        f.ships = f.ships.filter(x => !ids.has(x.id));
        p.fleets.push({ ...f, id: fake--, ships: moving, route: null, siege: null, ordersThisTurn: 0, bornTurn: p.turn });
        break;
      }
    }
  }
  if (!withOrders) return p;
  for (const o of L.queue[pid] ?? []) applyQueued(p, pid, o, () => fake--);
  return p;
}

/** The per-fleet order count (and repeat-order credits) an order uses, exactly as the resolver charges it. */
function countFleetOrder(p: GameState, pid: PlayerId, o: Order) {
  if (!('fleet' in o) || o.type === 'build') return;
  const f = p.fleets.find(x => x.id === o.fleet);
  if (!f || f.owner !== pid) return;
  if (f.ordersThisTurn > 0) p.players[pid].res.credits -= p.rules.orders.repeatFleetCredits;
  f.ordersThisTurn++;
}

function applyQueued(p: GameState, pid: PlayerId, o: Order, nextFakeId: () => number) {
  countFleetOrder(p, pid, o);
  if (validateOrder(p, pid, o)) return;
  const me = p.players[pid];
  const cost = orderCost(p, o, pid);
  if (!canAfford(me.res, cost, creditRate(p, pid))) return;
  pay(me.res, cost, creditRate(p, pid));
  switch (o.type) {
    case 'law': { const opp = opposite(o.law); me.laws = [...(me.laws ?? []).filter(x => x !== opp), o.law]; break; }
    case 'develop': p.regions[o.region] = { ...p.regions[o.region], project: { key: o.project, progress: 0, owner: pid } }; break;
    case 'excavate': { const f = p.fleets.find(x => x.id === o.fleet); if (f) p.regions[f.region] = { ...p.regions[f.region], relic: null }; break; }
    case 'build': {
      const sh = placeholderShip(o.cls, p.turn);
      const f = o.fleet !== null ? p.fleets.find(x => x.id === o.fleet) : undefined;
      if (f) f.ships.push(sh);
      else p.fleets.push({ ...p.fleets.find(x => x.owner === pid)!, id: nextFakeId(), owner: pid, region: o.region, ships: [sh], route: null, siege: null, ordersThisTurn: 0, bornTurn: p.turn });
      break;
    }
    case 'refit': {
      const f = p.fleets.find(x => x.id === o.fleet);
      if (f) for (const sh of f.ships) { sh.mod = blueprintFor(p, pid, sh.cls); sh.maxHp = sh.hp = baseHp(p, sh.cls, sh.mod); }
      break;
    }
    case 'influence': (p.turnStats.influenced ??= []).push(`${pid}:${o.target}`); break;
    case 'conceal': (p.concealed ??= []).push(pid); break;
    case 'pact': me.pactOffers.push(o.with); break;
  }
}

/** Spend an order now. Returns an error string, or null if it was queued for the next tick. */
export function queueOrder(s: GameState, pid: PlayerId, o: Order, now: number): string | null {
  const L = s.live;
  if (!L) return 'not a live game';
  if (s.winner !== null) return 'the game is over';
  if (!s.players[pid] || s.players[pid].eliminated) return 'you have been eliminated';
  accrue(s, now);
  if (L.bank[pid] < 1) return 'no orders banked yet';
  const q = (L.queue[pid] ??= []);
  if (q.length >= 8) return 'too many orders waiting for this tick';
  const isMovement = (x: Order) => x.type === 'move' || x.type === 'seize';
  if (isMovement(o) && q.some(x => isMovement(x) && 'fleet' in x && x.fleet === (o as { fleet: number }).fleet))
    return 'that fleet already has a movement order this tick';
  const proj = projected(s, pid);
  // count this order too, exactly as the resolver will when it runs
  countFleetOrder(proj, pid, o);
  const err = validateOrder(proj, pid, o);
  if (err) return err;
  // checks the resolver makes later, which would otherwise burn a banked order on a certain failure
  const me = proj.players[pid];
  if (o.type === 'influence' && s.rules.influenceLimits.onePerTargetPerTurn && proj.turnStats.influenced?.includes(`${pid}:${o.target}`))
    return 'already influenced there this cycle';
  if (o.type === 'pact' && me.pactOffers.includes(o.with)) return 'pact already offered this cycle';
  if (o.type === 'conceal' && proj.concealed?.includes(pid)) return 'already concealed this cycle';
  if (!canAfford(me.res, orderCost(proj, o, pid), creditRate(proj, pid)))
    return q.length || (L.free[pid] ?? []).length ? 'not enough resources (after what is already queued)' : 'not enough resources';
  q.push(o);
  L.bank[pid]--;
  return null;
}

/** Take back a queued order before its tick (refunds it). */
export function cancelQueued(s: GameState, pid: PlayerId, index: number): boolean {
  const q = s.live?.queue[pid];
  if (s.winner !== null || !q || !Number.isInteger(index) || index < 0 || index >= q.length) return false;
  q.splice(index, 1);
  s.live!.bank[pid] = Math.min(s.rules.live.bankCap, s.live!.bank[pid] + 1);
  return true;
}

/**
 * Free actions (doctrine, split, merge, rename, research, blueprint, revoke) apply at the next tick
 * and cost no order. Returns an error string, or null if it was queued. Re-issuing a doctrine, rename
 * or blueprint replaces the earlier one; research and revokes are checked against what is queued.
 */
export function queueFree(s: GameState, pid: PlayerId, fa: FreeAction): string | null {
  const L = s.live;
  if (!L) return 'not a live game';
  if (s.winner !== null) return 'the game is over';
  if (!s.players[pid] || s.players[pid].eliminated) return 'you have been eliminated';
  const list = (L.free[pid] ??= []);
  const same = (x: FreeAction) =>
    x.type === fa.type && (
      fa.type === 'doctrine' || fa.type === 'rename' ? (x as { fleet: number }).fleet === fa.fleet
      : fa.type === 'blueprint' ? (x as { cls: string }).cls === fa.cls
      : false);
  const i = list.findIndex(same);
  if (i >= 0) list.splice(i, 1);
  switch (fa.type) {
    case 'research': {
      if (list.some(x => x.type === 'research' && x.tech === fa.tech)) return 'already queued';
      // checked against everything queued: research is paid before orders, so it must not starve them
      const proj = projected(s, pid);
      const b = researchBlock(proj, pid, fa.tech);
      if (b) return b;
      if (!canAfford(proj.players[pid].res, techCost(proj, pid, fa.tech), creditRate(proj, pid)))
        return list.length || (L.queue[pid] ?? []).length ? 'not enough resources (after what is already queued)' : 'not enough resources';
      break;
    }
    case 'revoke':
      if (list.some(x => x.type === 'revoke' && x.law === fa.law)) return 'already queued';
      if (!projected(s, pid, false).players[pid].laws?.includes(fa.law)) return 'not enacted';
      break;
    case 'merge': {
      const f = s.fleets.find(x => x.id === fa.fleet && x.owner === pid);
      if (!f) return 'no such fleet of yours';
      // the merge happens before orders at the tick, so anything queued for the merged fleet would fail
      if ((L.queue[pid] ?? []).some(o => 'fleet' in o && o.type !== 'build' && o.fleet === fa.fleet)) return 'that fleet has orders waiting for this tick; take them back first';
      break;
    }
  }
  if (list.length >= 32) return 'too many changes waiting for this tick';
  list.push(fa);
  return null;
}

/** Cancel a fleet's journey (free): it stops where it is. */
export function haltOrder(s: GameState, pid: PlayerId, fleet: number): string | null {
  if (s.winner !== null) return 'the game is over';
  const f = s.fleets.find(x => x.id === fleet && x.owner === pid);
  if (!f) return 'not your fleet';
  if (!f.route) return 'not travelling';
  f.route = null;
  return null;
}

/**
 * A route must continue from where its fleet now stands. A fleet thrown off its path (a retreat,
 * a guard reaction) would otherwise "step" from its new region to a non-adjacent one next tick.
 */
function dropBrokenRoutes(s: GameState) {
  for (const f of s.fleets) {
    const rt = f.route;
    if (!rt) continue;
    if (rt.path.length ? !gateNeighbors(s, f.owner, f.region).includes(rt.path[0]) : rt.seize !== null && rt.seize !== f.region) f.route = null;
  }
}

/** Resolve exactly one tick (AI seats spend their orders first). Never mutates `s0`. */
export function runTick(s0: GameState, isAI: (pid: PlayerId) => boolean): GameState {
  // work on a private copy of the clock/bank/queues: if the resolver throws, the caller's state is untouched
  const s1: GameState = { ...s0, live: structuredClone(s0.live!) };
  const L = s1.live!;
  const tickTime = L.startedAt + (L.tick + 1) * tickMs(s1);
  accrue(s1, tickTime);
  // AI seats: spend a banked order on their best idea
  for (const p of s1.players) {
    if (!isAI(p.id) || p.eliminated || s1.winner !== null || L.bank[p.id] < 1) continue;
    const plan = planTurn(s1, p.id);
    const fleetOf = (o: Order) => ('fleet' in o && o.type !== 'build' ? s1.fleets.find(f => f.id === o.fleet) : undefined);
    // skip orders that would only redo what a fleet is already doing (re-routing to the same place, re-besieging)
    // (and orders this seat already queued, e.g. by its human before a steward took over)
    const queued = (L.queue[p.id] ?? []);
    const busy = new Set(queued.flatMap(q => ('fleet' in q && q.type !== 'build' ? [q.fleet] : [])));
    const opts = plan.orders.filter((o): o is Order => {
      if (!o) return false;
      if (queued.some(q => JSON.stringify(q) === JSON.stringify(o))) return false;
      const f = fleetOf(o);
      if (f && busy.has(f.id)) return false;
      if (o.type === 'move') return !f?.route;
      if (o.type === 'seize') return !(f?.route?.seize === o.target || (f?.siege === o.target && f.region === o.target));
      return true;
    });
    if (opts.length) {
      // the plan's first order is its best; every few ticks prefer a later one so laws/projects get their turn too.
      // If the preferred one can't be queued (now invalid or unaffordable), fall back to the others in order.
      const pref = L.tick % 3 === 2 ? Math.min(opts.length - 1, 1 + ((L.tick / 3) | 0) % Math.max(1, opts.length - 1)) : 0;
      for (const o of [opts[pref], ...opts.filter((_, i) => i !== pref)]) if (queueOrder(s1, p.id, o, tickTime) === null) break;
    }
    for (const fa of plan.free) if (fa.type === 'doctrine' || fa.type === 'research' || fa.type === 'blueprint') queueFree(s1, p.id, fa);
  }
  const ticks = ticksPerCycle(s1);
  const t = L.tick;
  const subs: Record<number, { orders: Order[]; free: FreeAction[] }> = {};
  for (const p of s1.players) subs[p.id] = { orders: L.queue[p.id] ?? [], free: L.free[p.id] ?? [] };
  const s = resolveTurn(s1, subs as never, { pulse: (t % ticks) + 1, newCycle: t % ticks === 0, endCycle: (t + 1) % ticks === 0 });
  s.live!.queue = {};
  s.live!.free = {};
  s.live!.tick = t + 1;
  if (s.last) s.last.tick = t + 1;
  dropBrokenRoutes(s);
  return s;
}

/**
 * Run every tick that has fallen due by `now` (at most `maxTicks`). Returns the new state and each
 * tick's result. If a tick throws, the ticks before it are kept and the error is returned (the
 * failed tick can be retried later); the input state is never left half-resolved.
 */
export function advanceTo(s: GameState, now: number, isAI: (pid: PlayerId) => boolean, maxTicks = 500): { state: GameState; results: TurnResult[]; error?: unknown } {
  const results: TurnResult[] = [];
  let st = s;
  if (!st.live) return { state: st, results };
  accrue(st, Math.min(now, nextTickAt(st)));
  let n = 0;
  while (st.winner === null && now >= nextTickAt(st) && n < maxTicks) {
    try { st = runTick(st, isAI); } catch (error) { return { state: st, results, error }; }
    n++;
    if (st.last) results.push(st.last);
  }
  // never accrue past the world clock: if the tick budget ran out, the remaining ticks must see the
  // same banks they would have in one uninterrupted catch-up (AI seats spend at tick time)
  if (st.live) accrue(st, Math.min(now, nextTickAt(st)));
  return { state: st, results };
}

/** Describe an order for the queue list. */
export function queuedText(s: GameState, o: Order): string {
  return `${ORDER_INFO[o.type].icon} ${ORDER_INFO[o.type].name}`;
}

/** Ticks until a travelling fleet arrives (approximate; ignores blocking). */
export function etaTicks(s: GameState, fleetId: number): number | null {
  const f = s.fleets.find(x => x.id === fleetId);
  if (!f?.route || !f.route.path.length) return null;
  const sp = Math.max(1, fleetSpeed(s, f)) + (f.route.overdrive ? s.rules.overdrive.speedBonus : 0);
  const need = f.route.path.length * s.rules.live.stepCost - f.route.mp;
  return Math.max(1, Math.ceil(need / sp));
}
