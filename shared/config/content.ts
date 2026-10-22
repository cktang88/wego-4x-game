// Flavor content: names, commander traits, relics & lore. Edit freely.

export const REGION_NAMES = [
  'Far Reach', 'Widow Rift', 'Helix Crest', 'Derelict Port', 'Dust Bowl', 'Libra Loop', 'Crux Alpha',
  'Carina Gate', 'Cowboy Leg', 'Perseus Crest', 'Wake District', 'Gamma Expanse', 'Lepus Rift', 'The Drink',
  'Titan Range', 'Lost Sea Atoll', 'Taurus Shelf', 'Draco Sector', 'Lyra Sector', 'Cepheus Reach', 'Dead Man Plateau',
  'Cygnus Gulf', 'Slingshot Pass', 'Dark Ridge', 'Hydra Shoal', 'Kappa Drift', 'Crying Sound', 'Theta Expanse',
  'Sigma Hollow', 'Zeta Shallows', 'Orrin Deep', 'Vesper Fold', 'Ashfall', 'Saltglass', 'Mire of Aun',
  'Kestrel Run', 'Halcyon Verge', 'Ninefold', 'Copper Tide', 'Pale Harbor', 'Gallows Turn', 'Bellweather',
  'Old Lantern', 'Grief Shelf', 'Marrow Field', 'Quiet Choir', 'Ember Wake', 'Sable Narrows',
];

export const CROWN_NAMES = ['Crown of Ash', 'Crown of Glass', 'Crown of Thorns'];
export const THRONE_NAME = 'The Hollow Throne';

export const SHIP_NAMES = [
  'Resolute', 'Vigilant', 'Stubborn Grace', 'Iron Psalm', 'Last Word', 'Night Heron', 'Fairweather', 'Undertow',
  'Brass Lantern', 'Kindly Wolf', 'Sixpence', 'Ardent', 'Old Faithful', 'Gravecutter', 'Little Sister', 'Persistence',
  'Mercy', 'Hollow Bell', 'Quarrel', 'Patience', 'Saint Elmo', 'Blackwater', 'Copperhead', 'Wren', 'Long Odds',
  'Wildfire', 'Reckoning', 'Starling', 'Thunderchild', 'Requiem', 'Ninefingers', 'Dauntless', 'Heretic', 'Sunder',
  'Small Mercies', 'Bad Penny', 'Lodestar', 'Morrow', 'Calamity Jane', 'Coalheart', 'Tin Saint', 'Ember',
  'Second Chance', 'Bellow', 'Rook', 'Kite', 'Lantern Jaw', 'Hush', 'Fortune', 'Spite', 'Cinder', 'Halberd', 'Gallant', 'Vesper', 'Nightjar', 'Iron Maiden', 'Whisper', 'Brimstone', 'Petrel', 'Kingfisher', 'Obstinate', 'Daybreak', 'Sorrow', 'Jackdaw',
];

export const COMMANDER_FIRST = [
  'Ines', 'Okafor', 'Rhee', 'Tamsin', 'Vasquez', 'Ilya', 'Marguerite', 'Dace', 'Sunniva', 'Orrin', 'Kaito',
  'Beatrix', 'Sol', 'Anouk', 'Teodor', 'Yara', 'Fenwick', 'Mirela', 'Cass', 'Hollis', 'Priya', 'Jun', 'Edda',
];
export const COMMANDER_LAST = [
  'Vance', 'Achterberg', 'Moreau', 'Kask', 'Oduya', 'Lindqvist', 'Tran', 'Halloran', 'Nakamura', 'Petrov',
  'Quell', 'Abernathy', 'Rask', 'Delacroix', 'Mbeki', 'Strand', 'Varga', 'Okoro', 'Hale', 'Castellan',
];

export const FLEET_NAMES = [
  'Home Guard', 'First Expedition', 'Long Watch', 'Red Lantern Squadron', 'The Lucky Few', 'Iron Column',
  'Second Expedition', 'Dawn Patrol', 'The Unforgiven', 'Grey Wolves', 'Rearguard', 'Vanguard', 'Ghost Wing',
];

/** Commander traits. Earned through deeds (see sim/history.ts), not rolled. */
export const TRAITS: Record<string, { name: string; desc: string; hit?: number; evasion?: number; garrisonDmg?: number; retreatSafe?: boolean; speed?: number }> = {
  none:        { name: 'Untested',     desc: 'No reputation yet.' },
  bloodied:    { name: 'Bloodied',     desc: 'Survived a lost battle. +4% evasion.', evasion: 0.04 },
  hunter:      { name: 'Hunter',       desc: 'Destroyed 4+ ships. +5% hit chance.', hit: 0.05 },
  survivor:    { name: 'Survivor',     desc: 'Escaped 2 retreats. Retreats suffer no pursuit fire.', retreatSafe: true },
  siegebreaker:{ name: 'Siegebreaker', desc: 'Captured 2 regions by force. +2 siege damage vs garrisons.', garrisonDmg: 2 },
  stalwart:    { name: 'Stalwart',     desc: 'Won 2 defensive battles. +6% evasion when defending.', evasion: 0.06 },
  giantkiller: { name: 'Giantkiller',  desc: 'Won while outnumbered 3:2. +10% hit when outnumbered, -5% when outnumbering.' },
  nemesis:     { name: 'Nemesis',      desc: 'Fought the same rival commander 3 times. +8% hit vs them.' },
};

/** Relics: each holds a fragment of the authored mystery, revealed in order of discovery. */
export const RELICS = [
  { id: 'chorus', name: 'The Chorus Engine', effect: 'sensor', desc: '+1 sensor range everywhere.' },
  { id: 'loom',   name: 'Loom of Hulls',     effect: 'discount', desc: 'Ships cost 15% less industry.' },
  { id: 'aegis',  name: 'Aegis Lattice',     effect: 'garrison', desc: '+6 max garrison in every region you own.' },
  { id: 'lens',   name: 'Widow\'s Lens',     effect: 'hit', desc: '+4% hit chance for all your fleets.' },
  { id: 'well',   name: 'The Deep Well',     effect: 'credits', desc: '+6 credits per turn.' },
  { id: 'crown_key', name: 'Crown Key',      effect: 'crownvp', desc: '+1 VP per turn for each Crown you hold.' },
];

/** Mystery fragments: revealed one by one, globally numbered, regardless of which relic surfaces. */
export const LORE = [
  'The relic\'s log is a single repeating order: "HOLD THE THRONE. DO NOT LET THEM CHOOSE." The order is signed by all three of your founders.',
  'Archive fragment: the old Empire did not fall to invasion. Its fleets stopped answering. Every fleet, on the same day, at the same minute.',
  'The Crowns were not seats of government. Engineering notes call them "governors" — in the sense of a device that limits an engine.',
  'A survey map shows four Crowns, not three. The fourth region is labelled only with your own capital\'s coordinates.',
  'Personal letter, unsent: "If three heirs fight over the Throne, it stays asleep. That is the point. That was always the point."',
  'The final entry: the Throne is not a place. It is a vote. It has been counting your victories since the first battle.',
];

// house enamels, lit tone (docs/ART-BIBLE.md §2.3): readable as text on dark; fills derive the enamel base from it
export const PLAYER_COLORS = ['#7fb3dc', '#dc6a66', '#f0cf72'];
export const PLAYER_DEFAULT_NAMES = ['Azure Compact', 'Crimson Dominion', 'Gilded Throneholders'];
export const NEUTRAL_COLOR = '#a9abb3';

// ============================================================================
//  THE SOUL LAYER (docs/SOUL.md): banners, perks, vows, scars, honours,
//  world callings & deeds, the Herald, ship traits. Numbers live in rules.soul.
// ============================================================================

/** Banner sigils (12): a fleet flies one, in its owner's colour. */
export const SIGILS: { id: string; name: string; glyph: string }[] = [
  { id: 'sun', name: 'Sun', glyph: '☉' }, { id: 'moon', name: 'Moon', glyph: '☾' }, { id: 'star', name: 'Star', glyph: '✶' },
  { id: 'crown', name: 'Crown', glyph: '♛' }, { id: 'wolf', name: 'Wolf', glyph: '🐺' }, { id: 'serpent', name: 'Serpent', glyph: '§' },
  { id: 'anchor', name: 'Anchor', glyph: '⚓' }, { id: 'tower', name: 'Tower', glyph: '♜' }, { id: 'blade', name: 'Blade', glyph: '†' },
  { id: 'eye', name: 'Eye', glyph: '◉' }, { id: 'flame', name: 'Flame', glyph: '♨' }, { id: 'raven', name: 'Raven', glyph: '⚚' },
];

/** Fleet modifiers, chosen at founding (point-buy, Fallout-style traits). Boons cost points, banes give them
 *  back: total boon cost <= total bane value + rules.soul.freePoints, at most 3 of each. All behavioural,
 *  all public. Honours (rank-ups) add further boons for free; `from` shapes which ones a fleet is offered. */
export interface FleetModDef { name: string; icon: string; desc: string; cost: number; from?: 'sieges' | 'defences' | 'interceptions' | 'wins' }
export const BOONS: Record<string, FleetModDef> = {
  medics:        { name: 'Field Medics',  icon: '✚', cost: 2, from: 'wins',          desc: 'Repairs anywhere in supply, and at its own worlds as fast as at a shipyard.' },
  ghosts:        { name: 'Ghosts',        icon: '☁', cost: 3, from: 'interceptions', desc: 'Unseen by rivals unless they are in or next to its region, or scan it.' },
  ambushers:     { name: 'Ambushers',     icon: '⚶', cost: 1, from: 'defences',      desc: 'Double first volley when it did not move this turn (defending or lying in wait).' },
  shock:         { name: 'Shock Troops',  icon: '➹', cost: 2, from: 'interceptions', desc: 'Double first volley when it moved in to attack this turn.' },
  cleanbreak:    { name: 'Clean Break',   icon: '⤺', cost: 3, from: 'wins',          desc: 'Retreats and breaks off without taking a parting volley.' },
  salvagers:     { name: 'Salvagers',     icon: '⚙', cost: 1, from: 'wins',          desc: '+3 industry for every enemy ship lost in a battle it wins.' },
  hunters:       { name: 'Hunters',       icon: '➶', cost: 2, from: 'interceptions', desc: '+20% hit against scarred or fleeing fleets; doubled pursuit volleys.' },
  iron:          { name: 'Iron Discipline', icon: '⚓', cost: 2, from: 'defences',   desc: 'Its side is forced out 3 rounds later; it never retreats above half strength.' },
  siegebreakers: { name: 'Siegebreakers', icon: '⛏', cost: 2, from: 'sieges',        desc: '+2 siege damage against garrisons.' },
  longrange:     { name: 'Long Range',    icon: '»', cost: 4,                        desc: '+1 movement per turn.' },
  beloved:       { name: 'Beloved',       icon: '♥', cost: 1, from: 'defences',      desc: '+1 influence a turn while at its home world.' },
  raiders:       { name: 'Raiders',       icon: '☠', cost: 2, from: 'sieges',        desc: 'Plunders credits from a rival each turn it ends in their system, and loots credits from worlds it takes.' },
  inspiring:     { name: 'Inspiring',     icon: '⚑', cost: 2, from: 'defences',      desc: 'The garrison of the friendly world it stands in rebuilds +4 a turn faster.' },
};
export const BANES: Record<string, FleetModDef> = {
  green:       { name: 'Green Crew',     icon: '◌', cost: 1, desc: '−15% hit until it has fought its first battle.' },
  hungry:      { name: 'Hungry',         icon: '⛽', cost: 1, desc: '+2 credits upkeep a turn.' },
  slowrefit:   { name: 'Slow Refits',    icon: '⏳', cost: 2, desc: 'Repairs only at shipyards, and at half speed.' },
  brittle:     { name: 'Brittle Morale', icon: '⚠', cost: 2, desc: 'Retreats earlier (below 55% strength) and its side is forced out 2 rounds sooner.' },
  conspicuous: { name: 'Conspicuous',    icon: '☀', cost: 2, desc: 'Always visible to every house, everywhere.' },
  glass:       { name: 'Glass Hulls',    icon: '◇', cost: 2, desc: 'Every hit on it does 1 more damage.' },
  homesick:    { name: 'Homesick',       icon: '⌂', cost: 1, desc: '−1 attack per ship when 3 or more jumps from its home world.' },
  grudgebound: { name: 'Grudge-bound',   icon: '⚡', cost: 2, desc: 'Must attack its named rival when next to them, or its boons fail for a turn.' },
  ponderous:   { name: 'Ponderous',      icon: '«', cost: 2, desc: '−1 movement per turn (minimum 1).' },
  looselips:   { name: 'Loose Lips',     icon: '✉', cost: 1, desc: 'Its movements are always reported to every house, even when concealed.' },
  reckless:    { name: 'Reckless',       icon: '!', cost: 1, desc: 'Can never be evasive: always stands and fights.' },
  gilded:      { name: 'Gilded',         icon: '¤', cost: 1, desc: 'Ships built into it cost +10 credits.' },
};
/** Fleet epithets earned at Legend rank, by the fleet's first boon (fallback: generic). */
export const LEGEND_EPITHETS: Record<string, string> = {
  medics: 'the Undying', ghosts: 'the Unseen', ambushers: 'the Patient Knife', shock: 'the Spear', cleanbreak: 'the Uncatchable',
  salvagers: 'the Scavengers', hunters: 'the Hounds', iron: 'the Wall', siegebreakers: 'the Wallbreakers', longrange: 'the Far-Riders',
  beloved: 'the Beloved', raiders: 'the Corsairs', inspiring: 'the Standard-Bearers', '': 'the Legend',
};

export type VowKindId = 'throne' | 'never_retreat' | 'guard' | 'avenge' | 'relic';
/** Vows: a fleet's want. Free to swear, public, one at a time. */
export const VOWS: Record<VowKindId, { name: string; icon: string; desc: string; keep: string; epithet: string }> = {
  throne:        { name: 'Take the Throne', icon: '♛', desc: '+8% hit at the Throne.', keep: 'Fulfilled when it helps take the Throne.', epithet: 'Throne-takers' },
  never_retreat: { name: 'Never retreat',   icon: '⚔', desc: 'Ignores its retreat threshold, +5% hit. Broken if it is ever forced out.', keep: 'Fulfilled after 3 battles won.', epithet: 'the Unbroken' },
  guard:         { name: 'Guard',           icon: '⛨', desc: '+5% hit and −5% to be hit at the guarded world. Broken if it ends a turn elsewhere.', keep: 'Fulfilled after 6 turns on guard.', epithet: 'Shield of {world}' },
  avenge:        { name: 'Avenge',          icon: '🗡', desc: '+1 damage per hit against the named commander.', keep: 'Fulfilled when that commander’s fleet is beaten or slain.', epithet: 'the Avenger' },
  relic:         { name: 'Bring a relic home', icon: '✧', desc: '+1 speed while carrying a relic it dug up.', keep: 'Fulfilled when it brings the relic to its home world.', epithet: 'Relic-bearers' },
};

/** Scars: taken on a rout. Every scar cuts both ways. A third one breaks the fleet. */
export const SCARS: Record<string, { name: string; icon: string; desc: string }> = {
  burned:   { name: 'Burned Hull',   icon: '♨', desc: '−15% hull; +6% hit when outnumbered (nerve).' },
  grudge:   { name: 'Grudge',        icon: '⚡', desc: '+1 damage against the house that routed it, −5% hit against anyone else.' },
  skeleton: { name: 'Skeleton Crew', icon: '☠', desc: '−6% hit; its upkeep is halved.' },
  haunted:  { name: 'Haunted',       icon: '☽', desc: '−1 speed; enemies fighting it lose 4% hit (morale).' },
};


/** World callings (chosen at development 3). Effects scale with tenure (rules.soul.*[tier]). */
export const CALLINGS: Record<string, { name: string; icon: string; desc: string; from: 'trait' | 'mark' }> = {
  arsenal:  { name: 'Arsenal',        icon: '⚒', desc: 'Ships built here cost less industry.', from: 'trait' },
  granary:  { name: 'Granary',        icon: '❀', desc: '+industry and +credits a turn.', from: 'trait' },
  bastion:  { name: 'Bastion',        icon: '▣', desc: 'Bigger garrison that rebuilds faster.', from: 'trait' },
  refinery: { name: 'Refinery',       icon: '◍', desc: '+credits a turn.', from: 'trait' },
  proving:  { name: 'Proving Ground', icon: '⚔', desc: 'Fleets that take new ships here gain commander XP (green commanders only).', from: 'mark' },
  oracle:   { name: 'Oracle',         icon: '◉', desc: 'Sees further: +sensor range from here.', from: 'mark' },
  cenotaph: { name: 'Cenotaph',       icon: '✝', desc: 'Your fleets here fight harder; the garrison gains armor.', from: 'mark' },
  bulwark:  { name: 'Bulwark',        icon: '⛫', desc: 'Siege damage against this garrison is reduced.', from: 'mark' },
};
/** Which trait-calling a world offers (by world trait, else by kind). */
export const TRAIT_CALLING: Record<string, string> = { forge: 'arsenal', garden: 'granary', bulwark: 'bastion', gas: 'refinery', home: 'arsenal', colony: 'granary', crown: 'bastion', throne: 'bastion', relic: 'refinery', void: 'refinery' };
/** Which mark-calling a world offers, by its strongest mark. */
export const MARK_CALLING: Record<string, string> = { blood: 'proving', relic: 'oracle', loss: 'cenotaph', siege: 'bulwark', toil: 'granary' };

/** Deeds: earned (max 2 per world, one can be engraved). Each changes a rule. */
export const DEEDS: Record<string, { name: string; icon: string; desc: string }> = {
  unbroken:   { name: 'Unbroken',          icon: '⛨', desc: 'Survived 2 sieges. Its garrison has +1 armor.' },
  thrice:     { name: 'Thrice-Taken',      icon: '⟲', desc: 'Changed hands 3 times. Captures here no longer cost development.' },
  fell:       { name: 'Where {fleet} Fell', icon: '✝', desc: 'A fleet broke or died here. The owner’s fleets get +5% hit here.' },
  haven:      { name: 'Haven of {fleet}',  icon: '⚑', desc: 'A fleet retired here. The owner’s fleets here fight with its perk, and fleets founded here are always offered it.' },
  kings_seat: { name: 'King’s Seat',       icon: '♛', desc: 'The Throne remembers its reigns. +10 max garrison.' },
  liberated:  { name: 'Liberated',         icon: '☼', desc: 'Retaken within 5 turns. +1 influence a turn.' },
};

/** World epithets by strongest mark, weakest to strongest. */
export const WORLD_EPITHETS: Record<string, string[]> = {
  toil:  ['the Diligent', 'the Tireless', 'the Ever-Working'],
  blood: ['the Red', 'the Bloodied', 'of a Hundred Wrecks'],
  siege: ['the Stubborn', 'the Unbroken', 'the Unconquerable'],
  relic: ['the Old', 'the Haunted', 'of Buried Kings'],
  loss:  ['the Grieving', 'the Mournful', 'of the Fallen'],
  taken: ['the Contested', 'Twice-Taken', 'Thrice-Taken'],
};

/** Suggested names for a newly founded fleet ({home} = the world it is founded at). */
export const FOUNDING_NAMES = [
  '{home} Home Guard', '{home} Lancers', 'Wardens of {home}', 'The {home} Few', '{home} Expedition', '{home} Rangers',
  'Iron Column', 'Grey Wolves', 'Long Watch', 'Ember Wing', 'The Lucky Few', 'Black Banner', 'Dawn Patrol', 'Second Expedition',
];

/** The Herald: headline templates by kind. {a} {b} {f} {r} {c} {x} are filled in; the variant is picked by hash. */
export const HERALD_TEMPLATES: Record<string, string[]> = {
  rout:        ['{f} ROUTED at {r}: {a} limps home', 'Broken but alive: {f} flees {r}', '{a}’s {f} turns tail at {r}'],
  caught:      ['HUNTED DOWN: {f} caught limping at {r}', 'No way home for {f}: destroyed at {r}'],
  destroyed:   ['{f} destroyed at {r}', 'Wreckage at {r}: {a}’s {f} is no more'],
  broken:      ['{f} BREAKS: third scar ends a legend', '{a} furls the banner of {f}'],
  death:       ['{c} falls with {f} at {r}', 'Death of a commander: {c} lost at {r}'],
  vengeance:   ['VENGEANCE: {a} repays the blood-debt to {b}', '{c} avenged at {r}'],
  debt:        ['Blood-debt: {a} owes {b} for {c}', '{b} swears revenge for {c}'],
  vow_broken:  ['OATHBREAKER: {f} breaks its vow', '{f} forswears “{x}”'],
  vow_kept:    ['{f} keeps its vow: now “{x}”', 'A vow fulfilled: {f} {x}'],
  vow_sworn:   ['{f} swears: {x}', 'A vow on the banner of {f}: {x}'],
  oath:        ['OATHBREAKER: {a} betrays {b} — “{x}”', '{a} breaks its sworn word to {b}: “{x}”'],
  coronation:  ['{a} TAKES THE THRONE', 'A new reign: {a} sits the Hollow Throne'],
  relic:       ['{a} unearths {x} at {r}', 'Relic found: {x}'],
  capital:     ['{a} SACKS THE CAPITAL OF {b}', '{r} falls: {b}’s court flees'],
  capture:     ['{a} takes {r} from {b}', '{r} changes hands'],
  razed:       ['{r} RAZED by {a}', '{a} burns {r} and takes the spoils'],
  liberated:   ['{r} LIBERATED by {a}', '{a} returns to {r}'],
  battle:      ['Battle of {r}: {x} ships lost', 'Carnage at {r}: {x} wrecks'],
  tribute:     ['{b} PAYS TRIBUTE to {a} for {r}', 'Peace bought at {r}: {b} pays {a} a third'],
  tribute_offer: ['{a} offers {b} terms over {r}', 'Terms at {r}: {a} names its price'],
  tribute_broken: ['OATHBREAKER: {a} breaks the tribute of {r}', '{a} takes {b}’s tribute, then attacks {r}'],
  refugees:    ['Refugees flee {r} for {x}', 'The roads out of {r} fill: refugees reach {x}'],
  refugees_lost: ['Refugees flee {r} into the dark', 'No haven for the refugees of {r}'],
  honour:      ['{f} honoured: {x}', '{c} rises: {f} earns {x}'],
  legend:      ['A LEGEND: {f} becomes “{x}”', '{f} passes into legend as {x}'],
  retired:     ['{f} retires with honours to {r}', 'The banner of {f} comes home to {r}'],
  eliminated:  ['{a} IS NO MORE', 'The last of {a} falls silent'],
  founded:     ['{a} raises a new banner: {f}', 'New banner over {r}: {f}'],
  quiet:       ['Quiet in the Reach', 'An uneasy calm', 'The three houses gather their strength'],
  // ---- signature mechanics: postures ({x} = the posture) and Fate
  p_called:    ['CALLED IT: {f} read {b} at {r}', '{a} saw it coming: {f} ({x}) at {r}', 'Right on the mark: {f} {x} at {r}'],
  p_caught:    ['CAUGHT OUT: {f} ({x}) at {r}', '{f} guessed wrong at {r}', 'A costly read: {f} {x} at {r}'],
  p_ambush:    ['AMBUSH at {r}: {f} springs the trap', 'Out of the dark at {r}: {f} strikes first'],
  p_broken:    ['BROKEN CHARGE at {r}: {f} runs onto braced guns', '{f} charges {r} — and the defenders were waiting'],
  p_exposed:   ['{f} waited in the dark at {r} for nobody', 'An ambush exposed: {f} at {r}'],
  p_scorched:  ['SCORCHED EARTH: {a} burns {r} before it falls', '{r} falls in ashes: {b} takes nothing'],
  p_levies:    ['{r} calls the levies: the walls fill in time', 'Levies man the walls of {r}'],
  fate:        ['FATE: {a} spends a token — {x}', 'The dice are thrown: {a} — {x}'],
  fate_bonus:  ['Fortune favours the fallen: {a} gains a Fate', '{a}, far behind, is touched by Fate'],
};

/** Signature: fleet postures (docs/SIGNATURE.md). The numbers live in rules.signature. */
export const POSTURES: Record<string, { name: string; icon: string; bet: string; right: string; wrong: string }> = {
  steady:  { name: 'Steady',  icon: '◇', bet: 'none (the default)', right: 'nothing', wrong: 'nothing' },
  guarded: { name: 'Guarded', icon: '⛉', bet: 'they attack me here', right: 'fortified, first strike and extra defence for the whole battle', wrong: '−1 speed and no attacking this turn; if nobody comes it is dug in and cannot move next turn' },
  running: { name: 'Running', icon: '»', bet: 'my path is clear', right: '+2 speed this turn', wrong: 'if anyone engages it this turn it cannot fire its first round and takes +50% damage' },
  charge:  { name: 'Charge',  icon: '⚡', bet: 'the defender is not braced', right: 'first strike and extra damage in the opening rounds (only with a Seize)', wrong: 'against a Guarded fleet or Called Levies the charge breaks: the defenders fire first and it loses its first round' },
  ambush:  { name: 'Ambush',  icon: '◉', bet: 'they come through here', right: 'hidden (unless scanned); any hostile fleet entering is stopped and it strikes first', wrong: 'if nobody comes it is exposed to every house and fatigued (−attack) next turn' },
};
/** Signature: world postures on systems you own. */
export const WORLD_POSTURES: Record<string, { name: string; icon: string; bet: string; right: string; wrong: string }> = {
  levies: { name: 'Call the Levies', icon: '⚑', bet: 'a siege lands here this turn', right: 'garrison ×1.5 at once (and a Charge on it breaks)', wrong: 'the system yields nothing this turn and next' },
  scorch: { name: 'Scorched Earth',  icon: '🔥', bet: 'you lose it this turn', right: 'the conqueror gets nothing: no loot, no plunder, no stolen archives, nothing to raze; you raze the Calling', wrong: 'if you hold it, development −1 for nothing' },
  gates:  { name: 'Open the Gates',  icon: '⛩', bet: 'an ally needs refuge', right: 'pact allies repair here as at their own shipyard', wrong: 'if a non-ally arrives the garrison holds fire in the first round' },
};
/** Signature: Fate token uses. */
export const FATE_USES: Record<string, { name: string; icon: string; target: 'fleet' | 'region'; desc: string }> = {
  laststand: { name: 'Last Stand',     icon: '⚔', target: 'fleet',  desc: 'This turn it will not retreat, rout or be forced out, and it hits harder. If it is wiped out, it dies.' },
  surge:     { name: 'Surge',          icon: '⚡', target: 'region', desc: 'One of your systems produces double this turn, and its project jumps a turn ahead.' },
  hyperjump: { name: 'Hyperjump',      icon: '⇶', target: 'fleet',  desc: 'The fleet moves 3 extra steps this turn and slips through blockades (but not an Ambush).' },
  twist:     { name: 'Twist of Fate',  icon: '↻', target: 'fleet',  desc: 'The worst enemy volley against it in its first exchange of fire this turn misses.' },
  rally:     { name: 'Rally',          icon: '✚', target: 'fleet',  desc: 'A Limping fleet repairs to 60% hull where it stands and stops limping.' },
};

/** AI dispatches (boasts, threats and lies). {me} = own house, {them} = a rival, {r} = a world. */
export const DISPATCH_TEMPLATES = [
  '{me} has never been stronger. {them} should look to its borders.',
  'Our fleets will be at {r} before {them} can blink.',
  '{them} is bankrupt. Its captains are selling their guns.',
  'Peace with {me} is still possible. For now.',
  'Whoever holds the Throne next, it will not be {them}.',
  'A great fleet has left the yards of {me}. Its destination is secret.',
  '{them} murdered our envoys. This will be answered.',
  '{me} wants nothing but trade. Ignore the rumours about {r}.',
];

/** Ship traits: an origin trait (a double-edged pair) rolled at build time, and sometimes a quirk.
 *  fx: hpPct (max hull), attack, shields, speed, sensor, siege, evasion, hit, upkeep (credits), repair (hull/turn). */
export interface ShipTraitDef { name: string; icon: string; text: string; kind: 'origin' | 'quirk'; fx: Partial<Record<'hpPct' | 'attack' | 'shields' | 'speed' | 'sensor' | 'siege' | 'evasion' | 'hit' | 'upkeep' | 'repair', number>> }
export const SHIP_TRAITS: Record<string, ShipTraitDef> = {
  // world-born origins
  rockborn:    { kind: 'origin', name: 'Asteroid-born',    icon: '◆', text: '+15% hull, −4% evasion',  fx: { hpPct: 0.15, evasion: -0.04 } },
  hazeborn:    { kind: 'origin', name: 'Nebula-raised',    icon: '☁', text: '+5% evasion, −3% hit',    fx: { evasion: 0.05, hit: -0.03 } },
  forged:      { kind: 'origin', name: 'Forge-tempered',   icon: '⚒', text: '+1 attack, +1 upkeep',    fx: { attack: 1, upkeep: 1 } },
  frontier:    { kind: 'origin', name: 'Frontier-built',   icon: '⛺', text: '+10% hull, −4% hit',      fx: { hpPct: 0.10, hit: -0.04 } },
  gardener:    { kind: 'origin', name: 'Garden-crewed',    icon: '❀', text: '+2 repair, −10% hull',    fx: { repair: 2, hpPct: -0.10 } },
  plated:      { kind: 'origin', name: 'Bulwark-plated',   icon: '▣', text: '+1 shields, −4% evasion', fx: { shields: 1, evasion: -0.04 } },
  gasfed:      { kind: 'origin', name: 'Gas-fuelled',      icon: '◍', text: '−1 upkeep, −8% hull',     fx: { upkeep: -1, hpPct: -0.08 } },
  veteranyard: { kind: 'origin', name: 'Veteran yard',     icon: '⚔', text: '+4% hit, +1 upkeep',      fx: { hit: 0.04, upkeep: 1 } },
  throneforged:{ kind: 'origin', name: 'Throne-forged',    icon: '♛', text: '+1 attack, +10% hull, +2 upkeep', fx: { attack: 1, hpPct: 0.10, upkeep: 2 } },
  antimatter:  { kind: 'origin', name: 'Antimatter-charged', icon: '⚛', text: '+1 attack, −10% hull',  fx: { attack: 1, hpPct: -0.10 } },
  crystal:     { kind: 'origin', name: 'Crystal-lensed',   icon: '◇', text: '+4% hit, −1 shields',     fx: { hit: 0.04, shields: -1 } },
  homebuilt:   { kind: 'origin', name: 'Home-built',       icon: '⌂', text: '+5% hull, −2% evasion',   fx: { hpPct: 0.05, evasion: -0.02 } },
  colonial:    { kind: 'origin', name: 'Colony-built',     icon: '○', text: '+2% evasion, −5% hull',   fx: { evasion: 0.02, hpPct: -0.05 } },
  crownsworn:  { kind: 'origin', name: 'Crown-sworn',      icon: '♕', text: '+3% hit, +1 upkeep',      fx: { hit: 0.03, upkeep: 1 } },
  relictouched:{ kind: 'origin', name: 'Relic-touched',    icon: '✧', text: '+1 sensor, −2% hit',      fx: { sensor: 1, hit: -0.02 } },
  equipped:    { kind: 'origin', name: 'Well-equipped',    icon: '✚', text: '+1 shields, +1 upkeep',   fx: { shields: 1, upkeep: 1 } },
  siegehard:   { kind: 'origin', name: 'Siege-hardened',   icon: '⛫', text: '+10% hull, −3% evasion',  fx: { hpPct: 0.10, evasion: -0.03 } },
  blooded:     { kind: 'origin', name: 'Blooded crew',     icon: '✠', text: '+4% hit, −5% hull',       fx: { hit: 0.04, hpPct: -0.05 } },
  // empire-born origins (laws, technologies)
  massprod:    { kind: 'origin', name: 'Mass-produced',    icon: '⚙', text: '−1 upkeep, −10% hull',    fx: { upkeep: -1, hpPct: -0.10 } },
  supplied:    { kind: 'origin', name: 'Well-supplied',    icon: '¢', text: '+2 repair, +1 upkeep',    fx: { repair: 2, upkeep: 1 } },
  drillcrew:   { kind: 'origin', name: 'Martial crew',     icon: '⚑', text: '+3% hit, −3% evasion',    fx: { hit: 0.03, evasion: -0.03 } },
  forward:     { kind: 'origin', name: 'Forward-rigged',   icon: '➹', text: '+1 attack, −1 shields',   fx: { attack: 1, shields: -1 } },
  garrisonclass:{ kind: 'origin', name: 'Garrison-class',  icon: '⛨', text: '+1 shields, −3% hit',     fx: { shields: 1, hit: -0.03 } },
  freecrew:    { kind: 'origin', name: 'Free crew',        icon: '☼', text: '+4% evasion, −3% hit',    fx: { evasion: 0.04, hit: -0.03 } },
  keeneyed:    { kind: 'origin', name: 'Keen-eyed',        icon: '◎', text: '+3% hit, +1 upkeep',      fx: { hit: 0.03, upkeep: 1 } },
  // rare quirks (also net-zero pairs: never pure luck)
  daredevil:   { kind: 'quirk', name: 'Daredevils',   icon: '☄', text: '+5% hit, −5% evasion',  fx: { hit: 0.05, evasion: -0.05 } },
  cautious:    { kind: 'quirk', name: 'Cautious',     icon: '☂', text: '+5% evasion, −5% hit',  fx: { evasion: 0.05, hit: -0.05 } },
  overgunned:  { kind: 'quirk', name: 'Overgunned',   icon: '✸', text: '+1 attack, −15% hull',  fx: { attack: 1, hpPct: -0.15 } },
  lumbering:   { kind: 'quirk', name: 'Lumbering',    icon: '■', text: '+15% hull, −1 speed',   fx: { hpPct: 0.15, speed: -1 } },
  racer:       { kind: 'quirk', name: 'Racer',        icon: '»', text: '+1 speed, −10% hull',   fx: { speed: 1, hpPct: -0.10 } },
  frugal:      { kind: 'quirk', name: 'Frugal',       icon: '¢', text: '−1 upkeep, −3% hit',    fx: { upkeep: -1, hit: -0.03 } },
};
