// Smoke test for the League over real HTTP: two games in one League (a new table, then "Again, at the same table?"),
// each played to the end with AI seats under fast rules, then the League record is checked.
//   npx tsx server/smoke-league.ts [--port 8811] [--keep] [--dist <dir>]
// Runs its own server on its own port with a temporary data directory (never the dev server's data/ or :8787).
// --keep leaves the server running afterwards (for screenshots of the League UI); --dist serves that directory.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planTurn, type PlayerView, type Submission } from '../shared/index.ts';
import { startServer } from './index.ts';

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const PORT = Number(arg('--port') ?? 8811);
const KEEP = process.argv.includes('--keep');
const dataDir = mkdtempSync(join(tmpdir(), 'tc-smoke-league-'));
const srv = await startServer({ port: PORT, host: '127.0.0.1', dataDir, distDir: arg('--dist') ?? join(dataDir, 'nodist'), tickMs: 500, createPerWindow: 100 });
const base = `http://127.0.0.1:${srv.port}`;
let failures = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };

async function call(method: string, path: string, body?: unknown, token?: string): Promise<any> {
  const r = await fetch(`${base}${path}`, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${j.error ?? ''}`);
  return j;
}

/** Seat 0 is a human seat played by the AI from its own (fogged) view; seats 1 and 2 are AI seats. */
async function playToEnd(id: string, token: string): Promise<any> {
  for (let n = 0; n < 60; n++) {
    const { meta, view } = await call('GET', `/api/games/${id}/view`, undefined, token) as { meta: any; view: PlayerView };
    if (meta.winner !== null) return meta;
    let sub: Submission;
    try { sub = planTurn(view.state, 0); } catch { sub = { orders: [], free: [] } as unknown as Submission; }
    await call('POST', `/api/games/${id}/orders`, { token, submission: sub, turn: meta.turn });
  }
  throw new Error(`game ${id} did not end`);
}

const t0 = Date.now();
try {
  const RULES = { victory: { turnLimit: 8 } };
  // game 1: a new table starts a League
  const g1 = await call('POST', '/api/games', { name: 'Smoke Friday', rules: RULES, seats: [{ kind: 'human' }, { kind: 'ai', aiLevel: 'expert', name: 'Kith' }, { kind: 'ai', aiLevel: 'standard', name: 'Wren' }] });
  const league = g1.meta.league as string;
  check(/^[0-9a-f]{10}$/.test(league ?? ''), `game 1 (${g1.id}) started League ${league}`);
  const tok1 = (await call('POST', `/api/games/${g1.id}/join`, { seat: 0, name: 'Sam' })).token as string;
  const end1 = await playToEnd(g1.id, tok1);
  check(end1.winner !== null, `game 1 ended on turn ${end1.turn}: ${end1.seats[end1.winner].name} wins (${end1.winReason})`);
  let lv = await call('GET', `/api/league/${league}`);
  check(lv.played === 1 && lv.hall.length === 1, `League records game 1 (played ${lv.played}, hall ${lv.hall.length})`);

  // game 2: "Again, at the same table?"
  const g2 = await call('POST', '/api/games', { league: { rematchOf: g1.id, token: tok1 } });
  check(g2.meta.league === league, `game 2 (${g2.id}) is a rematch in the same League`);
  check(g2.meta.seats.map((s: any) => `${s.kind}:${s.name}`).join() === end1.seats.map((s: any) => `${s.kind}:${s.name}`).join(), 'game 2 keeps the seats');
  const tok2 = (await call('POST', `/api/games/${g2.id}/join`, { seat: 0, name: 'Sam' })).token as string;
  const end2 = await playToEnd(g2.id, tok2);
  check(end2.winner !== null, `game 2 ended on turn ${end2.turn}: ${end2.seats[end2.winner].name} wins (${end2.winReason})`);
  const v2 = (await call('GET', `/api/games/${g2.id}/view`, undefined, tok2)).view as PlayerView;
  const first = v2.state.soul?.herald.find(e => e.turn === 1);
  check(!!first?.feud && first.headlines[0].kind === 'feud', `game 2's first Herald opens with the feud: "${first?.headlines[0].text}"`);
  if (first?.headlines[0].body) console.log(`     ${first.headlines[0].byline}\n     ${first.headlines[0].body.replace(/\n\n/g, '\n     ')}`);
  const specials = v2.state.soul?.herald.filter(e => e.special).map(e => `T${e.turn} ${e.special!.title}`) ?? [];
  console.log(`     special editions kept in game 2: ${specials.join(', ') || 'none'}`);

  // the League record
  lv = await call('GET', `/api/league/${league}`);
  check(lv.played === 2, `League has 2 games (${lv.games.map((g: any) => `${g.name}: ${g.winner}`).join('; ')})`);
  check(lv.hall.length === 2, `Hall of Crowns: ${lv.hall.map((h: any) => `game ${h.index} ${h.house}${h.banners.length ? ` (${h.banners.join(', ')})` : ''}`).join('; ')}`);
  check(lv.members.length === 3 && lv.members.every((m: any) => m.games === 2), `table: ${lv.members.map((m: any) => `${m.name} ${m.wins}W/${m.games}G${m.title ? ` ${m.title}` : ''}${m.ugly ? ' [Ugly Trophy]' : ''}`).join('; ')}`);
  check(lv.headToHead.length === 3 && lv.headToHead.every((h: any) => h.games === 2), `head-to-head: ${lv.headToHead.map((h: any) => `${h.a} ${h.ahead[0]}-${h.ahead[1]} ${h.b} (kills ${h.kills.join('-')}, worlds ${h.captures.join('-')})`).join('; ')}`);
  check(!!lv.ugly, `Ugly Trophy: ${lv.ugly?.name} (game ${lv.ugly?.index})`);
  console.log(`     nemesis: ${lv.nemesis.map((n: any) => `${n.nemesis} → ${n.member} (${n.harm})`).join('; ') || 'none'}`);
  console.log(`     feuds: ${lv.feuds.map((f: any) => `${f.a} / ${f.b}: ${f.level} (${f.heat})`).join('; ') || 'none'}`);
  console.log(`     oaths broken: ${lv.oaths.length}; famous banners: ${lv.famous.map((f: any) => f.name).join(', ') || 'none'}`);
  console.log(`     records: ${JSON.stringify(lv.records)}`);
  const text = JSON.stringify(lv);
  const hashes = [...srv.store.games.values()].flatMap(g => g.seats.map(s => s.token)).filter((x): x is string => !!x);
  check(!text.includes(tok1) && !text.includes(tok2) && hashes.every(h => !text.includes(h.slice(2))), 'no seat token or token hash in the League API');
  const mine = await call('POST', '/api/leagues/mine', { tokens: [{ game: g1.id, token: tok1 }, { game: g2.id, token: tok2 }] });
  check(mine.leagues.length === 1 && mine.leagues[0].id === league, `"my leagues" from stored tokens: ${mine.leagues.map((l: any) => l.name).join(', ')}`);
  // idempotency: recording again changes nothing
  const before = JSON.stringify(srv.leagues.get(league));
  for (const g of srv.store.games.values()) srv.store.recordLeague(g);
  check(JSON.stringify(srv.leagues.get(league)) === before, 'recording the ended games again changes nothing');
  console.log(`\n${failures ? `${failures} FAILED` : 'all checks passed'} in ${((Date.now() - t0) / 1000).toFixed(1)} s · server ${base} · data ${dataDir}`);
  if (KEEP) console.log(`KEEP: League ${league}; tokens ${JSON.stringify({ [g1.id]: { token: tok1, seat: 0 }, [g2.id]: { token: tok2, seat: 0 } })}`);
} catch (e) {
  failures++;
  console.error('FAIL', e);
}
if (!KEEP) {
  await srv.close();
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(failures ? 1 : 0);
}
