import type { Res, Rules } from '../config/rules.ts';

export type PlayerId = number;   // 0..2
export type RegionId = number;
export type FleetId = number;

export type RegionKind = 'home' | 'colony' | 'crown' | 'throne' | 'relic' | 'void';
export type Feature = 'none' | 'nebula' | 'asteroids';

export interface Pt { x: number; y: number }

export interface Region {
  id: RegionId;
  name: string;
  kind: RegionKind;
  feature: Feature;
  site: Pt;                 // where the star/planet is drawn
  poly: Pt[];               // irregular border polygon (already wobbled)
  centroid: Pt;
  neighbors: RegionId[];
  owner: PlayerId | null;
  homeOf: PlayerId | null;  // original capital owner
  dev: number;
  buildings: Record<string, number>;   // shipyard, fortress, mine, tradehub, sensor
  project: { key: string; progress: number; owner: PlayerId } | null;
  garrison: number;
  loyalty: number[];        // per player, for Influence
  relic: string | null;     // unexcavated relic id
  wreckage: number;         // persistent scars: ships destroyed here, ever
  battles: number;          // how many battles were fought here
  heldSince: number;        // turn current owner took it
  memorials: string[];      // fallen commanders & famous ships, forever
  baseGarrison: number;     // starting neutral garrison (neutral garrisons regenerate toward it)
}

export interface Subsystems { engines: boolean; weapons: boolean; shields: boolean } // true = working

export interface Ship {
  id: number;
  name: string;
  cls: string;
  hp: number;
  maxHp: number;
  sys: Subsystems;
  kills: number;
  battles: number;
  title: string | null;     // earned, e.g. "the Unbroken"
  bornTurn: number;
}

export type Stance = 'aggressive' | 'defensive' | 'evasive';
export type TargetPriority = 'weakest' | 'strongest' | 'cheapest' | 'garrison';

export interface Doctrine {
  stance: Stance;
  retreatAt: number;        // retreat when own hp fraction falls below this (0 = never)
  target: TargetPriority;
  guard: boolean;           // free standing order: reinforce adjacent owned regions when invaded
}

export interface Commander {
  name: string;
  xp: number;
  rank: number;
  traits: string[];
  deeds: { kills: number; wins: number; defWins: number; losses: number; retreats: number; captures: number };
  rivals: Record<string, { met: number; lastWinner: string | null }>;  // other commander -> record
  alive: boolean;
}

export interface Fleet {
  id: FleetId;
  owner: PlayerId;          // -1 = the Warden (neutral)
  name: string;
  region: RegionId;
  ships: Ship[];
  commander: Commander;
  doctrine: Doctrine;
  fortified: boolean;
  fatigued: boolean;        // overdrove last turn
  ordersThisTurn: number;
  guardUsed: boolean;
  history: string[];        // short chronicle lines
  bornTurn: number;
}

export interface Pact { a: PlayerId; b: PlayerId; until: number }

export interface Player {
  id: PlayerId;
  name: string;
  color: string;
  kind: 'human' | 'ai';
  aiLevel: 'novice' | 'standard' | 'expert';
  res: Res;
  vp: number;
  vpLog: { turn: number; amount: number; why: string }[];
  relics: string[];
  capital: RegionId;
  eliminated: boolean;
  pactOffers: PlayerId[];   // players this one offered a pact to this turn
  missedTurns: number;      // consecutive deadlines missed (steward takes over)
  reserveCommanders: Commander[]; // escaped commanders waiting for a new fleet
}

export interface Edict {
  id: string;
  name: string;
  desc: string;
  vp: number;
  revealedTurn: number;
  scoresTurn: number;
}

// ------------------------------------------------------------------- orders
export type Order =
  | { type: 'move'; fleet: FleetId; path: RegionId[]; overdrive?: boolean }
  | { type: 'seize'; fleet: FleetId; target: RegionId; also?: FleetId[] }   // `also`: extra fleets joining the assault
  | { type: 'build'; region: RegionId; cls: string; fleet: FleetId | null }
  | { type: 'develop'; region: RegionId; project: string }
  | { type: 'fortify'; fleet: FleetId }
  | { type: 'influence'; target: RegionId }
  | { type: 'scan'; target: RegionId }
  | { type: 'feint'; target: RegionId }
  | { type: 'conceal' }
  | { type: 'excavate'; fleet: FleetId }
  | { type: 'pact'; with: PlayerId };

export type OrderSlots = (Order | null)[];

/** Free (no Order cost) changes a player can make while planning. Applied before pulse 1. */
export type FreeAction =
  | { type: 'doctrine'; fleet: FleetId; doctrine: Doctrine }
  | { type: 'split'; fleet: FleetId; ships: number[] }
  | { type: 'merge'; fleet: FleetId; into: FleetId }
  | { type: 'rename'; fleet: FleetId; name: string };

export interface Submission {
  orders: OrderSlots;
  free: FreeAction[];
}

// ------------------------------------------------------------------- events
export type GameEvent =
  | { k: 'pulse'; pulse: number }
  | { k: 'move'; pulse: number; step: number; fleet: FleetId; owner: PlayerId; from: RegionId; to: RegionId; ships: number; guard?: boolean }
  | { k: 'blocked'; pulse: number; fleet: FleetId; owner: PlayerId; at: RegionId; reason: string }
  | { k: 'clash'; pulse: number; a: RegionId; b: RegionId; fleets: FleetId[] }
  | { k: 'battle'; pulse: number; region: RegionId; battle: number; name: string; parties: (PlayerId | -1)[] }
  | { k: 'retreat'; pulse: number; fleet: FleetId; owner: PlayerId; from: RegionId; to: RegionId }
  | { k: 'destroyed'; pulse: number; fleet: FleetId; owner: PlayerId; region: RegionId; name: string }
  | { k: 'capture'; pulse: number; region: RegionId; by: PlayerId; from: PlayerId | null; how: 'force' | 'influence' }
  | { k: 'build'; pulse: number; region: RegionId; owner: PlayerId; cls: string; fleet: FleetId; name: string }
  | { k: 'project'; pulse: number; region: RegionId; owner: PlayerId; key: string; done: boolean }
  | { k: 'influence'; pulse: number; region: RegionId; owner: PlayerId; loyalty: number }
  | { k: 'fortify'; pulse: number; fleet: FleetId; owner: PlayerId; region: RegionId }
  | { k: 'scan'; pulse: number; owner: PlayerId; region: RegionId }
  | { k: 'excavate'; pulse: number; owner: PlayerId; region: RegionId; relic: string; lore: number }
  | { k: 'pact'; pulse: number; a: PlayerId; b: PlayerId; formed: boolean }
  | { k: 'betrayal'; pulse: number; by: PlayerId; victim: PlayerId; region: RegionId }
  | { k: 'fail'; pulse: number; owner: PlayerId; text: string }
  | { k: 'note'; pulse: number; owner: PlayerId | null; text: string; region?: RegionId };

export interface ShotRec { from: number; to: number; dmg: number; crit?: keyof Subsystems; kill?: boolean; miss?: boolean }
export interface BattleSide {
  owner: PlayerId | -1;        // -1 = neutral garrison
  fleets: { id: FleetId; name: string; commander: string }[];
  ships: { id: number; name: string; cls: string; hp: number; maxHp: number; fleet: FleetId }[];
  garrison?: { id: number; hp: number; maxHp: number };
}
export interface BattleReport {
  id: number;
  name: string;
  turn: number;
  pulse: number;
  region: RegionId;
  sides: BattleSide[];
  rounds: { shots: ShotRec[]; retreats: { owner: PlayerId; fleet: FleetId; to: RegionId | null }[] }[];
  winner: PlayerId | -1 | null;
  losses: Record<string, number>;    // owner -> ships lost
  highlights: string[];
}

export interface Signal {
  turn: number;
  pulse: number;
  observer: PlayerId;
  about: PlayerId | null;   // null = unknown origin
  region: RegionId;
  text: string;
  confidence: 'confirmed' | 'inferred';
}

export interface ChronicleEntry { turn: number; text: string; players: PlayerId[]; region?: RegionId; major?: boolean }

// ------------------------------------------------------------------- state
export interface GameState {
  id: string;
  seed: number;
  turn: number;
  rules: Rules;
  players: Player[];
  regions: Region[];
  fleets: Fleet[];
  pacts: Pact[];
  nextId: number;
  rngState: number;
  loreFound: number;
  battleCount: number;
  winner: PlayerId | null;
  winReason: string;
  chronicle: ChronicleEntry[];
  scans: { owner: PlayerId; region: RegionId; until: number }[];
  throne: { owner: PlayerId | null; streak: number };
  crownHold: { owner: PlayerId | null; turns: number };
  edicts: Edict[];           // active/upcoming public objectives
  edictDeck: string[];
  wardenAwake: boolean;
  capitalsTaken?: PlayerId[];   // victims whose original capital has already paid capture VP
  wardenDefeated: boolean;
  /** Per-turn stats used by edicts and battle honors. */
  turnStats: { kills: number[]; battlesWon: number[]; crownBattlesWon: number[]; captures: number[] };
  /** Results of the most recent resolution, for replays. */
  last: TurnResult | null;
  /** Everything the game has ever seen, so a replay of any turn is possible. */
  log: { turn: number; submissions: Record<number, Submission> }[];
}

export interface TurnResult {
  turn: number;               // the turn that was resolved
  events: GameEvent[];
  battles: BattleReport[];
  signals: Signal[];
  startFleets: Fleet[];       // fleet positions at start of the turn, for animation
  startOwners: (PlayerId | null)[];
}
