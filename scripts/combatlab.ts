// Combat lab: equal-budget fleets of each ship class vs each other and vs garrisons.
//   npx vite-node scripts/combatlab.ts [budget] ['{rules json}']
import { createGame } from '../shared/sim/setup.ts';
import { runBattle } from '../shared/sim/combat.ts';
import { newFleet, newShip } from '../shared/sim/setup.ts';
import { Rng } from '../shared/sim/rng.ts';
import type { GameState } from '../shared/sim/types.ts';

const budget = Number(process.argv[2] ?? 150);
const over = JSON.parse(process.argv[3] ?? '{}');
const base = createGame({ seed: 7, players: [{ kind: 'ai' }, { kind: 'ai' }, { kind: 'ai' }], rules: over });
const R = base.rules;
const classes = Object.keys(R.ships).filter(c => c !== 'scout');
const price = (c: string) => (R.ships[c].cost.industry ?? 0) + (R.ships[c].cost.credits ?? 0);
const count = (c: string) => Math.max(1, Math.min(R.maxShipsPerFleet, Math.round(budget / price(c))));

function setup(): GameState {
  const s = structuredClone(base);
  s.fleets = [];
  return s;
}
function fleetOf(s: GameState, rng: Rng, owner: number, region: number, cls: string, n: number) {
  const f = newFleet(s, rng, owner, region);
  f.doctrine = { stance: 'aggressive', retreatAt: 0, target: 'weakest', guard: false };
  for (let i = 0; i < n; i++) f.ships.push(newShip(s, rng, cls));
  return f;
}
const N = 300;
// a neutral colony as the battlefield
const field = base.regions.findIndex(r => r.kind === 'colony' && r.feature === 'none');
console.log(`budget ${budget}: counts`, Object.fromEntries(classes.map(c => [c, count(c)])));
console.log('row = attacker win% vs column (aggressive, no retreat), and avg value left');
for (const a of classes) {
  const row: string[] = [];
  for (const b of classes) {
    let w = 0;
    for (let t = 0; t < N; t++) {
      const s = setup(); s.regions[field].owner = null;
      const rng = new Rng(t * 31 + 1);
      const fa = fleetOf(s, rng, 0, field, a, count(a));
      const fb = fleetOf(s, rng, 1, field, b, count(b));
      const out = runBattle(s, rng, field, 1, [fa, fb], null, new Map());
      if (out.winner === 0) w++;
    }
    row.push(`${b}:${(100 * w / N).toFixed(0)}`);
  }
  console.log(a.padEnd(9), row.join('  '));
}
// sieges: rounds of attrition vs a garrison. Report garrison dmg per budget per siege.
console.log('\nsiege: avg garrison damage dealt in one seize battle + ships lost (budget fleets)');
const targets: [string, number, number][] = [['neutral colony 14', 14, 0], ['crown neutral 40', 40, 0], ['home f1 34', 34, 1], ['crown owned f2 ~46', 46, 2]];
for (const c of classes) {
  const row: string[] = [];
  for (const [name, g, fort] of targets) {
    let dmg = 0, lost = 0, took = 0;
    for (let t = 0; t < N; t++) {
      const s = setup();
      const r = s.regions[field];
      r.owner = fort > 0 ? 1 : null; r.garrison = g; r.buildings = { fortress: fort };
      const rng = new Rng(t * 17 + 3);
      const fa = fleetOf(s, rng, 0, field, c, count(c));
      const n0 = fa.ships.length;
      runBattle(s, rng, field, 1, [fa], fort > 0 ? 1 : -1, new Map());
      dmg += g - r.garrison; lost += n0 - fa.ships.length; if (r.garrison <= 0) took++;
    }
    row.push(`${name}: ${(dmg / N).toFixed(0)}dmg ${(lost / N).toFixed(1)}lost ${(100 * took / N).toFixed(0)}%`);
  }
  console.log(c.padEnd(9), row.join(' | '));
}
