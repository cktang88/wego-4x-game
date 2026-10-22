// Per-system feature ablation (docs/WORLD-CARD.md, "Simplification"): what does each per-system mechanic actually do?
//
// Two kinds of variant, both against the same seeds as the baseline (paired):
//   sym:<name>   a rules override for everyone (a passive feature switched off): game-feel metrics vs baseline.
//   deny:<name>  one seat (rotating) may not use an option: it plans against rules where the option is unaffordable
//                or has its free actions stripped, so the AI re-plans around it. Measures what the DECISION is worth:
//                the denied seat's win rate (fair share 33%) and its VP vs the same seat in the baseline.
//
//   npx vite-node scripts/ablate-world.ts -- --games 24 --variant base
//   npx vite-node scripts/ablate-world.ts -- --games 24 --variant deny:wposture --out /tmp/x.json
import { createGame, resolveTurn, planTurn, mergeRules, type GameState, type Submission } from '../shared/index.ts';
import { systemStatus } from '../shared/sim/contest.ts';
import { citizenCap, roleOf } from '../shared/sim/systems.ts';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const games = Number(arg('games', '24'));
const seed0 = Number(arg('seed', '1000'));
const variant = arg('variant', 'base');
const levels = arg('levels', 'expert,expert,expert').split(',') as ('expert' | 'standard' | 'novice')[];
const out = arg('out', '');

const HUGE = { industry: 1e7, credits: 1e7 };
const denyProject = (k: string) => ({ projects: { [k]: { cost: HUGE } } });

/** Symmetric rules overrides (a passive mechanic switched off for everyone). */
const SYM: Record<string, object> = {
  base: {},
  'no-growth': { systems: { growthEvery: 9999, gardenGrowthEvery: 9999 } },
  'no-contested': { systems: { contested: false } },
  'no-stars': { systems: { capYellow: 0, capRed: 0, blueHabitableMax: 9, binaryGarrison: 0, pulsarSensor: 0, pulsarGateDiscount: 0, blueMineIndustry: 0, gravityWell: false } },
  'no-milslots': { systems: { milSlots: 9 } },
  'no-gates': { systems: { shipyardCitizens: 0, academyCitizens: 0 } },
  'no-waystation': { systems: { waystationDiscount: 0 } },
  'no-calling': { soul: { callingAtDev: 99 } },
  'no-tenure': { soul: { tenureTiers: [999, 999, 999] } },
  'no-deeds': { soul: { deedFellHit: 0, deedUnbrokenArmor: 0, deedSeatGarrison: 0, deedLiberatedInfluence: 0 } },
  'no-wpostures': { signature: { worldPostures: false } },
  'no-tribute': { systems: { tributeTurns: 0 } },
  'no-cutoff': { empire: { cutOffYield: 1 } },
  'no-develop': { projects: { develop: { cost: { industry: 1e7, credits: 1e7 } } } },
  // harness-emulated: citizens grow everywhere (non-Core systems every growAllEvery turns) and Develop is gone
  'grow-all-no-develop': { projects: { develop: { cost: { industry: 1e7, credits: 1e7 } } } },
  'no-station': { projects: { station: { cost: { industry: 1e7, credits: 1e7 } } } },
};
/** Asymmetric denials: [planning-rules override for the denied seat, free-action filter, order filter]. */
type Deny = { rules?: object; free?: (fa: any) => boolean; order?: (o: any) => boolean };
const DENY: Record<string, Deny> = {
  wposture: { free: fa => fa.type === 'wposture' },
  surge: { free: fa => fa.type === 'fate' && fa.use === 'surge' },
  calling: { free: fa => fa.type === 'calling' },          // the default (first option) applies after a turn
  tribute: { free: fa => fa.type === 'tribute' },
  raze: { free: fa => fa.type === 'raze', order: o => o.type === 'raze' },
  engrave: { rules: { soul: { engraveInfluence: 1e7, engraveCredits: 1e7 } }, order: o => o.type === 'engrave' },
  // re-planning denials: the option is unaffordable for this seat's planner
  ...Object.fromEntries(['develop', 'fortress', 'mine', 'tradehub', 'sensor', 'academy', 'extractor', 'battery', 'pshield', 'depot', 'gate', 'station'].map(k => [k, { rules: denyProject(k), order: (o: any) => o.type === 'develop' && o.project === k } as Deny])),
  // the logistics trio (the "Outpost" merge hypothesis)
  outpost: {
    rules: { projects: Object.fromEntries(['sensor', 'depot', 'gate'].map(k => [k, { cost: HUGE }])) },
    order: o => o.type === 'develop' && ['sensor', 'depot', 'gate'].includes(o.project),
  },
  // all structures except Shipyard / Develop / Fortress (the "one upgrade track" hypothesis)
  structures: {
    rules: { projects: Object.fromEntries(['mine', 'tradehub', 'sensor', 'academy', 'extractor', 'battery', 'pshield', 'depot', 'gate', 'station'].map(k => [k, { cost: HUGE }])) },
    order: o => o.type === 'develop' && !['develop', 'shipyard', 'fortress'].includes(o.project),
  },
};

const [kind, name] = variant.includes(':') ? variant.split(':') : ['sym', variant];
const sym = kind === 'sym' ? SYM[name] : {};
const deny = kind === 'deny' ? DENY[name] : null;
if (sym === undefined || (kind === 'deny' && !deny)) { console.error(`unknown variant ${variant}`); process.exit(2); }

type GameRow = { seed: number; winner: number; turns: number; vp: number[]; denied: number | null; captures: number; battles: number; margin: number; t6leaderWon: boolean; use: Record<string, number>; useDenied: Record<string, number> };
const rows: GameRow[] = [];
const t0 = Date.now();
for (let g = 0; g < games; g++) {
  const seed = seed0 + g;
  let s: GameState = createGame({ seed, players: levels.map(l => ({ kind: 'ai' as const, aiLevel: l })), rules: sym });
  const denied = deny ? g % 3 : null;
  const denyRules = deny?.rules ? mergeRules(s.rules, deny.rules) : null;
  const use: Record<string, number> = {}, useDenied: Record<string, number> = {};
  const bump = (k: string, p: number | null = null, n = 1) => { use[k] = (use[k] ?? 0) + n; if (p !== null && p === denied) useDenied[k] = (useDenied[k] ?? 0) + n; };
  let captures = 0, battles = 0, t6: number | null = null;
  while (s.winner === null && s.turn < 200) {
    const subs: Record<number, Submission> = {};
    for (const p of s.players) {
      let sub = p.id === denied && denyRules ? planTurn({ ...s, rules: denyRules }, p.id) : planTurn(s, p.id);
      if (p.id === denied && deny) {
        sub = { ...sub, free: sub.free.filter(fa => !deny.free?.(fa)), orders: sub.orders.map(o => (o && deny.order?.(o) ? null : o)) };
      }
      subs[p.id] = sub;
      for (const fa of sub.free) {
        if (fa.type === 'wposture') bump(`wposture:${fa.posture}`, p.id);
        if (fa.type === 'fate') bump(`fate:${fa.use}`, p.id);
        if (fa.type === 'calling') bump('calling pick', p.id);
        if (fa.type === 'tribute') bump(fa.accept ? 'tribute accept' : 'tribute offer', p.id);
        if (fa.type === 'raze') bump('raze', p.id);
      }
      for (const o of sub.orders) if (o) { bump(`order:${o.type}`, p.id); if (o.type === 'develop') bump(`proj:${o.project}`, p.id); }
    }
    s = resolveTurn(s, subs as any);
    if (name === 'grow-all-no-develop') {
      // emulated rule: owned non-Core systems below their cap, not contested, gain a citizen every 4 turns
      for (const r of s.regions) {
        if (r.owner === null || !r.bodies || roleOf(r) === 'core') continue;
        const cap = citizenCap(s, r) ?? 0;
        if (r.dev >= cap || systemStatus(s, r).contested) continue;
        (r as any).growAll = ((r as any).growAll ?? 0) + 1;
        if ((r as any).growAll >= 4) { (r as any).growAll = 0; r.dev += 1; bump('growth (emulated, non-Core)'); }
      }
    }
    battles += s.last!.battles.length;
    for (const e of s.last!.events as any[]) {
      if (e.k === 'capture') captures++;
      if (e.k === 'project' && e.done) bump(`built:${e.key}`, e.owner ?? null);
      if (e.k === 'note' && typeof e.text === 'string') {
        if (e.text.includes(' grows: citizens')) bump('growth');
        if (e.text.startsWith('Refugees')) bump('refugees');
      }
      if (e.k === 'posture' && e.posture && ['levies', 'scorch', 'gates'].includes(e.posture)) bump(`wpo-${e.posture}:${e.outcome}`, e.owner);
      if (e.k === 'blocked' && /gravity/.test(e.reason ?? e.text ?? '')) bump('gravity well stops');
    }
    for (const r of s.regions) {
      if (r.owner === null || !r.bodies) continue;
      const st = systemStatus(s, r);
      if (st.contested) bump('contested sys-turns');
      if (st.occupiedLeft > 0) bump('occupied sys-turns');
      if (st.tribute) bump('tribute sys-turns');
      if (r.story?.calling) bump('calling sys-turns');
    }
    if (s.turn - 1 === 6) { const srt = s.players.slice().sort((a, b) => b.vp - a.vp); t6 = srt[0].id; }
  }
  const vps = s.players.map(p => p.vp);
  const srt = vps.slice().sort((a, b) => b - a);
  rows.push({ seed, winner: s.winner ?? 0, turns: s.turn - 1, vp: vps, denied, captures, battles, margin: srt[0] - srt[1], t6leaderWon: t6 === s.winner, use, useDenied });
  process.stderr.write(`${variant} g${g} ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
  if (out) writeFileSync(`${out}.partial`, JSON.stringify({ sum: { variant, games: rows.length }, rows }));
}
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const sum: any = {
  variant, games, levels: levels.join(','), msPerGame: Math.round((Date.now() - t0) / games),
  turns: +avg(rows.map(r => r.turns)).toFixed(1), captures: +avg(rows.map(r => r.captures)).toFixed(1), battles: +avg(rows.map(r => r.battles)).toFixed(1),
  margin: +avg(rows.map(r => r.margin)).toFixed(1), t6leaderWon: rows.filter(r => r.t6leaderWon).length,
  use: Object.fromEntries(Object.entries(rows.reduce((m, r) => { for (const [k, v] of Object.entries(r.use)) m[k] = (m[k] ?? 0) + v; return m; }, {} as Record<string, number>)).sort().map(([k, v]) => [k, +(v / games).toFixed(2)])),
};
if (deny) {
  sum.deniedWins = rows.filter(r => r.winner === r.denied).length;
  sum.deniedVp = +avg(rows.map(r => r.vp[r.denied!])).toFixed(2);
  sum.othersVp = +avg(rows.map(r => (r.vp.reduce((a, b) => a + b, 0) - r.vp[r.denied!]) / 2)).toFixed(2);
}
console.log(JSON.stringify(sum));
if (out) writeFileSync(out, JSON.stringify({ sum, rows }));
