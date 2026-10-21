import { defaultRules, mergeRules, type Rules } from '../config/rules.ts';
import { COMMANDER_FIRST, COMMANDER_LAST, FLEET_NAMES, PLAYER_COLORS, PLAYER_DEFAULT_NAMES, SHIP_NAMES } from '../config/content.ts';
import { generateMap } from './mapgen.ts';
import { Rng } from './rng.ts';
import type { Commander, Fleet, GameState, Player, PlayerId, RegionId, Ship } from './types.ts';
import { EDICTS } from './edicts.ts';
import { baseHp, blueprintFor, maxDevAt } from './empire.ts';

export interface PlayerSetup { name?: string; kind: 'human' | 'ai'; aiLevel?: Player['aiLevel'] }
export interface GameSetup {
  seed?: number;            // public: drives the map (clients see it)
  /**
   * Private entropy for the combat/edict RNG (state.rngState). It must not be derivable from the
   * public seed, or clients could predict battle rolls and the edict deck. Servers should always
   * pass a fresh random value. If omitted: a fresh random value when `seed` is omitted too, else
   * derived from `seed` (legacy, reproducible tests/sims).
   */
  rngSeed?: number;
  players: PlayerSetup[];
  rules?: unknown;
  id?: string;
  homeRotation?: number;
}

export function createGame(setup: GameSetup): GameState {
  const rules: Rules = mergeRules(defaultRules(), setup.rules);
  const seed = (Number.isFinite(setup.seed) ? setup.seed! : Math.floor(Math.random() * 2 ** 31)) >>> 0;
  const { regions, homes: wedgeHomes } = generateMap(rules, seed);
  // which wedge each seat gets is decided by the seed, so any residual positional quirk isn't tied to a seat
  const hr = Number.isFinite(setup.homeRotation) ? Math.trunc(setup.homeRotation!) : seed;
  const rot = ((hr % 3) + 3) % 3;
  const rngSeed = Number.isFinite(setup.rngSeed) ? setup.rngSeed! >>> 0
    : !Number.isFinite(setup.seed) ? Math.floor(Math.random() * 2 ** 32) >>> 0
    : (seed ^ 0x9e3779b9) >>> 0;
  const homes = [0, 1, 2].map(i => wedgeHomes[(i + rot) % 3]);
  const s: GameState = {
    id: setup.id ?? `g${seed.toString(36)}`,
    seed, turn: 1, rules, regions, fleets: [], pacts: [], nextId: 1,
    rngState: rngSeed,
    players: [], loreFound: 0, battleCount: 0, winner: null, winReason: '', chronicle: [], scans: [],
    last: null, log: [],
    throne: { owner: null, streak: 0 },
    engagements: [],
    crownHold: { owner: null, turns: 0 },
    edicts: [], edictDeck: [], wardenAwake: false, wardenDefeated: false,
    turnStats: { kills: [0, 0, 0], battlesWon: [0, 0, 0], crownBattlesWon: [0, 0, 0], captures: [0, 0, 0] },
  };
  const rng = new Rng(s.rngState);
  s.edictDeck = rng.shuffle(Object.keys(EDICTS));

  for (let i = 0; i < 3; i++) {
    const ps: PlayerSetup = setup.players?.[i] ?? { kind: 'ai' };
    const home = homes[i];
    const p: Player = {
      id: i, name: ps.name || PLAYER_DEFAULT_NAMES[i], color: PLAYER_COLORS[i], kind: ps.kind === 'human' ? 'human' : 'ai',
      aiLevel: ps.aiLevel === 'novice' || ps.aiLevel === 'expert' ? ps.aiLevel : 'standard', res: { ...rules.start.resources }, vp: 0, vpLog: [], relics: [],
      capital: home, eliminated: false, pactOffers: [], missedTurns: 0, reserveCommanders: [],
      techs: [], laws: [], blueprint: {}, researched: 0,
    };
    s.players.push(p);
    const r = s.regions[home];
    r.owner = i; r.homeOf = i; r.dev = rules.start.homeDev; r.heldSince = 1;
    r.buildings = { shipyard: rules.start.homeShipyard, fortress: rules.start.homeFortress };
    r.garrison = maxGarrison(s, home);
  }
  // fleets — names drawn in a player-symmetric way so nobody gets a "better" roster
  for (let i = 0; i < 3; i++) {
    rules.start.fleets.forEach((classes, k) => {
      const f = newFleet(s, rng, i, homes[i], FLEET_NAMES[k % FLEET_NAMES.length]);
      for (const c of classes) f.ships.push(newShip(s, rng, c, i));
    });
  }
  s.rngState = rng.state;
  s.chronicle.push({ turn: 1, text: 'Three heirs of a dead empire light their beacons. The Hollow Throne waits between them.', players: [0, 1, 2], major: true });
  return s;
}

export function newCommander(rng: Rng): Commander {
  return {
    name: `${rng.pick(COMMANDER_FIRST)} ${rng.pick(COMMANDER_LAST)}`,
    xp: 0, rank: 1, traits: [], alive: true,
    deeds: { kills: 0, wins: 0, defWins: 0, losses: 0, retreats: 0, captures: 0 },
    rivals: {},
  };
}

export function newFleet(s: GameState, rng: Rng, owner: PlayerId, region: RegionId, name?: string): Fleet {
  const p = s.players[owner];
  const commander = p && p.reserveCommanders?.length ? p.reserveCommanders.shift()! : newCommander(rng);
  const f: Fleet = {
    id: s.nextId++, owner, region, ships: [], commander,
    name: name ?? `${ordinal(s.fleets.filter(x => x.owner === owner).length + 1)} Squadron`,
    doctrine: { stance: 'defensive', retreatAt: 0.35, target: 'weakest', guard: false },
    fortified: false, fatigued: false, ordersThisTurn: 0, guardUsed: false, history: [], bornTurn: s.turn,
  };
  s.fleets.push(f);
  return f;
}

export function newShip(s: GameState, rng: Rng, cls: string, owner: PlayerId | -1 = -1): Ship {
  const mod = blueprintFor(s, owner, cls);
  const hp = baseHp(s, cls, mod);
  const used = new Set(s.fleets.flatMap(f => f.ships.map(x => x.name)));
  let name = rng.pick(SHIP_NAMES);
  for (let i = 0; i < 40 && used.has(name); i++) name = rng.pick(SHIP_NAMES);
  if (used.has(name)) name = `${name} ${roman(2 + Math.floor(rng.next() * 4))}`;
  return {
    id: s.nextId++, name, cls, hp, maxHp: hp, mod,
    sys: { engines: true, weapons: true, shields: true },
    kills: 0, battles: 0, title: null, bornTurn: s.turn,
  };
}

export function maxGarrison(s: GameState, rid: RegionId): number {
  const r = s.regions[rid];
  const g = s.rules.garrison;
  if (r.owner === null) return r.garrison;
  if (r.kind === 'void') return 2 + (r.buildings.fortress ?? 0) * g.perFortress;
  let m = g.ownedBase + r.dev * g.perDev + (r.buildings.fortress ?? 0) * g.perFortress + (g.kindBonus[r.kind] ?? 0);
  if (s.players[r.owner]?.relics.includes('aegis')) m += 6;
  const E = s.rules.empire;
  if (E?.enabled !== false && E) {
    const pl = s.players[r.owner];
    if (r.trait === 'bulwark') m *= E.bulwarkGarrisonMult;
    if (pl?.laws?.includes('bastion')) m *= E.bastionGarrisonMult;
    if (pl?.techs?.includes('citadel')) m *= E.citadelGarrisonMult;
  }
  return Math.round(m);
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
export function roman(n: number): string {
  return ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n] ?? String(n);
}
