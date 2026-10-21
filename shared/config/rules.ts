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
    laneDots: [330, 520] as number[],   // hyperlanes longer than these get 1, 2 deep-space waypoints (travel takes longer)
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
    // --- star systems (docs/SYSTEMS.md): the only buildable body
    station:  { name: 'Station',  cost: { industry: 35, credits: 15 }, turns: 2, max: 1, desc: 'An orbital station: citizens cap +1 and +1 civil slot. One per system.' },
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

export type Rules = typeof DEFAULT_RULES & typeof EXTRA_DEFAULTS & typeof PLAYTEST_DEFAULTS & typeof SOUL_DEFAULTS & typeof SIGNATURE_DEFAULTS & typeof SYSTEMS_DEFAULTS;
export function defaultRules(): Rules { return structuredClone({ ...DEFAULT_RULES, ...EXTRA_DEFAULTS, ...PLAYTEST_DEFAULTS, ...SOUL_DEFAULTS, ...SIGNATURE_DEFAULTS, ...SYSTEMS_DEFAULTS }); }

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

/** Layers whose absence from a game's rules means "off": the sim plays a game saved before they existed without them. */
export const OPT_IN_LAYERS = ['soul', 'signature'] as const;
/**
 * Rules of a saved game, upgraded for this build: every knob a newer version added is filled from the defaults,
 * except that a whole layer the save predates (no `soul` / `signature` group) stays off instead of switching on
 * mid-game (old fleets have no banners, old houses no Fate...). Use this, not mergeRules(defaultRules(), saved),
 * when loading a save.
 */
export function upgradeRules(saved: unknown): Rules {
  const out = mergeRules(defaultRules(), saved);
  const had = isObj(saved) ? saved : {};
  for (const k of OPT_IN_LAYERS) if (!isObj(had[k])) (out[k] as { enabled: boolean }).enabled = false;
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

// ---------------------------------------------------------------- the Soul layer (docs/SOUL.md, phase A)
// Fleets as characters, worlds with a story, blood-debts, sworn pacts, the Herald, ship traits.
// Content (names, descriptions) lives in config/content.ts; every number is here.
export const SOUL_DEFAULTS = {
  soul: {
    enabled: true,
    // ---- banners & founding (Build with `found`, or fleet:null = founded with defaults)
    bannersBase: 3,              // banners a house can fly...
    bannersPerCrown: 1,          // ...+1 per Crown held (maxFleets stays a hard cap). Scout-only pickets fly no banner.
    freePoints: 1,               // boon cost may exceed bane value by this much (0 = strict net zero)
    maxBoons: 3,
    maxBanes: 3,
    // ---- boons & banes (behavioural fleet modifiers)
    medicsRepair: 4,             // Field Medics: hull repaired a turn anywhere in supply (own worlds: shipyard rate)
    salvageIndustry: 3,          // Salvagers: industry per enemy ship lost in a battle it wins
    hunterHit: 0.2,
    ironRounds: 3,               // Iron Discipline: forced out this many rounds later...
    ironHoldFrac: 0.5,           // ...and never retreats voluntarily above this strength
    siegebreakerSiege: 2,
    beloveInfluence: 1,
    raiderPlunder: 4,            // Raiders: credits a turn (+1 per development) taken from the system's owner
    raiderLoot: 4,               // Raiders: credits looted per world taken by force (+2 per development)
    raiderLootPerDev: 2,
    inspiringRegen: 4,
    greenHit: 0.15,
    hungryUpkeep: 2,
    brittleRetreat: 0.55,
    brittleRounds: 2,
    glassDmg: 1,
    homesickJumps: 3,
    gildedCredits: 10,
    // ---- vows
    vowThroneHit: 0.08,
    vowNeverRetreatHit: 0.05,
    vowNeverRetreatWins: 3,
    vowGuardHit: 0.05,
    vowGuardEvasion: 0.05,
    vowGuardTurns: 6,
    vowAvengeDmg: 1,
    vowRelicSpeed: 1,
    // ---- rout & limp
    routMinStrength: 0.25,       // destroyed instead if it had under this share of the winner's strength
    routHullCap: 0.3,            // surviving hulls are capped at this share of their max hull
    routRepeatTurns: 4,          // a second rout within this many turns kills the fleet
    limpSpeedPenalty: 1,
    limpingVisible: true,        // limping fleets are visible to every house
    limpClearHp: 0.5,            // limping ends at a friendly yard, or at an owned world once every hull is above this
    breakAtScars: 3,             // the third scar breaks (disbands) the fleet
    // ---- scars
    burnedHullMult: 0.85,
    burnedNerveHit: 0.06,
    grudgeDmg: 1,
    grudgeOtherHit: 0.05,
    skeletonHit: 0.06,
    skeletonUpkeepMult: 0.5,
    hauntedSpeed: 1,
    hauntedMorale: 0.04,
    // ---- honours & rank
    maxHonours: 3,
    honourAutoTurns: 1,          // an unpicked honour defaults to its first option after this many turns
    retireMinRank: 4,            // Storied (rank 4) and Legend (rank 5) fleets can retire
    upkeepByRank: [0, 0, 0, 1, 2, 3] as number[],   // extra credits upkeep, indexed by commander rank
    provingMaxXp: 6,             // Proving Ground XP never takes a commander past this (XP is earned by fighting)
    // ---- worlds: ledger, calling, tenure, deeds
    callingAtDev: 3,
    tenureTiers: [3, 6, 10] as number[],   // turns of continuous ownership for tier 1, 2, 3
    dormantTurns: 3,
    liberateWithin: 5,
    maxDeeds: 2,
    engraveInfluence: 4,
    engraveCredits: 10,
    unbrokenSieges: 2,
    thriceCaptures: 3,
    razeLump: 15,                // credits + industry for razing, +razeLumpPerDev x development (each)
    razeLumpPerDev: 8,
    razeVendettaTurns: 8,
    vendettaHit: 0.08,
    // calling effects by tier [none yet, tier 1, tier 2, tier 3]
    arsenalDiscount: [0.1, 0.15, 0.2, 0.25] as number[],
    granaryIndustry: [2, 3, 4, 6] as number[],
    granaryCredits: [1, 1, 2, 3] as number[],
    bastionGarrison: [4, 6, 9, 12] as number[],
    bastionRegen: [1, 1, 2, 3] as number[],
    refineryCredits: [3, 4, 6, 8] as number[],
    provingXp: [1, 1, 2, 3] as number[],
    oracleRange: [1, 1, 1, 2] as number[],
    cenotaphHit: [0.03, 0.04, 0.05, 0.07] as number[],
    cenotaphArmor: [0, 1, 1, 2] as number[],
    bulwarkSiegeCut: [1, 1, 2, 2] as number[],
    // deeds
    deedFellHit: 0.05,
    deedUnbrokenArmor: 1,
    deedSeatGarrison: 10,
    deedLiberatedInfluence: 1,
    // ---- friends: blood-debts, pacts, the Herald
    debtHit: 0.06,               // avenger's fleets vs the debtor's
    debtKillerHit: 0.04,         // extra against the killer commander himself
    heraldKeep: 12,              // editions kept in state
    heraldMin: 3,
    heraldMax: 6,
    dispatchMax: 140,
    pactWordsMax: 120,
    // ---- ship traits (rolled at build time from the yard world and the empire)
    shipTraits: true,
    shipQuirkChance: 0.15,
  },
};

// ---------------------------------------------------------------- signature mechanics (docs/SIGNATURE.md)
// Postures ("call it" by committing forces), world postures, and Fate tokens. Old saves whose rules have no
// `signature` group play without them (see shared/sim/signature.ts sigOn).
export const SIGNATURE_DEFAULTS = {
  signature: {
    enabled: true,
    postures: true,              // fleet postures (FreeAction 'posture')
    worldPostures: true,         // system postures (FreeAction 'wposture')
    fate: true,                  // Fate tokens (FreeAction 'fate')
    // ---- Guarded: "they attack me here"
    guardedHit: 0.04,            // extra hit chance while it holds (on top of counting as fortified)
    guardedEvasion: 0.06,        // extra defence while it holds (on top of counting as fortified)
    guardedSpeed: -1,            // movement this turn
    dugInTurns: 1,               // nobody came: it cannot move for this many turns
    // ---- Running: "my path is clear"
    runningSpeed: 2,             // extra movement this turn (LIVE: per tick, this cycle)
    runningDamageTaken: 1.5,     // caught strung out: damage taken this turn x this (and it can't fire its first round)
    // ---- Charge: "the defender is not guarded" (only with a Seize)
    chargeDamage: 1,             // extra damage per hit...
    chargeRounds: 2,             // ...for its first rounds this turn (plus first strike in round 1)
    neutralBraceChance: 0.4,     // a neutral garrison (or the Warden) braces against a charge this often (secret roll)
    // ---- Ambush: "they come through here"
    ambushFatigueMult: 0.75,     // nobody came: exposed (seen by all) and its attack x this next turn
    // ---- world postures
    leviesMult: 1.5,             // Call the Levies: garrison x this the moment an assault lands
    leviesIdleTurns: 2,          // no assault: the system's output is lost this turn and the next (turns counted)
    scorchDevLoss: 1,            // Scorched Earth held: development lost for nothing
    // ---- Fate
    fateStart: 3,                // tokens per house per game
    fateComebackGap: 10,         // a house this many VP behind the leader gets...
    fateComebackBonus: 1,        // ...this many extra tokens, once per game
    fatePerTurn: 1,              // tokens a house can spend per turn (LIVE: per cycle)
    surgeMult: 2,                // Surge: the system's output this turn x this...
    surgeProgress: 1,            // ...and its project jumps forward this many turns
    hyperjumpSteps: 3,           // Hyperjump: extra movement steps this turn, through blockades
    lastStandHit: 0.15,          // Last Stand: extra hit chance (and it never retreats, routs or is forced out this turn)
    rallyHull: 0.6,              // Rally: a Limping fleet's hulls repair to this share and it stops limping
  },
};

// ---------------------------------------------------------------- star systems (docs/SYSTEMS.md, steps 1-4)
// Stars and up to 3 bodies per system; citizens (the old `dev`) with a cap from the bodies, growth at Cores,
// civil/military slots, build gates, the waystation discount; Contested / Occupied / Tribute output sharing;
// the body-tagged ledger and Calling gates. Rules without this group (older games) and maps
// generated without bodies play exactly as before (see shared/sim/systems.ts sysOn).
export const SYSTEMS_DEFAULTS = {
  systems: {
    enabled: true,
    // ---- citizens cap: the sum of body caps plus the star, clamped to 0..maxCitizens
    maxCitizens: 5,
    capHabitable: { poor: 1, fair: 3, rich: 4 } as Record<string, number>,
    capMoon: 1,                  // a moon beside a habitable world (alone, it is a Bulwark site instead)
    capBarren: 1,
    capStation: 1,
    capYellow: 1,                // yellow dwarf: habitable cap +1
    capRed: -1,                  // red dwarf: habitable cap -1
    blueHabitableMax: 2,         // blue giant: habitable cap at most this
    // ---- growth: +1 citizen every N turns at an uncontested Core below its cap (Develop still buys +1)
    growthEvery: 3,
    gardenGrowthEvery: 2,        // a Garden (a rich habitable colony)
    // ---- build gates
    shipyardCitizens: 2,         // a Shipyard needs this many citizens (or a Station)
    academyCitizens: 3,
    // ---- slots: civil from bodies (each body 1, a Station +1); military/logistics everywhere
    stationCivilSlots: 1,
    milSlots: 2,
    chokeSlots: 1,               // +this at a chokepoint...
    chokeDegree: 6,              // ...a system with this many borders or more, or a cut vertex
    // ---- waystation discount: military/logistics projects cost less where citizens <= this
    waystationCitizens: 1,
    waystationDiscount: 0.3,
    // ---- stars
    binaryGarrison: 3,           // binary: owned garrison +this (one development step's worth)
    pulsarSensor: 1,             // pulsar: sensor range +1 from a system you own
    pulsarGateDiscount: 0.3,     // pulsar: Warp Gate -30%
    blueMineIndustry: 1,         // blue giant: +industry per Mine / Extractor level
    gravityWell: true,           // black hole: fleets entering stop there
    // ---- step 3: Contested, Occupied, Tribute (shared/sim/contest.ts)
    contested: true,             // off: a besieged system pays its owner in full, as before
    plunderShare: 0.5,           // attacker holding space: this share of the orbital output (the rest is lost)
    blockadeIndustry: 0.5,       // surface output of a blockaded system (the owner doesn't hold space)...
    blockadeCredits: 0.5,        // ...credits can't leave: half reach the treasury...
    blockadeInfluence: 0,        // ...and influence doesn't grow
    refugeeTurns: 3,             // every this many consecutive contested turns: -1 citizen (refugees)
    refugeeMinCitizens: 1,       // refugees never take a system below this
    occupiedTurns: 3,            // a just-captured system pays its new owner occupiedShare for this many turns
    occupiedShare: 0.5,
    tributeTurns: 5,             // accepted Tribute: the attacker takes tributeShare of the system's output this long
    tributeShare: 1 / 3,
    // ---- step 4: the body-tagged ledger and Calling gates
    bodyTagEvents: 2,            // a body earns its tag after this many events there
    callingGates: true,          // Granary/Refinery/Oracle/Arsenal/Cenotaph need the right bodies or history
    cenotaphBattles: 2,          // Cenotaph: battles fought here
    ledgerKeep: 12,              // ledger entries kept per system
  },
};
