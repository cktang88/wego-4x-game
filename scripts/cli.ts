// Text-mode client for playtesting (used by humans in a terminal and by LLM playtest agents).
//
//   npm run play -- new  --save g.json [--seed 5] [--ai expert,standard] [--rules '{json}']
//   npm run play -- show --save g.json            # your fogged view, as text
//   npm run play -- orders --save g.json '<json>' # submit & resolve one turn
//        json: {"orders":[order|null x5], "free":[...]}  (see shared/sim/types.ts)
//   npm run play -- help
//
// The human is always seat 0. AI seats plan with the in-game AI.
import { readFileSync, writeFileSync } from 'node:fs';
import { createGame, resolveTurn, planTurn, viewFor, describeOrder, validateOrder, orderCost, costText, income, findPath, fleetSpeed, fleetPower, ORDER_INFO, TRAITS, RELICS } from '../shared/index.ts';
import type { GameState, Submission } from '../shared/index.ts';

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const savePath = opt('save') ?? 'cli-game.json';
const load = (): GameState => JSON.parse(readFileSync(savePath, 'utf8'));
const save = (s: GameState) => writeFileSync(savePath, JSON.stringify(s));
const ME = 0;

if (cmd === 'new') {
  const ai = (opt('ai') ?? 'expert,standard').split(',');
  const s = createGame({ seed: opt('seed') ? Number(opt('seed')) : undefined, rules: opt('rules') ? JSON.parse(opt('rules')!) : undefined,
    players: [{ kind: 'human', name: 'You' }, { kind: 'ai', aiLevel: ai[0] as any }, { kind: 'ai', aiLevel: (ai[1] ?? ai[0]) as any }] });
  save(s);
  console.log(show(s));
} else if (cmd === 'show') {
  console.log(show(load()));
} else if (cmd === 'orders') {
  const s = load();
  if (s.winner !== null) { console.log('Game over.'); process.exit(0); }
  const raw = args.slice(1).filter((a, i) => !(a.startsWith('--') || args.slice(1)[i - 1]?.startsWith('--'))).join(' ').trim();
  let sub: Submission;
  try { sub = raw ? JSON.parse(raw) : { orders: [], free: [] }; } catch (e) { console.error(`Orders are not valid JSON: ${e}\nNothing was submitted.`); process.exit(1); }
  sub.orders ??= [];
  while (sub.orders.length < s.rules.orders.perTurn) sub.orders.push(null);
  sub.free ??= [];
  // pre-validate against a projection of your own earlier orders (like the browser UI does)
  const proj: GameState = structuredClone(s);
  const problems: string[] = [];
  sub.orders.forEach((o, i) => {
    if (!o) return;
    if ('fleet' in o && o.type !== 'build') { const f = proj.fleets.find(x => x.id === o.fleet); if (f) f.ordersThisTurn++; }
    const err = validateOrder(proj, ME, o);
    if (err) problems.push(`slot ${i + 1} (${o.type}): ${err}`);
    if (o.type === 'move') { const f = proj.fleets.find(x => x.id === o.fleet); if (f) f.region = o.path[o.path.length - 1]; }
    if (o.type === 'seize') { const f = proj.fleets.find(x => x.id === o.fleet); if (f) f.region = o.target; }
  });
  if (problems.length && !args.includes('--force')) { console.error('Orders rejected (add --force to submit anyway):\n  ' + problems.join('\n  ')); process.exit(1); }
  const subs: Record<number, Submission> = { 0: sub, 1: planTurn(s, 1), 2: planTurn(s, 2) };
  const n = resolveTurn(s, subs);
  save(n);
  console.log(report(n));
  console.log('\n' + show(n));
} else {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(0, 12).join('\n'));
  console.log('\nOrder types:\n' + Object.entries(ORDER_INFO).map(([k, v]) => `  ${k}: ${v.help}`).join('\n'));
  console.log(`\nOrder JSON shapes:
  {"type":"move","fleet":ID,"path":[regionIds...],"overdrive":false}
  {"type":"seize","fleet":ID,"target":REGION}
  {"type":"build","region":REGION,"cls":"frigate","fleet":null|FLEETID}
  {"type":"develop","region":REGION,"project":"develop|shipyard|fortress|mine|tradehub|sensor"}
  {"type":"fortify","fleet":ID}  {"type":"excavate","fleet":ID}
  {"type":"influence","target":REGION} {"type":"scan","target":REGION} {"type":"feint","target":REGION}
  {"type":"conceal"} {"type":"pact","with":PLAYER}
Free actions: {"type":"doctrine","fleet":ID,"doctrine":{"stance":"aggressive|defensive|evasive","retreatAt":0.35,"target":"weakest|strongest|cheapest|garrison","guard":true}}
  {"type":"merge","fleet":ID,"into":ID} {"type":"split","fleet":ID,"ships":[shipIds]}`);
}

function show(full: GameState): string {
  const v = viewFor(full, full.winner !== null ? null : ME);
  const s = v.state;
  const vis = new Set(v.visible);
  const me = s.players[ME];
  const inc = income(s, ME);
  const L: string[] = [];
  L.push(`=== THREE CROWNS · turn ${s.turn}/${s.rules.victory.turnLimit} · VP target ${s.rules.victory.vpTarget} ===`);
  if (s.winner !== null) L.push(`GAME OVER: ${s.players[s.winner].name} wins. ${s.winReason}`);
  L.push(`You: ${me.name}  res ⚙${me.res.industry} ¢${me.res.credits} ✦${me.res.influence}  income +${inc.industry}⚙ +${inc.credits}¢ +${inc.influence}✦  relics: ${me.relics.join(',') || '-'}`);
  L.push(`VP: ${s.players.map(p => `${p.name}${p.id === ME ? '(you)' : ''} ${p.vp}`).join(' | ')}   Throne: ${s.throne.owner === null ? 'unheld' : s.players[s.throne.owner].name + ' streak ' + s.throne.streak}${s.wardenAwake && !s.wardenDefeated ? ' · WARDEN AWAKE' : ''}`);
  for (const e of s.edicts) L.push(`EDICT: ${e.name} (${e.vp} VP, judged end of turn ${e.scoresTurn}): ${e.desc}`);
  if (s.pacts.length) L.push(`Pacts: ${s.pacts.map(p => `${p.a}-${p.b} until ${p.until}`).join(', ')}`);
  L.push('\nREGIONS (id name kind owner garrison dev buildings | neighbors) [* = in your sensor range]');
  for (const r of s.regions) {
    const own = r.owner === null ? 'neutral' : r.owner === ME ? 'YOU' : `P${r.owner}`;
    const b = Object.entries(r.buildings).filter(([, x]) => x).map(([k, x]) => `${k}${x}`).join(',');
    L.push(`${vis.has(r.id) ? '*' : ' '}${String(r.id).padStart(2)} ${r.name.padEnd(18)} ${r.kind.padEnd(6)} ${own.padEnd(7)} g${r.garrison < 0 ? '?' : r.garrison} dev${r.dev}${b ? ' ' + b : ''}${r.feature !== 'none' ? ' ' + r.feature : ''}${r.relic === 'unclaimed' ? ' RELIC' : ''}${r.project ? ` [building ${r.project.key} ${r.project.progress}]` : ''}${r.loyalty[ME] ? ` loyalty${r.loyalty[ME]}` : ''} | ${r.neighbors.join(',')}`);
  }
  L.push('\nFLEETS (visible)');
  for (const f of s.fleets) {
    const ships = f.ships.map(x => `${x.cls}#${x.id}(${x.hp}/${x.maxHp}${x.sys.engines ? '' : ' noEng'}${x.sys.weapons ? '' : ' noWpn'}${x.sys.shields ? '' : ' noShd'}${x.title ? ' ' + x.title : ''})`).join(' ');
    const who = f.owner === ME ? 'YOU' : f.owner === -1 ? 'WARDEN' : `P${f.owner}`;
    L.push(`  fleet ${f.id} [${who}] "${f.name}" at ${f.region} ${s.regions[f.region].name} · speed ${fleetSpeed(s, f)} power ${fleetPower(s, f)}${f.fortified ? ' fortified' : ''}${f.fatigued ? ' FATIGUED' : ''}`);
    L.push(`     cmdr ${f.commander.name} r${f.commander.rank} traits[${f.commander.traits.map(t => TRAITS[t]?.name ?? t).join(', ')}]${f.owner === ME ? ` doctrine ${JSON.stringify(f.doctrine)}` : ''}`);
    L.push(`     ${ships}`);
  }
  L.push('\nSHIP CLASSES: ' + Object.entries(s.rules.ships).map(([k, d]) => `${k}(${costText(d.cost)} hp${d.hp} atk${d.attack}x${d.shots} sh${d.shields} spd${d.speed} siege${d.siege} yard${d.needsShipyard})`).join(' '));
  L.push('PROJECTS: ' + Object.entries(s.rules.projects).map(([k, p]) => `${k}(${costText(p.cost)}, ${p.turns}t)`).join(' '));
  const last = s.last;
  if (last?.signals.length) { L.push('\nINTEL last turn:'); for (const g of last.signals) L.push(`  p${g.pulse} [${g.confidence}] ${g.text}`); }
  L.push('\nRECENT CHRONICLE:');
  for (const c of s.chronicle.slice(-6)) L.push(`  T${c.turn}: ${c.text}`);
  return L.join('\n');
}

function report(s: GameState): string {
  const last = s.last!;
  const v = viewFor(s, s.winner !== null ? null : ME).state.last ?? last;
  const L: string[] = [`--- RESOLUTION of turn ${last.turn} (what you saw) ---`];
  for (const e of v.events) {
    if (e.k === 'pulse') { L.push(`[pulse ${e.pulse}]`); continue; }
    L.push('  ' + JSON.stringify(e));
  }
  for (const b of v.battles) L.push(`  BATTLE ${b.name}: winner ${b.winner} losses ${JSON.stringify(b.losses)} rounds ${b.rounds.length}. ${b.highlights.slice(0, 4).join(' / ')}`);
  const mine = s.players[ME].vpLog.filter(x => x.turn === last.turn);
  if (mine.length) L.push(`  Your VP this turn: ${mine.map(x => `${x.amount} ${x.why}`).join('; ')}`);
  return L.join('\n');
}

void validateOrder; void describeOrder; void orderCost; void findPath; void RELICS;
