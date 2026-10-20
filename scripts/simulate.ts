// Headless balance harness: AI vs AI games, many seeds.
//   npm run sim -- --games 30 --levels expert,standard,novice --rules '{"orders":{"perTurn":4}}'
//   npm run sim -- --games 60 --suite      (runs the three standard skill matchups)
import { createGame, resolveTurn, planTurn, type GameState } from '../shared/index.ts';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const games = Number(arg('games', '20'));
const rules = JSON.parse(arg('rules', '{}'));
const verbose = args.includes('--verbose');
const seed0 = Number(arg('seed', '1000'));
const suite = args.includes('--suite')
  ? ['expert,standard,novice', 'expert,novice,novice', 'standard,novice,novice', 'expert,expert,standard']
  : [arg('levels', 'expert,standard,novice')];

/** Collapse a vpLog reason into a coarse source bucket. */
function vpBucket(why: string): string {
  if (why.startsWith('Holding') && why.includes('Crown')) return 'crowns';
  if (why.startsWith('Holding the Throne')) return 'throne';
  if (why.startsWith('Excavated')) return 'relics';
  if (why.startsWith('Edict')) return 'edicts';
  if (why.startsWith('Battle honors') || why.startsWith('Destroyed the Warden')) return 'battles';
  if (why.startsWith('Captured')) return 'capitals';
  if (why.startsWith('Bounty')) return 'bounty';
  if (why.startsWith('Broke')) return 'pacts';
  return why;
}

for (const lvStr of suite) {
  const levels = lvStr.split(',') as any[];
  const wins: Record<string, number> = {};
  const vpByLevel: Record<string, number[]> = {};
  const builds: Record<string, Record<string, number>> = {};
  const seatWins = [0, 0, 0];
  let turns = 0, battles = 0, captures = 0, shipsLost = 0, warden = 0, wardenKilled = 0, pacts = 0, betrayals = 0, influenceCaps = 0, earlyDecided = 0;
  const reasons: Record<string, number> = {};
  const vpSrc: Record<string, number> = {};
  let relics = 0;
  const vpSpread: number[] = [];
  const t0 = Date.now();
  for (let g = 0; g < games; g++) {
    // rotate seats so map position doesn't bias the level comparison
    const lv = levels.map((_, i) => levels[(i + g) % levels.length]);
    let s: GameState = createGame({ seed: seed0 + g, players: lv.map(l => ({ kind: 'ai' as const, aiLevel: l })), rules });
    let leaderT6: number | null = null;
    while (s.winner === null && s.turn < 200) {
      const subs: any = {};
      for (const p of s.players) subs[p.id] = planTurn(s, p.id);
      s = resolveTurn(s, subs);
      battles += s.last!.battles.length;
      for (const e of s.last!.events) {
        if (e.k === 'capture') { captures++; if (e.how === 'influence') influenceCaps++; }
        if (e.k === 'pact') pacts++;
        if (e.k === 'betrayal') betrayals++;
        if (e.k === 'build') { const l = s.players[e.owner].aiLevel; (builds[l] ??= {})[e.cls] = (builds[l][e.cls] ?? 0) + 1; }
      }
      for (const b of s.last!.battles) shipsLost += Object.values(b.losses).reduce((a, x) => a + x, 0);
      if (s.turn - 1 === 6) {
        const srt = s.players.slice().sort((a, b) => b.vp - a.vp);
        if (srt[0].vp - srt[1].vp >= 6) leaderT6 = srt[0].id;
      }
      if (verbose) {
        console.log(`T${s.turn - 1} ` + s.players.map(p => `${p.aiLevel[0]}:${p.vp}vp ${s.regions.filter(r => r.owner === p.id).length}r ${s.fleets.filter(f => f.owner === p.id).reduce((a, f) => a + f.ships.length, 0)}s c${s.regions.filter(r => r.kind === 'crown' && r.owner === p.id).length}${s.regions.some(r => r.kind === 'throne' && r.owner === p.id) ? 'T' : ''}`).join(' | ') + ` battles:${s.last!.battles.length}${s.wardenAwake && !s.wardenDefeated ? ' [warden]' : ''}`);
      }
    }
    if (s.wardenAwake) warden++;
    if (s.wardenDefeated) wardenKilled++;
    for (const p of s.players) {
      for (const v of p.vpLog) { const k = vpBucket(v.why); vpSrc[k] = (vpSrc[k] ?? 0) + v.amount; }
      (vpByLevel[p.aiLevel] ??= []).push(p.vp);
    }
    relics += s.loreFound;
    turns += s.turn - 1;
    const w = s.winner ?? 0;
    if (leaderT6 === w) earlyDecided++;
    wins[s.players[w].aiLevel] = (wins[s.players[w].aiLevel] ?? 0) + 1;
    seatWins[w]++;
    reasons[s.winReason.replace(/\d+/g, 'N')] = (reasons[s.winReason.replace(/\d+/g, 'N')] ?? 0) + 1;
    const vps = s.players.map(p => p.vp).sort((a, b) => b - a);
    vpSpread.push(vps[0] - vps[1]);
    if (verbose) console.log(`== game ${g}: winner ${s.players[w].name} (${s.players[w].aiLevel}) — ${s.winReason}\n`);
  }
  const avg = (xs: number[]) => (xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)).toFixed(1);
  console.log(`\n### ${lvStr}  games: ${games}  (${((Date.now() - t0) / games).toFixed(0)} ms/game)`);
  console.log('wins by level:', wins, ' avg VP:', Object.fromEntries(Object.entries(vpByLevel).map(([k, v]) => [k, +avg(v)])));
  console.log('wins by seat :', seatWins, ' reasons:', reasons);
  console.log(`avg turns ${(turns / games).toFixed(1)} | battles/turn ${(battles / turns).toFixed(2)} | ships lost/game ${(shipsLost / games).toFixed(1)} | captures/game ${(captures / games).toFixed(1)} (influence ${(influenceCaps / games).toFixed(1)})`);
  console.log('VP sources/game:', Object.fromEntries(Object.entries(vpSrc).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +(v / games).toFixed(1)])));
  console.log('builds/game  :', Object.fromEntries(Object.entries(builds).map(([l, b]) => [l, Object.fromEntries(Object.entries(b).map(([c, n]) => [c, +(n / games).toFixed(1)]))])));
  console.log(`relics/game ${(relics / games).toFixed(1)} | warden woke ${warden}/${games} (killed ${wardenKilled}) | pacts ${pacts} | betrayals ${betrayals} | margin ${avg(vpSpread)} VP | decided-by-T6 ${earlyDecided}/${games}`);
}
