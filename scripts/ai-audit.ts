// AI audit: how many of the orders the AI proposes fail at resolve time (wasted slots)?
//   npx tsx scripts/ai-audit.ts --games 20 [--levels expert,standard,novice] [--live 300]
// Counts 'fail' events per order type per AI level, plus (LIVE) ticks where an AI with a banked
// order queued nothing, and checks that planTurn never mutates the state it is given.
import { createGame, resolveTurn, planTurn, makeLive, runTick, viewFor, type GameState } from '../shared/index.ts';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const games = Number(arg('games', '20'));
const levels = arg('levels', 'expert,standard,novice').split(',') as any[];
const liveTicks = Number(arg('live', '0'));
const fogged = args.includes('--fog');   // plan from the fogged view, like an online steward / client AI
const seed0 = Number(arg('seed', '2000'));

const issued: Record<string, Record<string, number>> = {};
const failed: Record<string, Record<string, number>> = {};
const reasons: Record<string, number> = {};
let mutations = 0;
const bump = (m: Record<string, Record<string, number>>, l: string, k: string) => { (m[l] ??= {})[k] = (m[l][k] ?? 0) + 1; };
const typeOf = (text: string) => {
  const m = /^(\w[\w ]*?) failed:/.exec(text);
  if (m) return m[1];
  if (text.includes('exhausted')) return 'Seize(also)';
  if (text.includes("can't join")) return 'Seize(also)';
  return 'other';
};

function plan(s: GameState, pid: number) {
  const before = JSON.stringify(s);
  const src = fogged ? viewFor(s, pid).state : s;
  const sub = planTurn(src, pid);
  if (JSON.stringify(s) !== before) mutations++;
  return sub;
}

if (!liveTicks) {
  for (let g = 0; g < games; g++) {
    const lv = levels.map((_, i) => levels[(i + g) % levels.length]);
    let s: GameState = createGame({ seed: seed0 + g, players: lv.map(l => ({ kind: 'ai' as const, aiLevel: l })) });
    while (s.winner === null && s.turn < 200) {
      const subs: any = {};
      for (const p of s.players) {
        subs[p.id] = plan(s, p.id);
        for (const o of subs[p.id].orders) if (o) bump(issued, p.aiLevel, o.type);
        for (const f of subs[p.id].free) if (f.type === 'research') bump(issued, p.aiLevel, 'research');
      }
      s = resolveTurn(s, subs);
      for (const e of s.last!.events) if (e.k === 'fail' && e.owner >= 0) {
        const t = typeOf(e.text);
        bump(failed, s.players[e.owner].aiLevel, t);
        const r = `${s.players[e.owner].aiLevel[0]} ${t}: ${e.text.replace(/^.*failed: /, '').replace(/\d+/g, 'N').replace(/[A-Z][a-z]+ [A-Z][a-z]+/g, 'X')}`;
        reasons[r] = (reasons[r] ?? 0) + 1;
      }
    }
  }
} else {
  // LIVE: run N ticks of an all-AI game; an order is wasted if the AI had one banked and queued nothing
  for (let g = 0; g < games; g++) {
    const lv = levels.map((_, i) => levels[(i + g) % levels.length]);
    let s: GameState = makeLive(createGame({ seed: seed0 + g, players: lv.map(l => ({ kind: 'ai' as const, aiLevel: l })) }), 0, 360);
    for (let t = 0; t < liveTicks && s.winner === null; t++) {
      const before = JSON.stringify({ ...s, live: undefined });
      const banks = s.live!.bank.slice();
      s = runTick(s, () => true);
      void before;
      const subs = s.log[s.log.length - 1].submissions;
      for (const p of s.players) {
        if (p.eliminated) continue;
        const n = subs[p.id]?.orders.filter(Boolean).length ?? 0;
        for (const o of subs[p.id]?.orders ?? []) if (o) bump(issued, p.aiLevel, o.type);
        if (!n && banks[p.id] >= 1) bump(failed, p.aiLevel, '(no order queued)');
      }
      for (const e of s.last!.events) if (e.k === 'fail' && e.owner >= 0) {
        const t2 = typeOf(e.text);
        bump(failed, s.players[e.owner].aiLevel, t2);
        const r = `${t2}: ${e.text.replace(/^.*failed: /, '').replace(/\d+/g, 'N')}`;
        reasons[r] = (reasons[r] ?? 0) + 1;
      }
    }
  }
}

console.log(`games ${games}${liveTicks ? ` LIVE ticks ${liveTicks}` : ''}${fogged ? ' (fogged view)' : ''} levels ${levels.join(',')}`);
for (const l of Object.keys(issued)) {
  const iss = Object.values(issued[l]).reduce((a, b) => a + b, 0);
  const fl = Object.values(failed[l] ?? {}).reduce((a, b) => a + b, 0);
  console.log(`${l.padEnd(8)} issued ${iss}  failed ${fl} (${(100 * fl / Math.max(1, iss)).toFixed(1)}%)  fails: ${Object.entries(failed[l] ?? {}).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}`);
}
console.log('top reasons:\n' + Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, n]) => `  ${n}  ${k}`).join('\n'));
console.log('planTurn mutated its input:', mutations, 'times');
