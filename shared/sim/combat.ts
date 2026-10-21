// Deterministic, SUSTAINED fleet battles with qualitative damage.
//
// Battles are engagements that persist on the map. Every pulse each engagement
// fights only `combat.roundsPerPulse` rounds, and each side can only bring
// `combat.frontage` ships to bear per round, so big battles take longer, can
// span several turns, and reinforcements arriving mid-battle join in.
// Everything is driven by the shared seeded RNG so every client and the server
// produce identical battles from the same orders.
import { TRAITS } from '../config/content.ts';
import { ordinal } from './setup.ts';
import { shipStats, hasTech, hasLaw } from './empire.ts';
import type { Rng } from './rng.ts';
import type { BattleReport, Engagement, Fleet, GameEvent, GameState, PlayerId, RegionId, Ship, ShotRec, Subsystems } from './types.ts';
import { soulOn, SR, soulHit, soulDmg, soulSiege, soulArmor, soulForceRounds, soulWantsRetreat, hasBoon, hasBane, scarOf, routBlock, routExit, onRankUp, fulfilVow } from './soul.ts';
import { traitFx } from './shiptraits.ts';
import { distance } from './graph.ts';
import { battleBody, battleName, tributeCovers } from './systems.ts';
import { sigOn, effStance, sigRound, sigCanFire, sigFirst, sigHit, sigDmg, sigTaken, sigAtk, sigAfterRound, fateStand, fateOf, fx } from './signature.ts';

type Owner = PlayerId | -1;

interface Unit {
  uid: number;              // ship id, or -region-1 for a garrison
  owner: Owner;
  fleet: Fleet | null;
  ship: Ship | null;        // null => garrison
  pending: number;          // damage queued this round
}

export interface FightOutcome {
  retreats: { fleet: Fleet; to: RegionId }[];
  destroyedFleets: Fleet[];
  /** Set when the engagement is over (nobody left who can fight). */
  ended: boolean;
  winner: Owner | null;
  rounds: number;           // rounds fought in this call
  eng?: Engagement;
  /** Set when the Warden lost its last ship in this call: the player whose fleet sank it (if any). */
  wardenSlayer?: PlayerId;
  /** Soul layer: bannered fleets that ROUTED (keep >= 1 hull, limp home); the resolver moves them to `to`. */
  routs: { fleet: Fleet; to: RegionId; by: PlayerId | -1 }[];
  /** Soul layer: who destroyed each lost fleet (for blood-debts). */
  killers: Map<number, { owner: PlayerId | -1; cmd: string | null }>;
  /** Soul layer: story events raised during the fight (vows kept...). */
  events: GameEvent[];
}

/**
 * Are these two sides hostile? With `rid` (star systems): an accepted Tribute between them covers that system,
 * so they don't fight there (it is broken only by a Seize: see resolve.ts).
 */
export function hostile(s: GameState, a: Owner, b: Owner, rid?: RegionId): boolean {
  if (a === b) return false;
  if (a === -1 || b === -1) return true;
  if (rid !== undefined && s.regions[rid]?.tribute && tributeCovers(s, a, b, rid)) return false;
  return !s.pacts.some(p => p.until >= s.turn && ((p.a === a && p.b === b) || (p.a === b && p.b === a)));
}

function traitVal(f: Fleet | null, k: 'hit' | 'evasion' | 'garrisonDmg'): number {
  if (!f) return 0;
  let v = 0;
  for (const t of f.commander.traits) v += (TRAITS[t] as any)?.[k] ?? 0;
  return v;
}

export function engagementAt(s: GameState, rid: RegionId): Engagement | undefined {
  return (s.engagements ??= []).find(e => e.region === rid);
}

/** Whose garrison is in this fight: the owner's (vs any hostile fleet), or a neutral one (only vs besiegers). */
function garrisonSide(s: GameState, rid: RegionId, fleets: Fleet[]): Owner | null {
  const r = s.regions[rid];
  if (r.garrison <= 0) return null;
  if (r.owner !== null) return fleets.some(f => hostile(s, f.owner, r.owner!, rid)) ? r.owner : null;
  return fleets.some(f => f.siege === rid && f.owner !== -1) ? -1 : null;
}

/** Would anything here shoot at anything else right now? */
export function wouldFight(s: GameState, rid: RegionId): boolean {
  // limping fleets never start fights (they are caught instead: see resolve.ts)
  const here = s.fleets.filter(f => f.region === rid && f.ships.length && !f.limping);
  if (!here.length) return false;
  for (const a of here) for (const b of here) {
    if (a.owner >= b.owner || !hostile(s, a.owner, b.owner, rid)) continue;
    if (effStance(s, a) !== 'evasive' || effStance(s, b) !== 'evasive' || engagementAt(s, rid)) return true;
  }
  return garrisonSide(s, rid, here) !== null;
}

/** A fresh per-turn report for an engagement (one report per engagement per turn). */
export function newReport(s: GameState, eng: Engagement, pulse: number): BattleReport {
  return {
    id: ++s.battleCount, name: eng.name, turn: s.turn, pulse, region: eng.region, sides: [], rounds: [], winner: null,
    losses: {}, highlights: [], ongoing: true, day: s.turn - eng.startedTurn + 1, totalRounds: eng.rounds, engagement: eng.id,
  };
}

/**
 * Fight up to `maxRounds` rounds of the engagement in region `rid` (creating it if needed).
 * Appends rounds to `report`. `cameFrom` = where fleets entered from (preferred retreat).
 * With `clash` the fight is a single border exchange that never persists.
 */
export function fightRounds(
  s: GameState, rng: Rng, rid: RegionId, pulse: number, maxRounds: number,
  cameFrom: Map<number, RegionId>, getReport: (eng: Engagement) => BattleReport,
  opts: { clash?: Fleet[]; clashName?: string } = {},
): FightOutcome {
  const R = s.rules;
  const region = s.regions[rid];
  let active = opts.clash ? opts.clash.slice() : s.fleets.filter(f => f.region === rid && f.ships.length && !f.limping);
  const out: FightOutcome = { retreats: [], destroyedFleets: [], ended: false, winner: null, rounds: 0, routs: [], killers: new Map(), events: [] };
  const soul = soulOn(s);
  const sig = sigOn(s);
  const emitSoul = (e: GameEvent) => out.events.push(e);
  /** Soul: fleets routing out of this fight -> their exit. */
  const routing = new Map<Fleet, RegionId>();

  // ---- engagement bookkeeping
  let eng = opts.clash ? undefined : engagementAt(s, rid);
  if (!eng) {
    region.battles++;
    const isSiege = active.some(f => f.siege === rid) && !active.some(f => f.siege !== rid && f.owner !== region.owner);
    const ord = region.battles > 1 ? ordinal(region.battles) + ' ' : '';
    // star systems: the battle is fought over a body ("Battle of the Ashen Belt (Vel)"): a siege over the habitable
    // world or the Station, anything else (an ambush, an interception) at the belt
    const body = opts.clash ? undefined : battleBody(s, region, active.some(f => f.siege === rid));
    const name = opts.clashName ?? battleName(region, body, isSiege ? 'Siege' : 'Battle', ord) ?? `${ord}${isSiege ? 'Siege' : 'Battle'} of ${region.name}`;
    eng = {
      id: s.nextId++, region: rid, name, startedTurn: s.turn, startedPulse: pulse, rounds: 0, forceAt: R.combat.maxRoundsBase,
      startHp: {}, fleets: [], owners: [], losses: {}, lastStand: [], firstBlood: false, garrisonStart: region.garrison,
      hulls: {}, cmds: {},
    };
    if (body !== undefined) { eng.body = body; if (active.some(f => f.siege === rid)) eng.siege = true; }
    if (!opts.clash) s.engagements.push(eng);
  }
  const E = eng;
  out.eng = E;
  const report = getReport(E);
  const hl = (t: string) => { if (report.highlights.length < 16 && !report.highlights.includes(t)) report.highlights.push(t); };

  // ---- (re)joiners: every fleet present joins; reinforcements extend how long the fight can last
  const garrisonFor = (): Owner | null => opts.clash ? null : garrisonSide(s, rid, active);
  for (const f of active) {
    if (!E.fleets.includes(f.id)) {
      E.fleets.push(f.id);
      (E.joined ??= {})[f.id] = E.rounds;
      E.startHp[f.id] = f.ships.reduce((a, x) => a + x.hp, 0) || 1;
      E.forceAt += f.ships.length * R.combat.roundsPerHull;
      E.hulls[f.owner] = (E.hulls[f.owner] ?? 0) + f.ships.length;
      E.cmds[f.commander.name] = f.owner;
      if (E.rounds > 0) hl(`Reinforcements: ${f.name} (${f.ships.length} ship${f.ships.length > 1 ? 's' : ''}) joins the fight.`);
      // rivalry bookkeeping (nemesis / vengeance)
      for (const o of active) {
        if (o === f || !hostile(s, o.owner, f.owner, rid)) continue;
        for (const [x, y] of [[f, o], [o, f]] as const) {
          const rec = x.commander.rivals[y.commander.name] ?? (x.commander.rivals[y.commander.name] = { met: 0, lastWinner: null });
          rec.met++;
          if (rec.met === 3 && x.commander.name < y.commander.name) hl(`${x.commander.name} and ${y.commander.name} meet for the third time. This is personal now.`);
        }
      }
    }
    if (!E.owners.includes(f.owner)) E.owners.push(f.owner);
  }
  // report sides: every ship that fights this turn appears with the hp it had when it first fought this turn
  const sideOf = (o: Owner) => {
    let side = report.sides.find(x => x.owner === o);
    if (!side) { side = { owner: o, fleets: [], ships: [] }; report.sides.push(side); }
    return side;
  };
  const syncSides = () => {
    for (const f of active) {
      const side = sideOf(f.owner);
      if (!side.fleets.some(x => x.id === f.id)) side.fleets.push({ id: f.id, name: f.name, commander: f.commander.name });
      for (const sh of f.ships) if (!side.ships.some(x => x.id === sh.id)) side.ships.push({ id: sh.id, name: sh.name, cls: sh.cls, hp: sh.hp, maxHp: sh.maxHp, fleet: f.id });
    }
    const g = garrisonFor();
    if (g !== null) {
      const side = sideOf(g);
      if (!side.garrison) side.garrison = { id: -rid - 1, hp: region.garrison, maxHp: Math.max(region.garrison, E.garrisonStart) };
    }
  };
  syncSides();

  const lastStand = new Set(E.lastStand);
  const distCache = new Map<string, number>();
  const killedBy = new Map<number, Fleet | null>();
  const hullCount = (o: Owner) => active.filter(f => f.owner === o).reduce((a, f) => a + f.ships.length, 0);

  const units = (): Unit[] => {
    const u: Unit[] = [];
    for (const f of active) for (const sh of f.ships) u.push({ uid: sh.id, owner: f.owner, fleet: f, ship: sh, pending: 0 });
    const g = garrisonFor();
    if (g !== null) u.push({ uid: -rid - 1, owner: g, fleet: null, ship: null, pending: 0 });
    return u;
  };
  // neutral garrisons only trade fire with the fleets besieging them
  const canTarget = (a: Unit, b: Unit): boolean => {
    if (!hostile(s, a.owner, b.owner, rid)) return false;
    const neutralGar = (u: Unit) => !u.ship && region.owner === null;
    if (neutralGar(b) && a.fleet && a.fleet.siege !== rid && a.owner !== -1) return false;
    if (neutralGar(a) && b.fleet && b.fleet.siege !== rid) return false;
    if (b.fleet && a.fleet && effStance(s, a.fleet) === 'evasive' && effStance(s, b.fleet) === 'evasive' && !E.rounds) return false;
    return true;
  };
  const fighting = () => { const u = units(); return u.some(a => u.some(b => canTarget(a, b))); };

  const hitChance = (sh: Unit, tg: Unit): number => {
    let h = R.combat.baseHit;
    const f = sh.fleet;
    if (f) {
      h += (f.commander.rank - 1) * R.commanders.hitBonusPerRank + traitVal(f, 'hit');
      if (f.fortified) h += R.combat.fortifyHitBonus;
      if (lastStand.has(f.id)) h += R.lastStand.hitBonus;
      if (s.players[f.owner]?.relics.includes('lens')) h += 0.04;
      if (region.owner !== f.owner && hasLaw(s, f.owner, 'vanguard')) h += R.empire.vanguardHit;
      if (hasTech(s, f.owner, 'scanners')) h += R.empire.scannersHit;
      if (sh.ship && sh.ship.battles >= R.combat.veteranBattles) h += R.combat.veteranHitBonus;
      if (tg.fleet) {
        const rec = f.commander.rivals[tg.fleet.commander.name];
        if (rec && rec.lastWinner === tg.fleet.commander.name) h += R.vengeance.hitBonus;
        if (rec && rec.met >= 3 && f.commander.traits.includes('nemesis')) h += 0.08;
      }
      if (f.commander.traits.includes('giantkiller')) {
        const mine = hullCount(f.owner), theirs = tg.owner === -1 ? 3 : hullCount(tg.owner);
        h += mine < theirs ? 0.10 : mine > theirs ? -0.05 : 0;
      }
    } else {
      h += 0.05; // garrisons are dug in
    }
    if (region.feature === 'nebula') h -= R.combat.nebulaHitPenalty;
    // Signature: a Guarded fleet that called it counts as fortified (and more); Last Stand hits harder
    if (sig) h += sigHit(s, sh.fleet, tg.fleet, R.combat.fortifyHitBonus, R.combat.fortifyEvasion);
    if (soul) {
      if (sh.ship?.traits) h += traitFx(sh.ship).hit;
      const tf0 = tg.fleet;
      h += soulHit(s, sh.fleet, tf0, tg.owner, {
        region, moved: x => cameFrom.has(x.id),
        outnumbered: hullCount(sh.owner) < Math.max(0, ...active.filter(x => hostile(s, x.owner, sh.owner, rid)).map(x => hullCount(x.owner))),
        enemiesHaunted: active.some(x => hostile(s, x.owner, sh.owner, rid) && !!scarOf(x, 'haunted')),
      });
    }
    if (tg.ship) {
      h -= shipStats(s, tg.ship, tg.owner).evasion * (tg.ship.sys.engines ? 1 : 0.3);
      const tf = tg.fleet!;
      h -= traitVal(tf, 'evasion');
      if (tf.fortified) h -= R.combat.fortifyEvasion;
      if (tf.commander.traits.includes('stalwart') && region.owner === tf.owner) h -= 0.06;
      if (region.feature === 'asteroids' && region.owner === tf.owner) h -= R.combat.asteroidDefenderBonus;
    }
    return Math.max(0.1, Math.min(0.95, h));
  };

  const pickTarget = (sh: Unit, all: Unit[]): Unit | null => {
    const cands = all.filter(t => canTarget(sh, t) && (t.ship ? t.ship.hp - t.pending > 0 : region.garrison - t.pending > 0));
    if (!cands.length) return null;
    const pref = sh.fleet?.doctrine.target ?? 'weakest';
    const hpOf = (t: Unit) => (t.ship ? t.ship.hp : region.garrison) - t.pending;
    const atkOf = (t: Unit) => { if (!t.ship) return 3; const st = shipStats(s, t.ship, t.owner); return st.attack * st.shots; };
    const costOf = (t: Unit) => (t.ship ? (R.ships[t.ship.cls].cost.industry ?? 0) : 999);
    let sorted: Unit[];
    switch (pref) {
      case 'strongest': sorted = cands.sort((a, b) => atkOf(b) - atkOf(a) || hpOf(a) - hpOf(b)); break;
      case 'cheapest': sorted = cands.sort((a, b) => costOf(a) - costOf(b) || hpOf(a) - hpOf(b)); break;
      case 'garrison': sorted = cands.sort((a, b) => (a.ship ? 1 : 0) - (b.ship ? 1 : 0) || hpOf(a) - hpOf(b)); break;
      default: sorted = cands.sort((a, b) => hpOf(a) - hpOf(b));
    }
    // slight spread so whole fleets don't always focus one hull
    return rng.chance(0.8) ? sorted[0] : sorted[Math.min(sorted.length - 1, 1 + Math.floor(rng.next() * 2))];
  };

  /** Frontage: each side brings frontageBase + frontagePerShip x armed ships to bear per round (rotating),
 *  so firepower grows slower than hit points and bigger battles last longer. */
  const frontline = (all: Unit[]): Unit[] => {
    const out: Unit[] = [];
    const owners = [...new Set(all.map(u => u.owner))];
    for (const o of owners) {
      const armed = all.filter(u => u.owner === o && u.ship && u.ship.sys.weapons);
      const gar = all.filter(u => u.owner === o && !u.ship);
      out.push(...gar);
      const width = Math.min(R.combat.frontage, R.combat.frontageBase + Math.floor(armed.length * R.combat.frontagePerShip));
      if (armed.length <= width) { out.push(...armed); continue; }
      out.push(...rng.shuffle(armed.slice()).slice(0, width));
    }
    return out;
  };

  const fire = (shooters: Unit[], targets: Unit[], shots: ShotRec[], volleyMult = 1, firstStrike = false) => {
    for (const sh of shooters) {
      let n: number, atk: number, siege = 0;
      if (sh.ship ? sh.ship.hp <= 0 : region.garrison <= 0) continue;   // killed earlier this round (first strike)
      if (sh.ship) {
        const d = shipStats(s, sh.ship, sh.owner);
        if (!sh.ship.sys.weapons) continue;
        const alpha = volleyMult === 1 && E.rounds === 1 && hasTech(s, sh.owner, 'alpha') ? R.empire.alphaMult : 1;
        // Soul: Ambushers (stood its ground) / Shock Troops (moved in) double their first volley
        const fl = sh.fleet;
        const first = !!fl && soul && volleyMult === 1 && E.rounds === (E.joined?.[fl.id] ?? 0) + 1 &&
          ((hasBoon(s, fl, 'ambushers') && !cameFrom.has(fl.id)) || (hasBoon(s, fl, 'shock') && cameFrom.has(fl.id)));
        n = Math.max(1, Math.round(d.shots * volleyMult * alpha * (first ? 2 : 1)));
        atk = d.attack;
        siege = d.siege + traitVal(sh.fleet, 'garrisonDmg') + (soul ? soulSiege(s, sh.fleet, region) : 0);
        if (sh.fleet?.fatigued) atk = Math.max(1, Math.round(atk * R.overdrive.fatigueAttackMult));
        if (fl && soul && hasBane(s, fl, 'homesick') && fl.banner && homeDist(fl) >= SR(s).homesickJumps) atk = Math.max(1, atk - 1);
        if (sig && fl) atk = Math.max(1, Math.round(atk * sigAtk(s, fl)));
      } else {
        const fort = region.buildings.fortress ?? 0;
        const bat = region.buildings.battery ?? 0;
        n = Math.max(1, Math.round((R.garrison.shotsBase + fort * R.garrison.shotsPerFortress + bat * R.empire.batteryShots + Math.floor(region.garrison / R.garrison.hpPerShot)) * volleyMult));
        atk = R.garrison.attackBase + fort * R.garrison.attackPerFortress + bat * R.empire.batteryAttack;
      }
      // lethality: fraction of a ship's shots that fire each round (stochastic rounding keeps it fair)
      const want = n * R.combat.lethality;
      n = Math.floor(want) + (rng.chance(want - Math.floor(want)) ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const tg = pickTarget(sh, targets);
        if (!tg) break;
        if (!rng.chance(hitChance(sh, tg))) { shots.push({ from: sh.uid, to: tg.uid, dmg: 0, miss: true }); continue; }
        let dmg: number;
        if (!tg.ship) {
          const ps = region.buildings.pshield ? R.empire.pshieldReduction : 0;
          dmg = Math.max(ps ? 0 : 1, atk - (R.garrison.armor + (region.buildings.fortress ?? 0) * R.garrison.armorPerFortress + (soul ? soulArmor(s, region) : 0)) - ps) + Math.max(0, siege);
          if (dmg > 0 && sig) dmg += sigDmg(s, sh.fleet);
          if (dmg <= 0) { shots.push({ from: sh.uid, to: tg.uid, dmg: 0, miss: true }); continue; }
        } else {
          const shd = tg.ship.sys.shields ? shipStats(s, tg.ship, tg.owner).shields : 0;
          dmg = Math.max(1, Math.ceil(atk * (1 - R.shieldsCap.maxReduction)), atk - shd) + (soul ? soulDmg(s, sh.fleet, tg.fleet) : 0);
          if (sig) dmg = Math.ceil((dmg + sigDmg(s, sh.fleet)) * sigTaken(s, tg.fleet));
        }
        tg.pending += dmg;
        const rec: ShotRec = { from: sh.uid, to: tg.uid, dmg };
        if (firstStrike) rec.first = true;
        if (tg.ship && tg.ship.hp - tg.pending > 0 && rng.chance(R.combat.critChance)) {
          const working = (['engines', 'weapons', 'shields'] as (keyof Subsystems)[]).filter(k => tg.ship!.sys[k] && (k !== 'shields' || shipStats(s, tg.ship!, tg.owner).shields > 0));
          if (working.length) rec.crit = rng.pick(working);
        }
        if (tg.ship && tg.ship.hp - tg.pending <= 0 && !killedBy.has(tg.uid)) { rec.kill = true; killedBy.set(tg.uid, sh.fleet); }
        shots.push(rec);
      }
    }
  };

  const loseFleet = (f: Fleet) => {
    if (out.destroyedFleets.includes(f)) return;
    out.destroyedFleets.push(f);
    f.ships = [];
    if (f.owner === -1) return;
    const c = f.commander;
    if (c.name.endsWith('flag captain')) return;
    if (rng.chance(R.commanderFate.dieChance)) {
      c.alive = false;
      region.memorials.push(`${c.name} (rank ${c.rank}${c.traits.length ? ', ' + c.traits.map(t => TRAITS[t]?.name ?? t).join(', ') : ''}) fell with ${f.name} in the ${E.name}, turn ${s.turn}.`);
      hl(`${c.name} goes down with ${f.name}.`);
    } else {
      c.alive = true;
      (s.players[f.owner].reserveCommanders ??= []).push(c);
      hl(`${c.name} escapes the wreck of ${f.name} and will command again.`);
    }
  };

  const apply = (all: Unit[], shots: ShotRec[]) => {
    for (const u of all) {
      if (!u.pending) continue;
      if (u.ship) u.ship.hp = Math.max(0, u.ship.hp - u.pending);
      else region.garrison = Math.max(0, region.garrison - u.pending);
      u.pending = 0;
    }
    // Soul: a bannered fleet about to be wiped out routs instead (unless it must die): its flagship survives
    if (soul) for (const f of active) {
      if (!f.ships.length || f.ships.some(x => x.hp > 0)) continue;
      if (!routing.has(f)) { const exit = routFate(f); if (exit === null) continue; routing.set(f, exit); }
      const flag = f.ships.slice().sort((a, b) => b.maxHp - a.maxHp || a.id - b.id)[0];
      flag.hp = Math.max(1, Math.floor(flag.maxHp * SR(s).routHullCap));
      killedBy.delete(flag.id);
      for (const x of shots) if (x.to === flag.id && x.kill) delete x.kill;
    }
    for (const sh of shots) {
      if (!sh.crit) continue;
      const u = all.find(x => x.uid === sh.to);
      if (u?.ship && u.ship.hp > 0) {
        u.ship.sys[sh.crit] = false;
        const big = R.ships[u.ship.cls].hp >= 20;
        if (sh.crit === 'engines' && (big || !E.firstBlood)) hl(`${u.ship.name}'s engines are knocked out. It can't run now.`);
        if (sh.crit === 'weapons' && big) hl(`${u.ship.name}'s guns fall silent.`);
      }
    }
    for (const f of active) {
      const dead = f.ships.filter(x => x.hp <= 0);
      for (const d of dead) {
        report.losses[f.owner] = (report.losses[f.owner] ?? 0) + 1;
        E.losses[f.owner] = (E.losses[f.owner] ?? 0) + 1;
        region.wreckage++;
        const killer = killedBy.get(d.id);
        if (killer) {
          killer.commander.deeds.kills++;
          killer.commander.xp += R.commanders.xpPerKill;
          const killerShip = shots.find(x => x.to === d.id && x.kill);
          const ks = killerShip && killer.ships.find(x => x.id === killerShip.from);
          if (ks) ks.kills++;
          if (f.owner !== -1 && killer.owner !== -1) s.turnStats.kills[killer.owner] = (s.turnStats.kills[killer.owner] ?? 0) + 1;
        }
        if (!E.firstBlood) { E.firstBlood = true; hl(`First blood: ${d.name} (${R.ships[d.cls].name}) is destroyed.`); }
        if (d.title || d.battles >= R.combat.veteranBattles) {
          hl(`The veteran ${d.name}${d.title ? ' ' + d.title : ''} is lost after ${d.battles} battles.`);
          region.memorials.push(`${d.name}${d.title ? ' ' + d.title : ''}, lost in the ${E.name} (turn ${s.turn})`);
        }
      }
      f.ships = f.ships.filter(x => x.hp > 0);
      if (!f.ships.length) {
        const k = [...dead].reverse().map(d => killedBy.get(d.id)).find(x => x);
        out.killers.set(f.id, k ? { owner: k.owner, cmd: k.commander.name } : { owner: strongestFoe(f.owner), cmd: null });
        if (f.owner === -1 && dead.length) {
          const k = killedBy.get(dead[dead.length - 1].id) ?? [...dead].reverse().map(d => killedBy.get(d.id)).find(x => x);
          if (k && k.owner >= 0) out.wardenSlayer = k.owner;
        }
        loseFleet(f);
      }
    }
    active = active.filter(f => f.ships.length);
  };

  /** Signature, Twist of Fate: the worst enemy volley (one ship's shots) against the fleet in its first exchange this turn misses. */
  const twist = (shots: ShotRec[], all: Unit[]) => {
    for (const f of active) {
      if (fateOf(s, f) !== 'twist' || fx(s, f).twisted) continue;
      const mine = new Set(f.ships.map(x => x.id));
      const hits = shots.filter(x => mine.has(x.to) && x.dmg > 0);
      if (!hits.length) continue;
      const by = new Map<number, number>();
      for (const x of hits) by.set(x.from, (by.get(x.from) ?? 0) + x.dmg);
      let worst = 0, wd = -1;
      for (const [k, d] of by) if (d > wd) { worst = k; wd = d; }
      fx(s, f).twisted = true;
      for (const x of hits) {
        if (x.from !== worst) continue;
        const u = all.find(y => y.uid === x.to);
        if (u) u.pending = Math.max(0, u.pending - x.dmg);
        x.dmg = 0; x.miss = true; x.twist = true;
        delete x.crit; delete x.kill;
      }
      // a ship the negated volley would have killed lives on
      for (const sh of f.ships) {
        const u = all.find(y => y.uid === sh.id);
        if (u && sh.hp - u.pending > 0) { killedBy.delete(sh.id); for (const x of shots) if (x.to === sh.id) delete x.kill; }
      }
      hl(`TWIST OF FATE: the worst volley against ${f.name} goes wide (${wd} damage).`);
    }
  };

  // ---------------------------------------------------------------- rounds
  while (out.rounds < maxRounds && fighting()) {
    // Signature: postures meet reality (called / caught), the Levies rise, battle Fates are marked
    if (sig) {
      const g0 = region.garrison;
      sigRound(s, rng, region, opts.clash ? undefined : E, active, f => cameFrom.has(f.id), pulse, emitSoul, hl);
      if (region.garrison !== g0) for (const side of report.sides) if (side.garrison) { side.garrison.hp = region.garrison; side.garrison.maxHp = Math.max(side.garrison.maxHp, region.garrison); }
    }
    out.rounds++;
    E.rounds++;
    const all = units();
    const shots: ShotRec[] = [];
    const front = frontline(all);
    if (sig) {
      // first strike: those who called it (Guarded, Ambush, an unbraced Charge; the defenders of a broken one)
      // fire and land their hits before everyone else; a Running fleet caught out or a broken charge can't fire
      // its first round, nor can a garrison that opened its gates to the wrong guests
      const roundFleets = active.slice();
      const ok = front.filter(u => sigCanFire(s, u.fleet, region));
      const first = ok.filter(u => sigFirst(s, u.fleet, u.owner, roundFleets));
      const rest = ok.filter(u => !first.includes(u));
      if (first.length) {
        fire(first, all, shots, 1, true);
        twist(shots, all);
        apply(all, shots);
      }
      const later: ShotRec[] = [];
      fire(rest, all, later);
      twist(later, all);
      apply(all, later);
      shots.push(...later);
      sigAfterRound(s, roundFleets, region, all.some(u => !u.ship));
    } else {
      fire(front, all, shots);
      apply(all, shots);
    }
    const rr: BattleReport['rounds'][number] = { shots, retreats: [], pulse };
    report.rounds.push(rr);
    for (const f of [...routing.keys()]) flushRout(f, rr);
    if (opts.clash || !fighting()) break;

    // retreat checks (thresholds are against each fleet's strength when it joined)
    const weak = R.combat.forceDecision ? weakestOwner() : null;
    const forceAt = E.forceAt + (weak !== null && soul ? soulForceRounds(s, active.filter(x => x.owner === weak)) : 0);
    const forced = weak !== null && E.rounds >= forceAt ? weak : null;
    if (forced !== null && E.rounds === forceAt) hl(`After ${E.rounds} rounds, ${forced === -1 ? 'the defenders' : s.players[forced]?.name ?? 'one side'} can fight no longer.`);
    for (const f of active.slice()) {
      if (f.owner === -1) continue;
      const frac = f.ships.reduce((a, x) => a + x.hp, 0) / (E.startHp[f.id] ?? 1);
      // Signature: a Last Stand (Fate) never leaves this turn: not by choice, not forced
      if (sig && fateStand(s, f)) continue;
      const base = !lastStand.has(f.id) && ((effStance(s, f) === 'evasive' && !hasBane(s, f, 'reckless')) || (f.doctrine.retreatAt > 0 && frac < f.doctrine.retreatAt));
      const wants = forced === f.owner || (!lastStand.has(f.id) && soulWantsRetreat(s, f, frac, base));
      if (!wants) continue;
      // Soul: a bannered fleet forced out of a battle it lost ROUTS (or, if it must, dies)
      if (soul && forced === f.owner && f.banner && f.owner >= 0) {
        const exit = routing.get(f) ?? routFate(f);
        if (exit === null) {
          for (const x of f.ships) { report.losses[f.owner] = (report.losses[f.owner] ?? 0) + 1; E.losses[f.owner] = (E.losses[f.owner] ?? 0) + 1; region.wreckage++; }
          hl(`${f.name} is beaten and has nowhere to run: destroyed to the last hull.`);
          out.killers.set(f.id, { owner: strongestFoe(f.owner), cmd: null });
          loseFleet(f);
          active = active.filter(x => x !== f);
          continue;
        }
        routing.set(f, exit);
        pursue(f, rr);
        flushRout(f, rr);
        continue;
      }
      const to = retreatDest(f);
      const stranded = f.ships.filter(x => !x.sys.engines);
      const cornered = () => {
        if (forced === f.owner) { // nowhere to go and the battle is lost: scuttle
          for (const x of f.ships) { report.losses[f.owner] = (report.losses[f.owner] ?? 0) + 1; E.losses[f.owner] = (E.losses[f.owner] ?? 0) + 1; region.wreckage++; }
          hl(`${f.name} is cornered with nowhere to run and is destroyed to the last hull.`);
          loseFleet(f);
          active = active.filter(x => x !== f);
          return;
        }
        if (!lastStand.has(f.id)) { lastStand.add(f.id); hl(`LAST STAND: ${f.name} can't escape and fights to the end.`); }
      };
      if (to === null || stranded.length === f.ships.length) { cornered(); continue; }
      if (!pursue(f, rr)) { hl(`${f.name} is cut down while fleeing.`); continue; }
      if (routing.has(f)) { flushRout(f, rr); continue; }   // Soul: the parting volley turned the retreat into a rout
      const left = f.ships.filter(x => !x.sys.engines);
      if (left.length === f.ships.length) { cornered(); continue; }
      if (left.length) {
        f.ships = f.ships.filter(x => x.sys.engines);
        const rem: Fleet = {
          ...structuredClone(f), id: s.nextId++, name: `Remnant of ${f.name}`, ships: left,
          commander: { ...structuredClone(f.commander), name: `${f.commander.name}'s flag captain` },
          history: [`Left behind at ${region.name} on turn ${s.turn}.`], siege: null, route: null,
          fate: null,   // Signature: the Fate spent on the fleet stays with it (one token, one Twist / Last Stand)
        };
        rem.commander.alive = true;
        s.fleets.push(rem);
        active.push(rem);
        E.fleets.push(rem.id);
        E.startHp[rem.id] = left.reduce((a, x) => a + x.maxHp, 0);
        lastStand.add(rem.id);
        hl(`${left.map(x => x.name).join(', ')} ${left.length > 1 ? 'have' : 'has'} no engines and must stay behind: last stand.`);
      }
      f.commander.deeds.retreats++;
      f.siege = null;
      if (f.posture === 'ambush') f.posture = null;   // Signature: an ambush driven off is over (it no longer hides or lies still)
      out.retreats.push({ fleet: f, to });
      rr.retreats.push({ owner: f.owner, fleet: f.id, to });
      active = active.filter(x => x !== f);
    }
    active = active.filter(f => f.ships.length);
    syncSides();
  }
  E.lastStand = [...lastStand];

  /** Parting volley at a fleet leaving the fight. Returns false if it didn't survive. */
  function pursue(f: Fleet, rr: BattleReport['rounds'][number]): boolean {
    if (f.commander.traits.includes('survivor') || R.combat.retreatPursuitShots <= 0 || (soul && hasBoon(s, f, 'cleanbreak'))) return true;
    const all2 = units();
    const pursuers = frontline(all2.filter(u => canTarget(u, { uid: 0, owner: f.owner, fleet: f, ship: f.ships[0] ?? null, pending: 0 })));
    const targets = all2.filter(u => u.fleet === f);
    const shots2: ShotRec[] = [];
    const volleys = R.combat.retreatPursuitShots + (soul && pursuers.some(u => u.fleet && hasBoon(s, u.fleet, 'hunters')) ? 1 : 0);
    for (let i = 0; i < volleys; i++) fire(pursuers, targets, shots2, 0.5);
    apply(all2, shots2);
    rr.shots.push(...shots2);
    return f.ships.length > 0;
  }

  /** Side forced out when a battle drags on. A garrison can't leave: if it is the weakest, the siege grinds on. */
  function weakestOwner(): Owner | null {
    const g = garrisonFor();
    const lo = [...new Set([...active.map(f => f.owner), ...(g !== null ? [g] : [])])];
    let worst: Owner | null = null, wf = 2;
    for (const o of lo) {
      const fl = active.filter(f => f.owner === o);
      const cur = fl.reduce((a, f) => a + f.ships.reduce((b, x) => b + x.hp, 0), 0);
      const st = fl.reduce((a, f) => a + (E.startHp[f.id] ?? 1), 0);
      let frac = fl.length ? cur / st : 0;
      if (o === g && region.garrison > 0) frac = Math.max(frac, region.garrison / Math.max(1, E.garrisonStart));
      else if (!fl.length) continue;
      if (frac < wf) { wf = frac; worst = o; }
    }
    if (worst !== null && worst === g && !active.some(f => f.owner === g)) return null;
    return worst;
  }

  /** Soul: where a beaten bannered fleet routs to, or null if it must die (routBlock). */
  function routFate(f: Fleet): RegionId | null {
    if (!soul || !f.banner || f.owner < 0) return null;
    if (sig && fateStand(s, f)) return null;   // a Last Stand does not rout: it dies where it stands
    const exit = opts.clash ? f.region : routExit(s, f, rid, cameFrom.get(f.id));
    // strength committed to this engagement, by side (fleets that already left or died still count)
    const ownerOf = (id: number) => s.fleets.find(x => x.id === id)?.owner;
    const sideStart = (o: Owner) => E.fleets.filter(id => ownerOf(id) === o).reduce((a, id) => a + (E.startHp[id] ?? 0), 0);
    const own = Math.max(E.startHp[f.id] ?? 1, sideStart(f.owner));
    const g = garrisonFor();
    let winner = 0;
    for (const o of new Set([...active.map(x => x.owner), ...(g !== null ? [g] : [])])) {
      if (!hostile(s, o, f.owner, rid)) continue;
      winner = Math.max(winner, sideStart(o) + (o === g ? E.garrisonStart : 0));
    }
    const why = routBlock(s, f, own, winner, exit);
    const dbg = (globalThis as { __tcRoutStats?: Record<string, number> }).__tcRoutStats;
    if (dbg) dbg[why ?? 'rout'] = (dbg[why ?? 'rout'] ?? 0) + 1;
    return why === null ? exit : null;
  }
  /** Soul: the routing fleet leaves the fight. */
  function flushRout(f: Fleet, rr: BattleReport['rounds'][number]) {
    const to = routing.get(f);
    routing.delete(f);
    if (to === undefined || !f.ships.length || !active.includes(f)) return;
    f.commander.deeds.retreats++;
    f.siege = null;
    if (f.posture === 'ambush') f.posture = null;
    out.routs.push({ fleet: f, to, by: strongestFoe(f.owner) });
    rr.retreats.push({ owner: f.owner, fleet: f.id, to });
    hl(`${f.name} ROUTS: ${f.ships.length} battered hull${f.ships.length > 1 ? 's' : ''} limp${f.ships.length > 1 ? '' : 's'} away.`);
    active = active.filter(x => x !== f);
  }
  /** The strongest side hostile to `o` still in the fight (for blood-debts and grudges). */
  function strongestFoe(o: Owner): Owner {
    let best: Owner = region.owner !== null && hostile(s, region.owner, o, rid) ? region.owner : -1, bh = -1;
    for (const x of new Set(active.map(f => f.owner))) {
      if (!hostile(s, x, o, rid)) continue;
      const h = active.filter(f => f.owner === x).reduce((a, f) => a + f.ships.reduce((b, sh) => b + sh.hp, 0), 0);
      if (h > bh) { bh = h; best = x; }
    }
    return best;
  }
  function homeDist(f: Fleet): number {
    const h = f.banner?.home;
    if (h === undefined) return 0;
    const k = `${f.id}`;
    if (!distCache.has(k)) distCache.set(k, distance(s, f.region, h));
    return distCache.get(k)!;
  }

  function retreatDest(f: Fleet): RegionId | null {
    const enemyAt = (r: RegionId) => s.fleets.some(x => x.region === r && x.ships.length && hostile(s, x.owner, f.owner, r) && !active.includes(x));
    const enemyGarrison = (r: RegionId) => { const g = s.regions[r]; return g.owner !== null && g.garrison > 0 && hostile(s, g.owner, f.owner, r); };
    const cf = cameFrom.get(f.id);
    const cfOk = cf !== undefined && cf !== rid && !enemyAt(cf);
    if (cfOk && !enemyGarrison(cf)) return cf;
    const opts2 = (region.links ?? region.neighbors).filter(n => !enemyAt(n));
    const own = opts2.filter(n => s.regions[n].owner === f.owner);
    if (own.length) return rng.pick(own);
    const calm = opts2.filter(n => !enemyGarrison(n));
    if (calm.length) return rng.pick(calm);
    if (cfOk) return cf;
    return opts2.length ? rng.pick(opts2) : null;
  }

  // ---------------------------------------------------------------- end of the engagement?
  if (opts.clash) { report.ongoing = false; return out; }
  report.totalRounds = E.rounds;
  if (!fighting()) {
    out.ended = true;
    report.ongoing = false;
    s.engagements = s.engagements.filter(e => e !== E);
    const survivors = [...new Set(active.map(f => f.owner))];
    const g = garrisonFor() ?? (region.garrison > 0 && E.owners.length ? (region.owner ?? null) : null);
    if (g !== null && !survivors.includes(g)) survivors.push(g);
    out.winner = survivors.length === 1 ? survivors[0] : survivors.length ? (survivors.find(o => active.some(f => f.owner === o)) ?? survivors[0]) : null;
    report.winner = out.winner;
    finish(out.winner);
  }
  return out;

  /** Aftermath once a whole engagement is over: legends, xp, traits, rivalries. */
  function finish(winner: Owner | null) {
    const involved = s.fleets.filter(f => E.fleets.includes(f.id) && f.ships.length);
    const fleetFight = E.owners.length > 1;   // sieges against a lone garrison don't make legends
    if (fleetFight) for (const f of involved) f.ships.forEach(x => (x.battles++));
    for (const f of involved) for (const live of f.ships) {
      if (live.battles === R.combat.veteranBattles && !live.title) {
        live.title = rng.pick(['the Unbowed', 'the Lucky', 'the Grim', 'the Stubborn', 'Who Came Back', 'the Scarred', 'the Patient']);
        hl(`${live.name} survives its ${ordinal(live.battles)} battle and is now known as "${live.name} ${live.title}".`);
      }
    }
    const winnerCmd = involved.filter(f => f.owner === winner).map(f => f.commander.name);
    const salvaged = new Set<Owner>();
    for (const f of involved) {
      const c = f.commander;
      c.xp += fleetFight ? R.commanders.xpPerBattle : 1;
      const won = winner !== null && f.owner === winner;
      if (won) { c.deeds.wins++; if (region.owner === f.owner) c.deeds.defWins++; }
      else c.deeds.losses++;
      if (soul && f.banner && f.owner >= 0 && fleetFight) {
        const t = (f.tally ??= { sieges: 0, defences: 0, interceptions: 0, wins: 0, routs: 0 });
        if (won) {
          t.wins++;
          if (region.owner === f.owner) t.defences++;
          else if (E.fleets.some(id => { const x = s.fleets.find(y => y.id === id); return !!x && x.owner !== f.owner && cameFrom.has(id); })) t.interceptions++;
          if (f.vow?.kind === 'never_retreat' && (f.vow.progress = (f.vow.progress ?? 0) + 1) >= SR(s).vowNeverRetreatWins) fulfilVow(s, f, pulse, emitSoul);
          if (hasBoon(s, f, 'salvagers') && !salvaged.has(f.owner)) {
            salvaged.add(f.owner);
            const wrecks = Object.entries(E.losses).filter(([o]) => Number(o) !== f.owner).reduce((a, [, n]) => a + n, 0);
            if (wrecks) s.players[f.owner].res.industry += wrecks * SR(s).salvageIndustry;
          }
        }
      }
      for (const [rn, rec] of Object.entries(c.rivals)) {
        if (rn in E.cmds && hostile(s, E.cmds[rn], f.owner, rid)) {
          if (won) rec.lastWinner = c.name; else if (winnerCmd.includes(rn)) rec.lastWinner = rn;
        }
      }
      const outnumbered = (E.hulls[f.owner] ?? 0) * 1.5 <= Math.max(0, ...Object.entries(E.hulls).filter(([o]) => Number(o) !== f.owner).map(([, n]) => n));
      earnTraits(f, { won, outnumbered });
      while (c.rank < R.commanders.maxRank && c.xp >= c.rank * R.commanders.xpPerRank) {
        c.rank++;
        hl(`${c.name} is promoted to rank ${c.rank}.`);
        onRankUp(s, f, hl);
      }
      f.history.push(`T${s.turn}: ${won ? 'won' : winner === null ? 'fought' : 'lost'} the ${E.name}${s.turn > E.startedTurn ? ` after ${E.rounds} rounds over ${s.turn - E.startedTurn + 1} turns` : ''}.`);
    }
    if (winner !== null && winner !== -1) {
      s.turnStats.battlesWon[winner]++;
      if (region.kind === 'crown' || region.kind === 'throne') s.turnStats.crownBattlesWon[winner]++;
    }
  }

  function earnTraits(f: Fleet, ctx: { won: boolean; outnumbered: boolean }) {
    const c = f.commander;
    if (c.traits.length >= 3 || f.owner === -1) return;
    const give = (t: string) => {
      if (c.traits.includes(t) || c.traits.length >= 3) return;
      c.traits.push(t);
      hl(`${c.name} earns a reputation: ${TRAITS[t].name}. ${TRAITS[t].desc}`);
    };
    if (ctx.won && ctx.outnumbered) give('giantkiller');
    if (c.deeds.kills >= 4) give('hunter');
    if (!ctx.won && f.ships.length && c.deeds.losses >= 1) give('bloodied');
    if (c.deeds.retreats >= 2) give('survivor');
    if (c.deeds.defWins >= 2) give('stalwart');
    if (c.deeds.captures >= 2) give('siegebreaker');
    if (Object.values(c.rivals).some(r => r.met >= 3)) give('nemesis');
  }
}

/** A fleet leaving an ongoing engagement takes a parting volley (used for disengaging moves). */
export function disengage(s: GameState, rng: Rng, f: Fleet, pulse: number, getReport: (eng: Engagement) => BattleReport): boolean {
  const eng = engagementAt(s, f.region);
  if (!eng || !wouldFight(s, f.region)) return true;
  const enemies = s.fleets.some(x => x.region === f.region && x.ships.length && hostile(s, x.owner, f.owner, f.region));
  const r = s.regions[f.region];
  const gar = r.owner !== null && hostile(s, r.owner, f.owner, f.region) && r.garrison > 0;
  if (!enemies && !gar) return true;
  const R = s.rules;
  if (f.commander.traits.includes('survivor') || R.combat.retreatPursuitShots <= 0 || hasBoon(s, f, 'cleanbreak')) return true;
  // Soul: a bannered fleet that would be wiped out breaking off routs instead (the resolver applies it)
  const canRout = soulOn(s) && !!f.banner && f.owner >= 0 && routBlock(s, f, 1, 0, f.region) === null;
  const stayers = s.fleets.filter(x => x.region === f.region && x !== f && x.ships.length && hostile(s, x.owner, f.owner, f.region));
  const before = f.ships.length;
  const report = getReport(eng);
  let side = report.sides.find(x => x.owner === f.owner);
  if (!side) { side = { owner: f.owner, fleets: [], ships: [] }; report.sides.push(side); }
  if (!side.fleets.some(x => x.id === f.id)) side.fleets.push({ id: f.id, name: f.name, commander: f.commander.name });
  for (const sh of f.ships) if (!side.ships.some(x => x.id === sh.id)) side.ships.push({ id: sh.id, name: sh.name, cls: sh.cls, hp: sh.hp, maxHp: sh.maxHp, fleet: f.id });
  const rr: BattleReport['rounds'][number] = { shots: [], retreats: [{ owner: f.owner, fleet: f.id, to: -1 }], pulse };
  const hit = 0.5 * R.combat.baseHit;
  let shotsLeft = Math.min(R.combat.frontage, stayers.reduce((a, x) => a + x.ships.filter(sh => sh.sys.weapons).length, 0)) + (gar ? 1 : 0);
  while (shotsLeft-- > 0 && f.ships.length) {
    const tg = rng.pick(f.ships);
    if (!rng.chance(hit)) { rr.shots.push({ from: gar ? -f.region - 1 : stayers[0]?.ships[0]?.id ?? -f.region - 1, to: tg.id, dmg: 0, miss: true }); continue; }
    const dmg = 3;
    tg.hp -= dmg;
    if (tg.hp <= 0 && canRout && f.ships.length === 1) {
      tg.hp = Math.max(1, Math.floor(tg.maxHp * SR(s).routHullCap));
      (f as Fleet & { _routBy?: number })._routBy = stayers[0]?.owner ?? r.owner ?? -1;
    }
    const kill = tg.hp <= 0;
    rr.shots.push({ from: gar ? -f.region - 1 : stayers[0]?.ships[0]?.id ?? -f.region - 1, to: tg.id, dmg, kill: kill || undefined });
    if (kill) { report.losses[f.owner] = (report.losses[f.owner] ?? 0) + 1; eng.losses[f.owner] = (eng.losses[f.owner] ?? 0) + 1; s.regions[f.region].wreckage++; }
    f.ships = f.ships.filter(x => x.hp > 0);
  }
  if (rr.shots.length) report.rounds.push(rr);
  if (before !== f.ships.length && !report.highlights.includes(`${f.name} breaks off under fire.`)) report.highlights.push(`${f.name} breaks off under fire.`);
  f.siege = null;
  if (!f.ships.length && f.owner !== -1) {
    // destroyed while breaking off: the commander escapes or falls, as in any lost fleet
    const c = f.commander;
    if (rng.chance(R.commanderFate.dieChance)) {
      c.alive = false;
      s.regions[f.region].memorials.push(`${c.name} fell with ${f.name} breaking off from the ${eng.name}, turn ${s.turn}.`);
      report.highlights.push(`${c.name} goes down with ${f.name}.`);
    } else {
      (s.players[f.owner].reserveCommanders ??= []).push(c);
      report.highlights.push(`${c.name} escapes the wreck of ${f.name} and will command again.`);
    }
  }
  return f.ships.length > 0;
}
