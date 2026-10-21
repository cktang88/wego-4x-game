// AI for the signature mechanics (docs/SIGNATURE.md): postures, world postures, Fate.
// Called by planTurn AFTER the orders are chosen (a posture is a bet on what this turn's orders run into).
// Deterministic: decisions use the planning state and a seeded hash, never Math.random.
// Balance-sim hook: globalThis.__tcNoCharge = true makes the AI never Charge (scripts/simulate.ts --no-charge).
//   novice   – rarely: a naive posture now and then (Running when moving, Charge when attacking, Guarded at home).
//   standard – simple reads: Guarded when a rival fleet is next door, Running on clear roads, Charge at
//              garrisons that rarely brace; Last Stand at a Crown; spends spare Fate at the end.
//   expert   – reads the threat map and the battle predictor: Guarded where an attack is likely and it means to
//              hold, Running only where nothing can intercept, Charge when the defender has no reason to brace
//              (and reads the defender's habits and skill), an occasional Ambush on an enemy's road, the Levies
//              where a siege is all but certain, Scorched Earth on what can't be held, and Fate at decisive moments.
import { hashString } from './rng.ts';
import { findPath, fleetPower, fleetSpeed, within } from './graph.ts';
import { posturesOn, worldPosturesOn, fateOn, postureBlock, wpostureBlock, fateBlock, fateLeft, isDugIn, SG } from './signature.ts';
import type { Fleet, FreeAction, GameState, Order, PlayerId, Posture, Region, RegionId, Submission } from './types.ts';

type Level = 'novice' | 'standard' | 'expert';
export interface SigCtx {
  s: GameState;
  pid: PlayerId;
  lvl: Level;
  orders: (Order | null)[];
  threatened: Map<number, number>;
  /** Predicted odds that these fleets take region rid now (the planner's battle predictor). */
  odds: (fleets: Fleet[], rid: RegionId) => number;
  /** Predicted odds that `mine` beat `theirs` in a fight at rid (mine defending when `hold`). */
  duel: (mine: Fleet[], theirs: Fleet[], rid: RegionId, hold: boolean) => number;
  /** Is this fight in the balance (the predicted winner flips if our side were a third weaker or half again stronger)? */
  close: (mine: Fleet[], theirs: Fleet[], rid: RegionId, hold: boolean) => boolean;
  /** Expert: the rivals' plans as their own planners would make them from what we can see (null = no read). */
  rivals?: { p: PlayerId; sub: Submission }[] | null;
  /** The same read, already digested (readRivals). */
  read?: RivalRead | null;
}
export type RivalRead = ReturnType<typeof readRivals>;

const hostileP = (s: GameState, a: number, b: number) => {
  if (a === b) return false;
  if (a === -1 || b === -1) return true;
  return !s.pacts.some(x => x.until >= s.turn && ((x.a === a && x.b === b) || (x.a === b && x.b === a)));
};
const links = (s: GameState, rid: RegionId) => s.regions[rid].links ?? s.regions[rid].neighbors;
const isScouts = (f: Fleet) => f.ships.every(x => x.cls === 'scout');
const keyWorld = (s: GameState, r: Region, pid: PlayerId) => r.kind === 'crown' || r.kind === 'throne' || r.kind === 'home' || r.id === s.players[pid].capital;

/** How likely `defender` braces (Guarded fleets / Call the Levies) against an attack it can see coming. */
export function braceChance(s: GameState, attacker: PlayerId, target: Region): number {
  const S = SG(s);
  const foes = s.fleets.filter(f => f.region === target.id && f.ships.length && hostileP(s, f.owner, attacker));
  const owner = target.owner;
  if (owner === null && !foes.some(f => f.owner >= 0)) return target.garrison > 0 || foes.length ? S.neutralBraceChance : 0;
  const who = owner ?? foes.find(f => f.owner >= 0)!.owner;
  const p = s.players[who];
  if (!p) return S.neutralBraceChance;
  // read the house: its skill (AI), and how often rivals have seen it brace before
  const log = p.postureLog ?? {};
  const seen = Object.values(log).reduce((a, b) => a + b, 0);
  const braces = (log.guarded ?? 0) + (log.levies ?? 0);
  const habit = (braces + 1) / (seen + 4);
  const skill = p.kind === 'ai' ? (p.aiLevel === 'expert' ? 0.45 : p.aiLevel === 'standard' ? 0.25 : 0.05) : 0.3;
  // a garrison alone braces only with the Levies (rare); a fleet sitting on its own world braces more often
  const fleetsHere = foes.some(f => f.owner === who);
  const base = fleetsHere ? skill : skill * 0.4;
  return Math.max(0.02, Math.min(0.9, 0.6 * base + 0.4 * habit * (fleetsHere ? 1 : 0.5)));
}

export function sigFree(c: SigCtx): FreeAction[] {
  const { s, pid, lvl } = c;
  const out: FreeAction[] = [];
  if (!posturesOn(s) && !worldPosturesOn(s) && !fateOn(s)) return out;
  const expert = lvl === 'expert', novice = lvl === 'novice';
  const live = !!s.live;
  // LIVE: a posture set now lasts only what is left of this cycle, and undecided bets are judged when it ends.
  // A stationary bet (Guarded, Ambush, the Levies, Scorched Earth) taken late would just backfire (dug in,
  // exposed, output or development lost), so the AI only makes them in the first half of a cycle.
  const per = Math.max(1, Math.floor(s.rules.live?.ticksPerCycle ?? 8) || 1);   // as live.ts ticksPerCycle()
  const lateCycle = live && per - ((s.live!.tick ?? 0) % per) < Math.max(2, Math.ceil(per / 2));
  const S = SG(s);
  const me = s.players[pid];
  const roll = (k: string) => (hashString(`${s.seed}:${s.turn}:${pid}:${k}`) % 1000) / 1000;
  const mine = s.fleets.filter(f => f.owner === pid && f.ships.length && f.id >= 0);
  const orders = c.orders.filter((o): o is Order => !!o);
  const seizeOf = (f: Fleet) => orders.find(o => o.type === 'seize' && (o.fleet === f.id || (o.also ?? []).includes(f.id))) as Extract<Order, { type: 'seize' }> | undefined;
  const moveOf = (f: Fleet) => orders.find(o => o.type === 'move' && o.fleet === f.id) as Extract<Order, { type: 'move' }> | undefined;
  const foesNear = (rid: RegionId, extra = 1) => s.fleets.filter(x => x.ships.length && hostileP(s, x.owner, pid) && x.owner !== -1 && !x.limping && within(s, x.region, Math.max(1, fleetSpeed(s, x)) + extra).has(rid));
  const power = (fs: Fleet[]) => fs.reduce((a, f) => a + fleetPower(s, f), 0);
  const read = c.read ?? (c.rivals ? readRivals(s, pid, c.rivals) : null);

  // ------------------------------------------------------------------ fleet postures
  if (posturesOn(s)) {
    let ambushes = 0;
    for (const f of mine) {
      if (isScouts(f)) continue;
      const here = s.regions[f.region];
      const sz = seizeOf(f), mv = moveOf(f);
      const travelling = !!f.route && f.route.path.length > 0 && !sz && !mv;
      let pick: Posture | null = null;
      if (novice) {
        // naive and rare: a posture now and then, whatever the situation
        if (roll(`nov:${f.id}`) < 0.1) {
          if (sz && !live) pick = 'charge';
          else if (mv || travelling) pick = 'running';
          else if (here.owner === pid && !lateCycle) pick = 'guarded';
        }
      } else if (sz) {
        // Charge: only when the defender has no reason to brace
        if (!live && !f.limping) {
          const t = s.regions[sz.target];
          let bc = braceChance(s, pid, t);
          // the read: will the defenders brace (their own planners Guard the fleets there or Call the Levies)?
          if (read && t.owner !== null) bc = read.levies.has(t.id) || s.fleets.some(x => x.region === t.id && read.braced.has(x.id)) ? 0.9 : Math.min(bc, 0.1);
          const limit = expert ? 0.35 : 0.25;
          if (!(globalThis as { __tcNoCharge?: boolean }).__tcNoCharge && bc < limit && (expert || roll(`chg:${f.id}`) < 0.5)) pick = 'charge';
        }
      } else if (mv || travelling) {
        // Running: only on a road it believes clear, and only when the extra speed gets it somewhere sooner
        const path = mv ? mv.path : f.route!.path;
        const sp = Math.max(1, fleetSpeed(s, f));
        const dest = s.regions[path[path.length - 1]];
        const leg = path.slice(0, sp + S.runningSpeed);
        const hostileAt = (rid: RegionId) => s.fleets.some(x => x.region === rid && x.ships.length && hostileP(s, x.owner, pid)) || (s.regions[rid].owner !== null && s.regions[rid].owner !== pid && hostileP(s, s.regions[rid].owner!, pid) && s.regions[rid].garrison > 0);
        const clearRoad = !leg.some(hostileAt) && !(dest.owner !== null && dest.owner !== pid && hostileP(s, dest.owner, pid));
        // experts also fear anything that could reach the road this turn; standard players only look at the road itself
        const watched = expert ? (read ? leg.some(rid => (read.enters.get(rid) ?? []).length > 0) : leg.some(rid => foesNear(rid, 0).length > 0)) : false;
        if (path.length > sp && clearRoad && !watched && (expert || roll(`run:${f.id}`) < 0.5)) pick = 'running';
      } else if (!f.limping && !isDugIn(s, f) && !lateCycle) {
        // standing still: Guarded where an attack is likely and it means to hold; (expert) Ambush on an enemy's road
        // rival fleets that can strike here this turn
        const foes = s.fleets.filter(x => x.ships.length && x.owner >= 0 && hostileP(s, x.owner, pid) && !x.limping && !isScouts(x) && x.region !== here.id && within(s, x.region, Math.max(1, fleetSpeed(s, x))).has(here.id));
        if (here.owner === pid && foes.length) {
          const defenders = mine.filter(x => x.region === here.id);
          let likely: boolean;
          if (expert && read) {
            // the read: do the rivals' own plans bring a warfleet in here this turn?
            const coming = (read.enters.get(here.id) ?? []).filter(x => !isScouts(x));
            likely = coming.length > 0 && c.duel(defenders, coming, here.id, true) >= 0.3;
          } else if (expert) {
            // a rival attacks where it expects to win: read its odds with our predictor; it goes for what is worth taking
            const theirOdds = c.odds(foes, here.id);
            const worth = keyWorld(s, here, pid) || here.dev >= 3 || (c.threatened.get(here.id) ?? 0) > 0.5;
            likely = theirOdds >= 0.4 && (worth || theirOdds >= 0.65) && c.duel(defenders, foes, here.id, true) >= 0.3;
          } else {
            // standard: a big rival force next door to something that matters
            likely = keyWorld(s, here, pid) && power(foes.filter(x => links(s, x.region).includes(here.id))) > 0.8 * (power(defenders) + here.garrison * 0.5) && roll(`grd:${f.id}`) < 0.5;
          }
          if (likely) pick = 'guarded';
        } else if (expert && read && ambushes < 2 && here.owner !== pid) {
          // the read: a rival warfleet's road runs through (or into) where we already stand, and we'd win the fight
          const coming = (read.enters.get(here.id) ?? []).filter(x => !isScouts(x) && x.owner >= 0);
          if (coming.length && c.duel([f], coming, here.id, true) >= 0.55) { pick = 'ambush'; ambushes++; }
        } else if (expert && !read && !live && ambushes < 1 && here.owner !== pid && roll(`amb:${f.id}`) < 0.5) {
          // Ambush: a rival fleet within reach whose shortest road to one of our key worlds runs through here
          const prey = s.fleets.filter(x => x.ships.length && x.owner >= 0 && hostileP(s, x.owner, pid) && !x.limping && x.region !== here.id && !isScouts(x));
          for (const e of prey) {
            const goals = s.regions.filter(r => r.owner === pid && keyWorld(s, r, pid));
            const road = goals.map(g => findPath(s, e.region, g.id)).filter((p): p is RegionId[] => !!p && p.length <= fleetSpeed(s, e) + 2).sort((a, b) => a.length - b.length)[0];
            if (!road || !road.slice(0, -1).includes(here.id) || road.indexOf(here.id) >= Math.max(1, fleetSpeed(s, e))) continue;
            if (c.duel([f], [e], here.id, true) < 0.6) continue;
            pick = 'ambush';
            ambushes++;
            break;
          }
        }
      }
      if (pick && !postureBlock(s, pid, f, pick)) {
        out.push({ type: 'posture', fleet: f.id, posture: pick });
        f.posture = pick;   // planning copy only
      }
    }
  }

  // ------------------------------------------------------------------ world postures (rare and sensible)
  if (worldPosturesOn(s) && !novice) {
    let n = 0;
    for (const r of s.regions) {
      if (n >= (read ? 2 : 1) || r.owner !== pid || r.kind === 'lane' || r.kind === 'void') continue;
      const foes = foesNear(r.id);
      const defenders = mine.filter(f => f.region === r.id && !f.limping);
      const threat = c.threatened.get(r.id) ?? 0;
      let kind: 'levies' | 'scorch' | 'gates' | null = null;
      const coming = read ? (read.enters.get(r.id) ?? []).filter(x => !isScouts(x)) : [];
      if (expert && read) {
        // the read: an assault lands here this turn
        if (coming.length && r.garrison > 0) {
          const odds = c.odds(coming, r.id);
          if (r.id !== me.capital && !defenders.length && odds > 0.9 && (r.dev >= 3 || r.story?.calling)) kind = 'scorch';
          else if (odds > 0.1 && odds < 0.97) kind = 'levies';
        }
      } else if (foes.length && keyWorld(s, r, pid)) {
        const odds = c.odds(foes.filter(x => links(s, x.region).includes(r.id) || x.region === r.id), r.id);
        if (expert) {
          // Scorched Earth: it will fall and we can't stop it: leave them ashes (never the capital)
          if (r.id !== me.capital && !defenders.length && odds > 0.85 && (r.dev >= 3 || r.story?.calling)) kind = 'scorch';
          // Call the Levies: a siege is all but certain, and the extra walls could hold it
          else if (threat > 0.6 && odds > 0.35 && odds < 0.9) kind = 'levies';
        } else if (odds > 0.5 && odds < 0.9 && roll(`lev:${r.id}`) < 0.3) kind = 'levies';
      }
      if (lateCycle) kind = null;   // too late in the cycle for an assault to land (Gates below is harmless)
      if (!kind && expert && !foes.length) {
        // Open the Gates: a battered ally's fleet sits here
        const ally = s.fleets.find(x => x.region === r.id && x.owner >= 0 && x.owner !== pid && !hostileP(s, x.owner, pid) && x.ships.some(sh => sh.hp < sh.maxHp * 0.7));
        if (ally) kind = 'gates';
      }
      if (kind && !wpostureBlock(s, pid, r.id, kind)) { out.push({ type: 'wposture', region: r.id, posture: kind }); n++; }
    }
  }

  // ------------------------------------------------------------------ Fate (at decisive moments)
  if (fateOn(s) && fateLeft(s, pid) > 0) {
    const left = fateLeft(s, pid);
    // the game is about to end (tokens are worth nothing after it): the turn limit, or someone close to the VP target
    const late = s.rules.victory.turnLimit - s.turn <= 1 || (s.rules.victory.mode === 'vp' && Math.max(...s.players.map(p => p.vp)) >= s.rules.victory.vpTarget - 5);
    const legend = (f: Fleet) => f.commander.rank >= 3 || (f.epithets?.length ?? 0) > 0;
    const engaged = (f: Fleet) => {
      if (!(s.engagements ?? []).some(e => e.region === f.region)) return false;
      const r = s.regions[f.region];
      return s.fleets.some(x => x.region === f.region && x.ships.length && hostileP(s, x.owner, pid)) || (r.garrison > 0 && f.siege === r.id && (r.owner === null || hostileP(s, r.owner, pid)));
    };
    const tryFate = (fa: FreeAction & { type: 'fate' }) => { if (!fateBlock(s, pid, fa.use, fa.fleet, fa.region)) { out.push(fa); return true; } return false; };
    let done = false;
    if (novice) {
      if (roll('nfate') < 0.06) {
        const f = mine.find(x => engaged(x) && !x.limping);
        if (f) done = tryFate({ type: 'fate', use: 'laststand', fleet: f.id });
      }
      if (!done && late) done = tryFate({ type: 'fate', use: 'surge', region: me.capital });
    } else {
      // Last Stand: a valuable fleet in a close battle for a Crown, the Throne or our capital
      const prize = (r: Region) => r.kind === 'crown' || r.kind === 'throne' || r.kind === 'home' || r.id === me.capital;
      const ranked = mine.filter(f => !f.limping && !isScouts(f)).sort((a, b) => fleetPower(s, b) - fleetPower(s, a));
      for (const f of ranked) {
        if (done) break;
        const valuable = legend(f) || (ranked.indexOf(f) < 2 && f.ships.length >= 3);
        if (!valuable) continue;
        const sz = seizeOf(f);
        const at = sz ? s.regions[sz.target] : s.regions[f.region];
        if (!prize(at)) continue;
        let close = false;
        const here = mine.filter(x => x.region === at.id && !x.limping);
        if (sz) {
          const group = mine.filter(x => x.id === sz.fleet || (sz.also ?? []).includes(x.id));
          close = c.close(group.length ? group : [f], s.fleets.filter(x => x.region === at.id && x.ships.length && hostileP(s, x.owner, pid)), at.id, false);
        } else if (engaged(f)) {
          close = c.close(here, s.fleets.filter(x => x.region === at.id && x.ships.length && hostileP(s, x.owner, pid)), at.id, at.owner === pid);
        } else if (expert && read && at.owner === pid) {
          // the read: a rival warfleet comes for this prize this turn, and holding it is in the balance
          const coming = (read.enters.get(at.id) ?? []).filter(x => !isScouts(x));
          if (coming.length) close = c.close(here, coming, at.id, true);
        }
        if (!close) continue;
        if (!expert && !engaged(f)) continue;   // standard: only once the battle is on
        // a legend (or the main army) makes its Last Stand; an expert shields a lesser fleet with a Twist of Fate instead
        done = tryFate({ type: 'fate', use: expert && !legend(f) ? 'twist' : 'laststand', fleet: f.id });
      }
      // Rally a limping legend
      if (!done) for (const f of mine) {
        if (!f.limping || !legend(f)) continue;
        if (left < 2 && !late && f.commander.rank < 4) continue;
        if (s.fleets.some(x => x.ships.length && hostileP(s, x.owner, pid) && x.region === f.region)) continue;
        done = tryFate({ type: 'fate', use: 'rally', fleet: f.id });
        if (done) break;
      }
      // Hyperjump (expert): a fleet racing home to a key world under threat, just out of reach
      if (!done && expert && !live) for (const o of orders) {
        if (o.type !== 'move') continue;
        const f = mine.find(x => x.id === o.fleet);
        const dest = s.regions[o.path[o.path.length - 1]];
        if (!f || dest.owner !== pid || (c.threatened.get(dest.id) ?? 0) < 0.5) continue;
        const sp = Math.max(1, fleetSpeed(s, f));
        if (o.path.length <= sp || o.path.length > sp + S.hyperjumpSteps) continue;
        done = tryFate({ type: 'fate', use: 'hyperjump', fleet: f.id });
        if (done) break;
      }
      // Surge: the game is ending (tokens are worth nothing after), or (expert) a key build is out of reach
      if (!done && (late || (expert && left >= 2 && c.threatened.size && me.res.industry < 40 && s.turn >= 6))) {
        const best = s.regions.filter(r => r.owner === pid && r.kind !== 'lane').sort((a, b) => (b.kind === 'home' ? 1 : 0) - (a.kind === 'home' ? 1 : 0) || b.dev - a.dev || a.id - b.id)[0];
        if (best) done = tryFate({ type: 'fate', use: 'surge', region: best.id });
      }
    }
  }
  return out;
}

/** What the rivals' predicted plans would do this turn: where their fleets go, who braces. */
export function readRivals(s: GameState, pid: PlayerId, rivals: { p: PlayerId; sub: Submission }[]) {
  const enters = new Map<RegionId, Fleet[]>();
  const braced = new Set<number>();
  const levies = new Set<RegionId>();
  const add = (rid: RegionId, f: Fleet) => { const l = enters.get(rid) ?? []; if (!l.includes(f)) l.push(f); enters.set(rid, l); };
  for (const { p, sub } of rivals) {
    if (!hostileP(s, p, pid)) continue;
    const ordered = new Set<number>();
    for (const o of sub.orders) {
      if (!o) continue;
      if (o.type === 'seize') {
        for (const id of [o.fleet, ...(o.also ?? [])]) {
          const f = s.fleets.find(x => x.id === id && x.owner === p && x.ships.length);
          if (!f) continue;
          ordered.add(f.id);
          for (const r of id === o.fleet ? (o.via ?? []) : []) add(r, f);
          add(o.target, f);
        }
      } else if (o.type === 'move') {
        const f = s.fleets.find(x => x.id === o.fleet && x.owner === p && x.ships.length);
        if (!f) continue;
        ordered.add(f.id);
        for (const r of o.path.slice(0, Math.max(1, fleetSpeed(s, f)) + (o.overdrive ? s.rules.overdrive.speedBonus : 0))) add(r, f);
      }
    }
    // fleets the predicted plan leaves alone: a rival's route is secret (the fogged view has none in WEGO, only the
    // next step in LIVE), so only what is visible counts; otherwise the planner's prediction above is the read
    for (const f of s.fleets) {
      if (f.owner !== p || !f.ships.length || ordered.has(f.id) || !f.route?.path.length) continue;
      for (const r of f.route.path.slice(0, Math.max(1, fleetSpeed(s, f)))) add(r, f);
    }
    for (const fa of sub.free) {
      if (fa.type === 'posture' && fa.posture === 'guarded') braced.add(fa.fleet);
      if (fa.type === 'wposture' && fa.posture === 'levies') levies.add(fa.region);
    }
  }
  return { enters, braced, levies };
}
