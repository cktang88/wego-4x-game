// Notification chips (docs/UX-V2.md §1, bottom-left): at most 3, icon + up to 5 words, each jumps to its
// subject. Derived fresh from the last turn's result and the current state, so they never go stale.
// Phone: folded into one badge that opens the list.
import type { GameScreen } from '../game.ts';
import { connected, supplied } from '../../../shared/sim/empire.ts';
import { esc } from '../ui/dom.ts';
import { shortName, tip } from './util.ts';
import { soulNotes } from './soul.ts';
import { systemNotes } from './systems.ts';

export interface Note { key: string; icon: string; text: string; tone: 'bad' | 'good' | 'gold' | 'info'; p: number; go: () => void }

/** Planning nags (a choice to make, research to buy, a full bank, terms offered): they live on the plan strip's
 *  "to do" tab, not in the notice stack over the map. */
const NAG = /^(?:cal|hon|trib)\d|^bank$/;
export function planNags(g: GameScreen): Note[] { return allNotes(g).filter(n => NAG.test(n.key)); }
export function notes(g: GameScreen): Note[] { return allNotes(g).filter(n => !NAG.test(n.key)); }
function allNotes(g: GameScreen): Note[] {
  const st = g.st, you = g.you, out: Note[] = [];
  const at = (rid: number) => () => { if (st.regions[rid]) { g.select({ kind: 'region', id: rid }); g.focus(st.regions[rid].site); } };
  const rn = (rid: number) => shortName(st.regions[rid]?.name ?? '?', 2);
  // battles: during a replay, the ones played so far; otherwise last turn's that involved you
  const R = g.replay;
  const battles = R ? R.result.battles.filter(b => R.seen.includes(b.id)) : (st.last?.battles ?? []).filter(b => you === null || b.sides.some(s => s.owner === you));
  for (const b of battles.slice(-3)) {
    const won = you !== null && b.winner === you, lost = you !== null && b.winner !== null && b.winner !== you && b.sides.some(s => s.owner === you);
    out.push({ key: `b${b.id}`, icon: '⚔', text: `${won ? 'Won' : lost ? 'Lost' : 'Battle'} at ${rn(b.region)}`, tone: won ? 'good' : lost ? 'bad' : 'info', p: 1, go: () => g.openBattle(b.id) });
  }
  if (!R && st.last && you !== null) {
    for (const e of st.last.events) {
      if (e.k !== 'capture') continue;
      if (e.by === you) out.push({ key: `c${e.region}`, icon: '⚑', text: `Took ${rn(e.region)}`, tone: 'good', p: 2, go: at(e.region) });
      else if (e.from === you) out.push({ key: `l${e.region}`, icon: '⚠', text: `Lost ${rn(e.region)}`, tone: 'bad', p: 0, go: at(e.region) });
    }
    const fails = st.last.events.filter(e => e.k === 'fail' && e.owner === you).length;
    if (fails) out.push({ key: 'fail', icon: '⚠', text: `${fails} order${fails > 1 ? 's' : ''} failed`, tone: 'bad', p: 3, go: () => g.openModal('chronicle') });
  }
  if (you !== null && st.winner === null) {
    // threats to your capital and crowns
    for (const r of st.regions) {
      if (r.owner !== you || !(r.kind === 'home' || r.kind === 'crown' || r.kind === 'throne')) continue;
      const near = st.fleets.some(f => f.owner !== you && f.ships.length && (f.region === r.id || r.neighbors.includes(f.region)) && !st.pacts.some(p => p.until >= st.turn && [p.a, p.b].includes(f.owner) && [p.a, p.b].includes(you)));
      if (near) out.push({ key: `t${r.id}`, icon: '⚠', text: `Enemy near ${rn(r.id)}`, tone: 'bad', p: 0, go: at(r.id) });
    }
    if (st.rules.empire?.enabled !== false) {
      const conn = connected(st, you);
      const cut = st.regions.filter(r => r.owner === you && !conn.has(r.id));
      if (cut.length) out.push({ key: 'cut', icon: '⚠', text: `${rn(cut[0].id)} cut off`, tone: 'bad', p: 4, go: at(cut[0].id) });
      const sup = supplied(st, you, conn);
      const oos = st.fleets.find(f => f.owner === you && f.ships.length && !sup.has(f.region));
      if (oos) out.push({ key: 'oos', icon: '⚠', text: `${shortName(oos.name, 2)} unsupplied`, tone: 'bad', p: 5, go: () => { g.select({ kind: 'fleet', id: oos.id }); g.focus(st.regions[oos.region].site); } });
    }
    const dig = st.fleets.find(f => f.owner === you && st.regions[f.region]?.relic === 'unclaimed' && st.regions[f.region].owner === you);
    if (dig) out.push({ key: 'dig', icon: '✧', text: `Relic at ${rn(dig.region)}`, tone: 'gold', p: 3, go: () => { g.select({ kind: 'fleet', id: dig.id }); g.focus(st.regions[dig.region].site); } });
    for (const n of soulNotes(g)) out.push({ ...n, tone: 'gold', p: 1 });
    for (const n of systemNotes(g)) out.push({ ...n, p: n.tone === 'bad' ? 0 : 1 });
    // (research ready: the primary button and the Empire tool's dot say so; no notice over the map)
    if (g.live && g.bank >= st.rules.live.bankCap) out.push({ key: 'bank', icon: '⏱', text: 'Order bank full', tone: 'gold', p: 2, go: () => g.nextIdle() });
    const ed = st.edicts.find(e => e.scoresTurn === st.turn);
    if (ed) out.push({ key: `e${ed.id ?? ed.name}`, icon: '♛', text: `Edict: ${shortName(ed.name, 2)}`, tone: 'gold', p: 7, go: () => g.openModal('score') });
  }
  if (g.unreadChat) out.push({ key: 'chat', icon: '✉', text: `${g.unreadChat} new message${g.unreadChat > 1 ? 's' : ''}`, tone: 'info', p: 1, go: () => g.openModal('score', 'chat') });
  return out.sort((a, b) => a.p - b.p);
}

let expanded = false;
let current: Note[] = [];
/** News (battles, captures, failed orders, edicts) is shown for a while, then folds into the "+N" pill; the
 *  notices that ask for something (threats, choices, research, terms) stay until dealt with. At most 3 chips. */
const NEWS = /^(?:[bcl]\d|fail$|e)/;
const NEWS_MS = 12000;
const MAX_SHOWN = 2;
const firstSeen = new Map<string, number>();
let refresh = 0;
export function renderNotes(g: GameScreen, el: HTMLElement) {
  current = notes(g);
  const list = current;
  const now = performance.now();
  const turn = g.st.turn;
  let soonest = Infinity;
  const fresh = (n: Note) => {
    if (!NEWS.test(n.key)) return true;
    const k = `${turn}:${n.key}`;
    if (!firstSeen.has(k)) firstSeen.set(k, now);
    const left = NEWS_MS - (now - firstSeen.get(k)!);
    if (left > 0) soonest = Math.min(soonest, left);
    return left > 0;
  };
  let html = '';
  if (g.phone) {
    if (list.length) {
      const tone = list.some(n => n.tone === 'bad') ? 'bad' : list[0].tone;
      html = `<button class="nbadge ${tone}" data-n="more" aria-label="${list.length} notice${list.length > 1 ? 's' : ''}"${tip('Notices')}>${esc(list[0].icon)}<b>${list.length}</b></button>`;
      if (expanded) html += `<div class="nlist">${list.map((n, i) => chip(n, i)).join('')}</div>`;
    }
  } else {
    const live = list.map((n, i) => ({ n, i })).filter(x => fresh(x.n));
    const shown = expanded ? list.map((n, i) => ({ n, i })) : live.slice(0, MAX_SHOWN);
    const rest = list.length - shown.length;
    html = shown.map(x => chip(x.n, x.i)).join('') +
      (!expanded && rest > 0 ? `<button class="nchip more" data-n="more" aria-label="${rest} more notice${rest > 1 ? 's' : ''}"${tip('More notices')}>+${rest}</button>`
        : expanded && list.length > MAX_SHOWN ? `<button class="nchip more" data-n="more" aria-label="Fewer notices">−</button>` : '');
  }
  g.setHtml(el, html);
  // fold the news away when it goes stale (one timer at a time)
  if (soonest < Infinity && !refresh) refresh = window.setTimeout(() => { refresh = 0; if (!g.destroyed) renderNotes(g, el); }, soonest + 60);
}
const chip = (n: Note, i: number) => `<button class="nchip ${n.tone}" data-n="${i}" data-pop="note:${esc(n.key)}"${n.key.startsWith('b') ? ` data-battle="${esc(n.key.slice(1))}"` : ''}><i>${esc(n.icon)}</i><span>${esc(n.text)}</span></button>`;

export function bindNotes(g: GameScreen, el: HTMLElement) {
  el.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-n]');
    if (!b) return;
    if (b.dataset.n === 'more') { expanded = !expanded; renderNotes(g, el); return; }
    const n = current[Number(b.dataset.n)];
    if (g.phone) expanded = false;
    n?.go();
  });
}
