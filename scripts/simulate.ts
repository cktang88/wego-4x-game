// Headless balance harness: AI vs AI games, many seeds.
//   npm run sim -- --games 30 --levels expert,standard,novice --rules '{"orders":{"perTurn":4}}'
//   npm run sim -- --games 60 --suite      (runs the three standard skill matchups)
import { createGame, resolveTurn, planTurn, type GameState } from '../shared/index.ts';
import { styleOf } from '../shared/sim/ai-empire.ts';
import { systemStatus } from '../shared/sim/contest.ts';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const games = Number(arg('games', '20'));
const rules = JSON.parse(arg('rules', '{}'));
const verbose = args.includes('--verbose');
const seed0 = Number(arg('seed', '1000'));
// Soul layer: what AI fleets are founded with (style combos, random legal combos, or none) — for boon balance checks
const combos = arg('combos', 'style');
(globalThis as { __tcSoulCombos?: string }).__tcSoulCombos = combos;
(globalThis as { __tcNoCharge?: boolean }).__tcNoCharge = args.includes('--no-charge');   // balance probe: AI never charges
const suite = args.includes('--suite')
  ? ['expert,standard,novice', 'expert,novice,novice', 'standard,novice,novice', 'expert,expert,standard']
  : [arg('levels', 'expert,standard,novice')];

/** Collapse a vpLog reason into a coarse source bucket. */
function vpBucket(why: string): string {
  if (why.startsWith('Holding') && why.includes('Crown')) return 'crowns';
  if (why.startsWith('Holding the Throne')) return 'throne';
  if (why.startsWith('Excavated')) return 'relics';
  if (why.startsWith('Edict')) return 'edicts';
  if (why.startsWith('Battle honors')) return 'battles';
  if (why.startsWith('Destroyed the Warden')) return 'warden';
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
  const orderMix: Record<string, Record<string, number>> = {};
  const seatWins = [0, 0, 0];
  let turns = 0, battles = 0, captures = 0, shipsLost = 0, warden = 0, wardenKilled = 0, pacts = 0, betrayals = 0, influenceCaps = 0, earlyDecided = 0;
  const reasons: Record<string, number> = {};
  const vpSrc: Record<string, number> = {};
  const vpSrcLvl: Record<string, Record<string, number>> = {};
  let relics = 0;
  const styleWins: Record<string, number> = {}, styleSeats: Record<string, number> = {};
  const techTurn: Record<string, number[]> = {}, lawCount: Record<string, number> = {}, empireBuilds: Record<string, number> = {};
  const techLv: Record<string, number[]> = {};
  let techsOwned = 0, oosNotes = 0, stolen = 0;
  const vpSpread: number[] = [];
  // ---- Soul layer metrics
  const soulN: Record<string, number> = {};
  const bump = (k: string, n = 1) => { soulN[k] = (soulN[k] ?? 0) + n; };
  const traitDist: Record<string, Record<string, number>> = {};
  const boonSeats: Record<string, number> = {}, boonWins: Record<string, number> = {};
  // ---- signature metrics (postures, world postures, Fate) by AI level
  const postureN: Record<string, Record<string, number>> = {}, fleetTurns: Record<string, number> = {};
  const outcomeN: Record<string, Record<string, number>> = {}, fateN: Record<string, Record<string, number>> = {};
  const bumpL = (m: Record<string, Record<string, number>>, l: string, k: string, n = 1) => { (m[l] ??= {})[k] = (m[l][k] ?? 0) + n; };
  // ---- star systems step 3: contested / occupied / tribute
  const sysN: Record<string, number> = {};
  const bumpSys = (k: string, n = 1) => { sysN[k] = (sysN[k] ?? 0) + n; };
  const t0 = Date.now();
  for (let g = 0; g < games; g++) {
    // rotate seats so map position doesn't bias the level comparison
    const lv = levels.map((_, i) => levels[(i + g) % levels.length]);
    let s: GameState = createGame({ homeRotation: arg('rot', '') === '' ? undefined : Number(arg('rot', '0')), seed: seed0 + g, players: lv.map(l => ({ kind: 'ai' as const, aiLevel: l })), rules });
    let leaderT6: number | null = null;
    while (s.winner === null && s.turn < 200) {
      const subs: any = {};
      for (const p of s.players) {
        subs[p.id] = planTurn(s, p.id);
        if (!p.eliminated) fleetTurns[p.aiLevel] = (fleetTurns[p.aiLevel] ?? 0) + s.fleets.filter(f => f.owner === p.id && f.ships.some(sh => sh.cls !== 'scout')).length;
        for (const fa of subs[p.id].free) {
          if (fa.type === 'posture') bumpL(postureN, p.aiLevel, fa.posture);
          if (fa.type === 'wposture') bumpL(postureN, p.aiLevel, `w:${fa.posture}`);
          if (fa.type === 'tribute') bumpSys(fa.accept ? 'tribute accepts sent' : 'tribute offers');
        }
        for (const o of subs[p.id].orders) { const k = o ? o.type : 'none'; (orderMix[p.aiLevel] ??= {})[k] = (orderMix[p.aiLevel][k] ?? 0) + 1; }
      }
      const startBanner = new Map(s.fleets.map(f => [f.id, !!f.banner]));
      s = resolveTurn(s, subs);
      battles += s.last!.battles.length;
      for (const e of s.last!.events) {
        if (e.k === 'posture') { const l = s.players[e.owner].aiLevel; bumpL(outcomeN, l, `${e.posture}:${e.outcome}`); bumpL(outcomeN, l, `all:${e.outcome}`); }
        if (e.k === 'fate') bumpL(fateN, s.players[e.owner].aiLevel, e.use);
        if (e.k === 'rout') bump('routs');
        if (e.k === 'destroyed' && e.owner >= 0) bump(startBanner.get(e.fleet) || s.soul?.fallen.some(r => r.id === e.fleet) ? 'banners destroyed' : 'pickets/other destroyed');
        if (e.k === 'soul') bump(e.kind);
        if (e.k === 'build') {
          const r = s.regions[e.region];
          const sh = s.fleets.find(f => f.id === e.fleet)?.ships.find(x => x.name === e.name);
          const label = r.feature !== 'none' ? r.feature : r.trait ?? r.kind;
          for (const t of sh?.traits ?? []) { (traitDist[label] ??= {})[t] = (traitDist[label][t] ?? 0) + 1; }
        }
      }
      for (const e of s.last!.events) {
        if (e.k === 'capture') { captures++; if (e.how === 'influence') influenceCaps++; }
        if (e.k === 'pact') pacts++;
        if (e.k === 'betrayal') betrayals++;
        if (e.k === 'tech') { (techTurn[e.tech] ??= []).push(s.turn - 1); if (e.stolen) stolen++; }
        if (e.k === 'law') lawCount[e.law] = (lawCount[e.law] ?? 0) + 1;
        if (e.k === 'project' && e.done && ['academy', 'extractor', 'battery', 'pshield', 'depot', 'gate', 'station', 'shipyard', 'mine', 'tradehub', 'develop', 'fortress'].includes(e.key)) empireBuilds[e.key] = (empireBuilds[e.key] ?? 0) + 1;
        if (e.k === 'note' && e.text.includes('out of supply')) oosNotes++;
        if (e.k === 'note' && e.text.includes(' grows: citizens')) empireBuilds.growth = (empireBuilds.growth ?? 0) + 1;   // star systems: Core growth
        if (e.k === 'build') { const l = s.players[e.owner].aiLevel; (builds[l] ??= {})[e.cls] = (builds[l][e.cls] ?? 0) + 1; }
      }
      for (const b of s.last!.battles) shipsLost += Object.values(b.losses).reduce((a, x) => a + x, 0);
      for (const e of s.last!.events) {
        if (e.k === 'note' && e.text.startsWith('Refugees')) bumpSys('refugees');
        if ((e.k === 'soul' || e.k === 'note') && e.owner === null && e.text.includes('paid tribute to')) bumpSys('tributes accepted');
        if (e.k === 'soul' && e.kind === 'oath' && e.text.includes('tribute')) bumpSys('tributes broken');
      }
      for (const r of s.regions) {
        if (r.owner === null || !r.bodies) continue;
        const st = systemStatus(s, r);
        if (st.contested) bumpSys('contested system-turns');
        if (st.blockaded) bumpSys('blockaded system-turns');
        if (st.plunderers.length) bumpSys('plundered system-turns');
        if (st.occupiedLeft > 0) bumpSys('occupied system-turns');
        if (st.tribute) bumpSys('tribute system-turns');
      }
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
      for (const v of p.vpLog) {
        const k = vpBucket(v.why); vpSrc[k] = (vpSrc[k] ?? 0) + v.amount;
        const L = (vpSrcLvl[p.aiLevel] ??= {}); L[k] = (L[k] ?? 0) + v.amount;
      }
      (vpByLevel[p.aiLevel] ??= []).push(p.vp);
    }
    relics += s.loreFound;
    bump('caught', (s.soul?.fallen ?? []).filter(r => r.fate === 'caught').length);
    bump('fallen: broken', (s.soul?.fallen ?? []).filter(r => r.fate === 'broken').length);
    bump('fallen: retired', (s.soul?.fallen ?? []).filter(r => r.fate === 'retired').length);
    bump('honours', s.fleets.concat().reduce((a, f) => a + (f.honours?.length ?? 0), 0) + (s.soul?.fallen ?? []).reduce((a, r) => a + r.honours.length, 0));
    bump('debts', s.soul?.debts.length ?? 0);
    bump('oathbreaker houses', s.players.filter(p => p.oathbreaker?.length).length);
    // boon pick/win: which boons each seat flew (founded or honoured), against who won
    for (const p of s.players) {
      const used = new Set<string>();
      for (const f of s.fleets) if (f.owner === p.id && f.banner) { for (const b of f.banner.boons) used.add(b); for (const h of f.honours ?? []) used.add(h.id); }
      for (const r of s.soul?.fallen ?? []) if (r.owner === p.id) { for (const b of r.boons) used.add(b); for (const h of r.honours) used.add(h); }
      for (const b of used) { boonSeats[b] = (boonSeats[b] ?? 0) + 1; if (s.winner === p.id) boonWins[b] = (boonWins[b] ?? 0) + 1; }
    }
    turns += s.turn - 1;
    const w = s.winner ?? 0;
    if (leaderT6 === w) earlyDecided++;
    wins[s.players[w].aiLevel] = (wins[s.players[w].aiLevel] ?? 0) + 1;
    for (const p of s.players) { const st = styleOf(s, p.id); styleSeats[st] = (styleSeats[st] ?? 0) + 1; techsOwned += p.techs?.length ?? 0; (techLv[p.aiLevel] ??= []).push(p.techs?.length ?? 0); }
    styleWins[styleOf(s, w)] = (styleWins[styleOf(s, w)] ?? 0) + 1;
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
  const seats = (l: string) => levels.filter(x => x === l).length * games;
  console.log('VP src/player:', Object.fromEntries(Object.entries(vpSrcLvl).map(([l, m]) => [l, Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${(n / seats(l)).toFixed(1)}`).join(' ')])));
  console.log('builds/game  :', Object.fromEntries(Object.entries(builds).map(([l, b]) => [l, Object.fromEntries(Object.entries(b).map(([c, n]) => [c, +(n / games).toFixed(1)]))])));
  console.log('orders (% by level):', Object.fromEntries(Object.entries(orderMix).map(([l, m]) => { const t = Object.values(m).reduce((a, b) => a + b, 0); return [l, Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${Math.round(100 * n / t)}`).join(' ')]; })));
  console.log('style win%   :', Object.fromEntries(Object.keys(styleSeats).map(k => [k, `${Math.round(100 * (styleWins[k] ?? 0) / styleSeats[k])}% of ${styleSeats[k]} seats`])));
  console.log(`techs/player ${(techsOwned / games / 3).toFixed(1)} ${JSON.stringify(Object.fromEntries(Object.entries(techLv).map(([k, v]) => [k, avg(v)])))} | stolen ${stolen} | out-of-supply events/game ${(oosNotes / games).toFixed(1)} | empire projects/game`, Object.fromEntries(Object.entries(empireBuilds).map(([k, v]) => [k, +(v / games).toFixed(1)])));
  console.log('tech: times bought (avg turn):', Object.entries(techTurn).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => `${k}:${v.length}(${avg(v)})`).join(' '));
  console.log('laws enacted :', lawCount);
  {
    const lv = [...new Set(levels)] as string[];
    for (const l of lv) {
      const pn = postureN[l] ?? {};
      const ft = fleetTurns[l] ?? 1;
      const fleetP = ['guarded', 'running', 'charge', 'ambush'];
      const used = fleetP.reduce((a, k) => a + (pn[k] ?? 0), 0);
      const oc = outcomeN[l] ?? {};
      const rate = (k: string) => { const c = oc[`${k}:called`] ?? 0, x = oc[`${k}:caught`] ?? 0; return c + x ? `${c}/${c + x}=${Math.round(100 * c / (c + x))}%` : '-'; };
      console.log(`postures ${l.padEnd(8)}: fleet-turns ${ft}, steady ${(100 * (1 - used / ft)).toFixed(1)}% | ` + fleetP.map(k => `${k} ${(100 * (pn[k] ?? 0) / ft).toFixed(1)}%`).join(' ') +
        ` | world ${['levies', 'scorch', 'gates'].map(k => `${k}:${pn[`w:${k}`] ?? 0}`).join(' ')}`);
      console.log(`  called/(called+caught) ${l.padEnd(8)}: all ${rate('all')} | ` + [...fleetP, 'levies', 'scorch', 'gates'].map(k => `${k} ${rate(k)}`).join(' | '));
      console.log(`  fate ${l.padEnd(8)} per seat-game: ${(Object.values(fateN[l] ?? {}).filter((_, i) => Object.keys(fateN[l] ?? {})[i] !== 'bonus').reduce((a, b) => a + b, 0) / seats(l)).toFixed(2)}`, fateN[l] ?? {});
    }
  }
  console.log(`soul (combos=${combos}) per game:`, Object.fromEntries(Object.entries(soulN).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +(v / games).toFixed(2)])));
  console.log('boon seats & win% (fair share 33%):', Object.entries(boonSeats).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}:${Math.round(100 * (boonWins[k] ?? 0) / n)}%`).join(' | '));
  if (verbose || args.includes('--traits')) console.log('ship traits by yard world:', JSON.stringify(Object.fromEntries(Object.entries(traitDist).map(([k, m]) => [k, Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t, n]) => `${t}:${n}`).join(' ')]))));
  console.log('systems (step 3) per game:', Object.fromEntries(Object.entries(sysN).map(([k, v]) => [k, +(v / games).toFixed(2)])));
  console.log(`relics/game ${(relics / games).toFixed(1)} | warden woke ${warden}/${games} (killed ${wardenKilled}) | pacts ${pacts} | betrayals ${betrayals} | margin ${avg(vpSpread)} VP | decided-by-T6 ${earlyDecided}/${games}`);
}
