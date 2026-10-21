// AI for the Soul layer: founding combos per style, vows, honours, callings, razing, retirement, dispatches.
// Deterministic (hash/seeded only). Balance-sim hook: globalThis.__tcSoulCombos = 'none' | 'random' | 'style'
// (default 'style'): what boons/banes AI fleets are founded with (scripts/simulate.ts --combos).
import { BOONS, BANES } from '../config/content.ts';
import { styleOf, type Style } from './ai-empire.ts';
import { aiDispatch } from './herald.ts';
import { hashString } from './rng.ts';
import { SR, soulOn, modsBlock, bannersFree, hasBoon } from './soul.ts';
import type { Fleet, FoundSpec, FreeAction, GameState, Order, PlayerId } from './types.ts';

type Level = 'novice' | 'standard' | 'expert';

/** Boons/banes each style founds its fleets with (all legal with freePoints >= 1). */
export const STYLE_COMBOS: Record<Style, { boons: string[]; banes: string[] }[]> = {
  warlord: [{ boons: ['shock', 'siegebreakers'], banes: ['green', 'hungry', 'looselips'] }, { boons: ['hunters'], banes: ['green'] }],
  turtle:  [{ boons: ['medics', 'ambushers'], banes: ['looselips', 'hungry'] }, { boons: ['iron', 'inspiring'], banes: ['looselips', 'gilded', 'green'] }],
  trader:  [{ boons: ['salvagers', 'medics'], banes: ['gilded', 'homesick'] }, { boons: ['medics'], banes: ['hungry'] }],
  raider:  [{ boons: ['raiders', 'cleanbreak'], banes: ['green', 'glass', 'hungry'] }, { boons: ['longrange'], banes: ['glass', 'hungry'] }],
};
const HONOUR_PREF: Record<Style, string[]> = {
  warlord: ['shock', 'siegebreakers', 'hunters', 'iron', 'ambushers', 'medics', 'cleanbreak', 'salvagers', 'raiders', 'inspiring', 'longrange', 'ghosts', 'beloved'],
  turtle:  ['ambushers', 'iron', 'inspiring', 'medics', 'cleanbreak', 'shock', 'hunters', 'siegebreakers', 'salvagers', 'beloved', 'longrange', 'raiders', 'ghosts'],
  trader:  ['medics', 'salvagers', 'cleanbreak', 'ambushers', 'iron', 'shock', 'hunters', 'beloved', 'inspiring', 'siegebreakers', 'raiders', 'longrange', 'ghosts'],
  raider:  ['raiders', 'hunters', 'cleanbreak', 'shock', 'longrange', 'ghosts', 'siegebreakers', 'medics', 'ambushers', 'salvagers', 'iron', 'inspiring', 'beloved'],
};
const CALLING_PREF: Record<Style, string[]> = {
  warlord: ['arsenal', 'proving', 'bastion', 'bulwark', 'granary', 'refinery', 'cenotaph', 'oracle'],
  turtle:  ['bastion', 'bulwark', 'cenotaph', 'granary', 'arsenal', 'refinery', 'proving', 'oracle'],
  trader:  ['refinery', 'granary', 'arsenal', 'bastion', 'oracle', 'bulwark', 'proving', 'cenotaph'],
  raider:  ['arsenal', 'oracle', 'refinery', 'proving', 'granary', 'bastion', 'bulwark', 'cenotaph'],
};

/** A random legal boon/bane combination (deterministic from `key`). */
export function randomCombo(s: GameState, pid: PlayerId, key: string): { boons: string[]; banes: string[] } {
  const boonIds = Object.keys(BOONS).sort(), baneIds = Object.keys(BANES).filter(b => b !== 'grudgebound').sort();
  let h = hashString(key);
  const next = () => { h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; h = (h ^ (h >>> 13)) >>> 0; return h; };
  for (let tries = 0; tries < 40; tries++) {
    const nb = next() % 3, nn = next() % 4;
    const boons = [...new Set(Array.from({ length: nb }, () => boonIds[next() % boonIds.length]))];
    const banes = [...new Set(Array.from({ length: nn }, () => baneIds[next() % baneIds.length]))];
    if (!modsBlock(s, pid, boons, banes)) return { boons, banes };
  }
  return { boons: [], banes: [] };
}

/** Founding data for a new AI fleet at `region`. */
export function aiFoundSpec(s: GameState, pid: PlayerId, lvl: Level, region: number): FoundSpec {
  const mode = (globalThis as { __tcSoulCombos?: string }).__tcSoulCombos ?? 'style';
  const n = s.fleets.filter(f => f.owner === pid).length;
  let combo: { boons: string[]; banes: string[] };
  if (mode === 'none' || lvl === 'novice') combo = { boons: [], banes: [] };
  else if (mode === 'random') combo = randomCombo(s, pid, `${s.seed}:${s.turn}:${pid}:${region}:${n}`);
  else { const opts = STYLE_COMBOS[styleOf(s, pid)]; combo = opts[n % opts.length]; }
  if (modsBlock(s, pid, combo.boons, combo.banes)) combo = { boons: [], banes: [] };
  return { boons: [...combo.boons], banes: [...combo.banes] };
}

interface Ctx { s: GameState; pid: PlayerId; lvl: Level; threatened: Map<number, number>; mainArmy?: Fleet }

/** Free actions: pick honours and callings, swear the odd vow, raze what can't be held, plant a dispatch. */
export function soulFree(c: Ctx): FreeAction[] {
  const { s, pid, lvl } = c;
  const out: FreeAction[] = [];
  if (!soulOn(s)) return out;
  const style = styleOf(s, pid);
  const mine = s.fleets.filter(f => f.owner === pid && f.ships.length && f.id >= 0);
  // ---- honours: the one that best fits the style
  for (const f of mine) {
    if (!f.pendingHonour) continue;
    const pick = f.pendingHonour.options.slice().sort((a, b) => HONOUR_PREF[style].indexOf(a) - HONOUR_PREF[style].indexOf(b))[0];
    out.push({ type: 'honour', fleet: f.id, pick });
    f.pendingHonour = null;
  }
  // ---- callings: threatened worlds want walls; otherwise the style's economy
  for (const r of s.regions) {
    const pc = r.story?.pendingCalling;
    if (!pc || r.owner !== pid) continue;
    const pref = (c.threatened.get(r.id) ?? 0) > 0.3 ? ['bastion', 'bulwark', ...CALLING_PREF[style]] : CALLING_PREF[style];
    const pick = pc.options.slice().sort((a, b) => pref.indexOf(a) - pref.indexOf(b))[0];
    out.push({ type: 'calling', region: r.id, pick });
    r.story!.pendingCalling = null;
  }
  if (lvl === 'novice') return out;
  // ---- vows: at most one new vow a turn, only ones it can keep
  const swear = (f: Fleet, fa: FreeAction) => { out.push(fa); f.vow = { kind: (fa as { vow: 'throne' }).vow, since: s.turn }; };
  const free = mine.filter(f => f.banner && !f.vow && !f.limping);
  const debts = (s.soul?.debts ?? []).filter(d => !d.cleared && d.creditor === pid);
  let sworn = false;
  for (const f of free) {
    if (sworn) break;
    // avenge a commander who owes us blood, when one is in sight
    const foe = s.fleets.find(x => x.owner >= 0 && x.owner !== pid && x.ships.length && (debts.some(d => d.killer === x.commander.name) || !!f.commander.rivals[x.commander.name]?.lastWinner && f.commander.rivals[x.commander.name].lastWinner === x.commander.name));
    if (foe) { swear(f, { type: 'vow', fleet: f.id, vow: 'avenge', target: foe.id }); sworn = true; continue; }
    const here = s.regions[f.region];
    // a turtle posts a second fleet (never its main army) on oath at a threatened capital
    if (lvl === 'expert' && style === 'turtle' && f !== c.mainArmy && here.id === s.players[pid].capital && here.owner === pid && f.ships.length >= 2 && (c.threatened.get(here.id) ?? 0) > 0.3) {
      swear(f, { type: 'vow', fleet: f.id, vow: 'guard', region: here.id }); sworn = true; continue;
    }
    if (lvl === 'expert' && style === 'warlord' && f === c.mainArmy && f.ships.length >= 5 && f.commander.rank >= 2) {
      swear(f, { type: 'vow', fleet: f.id, vow: 'never_retreat' }); sworn = true; continue;
    }
    if (style === 'raider' && here.owner === pid && here.relic === 'unclaimed') { swear(f, { type: 'vow', fleet: f.id, vow: 'relic' }); sworn = true; continue; }
    if ((style === 'trader' || style === 'raider' || style === 'warlord') && f === c.mainArmy && !s.wardenAwake && s.turn >= 6) { swear(f, { type: 'vow', fleet: f.id, vow: 'throne' }); sworn = true; continue; }
  }
  // ---- raze: a world taken last turn that can't be held (or the game is ending) is worth more as loot
  if (lvl === 'expert') for (const r of s.regions) {
    const cap = r.story?.captured;
    if (!cap || cap.by !== pid || r.owner !== pid || s.turn - cap.turn !== 1 || cap.from === null) continue;
    if (r.kind === 'crown' || r.kind === 'throne' || r.id === s.players[pid].capital) continue;
    const ending = s.turn >= s.rules.victory.turnLimit - 1;
    const doomed = (c.threatened.get(r.id) ?? 0) > 0.6 || (r.kind === 'colony' && r.dev <= 1 && s.fleets.some(f => f.owner === cap.from && f.ships.length >= 3 && (s.regions[f.region].links ?? s.regions[f.region].neighbors).includes(r.id)));
    if (ending || doomed) { out.push({ type: 'raze', region: r.id }); r.story!.captured = null; }
  }
  // ---- the Herald: an occasional boast, threat or lie
  const d = aiDispatch(s, pid);
  if (d) out.push({ type: 'dispatch', text: d.text, as: d.as });
  return out;
}

/** Order candidates: retire a battered legend rarely. */
export function soulCands(c: Ctx): { o: Order; v: number; tag: string }[] {
  const { s, pid, lvl } = c;
  const out: { o: Order; v: number; tag: string }[] = [];
  if (!soulOn(s) || lvl === 'novice') return out;
  for (const f of s.fleets) {
    if (f.owner !== pid || !f.banner || f.commander.rank < SR(s).retireMinRank || !f.ships.length) continue;
    const r = s.regions[f.region];
    if (r.owner !== pid || (c.threatened.get(r.id) ?? 0) > 0) continue;
    // a twice-scarred legend sitting at home has done its part: its Haven outlives it
    if ((f.scars?.length ?? 0) >= SR(s).breakAtScars - 1 && f.ships.length <= 2) out.push({ o: { type: 'retire', fleet: f.id }, v: 3.2, tag: `retire:${f.id}` });
  }
  return out;
}

/** Can a non-scout ship be built into a new fleet here (a banner is free)? */
export const canFound = (s: GameState, pid: PlayerId) => !soulOn(s) || bannersFree(s, pid) > 0;
export { hasBoon };
