// The Herald (a front page each WEGO turn / LIVE cycle) and the Saga (end-of-game story data).
// Both are built from Soul-layer beats queued during resolution (soul.ts beat()), deterministically
// (templates in config/content.ts, variants picked by hash). Fog: a headline is public, or seen only by
// the players involved and those whose sensors covered its region (seenBy, filtered in view.ts).
// Each printed headline also gets a story (body + dateline, templates in config/herald-stories.ts), written
// only from facts that every player in the headline's audience was allowed to know.
import { BOONS, BANES, HERALD_TEMPLATES, SCARS, SIGILS, DISPATCH_TEMPLATES, CALLINGS } from '../config/content.ts';
import { STORIES, QUOTES, ASIDES, SOURCES, QUOTE_FRAMES, CLOSERS, CALLBACKS, READS, FATE_PROSE, RANK_WORDS, POSTURE_PROSE, STORY_CAPS } from '../config/herald-stories.ts';
import { SR, cleanText, ensureSoul, recordOf, soulOn, RANK_NAMES, worldEpithet, vowText } from './soul.ts';
import { SY, bodyName } from './systems.ts';
import { hashString } from './rng.ts';
import type { BattleReport, Fleet, FleetRecord, GameEvent, GameState, Headline, HeadlineFacts, HeraldEdition, PlayerId, RegionId, Vow } from './types.ts';

/**
 * Note what the Herald will need from this step (call at the end of every WEGO turn / LIVE tick, before
 * makeEdition): battle reports and posture/Fate details are gone by the time the edition is printed.
 * Attaches `facts` to the beats queued this step (internal; stripped when printed).
 */
export function heraldNote(s: GameState, battles: BattleReport[] = [], events: GameEvent[] = []) {
  const st = s.soul;
  if (!st || !soulOn(s)) return;
  for (const b of st.beats) {
    if (b.facts) continue;
    const facts: HeadlineFacts = {};
    if (b.kind === 'battle' && b.region !== undefined) {
      const rep = battles.filter(r => r.region === b.region && !r.ongoing)
        .sort((x, y) => sum(Object.values(y.losses)) - sum(Object.values(x.losses)) || x.id - y.id)[0];
      if (rep) facts.battle = {
        name: rep.name, rounds: rep.totalRounds ?? rep.rounds.length, winner: rep.winner,
        first: [...new Set((rep.rounds[0]?.shots ?? []).filter(x => x.first).map(x => rep.sides.find(sd => sd.ships.some(sh => sh.id === x.from))?.owner).filter((o): o is PlayerId | -1 => o !== undefined))],
        sides: rep.sides.map(sd => ({ owner: sd.owner, fleets: sd.fleets.map(f => ({ name: f.name, cmd: f.commander })), ships: sd.ships.length, lost: rep.losses[String(sd.owner)] ?? 0 })),
      };
    }
    if (b.kind.startsWith('p_') && b.region !== undefined) {
      const ev = events.find(e => e.k === 'posture' && e.region === b.region && e.owner === b.players[0] && (e.fleet === undefined || b.text.includes(fleetName(s, e.fleet))));
      if (ev && ev.k === 'posture') facts.posture = ev.posture;
    }
    if (b.kind === 'fate') {
      const ev = events.find(e => e.k === 'fate' && e.owner === b.players[0] && e.use !== 'bonus' && (e.fleet === undefined || b.text.includes(fleetName(s, e.fleet))));
      if (ev && ev.k === 'fate') facts.fate = ev.use;
    }
    b.facts = facts;
  }
}
const fleetName = (s: GameState, id: number) => s.fleets.find(f => f.id === id)?.name ?? s.soul?.fallen.find(r => r.id === id)?.name ?? '\u0000';
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Build this turn's edition from the queued beats and dispatches (called at the end of a WEGO turn / LIVE cycle). */
export function makeEdition(s: GameState, cov: Set<RegionId>[]): HeraldEdition | null {
  if (!soulOn(s)) return null;
  const st = ensureSoul(s)!;
  const S = SR(s);
  heraldNote(s);   // beats nobody noted (old saves, direct callers): whatever the state still knows
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
  writeStories(s, headlines, beats, st.herald[st.herald.length - 1] ?? null);
  for (const b of beats) delete b.facts;
  const dispatches = st.dispatches.map(d => ({ player: d.p, text: d.text, as: d.as, byline: d.as === 'source' ? `a source close to ${s.players[d.p]?.name ?? '?'}` : s.players[d.p]?.name ?? '?' }));
  st.dispatches = [];
  const ed: HeraldEdition = { turn: s.turn, headlines, dispatches };
  st.herald.push(ed);
  if (st.herald.length > S.heraldKeep) st.herald.splice(0, st.herald.length - S.heraldKeep);
  // the biggest moments of the game (for the Saga; the headline only, not the story)
  for (const b of ranked) if (b.drama >= 5) { const { body: _b, dateline: _d, ...m } = b; st.moments.push({ ...m, text: `T${s.turn}: ${b.text}` }); }
  st.moments = st.moments.map((m, i) => ({ m, i })).sort((a, b) => b.m.drama - a.m.drama || a.i - b.i).slice(0, 12).map(x => x.m);
  return ed;
}

// ============================================================================ stories
type Slots = Record<string, string | undefined>;
const SLOT = /\{(\?)?([A-Za-z]+)\}/g;
const known = (t: string, v: Slots) => [...t.matchAll(SLOT)].every(m => !!v[m[2]]);
/** Fill a story template: null when it needs a fact this audience may not have (see herald-stories.ts). */
export function fillStory(t: string, v: Slots, frag = false): string | null {
  const out = t.replace(/\[([^[\]]*)\]/g, (_, inner: string) => (known(inner, v) ? inner : ''));
  if (!known(out, v) || !out.trim()) return null;
  return tidy(out.replace(SLOT, (_, q: string | undefined, k: string) => (q ? '' : v[k]!)), frag);
}
/** Spaces and punctuation; sentences start with a capital (a fragment, e.g. a source's name, keeps its first letter). */
function tidy(t: string, frag = false): string {
  const u = t.replace(/\s+/g, ' ').replace(/\b([Aa]) (?=[AEIOU][a-z])/g, '$1n ').replace(/s’s\b/g, 's’').replace(/\s+([,.;:!?])/g, '$1').replace(/([,;:])(?=[.,;:])/g, '').trim()
    .replace(/([.!?][”"’]?\s+[“"‘]?)([a-z])/g, (_, a: string, c: string) => a + c.toUpperCase());
  return frag ? u : u.replace(/^([“"‘]?)([a-z])/, (_, q: string, c: string) => q + c.toUpperCase());
}
const mix = (seed: number, salt: string) => hashString(`${seed}:${salt}`);
/** A variant from `bank` by hash, skipping ones this edition already printed (unless nothing else fits). */
function pick(bank: readonly string[], v: Slots, seed: number, used: Set<string>, tag: string, frag = false): string | null {
  let fallback: string | null = null;
  for (let i = 0; i < bank.length; i++) {
    const j = (seed + i) % bank.length;
    const out = fillStory(bank[j], v, frag);
    if (out === null) continue;
    if (used.has(`${tag}:${j}`)) { fallback ??= out; continue; }
    used.add(`${tag}:${j}`);
    return out;
  }
  return fallback;
}
/** Like pick, but among the variants that carry the most facts (details should use what is known). */
function pickRich(bank: readonly string[], v: Slots, seed: number, used: Set<string>, tag: string): string | null {
  const weight: Record<string, number> = { cycle: 0, turn: 0, read: 4, fated: 4, fallen: 3, slain: 3, first: 2 };
  const facts = (t: string) => sum([...t.replace(/\[([^[\]]*)\]/g, (_, inner: string) => (known(inner, v) ? inner : '')).matchAll(SLOT)].map(m => weight[m[2]] ?? 1));
  const ok = bank.map((t, j) => ({ t, j, n: fillStory(t, v) === null ? -1 : facts(t) })).filter(x => x.n >= 0);
  if (!ok.length) return null;
  const top = Math.max(...ok.map(x => x.n));
  const best = ok.filter(x => x.n >= top - (top >= 3 ? 1 : 0));
  return pick(best.map(x => x.t), v, seed, used, `${tag}:${top}`);
}
const words = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);
const NUM = ['none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const num = (n: number) => (n >= 0 && n < NUM.length ? NUM[n] : String(n));
const plural = (n: number, w: string) => `${n === 0 ? 'no' : num(n)} ${w}${n === 1 ? '' : 's'}`;
const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${num(n)} times`);
const listOf = (xs: string[]) => (xs.length <= 1 ? xs[0] ?? '' : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const capFirst = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const lowFirst = (t: string) => (/^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t);
/** "Dawn Patrol" → "the Dawn Patrol"; "The Few" → "the Few"; names with a possessive stay as they are. */
const the = (name: string) => (/^the\s/i.test(name) ? `the ${name.slice(4)}` : /^(a|an)\s/i.test(name) || /['’]s\b/.test(name) ? name : `the ${name}`);

/** A banner as the Herald knows it: from a fleet still flying or from the record of a fallen one. */
interface Banner {
  id: number; owner: PlayerId; name: string; cmd: string; rank: number; epithets: string[]; scars: { id: string; turn: number }[];
  honours: string[]; sigil: string; home: RegionId; founded: number; routs: number; vow: Vow | null; oath: string | null; boons: string[];
}
const fromFleet = (f: Fleet): Banner => ({
  id: f.id, owner: f.owner, name: f.name, cmd: f.commander.name, rank: f.commander.rank, epithets: f.epithets ?? [], scars: f.scars ?? [],
  honours: (f.honours ?? []).map(h => h.id), sigil: f.banner?.sigil ?? '', home: f.banner?.home ?? f.region, founded: f.banner?.foundedTurn ?? f.bornTurn,
  routs: f.routs?.length ?? 0, vow: f.vow ?? null, oath: f.oathbreaker?.vow ?? null, boons: f.banner?.boons ?? [],
});
const fromRecord = (r: FleetRecord): Banner => ({
  id: r.id, owner: r.owner, name: r.name, cmd: r.commander, rank: r.rank, epithets: r.epithets, scars: r.scars, honours: r.honours, sigil: r.sigil,
  home: r.home, founded: r.foundedTurn, routs: r.routs, vow: null, oath: r.oathbreaker ? (r.saga.find(x => x.kind === 'vow_broken')?.text ?? null) : null, boons: r.boons,
});
/** The banner a headline names: its name is in the text and it belongs to the headline's first house. */
function bannerIn(s: GameState, text: string, owner: PlayerId | undefined, fallen: boolean): Banner | null {
  let best: { b: Banner; score: number } | null = null;
  const consider = (b: Banner, score: number) => { if (!best || score > best.score || (score === best.score && b.id < best.b.id)) best = { b, score }; };
  for (const f of s.fleets) if (f.owner >= 0 && f.name && text.includes(f.name) && (owner === undefined || f.owner === owner)) consider(fromFleet(f), f.name.length * 4 + (fallen ? 0 : 2));
  for (const r of s.soul?.fallen ?? []) if (r.name && text.includes(r.name) && (owner === undefined || r.owner === owner)) consider(fromRecord(r), r.name.length * 4 + (fallen && r.fateTurn === s.turn ? 3 : r.fateTurn === s.turn ? 1 : 0));
  return best ? (best as { b: Banner }).b : null;
}

/** The banner a fleet headline is about, checked against the name its template was filled with. */
function bannerOf(s: GameState, h: Headline, owner: PlayerId | undefined, fallen: boolean): Banner | null {
  const f = bannerIn(s, h.text, owner, fallen);
  const named = headlineVars(h.kind, h.text).f;
  // a longer name around the banner's ("Remnant of First Expedition" vs "First Expedition") is another fleet
  return f && named && named.length > f.name.length && named.includes(f.name) ? null : f;
}

interface Ctx { s: GameState; beats: Headline[]; prev: HeraldEdition | null; used: Set<string>; everyone: PlayerId[]; cycle: string }
const audienceOf = (c: Ctx, h: Headline) => (h.public ? c.everyone : [...new Set([...h.players, ...(h.seenBy ?? [])])]);
/** Does everyone in `aud` know what `who` knows? */
const within = (aud: PlayerId[], who: PlayerId[]) => aud.every(p => who.includes(p));

function writeStories(s: GameState, headlines: Headline[], beats: Headline[], prev: HeraldEdition | null) {
  const c: Ctx = { s, beats, prev, used: new Set(), everyone: s.players.map(p => p.id), cycle: s.mode === 'live' ? 'cycle' : 'turn' };
  headlines.forEach((h, i) => {
    try {
      const st = storyFor(c, h, i === 0, i);
      if (st.body) h.body = st.body;
      if (st.dateline) h.dateline = st.dateline;
    } catch { /* a story is decoration: never let it break the turn */ }
  });
  // the whole front page stays small: later stories shrink to their first paragraph, then go
  let total = sum(headlines.map(h => h.body?.length ?? 0));
  for (let i = headlines.length - 1; i >= 0 && total > STORY_CAPS.edition; i--) {
    const h = headlines[i];
    if (!h.body) continue;
    const cut = i === 0 ? h.body.split('\n\n').slice(0, 2).join('\n\n') : '';
    total -= h.body.length - cut.length;
    if (cut) h.body = cut; else delete h.body;
  }
}

/** The names a headline was filled with, read back from its template (for banners the state no longer knows). */
function headlineVars(kind: string, text: string): Record<string, string> {
  const keys = kind === 'refugees' ? ['refugees', 'refugees_lost'] : kind === 'oath' ? ['oath', 'tribute_broken'] : [kind];
  for (const k of keys) for (const t of HERALD_TEMPLATES[k] ?? []) {
    const names: string[] = [];
    const re = new RegExp(`^${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{([a-z])\\\}/g, (_, n: string) => { names.push(n); return '(.+?)'; })}$`);
    const m = re.exec(text);
    if (m) return Object.fromEntries(names.map((n, i) => [n, m[i + 1]]));
  }
  return {};
}

/** Slots, story kind and fortunes (who came off well or badly) for one headline, fog applied. */
function slotsFor(c: Ctx, h: Headline, aud: PlayerId[]): { v: Slots; kind: string; up: PlayerId[]; down: PlayerId[] } {
  const { s } = c;
  const pn = (p: PlayerId | -1 | undefined | null) => (p === undefined || p === null ? undefined : p === -1 ? 'the Warden' : s.players[p]?.name);
  const v: Slots = { turn: String(s.turn), cycle: c.cycle };
  let kind = h.kind;
  let [a, b] = h.players;
  if (kind === 'tribute') [a, b] = [h.players[1], h.players[0]];
  if (kind === 'refugees' && /into the dark|No haven/.test(h.text)) kind = 'refugees_lost';
  if (kind === 'oath' && /tribute/i.test(h.text)) kind = 'tribute_broken';
  v.A = pn(a); v.B = pn(b);
  if (a !== undefined) v.cap = s.regions[s.players[a]?.capital ?? -1]?.name;
  const r = h.region !== undefined ? s.regions[h.region] : undefined;
  if (r) {
    v.R = r.name.replace(/^The /, 'the ');
    const ep = worldEpithet(s, r);
    if (ep) v.Rx = `${r.name} ${ep}`;
    v.kindR = r.kind === 'crown' ? 'Crown world' : r.kind === 'throne' ? 'seat of the Throne' : r.kind === 'relic' ? 'relic world' : r.kind === 'colony' ? 'colony' : r.homeOf !== null ? 'capital' : undefined;
  }
  // the standings, the Throne, the edict: public
  const ranked = s.players.filter(p => !p.eliminated).sort((x, y) => y.vp - x.vp || x.id - y.id);
  if (ranked.length >= 2 && ranked[0].vp > ranked[1].vp) {
    const last = ranked[ranked.length - 1];
    v.leader = ranked[0].name; v.leaderVp = String(ranked[0].vp); v.trail = last.name; v.trailVp = String(last.vp);
    if (ranked[0].vp > last.vp) v.gap = `${ranked[0].vp - last.vp} VP`;
  }
  if (s.throne?.owner !== null && s.throne?.owner !== undefined) { v.throne = pn(s.throne.owner); v.streak = plural(Math.max(1, s.throne.streak), c.cycle); } else v.empty = 'y';
  const ed = (s.edicts ?? []).find(e => e.revealedTurn <= s.turn && e.scoresTurn >= s.turn);
  if (ed) { v.edict = ed.name; v.edictVp = String(ed.vp); }
  const up: PlayerId[] = [], down: PlayerId[] = [];
  const good = (x?: PlayerId) => { if (x !== undefined && x >= 0) up.push(x); };
  const bad = (x?: PlayerId) => { if (x !== undefined && x >= 0) down.push(x); };
  const fleetSlots = (f: Banner | null) => {
    if (!f) return;
    v.F = f.name; v.Ft = the(f.name); v.C = f.cmd;
    if (f.rank >= 2) v.rank = RANK_WORDS[f.rank] ?? RANK_NAMES[f.rank]?.toLowerCase();
    if (f.epithets.length) v.ep = f.epithets[f.epithets.length - 1];
    const sc = [...f.scars].sort((x, y) => y.turn - x.turn);
    if (sc.length) { v.scar = SCARS[sc[0].id]?.name; v.scars = plural(sc.length, 'scar'); }
    const hon = f.honours.map(x => BOONS[x]?.name).filter((x): x is string => !!x);
    if (hon.length) v.honours = listOf(hon);
    v.sigil = SIGILS.find(x => x.id === f.sigil)?.name;
    v.home = s.regions[f.home]?.name;
    if (s.turn - f.founded > 0) v.age = plural(s.turn - f.founded, c.cycle);
    v.founded = String(f.founded);
    if (f.routs) v.routs = times(f.routs);
  };
  switch (kind) {
    case 'battle': {
      battleSlots(c, h, aud, v);
      const w = h.facts?.battle?.winner;
      if (!v.murk && typeof w === 'number' && w >= 0) { good(w); for (const p of h.players) if (p !== w) bad(p); }
      break;
    }
    case 'rout': case 'destroyed': case 'caught': case 'death': case 'broken': case 'retired': {
      const f = bannerOf(s, h, a, kind !== 'rout' && kind !== 'retired');
      fleetSlots(f);
      if (!f) {
        // a fleet without a banner (or an old save): what the headline itself says
        const hv = headlineVars(h.kind, h.text);
        const rec = hv.c ? s.soul?.fallen.find(x => x.commander === hv.c && x.owner === a && x.fateTurn === s.turn) : undefined;
        if (rec) fleetSlots(fromRecord(rec));
        if (hv.f) { v.F = hv.f; v.Ft = the(hv.f); }
        if (hv.c) v.C = hv.c;
      }
      if (kind === 'rout' && f) {
        const fresh = f.scars.find(x => x.turn === s.turn);
        v.scar = fresh ? SCARS[fresh.id]?.name : undefined;
      }
      if ((kind === 'destroyed' || kind === 'caught' || kind === 'death') && f) {
        const d = s.soul?.debts.find(x => x.turn === s.turn && x.fleet === f.name && x.creditor === f.owner);
        if (d && d.killer !== v.B) v.killer = d.killer;
      }
      if (kind === 'retired') good(a); else { bad(a); good(b); }
      break;
    }
    case 'vow_sworn': case 'vow_kept': case 'vow_broken': case 'honour': case 'legend': case 'founded': {
      const f = bannerOf(s, h, a, false);
      fleetSlots(f);
      if (f && kind === 'vow_sworn' && f.vow) {
        v.vow = lowFirst(vowText(s, f.vow));
        if (f.vow.kind === 'avenge' && f.vow.target) v.target = f.vow.target;
        if (f.vow.kind === 'guard' && f.vow.region !== undefined) v.guard = s.regions[f.vow.region]?.name;
      }
      if (f && kind === 'vow_broken' && f.oath) v.vow = lowFirst(f.oath.replace(/^Broke its vow \((.*)\).*$/, '$1'));
      if (kind === 'vow_sworn' && !v.vow) v.vow = lowFirst(h.text.replace(/^.*?:\s*/, ''));
      if (kind === 'honour' || kind === 'founded') {
        const names = Object.values(BOONS).filter(x => h.text.includes(x.name)).sort((x, y) => y.name.length - x.name.length);
        const bo = names[0];
        if (bo && kind === 'honour') { v.boon = bo.name; v.boonDesc = lowFirst(bo.desc); }
      }
      if (kind === 'vow_broken') bad(a); else if (kind !== 'vow_sworn' && kind !== 'founded') good(a);
      break;
    }
    case 'debt': case 'vengeance': {
      const victimIn = (x: string) => h.text.includes(x);
      const ds = (s.soul?.debts ?? []).filter(x => (kind === 'debt' ? x.turn === s.turn && x.debtor === a && x.creditor === b : x.cleared === s.turn && x.creditor === a && x.debtor === b));
      const d = ds.find(x => victimIn(x.victim)) ?? (kind === 'vengeance' ? ds[0] : undefined);
      if (d) {
        v.victim = d.victim; v.Vf = the(d.fleet);
        if (d.killer !== v.A) v.killer = d.killer;
        if (kind === 'debt') v.R = s.regions[d.region]?.name ?? v.R;
        if (kind === 'vengeance' && s.turn > d.turn) v.since = plural(s.turn - d.turn, c.cycle);
        const open = (s.soul?.debts ?? []).filter(x => !x.cleared && ((x.debtor === a && x.creditor === b) || (x.debtor === b && x.creditor === a))).length;
        if (open >= 2) v.debts = num(open);
      }
      if (kind === 'debt') bad(b); else { good(a); bad(b); }
      break;
    }
    case 'capture': case 'capital': case 'liberated': case 'razed': {
      const story = r?.story;
      if (r && story) {
        const lost = story.lost;
        if (lost && lost.p === b && lost.turn === s.turn && lost.tenure > 0) v.tenure = plural(lost.tenure, c.cycle);
        if (story.calling) v.calling = CALLINGS[story.calling.id]?.name;
        const taken = story.owners.filter(o => o.how === 'force' || o.how === 'influence').length;
        if (taken >= 2) v.taken = times(taken);
        if (story.deeds.length) v.deed = story.deeds[story.deeds.length - 1].name;
        if (kind === 'liberated' && b !== undefined) {
          const held = [...story.owners].reverse().find(o => o.p === b && o.turn < s.turn);
          if (held) v.since = plural(s.turn - held.turn, c.cycle);
        }
      }
      good(a); bad(b);
      break;
    }
    case 'coronation': {
      const reigns = s.soul?.reigns ?? [];
      const before = [...reigns].reverse().find(x => x.p !== a && x.to !== null);
      if (before) v.prev = pn(before.p);
      if (reigns.length >= 2) v.reigns = num(reigns.length);
      good(a);
      break;
    }
    case 'tribute': case 'tribute_offer': {
      const t = r?.tribute;
      const share = SY(s).tributeShare;
      v.share = Math.abs(share - 1 / 3) < 0.01 ? 'a third' : Math.abs(share - 0.25) < 0.01 ? 'a quarter' : Math.abs(share - 0.5) < 0.01 ? 'half' : `${Math.round(share * 100)}%`;
      if (kind === 'tribute' && t) { v.until = String(t.until - 1); v.terms = num(t.until - t.since); }
      if (kind === 'tribute') { good(a); bad(b); }
      break;
    }
    case 'oath': case 'tribute_broken': {
      const o = [...(s.players[a ?? -1]?.oathbreaker ?? [])].reverse().find(x => x.turn === s.turn && x.victim === b);
      if (o && kind === 'oath') v.words = o.words.replace(/[.!?]+$/, '');
      bad(a); bad(b);
      break;
    }
    case 'refugees': case 'refugees_lost': {
      if (kind === 'refugees' && r) {
        const line = s.chronicle.find(e => e.turn === s.turn && e.text.startsWith(`Refugees from ${r.name} resettle at `));
        if (line?.region !== undefined) {
          const dest = s.regions[line.region];
          v.X = dest.name;
          const bn = bodyName(dest, line.body);
          if (bn && bn !== dest.name) v.Xb = bn;
        }
        if (!v.X) v.X = h.text.match(/ for (.+)$|reach (.+)$/)?.slice(1).find(Boolean);
      }
      bad(a);
      break;
    }
    case 'fate': {
      const f = bannerOf(s, h, a, false);
      fleetSlots(f);
      v.R = r?.name;   // Surge only: a fleet's Fate never says where the fleet is
      const use = h.facts?.fate ?? (/LAST STAND/.test(h.text) ? 'laststand' : /RALLIES/.test(h.text) ? 'rally' : /Twist of Fate/.test(h.text) ? 'twist' : /HYPERJUMPS/.test(h.text) ? 'hyperjump' : /surges/.test(h.text) ? 'surge' : undefined);
      const fp = use ? FATE_PROSE[use] : undefined;
      if (fp) { v.use = fillStory(fp.use, v, true) ?? undefined; v.useDesc = fillStory(fp.desc, v) ?? undefined; }
      const left = s.players[a ?? -1]?.fate;
      if (left !== undefined) v.left = num(left);
      v.home = undefined;   // keep a Fate story about the house, not where its fleets come from
      break;
    }
    case 'fate_bonus': {
      const me = s.players[a ?? -1];
      if (me && ranked[0] && ranked[0].id !== me.id && ranked[0].vp > me.vp) { v.leader = ranked[0].name; v.leaderVp = String(ranked[0].vp); v.gap = String(ranked[0].vp - me.vp); }
      break;
    }
    case 'p_called': case 'p_caught': case 'p_ambush': case 'p_broken': case 'p_exposed': {
      const f = bannerOf(s, h, a, false);
      fleetSlots(f);
      if (!f) { const hv = headlineVars(h.kind, h.text); if (hv.f) { v.F = hv.f; v.Ft = the(hv.f); } }
      const posture = h.facts?.posture ?? (kind === 'p_ambush' || kind === 'p_exposed' ? 'ambush' : kind === 'p_broken' ? 'charge' : kind === 'p_caught' ? 'running'
        : /read the defence|Charge/.test(h.text) ? 'charge' : /read the attack|Guarded/.test(h.text) ? 'guarded' : undefined);
      const pp = posture ? POSTURE_PROSE[posture] : undefined;
      if (pp) { v.posture = pp.name; v.bet = pp.bet; }
      if (kind === 'p_called' || kind === 'p_ambush') { good(a); bad(b); } else { bad(a); good(b); }
      break;
    }
    case 'p_scorched': case 'p_levies': {
      if (kind === 'p_levies') { good(a); bad(b); } else bad(b);
      break;
    }
    case 'deed': {
      v.deed = h.text.replace(/^.*?earns a deed:\s*/, '');
      break;
    }
    case 'calling': {
      const id = r?.story?.calling?.id;
      v.calling = (id ? CALLINGS[id]?.name : undefined) ?? h.text.replace(/^.*?calling:\s*/, '');
      break;
    }
    case 'eliminated': bad(a); break;
  }
  // whose side a partisan quote comes from
  const voice = kind === 'battle' ? (!v.murk && typeof h.facts?.battle?.winner === 'number' && h.facts.battle.winner >= 0 ? h.facts.battle.winner : undefined)
    : kind === 'debt' || kind === 'oath' || kind === 'tribute_broken' ? b
    : kind === 'quiet' || kind === 'calling' || kind === 'deed' ? undefined : a;
  if (voice !== undefined && voice >= 0) v.V = s.players[voice]?.name;
  return { v, kind: STORIES[kind] ? kind : 'quiet', up, down };
}

/** Battle slots. Names, numbers and first strikes only when the whole audience could see the fleets there. */
function battleSlots(c: Ctx, h: Headline, aud: PlayerId[], v: Slots) {
  const { s } = c;
  const r = s.regions[h.region!];
  const pn = (p: PlayerId | -1) => (p === -1 ? (r.owner === null && !s.wardenAwake ? 'the defenders' : 'the Warden') : s.players[p]?.name ?? '?');
  // where: the body it was fought over (the system's ledger notes it), or the system
  const led = [...(r.story?.ledger ?? [])].reverse().find(e => e.turn === s.turn && (e.kind === 'battle' || e.kind === 'siege'));
  const site = led ? bodyName(r, led.body) : null;
  v.place = site && site !== r.name ? `${site}, in the ${r.name.replace(/^the\s+/i, '')} system` : r.name;
  const line = [...s.chronicle].reverse().find(e => e.turn === s.turn && e.region === r.id && /^The .+ ends/.test(e.text));
  const total = Number(h.text.match(/(\d+)/)?.[1] ?? line?.text.match(/: (\d+) ships destroyed/)?.[1] ?? 0);
  if (total) v.lost = num(total);
  const days = Number(line?.text.match(/over (\d+) turns/)?.[1] ?? 0);
  if (days > 1) v.days = num(days);
  const fb = h.facts?.battle;
  v.battle = (fb?.name ?? line?.text.match(/^The (.+?) ends/)?.[1])?.replace(/\s*\([^)]*\)$/, '');
  // the fleets there are hidden from outsiders in a nebula: only those who fought (or own the system) saw them
  const fought = new Set<PlayerId>([...h.players, ...(r.owner !== null ? [r.owner] : [])]);
  const eyes = r.feature === 'nebula' && s.rules.sensors.nebulaHidesFleets ? [...fought] : aud;
  const clear = within(aud, eyes);
  // the sides: from the battle report, or (old saves) from what the fleets' histories and the fallen remember
  let sides = fb?.sides.map(x => ({ ...x, known: true }));
  let winner: PlayerId | -1 | null = fb ? fb.winner : null;
  if (!sides) {
    const held = line?.text.match(/ships destroyed\. (.+?) held the field\./)?.[1];
    winner = /The defenders held\./.test(line?.text ?? '') ? -1 : held ? (s.players.find(p => p.name === held)?.id ?? null) : null;
    const by = new Map<number, { owner: PlayerId | -1; fleets: { name: string; cmd: string }[]; ships: number; lost: number; known: boolean }>();
    const add = (owner: PlayerId | -1, name: string, cmd: string) => { const x = by.get(owner) ?? { owner, fleets: [], ships: 0, lost: 0, known: false }; x.fleets.push({ name, cmd }); by.set(owner, x); };
    if (v.battle) for (const f of s.fleets) if (f.history.some(x => x.startsWith(`T${s.turn}: `) && x.includes(` the ${v.battle}`))) add(f.owner, f.name, f.commander.name);
    for (const rec of s.soul?.fallen ?? []) if (rec.fateTurn === s.turn && rec.fateRegion === r.id) add(rec.owner, rec.name, rec.commander);
    sides = [...by.values()];
  }
  // in a nebula an outsider learns that a battle happened, not who fought it
  if (!clear) { v.murk = 'y'; return; }
  if (winner !== null) v.W = pn(winner);
  const losers = sides.filter(x => x.owner !== winner).sort((x, y) => y.lost - x.lost || y.ships - x.ships);
  const L = losers[0];
  if (L) v.L = pn(L.owner);
  const W = sides.find(x => x.owner === winner);
  const lead = (x?: { fleets: { name: string; cmd: string }[]; owner: PlayerId | -1 }) => (x?.fleets[0] ? the(x.fleets[0].name) : x && x.owner === r.owner ? `the garrison of ${r.name}` : undefined);
  v.Wf = lead(W); v.Lf = lead(L);
  v.Wc = W?.fleets[0]?.cmd; v.Lc = L?.fleets[0]?.cmd;
  if (fb && W && L) { v.lossW = plural(W.lost, 'ship'); v.lossL = plural(L.lost, 'ship'); v.nW = num(W.lost); v.nL = num(L.lost); }
  if (fb && fb.rounds > 1) v.rounds = num(fb.rounds);
  if (fb && fb.first.length === 1) v.first = pn(fb.first[0]);
  // what else this audience saw happen here this turn: posture reads, the fallen, a Fate spent
  const here = c.beats.filter(x => x !== h && x.region === r.id && within(aud, audienceOf(c, x)));
  const readBeat = here.find(x => x.kind.startsWith('p_') && x.kind !== 'p_exposed' && x.kind !== 'p_levies' && x.kind !== 'p_scorched');
  if (readBeat) {
    const f = bannerIn(s, readBeat.text, readBeat.players[0], false);
    const posture = readBeat.facts?.posture;
    const called = readBeat.kind === 'p_called' || readBeat.kind === 'p_ambush';
    const rv: Slots = { pF: f ? the(f.name) : undefined, pA: s.players[readBeat.players[0]]?.name, posture: posture ? POSTURE_PROSE[posture]?.name : undefined };
    const bank = called ? READS.called : READS.caught;
    v.read = pick(bank, rv, mix(hashString(readBeat.text), 'read'), c.used, called ? 'read:called' : 'read:caught') ?? undefined;
  }
  const lostBeat = here.find(x => x.kind === 'destroyed' || x.kind === 'caught');
  if (lostBeat) { const n = headlineVars(lostBeat.kind, lostBeat.text).f ?? bannerIn(s, lostBeat.text, lostBeat.players[0], true)?.name; if (n) v.fallen = the(n); }
  const deathBeat = here.find(x => x.kind === 'death');
  if (deathBeat) { const n = headlineVars('death', deathBeat.text).c ?? bannerIn(s, deathBeat.text, deathBeat.players[0], true)?.cmd; if (n) v.slain = n; }
  const names = new Set(sides.flatMap(x => x.fleets.map(f => f.name)));
  const fateBeat = c.beats.find(x => x.kind === 'fate' && x.public && (x.facts?.fate === 'laststand' || x.facts?.fate === 'twist' || /LAST STAND|Twist of Fate/.test(x.text)) && [...names].some(n => x.text.includes(n)));
  if (fateBeat) {
    const f = bannerIn(s, fateBeat.text, fateBeat.players[0], false);
    if (f && names.has(f.name)) v.fated = `${s.players[fateBeat.players[0]]?.name} had spent a token of Fate on ${the(f.name)}.`;
  }
}

/** The story (and dateline) under one headline. */
function storyFor(c: Ctx, h: Headline, isLead: boolean, idx: number): { body?: string; dateline?: string } {
  const { s } = c;
  const aud = audienceOf(c, h);
  const { v, kind, up, down } = slotsFor(c, h, aud);
  if (v.V) v.Vcap = s.regions[s.players.find(p => p.name === v.V)?.capital ?? -1]?.name;
  const seed = hashString(`${s.seed}:${s.turn}:${h.kind}:${h.region ?? ''}:${h.players.join(',')}:${h.text}:${idx}`);
  const K = STORIES[kind];
  // dateline: the system, or the court of the house it is about, or the Throne
  const throne = s.regions.find(r => r.kind === 'throne');
  const where = v.R ?? (h.players.length ? v.cap : undefined) ?? throne?.name ?? 'the Reach';
  const dateline = `${where.toUpperCase()}, ${c.cycle.toUpperCase()} ${s.turn}`;
  const quote = (short: boolean) => {
    // a partisan source (an officer of the house whose story it is) may say partisan things; a dockworker may not
    const partisan = !!v.V && mix(seed, 'side') % 3 !== 0;
    const qv: Slots = partisan ? { ...v } : { ...v, V: undefined };
    const src = pick(partisan ? SOURCES.partisan : SOURCES.neutral, qv, mix(seed, 'src'), c.used, partisan ? 'srcp' : 'srcn', true);
    const q = pick(QUOTES[K.mood], qv, mix(seed, 'q'), c.used, `q:${K.mood}`);
    if (!q || !src) return null;
    const frames = short ? QUOTE_FRAMES.slice(0, 2) : QUOTE_FRAMES;
    return pick(frames, { q, src, Src: capFirst(src) }, mix(seed, 'frame'), c.used, short ? 'fs' : 'f');
  };
  const closer = (skip?: string | null) => {
    const ctx = (K.context ?? ['rumour']).filter(x => x !== skip);
    for (let i = 0; i < ctx.length; i++) {
      const which = ctx[(mix(seed, 'ctx') + i) % ctx.length];
      const out = pick(CLOSERS[which], v, mix(seed, `c:${which}`), c.used, `c:${which}`);
      if (out) return { which, out };
    }
    return null;
  };
  if (!isLead) {
    let body = pick(K.short, v, mix(seed, 'short'), c.used, `${kind}:short`);
    if (!body) return { dateline };
    // room for colour: a quote, or a dry aside (by hash), and the other if there is still room
    const order = mix(seed, 'colour') % 5 < 3 ? ['q', 'a'] : ['a', 'q'];
    for (const what of order) {
      if (words(body) >= 25) break;
      const extra = what === 'q' ? quote(true) : pick(ASIDES[K.mood], v, mix(seed, 'aside'), c.used, `aside:${K.mood}`);
      if (extra && !body.includes(extra) && words(body) + words(extra) <= 50) body = `${body} ${extra}`;
    }
    return { body: clip(body, STORY_CAPS.short), dateline };
  }
  const lede = pick(K.lede, v, mix(seed, 'lede'), c.used, `${kind}:lede`);
  if (!lede) return { dateline };
  const detail = K.detail ? pickRich(K.detail, v, mix(seed, 'detail'), c.used, `${kind}:detail`) : null;
  const q = quote(false);
  // a house's dispatch from the last edition, quoted back at it when this story says how it fared
  let callback: string | null = null;
  for (const d of c.prev?.dispatches ?? []) {
    const dir = up.includes(d.player) ? 'up' : down.includes(d.player) ? 'down' : null;
    if (!dir) continue;
    const pledge = pledgeOf(d.text);
    if (!pledge) continue;
    callback = pick(CALLBACKS[dir], { ...v, who: d.byline, pledge }, mix(seed, 'cb'), c.used, `cb:${dir}`);
    if (callback) break;
  }
  const first = callback ? null : closer();
  const paras = [lede, detail, q, callback ?? first?.out].filter((x): x is string => !!x);
  const total = () => words(paras.join(' '));
  if (total() < 70) { const more = closer(first?.which)?.out; if (more && !paras.includes(more)) paras.push(more); }
  while ((total() > 120 || paras.join('\n\n').length > STORY_CAPS.lead) && paras.length > 2) paras.splice(paras.length > 3 ? paras.length - 1 : 1, 1);
  return { body: paras.join('\n\n'), dateline };
}
/** A dispatch, trimmed to quote back (ending in a full stop or the like). */
function pledgeOf(text: string): string | null {
  let t = cleanText(text, 200).replace(/[“”"]/g, '’');
  if (!t) return null;
  if (t.length > 110) t = `${t.slice(0, 108).replace(/\s+\S*$/, '')}…`;
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}
const clip = (t: string, n: number) => (t.length <= n ? t : `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…`);

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


