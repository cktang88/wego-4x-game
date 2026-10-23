// Commander portraits from game state (art/portraits.ts paints them): which marks a commander has earned, read from
// the fleet's public record only (scars, routs, rank, years of service), so a rival's portrait shows exactly what
// the map already tells. Used by the fleet card, the Herald's obituaries and the Saga.
import type { Fleet, GameState } from '../../../shared/sim/types.ts';
import type { FleetSaga } from '../../../shared/sim/herald.ts';
import { SCARS } from '../../../shared/config/content.ts';
import { tip } from './util.ts';
import { portraitImg, portraitCaption, type PortraitSpec } from '../art/portraits.ts';

/** Turns of service that grey a commander's temples (DELIGHT #38). */
export const GREY_AFTER = 15;
/** Routs that cost the eye (the "bad defeat"). */
export const MAIMED_AT = 2;

/** A living fleet's commander. */
export function fleetPortrait(st: GameState, f: Fleet, color: string): PortraitSpec {
  const since = f.banner?.foundedTurn ?? f.bornTurn ?? st.turn;
  return {
    name: f.commander.name, color,
    scars: (f.scars ?? []).map(s => s.id),
    maimed: (f.routs?.length ?? 0) >= MAIMED_AT,
    legend: f.commander.rank >= 5,
    rank: f.commander.rank,
    grey: st.turn - since >= GREY_AFTER,
  };
}

/** Did this commander die (a death notice, an obituary, or a name on a memorial)? Only what the state shows. */
export function commanderFell(st: GameState, name: string): boolean {
  if (!name) return false;
  for (const ed of st.soul?.herald ?? []) for (const h of ed.headlines) if ((h.kind === 'death' || h.kind === 'obituary') && h.text.includes(name)) return true;
  return st.regions.some(r => r.memorials.some(m => m.includes(name)));
}

/** A banner's commander as the Saga remembers it. */
export function sagaPortrait(st: GameState, f: FleetSaga, color: string): PortraitSpec {
  const end = f.fateTurn ?? st.turn;
  return {
    name: f.commander, color, scars: f.scars, maimed: f.routs >= MAIMED_AT, legend: f.rank >= 5, rank: f.rank,
    grey: end - f.foundedTurn >= GREY_AFTER,
    dead: f.fate !== 'alive' && f.fate !== 'retired' && f.fate !== 'merged' && commanderFell(st, f.commander),
  };
}

/** The <img>, with every mark named in its alt text and tooltip. */
export function portraitTag(spec: PortraitSpec, cssW: number, cls = 'portrait', how: 'tip' | 'title' = 'tip'): string {
  const cap = portraitCaption(spec, SCARS);
  const attr = how === 'tip' ? tip(cap) : ` title="${cap.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"`;
  return portraitImg(spec, cssW, cls, cap).replace('<img ', `<img${attr} `);
}
