// Deterministic auto-resolved fleet battles with qualitative damage.
// Everything here is driven by the shared seeded RNG so every client & the server
// produce identical battles from the same orders.
import { TRAITS } from '../config/content.ts';
import { ordinal } from './setup.ts';
import type { Rng } from './rng.ts';
import type { BattleReport, BattleSide, Fleet, GameState, PlayerId, RegionId, Ship, ShotRec, Subsystems } from './types.ts';

type Owner = PlayerId | -1;

interface Unit {
  uid: number;              // ship id, or -region-1 for a garrison
  owner: Owner;
  fleet: Fleet | null;
  ship: Ship | null;        // null => garrison
  pending: number;          // damage queued this round
}

export interface BattleOutcome {
  report: BattleReport;
  retreats: { fleet: Fleet; to: RegionId }[];
  destroyedFleets: Fleet[];
  winner: Owner | null;
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

/**
 * Fight it out in `rid` between all hostile parties present.
 * `garrisonFor`: whose garrison fights (region owner, -1 for a neutral garrison, or null for none).
 * `cameFrom`: where each fleet entered from this pulse (preferred retreat destination).
 */
export function runBattle(
  s: GameState, rng: Rng, rid: RegionId, pulse: number, fleets: Fleet[],
  garrisonFor: Owner | null, cameFrom: Map<number, RegionId>,
): BattleOutcome {
  const R = s.rules;
  const region = s.regions[rid];
  region.battles++;
  s.battleCount++;
  const name = `${region.battles > 1 ? ordinal(region.battles) + ' ' : ''}Battle of ${region.name}`;
  const owners: Owner[] = [];
  for (const f of fleets) if (!owners.includes(f.owner)) owners.push(f.owner);
  if (garrisonFor !== null && !owners.includes(garrisonFor)) owners.push(garrisonFor);

  // ---- report skeleton
  const startHp = new Map<number, number>();
  const sides: BattleSide[] = owners.map(o => ({
    owner: o,
    fleets: fleets.filter(f => f.owner === o).map(f => ({ id: f.id, name: f.name, commander: f.commander.name })),
    ships: fleets.filter(f => f.owner === o).flatMap(f => f.ships.map(sh => ({ id: sh.id, name: sh.name, cls: sh.cls, hp: sh.hp, maxHp: sh.maxHp, fleet: f.id }))),
  }));
  let garrisonMax = region.garrison;
  if (garrisonFor !== null && region.garrison > 0) {
    const side = sides.find(x => x.owner === garrisonFor)!;
    side.garrison = { id: -rid - 1, hp: region.garrison, maxHp: Math.max(region.garrison, garrisonMax) };
  }
  for (const f of fleets) startHp.set(f.id, f.ships.reduce((a, x) => a + x.hp, 0) || 1);
  const report: BattleReport = {
    id: s.battleCount, name, turn: s.turn, pulse, region: rid, sides, rounds: [], winner: null, losses: {}, highlights: [],
  };
  const hl = (t: string) => { if (report.highlights.length < 12 && !report.highlights.includes(t)) report.highlights.push(t); };

  // ---- rivalry bookkeeping (nemesis / vengeance)
  for (const a of fleets) for (const b of fleets) {
    if (a === b || !hostile(s, a.owner, b.owner)) continue;
    const rec = a.commander.rivals[b.commander.name] ?? (a.commander.rivals[b.commander.name] = { met: 0, lastWinner: null });
    rec.met++;
    if (rec.met === 3 && a.commander.name < b.commander.name) hl(`${a.commander.name} and ${b.commander.name} meet for the third time. This is personal now.`);
  }
  const hullCount = (o: Owner) => fleets.filter(f => f.owner === o).reduce((a, f) => a + f.ships.length, 0);
  const startHulls = new Map(owners.map(o => [o, hullCount(o)]));

  const lastStand = new Set<number>(); // fleet ids
  let active = fleets.slice();
  const retreats: { fleet: Fleet; to: RegionId }[] = [];
  const destroyedFleets: Fleet[] = [];
  const killedBy = new Map<number, Fleet | null>();
  let firstBlood = false;

  const garrisonAlive = () => garrisonFor !== null && region.garrison > 0;
  const liveOwners = (): Owner[] => {
    const o = new Set<Owner>();
    for (const f of active) if (f.ships.length) o.add(f.owner);
    if (garrisonAlive()) o.add(garrisonFor!);
    return [...o];
  };
  const anyHostilePair = () => {
    const lo = liveOwners();
    for (let i = 0; i < lo.length; i++) for (let j = i + 1; j < lo.length; j++) if (hostile(s, lo[i], lo[j])) return true;
    return false;
  };

  const units = (): Unit[] => {
    const u: Unit[] = [];
    for (const f of active) for (const sh of f.ships) u.push({ uid: sh.id, owner: f.owner, fleet: f, ship: sh, pending: 0 });
    if (garrisonAlive()) u.push({ uid: -rid - 1, owner: garrisonFor!, fleet: null, ship: null, pending: 0 });
    return u;
  };

  const hitChance = (sh: Unit, tg: Unit): number => {
    let h = R.combat.baseHit;
    const f = sh.fleet;
    if (f) {
      h += (f.commander.rank - 1) * R.commanders.hitBonusPerRank + traitVal(f, 'hit');
      if (f.fortified) h += R.combat.fortifyHitBonus;
      if (lastStand.has(f.id)) h += R.lastStand.hitBonus;
      if (s.players[f.owner]?.relics.includes('lens')) h += 0.04;
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
    // target evasion
    if (tg.ship) {
      h -= R.ships[tg.ship.cls].evasion * (tg.ship.sys.engines ? 1 : 0.3);
      const tf = tg.fleet!;
      h -= traitVal(tf, 'evasion');
      if (tf.fortified) h -= R.combat.fortifyEvasion;
      if (tf.commander.traits.includes('stalwart') && region.owner === tf.owner) h -= 0.06;
      if (region.feature === 'asteroids' && region.owner === tf.owner) h -= R.combat.asteroidDefenderBonus;
    }
    return Math.max(0.1, Math.min(0.95, h));
  };

  const pickTarget = (sh: Unit, all: Unit[]): Unit | null => {
    const cands = all.filter(t => hostile(s, sh.owner, t.owner) && (t.ship ? t.ship.hp - t.pending > 0 : region.garrison - t.pending > 0));
    if (!cands.length) return null;
    const pref = sh.fleet?.doctrine.target ?? 'weakest';
    const hpOf = (t: Unit) => (t.ship ? t.ship.hp : region.garrison) - t.pending;
    const atkOf = (t: Unit) => (t.ship ? R.ships[t.ship.cls].attack * R.ships[t.ship.cls].shots : 3);
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

  const fire = (shooters: Unit[], targets: Unit[], shots: ShotRec[], volleyMult = 1) => {
    for (const sh of shooters) {
      let n: number, atk: number, siege = 0;
      if (sh.ship) {
        const d = R.ships[sh.ship.cls];
        if (!sh.ship.sys.weapons) continue;
        n = Math.max(1, Math.round(d.shots * volleyMult));
        atk = d.attack;
        siege = d.siege + traitVal(sh.fleet, 'garrisonDmg');
        if (sh.fleet?.fatigued) atk = Math.max(1, Math.round(atk * R.overdrive.fatigueAttackMult));
      } else {
        const fort = region.buildings.fortress ?? 0;
        n = R.garrison.shotsBase + fort * R.garrison.shotsPerFortress + Math.floor(region.garrison / R.garrison.hpPerShot);
        atk = R.garrison.attackBase + fort * R.garrison.attackPerFortress;
      }
      for (let i = 0; i < n; i++) {
        const tg = pickTarget(sh, targets);
        if (!tg) break;
        if (!rng.chance(hitChance(sh, tg))) { shots.push({ from: sh.uid, to: tg.uid, dmg: 0, miss: true }); continue; }
        let dmg: number;
        if (!tg.ship) dmg = Math.max(1, atk - (R.garrison.armor + (region.buildings.fortress ?? 0) * R.garrison.armorPerFortress)) + siege;
        else {
          const sh = tg.ship.sys.shields ? R.ships[tg.ship.cls].shields : 0;
          dmg = Math.max(1, Math.ceil(atk * (1 - R.shieldsCap.maxReduction)), atk - sh);
        }
        tg.pending += dmg;
        const rec: ShotRec = { from: sh.uid, to: tg.uid, dmg };
        if (tg.ship && tg.ship.hp - tg.pending > 0 && rng.chance(R.combat.critChance)) {
          const working = (['engines', 'weapons', 'shields'] as (keyof Subsystems)[]).filter(k => tg.ship!.sys[k] && (k !== 'shields' || R.ships[tg.ship!.cls].shields > 0));
          if (working.length) rec.crit = rng.pick(working);
        }
        if (tg.ship && tg.ship.hp - tg.pending <= 0 && !killedBy.has(tg.uid)) { rec.kill = true; killedBy.set(tg.uid, sh.fleet); }
        shots.push(rec);
      }
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
        if (sh.crit === 'engines' && (big || !firstBlood)) hl(`${u.ship.name}'s engines are knocked out. It can't run now.`);
        if (sh.crit === 'weapons' && big) hl(`${u.ship.name}'s guns fall silent.`);
      }
    }
    // remove dead ships, credit kills
    for (const f of active) {
      const dead = f.ships.filter(x => x.hp <= 0);
      for (const d of dead) {
        report.losses[f.owner] = (report.losses[f.owner] ?? 0) + 1;
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
        if (!firstBlood) { firstBlood = true; hl(`First blood: ${d.name} (${R.ships[d.cls].name}) is destroyed.`); }
        if (d.title || d.battles >= R.combat.veteranBattles) {
          hl(`The veteran ${d.name}${d.title ? ' ' + d.title : ''} is lost after ${d.battles} battles.`);
          region.memorials.push(`${d.name}${d.title ? ' ' + d.title : ''}, lost in the ${name} (turn ${s.turn})`);
        }
      }
      f.ships = f.ships.filter(x => x.hp > 0);
    }
  };

  // ---------------------------------------------------------------- rounds
  let round = 0;
  while (anyHostilePair() && round < R.combat.maxRounds) {
    round++;
    const all = units();
    const shots: ShotRec[] = [];
    fire(all, all, shots);
    apply(all, shots);
    const rr: BattleReport['rounds'][number] = { shots, retreats: [] };
    report.rounds.push(rr);

    // fleets with no ships left
    for (const f of active) if (!f.ships.length && !destroyedFleets.includes(f)) destroyedFleets.push(f);
    active = active.filter(f => f.ships.length);
    if (!anyHostilePair()) break;

    // retreat checks
    const forced = round === R.combat.maxRounds && R.combat.forceDecision ? weakestOwner() : null;
    for (const f of active.slice()) {
      if (f.owner === -1) continue;
      const frac = f.ships.reduce((a, x) => a + x.hp, 0) / (startHp.get(f.id) ?? 1);
      const wants = forced === f.owner || (!lastStand.has(f.id) &&
        (f.doctrine.stance === 'evasive' || (f.doctrine.retreatAt > 0 && frac < f.doctrine.retreatAt)));
      if (!wants) continue;
      const to = retreatDest(f);
      const stranded = f.ships.filter(x => !x.sys.engines);
      if (to === null || stranded.length === f.ships.length) {
        if (forced === f.owner) { // nowhere to go and the battle is lost: scuttle
          for (const x of f.ships) { x.hp = 0; report.losses[f.owner] = (report.losses[f.owner] ?? 0) + 1; region.wreckage++; }
          f.ships = [];
          destroyedFleets.push(f);
          hl(`${f.name} is cornered with nowhere to run and is destroyed to the last hull.`);
          continue;
        }
        if (!lastStand.has(f.id)) { lastStand.add(f.id); hl(`LAST STAND: ${f.name} can't escape and fights to the end.`); }
        continue;
      }
      // pursuit volley at the retreating fleet
      if (!f.commander.traits.includes('survivor') && R.combat.retreatPursuitShots > 0) {
        const all2 = units();
        const pursuers = all2.filter(u => hostile(s, u.owner, f.owner));
        const targets = all2.filter(u => u.fleet === f);
        const shots2: ShotRec[] = [];
        for (let i = 0; i < R.combat.retreatPursuitShots; i++) fire(pursuers, targets, shots2, 0.5);
        apply(all2, shots2);
        rr.shots.push(...shots2);
        if (!f.ships.length) { destroyedFleets.push(f); hl(`${f.name} is cut down while fleeing.`); continue; }
      }
      // ships without engines are left behind and fight on
      const left = f.ships.filter(x => !x.sys.engines);
      if (left.length && left.length < f.ships.length) {
        f.ships = f.ships.filter(x => x.sys.engines);
        const rem: Fleet = {
          ...structuredClone(f), id: s.nextId++, name: `Remnant of ${f.name}`, ships: left,
          commander: { ...structuredClone(f.commander), name: `${f.commander.name}'s flag captain` },
          history: [`Left behind at ${region.name} on turn ${s.turn}.`],
        };
        rem.commander.alive = true;
        s.fleets.push(rem);
        active.push(rem);
        startHp.set(rem.id, left.reduce((a, x) => a + x.maxHp, 0));
        lastStand.add(rem.id);
        hl(`${left.map(x => x.name).join(', ')} ${left.length > 1 ? 'have' : 'has'} no engines and must stay behind: last stand.`);
      }
      f.commander.deeds.retreats++;
      retreats.push({ fleet: f, to });
      rr.retreats.push({ owner: f.owner, fleet: f.id, to });
      active = active.filter(x => x !== f);
    }
    active = active.filter(f => f.ships.length);
  }

  function weakestOwner(): Owner | null {
    const lo = liveOwners().filter(o => o !== garrisonFor || active.some(f => f.owner === o));
    let worst: Owner | null = null, wf = 2;
    for (const o of lo) {
      const fl = active.filter(f => f.owner === o);
      if (!fl.length) continue;
      const cur = fl.reduce((a, f) => a + f.ships.reduce((b, x) => b + x.hp, 0), 0);
      const st = fl.reduce((a, f) => a + (startHp.get(f.id) ?? 1), 0);
      let frac = cur / st;
      if (o === garrisonFor && garrisonAlive()) frac = Math.max(frac, region.garrison / Math.max(1, garrisonMax));
      if (frac < wf) { wf = frac; worst = o; }
    }
    return worst;
  }

  function retreatDest(f: Fleet): RegionId | null {
    const enemyAt = (r: RegionId) => s.fleets.some(x => x.region === r && x.ships.length && hostile(s, x.owner, f.owner) && !active.includes(x));
    const cf = cameFrom.get(f.id);
    if (cf !== undefined && cf !== rid && !enemyAt(cf)) return cf;
    const opts = region.neighbors.filter(n => !enemyAt(n));
    const own = opts.filter(n => s.regions[n].owner === f.owner);
    if (own.length) return own[0];
    return opts.length ? opts[0] : null;
  }

  // ---------------------------------------------------------------- aftermath
  const survivors = liveOwners();
  const hostileLeft = anyHostilePair();
  const winner: Owner | null = !hostileLeft && survivors.length >= 1
    ? (survivors.length === 1 ? survivors[0] : survivors.find(o => active.some(f => f.owner === o)) ?? survivors[0])
    : null;
  report.winner = winner;
  // only real fleet engagements count toward a ship's legend (not sieges)
  const fleetFight = new Set(fleets.map(f => f.owner)).size > 1;
  if (fleetFight) {
    for (const f of active) f.ships.forEach(x => (x.battles++));
    for (const r of retreats) r.fleet.ships.forEach(x => (x.battles++));
  }
  for (const side of report.sides) for (const sh of side.ships) {
    const live = s.fleets.flatMap(f => f.ships).find(x => x.id === sh.id);
    if (live && live.battles === R.combat.veteranBattles && !live.title) {
      live.title = rng.pick(['the Unbowed', 'the Lucky', 'the Grim', 'the Stubborn', 'Who Came Back', 'the Scarred', 'the Patient']);
      hl(`${live.name} survives its ${ordinal(live.battles)} battle and is now known as "${live.name} ${live.title}".`);
    }
  }

  // commanders: xp, deeds, traits, rivalry results
  const allFleets = [...new Set([...fleets, ...active, ...retreats.map(r => r.fleet), ...destroyedFleets])];
  const winnerCmd = allFleets.filter(f => f.owner === winner && f.ships.length).map(f => f.commander.name);
  for (const f of allFleets) {
    const c = f.commander;
    c.xp += fleetFight ? R.commanders.xpPerBattle : 1;
    const won = winner !== null && f.owner === winner;
    if (won) { c.deeds.wins++; if (region.owner === f.owner) c.deeds.defWins++; }
    else c.deeds.losses++;
    for (const [rn, rec] of Object.entries(c.rivals)) {
      if (allFleets.some(o => o.commander.name === rn && hostile(s, o.owner, f.owner))) {
        rec.lastWinner = won ? c.name : winnerCmd.includes(rn) ? rn : rec.lastWinner;
      }
    }
    const outnumbered = (startHulls.get(f.owner) ?? 0) * 1.5 <= Math.max(0, ...owners.filter(o => o !== f.owner).map(o => startHulls.get(o) ?? 0));
    earnTraits(s, f, { won, outnumbered, hl });
    while (c.rank < R.commanders.maxRank && c.xp >= c.rank * R.commanders.xpPerRank) {
      c.rank++;
      hl(`${c.name} is promoted to rank ${c.rank}.`);
    }
    if (f.ships.length) f.history.push(`T${s.turn}: ${won ? 'won' : winner === null ? 'fought' : 'lost'} the ${name}.`);
  }

  // destroyed fleets: commander fate & memorials
  for (const f of [...new Set(destroyedFleets)]) {
    f.ships = [];
    if (f.owner === -1) continue;
    const c = f.commander;
    if (c.name.endsWith('flag captain')) continue;
    if (rng.chance(R.commanderFate.dieChance)) {
      c.alive = false;
      region.memorials.push(`${c.name} (rank ${c.rank}${c.traits.length ? ', ' + c.traits.map(t => TRAITS[t]?.name ?? t).join(', ') : ''}) fell with ${f.name} in the ${name}, turn ${s.turn}.`);
      hl(`${c.name} goes down with ${f.name}.`);
    } else {
      c.alive = true;
      s.players[f.owner].reserveCommanders.push(c);
      hl(`${c.name} escapes the wreck of ${f.name} and will command again.`);
    }
  }
  if (winner !== null && winner !== -1) {
    s.turnStats.battlesWon[winner]++;
    if (region.kind === 'crown' || region.kind === 'throne') s.turnStats.crownBattlesWon[winner]++;
  }
  return { report, retreats, destroyedFleets: [...new Set(destroyedFleets)], winner };
}

function earnTraits(s: GameState, f: Fleet, ctx: { won: boolean; outnumbered: boolean; hl: (t: string) => void }) {
  const c = f.commander;
  if (c.traits.length >= 3 || f.owner === -1) return;
  const give = (t: string) => {
    if (c.traits.includes(t) || c.traits.length >= 3) return;
    c.traits.push(t);
    ctx.hl(`${c.name} earns a reputation: ${TRAITS[t].name}. ${TRAITS[t].desc}`);
  };
  if (ctx.won && ctx.outnumbered) give('giantkiller');
  if (c.deeds.kills >= 4) give('hunter');
  if (!ctx.won && f.ships.length && c.deeds.losses >= 1) give('bloodied');
  if (c.deeds.retreats >= 2) give('survivor');
  if (c.deeds.defWins >= 2) give('stalwart');
  if (c.deeds.captures >= 2) give('siegebreaker');
  if (Object.values(c.rivals).some(r => r.met >= 3)) give('nemesis');
}
