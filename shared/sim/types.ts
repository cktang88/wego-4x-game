import type { Res, Rules } from '../config/rules.ts';

export type PlayerId = number;   // 0..2
export type RegionId = number;
export type FleetId = number;

export type RegionKind = 'home' | 'colony' | 'crown' | 'throne' | 'relic' | 'void' | 'lane';   // lane = a deep-space waypoint on a long hyperlane
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
  /** Movement adjacency (through lane waypoints). Absent = `neighbors` (old saves / no long lanes). */
  links?: RegionId[];
  /** Lane waypoints only: the hyperlane a–b this dot sits on (i-th of n, counted from a). */
  lane?: { a: RegionId; b: RegionId; i: number; n: number };
  trait?: string | null;    // world trait (config/empire.ts TRAITS)
  vein?: string | null;     // strategic resource deposit (config/empire.ts VEINS)
  /** Soul layer: the world's ledger, epithet, calling, tenure and deeds (public). Absent = no history yet. */
  story?: RegionStory;
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
  mod?: string | null;      // fitted module (config/empire.ts MODULES)
  /** Soul layer: rolled origin trait (+ rare quirk), ids into content.ts SHIP_TRAITS. Absent = none. */
  traits?: string[];
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
  siege?: RegionId | null;  // besieging this region (set by Seize; persists until it leaves)
  route?: Route | null;     // LIVE mode: where this fleet is travelling
  od?: boolean;             // overdrove this turn/cycle (fatigued next)
  fatigued: boolean;        // overdrove last turn
  ordersThisTurn: number;
  guardUsed: boolean;
  history: string[];        // short chronicle lines
  bornTurn: number;
  oos?: number;             // consecutive turns out of supply
  // ---- Soul layer (docs/SOUL.md). All optional: old saves and fleets without them behave as before.
  /** A founded fleet's banner (public). Scout-only pickets and the Warden fly none. */
  banner?: Banner | null;
  /** Routed and limping home (public). It can't attack or seize, moves 1 slower, and dies if caught. */
  limping?: { since: number; to: RegionId; by: PlayerId | -1 } | null;
  scars?: FleetScar[];                 // public
  honours?: { id: string; turn: number }[];   // boon ids earned on rank-ups (public)
  /** A rank-up honour waiting to be chosen (private to the owner): FreeAction {type:'honour'}. */
  pendingHonour?: { options: string[]; since: number } | null;
  vow?: Vow | null;                    // public
  epithets?: string[];                 // earned names: fulfilled vows, Legend rank (public)
  oathbreaker?: { turn: number; vow: string } | null;  // broke a vow (public, permanent)
  routs?: number[];                    // turns it routed
  tally?: FleetTally;                  // how it fought (shapes its honours)
  saga?: SagaBeat[];                   // its story so far (public, capped)
  sulkUntil?: number;                  // Grudge-bound: boons fail until this turn
}

export interface Banner {
  sigil: string;                       // content.ts SIGILS id
  boons: string[];                     // content.ts BOONS ids (chosen at founding)
  banes: string[];                     // content.ts BANES ids
  grudgeVs?: PlayerId | null;          // Grudge-bound: the named rival
  home: RegionId;                      // where it was founded ("the Vel Home Guard")
  foundedTurn: number;
}
/** Founding data on a Build (fleet:null). Missing fields get deterministic defaults (foundingOffer). */
export interface FoundSpec { name?: string; sigil?: string; boons?: string[]; banes?: string[]; grudgeVs?: PlayerId }
export type VowKind = 'throne' | 'never_retreat' | 'guard' | 'avenge' | 'relic';
export interface Vow {
  kind: VowKind;
  since: number;
  region?: RegionId;                   // guard: the world
  target?: string;                     // avenge: the commander's name
  targetOwner?: PlayerId | -1;
  progress?: number;                   // never_retreat: battles won; guard: turns kept
  carrying?: string | null;            // relic: the relic it is bringing home
}
export interface FleetScar { id: string; turn: number; vs?: PlayerId | -1 }
export interface FleetTally { sieges: number; defences: number; interceptions: number; wins: number; routs: number }
export interface SagaBeat { turn: number; kind: string; text: string; region?: RegionId }

export interface Deed { id: string; turn: number; name: string; by?: PlayerId | null; fleet?: string; boon?: string; engraved?: boolean }
export interface RegionStory {
  toil: number;                        // turns owned at development >= callingAtDev
  blood: number;                       // fleet battles fought here
  siege: number;                       // sieges held off
  relic: number;                       // relics dug up here
  loss: number;                        // memorials
  owners: { p: PlayerId | null; turn: number; how: string }[];   // chronicle of hands it passed through
  epithet: string | null;              // automatic, from the strongest mark
  calling: { id: string; since: number; dormantUntil?: number } | null;
  /** A calling waiting to be chosen (private to the owner): FreeAction {type:'calling'}. */
  pendingCalling?: { options: string[]; since: number; owner: PlayerId } | null;
  tenureFrom: number;                  // the current owner's continuous tenure counts from this turn
  deeds: Deed[];
  lost?: { p: PlayerId; turn: number; tenure: number; calling: { id: string; since: number } | null } | null;  // for Liberation
  captured?: { by: PlayerId; from: PlayerId | null; turn: number } | null;   // for Razing
}

export interface BloodDebt { id: number; turn: number; debtor: PlayerId; creditor: PlayerId; killer: string; victim: string; fleet: string; region: RegionId; cleared?: number | null }
export interface Headline { text: string; kind: string; region?: RegionId; players: PlayerId[]; drama: number; public: boolean; seenBy?: PlayerId[] }
export interface HeraldEdition { turn: number; headlines: Headline[]; dispatches: { player: PlayerId; text: string; as: 'house' | 'source'; byline: string }[] }
export interface FleetRecord {
  id: FleetId; owner: PlayerId; name: string; commander: string; rank: number; sigil: string; boons: string[]; banes: string[];
  home: RegionId; foundedTurn: number; fate: 'destroyed' | 'caught' | 'broken' | 'retired' | 'merged' | 'alive';
  fateTurn: number; fateRegion: RegionId; epithets: string[]; scars: FleetScar[]; honours: string[]; oathbreaker: boolean;
  routs: number; saga: SagaBeat[]; public: boolean; seenBy?: PlayerId[];
}
export interface SoulState {
  debts: BloodDebt[];                  // public
  reigns: { p: PlayerId; from: number; to: number | null }[];   // the Throne's reigns (public)
  herald: HeraldEdition[];             // newest last (capped)
  beats: Headline[];                   // material for the next edition (internal; not sent to clients)
  dispatches: { p: PlayerId; text: string; as: 'house' | 'source'; turn: number }[];  // waiting for the next edition
  fallen: FleetRecord[];               // bannered fleets that are gone
  moments: Headline[];                 // the biggest moments of the game so far (for the Saga)
}

/** A battle in progress. Persists across pulses and turns until one side is gone. */
export interface Engagement {
  id: number;
  region: RegionId;
  name: string;
  startedTurn: number;
  startedPulse: number;
  rounds: number;                       // total rounds fought so far
  forceAt: number;                      // the weaker side is forced out after this many rounds
  startHp: Record<number, number>;      // fleet id -> hp when it joined (retreat thresholds)
  fleets: number[];                     // every fleet that ever fought here
  owners: number[];                     // fleet owners that fought here
  hulls: Record<number, number>;        // owner -> hulls committed (incl. reinforcements)
  cmds: Record<string, number>;         // commander name -> owner
  losses: Record<string, number>;
  lastStand: number[];
  firstBlood: boolean;
  garrisonStart: number;
  joined?: Record<number, number>;      // fleet id -> engagement round count when it joined (its first round is the next)
}

/** LIVE mode: a fleet in transit. It gains `speed` movement points per tick and steps one region per `stepCost`. */
export interface Route { path: RegionId[]; seize: RegionId | null; mp: number; overdrive?: boolean }

/** LIVE mode bookkeeping (absent in WEGO games). Times are epoch ms. */
export interface LiveState {
  speed: number;                    // time multiplier (1 = normal)
  startedAt: number;
  tick: number;                     // ticks resolved so far
  bank: number[];                   // orders available per player
  nextOrderAt: number[];            // when each player earns their next order
  queue: Record<number, Order[]>;   // orders spent, executing at the next tick
  free: Record<number, FreeAction[]>;
}

export interface Pact { a: PlayerId; b: PlayerId; until: number; words?: { by: PlayerId; text: string }[] }

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
  prevPactOffers?: PlayerId[]; // offers from last turn (still answerable this turn)
  missedTurns: number;      // consecutive deadlines missed (steward takes over)
  reserveCommanders: Commander[]; // escaped commanders waiting for a new fleet
  techs?: string[];         // researched technologies (public)
  laws?: string[];          // enacted laws (public)
  blueprint?: Record<string, string>; // ship class -> module fitted to new builds (public)
  researched?: number;      // technologies bought this turn/cycle
  revokedThisTurn?: string[]; // laws revoked this turn/cycle (enacting the opposite still costs the switch price)
  // ---- Soul layer
  oathbreaker?: { turn: number; victim: PlayerId; words: string }[];   // broke a sworn pact (public)
  vendettas?: { vs: PlayerId; until: number; region: RegionId }[];     // razed by `vs`: bonus against them (public)
  pactWords?: Record<number, string>;  // words attached to this turn's pact offers (to that partner only)
  dispatchTurn?: number;               // last edition this house planted a dispatch in
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
  | { type: 'seize'; fleet: FleetId; target: RegionId; also?: FleetId[]; via?: RegionId[] }   // `also`: extra fleets joining the assault; `via`: regions crossed on the way (WEGO: path length <= speed)
  | { type: 'build'; region: RegionId; cls: string; fleet: FleetId | null; found?: FoundSpec }   // `found`: (fleet:null) raise a new banner with these boons/banes
  | { type: 'develop'; region: RegionId; project: string }
  | { type: 'fortify'; fleet: FleetId }
  | { type: 'influence'; target: RegionId }
  | { type: 'scan'; target: RegionId }
  | { type: 'feint'; target: RegionId }
  | { type: 'conceal' }
  | { type: 'excavate'; fleet: FleetId }
  | { type: 'pact'; with: PlayerId; words?: string }   // `words`: a sworn pact (<=120 chars); breaking it brands you Oathbreaker
  | { type: 'law'; law: string }
  | { type: 'refit'; fleet: FleetId }
  | { type: 'retire'; fleet: FleetId }                   // Soul: a Storied/Legend fleet retires at an owned world (Haven deed)
  | { type: 'engrave'; region: RegionId; deed: string }  // Soul: make a world's deed permanent
  | { type: 'raze'; region: RegionId };                  // Soul: raze a world captured last turn or this one

export type OrderSlots = (Order | null)[];

/** Free (no Order cost) changes a player can make while planning. Applied before pulse 1. */
export type FreeAction =
  | { type: 'doctrine'; fleet: FleetId; doctrine: Doctrine }
  | { type: 'split'; fleet: FleetId; ships: number[]; found?: FoundSpec }
  | { type: 'merge'; fleet: FleetId; into: FleetId }
  | { type: 'rename'; fleet: FleetId; name: string }
  | { type: 'research'; tech: string }
  | { type: 'blueprint'; cls: string; mod: string }
  | { type: 'revoke'; law: string }
  | { type: 'halt'; fleet: FleetId }
  | { type: 'vow'; fleet: FleetId; vow: VowKind; region?: RegionId; target?: FleetId }   // Soul: swear a vow (target: a rival fleet whose commander to avenge)
  | { type: 'honour'; fleet: FleetId; pick: string | number }    // Soul: resolve a pending honour (boon id or option index)
  | { type: 'calling'; region: RegionId; pick: string | number } // Soul: resolve a pending calling
  | { type: 'raze'; region: RegionId }                           // Soul: raze a world you captured in the turn just resolved
  | { type: 'dispatch'; text: string; as?: 'house' | 'source' };  // Soul: plant one dispatch in the next Herald

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
  | { k: 'tech'; pulse: number; owner: PlayerId; tech: string; stolen?: boolean }
  | { k: 'law'; pulse: number; owner: PlayerId; law: string; revoked?: boolean }
  | { k: 'refit'; pulse: number; owner: PlayerId; fleet: FleetId; region: RegionId }
  | { k: 'note'; pulse: number; owner: PlayerId | null; text: string; region?: RegionId }
  | { k: 'rout'; pulse: number; fleet: FleetId; owner: PlayerId; from: RegionId; to: RegionId; by: PlayerId | -1; scar: string | null }
  /** Soul-layer story beats (vows, honours, deeds, callings, debts, razing...). owner null = public. */
  | { k: 'soul'; pulse: number; kind: string; owner: PlayerId | null; text: string; region?: RegionId; fleet?: FleetId; players?: PlayerId[] };

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
  rounds: { shots: ShotRec[]; retreats: { owner: PlayerId; fleet: FleetId; to: RegionId | null }[]; pulse?: number }[];
  winner: PlayerId | -1 | null;
  losses: Record<string, number>;    // owner -> ships lost
  highlights: string[];
  ongoing?: boolean;          // the engagement continues next pulse/turn
  day?: number;               // which turn of the engagement this report covers (1 = first)
  totalRounds?: number;       // rounds fought in the whole engagement so far
  engagement?: number;        // engagement id
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
  engagements: Engagement[];   // battles in progress
  mode?: 'wego' | 'live';
  live?: LiveState;
  cycleStartOwners?: (PlayerId | null)[];  // LIVE: owners when the current cycle began (for "held all turn" scoring)
  concealed?: PlayerId[];                  // players concealing this turn/cycle
  throne: { owner: PlayerId | null; streak: number };
  crownHold: { owner: PlayerId | null; turns: number };
  edicts: Edict[];           // active/upcoming public objectives
  edictDeck: string[];
  wardenAwake: boolean;
  capitalsTaken?: PlayerId[];   // victims whose original capital has already paid capture VP
  wardenDefeated: boolean;
  /** Per-turn stats used by edicts and battle honors. */
  turnStats: { kills: number[]; battlesWon: number[]; crownBattlesWon: number[]; captures: number[]; honors?: number[]; bounty?: number[]; influenced?: string[] };
  /** Results of the most recent resolution, for replays. */
  last: TurnResult | null;
  /** Everything the game has ever seen, so a replay of any turn is possible. */
  log: { turn: number; submissions: Record<number, Submission>; tick?: TickOpts }[];
  /** Soul layer: blood-debts, reigns, the Herald, fallen fleets. Absent in old saves (created on demand). */
  soul?: SoulState;
}

/** LIVE mode: resolve a single tick instead of a whole turn. */
export interface TickOpts {
  pulse: number;          // label for this tick within the cycle (1-based)
  newCycle: boolean;      // reset per-turn counters first
  endCycle: boolean;      // run the end-of-turn phase afterwards
}

export interface TurnResult {
  turn: number;               // the turn that was resolved
  tick?: number;              // LIVE: which tick this result covers
  events: GameEvent[];
  battles: BattleReport[];
  signals: Signal[];
  startFleets: Fleet[];       // fleet positions at start of the turn, for animation
  startOwners: (PlayerId | null)[];
}
