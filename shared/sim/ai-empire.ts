// AI for the Empire layer: what to research, which laws, modules, projects and refits.
// Each AI seat gets a deterministic *style* so the three empires diverge (and so we can
// measure in simulations whether every style is viable).
import { TECH, TECHS, LAWS, type Branch } from '../config/empire.ts';
import { blueprintFor, classBlock, hasTech, hasVein, lawBlock, lawSlots, researchBlock, techCost, connected } from './empire.ts';
import { canAfford, orderCost, pay } from './orders.ts';
import { creditRate } from './resolve.ts';
import { within } from './graph.ts';
import type { Rng } from './rng.ts';
import type { FreeAction, GameState, Order, PlayerId, Region } from './types.ts';

export type Style = 'warlord' | 'turtle' | 'trader' | 'raider';
export const STYLES: Style[] = ['warlord', 'turtle', 'trader', 'raider'];
const PRIORITY: Record<Style, Branch[]> = {
  warlord: ['war', 'logistics', 'bulwark', 'state'],
  turtle:  ['bulwark', 'war', 'state', 'logistics'],
  trader:  ['state', 'war', 'bulwark', 'logistics'],
  raider:  ['logistics', 'war', 'bulwark', 'state'],
};

/** A seat's style: fixed for the game, different for each seat. */
export function styleOf(s: GameState, pid: PlayerId): Style {
  const base = (s.seed >>> 3) % STYLES.length;
  return STYLES[(base + pid) % STYLES.length];
}

interface Ctx { s: GameState; pid: PlayerId; lvl: 'novice' | 'standard' | 'expert'; rng: Rng; threatened: Map<number, number> }

/** Free actions: research (at most one) and blueprints. Pays for research in s (the AI's projected state). */
export function empireFree(c: Ctx): FreeAction[] {
  const { s, pid, lvl, rng } = c;
  const out: FreeAction[] = [];
  if (s.rules.empire?.enabled === false) return out;
  const me = s.players[pid];
  const style = styleOf(s, pid);
  // ---- research
  // (globalThis.__tcNoResearch: test hook for scripts/research-value.ts)
  const pick = (globalThis as any).__tcNoResearch?.includes(pid) ? null : chooseTech(s, pid, style, lvl, rng);
  if (pick) {
    const cost = techCost(s, pid, pick);
    // keep enough to keep the shipyards busy: research is an investment, not a substitute for ships
    const reserveInd = lvl === 'expert' ? (s.turn <= 1 ? 999 : 14) : lvl === 'standard' ? 30 : 10;
    const ok = canAfford(me.res, cost, creditRate(s, pid)) && me.res.industry - (cost.industry ?? 0) >= reserveInd - (c.threatened.size ? -20 : 0) && me.res.credits - (cost.credits ?? 0) >= 6;
    if (ok && (lvl !== 'novice' || rng.chance(0.5))) {
      out.push({ type: 'research', tech: pick });
      pay(me.res, cost, creditRate(s, pid));   // like the resolver: credits cover an industry shortfall
      (me.techs ??= []).push(pick);
      me.researched = (me.researched ?? 0) + 1;
    }
  }
  // ---- blueprints: fit the best module we know to each class
  for (const cls of Object.keys(s.rules.ships)) {
    const want = bestModule(s, pid, cls, style);
    if (want && want !== blueprintFor(s, pid, cls)) { out.push({ type: 'blueprint', cls, mod: want }); (me.blueprint ??= {})[cls] = want; }
  }
  return out;
}

function chooseTech(s: GameState, pid: PlayerId, style: Style, lvl: string, rng: Rng): string | null {
  const ok = (id: string) => !researchBlock(s, pid, id);
  const avail = TECHS.filter(t => ok(t.id));
  if (!avail.length) return null;
  if (lvl === 'novice') return rng.pick(avail).id;
  const conn = connected(s, pid);
  const pri = PRIORITY[style];
  const score = (id: string) => {
    const t = TECH[id];
    let v = 10 - pri.indexOf(t.branch) * 2.2 - t.tier * 1.8;   // breadth first: tier I techs pay off early
    if (t.tier === 4) v += 4;                              // ★ technologies are a race
    // tier-III forks: pick the one that fits the situation
    if (id === 'pshield' || id === 'gates') v += hasVein(s, pid, 'crystal', conn) ? 1.5 : -6;
    if (id === 'siege') v += style === 'warlord' ? -1 : 1;
    if (id === 'alpha') v += style === 'warlord' ? 1 : 0;
    if (id === 'regen') v += style === 'turtle' && !hasVein(s, pid, 'crystal', conn) ? 2 : 0;
    if (id === 'markets') v += style === 'trader' ? 1 : 0;
    if (id === 'cruisers') v += hasVein(s, pid, 'antimatter', conn) ? 2 : -1.5;
    if (id === 'trade' && s.pacts.some(x => x.a === pid || x.b === pid)) v += 1;
    return v;
  };
  avail.sort((a, b) => score(b.id) - score(a.id) || a.id.localeCompare(b.id));
  return avail[0].id;
}

function bestModule(s: GameState, pid: PlayerId, cls: string, style: Style): string | null {
  const has = (t: string) => hasTech(s, pid, t);
  if (cls === 'scout' || cls === 'corvette') return has('ion') ? 'ion' : 'armor';
  if (cls === 'bombard') return has('deflectors') ? 'deflector' : 'armor';
  if (has('railguns') && (style !== 'turtle' || !has('deflectors'))) return 'railgun';
  if (has('deflectors')) return 'deflector';
  if (has('ion') && style === 'raider' && cls === 'frigate') return 'ion';
  return 'armor';
}

/** How much `p` would like this region for its Empire-layer features (veins, traits, academies). */
export function empireRegionValue(s: GameState, pid: PlayerId, r: Region): number {
  if (s.rules.empire?.enabled === false) return 0;
  let v = 0;
  if (r.vein) v += hasVein(s, pid, r.vein) ? 1.5 : 4;
  if (r.trait) v += 1;
  if (r.owner !== null && r.owner !== pid && (r.buildings.academy ?? 0) > 0) v += 2.5;
  return v;
}

/** Candidate orders: laws, Empire projects and refits. */
export function empireCands(c: Ctx, myRegions: Region[], mainArmyRegion: number | null): { o: Order; v: number; tag: string }[] {
  const { s, pid, lvl, threatened } = c;
  const out: { o: Order; v: number; tag: string }[] = [];
  if (s.rules.empire?.enabled === false) return out;
  const me = s.players[pid];
  const style = styleOf(s, pid);
  const novice = lvl === 'novice';
  // ---- laws
  if ((me.laws?.length ?? 0) < lawSlots(s, pid)) {
    const law = chooseLaw(s, pid, style, myRegions);
    if (law && !lawBlock(s, pid, law)) out.push({ o: { type: 'law', law }, v: (novice ? 2 : 3.6) + (s.turn < 6 ? 0.8 : 0), tag: 'law' });
  }
  // ---- projects
  const conn = connected(s, pid);
  const has = (t: string) => hasTech(s, pid, t);
  const count = (b: string) => myRegions.reduce((a, r) => a + (r.buildings[b] ?? 0), 0);
  const left = s.rules.victory.turnLimit - s.turn;
  for (const r of myRegions) {
    if (r.project) continue;
    const add = (key: string, v: number) => out.push({ o: { type: 'develop', region: r.id, project: key }, v, tag: `dev:${r.id}` });
    const threat = threatened.get(r.id) ?? 0;
    if (r.vein && !(r.buildings.extractor ?? 0) && conn.has(r.id)) add('extractor', 4 + (hasVein(s, pid, r.vein, conn) ? -1.5 : 1.5) + (left > 10 ? 0.5 : -2));
    if (r.id === me.capital && left > 8) {
      const ac = r.buildings.academy ?? 0;
      if (ac < 1 && s.turn >= 2) add('academy', (style === 'trader' || style === 'turtle' ? 3.8 : 3) - (novice ? 1 : 0));
      else if (ac === 1 && s.turn >= 7 && me.res.industry > 50) add('academy', 2.2);
    }
    const key = r.kind === 'home' || r.kind === 'crown' || r.kind === 'throne';
    if (has('batteries') && key && (r.buildings.battery ?? 0) < 2) add('battery', 2.2 + threat * 7 + (style === 'turtle' ? 0.8 : 0));
    if (has('pshield') && key && !r.buildings.pshield && hasVein(s, pid, 'crystal', conn)) add('pshield', 2.6 + threat * 6);
    if (has('depots') && count('depot') < 2 && mainArmyRegion !== null && !r.buildings.depot && r.id !== me.capital && within(s, mainArmyRegion, 1).has(r.id)) add('depot', 2.8);
    if (has('gates') && count('gate') < 2 && !r.buildings.gate && hasVein(s, pid, 'crystal', conn) && (r.id === me.capital || r.kind === 'crown' || r.kind === 'throne')) add('gate', 2.6);
  }
  // ---- refits: bring outdated fleets up to the blueprint while they sit at a shipyard
  for (const f of s.fleets) {
    if (f.owner !== pid || !f.ships.length) continue;
    const r = s.regions[f.region];
    if (r.owner !== pid || !(r.buildings.shipyard ?? 0)) continue;
    const stale = f.ships.filter(sh => sh.mod !== blueprintFor(s, pid, sh.cls)).length;
    const hurt = f.ships.filter(sh => sh.hp < sh.maxHp * 0.6).length;
    if (stale >= 2 || hurt >= 2) out.push({ o: { type: 'refit', fleet: f.id }, v: 1.6 + stale * 0.5 + hurt * 0.6, tag: `refit:${f.id}` });
  }
  return out;
}

function chooseLaw(s: GameState, pid: PlayerId, style: Style, myRegions: Region[]): string | null {
  const me = s.players[pid];
  const held = new Set(me.laws ?? []);
  const pairHeld = (pair: number) => LAWS.some(l => l.pair === pair && held.has(l.id));
  const creditsTight = me.res.credits < me.res.industry * 0.4;
  const agents = myRegions.some(r => r.loyalty.some((x, i) => i !== pid && x >= 40));
  const want: Record<number, string> = {
    0: style === 'turtle' || style === 'trader' ? 'bastion' : 'vanguard',
    1: style === 'trader' || creditsTight ? 'mercantile' : 'industrial',
    2: myRegions.length <= 6 ? 'central' : 'federal',
    3: agents ? 'martial' : 'open',
  };
  const order: Record<Style, number[]> = { warlord: [1, 0, 2, 3], turtle: [0, 1, 3, 2], trader: [1, 3, 2, 0], raider: [0, 1, 2, 3] };
  for (const pair of order[style]) if (!pairHeld(pair)) return want[pair];
  return null;
}

/** Can `pid` build this class at all? (tech + vein) */
export const canField = (s: GameState, pid: PlayerId, cls: string) => !classBlock(s, pid, cls);
export { orderCost };
