// The League ledger (docs/LOOPS.md §3.1): the same friends, many games. Pure and deterministic: a finished game
// is boiled down to a LeagueGameSummary (from its final state, plus the turn results the server kept), a League
// stores only those summaries, and every table (head-to-head, nemesis marks, feuds, the Hall of Crowns, the Ugly
// Trophy, oaths, famous fleets, records) is derived from them by leagueTable(). Recording the same game twice
// replaces its summary with an identical one, so updates are idempotent.
//
// Privacy: a League holds display names (house names the players typed), colours and game facts. It never holds
// seat tokens, token hashes, emails or IP addresses; identity across games is a member key derived from the seat
// kind and name (or carried over from the seat a rematch was made from).
import { sagaOf } from './sim/herald.ts';
import type { GameState, PlayerId, TurnResult } from './sim/types.ts';

export const LEAGUE_VERSION = 1;
/** Summaries kept per League (oldest dropped first). */
export const LEAGUE_MAX_GAMES = 200;

export interface LeagueSeatSummary {
  /** Member key (memberKey()): who this seat was across games. */
  member: string;
  /** The house name in that game. */
  name: string;
  kind: 'human' | 'ai';
  color: string;
  vp: number;
  /** 1 = the winner; ties broken as the game ranked them. */
  place: number;
  eliminated: boolean;
  /** Crown worlds held at the end of the game. */
  crowns: number;
  /** Turns (cycles) spent on the Hollow Throne. */
  throneTurns: number;
  /** Vows its banners fulfilled, and sworn pacts still standing at the end. */
  vowsKept: number;
  pactsKept: number;
  /** Vows its banners broke (Oathbreaker banners), and sworn pacts it broke. */
  vowsBroken: number;
  oathsBroken: number;
  shipsLost: number;
  shipsKilled: number;
  /** The house's banners as the Saga lists them (most storied first), at most three. */
  banners: string[];
  /** The Court: Exile points (what this house, in exile, cost the winner). Absent in older summaries and for houses never exiled. */
  exilePoints?: number;
}

export interface LeagueGameSummary {
  game: string;
  name: string;
  /** When the game was created (server clock, stored with the game: the summary of a game never changes). */
  createdAt: number;
  mode: 'wego' | 'live';
  /** Turns (cycles) played. */
  turns: number;
  winner: number | null;
  winReason: string;
  seats: LeagueSeatSummary[];
  /** [i][j]: ships of seat j destroyed by seat i. */
  kills: number[][];
  /** [i][j]: worlds seat i took from seat j. */
  captures: number[][];
  /** [i][j]: battles seat i won against seat j. */
  battles: number[][];
  /** [i][j]: sworn pacts seat i broke against seat j. */
  betrayals: number[][];
  /** [i][j]: blood-debts seat i incurred to seat j (banners and commanders killed). */
  debts: number[][];
  oaths: { by: number; victim: number; words: string; turn: number }[];
  famous: { seat: number; name: string; commander: string; epithets: string[]; rank: number; fate: string }[];
  biggestBattle: { name: string; turn: number; ships: number } | null;
}

export interface League {
  v: number;
  id: string;
  name: string;
  createdAt: number;
  /** Finished games, oldest first. */
  games: LeagueGameSummary[];
  /** Games of this League still being played. */
  pending: string[];
  /** The name was made up from the houses (not chosen): it follows their names until the first game is recorded. */
  auto?: boolean;
}

// ------------------------------------------------------------------ derived tables
export interface LeagueMemberRow {
  key: string; name: string; kind: 'human' | 'ai'; color: string;
  games: number; wins: number; crowns: number; podiums: number; lastPlaces: number;
  vpTotal: number; oathsKept: number; oathsBroken: number;
  /** One earned title (LOOPS.md §3.4), or null. */
  title: string | null;
  /** The Court: Exile points earned across games (making the winner's victory costly). */
  exilePoints: number;
  /** Holds the Ugly Trophy (last place in the League's latest game). */
  ugly: boolean;
}
export interface HeadToHead {
  a: string; b: string;
  games: number;
  /** Games where a finished above b, and the reverse. */
  ahead: [number, number];
  /** Games won by a / by b with the other at the table. */
  wins: [number, number];
  kills: [number, number];
  captures: [number, number];
  battles: [number, number];
  betrayals: [number, number];
}
export interface NemesisMark { member: string; nemesis: string; harm: number; kills: number; captures: number; betrayals: number }
export interface Feud { a: string; b: string; heat: number; level: 'simmering' | 'bitter' | 'blood feud'; games: number; captures: [number, number]; betrayals: [number, number]; debts: [number, number] }
export interface HallEntry { game: string; gameName: string; turns: number; member: string; house: string; color: string; banners: string[]; reason: string; vp: number; index: number }
export interface UglyTrophy { member: string; name: string; game: string; gameName: string; index: number }
export interface OathRecord { member: string; name: string; victim: string; victimName: string; words: string; game: string; index: number; turn: number }
export interface FamousFleet { member: string; house: string; name: string; commander: string; epithets: string[]; rank: number; fate: string; game: string; index: number }
export interface LeagueRecords {
  biggestBattle: { name: string; ships: number; game: string; turn: number } | null;
  fastestCrown: { member: string; house: string; turns: number; game: string } | null;
  mostVp: { member: string; house: string; vp: number; game: string } | null;
}
export interface LeagueTable {
  id: string; name: string; createdAt: number;
  played: number; pending: number;
  members: LeagueMemberRow[];
  headToHead: HeadToHead[];
  nemesis: NemesisMark[];
  feuds: Feud[];
  hall: HallEntry[];
  ugly: UglyTrophy | null;
  oaths: OathRecord[];
  famous: FamousFleet[];
  records: LeagueRecords;
}

/** What the Herald of a new game in a League may recall (setup's `league`): seats of the NEW game, public facts only. */
export interface LeagueMemory {
  name: string;
  /** Which meeting of this League the new game is (1 = the first). */
  meeting: number;
  houses: { seat: number; name: string; games: number; wins: number; ugly: boolean; title: string | null }[];
  last: { winner: number | null; winnerName: string; turns: number; lastPlace: number | null; lastName: string } | null;
  /** Rivalries between seats of the new game, hottest first. */
  feuds: { a: number; b: number; heat: number; level: string; games: number; wins: [number, number]; captures: [number, number]; betrayals: [number, number]; kills: [number, number] }[];
  nemesis: { seat: number; of: number; harm: number }[];
  /** Pacts broken between these seats in the last game, with the words they swore. */
  oaths: { by: number; victim: number; words: string }[];
  fleets: { seat: number; name: string; epithet: string | null }[];
}

// ------------------------------------------------------------------ helpers
const grid = (n: number) => Array.from({ length: n }, () => new Array<number>(n).fill(0));
const clip = (t: unknown, n: number) => (typeof t === 'string' ? t : '').replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').trim().slice(0, n);
const int = (x: unknown, lo = 0, hi = 1e6) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : lo);
const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** A member key from a seat's kind and name: case, spacing and punctuation do not matter. */
export function memberKey(kind: 'human' | 'ai', name: string): string {
  const n = clip(name, 60).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim() || 'nameless';
  return `${kind === 'ai' ? 'ai' : 'p'}:${n}`;
}

/** A League's default name, from the houses at its first table. */
export function leagueName(names: string[]): string {
  const ns = names.map(n => clip(n, 40)).filter(Boolean);
  if (ns.length < 2) return 'The League';
  return `The League of ${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`.slice(0, 80);
}

export function emptyLeague(id: string, name: string, createdAt: number): League {
  return { v: LEAGUE_VERSION, id, name: clip(name, 80) || 'The League', createdAt, games: [], pending: [] };
}

// ------------------------------------------------------------------ summarising a finished game
export interface SummaryInput {
  game: string;
  name: string;
  createdAt: number;
  /** Member key per seat. */
  members: string[];
  /** Seat kinds (the stored seats; the state's player kinds can be overridden by stewards). */
  kinds: ('human' | 'ai')[];
  /** The turn results the server kept (battles for kills). Optional: without it, kills come from blood-debts only. */
  history?: TurnResult[];
}

/** Boil a finished game down to its League summary. Pure: the same inputs give the same summary. */
export function summarizeGame(s: GameState, inp: SummaryInput): LeagueGameSummary {
  const n = s.players.length;
  const kills = grid(n), captures = grid(n), battles = grid(n), betrayals = grid(n), debts = grid(n);
  const ok = (p: unknown): p is PlayerId => typeof p === 'number' && p >= 0 && p < n;
  let biggest: LeagueGameSummary['biggestBattle'] = null;
  const lost = new Array<number>(n).fill(0);
  // battles: who destroyed whose ships, who beat whom (each report covers distinct rounds)
  const seenReport = new Set<string>();
  for (const r of inp.history ?? []) for (const b of r.battles ?? []) {
    const key = `${r.turn}:${r.tick ?? ''}:${b.id}:${b.day ?? ''}:${b.pulse}`;
    if (seenReport.has(key)) continue;
    seenReport.add(key);
    const ownerOf = new Map<number, number>();
    for (const sd of b.sides ?? []) for (const sh of sd.ships ?? []) ownerOf.set(sh.id, sd.owner);
    for (const rd of b.rounds ?? []) for (const sh of rd.shots ?? []) {
      if (!sh.kill) continue;
      const k = ownerOf.get(sh.from), v = ownerOf.get(sh.to);
      if (ok(k) && ok(v) && k !== v) kills[k][v]++;
    }
    for (const [o, x] of Object.entries(b.losses ?? {})) if (ok(Number(o))) lost[Number(o)] += int(x);
    if (!b.ongoing && ok(b.winner)) for (const sd of b.sides ?? []) if (ok(sd.owner) && sd.owner !== b.winner) battles[b.winner][sd.owner]++;
    const total = Object.values(b.losses ?? {}).reduce((a, x) => a + int(x), 0);
    if (total > 0 && (!biggest || total > biggest.ships)) biggest = { name: clip(b.name, 80), turn: r.turn, ships: total };
  }
  // captures: the hands every world passed through (public history), else the capture events kept
  let fromStory = false;
  for (const r of s.regions) {
    const own = r.story?.owners;
    if (!own) continue;
    fromStory = true;
    for (let i = 1; i < own.length; i++) {
      const a = own[i - 1].p, b = own[i].p;
      if (ok(a) && ok(b) && a !== b && (own[i].how === 'force' || own[i].how === 'influence')) captures[b][a]++;
    }
  }
  if (!fromStory) for (const r of inp.history ?? []) for (const e of r.events ?? []) if (e.k === 'capture' && ok(e.by) && ok(e.from) && e.by !== e.from) captures[e.by][e.from]++;
  for (const d of s.soul?.debts ?? []) if (ok(d.debtor) && ok(d.creditor) && d.debtor !== d.creditor) debts[d.debtor][d.creditor]++;
  // without kept battle reports, a blood-debt is at least one ship
  if (!(inp.history ?? []).length) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) kills[i][j] = Math.max(kills[i][j], debts[i][j]);
  const oaths: LeagueGameSummary['oaths'] = [];
  for (const p of s.players) for (const o of p.oathbreaker ?? []) {
    if (!ok(o.victim) || o.victim === p.id) continue;
    betrayals[p.id][o.victim]++;
    oaths.push({ by: p.id, victim: o.victim, words: clip(o.words, 200), turn: int(o.turn) });
  }
  oaths.sort((a, b) => a.turn - b.turn || a.by - b.by);
  const saga = sagaOf(s);
  const vowsKept = new Array<number>(n).fill(0), vowsBroken = new Array<number>(n).fill(0);
  for (const f of saga.fleets) {
    if (!ok(f.owner)) continue;
    vowsKept[f.owner] += f.beats.filter(b => b.kind === 'vow_kept').length;
    if (f.oathbreaker) vowsBroken[f.owner]++;
  }
  // places: the winner first, then by VP; houses that fell go below those that stood
  const order = s.players.map(p => p.id).sort((a, b) => (a === s.winner ? -1 : b === s.winner ? 1 : 0)
    || Number(s.players[a].eliminated) - Number(s.players[b].eliminated) || s.players[b].vp - s.players[a].vp || a - b);
  const famous = saga.fleets.filter(f => ok(f.owner) && (f.rank >= 3 || f.epithets.length > 0))
    .sort((a, b) => b.epithets.length - a.epithets.length || b.rank - a.rank || a.foundedTurn - b.foundedTurn || a.id - b.id).slice(0, 6)
    .map(f => ({ seat: f.owner, name: clip(f.name, 60), commander: clip(f.commander, 60), epithets: f.epithets.map(x => clip(x, 60)).slice(0, 3), rank: f.rank, fate: f.fate }));
  const seats: LeagueSeatSummary[] = s.players.map(p => ({
    member: inp.members[p.id] ?? memberKey(inp.kinds[p.id] ?? p.kind, p.name),
    name: clip(p.name, 40), kind: inp.kinds[p.id] ?? p.kind, color: clip(p.color, 16),
    vp: int(p.vp, -1e6), place: order.indexOf(p.id) + 1, eliminated: !!p.eliminated,
    crowns: s.regions.filter(r => r.kind === 'crown' && r.owner === p.id).length,
    throneTurns: (s.soul?.reigns ?? []).filter(r => r.p === p.id).reduce((a, r) => a + Math.max(0, (r.to ?? s.turn) - r.from), 0),
    vowsKept: vowsKept[p.id], pactsKept: s.pacts.filter(x => x.a === p.id || x.b === p.id).length,
    vowsBroken: vowsBroken[p.id], oathsBroken: betrayals[p.id].reduce((a, x) => a + x, 0),
    shipsLost: lost[p.id], shipsKilled: kills[p.id].reduce((a, x) => a + x, 0),
    banners: saga.fleets.filter(f => f.owner === p.id).sort((a, b) => Number(b.fate === 'alive') - Number(a.fate === 'alive') || b.rank - a.rank || b.epithets.length - a.epithets.length || a.id - b.id)
      .slice(0, 3).map(f => clip(f.epithets.length ? `${f.name}, ${f.epithets[f.epithets.length - 1]}` : f.name, 90)),
    ...(saga.exiles.some(e => e.player === p.id) ? { exilePoints: int(saga.exiles.find(e => e.player === p.id)!.points, 0, 1e6) } : {}),
  }));
  return {
    game: inp.game, name: clip(inp.name, 60), createdAt: int(inp.createdAt, 0, 1e15), mode: s.mode === 'live' ? 'live' : 'wego',
    turns: Math.max(0, s.turn - (s.winner !== null && s.mode !== 'live' ? 1 : 0)), winner: ok(s.winner) ? s.winner : null, winReason: clip(s.winReason, 120),
    seats, kills, captures, battles, betrayals, debts, oaths, famous, biggestBattle: biggest,
  };
}

/** Put a finished game's summary into the League (replacing an older summary of it). Returns true if anything changed. */
export function recordGame(l: League, sum: LeagueGameSummary): boolean {
  const before = JSON.stringify(l);
  const i = l.games.findIndex(g => g.game === sum.game);
  if (i >= 0) l.games[i] = sum; else l.games.push(sum);
  if (l.auto && l.games.length === 1) { l.name = leagueName(sum.seats.map(x => x.name)); delete l.auto; }
  l.games.sort((a, b) => a.createdAt - b.createdAt || byKey(a.game, b.game));
  if (l.games.length > LEAGUE_MAX_GAMES) l.games.splice(0, l.games.length - LEAGUE_MAX_GAMES);
  l.pending = l.pending.filter(g => g !== sum.game);
  return JSON.stringify(l) !== before;
}

// ------------------------------------------------------------------ the tables
/** Harm j did to i in one game: the "who took the most from whom" score behind nemesis marks. */
const harmOf = (g: LeagueGameSummary, j: number, i: number) => g.kills[j][i] + 3 * g.captures[j][i] + 4 * g.betrayals[j][i] + 2 * g.debts[j][i];

export function leagueTable(l: League): LeagueTable {
  const games = l.games;
  const rows = new Map<string, LeagueMemberRow>();
  for (const g of games) for (const sd of g.seats) {
    const r = rows.get(sd.member) ?? { key: sd.member, name: sd.name, kind: sd.kind, color: sd.color, games: 0, wins: 0, crowns: 0, podiums: 0, lastPlaces: 0, vpTotal: 0, oathsKept: 0, oathsBroken: 0, title: null, ugly: false, exilePoints: 0 };
    r.name = sd.name; r.color = sd.color; r.kind = sd.kind;   // the latest game's name and colour
    r.games++;
    if (sd.place === 1 && g.winner !== null) r.wins++;
    if (sd.place <= 2) r.podiums++;
    if (sd.place === g.seats.length) r.lastPlaces++;
    r.crowns += sd.crowns; r.vpTotal += sd.vp; r.exilePoints += int(sd.exilePoints ?? 0, 0, 1e6);
    r.oathsKept += sd.vowsKept + sd.pactsKept; r.oathsBroken += sd.vowsBroken + sd.oathsBroken;
    rows.set(sd.member, r);
  }
  const lastGame = games[games.length - 1];
  const loser = lastGame ? [...lastGame.seats].sort((a, b) => b.place - a.place)[0] : undefined;
  const ugly: UglyTrophy | null = lastGame && loser ? { member: loser.member, name: loser.name, game: lastGame.game, gameName: lastGame.name, index: games.length } : null;
  if (ugly) rows.get(ugly.member)!.ugly = true;
  // pairs
  const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
  const h2h = new Map<string, HeadToHead>();
  const feudAcc = new Map<string, { a: string; b: string; games: number; cap: [number, number]; bet: [number, number]; debt: [number, number]; mutual: number }>();
  const harm = new Map<string, Map<string, { harm: number; kills: number; captures: number; betrayals: number }>>();
  for (const g of games) {
    const n = g.seats.length;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const mi = g.seats[i].member, mj = g.seats[j].member;
      if (mi === mj) continue;
      const hm = harm.get(mi) ?? new Map();
      const e = hm.get(mj) ?? { harm: 0, kills: 0, captures: 0, betrayals: 0 };
      e.harm += harmOf(g, j, i); e.kills += g.kills[j][i]; e.captures += g.captures[j][i]; e.betrayals += g.betrayals[j][i];
      hm.set(mj, e); harm.set(mi, hm);
      if (i > j) continue;
      const k = pairKey(mi, mj);
      const [a, b, x, y] = mi < mj ? [mi, mj, i, j] : [mj, mi, j, i];
      const h = h2h.get(k) ?? { a, b, games: 0, ahead: [0, 0], wins: [0, 0], kills: [0, 0], captures: [0, 0], battles: [0, 0], betrayals: [0, 0] } as HeadToHead;
      h.games++;
      if (g.seats[x].place < g.seats[y].place) h.ahead[0]++; else if (g.seats[y].place < g.seats[x].place) h.ahead[1]++;
      if (g.winner === x) h.wins[0]++; else if (g.winner === y) h.wins[1]++;
      h.kills[0] += g.kills[x][y]; h.kills[1] += g.kills[y][x];
      h.captures[0] += g.captures[x][y]; h.captures[1] += g.captures[y][x];
      h.battles[0] += g.battles[x][y]; h.battles[1] += g.battles[y][x];
      h.betrayals[0] += g.betrayals[x][y]; h.betrayals[1] += g.betrayals[y][x];
      h2h.set(k, h);
      const f = feudAcc.get(k) ?? { a, b, games: 0, cap: [0, 0], bet: [0, 0], debt: [0, 0], mutual: 0 };
      f.games++;
      f.cap[0] += g.captures[x][y]; f.cap[1] += g.captures[y][x];
      f.bet[0] += g.betrayals[x][y]; f.bet[1] += g.betrayals[y][x];
      f.debt[0] += g.debts[x][y]; f.debt[1] += g.debts[y][x];
      // a game where each took something from the other
      if ((g.captures[x][y] + g.debts[x][y] + g.betrayals[x][y]) > 0 && (g.captures[y][x] + g.debts[y][x] + g.betrayals[y][x]) > 0) f.mutual++;
      feudAcc.set(k, f);
    }
  }
  const nemesis: NemesisMark[] = [];
  for (const [m, hm] of [...harm.entries()].sort((a, b) => byKey(a[0], b[0]))) {
    const best = [...hm.entries()].filter(([, e]) => e.harm > 0).sort((a, b) => b[1].harm - a[1].harm || byKey(a[0], b[0]))[0];
    if (best) nemesis.push({ member: m, nemesis: best[0], ...best[1] });
  }
  const feuds: Feud[] = [];
  for (const f of [...feudAcc.values()]) {
    const heat = 2 * Math.min(f.cap[0], f.cap[1]) + 3 * (f.bet[0] + f.bet[1]) + 2 * Math.min(f.debt[0], f.debt[1]) + 2 * f.mutual;
    if (heat < 4) continue;
    feuds.push({ a: f.a, b: f.b, heat, level: heat >= 16 ? 'blood feud' : heat >= 8 ? 'bitter' : 'simmering', games: f.games, captures: f.cap, betrayals: f.bet, debts: f.debt });
  }
  feuds.sort((a, b) => b.heat - a.heat || byKey(a.a, b.a) || byKey(a.b, b.b));
  const hall: HallEntry[] = [];
  games.forEach((g, i) => {
    if (g.winner === null) return;
    const w = g.seats[g.winner];
    hall.push({ game: g.game, gameName: g.name, turns: g.turns, member: w.member, house: w.name, color: w.color, banners: w.banners, reason: g.winReason, vp: w.vp, index: i + 1 });
  });
  const oaths: OathRecord[] = [];
  games.forEach((g, i) => { for (const o of g.oaths) oaths.push({ member: g.seats[o.by].member, name: g.seats[o.by].name, victim: g.seats[o.victim].member, victimName: g.seats[o.victim].name, words: o.words, game: g.game, index: i + 1, turn: o.turn }); });
  const famous: FamousFleet[] = [];
  games.forEach((g, i) => { for (const f of g.famous) famous.push({ member: g.seats[f.seat].member, house: g.seats[f.seat].name, name: f.name, commander: f.commander, epithets: f.epithets, rank: f.rank, fate: f.fate, game: g.game, index: i + 1 }); });
  famous.sort((a, b) => b.epithets.length - a.epithets.length || b.rank - a.rank || b.index - a.index || byKey(a.name, b.name));
  // records
  let biggestBattle: LeagueRecords['biggestBattle'] = null, fastestCrown: LeagueRecords['fastestCrown'] = null, mostVp: LeagueRecords['mostVp'] = null;
  for (const g of games) {
    if (g.biggestBattle && (!biggestBattle || g.biggestBattle.ships > biggestBattle.ships)) biggestBattle = { ...g.biggestBattle, game: g.game };
    if (g.winner !== null && (!fastestCrown || g.turns < fastestCrown.turns)) fastestCrown = { member: g.seats[g.winner].member, house: g.seats[g.winner].name, turns: g.turns, game: g.game };
    for (const sd of g.seats) if (!mostVp || sd.vp > mostVp.vp) mostVp = { member: sd.member, house: sd.name, vp: sd.vp, game: g.game };
  }
  const members = [...rows.values()].sort((a, b) => b.wins - a.wins || b.podiums - a.podiums || b.vpTotal - a.vpTotal || byKey(a.key, b.key));
  const mostBroken = Math.max(0, ...members.map(m => m.oathsBroken));
  for (const m of members) {
    m.title = m.wins >= 3 ? 'the Thrice-Crowned' : m.wins === 2 ? 'the Twice-Crowned'
      : m.oathsBroken > 0 && m.oathsBroken === mostBroken ? 'the Oathbreaker'
      : m.lastPlaces >= 2 && m.wins === 0 ? 'the Unlucky'
      : m.wins === 1 ? 'the Crowned'
      : m.oathsKept >= 3 && m.oathsBroken === 0 ? 'the Faithful' : null;
  }
  return {
    id: l.id, name: l.name, createdAt: l.createdAt, played: games.length, pending: l.pending.length,
    members, headToHead: [...h2h.values()].sort((a, b) => b.games - a.games || byKey(a.a, b.a) || byKey(a.b, b.b)),
    nemesis, feuds, hall, ugly, oaths: oaths.slice(-30), famous: famous.slice(0, 12),
    records: { biggestBattle, fastestCrown, mostVp },
  };
}

/** What the Herald of a new game seated by `members` (member key per seat) may recall from this League. */
export function leagueMemory(l: League, seats: { member: string; name: string }[]): LeagueMemory {
  const t = leagueTable(l);
  const seatOf = (m: string) => seats.findIndex(x => x.member === m);
  const rowOf = (m: string) => t.members.find(r => r.key === m);
  const houses = seats.map((sd, i) => {
    const r = rowOf(sd.member);
    return { seat: i, name: sd.name, games: r?.games ?? 0, wins: r?.wins ?? 0, ugly: !!r?.ugly, title: r?.title ?? null };
  });
  const lg = l.games[l.games.length - 1];
  let last: LeagueMemory['last'] = null;
  if (lg) {
    const w = lg.winner !== null ? lg.seats[lg.winner] : null;
    const lo = [...lg.seats].sort((a, b) => b.place - a.place)[0];
    last = { winner: w ? (seatOf(w.member) >= 0 ? seatOf(w.member) : null) : null, winnerName: w?.name ?? '', turns: lg.turns,
      lastPlace: lo && seatOf(lo.member) >= 0 ? seatOf(lo.member) : null, lastName: lo?.name ?? '' };
  }
  const feuds: LeagueMemory['feuds'] = [];
  for (const h of t.headToHead) {
    const a = seatOf(h.a), b = seatOf(h.b);
    if (a < 0 || b < 0) continue;
    const fd = t.feuds.find(f => f.a === h.a && f.b === h.b);
    const flip = a > b;
    const sw = <T>(x: [T, T]): [T, T] => (flip ? [x[1], x[0]] : x);
    feuds.push({ a: Math.min(a, b), b: Math.max(a, b), heat: fd?.heat ?? 0, level: fd?.level ?? '', games: h.games, wins: sw(h.wins), captures: sw(h.captures), betrayals: sw(h.betrayals), kills: sw(h.kills) });
  }
  feuds.sort((x, y) => y.heat - x.heat || y.games - x.games || x.a - y.a || x.b - y.b);
  const nemesis = t.nemesis.map(nm => ({ seat: seatOf(nm.member), of: seatOf(nm.nemesis), harm: nm.harm })).filter(x => x.seat >= 0 && x.of >= 0);
  const oaths = lg ? lg.oaths.map(o => ({ by: seatOf(lg.seats[o.by].member), victim: seatOf(lg.seats[o.victim].member), words: o.words })).filter(o => o.by >= 0 && o.victim >= 0).slice(-3) : [];
  const fleets = t.famous.map(f => ({ seat: seatOf(f.member), name: f.name, epithet: f.epithets[f.epithets.length - 1] ?? null })).filter(f => f.seat >= 0).slice(0, 4);
  return { name: l.name, meeting: l.games.length + 1, houses, last, feuds, nemesis, oaths, fleets };
}

/** Validate a LeagueMemory handed to createGame (it is public game state: names and counts only). */
export function cleanLeagueMemory(m: unknown, seats = 3): LeagueMemory | undefined {
  if (!m || typeof m !== 'object') return undefined;
  const x = m as Record<string, any>;
  const seat = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < seats ? v : -1);
  const pair = (v: unknown): [number, number] => (Array.isArray(v) ? [int(v[0]), int(v[1])] : [0, 0]);
  const arr = (v: unknown, n: number) => (Array.isArray(v) ? v.slice(0, n) : []);
  const out: LeagueMemory = {
    name: clip(x.name, 80) || 'The League',
    meeting: int(x.meeting, 1, 1e4),
    houses: arr(x.houses, seats).map((h: any) => ({ seat: seat(h?.seat), name: clip(h?.name, 40), games: int(h?.games), wins: int(h?.wins), ugly: !!h?.ugly, title: h?.title ? clip(h.title, 40) : null })).filter(h => h.seat >= 0),
    last: x.last && typeof x.last === 'object' ? {
      winner: seat(x.last.winner) >= 0 ? seat(x.last.winner) : null, winnerName: clip(x.last.winnerName, 40), turns: int(x.last.turns),
      lastPlace: seat(x.last.lastPlace) >= 0 ? seat(x.last.lastPlace) : null, lastName: clip(x.last.lastName, 40),
    } : null,
    feuds: arr(x.feuds, 3).map((f: any) => ({ a: seat(f?.a), b: seat(f?.b), heat: int(f?.heat), level: clip(f?.level, 20), games: int(f?.games), wins: pair(f?.wins), captures: pair(f?.captures), betrayals: pair(f?.betrayals), kills: pair(f?.kills) }))
      .filter(f => f.a >= 0 && f.b >= 0 && f.a !== f.b),
    nemesis: arr(x.nemesis, seats).map((nm: any) => ({ seat: seat(nm?.seat), of: seat(nm?.of), harm: int(nm?.harm) })).filter(nm => nm.seat >= 0 && nm.of >= 0 && nm.seat !== nm.of),
    oaths: arr(x.oaths, 3).map((o: any) => ({ by: seat(o?.by), victim: seat(o?.victim), words: clip(o?.words, 200) })).filter(o => o.by >= 0 && o.victim >= 0 && o.by !== o.victim),
    fleets: arr(x.fleets, 4).map((f: any) => ({ seat: seat(f?.seat), name: clip(f?.name, 60), epithet: f?.epithet ? clip(f.epithet, 60) : null })).filter(f => f.seat >= 0 && f.name),
  };
  return out;
}
