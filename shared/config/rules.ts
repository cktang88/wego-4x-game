// ============================================================================
//  THREE CROWNS — RULES
//  Every balance number in the game lives here. Tweak freely.
//  The in-game "Tweaks" panel edits a deep-merged override of this object, and
//  each game stores the exact rules it was created with (so saves and online
//  games stay deterministic even if you change defaults later).
// ============================================================================

export type ResKey = 'industry' | 'credits' | 'influence';
export type Res = Record<ResKey, number>;

export interface ShipClassDef {
  name: string;
  role: string;
  hp: number;
  attack: number;      // damage per hit
  shots: number;       // shots per combat round
  shields: number;     // flat damage absorbed per hit while shields are online
  speed: number;       // regions per Move order
  siege: number;       // bonus damage vs. planetary garrisons
  sensor: number;      // extra sensor range (regions)
  evasion: number;     // subtracted from enemy hit chance
  cost: Partial<Res>;
  needsShipyard: number; // min shipyard level required at the building region
  upkeep: number;      // credits per turn
  glyph: string;       // renderer shape key
  tech?: string[];     // needs ANY of these technologies (see config/empire.ts)
  vein?: string;       // needs access to this strategic resource (a connected Extractor)
}

export const DEFAULT_RULES = {
  version: 1,

  // ---------------------------------------------------------------- orders
  orders: {
    perTurn: 5,            // the Old World-style fixed budget. Same for everyone, forever.
    pulses: 1,             // WEGO: all of a turn's orders resolve together in one step (legacy: N pulses, slot k in pulse k)
    // An Order spent on a fleet that already acted this turn costs fatigue:
    // each extra order on the same fleet in one turn costs this many credits.
    repeatFleetCredits: 4,
    maxPerFleet: 2,        // Old World-style fatigue: a fleet can take at most this many orders per turn
  },

  // ---------------------------------------------------------------- map
  map: {
    regionsPerWedge: 8,    // map has 3-fold symmetry: 3 wedges + the Throne
    radius: 1000,          // world units
    minSiteDist: 150,
    borderWobble: 0.18,    // 0 = straight Voronoi edges
    minSharedEdge: 30,     // regions touching on a shorter edge are NOT adjacent
    nebulaChance: 0.18,
    asteroidChance: 0.18,
    voidChance: 0.12,
    relicsPerWedge: 2,      // empty deep space: no planet, weak yield, no garrison
  },

  // ---------------------------------------------------------------- start
  start: {
    resources: { industry: 60, credits: 40, influence: 10 } as Res,
    fleets: [
      // ship class keys from `ships` below
      ['frigate', 'frigate', 'corvette'],
      ['corvette', 'corvette'],
      ['scout'],
    ],
    homeDev: 3,
    homeShipyard: 1,
    homeFortress: 1,
  },

  // ---------------------------------------------------------------- economy
  economy: {
    // base yield per dev level, by region kind
    yields: {
      // influence is flat per region (not x dev); colonies give none, so Influence is a scarce choice
      home:     { industry: 6, credits: 4, influence: 2 },
      colony:   { industry: 3, credits: 2, influence: 0 },
      crown:    { industry: 3, credits: 3, influence: 2 },
      throne:   { industry: 4, credits: 5, influence: 3 },
      relic:    { industry: 2, credits: 2, influence: 1 },
      void:     { industry: 1, credits: 1, influence: 0 },
    } as Record<string, Res>,
    maxDev: 5,
    mineBonus: 4,           // +industry per mine level
    tradeHubBonus: 5,       // +credits per trade hub level
    creditsPerIndustry: 2,  // spare credits cover an industry shortfall at this rate (0 = disabled)
    shipRepairPerTurn: 4,   // hp repaired per ship per turn in an owned region
    shipyardRepairBonus: 6, // extra repair (and subsystem repair) at a shipyard
    bankruptAttrition: 3,   // hp lost per ship per turn while credits < 0
  },

  // ---------------------------------------------------------------- projects
  projects: {
    develop:  { name: 'Develop',  cost: { industry: 35, credits: 15 }, turns: 2, max: 5, desc: '+1 development: more yield of every kind.' },
    shipyard: { name: 'Shipyard', cost: { industry: 40, credits: 15 }, turns: 2, max: 3, desc: 'Build bigger ships here; repairs ships faster.' },
    fortress: { name: 'Fortress', cost: { industry: 30, credits: 15 }, turns: 2, max: 3, desc: '+garrison and garrison firepower.' },
    mine:     { name: 'Mine',     cost: { industry: 25 },              turns: 1, max: 3, desc: '+industry per turn.' },
    tradehub: { name: 'Trade Hub',cost: { industry: 25 },              turns: 1, max: 3, desc: '+credits per turn.' },
    sensor:   { name: 'Sensor Array', cost: { industry: 20, influence: 2 }, turns: 1, max: 2, desc: '+1 sensor range from this region.' },
    // --- the Empire layer (docs/EMPIRE.md)
    academy:  { name: 'Academy',  cost: { industry: 30, credits: 10 }, turns: 2, max: 2, desc: 'Research costs 15% less per level (all your Academies, up to 45%). If captured, the captor steals a technology.' },
    extractor:{ name: 'Extractor', cost: { industry: 30 },             turns: 2, max: 1, desc: 'Mines this vein: +3¢ a turn and access to its resource while connected to your capital.', vein: true },
    battery:  { name: 'Battery',  cost: { industry: 25, credits: 5 },  turns: 1, max: 2, desc: 'Orbital guns: the garrison gets +2 shots and +2 damage per level.', tech: 'batteries' },
    pshield:  { name: 'Planetary Shield', cost: { industry: 40, credits: 15 }, turns: 2, max: 1, desc: 'Hits on the garrison do 3 less damage. Only siege damage gets through.', tech: 'pshield', needs: 'crystal' },
    depot:    { name: 'Depot',    cost: { industry: 20 },              turns: 1, max: 1, desc: 'Logistics hub: +3 industry; supply reaches 2 regions from here; fleets here repair as fast as at a shipyard.', tech: 'depots' },
    gate:     { name: 'Warp Gate', cost: { industry: 45, credits: 15 }, turns: 2, max: 1, desc: 'Your fleets jump between any two of your gates as a single step; gates also link your territory for supply.', tech: 'gates', needs: 'crystal' },
  } as Record<string, { name: string; cost: Partial<Res>; turns: number; max: number; desc: string; tech?: string; needs?: string; vein?: boolean }>,

  // ---------------------------------------------------------------- garrisons
  garrison: {
    neutralMin: 8,
    neutralMax: 18,
    crownNeutral: 48,
    throneNeutral: 60,
    ownedBase: 12,          // max garrison of an owned region before fortresses
    perDev: 3,
    perFortress: 10,
    kindBonus: { home: 10, crown: 30, throne: 22 } as Record<string, number>,
    regenPerTurn: 5,
    attackBase: 3,          // garrison damage per hit
    attackPerFortress: 1,
    shotsBase: 1,
    hpPerShot: 8,
    armor: 2,               // damage absorbed per hit (siege damage ignores armor)
    armorPerFortress: 1,           // +1 shot per this much remaining garrison: big garrisons hit back hard
    shotsPerFortress: 1,
    afterCapture: 6,        // garrison left behind by a successful seize
  },

  // ---------------------------------------------------------------- ships
  ships: {
    // Niches: scouts see; corvettes are cheap fast raiders (weak in the line, useless vs walls);
    // frigates are the line; bombards crack garrisons; cruisers win line fights per Order;
    // dreadnoughts are late, slow power. Orders (5/turn) are the real bottleneck, so big hulls
    // are "order-efficient" while small hulls are "resource-efficient".
    scout:    { name: 'Scout',    role: 'Fast eyes. Fragile.', hp: 5,  attack: 1, shots: 1, shields: 0, speed: 3, siege: 0, sensor: 1, evasion: 0.15, cost: { industry: 10 },               needsShipyard: 1, upkeep: 1, glyph: 'dart' },
    corvette: { name: 'Corvette', role: 'Cheap, quick raider.', hp: 8,  attack: 3, shots: 1, shields: 0, speed: 3, siege: 0, sensor: 0, evasion: 0.15, cost: { industry: 12, credits: 4 },  needsShipyard: 1, upkeep: 1, glyph: 'arrow' },
    frigate:  { name: 'Frigate',  role: 'Line workhorse.',     hp: 14, attack: 3, shots: 2, shields: 1, speed: 2, siege: 1, sensor: 0, evasion: 0.05, cost: { industry: 28, credits: 10 },  needsShipyard: 1, upkeep: 2, glyph: 'wedge' },
    bombard:  { name: 'Bombard',  role: 'Cracks planets.',     hp: 18, attack: 1, shots: 2, shields: 2, speed: 1, siege: 6, sensor: 0, evasion: 0.00, cost: { industry: 38, credits: 16 },  needsShipyard: 2, upkeep: 2, glyph: 'block' },
    cruiser:  { name: 'Cruiser',  role: 'Shielded brawler.',   hp: 28, attack: 4, shots: 3, shields: 2, speed: 2, siege: 2, sensor: 0, evasion: 0.00, cost: { industry: 50, credits: 26 },  needsShipyard: 2, upkeep: 4, glyph: 'long', tech: ['cruisers'], vein: 'antimatter' },
    dread:    { name: 'Dreadnought', role: 'Slow apocalypse.', hp: 56, attack: 8, shots: 3, shields: 3, speed: 1, siege: 4, sensor: 0, evasion: 0.00, cost: { industry: 90, credits: 50 }, needsShipyard: 3, upkeep: 7, glyph: 'dread', tech: ['siege', 'alpha'], vein: 'antimatter' },
  } as Record<string, ShipClassDef>,
  maxShipsPerFleet: 8,
  maxFleets: 6,

  // ---------------------------------------------------------------- combat
  combat: {
    maxRounds: 8,              // (legacy single-battle cap; sustained battles use the knobs below)
    roundsPerPulse: 1,         // LIVE: rounds fought per tick
    roundsPerTurn: 5,          // WEGO: battles are SUSTAINED: each engagement fights this many rounds per turn, then carries on next turn
    frontageBase: 2,           // ships per side that can fire each round = base + perShip x armed ships (max frontage),
    frontagePerShip: 0.34,     //   so firepower grows slower than hit points: bigger battles take longer
    frontage: 8,
    lethality: 0.5,            // share of each ship's shots fired per round: lower = longer, more reinforceable battles
    maxRoundsBase: 6,          // the weaker side is forced out after base + roundsPerHull x hulls committed
    roundsPerHull: 1,
    baseHit: 0.68,
    fortifyHitBonus: 0.10,     // fortified fleets hit more
    fortifyEvasion: 0.08,      // and are harder to hit
    asteroidDefenderBonus: 0.08,
    nebulaHitPenalty: 0.12,    // everyone shoots worse in nebulae
    critChance: 0.22,          // chance a damaging hit knocks out a subsystem
    shieldRegenEachRound: false,
    // A battle that reaches maxRounds forces the weaker side (by remaining
    // hp fraction) to retreat. No stalemates.
    forceDecision: true,
    retreatPursuitShots: 1,    // free volleys the winner gets at a retreating fleet
    veteranBattles: 3,         // ship gains a title after surviving this many battles
    veteranHitBonus: 0.05,
  },

  // ---------------------------------------------------------------- commanders
  commanders: {
    xpPerBattle: 2,
    xpPerKill: 1,
    xpPerRank: 6,
    hitBonusPerRank: 0.02,
    maxRank: 5,
  },

  // ---------------------------------------------------------------- influence / diplomacy
  influence: {
    orderCost: 5,              // influence spent by an Influence order
    pushAmount: 30,            // loyalty gained per Influence order
    adjacentBonus: 10,         // extra if you own an adjacent region
    flipThreshold: 130,        // neutral region joins you at this loyalty
    decayPerTurn: 6,           // loyalty drifts back toward 0
    rivalSubvertCost: 8,       // influence cost to Influence a RIVAL-owned region
    rivalFlipThreshold: 180,   // rival regions are harder to flip (not capitals)
    pactCost: 2,               // influence to propose a non-aggression pact
    pactTurns: 4,
    pactBreakVp: 3,            // VP penalty for attacking a pact partner
    feintCost: 2,
    concealCost: 3,
    scanCost: 1,
  },

  // ---------------------------------------------------------------- sensors
  sensors: {
    ownedRange: 1,             // owned regions see adjacent regions
    fleetRange: 1,
    scanRange: 1,              // Scan reveals target + neighbors this turn and next
    nebulaHidesFleets: true,   // fleets in a nebula are only seen by co-located enemies
    feintSignals: 3,
  },

  // ---------------------------------------------------------------- victory
  victory: {
    mode: 'vp' as 'vp' | 'conquest',
    vpTarget: 40,
    turnLimit: 32,
    vpPerCrownPerTurn: 1,
    crownMajorityVp: 1,        // extra VP per turn while holding 2+ Crowns
    vpPerThronePerTurn: 3,
    vpPerRelic: 2,
    vpPerBattleWon: 1,         // only for battles involving >= 2 ships destroyed
    vpCapitalCapture: 6,
    holdAllCrownsWins: true,   // own all 3 crowns at end of turn = instant win
    eliminateOnCapitalLoss: false,
  },

  // ---------------------------------------------------------------- AI
  ai: {
    aggression: 1.0,           // scales how eagerly the AI attacks
    cheatVision: false,        // AI sees through fog when true
  },

  // ---------------------------------------------------------------- async
  async: {
    defaultDeadlineHours: 0,   // 0 = wait for everyone. Otherwise auto-resolve; missing players get AI orders.
  },
};

export type Rules = typeof DEFAULT_RULES & typeof EXTRA_DEFAULTS & typeof PLAYTEST_DEFAULTS;
export function defaultRules(): Rules { return structuredClone({ ...DEFAULT_RULES, ...EXTRA_DEFAULTS, ...PLAYTEST_DEFAULTS }); }

export function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** Deep-merge `over` onto a copy of `base`. Arrays are replaced, not merged. */
export function mergeRules<T>(base: T, over: unknown): T {
  const out: any = structuredClone(base);
  if (!isObj(over)) return out;
  for (const [k, v] of Object.entries(over)) {
    if (isObj(v) && isObj(out[k])) out[k] = mergeRules(out[k], v);
    else if (v !== undefined) out[k] = structuredClone(v);
  }
  return out;
}

// Extra knobs added after the research pass (kept separate so they're easy to find).
export const EXTRA_DEFAULTS = {
  throne: {
    streakMaxVp: 3,            // Throne pays 1,2,3..max VP for consecutive turns held
    holderVisible: true,       // fleets in the Throne are visible to everyone
  },
  bounty: {
    vpTakeFromLeader: 1,       // capture a region from the VP leader
    leaderMinLead: 3,          // must lead by at least this much to count as "the leader"
    battleHonorMinKills: 2,    // win a battle destroying >= N ships: +1 VP
    battleHonorVp: 1,
    battleHonorVsLeaderVp: 2,
    maxHonorPerTurn: 2,
  },
  edicts: {
    firstReveal: 2,            // reveal an edict at end of this turn...
    every: 2,                  // ...and every N turns after; it scores at the end of the following turn
  },
  warden: {
    wakeAtLore: 6,             // the Warden wakes in the Throne when this many relics are excavated
    ships: ['cruiser', 'cruiser', 'frigate', 'frigate'],  // it hunts the leader now: strong, but garrisons + a fleet can kill it
    defeatVp: 5,
  },
  overdrive: {
    speedBonus: 1,
    fatigueAttackMult: 0.75,   // fatigued fleets deal less damage next turn
  },
  lastStand: {
    hitBonus: 0.15,
  },
  vengeance: {
    hitBonus: 0.10,            // commander who lost the last meeting with a rival gets this vs that rival
  },
  commanderFate: {
    dieChance: 0.5,            // otherwise escapes to the capital and waits for a new fleet
  },
  steward: {
    mode: 'ai' as 'ai' | 'standing', // what a player who misses the deadline does
  },
};

// Knobs added after the first playtest round (engine-level counterplay rules).
export const PLAYTEST_DEFAULTS = {
  crowns: {
    holdTurnsToWin: 3,          // must hold all three Crowns at the end of this many consecutive turns
    mustHoldAtTurnStart: true,  // Crown/Throne VP only if you held it when the turn began (no pulse-5 snipes)
    capturedGarrisonBonus: { crown: 12, throne: 16 } as Record<string, number>, // extra garrison left after taking one
    crownKeyFlatVp: 1,          // Crown Key relic: +this VP/turn while holding any Crown
  },
  neutral: {
    garrisonRegen: 3,           // neutral garrisons slowly recover toward their starting strength
  },
  influenceLimits: {
    onePerTargetPerTurn: true,
    capAtThreshold: true,       // loyalty can't exceed the flip threshold
    purgeAmount: 30,            // Influence on your OWN region removes this much rival loyalty
    perFortress: 15,            // each fortress level adds this to the rival flip threshold
    crownMult: 2,               // Crowns and the Throne need this many times the normal loyalty
  },
  bountyCap: {
    maxPerTurn: 3,              // total bounty + honors VP a player can earn per turn
  },
  shieldsCap: {
    maxReduction: 0.5,          // shields can at most halve a hit
  },
  wardenHunt: {
    enabled: true,              // once awake, the Warden marches toward the VP leader
    stepsPerTurn: 1,
    razes: true,                // a leader region whose garrison it destroys becomes neutral
  },
  comeback: {
    gap: 10,                    // players at least this many VP behind the leader…
    incomeBonus: 0.15,          // …get this much extra income (never extra orders; not while holding the Throne)
  },
  live: {
    // LIVE mode (Neptune's Pride-style): the world advances in real time, one tick (= one pulse) at a time
    tickMinutes: 30,           // real minutes per tick at normal speed
    ticksPerCycle: 8,          // a cycle (= a WEGO turn: income, upkeep, scoring, edicts) every 8 ticks = 4 hours
    orderEveryHours: 4,        // you earn one order this often...
    bankCap: 6,                // ...and can save up to this many
    startOrders: 3,
    stepCost: 3,               // movement points per region; a fleet gains its speed in points each tick
  },
  intel: {
    ghostEchoChance: 0.35,      // chance per unclaimed relic per turn of a fake "unidentified movement"
  },
  // ---------------------------------------------------------------- the Empire layer (docs/EMPIRE.md)
  empire: {
    enabled: true,
    // research: price = (base[tier] + perRegion x tier x regions owned) x (1 - academy discount); credits share below
    techBase: [0, 10, 18, 28, 40],
    techPerRegionPerTier: 1.5,
    techCreditShare: 0.35,       // this fraction of the price is credits, the rest industry
    academyDiscount: 0.15,       // per Academy level you own...
    academyMaxDiscount: 0.45,    // ...up to this
    researchPerTurn: 1,          // technologies you can buy per turn (LIVE: per cycle)
    // laws
    lawSlotsStart: 1,
    lawSlotTurns: [10],          // +1 slot at each of these turns
    lawCost: 6,                  // influence to enact; switching a pair to its other side costs double
    // modules / refit
    armorHpMult: 1.25,
    refitIndustryPerShip: 4,
    // supply
    cutOffYield: 0.5,            // regions not connected to your capital yield this much
    supplyRange: 1,              // fleets this close to connected territory are in supply
    depotRange: 2,
    oosGraceTurns: 1,            // turns out of supply before attrition starts
    oosAttrition: 2,             // hp per ship per turn after that
    // veins & traits
    extractorCredits: 3,
    forgePerDev: 1,
    gasCredits: 4,
    gardenDevBonus: 1,
    gardenDevelopDiscount: 0.3,
    bulwarkGarrisonMult: 1.5,
    traitChance: 0.6,            // share of plain colonies that get a trait
    // technology effects
    pshieldReduction: 3,
    batteryShots: 2,
    batteryAttack: 2,
    siegeDoctrineBonus: 3,
    tradeHubBonus: 3,
    pactCredits: 4,
    subversionCostMult: 0.6,
    subversionPushMult: 1.5,
    marketsCreditsMult: 1.15,
    citadelGarrisonMult: 1.5,
    regenRepair: 3,
    alphaMult: 1.5,              // Alpha Strike: first-round volley multiplier
    scannersHit: 0.06,           // Deep Scanners: fire-control bonus
    depotIndustry: 3,
    depotUpkeepCut: 0.4,
    citadelCrownVp: 1,
    // laws
    bastionGarrisonMult: 1.3,
    lawRegenBonus: 3,
    vanguardHit: 0.08,
    mercantileMult: 1.2,
    mercantileHubBonus: 2,
    industrialMult: 1.2,
    industrialShipDiscount: 0.1,
    industrialCreditMult: 0.9,
    centralMult: 1.5,
    federalDevelopDiscount: 0.35,
    openInfluence: 3,
    martialInfluence: -1,
  },
};
