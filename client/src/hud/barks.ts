// Commander barks (docs/DELIGHT.md #44): one short line in the fleet card's Story, in the commander's voice, keyed to
// the fleet's true record (where it has been, what it bears, how it fights). Hades-style: the most pertinent line wins,
// and a line is never spoken twice in a game by the same fleet; within a turn the line stays put.
import type { GameScreen } from '../game.ts';
import type { Fleet } from '../../../shared/sim/types.ts';

const NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const num = (n: number) => NUM[n] ?? String(n);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

interface Line { id: string; ok: boolean; text: () => string }
function lines(g: GameScreen, f: Fleet): Line[] {
  const st = g.st, c = f.commander;
  const here = st.regions[f.region]?.name ?? '';
  const beatsHere = (f.saga ?? []).filter(b => b.region === f.region && b.kind !== 'founded');
  const hp = f.ships.reduce((a, s) => a + s.hp, 0), max = f.ships.reduce((a, s) => a + s.maxHp, 0) || 1;
  const scars = f.scars?.length ?? 0;
  return [
    { id: 'limp', ok: !!f.limping, text: () => 'Just get us home.' },
    { id: 'routed-here', ok: beatsHere.some(b => b.kind === 'rout'), text: () => `${here}. We ran from here once.` },
    { id: 'again-here', ok: beatsHere.length > 0, text: () => `${here} again. I know these stars.` },
    { id: 'legend', ok: c.rank >= 5, text: () => 'They know our name now.' },
    { id: 'scarred', ok: scars >= 2, text: () => `${cap(num(scars))} scars. Still flying.` },
    { id: 'hull', ok: hp / max < 0.35, text: () => 'Patch what you can. We are not done.' },
    { id: 'oos', ok: (f.oos ?? 0) >= 1, text: () => 'Rations are thin, Admiral.' },
    { id: 'veteran', ok: c.deeds.wins >= 3, text: () => `${cap(num(c.deeds.wins))} fights won. I will take another.` },
    { id: 'vow', ok: !!f.vow, text: () => 'We swore it. We keep it.' },
    { id: 'home', ok: !!f.banner && f.region === f.banner.home, text: () => 'Home waters. Quiet, for now.' },
    { id: 'untried', ok: c.rank <= 1 && c.deeds.wins === 0, text: () => 'Untried. Give us the chance.' },
  ];
}

type Said = Record<string, { id: string; turn: number }[]>;
const key = (g: GameScreen) => `tc.barks.${g.gameKey()}`;
function load(g: GameScreen): Said { try { return JSON.parse(localStorage.getItem(key(g)) ?? '{}') ?? {}; } catch { return {}; } }
const mem = new Map<string, Said>();

/** This turn's bark for one of your fleets (or a rival's you can see), or '' when it has nothing new to say. */
export function barkFor(g: GameScreen, f: Fleet): string {
  if (!f.ships.length || f.owner < 0) return '';
  const k = key(g);
  const said = mem.get(k) ?? load(g);
  mem.set(k, said);
  const mine = said[f.id] ?? [];
  const now = mine.find(x => x.turn === g.st.turn);
  const L = lines(g, f);
  if (now) return L.find(l => l.id === now.id)?.text() ?? '';
  const pick = L.find(l => l.ok && !mine.some(x => x.id === l.id));
  if (!pick) return '';
  said[f.id] = [...mine, { id: pick.id, turn: g.st.turn }];
  try { localStorage.setItem(k, JSON.stringify(said)); } catch { /* the bark is only for this sitting */ }
  return pick.text();
}
