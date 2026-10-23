// A small harness for the Court modules (not part of the game build): a real game state with a captive, terms, an
// open Coronation and an exile, each module mounted twice where it has two states. Open /src/court/harness.html on a
// Vite dev server (root: client). `?state=chosen` shows every module with a decision already in the plan.
import '../icons.css';
import '../art/kit.css';
import { createGame, newFleet, newShip } from '../../../shared/sim/setup.ts';
import { ensureSoul } from '../../../shared/sim/soul.ts';
import { ensureCourt, captureCommander } from '../../../shared/sim/court.ts';
import { Rng } from '../../../shared/sim/rng.ts';
import type { FreeAction, GameState } from '../../../shared/sim/types.ts';
import { mountCaptiveCard, mountRansomOffer, mountDecreePrompt, mountWhisperPanel, sameCourtAction, type CourtMount } from './index.ts';

const chosen = new URLSearchParams(location.search).get('state') === 'chosen';
const s: GameState = createGame({ seed: 23, players: [0, 1, 2].map(() => ({ kind: 'human' as const })) });
ensureSoul(s);
const ct = ensureCourt(s)!;
s.turn = 14;
for (const p of s.players) p.res = { industry: 80, credits: 41, influence: 9 };
s.players[0].vp = 22; s.players[1].vp = 17; s.players[2].vp = 9;
const rng = new Rng(9);
const fleet = (owner: number, name: string, cmd: string, rank: number) => {
  const f = newFleet(s, rng, owner, s.players[owner].capital);
  f.ships.push(newShip(s, rng, 'frigate', owner));
  f.name = name; f.commander.name = cmd; f.commander.rank = rank;
  f.scars = [{ id: 'burned', turn: 9 }, { id: 'grudge', turn: 12, vs: 1 }];
  return f;
};
const where = s.regions.find(r => r.kind === 'colony')!.id;
const a = fleet(0, 'the Dawn Patrol', 'Maximiliana Throckmorton', 3);
const c1 = captureCommander(s, a, 1, where, 1, () => {})!;            // you (seat 1) hold Azure's commander
c1.turn = 13; c1.until = 17;
const b = fleet(1, 'the Ember Wing', 'Ines Achterberg', 2);
const c2 = captureCommander(s, b, 0, where, 1, () => {})!;            // Azure holds yours, terms named last turn
c2.turn = 12; c2.until = 16; c2.offer = { res: 'credits', amount: 20, turn: 13 };
s.throne.owner = 0;
ct.coronation = { holder: 0, since: 13, until: 15, answers: { 2: 'defy' } };
s.players[2].eliminated = false;
// the exile panel is for seat 2 in a copy where it has fallen
const ex: GameState = structuredClone(s);
ex.players[2].eliminated = true;
ex.court!.coronation = null;
ex.wardenAwake = true;
ex.court!.exiles = [{ p: 2, since: 11, whisper: 0, vote: null, tally: [7, 2, 0] }];

const grid = document.getElementById('grid')!;
const log = document.getElementById('log')!;
const plans: Record<string, FreeAction[]> = { captive: [], ransom: [], decree: [], exile: [] };
if (chosen) {
  plans.captive = [{ type: 'captive', id: c1.id, act: 'execute' }];
  plans.ransom = [{ type: 'ransom', id: c2.id, pay: true }];
  plans.decree = [{ type: 'decree', answer: 'kneel' }];
  plans.exile = [{ type: 'exile', whisper: 1, vote: 0 }];
}
const cell = (label: string) => {
  const d = document.createElement('div'); d.className = 'hz-cell';
  d.innerHTML = `<span class="hz-label">${label}</span>`;
  grid.appendChild(d);
  return d;
};
const mounts: { m: CourtMount<any>; key: string; props: () => any }[] = [];
const refresh = () => {
  for (const x of mounts) x.m.update({ ...x.props(), pending: plans[x.key] });
  log.textContent = `Plan: ${JSON.stringify(Object.values(plans).flat())}`;
};
const handlers = (key: string) => ({
  onAction(fa: FreeAction) { plans[key] = [...plans[key].filter(x => !sameCourtAction(fa)(x)), fa]; refresh(); },
  onClear(match: (fa: FreeAction) => boolean) { plans[key] = plans[key].filter(x => !match(x)); refresh(); },
});
const add = (key: string, label: string, mount: (host: HTMLElement, p: any, h: any) => CourtMount<any>, props: () => any) => {
  const m = mount(cell(label), { ...props(), pending: plans[key] }, handlers(key));
  mounts.push({ m, key, props });
};
add('captive', 'Captive card (captor)', mountCaptiveCard, () => ({ st: s, you: 1, captiveId: c1.id }));
add('ransom', 'Ransom offer (owner)', mountRansomOffer, () => ({ st: s, you: 1, captiveId: c2.id }));
add('decree', 'Kneel or Defy (a rival)', mountDecreePrompt, () => ({ st: s, you: 1 }));
add('exile', 'Exile: whisper panel', mountWhisperPanel, () => ({ st: ex, you: 2 }));
refresh();
(window as unknown as { __court: unknown }).__court = { plans, refresh };
