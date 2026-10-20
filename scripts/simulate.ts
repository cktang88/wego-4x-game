// Headless balance harness: AI vs AI games, many seeds.
//   npm run sim -- --games 30 --levels expert,standard,novice --rules '{"orders":{"perTurn":4}}'
import { createGame, resolveTurn, planTurn, type GameState } from '../shared/index.ts';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const games = Number(arg('games', '20'));
const levels = arg('levels', 'expert,standard,novice').split(',') as any[];
const rules = JSON.parse(arg('rules', '{}'));
const verbose = args.includes('--verbose');
const seed0 = Number(arg('seed', '1000'));

const wins: Record<string, number> = {};
const seatWins = [0, 0, 0];
let turns = 0, battles = 0, captures = 0, shipsLost = 0, warden = 0, pacts = 0, betrayals = 0, influenceCaps = 0;
const reasons: Record<string, number> = {};
const vpSrc: Record<string, number> = {};
let relics = 0;
const vpSpread: number[] = [];
const t0 = Date.now();
for (let g = 0; g < games; g++) {
  // rotate seats so map position doesn't bias the level comparison
  const lv = levels.map((_, i) => levels[(i + g) % levels.length]);
  let s: GameState = createGame({ seed: seed0 + g, players: lv.map(l => ({ kind: 'ai' as const, aiLevel: l })), rules });
  while (s.winner === null && s.turn < 200) {
    const subs: any = {};
    for (const p of s.players) subs[p.id] = planTurn(s, p.id);
    s = resolveTurn(s, subs);
    battles += s.last!.battles.length;
    for (const e of s.last!.events) {
      if (e.k === 'capture') { captures++; if (e.how === 'influence') influenceCaps++; }
      if (e.k === 'pact') pacts++;
      if (e.k === 'betrayal') betrayals++;
    }
    for (const b of s.last!.battles) shipsLost += Object.values(b.losses).reduce((a, x) => a + x, 0);
    if (verbose) {
      console.log(`T${s.turn - 1} ` + s.players.map(p => `${p.aiLevel[0]}:${p.vp}vp ${s.regions.filter(r => r.owner === p.id).length}r ${s.fleets.filter(f => f.owner === p.id).reduce((a, f) => a + f.ships.length, 0)}s`).join(' | ') + ` battles:${s.last!.battles.length}`);
    }
  }
  if (s.wardenAwake) warden++;
  for (const p of s.players) for (const v of p.vpLog) { const k = v.why.replace(/\(.*\)|\d+|Crimson Dominion|Azure Compact|Gilded Throneholders|'s|:.*/g, '').trim(); vpSrc[k] = (vpSrc[k] ?? 0) + v.amount; }
  relics += s.loreFound;
  turns += s.turn - 1;
  const w = s.winner ?? 0;
  wins[s.players[w].aiLevel] = (wins[s.players[w].aiLevel] ?? 0) + 1;
  seatWins[w]++;
  reasons[s.winReason.replace(/\d+/g, 'N')] = (reasons[s.winReason.replace(/\d+/g, 'N')] ?? 0) + 1;
  const vps = s.players.map(p => p.vp).sort((a, b) => b - a);
  vpSpread.push(vps[0] - vps[1]);
  if (verbose) console.log(`== game ${g}: winner ${s.players[w].name} (${s.players[w].aiLevel}) — ${s.winReason}\n`);
}
console.log(`games: ${games}  (${((Date.now() - t0) / games).toFixed(0)} ms/game)`);
console.log('wins by level:', wins);
console.log('wins by seat :', seatWins);
console.log('win reasons  :', reasons);
console.log(`avg turns ${(turns / games).toFixed(1)} | battles/turn ${(battles / turns).toFixed(2)} | ships lost/game ${(shipsLost / games).toFixed(1)} | captures/game ${(captures / games).toFixed(1)} (influence ${(influenceCaps / games).toFixed(1)})`);
console.log('VP sources/game:', Object.fromEntries(Object.entries(vpSrc).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +(v / games).toFixed(1)])));
console.log(`relics/game ${(relics / games).toFixed(1)}`);
console.log(`warden woke in ${warden}/${games} | pacts ${pacts} | betrayals ${betrayals} | avg winning margin ${(vpSpread.reduce((a, b) => a + b, 0) / games).toFixed(1)} VP`);
