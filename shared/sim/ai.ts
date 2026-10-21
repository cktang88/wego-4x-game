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
import { hostile, engagementAt, wouldFight } from './combat.ts';
import { EDICTS } from './edicts.ts';
import { findPath, fleetPower, fleetSpeed, within } from './graph.ts';
import { canAfford, orderCost, pay, validateOrder } from './orders.ts';
import { Rng } from './rng.ts';
import { emptySubmission, currentLeader, flipThreshold, creditRate } from './resolve.ts';
import { maxGarrison } from './setup.ts';
import type { Fleet, FreeAction, GameState, Order, PlayerId, Region, RegionId, Submission } from './types.ts';
import { coverage } from './visibility.ts';
import { viewFor } from './view.ts';
import { empireFree, empireCands, empireRegionValue, canField } from './ai-empire.ts';
import { shipStats, hasTech, hasLaw, baseHp, blueprintFor } from './empire.ts';
import { LAW, LAWS } from '../config/empire.ts';
import { soulFree, soulCands, aiFoundSpec } from './ai-soul.ts';
import { hasBane } from './soul.ts';
import { sigFree, readRivals, braceChance } from './ai-signature.ts';
import { isDugIn, sigOn, posturesOn, isExposed, SG } from './signature.ts';
import { soulOn, soulHit, hasBoon } from './soul.ts';
import { traitFx } from './shiptraits.ts';

interface Cand { o: Order; v: number; tag: string }
type Level = 'novice' | 'standard' | 'expert';

/**
 * Plan a turn for seat `pid`. `opts.depth` > 0 marks a nested prediction (an expert reading a rival by running
 * the rival's planner on its own fogged view): nested plans never predict further.
 */
export function planTurn(s0: GameState, pid: PlayerId, level?: Level, opts: { depth?: number } = {}): Submission {
  const sub = emptySubmission(s0);
  const me = s0.players[pid];
  if (!me || me.eliminated) return sub;
  const lvl = level ?? me.aiLevel;
  const rng = new Rng((s0.seed ^ (s0.turn * 7919) ^ (pid * 104729)) >>> 0);
  const s = perceive(s0, pid);
  const R = s.rules;
  const expert = lvl === 'expert', novice = lvl === 'novice';
  const live = !!s.live;
  // WEGO resolves all orders in one step (rules.orders.pulses = 1): positions don't change between a turn's orders
  const oneStep = live || s.rules.orders.pulses <= 1;
  const aggr = R.ai.aggression;
  const leader = currentLeader(s);
  const edictsNow = s.edicts.filter(e => e.scoresTurn === s.turn).map(e => e.id); // judged at the end of THIS turn
  const myFleets = () => s.fleets.filter(f => f.owner === pid && f.ships.length && f.id >= 0);
  const warden = () => s.fleets.find(f => f.owner === -1 && f.ships.length);
  const crowns = s.regions.filter(r => r.kind === 'crown');
  const myCrowns = crowns.filter(r => r.owner === pid).length;
  const simCache = new Map<string, SimResult>();
  // the expert's predictor models traits, boons and banes, routs and postures (unitsOf rich); others plan cruder
  const uo = (f: Fleet, defending = false) => unitsOf(s, f, defending, expert);
  // expert: read the rivals by running their own planners on what we can see (one level deep, WEGO only)
  const rivals = expert && !live && !opts.depth && sigOn(s0) ? predictRivals() : null;
  const read = rivals ? readRivals(s, pid, rivals) : null;

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

  // regions our fleets besiege as the turn starts: the siege carries on by itself and usually decides
  // them in pulse 1 (so a fresh Seize or Influence there would find it "already yours")
  const siegeOk = new Map<number, boolean>();
  for (const f of s.fleets) {
    if (f.owner !== pid || !f.ships.length || f.siege !== f.region || siegeOk.has(f.region)) continue;
    const by = s.fleets.filter(x => x.owner === pid && x.ships.length && x.siege === f.region && x.region === f.region);
    siegeOk.set(f.region, seizeOdds(by.flatMap(x => uo(x)), s.regions[f.region], 'siege:' + by.map(x => unitsKey(x)).join('+')).p >= 0.6);
  }
  const besieged = { has: (rid: number) => siegeOk.has(rid) };
  const siegeHolds = (rid: number) => !!siegeOk.get(rid);

  // -------------------------------------------------- free actions: merges & doctrine
  if (expert) {
    // concentrate force: merge fleets sharing a region (scouts stay separate)
    const byRegion = new Map<number, Fleet[]>();
    for (const f of myFleets()) if (!isScoutFleet(f)) (byRegion.get(f.region) ?? byRegion.set(f.region, []).get(f.region)!).push(f);
    for (const fl of byRegion.values()) {
      fl.sort((a, b) => b.ships.length - a.ships.length);
      for (let i = 1; i < fl.length; i++) {
        if (fl[0].ships.length + fl[i].ships.length > R.maxShipsPerFleet) continue;
        // keep two real task forces: each fleet gets its own Orders (combined seizes can still mass them)
        if (fl[i].ships.length >= 3 && fl[0].ships.length >= 3) continue;
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
        // guards auto-charge into invaded neighbours: experts keep the capital's defenders home and
        // only guard when they would beat everything visible that could invade next door
        guard: expert ? atHome && here.id !== me.capital && f.ships.length >= 2 && guardSafe(f) : atHome && enemyPowerNear(s, pid, f.region, 1) > fleetPower(s, f) * 0.6,
      };
      if (isScoutFleet(f) || (f.ships.length === 1 && (R.ships[f.ships[0].cls]?.hp ?? 9) <= 6)) { d.stance = 'evasive'; d.guard = false; }
      // Soul: a limping fleet slips home quietly; a guard-vowed fleet never answers calls elsewhere; a Reckless one never runs
      if (f.limping) { d.stance = 'evasive'; d.guard = false; }
      if (f.vow?.kind === 'guard') d.guard = false;
      if (d.stance === 'evasive' && hasBane(s, f, 'reckless')) d.stance = 'defensive';
      sub.free.push({ type: 'doctrine', fleet: f.id, doctrine: d });
      f.doctrine = d;
    }
  }

  // -------------------------------------------------- the Empire layer: research & blueprints (free)
  sub.free.push(...empireFree({ s, pid, lvl, rng, threatened }));
  // -------------------------------------------------- the Soul layer: honours, callings, vows, razing, dispatches (free)
  sub.free.push(...soulFree({ s, pid, lvl, threatened, mainArmy: myFleets().filter(f => !isScoutFleet(f) && !f.limping).sort((a, b) => fleetPower(s, b) - fleetPower(s, a))[0] }));

  // -------------------------------------------------- order slots (greedy over projected state)
  const usedTargets = new Set<string>();
  // LIVE mid-cycle: orders a fleet already took this cycle still count against its limit
  const fleetUses = new Map<number, number>();
  for (const f of s.fleets) if (f.owner === pid && f.ordersThisTurn > 0) fleetUses.set(f.id, f.ordersThisTurn);
  for (let slot = 0; slot < R.orders.perTurn; slot++) {
    const valid = candidates().filter(c => c.v > 0.3 && !usedTargets.has(c.tag) && !(isFleetOrder(c.o) && (fleetUses.get(c.o.fleet) ?? 0) >= R.orders.maxPerFleet) &&
      !economyBlocked(c.o) && !validateOrder(s, pid, c.o) && affordable(c.o));
    if (!valid.length) continue;
    // tiny seeded jitter so exact ties never break by region id (which would favour one map wedge)
    for (const c of valid) c.v += rng.next() * 0.02;
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
  // a guard reaction would pull a fleet off its plan mid-turn (its later orders then start from the
  // wrong region): fleets with work this turn stand down, unless their only order is a pulse-1 move/seize
  for (const fa of sub.free) {
    if (fa.type !== 'doctrine' || !fa.doctrine.guard) continue;
    const mine = sub.orders.map((o, k) => ({ o, k })).filter(x => x.o && (isFleetOrder(x.o) && x.o.fleet === fa.fleet || (x.o.type === 'seize' && x.o.also?.includes(fa.fleet)) || (x.o.type === 'build' && x.o.fleet === fa.fleet)));
    if (mine.length && !(mine.length === 1 && mine[0].k === 0 && (mine[0].o!.type === 'move' || mine[0].o!.type === 'seize'))) fa.doctrine.guard = false;
  }
  // -------------------------------------------------- signature: postures, world postures, Fate (bets on this turn's orders)
  sub.free.push(...sigFree({
    s, pid, lvl, orders: sub.orders, threatened, rivals, read,
    odds: (fl, rid) => fl.length ? seizeOdds(fl.flatMap(x => uo(x)), s.regions[rid], 'sig:' + fl.map(x => unitsKey(x)).join('+')).p : 0,
    duel: (mineF, theirs, rid, hold) => {
      if (!theirs.length) return 1;
      if (!mineF.length && !hold) return 0;
      const r = s.regions[rid];
      const gar = hold && r.owner === pid ? r.garrison : 0;
      return 1 - simBattle(s, rid, theirs.flatMap(x => uo(x)), mineF.flatMap(x => uo(x, hold)), gar, hold ? r.buildings.fortress ?? 0 : 0, 0.35).p;
    },
    close: (mineF, theirs, rid, hold) => {
      if (!mineF.length) return false;
      const r = s.regions[rid];
      const scale = (u: SimUnit[], k: number) => u.map(x => ({ ...x, hp: x.hp * k }));
      const M = mineF.flatMap(x => uo(x, hold)), T = theirs.flatMap(x => uo(x, !hold));
      const fort = r.buildings.fortress ?? 0;
      if (hold) {
        if (!T.length) return false;
        const gar = r.owner === pid ? r.garrison : 0;
        return simBattle(s, rid, T, scale(M, 1.5), gar, fort, 0.35).win !== simBattle(s, rid, T, scale(M, 0.67), gar, fort, 0.35).win;
      }
      const gar = r.owner === pid ? 0 : r.garrison;
      return simBattle(s, rid, scale(M, 1.5), T, gar, fort, 0.35).win !== simBattle(s, rid, scale(M, 0.67), T, gar, fort, 0.35).win;
    },
  }));
  return sub;

  // ====================================================================== helpers
  function predictRivals(): { p: PlayerId; sub: Submission }[] {
    const view = perceive(s0, pid);
    const out: { p: PlayerId; sub: Submission }[] = [];
    for (const p of view.players) if (p.id !== pid && !p.eliminated) out.push({ p: p.id, sub: planTurn(view, p.id, undefined, { depth: 1 }) });
    return out;
  }
  function me0() { return s.players[pid]; }
  /** Is region rid within the hunting Warden's next step (and are we its likely prey)? */
  function wardenNear(rid: number): boolean {
    const w = warden();
    return !!w && !!R.wardenHunt?.enabled && topVp() && (w.region === rid || s.regions[rid].neighbors.includes(w.region));
  }
  /** Am I (or would I soon be) the one the Warden hunts? */
  function topVp() { return s.players.every(p => p.id === pid || p.eliminated || p.vp < me0().vp + 3); }

  /** Builds, projects and digs fail while hostile ships sit in the region ("enemies present"). */
  function economyBlocked(o: Order): boolean {
    const rid = o.type === 'build' || o.type === 'develop' ? o.region : o.type === 'excavate' ? s.fleets.find(x => x.id === o.fleet)?.region : undefined;
    return rid !== undefined && hostileFleetsAt(rid).length > 0;
  }
  function isFleetOrder(o: Order): o is Extract<Order, { fleet: number }> { return 'fleet' in o && o.type !== 'build'; }
  /** What the resolver will charge for this order in its pulse: its cost, plus the repeat-fleet fee. */
  function slotCost(o: Order) {
    const c = { ...orderCost(s, o, pid) };
    const fees = (isFleetOrder(o) && (fleetUses.get(o.fleet) ?? 0) > 0 ? 1 : 0) +
      (o.type === 'seize' ? (o.also ?? []).filter(id => (fleetUses.get(id) ?? 0) > 0).length : 0);
    if (fees) c.credits = (c.credits ?? 0) + fees * R.orders.repeatFleetCredits;
    return c;
  }
  /** Mirrors the resolver: moves and seizes have no price check; everything else needs canAfford
   *  after the repeat-fleet fee (which is taken at the start of the pulse) has been paid. */
  function affordable(o: Order): boolean {
    if (o.type === 'move' || o.type === 'seize') return true;
    const fee = isFleetOrder(o) && (fleetUses.get(o.fleet) ?? 0) > 0 ? R.orders.repeatFleetCredits : 0;
    const res = { ...me0().res, credits: me0().res.credits - fee };
    return canAfford(res, orderCost(s, o, pid), creditRate(s, pid));
  }
  function project(o: Order) {
    pay(me0().res, slotCost(o), creditRate(s, pid));
    if (o.type === 'law') {
      // enacting one side of a pair repeals the other
      const opp = LAWS.find(l => l.pair === LAW[o.law]?.pair && l.id !== o.law)?.id;
      me0().laws = [...(me0().laws ?? []).filter(x => x !== opp), o.law];
    }
    const use = (id: number, n = 1) => fleetUses.set(id, Math.min(R.orders.maxPerFleet, (fleetUses.get(id) ?? 0) + n));
    // one-step WEGO: a fleet's orders all land at once, so a second one (move after excavate/fortify...) would undo the first
    if (isFleetOrder(o)) use(o.fleet, oneStep ? 9 : 1);
    if (o.type === 'move') {
      const f = s.fleets.find(x => x.id === o.fleet)!;
      const dest = o.path[o.path.length - 1];
      // LIVE: a move sets the fleet travelling; it is not at dest for several ticks
      if (!oneStep) {
        // ending next to/among enemies means a battle (or a garrison stop): no clean second order
        if (hostileFleetsAt(dest).length || (s.regions[dest].owner !== null && s.regions[dest].owner !== pid && s.regions[dest].garrison > 0 && hostile(s, pid, s.regions[dest].owner!))) use(f.id, 9);
        f.region = dest; f.fortified = false; f.siege = null;
      } else use(f.id, 9);
    }
    if (o.type === 'seize') {
      const f = s.fleets.find(x => x.id === o.fleet)!;
      const t = s.regions[o.target];
      // a defended target means a siege that carries on: the besiegers stay put (and leaving would abandon it)
      const fight = t.garrison > 0 || hostileFleetsAt(o.target).length > 0;
      usedTargets.add(`seize:${o.target}`); // optimistic: assume it falls (so we don't seize or influence it again)
      usedTargets.add(`inf:${o.target}`);
      for (const g of [f, ...(o.also ?? []).map(id => s.fleets.find(x => x.id === id)).filter((x): x is Fleet => !!x)]) {
        if (g !== f) use(g.id);
        if (fight || oneStep) use(g.id, 9);
        if (!oneStep) { g.region = o.target; g.fortified = false; g.siege = o.target; }
      }
    }
    if (o.type === 'fortify') { const f = s.fleets.find(x => x.id === o.fleet)!; f.fortified = true; }
    if (o.type === 'influence') {
      const r = s.regions[o.target];
      if (r.owner === pid) r.loyalty = r.loyalty.map((x, i) => (i === pid ? x : Math.max(0, x - (R.influenceLimits?.purgeAmount ?? 0))));
      else {
        const adj = r.neighbors.some(n => s.regions[n].owner === pid);
        r.loyalty[pid] = (r.loyalty[pid] ?? 0) + Math.round((R.influence.pushAmount + (adj ? R.influence.adjacentBonus : 0)) * (hasTech(s, pid, 'subversion') ? R.empire.subversionPushMult : 1));
        if (r.loyalty[pid] >= flipThreshold(s, r.id)) usedTargets.add(`seize:${r.id}`); // it defects this pulse: don't also seize it
      }
    }
    if (o.type === 'develop') s.regions[o.region].project = { key: o.project, progress: 0, owner: pid };
    if (o.type === 'refit') {
      const f = s.fleets.find(x => x.id === o.fleet)!;
      for (const sh of f.ships) { sh.mod = blueprintFor(s, pid, sh.cls); sh.maxHp = baseHp(s, sh.cls, sh.mod); sh.hp = Math.max(sh.hp, sh.maxHp); sh.sys = { engines: true, weapons: true, shields: true }; }
    }
    if (o.type === 'build') {
      // the projected fleet gets the new hull (fitted like the real one will be) so later slots plan with it
      const mod = blueprintFor(s, pid, o.cls);
      const hp = baseHp(s, o.cls, mod);
      const sh = { id: -1000 - slot(), name: 'new', cls: o.cls, hp, maxHp: hp, sys: { engines: true, weapons: true, shields: true }, kills: 0, battles: 0, title: null, bornTurn: s.turn, mod };
      const f = o.fleet !== null ? s.fleets.find(x => x.id === o.fleet) : undefined;
      if (f) f.ships.push(sh);
      else {
        // a new fleet: it can't act this turn (negative id keeps it out of myFleets) but it counts toward maxFleets
        const base = myFleets()[0] ?? s.fleets.find(x => x.owner === pid);
        if (base) s.fleets.push({ ...structuredClone(base), id: -1 - slot(), region: o.region, ships: [sh], bornTurn: s.turn, siege: null, route: null, fortified: false, ordersThisTurn: 0 });
      }
    }
  }
  function slot() { return sub.orders.filter(Boolean).length; }
  /** A Build: into a fleet at the yard, or founding a new banner (Soul layer: with this style's boons and banes). */
  function buildOrder(region: number, cls: string, joinable: Fleet | undefined): Order {
    if (joinable) return { type: 'build', region, cls, fleet: joinable.id };
    if (s.rules.soul?.enabled !== false && s.rules.soul && cls !== 'scout') return { type: 'build', region, cls, fleet: null, found: aiFoundSpec(s, pid, lvl, region) };
    return { type: 'build', region, cls, fleet: null };
  }

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
    if (!novice) v += empireRegionValue(s, pid, r);
    if (expert) {
      if (r.owner !== null && r.owner === leader && leader !== pid) v += 4;                 // bounty + slows the leader
      if (r.kind === 'crown') {
        if (r.owner !== pid && myCrowns === 2) v += 25;                                       // the third crown starts the win countdown
        if (r.owner !== null && r.owner !== pid && s.crownHold?.owner === r.owner) v += 40;   // they hold all three: break it NOW
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
      // income over the rest of the game: land early, it compounds
      const y = R.economy.yields[r.kind] ?? R.economy.yields.colony;
      v += (y.industry + y.credits) * Math.max(1, r.dev) * 0.25 * Math.max(0, Math.min(1, (R.victory.turnLimit - s.turn - 8) / 12));
      if (r.kind === 'throne') {
        const w = warden();
        if (w) v = w.region === r.id ? -5 : v;                                                // the Warden judges whoever sits there
        else if (s.loreFound >= R.warden.wakeAtLore - 1 && !s.wardenAwake) v -= 3;            // it may wake soon
      }
    } else {
      if (r.kind === 'throne' && s.fleets.some(f => f.owner === -1)) v -= 6;
      // even a standard player sees a rival about to complete the set
      if (!novice && r.kind === 'crown' && r.owner !== null && r.owner !== pid && crowns.filter(c => c.owner === r.owner).length >= 2) v += 8;
      if (!novice && r.kind === 'crown' && r.owner !== null && r.owner !== pid && s.crownHold?.owner === r.owner) v += 20;
    }
    return v;
  }

  // ---------------------------------------------------------------- strength estimates
  /** Predicted chance that `units` (attacking from outside) take region t this pulse, and expected losses. */
  function seizeOdds(units: SimUnit[], t: Region, key: string): SimResult {
    const ck = `${t.id}:${key}`;
    const hit = simCache.get(ck);
    if (hit) return hit;
    // rivals' guard orders are secret: assume a real fleet sitting on its owner's world next door will answer
    const mayGuard = (f: Fleet) => R.ai.cheatVision ? f.doctrine.guard : s.regions[f.region].owner === f.owner && f.ships.length >= 2;
    const defFleets = s.fleets.filter(f => f.ships.length && hostile(s, f.owner, pid) && (f.region === t.id ||
      (t.owner !== null && f.owner === t.owner && t.neighbors.includes(f.region) && mayGuard(f))));
    const D = defFleets.flatMap(f => uo(f));
    const fort = t.buildings.fortress ?? 0;
    const gar = Math.round(t.garrison * (novice && t.owner === null ? 0.8 : 1)); // novices underrate neutral garrisons
    // expert: it will Charge a defender it reads as unbraced (first strike, extra damage early); a braced one
    // (Guarded fleets, the Levies) would break the charge, so it plans those assaults Steady
    const charge = expert && !(globalThis as { __tcNoCharge?: boolean }).__tcNoCharge && posturesOn(s) && t.owner !== null && t.owner !== pid &&
      (read ? !(read.levies.has(t.id) || defFleets.some(f => read.braced.has(f.id))) : braceChance(s, pid, t) < 0.35);
    const braced = expert && !!read && (read.levies.has(t.id) || defFleets.some(f => read.braced.has(f.id)));
    if (charge) units = units.map(u => ({ ...u, dmg: (u.dmg ?? 0) + SG(s).chargeDamage }));
    const so = { first: charge ? 'a' as const : braced && defFleets.some(f => read!.braced.has(f.id)) ? 'd' as const : undefined };
    const garB = braced && read!.levies.has(t.id) ? Math.round(gar * SG(s).leviesMult) : gar;
    let res: SimResult;
    if (D.length) {
      // fleet battle (garrison helps only if its owner has ships here), then the siege
      const garHelps = t.owner !== null && defFleets.some(f => f.owner === t.owner);
      const b1 = simBattle(s, t.id, units, D, garHelps ? garB : 0, fort, 0.35, so);
      if (!b1.win) res = b1;
      else {
        const b2 = simBattle(s, t.id, b1.left, [], b1.garLeft || (garHelps ? 0 : garB), fort, 0.35);
        res = { ...b2, p: Math.min(b1.p, b2.p), lost: b1.lost + b2.lost };
      }
    } else res = simBattle(s, t.id, units, [], garB, fort, 0.35, so);
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
      const A = near.flatMap(f => uo(f));
      const D = [...s.fleets.filter(f => f.owner === pid && f.region === rid && f.ships.length).flatMap(f => uo(f, true)), ...extra];
      const b = simBattle(s, rid, A, D, r.garrison, r.buildings.fortress ?? 0, 0.4);
      worst = Math.max(worst, b.p);
    }
    // the hunting Warden marches on the leader one region per turn
    const w = warden();
    if (w && R.wardenHunt?.enabled && topVp() && (w.region === rid || s.regions[rid].neighbors.includes(w.region))) {
      const D = [...s.fleets.filter(f => f.owner === pid && f.region === rid && f.ships.length).flatMap(f => uo(f, true)), ...extra];
      worst = Math.max(worst, simBattle(s, rid, uo(w), D, r.garrison, r.buildings.fortress ?? 0, 0.4).p * 0.8);
    }
    return worst;
  }

  // ---------------------------------------------------------------- candidates
  function candidates(): Cand[] {
    const out: Cand[] = [];
    const fleets = myFleets();
    const myPow = fleets.reduce((a, f) => a + fleetPower(s, f), 0) || 1;
    const rivalPow = Math.max(1, ...s.players.filter(p => p.id !== pid && !p.eliminated).map(p => s.fleets.filter(f => f.owner === p.id).reduce((a, f) => a + fleetPower(s, f), 0)));
    const mainArmy = fleets.filter(f => !isScoutFleet(f) && !f.limping).sort((a, b) => fleetPower(s, b) - fleetPower(s, a))[0];

    for (const f of fleets) {
      const uses = fleetUses.get(f.id) ?? 0;
      if (uses >= R.orders.maxPerFleet) continue;
      if (f.route && f.route.path.length) continue;   // already travelling on a route (it keeps going without orders)
      if (f.limping) continue;                         // Soul: a limping fleet follows its own route home
      // Soul: leaving its world would break the vow. Signature: a dug-in fleet can't move this turn either.
      const sworeGuard = f.vow?.kind === 'guard' || isDugIn(s, f);
      // Soul: a relic-vowed fleet carrying its relic heads home to fulfil the vow
      if (f.vow?.kind === 'relic' && f.vow.carrying && f.banner && f.region !== f.banner.home && !isDugIn(s, f)) {
        const home = findPath(s, f.region, f.banner.home);
        if (home && !home.slice(0, -1).some(x => hostileFleetsAt(x).length || (s.regions[x].owner !== null && s.regions[x].owner !== pid && s.regions[x].garrison > 0)))
          out.push({ o: { type: 'move', fleet: f.id, path: home }, v: 5, tag: `move:${f.id}` });
      }
      const fatiguePenalty = uses > 0 ? (me0().res.credits > 20 ? 1 : 4) : 0;
      const pow = fleetPower(s, f);
      const here = s.regions[f.region];
      const isScout = isScoutFleet(f);
      const units = uo(f);
      const ukey = unitsKey(f);
      // leaving a threatened key world costs (expert only)
      // the hunting Warden is about to land on us: get weak fleets out of its way
      const flee = expert && wardenNear(f.region) && !isScout ? 3 : 0;
      const leaveCost = expert && threatened.has(here.id) && !isScout ? regionValue(here) * Math.max(0, threatWithout(f) - (threatened.get(here.id) ?? 0)) * 1.2 : 0;

      // excavate
      if (here.relic === 'unclaimed' && here.owner === pid) {
        let v = 14 - fatiguePenalty;
        // the last relic wakes the Warden, which hunts the VP leader: wake it on a rival, never on yourself
        if (expert && s.loreFound === R.warden.wakeAtLore - 1 && !s.wardenAwake) v += topVp() ? -12 : 4;
        out.push({ o: { type: 'excavate', fleet: f.id }, v, tag: `ex:${here.id}` });
      }

      // sustained battles: a fleet locked in a fight it isn't losing should stay (leaving costs a parting volley)
      const engagedHere = !!engagementAt(s, here.id) && wouldFight(s, here.id);
      const myHereHp = s.fleets.filter(x => x.owner === pid && x.region === here.id).reduce((a, x) => a + fleetPower(s, x), 0);
      const foeHereHp = hostileFleetsAt(here.id).reduce((a, x) => a + fleetPower(s, x), 0) + (here.owner !== pid && here.owner !== null ? here.garrison : 0);
      const stayInFight = engagedHere && !isScout && myHereHp >= foeHereHp * 0.7 ? 4 + regionValue(here) * 0.3 : 0;

      // seize adjacent / current, or (one-step WEGO) march through clear space and assault within speed
      const viaOf = new Map<number, number[]>();
      const hereLinks = here.links ?? here.neighbors;
      if (oneStep && !live) {
        const sp0 = fleetSpeed(s, f);
        const clear = (x: number) => (s.regions[x].owner === pid || s.regions[x].owner === null || !hostile(s, pid, s.regions[x].owner!)) && !(s.regions[x].owner === null && s.regions[x].garrison > 0) && !hostileFleetsAt(x).length;
        const prev = new Map<number, number>([[here.id, -1]]); let frontier = [here.id];
        for (let d = 1; d < sp0; d++) {
          const next: number[] = [];
          for (const r of frontier) for (const n of s.regions[r].links ?? s.regions[r].neighbors) if (!prev.has(n) && clear(n)) { prev.set(n, r); next.push(n); }
          frontier = next;
        }
        for (const [r] of prev) {
          if (r === here.id) continue;
          const via: number[] = []; for (let x = r; x !== here.id; x = prev.get(x)!) via.unshift(x);
          for (const n of s.regions[r].links ?? s.regions[r].neighbors) if (n !== here.id && !hereLinks.includes(n) && !prev.has(n) && !viaOf.has(n) && s.regions[n].kind !== 'lane') viaOf.set(n, via);
        }
      }
      for (const tid of sworeGuard ? [] : [here.id, ...hereLinks.filter(n => s.regions[n].kind !== 'lane'), ...viaOf.keys()]) {
        const via = viaOf.get(tid);
        const t = s.regions[tid];
        if (t.owner === pid) continue;
        if (f.siege === tid) continue;   // already besieging: the siege carries on without new orders
        if (besieged.has(tid) && siegeHolds(tid)) continue;   // our other fleets are taking it already ("already yours")
        const pact = t.owner !== null && t.owner >= 0 && !hostile(s, pid, t.owner);
        if (pact && !(expert && leader === t.owner)) continue;
        if (isScout && t.garrison > 2) continue;
        let v: number;
        let also: number[] = [];
        if (expert) {
          // combined assault: bring every idle fleet next to the target if one fleet alone isn't enough
          let sim = seizeOdds(units, t, ukey);
          if (sim.p < 0.9) {
            const helpers = fleets.filter(g => g !== f && !isScoutFleet(g) && !g.limping && g.vow?.kind !== 'guard' && !isDugIn(s, g) && (fleetUses.get(g.id) ?? 0) < R.orders.maxPerFleet && !(live && g.route) &&
              !(g.bornTurn === s.turn && s.turn > 1) &&
              (g.region === tid || s.regions[g.region].neighbors.includes(tid)) && !threatened.has(g.region))
              // the resolver lets at most 3 fleets join an assault: plan with the 3 strongest
              .sort((a, b) => fleetPower(s, b) - fleetPower(s, a) || a.id - b.id).slice(0, 3);
            if (helpers.length) {
              const all = [...units, ...helpers.flatMap(g => uo(g))];
              const sim2 = seizeOdds(all, t, ukey + helpers.map(g => unitsKey(g)).join('+'));
              if (sim2.p > sim.p + 0.1) { sim = sim2; also = helpers.map(g => g.id); }
            }
          }
          // never throw a fleet at a wall: battles are noisy, so demand a real margin unless the prize is huge
          if (sim.p < (regionValue(t) >= 25 ? 0.45 : 0.6)) continue;
          v = regionValue(t) * sim.p * aggr - sim.lost * 0.2 - (1 - sim.p) * unitsCost(units) * 0.05 - fatiguePenalty - leaveCost - also.length * 0.5;
          if (pact) v -= R.influence.pactBreakVp * 2;
          if (edictsNow.includes('crown_battle') && t.kind === 'crown' && s.fleets.some(x => x.region === tid && x.owner !== pid && x.ships.length)) v += 3;
        } else {
          // standard & novice: same predictor, but no thought for what happens next
          const p = seizeOdds(units, t, ukey).p;
          if (p < (novice ? 0.3 : 0.2)) continue;
          v = regionValue(t) * p * aggr - (1 - p) * pow * 0.08 - fatiguePenalty;
        }
        if (t.owner !== null && t.owner !== pid && t.owner >= 0) v += 1.5 * aggr; // conflict is the point
        if (via) v -= 0.3 * via.length;   // a longer march: slightly less sure of the picture on arrival
        const so: Order = { type: 'seize', fleet: f.id, target: tid, ...(also.length ? { also } : {}), ...(via ? { via } : {}) };
        out.push({ o: so, v, tag: `seize:${tid}` });
      }

      // move: toward opportunities, home to defend, or (expert) to concentrate
      const sp = fleetSpeed(s, f);
      const canOd = expert ? !f.fatigued && uses === 0 : !f.fatigued;
      // destinations are planets (waypoints are passed through); routes may take more than one turn
      const odBonus = canOd && !novice ? R.overdrive.speedBonus : 0;
      const reach = sworeGuard ? [] : [...within(s, f.region, live || R.orders.pulses > 1 ? sp + odBonus : sp * 2 + odBonus)].filter(x => x !== f.region && s.regions[x].kind !== 'lane');
      for (const dest of reach) {
        const path = findPath(s, f.region, dest);
        if (!path) continue;
        const od = path.length > sp && path.length <= sp + odBonus;   // overdrive only to arrive this turn
        if (path.slice(0, -1).some(x => s.regions[x].owner !== null && s.regions[x].owner !== pid && s.regions[x].garrison > 0)) continue; // blocked en route
        if (path.slice(0, -1).some(x => hostileFleetsAt(x).length)) continue;                     // would be stopped (and fight) en route
        const dr = s.regions[dest];
        const foes = hostileFleetsAt(dest);
        if (foes.some(x => x.owner === -1) && !expert) continue;                                  // everyone knows not to poke the Warden
        // reinforcing an ongoing battle: our ships already there count toward the odds
        const friendsThere = s.fleets.filter(x => x.owner === pid && x.region === dest && x !== f).reduce((a, x) => a + fleetPower(s, x), 0);
        const reinforcing = !!engagementAt(s, dest) && (friendsThere > 0 || dr.owner === pid);
        if (foes.length && (isScout || (!expert && fleetPower(s, f) + friendsThere < foes.reduce((a, x) => a + fleetPower(s, x), 0) * 1.2))) continue;
        const rivalHeld = dr.owner !== null && dr.owner !== pid && dr.garrison > 0;
        // rival garrisons now open fire on anything parked in their region: only experts with a plan go in
        if (rivalHeld && (!expert || isScout)) continue;
        let v = 0;
        if (!novice) v = moveValue(f, units, dest, path.length, mainArmy) - leaveCost - (path.length > sp + odBonus ? 1 : 0);   // a 2-turn trip
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
        if (flee && !wardenNear(dest)) v += flee;
        if (reinforcing && !isScout && !novice) v = Math.max(v, 3 + regionValue(dr) * (expert ? 0.8 : 0.5) * Math.min(1.5, (foes.reduce((a, x) => a + fleetPower(s, x), 0) + 1) / (friendsThere + 1)));
        v -= stayInFight;
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
        // join a fleet that will still be here when the yard delivers: guards may charge off to a neighbour mid-turn
        const joinable = myFleets().find(f => f.region === r.id && f.ships.length < R.maxShipsPerFleet && !isScoutFleet(f) && !f.doctrine.guard && !(live && f.route));
        if (expert) {
          const b = expertBuild(r, need, joinable, mainArmy);
          if (b) out.push({ o: buildOrder(r.id, b.cls, joinable), v: b.v, tag: `build:${r.id}:${sub.orders.filter(o => o?.type === 'build').length}` });
        } else {
          for (const [cls, d] of Object.entries(R.ships)) {
            if (d.needsShipyard > yard || cls === 'scout') continue;
            // bang per buck, with a nod to the fact that Orders (not money) are the real limit
            const eff = (d.hp * 0.5 + d.attack * d.shots * 2 + d.shields * 3) / Math.pow(Math.max(10, (d.cost.industry ?? 0) + (d.cost.credits ?? 0)), 0.85);
            const v = (3 + need * 3.5 * aggr) * eff * 1.4 + (novice ? rng.next() * 2 : 0);
            out.push({ o: buildOrder(r.id, cls, joinable), v, tag: `build:${r.id}:${cls}` });
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

    // ------------- the Soul layer: retire a battered legend (rare)
    out.push(...soulCands({ s, pid, lvl, threatened }));

    // ------------- the Empire layer: laws, projects, refits
    out.push(...empireCands({ s, pid, lvl, rng, threatened }, s.regions.filter(x => x.owner === pid), mainArmy ? mainArmy.region : null));

    // ------------- influence regions next door
    for (const r of s.regions) {
      if (r.kind === 'void') continue;
      if (besieged.has(r.id)) continue;   // the siege decides it (and a capture wipes the loyalty we'd push)
      if (r.owner === pid) {
        // expert counter-intelligence: purge rival agents before they turn one of our worlds
        const worst = Math.max(...r.loyalty.filter((_, i) => i !== pid));
        if (expert && worst > 0 && worst + R.influence.pushAmount + R.influence.adjacentBonus >= flipThreshold(s, r.id))
          out.push({ o: { type: 'influence', target: r.id }, v: regionValue(r) * 0.8, tag: `inf:${r.id}` });
        continue;
      }
      if (r.owner !== null && (s.players[r.owner].capital === r.id || novice)) continue;
      const near = r.neighbors.some(n => s.regions[n].owner === pid);
      if (!near) continue;
      const thr = flipThreshold(s, r.id);
      const after = r.loyalty[pid] + R.influence.pushAmount + R.influence.adjacentBonus;
      let v = regionValue(r) * (after >= thr ? 1 : after / thr * 0.45) - (r.owner !== null ? 1 : 0);
      if (expert) {
        // pointless while a rival's guns sit there; and finish what we started
        if (s.fleets.some(f => f.region === r.id && f.ships.length && f.owner !== pid && hostile(s, f.owner, pid))) v *= 0.3;
        // a neutral we could just take by force with a fleet next door is not worth the influence
        if (r.owner === null && r.garrison <= 12 && r.kind === 'colony') v *= 0.5;
        if (r.loyalty[pid] > 0) v += 1;
        // one push per turn against decay: if it takes ages to flip, the Order is better spent elsewhere
        const perTurn = R.influence.pushAmount + R.influence.adjacentBonus - R.influence.decayPerTurn;
        const turns = Math.ceil((thr - r.loyalty[pid]) / Math.max(1, perTurn));
        if (turns > 3 && me0().res.influence < 30) v *= 3 / (turns + 1); // ...unless influence is piling up anyway
      }
      out.push({ o: { type: 'influence', target: r.id }, v, tag: `inf:${r.id}` });
    }

    if (expert) {
      // pacts: ally with the weaker rival against a runaway leader, and answer offers from anyone
      // who isn't running away with it (offers stay visible on the offering player for a turn)
      const inPact = (q: number) => s.pacts.some(x => (x.a === pid && x.b === q) || (x.b === pid && x.a === q));
      if (leader !== null && leader !== pid) {
        const other = s.players.find(p => p.id !== pid && p.id !== leader && !p.eliminated);
        if (other && !inPact(other.id)) out.push({ o: { type: 'pact', with: other.id }, v: 2.5, tag: 'pact' });
      }
      for (const p of s.players) {
        if (p.id === pid || p.eliminated || inPact(p.id) || !p.pactOffers?.includes(pid)) continue;
        if (p.id === leader || p.vp > me0().vp + 6) continue; // never prop up the leader
        out.push({ o: { type: 'pact', with: p.id }, v: 3, tag: 'pact' });
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
    const combined = friends.length ? [...units, ...friends.flatMap(x => uo(x))] : units;
    const ckey = unitsKey(f) + friends.map(x => unitsKey(x)).join('+');
    let v = 0;

    // moving onto enemy ships (or into a rival's garrisoned region) means a battle: only if we win it convincingly
    const foes = hostileFleetsAt(dest);
    const garFights = dr.owner !== null && dr.owner !== pid && dr.garrison > 0 && hostile(s, pid, dr.owner);
    if (garFights && !foes.length) {
      const b = simBattle(s, dest, units, [], dr.garrison, dr.buildings.fortress ?? 0, 0.35);
      if (b.p < 0.75) return -99;
      v += regionValue(dr) * 0.3 * b.p - b.lost * 0.1; // grinds the garrison down for next turn's seize
    }
    if (foes.length) {
      const b = simBattle(s, dest, units, foes.flatMap(x => uo(x, true)), garFights || foes.some(x => x.owner === dr.owner) ? dr.garrison : 0, dr.buildings.fortress ?? 0, 0.35);
      if (b.p < 0.65) return -99;
      v += unitsCost(foes.flatMap(x => uo(x))) * 0.06 * b.p - b.lost * 0.1;
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
        if (sim.p < (expert ? 0.55 : 0.35)) continue;
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
      const def = s.fleets.filter(x => x.region === dest && x.ships.length && hostile(s, x.owner, pid)).flatMap(x => uo(x));
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

  /** Expert: would f win against every visible hostile force within two jumps (the ones that could trigger its guard)? */
  function guardSafe(f: Fleet): boolean {
    const near = within(s, f.region, 2);
    const foes = s.fleets.filter(x => x.ships.length && x.owner >= 0 && hostile(s, x.owner, pid) && near.has(x.region));
    if (!foes.length) return f.ships.length >= 3;
    for (const p of new Set(foes.map(x => x.owner))) {
      const b = simBattle(s, f.region, uo(f), foes.filter(x => x.owner === p).flatMap(x => uo(x)), 0, 0, 0.35);
      if (b.p < 0.7) return false;
    }
    return true;
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
      const b = simBattle(s, r.id, near.flatMap(x => uo(x)), keep.flatMap(x => uo(x, true)), r.garrison, r.buildings.fortress ?? 0, 0.4);
      worst = Math.max(worst, b.p);
    }
    return worst;
  }

  function hostileFleetsAt(rid: number): Fleet[] {
    return s.fleets.filter(x => x.region === rid && x.ships.length && x.owner !== pid && hostile(s, x.owner, pid));
  }

  function enemyUnitsNear(rid: number): SimUnit[] {
    const area = s.regions[rid].neighbors;
    return s.fleets.filter(x => x.ships.length && x.owner >= 0 && hostile(s, x.owner, pid) && (x.region === rid || area.includes(x.region))).flatMap(x => uo(x));
  }

  // ---------------------------------------------------------------- expert: builds & projects
  function expertBuild(r: Region, need: number, joinable: Fleet | undefined, mainArmy: Fleet | undefined): { cls: string; v: number } | null {
    const yard = r.buildings.shipyard ?? 0;
    const res = me0().res;
    const ok = (c: string) => R.ships[c] && R.ships[c].needsShipyard <= yard && canField(s, pid, c) && canAfford(res, orderCost(s, { type: 'build', region: r.id, cls: c, fleet: null }, pid), creditRate(s, pid));
    const army = mainArmy ? mainArmy.ships : [];
    const bombards = army.filter(x => (R.ships[x.cls]?.siege ?? 0) >= 5).length;
    // a hard nut within reach of the army (fortified capitals, crowns, the Throne) wants siege hulls
    const hardTarget = s.regions.some(t => t.owner !== pid && t.garrison >= 28 && (t.kind === 'crown' || t.kind === 'throne' || t.kind === 'home') &&
      (!mainArmy || within(s, mainArmy.region, 3).has(t.id)));
    let cls: string | null = null;
    const allBombards = myFleets().reduce((n, f) => n + f.ships.filter(x => (R.ships[x.cls]?.siege ?? 0) >= 5).length, 0);
    if (hardTarget && bombards < 1 + Math.floor(army.length / 5) && allBombards < 2 && ok('bombard')) cls = 'bombard';
    else if (ok('dread') && res.industry > 100) cls = 'dread';
    else if (ok('cruiser')) cls = 'cruiser';
    else if (ok('frigate')) cls = 'frigate';
    else if (ok('corvette') && (s.turn <= 3 || (threatened.get(r.id) ?? 0) > 0.3)) cls = 'corvette';
    if (!cls) return null;
    // urgent at a threatened yard; otherwise scale with how outgunned we are and how much we can afford
    const threat = threatened.get(r.id) ?? 0;
    const order = { scout: 0, corvette: 1, frigate: 2, bombard: 2.5, cruiser: 3, dread: 4 }[cls] ?? 1;
    // armies win this game: keep the yards busy (each build is one Order, so prefer big hulls)
    let v = 5.5 + need * 2.5 + order * 0.8 + threat * 8;
    if (s.turn <= 1 && !threat) v -= 1.5; // grow the economy first
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
      add('develop', 1.5 + (y.industry + y.credits) * 0.3 + early * 2);
    }
    if ((r.buildings.mine ?? 0) < 2 && r.kind !== 'void') add('mine', 3 + early * 3); // cheap compounding industry: early mines out-build everyone later
    // credits are usually the binding resource: turn spare industry into trade
    const res = me0().res;
    if ((r.buildings.tradehub ?? 0) < 2 && r.kind !== 'void' && res.industry > res.credits * 1.5) add('tradehub', 3.5 + early + Math.min(2, (res.industry - res.credits) / 40));
    if ((r.buildings.fortress ?? 0) < 2 && (r.kind === 'crown' || r.kind === 'throne')) add('fortress', 2.5 + threat * 6);
  }
}

// ============================================================================
//  Battle predictor: a deterministic expected-value version of combat.ts.
//  Good enough to tell "easy", "coin flip" and "suicide" apart.
// ============================================================================
/**
 * A ship as the predictor sees it. Rich (expert) units also carry: `first` (round-1 volley multiplier: Ambushers
 * defending, Shock Troops attacking), `glass` (takes +1 damage per hit), `dmg` (extra damage per hit in the
 * opening rounds: a Charge), `rout` (a bannered fleet that would rout rather than die if it loses).
 */
export interface SimUnit { hp: number; atk: number; shots: number; sh: number; siege: number; eva: number; cost: number; own?: number; hit?: number; first?: number; glass?: boolean; dmg?: number; rout?: boolean }
interface SimResult { win: boolean; p: number; left: SimUnit[]; garLeft: number; lost: number }

function isScoutFleet(f: Fleet): boolean { return f.ships.every(x => x.cls === 'scout'); }
function unitsKey(f: Fleet): string { return f.ships.map(x => `${x.cls[0]}${x.cls[1]}${x.hp}`).join(''); }

export function unitsOf(s: GameState, f: Fleet, defending = false, rich = false): SimUnit[] {
  const R = s.rules;
  // rich (the expert's predictor): the Soul layer's fleet modifiers and ship traits, exposure, routs
  const soul = rich && soulOn(s) && f.owner >= 0;
  const fleetHit = soul ? soulHit(s, f, null, -1, { region: s.regions[f.region], moved: () => !defending, outnumbered: false, enemiesHaunted: false }) : 0;
  const first = soul && ((defending && hasBoon(s, f, 'ambushers')) || (!defending && hasBoon(s, f, 'shock'))) ? 2 : 1;
  const glass = soul && !!f.banner?.banes.includes('glass');
  const rout = soul && !!f.banner && !f.limping && !(f.routs ?? []).some(t => s.turn - t < (s.rules.soul?.routRepeatTurns ?? 4));
  const tired = rich && isExposed(s, f) ? SG(s).ambushFatigueMult : 1;
  return f.ships.map(sh => {
    const d = { ...shipStats(s, sh, f.owner), cost: R.ships[sh.cls].cost };
    let atk = sh.sys.weapons ? d.attack : 0;
    if (f.fatigued) atk = Math.max(1, Math.round(atk * R.overdrive.fatigueAttackMult));
    if (tired !== 1 && atk > 0) atk = Math.max(1, Math.round(atk * tired));
    const eva = d.evasion * (sh.sys.engines ? 1 : 0.3) + (f.fortified && defending ? R.combat.fortifyEvasion : 0);
    // combat.ts hitChance: commander rank, dug-in fleets, the Lens relic (Vanguard depends on the region: see simBattle)
    const hit = (f.commander ? (f.commander.rank - 1) * (R.commanders?.hitBonusPerRank ?? 0) : 0) + (f.fortified && defending ? R.combat.fortifyHitBonus ?? 0 : 0) +
      (f.owner >= 0 && s.players[f.owner]?.relics?.includes('lens') ? 0.04 : 0);
    const u: SimUnit = { hp: sh.hp, atk, shots: sh.sys.weapons ? d.shots : 0, sh: sh.sys.shields ? d.shields : 0, siege: d.siege, eva, cost: (d.cost.industry ?? 0) + (d.cost.credits ?? 0), own: f.owner, hit };
    if (rich) {
      u.hit = hit + fleetHit + (sh.traits?.length ? traitFx(sh).hit : 0);
      if (first !== 1) u.first = first;
      if (glass) u.glass = true;
      if (rout) u.rout = true;
    }
    return u;
  });
}
function unitsCost(u: SimUnit[]): number { return u.reduce((a, x) => a + x.cost, 0); }

/** Attacker units A vs defender units D (+ a garrison of `gar` hp behind `fort` fortress levels). */
function simBattle(s: GameState, rid: number, A: SimUnit[], D: SimUnit[], gar: number, fort: number, retreatA: number, o: { first?: 'a' | 'd' } = {}): SimResult {
  const R = s.rules, C = R.combat, G = R.garrison;
  const neb = s.regions[rid].feature === 'nebula' ? C.nebulaHitPenalty : 0;
  type U = SimUnit & { cur: number; pend: number; gar?: boolean };
  const a: U[] = A.map(u => ({ ...u, cur: u.hp, pend: 0 }));
  const d: U[] = D.map(u => ({ ...u, cur: u.hp, pend: 0 }));
  const garU: U = { hp: gar, atk: 0, shots: 0, sh: 0, siege: 0, eva: 0, cost: 0, cur: gar, pend: 0, gar: true };
  const reg = s.regions[rid];
  const armor = G.armor + fort * G.armorPerFortress + (reg.buildings.pshield ? R.empire.pshieldReduction : 0);
  const bat = reg.buildings.battery ?? 0;
  const shieldCap = R.shieldsCap?.maxReduction ?? 1; // shields absorb at most this share of a hit
  const hp = (xs: U[]) => xs.reduce((t, x) => t + Math.max(0, x.cur), 0);
  const a0 = hp(a) || 1, d0 = hp(d) + gar || 1;
  // combat.ts: Vanguard ships hit harder away from home; Alpha Strike multiplies every ship's first-round volley (rules.empire.alphaMult).
  // A sim round fires every ship's every shot; a real round fires only the frontline (frontageBase +
  // frontagePerShip x armed ships) at `lethality`. So the one doubled real round is worth
  // lethality x frontline/armed extra sim volleys, not a whole doubled sim round.
  const bonusOf = (u: SimUnit) => (u.hit ?? 0) + (u.own !== undefined && u.own >= 0 && reg.owner !== u.own && hasLaw(s, u.own, 'vanguard') ? R.empire.vanguardHit : 0) + (u.own !== undefined && u.own >= 0 && hasTech(s, u.own, 'scanners') ? R.empire.scannersHit : 0);
  const alphaMult = (side: SimUnit[]) => {
    const armed = side.filter(u => u.atk > 0 && u.shots > 0).length || 1;
    const width = Math.min(C.frontage ?? armed, (C.frontageBase ?? armed) + Math.floor(armed * (C.frontagePerShip ?? 0)));
    return 1 + (R.empire.alphaMult - 1) * Math.max(0, Math.min(1, C.lethality ?? 1)) * Math.min(1, width / armed);
  };
  const alphaA = alphaMult(A), alphaD = alphaMult(D);
  // rich units: a doubled first volley (Ambushers / Shock Troops) is scaled to one real round, like Alpha Strike
  const firstMult = (side: SimUnit[], u: SimUnit) => (u.first && u.first !== 1 ? 1 + (u.first - 1) * (alphaMult(side) - 1) / Math.max(0.01, R.empire.alphaMult - 1) : 1);
  const volley = (u: SimUnit, round: number, m: number, side: SimUnit[] = []) => (u.atk > 0 ? u.shots : 0) * (round === 1 && u.own !== undefined && u.own >= 0 && hasTech(s, u.own, 'alpha') ? m : 1) * (round === 1 ? firstMult(side, u) : 1);
  const chargeRounds = SG(s).chargeRounds;
  const fire = (shooters: { atk: number; shots: number; siege: number; bonus: number; dmg?: number }[], targets: U[]) => {
    const live = targets.filter(t => t.cur > 0).sort((x, y) => x.cur - y.cur);
    let i = 0;
    for (const sh of shooters) for (let k = 0; k < sh.shots; k++) {
      while (i < live.length && live[i].cur - live[i].pend <= 0) i++;
      if (i >= live.length) return;
      const t = live[i];
      const ph = Math.max(0.1, Math.min(0.95, C.baseHit + sh.bonus - t.eva - neb));
      const dmg = (t.gar ? Math.max(reg.buildings.pshield ? 0 : 1, sh.atk - armor) + sh.siege : Math.max(1, Math.ceil(sh.atk * (1 - shieldCap)), sh.atk - t.sh) + (t.glass ? 1 : 0)) + (sh.dmg ?? 0);
      t.pend += ph * dmg * Math.min(1, sh.shots - k);   // a fractional last shot (Alpha Strike) counts in part
    }
  };
  let retreated: 'a' | 'd' | null = null;
  for (let round = 1; round <= C.maxRounds; round++) {
    const la = a.filter(u => u.cur > 0), ld = d.filter(u => u.cur > 0);
    if (!la.length || (!ld.length && garU.cur <= 0)) break;
    const dTargets = garU.cur > 0 ? [...ld, garU] : ld;
    const land = () => { for (const u of [...a, ...d, garU]) { u.cur -= u.pend; u.pend = 0; } };
    const aFire = () => fire(a.filter(u => u.cur > 0).map(u => ({ atk: u.atk, shots: volley(u, round, alphaA, A), siege: u.siege, bonus: bonusOf(u), dmg: round <= chargeRounds ? u.dmg : 0 })), dTargets);
    const dFire = () => {
      const dShooters: { atk: number; shots: number; siege: number; bonus: number; dmg?: number }[] = d.filter(u => u.cur > 0).map(u => ({ atk: u.atk, shots: volley(u, round, alphaD, D), siege: u.siege, bonus: bonusOf(u), dmg: round <= chargeRounds ? u.dmg : 0 }));
      if (garU.cur > 0) dShooters.push({ atk: G.attackBase + fort * G.attackPerFortress + bat * R.empire.batteryAttack, shots: G.shotsBase + fort * G.shotsPerFortress + bat * R.empire.batteryShots + Math.floor(garU.cur / G.hpPerShot), siege: 0, bonus: 0.05 });
      fire(dShooters, a.filter(u => u.cur > 0));
    };
    // postures: a side with first strike lands its first volley before the other fires
    if (round === 1 && o.first === 'a') { aFire(); land(); dFire(); }
    else if (round === 1 && o.first === 'd') { dFire(); land(); aFire(); }
    else { aFire(); dFire(); }
    land();
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
  const left = a.filter(u => u.cur > 0.5).map(u => ({ hp: u.cur, atk: u.atk, shots: u.shots, sh: u.sh, siege: u.siege, eva: u.eva, cost: u.cost, own: u.own, hit: u.hit, glass: u.glass, rout: u.rout }));
  // a beaten bannered fleet routs (rich units): its last hulls limp home instead of dying, so a defeat costs less
  const lost = a.reduce((t, u) => t + (u.cur <= 0.5 ? u.cost * (!win && u.rout ? 0.75 : 1) : u.cost * (1 - u.cur / u.hp) * 0.3), 0);
  return { win, p, left, garLeft: Math.max(0, garU.cur), lost };
}

/**
 * UI helper: predicted odds that `fleetIds` (as they are now) take `target` in one seize,
 * against visible hostile fleets there plus the garrison. Pure and deterministic.
 */
export function predictAssault(s: GameState, pid: PlayerId, fleetIds: number[], target: RegionId): { p: number; win: boolean; note: string } {
  const R = s.rules, t = s.regions[target];
  const mine = s.fleets.filter(f => fleetIds.includes(f.id) && f.owner === pid && f.ships.length);
  if (!t || !mine.length) return { p: 0, win: false, note: 'no fleet selected' };
  const A = mine.flatMap(f => unitsOf(s, f));
  const foes = s.fleets.filter(f => f.region === target && f.ships.length && f.owner !== pid && hostile(s, f.owner, pid));
  const fort = t.buildings.fortress ?? 0;
  // fogged garrisons may arrive as -1: assume the starting/max strength
  const gar = t.garrison >= 0 ? t.garrison : t.owner === null ? (t.baseGarrison ?? 0) : maxGarrison(s, target);
  let res: SimResult;
  if (foes.length) {
    const garHelps = t.owner !== null && foes.some(f => f.owner === t.owner);
    const b1 = simBattle(s, target, A, foes.flatMap(f => unitsOf(s, f, true)), garHelps ? gar : 0, fort, 0.35);
    if (!b1.win) res = b1;
    else { const b2 = simBattle(s, target, b1.left, [], b1.garLeft || (garHelps ? 0 : gar), fort, 0.35); res = { ...b2, p: Math.min(b1.p, b2.p), lost: b1.lost + b2.lost }; }
  } else res = gar > 0 ? simBattle(s, target, A, [], gar, fort, 0.35) : { win: true, p: 0.98, left: A, garLeft: 0, lost: 0 };
  // hint: what decides this fight
  const armor = R.garrison.armor + fort * R.garrison.armorPerFortress + (t.buildings.pshield ? R.empire.pshieldReduction : 0);
  const blocked = A.filter(u => u.atk - armor <= 0 && u.siege === 0).length;
  let note: string;
  if (foes.length) note = `rival fleet of ${foes.reduce((n, f) => n + f.ships.length, 0)} ship${foes.reduce((n, f) => n + f.ships.length, 0) > 1 ? 's' : ''} defends${gar > 0 ? `, backed by a garrison of ${gar}` : ''}`;
  else if (gar > 0 && blocked * 2 > A.length) note = `armor ${armor} blocks most of your fire — bring bombards`;
  else if (gar > 0) note = `garrison ${gar}${fort ? ` behind fortress ${fort}` : ''}`;
  else note = 'undefended';
  if (!res.win && res.p < 0.3) note += ' (likely repulsed)';
  return { p: Math.round(res.p * 100) / 100, win: res.win, note };
}

/**
 * The AI's view of the world: exactly what a human in this seat would be sent (viewFor: no
 * unseen fleets, no rival stockpiles or doctrines, fogged rival garrisons and projects), unless
 * rules.ai.cheatVision. Always a private copy: planning never writes through to s0.
 */
function perceive(s0: GameState, pid: PlayerId): GameState {
  const s = s0.rules.ai?.cheatVision ? structuredClone({ ...s0, last: null, log: [] }) as GameState
    : viewFor({ ...s0, last: null, log: [] }, pid).state;
  // a fogged state hides rival garrisons as -1: plan against the likely strength instead
  for (const r of s.regions) if (!(r.garrison >= 0)) r.garrison = r.owner === null ? Math.max(0, r.baseGarrison ?? 0) : maxGarrison(s, r.id);
  // per-turn counters still hold last turn's values until the resolver resets them: a WEGO turn
  // (or the first tick of a LIVE cycle) starts fresh, so plan as if they were already reset
  const L = s.live, per = Math.max(1, Math.floor(s.rules.live?.ticksPerCycle ?? 8) || 1);   // as live.ts ticksPerCycle()
  if (!L || L.tick % per === 0) {
    for (const f of s.fleets) f.ordersThisTurn = 0;
    for (const p of s.players) p.researched = 0;
  }
  // old saves may lack Empire-layer fields
  for (const p of s.players) { p.techs ??= []; p.laws ??= []; p.blueprint ??= {}; p.pactOffers ??= []; }
  s.engagements ??= [];
  s.scans ??= [];
  return s;
}

function enemyPowerNear(s: GameState, pid: PlayerId, rid: number, range: number): number {
  const area = within(s, rid, range);
  return s.fleets.filter(f => f.ships.length && area.has(f.region) && hostile(s, f.owner, pid)).reduce((a, f) => a + fleetPower(s, f), 0);
}

export { EDICTS };
