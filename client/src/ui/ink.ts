// Herald ink (docs/DELIGHT.md #66): a planted dispatch is printed as fact, but in *your* copy the ink smudges where
// your own intel contradicts it. Computed here, in your client, from your own view only (the worlds you see, your own
// fleets and treasury): a rival's copy, and the liar's own copy, print clean. Nothing is guessed: a claim the reader
// cannot check stays clean, and only a few plain kinds of claim are read at all:
//   "X is bankrupt"                  about your house, while your treasury holds credits
//   "<fleet> destroyed / is no more" about one of your fleets, still flying
//   "we hold W", "W is ours", "W fell to X"   about a world you can see, held by someone else
//   "ignore the rumours about W", "no fleet at W"   while you can see the writer's fleet at W
// A dispatch is checked against the view at the moment its edition is the newest (when it is read as news); the
// verdict is kept for that copy, so an old edition keeps its smudge as printed.
import type { GameScreen } from '../game.ts';
import type { HeraldEdition, PlayerId, Region } from '../../../shared/sim/types.ts';

type Dispatch = HeraldEdition['dispatches'][number];
const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ');
const words = (s: string) => new RegExp(`(^|[^a-z])${s.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`);

/** The reason this reader knows the dispatch is false (≤ 12 words), or null if they cannot tell. */
export function lieCheck(g: GameScreen, d: Dispatch): string | null {
  const st = g.st, you = g.you;
  if (you === null || d.player === you || !st.players[you]) return null;
  const t = norm(d.text);
  const me = st.players[you];
  const author = st.players[d.player];
  const said = (name: string) => words(norm(name)).test(t);
  // 1. "your house is bankrupt", read by a house with money in the bank
  if (/\bbankrupt\b|\bpenniless\b|\bbroke\b/.test(t) && said(me.name) && (me.res?.credits ?? 0) > 0) return `Your treasury holds ${me.res.credits} credits.`;
  // 2. one of your fleets declared dead
  if (/\b(destroyed|sunk|annihilated|wiped out|is no more|are no more|dead|burned)\b/.test(t)) {
    // only a fleet the words can mean: its name is yours alone in what you know of the war (houses reuse names:
    // every house has a Home Guard), or the dispatch names your house beside it
    const known = [...st.fleets.map(x => ({ name: x.name, owner: x.owner })), ...(st.soul?.fallen ?? []).map(r => ({ name: r.name, owner: r.owner }))];
    const f = st.fleets.find(x => x.owner === you && x.ships.length && x.name.length >= 4 && said(x.name)
      && (said(me.name) || !known.some(k => k.owner !== you && norm(k.name) === norm(x.name))));
    if (f) return `${f.name} still flies.`;
  }
  // the worlds this reader can check: seen now, or their own
  const vis = g.visibleSet();
  const checkable = (r: Region) => !!r && r.kind !== 'lane' && (vis.has(r.id) || r.owner === you);
  const named = st.regions.filter(r => r.kind !== 'lane' && r.name.length >= 3 && checkable(r) && said(r.name));
  if (!named.length) return null;
  const houseIn = (s: string): PlayerId | null => {
    for (const p of st.players) if (words(norm(p.name)).test(s) || words(norm(p.name.split(' ')[0])).test(s)) return p.id;
    return null;
  };
  const owner = (o: PlayerId | null | undefined) => (o === null || o === undefined || o < 0 ? 'unclaimed' : o === you ? 'yours' : `${st.players[o]?.name ?? '?'}’s`);
  for (const r of named) {
    const w = norm(r.name);
    // 3. "we hold W" / "W is ours" / "our W": the writer claims a world it does not hold
    const ours = new RegExp(`\\b(we|our fleets?|${norm(author?.name ?? '§')})\\s+(hold|holds|took|take|own|owns|have taken|has taken|captured|rule)\\s+(the\\s+)?${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(is|stands)\\s+ours|\\bour\\s+${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
    if (ours.test(t) && r.owner !== d.player) return `${r.name} is ${owner(r.owner)}, by your own eyes.`;
    // "W fell to X" / "W belongs to X" / "X holds W"
    const m = new RegExp(`${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(fell to|has fallen to|belongs to|is held by)\\s+([^.,;!?]+)`).exec(t);
    if (m) { const h = houseIn(m[2]); if (h !== null && r.owner !== h) return `${r.name} is ${owner(r.owner)}, by your own eyes.`; }
    // 4. "ignore the rumours about W" / "no fleet at W" while the writer's fleet sits there in plain sight
    const deny = new RegExp(`(rumou?rs? (about|of)|no fleets? (at|near|in)|nothing (at|near|in)|never (sent|go) to)\\s+(the\\s+)?${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
    if (deny.test(t) && vis.has(r.id) && st.fleets.some(f => f.owner === d.player && f.region === r.id && f.ships.length)) return `Your scouts see their fleet at ${r.name}.`;
  }
  return null;
}

/** The smudges of one copy, kept per game and seat: { edition turn: { dispatch index: reason } }. */
function store(g: GameScreen): Record<string, Record<string, string>> {
  try { return JSON.parse(localStorage.getItem(`tc.ink.${g.gameKey()}.${g.you ?? 's'}`) ?? '{}') ?? {}; } catch { return {}; }
}
/** Smudges for an edition: computed against the view when it is the newest, remembered after. */
export function smudgesFor(g: GameScreen, ed: HeraldEdition, newest: boolean): Map<number, string> {
  const out = new Map<number, string>();
  if (g.you === null) return out;
  const all = store(g);
  const key = String(ed.turn);
  if (!newest) {
    for (const [i, why] of Object.entries(all[key] ?? {})) out.set(Number(i), why);
    return out;
  }
  ed.dispatches.forEach((d, i) => { const why = lieCheck(g, d); if (why) out.set(i, why); });
  if (out.size || all[key]) {
    all[key] = Object.fromEntries(out);
    try { localStorage.setItem(`tc.ink.${g.gameKey()}.${g.you}`, JSON.stringify(all)); } catch { /* storage blocked: the smudge is only for this reading */ }
  }
  return out;
}
