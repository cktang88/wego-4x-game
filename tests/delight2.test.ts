// The second wave of delight details (client-only): the Herald's ink runs only where the reader's own intel
// contradicts a dispatch, and never in the liar's copy; the portraits' marks are earned, never invented.
import { describe, expect, it } from 'vitest';
import { createGame } from '../shared/sim/setup.ts';
import type { GameState, HeraldEdition } from '../shared/sim/types.ts';
import { lieCheck } from '../client/src/ui/ink.ts';
import { fleetPortrait, MAIMED_AT, GREY_AFTER } from '../client/src/hud/portrait.ts';
import { portraitCaption } from '../client/src/art/portraits.ts';
import { TEMPERS, aiHouseLine } from '../client/src/ui/houses.ts';

type Disp = HeraldEdition['dispatches'][number];
/** A reader's screen: what lieCheck reads (the state as this seat sees it, and what it can see). */
function reader(st: GameState, you: number, visible: number[]) {
  return { st, you, visibleSet: () => new Set(visible) } as unknown as Parameters<typeof lieCheck>[0];
}
const game = () => createGame({ seed: 4242, players: [0, 1, 2].map(() => ({ kind: 'ai' as const, aiLevel: 'standard' as const })) });
const say = (player: number, text: string): Disp => ({ player, text, as: 'house', byline: 'x' });

describe('Herald ink (DELIGHT #66)', () => {
  it('a claim that one of your fleets is destroyed smudges in your copy only while it still flies', () => {
    const st = game();
    const mine = st.fleets.find(f => f.owner === 0 && f.ships.length)!;
    mine.name = 'The Iron Vigil';
    const d = say(1, `${mine.name} is no more. We destroyed it.`);
    expect(lieCheck(reader(st, 0, []), d)).toMatch(/still flies/);
    // the third house cannot check it: clean
    expect(lieCheck(reader(st, 2, []), d)).toBeNull();
    // the liar's own copy prints clean
    expect(lieCheck(reader(st, 1, []), d)).toBeNull();
    // the fleet really gone: the words are true, no smudge
    mine.ships = [];
    expect(lieCheck(reader(st, 0, []), d)).toBeNull();
  });
  it('a fleet name another house also flies is ambiguous: clean, unless the dispatch names your house', () => {
    const st = game();
    const mine = st.fleets.find(f => f.owner === 0 && f.ships.length)!;
    const theirs = st.fleets.find(f => f.owner === 1 && f.ships.length)!;
    theirs.name = mine.name;
    expect(lieCheck(reader(st, 0, []), say(2, `${mine.name} is no more.`))).toBeNull();
    expect(lieCheck(reader(st, 0, []), say(2, `${st.players[0].name}'s ${mine.name} is no more.`))).toMatch(/still flies/);
  });
  it('a bankruptcy claim smudges only if your treasury really holds credits', () => {
    const st = game();
    const d = say(2, `${st.players[0].name} is bankrupt. Its captains are selling their guns.`);
    st.players[0].res.credits = 12;
    expect(lieCheck(reader(st, 0, []), d)).toMatch(/12 credits/);
    st.players[0].res.credits = 0;
    expect(lieCheck(reader(st, 0, []), d)).toBeNull();
  });
  it('a claim to hold a world is checked only against a world the reader can see', () => {
    const st = game();
    const w = st.regions.find(r => r.owner === 0 && r.kind !== 'lane')!;
    const d = say(1, `We hold ${w.name}, whatever they say.`);
    // reader 2 does not see it: cannot tell
    expect(lieCheck(reader(st, 2, []), d)).toBeNull();
    // reader 2 sees it, held by house 0: smudged
    expect(lieCheck(reader(st, 2, [w.id]), d)).toMatch(new RegExp(w.name));
    // true claim: no smudge
    w.owner = 1;
    expect(lieCheck(reader(st, 2, [w.id]), d)).toBeNull();
  });
  it('the AI templates that cannot be checked never smudge', () => {
    const st = game();
    for (const t of ['Peace with Crimson Dominion is still possible. For now.', 'Whoever holds the Throne next, it will not be them.', 'A great fleet has left the yards. Its destination is secret.'])
      expect(lieCheck(reader(st, 0, st.regions.map(r => r.id)), say(1, t))).toBeNull();
  });
});

describe('commander portraits (DELIGHT #37 #38)', () => {
  it('marks come from the fleet record: scars, two routs, Legend rank, long service', () => {
    const st = game();
    const f = st.fleets.find(x => x.owner === 0 && x.ships.length)!;
    let p = fleetPortrait(st, f, '#2f6ea6');
    expect(p.scars).toEqual([]);
    expect(p.maimed || p.legend || p.grey).toBe(false);
    f.scars = [{ id: 'burned', turn: 3 }]; f.routs = Array.from({ length: MAIMED_AT }, (_, i) => i + 2); f.commander.rank = 5;
    st.turn = (f.banner?.foundedTurn ?? f.bornTurn) + GREY_AFTER;
    p = fleetPortrait(st, f, '#2f6ea6');
    expect(p.scars).toEqual(['burned']);
    expect(p.maimed && p.legend && p.grey).toBe(true);
    expect(portraitCaption(p, { burned: { name: 'Burned Hull' } })).toMatch(/Burned Hull.*eye.*laurel.*grey/);
  });
});

describe('rival houses (DELIGHT #3)', () => {
  it('every AI level has a temper; a human house has none', () => {
    for (const k of ['novice', 'standard', 'expert'] as const) expect(TEMPERS[k].motto.length).toBeGreaterThan(3);
    expect(aiHouseLine({ kind: 'ai', aiLevel: 'expert', color: '#a3303a', name: 'Crimson Dominion' })).toBe('the Crimson, who never forgive');
    expect(aiHouseLine({ kind: 'human', aiLevel: 'expert', color: '#a3303a', name: 'Crimson Dominion' })).toBeNull();
  });
});

import { byAThread } from '../client/src/fx/battlefacts.ts';
import type { BattleReport } from '../shared/sim/types.ts';
describe('BY A THREAD (DELIGHT #57)', () => {
  const rep = (shots: BattleReport['rounds'][number]['shots']): BattleReport => ({
    id: 1, name: 'Vel', turn: 3, pulse: 0, region: 0, winner: 0, losses: {}, highlights: [],
    sides: [{ owner: 0, fleets: [], ships: [{ id: 1, name: 'Stubborn', cls: 'frigate', hp: 40, maxHp: 40, fleet: 1 }] }, { owner: 1, fleets: [], ships: [{ id: 2, name: 'Other', cls: 'frigate', hp: 40, maxHp: 40, fleet: 2 }] }],
    rounds: [{ shots, retreats: [] }],
  });
  it('a ship left at 5% hull or less, alive, is named; misses, Twists and the dead are not', () => {
    expect(byAThread(rep([{ from: 2, to: 1, dmg: 38 }])).map(x => x.name)).toEqual(['Stubborn']);
    expect(byAThread(rep([{ from: 2, to: 1, dmg: 30 }]))).toEqual([]);
    expect(byAThread(rep([{ from: 2, to: 1, dmg: 38, miss: true }]))).toEqual([]);
    expect(byAThread(rep([{ from: 2, to: 1, dmg: 38, twist: true }]))).toEqual([]);
    expect(byAThread(rep([{ from: 2, to: 1, dmg: 40, kill: true }]))).toEqual([]);
  });
});
