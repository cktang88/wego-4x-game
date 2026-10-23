// The AI levels as rival houses (docs/DELIGHT.md #3): not "standard / expert" but a ruler with a face, a temper and a
// motto: the Crimson, who never forgive. The temper is the AI level (the sim's novice / standard / expert, nothing
// more); the house is the seat's enamel. The same ruler signs that house's dispatches in the Herald, in its own hand.
import type { Player } from '../../../shared/sim/types.ts';
import { houseOf, FACTION, type HouseKey } from '../art/bible.ts';
import { esc } from './dom.ts';
import { bannerSvg } from '../art/sigils.ts';
import { portraitImg, type PortraitPersona } from '../art/portraits.ts';

export type AiLevel = 'novice' | 'standard' | 'expert';
export interface Temper {
  persona: PortraitPersona;
  /** the ruler, by office */
  title: string;
  /** "who never forgive": completes "the Crimson, …" */
  epithet: string;
  motto: string;
  /** the hand its dispatches are written in (herald.css .dsp.hand-*) */
  hand: 'flourish' | 'clerk' | 'terse';
  /** the level in plain words (the lobby says what you are choosing) */
  level: string;
}
export const TEMPERS: Record<AiLevel, Temper> = {
  novice: { persona: 'heir', title: 'The Young Heir', epithet: 'who never wait', motto: 'First to the field.', hand: 'flourish', level: 'novice' },
  standard: { persona: 'steward', title: 'The Steward', epithet: 'who never hurry', motto: 'Slow ink, sure hand.', hand: 'clerk', level: 'standard' },
  expert: { persona: 'admiral', title: 'The Old Admiral', epithet: 'who never forgive', motto: 'We remember.', hand: 'terse', level: 'expert' },
};
/** A house's short name ("the Crimson"), by its colour, else the player's first word. */
export function houseShort(color: string, fallback = ''): string {
  const k = houseOf(color);
  if (k && k !== 'neutral' && k !== 'warden') return FACTION[k].name.split(' ')[0];
  return fallback.split(/\s+/)[0] || 'House';
}
/** The lobby's seats: seat 1 is Crimson, seat 2 Gilded (shared/sim/setup seat order). */
export const SEAT_KEYS: HouseKey[] = ['azure', 'crimson', 'gilded'];

/** "the Crimson, who never forgive" for an AI player (null for a human). */
export function aiHouseLine(p: Pick<Player, 'kind' | 'aiLevel' | 'color' | 'name'>): string | null {
  if (p.kind !== 'ai') return null;
  const t = TEMPERS[p.aiLevel] ?? TEMPERS.standard;
  return `the ${houseShort(p.color, p.name)}, ${t.epithet}`;
}

/** The ruler's portrait (a stock face per temper, in the house's coat). */
export function rulerImg(level: AiLevel, color: string, w: number, cls = 'portrait ruler'): string {
  const t = TEMPERS[level] ?? TEMPERS.standard;
  return portraitImg({ name: `${t.title} of ${color}`, color, persona: t.persona, rank: level === 'expert' ? 5 : level === 'standard' ? 3 : 1 }, w, cls, `${t.title}`);
}

/** The lobby's seat plate for a rival: the ruler, the house and its temper, the motto. Human: a friend's chair. */
export function seatPlate(seat: number, v: string, live = false): string {
  // live is one human per device: a hotseat chair is taken by the Steward (main.ts starts it as AI standard)
  if (live && v === 'human') v = 'standard';
  const key = SEAT_KEYS[seat] ?? 'crimson';
  const F = FACTION[key];
  const short = F.name.split(' ')[0];
  if (v === 'human') {
    return `<div class="lb-house human" style="--pc:${F.hi}"><span class="lb-chair" aria-hidden="true">${bannerSvg('crown', F.base, 40)}</span><div><b>${esc(F.name)}</b><small>A friend at this device</small><em>The curtain hides each player’s plans.</em></div></div>`;
  }
  const t = TEMPERS[v as AiLevel] ?? TEMPERS.standard;
  return `<div class="lb-house" style="--pc:${F.hi}">${rulerImg(v as AiLevel, F.base, 52)}<div><b>The ${esc(short)}, ${esc(t.epithet)}</b><small>${esc(t.title)} · AI ${esc(t.level)}</small><em>“${esc(t.motto)}”</em></div></div>`;
}
