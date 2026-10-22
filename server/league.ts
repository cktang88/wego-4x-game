// League persistence: data/leagues/<id>.json, one file per League (docs/LOOPS.md §3.1).
// The ledger itself (summaries, tables, the Herald's memory) is pure and lives in shared/league.ts; this file only
// stores Leagues and never writes a seat token, a token hash or anything but display names into them.
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { emptyLeague, leagueName, leagueTable, recordGame, LEAGUE_VERSION, type League, type LeagueGameSummary, type LeagueTable } from '../shared/league.ts';

export const LEAGUE_ID_RE = /^[0-9a-f]{6,32}$/;

const looksLikeLeague = (l: any, file: string): l is League =>
  !!l && typeof l === 'object' && typeof l.id === 'string' && LEAGUE_ID_RE.test(l.id) && `${l.id}.json` === file
  && Array.isArray(l.games) && Array.isArray(l.pending) && typeof l.name === 'string';

/** A League as the API serves it: the derived tables. Everything in it is public to whoever has the League id. */
export interface LeagueView extends LeagueTable {
  games: { game: string; name: string; turns: number; mode: 'wego' | 'live'; winner: string | null; houses: { name: string; place: number; vp: number; color: string; member: string }[] }[];
  running: string[];
}

export class LeagueStore {
  leagues = new Map<string, League>();

  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true });
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const l = JSON.parse(readFileSync(join(dir, f), 'utf8'));
        if (!looksLikeLeague(l, f)) throw new Error('not a valid league file');
        l.v ??= LEAGUE_VERSION;
        this.leagues.set(l.id, l);
      } catch (e) {
        console.error('[leagues] failed to load', f, (e as Error)?.message ?? e);
        try { renameSync(join(dir, f), join(dir, `${f}.corrupt-${Date.now()}`)); } catch { /* ignore */ }
      }
    }
  }

  /** Atomic write (temp file + fsync + rename), like games. */
  save(l: League) {
    const p = join(this.dir, `${l.id}.json`);
    const tmp = `${p}.${process.pid}.tmp`;
    const fd = openSync(tmp, 'w');
    try { writeSync(fd, JSON.stringify(l)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp, p);
  }

  get(id: unknown): League | undefined {
    return typeof id === 'string' && LEAGUE_ID_RE.test(id) ? this.leagues.get(id) : undefined;
  }

  create(houses: string[], name?: string): League {
    let id: string;
    do { id = randomBytes(5).toString('hex'); } while (this.leagues.has(id) || existsSync(join(this.dir, `${id}.json`)));
    const l = emptyLeague(id, name || leagueName(houses), Date.now());
    if (!name) l.auto = true;
    this.save(l);
    this.leagues.set(id, l);
    return l;
  }

  /** A new game joins the League (still running). */
  attach(l: League, game: string) {
    if (l.pending.includes(game) || l.games.some(g => g.game === game)) return;
    l.pending.push(game);
    if (l.pending.length > 50) l.pending.splice(0, l.pending.length - 50);
    this.save(l);
  }

  /** Record a finished game (idempotent: the same summary twice changes nothing and writes nothing). */
  record(l: League, sum: LeagueGameSummary): boolean {
    const changed = recordGame(l, sum);
    if (changed) this.save(l);
    return changed;
  }

  view(l: League): LeagueView {
    return {
      ...leagueTable(l),
      games: l.games.map(g => ({
        game: g.game, name: g.name, turns: g.turns, mode: g.mode, winner: g.winner !== null ? g.seats[g.winner].name : null,
        houses: g.seats.map(s => ({ name: s.name, place: s.place, vp: s.vp, color: s.color, member: s.member })),
      })),
      running: [...l.pending],
    };
  }

  /** A short card for "your leagues". */
  card(l: League) {
    const t = leagueTable(l);
    return { id: l.id, name: l.name, played: l.games.length, running: l.pending.length, houses: t.members.map(m => ({ name: m.name, wins: m.wins, color: m.color, ugly: m.ugly })),
      lastWinner: t.hall.length ? t.hall[t.hall.length - 1].house : null };
  }
}
