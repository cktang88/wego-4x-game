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
import { resolveTurn } from './resolve.ts';
import { planTurn } from './ai.ts';
import { validateOrder, ORDER_INFO } from './orders.ts';
import type { FreeAction, GameState, LiveState, Order, PlayerId, TurnResult } from './types.ts';

export const LIVE_SPEEDS: Record<string, { label: string; mult: number; desc: string }> = {
  normal: { label: 'Normal', mult: 1, desc: 'A tick every 30 min, an order every 4 h. Plays out over days.' },
  fast: { label: 'Fast', mult: 60, desc: 'A tick every 30 s, an order every 4 min. Try it out in an evening.' },
  blitz: { label: 'Blitz', mult: 360, desc: 'A tick every 5 s. For testing.' },
};

export const tickMs = (s: GameState) => (s.rules.live.tickMinutes * 60_000) / (s.live?.speed ?? 1);
export const orderMs = (s: GameState) => (s.rules.live.orderEveryHours * 3_600_000) / (s.live?.speed ?? 1);
export const nextTickAt = (s: GameState) => (s.live ? s.live.startedAt + (s.live.tick + 1) * tickMs(s) : 0);
export const tickInCycle = (s: GameState) => (s.live ? s.live.tick % s.rules.live.ticksPerCycle : 0);

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

/** Earn orders up to `now` (capped bank: orders earned while full are lost — spend them!). */
export function accrue(s: GameState, now: number) {
  const L = s.live!;
  const every = orderMs(s);
  for (const p of s.players) {
    let guard = 0;
    while (now >= L.nextOrderAt[p.id] && guard++ < 1000) {
      if (L.bank[p.id] < s.rules.live.bankCap) L.bank[p.id]++;
      L.nextOrderAt[p.id] += every;
    }
  }
}

/** Project the state as if this player's queued orders had already resolved (for validating the next one). */
function projected(s: GameState, pid: PlayerId): GameState {
  const q = s.live?.queue[pid] ?? [];
  const p: GameState = { ...s, fleets: s.fleets.map(f => ({ ...f })) };
  for (const o of q) if ('fleet' in o && o.type !== 'build') { const f = p.fleets.find(x => x.id === o.fleet); if (f) f.ordersThisTurn++; }
  return p;
}

/** Spend an order now. Returns an error string, or null if it was queued for the next tick. */
export function queueOrder(s: GameState, pid: PlayerId, o: Order, now: number): string | null {
  const L = s.live;
  if (!L) return 'not a live game';
  if (s.winner !== null) return 'the game is over';
  if (s.players[pid]?.eliminated) return 'you have been eliminated';
  accrue(s, now);
  if (L.bank[pid] < 1) return 'no orders banked yet';
  const proj = projected(s, pid);
  // count this order too, exactly as the resolver will when it runs
  if ('fleet' in o && o.type !== 'build') { const f = proj.fleets.find(x => x.id === o.fleet); if (f) f.ordersThisTurn++; }
  const err = validateOrder(proj, pid, o);
  if (err) return err;
  const q = (L.queue[pid] ??= []);
  if (q.length >= 8) return 'too many orders waiting for this tick';
  if (q.some(x => 'fleet' in x && 'fleet' in o && x.type !== 'build' && o.type !== 'build' && x.fleet === o.fleet && (x.type === 'move' || x.type === 'seize') && (o.type === 'move' || o.type === 'seize')))
    return 'that fleet already has a movement order this tick';
  q.push(o);
  L.bank[pid]--;
  return null;
}

/** Take back a queued order before its tick (refunds it). */
export function cancelQueued(s: GameState, pid: PlayerId, index: number): boolean {
  const q = s.live?.queue[pid];
  if (!q || index < 0 || index >= q.length) return false;
  q.splice(index, 1);
  s.live!.bank[pid] = Math.min(s.rules.live.bankCap, s.live!.bank[pid] + 1);
  return true;
}

/** Free actions (doctrine, split, merge, rename) apply at the next tick and cost nothing. */
export function queueFree(s: GameState, pid: PlayerId, fa: FreeAction) {
  const L = s.live!;
  const list = (L.free[pid] ??= []);
  if (fa.type === 'doctrine' || fa.type === 'rename') {
    const i = list.findIndex(x => x.type === fa.type && x.fleet === fa.fleet);
    if (i >= 0) list.splice(i, 1);
  }
  if (list.length < 32) list.push(fa);
}

/** Cancel a fleet's journey (free): it stops where it is at the next tick. */
export function haltOrder(s: GameState, pid: PlayerId, fleet: number): string | null {
  const f = s.fleets.find(x => x.id === fleet && x.owner === pid);
  if (!f) return 'not your fleet';
  if (!f.route) return 'not travelling';
  f.route = null;
  return null;
}

/** Resolve exactly one tick (AI seats spend their orders first). */
export function runTick(s0: GameState, isAI: (pid: PlayerId) => boolean): GameState {
  const L0 = s0.live!;
  const tickTime = L0.startedAt + (L0.tick + 1) * tickMs(s0);
  accrue(s0, tickTime);
  // AI seats: spend a banked order on their best idea
  for (const p of s0.players) {
    if (!isAI(p.id) || p.eliminated || s0.winner !== null || L0.bank[p.id] < 1) continue;
    const plan = planTurn(s0, p.id);
    const best = plan.orders.find(o => o && !(o.type === 'move' && s0.fleets.find(f => f.id === o.fleet)?.route));
    if (best) queueOrder(s0, p.id, best, tickTime);
    for (const fa of plan.free) if (fa.type === 'doctrine') queueFree(s0, p.id, fa);
  }
  const ticks = s0.rules.live.ticksPerCycle;
  const t = L0.tick;
  const subs: Record<number, { orders: Order[]; free: FreeAction[] }> = {};
  for (const p of s0.players) subs[p.id] = { orders: L0.queue[p.id] ?? [], free: L0.free[p.id] ?? [] };
  const live = structuredClone(L0);
  const s = resolveTurn({ ...s0, live }, subs as any, { pulse: (t % ticks) + 1, newCycle: t % ticks === 0, endCycle: (t + 1) % ticks === 0 });
  s.live = live;
  s.live.queue = {};
  s.live.free = {};
  s.live.tick = t + 1;
  if (s.last) s.last.tick = t + 1;
  return s;
}

/** Run every tick that has fallen due by `now` (capped). Returns the new state and each tick's result. */
export function advanceTo(s: GameState, now: number, isAI: (pid: PlayerId) => boolean, maxTicks = 500): { state: GameState; results: TurnResult[] } {
  const results: TurnResult[] = [];
  let st = s;
  if (!st.live) return { state: st, results };
  accrue(st, Math.min(now, nextTickAt(st)));
  let n = 0;
  while (st.winner === null && now >= nextTickAt(st) && n++ < maxTicks) {
    st = runTick(st, isAI);
    if (st.last) results.push(st.last);
  }
  if (st.live) accrue(st, now);
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
  const sp = Math.max(1, Math.min(...f.ships.map(x => (x.sys.engines ? s.rules.ships[x.cls]?.speed ?? 1 : 1)))) + (f.route.overdrive ? s.rules.overdrive.speedBonus : 0);
  const need = f.route.path.length * s.rules.live.stepCost - f.route.mp;
  return Math.max(1, Math.ceil(need / sp));
}
