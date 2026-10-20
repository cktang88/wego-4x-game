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
  'Small Mercies', 'Bad Penny', 'Lodestar', 'Morrow', 'Calamity Jane', 'Coalheart', 'Tin Saint', 'Warden', 'Ember',
  'Second Chance', 'Bellow', 'Rook', 'Kite', 'Lantern Jaw', 'Hush', 'Fortune', 'Spite', 'Cinder', 'Halberd',
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

export const PLAYER_COLORS = ['#3fd0ff', '#ff4f7b', '#ffd23f'];
export const PLAYER_DEFAULT_NAMES = ['Azure Compact', 'Crimson Dominion', 'Gilded Throneholders'];
export const NEUTRAL_COLOR = '#8a8aa8';
