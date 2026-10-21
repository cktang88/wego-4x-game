// ============================================================================
//  STAR SYSTEMS: stars, bodies and roles (docs/SYSTEMS.md).
//  Names, icons and one-line descriptions live here; the numbers live in rules.ts (`systems`).
// ============================================================================

export type StarKind = 'yellow' | 'red' | 'blue' | 'binary' | 'pulsar' | 'blackhole';
export type BodyKind = 'habitable' | 'gas' | 'belt' | 'moon' | 'barren' | 'ruin';
export type BodyQuality = 'poor' | 'fair' | 'rich';
export type SystemRole = 'core' | 'forge' | 'harbor' | 'waystation';

export const STARS: Record<StarKind, { name: string; icon: string; color: string; desc: string }> = {
  yellow:    { name: 'Yellow dwarf', icon: '☉', color: '#ffd76a', desc: 'Habitable cap +1.' },
  red:       { name: 'Red dwarf',    icon: '●', color: '#ff7a5c', desc: 'Habitable cap −1.' },
  blue:      { name: 'Blue giant',   icon: '✹', color: '#8fc8ff', desc: '+1 industry per Mine and Extractor; habitable cap at most 2.' },
  binary:    { name: 'Binary',       icon: '⚭', color: '#ffe6a8', desc: 'Up to 3 bodies; garrison +3.' },
  pulsar:    { name: 'Pulsar',       icon: '✳', color: '#c9a6ff', desc: 'No habitable world. Sensor range +1; Warp Gate −30%.' },
  blackhole: { name: 'Black hole',   icon: '◉', color: '#b07cff', desc: 'No habitable world. Gravity well: fleets entering stop here.' },
};

export const BODIES: Record<BodyKind, { name: string; icon: string; desc: string; orbital: boolean }> = {
  habitable: { name: 'Habitable world', icon: '◉', desc: 'Citizens cap 1 / 3 / 4 (poor / fair / rich). Trade Hub site.', orbital: false },
  gas:       { name: 'Gas giant',       icon: '◍', desc: '+4 credits a turn. Trade Hub site. No surface to mine.', orbital: true },
  belt:      { name: 'Asteroid belt',   icon: '⁘', desc: 'Mine site.', orbital: true },
  moon:      { name: 'Moon',            icon: '◐', desc: 'Citizens cap +1 beside a habitable world; alone, a Bulwark site (garrison ×1.5).', orbital: false },
  barren:    { name: 'Barren world',    icon: '◌', desc: 'Mine site; cap 1. A rich one is a Forge: +1 industry per citizen.', orbital: false },
  ruin:      { name: 'Ruin',            icon: '⌂', desc: 'Old-empire ruins: where relics are dug.', orbital: false },
};
export const STATION = { name: 'Station', icon: '⬡', desc: 'The only body you can build: citizens cap +1, +1 civil slot, one per system.' };

export const ROLES: Record<SystemRole, { name: string; icon: string; desc: string }> = {
  core:       { name: 'Core',       icon: '♚', desc: 'A fair or rich habitable world: citizens grow here.' },
  forge:      { name: 'Forge',      icon: '⚒', desc: 'A belt or rich barren world: industry.' },
  harbor:     { name: 'Harbor',     icon: '⚓', desc: 'A gas giant: credits and fuel.' },
  waystation: { name: 'Waystation', icon: '⛯', desc: 'Rock, ice or nothing: supply, sensors, gates, forts.' },
};

/** Flavour adjectives for habitable worlds, by quality. */
export const HAB_ADJ: Record<BodyQuality, string[]> = {
  rich: ['garden', 'ocean', 'jungle', 'temperate'],
  fair: ['ocean', 'steppe', 'desert', 'tundra', 'archipelago', 'savanna'],
  poor: ['arid', 'ice', 'toxic', 'dust', 'cinder'],
};
export const BELT_NAMES = ['Ashen', 'Iron', 'Glass', 'Broken', 'Silent', 'Ember', 'Shattered', 'Saltwhite', 'Hollow', 'Rust', 'Thorn', 'Widow'];
export const GIANT_NAMES = ['Tyr', 'Ossa', 'Mammon', 'Baal', 'Orun', 'Hathor', 'Kessel', 'Vorn', 'Amaru', 'Typhon', 'Ilmar', 'Sabaoth', 'Nereid', 'Golgoth'];
export const MOON_NAMES = ['Cinder', 'Lanthe', 'the Lantern', 'Pale Ama', 'Erebus', 'the Anvil', 'Thule', 'Small Mercy', 'Nyx', 'the Bastion', 'Corvid', 'Halcyon'];
export const RUIN_NAMES = ['Drowned Spire', 'Old Choir', 'Sunken Gate', 'Hollow Crown', 'Last Archive', 'Glass Cathedral', 'Silent Forge', 'Broken Orrery', 'Ninth Vault'];
