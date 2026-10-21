// Does investing in research pay off? Three expert AIs; one seat (rotating) is barred
// from researching. If research matters, the barred seat should win well under 1/3.
//   npx tsx scripts/research-value.ts [games]
import { createGame, resolveTurn, planTurn } from '../shared/index.ts';
const games = Number(process.argv[2] ?? 30);
const wins = [0, 0, 0], vp = [0, 0, 0], techs = [0, 0, 0];
for (let g = 0; g < games; g++) {
  const bar = g % 3;
  (globalThis as any).__tcNoResearch = [bar];   // test hook read by shared/sim/ai-empire.ts
  let s = createGame({ seed: 900 + g, players: [0, 1, 2].map(() => ({ kind: 'ai' as const, aiLevel: 'expert' as const })) });
  while (s.winner === null && s.turn < 200) { const subs: any = {}; for (const p of s.players) subs[p.id] = planTurn(s, p.id); s = resolveTurn(s, subs); }
  [bar, (bar + 1) % 3, (bar + 2) % 3].forEach((p, i) => { vp[i] += s.players[p].vp; techs[i] += s.players[p].techs!.length; if (s.winner === p) wins[i]++; });
}
console.log(`barred seat wins ${wins[0]}/${games} (${Math.round(100 * wins[0] / games)}%), researching seats ${wins[1]} + ${wins[2]}`);
console.log('avg VP', vp.map(v => (v / games).toFixed(1)), 'techs', techs.map(v => (v / games).toFixed(1)));
