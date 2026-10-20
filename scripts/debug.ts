// Print orders / events / battles turn by turn for one AI game.
//   npx vite-node scripts/debug.ts <turns> [seed] [levels] ['{rules json}']
//   npx vite-node scripts/debug.ts 12 1003 expert,standard,novice
import { createGame, resolveTurn, planTurn, describeOrder, type GameState } from '../shared/index.ts';
const turns = Number(process.argv[2] ?? 2);
const seed = Number(process.argv[3] ?? 1000);
const levels = (process.argv[4] ?? 'expert,expert,expert').split(',') as any[];
const rules = JSON.parse(process.argv[5] ?? '{}');
let s: GameState = createGame({ seed, players: levels.map(l => ({ kind: 'ai' as const, aiLevel: l })), rules });
const rn = (id: number) => `${s.regions[id].name}#${id}`;
console.log('regions', s.regions.map(r => `${r.id}:${r.kind}:${r.neighbors.join('/')}:g${r.garrison}`).join(' '));
console.log('homes', s.players.map(p => p.capital), 'levels', levels.join(','));
for (let t = 0; t < turns && s.winner === null; t++) {
  const subs: any = {};
  console.log(`\n===== TURN ${s.turn}`);
  for (const p of s.players) {
    subs[p.id] = planTurn(s, p.id);
    const fl = s.fleets.filter(f => f.owner === p.id).map(f => `${f.id}@${f.region}[${f.ships.map(x => x.cls[0] + x.cls[1]).join('')}]`).join(' ');
    console.log(`P${p.id}(${p.aiLevel}) ${p.vp}vp res ${JSON.stringify(p.res)} fleets ${fl}`);
    console.log('   orders:', subs[p.id].orders.map((o: any) => o ? describeOrder(s, o) : '-').join(' | '));
  }
  const prev = s;
  s = resolveTurn(s, subs);
  for (const e of s.last!.events) {
    if (e.k === 'capture') console.log(`   capture ${rn(e.region)} by P${e.by} from ${e.from} (${e.how}) p${e.pulse}`);
    else if (e.k === 'fail') console.log(`   FAIL P${e.owner} p${e.pulse}: ${e.text}`);
    else if (e.k === 'excavate') console.log(`   excavate P${e.owner} ${rn(e.region)}`);
    else if (e.k === 'note' && e.owner === null) console.log(`   NOTE ${e.text}`);
  }
  for (const b of s.last!.battles) console.log('   BATTLE', b.name, `#${b.region}`, 'sides', b.sides.map(x => `${x.owner}:${x.ships.map(y => y.cls[0] + y.cls[1]).join('')}${x.garrison ? 'g' + x.garrison.hp : ''}`).join(' v '), 'winner', b.winner, 'losses', JSON.stringify(b.losses));
  for (const p of s.players) { const gain = p.vpLog.filter(v => v.turn === prev.turn); if (gain.length) console.log(`   P${p.id} +vp`, gain.map(v => `${v.amount}:${v.why}`).join('; ')); }
}
console.log('\nwinner', s.winner, s.winReason, s.players.map(p => p.vp));
