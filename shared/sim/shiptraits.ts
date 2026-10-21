// Ship traits (Soul layer): every ship is rolled an ORIGIN trait when it is built, a small double-edged
// pair weighted by where it was built (the yard world's kind, trait, feature, vein, calling, development
// and history), by its empire (laws, technologies) and a little by the fleet it joins. ~15% of ships also
// get a rare QUIRK (also a net-zero pair). Effects are deliberately small: texture, never game-deciding.
// Content: config/content.ts SHIP_TRAITS. Ships without `traits` (old saves) simply have none.
import { SHIP_TRAITS } from '../config/content.ts';
import { Rng, hashString } from './rng.ts';
import type { Fleet, GameState, PlayerId, RegionId, Ship } from './types.ts';

export type TraitFx = { hpPct: number; attack: number; shields: number; speed: number; sensor: number; siege: number; evasion: number; hit: number; upkeep: number; repair: number };
const ZERO: TraitFx = { hpPct: 0, attack: 0, shields: 0, speed: 0, sensor: 0, siege: 0, evasion: 0, hit: 0, upkeep: 0, repair: 0 };

/** Summed effects of a ship's traits (unknown ids are ignored). */
export function traitFx(sh: Pick<Ship, 'traits'> | null | undefined): TraitFx {
  const t = sh?.traits;
  if (!t || !t.length) return ZERO;
  const out = { ...ZERO };
  for (const id of t) {
    const d = Object.hasOwn(SHIP_TRAITS, id) ? SHIP_TRAITS[id] : undefined;
    if (!d) continue;
    for (const [k, v] of Object.entries(d.fx)) out[k as keyof TraitFx] += v ?? 0;
  }
  return out;
}

/** Max-hull multiplier from traits (applied when the ship is built or refitted). */
export const traitHpMult = (sh: Pick<Ship, 'traits'>) => Math.max(0.5, 1 + traitFx(sh).hpPct);

/** UI helper: how many ships of a fleet carry each trait, most common first. */
export function fleetTraits(f: Pick<Fleet, 'ships'>): { id: string; name: string; icon: string; text: string; kind: 'origin' | 'quirk'; count: number }[] {
  const n = new Map<string, number>();
  for (const sh of f.ships) for (const id of sh.traits ?? []) if (Object.hasOwn(SHIP_TRAITS, id)) n.set(id, (n.get(id) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id, count]) => ({ id, count, name: SHIP_TRAITS[id].name, icon: SHIP_TRAITS[id].icon, text: SHIP_TRAITS[id].text, kind: SHIP_TRAITS[id].kind }));
}

const CALLING_TRAIT: Record<string, [string, number]> = {
  arsenal: ['forged', 2], proving: ['blooded', 3], bastion: ['plated', 2], granary: ['gardener', 1],
  refinery: ['gasfed', 1], oracle: ['relictouched', 2], cenotaph: ['blooded', 1], bulwark: ['siegehard', 2],
};
const LAW_TRAIT: Record<string, string> = { industrial: 'massprod', mercantile: 'supplied', martial: 'drillcrew', vanguard: 'forward', bastion: 'garrisonclass', open: 'freecrew' };
const TECH_TRAIT: Record<string, string> = { scanners: 'keeneyed', railguns: 'forward', deflectors: 'plated' };
const GENERIC = ['blooded', 'freecrew', 'drillcrew', 'colonial'];
const BOON_TRAIT: Record<string, string> = { shock: 'forward', ambushers: 'hazeborn', medics: 'supplied', siegebreakers: 'siegehard', raiders: 'forward', iron: 'plated', ghosts: 'hazeborn', hunters: 'keeneyed' };

/** The weighted pool of origin traits for a ship built at `rid` by `owner` into `fleet` (pure; for tests and the UI). */
export function originPool(s: GameState, owner: PlayerId | -1, rid: RegionId | null | undefined, fleet?: Fleet | null): Map<string, number> {
  const w = new Map<string, number>();
  const add = (id: string, x: number) => { if (Object.hasOwn(SHIP_TRAITS, id)) w.set(id, (w.get(id) ?? 0) + x); };
  const r = rid !== null && rid !== undefined ? s.regions[rid] : undefined;
  if (r) {
    switch (r.kind) {
      case 'home': add('homebuilt', 3); break;
      case 'crown': add('crownsworn', 3); break;
      case 'throne': add('throneforged', 3); break;
      case 'relic': add('relictouched', 3); break;
      case 'void': add('frontier', 3); break;
      default: {
        const t = r.trait;
        if (t === 'forge') add('forged', 3);
        else if (t === 'garden') add('gardener', 3);
        else if (t === 'bulwark') add('plated', 3);
        else if (t === 'gas') add('gasfed', 3);
        else if (r.dev <= 1) add('frontier', 3);
        else add('colonial', 3);
      }
    }
    if (r.kind === 'home' && r.trait === 'forge') add('forged', 2);
    if (r.feature === 'asteroids') add('rockborn', 3);
    if (r.feature === 'nebula') add('hazeborn', 3);
    if (r.vein === 'antimatter') add('antimatter', 2);
    if (r.vein === 'crystal') add('crystal', 2);
    if (r.dev >= 4) add('equipped', 2);
    if (r.battles >= 3) add('veteranyard', 2);
    if ((r.story?.siege ?? 0) >= 1) add('siegehard', 2);
    const c = r.story?.calling;
    if (c && Object.hasOwn(CALLING_TRAIT, c.id)) add(CALLING_TRAIT[c.id][0], CALLING_TRAIT[c.id][1]);
  }
  const pl = owner >= 0 ? s.players[owner] : undefined;
  if (pl && s.rules.empire?.enabled !== false) {
    for (const l of pl.laws ?? []) if (Object.hasOwn(LAW_TRAIT, l)) add(LAW_TRAIT[l], 1.5);
    for (const t of pl.techs ?? []) if (Object.hasOwn(TECH_TRAIT, t)) add(TECH_TRAIT[t], 1);
  }
  if (fleet?.banner) {
    for (const b of fleet.banner.boons) if (Object.hasOwn(BOON_TRAIT, b)) add(BOON_TRAIT[b], 1);
    if (fleet.vow?.kind === 'never_retreat') add('blooded', 1);
  }
  // a little crew temperament everywhere, so two ships from the same yard still differ
  for (const g of GENERIC) add(g, 0.5);
  if (!w.size) add('colonial', 1);
  return w;
}

/**
 * Roll a new ship's traits. Uses its own stream derived from the game RNG's current state and the ship id,
 * so it stays deterministic and private without shifting the combat dice that follow.
 */
export function rollShipTraits(s: GameState, rngState: number, shipId: number, owner: PlayerId | -1, rid: RegionId | null | undefined, fleet?: Fleet | null): string[] {
  const S = s.rules.soul;
  if (!S || S.enabled === false || S.shipTraits === false || owner < 0) return [];
  const rng = new Rng((rngState ^ hashString(`trait:${shipId}`)) >>> 0);
  const pool = [...originPool(s, owner, rid, fleet).entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const total = pool.reduce((a, [, x]) => a + x, 0);
  let roll = rng.next() * total, pick = pool[0][0];
  for (const [id, x] of pool) { if ((roll -= x) < 0) { pick = id; break; } }
  const out = [pick];
  if (rng.chance(S.shipQuirkChance ?? 0)) {
    const quirks = Object.keys(SHIP_TRAITS).filter(k => SHIP_TRAITS[k].kind === 'quirk').sort();
    if (quirks.length) out.push(rng.pick(quirks));
  }
  return out;
}
