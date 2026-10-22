// The four Improve tracks (docs/SIMPLIFY.md §4): Works (economy), Yard (hull sizes), Walls (defence) and Outpost
// (supply, sight, gates). A track groups today's projects; the picker chooses the concrete building the next level
// buys, from the system's bodies, the research and the rules. Pure: the world card's Improve tab and (stage C) a
// develop order that names a track both use it, so the button and the resolver can never disagree.
import type { GameState, Order, PlayerId, Region } from './types.ts';
import { validateOrder } from './orders.ts';
import { TRACKS, TRACK_MEMBERS, roleOf, stationCut, sysOn, isWaystation, type Track } from './systems.ts';
import { maxDevAt } from './empire.ts';

export { TRACKS, TRACK_MEMBERS, type Track };
export const isTrack = (k: unknown): k is Track => typeof k === 'string' && (TRACKS as readonly string[]).includes(k);

/** Does this world add citizens by itself (an owned Core with star systems on)? Elsewhere Develop is a Works member. */
export const growsItself = (s: GameState, r: Region): boolean => sysOn(s) && roleOf(r) === 'core';

/** One step of a track: a project and the level it reaches. */
export interface Step { key: string; to: number }

/** The steps of a track in the order the picker takes them, for this world (a level a building already has is skipped). */
export function trackSteps(s: GameState, r: Region, t: Track): Step[] {
  const lv = (k: string) => (k === 'develop' ? r.dev : r.buildings[k] ?? 0);
  const P = s.rules.projects;
  const max = (k: string) => (k === 'develop' ? maxDevAt(s, r.id) : P[k]?.max ?? 0);
  const ladder = (k: string, from = 1) => Array.from({ length: Math.max(0, max(k) - from + 1) }, (_, i) => ({ key: k, to: from + i }));
  let steps: Step[] = [];
  switch (t) {
    case 'yard': steps = ladder('shipyard'); break;
    // Fortress I, then the researched and crystal levels between the Fortress levels
    case 'walls': steps = [{ key: 'fortress', to: 1 }, { key: 'battery', to: 1 }, { key: 'fortress', to: 2 }, { key: 'pshield', to: 1 }, { key: 'fortress', to: 3 }, { key: 'battery', to: 2 }]; break;
    case 'outpost': steps = [{ key: 'depot', to: 1 }, { key: 'sensor', to: 1 }, { key: 'gate', to: 1 }, { key: 'sensor', to: 2 }]; break;
    case 'works': {
      // Extractor (on a vein) → +1 citizen (worlds that don't grow by themselves) → Mine / Trade Hub, the lower first
      // (a tie: the Mine) → Academy (Cores with citizens; always last: SIMPLIFY.md found the AI overvalues it)
      if (r.vein) steps.push(...ladder('extractor'));
      if (!growsItself(s, r)) steps.push(...ladder('develop', r.dev + 1));
      // interleave the two ladders by level, so the lower of the two is raised first (the Mine winning ties)
      const both: Step[] = [...ladder('mine'), ...ladder('tradehub')].filter(x => lv(x.key) < x.to)
        .sort((a, b) => a.to - b.to || (a.key === 'mine' ? -1 : 1));
      steps.push(...both);
      if (!sysOn(s) || roleOf(r) === 'core' || r.kind === 'home') steps.push(...ladder('academy'));
      break;
    }
  }
  return steps.filter(x => P[x.key] && lv(x.key) < x.to && x.to <= max(x.key));
}

/** Every member of a track that could be ordered here (for the long-press list), in picker order, with the next level. */
export function trackMembers(s: GameState, r: Region, t: Track): { key: string; lvl: number; max: number }[] {
  const keys = t === 'works' ? ['extractor', 'develop', 'mine', 'tradehub', 'academy', ...(stationCut(s) || !sysOn(s) ? [] : ['station'])] : [...TRACK_MEMBERS[t]];
  return keys.filter(k => s.rules.projects[k] && (k !== 'extractor' || !!r.vein)).map(k => ({
    key: k,
    lvl: k === 'develop' ? r.dev : r.buildings[k] ?? 0,
    max: k === 'develop' ? maxDevAt(s, r.id) : s.rules.projects[k].max,
  }));
}

/** The member a track's next level buys here, or why the track can't move now. */
export interface Pick { key: string | null; to: number; why: string | null; order: Order | null }

/** nextInTrack for a region id (validators, the resolver): a bad id or an unowned region gives no order. */
export function trackOrder(s: GameState, p: PlayerId, rid: number, t: Track): Pick {
  const r = Number.isInteger(rid) ? s.regions[rid] : undefined;
  if (!r) return { key: null, to: 0, why: 'no such region', order: null };
  if (r.owner !== p) return { key: null, to: 0, why: 'not your region', order: null };
  return nextInTrack(s, p, r, t);
}

/** Reasons that mean "not this member, try the next" rather than "the track is stuck". */
const skippable = (why: string) => /^needs |crystal|antimatter|no vein|no belt|surface|trade hub needs|already at max|academy needs|no works site|track full|nothing to build/i.test(why);

/**
 * The concrete project the next level of track `t` buys at r for player p: the first step whose order validates.
 * Outpost waits for its Depot (the track is dimmed "needs Supply Depots") except at a Waystation, which may start
 * with the Sensor. With nothing legal: the first step's reason (a project underway, an unpaid gate, the cap...).
 */
export function nextInTrack(s: GameState, p: PlayerId, r: Region, t: Track): Pick {
  const steps = trackSteps(s, r, t);
  if (!steps.length) return { key: null, to: 0, why: 'max', order: null };
  let first: string | null = null;
  for (const [i, st] of steps.entries()) {
    const o: Order = { type: 'develop', region: r.id, project: st.key };
    const why = validateOrder(s, p, o);
    if (!why) return { key: st.key, to: st.to, why: null, order: o };
    first ??= why;
    // a project underway, an order budget, someone else's world: every member would say the same
    if (!skippable(why)) return { key: st.key, to: st.to, why, order: null };
    if (t === 'outpost' && i === 0 && st.key === 'depot' && !isWaystation(s, r) && /^needs /.test(why)) return { key: st.key, to: st.to, why, order: null };
  }
  return { key: steps[0].key, to: steps[0].to, why: first, order: null };
}
