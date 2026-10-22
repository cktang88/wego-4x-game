// The Herald's stories (body + dateline under each headline): generated deterministically from the event's
// data, varied, size-capped, and never telling a reader more than the headline's audience was allowed to know.
import { describe, expect, it } from 'vitest';
import { createGame, newFleet, newShip } from '../shared/sim/setup.ts';
import { resolveTurn } from '../shared/sim/resolve.ts';
import { planTurn } from '../shared/sim/ai.ts';
import { makeLive, runTick } from '../shared/sim/live.ts';
import { viewFor } from '../shared/sim/view.ts';
import { Rng } from '../shared/sim/rng.ts';
import { makeEdition, headlineVisible, fillStory, correspondentOf } from '../shared/sim/herald.ts';
import { ensureSoul, headline, archiveFleet } from '../shared/sim/soul.ts';
import { STORIES, STORY_CAPS } from '../shared/config/herald-stories.ts';
import type { Fleet, GameState, Headline, HeraldEdition, RegionId, Submission } from '../shared/sim/types.ts';

const game = (seed = 11) => createGame({ seed, players: [0, 1, 2].map(() => ({ kind: 'human' as const })) });
const rng = new Rng(7);
const fleetAt = (s: GameState, owner: number, region: number, name: string, cmd: string): Fleet => {
  const f = newFleet(s, rng, owner, region);
  f.ships.push(newShip(s, rng, 'frigate', owner), newShip(s, rng, 'frigate', owner));
  f.name = name;
  f.commander.name = cmd;
  f.commander.rank = 3;
  f.banner = { sigil: 'wolf', boons: [], banes: [], home: s.players[owner].capital, foundedTurn: 1 };
  s.fleets.push(f);
  return f;
};
const words = (t: string) => t.trim().split(/\s+/).length;
const POSTURE_WORDS = /\b(Guarded|Charge|Running|Ambush)\b/;

/** AI games with every layer on; the editions printed along the way. */
function aiGame(seed: number, turns: number): { s: GameState; eds: HeraldEdition[] } {
  let s = createGame({ seed, players: ['expert', 'standard', 'novice'].map(l => ({ kind: 'ai' as const, aiLevel: l as 'expert' })) });
  const eds: HeraldEdition[] = [];
  while (s.winner === null && s.turn <= turns) {
    const subs: Record<number, Submission> = {};
    for (const p of s.players) subs[p.id] = planTurn(s, p.id);
    s = resolveTurn(s, subs);
    const ed = s.soul!.herald.at(-1)!;
    if (ed.turn === s.turn - 1) eds.push(structuredClone(ed));
  }
  return { s, eds };
}
const GAMES = [3101, 3102, 3103].map(seed => ({ seed, ...aiGame(seed, 24) }));

describe('herald stories: the template engine', () => {
  it('a template needs all its slots; optional parts drop out; sentences start with a capital', () => {
    expect(fillStory('{Ft} lost at {R}.', { Ft: 'the Dawn Patrol' })).toBeNull();
    expect(fillStory('{Ft} lost at {R}.[ {C} fell.]', { Ft: 'the Dawn Patrol', R: 'Vel' })).toBe('The Dawn Patrol lost at Vel.');
    expect(fillStory('{Ft} lost at {R}.[ {C} fell.]', { Ft: 'the Dawn Patrol', R: 'Vel', C: 'Kith' })).toBe('The Dawn Patrol lost at Vel. Kith fell.');
    expect(fillStory('{?murk}Nobody knows.', {})).toBeNull();
    expect(fillStory('{?murk}Nobody knows.', { murk: 'y' })).toBe('Nobody knows.');
    expect(fillStory('{X} becomes a {Y}.', { X: 'Vel', Y: 'Arsenal' })).toBe('Vel becomes an Arsenal.');
  });
  it('the common kinds have at least six variants of each part', () => {
    for (const k of ['battle', 'rout', 'capture', 'vow_sworn', 'vow_kept', 'vow_broken', 'honour', 'debt', 'vengeance', 'fate', 'p_called', 'p_caught', 'tribute', 'refugees', 'coronation', 'quiet', 'liberated', 'destroyed']) {
      expect(STORIES[k].lede.length, k).toBeGreaterThanOrEqual(6);
      expect(STORIES[k].short.length, k).toBeGreaterThanOrEqual(6);
    }
  });
});

describe('herald stories: AI games', () => {
  it('every headline gets a story and a dateline; leads run long, the rest short; editions stay small', () => {
    let leads = 0, shorts = 0;
    for (const { eds } of GAMES) for (const ed of eds) {
      let chars = 0;
      ed.headlines.forEach((h, i) => {
        expect(h.dateline, h.text).toMatch(/^[A-Z0-9 '’-]+, TURN \d+$/);
        expect(h.body, `${h.kind}: ${h.text}`).toBeTruthy();
        const w = words(h.body!);
        if (i === 0) { leads++; expect(w, h.body).toBeGreaterThanOrEqual(45); expect(w, h.body).toBeLessThanOrEqual(130); expect(h.body!.split('\n\n').length).toBeGreaterThanOrEqual(2); }
        else { shorts++; expect(w, h.body).toBeGreaterThanOrEqual(8); expect(w, h.body).toBeLessThanOrEqual(55); }
        expect(h.body).not.toMatch(/\{|\}|\[|\]|undefined|NaN|\?\?/);
        expect(h.facts).toBeUndefined();
        chars += h.body!.length;
      });
      expect(chars).toBeLessThanOrEqual(STORY_CAPS.edition);
    }
    expect(leads).toBeGreaterThan(40);
    expect(shorts).toBeGreaterThan(80);
  });

  it('is deterministic (same seed, same stories) and varied (the same kind rarely reads the same)', () => {
    const again = aiGame(3101, 24);
    expect(JSON.stringify(again.eds)).toBe(JSON.stringify(GAMES[0].eds));
    const bodies = GAMES.flatMap(g => g.eds.flatMap(ed => ed.headlines.map(h => h.body!)));
    expect(new Set(bodies).size / bodies.length).toBeGreaterThan(0.9);
  });

  it('public stories name no system beyond what is public, and reveal no posture', () => {
    for (const { s, eds } of GAMES) {
      const regionNames = s.regions.filter(r => r.kind !== 'lane').map(r => r.name).sort((a, b) => b.length - a.length);
      eds.forEach((ed, i) => {
        const prevDispatches = (eds[i - 1]?.dispatches ?? []).map(d => d.text).join(' ');
        for (const h of ed.headlines) {
          if (!h.public || !h.body) continue;
          const allowed = new Set<string>([h.text, prevDispatches]);
          if (h.region !== undefined) allowed.add(s.regions[h.region].name);
          for (const p of s.players) allowed.add(s.regions[p.capital].name);
          for (const r of s.regions) if (r.kind === 'throne' || r.homeOf !== null) allowed.add(r.name);
          for (const d of s.soul!.debts) allowed.add(s.regions[d.region].name);
          // the banner named in the headline: its home and the world it swore to guard are public
          for (const f of [...s.fleets, ...s.soul!.fallen]) if (h.text.includes(f.name)) {
            const home = 'ships' in f ? f.banner?.home : f.home;
            if (home !== undefined) allowed.add(s.regions[home].name);
            if ('vow' in f && f.vow?.region !== undefined) allowed.add(s.regions[f.vow.region].name);
          }
          let rest = h.body;
          for (const a of allowed) for (const n of regionNames) if (a.includes(n)) rest = rest.split(n).join('');
          for (const n of regionNames) expect(rest.includes(n), `${h.kind} "${h.text}" names ${n}: ${h.body}`).toBe(false);
          if (!h.kind.startsWith('p_')) expect(h.body, h.body).not.toMatch(POSTURE_WORDS);
        }
      });
    }
  });

  it('private stories only name fleets of the houses involved (or the one in the headline)', () => {
    for (const { s, eds } of GAMES) {
      const names = [...new Set([...s.fleets.filter(f => f.owner >= 0).map(f => f.name), ...s.soul!.fallen.map(r => r.name)])].sort((a, b) => b.length - a.length);
      for (const ed of eds) for (const h of ed.headlines) {
        if (h.public || !h.body) continue;
        let rest = h.body;
        for (const n of names) if (h.text.includes(n)) rest = rest.split(n).join('');
        for (const n of names) if (rest.includes(n)) {
          const owners = [...s.fleets, ...s.soul!.fallen].filter(f => f.name === n).map(f => f.owner);
          expect(owners.some(o => h.players.includes(o)), `${n} in ${h.body}`).toBe(true);
        }
      }
    }
  });

  it('old editions without stories still render through the views', () => {
    const { s } = GAMES[0];
    const t = structuredClone(s);
    for (const ed of t.soul!.herald) for (const h of ed.headlines) { delete h.body; delete h.dateline; }
    for (const p of [0, 1, 2]) expect(viewFor(t, p).state.soul!.herald.length).toBe(t.soul!.herald.length);
  });

  it('LIVE editions get stories too (filed by cycle)', () => {
    let s = makeLive(createGame({ seed: 77, players: ['expert', 'standard', 'novice'].map(l => ({ kind: 'ai' as const, aiLevel: l as 'expert' })) }), 0, 1);
    for (let i = 0; i < 40 && s.turn < 5; i++) s = runTick(s, () => true);
    const eds = s.soul!.herald;
    expect(eds.length).toBeGreaterThan(1);
    for (const ed of eds) for (const h of ed.headlines) { expect(h.body).toBeTruthy(); expect(h.dateline).toMatch(/, CYCLE \d+$/); }
  });
});

// ============================================================================ fog, constructed
describe('herald stories: fog', () => {
  /** Two houses fight at R (covered by 0 and 1 only); house 1 also has a fleet hidden away at Q. */
  function scene(seed: number, opts: { nebula?: boolean; p2covers?: boolean; postureSeenBy?: number[] } = {}) {
    const s = game(seed);
    const st = ensureSoul(s)!;
    s.turn = 9;
    const free = s.regions.filter(r => r.kind === 'colony' && r.owner === null);
    const R = free[0], Q = free[free.length - 1];
    if (opts.nebula) R.feature = 'nebula';
    const a = fleetAt(s, 0, R.id, 'Ember Wake Expedition', 'Sunniva Achterberg');
    const b = fleetAt(s, 1, R.id, 'Crimson Lance', 'Okafor Strand');
    const hidden = fleetAt(s, 1, Q.id, 'Shadow Column', 'Ilse Varga');
    hidden.vow = { kind: 'avenge', since: 9, target: 'Sunniva Achterberg', targetOwner: 0 };
    const [n0, n1] = [s.players[0].name, s.players[1].name];
    const beats: Headline[] = [
      { kind: 'battle', text: `Battle of ${R.name}: 5 ships lost`, region: R.id, players: [0, 1], drama: 9, public: false,
        facts: { battle: { name: `Battle of ${R.name}`, rounds: 4, winner: 0, first: [0], sides: [
          { owner: 0, fleets: [{ name: a.name, cmd: a.commander.name }], ships: 6, lost: 1 },
          { owner: 1, fleets: [{ name: b.name, cmd: b.commander.name }], ships: 5, lost: 4 }] } } },
      { kind: 'p_called', text: `CALLED IT: ${a.name} read the attack at ${R.name}`, region: R.id, players: [0, 1], drama: 4, public: false,
        facts: { posture: 'guarded' }, ...(opts.postureSeenBy ? { seenBy: opts.postureSeenBy } : {}) },
      { kind: 'capture', text: `${n0} takes ${R.name} from ${n1}`, region: R.id, players: [0, 1], drama: 5, public: true },
      { kind: 'vow_sworn', text: `${hidden.name} swears: Avenge Sunniva Achterberg`, players: [1], drama: 4, public: true },
      { kind: 'fate', text: `FATE: ${n1} spends a token — ${hidden.name} makes its LAST STAND`, players: [1], drama: 4, public: true, facts: { fate: 'laststand' } },
      { kind: 'honour', text: `${hidden.name} honoured: Ghosts`, players: [1], drama: 3, public: true },
    ];
    st.beats.push(...beats);
    const cov: Set<RegionId>[] = [new Set([R.id]), new Set([R.id]), new Set(opts.p2covers ? [R.id] : [])];
    makeEdition(s, cov);
    return { s, R, Q, a, b, hidden };
  }
  const read = (s: GameState, p: number) => viewFor(s, p).state.soul!.herald.at(-1)!.headlines;

  it('a house that saw nothing reads only public stories, and they name no hidden fleet, place or posture', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const { s, R, Q, a, b } = scene(seed);
      const mine = read(s, 2);
      expect(mine.every(h => h.public)).toBe(true);
      for (const h of mine) {
        const body = `${h.dateline} ${h.body}`;
        expect(body).not.toContain(Q.name);                 // where the hidden fleet is
        expect(body).not.toContain(a.name);                 // fleets at R it never saw
        expect(body).not.toContain(b.name);
        if (!h.text.includes(a.commander.name)) expect(body).not.toContain(a.commander.name);
        expect(body).not.toContain(b.commander.name);
        expect(body).not.toMatch(POSTURE_WORDS);
        if (h.kind !== 'capture') expect(body, body).not.toContain(R.name);
      }
      // the fighters read the full battle story: names, numbers, the read
      const lead = read(s, 0)[0];
      expect(lead.kind).toBe('battle');
      expect(lead.body!.split('\n\n').length).toBeGreaterThanOrEqual(3);
    }
  });

  it('those who fought get names and numbers; an outsider who watched a nebula gets neither', () => {
    let named = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const open = scene(seed).s;
      const battle = read(open, 0).find(h => h.kind === 'battle')!;
      if (/Ember Wake|Crimson Lance|Achterberg|Strand|\bfour\b|\bone\b/.test(battle.body!)) named++;
      const { s, a, b } = scene(seed, { nebula: true, p2covers: true });
      const seen = read(s, 2).find(h => h.kind === 'battle')!;
      expect(seen).toBeTruthy();
      for (const n of [a.name, b.name, a.commander.name, b.commander.name]) expect(seen.body).not.toContain(n);
      expect(seen.body).not.toMatch(/\bfour\b|lost one|first/);
      expect(seen.body).not.toMatch(POSTURE_WORDS);
      for (const p of s.players) expect(seen.body).not.toContain(p.name);   // nor which houses fought
    }
    expect(named).toBeGreaterThan(15);
  });

  it('a posture read stays out of a story whose audience did not see it', () => {
    let shown = 0;
    for (let seed = 1; seed <= 40; seed++) {
      // the battle was watched by house 2 too, but the posture reveal was only for the two who fought
      const hidden = scene(seed, { p2covers: true, postureSeenBy: [0, 1] }).s;
      const battle = read(hidden, 2).find(h => h.kind === 'battle')!;
      expect(battle.body).not.toMatch(POSTURE_WORDS);
      expect(battle.body).not.toMatch(/read the fight|bad read|called it|caught out/i);
      // control: when everyone saw the reveal, the battle story may use it
      const seen = scene(seed, { p2covers: true, postureSeenBy: [0, 1, 2] }).s;
      if (/read the fight|read that decided|called it/i.test(read(seen, 2).find(h => h.kind === 'battle')!.body!)) shown++;
    }
    expect(shown).toBeGreaterThan(0);
  });

  it('public stories about a hidden fleet never say where it is', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const { s, Q, hidden } = scene(seed);
      for (const p of [0, 2]) for (const h of read(s, p).filter(x => x.text.includes(hidden.name))) {
        expect(h.body).not.toContain(Q.name);
        expect(h.dateline).not.toContain(Q.name.toUpperCase());
      }
    }
  });

  it('headlineVisible still decides who reads a story', () => {
    const { s } = scene(3);
    const ed = s.soul!.herald.at(-1)!;
    for (const p of [0, 1, 2]) expect(read(s, p).length).toBe(ed.headlines.filter(h => headlineVisible(h, p)).length);
  });
});

// ============================================================================ the Herald remembers (wave 2)
describe('herald memory: correspondent, callbacks, obituaries, special editions', () => {
  /** A fresh game at turn `t` with an empty Herald (no claim edition) and the given beats printed. */
  function edition(s: GameState, t: number, beats: Headline[], cov: Set<RegionId>[]) {
    s.turn = t;
    ensureSoul(s)!.beats.push(...beats);
    return makeEdition(s, cov)!;
  }
  const battleAt = (s: GameState, R: { id: number; name: string }, players: number[], lost = 5): Headline => ({
    kind: 'battle', text: `Battle of ${R.name}: ${lost} ships lost`, region: R.id, players, drama: 9, public: false,
    facts: { battle: { name: `Battle of ${R.name}`, rounds: 3, winner: players[0], first: [], sides: players.map((o, i) => ({ owner: o, fleets: [], ships: 4, lost: i ? lost - 1 : 1 })) } },
  });
  const readerSees = (s: GameState, p: number, kind: string) => viewFor(s, p).state.soul!.herald.at(-1)!.headlines.filter(h => h.kind === kind);
  const free = (s: GameState) => s.regions.filter(r => r.kind === 'colony' && r.owner === null);
  const both = (R: number): Set<RegionId>[] => [new Set([R]), new Set([R]), new Set()];
  const all = (R: number): Set<RegionId>[] => [new Set([R]), new Set([R]), new Set([R])];

  it('every galaxy has a named correspondent (deterministic from the seed) whose byline tops the lead story', () => {
    const names = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) names.add(correspondentOf({ seed }).name);
    expect(names.size).toBeGreaterThanOrEqual(6);
    expect(correspondentOf({ seed: 5 })).toEqual(correspondentOf({ seed: 5 }));
    for (const { s, eds } of GAMES) for (const ed of eds) {
      expect(ed.correspondent).toBe(correspondentOf(s).name);
      if (ed.headlines[0].body) expect(ed.headlines[0].byline).toBe(`By ${correspondentOf(s).name}, ${correspondentOf(s).title}`);
    }
  });

  it('a second battle at the same system calls back to the first, for readers who knew of the first', () => {
    let called = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const s = game(seed);
      const R = free(s)[0];
      edition(s, 9, [battleAt(s, R, [0, 1])], both(R.id));
      const ed = edition(s, 12, [battleAt(s, R, [0, 1])], both(R.id));
      const b = ed.headlines.find(h => h.kind === 'battle')!;
      if (/\bsecond\b/.test(b.body!)) called++;
    }
    expect(called).toBe(20);
  });

  it('fog: no callback to a battle part of the audience never saw', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = game(seed);
      const R = free(s)[0];
      edition(s, 9, [battleAt(s, R, [0, 1])], both(R.id));          // house 2 saw nothing of the first
      const ed = edition(s, 12, [battleAt(s, R, [0, 1])], all(R.id)); // ...but watched the second
      const b = ed.headlines.find(h => h.kind === 'battle')!;
      expect(b.seenBy).toContain(2);
      expect(b.body).not.toMatch(/\bsecond\b|seen this before|come to blows|met in battle/);
      // house 2's copy of the Herald's memory holds only what it could know
      expect(viewFor(s, 2).state.soul!.annals!.filter(a => a.kind === 'battle').map(a => a.turn)).toEqual([12]);
      expect(viewFor(s, 0).state.soul!.annals!.filter(a => a.kind === 'battle').map(a => a.turn)).toEqual([9, 12]);
    }
  });

  it('a capture where a fleet fell before recalls it ("where the Long Watch fell") only if everyone saw it fall', () => {
    let recalled = 0;
    for (let seed = 1; seed <= 20; seed++) for (const sawIt of [true, false]) {
      const s = game(seed);
      const R = free(s)[0];
      const [n0, n1] = [s.players[0].name, s.players[1].name];
      const fell: Headline = { kind: 'destroyed', text: headline(s, 'destroyed', { f: 'Long Watch', r: R.name, a: n1 }), region: R.id, players: [1, 0], drama: 5, public: false };
      edition(s, 9, [fell], sawIt ? all(R.id) : both(R.id));
      const ed = edition(s, 14, [{ kind: 'capture', text: `${n0} takes ${R.name} from ${n1}`, region: R.id, players: [0, 1], drama: 5, public: true }], all(R.id));
      const cap = ed.headlines.find(h => h.kind === 'capture')!;
      if (sawIt) { if (cap.body!.includes('Long Watch')) recalled++; }
      else expect(cap.body).not.toContain('Long Watch');
    }
    expect(recalled).toBeGreaterThanOrEqual(15);
  });

  it('a fallen commander gets an obituary: dates and deeds, the same readers as the death, the memorial byline', () => {
    for (let seed = 1; seed <= 15; seed++) {
      const s = game(seed);
      const R = free(s)[0];
      const f = fleetAt(s, 0, R.id, 'Ember Wake', 'Sunniva Achterberg');
      f.epithets = ['the Unbroken'];
      f.banner!.foundedTurn = 2;
      s.turn = 11;
      archiveFleet(s, f, 'destroyed', R.id);
      const death: Headline = { kind: 'death', text: headline(s, 'death', { c: 'Sunniva Achterberg', f: 'Ember Wake', r: R.name }), region: R.id, players: [0], drama: 7, public: false };
      const ed = edition(s, 11, [death], both(R.id));
      const ob = ed.headlines.find(h => h.kind === 'obituary')!;
      expect(ob, `seed ${seed}`).toBeTruthy();
      expect(ob.text).toBe('Obituary: Sunniva Achterberg');
      expect(ed.headlines.indexOf(ob)).toBe(ed.headlines.findIndex(h => h.kind === 'death') + 1);
      expect(ob.public).toBe(false);
      expect(ob.body).toContain('Sunniva Achterberg');
      expect(ob.byline).toMatch(/for the memorial page$/);
      expect(ob.body).not.toMatch(/\{|\}|undefined/);
      expect(readerSees(s, 0, 'obituary').length).toBe(1);
      expect(readerSees(s, 1, 'obituary').length).toBe(1);   // its sensors covered the system
      expect(readerSees(s, 2, 'obituary').length).toBe(0);   // fog: house 2 never saw it
    }
  });

  it('special editions mark the acts, once each, from public facts only', () => {
    // act I: the first edition of every game
    for (const { eds } of GAMES) {
      expect(eds[0].special?.act).toBe('claim');
      const acts = eds.filter(e => e.special).map(e => e.special!.n);
      expect(acts).toEqual([...acts].sort((a, b) => a - b));            // in order
      expect(new Set(acts).size).toBe(acts.length);                       // once each
      for (const e of eds.filter(x => x.special)) {
        const h = e.headlines.find(x => x.kind === `act_${e.special!.act}`)!;
        expect(h.public).toBe(true);
        expect(h.body).toBeTruthy();
      }
    }
    expect(GAMES.some(g => g.eds.some(e => e.special?.act === 'blood'))).toBe(true);
    // first blood comes from a public event between houses, never from a private battle alone
    const s = game(21);
    const R = free(s)[0];
    expect(edition(s, 6, [battleAt(s, R, [0, 1])], both(R.id)).special).toBeUndefined();
    const ed = edition(s, 7, [{ kind: 'capture', text: `${s.players[0].name} takes ${R.name} from ${s.players[1].name}`, region: R.id, players: [0, 1], drama: 5, public: true }], both(R.id));
    expect(ed.special?.act).toBe('blood');
    for (const p of [0, 1, 2]) expect(readerSees(s, p, 'act_blood').length).toBe(1);
    expect(edition(s, 8, [{ kind: 'capture', text: `${s.players[1].name} takes ${R.name} from ${s.players[0].name}`, region: R.id, players: [1, 0], drama: 5, public: true }], both(R.id)).special).toBeUndefined();
  });

  it('the crisis, the Throne and last orders', () => {
    const s = game(22);
    s.soul!.acts = ['claim', 'borders', 'blood'];
    s.players[2].vp = 20; s.players[0].vp = 6; s.players[1].vp = 4;
    const crisis = edition(s, 14, [], [new Set(), new Set(), new Set()]);
    expect(crisis.special?.act).toBe('crisis');
    expect(crisis.headlines.find(h => h.kind === 'act_crisis')!.text).toBe(`${s.players[2].name.toUpperCase()} GROWS FAT`);
    s.players[2].vp = 31;
    expect(edition(s, 16, [], [new Set(), new Set(), new Set()]).special?.act).toBe('throne');
    expect(edition(s, s.rules.victory.turnLimit - 1, [], [new Set(), new Set(), new Set()]).special?.act).toBe('last');
    expect(edition(s, s.rules.victory.turnLimit, [], [new Set(), new Set(), new Set()]).special).toBeUndefined();
  });

  it('a broken oath has anniversaries, in public', () => {
    const s = game(23);
    const R = free(s)[0];
    s.players[0].oathbreaker = [{ turn: 5, victim: 1, words: 'Not one ship past the Veil' }];
    edition(s, 5, [{ kind: 'oath', text: headline(s, 'oath', { a: s.players[0].name, b: s.players[1].name, x: 'Not one ship past the Veil' }), region: R.id, players: [0, 1], drama: 9, public: true }], both(R.id));
    const ed = edition(s, 15, [], [new Set(), new Set(), new Set()]);
    const an = ed.headlines.find(h => h.kind === 'anniversary')!;
    expect(an).toBeTruthy();
    expect(an.text).toBe(`Ten turns since ${s.players[0].name} broke faith with ${s.players[1].name}`);
    expect(an.public).toBe(true);
    expect(edition(s, 16, [], [new Set(), new Set(), new Set()]).headlines.some(h => h.kind === 'anniversary')).toBe(false);
  });
});
