// The Herald (a front page each WEGO turn / LIVE cycle) and the Saga (end-of-game story data).
// Both are built from Soul-layer beats queued during resolution (soul.ts beat()), deterministically
// (templates in config/content.ts, variants picked by hash). Fog: a headline is public, or seen only by
// the players involved and those whose sensors covered its region (seenBy, filtered in view.ts).
import { BOONS, BANES, HERALD_TEMPLATES, SCARS, SIGILS, DISPATCH_TEMPLATES } from '../config/content.ts';
import { SR, cleanText, ensureSoul, recordOf, soulOn, RANK_NAMES } from './soul.ts';
import { hashString } from './rng.ts';
import type { FleetRecord, GameState, Headline, HeraldEdition, PlayerId, RegionId } from './types.ts';

/** Build this turn's edition from the queued beats and dispatches (called at the end of a WEGO turn / LIVE cycle). */
export function makeEdition(s: GameState, cov: Set<RegionId>[]): HeraldEdition | null {
  if (!soulOn(s)) return null;
  const st = ensureSoul(s)!;
  const S = SR(s);
  const beats = st.beats;
  st.beats = [];
  const seenBy = (h: Headline) => s.players.filter(p => h.players.includes(p.id) || (h.region !== undefined && cov[p.id]?.has(h.region))).map(p => p.id);
  for (const b of beats) if (!b.public && !b.seenBy) b.seenBy = seenBy(b);
  for (const r of st.fallen) if (r.fateTurn === s.turn && !r.seenBy) r.seenBy = s.players.filter(p => p.id === r.owner || cov[p.id]?.has(r.fateRegion)).map(p => p.id);
  // rank by drama (ties: the order they happened); one headline per kind+region
  const seen = new Set<string>();
  const ranked = beats.map((b, i) => ({ b, i })).sort((x, y) => y.b.drama - x.b.drama || x.i - y.i).map(x => x.b)
    .filter(b => { const k = `${b.kind}:${b.region ?? ''}:${b.text}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const headlines = ranked.filter(b => b.drama > 0).slice(0, S.heraldMax);
  const quiet = HERALD_TEMPLATES.quiet;
  for (let i = 0; headlines.length < S.heraldMin && i < quiet.length; i++) {
    headlines.push({ kind: 'quiet', text: quiet[(hashString(`${s.seed}:${s.turn}`) + i) % quiet.length], players: [], drama: 0, public: true });
  }
  const dispatches = st.dispatches.map(d => ({ player: d.p, text: d.text, as: d.as, byline: d.as === 'source' ? `a source close to ${s.players[d.p]?.name ?? '?'}` : s.players[d.p]?.name ?? '?' }));
  st.dispatches = [];
  const ed: HeraldEdition = { turn: s.turn, headlines, dispatches };
  st.herald.push(ed);
  if (st.herald.length > S.heraldKeep) st.herald.splice(0, st.herald.length - S.heraldKeep);
  // the biggest moments of the game (for the Saga)
  for (const b of ranked) if (b.drama >= 5) st.moments.push({ ...b, text: `T${s.turn}: ${b.text}` });
  st.moments = st.moments.map((m, i) => ({ m, i })).sort((a, b) => b.m.drama - a.m.drama || a.i - b.i).slice(0, 12).map(x => x.m);
  return ed;
}

/** Can player `p` read this headline? */
export const headlineVisible = (h: Headline, p: PlayerId) => h.public || h.players.includes(p) || !!h.seenBy?.includes(p);

/** Validate and queue a dispatch (one per house per edition). Returns an error or null. */
export function queueDispatch(s: GameState, p: PlayerId, text: unknown, as: unknown): string | null {
  if (!soulOn(s)) return 'the Herald is off in these rules';
  const st = ensureSoul(s)!;
  const t = cleanText(text, SR(s).dispatchMax);
  if (!t) return 'empty dispatch';
  if (st.dispatches.some(d => d.p === p) || s.players[p].dispatchTurn === s.turn) return 'one dispatch per edition';
  st.dispatches.push({ p, text: t, as: as === 'source' ? 'source' : 'house', turn: s.turn });
  s.players[p].dispatchTurn = s.turn;
  return null;
}

/** An AI dispatch from the templates (deterministic), or null if it stays quiet this turn. */
export function aiDispatch(s: GameState, p: PlayerId): { text: string; as: 'house' | 'source' } | null {
  const h = hashString(`${s.seed}:${s.turn}:${p}:dispatch`);
  if (h % 4 !== 0) return null;
  const rivals = s.players.filter(x => x.id !== p && !x.eliminated);
  if (!rivals.length) return null;
  const them = rivals[(h >>> 4) % rivals.length].name;
  const mine = s.regions.filter(r => r.owner !== p && r.kind !== 'lane');
  const r = mine.length ? mine[(h >>> 8) % mine.length].name : 'the Throne';
  const text = DISPATCH_TEMPLATES[(h >>> 12) % DISPATCH_TEMPLATES.length].replace('{me}', s.players[p].name).replace('{them}', them).replace('{r}', r);
  return { text: text.slice(0, SR(s).dispatchMax), as: (h >>> 16) % 2 ? 'source' : 'house' };
}

// ============================================================================ the Saga
export interface FleetSaga {
  id: number; owner: PlayerId; name: string; commander: string; rank: number; rankName: string;
  sigil: string; sigilGlyph: string; boons: string[]; banes: string[]; home: RegionId; homeName: string; foundedTurn: number;
  fate: FleetRecord['fate']; fateTurn: number | null; fateRegion: RegionId | null;
  epithets: string[]; scars: string[]; honours: string[]; routs: number; oathbreaker: boolean;
  paragraph: string;
  beats: { turn: number; kind: string; text: string; region?: RegionId }[];
}
export interface Saga {
  fleets: FleetSaga[];
  reigns: { player: PlayerId; name: string; from: number; to: number | null }[];
  memorials: { region: RegionId; regionName: string; text: string }[];
  moments: { turn: number; text: string; kind: string; region?: RegionId; players: PlayerId[] }[];
  oaths: { player: PlayerId; turn: number; victim: PlayerId; words: string }[];
  vowsBroken: { fleet: string; owner: PlayerId; turn: number; vow: string }[];
  debts: { debtor: PlayerId; creditor: PlayerId; victim: string; killer: string; turn: number; cleared: number | null }[];
  worlds: { region: RegionId; name: string; epithet: string | null; calling: string | null; deeds: string[] }[];
}

/** The end-of-game Saga as structured data (pure). Works mid-game too (fleets still flying are "alive"). */
export function sagaOf(s: GameState): Saga {
  const st = s.soul;
  const rn = (id: RegionId | null | undefined) => (id === null || id === undefined ? '?' : s.regions[id]?.name ?? '?');
  const recs: FleetRecord[] = [...(st?.fallen ?? []), ...s.fleets.filter(f => f.banner && f.owner >= 0 && f.ships.length).map(f => recordOf(s, f, 'alive', f.region))];
  const fleets = recs.map(r => {
    const sig = SIGILS.find(x => x.id === r.sigil);
    const fateText = r.fate === 'alive' ? 'It still flies.'
      : r.fate === 'destroyed' ? `It was destroyed at ${rn(r.fateRegion)} on turn ${r.fateTurn}.`
      : r.fate === 'caught' ? `It was caught limping home at ${rn(r.fateRegion)} on turn ${r.fateTurn} and destroyed.`
      : r.fate === 'broken' ? `Its third scar broke it on turn ${r.fateTurn}; it was disbanded with honours.`
      : r.fate === 'retired' ? `It retired with honours to ${rn(r.fateRegion)} on turn ${r.fateTurn}.`
      : `It was merged into another banner on turn ${r.fateTurn}.`;
    const parts = [
      `${r.name}${r.epithets.length ? `, ${r.epithets.join(', ')},` : ''} was founded at ${rn(r.home)} on turn ${r.foundedTurn} under ${r.commander}${r.boons.length ? `, ${r.boons.map(b => BOONS[b]?.name ?? b).join(' and ')}` : ''}${r.banes.length ? ` (${r.banes.map(b => BANES[b]?.name ?? b).join(', ')})` : ''}.`,
    ];
    const kept = r.saga.filter(b => b.kind === 'vow_kept' || b.kind === 'legend' || b.kind === 'honour');
    if (kept.length) parts.push(kept.map(b => b.text).join(' '));
    if (r.routs) parts.push(`It routed ${r.routs === 1 ? 'once' : `${r.routs} times`}${r.scars.length ? ` and bears ${r.scars.map(x => SCARS[x.id]?.name ?? x.id).join(', ')}` : ''}.`);
    if (r.oathbreaker) parts.push('It broke a vow, and is remembered as Oathbreaker.');
    parts.push(fateText);
    return {
      id: r.id, owner: r.owner, name: r.name, commander: r.commander, rank: r.rank, rankName: RANK_NAMES[r.rank] ?? '',
      sigil: r.sigil, sigilGlyph: sig?.glyph ?? '', boons: r.boons, banes: r.banes, home: r.home, homeName: rn(r.home), foundedTurn: r.foundedTurn,
      fate: r.fate, fateTurn: r.fate === 'alive' ? null : r.fateTurn, fateRegion: r.fate === 'alive' ? null : r.fateRegion,
      epithets: r.epithets, scars: r.scars.map(x => x.id), honours: r.honours, routs: r.routs, oathbreaker: r.oathbreaker,
      paragraph: parts.join(' '), beats: r.saga,
    } satisfies FleetSaga;
  }).sort((a, b) => b.rank - a.rank || b.epithets.length - a.epithets.length || a.foundedTurn - b.foundedTurn || a.id - b.id);
  return {
    fleets,
    reigns: (st?.reigns ?? []).map(r => ({ player: r.p, name: s.players[r.p]?.name ?? '?', from: r.from, to: r.to })),
    memorials: s.regions.flatMap(r => r.memorials.map(text => ({ region: r.id, regionName: r.name, text }))),
    moments: (st?.moments ?? []).slice(0, 3).map(m => ({ turn: Number(/^T(\d+)/.exec(m.text)?.[1] ?? 0), text: m.text.replace(/^T\d+: /, ''), kind: m.kind, region: m.region, players: m.players })),
    oaths: s.players.flatMap(p => (p.oathbreaker ?? []).map(o => ({ player: p.id, turn: o.turn, victim: o.victim, words: o.words }))),
    vowsBroken: recs.filter(r => r.oathbreaker).map(r => ({ fleet: r.name, owner: r.owner, turn: r.saga.find(b => b.kind === 'vow_broken')?.turn ?? 0, vow: r.saga.find(b => b.kind === 'vow_broken')?.text ?? '' })),
    debts: (st?.debts ?? []).map(d => ({ debtor: d.debtor, creditor: d.creditor, victim: d.victim, killer: d.killer, turn: d.turn, cleared: d.cleared ?? null })),
    worlds: s.regions.filter(r => r.story && (r.story.epithet || r.story.calling || r.story.deeds.length))
      .map(r => ({ region: r.id, name: r.name, epithet: r.story!.epithet, calling: r.story!.calling?.id ?? null, deeds: r.story!.deeds.map(d => d.name) })),
  };
}


