// "The target picks the verb" (docs/UX-V2.md §3): what dropping a fleet (or some of its ships) on a
// region would do, with the live preview text, the arrow colour and the order / free actions to commit.
// Every validity decision goes through the GameScreen's own validators (validateAt / orderWhy), so the
// drag preview, the highlights and the committed order can never disagree.
import type { FreeAction, Order } from '../../../shared/sim/types.ts';
import { fleetPower, fleetSpeed } from '../../../shared/sim/graph.ts';
import { MAX_JOINERS, orderCost, costText } from '../../../shared/sim/orders.ts';
import { gateNeighbors } from '../../../shared/sim/empire.ts';
import { tickMs } from '../../../shared/sim/live.ts';
import type { GameScreen } from '../game.ts';
import { fmtDur, shortWhy } from './util.ts';
import { toast } from '../ui/dom.ts';

export type Verb = 'move' | 'overdrive' | 'seize' | 'join' | 'merge' | 'split' | 'invalid';
export interface DragSrc { fleet: number; ships?: number[] }
export interface Intent {
  verb: Verb;
  ok: boolean;
  /** preview card: big glyph + a few words / numbers */
  icon: string;
  text: string;
  /** a second, smaller line (cost, warning), or '' */
  sub: string;
  color: string;
  from: number;
  to: number;
  /** regions after `from`, for the arrow */
  path: number[];
  order?: Order;
  free?: FreeAction[];
  join?: { slot: number; fleet: number };
  merge?: { fleet: number; into: number };
  odds?: number;
  /** valid, but every slot is taken: the commit asks which order to replace */
  full?: boolean;
  /** replaces the fleet's own move / seize in this slot (WEGO) or queue index (LIVE) */
  replace?: number;
}

export const VERB_COLOR: Record<Verb, string> = {
  move: '#6dffb0', overdrive: '#ffb84d', seize: '#ff5d7a', join: '#ff9db0', merge: '#8fd3ff', split: '#8fd3ff', invalid: '#8a83a8',
};

/** Movement adjacency: hyperlane links (when the map has them) plus your warp gates. */
export function moveNbrs(g: GameScreen, c: number): number[] {
  const st = g.st, r = st.regions[c] as (typeof st.regions)[number] & { links?: number[] };
  if (!r) return [];
  const base = r.links ?? r.neighbors;
  const gates = gateNeighbors(st, g.you ?? -2, c).filter(n => !r.neighbors.includes(n));
  return gates.length ? [...base, ...gates] : base;
}
/** A lane waypoint (deep-space dot): never a drop target, only a place on a path. */
export const isLane = (g: GameScreen, rid: number) => (g.st.regions[rid]?.kind as string) === 'lane';

/** BFS over your gate-aware graph that doesn't route *through* regions that would stop you. */
export function routeTo(g: GameScreen, from: number, to: number): number[] | null {
  const prev = new Map<number, number>([[from, -1]]);
  const q = [from];
  while (q.length) {
    const c = q.shift()!;
    if (c === to) break;
    if (c !== from && g.stopsAt(c)) continue;
    for (const n of moveNbrs(g, c)) if (!prev.has(n)) { prev.set(n, c); q.push(n); }
  }
  if (!prev.has(to)) {
    // fall back to the plain shortest path (it will be stopped on the way; the card says so)
    const p2 = new Map<number, number>([[from, -1]]);
    const q2 = [from];
    while (q2.length) { const c = q2.shift()!; if (c === to) break; for (const n of moveNbrs(g, c)) if (!p2.has(n)) { p2.set(n, c); q2.push(n); } }
    if (!p2.has(to)) return null;
    const out: number[] = [];
    for (let c = to; c !== from; c = p2.get(c)!) out.unshift(c);
    return out;
  }
  const out: number[] = [];
  for (let c = to; c !== from; c = prev.get(c)!) out.unshift(c);
  return out;
}

/** The slot the next order would go into (or, all full, past the end: positions after the whole plan). */
function slotK(g: GameScreen): number { return g.live ? 0 : g.nextSlot() ?? g.plan.orders.length; }

function bad(from: number, to: number, text: string, path: number[] = []): Intent {
  return { verb: 'invalid', ok: false, icon: '⊘', text, sub: '', color: VERB_COLOR.invalid, from, to, path };
}

/** Garrison + visible hostile power in a region, as "20⛨" / "20⛨+31⚔" / "?⛨". */
function defenceText(g: GameScreen, rid: number): string {
  const st = g.st, r = st.regions[rid];
  const foes = st.fleets.filter(f => f.region === rid && f.owner !== g.you && f.ships.length);
  const fp = foes.reduce((a, f) => a + fleetPower(st, f), 0);
  const gar = r.owner === g.you ? 0 : r.garrison;
  return `${gar < 0 ? '?' : gar}⛨${fp ? `+${fp}⚔` : ''}`;
}

/**
 * What would dropping `src` on region `rid` do? `over` is an own fleet token under the pointer (merge).
 * `force` restricts the verb (M / S keys). Returns null when the drop means nothing (back where it started).
 */
export function intentFor(g: GameScreen, src: DragSrc, rid: number | null, over: number | null = null, force: 'move' | 'seize' | null = null): Intent | null {
  const st = g.st, me = g.you;
  const f = g.fleet(src.fleet);
  if (!f || me === null || f.owner !== me || rid === null || !st.regions[rid] || isLane(g, rid)) return null;
  const k = slotK(g);
  // one-step turns: every order starts from where the fleet is now
  const from = f.region;
  const subset = src.ships && src.ships.length && src.ships.length < f.ships.length ? src.ships.filter(id => f.ships.some(s => s.id === id)) : null;
  const block = g.planBlock();
  if (block) return bad(from, rid, shortWhy(block));
  const max = st.rules.maxShipsPerFleet;
  const R = st.regions[rid];

  // ---- merge: dropped on another own fleet sitting in the same region
  if (over !== null && over !== f.id && !subset) {
    const o = g.fleet(over);
    if (o && o.owner === me && o.region === f.region) {
      const tot = o.ships.length + f.ships.length;
      if (tot > max) return bad(from, rid, `${tot}/${max} ships`);
      if (g.fleetUses(f.id) > 0) return bad(from, rid, 'has orders');
      return { verb: 'merge', ok: true, icon: '+', text: `${tot}/${max} ships`, sub: 'free', color: VERB_COLOR.merge, from, to: rid, path: [], merge: { fleet: f.id, into: o.id } };
    }
  }
  // splitting a subset off: the REST stays behind as a new squadron, this fleet (now just the subset) acts
  const restIds = subset ? f.ships.filter(s => !subset.includes(s.id)).map(s => s.id) : [];
  const splitFree: FreeAction[] = subset ? [{ type: 'split', fleet: f.id, ships: restIds }] : [];
  const needsWhole = () => subset && g.fleetUses(f.id) > 0 ? bad(from, rid, 'has orders') : null;

  // ---- back on its own region
  if (rid === from) {
    if (subset && force === null) {
      if (from !== f.region) return bad(from, rid, 'not there yet');
      return { verb: 'split', ok: true, icon: '✂', text: `split ${subset.length}`, sub: 'free', color: VERB_COLOR.split, from, to: rid, path: [], free: [{ type: 'split', fleet: f.id, ships: subset }] };
    }
    const seizable = R.owner !== me && !(R.kind === 'void' && R.owner === null);
    if (!seizable || force === 'move') return null;
  }

  // ---- join a seize you already planned on this region (WEGO: the order's `also`)
  if (!g.live && force !== 'move') {
    const slot = g.plan.orders.findIndex(o => o?.type === 'seize' && o.target === rid && o.fleet !== f.id);
    if (slot >= 0) {
      const o = g.plan.orders[slot] as Extract<Order, { type: 'seize' }>;
      const at = f.region;
      const also = new Set((o.also ?? []).filter(x => x !== o.fleet));
      if (also.has(f.id)) return bad(from, rid, 'already joined');
      if (at !== rid && !st.regions[at].neighbors.includes(rid)) return bad(from, rid, 'not adjacent');
      if (also.size >= MAX_JOINERS) return bad(from, rid, `${MAX_JOINERS} joiners max`);
      if (g.fleetUses(f.id) >= st.rules.orders.maxPerFleet) return bad(from, rid, '2 orders max');
      const w = needsWhole(); if (w) return w;
      const od = CHEAP ? null : g.odds([o.fleet, ...also, f.id], rid, slot);
      const pct = od ? Math.round(od.p * 100) : null;
      return { verb: 'join', ok: true, icon: '⚔', text: `join${pct !== null ? ` · ${pct}%` : ''}`, sub: g.fleetUses(f.id) > 0 ? `+${st.rules.orders.repeatFleetCredits}¢` : '', color: VERB_COLOR.join, from, to: rid, path: [rid], join: { slot, fleet: f.id }, odds: od?.p, free: splitFree.length ? splitFree : undefined };
    }
  }

  // a fleet's existing move / seize this turn: a new drag replaces it (one movement per fleet per turn)
  const movList: (Order | null)[] = g.live ? g.queue : g.plan.orders;
  const movIdx = movList.findIndex(o => !!o && (o.type === 'move' || o.type === 'seize') && o.fleet === f.id);
  const finish = (it: Intent): Intent => {
    if (!it.ok || !it.order) return it;
    const isMove = it.order.type === 'move' || it.order.type === 'seize';
    const replacing = isMove && movIdx >= 0;
    if (!replacing) { const w = needsWhole(); if (w) return { ...w, path: it.path }; }
    // the rules have the final word
    if (g.live) {
      if (replacing) { it.replace = movIdx; it.sub = it.sub || '↻ replaces order'; }
      else { const why = g.orderWhy(it.order); if (why) return { ...bad(from, rid, shortWhy(why), it.path) }; }
    } else {
      const slot = replacing ? movIdx : Math.min(k, g.plan.orders.length - 1);
      const keep = g.plan.orders[slot];
      if (replacing) g.plan.orders[slot] = null;
      let why: string | null;
      try { why = g.validateAt(it.order, slot); } finally { if (replacing) g.plan.orders[slot] = keep; }
      if (why) return { ...bad(from, rid, shortWhy(why), it.path) };
      if (replacing) { it.replace = movIdx; if (!it.sub) it.sub = `↻ replaces ${['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'][movIdx] ?? ''}`; }
      else if (g.nextSlot() === null) { it.full = true; it.sub = 'no slot free: pick one'; }
      else {
        const c = { ...orderCost(g.costState(), it.order, me) };
        if (g.fleetUses(f.id) > 0) c.credits = (c.credits ?? 0) + st.rules.orders.repeatFleetCredits;
        const ct = costText(c);
        if (ct && !it.sub) it.sub = ct;
      }
    }
    if (splitFree.length) { it.free = splitFree; it.text = `${subset!.length}▸ ${it.text}`; }
    return it;
  };

  // ---- seize or move: any reachable planet. WEGO moves are routes: the fleet advances its speed each turn and
  // keeps going on later turns without new orders, so distance only changes the ETA.
  const seizable = R.owner !== me && !(R.kind === 'void' && R.owner === null && !st.fleets.some(x => x.region === rid && x.owner !== me && x.ships.length));
  const path = rid === from ? [] : routeTo(g, from, rid);
  if (!path) return bad(from, rid, 'no route');
  const sp = Math.max(1, fleetSpeed(st, f));
  const eta = (n: number) => {
    if (g.live) return fmtDur(Math.ceil((n * st.rules.live.stepCost) / sp) * tickMs(st));
    const t = Math.max(1, Math.ceil(n / sp));
    return t <= 1 ? '' : `${t} turns`;
  };
  const stop = path.slice(0, -1).find(r => g.stopsAt(r));
  const warn = stop !== undefined ? `⚠ stops at ${st.regions[stop].name}` : '';
  if (force === 'seize' && !seizable) return bad(from, rid, 'already yours');
  if (seizable && force !== 'move') {
    const via = path.slice(0, -1);
    const order = { type: 'seize', fleet: f.id, target: rid, ...(via.length ? { via } : {}) } as Order;
    const od = CHEAP ? null : g.odds([f.id], rid, Math.min(k, g.plan.orders.length));
    const pct = od ? Math.round(od.p * 100) : null;
    const t = eta(path.length);
    return finish({ verb: 'seize', ok: true, icon: '⚔', text: `${pct !== null ? `${pct}% · ` : ''}${fleetPower(st, f)} vs ${defenceText(g, rid)}`, sub: warn || (t ? `arrives in ${t}` : ''), color: VERB_COLOR.seize, from, to: rid, path, order, odds: od?.p });
  }
  if (!path.length) return null;
  const order: Order = { type: 'move', fleet: f.id, path };
  const t = eta(path.length);
  return finish({ verb: 'move', ok: true, icon: '➤', text: t ? `Move · ${t}` : 'Move', sub: warn, color: VERB_COLOR.move, from, to: rid, path, order });
}

/**
 * Regions worth lighting up while `src` is picked up: every region where the drop would be valid,
 * coloured by verb (pit of success: invalid targets never light up). Memoized by the caller.
 */
let CHEAP = false;
export function targetMap(g: GameScreen, src: DragSrc, force: 'move' | 'seize' | null = null): Map<number, string> {
  const st = g.st, out = new Map<number, string>();
  const f = g.fleet(src.fleet);
  if (!f || g.you === null || f.owner !== g.you || g.planBlock()) return out;
  const from = f.region;
  // candidates: within speed + overdrive (LIVE: everything visible-ish within 6 jumps) plus neighbours
  // only what the fleet reaches THIS turn lights up (farther drops still work: they just take more turns)
  const reach = g.live ? 3 : Math.max(1, fleetSpeed(st, f));
  const d = new Map<number, number>([[from, 0]]);
  let frontier = [from];
  for (let i = 1; i <= reach && frontier.length; i++) {
    const next: number[] = [];
    for (const c of frontier) for (const n of moveNbrs(g, c)) if (!d.has(n)) { d.set(n, i); next.push(n); }
    frontier = next;
  }
  for (const rid of d.keys()) {
    if (isLane(g, rid)) continue;
    CHEAP = true;
    let it: Intent | null = null;
    try { it = intentFor(g, src, rid, null, force); } finally { CHEAP = false; }
    if (it?.ok) out.set(rid, VERB_COLOR[it.verb]);
  }
  return out;
}

/** Carry out an intent: free actions first (split), then the order / join / merge. Returns success. */
export function commitIntent(g: GameScreen, it: Intent): boolean {
  if (!it.ok) return false;
  if (it.full && it.order) { g.askReplace(it); return true; }
  g.snapshot();
  if (it.merge) { g.pushFree({ type: 'merge', fleet: it.merge.fleet, into: it.merge.into }, true); g.afterAction(); return true; }
  for (const fa of it.free ?? []) g.pushFree(fa, true);
  if (it.join) {
    const o = g.plan.orders[it.join.slot];
    if (!o || o.type !== 'seize') return false;
    o.also = [...new Set([...(o.also ?? []), it.join.fleet])];
    g.savePlan();
    g.flashSlot(it.join.slot);
    g.afterAction();
    return true;
  }
  if (it.order && it.replace !== undefined) {
    if (g.live) { g.src.liveCancel?.(it.replace); return g.addOrder(it.order, true); }
    g.plan.orders[it.replace] = it.order;
    g.savePlan();
    g.flashSlot(it.replace);
    g.afterAction();
    return true;
  }
  if (it.order) return g.addOrder(it.order, true);
  if (it.free?.length) { g.afterAction(); if (g.live) toast('✂ at next tick'); return true; }
  return false;
}
