// League REST client (server/index.ts): GET /api/league/:id, POST /api/leagues/mine, rematches.
// Seat tokens stay in this browser (localStorage 'tc.token.<game>', written by net.ts); they are only ever sent in
// request bodies, never in URLs.
import type { LeagueTable } from '../../../shared/league.ts';
import type { CreateGameReq, GameMeta } from '../../../shared/protocol.ts';

/** GET /api/league/:id (server/league.ts LeagueView). */
export interface LeagueView extends LeagueTable {
  games: { game: string; name: string; turns: number; mode: 'wego' | 'live'; winner: string | null; houses: { name: string; place: number; vp: number; color: string; member: string }[] }[];
  running: string[];
}
/** POST /api/leagues/mine: one card per League this browser holds a seat in. `via`: games of it this browser sits in. */
export interface LeagueCard { id: string; name: string; played: number; running: number; houses: { name: string; wins: number; color: string; ugly: boolean }[]; lastWinner: string | null; via: string[] }

const TOKEN_KEY = /^tc\.token\.([0-9a-f]{6,32})$/;

/** Every seat this browser holds: [{ game, token, seat }]. */
export function heldSeats(): { game: string; token: string; seat: number }[] {
  const out: { game: string; token: string; seat: number }[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const m = k ? TOKEN_KEY.exec(k) : null;
      if (!m) continue;
      try {
        const v = JSON.parse(localStorage.getItem(k!) ?? 'null') as { token?: unknown; seat?: unknown } | null;
        if (v && typeof v.token === 'string' && v.token) out.push({ game: m[1], token: v.token, seat: typeof v.seat === 'number' ? v.seat : -1 });
      } catch { /* a damaged entry */ }
    }
  } catch { /* storage blocked */ }
  return out;
}
const seatOf = (game: string) => heldSeats().find(x => x.game === game) ?? null;

async function errorText(r: Response): Promise<string> {
  try { return (await r.json()).error ?? `HTTP ${r.status}`; } catch { return `HTTP ${r.status}`; }
}
async function postJson<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(await errorText(r));
  return r.json() as Promise<T>;
}

export const leagueApi = {
  async get(id: string): Promise<LeagueView> {
    const r = await fetch(`/api/league/${encodeURIComponent(id)}`);
    if (!r.ok) throw new Error(await errorText(r));
    return r.json();
  },
  async mine(): Promise<LeagueCard[]> {
    const seats = heldSeats();
    if (!seats.length) return [];
    const r = await postJson<{ leagues: LeagueCard[] }>('/api/leagues/mine', { tokens: seats.map(({ game, token }) => ({ game, token })) });
    return r.leagues;
  },
  async leagueOf(game: string): Promise<string | null> {
    const r = await fetch(`/api/games/${encodeURIComponent(game)}`);
    if (!r.ok) return null;
    return ((await r.json()) as GameMeta).league ?? null;
  },
};

/**
 * The `league` field for POST /api/games when the lobby adds a game to an existing League (proof: a seat of one of
 * its games), or undefined for a new League.
 */
export function leagueReq(card: LeagueCard | null): CreateGameReq['league'] {
  if (!card) return undefined;
  for (const g of card.via) { const s = seatOf(g); if (s) return { id: card.id, game: g, token: s.token }; }
  return undefined;
}

/**
 * "Again, at the same table?": a rematch of `game` (same seats, galaxy and League), and this browser takes its old
 * seat there. Resolves to the new game's id (its seat token is stored like any joined seat).
 */
export async function rematch(game: string): Promise<string> {
  const mine = seatOf(game);
  if (!mine) throw new Error('You do not hold a seat in that game.');
  const made = await postJson<{ id: string; meta: GameMeta }>('/api/games', { league: { rematchOf: game, token: mine.token } } satisfies CreateGameReq);
  const seat = mine.seat >= 0 ? mine.seat : 0;
  const name = made.meta.seats[seat]?.name ?? '';
  if (made.meta.seats[seat]?.kind === 'human') {
    const j = await postJson<{ token: string; seat: number }>(`/api/games/${encodeURIComponent(made.id)}/join`, { seat, name });
    try { localStorage.setItem(`tc.token.${made.id}`, JSON.stringify({ token: j.token, seat: j.seat })); } catch { /* storage blocked */ }
  }
  return made.id;
}
