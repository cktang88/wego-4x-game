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
import type { BattleReport, Engagement, Fleet, GameState, PlayerId, RegionId, Ship, ShotRec, Subsystems } from './types.ts';

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
}

export function hostile(s: GameState, a: Owner, b: Owner): boolean {
  if (a === b) return false;
  if (a === -1 || b === -1) return true;
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
  if (r.owner !== null) return fleets.some(f => hostile(s, f.owner, r.owner!)) ? r.owner : null;
  return fleets.some(f => f.siege === rid && f.owner !== -1) ? -1 : null;
}

/** Would anything here shoot at anything else right now? */
export function wouldFight(s: GameState, rid: RegionId): boolean {
  const here = s.fleets.filter(f => f.region === rid && f.ships.length);
  if (!here.length) return false;
  for (const a of here) for (const b of here) {
    if (a.owner >= b.owner || !hostile(s, a.owner, b.owner)) continue;
    if (a.doctrine.stance !== 'evasive' || b.doctrine.stance !== 'evasive' || engagementAt(s, rid)) return true;
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
  let active = opts.clash ? opts.clash.slice() : s.fleets.filter(f => f.region === rid && f.ships.length);
  const out: FightOutcome = { retreats: [], destroyedFleets: [], ended: false, winner: null, rounds: 0 };

  // ---- engagement bookkeeping
  let eng = opts.clash ? undefined : engagementAt(s, rid);
  if (!eng) {
    region.battles++;
    const name = opts.clashName ?? `${region.battles > 1 ? ordinal(region.battles) + ' ' : ''}${active.some(f => f.siege === rid) && !active.some(f => f.siege !== rid && f.owner !== region.owner) ? 'Siege' : 'Battle'} of ${region.name}`;
    eng = {
      id: s.nextId++, region: rid, name, startedTurn: s.turn, startedPulse: pulse, rounds: 0, forceAt: R.combat.maxRoundsBase,
      startHp: {}, fleets: [], owners: [], losses: {}, lastStand: [], firstBlood: false, garrisonStart: region.garrison,
      hulls: {}, cmds: {},
    };
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
      E.startHp[f.id] = f.ships.reduce((a, x) => a + x.hp, 0) || 1;
      E.forceAt += f.ships.length * R.combat.roundsPerHull;
      E.hulls[f.owner] = (E.hulls[f.owner] ?? 0) + f.ships.length;
      E.cmds[f.commander.name] = f.owner;
      if (E.rounds > 0) hl(`Reinforcements: ${f.name} (${f.ships.length} ship${f.ships.length > 1 ? 's' : ''}) joins the fight.`);
      // rivalry bookkeeping (nemesis / vengeance)
      for (const o of active) {
        if (o === f || !hostile(s, o.owner, f.owner)) continue;
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
    if (!hostile(s, a.owner, b.owner)) return false;
    const neutralGar = (u: Unit) => !u.ship && region.owner === null;
    if (neutralGar(b) && a.fleet && a.fleet.siege !== rid && a.owner !== -1) return false;
    if (neutralGar(a) && b.fleet && b.fleet.siege !== rid) return false;
    if (b.fleet && a.fleet && a.fleet.doctrine.stance === 'evasive' && b.fleet.doctrine.stance === 'evasive' && !E.rounds) return false;
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

  const fire = (shooters: Unit[], targets: Unit[], shots: ShotRec[], volleyMult = 1) => {
    for (const sh of shooters) {
      let n: number, atk: number, siege = 0;
      if (sh.ship) {
        const d = shipStats(s, sh.ship, sh.owner);
        if (!sh.ship.sys.weapons) continue;
        const alpha = volleyMult === 1 && E.rounds === 1 && hasTech(s, sh.owner, 'alpha') ? 2 : 1;
        n = Math.max(1, Math.round(d.shots * volleyMult * alpha));
        atk = d.attack;
        siege = d.siege + traitVal(sh.fleet, 'garrisonDmg');
        if (sh.fleet?.fatigued) atk = Math.max(1, Math.round(atk * R.overdrive.fatigueAttackMult));
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
          dmg = Math.max(ps ? 0 : 1, atk - (R.garrison.armor + (region.buildings.fortress ?? 0) * R.garrison.armorPerFortress) - ps) + siege;
          if (dmg <= 0) { shots.push({ from: sh.uid, to: tg.uid, dmg: 0, miss: true }); continue; }
        } else {
          const shd = tg.ship.sys.shields ? shipStats(s, tg.ship, tg.owner).shields : 0;
          dmg = Math.max(1, Math.ceil(atk * (1 - R.shieldsCap.maxReduction)), atk - shd);
        }
        tg.pending += dmg;
        const rec: ShotRec = { from: sh.uid, to: tg.uid, dmg };
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
      if (!f.ships.length) loseFleet(f);
    }
    active = active.filter(f => f.ships.length);
  };

  // ---------------------------------------------------------------- rounds
  while (out.rounds < maxRounds && fighting()) {
    out.rounds++;
    E.rounds++;
    const all = units();
    const shots: ShotRec[] = [];
    fire(frontline(all), all, shots);
    apply(all, shots);
    const rr: BattleReport['rounds'][number] = { shots, retreats: [], pulse };
    report.rounds.push(rr);
    if (opts.clash || !fighting()) break;

    // retreat checks (thresholds are against each fleet's strength when it joined)
    const forced = R.combat.forceDecision && E.rounds >= E.forceAt ? weakestOwner() : null;
    if (forced !== null && E.rounds === E.forceAt) hl(`After ${E.rounds} rounds, ${forced === -1 ? 'the defenders' : s.players[forced]?.name ?? 'one side'} can fight no longer.`);
    for (const f of active.slice()) {
      if (f.owner === -1) continue;
      const frac = f.ships.reduce((a, x) => a + x.hp, 0) / (E.startHp[f.id] ?? 1);
      const wants = forced === f.owner || (!lastStand.has(f.id) &&
        (f.doctrine.stance === 'evasive' || (f.doctrine.retreatAt > 0 && frac < f.doctrine.retreatAt)));
      if (!wants) continue;
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
      const left = f.ships.filter(x => !x.sys.engines);
      if (left.length === f.ships.length) { cornered(); continue; }
      if (left.length) {
        f.ships = f.ships.filter(x => x.sys.engines);
        const rem: Fleet = {
          ...structuredClone(f), id: s.nextId++, name: `Remnant of ${f.name}`, ships: left,
          commander: { ...structuredClone(f.commander), name: `${f.commander.name}'s flag captain` },
          history: [`Left behind at ${region.name} on turn ${s.turn}.`], siege: null,
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
    if (f.commander.traits.includes('survivor') || R.combat.retreatPursuitShots <= 0) return true;
    const all2 = units();
    const pursuers = frontline(all2.filter(u => canTarget(u, { uid: 0, owner: f.owner, fleet: f, ship: f.ships[0] ?? null, pending: 0 })));
    const targets = all2.filter(u => u.fleet === f);
    const shots2: ShotRec[] = [];
    for (let i = 0; i < R.combat.retreatPursuitShots; i++) fire(pursuers, targets, shots2, 0.5);
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

  function retreatDest(f: Fleet): RegionId | null {
    const enemyAt = (r: RegionId) => s.fleets.some(x => x.region === r && x.ships.length && hostile(s, x.owner, f.owner) && !active.includes(x));
    const enemyGarrison = (r: RegionId) => { const g = s.regions[r]; return g.owner !== null && g.garrison > 0 && hostile(s, g.owner, f.owner); };
    const cf = cameFrom.get(f.id);
    const cfOk = cf !== undefined && cf !== rid && !enemyAt(cf);
    if (cfOk && !enemyGarrison(cf)) return cf;
    const opts2 = region.neighbors.filter(n => !enemyAt(n));
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
    for (const f of involved) {
      const c = f.commander;
      c.xp += fleetFight ? R.commanders.xpPerBattle : 1;
      const won = winner !== null && f.owner === winner;
      if (won) { c.deeds.wins++; if (region.owner === f.owner) c.deeds.defWins++; }
      else c.deeds.losses++;
      for (const [rn, rec] of Object.entries(c.rivals)) {
        if (rn in E.cmds && hostile(s, E.cmds[rn], f.owner)) {
          if (won) rec.lastWinner = c.name; else if (winnerCmd.includes(rn)) rec.lastWinner = rn;
        }
      }
      const outnumbered = (E.hulls[f.owner] ?? 0) * 1.5 <= Math.max(0, ...Object.entries(E.hulls).filter(([o]) => Number(o) !== f.owner).map(([, n]) => n));
      earnTraits(f, { won, outnumbered });
      while (c.rank < R.commanders.maxRank && c.xp >= c.rank * R.commanders.xpPerRank) {
        c.rank++;
        hl(`${c.name} is promoted to rank ${c.rank}.`);
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
  const enemies = s.fleets.some(x => x.region === f.region && x.ships.length && hostile(s, x.owner, f.owner));
  const r = s.regions[f.region];
  const gar = r.owner !== null && hostile(s, r.owner, f.owner) && r.garrison > 0;
  if (!enemies && !gar) return true;
  const R = s.rules;
  if (f.commander.traits.includes('survivor') || R.combat.retreatPursuitShots <= 0) return true;
  const stayers = s.fleets.filter(x => x.region === f.region && x !== f && x.ships.length && hostile(s, x.owner, f.owner));
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
    const kill = tg.hp <= 0;
    rr.shots.push({ from: gar ? -f.region - 1 : stayers[0]?.ships[0]?.id ?? -f.region - 1, to: tg.id, dmg, kill: kill || undefined });
    if (kill) { report.losses[f.owner] = (report.losses[f.owner] ?? 0) + 1; eng.losses[f.owner] = (eng.losses[f.owner] ?? 0) + 1; s.regions[f.region].wreckage++; }
    f.ships = f.ships.filter(x => x.hp > 0);
  }
  if (rr.shots.length) report.rounds.push(rr);
  if (before !== f.ships.length && !report.highlights.includes(`${f.name} breaks off under fire.`)) report.highlights.push(`${f.name} breaks off under fire.`);
  f.siege = null;
  return f.ships.length > 0;
}
