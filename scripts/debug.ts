import { createGame, resolveTurn, planTurn, describeOrder, type GameState } from '../shared/index.ts';
let s: GameState = createGame({ seed: 1000, players: [0,1,2].map(() => ({ kind: 'ai' as const, aiLevel: 'expert' as const })) });
console.log('regions', s.regions.length, s.regions.map(r => `${r.id}:${r.kind}:${r.neighbors.length}:g${r.garrison}`).join(' '));
console.log('homes', s.players.map(p => p.capital), 'home neighbors', s.players.map(p => s.regions[p.capital].neighbors));
for (let t = 0; t < Number(process.argv[2] ?? 2); t++) {
  const subs: any = {};
  for (const p of s.players) { subs[p.id] = planTurn(s, p.id); console.log(`P${p.id} orders:`, subs[p.id].orders.map((o: any) => o ? describeOrder(s, o) : '-').join(' | ')); }
  s = resolveTurn(s, subs);
  for (const e of s.last!.events) if (e.k !== 'pulse' && e.k !== 'move') console.log('  ', JSON.stringify(e));
  for (const b of s.last!.battles) console.log('  BATTLE', b.name, 'winner', b.winner, 'losses', JSON.stringify(b.losses), 'rounds', b.rounds.length, b.highlights.join(' / '));
  for (const p of s.players) console.log(`  P${p.id} vp ${p.vp}`, p.vpLog.filter(v => v.turn === s.turn - 1).map(v => `${v.amount}:${v.why}`).join('; '), JSON.stringify(p.res));
}
