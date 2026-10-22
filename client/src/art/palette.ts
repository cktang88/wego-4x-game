// Faction paint schemes: every house has a silhouette language and a paint job, like a painted miniatures army.
// The owner colour itself stays the ownership signal (base rings, enamel plates, territory paint); the hull paint is
// derived from it so a recoloured player still reads as theirs.
import { type RGB, rgb, mix, shade, saturate } from './util.ts';
import { enamel as enamelOf, houseOf } from './bible.ts';

export type Faction = 'azure' | 'crimson' | 'gilded' | 'warden' | 'neutral';

export interface Scheme {
  faction: Faction;
  /** owner colour (ring, plates) */
  team: RGB;
  /** main hull lacquer */
  hull: RGB;
  /** secondary panels */
  hull2: RGB;
  /** trim metal (silver, brass, gold) */
  trim: RGB;
  /** dark recesses, gun decks */
  dark: RGB;
  /** accent stripes / enamel (team-derived) */
  accent: RGB;
  /** engine plume core + glow */
  engine: RGB;
  /** window / port lights */
  window: RGB;
  /** weapon fire colour */
  weapon: RGB;
}

const SILVER: RGB = [176, 186, 198], BRASS: RGB = [184, 136, 62], GOLD: RGB = [226, 172, 60], BONE: RGB = [214, 200, 170];

/** House by seat: 0 Azure Compact, 1 Crimson Dominion, 2 Gilded Throneholders, -1 the Warden. */
export function factionOf(owner: number | null | undefined): Faction {
  if (owner === 0) return 'azure';
  if (owner === 1) return 'crimson';
  if (owner === 2) return 'gilded';
  if (owner === -1) return 'warden';
  return 'neutral';
}

const cache = new Map<string, Scheme>();
export function scheme(owner: number | null | undefined, teamHex: string): Scheme {
  // hulls are lacquered in the house enamel (ART-BIBLE §2.3): any owner colour maps to its enamel base
  if (houseOf(teamHex)) teamHex = enamelOf(teamHex).base;
  const f = factionOf(owner);
  const k = `${f}|${teamHex}`;
  let s = cache.get(k);
  if (s) return s;
  const team = rgb(teamHex);
  switch (f) {
    case 'azure': s = {
      faction: f, team,
      hull: saturate(mix(team, [44, 84, 132], 0.58), 1.0), hull2: mix(team, [70, 82, 100], 0.72),
      trim: SILVER, dark: [10, 18, 30], accent: shade(team, -0.05), engine: mix(team, [210, 250, 255], 0.45), window: [190, 245, 255], weapon: mix(team, [230, 255, 255], 0.35),
    }; break;
    case 'crimson': s = {
      faction: f, team,
      hull: saturate(mix(team, [96, 8, 16], 0.72), 1.1), hull2: mix(team, [44, 30, 30], 0.82),
      trim: BRASS, dark: [26, 10, 12], accent: shade(team, -0.05), engine: [255, 150, 70], window: [255, 214, 140], weapon: [255, 176, 96],
    }; break;
    case 'gilded': s = {
      faction: f, team,
      hull: mix(BONE, team, 0.06), hull2: mix(BONE, [120, 100, 76], 0.45),
      trim: mix(GOLD, team, 0.25), dark: [40, 30, 18], accent: mix(team, GOLD, 0.3), engine: [255, 236, 170], window: [140, 236, 255], weapon: [255, 226, 130],
    }; break;
    case 'warden': s = {
      faction: f, team,
      hull: [46, 38, 64], hull2: [28, 22, 40], trim: [190, 170, 230], dark: [10, 6, 18], accent: [200, 140, 255], engine: [220, 160, 255], window: [235, 200, 255], weapon: [214, 150, 255],
    }; break;
    default: s = {
      faction: 'neutral', team,
      hull: [104, 108, 122], hull2: [70, 72, 84], trim: [190, 194, 204], dark: [18, 18, 24], accent: mix(team, [150, 150, 170], 0.5), engine: [200, 220, 255], window: [220, 230, 255], weapon: [220, 230, 255],
    };
  }
  cache.set(k, s);
  return s;
}

/** Relative hull lengths per class (the dreadnought is the centrepiece model). */
export const CLASS_LEN: Record<string, number> = { scout: 0.56, corvette: 0.66, frigate: 0.82, bombard: 0.9, cruiser: 1.06, dread: 1.38 };
/** Bigger hulls lead a stack. */
export const CLASS_RANK: Record<string, number> = { dread: 6, cruiser: 5, bombard: 4, frigate: 3, corvette: 2, scout: 1 };
export const classLen = (cls: string) => CLASS_LEN[cls] ?? 0.82;
