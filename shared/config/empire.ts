// ============================================================================
//  THE EMPIRE LAYER — research, ship modules, laws, world traits, veins.
//  Names & descriptions live here; the numbers live in rules.ts (`empire`).
//  See docs/EMPIRE.md for the design.
// ============================================================================

export type Branch = 'war' | 'bulwark' | 'logistics' | 'state';

export interface TechDef {
  id: string;
  name: string;
  branch: Branch;
  tier: 1 | 2 | 3 | 4;   // 3 = one of a pair (pick one, forever); 4 = ★ one owner per game
  icon: string;
  desc: string;
}

export const BRANCHES: Record<Branch, { name: string; icon: string; color: string; pitch: string }> = {
  war:       { name: 'Warfare',   icon: '⚔', color: '#ff6b6b', pitch: 'Hit harder. Cruisers, siege, the first strike.' },
  bulwark:   { name: 'Bulwark',   icon: '⛨', color: '#6bb8ff', pitch: 'Hold what you have. Shields, batteries, walls.' },
  logistics: { name: 'Logistics', icon: '➤', color: '#ffd86b', pitch: 'Go further, faster. Engines, depots, gates, eyes.' },
  state:     { name: 'Statecraft', icon: '✦', color: '#7dffb0', pitch: 'Money and influence. Trade, laws, subversion.' },
};

export const TECHS: TechDef[] = [
  { id: 'railguns',   branch: 'war', tier: 1, icon: '⁍', name: 'Railguns', desc: 'Unlocks the Railgun module: +1 attack (and +1 shot for heavy ships that fire 3+ times).' },
  { id: 'cruisers',   branch: 'war', tier: 2, icon: '▬', name: 'Cruiser Yards', desc: 'You can build Cruisers (needs ⚛ Antimatter and a level 2 shipyard).' },
  { id: 'siege',      branch: 'war', tier: 3, icon: '☄', name: 'Siege Doctrine', desc: 'All your ships deal +3 damage to garrisons. Bombards cost 25% less.' },
  { id: 'alpha',      branch: 'war', tier: 3, icon: '⚡', name: 'Alpha Strike', desc: 'In the first round of every battle, your ships fire twice.' },
  { id: 'sunhammer',  branch: 'war', tier: 4, icon: '☀', name: 'The Sunhammer', desc: '★ Only one empire can own it. All your ships +1 attack.' },

  { id: 'deflectors', branch: 'bulwark', tier: 1, icon: '◠', name: 'Deflectors', desc: 'Unlocks the Deflector module: +2 shields and a little evasion.' },
  { id: 'batteries',  branch: 'bulwark', tier: 2, icon: '⊕', name: 'Orbital Batteries', desc: 'New project: Battery. Each level gives a garrison +2 shots and +2 damage.' },
  { id: 'pshield',    branch: 'bulwark', tier: 3, icon: '◎', name: 'Planetary Shields', desc: 'New project: Planetary Shield (needs ◆ Crystals). Hits on that garrison do 3 less damage; only siege damage gets through.' },
  { id: 'regen',      branch: 'bulwark', tier: 3, icon: '✚', name: 'Regenerators', desc: 'Your ships repair anywhere in supply, +3 hp a turn. Garrisons rebuild twice as fast.' },
  { id: 'citadel',    branch: 'bulwark', tier: 4, icon: '♜', name: 'Citadel Worlds', desc: '★ Only one empire can own it. Your garrisons are 50% larger, and every Crown you hold pays +1 VP a turn.' },

  { id: 'ion',        branch: 'logistics', tier: 1, icon: '»', name: 'Ion Drives', desc: 'Unlocks the Ion Drive module: +1 speed and much harder to hit.' },
  { id: 'depots',     branch: 'logistics', tier: 2, icon: '⛽', name: 'Supply Depots', desc: 'Ship upkeep −25%. New project: Depot, a logistics hub: +3 industry, supply reaches 2 regions from it, and fleets there repair fully.' },
  { id: 'gates',      branch: 'logistics', tier: 3, icon: '⧉', name: 'Warp Gates', desc: 'New project: Warp Gate (needs ◆ Crystals). Your fleets jump between any two of your gates as one step.' },
  { id: 'scanners',   branch: 'logistics', tier: 3, icon: '◉', name: 'Deep Scanners', desc: '+1 sensor range everywhere. You see into nebulae.' },
  { id: 'jump',       branch: 'logistics', tier: 4, icon: '↯', name: 'Jump Drive', desc: '★ Only one empire can own it. All your fleets +1 speed.' },

  { id: 'trade',      branch: 'state', tier: 1, icon: '⚖', name: 'Trade Compacts', desc: 'Trade Hubs give +3¢ more. Each pact you hold pays you 4¢ a turn.' },
  { id: 'bureaucracy', branch: 'state', tier: 2, icon: '⚑', name: 'Bureaucracy', desc: '+1 law slot and +2 influence a turn.' },
  { id: 'subversion', branch: 'state', tier: 3, icon: '☍', name: 'Subversion', desc: 'Influence orders cost 40% less and push 50% harder.' },
  { id: 'markets',    branch: 'state', tier: 3, icon: '¤', name: 'Free Markets', desc: '+20% credits. Credits cover missing industry 1:1 (instead of 2:1).' },
  { id: 'mandate',    branch: 'state', tier: 4, icon: '♛', name: 'Imperial Mandate', desc: '★ Only one empire can own it. +1 VP every turn.' },
];
export const TECH: Record<string, TechDef> = Object.fromEntries(TECHS.map(t => [t.id, t]));

export interface ModuleDef { id: string; name: string; icon: string; desc: string; tech: string | null }
export const MODULES: ModuleDef[] = [
  { id: 'armor',     name: 'Armor Plating', icon: '▣', desc: '+25% hull.', tech: null },
  { id: 'railgun',   name: 'Railguns',      icon: '⁍', desc: '+1 attack; +1 shot if the ship fires 3+.', tech: 'railguns' },
  { id: 'deflector', name: 'Deflector',     icon: '◠', desc: '+2 shields, +3% evasion.', tech: 'deflectors' },
  { id: 'ion',       name: 'Ion Drive',     icon: '»', desc: '+1 speed, +8% evasion.', tech: 'ion' },
];
export const MODULE: Record<string, ModuleDef> = Object.fromEntries(MODULES.map(m => [m.id, m]));

export interface LawDef { id: string; pair: number; name: string; icon: string; desc: string }
export const LAW_PAIRS = ['Doctrine', 'Economy', 'Rule', 'Order'];
export const LAWS: LawDef[] = [
  { id: 'bastion',    pair: 0, icon: '⛨', name: 'Bastion',     desc: 'Garrisons 30% larger and rebuild +3 a turn faster.' },
  { id: 'vanguard',   pair: 0, icon: '⚔', name: 'Vanguard',    desc: '+8% hit chance when attacking a region. Overdrive no longer fatigues.' },
  { id: 'mercantile', pair: 1, icon: '¢', name: 'Mercantile',  desc: '+25% credits. Trade Hubs +2¢ more.' },
  { id: 'industrial', pair: 1, icon: '⚙', name: 'Industrial',  desc: '+20% industry. Ships cost 10% less industry. −10% credits.' },
  { id: 'central',    pair: 2, icon: '♔', name: 'Centralism',  desc: 'Your capital yields 50% more of everything.' },
  { id: 'federal',    pair: 2, icon: '⁂', name: 'Federation',  desc: 'Develop costs 35% less. Every colony +1 industry; at development 3+ also +1 influence.' },
  { id: 'martial',    pair: 3, icon: '⚑', name: 'Martial Law', desc: 'Rivals cannot Influence your regions. Garrisons rebuild +3 faster. −1 influence a turn.' },
  { id: 'open',       pair: 3, icon: '☼', name: 'Open Society', desc: '+3 influence a turn. Scan, Feint and Conceal are free.' },
];
export const LAW: Record<string, LawDef> = Object.fromEntries(LAWS.map(l => [l.id, l]));

export const TRAITS: Record<string, { name: string; icon: string; desc: string }> = {
  forge:  { name: 'Forge World', icon: '⚒', desc: '+1 industry per development level.' },
  garden: { name: 'Garden World', icon: '❀', desc: 'Can develop one level higher; Develop here costs 30% less.' },
  bulwark: { name: 'Bulwark Moon', icon: '▣', desc: 'Garrison 50% larger.' },
  gas:    { name: 'Gas Giant', icon: '◍', desc: '+4 credits a turn. No mines.' },
};

export const VEINS: Record<string, { name: string; icon: string; color: string; desc: string }> = {
  antimatter: { name: 'Antimatter', icon: '⚛', color: '#ff7ad9', desc: 'Needed for Cruisers and Dreadnoughts.' },
  crystal:    { name: 'Crystals',   icon: '◆', color: '#6ff3ff', desc: 'Needed for Planetary Shields and Warp Gates.' },
};
